# AI RPG Architecture — Deterministic Character Foundation

## 1. Goal

Build a deterministic Twine/SugarCube RPG framework that can later supply a stateless language model with everything required to behave as one specific character.

The model is not part of the current milestone. The current milestone prepares:

- authorable characters;
- separate public and AI-private descriptions;
- individual formal abilities;
- objective action feedback;
- per-character saved mind state;
- restricted future-controller context.

The engine remains the authority over objective reality.

## 2. Main separation

```text
Authoring data in world.json
        │ new game initialization
        ▼
Deterministic runtime world in SugarCube state
        │ restricted projection
        ▼
Human / Dummy / future AI controller
        │ intention
        ▼
CharacterAPI.perform()
        │ validation and execution
        ▼
World mutation + events + private feedback
        │
        └──► character mind.pendingObservations
```

Free narrative is a separate channel:

```text
Narrative text
    may describe speech, gestures, or attempts
    does not itself mutate protected state
    does not itself reveal hidden facts
```

## 3. Authoritative world document

`data/world.json` becomes the authoring source for:

- `startLocationId`;
- major locations;
- sublocations;
- character definitions;
- character initial minds;
- individual ability definitions;
- protected IDs used by the authoring workflow.

The document uses `schemaVersion: 2`.

Conceptual shape:

```json
{
  "schemaVersion": 2,
  "startLocationId": "tavernEntrance",
  "locations": {},
  "characters": {},
  "abilities": {}
}
```

Generated JavaScript, generated Twee passages, generated StoryData, and the built game HTML are derived artifacts.

## 4. Major locations and generated passages

Every major physical location has its own generated Twine passage.

```text
tavernEntrance  → The Tavern
bar              → The Bar
commonRoom       → The Common Room
street           → The Street
```

The build generator must:

1. validate unique passage names;
2. validate `startLocationId`;
3. generate one physical passage per location;
4. generate SugarCube `StoryData.start` from the start location's passage.

The obsolete generic-location-passage design is not authoritative.

Internal sublocations remain runtime entities rather than passages.

## 5. Character authoring definition

A character definition contains authored starting data rather than mutable runtime state.

Example:

```json
{
  "id": "hoodedWoman",
  "name": "Hooded woman",
  "playerDescription": "A pale woman in a travel-stained dark cloak watches the room from beneath her hood.",
  "interactionLabel": "Speak with the hooded woman",
  "aiDescription": "You are Mara, a secretive hedge witch. You conceal your abilities and distrust authority.",
  "locationId": "commonRoom",
  "sublocationId": "commonRoomTableOne",
  "inventoryId": "inventory_hoodedWoman",
  "wallet": 8,
  "initialControllerId": "dummy",
  "defaultControllerId": "dummy",
  "abilityIds": ["readAura"],
  "engineFacts": {
    "aura": "A quiet, disciplined magical presence surrounds her."
  },
  "initialMind": {
    "knownFacts": [],
    "beliefs": [],
    "relationships": [],
    "recentMemories": [],
    "longTermMemories": []
  }
}
```

### 5.1 Public and private descriptions

`playerDescription` is public prose used in normal player-facing views.

`aiDescription` is private controller identity data. It may later be supplied only to the AI controller of that same character.

`engineFacts` contains hidden objective values used by mechanics. It is not a prompt and must not appear in unrestricted dumps or other characters' views.

## 6. Runtime character state

At new-game initialization, the engine deep-copies character authoring definitions into runtime entities.

The runtime character owns physical state and mind state:

```js
{
  id: "hoodedWoman",
  type: "character",
  name: "Hooded woman",
  playerDescription: "...",
  aiDescription: "...",
  engineFacts: { aura: "..." },
  locationId: "commonRoom",
  sublocationId: "commonRoomTableOne",
  inventoryId: "inventory_hoodedWoman",
  wallet: 8,
  defaultControllerId: "dummy",
  abilityIds: ["readAura"],
  mind: {
    knownFacts: [],
    beliefs: [],
    relationships: [],
    recentMemories: [],
    longTermMemories: [],
    pendingObservations: []
  }
}
```

The mind belongs to the character. Switching the character between `human`, `dummy`, and future `ai` controllers does not replace or reset it.

Because the character lives in `State.variables.world`, normal SugarCube saves carry the mind with the world.

## 7. Initial mind record shapes

The data is structured but intentionally simple.

### Known facts

```json
{
  "id": "fact_arrival_reason",
  "text": "You came to the tavern looking for information."
}
```

### Beliefs

```json
{
  "id": "belief_guard_interest",
  "text": "The town guard may be watching travellers who ask about magic.",
  "confidence": "medium"
}
```

### Relationships

```json
{
  "targetCharacterId": "player",
  "summary": "You do not know this traveller yet."
}
```

### Memories

```json
{
  "id": "memory_old_mentor",
  "summary": "Your former mentor warned you never to reveal your gift to officials.",
  "importance": 0.9,
  "protected": true
}
```

`recentMemories` and `longTermMemories` use the same shape. Their future compression policy is outside this milestone.

## 8. Pending observations

`pendingObservations` contains objective information delivered to one character but not yet interpreted by a future AI controller.

Example event observation:

```json
{
  "id": 14,
  "kind": "event",
  "sourceEventId": 8,
  "turn": 23,
  "actorId": "player",
  "targetId": "hoodedWoman",
  "text": "The traveller gave you a mug of ale.",
  "data": {
    "itemId": "aleMug_4"
  }
}
```

Example action-feedback observation:

```json
{
  "id": 15,
  "kind": "action_feedback",
  "actionType": "read_aura",
  "turn": 24,
  "text": "You sense a faint necromantic residue around the traveller.",
  "data": {
    "targetId": "player",
    "factKey": "aura"
  }
}
```

The deterministic engine may enqueue observations. It must not automatically decide what the character believes or how relationships change.

## 9. Abilities and executable actions

An ability is authored metadata that grants one existing engine action to specific characters.

```json
{
  "id": "readAura",
  "name": "Read aura",
  "actionType": "read_aura",
  "playerDescription": "Sense supernatural traces around a visible character.",
  "aiDescription": "Use this formal action to request private engine-grounded aura information. Never invent the result before the engine returns it."
}
```

Ability definitions do not contain JavaScript, mutations, conditions, or effect scripts.

The `actionType` must correspond to a registered `ActionRegistry` definition.

## 10. Formal action availability

The action registry contains executable mechanics, but registry membership alone does not grant access.

For an actor, the currently available action types are:

```text
base actions
+ current sublocation capabilities
+ action types from actor abilityIds
```

Examples:

```text
move                    base
move_within_location    base
take_item               base
give_item               base
pour_ale                granted by barBehindCounter
place_item               granted by a table sublocation
read_aura               granted by hoodedWoman.readAura
```

`getAvailableActions(actorId)` returns a deduplicated map with source metadata:

```json
{
  "read_aura": {
    "description": "Read a visible character's aura.",
    "sources": [
      {
        "kind": "character_ability",
        "id": "readAura",
        "name": "Read aura"
      }
    ],
    "schema": {},
    "options": {}
  }
}
```

`perform()` rejects an otherwise registered action when the actor does not currently receive it from any valid source.

## 11. Unified formal action result

Physical and perceptual actions use the same registry and the same normalized result contract.

```js
{
  ok: true,
  action: { type: "take_item", item_id: "aleMug_4" },
  events: [],
  feedback: [],
  error: null
}
```

Failure:

```js
{
  ok: false,
  action: { type: "take_item", item_id: "aleMug_4" },
  events: [],
  feedback: [
    {
      recipientId: "hoodedWoman",
      kind: "observation",
      code: "ITEM_NOT_ACCESSIBLE",
      text: "The mug is on another table and is out of reach.",
      data: { itemId: "aleMug_4" }
    }
  ],
  error: {
    code: "ITEM_NOT_ACCESSIBLE",
    message: "Item is not accessible from the current position."
  }
}
```

Feedback is grounded engine output. Each recipient feedback entry is also appended to that character's `mind.pendingObservations`.

Events and feedback are independent:

- an action may mutate state and emit a public event;
- an action may fail yet provide private feedback;
- an action may reveal private information without mutating state;
- an action may do all three.

## 12. Sample individual action: read_aura

`read_aura` proves that personal abilities can reveal grounded hidden information without a separate perception subsystem.

Rules:

- the actor must receive `read_aura` from an assigned ability;
- the target must be another character in the same major location and visible under current perception rules;
- the action does not require physical reach unless later mechanics add that rule;
- the result reads only the target's objective `engineFacts.aura` value;
- the result is private feedback to the actor;
- no other character receives the aura result;
- the action need not mutate world state or emit a public event;
- absence of an aura value returns a grounded neutral result rather than exposing raw missing data.

A character without the ability receives `ACTION_NOT_AVAILABLE` even if it manually submits the same JSON action.

## 13. Events and observation routing

Confirmed events remain the record of objective occurrences.

When an event has recipients, the engine creates recipient-specific pending observations. These observations may use second-person text or structured data suitable for future context building.

Do not use event history as the only persistent character memory. A loaded save must already contain each character's current mind and observation inbox.

The event log may remain capped for debugging while character mind remains independent.

## 14. Restricted character view

A restricted view may contain:

- the actor's physical state;
- current location and sublocation;
- public descriptions of nearby characters;
- reachable characters and accessible inventories;
- exits and positions;
- currently granted actions.

It must not contain:

- another character's `aiDescription`;
- another character's mind;
- another character's `engineFacts`;
- distant private inventories or wallets;
- hidden facts not revealed through a formal action.

## 15. Future context builder boundary

Add a pure, deterministic interface:

```js
setup.ContextBuilder.build(actorId)
```

It returns a deep-cloned JSON-serializable bundle suitable for a future controller adapter:

```json
{
  "schemaVersion": 1,
  "character": {
    "id": "hoodedWoman",
    "name": "Hooded woman",
    "aiDescription": "...",
    "abilities": []
  },
  "mind": {},
  "view": {},
  "availableActions": {}
}
```

The current ContextBuilder must not:

- generate prompt prose;
- call a model;
- retain conversation state outside the character;
- count tokens;
- summarize memories;
- mutate the world or acknowledge observations.

Its purpose is to prove that the deterministic engine can already supply the future adapter with the correct restricted data.

## 16. HumanController invariant

Exactly one runtime character is assigned `human`.

Authoring definitions include:

- `initialControllerId` — used to construct the initial assignment map;
- `defaultControllerId` — fallback after human control leaves the character.

Exactly one character must have `initialControllerId: "human"`.

No character may have `defaultControllerId: "human"`.

Controller switching remains atomic through `setup.Game.takeHumanControl(characterId)`.

## 17. Editor architecture

`editor/world-editor.html` remains:

- one self-contained file;
- offline;
- English-only;
- usable through `file://`;
- limited to importing and downloading `world.json`.

Main sections:

```text
Locations
Characters
Abilities
```

### Character form

Expose:

- stable ID;
- name;
- player-facing description;
- interaction label;
- AI-facing description;
- starting location and sublocation;
- wallet;
- inventory ID;
- initial controller;
- fallback/default controller;
- assigned abilities;
- hidden aura fact for the POC;
- initial known facts;
- initial beliefs;
- initial relationships;
- initial recent memories;
- initial long-term memories.

`pendingObservations` is runtime state and is not authored.

### Ability form

Expose:

- stable ID;
- name;
- player-facing description;
- AI-facing usage description;
- engine action type selected from a known allowlist.

The editor does not define action code.

## 18. Hardening rules

The same core problems must be rejected before build and at runtime when relevant:

- duplicate location passage names;
- invalid or missing start location;
- globally colliding inventory IDs;
- invalid character location/sublocation;
- zero or multiple initial human characters;
- default controller set to `human`;
- invalid ability reference;
- ability references an unknown action type;
- deletion of referenced locations, sublocations, characters, or abilities;
- malformed mind records;
- restricted-view leaks of AI-private or engine-hidden data.

## 19. Save behavior

Runtime mind is ordinary JSON state under `State.variables.world`.

The implementation must prove that:

```text
world
  → JSON.stringify
  → JSON.parse
  → equivalent character minds and pending observations
```

No separate log replay or model call is required after loading.

The task does not introduce a second persistence system.

## 20. Out of scope

The following remain later work:

- OpenAI or any other model API;
- API key entry;
- prompt templates;
- response schemas for model decisions;
- autonomous controller turns;
- memory interpretation and relationship updates by a model;
- memory compression and token budgeting;
- embeddings or retrieval;
- combat, economy, quests, dialogue trees, and arbitrary scripts.
