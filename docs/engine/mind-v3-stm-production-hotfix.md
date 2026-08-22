# Mind v3 STM Production Hotfix

## Status

Implementation sub-spec for the first live-production Mind v3 STM consolidation failures observed on 2026-08-18.

This hotfix does not change Mind v3 ownership, evidence, eviction, belief-math, stale-check, or atomic-commit semantics. It only makes the existing STM auxiliary protocol robust enough to complete against a developed character with a large migrated mind.

## 1. Production failures

The first live automatic STM roll exposed two independent protocol failures.

### 1.1 STM completion budget exhausted

A developed Mara STM request contained approximately 21.7k prompt tokens. The Utility model produced a structurally sensible consolidation but reached the existing shared `memory-consolidation` completion ceiling of 2400 tokens before completing the JSON object.

Observed invariant-preserving behavior was correct: the request failed with `MODEL_OUTPUT_TRUNCATED` and no verbatim observations or mind state were committed or removed.

The bug is therefore insufficient STM response headroom, not commit safety.

### 1.2 Importance scale mismatch

A simultaneous Traveler STM request returned complete, semantically usable JSON but authored memory `importance` values on a human-readable 1..10 scale (`6`, `7`, `8`, etc.) rather than the canonical Mind v3 0..1 scale. The strict validator correctly rejected the result, but a repair request repeated the same scale and therefore failed again.

The canonical persisted scale remains 0..1.

## 2. Required changes

### 2.1 Dedicated STM request profile

Add a dedicated AI request profile for Mind v3 STM consolidation rather than raising the completion ceiling for all memory-maintenance calls.

Default:

```text
profile: mind-v3-stm
model role: Utility
max completion tokens: 6000
reasoning: disabled
low temperature
```

LTM consolidation and belief reconciliation retain the existing shared `memory-consolidation` budget unless separate production evidence later justifies changing them.

The model ID remains configurable through the existing Utility-model selector. Do not hard-code a provider model.

### 2.2 Thematic compactness instruction

The STM system prompt must explicitly reinforce that STM is thematic rather than one-record-per-observation transcription.

The model should normally combine related eviction observations into a small number of thematic STM records and keep summaries concise while preserving meaningful information. It may exceed the normal small count when material is genuinely unrelated, but should not mechanically mirror each source observation into a separate STM record.

This is a prompt/output-efficiency correction consistent with existing Mind v3 semantics; it is not a new forgetting rule.

### 2.3 Explicit canonical importance scale

Every STM memory proposal instruction must state unambiguously:

```text
importance is a numeric decimal in the inclusive range 0..1.
Use values such as 0.2, 0.5, 0.8; do not use a 1..10 scale.
```

The same wording should be used for LTM proposals because the field has identical canonical semantics.

### 2.4 Narrow ingress normalization

Before validating model-produced STM/LTM memory proposals, normalize the common accidental 1..10 representation into the canonical 0..1 representation:

```text
0 <= importance <= 1  -> unchanged
1 < importance <= 10  -> importance / 10
otherwise              -> invalid
```

Important details:

- `1` remains canonical `1.0`; it is not ambiguously rewritten to `0.1`.
- Normalization occurs only at the model-protocol ingress before validation/commit.
- Canonical runtime/save/portable-mind data remains strictly 0..1.
- No strings, NaN, infinities, negatives, or values above 10 are coerced.
- This leniency applies only to `importance`; belief confidence, activation, evidence strength, IDs, shapes, bounds, and protected-memory invariants remain strict.
- A normalized response must still pass the complete existing candidate validation and stale/atomic-commit path.

## 3. Failure and retry semantics

Unchanged:

- truncated STM output commits nothing;
- invalid output commits nothing;
- stale output commits nothing;
- no eviction observation is removed before successful validated commit;
- a failed background job clears its transient job state and leaves the character eligible for later retry;
- newly arrived verbatim observations are never removed by an older job.

The hotfix must not add a special retry loop after provider truncation. A later normal eligibility check may schedule a fresh job from preserved source observations.

## 4. Acceptance tests

Add regressions proving at least:

1. `mind-v3-stm` resolves through the Utility role with a 6000-token completion ceiling and reasoning disabled.
2. STM consolidation uses the dedicated profile while LTM/reconciliation continue to use the existing memory-maintenance profile.
3. The STM prompt explicitly says `importance` is 0..1 and forbids 1..10 output.
4. The STM prompt asks for thematic grouping rather than one memory per observation.
5. A model STM add with `importance: 7` commits as canonical `0.7`.
6. A model STM upsert with `importance: 8` commits as canonical `0.8`.
7. A valid canonical `importance: 1` remains `1`, not `0.1`.
8. `importance: 11`, a negative value, a string, or another invalid representation still fails validation and removes no source observations.
9. LTM memory proposals receive the same 1..10 ingress normalization and canonical persistence.
10. Existing Mind v3 full-buffer eviction, stale-result, protected-memory, belief-evidence and failure-safety regressions remain green.

## 5. Non-goals

This hotfix does not:

- change the `>40` automatic STM trigger;
- change the newest-20 verbatim retention rule;
- change which observations count as fresh belief evidence;
- alter belief confidence or activation formulas;
- change migrated mind contents;
- enable automatic consolidation when the admin toggle is disabled;
- introduce retrieval/vector memory;
- raise ordinary `game-decision` output limits;
- make background cognition blocking.
