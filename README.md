# AI RPG Framework POC

This repository is the framework-first rewrite of the original Twine tavern proof of concept.

The current version has no model calls. It provides a deterministic world, authored characters and abilities, saved per-character minds, grounded observations, restricted context bundles, a shared Character API, inventories, movement, item and money transfers, confirmed events, and debug takeover of any character.

Assigned zero-input abilities are also usable from the normal player-facing location view.
The controls are derived from the character currently under HumanController and from that
character's live action grants; they do not depend on a particular character ID. The sample
`readAura` ability performs a targetless scan of all other characters currently perceivable
to the actor and immediately displays its structured private results. Switching control
keeps each character's displayed private result isolated from the others.

## Project layout

```text
src/story.twee          Twine passages and prose
src/10-game-api.js      World, ActionRegistry, CharacterAPI, invariants
src/20-controllers.js   Human, Dummy, and future AI controller shell
src/30-game-ui.js       Browser controls and character takeover UI
src/styles.css          Framework UI styles
data/world.json         Authoritative locations, characters, minds, and abilities
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

`data/world.json` (schema version 2) is the single authoritative source for the start
location, major locations, sublocations, characters, initial minds, controller defaults,
hidden engine facts, and individual ability grants. The editor exposes separate Locations,
Characters, and Abilities sections and blocks structurally invalid downloads.

`src/generated/world-data.js`, `src/generated/world-passages.twee`, and
`src/generated/world-storydata.twee` are derived build files and must not be edited directly.

Administrator steps:

1. Send `editor/world-editor.html` and the current `data/world.json` to the author.
2. Receive the edited downloaded `world.json`.
3. Review the JSON diff.
4. Replace `data/world.json` in the repository.
5. Run `test.bat` and `build.bat`.

The build invokes a local PowerShell validation/generation step before tests and Tweego
compilation. The resulting `dist/game.html` embeds the world data and remains self-contained; it does
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

The tests verify the HumanController invariant, action grants, generic ability discovery,
targetless aura scans, escaped and actor-isolated private result display, normalized feedback,
observation privacy, restricted views and context, mind save round trips, movement, inventory
and money transfer, editor validation, generator rejection, rollback safety, and controller
switching.

## Development workflow

Edit the source files in VS Code. Treat generated `dist/game.html` as build output rather than the source of truth.

Codex should read `AGENTS.md` before modifying the project. The most important rule is that exactly one character is human-controlled, and switching control is performed only by `setup.Game.takeHumanControl()`.
