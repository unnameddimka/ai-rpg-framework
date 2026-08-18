# Mind v3 LTM Evidence-Driven Consolidation

## Status

Accepted implementation specification.

This specification replaces the remaining arbitrary operation-count limits in Mind v3 long-term-memory consolidation. It keeps the existing single-pass coverage-based retirement architecture, but makes consolidation volume depend on the complexity and significance of the character's remembered experience rather than fixed record-count caps.

## 1. Core rule

The engine must not reject a semantically grounded LTM maintenance result merely because the model proposes many justified changes in one pass.

The following LTM-stage numeric operation limits are removed:

- maximum LTM upserts/additions per pass;
- maximum higher-order belief effects per pass;
- maximum new beliefs per pass;
- maximum activated belief IDs per pass;
- maximum STM retirements per pass.

Structural validation, protected-memory rules, provenance, retirement coverage, candidate-world validation and atomic commit remain mandatory.

## 2. Full STM context

LTM consolidation receives the complete current STM set and existing LTM context needed to recognize broad autobiographical patterns. Do not artificially batch STM merely to keep the number of possible writes or retirements small.

There is no requirement to empty STM. Material omitted from all retirement groups remains available for later maintenance.

## 3. Dedicated completion budget

LTM consolidation uses the Utility model through a dedicated request profile:

```text
LTM_CONSOLIDATION_MAX_COMPLETION_TOKENS = 12000
```

This is output headroom, not a target. The prompt should prefer concise output, but completeness and preservation of meaningful autobiographical information take priority over artificial brevity.

Ordinary roleplay request limits are unchanged.

## 4. Evidence-driven delta

Existing LTM is persistent context and read-only by default.

The model should:

- omit unchanged LTM;
- update an existing matching durable topic when appropriate;
- add genuinely distinct durable themes when needed;
- avoid retopicing, beautifying or rewriting memories merely for style;
- make as many material changes as the remembered evidence actually justifies, with no arbitrary count limit.

Exact no-op LTM upserts are discarded by protocol ingress rather than creating revision churn.

## 5. LTM write provenance

Every material LTM upsert or addition must identify the remembered material that justifies it.

Existing LTM upsert:

```js
{
  id,
  topic,
  summary,
  importance,
  sourceStmIds: [],
  sourceLtmIds: []
}
```

New LTM:

```js
{
  ref: "new_ltm_1",
  topic,
  summary,
  importance,
  sourceStmIds: [],
  sourceLtmIds: []
}
```

At least one of `sourceStmIds` or `sourceLtmIds` must be non-empty.

`sourceStmIds` may reference only STM supplied to the current request. `sourceLtmIds` may reference only existing LTM supplied to the current request. Unknown, duplicate or malformed provenance IDs reject the result atomically.

The response-local `ref` for a new LTM is used only so retirement coverage may refer to that proposed durable memory. The engine allocates the canonical `memory_ai_*` ID at commit and does not persist `ref` or provenance fields into the character's autobiographical memory record.

Provenance is engine/debug metadata, not character consciousness.

## 6. STM retirement groups

STM retirement is unlimited by count but always explicit.

An STM may disappear only through exactly one validated retirement group.

### 6.1 Represented

```js
{
  stmIds: ["stm_1", "stm_2"],
  disposition: "represented",
  representedByLtmRefs: ["existing_ltm_id", "new_ltm_1"]
}
```

Use `represented` when meaningful durable autobiographical content from the retiring STM is preserved by one or more LTM records that will exist after the same atomic commit.

`representedByLtmRefs` may refer to existing LTM IDs or response-local refs of new LTM additions.

### 6.2 Safe to forget

```js
{
  stmIds: ["stm_3"],
  disposition: "safe_to_forget",
  representedByLtmRefs: [],
  reason: "routine"
}
```

Allowed initial reason codes are:

- `routine` — ordinary/repeated experience with no meaningful unique durable consequence;
- `redundant` — meaningful content is already duplicated elsewhere and this STM contributes no unique durable information;
- `transient` — temporarily relevant state that has resolved and no longer has durable autobiographical value.

The reason is compact machine-readable justification and debug metadata. It is not persisted as consciousness.

## 7. Material that should not be casually forgotten

The LTM prompt must explicitly warn against `safe_to_forget` for unique meaningful content, including:

- promises and agreements;
- personal boundaries;
- secrets;
- important biographical history;
- significant relationship developments;
- unresolved goals or conflicts;
- important discoveries;
- significant changes in understanding;
- emotionally defining episodes;
- consequential causal facts likely to matter later.

If the model is unsure whether such content is durably represented, it should leave the STM unretired.

## 8. Protected memory

Existing protected-memory semantics remain authoritative.

Protected STM may not be retired as `safe_to_forget`. Protected autobiographical memory must never disappear merely because consolidation is large or complex.

No change in this specification weakens protected LTM rules.

## 9. Retirement validation

The engine validates that:

1. every retiring STM exists;
2. every retiring STM appears in at most one retirement group;
3. protected STM is not retired illegally;
4. every represented target resolves to existing or proposed resulting LTM;
5. every `safe_to_forget` group has one allowed reason and no LTM representation refs;
6. STM omitted from retirement groups remains untouched.

There is no numeric retirement ceiling.

## 10. Provenance and retirement are complementary

LTM provenance answers:

> Why does this durable-memory change exist?

```text
LTM -> source STM/LTM
```

Retirement coverage answers:

> Why may this STM disappear?

```text
STM -> resulting LTM
or
STM -> explicit safe-to-forget reason
```

Together they provide a bidirectional audit trail without another model request.

## 11. No semantic audit or repair pass

Do not add a second model call to audit preservation or repair the first result.

LTM maintenance remains one auxiliary model request per character per eligible stage. This avoids multiplying latency, token cost and provider failure modes across many AI characters.

Semantic judgment remains with the consolidation model; the engine enforces provenance, reference validity, protected-memory rules and atomicity.

## 12. Beliefs and activation

Do not impose numeric caps on LTM-stage higher-order belief effects, new beliefs or activated belief IDs.

Existing Mind v3 semantics still apply:

- old STM is not blindly counted as fresh direct evidence again;
- LTM belief effects should reflect genuinely higher-order pattern induction/reappraisal;
- the engine owns confidence mathematics;
- activation remains engine-owned and saturating;
- malformed/unknown references remain subject to hardened ingress validation.

## 13. Failure semantics

If LTM maintenance times out, truncates, returns malformed JSON, fails provenance/retirement/protected-memory validation, fails candidate-world validation, or becomes stale:

- no LTM writes commit;
- no STM retirement occurs;
- no LTM-stage belief effects commit;
- source STM remains intact;
- reconciliation is skipped under existing timelapse stage-gating rules;
- activation decay may still run;
- an already committed world timelapse is not rolled back merely because auxiliary reflective work failed.

## 14. Observability

Successful LTM commit diagnostics should expose at least:

- LTM upsert count;
- LTM add count;
- represented STM retirement count;
- safe-to-forget retirement count;
- safe-to-forget counts by reason;
- remaining STM count;
- provenance source-reference count;
- request usage/completion tokens through normal request diagnostics.

These values are diagnostic metadata and do not enter character consciousness.

## 15. Required regressions

Tests must cover at least:

- 12 or more justified LTM writes commit successfully;
- old `MAX_LTM_WRITES`-style limits no longer reject by count;
- large higher-order belief/new-belief/activation arrays are not rejected solely by count;
- valid `sourceStmIds` and `sourceLtmIds` provenance;
- missing/unknown/duplicate provenance rejects atomically;
- response-local new-LTM refs resolve for represented retirement and do not persist;
- represented retirement can remove 67+ STM in one pass;
- omitted STM remains;
- `routine`, `redundant` and `transient` are valid forgetting reasons;
- unknown forgetting reasons reject;
- protected STM cannot be `safe_to_forget`;
- truncated/invalid LTM output retires nothing;
- LTM failure still gates reconciliation while allowing activation decay;
- a Mara-sized migrated STM backlog can be consolidated without artificial operation-count rejection.

## 16. Acceptance invariant

The implementation is accepted when:

> The amount of memory consolidated in one night is determined by the complexity and significance of the character's experience, not arbitrary record-count limits.

And:

> A short-term memory may disappear only because the model explicitly states where its durable content is represented or why it is safe to forget.

And:

> Every material long-term-memory change identifies the remembered material from which it arose.
