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
data/world.json         Authoritative location and sublocation data
editor/world-editor.html Standalone offline world editor
tools/generate-world-data.ps1 Build-time JSON embedder
docs/architecture.md    Current architecture
docs/status.md          Current implementation status
AGENTS.md                Instructions for Codex and other coding agents
tests/run-tests.js       Node test harness
build.bat                Windows Tweego build
```

The numeric JavaScript prefixes make the dependency order explicit when Tweego reads the source directory.

## World authoring workflow

`data/world.json` is the single authoritative source for major locations, exits, and
sublocations. `src/generated/world-data.js` and `src/generated/world-passages.twee` are
derived build files and must not be edited directly.

Administrator steps:

1. Send `editor/world-editor.html` and the current `data/world.json` to the author.
2. Receive the edited downloaded `world.json`.
3. Review the JSON diff.
4. Replace `data/world.json` in the repository.
5. Run `test.bat` and `build.bat`.

The build invokes a local PowerShell conversion step before tests and Tweego compilation.
The resulting `dist/game.html` embeds the spatial data and remains self-contained; it does
not fetch `world.json` at runtime.

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
