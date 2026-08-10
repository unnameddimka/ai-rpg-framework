# AI RPG Framework POC

This repository is the framework-first rewrite of the original Twine tavern proof of concept.

The project combines a deterministic world simulation with user-triggered AI character reaction waves and an optional AI-powered presentation narrator. The deterministic engine remains authoritative for world state, movement, inventories, money, passage locks, item transformations, grounded action results, perception, and controller ownership. AI character models choose character behavior from the same restricted canonical `view` used to build the player UI. The Narrator is a separate presentation service and never controls characters or mutates the world.

The current tavern proof of concept includes persistent item instances, reusable mugs, lockable upstairs rooms with ordinary key items, beds and tables as sublocations, chronological History, a crystal-sphere prompt lab, and a stateless literary Narrator layer with raw-presentation fallback.

## Project layout

```text
src/story.twee                  Twine passages and prose
src/00-model-list.js            Generated embedded model catalog
src/10-game-api.js              World, ActionRegistry, CharacterAPI, invariants
src/20-controllers.js           Human, Dummy, and AI character controllers
src/21-ai-settings.js           API key, character-model and narrator-model settings
src/22-openrouter-client.js     Browser-side OpenRouter transport
src/23-ai-protocol.js           Character JSON protocol, parsing, validation, repair
src/24-ai-request-executor.js   Shared serialized request transport, cooldown and exchange log
src/24-ai-turn-scheduler.js     Reaction-wave scheduler and queue projections
src/24-prompt-lab.js            Crystal-sphere request debugger
src/25-turn-flow.js             Human Submit/Pass plus completed AI reaction wave
src/26-presentation-narrator.js Stateless presentation Narrator service
src/30-game-ui.js               Browser UI, History, narrator presentation and debug controls
src/styles.css                  Framework UI styles

data/world.json                Authoritative world, characters, items and authored mind data
data/model_list.json           OpenRouter model catalog and defaults
editor/world-editor.html        Standalone offline world editor

tools/generate-world-data.js   World validator and generated-data builder
tools/generate-model-list.js   Model-list validator and embedded catalog builder
tools/build-from-existing-runtime.js Fallback standalone HTML builder

docs/architecture.md           Architecture notes
docs/status.md                 Current project status
docs/engine/                   Engine/controller/presentation implementation specs
docs/world/                    World/character authoring specs
AGENTS.md                       Instructions for coding agents

tests/run-tests.js             Core engine tests
tests/run-editor-tests.js      Editor tests
tests/run-ui-tests.js          UI tests
tests/run-ai-tests.js          AI/controller/protocol tests
tests/run-generator-tests.js   Generator validation tests
tests/run-narrator-tests.js    Presentation Narrator tests

test.bat / test.sh             Full test entry points
build.bat / build.sh           Full build entry points
dist/game.html                 Self-contained built game
```

The numeric JavaScript prefixes make dependency order explicit when Tweego reads `src/`.

## Core architecture

### Deterministic world

The engine owns objective state. Character models do not directly mutate the world.

Formal actions are validated against the actor's current canonical `view.available_actions`, including concrete option values. Valid actions are executed locally by the deterministic engine, which produces grounded success/failure events.

A Human request that is impossible under the current action contract is rejected without consuming the turn. A legitimate available action attempt that fails in-world still consumes the turn and advances the world tick.

### Shared restricted view

The restricted character `view` is the canonical public/operational projection for both HumanController and AIController.

The browser builds normal gameplay controls from this same view. AI character requests receive the same view unchanged. AI-specific context may add only private character information such as authored instructions, memory, relationships, prepared observations, and the character's private nullable `continuation`.

`continuation` is a model-authored working intention. The engine stores and returns it but does not interpret, prioritize, validate, expire, or plan from it.

### AI reaction waves

After a Human Submit, the human intent commits first and the scheduler synchronously processes the resulting AI reaction wave.

Within one world tick:

- each eligible AI character may react at most once;
- formal-action targets receive the strongest initiative priority;
- speech addressees receive secondary priority;
- remaining characters use deterministic scheduler order;
- later AI characters see grounded observations created earlier in the same wave;
- observations delivered to an AI that already reacted remain queued for a later world tick;
- there is no autonomous timer loop.

The normal sidebar shows scheduler diagnostics but does not expose a manual gameplay path for processing pending AI work. The crystal sphere retains explicit debug controls.

### Movement and perception

A successful location transition produces one canonical movement event conceptually equivalent to:

```text
character_moved { actorId, fromLocationId, toLocationId }
```

The same event is delivered to the union of characters who can perceive the actor from the source or destination side.

## World authoring

`data/world.json` is the authoritative authored world source. Generated world files must not be edited directly.

The standalone editor supports locations, characters, abilities, item definitions, item instances, initial placement, passage blocking/locking, and ordinary key compatibility.

### Persistent item instances

Items are persistent instances referring to definitions rather than disposable prose objects.

The tavern mug loop demonstrates state transformation:

1. an empty mug instance is taken from storage;
2. `fill` transforms that same instance into `mugOfAle` when performed at the authored ale source;
3. `consume` transforms it back into `emptyMug`;
4. the same physical instance can be reused.

### Lockable passages and keys

Lockable exits use authored lock IDs. Ordinary item definitions may carry matching `keyLockId` values. `lock` and `unlock` are normal grounded formal actions and synchronize only the reciprocal sides of the same physical passage.

A lock ID represents key compatibility, not global shared state among unrelated doors.

The current tavern includes lockable upstairs rooms and matching keys held by Garrick.

### Sublocations

Tables, the bar area, beds, and other authored positions use the existing sublocation mechanics rather than special-case gameplay primitives. Dynamic inventories/items associated with these positions remain canonical world state.

## Player-facing History

The main UI keeps a chronological History of player-facing grounded presentation entries.

History includes Human narrative, Human grounded actions/failures, AI character-authored narrative, and grounded AI action results/failures. Visibility metadata is preserved so the debug **Show invisible events** option can expose entries that were not visible to the Human character.

The runtime History is not used as AI context. Saves retain a bounded mirror of the most recent History entries.

## Presentation Narrator

The Narrator is a separate stateless presentation service, not a controller and not part of the AI scheduler.

It uses the same low-level OpenRouter transport/cooldown infrastructure but has its own model selection, system prompt, request contract, validation and exchange-log purpose.

Default Narrator model:

```text
sao10k/l3.3-euryale-70b:nitro
```

The sidebar contains independent **Character model** and **Narrator model** selectors plus an **Enable narrator** checkbox.

### Static scene narration

Whenever the Human-controlled character enters a location, the Narrator may rewrite the static presentation facts for that location into literary prose.

Static narration covers only things that cannot change during the current visit, such as architecture and permanent/static fixtures. Anything that can change after entry belongs to dynamic presentation instead.

Static narration is regenerated on each entry; there is currently no cache.

### Dynamic scene narration

After the entire Human turn and AI reaction wave completes, exactly one dynamic Narrator request is made when narration is enabled.

The request receives the full current visible dynamic scene, including character positions, dynamic items and grounded action/event presentation. It is intentionally a full snapshot rather than a delta, so prose may vary slightly from tick to tick.

### Protected character-authored text

Human-authored narrative/speech and AI `publicNarrative` / `spokenText` are immutable presentation material.

The mixed Narrator stream encloses this material in paired protected blocks:

```text
<verbatim id="v1">
Captain John Price: *Price raises his mug slightly.* Evening, Nell.
</verbatim>
```

The Narrator may read block contents for linguistic context, but the framework separately retains each canonical original. Returned block structure is validated, returned inner text is discarded, and the original canonical text is restored before rendering.

Arbitrary character text is safely escaped before being inserted into the structural Narrator framing, so character content cannot inject fake `<verbatim>` tags.

If Narrator transport or validation fails, the game immediately falls back to the existing raw deterministic presentation. Narrator failure never rolls back or repeats a world tick.

Narrator output is presentation only. It is never written back into world state, character memory, beliefs, relationships, observations, or canonical History.

## OpenRouter models and settings

The game calls OpenRouter directly from the browser using the user-supplied API key.

`data/model_list.json` defines the selectable model catalog, the default character model, and the default Narrator model. The build validates and embeds this catalog into the standalone HTML.

The current catalog includes:

- `thedrummer/cydonia-24b-v4.1` — Cydonia 24B V4.1;
- `sao10k/l3.3-euryale-70b` — Llama 3.3 Euryale 70B;
- `sao10k/l3.3-euryale-70b:nitro` — Llama 3.3 Euryale 70B, Nitro routing; default Narrator;
- `sao10k/l3.1-euryale-70b:nitro` — Llama 3.1 Euryale 70B, Nitro routing;
- `mistralai/mistral-small-3.2-24b-instruct` — Mistral Small 3.2 24B;
- `deepseek/deepseek-v4-pro` — DeepSeek V4 Pro.

The API key is not stored in world data, SugarCube saves, model context, exchange-log exports, or generated world artifacts. Optional **Remember for 24 hours** persistence uses namespaced browser storage with expiry. **Forget saved key** clears the stored and in-memory key without removing harmless model preferences.

Character and Narrator model selections are independent.

## Shared request executor and diagnostics

Live character and Narrator calls share one serialized request transport policy so browser-side requests obey the same cooldown and rate-limit handling.

Character requests pass through the character JSON protocol and repair validator. Narrator requests use the executor's raw/generic path and their own presentation validator instead of the character protocol.

Exchange history records request purpose/stage. Narrator calls are marked as narration exchanges (for example `purpose: narration`, `stage: location` or `stage: tick`) and appear chronologically alongside character model exchanges.

Exported exchange logs include browser-visible request/response diagnostics, parser/validation traces where applicable, usage data and sanitized provider details. API keys, authorization data and provider user identifiers are redacted/excluded.

## Crystal-sphere prompt lab

The temporary Village temple contains a crystal sphere used for AI debugging.

It exposes scheduler queue state, exact character requests, dry runs, current protocol traces, recorded exchange history, portable log export/import, and an explicit live processing path for the queue head.

Dry runs do not mutate the world, consume observations, execute formal actions, or advance the scheduler.

Narrator exchanges are included in the same exported exchange history with narration-specific metadata.

## Build on Windows

Requirements:

- Node.js;
- Tweego + SugarCube on `PATH` for a clean build.

Run:

```bat
build.bat
```

Output:

```text
dist/game.html
```

## Build under Bash/Linux/WSL

Run:

```bash
./build.sh
```

`build.sh` searches for Tweego on `PATH`, then in the project's `.tools/tweego/` directory and common user-local locations. `TWEEGO_EXE` and `TWEEGO_PATH` may also be supplied explicitly.

If Tweego is unavailable but a valid existing `dist/game.html` is present, the fallback builder reuses its embedded SugarCube runtime and replaces the authored story/style/script payload with the current sources.

A completely clean build with no existing SugarCube runtime still requires Tweego.

## Tests

Windows:

```bat
test.bat
```

Bash/Linux/WSL:

```bash
./test.sh
```

`test.sh` regenerates the model/world embedded sources and runs:

```text
tests/run-tests.js
tests/run-editor-tests.js
tests/run-ui-tests.js
tests/run-ai-tests.js
tests/run-generator-tests.js
tests/run-narrator-tests.js
```

Automated tests use mocked model transports and do not contact the live OpenRouter API.

The Narrator suite covers static/dynamic presentation assembly, paired verbatim framing, safe serialization of arbitrary character content, structural validation, canonical verbatim restoration, fallback behavior and narration request handling.

## World editor workflow

The editor is a single offline HTML file intended to work without Node, a server, or a build environment.

Typical authoring flow:

1. open `editor/world-editor.html`;
2. load the current `data/world.json`;
3. edit and validate the world;
4. download the resulting `world.json`;
5. replace `data/world.json` in the repository;
6. run tests and build.

The generated files under `src/generated/` are build products and should not be manually edited.

## Development workflow

Treat the current Git `main` HEAD as the evolving implementation baseline after the initial project archive for a development chat.

Edit core source files directly. Avoid runtime monkey patches or wrapper modules when the behavior belongs in an existing subsystem.

Build output (`dist/game.html`) is generated and should not be treated as the source of truth.

Coding agents should read `AGENTS.md` before modifying the project. One central invariant remains: exactly one character is Human-controlled, and controller switching must preserve that invariant atomically.
