# AI RPG Architecture — Deterministic Character Foundation

## 1. Goal

Build a deterministic Twine/SugarCube RPG framework that supplies a stateless language model with everything required to behave as one specific character while the engine remains authoritative.

The current integration milestone adds a user-triggered OpenRouter reaction loop with a small validated model catalog on top of the existing deterministic foundation:

- authorable characters;
- separate public and AI-private descriptions;
- individual formal abilities;
- objective action feedback;
- per-character saved mind state;
- restricted controller context;
- a saved deterministic AI-turn queue;
- one Human-triggered global AI world tick at a time, with each eligible queued AI character reacting at most once per tick;
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

Narrative and a formal action remain separate authority channels, but they may be submitted together as one intent:

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
+ actions derived from owned item definitions and the current environment
+ action types from actor abilityIds
```

Examples:

```text
move                    base
move_within_location    base
take_item               base
give_item               base
place_item              granted by a table sublocation
fill                    granted by an owned fillable item when the current environment supplies its required capability
consume                 granted by an owned consumable item
read_aura               granted by the actor's assigned readAura ability
```

The bar does not create mugs from nothing. `barBehindCounter` exposes the environment
capability `ale_source` and an accessible `inventory_barMugCabinet`. An empty-mug instance
grants `fill` only while owned at that source. Filling changes the instance definition from
`emptyMug` to `mugOfAle`; consuming it changes the same instance back to `emptyMug`.

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

## 14. Canonical restricted character view

The restricted character view is the canonical public and operational projection for one
controlled character. It is the common foundation for both HumanController and AIController.

The normal player-facing interface must be rendered from this view. The AI model must receive
the same view unchanged, so it sees the same public situation and the same currently available
controls that a human controlling that character would receive.

A restricted view may contain:

- the actor's player-visible physical state;
- current location and sublocation;
- public descriptions of nearby characters;
- reachable characters and player-accessible inventories;
- exits and positions;
- currently granted actions and their valid options, because these are the source from which
  the player interface constructs its controls.

It must not contain:

- another character's `aiDescription`;
- another character's mind;
- another character's `engineFacts`;
- distant private inventories or wallets;
- hidden facts not revealed through a formal action.

The view has one representation only. Data present in the view must not be repeated elsewhere
in an AI request under another property name, casing convention, wrapper, or independently
computed projection. In particular, the action catalog inside the view is authoritative for
both player controls and model action selection; there must not also be a serialized
`availableActions` sibling containing the same catalog.

## 15. AI context as an additive extension of the view

Add a pure, deterministic interface:

```js
setup.ContextBuilder.build(actorId)
```

It returns a deep-cloned JSON-serializable bundle suitable for the AI protocol adapter. The
bundle embeds the exact canonical restricted view and adds only information that the human
interface does not expose but that belongs to the controlled character, such as private
identity instructions, private self-state, memory, beliefs, relationships, and prepared
pending observations.

Conceptual shape:

```json
{
  "schemaVersion": 1,
  "view": {},
  "character": {
    "aiDescription": "...",
    "privateSelfData": {}
  },
  "mind": {},
  "pendingObservations": []
}
```

The exact private-field organization may evolve, but these invariants are mandatory:

1. `view` is built once by the same projection used by the player interface and is passed to
   the model without removing, renaming, or duplicating its fields.
2. AI-only context is strictly additive. It may add private information about the controlled
   character, but it must not restate information already present in `view`.
3. A concept has one serialized source of truth. No snake_case/camelCase aliases or parallel
   copies of the same action catalog, inventory, location, character list, or other view data
   are allowed in the model request.
4. If the AI protocol needs internal validation metadata, it must derive it from `view` or keep
   it in a non-serialized application envelope. Internal validator data must not be sent to the
   model a second time.
5. Raw runtime structures must be projected correctly at construction time. Do not first build
   an over-complete context and then clone/delete duplicate fields at the protocol boundary.
6. Prepared request observations may replace the raw observation inbox, but the context builder
   must omit the raw inbox when constructing the AI mind projection rather than serializing both
   and deleting one later.

ContextBuilder remains a pure restricted-data projection. It must not call a model, retain
conversation state outside the character, count tokens, summarize memories, mutate the world,
or acknowledge observations. A separate browser-side adapter serializes this already-correct
bundle into stage-specific model messages without restructuring its view.

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

- autonomous/timer-driven NPC activity or background/off-screen queue processing;
- provider selection or arbitrary model IDs outside the authored model catalog;
- streaming;
- multiple formal actions in one AI turn;
- memory compression and token budgeting;
- embeddings or retrieval;
- editable ability effects or arbitrary scripts;
- combat, economy, quests, dialogue trees, and other major gameplay systems.

## 21. AI reaction queue and user-triggered waves

The runtime owns a deterministic JSON-serializable queue. Normal play advances it only after a human **Submit** or explicit **Pass / Next turn**. There is no timer or background execution.

The sidebar still exposes **Process next AI event** and the crystal sphere still exposes the full queue for debugging. Those controls process one queue entry manually. The sidebar checkbox **Stop automatic AI request processing** pauses only the wave normally started after Submit; explicit Pass and sphere/sidebar stepping remain available.

Conceptual saved state:

```js
world.ai = {
  turnQueue: [
    { characterId: "innkeeper", reason: "event" },
    { characterId: "hoodedWoman", reason: "event" }
  ]
};
```

A character appears at most once. Additional observations accumulate in that character's `mind.pendingObservations`.

Queue eligibility requires:

- current controller assignment `ai`;
- at least one pending observation.

Stale entries are removed. Human and dummy characters are never executed by the queue.

### 21.1 Initiative from pending observations

The saved queue remains a stable deterministic deduplicated list, but the next character is selected by an initiative score derived from that character's currently pending targeted observations:

- explicitly addressed speech: `+1`;
- targeted formal-action event: `+2`;
- observation originating from the current HumanController: additional `+2`.

Scores accumulate across pending observations and are recomputed before every next selection in the world tick. Only unreacted eligible AI characters participate. Once observations are consumed, their contribution disappears automatically. Ties fall back to the stable saved queue order. No separate persistent initiative stat is stored.

The observation/event stores the source controller at creation time, so later controller switching cannot rewrite whether the HumanController caused that stimulus.

### 21.2 Reaction-wave rule

A HumanController Submit that consumes the turn, or explicit Pass / Next turn, advances one global AI world tick. A world tick repeatedly processes the highest-initiative queued character that has not yet reacted in that tick.

- each character reacts at most once per wave;
- each reaction may contain at most one formal action;
- confirmed events from earlier reactions are delivered immediately;
- later characters in the same wave see those earlier events;
- events delivered to a character that already reacted remain queued for the next wave.

This prevents infinite same-tick dialogue loops while preserving causal propagation through the world, including off-screen pending observations. An AI character with no pending observations is never invoked merely because a world tick occurred.

### 21.3 Combined interaction observations

`CharacterAPI.submitIntent()` assigns one `interactionId` to the narrative and formal-action parts of the same intent. The engine still stores objective action events and narrative events separately, but the scheduler groups matching observations before building an AI request while retaining every original observation ID for exact consumption. Attempt-phase speech is presented before the grounded mechanical result inside the combined observation, for example: “The player said: ‘Pour me an ale.’ The player gave 2 gold.”

Speech has its own structured `spokenTargetId`, validated against characters visible in the canonical request view. A speech target and formal-action target may differ, and both raw pending observations contribute independently to initiative.

### 21.4 Control switching and saves

If HumanController leaves a character and its `defaultControllerId` is `ai`, enqueue it when pending observations exist. The queue survives SugarCube save/load. In-flight promises, API settings, prompts, responses, and the transient current reaction-wave set are not saved.

## 22. OpenRouter client, model catalog, and key lifecycle

The browser sends non-streaming chat-completions requests to OpenRouter. Provider choice is
fixed, but the model comes from the build-validated `data/model_list.json` catalog:

```json
{
  "schemaVersion": 1,
  "defaultModelId": "thedrummer/cydonia-24b-v4.1",
  "models": [
    { "id": "thedrummer/cydonia-24b-v4.1", "name": "Cydonia 24B V4.1" },
    { "id": "sao10k/l3.3-euryale-70b", "name": "Llama 3.3 Euryale 70B" },
    { "id": "sao10k/l3.1-euryale-70b:nitro", "name": "Llama 3.1 Euryale 70B (Nitro)" },
    { "id": "mistralai/mistral-small-3.2-24b-instruct", "name": "Mistral Small 3.2 24B" }
  ]
}
```

`tools/generate-model-list.js` rejects malformed, duplicate, empty, or default-missing
catalogs and emits `src/00-model-list.js`. The standalone `dist/game.html` embeds that output;
it does not fetch sibling JSON under `file://`.

The AI Settings panel renders a selector from the generated list. The selected model ID is
stored outside `State.variables`, applied to the next request, and persisted independently in
a namespaced localStorage value when available. A missing or obsolete saved ID is deleted and
falls back to `defaultModelId`. Each transport result and exchange-history record captures the
model ID actually used so logs remain meaningful after later selection changes.

The user enters an OpenRouter API key in the same panel. The key is stored in a transient object outside `State.variables`.

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

## 23. One queued AI reaction

`setup.AITurnScheduler.buildDecisionRequest(characterId)` is the single source for the exact restricted request represented by a queue entry. It snapshots up to 50 pending observations, groups records sharing an `interactionId`, builds the restricted context, and records the original observation IDs for precise consumption.

A live AI reaction uses one model request:

1. snapshot the pre-turn world;
2. send the decision request;
3. validate one JSON response;
4. submit its optional narrative and optional single formal action through `CharacterAPI.submitIntent()`;
5. apply bounded memory updates;
6. consume only the snapshotted observation IDs;
7. remove the character from the queue and re-enqueue it when new observations remain.

There is no immediate result-stage request.

If the formal action succeeds, the engine records a grounded `action_result` observation for the AI actor. If it fails validation, the existing grounded `action_feedback` observation remains. The actor interprets either result during a later wave. This creates the cycle:

```text
observation -> intention -> deterministic world result -> later observation
```

A provider, parser, validation, or commit failure restores the failed character's pre-reaction snapshot and preserves its queue entry and unconsumed observations. During a full world tick the scheduler then stops immediately; reactions already committed earlier in that tick remain committed, and later/unprocessed characters remain pending for a later HumanController tick.

## 24. Model JSON protocol

Do not rely on native strict structured-output support. Request JSON-only output, extract one JSON object, and validate locally. At most one repair request may be sent for malformed or schema-invalid JSON. General network retries are not automatic.

Conceptual response:

```json
{
  "action": {
    "type": "give_money",
    "target_id": "innkeeper",
    "amount": 2
  },
  "publicNarrative": "The traveller places two coins on the counter.",
  "spokenText": "Pour me an ale.",
  "spokenTargetId": "innkeeper",
  "memoryUpdates": {
    "recentMemoriesToAdd": [],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

`action` is `null` or one currently available formal action. Narrative, speech, action, and bounded memory updates may coexist in one response. The system prompt instructs the model to prefer `action: null` when no formal action clearly advances the character's goals and never to select an action merely because it is available.

The model must not claim that a selected formal action succeeded. Only the engine's normalized action result establishes objective consequences. No chain-of-thought, hidden reasoning, arbitrary world patch, arbitrary mind replacement, or executable code is accepted.

## 25. Validated memory updates

The model may request only these bounded operations:

- append a recent memory;
- upsert a belief by stable `id`;
- upsert a relationship by `targetCharacterId`.

The engine assigns unique IDs to new memories when the model does not provide one. Validate text length, importance range `0..1`, belief confidence, relationship targets, and per-turn count limits. Protected memories, known facts, long-term memories, and pending observations cannot be directly edited by the model.

Applying updates must use an engine-owned function and must be part of the turn transaction.

## 26. Combined intent commit and turn display

Human and AI controllers submit the same conceptual envelope: optional attempt-phase narrative plus at most one formal action. `CharacterAPI.submitIntent()` assigns an `interactionId`; only deterministic registry execution establishes the completed objective action result.

A successful major-location transition emits one `character_moved` event containing `fromLocationId` and `toLocationId`. Its recipients are the union of observers in the source and destination locations, so both sides receive the same full movement fact.

The browser composes **Latest turn** from canonical event recipients. Visibility is evaluated per emitted event rather than by snapshotting whether the reacting actor was visible at the start of the AI reaction. Off-screen reactions still mutate the world and reach AI recipients. A default-off **Show invisible events** checkbox may reveal current-turn suppressed presentation entries with an explicit debug-only marker; it never changes perception or simulation state.

## 27. Failure and rollback

On API error, missing key, malformed response after one repair, local schema rejection, or unexpected exception:

- do not consume the affected observations;
- do not remove the affected queue entry;
- do not apply model memory changes;
- do not fabricate model narrative or action;
- restore the failed reaction's pre-turn snapshot;
- stop the current full AI world tick;
- show a concise safe error and retain a retry path.

A human intent is committed before its automatic world tick. If a later AI request fails, the human action remains valid and successfully completed earlier AI reactions remain committed. Pending observations continue to accumulate across later HumanController turns and are available when AI processing resumes.

A high emergency guard stops a tick after 64 model decisions, preserves committed state, leaves unprocessed work pending, and reports a debug warning. It is corruption protection rather than gameplay pacing.

## 28. Debug and usage UI

The AI panel should show:

- key status without revealing the key;
- fixed provider plus the current validated model selection and raw model ID;
- next scheduler recipient, first-event preview, and queue length;
- `Stop automatic AI request processing`;
- default-off `Show invisible events` for current-turn suppressed presentation entries;
- `Process next AI event`;
- shared executor busy/cooldown information where useful;
- last safe error;
- last token usage and cost when returned by OpenRouter;
- optional transient request/response diagnostics, with credentials and user-scoped provider identifiers excluded.

Raw prompts and responses are never written to SugarCube state, game saves, world data, or
generated source files. They may appear in closure-owned transient diagnostics and in an
explicit user-requested exchange-log export after transport-layer sanitization.

## 29. Still out of scope

This integration does not add:

- timer-based or background NPC activity unrelated to a user-triggered Submit/Pass wave;
- initiative without pending observations;
- multiple actions in one turn;
- provider selection or arbitrary unvalidated model IDs;
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

OpenRouter failures attach a sanitized `providerResponse` containing the endpoint, HTTP status,
accessible diagnostic headers, retry information, raw body, parsed body, and provider metadata.
Sanitization occurs inside `src/22-openrouter-client.js` before the object is returned: API keys,
Authorization/Bearer values, `user_id` properties, and `user_...` identifier strings are
replaced. Provider diagnostics required for operation remain intact, including
`provider_name`, `limit_source`, error text, and retry hints.

`AIRequestExecutor` also keeps a closure-owned FIFO history of the latest 50 validated request
executions. Each entry records purpose, actor, stage, exact messages, available actions,
timestamps, duration, normalized result, raw content, usage, and the full initial/repair
trace. No transport client or credentials are retained.

The sphere exports a versioned `ai-rpg.ai-exchange-log` JSON document containing the focused
request/run, executor history, scheduler projection, and a minimal game summary. The export is
constructed from an explicit allow-list of debug data, redacts the current in-memory key,
OpenRouter/Bearer-shaped secrets, OpenRouter `user_id` fields, and `user_...` identifiers, and
fails rather than returning a file if the current key is still present. Transport-layer
sanitization is the primary boundary; export redaction is defense in depth. Import validates
schema, version, size, stage, messages, and action data before
loading the request into the sphere. Import never writes world state. Offline replay uses the
recorded raw attempt content as a mock client and routes it through the current `AIProtocol`
parser and validator; it does not call the network or commit actions, narrative, memory, or
observation consumption.
