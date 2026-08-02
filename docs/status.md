# Project Status

## Implemented

- Existing locations preserved: tavern entrance, bar, common room, street.
- Shared objective world in SugarCube state.
- Character and location inventories.
- Mug of ale and cleaning rag test items.
- Wallets.
- Registered actions:
  - `move`
  - `take_item`
  - `drop_item`
  - `give_item`
  - `give_money`
- Confirmed world event history.
- Restricted per-character view.
- HumanController.
- DummyController that takes no actions and writes debug logs.
- AIController placeholder with no model integration.
- Debug UI for taking human control of any character.
- Atomic enforcement that exactly one HumanController exists.
- Node tests.

## Not implemented

- AI/model requests.
- NPC memories and attitudes.
- AI event processing.
- Buying and selling.
- Item use effects.
- Combat.
- Ownership and theft rules.

## Next sensible task

Build the project with Tweego on the development machine, inspect the browser UI, and fix any SugarCube/Tweego integration issues before adding more mechanics.
