# Codex Task — Dynamic Location and Interaction UI

## Goal

Replace the current hard-coded physical location prose and links with a dynamic player-facing location view rendered from the current world state.

The existing API/action table remains a developer debug interface below the player-facing view.

Do not implement AI, combat, trading, or autonomous NPC behaviour in this task.

---

## Required user-facing behaviour

The main location screen must be generated from the character currently controlled by `HumanController`.

It must show:

1. the current location name;
2. the current location's base description;
3. a visible presence paragraph for every other character currently in that location;
4. a dynamic interaction link for every other character currently in that location;
5. a dynamic movement link for every connected exit;
6. the existing debug/API panel below the player-facing content.

The rendered result must always reflect the current `World` state. Do not keep a second hard-coded list of exits or characters in `story.twee`.

---

## Architectural decision: one generic physical-location passage

Use one generic SugarCube passage for all physical locations, for example:

```text
Location
```

A physical location is identified by the controlled character's `locationId`, not by the name of the currently open Twine passage.

The generic passage should contain only stable mount points or macros, for example:

```html
<div id="location-view"></div>
<div id="framework-action-panel"></div>
```

`setup.GameUI.renderLocationView()` must populate the player-facing location view from:

```js
setup.CharacterAPI.getView(setup.Game.getHumanCharacterId())
```

The old physical passages may be removed, converted into non-physical narrative passages, or temporarily retained but unused. There must be only one active rendering path for physical locations.

Close-up interaction should also be generic rather than requiring one passage per NPC. A single passage such as `Character Interaction`, or an inline interaction panel, may be used.

---

## World presentation data

Location prose must live in world data rather than in hard-coded passage bodies.

Each location entity should expose player-facing presentation data similar to:

```js
{
  id: "bar",
  type: "location",
  name: "The Bar",
  description: [
    "The bar counter is dark with age and spilled ale.",
    "Shelves of mismatched bottles line the wall behind it."
  ],
  exits: {
    tavernEntrance: "tavernEntrance"
  }
}
```

`description` may be a string or an array of paragraphs, but the representation must be consistent across all locations.

Each character must expose only public presentation information suitable for another character in the same room. Use a simple explicit prose field for the first version, for example:

```js
{
  id: "innkeeper",
  type: "character",
  name: "Innkeeper",
  locationId: "bar",
  presenceText: "The innkeeper stands behind the counter, wiping a wooden mug with a worn cloth."
}
```

```js
{
  id: "hoodedWoman",
  type: "character",
  name: "Hooded woman",
  locationId: "commonRoom",
  presenceText: "A hooded woman sits near the fire, watching the room from beneath the edge of her hood."
}
```

For this task, `presenceText` is static world state. Later actions or AI may change it, but do not implement that system now.

Do not expose private memories, hidden inventory contents, controller internals, or other debug data in the player-facing location description.

---

## Dynamic character presence

The controlled character must never be rendered as another person present in the room.

For every other character whose `locationId` matches the controlled character's `locationId`:

- append that character's `presenceText` to the location description;
- render an interaction link using that character's public name;
- store/use the character ID as the target, never the display name.

Example while controlling `player` in the bar:

```text
The Bar

The bar counter is dark with age and spilled ale.

The innkeeper stands behind the counter, wiping a wooden mug with a worn cloth.

[Speak with the innkeeper]
[Return to the tavern entrance]
```

Example after taking human control of `innkeeper` in the same world state:

- do not show the innkeeper's own `presenceText`;
- do not show a link to speak with the innkeeper;
- show links for any other characters currently in the bar.

If the hooded woman moves into the bar, her presence paragraph and interaction link must appear immediately on the next render without editing `story.twee`.

If a character leaves, their paragraph and interaction link must disappear.

---

## Dynamic interaction links

Interaction links are generated from nearby characters in the restricted character view.

The link label may use a field such as `interactionLabel`, with a fallback:

```text
Speak with {character.name}
```

Activating an interaction link must select the target character by ID and open one generic interaction surface.

A minimal first version may show:

- target name;
- target public description/presence text;
- a Back link to the generic location passage;
- the existing narrative/formal debug controls filtered or preselected for that target where practical.

Do not create or preserve hard-coded NPC-specific links such as:

```text
[[Speak with the innkeeper->Innkeeper Close-up]]
```

Do not show interaction links for:

- the controlled character itself;
- characters in another location;
- non-character entities.

The selected interaction target is UI state, not objective world state. Keep it JSON-serializable if stored in `State.variables`.

Before rendering an interaction screen, validate that the target still exists and remains in the same location as the controlled character. If not, return to the generic location screen with a clear result instead of showing stale interaction data.

---

## Dynamic movement links

All movement links must be generated from the current location's exits in the restricted character view.

A movement link must call:

```js
setup.CharacterAPI.perform(actorId, {
  type: "move",
  destination_id: destinationId
})
```

or an existing `setup.GameUI.moveHuman(destinationId)` wrapper that performs exactly that API call.

Never navigate directly to another physical location with a raw Twine link such as:

```text
[[Return to the entrance->The Tavern]]
```

Required sequence:

1. determine the one human-controlled actor;
2. request the registered `move` action;
3. let `ActionRegistry` validate and mutate the world;
4. on success, open or rerender the generic `Location` passage;
5. on failure, remain in place and show the action result in debug output.

The browser passage must follow world state; browser navigation must not create world state.

---

## Rendering responsibilities

Add or adapt UI functions with responsibilities equivalent to:

```js
setup.GameUI.renderLocationView()
setup.GameUI.openInteraction(targetId)
setup.GameUI.renderInteractionView()
setup.GameUI.moveHuman(destinationId)
```

Exact names may differ, but keep player-facing rendering separate from the existing debug action panel.

Recommended render order:

```text
location heading
base location prose
nearby-character presence prose
interaction links
movement links
separator
existing debug/API panel
```

Re-render player-facing content after:

- passage display;
- successful movement;
- human-control takeover;
- world reset;
- any successful action that may alter character locations or visible presence data.

Avoid duplicate click handlers after repeated renders. Clear and rebuild the mount point, or use delegated event handlers with stable selectors and `data-*` IDs.

All text inserted from world data must be rendered safely. Do not concatenate untrusted model text into executable HTML. For current static prose, prefer DOM text APIs or explicit escaping helpers.

---

## Relationship to the debug/API table

The current action table is not the normal game interface. Treat it as a debug representation of `CharacterAPI`.

Preserve it below the player-facing location content.

The dynamic movement and interaction links are the normal game UI, but they must call the same engine APIs as the debug table.

There must not be separate gameplay rules for links and debug controls.

Example:

```text
Player-facing [Go to the bar]
            │
            └── CharacterAPI.perform(... move ...)

Debug move button
            │
            └── CharacterAPI.perform(... move ...)
```

---

## Required initial content

Preserve the existing physical map:

```text
bar
  │
commonRoom ─ tavernEntrance ─ street
```

Provide base dynamic descriptions for:

- `tavernEntrance`;
- `bar`;
- `commonRoom`;
- `street`.

Provide `presenceText` for at least:

- `innkeeper`;
- `hoodedWoman`;
- `player` so the player entity also has a public description when another character is human-controlled.

Merchants currently represented only by prose are not required to become character entities in this task. They may remain part of the common-room base description until deliberately modelled as entities.

---

## Controller invariant

Preserve the existing hard invariant:

```text
Exactly one character is controlled by HumanController.
```

The location view must always derive its actor from:

```js
setup.Game.getHumanCharacterId()
```

Do not assume that the human-controlled actor has ID `player`.

After `setup.Game.takeHumanControl(characterId)`:

- the new controlled character's location is shown;
- self-interaction disappears for that character;
- the old controlled character may appear as a nearby character if physically present;
- all normal links act as the new controlled character.

---

## Acceptance tests

Add or update tests where practical. At minimum, manually verify all scenarios below in the built browser game.

### Scenario 1 — player at tavern entrance

Expected:

- tavern entrance base description is visible;
- exit links are generated from world exits;
- no hard-coded bar/common-room/street navigation is required;
- the debug table remains below.

### Scenario 2 — player enters the bar

Expected:

- movement is executed through `CharacterAPI.perform(... move ...)`;
- controlled character `locationId` becomes `bar`;
- bar base description is rendered;
- innkeeper `presenceText` is rendered;
- interaction link targets `innkeeper`;
- no self-interaction link is present.

### Scenario 3 — take control of innkeeper

Expected:

- exactly one `human` assignment still exists;
- the bar remains the visible location;
- innkeeper presence text and self-interaction link disappear;
- if `player` is in the bar, the player's public presence and interaction link appear;
- all movement/actions now use `innkeeper` as actor.

### Scenario 4 — another character enters

Move the hooded woman into the bar using the debug API.

Expected on rerender:

- hooded woman presence text appears;
- interaction link to `hoodedWoman` appears;
- no story passage source change is needed.

### Scenario 5 — character leaves

Move the hooded woman out of the bar.

Expected:

- presence text disappears;
- interaction link disappears;
- a previously open interaction target is rejected as stale.

### Scenario 6 — invalid direct navigation

Verify that normal physical movement cannot be achieved through a raw physical Twine link that bypasses `move` validation.

### Scenario 7 — reset and save/load

Expected:

- reset returns the world and dynamic location view to initial state;
- SugarCube save/load restores location, one-human assignment, and selected UI state without duplicating handlers or showing stale content.

---

## Non-goals

Do not implement in this task:

- AI/model requests;
- autonomous turns;
- dialogue generation;
- memories or attitudes;
- combat;
- buying/selling;
- detailed coordinates inside a location;
- posture-changing actions;
- procedural prose generation;
- converting merchants into full character entities unless required for a small cleanup.

---

## Validation before completion

1. Run `node --check` on all JavaScript files.
2. Run `node tests/run-tests.js`.
3. Build with `build.bat`/Tweego.
4. Open `dist/game.html` and manually execute the acceptance scenarios.
5. Confirm `setup.Game.validateWorld()` succeeds after movement and controller takeover.
6. Confirm there is exactly one HumanController after every tested operation.
7. Update `docs/status.md` with what was implemented and any known limitations.
