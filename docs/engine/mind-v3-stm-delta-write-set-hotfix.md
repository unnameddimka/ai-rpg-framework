# Mind v3 STM Delta Write-Set Hotfix

## Status

Implementation mini-spec for the live Mind v3 STM completion truncation observed on 2026-08-18 after the dedicated 6000-token STM profile and async stale-check fixes.

This hotfix changes only the STM model protocol/write-set bounds. It does not change verbatim capture, the `>40` trigger, newest-20 retention, evidence ownership, belief math, async compatibility, or atomic commit semantics.

## 1. Production failure

A developed Mara entered ordinary background STM consolidation with roughly:

- 48 verbatim observations;
- 28 eviction observations and 20 retained observations;
- 61 migrated/existing STM records;
- 31 LTM records;
- 154 beliefs.

The Utility model was given sufficient completion headroom (6000 tokens), but attempted to rewrite essentially the entire existing STM set rather than returning a delta. The response contained a large `shortTermMemoriesToUpsert` set, then new STM/belief effects, and reached the 6000-token completion ceiling before closing valid JSON.

No canonical state was lost because the existing failure semantics rejected the truncated response before commit.

The bug is therefore not insufficient token budget. The protocol does not state strongly enough that persisted STM is **read-only by default** and that consolidation returns only a bounded delta caused by the current eviction evidence.

## 2. Required behavior

### 2.1 Delta-only STM output

Existing STM supplied to the model is persistent context. Its presence in the request does not mean it must be re-emitted.

The STM prompt must state explicitly:

- omit every existing STM that does not require a material change because of the current eviction set;
- never restate unchanged STM;
- never retopic, beautify, normalize, merge, or rewrite migrated/legacy STM merely to improve organization;
- upsert an existing STM only when newly consumed eviction evidence materially extends or corrects that same thematic memory;
- create a new STM only for genuinely distinct new material;
- prefer a small number of thematic writes rather than one write per observation.

Unmentioned existing STM remains unchanged automatically by the engine.

### 2.2 Bounded write set

Centralize the following initial tuning defaults in Mind v3 configuration:

```text
STM_WRITE_SET_LIMIT = 8
STM_BELIEF_EFFECT_LIMIT = 12
STM_NEW_BELIEF_LIMIT = 4
STM_ACTIVATED_BELIEF_LIMIT = 12
```

For one STM consolidation response:

```text
shortTermMemoriesToUpsert.length
+ shortTermMemoriesToAdd.length
<= STM_WRITE_SET_LIMIT
```

The other response arrays must respect their corresponding limits.

These are protocol/output bounds, not autobiographical-memory retention caps. They must never cause the engine to silently delete existing STM or source verbatim observations.

If the eviction material spans more themes than fit in the write budget, the model should combine related evidence into broader thematic STM summaries while preserving important detail. A future retrieval/partitioning architecture may replace this bound, but the live hotfix must remain simple and deterministic.

### 2.3 Request-visible policy

In addition to the system prompt, the STM request payload must include an explicit engine-owned write policy containing the current numeric limits and delta-only semantics. This makes the constraint visible next to the large existing-memory arrays instead of relying on a distant prose instruction alone.

Recommended shape:

```js
stmWritePolicy: {
  mode: "delta-only",
  maxMemoryWrites: 8,
  maxBeliefEffects: 12,
  maxBeliefsToAdd: 4,
  maxActivatedBeliefIds: 12,
  unchangedExistingStm: "omit",
  legacyCleanup: "forbidden"
}
```

Exact wording may differ, but values are engine-owned and derive from centralized configuration.

### 2.4 Validation

The engine must reject, without partial commit:

- any STM response exceeding the combined memory write-set limit;
- any response exceeding belief-effect/new-belief/activation limits;
- duplicate or invalid IDs as before;
- exact no-op STM upserts that merely restate the current persisted topic/summary/importance;
- all existing invalid shapes/bounds/protected-memory violations.

Do **not** truncate or silently take the first N model operations. An oversized response is invalid as a whole; source observations remain available for retry.

### 2.5 Completion budget

Keep the dedicated `mind-v3-stm` 6000-token Utility request profile introduced by the previous production hotfix.

Do not raise it again for this failure. A well-behaved bounded delta should fit comfortably within the existing budget. Another `length` failure after this protocol fix should be treated as new evidence rather than preemptively increasing the ceiling.

## 3. Async and commit semantics

Unchanged from the async stale-check hotfix:

- gameplay may continue while STM is in flight;
- new verbatim observations may append;
- activation-only belief changes are compatible;
- live activation is preserved and consolidation bumps apply on top;
- incompatible STM/LTM/relationship/belief identity-text-confidence changes make the result stale;
- only exact snapshot eviction IDs are removed after a successful validated commit;
- failed/truncated/oversized/no-op-invalid results remove nothing.

## 4. Acceptance tests

Add regressions proving at least:

1. the STM system prompt explicitly says the response is delta-only;
2. it forbids retopic/beautify/cleanup rewrites of migrated/legacy STM;
3. the payload exposes the engine-owned write policy and limits;
4. with 61 existing STM records and 48 verbatim observations, a small delta (for example one upsert plus one add) commits while all unrelated existing STM remains byte-for-byte unchanged;
5. a response with more than `STM_WRITE_SET_LIMIT` combined STM upserts/adds is rejected and removes no verbatim source records;
6. a response exceeding the belief-effect limit is rejected atomically;
7. an exact no-op STM upsert is rejected rather than being treated as useful work;
8. the dedicated `mind-v3-stm` request profile remains 6000 completion tokens and Utility-role;
9. existing importance normalization, protected-memory, exact-eviction, async activation merge, stale-conflict, migration, timelapse and failure-safety regressions remain green.

## 5. Non-goals

This hotfix does not:

- implement semantic/vector retrieval;
- reduce the amount of existing mind context supplied to the Utility model;
- retopic migrated legacy STM;
- merge old STM merely to reduce count;
- change LTM consolidation write limits;
- change belief confidence/activation formulas;
- alter the automatic-consolidation admin toggle;
- make background cognition blocking;
- add automatic retries after provider truncation.
