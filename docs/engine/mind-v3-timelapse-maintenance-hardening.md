# Mind v3 Timelapse Maintenance Hardening

## Status

Accepted implementation specification.

This spec hardens the existing Mind v3 timelapse-maintenance pipeline based on failures observed during the first real overnight timelapse after Mind v3 rollout.

It does **not** redesign Mind v3, change the memory/belief conceptual model, or change ordinary roleplay behavior. It only makes existing timelapse maintenance protocols bounded, deterministic at ingress, and correctly staged after partial failures.

---

# 1. Observed production failures

The first overnight Mind v3 run exposed four independent protocol problems.

## 1.1 Duplicate belief effects caused whole STM results to fail

A semantically useful STM response could be rejected because the same belief appeared more than once in `beliefEffects` and/or `activatedBeliefIds`.

This is too brittle for auxiliary model output. Repeated references to the same belief are often unambiguous redundancy rather than a meaningful protocol conflict.

However, duplicates must not be blindly summed because that would allow repetition in model output to amplify confidence or activation.

## 1.2 LTM consolidation was still effectively unbounded

STM consolidation has already been hardened to operate as a bounded delta over existing STM.

LTM consolidation still permits a much larger write surface. During the overnight run, the model attempted a broad rewrite/reorganization and hit its completion-token limit before returning a valid complete response.

Raising the token limit alone would preserve the structural problem and merely make the failure more expensive.

## 1.3 Belief reconciliation prompt and validator disagree on shape

Multiple characters produced semantically reasonable reconciliation proposals that failed validation because the model used fields such as singular `beliefId` or `candidateBeliefId` while the validator expected `beliefIds`.

Because the same pattern occurred across several characters, this is treated as a protocol-contract bug rather than isolated model misbehavior.

## 1.4 Dependent maintenance stages continued after upstream failure

The current timelapse maintenance flow may continue into later cognitive stages after an earlier stage has failed.

Example failure chain:

```text
post-timelapse STM fails
    ↓
LTM still runs against state that did not receive the intended STM update
    ↓
reconciliation still runs
```

This wastes auxiliary requests and allows later stages to reason over an unexpectedly stale intermediate mind state.

---

# 2. Scope

This hotfix changes only:

- STM auxiliary-result ingress normalization for duplicate belief references;
- LTM consolidation write-set policy and validation;
- reconciliation response schema/prompt compatibility;
- timelapse maintenance stage gating;
- regression tests and diagnostics for those behaviors.

It does not change:

- verbatim retention counts;
- ordinary STM trigger thresholds;
- belief confidence mathematics;
- activation mathematics;
- the meaning of STM, LTM, beliefs, or relationships;
- background STM async stale semantics already introduced by the previous hotfix;
- canonical world/timelapse simulation;
- portable mind semantics;
- migration semantics.

---

# 3. STM duplicate belief-effect normalization

## 3.1 Principle

Auxiliary output may contain redundant references to the same belief. Ingress should deterministically normalize harmless redundancy before strict candidate validation.

Normalization must never create extra evidential weight merely because the model repeated itself.

## 3.2 Same-direction duplicate effects

Given multiple effects for the same belief and the same direction:

```js
{ beliefId: "b1", effect: "supports", strength: 0.4 }
{ beliefId: "b1", effect: "supports", strength: 0.7 }
```

normalize to one effect:

```js
{ beliefId: "b1", effect: "supports", strength: 0.7 }
```

Use the **maximum strength**, never the sum and never repeated application.

The same rule applies to repeated `contradicts` or repeated `ambiguous` effects.

## 3.3 Opposing effects for the same belief

If one response contains both support and contradiction for the same belief:

```text
supports(b1)
contradicts(b1)
```

do not apply both independently.

Normalize the direct confidence effect to:

```js
{ beliefId: "b1", effect: "ambiguous", strength: max(all relevant strengths) }
```

Consequences:

- no direct confidence movement for that response;
- the belief may still receive activation because the evidence was psychologically salient;
- diagnostics should record that conflicting evidence directions were collapsed to ambiguous.

This preserves uncertainty rather than letting arbitrary output ordering decide confidence.

## 3.4 Activated belief IDs

`activatedBeliefIds` is normalized to unique stable IDs before validation and application.

A repeated ID produces one activation application only.

## 3.5 Limits

Existing STM write/effect limits are applied **after normalization**.

A response must not be rejected merely because harmless duplicate entries caused the raw array length to exceed a limit when the normalized semantic write-set is within bounds.

Invalid or unknown belief IDs remain validation errors.

---

# 4. LTM consolidation must be delta-only

## 4.1 Principle

Existing LTM is read-only context by default.

LTM consolidation is not a general opportunity to rewrite, retopic, beautify, or normalize the character's complete durable memory store.

The request exists to integrate the STM material currently eligible for durable consolidation.

## 4.2 Model instruction

The LTM prompt must explicitly state:

- existing LTM should remain unchanged unless current eligible STM materially changes a specific durable topic;
- prefer one update to an existing matching topic over creating duplicates;
- do not rewrite records for style consistency;
- do not retopic legacy records merely because a better label can be imagined;
- do not emit unchanged/no-op upserts;
- output only the minimal delta required by the current consolidation;
- previously processed memories are context, not automatically fresh evidence.

The prompt should include a compact machine-readable write-policy block alongside the normal natural-language instructions.

## 4.3 Bounded LTM write-set

Default hard limits for one LTM consolidation response:

```text
MAX_LTM_WRITES_PER_PASS = 6
MAX_STM_RETIREMENTS_PER_PASS = 12
MAX_LTM_BELIEF_EFFECTS_PER_PASS = 6
MAX_LTM_NEW_BELIEFS_PER_PASS = 3
MAX_LTM_ACTIVATED_BELIEFS_PER_PASS = 8
```

`MAX_LTM_WRITES_PER_PASS` means:

```text
ltm upserts + ltm additions <= 6
```

The exact constants remain centralized Mind v3 tuning values, but the existence of a small bounded write-set is structural.

## 4.4 STM retirement

STM may only be retired when the returned LTM delta successfully and durably represents that material under existing protected-memory rules.

Retirement IDs:

- must reference eligible STM source records;
- must be unique after ingress normalization;
- must not exceed the per-pass retirement limit;
- are applied only after complete candidate validation and successful atomic commit.

No source STM is removed on timeout, truncation, parse failure, protocol failure, stale result, or candidate validation failure.

## 4.5 No-op LTM upserts

An LTM upsert that is materially identical to the existing record is invalid/no-op work and should not count as a useful write.

Prefer rejecting the no-op proposal at validation rather than committing meaningless revision churn.

## 4.6 Completion budget

Do **not** increase the LTM completion-token limit as part of this hotfix unless bounded-delta responses still demonstrably truncate after the write-set fix.

The first remedy is bounded output, not a larger output ceiling.

---

# 5. Reconciliation protocol hardening

## 5.1 Exact response schema in prompt

The reconciliation prompt must include the complete expected response shape, not only prose descriptions of allowed operations.

For example:

```js
{
  resolutions: [
    {
      action: "revise" | "merge" | "weaken" | "reinforce" |
              "contextualize" | "supersede" | "remove" |
              "leave_unresolved",
      beliefIds: ["belief-id", "..."],
      replacementText?: "...",
      survivorBeliefId?: "...",
      effect?: "supports" | "contradicts" | "ambiguous",
      strength?: 0.0,
      reasoning?: "short diagnostic explanation"
    }
  ],
  activatedBeliefIds: []
}
```

Exact field names should match the actual validator implementation.

The model must be told that `beliefIds` is always an array, including single-belief operations.

## 5.2 Narrow ingress adapter for singular-ID aliases

For obvious single-belief proposals only, ingress may normalize:

```js
beliefId: "b1"
```

or:

```js
candidateBeliefId: "b1"
```

into:

```js
beliefIds: ["b1"]
```

only when:

- `beliefIds` is absent;
- exactly one unambiguous singular source ID is present;
- that ID exists in the reconciliation candidate set.

Do not guess missing participants for merge/contextualize/supersede from text or from `survivorBeliefId`.

Ambiguous proposals remain validation failures.

## 5.3 Resolution count

Candidate selection and response limits should agree.

Default:

```text
MAX_RECONCILIATION_RESOLUTIONS = 5
```

The prompt must explicitly request at most five resolutions.

Candidate selection should normally provide only the small cluster(s) necessary to make those resolutions meaningful rather than exposing a large unrelated belief set.

## 5.4 Duplicate reconciliation references

Exact duplicate `activatedBeliefIds` may be uniqued.

Duplicate or overlapping destructive resolutions affecting the same belief in incompatible ways must not be silently ordered and applied. Reject the incompatible response atomically.

## 5.5 `leave_unresolved`

`leave_unresolved` remains a first-class successful result.

It must not require belief mutation and must not be transformed into an error merely because no text/confidence change occurred.

---

# 6. Timelapse maintenance stage gating

## 6.1 Principle

Timelapse world simulation and timelapse mind maintenance are separate concerns.

A completed night remains a completed night even if auxiliary cognitive maintenance partially fails.

Within mind maintenance, however, later semantic stages must not run when their required upstream representation failed to commit.

## 6.2 Pre-timelapse boundary

Existing behavior remains:

```text
forced pre-timelapse STM consolidation
```

If it succeeds:

- pre-timelapse verbatim eviction commits normally;
- timelapse proceeds.

If it fails:

- pre-timelapse verbatim remains intact;
- no source memory is lost;
- timelapse may still proceed according to existing non-fatal boundary policy;
- diagnostics record the failed boundary.

This hotfix does not make failed pre-boundary consolidation abort the physical night.

## 6.3 Post-timelapse stage order

The canonical post-timelapse mind-maintenance dependency chain becomes:

```text
post-timelapse STM
    ↓ on success
LTM consolidation
    ↓ on success
belief reconciliation
    ↓
activation decay
```

Higher-order belief effects that are part of the LTM stage remain part of that stage.

## 6.4 STM failure

If post-timelapse STM fails:

- preserve all uncommitted verbatim source records;
- skip LTM consolidation for that character in this maintenance cycle;
- skip belief reconciliation for that character in this maintenance cycle;
- still apply activation decay;
- return/record a partial-maintenance diagnostic.

Reason: LTM and reconciliation should not reason as if the intended new STM representation existed when it did not commit.

## 6.5 LTM failure

If STM succeeds but LTM fails:

- keep successfully committed STM changes;
- preserve all uncommitted STM sources that the failed LTM stage would have retired;
- skip reconciliation for that character in this maintenance cycle;
- still apply activation decay;
- return/record a partial-maintenance diagnostic.

## 6.6 Reconciliation failure

If STM and LTM succeed but reconciliation fails:

- retain the successfully committed STM/LTM state;
- make no partial reconciliation mutation;
- still apply activation decay;
- record the failure diagnostically.

## 6.7 Activation decay

Activation decay reflects elapsed time rather than success of reflective model work.

Therefore it should run after the night's maintenance attempt even when STM, LTM, or reconciliation fails.

Decay must continue to affect activation only and must not change confidence or delete memory.

---

# 7. Atomicity and failure semantics

Each individual model-driven stage remains independently atomic:

```text
snapshot
→ model request
→ parse
→ ingress normalization
→ strict validation
→ stale/source check
→ apply to candidate clone
→ candidate validation
→ atomic commit
→ source retirement/eviction
```

Ingress normalization is not a substitute for validation.

Allowed normalization is limited to semantically unambiguous cases defined by this spec:

- duplicate belief effects;
- duplicate activated IDs;
- bounded importance normalization already defined by the previous STM hotfix;
- singular reconciliation belief-ID aliases.

Do not invent missing memory IDs, infer merge partners from text, repair arbitrary malformed JSON structures, or silently coerce unknown enum values.

If normalization cannot make the result unambiguous, reject the stage and preserve its source state.

---

# 8. Diagnostics

For timelapse maintenance, record stage-level outcome per character, for example:

```js
{
  stm: "committed" | "failed" | "skipped",
  ltm: "committed" | "failed" | "skipped",
  reconciliation: "committed" | "failed" | "skipped",
  activationDecay: "applied" | "failed",
  failures: [
    { stage, code, message }
  ]
}
```

Exact representation may follow existing diagnostics structures.

A skipped dependent stage should be distinguishable from a stage that actually ran and failed.

Recommended diagnostic reasons:

```text
skipped_due_to_stm_failure
skipped_due_to_ltm_failure
```

Do not surface verbose provider output to normal roleplay UI.

---

# 9. Required invariants

The hotfix is accepted only if all of the following hold.

## STM ingress

1. Repeating the same support effect cannot amplify confidence more than the strongest single returned effect.
2. Repeating activation IDs cannot cause repeated activation bumps.
3. Simultaneous support and contradiction for one belief does not cause arbitrary double movement; it becomes ambiguous direct evidence.
4. Invalid/unknown IDs remain errors.
5. Source verbatim is removed only after a completely valid successful commit.

## LTM

6. Existing LTM is read-only by default.
7. One LTM pass has a small hard write-set.
8. No broad legacy retopicing/beautification is permitted.
9. STM retirements are bounded and occur only after successful LTM commit.
10. Truncated/invalid LTM output removes no STM.
11. Protected memory semantics remain unchanged.
12. Completion-token budget is not increased merely to accommodate unbounded rewriting.

## Reconciliation

13. Prompt and validator use one explicit response schema.
14. Single `beliefId`/`candidateBeliefId` may be adapted only when unambiguous.
15. Missing multi-belief participants are never guessed.
16. Maximum proposed resolutions matches validator capacity.
17. `leave_unresolved` is a valid successful outcome.
18. Conflicting destructive resolutions do not partially commit.

## Timelapse stage gating

19. Post-timelapse STM failure skips LTM and reconciliation for that character.
20. LTM failure skips reconciliation for that character.
21. Reconciliation failure does not roll back already committed STM/LTM.
22. Activation decay still runs after elapsed timelapse even when reflective stages fail.
23. A failed mind-maintenance stage does not undo successful physical timelapse world simulation.
24. Every skipped/failed stage is diagnostically visible.
25. No failure path silently drops source autobiographical memory.

---

# 10. Regression tests

Add tests covering at least:

## STM duplicate effects

1. Two support effects for one belief normalize to one effect using maximum strength.
2. Duplicate support is not applied twice.
3. Duplicate contradiction is not applied twice.
4. Support + contradiction for one belief normalizes to ambiguous confidence effect.
5. The conflicting belief still becomes eligible for activation.
6. Duplicate `activatedBeliefIds` produces one activation bump.
7. Unknown duplicate belief ID still fails validation and removes no verbatim.

## LTM bounded delta

8. Fixture with many existing LTM records returns one upsert and one add; unrelated LTM remains unchanged byte-for-byte.
9. More than six LTM writes is rejected atomically.
10. More than twelve STM retirements is rejected atomically.
11. Exact no-op LTM upsert is rejected or ignored according to chosen validator behavior without revision churn.
12. Invalid/truncated LTM response retires no STM.
13. Protected LTM cannot be retired/replaced contrary to protected-memory rules.
14. A valid compact LTM delta fits within the existing completion profile in the regression mock/protocol test.

## Reconciliation schema

15. Canonical `beliefIds: [id]` response validates.
16. Singular `beliefId` normalizes to `beliefIds:[id]` when unambiguous.
17. Singular `candidateBeliefId` normalizes likewise.
18. A merge with only `survivorBeliefId` and no source `beliefIds` is rejected.
19. More than five resolutions is rejected.
20. `leave_unresolved` with valid candidate IDs succeeds without belief deletion.
21. Two incompatible resolutions mutating the same belief reject atomically.

## Timelapse stage gating

22. STM success → LTM success → reconciliation success → decay runs all stages.
23. STM failure → LTM skipped → reconciliation skipped → decay still runs.
24. LTM failure after successful STM → reconciliation skipped → decay runs.
25. Reconciliation failure preserves committed STM and LTM and still decays activation.
26. Skipped stages make no provider/model request.
27. Diagnostics distinguish failed from skipped stages.
28. Physical timelapse remains committed despite non-fatal mind-maintenance failure.
29. Source verbatim/STM is preserved on every relevant failure path.

## Production regression fixture

30. Add a fixture structurally representative of the first real overnight Mind v3 failure:
    - migrated/large STM and LTM;
    - many beliefs;
    - duplicate belief effects;
    - reconciliation single-ID alias;
    - bounded LTM delta.
31. Assert the fixture completes without mass memory rewriting, token-limit-driven output growth, or source-memory loss.

---

# 11. Implementation boundaries

Preferred implementation remains localized to existing Mind v3 modules:

```text
stm-consolidation
    ingress normalization for belief effects / activation IDs

ltm-consolidation
    delta write policy, limits, validation

belief-reconciliation
    explicit schema, narrow alias adapter, resolution limits

timelapse mind-maintenance orchestration
    dependent stage gating and outcome diagnostics

mind-v3 configuration
    centralized bounded limits
```

Do not introduce a general-purpose arbitrary model-output repair framework.

Do not introduce blocking locks around ordinary gameplay.

Do not merge these stages into one giant model request.

---

# 12. Rollout / test procedure

After implementation:

1. Run focused Mind v3 regression tests.
2. Run night-timelapse tests.
3. Run the full project suite and build.
4. Apply the hotfix overlay to a clean copy of the current cumulative Mind v3 build and rerun tests/build.
5. Load the recovered pre-timelapse save whose last committed event is Mara saying:
   `Good night, Dmytro. Sleep well.`
6. Create a fresh emergency dump before triggering Sleep.
7. Run one real overnight timelapse.
8. Create a post-timelapse emergency dump.
9. Verify per character:
   - boundary STM outcome;
   - post-timelapse STM outcome;
   - LTM delta size;
   - reconciliation outcome or intentional unresolved result;
   - activation decay;
   - retained verbatim/source memory;
   - absence of mass legacy-memory rewrites.

Do not tune coefficients or memory thresholds as part of this rollout unless the hardened pipeline itself first passes structurally.

---

# 13. Final principle

The overnight maintenance pipeline should tolerate ordinary model redundancy and minor schema drift **without becoming permissive about meaning**.

The intended boundary is:

> normalize what is semantically unambiguous; strictly reject what would require guessing.

And for dependent cognitive work:

> a later reflective stage may consume only an upstream representation that actually committed successfully.

This preserves Mind v3's core rule: model semantics may be fuzzy, but canonical mutation, evidence accounting, source retirement, and failure recovery remain deterministic engine responsibilities.


## Superseded LTM count limits

The LTM per-pass numeric limits defined in this historical hardening spec are superseded by `mind-v3-ltm-evidence-driven-consolidation.md`. Structural validation, stage gating and failure-preservation semantics remain current.
