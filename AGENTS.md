# AI RPG Repository Instructions

## Architectural authority

- The deterministic game engine owns objective world state.
- Controllers choose intentions; they never mutate world state or character mind directly.
- All formal actions must pass through `setup.CharacterAPI.perform()`.
- Free narrative input must pass through `setup.CharacterAPI.narrate()` and must not create objective facts by itself.
- `ActionRegistry` is the single source of truth for executable formal action mechanics.
- A formal action may mutate the world, emit public events, return private actor feedback, do any combination of those, or fail with grounded feedback.
- Do not split physical and perceptual actions into separate execution systems.

## Static authoring data and runtime state

- `data/world.json` is the authoritative authoring source for locations, sublocations, characters, initial character minds, and character ability definitions.
- `src/generated/world-data.js`, generated physical passages, generated StoryData, and `dist/game.html` are build outputs. Never edit them directly.
- Authoring data is copied into JSON-serializable runtime state at new-game initialization.
- Runtime character state, including `mind`, must live inside `State.variables.world` so SugarCube saves restore it with the rest of the world.
- Never store functions, controller objects, class instances, DOM nodes, promises, API clients, or other non-serializable values in SugarCube state.

## Characters and controllers

The controller types are:

- `human` — receives commands from the browser UI;
- `dummy` — performs no autonomous actions and may write debug logs;
- `ai` — uses the browser-side OpenRouter adapter and the fixed Cydonia model only when a manual queued AI turn is requested.

### Critical HumanController invariant

Exactly one character must use `HumanController` at all times.

- Never assign `human` by writing into `world.control.assignments` directly.
- Switch human control only through `setup.Game.takeHumanControl(characterId)`.
- The switch must be atomic: construct and validate a candidate assignment map, then commit it once.
- Initial authoring data must specify exactly one initial human-controlled character.
- A character's persistent `defaultControllerId` must not be `human`. HumanController is only a temporary override. When human control leaves a character, that character must return directly to its authored `defaultControllerId`. Do not store or restore a `controllerBeforeHuman` value.
- Loading or initialization must validate and repair or reject zero-human and multiple-human states.
- Never assume the human-controlled character ID is `player`.
- Do not change `defaultControllerId` during normal play in this milestone. A future scripted controller may remain a character's permanent default for the whole game.

## Character descriptions and private data

- `playerDescription` is public player-facing prose. It may be shown to other human-controlled characters.
- `aiDescription` is private identity/personality/instruction data for a AI controller. It must not appear in normal player-facing UI or another character's restricted view.
- `engineFacts` contains objective hidden data used only by formal mechanics. It must not be exposed merely because a controller asks for a view or context.
- A formal action such as `read_aura` may reveal a specific hidden fact through private grounded feedback.

## Character mind

Each runtime character owns a JSON-serializable `mind` object. The mind belongs to the character, not to its current controller, and survives Human/Dummy/AI controller switching.

Required conceptual partitions:

- `knownFacts` — facts the character currently accepts;
- `beliefs` — subjective conclusions or uncertain claims;
- `relationships` — character-specific relationship summaries;
- `recentMemories` — detailed recent memories;
- `longTermMemories` — older or already compressed memories;
- `pendingObservations` — objective events and action feedback not yet interpreted by a AI controller.

The AI controller may interpret a bounded snapshot of `pendingObservations` during an explicitly requested queued AI turn. The deterministic engine must never invent attitudes or interpretations itself.

The current milestone still must not:

- count tokens or implement token-budget policies;
- summarize or compress memories;
- use embeddings or vector search;
- run autonomous or time-based NPC loops.

Validated AI memory updates may append recent memories and upsert beliefs or relationships only through a dedicated engine-owned function. The model never receives direct mutation access to `mind`.

## Formal action availability

The available formal action set for a character is the deduplicated union of:

1. engine-defined base action types;
2. action types granted by the current sublocation's `capabilities`;
3. action types granted by the character's individual `abilityIds` through the ability catalog.

Rules:

- A registered action is not automatically available merely because it exists in `ActionRegistry`.
- `getAvailableActions()` must expose why an action is available.
- `perform()` must reject actions not currently granted to the actor.
- Action definition validation still checks targets, reachability, inventory access, capacity, and other dynamic preconditions.
- Character abilities grant access to actions; they do not contain executable JavaScript.
- Player-facing ability controls must be derived from the currently human-controlled character's assigned abilities and current `available_actions`; never hardcode a character ID such as `hoodedWoman`.
- For this milestone, the normal player-facing UI supports assigned zero-input abilities. The first supported action is `read_aura`.
- `read_aura` accepts no target parameter. It scans all other characters currently perceivable to the actor and returns their authored hidden aura values as private grounded feedback.
- Private feedback returned to the human-controlled actor must be shown immediately in the normal player-facing UI, not only in debug JSON or `mind.pendingObservations`.

## Formal action results and observations

Every `perform()` call must return one normalized JSON-serializable result shape containing, as applicable:

- `ok`;
- the attempted action;
- confirmed public/private events;
- private grounded `feedback` entries for specific recipients;
- an error code and message on failure.

Private feedback must be routed into the recipient character's `mind.pendingObservations`.

Examples include:

- a successful physical action that also reveals something tactile;
- a failed attempt that reveals a locked door or unreachable object;
- `read_aura`, which may change no world state and primarily returns private feedback.

Narrative output remains separate. A model or human may describe an attempt, but only a successful formal action result establishes objective consequences or hidden information.

## Restricted views and AI context

- `setup.CharacterAPI.getView(actorId)` must expose only information currently available to that actor.
- It must never expose another character's `aiDescription`, `mind`, or `engineFacts`.
- `setup.ContextBuilder.build(actorId)` remains a pure JSON-serializable restricted-data projection. It must not call an API, count tokens, acknowledge observations, or mutate state.
- A separate AI prompt/protocol adapter may serialize that bundle for OpenRouter.
- The context bundle may include the actor's own `aiDescription`, own mind, restricted world view, granted abilities, available formal actions, and pending observations.


## AI turn queue and controller integration

- AI turns are manual in this milestone. The sidebar exposes one `Process next AI event` control, never a character picker. The temporary sphere may inspect the whole queue, but only the queue head may be processed live.
- Objective events and feedback may enqueue eligible characters whose current controller assignment is `ai`.
- The queue must be deterministic, JSON-serializable, saveable with SugarCube, and deduplicated by character ID.
- Direct addressees and formal-action targets are enqueued before other perceiving AI characters; remaining order follows deterministic event delivery order.
- A queued entry is eligible only while that character is currently assigned `ai` and has pending observations. Skip or remove stale entries.
- When HumanController leaves a character and that character returns to `defaultControllerId: "ai"`, enqueue it if it already has pending observations.
- Do not enqueue a human-controlled or dummy-controlled character.
- One scheduler invocation processes at most one queued character and at most one formal action.
- `setup.AITurnScheduler` owns queue-head selection and exact decision-request construction. It has no timer yet.
- `setup.AIRequestExecutor` is the only path for game, repair, and prompt-lab model requests. It serializes calls, leaves at least one second between live transports, and honors `Retry-After` without automatically retrying a 429.
- A failed API call, invalid model response, or failed transaction must preserve the queue entry and all unconsumed observations for retry.

## OpenRouter and API-key rules

- The game calls OpenRouter directly from the browser through `POST https://openrouter.ai/api/v1/chat/completions`.
- The fixed model for this milestone is `thedrummer/cydonia-24b-v4.1`.
- Streaming is disabled. Do not add provider selection or model selection yet.
- The API key is entered in the game UI. It must never enter `world.json`, generated files, SugarCube state, saves, exported data, controller logs, request-debug dumps, or error text.
- Without opt-in persistence, the key exists only in a non-SugarCube runtime object for the lifetime of the page.
- `Remember for 24 hours` stores a record in `localStorage` with an explicit expiry timestamp. Expired records are deleted when read. Provide `Forget saved key`.
- If `localStorage` is unavailable under `file://`, keep the key in memory and show a nonfatal warning.
- Do not use cookies.

## AI response and transaction safety

- Never treat model prose as objective world state.
- Parse and locally validate model JSON. Do not depend on native provider strict-schema support.
- Permit at most one repair request for malformed or schema-invalid JSON. No general automatic retries.
- An AI turn may return no formal action. If it returns an action, pass that action through `setup.CharacterAPI.perform()` exactly like a human action.
- If a formal action is attempted, provide the normalized grounded result to a second model call before accepting final reaction text or memory updates. Both calls together are one AI turn.
- Hold all model-produced narrative and memory changes until the complete turn succeeds. Avoid partial commits.
- Apply public narrative only through `setup.CharacterAPI.narrate()`.
- Apply model memory changes only through an engine-owned validator supporting bounded append/upsert operations.
- Remove only observation IDs actually consumed by a successfully committed turn. Never clear an entire inbox blindly.
- Raw request and response bodies may be kept only in transient debug memory and must be redacted of credentials.

## Dynamic player-facing UI and passages

- Every major physical location has its own generated Twine passage.
- Passage names and the start passage are generated from validated `data/world.json` data.
- Do not use or restore the obsolete "one generic physical-location passage" architecture.
- Physical location prose, nearby-character presence, interaction links, and exits must be rendered from the restricted character view and runtime world state.
- Normal movement UI must call the registered `move` action through `setup.CharacterAPI.perform()`.
- Never show the controlled character as a nearby character or interaction target.
- Keep the formal action panel as a developer/debug interface below the player-facing view.
- Assigned character abilities are an exception: currently available zero-input abilities must also appear as normal player-facing controls above the debug panel.

## World editor

- `editor/world-editor.html` must remain one self-contained offline English-only HTML file.
- It must work through `file://` and import/export only `world.json`.
- The author must not need Node, npm, PowerShell, Tweego, a server, VS Code, or a terminal.
- The editor may assign known engine actions and character abilities, but must never accept executable code.
- Preserve unknown JSON properties whenever practical.
- Block export on structural errors with human-readable English messages.

## Hard validation rules

Validate in the editor, build generator, and runtime where applicable:

- unique major-location passage names;
- a valid `startLocationId` whose passage is generated as the SugarCube start passage;
- globally unique inventory IDs across locations, sublocations, and characters;
- valid character location and sublocation references;
- exactly one initial human-controlled character;
- valid ability references;
- ability `actionType` values that exist in the known engine action allowlist/registry;
- no deleted location, sublocation, character, or ability still referenced by another record.

## Current scope

Implement and preserve:

- existing tavern entrance, bar, common room, street, and the temporary village-temple prompt-lab room;
- generated major physical passages;
- sublocations, capacity, reachability, table inventories, and behind-bar capability;
- inventories, wallets, movement, item transfer, money transfer, `place_item`, and `pour_ale`;
- confirmed events and restricted views;
- debug takeover of any character by the one HumanController;
- authorable characters, initial minds, and individual abilities;
- one sample grounded individual ability, `read_aura`;
- direct browser OpenRouter integration with fixed Cydonia;
- one deterministic saved AI turn queue, a manual `AITurnScheduler`, and a `Process next AI event` control;
- validated one- or two-stage AI turns and bounded memory updates;
- 24-hour optional local API-key persistence outside SugarCube.

Do not add yet:

- autonomous or timer-driven NPC execution;
- model/provider selection;
- memory compression, token budgeting, embeddings, or vector search;
- combat, health changes, or damage;
- buying and selling;
- item use effects or equipment;
- quests or dialogue trees;
- arbitrary author scripts.

## File placement

- Keep engine logic in `src/10-game-api.js` unless a small additional numerically prefixed engine module clearly improves separation.
- Keep controller behavior in `src/20-controllers.js`.
- Put the browser-only OpenRouter client, prompt/protocol parsing, shared request executor, manual turn scheduler, transient AI settings, and prompt-lab state in small numerically prefixed source modules before `src/30-game-ui.js`; do not place secrets or promises in SugarCube state.
- Keep browser/debug UI in `src/30-game-ui.js`.
- Keep hand-authored non-generated Twee metadata and nonphysical passages in `src/story.twee`.
- Keep authoritative authoring data in `data/world.json`.
- Keep the standalone editor in `editor/world-editor.html`.
- Preserve deterministic source ordering.

## Validation before completion

1. Run `node --check` on every JavaScript file.
2. Run `node tests/run-tests.js`.
3. Run `node tests/run-editor-tests.js`.
4. Run the PowerShell world-data generator.
5. Build with Tweego when installed.
6. Verify `setup.Game.validateWorld()` succeeds after all tested actions.
7. Verify a JSON serialize/parse round trip preserves every character mind.
8. Test queue ordering, deduplication, stale-entry handling, scheduler request projection, executor serialization/minimum interval, successful one-stage turns, successful two-stage turns, malformed JSON repair, failed-request rollback, consumed-observation removal by ID, and 24-hour key expiry.
9. Verify no API key appears in a save, world dump, generated artifact, debug log, or copied AI context.
10. Update `README.md` and `docs/status.md` with implemented results and remaining limitations.
