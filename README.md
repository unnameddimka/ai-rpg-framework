# AI RPG Framework POC

This repository is the framework-first rewrite of the original Twine tavern proof of concept.

The current version provides a deterministic world plus a narrow, manually triggered AI
integration. It supports authored characters and abilities, saved per-character minds,
grounded observations, restricted context bundles, inventories, movement, transfers,
confirmed events, and debug takeover of any character.

Assigned zero-input abilities are also usable from the normal player-facing location view.
The controls are derived from the character currently under HumanController and from that
character's live action grants; they do not depend on a particular character ID. The sample
`readAura` ability performs a targetless scan of all other characters currently perceivable
to the actor and immediately displays its structured private results. Switching control
keeps each character's displayed private result isolated from the others.

## Project layout

```text
src/story.twee          Twine passages and prose
src/00-model-list.js    Generated embedded model catalog
src/10-game-api.js      World, ActionRegistry, CharacterAPI, invariants
src/20-controllers.js   Human, Dummy, and manual AI-turn orchestration
src/21-ai-settings.js   Transient key plus selected-model runtime settings
src/22-openrouter-client.js Browser-side OpenRouter client
src/23-ai-protocol.js   JSON-only prompt protocol, parsing, validation, repair
src/24-ai-request-executor.js Shared serialized request transport and cooldown policy
src/24-ai-turn-scheduler.js Manual scheduler facade and queue/request projections
src/24-prompt-lab.js    Transient scheduler/prompt debugger
src/30-game-ui.js       Browser controls, scheduler queue, sphere lab, and takeover UI
src/styles.css          Framework UI styles
data/world.json         Authoritative locations, characters, minds, and abilities
data/model_list.json    Authoritative OpenRouter model list and default
editor/world-editor.html Standalone offline world editor
tools/generate-world-data.js Cross-platform world validator/embedder
tools/generate-model-list.js Cross-platform model-list validator/embedder
docs/architecture.md    Current architecture
docs/status.md          Current implementation status
AGENTS.md                Instructions for Codex and other coding agents
tests/run-tests.js       Node test harness
build.bat / build.sh     Windows and Bash builds
```

The numeric JavaScript prefixes make the dependency order explicit when Tweego reads the source directory.

## World authoring workflow

`data/world.json` (schema version 2) is the single authoritative source for the start
location, major locations, sublocations, characters, initial minds, controller defaults,
hidden engine facts, and individual ability grants. The editor exposes separate Locations,
Characters, and Abilities sections and blocks structurally invalid downloads.

`src/generated/world-data.js`, `src/generated/world-passages.twee`,
`src/generated/world-storydata.twee`, and `src/00-model-list.js` are derived build files and
must not be edited directly.

`data/model_list.json` separately defines the selectable OpenRouter models and
`defaultModelId`. The build validates it, then embeds it into the standalone HTML so the game
can still run from a single `file://` document without fetching sibling JSON files.

Administrator steps:

1. Send `editor/world-editor.html` and the current `data/world.json` to the author.
2. Receive the edited downloaded `world.json`.
3. Review the JSON diff.
4. Replace `data/world.json` in the repository.
5. Run `test.bat` and `build.bat` on Windows, or `./test.sh` and `./build.sh` under Bash.

The build invokes both cross-platform Node validation/generation steps before tests and story
compilation. The resulting `dist/game.html` embeds the world and model catalog and remains
self-contained; it does not fetch `world.json` or `model_list.json` at runtime.

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

## Build under Bash/Linux

1. Make sure Node.js is on `PATH`.
2. Prefer installing Tweego and its SugarCube story format, then run:

```bash
./build.sh
```

`build.sh` searches `PATH`, `.tools/tweego/tweego`, `~/.local/bin/tweego`, and
`~/.local/share/tweego/tweego`. `TWEEGO_EXE` and `TWEEGO_PATH` may be supplied explicitly.
When Tweego is unavailable, the script can still rebuild the project by reusing the SugarCube
runtime already embedded in the tracked `dist/game.html`. A clean build with no existing
`dist/game.html` still requires Tweego.

## Manual OpenRouter AI turns

The built game calls OpenRouter directly from the browser. The provider remains fixed to
OpenRouter, while the model is chosen from the validated catalog in `data/model_list.json`.
The same file names the default model. The initial catalog contains:

- `thedrummer/cydonia-24b-v4.1` — **Cydonia 24B V4.1** and the current default;
- `sao10k/l3.3-euryale-70b` — **Llama 3.3 Euryale 70B**.

1. Open the AI Settings panel in the sidebar.
2. Choose a model. The selection is applied immediately and persisted independently in
   `localStorage` when browser storage is available.
3. Enter an OpenRouter API key. The password field is cleared after saving.
4. Optionally enable **Remember for 24 hours**. Otherwise the key remains in memory only
   until the page closes.
5. Create a visible event for an AI-controlled character. The sidebar shows the next
   recipient and a short description of the first pending observation.
6. Press **Process next AI event**. One press processes only the queue head and at most one
   formal action. There is no timer or automatic queue draining yet.

The key is never stored in SugarCube state, saves, world data, generated artifacts,
controller logs, copied AI context, or visible errors. Optional persistence uses a
namespaced `localStorage` record with an explicit 24-hour expiry. **Forget saved key**
clears both persisted and in-memory key copies but intentionally leaves the harmless model
preference alone. An invalid or removed saved model falls back to `defaultModelId`. Browser
storage can fail for `file://` pages; in that case the game displays a warning and safely
keeps the key and model selection in memory only.

OpenRouter requests require browser network/CORS access and account credit. Authentication,
credit, rate-limit, provider, and network failures are shown as short safe messages. All game,
repair, and sphere requests pass through one serialized `AIRequestExecutor`. It leaves at
least one second between live transport calls and honors OpenRouter `Retry-After`; it does not
automatically retry a 429. Failed requests retain the queue entry and observations for retry.
A failed second-stage request also rolls back the preceding formal action completely.

OpenRouter HTTP failures retain a sanitized `providerResponse` for diagnosis. It includes the
status, readable response headers, `Retry-After`, raw and parsed response bodies, and provider
metadata such as `provider_name` and `limit_source`. Credentials, authorization material,
OpenRouter `user_id` values, and `user_...` identifier strings are replaced before they reach
UI state, protocol traces, executor history, or exported AI exchange logs. Failed requests keep
the scheduler entry unchanged so the same event can be retried later.

## Crystal-sphere prompt lab

From the street, enter the temporary **Village temple** and approach the crystal sphere.
This room is a development-only prompt laboratory wired to the same context builder,
OpenRouter client, JSON parser, schema validator, and one-repair protocol as real AI turns.

The sphere shows the complete scheduler queue as ordered cards. Each card identifies the
recipient, location, queue reason, request size, and a preview of the observations that will
be sent. The first card is marked as the next live request. Any queued request may be
inspected or dry-run; only the queue head exposes **Process live**, which invokes the same
manual scheduler as the sidebar and advances the real world on success.

The loaded request panel still supports exact and edited-system-prompt dry runs and displays
every initial/repair attempt, raw assistant content, parsed JSON, concrete validation errors,
messages, and provider usage. Dry runs never execute actions, write narrative, update memory,
consume observations, or advance the queue. The room is intentionally hard-coded and can be
removed from the final build later.

## Test without Tweego

```bat
test.bat
```

or under Bash:

```bash
./test.sh
```

The individual suites may also be run directly:

```bash
node tests/run-tests.js
node tests/run-ui-tests.js
node tests/run-editor-tests.js
node tests/run-ai-tests.js
node tests/run-generator-tests.js
```

The tests verify the HumanController invariant, action grants, generic ability discovery,
targetless aura scans, escaped and actor-isolated private result display, normalized feedback,
observation privacy, restricted views and context, mind save round trips, movement, inventory
and money transfer, editor validation, world/model-list generator rejection, model default/selection persistence,
queue ordering and repair, mocked OpenRouter responses, key expiry/leak prevention, detailed protocol diagnostics,
scheduler request projection, executor serialization and timing, prompt-lab dry-run isolation,
live sphere scheduling, protocol repair, atomic AI transactions, rollback safety, and
controller switching. Automated tests never contact the
live OpenRouter API.

## Development workflow

Edit the source files in VS Code. Treat generated `dist/game.html` as build output rather than the source of truth.

Codex should read `AGENTS.md` before modifying the project. The most important rule is that exactly one character is human-controlled, and switching control is performed only by `setup.Game.takeHumanControl()`.
