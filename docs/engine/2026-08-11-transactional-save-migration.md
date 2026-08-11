# Transactional Save Migration and Authoring Reconciliation

## Purpose

Allow older compatible playthroughs to continue automatically after the game is rebuilt with newer authored world content or a newer compatible persisted runtime schema.

Core model:

> **Fresh authored world + preserved lives.**

The current build defines the objective authored world. The save contributes selected runtime history for surviving characters and surviving item instances. Character memory is the highest-priority persisted state.

## Version model

Persist two distinct compatibility concepts:

- `schemaVersion` — persisted runtime structure/semantics;
- `authoringRevision` — deterministic fingerprint of current generated world authoring.

The build generator computes `authoringRevision` from `data/world.json` and embeds it into `setup.GeneratedWorldData`. A change to authored world content therefore triggers reconciliation without requiring a manual revision edit.

Legacy saves using historical `world.version = 6` are recognized as migration sources.

## Trigger points

Migration is detected automatically on restored playthroughs, including:

- normal SugarCube/session restoration after F5;
- normal saved-game loading.

If schema and authored revision already match the current build, normal bootstrap proceeds without migration.

## Transaction model

Never patch the restored old world structure in place.

Required flow:

```text
restored save
  -> clone persistent migration source
  -> create a completely fresh current world from GeneratedWorldData
  -> overlay approved runtime character/item state
  -> apply deterministic reference fallbacks
  -> validate the complete candidate
  -> atomically commit State.variables.world
```

The old active save remains untouched until candidate validation succeeds.

If migration fails, discard the candidate and leave the original restored save unchanged. Never silently reset to a new game.

## Character matching

Characters match by canonical character ID.

A saved character whose ID still exists in current authoring survives. A character removed from current authoring is omitted from the new candidate and therefore deleted from the playthrough.

Future runtime-created characters require a separate policy and are not inferred here.

## Authored character state

For surviving characters, current authoring wins for profile/configuration state, including:

- name;
- `playerDescription`;
- `aiDescription`;
- abilities and ability instructions;
- engine facts;
- default controller;
- authored metadata.

This allows authoring fixes and newly established world facts to reach existing playthroughs.

## Character mind

### Authored `knownFacts`

Saved `knownFacts` are **not** migrated.

For each surviving character:

```text
mind.knownFacts = current authored initialMind.knownFacts
```

`knownFacts` are treated as current authored baseline knowledge about the current authored world. This is what allows new local facts such as Mara's cottage/social status to appear in an existing playthrough.

### Preserved mental history

Preserve from the save:

- `beliefs`;
- `relationships`;
- `recentMemories`;
- `longTermMemories`.

Do not silently discard malformed persisted memory. Invalid persistent mental state causes migration failure rather than partial loss.

### Continuation

Preserve the surviving character's current model-authored `continuation` unchanged when it remains a valid string within the existing limit.

The framework does not interpret, expire, rewrite, or prioritize continuation content during migration.

### Pending observations

Do not migrate `pendingObservations`.

A migrated world starts a new execution session around the preserved durable life state.

## Other character runtime state

Preserve when valid:

- wallet;
- current controller assignment;
- current major location;
- current sublocation;
- ownership/placement of surviving item instances.

The exactly-one-HumanController invariant must hold at commit. If the previous Human-controlled character was removed or assignments are otherwise invalid, use the existing deterministic controller-repair policy, preferring the canonical player character where applicable.

## Position repair

- Saved location and sublocation both still valid: restore exactly.
- Saved location exists but sublocation was removed: use that location's current `defaultSublocation`; record a warning.
- Saved location was removed: use current `startLocation` and its default sublocation; record a warning.

Do not recreate removed locations or sublocations from the save.

## Runtime item migration

Current authored item definitions are authoritative. Never migrate old definition objects.

Preserve valid saved item instances such as keys, mugs, ale, transformed items, carried items, surface items, and runtime-created ordinary items.

Preserve the instance ID, current `definitionId`, current placement, and compatible instance-specific fields.

If the current authored world no longer contains the saved instance's definition, delete that instance and record a warning.

### Authored instance deduplication

Fresh candidate creation initially installs current authored starting item instances.

If the save contains an item instance with the same persistent ID, the saved runtime instance replaces the fresh starting placement/state for that ID.

New authored instances whose IDs did not exist in the save remain in their new authored starting positions.

### Missing container fallback

If the saved container still exists, restore there.

If the saved inventory ID no longer exists, inspect the saved inventory owner:

1. if the same owner entity survives and currently owns an inventory, place the item in that current inventory;
2. otherwise remove the item.

Every reposition/removal is reported. Never commit dangling container references.

## World structure

Do not migrate old copies of authored structure such as:

- locations;
- sublocations;
- exits;
- descriptions;
- capacities;
- beds/surfaces/containers;
- item definitions;
- ability definitions;
- authored lock configuration;
- environmental fixtures.

These always come from the current build.

## Transient execution state

Discard old:

- world event journal used by the current execution session;
- pending observations;
- AI turn queue;
- in-flight AI/reaction state;
- scheduler scratch state;
- debug controller state;
- narrator request/presentation state;
- AI exchange transport/debug history.

Runtime counters are reset or reconstructed so future generated IDs cannot collide with preserved durable records. In particular, preserved `memory_ai_N` IDs advance the next memory counter beyond the highest surviving generated memory ID.

## Migration UI

When migration is required, normal gameplay rendering is blocked and a modal overlay is shown before migration work begins:

> **Migrating save...**
>
> Updating this playthrough to the current world version.

The UI yields a browser paint opportunity before the synchronous candidate migration begins so the status is actually visible.

No Human action, AI reaction wave, narrator request, or other gameplay interaction may begin while migration is active.

On success, briefly show either:

> **Save migrated successfully.**

or, when deterministic fallbacks/removals were required:

> **Save migrated with warnings.**

On failure, leave the original restored save active but block gameplay and show:

> **Save migration failed. Your original save was not changed.**

Never auto-reset after failure.

## Diagnostics

Every attempted migration produces a structured report containing at least:

- source/target schema version;
- source/target authoring revision;
- status;
- characters preserved/removed;
- character position fallbacks;
- item instances preserved/removed/repositioned;
- authored known facts loaded;
- memories/relationships/beliefs preserved;
- warnings;
- errors.

The latest report is exposed through the migration API and successful reports are also stored in the fresh world's debug migration report list.

## Current compatibility case

The migration must support the pre-cottage playthrough where Mara already remembers the Traveler's offer/building promise but the old authored world contains no `villageEdge` or `secludedCottage`.

After rebuild + F5:

- migration is detected before gameplay rendering;
- the new village edge/cottage authored structure appears;
- Mara's saved memories, beliefs, relationships, wallet, controller state, and continuation survive;
- Mara's current authored description and authored `knownFacts` replace the old authored baseline;
- Garrick and Nell receive their new authored Mara facts;
- Captain Price receives no new authored Mara facts, while his actual saved memories/beliefs/relationships survive;
- valid keys/mugs/ale and other item instances preserve their current state and placement;
- transient queue/observations/events are cleared;
- the candidate validates before atomic commit.

## Public engine surface

The engine exposes a migration service conceptually equivalent to:

```text
setup.SaveMigration.getStatus()
setup.SaveMigration.migrate()
setup.SaveMigration.isInFlight()
setup.SaveMigration.getLastReport()
```

Normal `setup.Game.bootstrap()` detects a required migration without mutating the restored world. Normal world APIs refuse to proceed against a save that still requires migration.

## Acceptance criteria

1. Current legacy `world.version = 6` saves are recognized.
2. Authoring changes are detected through the generated authoring revision.
3. F5/session restoration can trigger migration.
4. normal save loading can trigger migration.
5. the current authored world is rebuilt fresh.
6. character memories, beliefs, relationships, continuation, wallet, valid position, and controller assignment survive for characters that still exist.
7. `knownFacts` come from current authoring.
8. removed characters disappear.
9. current item definitions win while valid runtime item instances survive.
10. item instances with removed definitions are deleted.
11. saved persistent item IDs do not duplicate fresh authored starting instances.
12. invalid positions and removed containers use deterministic fallback/removal with warnings.
13. transient execution state is discarded.
14. migration is atomic and validates before commit.
15. failure leaves the original restored save unchanged and never silently resets it.
16. `Migrating save...` is visibly rendered before migration work.
17. structured diagnostics are produced.
18. the Mara-cottage regression scenario passes without losing Mara's memory.
19. Captain Price receives no retroactive authored local Mara knowledge.
