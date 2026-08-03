# Codex Task — Characters, Individual Abilities, Saved Mind State, and World Hardening

## Goal

Extend the deterministic framework so `world.json` and the offline editor can author characters and individual abilities, while runtime character state stores all information needed by a future stateless AI controller.

Do not connect a model in this task.

At completion, the engine must be able to provide a future controller with:

```text
who the character is
what the character can publicly look like
what private identity instructions belong to that character
where the character is
what the character can currently perceive
what formal actions are currently available and why
what objective observations are waiting for interpretation
what facts, beliefs, relationships, and memories the character already owns
```

The engine must still decide all objective consequences.

---

## 1. Read before implementation

Read:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/status.md`
- existing engine/editor tests
- current `data/world.json`
- current PowerShell generator

Preserve all existing working location, sublocation, inventory, controller, action, event, editor, test, and build behavior unless this task explicitly changes it.

---

## 2. Non-negotiable boundaries

Do not add:

- OpenAI or other model calls;
- API-key fields;
- fetch requests to model endpoints;
- prompt strings or chat-message construction;
- token counting;
- memory compression or summarization;
- embeddings, vector search, or retrieval databases;
- autonomous AI turns;
- arbitrary JavaScript entered through the editor.

`AIController` remains an unimplemented placeholder.

The editor remains one English-only offline HTML file that only imports and downloads `world.json`.

---

## 3. Upgrade the authoritative document

Upgrade `data/world.json` to `schemaVersion: 2`.

Required top-level fields:

```json
{
  "schemaVersion": 2,
  "startLocationId": "tavernEntrance",
  "protectedLocationIds": [],
  "protectedSublocationIds": [],
  "protectedCharacterIds": [],
  "protectedAbilityIds": [],
  "locations": {},
  "characters": {},
  "abilities": {}
}
```

Migrate the existing hard-coded player, hooded woman, and innkeeper into `characters`.

After migration, do not keep a second canonical hard-coded copy of those character definitions in `src/10-game-api.js`.

Runtime initialization must deep-copy authored data so gameplay never mutates `setup.GeneratedWorldData`.

Bump the runtime world version so incompatible old POC saves are not silently interpreted as the new schema.

---

## 4. Character authoring schema

Each authored character must support:

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

### Description rules

- `playerDescription` replaces the current canonical use of `presenceText` for public nearby-character prose.
- `aiDescription` is private and must not appear in normal UI or another character's restricted view.
- `engineFacts` is objective hidden mechanical data and must not appear in normal UI, generic view output, or another character's context.
- `interactionLabel` remains public UI data.

Preserve unknown character properties when the editor loads and exports the document.

### Controller rules

- Exactly one authored character has `initialControllerId: "human"`.
- Other initial controller values may be `dummy` or the existing nonfunctional `ai` placeholder.
- `defaultControllerId` may be `dummy` or `ai`, but never `human`.
- Runtime assignments are constructed from `initialControllerId`.
- Existing atomic takeover and repair behavior remains authoritative.

---

## 5. Initial mind schema

Support the following authorable record shapes.

### Known fact

```json
{
  "id": "fact_arrival_reason",
  "text": "You came to the tavern looking for information."
}
```

### Belief

```json
{
  "id": "belief_guard_interest",
  "text": "The town guard may be watching travellers who ask about magic.",
  "confidence": "medium"
}
```

Allowed confidence values:

```text
low
medium
high
```

### Relationship

```json
{
  "targetCharacterId": "player",
  "summary": "You do not know this traveller yet."
}
```

### Recent or long-term memory

```json
{
  "id": "memory_old_mentor",
  "summary": "Your former mentor warned you never to reveal your gift to officials.",
  "importance": 0.9,
  "protected": true
}
```

Rules:

- IDs inside each character's fact, belief, and memory lists must be non-empty and unique within the relevant list.
- `importance` must be a finite number from `0` through `1`.
- `protected` must be Boolean.
- relationship targets must reference existing characters and may not target the same character unless self-relationships are explicitly justified and tested; prefer rejecting self-targets in this milestone.
- do not create `pendingObservations` in authoring data.

At runtime, deep-copy `initialMind` to:

```js
character.mind = {
  knownFacts: [],
  beliefs: [],
  relationships: [],
  recentMemories: [],
  longTermMemories: [],
  pendingObservations: []
};
```

Do not automatically transform observations into the other mind partitions.

---

## 6. Ability authoring schema

Add a top-level ability catalog.

Each ability contains:

```json
{
  "id": "readAura",
  "name": "Read aura",
  "actionType": "read_aura",
  "playerDescription": "Sense supernatural traces around a visible character.",
  "aiDescription": "Use this formal action to request private engine-grounded aura information. Never invent the result before the engine returns it."
}
```

Rules:

- ability IDs are stable technical IDs;
- character `abilityIds` reference catalog records;
- `actionType` must reference a known registered engine action type;
- ability definitions are metadata and grants only;
- ability definitions never contain executable code, effect expressions, scripts, or mutations;
- deleting an ability that is assigned to a character must be blocked until references are removed.

Add `readAura` to the sample world and assign it to the hooded woman only.

---

## 7. Formal action availability

Refactor `getAvailableActions(actorId)` so it no longer returns every registered action automatically.

The actor's available action types are the deduplicated union of:

1. an explicit engine-side base action allowlist;
2. action IDs in the actor's current sublocation `capabilities` array;
3. `actionType` values from the actor's assigned ability records.

Use these initial grants:

### Base actions

```text
move
move_within_location
take_item
drop_item
give_item
give_money
```

### Sublocation actions

- `barBehindCounter` grants `pour_ale`.
- `commonRoomTableOne` and `commonRoomTableTwo` grant `place_item`.

### Character actions

- `hoodedWoman` receives `read_aura` through `readAura`.

Do not list `place_item`, `pour_ale`, or `read_aura` when the current actor has no corresponding grant.

Each available-action record must include source metadata, for example:

```json
{
  "sources": [
    { "kind": "base" },
    {
      "kind": "sublocation",
      "id": "barBehindCounter"
    },
    {
      "kind": "character_ability",
      "id": "readAura",
      "name": "Read aura"
    }
  ]
}
```

Deduplicate an action type while preserving all grant sources.

`setup.CharacterAPI.perform()` must reject a registered but currently ungranted action with:

```text
ACTION_NOT_AVAILABLE
```

Do this before action-specific execution.

Action-specific validation remains responsible for current targets, options, reachability, inventories, capacity, amounts, and other dynamic preconditions.

---

## 8. Normalize formal action results

Use one execution system for physical actions and information-gathering actions.

Every `perform()` result must be JSON-serializable and contain:

```js
{
  ok: Boolean,
  action: Object,
  events: Array,
  feedback: Array,
  error: Object | null
}
```

A success uses `error: null`.

A failure still returns the attempted action, an empty or populated event array, an empty or populated feedback array, and a structured error.

Feedback entry shape:

```js
{
  recipientId: "hoodedWoman",
  kind: "observation",
  code: "ITEM_NOT_ACCESSIBLE",
  text: "The mug is on another table and is out of reach.",
  data: {
    itemId: "aleMug_4"
  }
}
```

Requirements:

- feedback is grounded engine output, not controller-written narrative;
- a successful action may produce feedback;
- a failed action may produce feedback;
- an action may produce feedback without world mutation;
- feedback may have one or more explicit recipients;
- do not expose recipient-private feedback in public events;
- preserve rollback behavior for failed execution and invariant violations.

Existing callers and debug UI may be adapted to the normalized result but must retain current usable behavior.

---

## 9. Pending observation inbox

Add runtime counters/state needed to assign stable observation IDs.

Whenever formal action feedback is returned, append a deep-cloned observation to each valid recipient's:

```js
character.mind.pendingObservations
```

Whenever an existing confirmed event is perceptible to a character, enqueue a recipient-specific event observation as well.

Observation shape:

```js
{
  id: 15,
  kind: "event" | "action_feedback",
  sourceEventId: 8,
  actionType: "give_item",
  turn: 23,
  actorId: "player",
  targetId: "hoodedWoman",
  text: "The traveller gave you a mug of ale.",
  data: {}
}
```

Fields that do not apply may be absent or `null`, but the chosen convention must be consistent and tested.

Rules:

- the inbox is character-private state;
- the engine appends objective observations only;
- DummyController must not convert them into memories, beliefs, or relationships;
- no automatic deletion or model processing in this task;
- cap only if a clearly documented high safety limit is needed; do not silently discard observations during normal POC tests.

Keep confirmed event history as a separate objective/debug record. Do not require log replay to rebuild character minds after loading.

---

## 10. Add the sample `read_aura` formal action

Register:

```text
read_aura
```

Input schema:

```json
{
  "type": "read_aura",
  "target_id": "player"
}
```

Rules:

- only available through a character ability grant;
- target must exist;
- target must not be the actor;
- target must be in the same major location and visible under current major-location perception rules;
- physical sublocation reach is not required in this milestone;
- read only `target.engineFacts.aura`;
- if the value exists, return it as private actor feedback;
- if absent, return a grounded neutral message such as `You sense no unusual supernatural aura.`;
- do not include raw `engineFacts` in the returned public view;
- do not mutate world state;
- do not reveal the result to the target or bystanders;
- a public event is not required for this silent POC ability.

Add suitable sample aura values to character authoring data so tests can prove success and privacy.

A non-hooded character manually submitting `read_aura` must receive `ACTION_NOT_AVAILABLE` and must not receive the hidden aura value.

---

## 11. Restricted views and ContextBuilder

Update restricted views to use authored character data.

Nearby character records may expose:

- ID;
- name;
- `playerDescription`;
- interaction label;
- location-relative position;
- reachability.

They must not expose:

- `aiDescription`;
- `engineFacts`;
- `mind`;
- assigned private ability instructions unless the current actor is the same character.

Add:

```js
setup.ContextBuilder.build(actorId)
```

It must return a deep-cloned JSON-serializable object containing only:

- a schema version;
- actor ID and name;
- the actor's own `aiDescription`;
- the actor's own ability metadata;
- the actor's own mind;
- the actor's restricted view;
- currently available formal actions and their sources.

Do not include:

- raw entire world state;
- another character's mind;
- another character's `aiDescription`;
- another character's `engineFacts`;
- a natural-language prompt;
- API request parameters;
- token estimates.

`ContextBuilder.build()` must not mutate or acknowledge anything.

---

## 12. SugarCube/save compatibility

Keep runtime characters and minds in `State.variables.world`.

All new structures must remain JSON-serializable.

Add a test that:

1. creates or bootstraps the world;
2. performs actions that enqueue observations;
3. adds or seeds representative mind records;
4. serializes the world through `JSON.stringify`;
5. restores it through `JSON.parse`;
6. verifies all characters' mind partitions and pending observations survive unchanged;
7. verifies world validation still succeeds.

Do not add a second save format or rebuild memory from event logs.

---

## 13. Extend the standalone offline editor

Keep exactly one distributable file:

```text
editor/world-editor.html
```

It remains self-contained, offline, English-only, and usable through `file://`.

Add primary sections or tabs:

```text
Locations
Characters
Abilities
```

### 13.1 Character list and form

Support add, select, edit, and delete.

Expose:

- stable character ID;
- name;
- player-facing description;
- interaction label;
- AI-facing description;
- starting location;
- starting sublocation filtered to the selected location;
- wallet;
- inventory ID;
- initial controller;
- fallback/default controller;
- assigned abilities using catalog selections;
- optional hidden aura text for the POC engine fact;
- initial known facts;
- initial beliefs with confidence;
- initial relationships with target character selection;
- initial recent memories;
- initial long-term memories.

Use repeatable form rows, not raw JSON, for the required mind fields.

Existing technical IDs should remain read-only unless the editor already implements safe atomic rename support. New IDs may be suggested but must be reviewed before creation.

### 13.2 Ability list and form

Support add, select, edit, and delete.

Expose:

- stable ability ID;
- display name;
- player-facing description;
- AI-facing usage description;
- engine action type selected from an embedded known-action dropdown.

The dropdown must include the current registered actions, including `read_aura`, and must not accept arbitrary executable code.

### 13.3 Delete/reference behavior

Block deletion when referenced:

- location used by a character's starting location;
- sublocation used by a character's starting position;
- character referenced by an initial relationship;
- ability assigned to a character;
- the sole initial human-controlled character, unless another human is assigned as part of the same valid edit.

Show specific English errors naming the references.

### 13.4 Unknown field preservation

Continue preserving unknown top-level, location, sublocation, character, ability, and nested record properties whenever practical.

Editing known fields must not erase unrelated future data.

### 13.5 Local draft

Keep or extend the existing localStorage draft behavior so characters and abilities are included. Downloaded JSON remains authoritative.

---

## 14. Hardening: passage names and start passage

Fix the current architectural/documentation mismatch and build risk.

Required behavior:

- major locations continue to use separate generated passages;
- all location passage names are non-empty and globally unique;
- the editor blocks export when passage names collide;
- the PowerShell generator rejects duplicates even if the editor was bypassed;
- runtime/build validation rejects malformed location passage data where applicable;
- `startLocationId` must reference an existing location;
- SugarCube `StoryData.start` must be generated from that location's passage;
- remove the fixed `"start": "The Tavern"` source of truth from hand-authored `src/story.twee`;
- do not solve this by forbidding all start-passage edits.

The generated StoryData must preserve the existing IFID, SugarCube format, format version, and zoom unless there is a documented reason to change them.

---

## 15. Hardening: globally unique inventory IDs

Inventory IDs must be globally unique across:

- major locations;
- sublocations;
- characters.

Reject collisions in:

- editor validation/export;
- PowerShell generation;
- runtime world construction/validation.

Do not allow later records to silently overwrite earlier inventories.

Errors must name both conflicting owners and the inventory ID.

Keep existing inventory IDs unless a collision requires an explicit authored correction.

---

## 16. Validation requirements

Editor and/or generator validation must reject:

- unsupported schema version;
- missing `startLocationId`;
- invalid start location;
- duplicate passage names;
- duplicate inventory IDs;
- character ID mismatch between object key and `id`;
- missing character name;
- missing public or AI description when required;
- invalid start location or sublocation;
- negative or non-integer wallet;
- unknown initial/default controller;
- zero or multiple initial humans;
- `defaultControllerId: "human"`;
- unknown assigned ability;
- unknown ability action type;
- duplicate ability assignment;
- malformed known facts, beliefs, relationships, or memories;
- relationship to missing character;
- duplicate local fact/belief/memory IDs;
- importance outside `0..1`;
- invalid belief confidence.

Use human-readable English editor errors and precise developer-facing generator/runtime errors.

---

## 17. Required tests

Extend `tests/run-tests.js` to cover at least:

1. characters are loaded from generated world data rather than canonical hard-coded copies;
2. exactly one initial human is accepted;
3. zero and multiple initial humans are rejected or repaired according to the documented boundary;
4. default human controller is rejected;
5. character location and sublocation references are validated;
6. inventory ID collisions are rejected without overwrite;
7. major passage names are unique;
8. start location resolves to the correct generated passage;
9. base actions are available from the base allowlist;
10. `pour_ale` is available only from the correct sublocation grant;
11. `place_item` is available only at a table grant;
12. `read_aura` is available only to the hooded woman through her ability;
13. manually submitting an ungranted action returns `ACTION_NOT_AVAILABLE`;
14. action source metadata is present and deduplicated;
15. successful physical action can return feedback;
16. failed action can return grounded feedback;
17. feedback is appended only to explicit recipients' pending observations;
18. public event observations reach characters in the major location according to existing perception rules;
19. `read_aura` returns the target aura only to the actor;
20. restricted views do not leak `aiDescription`, `engineFacts`, or another mind;
21. ContextBuilder includes the actor's own private data and no forbidden other-character data;
22. controller switching preserves the character mind;
23. JSON serialize/parse round trip preserves minds and observations;
24. existing movement, inventory, money, table, ale, rollback, and HumanController tests still pass.

Extend `tests/run-editor-tests.js` to cover at least:

1. the editor remains one self-contained offline file;
2. all visible editor labels/errors introduced by this task are English;
3. schemaVersion 2 character and ability data loads;
4. character edits export correctly;
5. ability edits export correctly;
6. unknown character/ability/nested fields survive edits;
7. duplicate passage names block export;
8. duplicate inventory IDs block export;
9. invalid start location blocks export;
10. invalid character location/sublocation blocks export;
11. zero/multiple initial human characters block export;
12. invalid ability reference/action type blocks export;
13. deleting referenced characters, abilities, locations, or sublocations is blocked;
14. localStorage draft includes character and ability edits.

Add generator-focused tests if practical, or ensure the test harness invokes the PowerShell generator with temporary invalid fixtures on Windows. At minimum, implement deterministic validation functions that Node tests can exercise without requiring PowerShell on non-Windows environments.

---

## 18. Build and generated files

Update `tools/generate-world-data.ps1` to:

- require schema version 2;
- validate the complete authored document before writing outputs;
- generate `src/generated/world-data.js`;
- generate physical location passages;
- generate StoryData with the start passage derived from `startLocationId`;
- fail before partially replacing generated outputs when validation fails.

Prefer writing temporary files and atomically replacing generated outputs only after all validation and generation succeeds.

Update `build.bat` only as needed to include any new generated StoryData file. Do not add an author-side dependency.

The final `dist/game.html` remains self-contained and works through `file://`.

---

## 19. Documentation updates

Update:

- `README.md` — explain that `world.json` now owns characters and abilities as well as spatial data;
- `docs/architecture.md` — keep it consistent with implementation;
- `docs/status.md` — move completed items to Implemented and list remaining limitations;
- `AGENTS.md` only when implementation reveals a necessary correction, without weakening its architectural constraints.

Remove or correct statements that claim the project uses one generic physical-location passage.

Do not delete historical task files.

---

## 20. Acceptance scenarios

### Scenario A — Author edits a character

1. Open `editor/world-editor.html` directly.
2. Load `world.json`.
3. Open Characters.
4. Change the hooded woman's public description and AI description.
5. Add an initial known fact.
6. Download `world.json`.
7. Replace project `data/world.json` and build.
8. The public description changes in player-facing UI.
9. The AI description appears only in the hooded woman's ContextBuilder bundle.

### Scenario B — Unique ability

1. Hooded woman is human-controlled.
2. `read_aura` is listed with source `character_ability/readAura`.
3. She uses it on the player in the same major location.
4. No physical world state changes.
5. Only her result and pending observation contain the player's authored aura.
6. The player and innkeeper receive no aura result.

### Scenario C — Ability cannot be forged

1. Player is human-controlled and has no `readAura` ability.
2. Debug code manually calls `perform(player, {type: "read_aura", target_id: "hoodedWoman"})`.
3. The engine returns `ACTION_NOT_AVAILABLE`.
4. The hooded woman's hidden aura is not returned or queued.

### Scenario D — Failed physical action informs the actor

1. A character attempts to take an item from an inaccessible table.
2. World state remains unchanged.
3. The normalized result is unsuccessful.
4. The result contains grounded private feedback.
5. The same feedback is present in that actor's pending observations.

### Scenario E — Save-ready mind

1. Seed a character with facts, beliefs, relationship, memories, and pending observations.
2. Switch human control away and back.
3. Serialize and restore the world.
4. The character's mind is unchanged.

### Scenario F — Authoring hardening

1. Give two locations the same passage name: export/build is blocked.
2. Give a character and table the same inventory ID: export/build is blocked.
3. Change `startLocationId`: generated StoryData starts at the selected location passage.

---

## 21. Completion report

When finished, report:

- files changed;
- schema version and migration summary;
- action-availability design;
- normalized result/feedback design;
- mind and observation data shapes;
- editor character/ability workflow;
- hardening validations added;
- tests run and results;
- build result;
- remaining limitations.

Do not begin model integration after completing this task.
