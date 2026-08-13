# AI RPG Persistence and Save-State Correctness — Implementation Specification

## 1. Purpose

Fix persistence bugs where the live canonical world is correct during play, but exported or restored saves contain stale runtime state.

This specification covers two related persistence failures:

1. **Stale live-state serialization after in-place asynchronous gameplay**
   - Normal world ticks, AI reaction cascades, and timelapse can mutate `State.variables.world` without creating a new SugarCube passage/history moment.
   - The UI can show the correct live state after `Engine.show()`, while a subsequent disk/browser save serializes an older history snapshot.
   - This can make a save taken after a completed timelapse restore the world to the pre-timelapse positions, sleeping flags, continuations, inventories, or other runtime state.

2. **Dynamic lock state lost during fresh-world + runtime-overlay migration**
   - Migration rebuilds from the current authored world and overlays saved runtime state.
   - Compatible passage/door lock state is currently not preserved, so authored defaults can overwrite runtime lock state from the save.

The fix must make persistence reflect the actual canonical runtime state at the moment the user saves.

---

## 2. Observed Failure

A completed overnight timelapse reached a valid live state in which:

- Captain Price was asleep in Guest Room 1.
- Nell was asleep on the cot beneath the stairs.
- Garrick was asleep in his private room.
- Mara was asleep in her cottage.

However, a save exported after the timelapse contained the earlier pre-sleep state:

- Price was awake at `commonRoomTableTwo`.
- Nell was awake at `barPublicSide`.
- Garrick was awake behind the bar.
- Mara was awake at `villageEdgePath`.
- Old tick-mode `continuation` values were still present.

The runtime itself had completed the timelapse correctly. The persistence layer serialized stale state.

This is not specific to timelapse. Any in-place mutation that does not create a new SugarCube history moment may be affected.

---

## 3. Core Persistence Invariant

At the instant a save is created:

> **The saved runtime state must be semantically equivalent to the current live canonical `State.variables.world`.**

The save system must not depend on a passage navigation having occurred after the most recent mutation.

`Engine.show()` must not be treated as sufficient evidence that the SugarCube history state used for persistence is synchronized.

The same invariant applies after:

- a HumanController action,
- a complete AI reaction cascade,
- a failed but turn-consuming grounded action,
- a normal in-place world tick,
- an overnight timelapse,
- a partially completed timelapse whose committed rounds are intentionally retained,
- debug/runtime actions that legitimately mutate canonical world state,
- any future daytime timelapse.

---

## 4. Required Architecture

### 4.1 Introduce one explicit persistence synchronization boundary

Create a single reusable mechanism responsible for ensuring that the state SugarCube saves is synchronized with the current live runtime state.

Do not scatter ad hoc history mutations across controllers.

The exact implementation may use the most appropriate SugarCube-compatible mechanism, but the behavior must be centralized and testable.

Possible implementation strategies include:

- updating/replacing the active history moment with the current live variables before save serialization, or
- changing the custom save/export path so it serializes the current canonical live state directly rather than relying on a stale history snapshot.

The implementation must choose the smallest reliable mechanism compatible with the existing save/load architecture.

### 4.2 Do not create fake gameplay turns

Persistence synchronization must **not**:

- advance the world tick,
- create an AI reaction opportunity,
- emit observations,
- create gameplay events,
- alter initiative,
- create an additional passage transition visible to gameplay,
- duplicate a HumanController turn,
- wake sleeping characters,
- rerun timelapse logic.

It is persistence bookkeeping only.

### 4.3 Preserve normal SugarCube navigation semantics

Ordinary passage navigation must continue to work normally.

The fix must not require the player to change location before saving.

It must also not create a growing sequence of artificial history moments merely because async work completed.

---

## 5. Save Creation Requirements

Before any user-visible save/export operation serializes game state:

1. All currently completed canonical mutations must already be present in `State.variables.world`.
2. The persistence synchronization mechanism must make the serializable state reflect that live world.
3. Only then may the save payload be created.

If a world tick or timelapse is still actively processing, preserve the existing UI rule that player controls remain locked until the canonical operation finishes.

Do not add a second save path that can serialize speculative or partially uncommitted model output.

### 5.1 Progressive output does not change persistence semantics

Progressive committed rendering remains presentation only.

Showing a committed tick fragment or timelapse round early must not itself force a gameplay snapshot.

The save invariant concerns canonical committed state, not rendering cadence.

---

## 6. Timelapse-Specific Requirements

### 6.1 Successful overnight completion

After overnight timelapse finishes:

- the HumanController wake-up state must be persisted,
- AI locations must match their final canonical timelapse locations,
- AI `sleeping` flags must match the live end state,
- inventories and deterministic timelapse-action results must match live state,
- reflections, consolidation results, recent/long-term memories, beliefs, relationships, and other committed private state must match live state,
- cleared/updated continuations must match live state.

A save made immediately after the overnight result appears must restore exactly that state without requiring any further passage navigation.

### 6.2 Partial timelapse failure

The current timelapse rule remains:

- fully committed earlier rounds remain canonical,
- speculative later work is discarded,
- already committed state is not rolled back.

If saving is allowed after such a failure, the save must contain exactly the retained committed state.

---

## 7. Normal Tick Requirements

A save made immediately after an in-place HumanController tick must preserve:

- the HumanController action result,
- all completed AI reactions from that tick,
- final locations and sublocations,
- inventories,
- sleeping/waking state,
- money and tracked items,
- relationship/belief/memory updates,
- continuation changes,
- deterministic world flags,
- any other canonical runtime mutation.

This must work even if the current SugarCube passage never changed during the tick.

---

## 8. Migration: Preserve Dynamic Lock State

The existing architecture remains:

> fresh authored world + compatible saved runtime overlay

Authored world data remains authoritative for static definitions and newly introduced content.

However, dynamic lock state is runtime state and must be overlaid from the save when the corresponding passage still exists.

### 8.1 Required behavior

For a passage/door that exists in both:

- the current authored world, and
- the saved runtime world,

preserve the saved runtime `locked` value when the passage identity can be matched safely.

Use stable authored identifiers where available.

If lock state is represented reciprocally on two exits for the same physical passage, migration must keep the two sides consistent.

### 8.2 New or removed passages

- A newly authored passage that does not exist in the old save uses its authored default.
- A removed passage is not resurrected from the old save.
- Do not invent compatibility matches based only on display text.

### 8.3 Authored default must not overwrite existing runtime state

Example:

- authored Guest Room 2 door default: `locked: true`
- saved runtime state: `locked: false`
- same stable passage still exists

After migration, it must remain `locked: false`.

---

## 9. Save Compatibility

Do not break existing save files unnecessarily.

Existing saves that lack any newly introduced persistence metadata must still load through the current migration path.

If a save contains stale state because it was produced before this fix, the engine cannot reconstruct runtime mutations that were never serialized. Do not fabricate missing history.

The fix guarantees correctness for saves created after the new persistence behavior is installed.

---

## 10. Continuation Semantics

This persistence fix must preserve the separate design decision that `continuation` is model-authored working state and the engine does not interpret its semantic content.

For timelapse mode boundaries, ordinary tick-mode continuation may be cleared according to the timelapse specification.

Persistence must simply save the canonical value that currently exists.

Do not add save-layer logic that interprets continuation text.

---

## 11. Error Handling

If persistence synchronization fails:

- do not silently write a known-stale save,
- surface a clear debug/user-visible save failure,
- preserve the live runtime state,
- do not mutate world state merely to recover from serialization failure.

The save layer must not report success until serialization has completed from the synchronized state.

---

## 12. Tests

Add regression tests that reproduce the actual failure modes.

### 12.1 Save immediately after in-place mutation

1. Start from a known world.
2. Mutate canonical `State.variables.world` without passage navigation.
3. Invoke the real save/export path.
4. Reload the produced save.
5. Assert the mutation survived.

The test must fail against the old behavior.

### 12.2 Save immediately after ordinary tick

Run a HumanController turn that causes at least one AI reaction without changing SugarCube passage.

Save immediately after the reaction cascade.

Reload and assert final canonical state matches the pre-save live state.

### 12.3 Save immediately after overnight timelapse

Use multiple AI characters whose final states differ clearly from their starting states.

At minimum assert after reload:

- HumanController is in the correct morning state.
- Price remains in Guest Room 1 with the correct sleeping state.
- Nell remains on the under-stairs bed with the correct sleeping state.
- Garrick remains in his room with the correct sleeping state.
- Mara remains at her cottage with the correct sleeping state.
- pre-timelapse continuations do not reappear if they were cleared by the canonical runtime.

Do not rely only on UI text; compare canonical world state.

### 12.4 Save/load without location change

Explicitly verify that persistence works when no `Engine.play()` or equivalent navigation happened after the mutation.

### 12.5 Lock-state migration

Create an old save in which a stable authored passage is unlocked even though the fresh authored world defaults it to locked.

Migrate and assert the runtime passage remains unlocked.

Also test the inverse:

- authored default unlocked,
- saved runtime locked,
- migrated result remains locked.

### 12.6 New passage default

Add a passage to fresh authored world that did not exist in the old save.

Assert it uses the authored default lock state after migration.

### 12.7 Reciprocal lock consistency

If two exits represent the same lockable doorway, migration must not produce one side locked and the other unlocked.

### 12.8 Existing save migration behavior

Retain existing regression coverage proving that:

- current authored descriptions come from the fresh world,
- runtime positions/inventory/memory from compatible saved entities survive,
- newly authored stable-ID items can appear in old saves according to the established overlay rules.

The new lock overlay must not regress these rules.

---

## 13. Debugging / Diagnostics

Keep enough debug visibility to distinguish:

- current live `State.variables.world`,
- the state about to be serialized,
- migration input,
- migration output.

A lightweight assertion/helper in tests is preferred over permanent noisy UI.

Do not add a manual gameplay button that forces state synchronization as a workaround.

Saving must be correct automatically.

---

## 14. Non-Goals

This patch does **not**:

- change timelapse planning,
- change overnight wake-up semantics,
- implement daytime timelapse,
- change AI reaction scheduling,
- change narrator behavior,
- add equippables,
- redesign the save file format unless strictly required,
- reconstruct mutations missing from already-stale historical saves,
- change authored world content except where a test fixture requires it.

---

## 15. Acceptance Criteria

The patch is complete when all of the following are true:

1. A save taken immediately after a normal in-place world tick reloads the exact committed runtime state.
2. A save taken immediately after overnight timelapse reloads the exact final canonical timelapse state.
3. No passage navigation is required before saving.
4. Progressive UI rendering does not affect save correctness.
5. Dynamic passage lock state survives fresh-world migration for compatible existing passages.
6. Newly authored passages still use authored defaults.
7. Static authored data continues to refresh from the current world while compatible runtime state is preserved.
8. Existing tests remain green and new regression tests fail on the old implementation but pass on the fix.
9. No fake gameplay turn/history event is created merely to make saving work.
