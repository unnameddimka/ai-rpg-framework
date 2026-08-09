# Codex Task — Sublocations, Accessibility, Table Inventories, and Pouring Ale

## Goal

Add a second spatial layer inside major Twine locations.

Major locations remain Twine passages. Sublocations are JavaScript world-state positions inside those passages.

The task must support:

- standing behind the bar;
- the innkeeper starting behind the bar;
- pouring ale only while behind the bar;
- generating unique mugs of ale in the performing character's inventory;
- two tables in the common room;
- table inventories representing items placed on each tabletop;
- sitting at a table;
- taking tabletop items only when the actor is at that table;
- dynamic location prose showing where other characters are standing or sitting;
- public event visibility limited to the major location/passage.

Do not implement AI, combat, trading, theft rules, finite ale stock, or autonomous NPC turns.

---

## 1. Spatial model

A character has two spatial identifiers:

```js
{
  locationId: "commonRoom",
  sublocationId: "commonRoomTableOne"
}
```

`locationId` identifies the major room and its Twine passage.

`sublocationId` identifies the character's current position inside that room.

Hard invariant:

```text
world.entities[character.sublocationId].locationId === character.locationId
```

Every major location must define a default sublocation:

```js
{
  id: "commonRoom",
  type: "location",
  passage: "The Common Room",
  defaultSublocationId: "commonRoomFloor"
}
```

When a character moves between major locations, the registered `move` action must assign the destination's `defaultSublocationId`.

Do not preserve an old sublocation across passage movement.

---

## 2. Major locations remain passages

Use the existing major physical passages:

```text
The Tavern
The Bar
The Common Room
The Street
```

Each corresponds to one major world location:

```text
tavernEntrance
bar
commonRoom
street
```

This task supersedes the previous "one generic physical-location passage" decision.

Passages should contain only stable structure or a common rendering macro/mount point. Mutable prose and links must still come from world state.

Example passage body:

```text
:: The Common Room
<<locationView>>
```

or an equivalent stable mount point.

A successful major `move` action updates world state first and only then opens the destination location's passage.

Sublocation movement never opens another passage.

---

## 3. Initial sublocations

Create at least these sublocations.

### Tavern entrance

```text
tavernEntranceFloor
```

Default position for the entrance.

### Bar

```text
barPublicSide
barBehindCounter
```

- `barPublicSide` is the default bar position.
- `barBehindCounter` represents standing behind the bar.
- The innkeeper starts at `barBehindCounter`.
- `barBehindCounter` provides the `pour_ale` capability.
- `barPublicSide` and `barBehindCounter` may be marked mutually reachable across the counter for direct interaction, but this must be explicit data rather than a hard-coded actor exception.

### Common room

```text
commonRoomFloor
commonRoomTableOne
commonRoomTableTwo
```

- `commonRoomFloor` is the default position.
- `commonRoomTableOne` and `commonRoomTableTwo` represent sitting at separate tables.
- Each table sublocation owns a separate inventory.
- The hooded woman may start at `commonRoomTableOne`.

### Street

```text
streetCenter
```

Default street position.

Exact IDs may differ, but use stable IDs and document them.

---

## 4. Recommended sublocation data

Use JSON-serializable world data.

A suitable first-version shape is:

```js
{
  id: "commonRoomTableOne",
  type: "sublocation",
  locationId: "commonRoom",
  name: "First table",
  enterLabel: "Sit at the first table",
  selfText: "You are sitting at the first table.",
  occupantTemplate: "{name} sits at the first table.",
  capacity: 4,
  inventoryId: "inventory_commonRoomTableOne",
  reachableSublocationIds: ["commonRoomTableOne"]
}
```

Behind the bar may expose a capability:

```js
{
  id: "barBehindCounter",
  type: "sublocation",
  locationId: "bar",
  name: "Behind the bar",
  enterLabel: "Step behind the bar",
  selfText: "You are standing behind the bar.",
  occupantTemplate: "{name} stands behind the bar.",
  capacity: 2,
  capabilities: ["pour_ale"],
  reachableSublocationIds: [
    "barBehindCounter",
    "barPublicSide"
  ]
}
```

The exact field names may differ. Preserve the concepts:

- parent major location;
- player-facing position text;
- capacity;
- reachable sublocations;
- optional inventory;
- optional capabilities.

Avoid storing executable functions in world state.

---

## 5. Perception, reachability, and capability are separate

### Public perception

For the current proof of concept, a public event is perceived by other characters whose `locationId` equals the event's `locationId`.

Sublocation does not limit public visibility yet.

Examples visible throughout the bar passage:

- someone steps behind the bar;
- someone pours ale;
- someone takes a mug;
- someone gives another character money;
- someone speaks publicly.

Examples visible throughout the common-room passage:

- someone sits at a table;
- someone places a mug on a table;
- someone takes the mug from the table.

Characters in another passage do not receive these events.

### Physical reachability

Being visible does not mean being reachable.

A character may physically manipulate only:

- their own inventory;
- inventories exposed by their current sublocation;
- characters in the same or explicitly reachable sublocation;
- other objects explicitly reachable from the current sublocation.

### Capability availability

A special action is available only when the actor's current sublocation provides the required capability.

For example, `pour_ale` is available behind the bar and unavailable at the public side, entrance, common room, and street.

---

## 6. Internal movement action

Add a formal registered action:

```json
{
  "type": "move_within_location",
  "destination_id": "barBehindCounter"
}
```

Validation must confirm:

- actor exists and is a character;
- destination exists and is a sublocation;
- destination belongs to the actor's current major location;
- destination is a legal transition from the current sublocation;
- destination has available capacity;
- actor is not already there.

Execution must:

- update only `actor.sublocationId`;
- leave `actor.locationId` unchanged;
- create a confirmed public event in the current major location;
- not navigate to another Twine passage;
- rerender the current passage UI.

Suggested event:

```js
{
  type: "character_changed_sublocation",
  actorId,
  locationId,
  fromSublocationId,
  toSublocationId
}
```

---

## 7. Major movement action

Keep `move` for passage-to-passage travel.

On success it must:

1. validate the connected major destination;
2. update `actor.locationId`;
3. set `actor.sublocationId` to the destination location's `defaultSublocationId`;
4. create confirmed movement event data;
5. navigate the browser only when the moved actor is the human-controlled character.

For perception correctness, prefer two public events:

```text
character_left_location     visible in the origin passage
character_entered_location  visible in the destination passage
```

If the existing engine retains one movement event, its recipient calculation must still avoid leaking the event to unrelated passages. Document the chosen solution and test it.

---

## 8. Pouring ale

Add a registered formal action:

```json
{
  "type": "pour_ale"
}
```

Validation must confirm:

- actor is a valid character;
- actor's current sublocation provides `pour_ale`;
- actor has a valid inventory;
- generated item insertion will preserve item invariants.

For this proof of concept, ale supply may be infinite.

Execution must:

1. generate a unique item ID;
2. create a new mug-of-ale item entity;
3. put it directly into the performing character's inventory;
4. update the item's `containerId` consistently;
5. produce a public event in the bar passage.

Example generated entity:

```js
{
  id: "mugOfAle_17",
  type: "item",
  templateId: "mugOfAle",
  name: "Mug of ale",
  containerId: "inventory_innkeeper"
}
```

Do not reuse one singleton mug entity.

Two consecutive successful pours must produce two distinct mugs.

Suggested event:

```js
{
  type: "ale_poured",
  actorId,
  itemId,
  locationId: "bar",
  sublocationId: "barBehindCounter"
}
```

The action must not be implemented by narrative text, direct UI mutation, or a bartender-specific exception.

Any character who legally occupies the behind-bar sublocation may pour ale.

---

## 9. Table inventories

Each common-room table owns a separate inventory:

```text
inventory_commonRoomTableOne
inventory_commonRoomTableTwo
```

A mug placed on table one must not appear on table two or in the general common-room floor inventory.

### Placing an item

Add a formal action such as:

```json
{
  "type": "place_item",
  "item_id": "mugOfAle_17",
  "target_inventory_id": "inventory_commonRoomTableOne"
}
```

Validation must confirm:

- actor owns the item;
- target inventory exists;
- target inventory is exposed by the actor's current sublocation;
- actor is currently at the corresponding table;
- item transfer preserves invariants.

Execution transfers the item and creates a public event in the common-room passage.

### Taking an item

Generalize `take_item` so that it may take items from any inventory accessible from the actor's current sublocation, not only from the major location's floor inventory.

A character at table one can take items from table one's inventory.

A character:

- at table two;
- on the common-room floor;
- in another passage;

cannot take an item from table one.

Do not implement this restriction only by hiding a UI link. Engine validation must reject an invalid direct API call.

### Existing `drop_item`

Keep `drop_item` for placing an owned item into the major location's floor/default inventory, unless the current implementation has a clearer compatible meaning.

Document the distinction:

```text
drop_item  → floor/general location inventory
place_item → selected accessible surface/container
```

---

## 10. Reachable characters

Add a reusable engine helper or equivalent logic:

```js
canReachCharacter(actorId, targetId, world)
```

For the first version, a target is reachable when:

- both characters are in the same major location; and
- the target's sublocation is either the actor's own sublocation or is listed in the actor sublocation's `reachableSublocationIds`.

Use this rule for physical direct-transfer actions such as:

- `give_item`;
- `give_money` if money is treated as a hand-to-hand transfer.

The bar public side and behind-counter positions may explicitly reach each other across the counter.

Characters at the same table are reachable to one another.

Do not use character identity or role as a special case.

---

## 11. Restricted character view

Extend `CharacterAPI.getView(actorId)` without exposing the complete world.

The view should include enough public and actionable information for browser UI and a future AI controller:

```js
{
  self: {
    id,
    location_id,
    sublocation_id,
    position_text,
    inventory
  },
  location: {
    id,
    name,
    passage,
    description,
    sublocations,
    characters,
    exits
  },
  accessible_inventories: [...],
  available_actions: {...}
}
```

Nearby characters may be visible anywhere in the passage, but each must include public position information derived from its current sublocation.

Example:

```js
{
  id: "innkeeper",
  name: "The innkeeper",
  sublocation_id: "barBehindCounter",
  position_text: "The innkeeper stands behind the bar.",
  reachable: true
}
```

Do not expose:

- inaccessible inventory contents;
- distant passage contents;
- private memories;
- controller internals;
- hidden future state.

---

## 12. Dynamic player-facing prose

The player-facing description of a passage must be assembled from:

1. the major location's base prose;
2. public descriptions of relevant fixed sublocations or furniture;
3. the controlled character's own current-position text;
4. every other present character's public description and current-position phrase.

The controlled actor must not be listed as another occupant.

Example while controlling the player on the public side of the bar:

```text
The Bar

The dark counter is polished smooth by years of elbows and spilled drink.

You are standing on the public side of the counter.

The innkeeper stands behind the bar.

[Speak with the innkeeper]
[Step behind the bar]
[Return to the tavern entrance]
```

After taking human control of the innkeeper:

```text
You are standing behind the bar.
```

The innkeeper's own third-person presence line and self-interaction link must disappear.

If another character moves behind the bar, their position description must update from world state without editing passage text.

For character presentation, prefer a composition such as:

```text
public character name + sublocation occupant phrase
```

Do not keep posture such as "sits at the first table" permanently hard-coded into a character's static description.

---

## 13. Normal UI actions

The normal passage UI should dynamically render:

- legal internal-position links;
- legal major exit links;
- nearby-character interaction links;
- special capability links such as `Pour a mug of ale`;
- accessible container contents;
- legal `Take` and `Place` actions where suitable.

Every link must call the same registered engine actions used by the debug panel.

Examples:

```text
[Step behind the bar]
[Pour a mug of ale]
[Sit at the first table]
[Place Mug of ale on the first table]
[Take Mug of ale from the first table]
```

The debug/API table remains below the player-facing view.

Do not duplicate validation rules in rendering code. The UI should render from `available_actions` and engine-produced options.

---

## 14. Public event recipients

Update or verify event-recipient calculation.

For an ordinary public event with:

```js
locationId: "commonRoom"
```

recipients are other characters currently in `commonRoom`, regardless of table/floor sublocation.

Characters in `bar`, `tavernEntrance`, or `street` are not recipients.

Record the event's occurrence location at execution time. Recipient determination must not later change merely because the actor moves away.

Hidden/private events remain outside this task except where already implemented.

---

## 15. World validation

Extend `setup.Game.validateWorld()` or equivalent validation.

It must verify:

- exactly one HumanController;
- every character has a valid major location;
- every character has a valid sublocation;
- every character's sublocation belongs to their major location;
- every location has a valid default sublocation;
- every sublocation references a valid parent location;
- sublocation occupancy does not exceed capacity;
- every sublocation inventory exists when referenced;
- every item belongs to exactly one inventory;
- every item's `containerId` and containing inventory agree;
- all reachable-sublocation references are valid and belong to the same major location;
- generated item IDs are unique.

A failed action must not leave a partially changed world.

---

## 16. Required tests

Add Node tests covering at least these scenarios.

### Sublocation initialization

- Player starts in the entrance default sublocation.
- Innkeeper starts behind the bar.
- Hooded woman starts at one common-room table.
- All character sublocations belong to their major locations.

### Internal movement

- Player moves from bar public side to behind the bar.
- `locationId` remains `bar`.
- `sublocationId` changes.
- No passage-to-passage movement occurs.
- Capacity prevents illegal entry when full.

### Major movement

- Moving to another major location assigns its default sublocation.
- The human-controlled actor's browser passage follows successful world movement.
- A Dummy-controlled character can move without forcing browser navigation.

### Pouring ale

- Innkeeper may pour ale from behind the bar.
- Player may pour ale after legally moving behind the bar.
- Pouring fails from the public side and from other passages.
- Two pours create two unique items.
- Each generated mug appears in the actor's inventory.
- Item invariants remain valid.

### Table inventory

- A character at table one may place a mug into table one's inventory.
- A second character at table one may take it.
- A character at table two cannot take it.
- A character on the common-room floor cannot take it.
- A character in another passage cannot take it.
- Invalid direct API calls fail without moving the item.

### Dynamic presence

- Other characters' prose reflects their current sublocation.
- A seated character is described as seated at the correct table.
- A character behind the bar is described behind the bar.
- The human-controlled actor is not rendered as another occupant.
- Human takeover changes first-person and third-person rendering correctly.

### Visibility

- Public table and bar events are delivered to characters in the same major location.
- The same events are not delivered to characters in other passages.
- Sublocation differences do not block public perception in this version.

### Regression

- Exactly one HumanController remains enforced.
- Existing inventories, money transfer, item giving, debug panel, reset, and save/load behaviour continue to work.

---

## 17. Completion criteria

The task is complete when:

- major rooms remain Twine passages;
- sublocations exist only in world/JavaScript state;
- character position is objective engine state;
- normal UI and debug UI derive action availability from the same registry;
- the innkeeper begins behind the bar;
- any legal occupant behind the bar can pour multiple unique mugs;
- two common-room tables maintain distinct inventories;
- only occupants of a table can manipulate its tabletop inventory;
- other characters' standing/sitting positions appear dynamically in passage prose;
- public event visibility is limited to the major passage;
- all tests and world invariants pass;
- no AI, combat, trading, or autonomous NPC logic is introduced.
