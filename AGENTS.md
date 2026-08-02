# AI RPG Repository Instructions

## Architectural authority

- The game engine owns objective world state.
- Controllers return decisions; they never mutate world state directly.
- All formal mutations must pass through `setup.CharacterAPI.perform()`.
- Narrative input must pass through `setup.CharacterAPI.narrate()`.
- `ActionRegistry` is the single source of truth for formal actions.

## Controllers

The controller types are:

- `human` — receives commands from the browser UI;
- `dummy` — performs no autonomous actions and may write debug logs;
- `ai` — reserved for later and currently not implemented.

### Critical invariant

Exactly one character must use `HumanController` at all times.

- Never assign `human` by writing into `world.control.assignments` directly.
- Switch human control only through `setup.Game.takeHumanControl(characterId)`.
- The switch must be atomic: construct and validate a candidate assignment map, then commit it once.
- Generic controller assignment must reject attempts to create zero or multiple human-controlled characters.
- Loading or initialization must validate the invariant and repair invalid legacy/debug state to one human-controlled character.

## Dynamic player-facing UI

- Physical location prose, nearby-character presence, interaction links, and exit links must be derived from the current restricted character view and `World` state.
- Do not hard-code physical exits or NPC-specific interaction links in `story.twee`.
- Normal movement UI must call the registered `move` action through `setup.CharacterAPI.perform()` or a wrapper that does exactly that.
- Never assume the human-controlled actor ID is `player`; always use `setup.Game.getHumanCharacterId()`.
- Never show the controlled character as a nearby character or interaction target.
- Keep the API/action table as a debug interface below the player-facing dynamic view.
- Use one generic physical-location passage and one generic interaction surface unless a later architecture decision explicitly changes this.

## Current scope

Implement and preserve:

- the existing tavern entrance, bar, common room, and street locations;
- inventories owned by characters and locations;
- `move`, `take_item`, `drop_item`, `give_item`, and `give_money`;
- confirmed world events;
- restricted character views;
- debug takeover of any character by the one HumanController.

Do not add yet:

- combat, health changes, or damage;
- buying and selling;
- item use effects or equipment;
- model/API calls;
- autonomous scripted NPC behaviour.

## Twine and JavaScript

- Keep story prose and passages in `src/story.twee`.
- Keep engine logic in `src/10-game-api.js`.
- Keep controllers in `src/20-controllers.js`.
- Keep browser/debug UI in `src/30-game-ui.js`.
- Keep SugarCube state JSON-serializable; do not store functions or class instances in `State.variables`.
- Preserve the numeric filename prefixes unless the build order is replaced by an explicit bundler.

## Validation

Before completing a change:

1. Run `node --check` on every JavaScript file.
2. Run `node tests/run-tests.js`.
3. Build with Tweego when it is installed.
4. Verify that `setup.Game.validateWorld()` succeeds after the tested actions.
