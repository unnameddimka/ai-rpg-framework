# AI RPG — Model Output Must Have Effect / No-Op Upsert Invariant

## Status

Follow-up protocol-hardening specification for Mind v3 and other structured model→engine protocols.

This change was motivated by a production LTM-maintenance failure where the model returned a large number of unchanged existing LTM records as upserts, consuming the entire output budget before producing a complete JSON response.

The fix is intentionally broader than LTM maintenance.

---

# 1. Problem

Structured model protocols frequently provide the model with existing canonical state and ask it to propose changes.

A model may incorrectly interpret:

```text
this record is relevant
```

as:

```text
this record should be returned in the output
```

even when the proposed record is materially unchanged.

Observed production example:

```text
Mara:
3 STM records
59 existing LTM records

LTM consolidation response:
43 existing LTM records returned as upserts
43 / 43 materially unchanged
response reached 12000 output tokens
JSON truncated
maintenance failed
```

The existing validator could reject those no-op upserts after generation, but validation never ran because the response was truncated first.

Therefore deterministic validation alone is insufficient.

The model must understand before generation that unchanged data should not be returned.

---

# 2. Core invariant

> Model output should contain structured operations only when those operations have an effect according to the semantics of the protocol.

For state-mutating operations:

> If applying an operation would leave the relevant model-writable canonical state materially unchanged after normalization, the model must omit that operation from its response.

This applies especially to all upsert-style operations.

---

# 3. Token-efficiency goal

The primary protection must exist in the model prompt.

The goal is not merely:

```text
generate no-op
→ validator rejects it
```

The desired behavior is:

```text
model recognizes no-op
→ does not generate it
→ output tokens are never spent on it
```

Deterministic validation remains a safety layer, not the main mechanism.

---

# 4. Upsert semantics

An upsert means:

> Change this existing record to a materially different model-writable state.

It does **not** mean:

- this record was relevant;
- this record was considered;
- this record supports the reasoning;
- this record was used as context;
- this record relates to current evidence;
- this record should remain present;
- this record should receive provenance despite otherwise remaining unchanged.

Unmentioned existing records remain unchanged automatically.

Therefore the model must not echo existing records merely to preserve them.

---

# 5. No-op definition

No-op status is based on the **effective state change after protocol normalization**, not raw JSON equality.

Conceptually:

```text
normalize(existing)
normalize(proposed)

apply proposed model-writable changes

if resulting canonical/model-writable state
is materially equivalent to existing state:

    operation is a no-op
```

Examples of differences that do not necessarily constitute an effect:

- JSON property ordering;
- whitespace or equivalent normalized representations;
- omitted values that normalize to existing defaults;
- metadata that is not model-writable;
- provenance fields that merely annotate an otherwise unchanged record;
- engine-owned IDs repeated back unchanged.

Protocol-specific normalization remains authoritative.

---

# 6. No-op upserts are invalid

Every model protocol containing an upsert-style operation should explicitly instruct:

> Never emit a no-op upsert.

If no model-writable field needs to change:

> Omit the record entirely from the response.

This should be stated both:

1. in the general structured-output instructions;
2. next to each relevant `*ToUpsert` output field where practical.

The repetition is intentional. The instruction should be close to where the model constructs the output.

---

# 7. Canonical prompt guidance

Structured model prompts should include language equivalent to:

```text
MODEL OUTPUT MUST HAVE EFFECT

Do not return an operation merely because a record was relevant,
considered, retrieved, or used as context.

For every upsert, the proposed record must materially change the
model-writable state of the corresponding existing record.

If applying an upsert would leave the record materially unchanged
after normalization, omit that upsert entirely.

Existing records that are not mentioned remain unchanged automatically.

Do not copy unchanged existing records into the response.
```

Protocol-specific prompts may use terminology appropriate to their domain.

---

# 8. LTM-specific clarification

The LTM consolidation prompt must additionally make the following distinction explicit:

```text
Existing LTM may be relevant to current STM evidence without requiring an upsert.
```

Add language equivalent to:

> Do not return an existing LTM merely because it is relevant to the STM currently being consolidated.

> Only include an existing LTM in `longTermMemoriesToUpsert` when the new STM evidence materially changes that specific LTM.

> If an existing LTM already represents the information adequately and requires no model-writable change, leave it out of the response.

> `sourceStmIds` or other provenance does not by itself justify an upsert.

This directly addresses the observed production failure.

---

# 9. Provenance is not an effect

Protocol metadata such as provenance must not be used to manufacture a state change.

Example invalid reasoning:

```text
LTM A is unchanged
but STM 592 is related to it
therefore:
    return LTM A with sourceStmIds = [592]
```

Unless provenance is itself intentionally defined as persistent model-writable canonical state whose modification is semantically required, this is a no-op.

For the current Mind v3 consolidation protocol:

> Provenance identifies evidence supporting an actual proposed transformation.

It is not a reason to emit an otherwise unchanged memory record.

---

# 10. Explicit null / negative decisions remain valid

This invariant does **not** mean every model response must mutate canonical data.

Some protocols deliberately encode a meaningful negative decision.

Examples may include:

```text
action: null

no reaction

no contradiction

safe_to_forget

no maintenance change required
```

where supported by the relevant protocol.

Such a result may have no persistent mutation but still represents the semantic result of the invocation.

Therefore:

> An explicitly defined null/negative protocol result is not considered useless model output merely because it does not mutate canonical state.

The distinction is:

```text
explicit semantic decision
!=
redundant state rewrite
```

---

# 11. Empty change sets are valid

Where a protocol allows it, the correct response may therefore be:

```json
{
  "updates": [],
  "creates": [],
  "deletes": []
}
```

or its protocol-specific equivalent.

The model must prefer an empty change set over returning unchanged records.

---

# 12. Deterministic validation

Prompt guidance is the primary mechanism.

Where no-op detection can be performed deterministically, validators must also enforce the invariant.

Conceptually:

```text
proposal
→ normalize
→ compare effective model-writable state
→ reject no-op operation
```

Do not rely on the model alone.

This provides defense in depth:

```text
prompt:
avoid generating no-op

validator:
reject it if generated anyway
```

---

# 13. Validation diagnostics

Validation errors should be actionable.

Instead of:

```text
Invalid LTM upsert.
```

prefer:

```text
LTM memory_ai_123 upsert has no effect.

The proposed model-writable state is materially unchanged
from the existing record after normalization.

Do not return unchanged records.
Omit this upsert from the response.
```

For repair prompts, explicitly instruct the model not to substitute another equivalent no-op representation.

---

# 14. Repair behavior

When a repair pass receives one or more no-op errors:

> Remove the no-op operations unless another genuine model-writable change is required.

The repair prompt must not encourage rewriting unchanged content merely to satisfy validation.

Bad repair:

```text
same memory
+ tiny wording change solely to bypass equality check
```

The model must understand that arbitrary cosmetic rewriting is not the goal.

The intended question is:

```text
Does this record actually need to change?
```

If no:

```text
omit it
```

---

# 15. Semantic vs textual equality

A validator may not always be able to prove semantic equivalence.

Deterministic checks should therefore operate on the strongest equivalence available from each protocol.

### Exact normalized structured state

Preferred where fields are structured:

```text
confidence: 0.7 → 0.7
activation: 0.4 → 0.4

= no effect
```

### Exact normalized textual fields

For memory summaries/topics where deterministic semantic comparison is unavailable:

```text
topic unchanged
summary unchanged
importance unchanged
retrievalBrief unchanged

= deterministic no-op
```

A wording change may technically evade exact comparison.

Prompt instructions remain responsible for discouraging meaningless paraphrase-only rewrites.

No additional semantic audit-model pass is required.

---

# 16. Relationship upserts

`relationshipsToUpsert` follows the same rule.

A relationship record is returned only when the normalized durable relationship summary actually changes. Relevance, continued importance, or simply interacting with the target does not justify echoing an unchanged relationship.

Ordinary decision/result protocols and post-timelapse reflection should carry this instruction in their model-facing prompt. Where the current relationship is supplied, exact normalized equality is rejected deterministically.

---

# 17. Relationship to engine-owned state

Engine-owned fields do not create model-visible mutation rights.

For example:

```text
memory ID
global nextMemoryId
timestamps generated by engine
canonical placement metadata
```

must not be changed or echoed solely to make an operation appear effective.

Each protocol's existing model-writable/engine-owned boundary remains authoritative.

---

# 18. Scope

The invariant applies to structured model→engine protocols throughout the project where the model proposes changes to existing state.

Current model-facing upsert audit includes:

- LTM upserts;
- STM upserts;
- retained-ID STM repartition replacements;
- relationship upserts in ordinary character decisions/results;
- relationship upserts in post-timelapse reflection.

Belief confidence/text is not ordinary-turn upsert state under Mind v3. Reconciliation uses explicit semantic operations rather than a generic upsert array and keeps its existing operation semantics.

Do not mechanically change protocols where returning current state is intentionally part of the semantic contract. For example, `continuation` is a required current intention projection: repeating it explicitly means preserve that intention, while `null` means clear it.

---

# 19. LTM production fix

For the current Mara failure, the immediate required change is prompt hardening in LTM consolidation.

Do **not** solve the production issue by simply increasing the 12000-token output ceiling.

Do **not** reintroduce an arbitrary LTM write-set cap as part of this fix.

The production failure was caused by useless output, not by a legitimate need for a large number of meaningful LTM writes.

Expected behavior after this change:

```text
3 STM
59 existing LTM

model considers existing LTM as context

only actually changed existing LTM appear in upserts
new durable memories appear in adds

unchanged existing LTM require zero output tokens
```

---

# 20. Existing no-op validator behavior

Any current deterministic no-op protections remain in place or are strengthened to reject the ineffective operation explicitly rather than treating it as useful work.

This specification strengthens the earlier architecture by moving the same concept into model-facing instructions.

Do not weaken validation simply because the prompt has improved.

---

# 21. No arbitrary write cap

This specification does not introduce a new generic operation-count limit.

A maintenance pass may still legitimately produce many meaningful changes if the evidence requires them.

The invariant is:

```text
unbounded meaningful work if required
+
zero tolerance for useless echoed work
```

If output size remains a production problem after useless operations are eliminated, bounded working sets or other protocol changes may be evaluated separately using production evidence.

---

# 22. Interaction with STM semantic repartition

The existing STM Semantic Repartition behavior remains unchanged.

A repartition has effect because it transforms the STM structure:

```text
STM A
→ STM A' + STM B
```

or:

```text
STM A
→ STM B + STM C
```

A replacement record retaining a source STM ID is valid only when its model-writable content actually changes as part of the repartition.

If the source record should remain exactly unchanged and genuinely new material merely needs another STM, use ordinary creation instead of echoing the unchanged source through repartition.

Repartition must not be used as a loophole to echo unchanged records unnecessarily.

---

# 23. Interaction with safe_to_forget

`safe_to_forget` remains valid where defined by the LTM retirement protocol.

It represents an explicit semantic judgment about source STM retirement.

It is therefore not equivalent to an unchanged upsert.

The engine's existing retirement safety invariants remain authoritative.

---

# 24. Failure atomicity

No changes to existing atomicity guarantees.

If a model proposal contains invalid no-op mutations and repair ultimately fails:

```text
canonical state remains unchanged
source STM remains where current rules require
verbatim evidence remains according to current commit semantics
```

No partial commit is introduced.

---

# 25. Required regression tests

Add tests covering at least:

1. shared model-facing invariant says structured mutation output must have effect;
2. LTM prompt explicitly says unchanged existing LTM must not be returned;
3. LTM prompt explicitly distinguishes relevance from mutation;
4. LTM prompt says provenance does not justify an otherwise unchanged upsert;
5. STM prompt contains equivalent no-op-upsert guidance;
6. exact normalized no-op LTM upsert is rejected;
7. exact normalized no-op STM upsert is rejected;
8. retained-ID repartition replacement cannot be an unchanged source echo;
9. a genuine LTM content change remains accepted;
10. a genuine STM content change remains accepted;
11. empty upsert arrays remain valid;
12. explicit `action:null` remains valid;
13. exact normalized no-op relationship upsert is rejected when current relationship state is supplied;
14. a genuine relationship-summary change remains accepted;
15. repair diagnostics instruct the model to omit unchanged data;
16. repair guidance discourages cosmetic rewrites made solely to bypass equality;
17. LTM `sourceStmIds` alone does not make an otherwise unchanged LTM upsert valid;
18. existing valid high-volume LTM consolidation remains possible; no arbitrary write cap is introduced;
19. STM Semantic Repartition continues to function normally;
20. a synthetic Mara-style proposal containing many unchanged LTM upserts is rejected as no-effect output.

---

# 26. Production regression case

Add a regression representing the observed Mara failure.

Conceptually:

```text
existing LTM:
43+ unchanged records returned as upserts

new STM:
3 records
```

The model-facing protocol must make clear that returning unchanged existing records is forbidden.

A synthetic proposal containing many unchanged LTM upserts must be rejected as no-effect operations even when every record carries apparently valid STM provenance.

The test does not need to simulate an actual 12000-token generation. The regression protects the contract that allowed the runaway generation.

---

# 27. Documentation

Update canonical architecture documentation with a project-wide invariant:

## Model Output Must Have Effect

Document:

- relevance does not imply output;
- unchanged state should not be echoed;
- no-op upserts are forbidden;
- prompt prevention is important for token efficiency;
- deterministic validation remains required where possible;
- explicit null/negative protocol decisions remain valid;
- the rule operates on effective normalized model-writable state.

Update Mind v3 documentation with the STM/LTM/relationship consequences.

Historical specs remain unchanged.

---

# 28. Acceptance criteria

The change is accepted when:

- the model is explicitly instructed not to return unchanged records;
- every current model-facing upsert-style prompt makes this expectation clear;
- LTM consolidation explicitly says relevance alone does not justify an upsert;
- provenance alone cannot justify unchanged LTM output;
- deterministic no-op validation remains or is added where feasible;
- null/negative semantic protocol decisions are not incorrectly rejected;
- no arbitrary LTM write limit is reintroduced;
- Mara-style mass echoing of unchanged LTM is covered by regression tests;
- existing meaningful high-volume LTM update behavior remains unchanged;
- STM semantic repartition remains functional;
- full project tests pass.

---

# 29. Final invariant

```text
The model may inspect far more state than it returns.

Returned structured mutations represent effects, not relevance.

If an existing record would remain materially unchanged
after normalization:

    do not return an upsert;
    do not echo the record;
    do not attach metadata merely to justify returning it;
    omit it entirely.

Explicit protocol-level null or negative decisions remain valid
when the decision itself carries semantic meaning.

Prompt prevention comes first.
Validator rejection remains the safety net.
```
