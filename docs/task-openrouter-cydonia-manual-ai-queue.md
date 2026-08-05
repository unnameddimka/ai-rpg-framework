> Historical milestone note: this document specified the original fixed-Cydonia vertical slice.
> The current implementation supersedes only its fixed-model UI/client requirements with
> `docs/task-openrouter-model-list.md`; its scheduler, protocol, safety, and transaction rules
> remain applicable.

# Task: OpenRouter Cydonia Integration with a Manual AI Turn Queue

## 1. Objective

Connect the existing deterministic character framework to OpenRouter using the fixed model `thedrummer/cydonia-24b-v4.1`.

This is a narrow vertical slice. It must prove that a stateless model can:

1. receive one character's restricted identity, mind, current view, pending observations, abilities, and available actions;
2. choose no formal action or one formal action;
3. receive the engine-grounded result of that action when needed;
4. produce player-visible narrative and bounded memory updates;
5. preserve deterministic engine authority and SugarCube saveability.

The user advances AI characters manually through one global queue button. Do not add a character picker or automatic AI loop.

## 2. Required reading

Before editing code, read:

- `AGENTS.md`;
- `docs/architecture.md`;
- `docs/status.md`;
- `src/10-game-api.js`;
- `src/20-controllers.js`;
- `src/30-game-ui.js`;
- `data/world.json`;
- all existing tests.

Preserve all existing behavior, especially `read_aura`, restricted views, event routing, atomic HumanController takeover, editor operation, and build generation.

## 3. Scope boundaries

Implement only:

- fixed OpenRouter provider;
- fixed Cydonia model;
- user-entered API key;
- optional 24-hour localStorage key persistence;
- permanent character `defaultControllerId` semantics;
- a deterministic saved AI-turn queue;
- one global `Take next AI turn` action;
- one-stage no-action turns;
- two-stage formal-action turns;
- JSON extraction, local validation, and at most one repair request;
- bounded memory updates;
- safe errors, rollback, and transient debug/usage output.

Do not implement:

- automatic queue draining;
- timers or autonomous initiative;
- model/provider selection;
- streaming;
- multiple formal actions in one AI turn;
- memory compression or token budgeting;
- embeddings or vector search;
- editable ability effects or JavaScript in `world.json`;
- new gameplay systems.

## 4. Controller defaults and HumanController override

### 4.1 Permanent default

`defaultControllerId` is the character's permanent nonhuman controller for this world definition. Normal play does not change it.

HumanController is only a temporary override. When human control moves from A to B:

```text
A assignment = A.defaultControllerId
B assignment = human
```

Do not add `controllerBeforeHuman`, controller stacks, or runtime default-controller editing.

### 4.2 Initial sample data

Update sample world data so the AI integration can be exercised immediately:

- `player`: `initialControllerId: human`, `defaultControllerId: ai`;
- `hoodedWoman`: `initialControllerId: ai`, `defaultControllerId: ai`;
- `innkeeper`: keep `dummy` unless a test explicitly needs another AI observer.

The editor must continue allowing only `dummy` or `ai` as defaults and exactly one initial human assignment.

### 4.3 Releasing a human-controlled AI-default character

When HumanController leaves a character and that character returns to `ai`, enqueue it when it has one or more pending observations. Do not execute a turn automatically.

## 5. AI queue state

Add a JSON-serializable runtime structure under the world, for example:

```js
world.ai = {
  turnQueue: []
};
```

Do not store Sets, Maps, functions, promises, request objects, or controller instances in the world.

Provide engine-owned queue methods, conceptually:

```js
setup.AITurnQueue.enqueue(characterId, reason)
setup.AITurnQueue.peek()
setup.AITurnQueue.remove(characterId)
setup.AITurnQueue.getStatus()
setup.AITurnQueue.repair()
```

Names may differ, but there must be one clear API.

### 5.1 Eligibility

A character is eligible only when:

- it exists and is a character;
- its current controller assignment is `ai`;
- it has at least one `mind.pendingObservations` record.

Human and dummy characters never execute through the AI queue.

### 5.2 Deduplication

A character may appear at most once in the queue. New observations accumulate in its inbox without duplicate queue entries.

### 5.3 Ordering

When one event has multiple observers, enqueue eligible recipients in this priority:

1. direct addressee;
2. formal-action target;
3. other perceiving AI characters in existing deterministic recipient order.

Do not move an already queued character to the end or duplicate it.

### 5.4 Stale entries

Before rendering or executing the head, skip/remove entries that are no longer eligible because the character became human/dummy, disappeared, or has no pending observations.

### 5.5 Save/load

The queue survives SugarCube save/load. Runtime validation and repair must remove invalid or duplicate entries without changing valid order.

## 6. Global queue UI

Add one AI panel in the normal debug/sidebar interface. Do not render one button per character and do not add a character selector.

When the queue has an eligible head:

```text
Next AI turn: Hooded woman
Pending AI characters: 2
[Take next AI turn]
```

When empty:

```text
No pending AI turns
```

The button:

- processes only the current head;
- is disabled while an AI request is in flight;
- is disabled when no API key is available;
- never automatically continues to the next character;
- rerenders queue status after success, failure, controller switch, and save/load initialization.

## 7. AI settings and API-key storage

Add an `AI Settings` UI containing:

```text
Provider: OpenRouter
Model: Cydonia 24B V4.1
API key: [password field]
[ ] Remember for 24 hours
[Save settings]
[Forget saved key]
```

Provider and model are fixed labels, not selectors.

### 7.1 Runtime storage

Keep the live key in a browser-only transient object outside SugarCube state, for example `setup.AIRuntimeSettings` or a closure-owned module object.

Do not store it in `State.variables`, `world`, `frameworkUI`, passage variables, setup data copied into saves, controller logs, or DOM data attributes.

### 7.2 Optional 24-hour localStorage record

Use a namespaced localStorage key, such as:

```text
aiRpg.openRouterKey.v1
```

Store:

```json
{
  "apiKey": "sk-or-...",
  "expiresAt": 1234567890
}
```

Rules:

- `expiresAt = Date.now() + 24 hours`;
- reject malformed records;
- delete expired records on read;
- `Forget saved key` removes localStorage and clears the in-memory key;
- if localStorage throws or is unavailable under `file://`, retain the key only in memory and show a nonfatal warning;
- never use cookies;
- never display the whole persisted key after save.

### 7.3 Secret-leak tests

Use a sentinel fake key in tests and verify it does not appear in:

- JSON serialization of `State.variables.world`;
- a SugarCube-compatible save-state fixture;
- `ContextBuilder` output;
- controller logs;
- copied debug context;
- generated files;
- safe error messages.

## 8. OpenRouter client

Create a small browser-side client module loaded before the UI. Use raw `fetch`; do not add npm dependencies or a server.

Request:

```text
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <key>
Content-Type: application/json
```

Optional OpenRouter attribution headers may be omitted for `file://`.

Fixed request properties:

- model: `thedrummer/cydonia-24b-v4.1`;
- stream: `false`;
- a bounded `max_tokens` suitable for concise JSON;
- temperature stored as a code constant, not a user setting.

Do not add web search or other plugins. Do not assume native strict JSON-schema support.

Return a normalized client result containing status, assistant content, usage when present, and a safe error. Never put the key or Authorization header in returned diagnostics.

Handle at least:

- missing key;
- network/CORS failure;
- HTTP 401;
- HTTP 402;
- HTTP 429;
- other 4xx;
- provider 5xx;
- malformed OpenRouter response.

No automatic network retry in this milestone.

## 9. Prompt/protocol adapter

Keep `setup.ContextBuilder.build(actorId)` pure. Add a separate adapter that turns its JSON bundle and a bounded observation snapshot into messages.

The model must be told:

- it controls exactly the supplied character;
- objective facts come only from supplied context and engine results;
- narrative cannot mutate the world;
- it may choose at most one available formal action;
- it must not invent hidden information or action success;
- it must return JSON only;
- it must not output chain-of-thought or hidden reasoning;
- action parameters must use IDs/options from `availableActions`;
- no arbitrary world or mind patches are allowed.

The prompt must include only restricted actor data. Never include another character's `aiDescription`, mind, or engineFacts.

## 10. Decision response schema

Accept this conceptual structure:

```json
{
  "action": null,
  "publicNarrative": null,
  "spokenText": null,
  "memoryUpdates": {
    "recentMemoriesToAdd": [],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

### 10.1 No-action response

When `action` is null:

- narrative, speech, and memory updates are final;
- after validation, commit them and consume the snapshotted observations.

The AI may choose silence/no visible response by returning null narrative and null speech. That still counts as a successful processed turn when the JSON is valid.

### 10.2 Action response

When `action` is non-null:

- it must be one JSON action object with a string `type`;
- it must refer to a currently available formal action;
- stage-one memory updates must be empty;
- stage-one text may describe only intention or attempt and must not assert an unconfirmed outcome;
- do not commit stage-one text until the full two-stage transaction succeeds.

Reject multiple actions, arrays of actions, arbitrary patches, unknown protocol fields that alter semantics, and executable content.

## 11. JSON extraction, validation, and one repair request

Implement local extraction that can handle a JSON object wrapped in a markdown code fence, but do not accept mixed prose plus ambiguous multiple objects.

Validate locally against explicit code-owned schemas.

When parsing or validation fails:

1. send at most one repair request containing the invalid response and the expected schema;
2. require JSON only;
3. validate again;
4. on second failure, abort without changing game state.

Do not repair semantic engine failures such as an unavailable action by asking the model repeatedly. A formal action failure is a grounded result for stage two.

## 12. One-stage transaction

For an action-null turn:

1. snapshot the queue head and pending observation IDs;
2. build context;
3. call OpenRouter;
4. parse/repair/validate;
5. apply bounded memory updates;
6. submit model narrative through `CharacterAPI.narrate()` when any visible text exists;
7. remove only consumed observation IDs;
8. remove the actor from the queue;
9. validate the world and commit/rerender.

If any step fails, restore the pre-turn world and retain the queue head and observations.

## 13. Two-stage grounded action transaction

For an action-taking turn:

1. snapshot or clone the full pre-turn world;
2. snapshot the actor's current pending observation IDs;
3. perform the chosen action through `CharacterAPI.perform(actorId, action)`;
4. capture the normalized result, including failure feedback;
5. collect IDs of actor feedback observations created by that action;
6. send a second result-stage request containing the chosen action and exact normalized result;
7. parse/repair/validate the result-stage response;
8. apply final narrative and bounded memory updates;
9. consume the original observation IDs and action-feedback observation IDs actually supplied to stage two;
10. remove the actor from the queue;
11. keep newly generated unrelated observations and any newly queued recipients;
12. validate and commit.

If the second request or final validation fails, restore the complete pre-turn world. No formal action mutation, event, feedback, narrative, memory update, or queue change may remain.

A failed formal action is not a transaction failure. Its normalized failure result is sent to stage two so the character can react to the grounded failure.

## 14. Result-stage response schema

Conceptual structure:

```json
{
  "publicNarrative": null,
  "spokenText": null,
  "memoryUpdates": {
    "recentMemoriesToAdd": [],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

It may not choose another formal action.

## 15. Bounded memory update API

Add one engine-owned validator/applier. Controllers must not mutate `character.mind` directly.

Support only:

### Recent memory append

```json
{
  "summary": "The traveller warned me about the guard.",
  "importance": 0.8
}
```

The engine assigns a stable unique ID and `protected: false`. Enforce nonempty bounded text and importance from `0` through `1`.

### Belief upsert

```json
{
  "id": "belief_traveller_knows_magic",
  "text": "The traveller may know forbidden magic.",
  "confidence": "medium"
}
```

Allow only valid stable IDs and confidence `low|medium|high`.

### Relationship upsert

```json
{
  "targetCharacterId": "player",
  "summary": "I regard the traveller with cautious curiosity."
}
```

The target must exist and not be the actor.

Add conservative per-turn limits for record count and text length. Reject the whole memory-update payload when any record is invalid.

Do not allow model edits to:

- `knownFacts`;
- `longTermMemories`;
- protected memories;
- `pendingObservations`;
- physical state;
- abilities;
- controllers;
- engine facts.

## 16. Model narrative

Combine `publicNarrative` and `spokenText` into a clear narrative event, while preserving which text is speech if the current narrative API supports structured metadata.

All accepted AI narrative must pass through `CharacterAPI.narrate()` and follow existing visibility rules. Do not append raw HTML. Escape model text in all UI surfaces.

If both values are null/empty, do not create a narrative event.

## 17. Observation consumption

Never clear `pendingObservations` wholesale.

At turn start, snapshot observation IDs. On success, remove only IDs supplied to and processed by that turn. In a two-stage turn, also remove actor feedback observation IDs explicitly supplied to stage two. Preserve observations created independently after the snapshot.

On any failure, consume nothing.

## 18. Queue effects of AI narrative/actions

AI formal actions and narrative may create observations for other AI-controlled characters. Enqueue those recipients through the same normal routing rules.

Do not execute them automatically. After one successful turn, the UI shows the next eligible queue head.

Do not immediately requeue the actor merely for observing its own narrative/action. Existing self-recipient exclusions should remain. If the actor still has unconsumed observations after success, it may be queued once at the tail.

## 19. Errors and rollback

Expose concise player-safe messages:

- API key missing;
- authentication failed;
- insufficient OpenRouter credits;
- rate limited;
- provider unavailable;
- browser/network/CORS failure;
- model returned invalid JSON;
- model selected invalid protocol data;
- unexpected transaction failure.

Do not include the API key, Authorization header, full request headers, OpenRouter `user_id`, or other user-scoped provider identifiers in the visible error. Preserve sanitized provider diagnostics needed to distinguish authentication, credit, shared upstream rate-limit, provider, and network failures.

Store only the latest safe error in transient UI state.

## 20. Debug and usage information

Transient browser-only debug state may retain:

- last restricted context;
- last messages sent to the model;
- last raw assistant content;
- last parsed response;
- last usage data;
- last safe error.

Never save this data into SugarCube. Always redact Authorization data, API keys, OpenRouter `user_id` properties, and `user_...` identifiers before diagnostics enter traces or exports. Keep non-secret fields such as HTTP status, `provider_name`, `limit_source`, retry hints, and provider error text.

Show token usage and reported cost when present. Do not implement local token counting or cost estimation.

Useful controls:

- `Copy AI context`;
- `Show last model response`;
- `Clear transient AI debug`.

These are optional if they threaten scope, but queue status, safe errors, and usage are required.

## 21. Source organization

Recommended separation:

```text
src/10-game-api.js          deterministic world, queue hooks, memory update API
src/20-controllers.js       AIController orchestration entry point
src/21-ai-settings.js       transient key/settings and 24-hour localStorage
src/22-openrouter-client.js browser fetch client
src/23-ai-protocol.js       prompt building, parsing, validation, repair
src/30-game-ui.js           settings, queue button, status, usage/errors
```

Exact filenames may differ, but preserve deterministic numeric source order and keep network/secrets out of engine state.

## 22. Required tests

Add deterministic unit tests with mocked fetch. Tests must never call the live OpenRouter API.

### Controller defaults

- leaving player control returns the previous character directly to `defaultControllerId`;
- no `controllerBeforeHuman` state exists;
- AI-default character with pending observations is queued when released;
- dummy-default character is not queued when released.

### Queue

- direct target before other observers;
- deduplication;
- stable existing order;
- stale entries removed;
- queue survives JSON serialize/parse;
- queue repair removes invalid/duplicate IDs;
- one button call processes only one actor.

### Key storage

- memory-only mode;
- 24-hour expiry timestamp;
- expired/malformed localStorage removed;
- forget clears both stores;
- localStorage failure degrades to memory-only;
- sentinel key never enters saveable/debug/game data.

### OpenRouter client

- correct endpoint, Bearer header, fixed model, non-streaming request;
- 401, 402, 429, 5xx, malformed body, and network failure normalization;
- key absent from normalized errors.

### Protocol

- valid no-action decision;
- valid action decision;
- multiple actions rejected;
- action-stage memory update rejected;
- fenced JSON extraction;
- malformed JSON triggers exactly one repair;
- second invalid response aborts;
- no chain-of-thought field or arbitrary patch accepted.

### Transactions

- successful one-stage narrative/memory turn;
- successful two-stage action turn;
- failed formal action still reaches result stage;
- result-stage API failure restores complete pre-action world;
- memory-validation failure restores world;
- only consumed observation IDs removed;
- new unrelated observations preserved;
- queue head preserved on failure and removed on success;
- other AI recipients generated by the turn are queued but not executed.

### UI

- no character picker;
- correct queue-head label;
- button disabled with empty queue, missing key, or in-flight request;
- fixed provider/model display;
- password input;
- safe error and usage rendering;
- no raw HTML injection from model output.

Run all existing test suites as well.

## 23. Manual acceptance scenarios

### Scenario A: enter and remember key

1. Open built `dist/game.html` through `file://`.
2. Enter an OpenRouter key.
3. Enable `Remember for 24 hours`.
4. Reload and verify key status is restored without displaying the full key.
5. Use `Forget saved key` and verify the key is gone.

### Scenario B: queue a reaction

1. Ensure hoodedWoman uses `ai`.
2. Move the human-controlled player into the common room.
3. Submit narrative visible to the hooded woman.
4. Verify the panel shows `Next AI turn: Hooded woman`.
5. Press `Take next AI turn`.
6. Verify only one AI character acts and control returns to the user.

### Scenario C: grounded read aura

1. Give an AI-controlled character the `readAura` ability.
2. Queue that character through a perceived event.
3. Press `Take next AI turn` until Cydonia selects `read_aura`, or use a mocked/manual protocol fixture in debug mode.
4. Verify the engine performs `read_aura`.
5. Verify the second request receives actual Hidden aura feedback.
6. Verify final narrative does not expose private feedback to unrelated characters unless the model chooses to say something publicly.

### Scenario D: rollback

1. Mock or force a valid formal action decision.
2. Fail the second request.
3. Verify inventories, wallets, location, events, feedback, memory, queue, and observations exactly match the pre-turn world.

### Scenario E: HumanController override

1. Take human control of hoodedWoman.
2. Give the player pending observations while player is temporarily AI-controlled.
3. Switch human control back to player.
4. Verify hoodedWoman returns to `ai`, player becomes human, and any eligible released AI character is queued rather than executed.

## 24. Completion requirements

Before completion:

1. run `node --check` on all JavaScript;
2. run `node tests/run-tests.js`;
3. run `node tests/run-ui-tests.js`;
4. run `node tests/run-editor-tests.js`;
5. run generator tests on Windows/PowerShell;
6. run `test.bat`;
7. run `build.bat`;
8. manually execute the acceptance scenarios possible without spending live credits;
9. perform one explicitly user-initiated live OpenRouter smoke test only when a real key is entered in the built game;
10. update `README.md` with key entry, queue usage, security limitations, and troubleshooting;
11. update `docs/status.md` with implemented behavior and remaining limitations.

Do not mark the task complete while any existing deterministic test is broken or while a failed second-stage request can leave partial world mutation.
