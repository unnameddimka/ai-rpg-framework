# AI RPG Architecture — Framework-First Proof of Concept

## 1. Goal

Build a deterministic Twine/SugarCube game framework before connecting a language model.

Every character uses the same engine representation and the same formal action API. The difference between the player, an inactive NPC, and a future AI NPC is the controller assigned to that character.

The framework currently supports:

- the existing tavern locations and passages;
- objective shared world state;
- character and location inventories;
- taking, dropping, and giving items;
- wallets and giving money;
- movement through connected exits;
- confirmed world events;
- restricted character views;
- browser controls for manually testing every character.

Combat, trading, equipment, item effects, and model calls are outside the current milestone.

## 2. Core rule

The engine owns objective reality.

```text
Controller
    │ requests an intention
    ▼
CharacterAPI
    │
    ▼
ActionRegistry validation
    │
    ▼
Objective world mutation
    │
    ▼
Confirmed world event
```

No controller may directly change wallets, inventories, locations, or other protected state.

## 3. World state

The world is stored as a JSON-serializable object in `State.variables.world`.

It contains:

- `entities` — characters, locations, and items;
- `inventories` — inventories owned by characters and locations;
- `control.assignments` — controller IDs assigned to characters;
- `events` — confirmed event history and pending recipients;
- `debug` — last action result, controller logs, and repairs.

Functions and controller objects are kept in `setup`, not in SugarCube state.

## 4. Existing locations

The original map is preserved rather than replaced.

```text
tavernEntrance  → The Tavern
bar              → The Bar
commonRoom       → The Common Room
street           → The Street
```

Connections:

```text
                  bar
                   │
commonRoom ─ tavernEntrance ─ street
```

Close-up passages such as `Hooded Woman`, `Innkeeper Close-up`, and `Merchants` do not create additional physical locations.

A successful player-controlled `move` action updates the character's `locationId` and then the UI opens the destination location's passage.

NPC movement changes only that NPC's `locationId`; it does not inherently move another character or rewrite browser state.

## 5. Characters and controllers

Character entities contain physical state and a `defaultControllerId`.

```js
{
  id: "hoodedWoman",
  type: "character",
  name: "Hooded woman",
  locationId: "commonRoom",
  inventoryId: "inventory_hoodedWoman",
  wallet: 8,
  defaultControllerId: "dummy"
}
```

Controller assignment is stored separately:

```js
world.control.assignments = {
  player: "human",
  hoodedWoman: "dummy",
  innkeeper: "dummy"
};
```

### 5.1 HumanController

`human` receives decisions from the browser interface. It is not permanently tied to the entity named `player`.

The developer may take control of the hooded woman or innkeeper. All UI actions then use that character as the actor.

### 5.2 DummyController

`dummy` makes no autonomous decisions and requests no actions. It may acknowledge perceived events and write debug logs.

### 5.3 AIController

`ai` is reserved for a later milestone. The current shell returns a not-implemented result and does not call any model.

## 6. Exactly one HumanController

This is a hard world invariant:

```text
Exactly one character is assigned controllerId = "human".
```

Human control may be switched only through:

```js
setup.Game.takeHumanControl(characterId)
```

The operation is atomic:

1. copy the current assignment map;
2. return every current human assignment to that character's default controller;
3. assign `human` to the target character;
4. validate that the candidate map contains exactly one human;
5. commit the complete assignment map once.

Generic controller assignment rejects `human`, and it also rejects removing the only human assignment.

Initialization and loading validate the invariant. Invalid legacy or debug states are repaired to one human character, preferring `player` when no unambiguous previous human exists.

## 7. Inventories and items

Every item belongs to exactly one inventory.

```text
item.containerId == inventory.id
inventory.itemIds contains item.id
```

An inventory may belong to a character or location. Later it may belong to a chest or another container.

Current test items:

- mug of ale in the bar inventory;
- cleaning rag in the innkeeper's inventory.

Money remains a numeric wallet value rather than coin items.

## 8. Character API

All controllers use the same interface:

```js
setup.CharacterAPI = {
  getView(actorId),
  getAvailableActions(actorId),
  perform(actorId, action),
  narrate(actorId, input)
};
```

Controllers and UI code must not bypass it to mutate world state.

## 9. Formal actions

The first action registry contains:

```text
move
take_item
drop_item
give_item
give_money
```

Every action definition provides:

- description;
- serializable schema;
- current options;
- objective validation;
- execution code;
- confirmed event data.

Example:

```json
{
  "type": "give_item",
  "target_id": "hoodedWoman",
  "item_id": "beerMug"
}
```

Validation completes before execution. The framework snapshots state and restores it if execution throws or violates an item invariant.

## 10. Restricted character view

A controller receives a view for one actor, not the entire world.

The view contains:

- the actor's location, wallet, and inventory;
- nearby characters;
- items in the current location;
- directly connected exits;
- current action descriptions, schemas, and options.

It does not expose distant inventories, distant wallets, or distant items.

This same view will later become part of AI model input.

## 11. Events

Physical state changes happen immediately in world state after validation.

Events describe confirmed facts for perception and later subjective interpretation.

```js
{
  id: 12,
  type: "item_transferred",
  actorId: "player",
  targetId: "hoodedWoman",
  itemId: "beerMug",
  locationId: "commonRoom",
  recipients: ["hoodedWoman"],
  pendingFor: [],
  processedBy: ["hoodedWoman"]
}
```

Human and Dummy controllers currently acknowledge events immediately. A future AI controller may leave them pending until a successful model response processes them.

Narrative input also produces events, but it does not change protected physical state.

## 12. Dynamic location, interaction, and debug UI

The normal player-facing location screen is rendered dynamically from the world state of the one character currently controlled by `HumanController`.

Use one generic physical-location passage. The current physical location is determined by the controlled character's `locationId`, not by maintaining one hard-coded Twine passage per location.

The player-facing view contains:

- the current location name;
- base location prose stored on the location entity;
- public `presenceText` for every other character in the same location;
- one interaction link for every other character in the same location;
- one movement link for every currently connected exit.

The controlled character is excluded from nearby-character prose and interaction targets. This remains true after debug takeover; the UI must never assume the controlled actor is the entity named `player`.

Movement links do not navigate directly between physical Twine passages. They request the registered `move` action through `CharacterAPI`, and the generic location screen rerenders only after successful validation and world mutation.

Interaction uses one generic interaction surface. The selected target is UI state and must be revalidated against current location state before rendering.

The current action/API panel remains below the player-facing view as a developer debug interface. Both normal links and debug controls call the same `CharacterAPI`; there are no separate gameplay rules in the UI.

Dynamic UI requirements and acceptance scenarios are specified in:

```text
docs/task-dynamic-location-ui.md
```

## 13. Source organization

```text
src/story.twee          passages and prose
src/10-game-api.js      world, actions, CharacterAPI, invariants
src/20-controllers.js   Human, Dummy, future AI shell
src/30-game-ui.js       browser and debug controls
src/styles.css          UI styling
```

The numeric prefixes make JavaScript load order explicit for Tweego.

## 14. Development order

### Phase 1 — framework

Implemented now:

- world state;
- existing locations;
- inventories and wallets;
- action registry;
- character API;
- events;
- restricted views;
- Human and Dummy controllers;
- debug character takeover;
- exactly-one-human invariant.

### Phase 2 — browser validation

Build with Tweego, run in a browser, and verify all controls and SugarCube save/load behaviour.

### Phase 3 — perception and subjective state

Add per-character memories, attitudes, and robust pending-event processing without a model first where possible.

### Phase 4 — AI controller

Add model request construction and structured output. The model receives the restricted view and action schemas, and all returned actions still pass through `CharacterAPI.perform()`.

### Phase 5 — expansion

Possible later systems:

- jobs and rewards;
- buying and selling;
- item use;
- doors and locks;
- character-specific capabilities;
- reputation interpreted by the model;
- combat as a separate subsystem.

## 15. Final summary

### Sublocation spatial layer

Spatial authoring data lives in `data/world.json` (schema version 1). The standalone editor
imports and exports that file without accessing the repository. During administrator builds,
`tools/generate-world-data.ps1` creates derived `src/generated/world-data.js` and mount-only
physical passages. The browser game never fetches external JSON at runtime.

Major locations remain the four physical SugarCube passages. Characters also carry a
`sublocationId`, which identifies their objective position within the major location.

Stable sublocation IDs:

- `tavernEntranceFloor`
- `barPublicSide`
- `barBehindCounter`
- `commonRoomFloor`
- `commonRoomTableOne`
- `commonRoomTableTwo`
- `streetCenter`

Sublocations declare capacity, legal/reachable neighboring positions, presentation text,
optional inventories, and optional capabilities. The behind-bar position supplies
`pour_ale`; both common-room tables own distinct inventories.

`move` changes major location and assigns its default sublocation. It emits separate
`character_left_location` and `character_entered_location` events so perception is scoped
to the correct origin and destination. `move_within_location` changes only sublocation and
does not navigate to another passage.

`drop_item` places an item in the general major-location inventory. `place_item` places an
item on the accessible surface at the actor's current sublocation. Public perception is
major-location-wide, while physical transfers and surface access obey sublocation
reachability.

```text
                    World State
       characters, locations, items, money
                          ▲
                          │ validated mutation
                          │
                    CharacterAPI
        getView / getAvailableActions / perform
                          ▲
                          │
          ┌───────────────┼───────────────┐
          │               │               │
 HumanController   DummyController   AIController
 browser input      no autonomous     later model
                        actions
          └───────────────┼───────────────┘
                          │
                          ▼
                   ActionRegistry
              validate → execute → event
```

The engine determines objective facts. Controllers choose intentions. Exactly one character is controlled by the human interface. The future model remains a controller rather than an authority over world state.
