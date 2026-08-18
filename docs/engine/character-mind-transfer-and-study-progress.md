# Portable Character Mind and Item-Owned Study Progress

> **Historical / superseded:** Mind v3 (`ai-rpg-mind-v3.md`) is now canonical for autobiographical memory, beliefs, maintenance, migration, and portable mind. Keep this document only for implementation history or non-mind features that Mind v3 explicitly leaves intact.


## Status

Implemented engine/UI specification for the current AI RPG architecture.

This task contains two related changes:

1. add explicit export/import of a character's portable accumulated mind state;
2. move `abstract_study` progress out of `character.mind` and into the specific item instance, keyed separately for each character who has used that item.

The changes share one ownership rule: character-authored persistent identity belongs to the portable mind; deterministic source-specific bookkeeping belongs to the world object that owns that mechanic.

## 1. Goals

### 1.1 Portable character mind

Allow the user to reset or replace the world and carry a specific developed AI character forward without carrying that character's physical/runtime world state.

The primary workflow is:

1. select Mara in the sidebar;
2. export her accumulated mind to a standalone JSON file;
3. reset the world;
4. select the fresh authored Mara with the same stable character ID;
5. import the exported mind;
6. continue play with fresh world/body/item state but preserved accumulated memories, beliefs, and relationships.

Import is **replace**, not merge. Merge semantics are explicitly deferred.

### 1.2 Item-owned `abstract_study` progress

The current `abstractStudyProgress` is deterministic bookkeeping for the `abstract_study` item effect and does not belong to character identity.

Move that state to the item instance that provides the study interaction. Each item instance remembers study progress independently for each character ID that has used it.

For example, one slab may remember different active study threads for Mara, Traveler, and Garrick. A different slab instance has independent state.

## 2. Ownership rule for portable mind

The portable mind contains **persistent character state whose semantic content is authored by the model through the current character/memory protocols**.

For version 1, the transferred partitions are exactly:

- `beliefs`;
- `relationships`;
- `recentMemories`;
- `longTermMemories`.

`recentMemories`, `beliefs`, and `relationships` are authored through ordinary character decision memory updates. `longTermMemories` are authored/rewritten by the memory-consolidation model workflow.

The exported records retain the framework metadata required to preserve their identity and behavior, such as memory IDs, importance, and `protected`, even though those envelope fields are assigned or maintained by the engine rather than freely authored by the model.

## 3. State that is not portable

The following state must not be exported/imported as part of the portable mind:

- `knownFacts`;
- `pendingObservations`;
- `continuation`;
- `abstractStudyProgress` / item study progress;
- `aiDescription`;
- `playerDescription`;
- abilities or ability instructions;
- controller assignment;
- location/sublocation/position;
- sleeping state;
- wallet;
- inventory;
- equipped items;
- item ownership or item runtime state;
- engine facts/aura;
- world events, queues, locks, counters, or other world/runtime state.

`knownFacts` remain current authored baseline knowledge from the fresh world because the character model cannot currently write that partition.

`continuation` is model-authored but is transient working intention, not persistent identity. Import must not carry the exported character's old continuation into the new world.

## 4. Import semantics

### 4.1 Strict identity guard

A mind export is bound to one stable `characterId`.

Import is permitted only when:

```text
export.characterId === targetCharacter.id
```

There is no force-import override in version 1.

`characterName` is informational only and is not an identity key. A name or description may legitimately change between authored world revisions while the stable character ID remains the same.

### 4.2 Replace, never merge

On successful import, replace the target character's complete current values for:

- `mind.beliefs`;
- `mind.relationships`;
- `mind.recentMemories`;
- `mind.longTermMemories`.

Do not merge records with the fresh target character's values. The imported mind is the authoritative accumulated model-authored identity for these partitions.

All non-portable state remains from the current world.

Clear any existing target `continuation` as replacement hygiene. It belongs to the overwritten target runtime mind and is not part of the imported persistent identity.

Do **not** clear or replace `pendingObservations`; they are current-world perceptual/runtime state. A successfully imported character may react to currently valid pending observations using the imported mind.

### 4.3 No automatic story event

Import is an admin/runtime operation, not an in-world action.

It must not automatically:

- emit a world event;
- inject a pending observation;
- narrate a transition;
- create/move items;
- alter the target's physical state;
- advance the world tick;
- schedule an AI turn solely because import occurred.

If the character later receives an observation, the normal model flow sees the imported mind together with the current canonical view and may interpret the changed world in character.

### 4.4 Atomic commit

Import must be transactional:

1. parse the complete file;
2. validate schema/version/identity and every transferred record;
3. clone the current world;
4. replace the four mind partitions on the candidate target;
5. clear the candidate target continuation;
6. normalize memory ID counters;
7. validate the candidate world;
8. commit only if every step succeeds.

Any failure leaves the live world unchanged.

## 5. Export file format

Version 1 uses a standalone JSON document:

```json
{
  "schema": "ai-rpg.character-mind",
  "version": 1,
  "exportedAt": "2026-08-14T00:00:00.000Z",
  "characterId": "hoodedWoman",
  "characterName": "Mara",
  "mind": {
    "beliefs": [],
    "relationships": [],
    "recentMemories": [],
    "longTermMemories": []
  }
}
```

The file must not contain the whole character entity or world snapshot.

Suggested filename:

```text
mara-character-mind.json
```

The exact filename is presentation only; schema/version/`characterId` determine meaning.

### 5.1 Record validation

Version 1 validates the current canonical record shapes:

- belief: `{ id, text, confidence }`;
- relationship: `{ targetCharacterId, summary }`;
- recent/long-term memory: `{ id, summary, importance, protected }`.

Required constraints should match current engine limits where applicable. IDs must be valid and unique within their relevant partition. Recent and long-term memory IDs must not collide with each other.

Relationship records may refer to a character ID that is not currently present in the new authored world. The relationship is historical mind state and must not be discarded merely because that person is currently absent. A relationship targeting the imported character itself is invalid.

Unknown top-level schema fields or incompatible future versions must not be silently interpreted as version 1.

## 6. Memory ID/counter normalization

Imported memories preserve their existing IDs.

After replacement, recompute or raise `world.nextMemoryId` so that every imported ID matching:

```text
memory_ai_<number>
```

is below the next generated ID.

Future ordinary memory writes and consolidation must never collide with an imported memory ID.

This normalization is required even when importing into a freshly reset world whose counter has returned to a low value.

## 7. Busy-state and persistence rules

Export/import controls must not operate while a character/model/consolidation request or AI reaction wave can concurrently mutate the same state.

Import must use the framework's normal in-place state synchronization/persistence path so that a save made immediately after import contains the imported mind without requiring movement or another world tick first.

No API key or model transport data is included in a mind export.

## 8. Sidebar UI

The existing top sidebar block is already used for more than HumanController switching. Replace the misleading `Human controller` presentation with a compact character-tools block.

Recommended layout:

```text
Character
[Mara ▼]
[Take control] [Character]

Mind tools ▸
```

Expanded `Mind tools`:

```text
[Compress memory]
[Export mind] [Import mind]
```

The same selected character is the target for control, character inspection, compression, export, and import.

`Mind tools` should be collapsed by default to reduce sidebar clutter.

The existing world controls remain separate. Broader sidebar redesign is not required by this task.

### 8.1 Import confirmation

After a valid file is selected and the character ID matches, show a destructive confirmation similar to:

```text
Import saved mind for Mara?

This will replace Mara's beliefs, relationships,
recent memories, and long-term memories.

World state, inventory, location, authored descriptions,
and known facts will not change.

[Cancel] [Replace mind]
```

Display both the file character name/ID and current target name/ID in the confirmation/debug information.

If IDs differ, reject before confirmation. Do not offer a force option.

## 9. `abstract_study` ownership refactor

### 9.1 Current behavior to preserve

The existing deterministic behavior remains unchanged:

- bounded free-text `input_text`;
- lexical relation to the immediately previous study input;
- `survey` at depth 1;
- `focused` at depth 2;
- `saturated` at depth 3;
- unrelated input starts a fresh survey;
- no model request and no generated lore.

This task changes only where the progress record is stored.

### 9.2 New item-instance runtime state

Remove `abstractStudyProgress` from `character.mind`.

For an item instance using `abstract_study`, lazily maintain runtime state conceptually shaped as:

```json
{
  "abstractStudyProgressByCharacterId": {
    "hoodedWoman": {
      "lastInput": "mind storage outside the world",
      "depth": 2
    },
    "player": {
      "lastInput": "protective wards",
      "depth": 1
    }
  }
}
```

The field belongs to the **item instance**, not the item definition and not the character.

The authored `data/world.json` does not need to contain this runtime field. A fresh item starts with no reader progress and creates entries lazily when used.

The standalone world editor does not expose this runtime state.

### 9.3 Per-reader semantics

When actor `A` uses item instance `I`:

1. read `I.abstractStudyProgressByCharacterId[A.id]`;
2. compare the new input only against that reader's previous `lastInput` for this item instance;
3. compute the same related/depth/stage result as today;
4. write the updated record back under `A.id`.

Another character using the same item must not advance or reset `A`'s study thread.

Another item instance with the same definition must have independent study state.

Because the state follows the item instance, moving or giving the same physical slab to another location/owner preserves the slab's per-reader history.

A fresh slab created by a world reset starts with no reader history, even if an imported character remembers having studied similar material before.

## 10. Save migration for legacy study progress

Current saves may contain:

```text
character.mind.abstractStudyProgress[itemId]
```

Migration must convert compatible legacy records into the matching item instance:

```text
item.abstractStudyProgressByCharacterId[characterId]
```

for every preserved character/item pair where the legacy record is valid and the referenced current item instance still exists.

After migration, the candidate character must not retain `mind.abstractStudyProgress`.

If both new item-owned state and a legacy character-owned record exist, valid new item-owned state wins for that character/item pair; legacy conversion may fill only a missing entry.

Invalid/missing item references are discarded with a migration warning rather than creating story-specific replacement items.

The migration remains generic for any item instance using `abstract_study`; it must not special-case Mara or the Arcane Knowledge Slab.

## 11. API/implementation boundaries

Prefer keeping responsibilities aligned with the current split:

- `src/13-character-memory.js`: portable mind snapshot validation/export/import helpers and memory-counter normalization support;
- `src/10-game-api.js`: `abstract_study` item-owned runtime progress and world validation for its optional item state;
- `src/11-save-migration.js`: legacy character-owned study-progress conversion and preservation of new item-owned runtime progress;
- `src/30-game-ui.js`: character-tools UI, file download/upload, confirmation, status reporting;
- persistence/history synchronization: use the existing canonical path for immediate save correctness.

Keep the public `setup.GameAPI`/`CharacterAPI` facade stable where practical. A small dedicated facade such as `setup.CharacterMindTransfer` is acceptable if it avoids mixing file/UI concerns into deterministic character actions.

Mind export/import is not a formal in-world character action and must not appear in `view.available_actions`.

## 12. Required tests

### Portable mind

1. export contains exactly the four portable partitions plus format metadata;
2. export excludes known facts, continuation, pending observations, descriptions, inventory, position, wallet, controller state, and study progress;
3. import with matching `characterId` replaces all four target partitions;
4. import preserves current authored `knownFacts` and current `aiDescription`;
5. import preserves current location, inventory/items, equipment, wallet, sleeping/controller/world state;
6. import clears target continuation;
7. import does not create an event/observation/tick/AI queue entry;
8. mismatched `characterId` is rejected with no mutation;
9. malformed/incompatible file is rejected atomically;
10. imported memory IDs are preserved and `nextMemoryId` is raised above imported `memory_ai_*` IDs;
11. a save made immediately after import contains the imported mind.

### Study progress

12. same character + same item + related queries progresses `survey -> focused -> saturated` exactly as before;
13. unrelated query resets that reader's thread to survey;
14. two characters using the same item maintain independent progress;
15. one character using two separate item instances maintains independent progress per item;
16. moving/giving the same item preserves its per-reader progress;
17. fresh world/reset starts the authored item with empty reader progress;
18. character mind no longer receives `abstractStudyProgress` during study;
19. new-format saves preserve item-owned per-reader progress;
20. legacy saves migrate `character.mind.abstractStudyProgress[itemId]` into the corresponding item's per-character entry;
21. migration does not special-case Mara/slab story IDs.

### UI

22. character selector drives Take control, Character, Compress memory, Export mind, and Import mind;
23. Mind tools are collapsed by default;
24. import mismatch is blocked before destructive confirmation;
25. valid import requires explicit `Replace mind` confirmation;
26. relevant controls are disabled/rejected while conflicting AI/memory work is in flight.

## 13. Non-goals

This task does not implement:

- merging two developed minds;
- importing a mind into a different character ID;
- transferring physical state/items/equipment;
- transferring `knownFacts`;
- transferring `continuation`;
- transferring slab study progress with a character;
- automatically creating a transition memory or observation;
- interpreting contradictions between imported memories and the new world;
- changing the slab's current deterministic educational semantics;
- adding a general knowledge/skill system.

