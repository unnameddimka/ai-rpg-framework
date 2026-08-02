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
- One generic physical `Location` passage rendered from the controlled character's restricted view.
- Dynamic location descriptions, nearby-character presence, interaction controls, and movement controls.
- Inline character interaction panel with validated, JSON-serializable target UI state.
- Public `presenceText` and interaction labels for the player, innkeeper, and hooded woman.
- Node tests.

## Not implemented

- AI/model requests.
- NPC memories and attitudes.
- AI event processing.
- Buying and selling.
- Item use effects.
- Combat.
- Ownership and theft rules.

## Known limitations

- Character interaction currently selects and describes a target but does not generate dialogue.
- The formal action panel remains a developer/debug interface below the player-facing view.
- Browser acceptance scenarios must still be checked manually when UI behavior changes.
