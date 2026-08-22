# Speech Reach, Item Action UX, and Timelapse Temporal Discipline

Status: implementation specification  
Scope: engine + game UI  
World-specific authored content changes: none required

## 1. Purpose

This patch improves three areas without introducing parallel mechanics:

1. make movement speech and shouting obey simple grounded spatial/perception rules;
2. reduce item-action button clutter while keeping formal action contracts unchanged;
3. keep timelapse narration temporally disciplined so models do not advance the time phase on their own.

Before implementation, read and reuse the current project contracts in:

- `docs/architecture.md`
- `docs/status.md`
- relevant `docs/engine/*`
- relevant `docs/world/*`

Search the existing code for analogous speech delivery, observation, topology, item-label, and action-rendering helpers before adding new generic mechanisms. Reuse existing predicates/contracts whenever possible.

---

## 2. Non-goals

This patch does **not** add:

- acoustic simulation;
- sound attenuation;
- door/wall sound blocking;
- multi-addressee speech;
- item stacking;
- new formal item actions;
- a new trade system;
- a natural-language temporal validator;
- a second perception/memory system.

---

# Part A — Movement Speech and Addressee Reach

## 3. Existing invariant

There is at most one optional speech addressee.

The existing speech, observation, reaction, dialogue-context, and attempt-phase delivery contracts remain authoritative except where explicitly extended below.

## 4. `move` with spoken text

When the player selects a `move` action and includes spoken text, the optional addressee may be:

- a character in the origin location; or
- a character the player has grounded reason to believe is in the destination location.

The addressee selector must not expose arbitrary actual occupants of the destination. It must not become an omniscient radar.

## 5. Grounded destination presence

Destination addressee eligibility is based on **player-known / last-known presence**, not direct access to hidden canonical placement.

Typical qualifying evidence:

- the player directly saw the character in that destination recently; or
- the player directly observed that character move into the destination and has not subsequently observed them leave.

Example:

- Mara and the player are in the cottage;
- the player observes Mara move from the cottage to the garden;
- the player chooses `Move → Garden`;
- Mara may be offered as the destination addressee because the player actually observed where she went.

If Mara later moves elsewhere without the player perceiving it, the player's last-known information may remain stale. That is acceptable and preferable to leaking hidden state.

### 5.1 Reuse before new state

If existing delivered observations / perception records already provide enough deterministic information to derive last-known presence, derive from them.

Only add a small explicit controller-side last-known-presence cache if derivation from existing state is impractical. If such state is added:

- it is deterministic perception state, not a belief;
- it is not part of the character mind;
- it is not exported in portable mind export;
- it must survive ordinary save/load if otherwise the UI would forget already perceived placement;
- it is updated only by information actually delivered to the human-controlled character.

## 6. Delivery room

For `move + spokenText + addressee`:

- if the addressee is in the origin, direct speech delivery occurs in the origin context;
- if the addressee is in the destination, direct speech delivery occurs in the destination context after arrival;
- delivery uses the existing observation/perception pipeline;
- do not broadcast the direct-address observation indiscriminately to both rooms.

Existing rules for other observers hearing ordinary speech remain unchanged.

## 7. Stale last-known destination

A stale last-known addressee must not make movement impossible.

If the player selects a destination addressee based on valid last-known information but that character is no longer there when the action executes:

- the move itself may still succeed normally;
- do not reveal the addressee's actual hidden location;
- do not fabricate a direct-address delivery to the absent character;
- preserve existing ordinary speech/observer semantics for the room where the utterance actually occurs.

The UI should naturally update once the player perceives the destination.

---

# Part B — Shout Volume

## 8. Add `Shout`

Add `Shout` as the third speech-volume option in the existing speech UI/contract.

Do not create a separate dialogue subsystem.

## 9. Shout restrictions

A shout:

- has **no addressee**;
- cannot be combined with `move`;
- is a stationary speech action;
- selecting `Shout` in the UI immediately clears the current addressee and disables the addressee selector;
- if `move` is selected, `Shout` must be unavailable/invalid for that action.

Formal validation must enforce the same constraints as the UI.

## 10. Shout hearing radius

A shout is heard in:

1. the speaker's current location; and
2. every location directly adjacent to it by exactly one authored topology edge.

No further propagation occurs.

Equivalent rule:

> `heardLocations = { currentLocation } ∪ directNeighbors(currentLocation)`

Do not BFS beyond one edge.

## 11. Locks and acoustics

This patch does not simulate acoustics.

Therefore:

- locked passages do not block shout delivery;
- closed/locked door state does not modify shout hearing;
- traversal capability is irrelevant to sound delivery;
- authored graph distance still matters.

Examples:

- a shout on `Street` may be heard on `Street`, at `Tavern Entrance`, in Harlan's directly connected kitchen/work area, and on `Market Square` if those are direct neighbors;
- it is not heard at the `Bar` if the Bar is a second hop through another room;
- it is not heard inside the merchant's `Wagon` if the Wagon is a second hop through Market Square;
- a shout in `Common Room` may be heard by Garrick at a directly adjacent Bar;
- guests in upstairs rooms do not hear it when `Upper Corridor` is an intermediate location.

## 12. Observation and reactions

Shout delivery uses normal observation delivery.

Every character in a heard location receives the normal grounded observation for the shout and may react through the normal reaction scheduler.

Sleeping characters receive the observation through the same mechanism as any other character. This patch does **not** add deterministic waking behavior. Whether the shout causes a reaction, waking, irritation, investigation, or no response is handled by the existing observation/reaction behavior.

---

# Part C — Paper Sheet Instance Labels

## 13. Problem

Written Paper Sheet instances are currently visually indistinguishable from blank sheets and from one another.

The canonical item definition/name must remain unchanged.

## 14. Shared item-instance display formatter

Add or extend one shared item-instance display-label formatter.

For a Paper Sheet:

- blank/whitespace-only `content` → `Paper Sheet`;
- non-empty `content` → `Paper Sheet — <preview>`.

The preview is UI-only. It must not mutate canonical item data.

## 15. Preview rules

Use the first few meaningful words of `content` (approximately 4–6 words), normalized for compact display.

Recommended behavior:

- collapse whitespace/newlines;
- strip the syntactic `*` markers from drawing metadata for the preview;
- preserve the actual wording;
- append `…` when truncated.

Examples:

- `Meet me by the old bridge after sunset.`  
  → `Paper Sheet — Meet me by the old…`

- `*a crooked little house is drawn beneath the text*`  
  → `Paper Sheet — a crooked little house is…`

Do not alter the stored `content`.

## 16. Where the formatter must be used

Use the same formatter everywhere the user needs to distinguish item instances, including at minimum:

- normal inventory display;
- quick/action buttons;
- bulk-transfer checkbox picker;
- `Advanced Actions`;
- container/surface item lists;
- paper-specific use/read/write action labels.

Do not implement separate paper-label logic per screen.

## 17. No stacking in this patch

Do not add item stacking yet.

Distinct item instances remain individually selectable even when their canonical item type is the same.

---

# Part D — Grouped Item Actions

## 18. Goal

Large inventories must not flood the main UI with one button per item/action combination.

This is a presentation refactor only.

The existing formal actions, validation, execution, IDs, and model-facing contracts remain unchanged.

## 19. `Use item` group

Replace the flat set of item-use buttons in the quick action area with a single expandable:

`Use item ▸`

Its children are the **actual available action labels**, not merely item names.

Examples:

- `Read paper — Meet me by the old…`
- `Write / draw on paper — Meet me by the old…`
- `Squeeze Memory Stone`
- `Study with tablet`

Only currently available formal actions appear.

Selecting a child executes/opens the same formal action flow as before.

## 20. `Drop item` group

Replace flat per-item drop buttons with:

`Drop item ▸`

Children are individual droppable item instances using the shared display formatter.

Example:

- `Paper Sheet — Meet me by the old…`
- `Writing Set`
- `Stamina Potion`

## 21. `Put item on/in <destination>` groups

Group put/place actions by destination.

Examples:

- `Put item on table ▸`
- `Put item in chest ▸`
- `Put item on bed ▸`

Each group's children are the item instances currently valid for that destination.

Do not change keyed-container access, capacity, ownership, reachability, or any other validation rule.

The grouping layer must be generated from already validated available actions rather than inventing availability itself.

## 22. Advanced Actions

`Advanced Actions` may continue to expose the formal action list rather than using the grouped quick-action structure.

However:

- item labels there must use the same shared item-instance formatter;
- the formal action semantics must remain identical.

---

# Part E — Timelapse Temporal Discipline

## 23. Problem

A timelapse may correctly preserve canonical state while model-generated narrative drifts into the next time phase prematurely.

Observed examples include behavior such as:

- preparing as though the night has already begun during a daytime timelapse;
- going to bed during daytime rounds;
- referring to the "day ahead" late in a daytime span;
- behaving as though the next morning has started before the deterministic phase transition.

This creates a mismatch between narrative and engine time even when the final state is correct.

## 24. Core invariant

**Models must not advance the world's time phase themselves.**

For the entire set of timelapse simulation rounds, the authoritative phase remains the source phase until the engine performs the deterministic transition.

Example:

`daytime timelapse → evening`

All simulation rounds occur within the daytime span. `evening` does not begin until the engine commits the phase transition after the rounds.

Likewise, an evening/night timelapse that advances to morning must not narrate the new morning before the deterministic transition.

## 25. Prompt requirements

Timelapse planning and per-round decision prompts must explicitly state:

- the current authoritative time phase;
- the phase the engine will transition to afterward, if useful for orientation;
- that the model must not perform or narrate the phase transition itself;
- that all planned round actions must fit inside the current timelapse span;
- that future-phase events may be anticipated prospectively but not treated as already occurring.

Good:

> Nell checks that the common room will be ready for the evening crowd.

Bad:

> Nell turns in for the night.

when the authoritative phase is still daytime and sleeping is not valid.

## 26. Action validity remains deterministic

Existing deterministic action availability remains the safety net.

Examples:

- if daytime sleeping is currently prohibited, the model must not receive/commit a daytime sleep action;
- routine anchors and other deterministic final positioning happen at the engine-controlled phase boundary, not because the model narrates the next phase.

Do not add a brittle natural-language parser intended to reject every temporal phrase. The main mitigation is:

1. explicit prompt contract;
2. formal action validation;
3. deterministic phase ownership by the engine.

## 27. Planning discipline

Timelapse planners should treat rounds as portions of one abstract span, not as independent mini-days.

A plan should not reset a character's implied clock between rounds.

In particular:

- do not repeatedly "wake up" unless the character was actually sleeping and waking is grounded;
- do not repeatedly start/end workdays;
- do not independently invent sunrise/sunset;
- do not use round number as permission to enter the next canonical phase.

Later rounds may reasonably reflect progression within the same span, such as finishing work or preparing for the upcoming evening, while still remaining in the current phase.

## 28. Transition ownership

The phase transition remains one deterministic engine event.

The intended order is:

1. timelapse rounds execute/commit in the source phase;
2. round-dependent reflection/maintenance runs according to existing architecture;
3. final deterministic routines/settlements/transitions run in their established order;
4. the engine changes the canonical phase/day;
5. the new phase is then visible to subsequent gameplay/model calls.

Do not create narrative-only duplicate transitions.

## 29. Timelapse UI status

Existing user-friendly timelapse modal/status behavior remains compatible with this patch.

System progress lines such as:

- `Simulating daytime activity…`
- `Consolidating memories…`
- `Reconciling beliefs…`
- `Updating weather…`

are process-status UI, not in-world time claims, and may appear while the canonical phase remains unchanged.

---

# Part F — Model / Engine Contracts

## 30. Model-visible actions

AI characters must receive the formal actions supported by these mechanics through the normal `available_actions` path.

Do not add prompt-only abilities.

In particular:

- shout must be grounded as an available formal speech action when valid;
- paper read/write actions remain grounded formal actions;
- grouped UI controls are **not** model-facing actions and must not alter the model protocol.

## 31. Observation integrity

Every speech delivery introduced here must use the existing observation/perception pipeline.

Do not directly append memories, relationships, dialogue context, or reactions as a shortcut.

The normal downstream systems decide what is perceived, remembered, reacted to, and consolidated.

---

# Part G — Save / Migration

## 32. Compatibility

Existing saves must continue to load.

If no new persistent state is required, do not bump schema solely for UI grouping or shout.

If an explicit last-known-presence cache is introduced because existing perception state cannot support the feature:

- add the smallest necessary persisted field;
- migrate old saves with an empty/derived initial value;
- preserve all existing character/world state;
- add a regression test from the previous schema.

Do not store derived UI labels in saves.

Paper `content` remains the existing instance-level canonical field.

---

# Part H — Acceptance Criteria

## 33. Move addressing

1. A character in the origin may be selected as addressee for `move + spokenText`.
2. A character directly observed moving into the destination may be selected there.
3. An unobserved hidden character in the destination does not appear in the selector.
4. Stale last-known information does not reveal the character's actual new location.
5. Direct-address observation is delivered in the addressee's actual eligible room through normal perception.
6. Movement can still succeed when a stale destination addressee is no longer there.

## 34. Shout

1. `Shout` appears as the third speech-volume option.
2. Selecting it clears and disables addressee.
3. Shout cannot be combined with move.
4. Characters in the current location hear it.
5. Characters in every direct one-hop neighboring location hear it.
6. Characters two hops away do not hear it.
7. Locked passage state does not alter shout range.
8. Sleeping characters receive the same observation pipeline; no special forced wake is introduced.

## 35. Item labels

1. Blank paper displays as `Paper Sheet`.
2. Written paper shows a short text preview.
3. Drawing-only metadata shows a readable preview without raw `*` markers.
4. The same formatter is used in inventory, quick actions, bulk transfer, Advanced Actions, and container lists.
5. Canonical item names/content are unchanged.

## 36. Action grouping

1. Main quick actions no longer create one top-level button per use/drop/put combination.
2. `Use item` expands to actual action labels such as `Read paper` and `Squeeze Memory Stone`.
3. `Drop item` expands to individually distinguishable item instances.
4. Put actions are grouped by destination.
5. Underlying formal action IDs, validation, and execution remain unchanged.
6. Keyed-container access and other existing predicates continue to be reused.

## 37. Timelapse discipline

1. Timelapse prompts explicitly identify the authoritative current phase and forbid model-driven phase advancement.
2. A daytime timelapse does not expose valid actions that contradict existing daytime restrictions.
3. Models may prospectively prepare for the next phase but must not behave as though it has begun.
4. Canonical phase changes exactly once through the deterministic engine path.
5. Existing routine anchors and maintenance continue to function.
6. No new narrative NLP validator is required.
7. Regression tests cover prompt construction and deterministic phase ownership.

---

# Part I — Suggested Regression Tests

Add targeted tests for at least:

- origin addressee on move;
- observed destination addressee on move;
- hidden destination occupant not exposed;
- stale last-known destination;
- shout current-room delivery;
- shout one-hop delivery;
- shout two-hop exclusion;
- shout through a locked direct passage;
- shout UI clearing/disabling addressee;
- shout + move rejection;
- sleeping listener receives ordinary observation;
- paper preview for text;
- paper preview for drawing-only metadata;
- shared item label in inventory / bulk transfer / Advanced Actions;
- grouped `Use item` labels;
- grouped `Drop item`;
- grouped put-by-destination;
- timelapse prompt includes temporal invariant;
- daytime-to-evening phase remains daytime through all rounds;
- phase transitions once at the deterministic boundary.

---

## 38. Implementation principle

This patch must favor **reuse before invention**.

If implementation appears to require a new generic system for:

- perception;
- keyed access;
- speech delivery;
- topology;
- item action validation;
- item naming;
- timelapse phase ownership;

first verify that the project does not already have the required mechanism or a predicate that can be extended.

A new parallel mechanism requires an explicit architectural justification.
