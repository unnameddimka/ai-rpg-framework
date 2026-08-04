# AI RPG Architecture — Deterministic Character Foundation

## 1. Goal

Build a deterministic Twine/SugarCube RPG framework that supplies a stateless language model with everything required to behave as one specific character while the engine remains authoritative.

The current integration milestone adds a narrow manual OpenRouter/Cydonia vertical slice on top of the existing deterministic foundation:

- authorable characters;
- separate public and AI-private descriptions;
- individual formal abilities;
- objective action feedback;
- per-character saved mind state;
- restricted controller context;
- a saved deterministic AI-turn queue;
- one manually triggered AI turn at a time;
- browser-side OpenRouter access with a transient user-supplied key.

The engine remains the authority over objective reality.

## 2. Main separation

```text
Authoring data in world.json
        │ new game initialization
        ▼
Deterministic runtime world in SugarCube state
        │ restricted projection
        ▼
Human / Dummy / AI controller
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
villageTemple    → The Village Temple (temporary prompt-lab room)
```

The build generator must:

1. validate unique passage names;
2. validate `startLocationId`;
3. generate one physical passage per location;
4. generate SugarCube `StoryData.start` from the start location's passage.

The obsolete generic-location-passage design is not authoritative.

Internal sublocations remain runtime entities rather than passages. The temporary
`villageTemple` location is ordinary world data, but `src/30-game-ui.js` recognizes its ID
and renders a development-only crystal-sphere prompt lab there. The lab itself is transient
browser state and never enters the deterministic world or SugarCube saves.

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
  "initialControllerId": "ai",
  "defaultControllerId": "ai",
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
  defaultControllerId: "ai",
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

`pendingObservations` contains objective information delivered to one character but not yet interpreted by a AI controller.

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
  "playerDescription": "Sense the hidden auras of everyone you can currently perceive.",
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
read_aura               granted by the actor's assigned readAura ability
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

Invocation:

```json
{
  "type": "read_aura"
}
```

Rules:

- the actor must receive `read_aura` from an assigned ability;
- the action accepts no target parameter in this milestone;
- the engine derives the scan set from the actor's current restricted/perception view;
- every other currently perceivable character is scanned; the actor is excluded;
- physical reach is not required;
- each result reads only that character's objective `engineFacts.aura` value, authored in the editor as `Hidden aura`;
- absence of an aura value returns a grounded neutral result rather than exposing raw missing data;
- the complete scan result is private feedback to the actor;
- no scanned character or bystander receives the aura result;
- the action does not mutate world state and does not need to emit a public event.

Recommended feedback data shape:

```json
{
  "recipientId": "player",
  "kind": "observation",
  "code": "AURA_SCAN_RESULT",
  "text": "You read the nearby auras.",
  "data": {
    "results": [
      {
        "characterId": "innkeeper",
        "name": "Innkeeper",
        "aura": "His aura is mundane and tired."
      }
    ]
  }
}
```

When no other characters are perceivable, return a successful private observation such as `You sense no other auras nearby.`

A character without the ability receives `ACTION_NOT_AVAILABLE` even if it manually submits the same JSON action.

### 12.1 Player-facing ability controls

The normal UI renders assigned abilities generically from the currently human-controlled actor's data and current action availability.

For each assigned ability whose `actionType` is currently available and requires no input in this milestone:

- render the authored ability `name`;
- render its public `playerDescription`;
- render an execution button;
- call `setup.CharacterAPI.perform(actorId, {type: ability.actionType})`;
- display recipient-private feedback immediately in a normal player-facing result area.

The UI must never test for a specific character ID or assume that `readAura` belongs to the hooded woman. Assigning `readAura` to the player, innkeeper, or any future character through the editor must make the same control appear whenever that character is under HumanController.

The debug formal-action panel remains available, but it is not the only interface for assigned abilities.

This milestone does not add arbitrary JavaScript, editable effect scripts, a general target picker, or a universal form generator. Future data-driven effects will be designed separately.

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

## 15. Context builder boundary

Add a pure, deterministic interface:

```js
setup.ContextBuilder.build(actorId)
```

It returns a deep-cloned JSON-serializable bundle suitable for the AI protocol adapter:

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

ContextBuilder remains a pure restricted-data projection. It must not call a model, retain conversation state outside the character, count tokens, summarize memories, mutate the world, or acknowledge observations. A separate browser-side adapter serializes this bundle into stage-specific model messages.

## 16. HumanController invariant and permanent defaults

Exactly one runtime character is assigned `human`. HumanController is a temporary override rather than a character's persistent controller.

Authoring definitions include:

- `initialControllerId` — used only to construct the initial assignment map;
- `defaultControllerId` — the character's permanent nonhuman controller for this game definition.

Exactly one character must have `initialControllerId: "human"`. No character may have `defaultControllerId: "human"`.

When human control moves from character A to character B, the atomic candidate assignment map must set A directly to `A.defaultControllerId` and B to `human`. Do not track `controllerBeforeHuman`. Normal gameplay does not change authored default controllers in this milestone. A future dumb mob may therefore keep a scripted controller as its default for the entire game.

If A returns to `ai` and already has pending observations, queue A for a later manual AI turn. Controller switching itself does not immediately execute that turn.

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

- automatic queue draining or autonomous/timer-driven NPC activity;
- provider or model selection beyond fixed OpenRouter/Cydonia;
- streaming;
- multiple formal actions in one AI turn;
- memory compression and token budgeting;
- embeddings or retrieval;
- editable ability effects or arbitrary scripts;
- combat, economy, quests, dialogue trees, and other major gameplay systems.

## 21. Manual AI turn queue

The first model integration is deterministic and manually advanced. The sidebar does not ask the user to pick an AI character. It shows the queue head as a recipient plus an event preview:

```text
Next recipient: Hooded woman
Event: You to Hooded woman: “Hello there.”
[Process next AI event]
```

When empty it shows `No pending AI turns`. The temporary crystal sphere may render the full queue, but live execution still follows queue order.

The runtime world owns a JSON-serializable queue, conceptually:

```js
world.ai = {
  turnQueue: ["hoodedWoman", "innkeeper"]
};
```

A character may appear at most once. Additional observations accumulate in that character's `mind.pendingObservations` without adding duplicate queue entries.

Queue eligibility requires both:

- current controller assignment `ai`;
- at least one pending observation.

Stale entries are removed or skipped when inspected. Human and dummy characters are never executed by the queue.

### 21.1 Ordering

For each confirmed event or feedback delivery, enqueue eligible AI recipients in this priority order:

1. direct addressee, when present;
2. formal-action target, when present;
3. other perceiving AI characters in deterministic delivery order.

Existing queued characters keep their earlier position.

### 21.2 Control switching

If HumanController leaves a character and its `defaultControllerId` is `ai`, enqueue that character if it already owns pending observations. Switching control never calls the model automatically.

### 21.3 Save behavior

The queue is runtime game state and must survive SugarCube save/load. In-flight requests, promises, API settings, raw prompts, and raw responses are transient and must not be saved.

## 22. OpenRouter client and key lifecycle

The browser sends a non-streaming chat-completions request to OpenRouter using the fixed model:

```text
thedrummer/cydonia-24b-v4.1
```

The user enters an OpenRouter API key in an `AI Settings` panel. The key is stored in a transient object outside `State.variables`.

Optional `Remember for 24 hours` persistence uses `localStorage`, not cookies:

```json
{
  "apiKey": "...",
  "expiresAt": 0
}
```

On read, reject malformed data, delete expired data, and never display the full saved key. `Forget saved key` clears both localStorage and the current in-memory value. If localStorage fails under `file://`, continue with memory-only storage and show a warning.

The key must never be present in:

- `world.json`;
- generated JS or Twee;
- SugarCube history or saves;
- copied context bundles;
- controller logs;
- debug world dumps;
- error bodies shown to the player.

### 22.1 Shared request executor

Every game-stage, repair, and prompt-lab request passes through `setup.AIRequestExecutor`.
It serializes executions, prevents overlapping transport calls, and leaves at least one
second between live OpenRouter calls. HTTP 429 responses may provide `Retry-After`; the
executor extends its cooldown accordingly and exposes the remaining delay to the debug UI.
It never performs a general automatic retry. The protocol still permits exactly one repair
request for invalid JSON, and that repair passes through the same timing policy.

## 23. One queued AI turn

`setup.AITurnScheduler.processNext()` processes only the first eligible queue entry. The
sidebar button and the crystal sphere's live control both call this operation. There is no
timer yet, so a scheduler invocation happens only after a user action.

`setup.AITurnScheduler.buildDecisionRequest(characterId)` is the single source for the exact
restricted decision request represented by a queue entry. It is used by both live turns and
sphere inspection/dry runs.

At turn start:

1. identify the queue-head actor;
2. snapshot the IDs and contents of current pending observations;
3. build a restricted context bundle;
4. send the decision request.

The decision response may choose no formal action or one currently available formal action.

### 23.1 One-stage turn

When `action` is `null`, the same response may contain final public narrative, spoken text, and bounded memory updates. After local validation, commit them atomically and consume only the snapshotted observation IDs.

### 23.2 Two-stage turn

When an action is present:

1. validate and execute it through `CharacterAPI.perform()`;
2. capture its normalized grounded result, including failure feedback;
3. send a second request containing the original restricted context, chosen action, and actual action result;
4. receive final reaction text and bounded memory updates;
5. commit the whole turn only after the second response validates.

The two requests are one game turn. The model must not invent action success or hidden feedback before the engine result exists.

All stage-one narrative for action-taking turns is held until completion and may describe only intention or attempt, never an unconfirmed result.

## 24. Model JSON protocol

Do not rely on native strict structured-output support. Request JSON-only output, extract a JSON object, and validate locally. At most one repair request may be sent when parsing or schema validation fails. General network retries are not automatic.

Conceptual decision response:

```json
{
  "action": null,
  "publicNarrative": "She studies the traveller in silence.",
  "spokenText": null,
  "memoryUpdates": {
    "recentMemoriesToAdd": [],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

When `action` is non-null, `memoryUpdates` must be empty until the result-stage response. The action object is passed unchanged to local action validation after removing unknown top-level protocol fields.

Conceptual result-stage response:

```json
{
  "publicNarrative": "Her expression tightens for a moment.",
  "spokenText": "Interesting.",
  "memoryUpdates": {
    "recentMemoriesToAdd": [
      {
        "summary": "I sensed unusual potential around the traveller.",
        "importance": 0.6
      }
    ],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

No chain-of-thought, hidden reasoning, arbitrary world patch, arbitrary mind replacement, or executable code is accepted.

## 25. Validated memory updates

The model may request only these bounded operations:

- append a recent memory;
- upsert a belief by stable `id`;
- upsert a relationship by `targetCharacterId`.

The engine assigns unique IDs to new memories when the model does not provide one. Validate text length, importance range `0..1`, belief confidence, relationship targets, and per-turn count limits. Protected memories, known facts, long-term memories, and pending observations cannot be directly edited by the model.

Applying updates must use an engine-owned function and must be part of the turn transaction.

## 26. Narrative commit

Accepted AI narrative is not a direct DOM append. It goes through `CharacterAPI.narrate()` so it creates the same confirmed narrative event and recipient observations as human narrative.

The display may combine public narrative and spoken text for readability, but both remain model-authored narrative rather than objective engine facts. HTML-escape all content.

## 27. Failure and rollback

On API error, missing key, malformed response after one repair, local schema rejection, or unexpected exception:

- do not consume observations;
- do not remove the queue head;
- do not apply memory changes;
- do not commit model narrative;
- preserve any pre-turn world snapshot needed to roll back a formal action;
- show a concise safe error and retain a retry path.

Because a formal action occurs before the second request, the implementation must either execute against a cloned transaction candidate or capture and restore the pre-action world on second-stage failure. Partial world mutation is not acceptable.

## 28. Debug and usage UI

The AI panel should show:

- key status without revealing the key;
- fixed provider and model;
- next scheduler recipient, first-event preview, and queue length;
- `Process next AI event`;
- shared executor busy/cooldown information where useful;
- last safe error;
- last token usage and cost when returned by OpenRouter;
- optional transient request/response diagnostics, with credentials excluded.

Raw prompts and responses are never saved.

## 29. Still out of scope

This integration does not add:

- automatic queue draining;
- timer-based NPC activity;
- initiative without pending observations;
- multiple actions in one turn;
- model/provider selection;
- streaming;
- memory compression or token budgeting;
- target-form generation for human abilities;
- editable ability effects or arbitrary scripts.


## Temporary crystal-sphere scheduler and prompt lab

The sphere renders `AITurnScheduler.getQueueView()` as ordered cards. Each card shows the
recipient, location, queue reason, pending-observation count, available-action count, and a
preview of the observation bundle. The first card is marked as the exact next live request.
Any card may be inspected or dry-run, but only the queue head may be processed live.

`src/24-prompt-lab.js` reuses the production `AITurnScheduler`, `AIRequestExecutor`,
`ContextBuilder`, and `AIProtocol`. It may capture any queued decision request or the last
request actually issued by `AIController`. Dry-running or retrying a loaded request does not
call `CharacterAPI.perform()`, `CharacterAPI.narrate()`, `AIMemory.applyUpdates()`, or
observation consumption. The sphere's explicit **Process live** control is different: it
invokes the same manual scheduler as the sidebar and commits a normal AI turn.

The protocol returns a transient trace containing:

- the stage and original messages;
- each initial/repair attempt;
- raw assistant content;
- parsed JSON when parsing succeeds;
- exact validation errors;
- usage data and final status.

The trace and edited prompt are closure-owned browser debug data. They are not stored in
`State.variables.world`, saves, authoring data, or generated world files, and they never
contain the API key.
