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
- `ai` — reserved for later and currently must not call a model.

### Critical HumanController invariant

Exactly one character must use `HumanController` at all times.

- Never assign `human` by writing into `world.control.assignments` directly.
- Switch human control only through `setup.Game.takeHumanControl(characterId)`.
- The switch must be atomic: construct and validate a candidate assignment map, then commit it once.
- Initial authoring data must specify exactly one initial human-controlled character.
- A character's fallback/default controller must not be `human`.
- Loading or initialization must validate and repair or reject zero-human and multiple-human states.
- Never assume the human-controlled character ID is `player`.

## Character descriptions and private data

- `playerDescription` is public player-facing prose. It may be shown to other human-controlled characters.
- `aiDescription` is private identity/personality/instruction data for a future AI controller. It must not appear in normal player-facing UI or another character's restricted view.
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
- `pendingObservations` — objective events and action feedback not yet interpreted by a future AI controller.

The current milestone must not:

- call a model;
- count tokens;
- summarize or compress memories;
- convert observations into beliefs automatically;
- invent attitudes or interpretations in engine code.

The engine may seed initial mind data and enqueue objective observations. Later controller-specific logic will interpret them.

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

## Restricted views and future context

- `setup.CharacterAPI.getView(actorId)` must expose only information currently available to that actor.
- It must never expose another character's `aiDescription`, `mind`, or `engineFacts`.
- `setup.ContextBuilder.build(actorId)` may prepare a JSON-serializable future-controller bundle, but it must not build a natural-language prompt, call an API, count tokens, or mutate state.
- The context bundle may include the actor's own `aiDescription`, own mind, restricted world view, granted abilities, available formal actions, and pending observations.

## Dynamic player-facing UI and passages

- Every major physical location has its own generated Twine passage.
- Passage names and the start passage are generated from validated `data/world.json` data.
- Do not use or restore the obsolete "one generic physical-location passage" architecture.
- Physical location prose, nearby-character presence, interaction links, and exits must be rendered from the restricted character view and runtime world state.
- Normal movement UI must call the registered `move` action through `setup.CharacterAPI.perform()`.
- Never show the controlled character as a nearby character or interaction target.
- Keep the formal action panel as a developer/debug interface below the player-facing view unless a later task replaces it.

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

- existing tavern entrance, bar, common room, and street;
- generated major physical passages;
- sublocations, capacity, reachability, table inventories, and behind-bar capability;
- inventories, wallets, movement, item transfer, money transfer, `place_item`, and `pour_ale`;
- confirmed events and restricted views;
- debug takeover of any character by the one HumanController;
- authorable characters, initial minds, and individual abilities;
- one sample grounded individual ability, `read_aura`.

Do not add yet:

- model/API calls or API-key UI;
- prompt construction;
- memory compression, token budgeting, embeddings, or vector search;
- autonomous NPC decisions;
- combat, health changes, or damage;
- buying and selling;
- item use effects or equipment;
- quests or dialogue trees;
- arbitrary author scripts.

## File placement

- Keep engine logic in `src/10-game-api.js` unless a small additional numerically prefixed engine module clearly improves separation.
- Keep controllers in `src/20-controllers.js`.
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
8. Update `docs/status.md` with implemented results and remaining limitations.
