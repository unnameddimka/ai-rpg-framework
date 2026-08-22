# Safe Mind Maintenance, Dialogue Fix, and Emergency Diagnostics

> **Historical / superseded:** Mind v3 (`ai-rpg-mind-v3.md`) is now canonical for autobiographical memory, beliefs, maintenance, migration, and portable mind. Keep this document only for implementation history or non-mind features that Mind v3 explicitly leaves intact.


> **Supersession notice (Safe Mind Maintenance v2):** The maintenance authority model, snapshot timing, portable archive rules, and Emergency Dump packaging in this document have been superseded by `safe-mind-maintenance-v2-bounded-archival.md`. This document remains authoritative for the Human speech → `recentDialogue` regression fix and ordinary decision-time `beliefIdsToRemove`. Where the two documents differ, v2 wins.

## Scope

This patch extends the existing character-mind maintenance path without creating a second maintenance workflow.

The existing canonical `MemoryConsolidator.compress(...)` procedure remains the single implementation used by both:

- the manual **Maintain mind** / **Compress memory** control;
- automatic overnight timelapse maintenance.

The patch also fixes HumanController speech delivery into `recentDialogue`, allows ordinary AI decisions to explicitly remove obsolete beliefs, preserves pre-maintenance mind snapshots, and adds a best-effort emergency diagnostic dump.

Character continuity is higher priority than token reduction. Maintenance may compress, merge, revise, or remove records when needed, but meaningful semantic content that still matters should be preserved somewhere in the retained mind rather than silently discarded.

## 1. Recent dialogue regression fix

`recentDialogue` remains an engine-owned bounded eight-utterance conversational window outside `mind`.

It must contain:

- the character's own validated `spokenText`;
- speech actually delivered to that character through normal perception;
- HumanController speech and AI speech interleaved in actual delivery order.

The HumanController submit path must not accidentally suppress parsed speech by passing an explicitly present `spokenText: undefined` field into the lower narrative layer.

Regression example:

```text
Traveler says A
Mara says B
Traveler says C
```

Before FIFO trimming, Mara's dialogue window must contain:

```text
[Traveler A, Mara B, Traveler C]
```

No alternate dialogue channel should be introduced. Normal event/perception delivery remains authoritative.

## 2. Immediate belief correction/removal

Ordinary model-authored `memoryUpdates` gain an explicit belief-removal list.

Use the existing naming convention:

```json
{
  "recentMemoriesToAdd": [],
  "beliefsToUpsert": [],
  "beliefIdsToRemove": [],
  "relationshipsToUpsert": []
}
```

Beliefs represent the character's current understanding, not an immutable history of every previous opinion.

When newly grounded information directly contradicts or supersedes an existing belief, the model should prefer:

1. updating the existing belief through the same stable belief ID when the subject remains the same;
2. explicitly removing an obsolete/redundant belief when replacement by another retained belief is more appropriate.

Historically meaningful mistakes may still remain in autobiographical memory if worth remembering.

The engine validates removals and must reject duplicate/invalid/nonexistent IDs rather than silently doing something else.

## 3. One shared maintenance pipeline

Do not create a separate nightly maintenance implementation.

Manual maintenance and overnight timelapse call exactly the same `MemoryConsolidator.compress(...)` implementation with only trigger metadata differing.

Keep existing thresholds and current recent-memory retention semantics unless otherwise stated:

- retain the newest 10 recent memories;
- older recent memories are candidates for consolidation;
- belief maintenance can run at the existing belief threshold;
- long-term maintenance can run at the existing long-term-memory threshold.

The procedure may still return `nothingToMaintain` when no current threshold/work condition requires a model request.

## 4. Maintenance philosophy

Treat persistent character minds as high-value continuity state.

Priority order:

```text
character continuity / identity preservation
> semantic preservation
> compactness / token efficiency
```

Maintenance should:

- preserve identity, commitments, relationships, important discoveries, conflicts, uncertainty, preferences, and meaningful experiences;
- correct obsolete beliefs when newer grounded information establishes a better current understanding;
- merge overlapping long-term memories conservatively;
- remove records only when their still-important meaning is preserved in retained records or the content has genuinely become obsolete/unimportant;
- preserve the fact that the character once believed something incorrectly when that mistake itself is autobiographically meaningful;
- avoid storing the same proposition redundantly as both a belief and memory merely for safety.

A memory is primarily an experienced event or autobiographical episode.
A belief is primarily the character's current inferred/subjective understanding.

Do not aggressively deduplicate unique autobiographical material merely to save prompt tokens.

## 5. Protected memories

`protected: true` long-term memories remain strictly non-removable by maintenance.

Maintenance may read protected memories and use them to reconcile other state, but must not:

- remove them;
- replace them with rewritten content;
- mutate their importance or summary.

Their protection is an explicit continuity guarantee.

## 6. Relationships

Relationships remain outside maintenance output in this patch.

Maintenance may receive relationships as read-only context, because they help interpret autobiographical material, but it must not add/remove/merge/rewrite relationship records.

Ordinary character decision updates remain responsible for relationship evolution.

## 7. Maintenance operation contract (superseded)

The former broad maintenance operation contract with generic `longTermMemoryIdsToRemove` / maintenance-level `beliefIdsToRemove` arrays is **no longer valid**. Safe Mind Maintenance v2 replaces it with bounded recent, consistency-repair, and tiny long-term-merge protocols. See `safe-mind-maintenance-v2-bounded-archival.md`.

## 8. Pre-maintenance snapshots (v2 rule)

Keep the newest five full pre-maintenance snapshots per character. A snapshot is appended only for a successful maintenance transaction that actually changes the candidate and is about to commit atomically. Failed attempts and successful no-ops do not consume snapshot slots. Only one snapshot is added per logical maintenance run regardless of internal model-call count. Snapshots survive save/load/migration and remain excluded from portable mind transfer.

## 9. Emergency diagnostic dump (canonical v2 packaging)

The canonical Emergency Dump is one downloaded ZIP containing independent JSON sections, for example:

```text
ai-rpg-emergency-dump-<timestamp>.zip
  manifest.json
  game-state.json
  sugarcube.json
  minds.json
  scheduler-state.json
  ai-exchanges.json
  ui-runtime.json
  errors.json
```

Each section is captured/serialized independently. Failure of one section must not prevent the others. `manifest.json` records section success/failure. The bundle remains best-effort, does not require world validation, includes full diagnostic state/minds/snapshots/archive where available, and defensively redacts API/authentication secrets.

**This supersedes the earlier monolithic-single-JSON proposal. A single monolithic Emergency Dump JSON is not the intended format.**

## 10. Runtime error capture

Maintain a small bounded diagnostic ring buffer for uncaught browser errors and unhandled promise rejections where browser APIs are available.

This buffer is diagnostic-only and must not mutate story state.

Failure to install browser error listeners must never prevent gameplay.

## 11. Save/migration

Compatible saves should preserve `mindMaintenanceSnapshots` for surviving stable character IDs.

Old saves without this field initialize it to an empty array.

Snapshots are non-authoritative diagnostic/recovery state; malformed snapshot entries may be sanitized away during bootstrap/migration rather than making an otherwise recoverable save unusable.

Do not transfer snapshots through portable character-mind export/import.

## 12. Required tests

Add regression coverage for at least:

1. Human `submitIntent` speech reaches the addressed/perceiving AI `recentDialogue`;
2. dialogue interleaves Human and AI speech in delivery order;
3. eight-entry FIFO behavior remains unchanged;
4. ordinary memory updates can remove an existing belief;
5. invalid/nonexistent/duplicate belief removals are rejected;
6. ordinary protocol requires `beliefIdsToRemove` in the exact memory-update shape;
7. maintenance prompt emphasizes semantic preservation and conservative removal;
8. protected long-term memories remain non-removable/non-rewritable;
9. manual maintenance records a pre-maintenance snapshot before request execution;
10. automatic maintenance uses the same snapshot/pipeline and records trigger metadata;
11. snapshots retain only the newest five entries;
12. snapshots survive save migration for stable character IDs;
13. portable mind export/import excludes maintenance snapshots;
14. emergency diagnostic capture works with normal state;
15. emergency capture still returns a partial document when one section throws;
16. emergency document contains no API key;
17. UI includes a red bottom-of-sidebar Emergency dump button;
18. complete test suite and production build pass.

## 13. Post-timelapse reflection compatibility

Because post-timelapse reflection uses the same bounded runtime memory-update validator/application path, its exact `memoryUpdates` shape should also include `beliefIdsToRemove`. This keeps belief correction semantics consistent rather than making reflection a special older-shaped update channel. It does not turn reflection into maintenance and does not grant it long-term-memory merge/delete operations.
