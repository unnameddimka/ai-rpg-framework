# Mallowstead

Mallowstead is a browser-based AI role-playing game built on a deterministic world simulation with AI-controlled characters.

The core rule is simple: **the engine owns objective reality; models choose character behavior inside the actions the engine currently allows.**

## Play

Open:

```text
dist/mallowstead.html
```

in a modern browser, enter an OpenRouter API key, choose models if desired, and play. No server is required.

The left sidebar exposes three independent model roles. Character and Utility default to DeepSeek V4 Flash:

- **Character model** — ordinary AI character decisions.
- **Utility model** — structured/coarse AI work such as timelapse planning, reflection, and memory consolidation. The authored default is DeepSeek V4 Flash.
- **Narrator model** — optional presentation prose plus narrowly bounded rendering jobs such as weather prose. The presentation narrator remains optional; weather rendering may save a canonical ambient description derived only from engine-supplied weather data, and weather failure never blocks gameplay.

The API key is never stored in world data, game saves, or exported AI exchange logs. Optional browser storage remembers it for 7 days.

## Build profiles

`build.bat` / `build.sh` builds the public Mallowstead world from `data/world.json` and packages a versioned public release ZIP in `dist/`.

`build.bat private` / `build.sh private` builds the local private world from ignored `data/world.private.json`. Private generated artifacts are staged under `.build/` and must not replace tracked public generated files.

## Edit the world

Open:

```text
editor/world-editor.html
```

and load `data/world.json`.

`data/world.json` is the authoritative authored source. Generated files under `src/generated/` are build products and must not be edited manually. Worlds may author a top-level `groundedItemPolicy`: free-form Character-facing rules reserving semantic item categories to formal engine mechanics while leaving other incidental objects available as narrative props.

The editor is standalone/offline and can author world settings including the grounded-item policy, locations, sublocations, characters, public/private descriptions, abilities, item definitions, stable item instances and initial placement, passage locks/keys, key-gated sublocation containers (`requiredKeyItemId`), initial mind data, and minimally surfaced daytime activity/job entities. Item `useAction` authoring includes deterministic effects, the deterministic text-input `abstract_study` effect, and the generic model-backed `utility_query` information-source effect with bounded reader text input, an authored Utility-model source prompt, and an optional per-item output-token cap. The editor visibility invariant is stronger than its current editing UX: every authored entity type must be visible even when its dedicated controls are intentionally crude.

## Build and test

Windows:

```bat
test.bat
build.bat
```

Linux / WSL:

```bash
./test.sh
./build.sh
```

Automated tests use mocked model transports and do not spend OpenRouter credits.

A clean build uses Tweego + SugarCube. The Bash build may reuse the SugarCube runtime embedded in an existing valid `dist/mallowstead.html` when Tweego is unavailable.

## Authored world vs save

Persistence follows one ownership boundary:

- **current authored world (`data/world.json` -> generated `world.js` data)** supplies static definitions and the baseline world for new games and migrations;
- **the save** supplies compatible runtime state: positions, inventories, item state/ownership, money, sleeping, memories, beliefs, relationships, continuations, dynamic locks, events, pending observations, AI queue state, and runtime counters.

Loading an older compatible save is therefore:

> fresh current authored world + compatible saved runtime overlay

A well-formed externally edited save may contain a legitimate pending observation for story/debug experimentation. Generic migration preserves compatible runtime observations and lets the normal scheduler process them; story-specific migration hooks are forbidden.

## Runtime model

Ordinary HumanController and AIController decisions share the same canonical restricted character `view`, including `view.available_actions`. AI gets private character data in addition to that view, not an alternate public world.

A Human turn commits one atomic formal action at most, then synchronously processes the causally created AI reaction wave. Each eligible AI reacts at most once in that world tick. Later AI reactions see observations created by earlier committed reactions, so ordinary reaction waves remain causal/sequential.

Timelapse is a separate coarse-time framework. It may parallelize independent planning and per-character maintenance preparation while preserving sequential committed rounds. Maintenance uses a barrier: all character proposals finish first, then canonical maintenance commits run sequentially and allocate final global memory IDs. Overnight and daytime timelapse are both exposed in gameplay; each uses five committed coarse rounds. Daytime planners cannot sleep: beds/sleep are omitted from the daytime contract and rejected defensively, while nighttime sleep remains unchanged. Committed timelapse prose is third-person world narration; sponsored work explicitly narrates the grounded sponsor by visible name together with the Traveler rather than using sponsor-perspective `You/I/We`. After those rounds (and required daytime settlement) commit, reflection/maintenance failures remain diagnostic rather than undoing the coarse-time transition. Timelapse pathfinding respects persistent passage locks: an unlocked passage is open to everyone, while a locked passage is traversable by a character carrying its matching key without synthesizing unlock/relock or mutating the canonical lock state.

Global environment state now exposes coarse time (`Evening`, `Night`, `Morning`, `Day`) plus a saved narrative weather description to every character and to the main UI. New games begin Monday Evening. Ordinary ticks do not move the clock. Night timelapse ends in Morning; accepted day work or solo hunting runs daytime timelapse and ends in Evening. A fresh playable scene renders first, then startup weather resolves asynchronously through browser-CORS `ipwho.is` approximate IP geolocation + Open-Meteo + the same narrowly scoped shared weather refresh/fallback pipeline used at coarse-time transitions. Missing credentials or any refresh failure is non-blocking; already initialized saved weather is preserved on load, and a stale startup result is discarded if the simulation has already advanced to a later period. Weather keeps explicit stage diagnostics and is independent of the optional presentation-Narrator toggle.


Key-gated containers deliberately use a simpler rule than doors. A sublocation inventory may reference one concrete ordinary key item instance through `requiredKeyItemId`; only direct possession in the actor's normal inventory reveals/enables protected contents. The key can be transferred with ordinary item mechanics, and there is no separate chest open/closed/lock/unlock state. The authored world now uses this for Garrick's private chest, Harlan's private chest, and Mara's new cottage chest; Mara's Slab begins in her chest. Mara also carries a separate ordinary key for the now-lockable cottage entrance.

Daytime activities are authored in `data/world.json` under `dayActivities`. The current set is Mara assistance, Harlan forge assistance, Radovan farm assistance, Bozhena farmstead assistance, and solo squirrel hunting. Sponsors decide whether to offer work through the AI-only formal `offer_day_work` action; the Human resolves a blocking in-game Accept/Decline overlay. Completed jobs settle only after all five rounds: Mara chooses 1-3 Healing Salve/Stamina Potion items, Harlan chooses 3-7 minted salary gold, Radovan chooses 2-3 produce items from turnip/onion/buckwheat groats/apple, Bozhena chooses 2-3 household-food items from eggs/farm cheese/bread, and hunting produces 1-5 Squirrel Pelts by engine RNG. Maksym provides a narrow merchant loop: selected goods have explicit external-sale values, characters negotiate in dialogue, and exchanges commit through ordinary grounded item and gold transfers. There is still no universal village price model, dedicated shop UI, or atomic `Trade` action.

## AI request behavior

Production model calls resolve through named request profiles. OpenRouter Character-role requests prefer providers sorted by throughput; Utility and Narrator requests remain latency-sorted. Provider fallbacks stay enabled, and stable non-secret `session_id` values improve sticky routing/cache locality where supported.

The shared executor intentionally leaves at least one second between live transport calls, applies a hard 180-second timeout to every OpenRouter transport (including response-body reads), and honors `Retry-After` after HTTP 429. Provider 429 cooldown is shared across request roles; optional static/end-of-turn narrator requests skip immediately to deterministic/raw presentation while that cooldown is active, while canonical character reactions remain queued for a later attempt. Safe timelapse maintenance prepare/model work may execute concurrently, but canonical maintenance commits are sequential after the batch barrier; ordinary causal character reactions do not run in parallel.

`abstract_study` is a deterministic text-input item effect for cases where gameplay needs to record that a character studied a freely chosen subject without generating new lore. The controller supplies bounded `input_text`; the engine commits `use_item` and returns authored private feedback that may interpolate `{inputText}`. Reader-specific runtime progress tracks the immediately active study thread. Lexically related follow-ups advance through `survey` → `focused` → `saturated`; an unrelated question starts a new survey. Authored focused/saturated feedback can signal diminishing theoretical returns and suggest practice or a different question without inventing the subject matter. No model call is made.

Authored item interactions may also use the Utility role after a deterministic `use_item` commit. `utility_query` accepts bounded `input_text`, calls a non-character authored information source, and returns generated content as private grounded feedback/observation to the reader. The source is not an NPC and receives no character mind by default. Use this only when the source genuinely needs generated information; for lore-safe educational progress prefer `abstract_study`. Generated content grounds what the source returned, not automatically the objective truth of every claim inside it.

## Repository map

```text
data/world.json                 Committed public authored world source
data/world.private.json         Optional ignored developer-only private authored profile
data/model_list.json            Supported model catalog/defaults
editor/world-editor.html        Standalone offline authored-world editor
dist/mallowstead.html           Public standalone playable build

src/07-mind-v3.js              Canonical Mind v3 semantics/config/math
src/08-mind-validators.js      Shared mind/dialogue validators
src/09-persistence.js          Save-state synchronization helpers
src/09-world-state-authority.js Shared structured world-state-authority mapping
src/09-action-option-validation.js Shared pure action-option/cross-field validation
src/09-passage-rules.js        Passage/lock/key rules
src/09-world-derived-state.js  Derived item-placement synchronization
src/10-game-api.js             Stable setup.Game facade + intent/transaction orchestration
src/10-game-00-item-mechanics.js Generic runtime item/inventory primitives
src/10-game-01-validation.js    Runtime world/invariant validation
src/10-game-02-actions.js       Action registry/AI metadata/affordance projection
src/10-trade-lifecycle.js       Merchant stock/provenance/restock/settlement
src/10-presence.js             Neutral local-presence authority
src/10-weekly-rhythm.js        Calendar/schedule/awayable lifecycle policy
src/10-triggered-events.js     Authored triggered-event execution
src/10-authored-effects.js     Authored effect execution
src/11-save-migration.js       Fresh-world + runtime-overlay migration
src/12-character-context.js    Restricted view/model-context construction
src/13-character-memory.js     Mind/continuation/portable-mind helpers
src/13-verbatim-memory.js      Committed-experience capture
src/14-event-perception.js     Event routing/perception/observation/dialogue projection
src/20-controllers.js          Human/Dummy/AI controllers
src/21-ai-request-profiles.js  Purpose-specific model roles/request profiles
src/21-ai-settings.js          API key/model settings
src/22-openrouter-client.js    Browser OpenRouter transport/routing
src/23-ai-protocol.js          Ordinary Character JSON protocol
src/23-structured-ai-request.js Shared structured parse/validate/repair lifecycle
src/23-timelapse-protocol.js   Timelapse planner/interaction/reflection protocol
src/23-world-environment.js    Canonical global time/weather
src/24-ai-request-executor.js  Shared request executor/pacing/concurrency boundary
src/24-ai-turn-scheduler.js    Causal AI reaction-wave scheduler
src/24-timelapse-core.js       Transactional coarse-time execution/rollback core
src/24-daytime-timelapse.js    Day jobs/hunting/settlement policy
src/24-night-timelapse.js      Overnight policy
src/24-memory-consolidator.js  Transactional Mind maintenance
src/25-turn-flow.js            Human tick orchestration/progressive committed output
src/26-presentation-narrator.js Optional presentation narrator
src/30-game-ui.js              Browser UI
src/generated/                 Generated source inputs; do not edit manually

tests/                         Automated suites
tools/                         Build/generation/developer helpers
docs/architecture.md           Canonical architecture
docs/status.md                 Canonical current implementation status/limitations
AGENTS.md                      Coding-agent invariants/workflow
```

For implementation details, read `docs/architecture.md`. For what exists right now and what is deferred, read `docs/status.md`.
