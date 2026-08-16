# Safe Mind Maintenance v2.1: Protocol Schema and Correction Context

Status: implemented corrective follow-up to `safe-mind-maintenance-v2-bounded-archival.md`.

## 1. Scope

This patch does not redesign Safe Mind Maintenance v2 or increase maintenance authority. It fixes two live-run failures:

1. maintenance prompts did not show the exact nested response schema, allowing the model/repair call to emit forbidden engine-owned fields such as `replacement.protected`;
2. an old recent-memory batch could be consolidated without seeing newer recent evidence that explicitly corrected a factual mistake in the old material.

All v2 safety invariants remain authoritative: bounded passes, source-explicit retirement, archival preservation, protected-memory immutability, one all-or-nothing transaction, successful-change-only pre-maintenance snapshots, and shared manual/overnight `MemoryConsolidator.compress()`.

## 2. Exact stage contracts

Every maintenance stage receives a literal nested `requiredResponseShape` plus stage-specific response rules. Array element structure is explicit rather than represented only as an empty array. Angle-bracket values are explicitly identified as schema placeholders rather than literal output values, and operation arrays may be empty when that operation is not warranted.

### Recent consolidation

The model is shown a structure equivalent to:

```json
{
  "groups": [
    {
      "sourceRecentMemoryIds": ["<sourceRecentMemoryId>"],
      "replacement": {
        "summary": "<consolidated autobiographical memory>",
        "importance": 0.7
      }
    }
  ],
  "archiveOnlyRecentMemoryIds": ["<sourceRecentMemoryId>"],
  "keepActiveRecentMemoryIds": ["<sourceRecentMemoryId>"]
}
```

`groups[].replacement` may contain only `summary` and `importance`. The model must not return `id`, `protected`, timestamps, metadata, or other engine-owned fields.

### Consistency repair (historical v2.1 contract; superseded by v2.2)

The following was the v2.1 consistency contract. It is no longer part of the canonical maintenance pipeline after v2.2. The model was shown the exact nested shapes for:

- `beliefRevisions[].sourceBeliefIds`;
- `beliefRevisions[].replacement` (`id`, `text`, `confidence` only, with the id reused from one source belief);
- `beliefsToArchiveOnly`;
- `longTermCorrections[].sourceLongTermMemoryId`;
- `longTermCorrections[].replacement` (`summary`, `importance` only).

### Long-term merge

The model is shown the exact non-null merge shape: 2-3 supplied source IDs plus a replacement containing only `summary` and `importance`. `merge: null` is explicitly valid and preferred when no clearly safe merge exists.

## 3. Engine-owned fields

Maintenance prompts explicitly state:

> Never invent or return engine-owned record fields. Return only fields explicitly present in the supplied response shape. New memory IDs are assigned by the engine, and protection state is controlled exclusively by the engine.

Validators remain authoritative. Prompt guidance does not weaken deterministic rejection of extra fields.

A response containing, for example:

```json
{
  "replacement": {
    "summary": "...",
    "importance": 0.7,
    "protected": false
  }
}
```

is invalid and cannot commit.

## 4. Repair calls

The single allowed structured-output repair attempt receives the same exact response shape and rules as the original stage.

Repair is instructed to fix syntax/shape only. It must not:

- invent semantic content;
- invent missing maintenance operations;
- add fields outside the schema.

If the repaired response remains invalid, the complete logical maintenance transaction fails and changes nothing.

## 5. Newer read-only correction context

Each recent-consolidation request separates two recent-memory sets:

- `sourceRecentMemories`: the bounded old batch the model may operate on;
- `newerReadOnlyRecentMemories`: up to the newest 10 recent memories, supplied only as factual correction evidence.

The read-only records are not part of the actionable batch. Their IDs are forbidden in consolidation groups, archive-only lists, and keep-active lists by the existing batch-membership validator.

This does not increase the recent batch authority. The existing limits remain:

- `RECENT_BATCH_SIZE = 12`;
- `MAX_RECENT_BATCHES_PER_RUN = 3`;
- newest 10 active recent memories are not offered as destructive sources.

## 6. Correction semantics

A newer read-only memory may clearly correct or supersede a factual claim in an older source memory. In that case the consolidated replacement should reflect the newer corrected account rather than preserve the known mistake as objective history.

Maintenance is not creative writing. All stages explicitly prohibit novel autobiographical claims unsupported by supplied records.

Memory and belief semantics remain distinct:

- memory represents remembered events/experience;
- belief represents current understanding/inference.

Where useful, a consolidated memory may preserve the autobiographical fact that the character once remembered something incorrectly while still stating the corrected event accurately.

## 7. Tea regression fixture

The live Mara case is the canonical regression shape:

- an older record says Dmytro made tea;
- a newer recent record says Dmytro corrected Mara and that Mara actually made the tea.

When the old record is consolidated and the newer correction is present as read-only evidence, a valid replacement may say that Mara made the tea and initially misremembered the detail.

An unsupported transformation such as “Dmytro was the first man Mara ever made tea for” is not justified unless independently supported by supplied records.

The engine cannot deterministically prove arbitrary semantic hallucination, so this is enforced through conservative prompt/evidence discipline plus bounded authority, not a fake semantic validator.

## 8. Failure and transaction behavior

No v2 transaction semantics change.

If any initial or repair response is truncated, malformed, schema-invalid, references forbidden IDs, exceeds authority limits, or otherwise fails validation:

- live mind remains unchanged;
- `maintenanceArchive` remains unchanged;
- successful-maintenance snapshot FIFO remains unchanged;
- no earlier candidate-stage work is partially committed.

## 9. Diagnostics

Maintenance exchange traces continue to preserve stage identity, raw/repair responses, validation failures, provider/model metadata, and finish information for Emergency Dump diagnosis.

There is no new user-facing audit UI.

## 10. Acceptance criteria

The corrective patch is complete when:

1. every maintenance stage receives an explicit literal nested response shape;
2. repair repeats the same exact contract and is syntax/shape-only;
3. model-authored `protected` or new memory IDs remain invalid;
4. recent source batches receive newest-10 recent records separately as read-only correction evidence;
5. read-only IDs cannot be selected by maintenance operations;
6. prompts require later clear corrections to supersede older factual mistakes;
7. prompts prohibit unsupported autobiographical invention;
8. Safe Mind Maintenance v2 authority limits are unchanged;
9. the observed `replacement.protected = false` failure has a transactional regression test;
10. the tea correction-context case has a regression test;
11. manual and overnight maintenance still use the same canonical pipeline.
