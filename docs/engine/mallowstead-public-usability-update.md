# Mallowstead Public Usability Update
## Discoverable Locations, Non-Blocking Startup Weather, and Quick Give Gold

**Status:** Implementation specification  
**Scope:** Small public usability/content update  
**Game:** Mallowstead  
**Out of scope:** Chuhayster, secret-arc/quest framework, additional secret characters, large narrative systems

---

## 1. Goals

This update adds three focused improvements without changing the core simulation model:

1. Add a reusable per-character **discoverable location** mechanic and use it for the first secret place, **Trampled Glade**.
2. Make the initial current-weather lookup **non-blocking**, so a new game becomes usable immediately.
3. Add a quick **Give gold** control that is only presentation sugar over the existing formal gold-transfer action.

The implementation must preserve the existing engine principles:

- canonical world state remains authoritative;
- AI models do not invent or directly write mechanical access;
- formal actions are validated by the engine;
- hidden information must not leak through model views, pathfinding, timelapse, or player-facing off-screen presentation;
- save/load and old Mallowstead/MVP/POC save compatibility must remain intact.

---

# 2. Discoverable Locations

## 2.1 Concept

Some authored locations may be marked as requiring discovery.

Discovery is:

- **per character**;
- **location-level**, not entrance-level;
- persistent canonical runtime state;
- independent from mind, beliefs, memories, and known facts.

Once a character discovers a secret location, **all authored entrances to that location become available to that character at once**.

Do not introduce per-passage discovery in this update.

Suggested authored/runtime shape:

```text
location.requiresDiscovery: true

character.initialDiscoveredLocationIds: [...]
character.discoveredLocationIds: [...]
```

Exact field names may follow existing project naming conventions, but the semantic split is required:

- authored initial knowledge/access;
- persisted runtime discoveries.

Ordinary locations do not need to be listed in `discoveredLocationIds`; they remain available normally.

## 2.2 Mechanical discovery vs. character knowledge

Mechanical access and narrative knowledge are separate.

For example, Mara should have both:

- an authored known fact explaining that she knows about Trampled Glade;
- authored initial discovery/access allowing the engine to route her there.

The engine must **not parse known-fact prose to determine location access**.

When another character discovers the location mechanically, normal grounded observations should tell that character what happened, so the model has narrative context in addition to the persistent mechanical access.

Discovery itself is not a belief and must not decay, consolidate, or disappear with memory maintenance.

Portable mind export/import must not transfer discovered locations.

## 2.3 Visibility and available actions

For a character who has not discovered a `requiresDiscovery` location:

- the secret location must not appear as an exit;
- moves into it must not appear in `available_actions`;
- the secret location must not appear as an otherwise reachable destination in structured model view;
- generic navigation helpers must treat it as unavailable.

For a character who has discovered it, the location behaves like an ordinary authored location.

The server/engine-side validator remains authoritative: manually constructing a move to an undiscovered location must be rejected even if UI filtering is bypassed.

## 2.4 Timelapse and pathfinding

All character-aware pathfinding, including daytime/nighttime timelapse routing, must respect discovery.

An undiscovered location:

- cannot be selected as a destination;
- cannot be used as an intermediate route or shortcut;
- must effectively not exist in that character's traversable graph.

This is required even when using the secret location would produce a shorter path between two ordinary locations.

Routing must be evaluated for the actual actor, not against one global world graph.

## 2.5 Off-screen secrecy / `Elsewhere`

Events occurring in a secret location that the Human-controlled character has not discovered must not be revealed through normal player-facing off-screen presentation.

This includes at least:

- `Elsewhere` output;
- current-tick off-screen event presentation;
- normal player-facing history generated from those hidden events;
- the `Show invisible events` gameplay toggle.

The invariant is:

> Undiscovered secret-location content must not be spoiled merely because the simulation continues off-screen.

If an event touches an undiscovered secret location and the Human is **not directly perceiving the hidden passage use**, suppress it from normal player-facing presentation.

Raw administrative artifacts such as emergency dumps may still contain canonical world state; they are diagnostic exports, not gameplay information surfaces.

## 2.6 Discovering a location by witnessing entry

A character can discover a secret location by directly observing another character enter it from a visible source location.

Required sequence:

1. Mover performs a validated move from an ordinary/discovered source into a secret destination.
2. Determine source-side perceivers using normal perception rules.
3. For each perceiver who has not discovered the destination:
   - add the destination location ID to that perceiver's discoveries;
   - then deliver the normal grounded movement observation.
4. The observation may now name the newly discovered destination normally.

This does **not** create omniscient discovery for off-screen characters.

For this update, the automatic witness rule is specifically based on **seeing someone enter the hidden location from the source side**. Do not broaden it into generic inference from arbitrary events.

## 2.7 Showing a hidden location to another character

Add one small reusable formal mechanism for intentionally revealing a hidden place.

Conceptually:

```text
show_hidden_location
```

The exact action name may follow project conventions.

Validation requirements:

- actor and target are present together;
- target is a character;
- actor has discovered the location;
- target has not discovered the location;
- the current location has an authored entrance to that secret location;
- the target can normally perceive the actor/action.

On success:

- target gains discovery of the secret location;
- target receives a grounded observation that the actor showed them the concealed path/location;
- no teleport occurs;
- neither character is automatically moved.

The action should be available to AI characters through normal formal-action generation when its conditions are met.

This is the mechanism Mara can use to reveal Trampled Glade to the Traveler.

Do not create a Trampled-Glade-specific action.

## 2.8 Save/load and migration

`discoveredLocationIds` is persisted world state.

On a fresh world:

```text
effective discoveries =
    authored initial discoveries
```

On save migration/load:

```text
effective discoveries =
    valid saved discoveries
    UNION
    current authored initial discoveries
```

Requirements:

- discard IDs that no longer correspond to valid authored locations;
- deduplicate IDs;
- preserve valid discoveries from old saves;
- old saves with no discovery field load normally;
- a character authored as initially knowing a secret location receives that discovery after migration even when loading an older save.

Safety invariant:

If a character is loaded while physically located inside a `requiresDiscovery` location, that location must be considered discovered for that character.

---

# 3. Trampled Glade

## 3.1 Authored location

Add a new secret location:

**Trampled Glade**

It is a normal top-level location with:

```text
requiresDiscovery = true
```

It has two authored entrances:

1. from the creek/stream behind Mara's garden;
2. from `Village Edge`.

Discovery of Trampled Glade reveals both entrances at once.

Do not add Chuhayster in this update.

Do not add a quest, arc state, summon trigger, special reward, or explanation for the clearing yet.

## 3.2 Environmental hook

The location description should establish a small unexplained mystery.

Use grounded physical details such as:

- grass heavily trampled in a rough circular area;
- dry twigs crushed underfoot;
- several small branches broken unusually high or with unusual force;
- signs that something or someone repeatedly moves energetically around the clearing.

Do not explicitly mention:

- Chuhayster;
- a monster;
- supernatural causes;
- dancing as a confirmed explanation.

The player should only see evidence.

## 3.3 Mara

Mara:

- has Trampled Glade in her authored initial discoveries;
- has an authored known fact that she knows the hidden clearing and how to reach it.

The known fact may note the trampled grass/broken branches, but it should not establish a canonical supernatural explanation.

Mara may reveal the clearing to the Traveler through the generic `show_hidden_location` action when they are together at one of its entrances.

No other existing character starts with Trampled Glade discovered unless explicitly required by later authoring.

## 3.4 Discovery while hunting squirrels

The Traveler may discover Trampled Glade while performing the existing daytime squirrel-hunting activity.

Rule:

- make **one** random discovery roll per successfully completed full squirrel-hunting day;
- chance: **10%**;
- do not roll once per timelapse round;
- do not roll if the Traveler has already discovered Trampled Glade.

On success:

- add Trampled Glade to the Traveler's discoveries;
- emit a grounded result/observation describing that during the hunt the Traveler noticed the broken branches, trampled ground, and a concealed way into the clearing;
- do not automatically move the Traveler into the clearing;
- subsequent normal navigation exposes both entrances.

The RNG must use the project's existing deterministic/injectable randomness mechanism where available so tests can force success/failure without flaky probability tests.

---

# 4. Non-Blocking Initial Weather

## 4.1 Goal

Creating a new world must no longer wait for IP geolocation/current-weather network work before showing the game.

The player should reach the playable game UI immediately while weather resolution continues asynchronously.

## 4.2 Startup flow

New-world startup becomes:

1. create/initialize canonical world state;
2. render the playable scene immediately;
3. display a temporary weather state such as `Checking current weather…`, or omit the final weather description while checking;
4. launch the existing current-weather resolution asynchronously;
5. if it succeeds while still applicable:
   - update canonical weather;
   - quietly rerender the scene/weather presentation;
6. if it fails while still applicable:
   - apply the same canonical fallback used by the normal new-tick-period weather mechanism;
   - quietly rerender.

There must not be a second separate fallback implementation for startup.

The shared weather resolution/fallback mechanism remains the single authority.

## 4.3 Stale-result protection

A slow startup request must not overwrite newer simulation state.

Associate the asynchronous startup weather attempt with the world/tick revision or an equivalent monotonic token.

If the player advances the simulation before the startup request resolves:

- the startup result is stale;
- do not apply it to the newer world period;
- do not emit an error to the player for discarding a stale result.

The normal weather update associated with the newer tick/period remains authoritative.

The exact revision/token implementation may follow existing engine structure.

## 4.4 Presentation

Completing the initial weather lookup is **not an in-world event**.

Do not add history such as:

```text
The weather suddenly changed.
```

Do not trigger AI reactions merely because startup weather data arrived.

It is completion of initialization/presentation of current conditions.

Network failure must not prevent play.

Loading an already initialized save must continue to use its saved canonical weather and must not perform an unnecessary startup refresh unless existing tick-period semantics independently require one.

---

# 5. Quick `Give gold`

## 5.1 Goal

Expose the existing formal gold-transfer mechanic as a convenient quick action.

Do not add a second gold-transfer engine path.

## 5.2 Visibility

Show a quick-action button:

**Give gold**

only when all are true:

- the Human-controlled character currently has at least 1 gold;
- at least one present/visible character is a currently valid recipient according to the existing formal action contract.

Otherwise hide the quick action rather than showing a disabled useless control.

## 5.3 Expanded UI

Clicking `Give gold` opens the same action-picker overlay pattern used by `Transfer items`.

The picker contains:

- recipient selector/list containing only valid present characters;
- integer amount control;
- confirmation button: `Give`.

Suggested amount behavior:

- minimum: `1`;
- maximum: current available gold;
- default: `1`;
- reject empty, zero, negative, non-integer, or over-balance values.

The UI must remain usable when more than one recipient is present.

Use the existing quick-action visual style and existing recipient-selection conventions where possible.

## 5.4 Execution

Picker confirmation constructs the existing formal `give_money` action and stores it as the currently selected action. It **must not execute the Human turn**.

The player may then add narrative/speech normally and starts the turn only through the existing main `Submit` control, exactly like a transfer selected through `Transfer items`.

When the eventual normal Submit executes the selected action, all existing behavior remains authoritative:

- validation;
- inventory/currency state changes;
- observations;
- perception;
- AI reactions;
- tick spending;
- failure behavior.

The quick control is presentation-only.

Do not directly mutate gold from UI code.

After picker confirmation:

- close the picker;
- render the selected `give_money` action through the normal action panel;
- do not mutate canonical gold and do not advance the turn.

After the later normal Submit succeeds, refresh available actions and balances through the ordinary turn flow.

---

# 6. Public / Private Profiles

These engine usability changes are shared behavior and must not create divergent simulation implementations between public and private builds.

The public canonical world receives Trampled Glade and Mara's related authored state.

If a local ignored private world exists, the implementation process should mirror the same Mallowstead world changes into it while preserving its private-only additions. The private world remains ignored and must not enter the public distribution.

No Chuhayster content is added to either profile in this update.

---

# 7. Non-Goals

This update explicitly does **not** implement:

- Chuhayster as a character;
- Chuhayster summoning;
- a generic quest/secret-arc state machine;
- secret items or resolution triggers;
- per-entrance discovery;
- automatic discovery from rumors alone;
- model-written discovery state;
- special XP/reward UI;
- quest log or `Secret discovered!` notifications;
- blocking startup weather;
- a second quick-gold engine implementation.

---

# 8. Required Tests

## 8.1 Discoverable locations

Add deterministic tests covering:

- undiscovered secret exit absent from character view;
- undiscovered secret destination absent from available move actions;
- validator rejects direct move to undiscovered secret location;
- discovery exposes all entrances to the location;
- different characters may have different discovery state;
- Mara starts with Trampled Glade discovered;
- another normal NPC does not;
- witnessing entry from the source side grants discovery before the movement observation is delivered;
- an off-screen character does not gain discovery;
- `show_hidden_location` validates actor/target/location/current entrance correctly;
- successful show action grants target discovery without moving either character;
- save/load preserves discoveries;
- legacy saves without the field migrate cleanly;
- authored initial discoveries are unioned into migrated saves;
- being loaded inside a hidden location repairs discovery.

## 8.2 Timelapse/pathfinding

Test that:

- undiscovered Trampled Glade is not usable as destination or intermediate route;
- discovered Trampled Glade may be routed normally;
- actor-specific routing differs when two characters have different discovery state.

## 8.3 Player secrecy

Test that:

- off-screen events entirely inside undiscovered Trampled Glade do not appear through `Elsewhere`;
- off-screen movement into/out of the undiscovered location does not leak its name to the Human;
- `Show invisible events` does not reveal undiscovered secret-location content;
- direct source-side observation of entry grants discovery and then permits normal presentation.

## 8.4 Squirrel hunting

Test with controlled RNG:

- failed roll does not discover;
- successful 10% roll discovers;
- exactly one discovery roll occurs per completed squirrel-hunting day;
- no further discovery rolls after location is already known;
- discovery result does not teleport the Traveler.

## 8.5 Startup weather

Test that:

- new-world playable UI is rendered before weather promise resolution;
- successful current weather applies asynchronously and rerenders;
- failed lookup uses the shared existing fallback;
- stale startup result is discarded after simulation revision advances;
- stale result does not create an error or in-world event;
- loading an initialized save does not perform unnecessary startup weather replacement.

## 8.6 Quick Give gold

Test that:

- quick action hidden with zero gold;
- hidden when there are no valid recipients;
- visible with gold plus at least one valid present recipient;
- recipient list contains only valid present/visible characters;
- invalid amounts cannot submit;
- amount above balance cannot submit;
- successful picker confirmation selects the existing `give_money` formal action without invoking `runHumanIntent` or advancing the turn;
- the main normal Submit is the only control that executes the selected gold transfer;
- UI does not mutate canonical gold directly.

---

# 9. Acceptance Criteria

The update is complete when:

1. A fresh player cannot see or route through Trampled Glade until discovering it.
2. Mara can mechanically access it from the start and can show it to the Traveler.
3. Watching someone enter the hidden location from the same source reveals it to the witness.
4. NPC timelapse cannot accidentally route through unknown secret places.
5. Human `Elsewhere` output cannot spoil unknown secret locations.
6. A completed squirrel-hunting day has one deterministic-testable 10% chance to reveal Trampled Glade.
7. Trampled Glade contains only environmental mystery hooks; Chuhayster does not yet exist.
8. New-game UI appears without waiting for the weather network request.
9. Weather later resolves quietly through the shared weather/fallback mechanism without allowing stale results to overwrite a newer period.
10. `Give gold` reuses the normal action-picker/selected-action flow: choosing recipient and amount does not spend a turn; only the main Submit executes the existing formal action.
11. Existing saves remain compatible.
12. Public/private builds continue to share engine behavior and the public distribution still excludes private-world data.
