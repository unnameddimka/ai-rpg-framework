# AI RPG Architecture

## 1. Design goal

AI RPG combines a deterministic stateful RPG engine with stateless model inference. The framework should permit emergent character behavior without allowing generated prose to become an alternate game engine.

The core separation is:

> **engine = objective world; controller/model = intention; presentation = prose**

## 2. Authored world and runtime save

### 2.1 Authored/static source

`data/world.json` is the authoritative authored world document. Build tools validate it and generate embedded source data.

Authored data includes:

- locations and exits;
- sublocations/positions;
- static descriptions;
- character definitions and authored descriptions;
- abilities;
- item definitions;
- stable initial item instances/placement;
- lock/key definitions and authored defaults;
- authored `knownFacts` and initial relationship/mind baselines;
- authored timelapse actions.

### 2.2 Runtime state

The save owns compatible runtime state, including:

- character location/sublocation;
- sleeping;
- wallet;
- runtime item instances, transformations, ownership and placement;
- dynamic lock state;
- beliefs;
- relationships;
- recent/long-term memories;
- continuation;
- committed event journal;
- pending observations;
- AI turn queue;
- runtime ID counters;
- AI inference session identity.

### 2.3 Migration

Compatible older saves are reconciled transactionally as:

> **fresh current authored world + compatible saved runtime overlay**

Current authoring wins for static definitions. Compatible runtime state wins for what actually happened during play.

New authored stable entities absent from an old save appear from current authoring. Stable existing runtime item instances preserve saved state/placement. Removed authored entities are not resurrected merely because an old save contained them.

Dynamic reciprocal lock state is restored by stable `lockId` when compatible.

Valid saved runtime events and pending observations survive migration when their referenced current entities remain valid. Invalid references may be sanitized/discarded with migration warnings. Runtime counters are reconstructed above all preserved IDs.

A manually patched save may therefore add a well-formed pending observation for a current character. No special story migration code is required: queue restoration/repair makes an AI-controlled recipient with pending observations normally eligible.

Migration validates the complete candidate before atomically replacing the restored world. Failure leaves the original save state untouched.

## 3. Entities, inventories, items

The runtime world contains stable entity IDs. Locations, sublocations, characters, and item instances are entities. Inventories are explicit containers owned by characters/locations/sublocations.

An item instance references an authored item definition. The definition supplies type-level behavior/metadata; the instance supplies identity and runtime container/state.

Tracked transformations change the instance's definition/subtype deterministically rather than replacing narrative text only.

Item definitions may expose authored `useAction` effects. Most effects are synchronous/deterministic, such as `report_memory_counts`, and may return only grounded public/private feedback without adding stats or buffs.

`abstract_study` is a deterministic text-input effect for educational/reference interactions that must not materialize new lore. The controller supplies bounded `input_text`; the engine validates and commits `use_item`, then returns authored private feedback whose template may interpolate `{inputText}`. Study progress belongs to the **item instance** and is keyed by reader character ID (`item.abstractStudyProgressByCharacterId[characterId]`), so one physical source can remember independent threads for multiple readers and separate copies of the same item definition do not share progress. Consecutive lexically related queries advance through `survey`, `focused`, and `saturated`; an unrelated query begins a new survey. `focusedFeedbackText` and `saturatedFeedbackText` are optional authored stage templates, with `feedbackText` as the survey/fallback template. This progress is deterministic source bookkeeping rather than character mind/lore and no model request is created.

A `useAction` may also declare a **model-backed information request**. The generic effect is `utility_query`:

1. the controller chooses ordinary `use_item` and supplies bounded `input_text` when that authored item requires it;
2. the deterministic engine validates ownership/current availability/input, commits the public `item_used` event, and returns a deferred model-request descriptor;
3. after that canonical action commit, the shared AI executor sends the authored information-source contract plus the reader input to the Utility model;
4. the generated result is delivered only to the configured reader as private grounded action feedback/observation.

The Utility call is **not an actor turn**. The information source has no controller, personality, goals, memories, relationships, or autonomous agency. The request does not receive the reader's private mind by default; current `utility_query` input consists of authored source instructions/description plus the explicit reader query.

Source authoring also owns **specificity and output size**. `utility_query` may declare `utilityMaxTokens` to bound model output for that item. A source contract may intentionally return concrete reference material, but concrete worldbuilding is not implicit: new proper nouns, dates, named doctrines, spells, organizations, places, historical claims, or similar setting facts should only be generated when the authored source explicitly allows it. When gameplay only needs to establish that a character studied a subject and broadened understanding, use deterministic `abstract_study` instead of generating a summary with a model.

A generated information result grounds **what the source returned**, not necessarily the objective truth of every proposition inside it. Authored sources may contain competing schools, disputed history, mistaken theories, records, interpretations, etc. unless their contract explicitly defines stronger authority. A model-request failure does not retroactively undo the already committed physical item-use action; it becomes private failure feedback instead.

## 4. Characters and control

Every character has a stable identity independent of location.

Controller roles:

- HumanController;
- AIController;
- Dummy/debug controller.

Exactly one character must be HumanController-controlled. Switching is atomic and controller state is validated/repaired on bootstrap/load where possible.

Authored `defaultControllerId` is not the same as current runtime control assignment.

## 5. Character mind

A character mind contains:

- `knownFacts`: authored baseline, refreshed from current authoring during migration;
- `beliefs`: runtime inferred/subjective propositions;
- `relationships`: runtime durable social summaries;
- `recentMemories`: runtime event memories;
- `longTermMemories`: consolidated runtime memories;
- `pendingObservations`: runtime inbox.

`continuation` is stored under AI runtime state and is model-authored opaque working intention. The framework stores/returns it but does not interpret its semantics.

Memory updates from ordinary AI decisions are bounded structured operations: recent-memory append, belief upsert, relationship upsert. Consolidation is a separate transactional maintenance job.

Portable character-mind export/import is an admin/runtime operation, not an in-world action. Version 1 carries exactly the persistent model-authored partitions `beliefs`, `relationships`, `recentMemories`, and `longTermMemories`. Import is strict replace-only and requires an exact stable `characterId` match; there is no force-import or merge path. Current authored `knownFacts`, descriptions, controller/physical state, inventory/equipment, pending observations, continuation, and item-owned mechanic state remain in the destination world. Import clears the target continuation, preserves imported memory IDs, advances `nextMemoryId` beyond imported `memory_ai_*` IDs, and does not emit a transition event/observation or schedule a turn.

## 6. Canonical restricted character view

`CharacterAPI.getView(actorId)` / the current equivalent is the canonical public + operational projection for an ordinary controller.

It contains the actor-visible state required to play, including:

- self state;
- current location/sublocations;
- visible characters;
- accessible inventories/items;
- available abilities;
- exact current `available_actions` catalog and concrete options.

Human UI and ordinary AIController both reason from this same base projection.

AI ordinary-decision context adds private data (AI description, ability instructions, mind records, continuation, prepared pending observations) but does not replace the public view with a second interpretation.

Maintenance workflows such as timelapse/reflection/consolidation may build purpose-specific compact contexts directly; they are not ordinary controller decisions.

## 7. Formal actions

The deterministic action registry/CharacterAPI is the sole authority for formal mechanics.

`view.available_actions` is generated from current state. A requested action must match:

- a currently offered action type;
- that action's schema;
- its current concrete option values.

Examples include movement, moving within a location, item transfer, placement, item use, money transfer, locks, sleep, and character abilities.

Narrative cannot establish a tracked state transition that the engine did not execute.

### 7.1 Attempt vs result

A controller response may contain speech/narrative and one formal action attempt. Speech and visible attempt-phase narration happen before deterministic completion.

The engine then executes the formal action and emits grounded result/failure.

If prose claims something inconsistent with the deterministic result, the engine wins.

### 7.2 Invalid vs grounded failure

- Impossible/out-of-contract Human request: reject; no world tick.
- Valid available attempt that fails in-world: turn is spent; grounded failure becomes part of the tick.

## 8. Intent, speech and loudness

Human and AI use the same canonical combined intent path: optional speech/visible narrative plus at most one formal action.

Speech may have an explicit addressee independently of formal-action target.

Loudness currently has two mechanical values:

- `noticeable`;
- `hidden`.

Whisper-like prose does not change loudness by itself.

## 9. Events, perception and observations

The engine emits canonical events after deterministic commits.

Major location transitions use one event:

```text
character_moved { actorId, fromLocationId, toLocationId, ... }
```

The same event is delivered to the union of recipients who can perceive the actor from source or destination. It is not split into separate departure/arrival canonical events.

Events generate recipient-specific pending observations. Pending observations are already perception-filtered; the model must treat a delivered observation as perceived.

Observation IDs are consumed explicitly rather than clearing an inbox indiscriminately.

## 10. AI reaction queue and world ticks

AI does not run from a background timer. Autonomy progresses when HumanController advances the world.

A valid Human Submit creates one world tick:

1. commit Human narrative/action attempt/result;
2. route observations;
3. process the AI reaction wave synchronously;
4. each eligible AI reacts at most once in that tick;
5. later AI reactions see observations accumulated from earlier committed reactions;
6. finish presentation and unlock Human input.

Initiative among still-unreacted eligible AI is tiered:

1. formal-action targets;
2. speech targets;
3. deterministic queue order.

Human-origin targeting contributes stronger initiative.

Ordinary reactions remain sequential because this causal visibility is a gameplay invariant.

A failed model/protocol/commit step rolls back only that uncommitted AI reaction snapshot and stops the current wave. Earlier committed reactions remain committed.

## 11. Sleeping

Sleeping is explicit canonical state and is distinct from merely lying on a bed.

Observation alone does not mechanically wake a character. Existing wake-on-own-action/non-empty-speech semantics wake the actor before that behavior commits.

## 12. Timelapse architecture

Timelapse is a generic coarse-time execution framework with mode-specific wrappers/policies.

Current source split:

- `24-timelapse-core.js`: generic planning protocol, compact context, rounds, encounters, replans, reflection;
- `24-night-timelapse.js`: overnight entry/exit policy.

Only overnight timelapse is currently exposed.

### 12.1 Overnight behavior

Current overnight mode:

- is triggered by Human sleep on an appropriate bed;
- uses five coarse sequential rounds;
- allows each step to choose a reachable location plus one coarse action;
- treats travel as implicit inside that round;
- supports `narrate`, `sleep`, and authored deterministic timelapse actions;
- resolves social collisions via private intents plus one public group resolver;
- replans affected participants after actual encounters/failures;
- performs reflection and memory consolidation at the end;
- returns/wakes HumanController in the morning;
- does **not** automatically wake AI characters.

Tick-mode `continuation` is cut at the timelapse boundary and is not passed into coarse planning.

`narrate` may describe untracked background activity but cannot mutate tracked items, ownership, money, locks, movement, sleeping state, or deterministic world flags.

### 12.2 Concurrency

Rounds are causal/sequential. Within safe phases, independent model work may run concurrently (plans, intents, independent encounter groups, replans, reflections, consolidations as permitted by the implementation).

Progressive UI may show committed blocks while work continues; speculative planning/thinking is never presented as committed world fact.

## 13. AI model roles and request profiles

Production requests resolve through `setup.AIRequestProfiles`.

Current model roles:

- **Character**: ordinary AIController decision;
- **Utility**: timelapse structural work, reflection, memory consolidation, authored non-character information-source queries;
- **Narrator**: presentation prose.

Profiles centralize model role, max output, reasoning settings, temperature, provider routing, and telemetry labels without encoding gameplay semantics.

Ordinary character decisions intentionally retain the existing larger reasoning/output budget until measured tuning demonstrates a safe reduction.

Structural timelapse requests use bounded outputs and reasoning disabled. Utility default is DeepSeek V4 Flash.

## 14. OpenRouter transport

The browser calls OpenRouter directly using the user-supplied key.

Requests are non-streaming today.

Routing defaults:

- provider sort: latency;
- provider fallbacks: enabled;
- stable non-secret `session_id` per runtime/model-role/profile/actor family where available.

Stable request prefixes are retained where practical so provider-side prompt caching can benefit repeated requests. Prompt caching is an optimization only; correctness never depends on a cache hit.

Gameplay response caching is not enabled.

## 15. Shared request executor

The shared executor provides:

- serialized causal request execution by default;
- an explicit concurrent path used only by workflows that prove requests independent;
- at least one second between live transport calls;
- `Retry-After` aware cooldown after 429;
- no automatic rate-limit retry loop;
- sanitized exchange logging (latest 100 exchanges);
- request purpose/stage/model/options and provider diagnostics.

The one-second pacing guard remains intentional even when timelapse permits safe parallel work.

## 16. AI protocol

Ordinary character decisions return one strict JSON object containing:

- `action`;
- `publicNarrative`;
- `spokenText`;
- `spokenTargetId`;
- `spokenLoudness`;
- `continuation`;
- `memoryUpdates`.

Protocol validation rejects unknown/malformed fields and illegal action options. Action-specific authored text input (currently `use_item.input_text` for `abstract_study` and `utility_query`) is also required/bounded from the current `available_actions` option record before execution. One repair attempt may be made for malformed/schema-invalid output.

Structured timelapse workflows use separate exact JSON protocols with their own validators/repair prompts.

## 17. Presentation narrator

The optional narrator is a presentation layer only. It does not decide actions, mutate world state, or rewrite canonical history.

It receives deterministic facts/committed tick structure and returns literary prose. If disabled or failed, deterministic presentation remains available.

Progressive committed ordinary/timelapse output may be displayed before all AI work finishes; the input remains locked until the canonical operation ends.

## 18. Persistence synchronization

In-place async world mutations can occur without SugarCube passage navigation. Before save serialization, the persistence layer synchronizes the active save moment with current live `State.variables` so exported saves contain the actual committed runtime state.

This synchronization is bookkeeping only: it does not create a gameplay turn, event, observation, AI reaction, or fake passage navigation.

## 19. World editor

The standalone editor is a browser-only authoring tool for `data/world.json`. It does not write directly into repository files; Save downloads a new JSON file.

The editor mirrors authored data but is not a runtime/save editor.

## 20. Debug tooling

The crystal sphere/prompt lab exposes scheduler/request state, dry runs, exchange import/export, replay and diagnostics. Debug tooling must observe normal architecture rather than offer alternate gameplay commit paths.

Normal sidebar may expose read-only scheduler information, but there is no manual gameplay “process pending AI request” button.

## 21. Current authored story/world notes

The current authored world includes the tavern, village/street/temple, village edge and Mara's secluded cottage.

Mara's cottage includes a work table and a stable authored **Slab of Full Arcane Knowledge** instance. `Consult slab` uses deterministic `abstract_study`. Mara/another holder supplies a subject or question in `input_text`; the engine returns authored private feedback for the reader's current study stage. A new line gives broad orientation, a related follow-up gives focused understanding, and continued reading on the same line reaches `saturated` feedback with diminishing theoretical returns. The slab never asks a model to invent or summarize the subject, so it cannot introduce new schools, spells, techniques, taxonomies, history, dates, mechanisms, recipes, or other setting facts through this interaction. It provides no buffs, stats, automatic mastery, or omniscient current/future knowledge.

Mara's cottage also has a normal reciprocal unlocked exit to **Forest stream** (`forestMountainStream`) at the foot of the mountains. The stream has an ordinary bank plus `forestStreamSittingPlace`, a two-capacity sublocation represented by broad smooth stones beside the water. It uses only existing movement/co-location/capacity mechanics and has no scripted date/romance behavior.

Story-specific activation of an existing save is performed by editing that save's runtime observation inbox when desired, not by embedding Mara/slab special cases into migration.

## 22. Deferred architecture

Explicitly deferred:

- daytime timelapse/jobs/work-until-evening;
- professional NPC daily schedules/travel-to-work;
- village economy/work rewards;
- retrieval-based hybrid memory/embeddings;
- large-crowd optimization beyond current emergency limits;
- expanded loudness propagation/shouts;
- equipment/combat/quest systems;
- narrator grounding redesign.
