# Safe Mind Maintenance v2 — Bounded Archival Consolidation

> **v2.1 corrective follow-up:** `safe-mind-maintenance-v2.1-protocol-correction-context.md` adds exact per-stage nested response schemas and newest-recent read-only correction evidence. It does not increase maintenance authority or replace the v2 transaction/archive model.

## Status and priority

This specification supersedes the maintenance authority model, snapshot timing, portable-mind archive rules, and Emergency Dump packaging described in `safe-mind-maintenance-and-emergency-diagnostics.md`.

The older document remains relevant for the Human speech → `recentDialogue` regression fix and ordinary decision-time `beliefIdsToRemove` behavior.

Maintenance priority is explicit:

```text
character continuity / identity preservation
> semantic preservation
> compactness / token efficiency
```

Maintenance reduces **active model context**. It does not destroy retired autobiographical source records.

## 1. Problem

The previous maintenance protocol let one model response inspect and broadly rewrite/remove beliefs and long-term memories while also consolidating recent memories. That contract exposed large generic deletion arrays and allowed one response to propose changes across most of a character's persistent mind.

A real Mara maintenance attempt demonstrated why this is unsafe: the response reached the output-token limit, attempted broad deletions, and confused recent-memory IDs with long-term-memory removals. Transactional validation prevented commit, but the authority surface was still too broad.

Do not fix this by merely increasing output tokens or strengthening prompt wording. Restrict authority structurally in the engine.

## 2. One canonical transaction

`MemoryConsolidator.compress(characterId, ...)` remains the only maintenance entry point for both:

- manual **Maintain mind**;
- automatic overnight maintenance.

One logical maintenance run may use several small model calls, but all calls operate on an in-memory candidate. The live character mind is not mutated until the whole run succeeds.

If any phase fails, truncates, returns malformed/invalid protocol data, violates an authority limit, or becomes stale before commit:

```text
live active mind = unchanged
maintenance archive = unchanged
maintenance snapshot FIFO = unchanged
```

Successful earlier phases in the candidate are discarded when a later phase fails.

## 3. Maintenance archive

Every character mind owns:

```json
{
  "maintenanceArchive": {
    "memories": [],
    "beliefs": []
  }
}
```

Whenever maintenance removes or replaces an active recent memory, long-term memory, or belief, the exact source record is first copied into the archive with minimal provenance:

```json
{
  "archivedAt": "ISO timestamp",
  "sourcePartition": "recentMemories | longTermMemories",
  "record": { "...exact original memory...": "..." }
}
```

Belief archive entries contain `archivedAt` and the exact original belief record.

The archive:

- persists through save/load and compatible migration;
- is included in Emergency Dump;
- is included in portable character-mind transfer;
- is excluded from ordinary AI decision context;
- is excluded from `recentDialogue`;
- is not automatically sent back into later maintenance prompts;
- is not automatically cleaned, compressed, deduplicated, or expired in this patch.

Disk size is cheaper than irreversible character-memory loss.

## 4. Protected memory invariant

Any memory with `protected: true`, whether currently recent or long-term, is read-only to maintenance.

Maintenance must never:

- remove it;
- archive it as part of removal;
- rewrite it;
- merge it into a replacement and remove the source;
- mutate its summary or importance.

Protected records may be supplied as read-only context.

Any destructive operation referencing a protected record fails validation.

## 5. Phase A — bounded recent consolidation

The newest **10** recent memories from the source state are never offered for consolidation.

Older protected recent memories are also never offered.

Process eligible old recent memories in bounded batches:

```text
RECENT_BATCH_SIZE = 12
MAX_RECENT_BATCHES_PER_RUN = 3
```

Therefore one complete maintenance run can inspect at most 36 old recent records through this phase.

The model response is source-explicit:

```json
{
  "groups": [
    {
      "sourceRecentMemoryIds": ["memory_a", "memory_b"],
      "replacement": {
        "summary": "durable consolidated meaning",
        "importance": 0.7
      }
    }
  ],
  "archiveOnlyRecentMemoryIds": [],
  "keepActiveRecentMemoryIds": []
}
```

Every supplied batch source ID must appear exactly once in one of those outcomes.

### Group result

For `A + B + C → D`:

1. archive exact A/B/C;
2. remove A/B/C from active recent memory;
3. create D as an active long-term memory;
4. assign D's ID in the engine using the existing memory-ID sequence.

The model never supplies a new long-term memory ID.

### Archive-only result

Archive-only is allowed for genuinely routine material with no durable active value. The exact source still survives in the archive.

### Keep-active result

If safe compression would lose meaningful autobiographical information, the model may keep the source active.

The engine must not force the active recent count down to exactly ten. Ten is a retention target, not a destructive invariant.

## 6. Phase B — bounded consistency repair (superseded by v2.2)

> Safe Mind Maintenance v2.2 replaces this general consistency-repair phase with deterministic per-character cognitive-dissonance discovery/resolution. This section is retained only as historical v2 design context; `safe-mind-maintenance-v2.2-cognitive-dissonance-reconciliation.md` is canonical.


After recent consolidation, run one consistency-repair pass when either:

- recent consolidation actually removed/promoted source records; or
- the existing belief-maintenance threshold is met.

This phase is for clear semantic repair, not general cleanup.

It may inspect current active beliefs, active long-term memories, known facts/relationships as read-only context, and recent evidence relevant to the same transaction.

Response shape:

```json
{
  "beliefRevisions": [
    {
      "sourceBeliefIds": ["belief_a"],
      "replacement": {
        "id": "belief_a",
        "text": "corrected current understanding",
        "confidence": "high"
      }
    }
  ],
  "beliefsToArchiveOnly": [],
  "longTermCorrections": [
    {
      "sourceLongTermMemoryId": "memory_x",
      "replacement": {
        "summary": "factually corrected durable summary",
        "importance": 0.8
      }
    }
  ]
}
```

Engine-enforced authority limits:

- at most **5 belief source records total** across revisions + archive-only retirement;
- at most **2 archive-only beliefs**;
- at most **2 long-term corrections**.

Beliefs represent current understanding. Prefer same-ID correction when the proposition remains the same subject.

For duplicate beliefs, several source IDs may be merged into one replacement, but the replacement ID must reuse one supplied source belief ID.

A belief may leave active cognition without replacement only when genuinely obsolete/redundant; its exact source is still archived.

Long-term correction is same-ID factual correction only. It is not permission to rewrite prose merely for style or compactness.

Relationships and authored `knownFacts` are read-only and never modified by maintenance.

## 7. Tea correction regression

Use a generic fixture derived from the real Mara state:

- an active belief incorrectly says Dmytro made tea;
- a long-term memory repeats that incorrect statement;
- a later recent memory records the grounded correction that Mara actually made the tea.

A successful consistency repair should be able to leave active understanding equivalent to:

> Mara made the tea that morning; she initially misremembered Dmytro as having made it.

Requirements:

- current belief is no longer false;
- corrected long-term memory no longer states the false history as objective fact;
- meaningful history of the temporary misremembering may remain;
- exact prior belief/memory records are recoverable in archive;
- unrelated beliefs/memories remain unchanged;
- relationships remain unchanged.

No runtime logic may special-case Mara, Dmytro, or tea.

## 8. Phase C — tiny long-term merge

Long-term deduplication remains threshold-driven at the existing active long-term threshold:

```text
LONG_TERM_MAINTENANCE_THRESHOLD = 30
```

One merge may combine only **2–3** unprotected active long-term memories into one replacement.

```json
{
  "merge": {
    "sourceLongTermMemoryIds": ["memory_a", "memory_b"],
    "replacement": {
      "summary": "faithful combined durable memory",
      "importance": 0.8
    }
  }
}
```

`{"merge": null}` is always valid when no safe merge exists.

Allow at most:

```text
MAX_LONG_TERM_MERGES_PER_RUN = 2
```

For every merge:

1. archive every exact source record;
2. remove only those explicit sources from active long-term memory;
3. add one engine-ID-assigned replacement.

The old broad maintenance fields `longTermMemoryIdsToRemove` and maintenance-level `beliefIdsToRemove` are no longer part of the maintenance protocol.

Ordinary character decision `memoryUpdates.beliefIdsToRemove` remains a separate bounded gameplay mechanism.

## 9. Snapshot timing and FIFO

Keep the newest **5** full pre-maintenance snapshots per character.

A snapshot is appended only when the complete maintenance transaction:

1. finishes all required model phases successfully;
2. passes stale-state checks;
3. produces an actual candidate change;
4. passes full candidate world/mind validation;
5. is about to commit atomically.

A failed maintenance attempt does not consume a snapshot slot.

A successful no-op does not consume a snapshot slot.

Only one snapshot is added per complete maintenance run, regardless of internal model-call count.

The snapshot contains the full pre-run `mind`, including any existing maintenance archive. Snapshots remain world-local recovery state and are excluded from portable mind transfer.

## 10. Stale-state and validation

Before final commit, compare the live maintenance-relevant source state against the captured source:

- recent memories;
- long-term memories;
- beliefs;
- maintenance archive;
- memory-ID sequence required for engine-assigned replacement IDs.

If stale, return `MEMORY_CONSOLIDATION_STALE` and commit nothing.

Before commit, validate the full candidate world using canonical validators, including:

- active belief uniqueness/validity;
- active memory uniqueness/validity;
- archive structure/records;
- protected-memory invariants;
- relationships and ordinary world invariants.

## 11. Portable mind v2

Portable character-mind export version becomes **2** and adds `maintenanceArchive`:

```json
{
  "schema": "ai-rpg.character-mind",
  "version": 2,
  "mind": {
    "beliefs": [],
    "relationships": [],
    "recentMemories": [],
    "longTermMemories": [],
    "maintenanceArchive": {
      "memories": [],
      "beliefs": []
    }
  }
}
```

Compatibility:

- version 1 remains importable;
- v1 import initializes an empty maintenance archive;
- new exports use v2;
- v2 import/export round-trips archive contents;
- `mindMaintenanceSnapshots` remain excluded;
- `recentDialogue` remains excluded.

Archived memory IDs must still be considered when normalizing `nextMemoryId` after portable import so retired IDs are not accidentally reused.

## 12. Save/migration

Older compatible saves without `mind.maintenanceArchive` initialize:

```json
{
  "memories": [],
  "beliefs": []
}
```

Existing valid archives survive generic migration for stable character IDs.

No story-specific migration logic is allowed.

## 13. Emergency Dump canonical packaging

This section **supersedes every earlier maintained statement that a single monolithic Emergency Dump JSON is acceptable or preferred**.

There is one canonical format:

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

Exact section names may evolve only if documentation and implementation remain consistent, but the invariant is fixed: **one downloaded ZIP containing independent JSON diagnostic sections**.

Requirements:

- each section is captured independently;
- failure of one producer/serializer does not prevent the other files from being generated;
- `manifest.json` records section success/failure and basic build/world metadata;
- `minds.json` includes active mind, maintenance archive, maintenance snapshots, and recent dialogue;
- full current game/runtime state remains present in the bundle;
- scheduler/observations/request-executor/exchange diagnostics remain present where available;
- recent runtime errors remain present;
- obvious API keys, Authorization values, tokens, passwords, and authentication secrets are defensively redacted;
- Emergency Dump must not require world validation to succeed.

No human-readable maintenance audit UI is introduced.

No maintained documentation may continue to describe a monolithic single-JSON dump as the intended format.

## 14. Required regression coverage

Tests must prove at minimum:

### Transaction safety

1. malformed/truncated early phase changes nothing;
2. failure in a later phase rolls back earlier candidate work;
3. stale-state commit changes nothing except the independent concurrent live change;
4. failed maintenance adds no snapshot;
5. successful changed maintenance adds exactly one snapshot;
6. successful no-op adds no snapshot;
7. snapshot FIFO retains newest five full minds.

### Authority limits

8. recent IDs outside the batch are rejected;
9. duplicate source assignment is rejected;
10. protected recent removal/merge is rejected;
11. consistency touches at most five belief sources total;
12. archive-only belief retirement is capped at two;
13. long-term corrections are capped at two;
14. long-term merge accepts only two or three sources;
15. protected long-term merge/correction is rejected;
16. broad arbitrary maintenance deletion arrays no longer exist in the maintenance response contract.

### Archive preservation

17. every replaced/retired active source is copied verbatim to archive;
18. archive survives save/load/migration;
19. archive stays out of ordinary decision context;
20. Emergency Dump contains archive and snapshots.

### Portable mind

21. v1 files remain importable;
22. v1 import creates empty archive;
23. new exports are v2;
24. v2 archive round-trips;
25. snapshots and recentDialogue remain excluded.

### Realistic contradiction fixture

26. the tea-style false belief can be corrected;
27. the contradictory unprotected LT summary can be corrected;
28. prior false records are archived;
29. unrelated mind records and relationships remain unchanged.

### Emergency bundle

30. Emergency Dump is a real ZIP container with multiple JSON files;
31. one broken diagnostic section does not suppress the others;
32. secrets remain redacted.

## 15. Acceptance criteria

The patch is complete when:

- no maintenance response can mass-delete a character mind;
- all destructive active-context changes are source-explicit and engine-bounded;
- retired source records remain recoverable in archive;
- protected memories are untouchable;
- newest ten recent memories are never offered to Phase A;
- uncertain old recent material may remain active;
- belief repair is small and current-understanding oriented;
- long-term merge is tiny and optional;
- all phases commit atomically or not at all;
- failed attempts do not pollute snapshot FIFO;
- relationships remain outside maintenance authority;
- archive persists without entering ordinary model context;
- portable v1 remains compatible and v2 preserves archive;
- the tea regression produces a corrected active understanding without destroying the source history;
- Emergency Dump uses one ZIP with independent JSON sections;
- no maintained documentation contradicts that Emergency Dump format.
