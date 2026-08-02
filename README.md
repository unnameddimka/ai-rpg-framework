# AI RPG Framework POC

This repository is the framework-first rewrite of the original Twine tavern proof of concept.

The current version has no model calls. It provides a deterministic world, a shared Character API, inventories, movement, item and money transfers, confirmed events, and debug takeover of any character.

## Project layout

```text
src/story.twee          Twine passages and prose
src/10-game-api.js      World, ActionRegistry, CharacterAPI, invariants
src/20-controllers.js   Human, Dummy, and future AI controller shell
src/30-game-ui.js       Browser controls and character takeover UI
src/styles.css          Framework UI styles
docs/architecture.md    Current architecture
docs/status.md          Current implementation status
AGENTS.md                Instructions for Codex and other coding agents
tests/run-tests.js       Node test harness
build.bat                Windows Tweego build
```

The numeric JavaScript prefixes make the dependency order explicit when Tweego reads the source directory.

## Build on Windows

1. Install Tweego and make sure `tweego.exe` is on `PATH`.
2. Make sure Tweego can find the SugarCube story format.
3. Run:

```bat
build.bat
```

The output is:

```text
dist/game.html
```

Open that HTML file in a browser.

## Test without Tweego

```bat
test.bat
```

or:

```bash
node tests/run-tests.js
```

The tests verify the HumanController invariant, movement, inventory transfer, money transfer, rollback-safe validation, and controller switching.

## Development workflow

Edit the source files in VS Code. Treat generated `dist/game.html` as build output rather than the source of truth.

Codex should read `AGENTS.md` before modifying the project. The most important rule is that exactly one character is human-controlled, and switching control is performed only by `setup.Game.takeHumanControl()`.
