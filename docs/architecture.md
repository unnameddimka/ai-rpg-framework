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

A sublocation inventory may optionally declare `requiredKeyItemId`, which references one concrete ordinary item instance. Access is granted only while that exact key is directly present in the acting character's normal inventory. Without it, the container itself may remain visible but its canonical contents are omitted from accessible inventories and cannot be targeted by take/place/use/study, including timelapse study. With the key, contents are exposed normally even if the character had forgotten them. Container keys are ordinary transferable items; there is intentionally no open/closed or lock/unlock state for these containers. This differs from passage locks, whose persistent reciprocal `locked` state is world state.

Equipment is item-defined rather than character-slot-defined. A definition with non-empty `equipSlots` is equippable and supplies `equippedDescription`; slots are free-form exact-match strings. A character stores `equippedItems` records `{itemId, slot, visible}`. Inventory placement uses `item.containerId = inventoryId`; equipped placement uses `item.containerId = characterId`, and one item may occupy a slot at a time. `equip`/`unequip` are ordinary formal actions from `view.available_actions`; equipped items remain eligible for `use_item`, while transfer/drop/place require unequipping first. The `visible` flag currently defaults true and is reserved for future concealment/layering rules.

Character visual descriptions are intrinsic only. Canonical current appearance is computed from base `playerDescription`, neutral `undressed` state when the exact `clothing` slot is empty, and visible equipped-item descriptions. The canonical view exposes both assembled appearance text and structured `equipped_items` to Human/AI consumers.

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

Mind v3 separates runtime stimuli, experienced history, autobiographical memory, and interpretation. The canonical design specification is `docs/engine/ai-rpg-mind-v3.md`.

A character mind contains:

- `knownFacts`: authored baseline, refreshed from current authoring during migration;
- `pendingObservations`: authoritative unprocessed scheduler/reaction inbox;
- `verbatimObservations`: persistent compact records of actually committed/delivered recent experience;
- `shortTermMemories`: thematic, relatively detailed autobiographical memory;
- `longTermMemories`: thematic, intentionally more lossy durable autobiographical memory;
- `beliefs`: subjective inductive interpretations with stable `id`, `text`, numeric `confidence`, and numeric `activation`;
- `relationships`: runtime durable social summaries.

`continuation` remains AI runtime state outside autobiographical mind: a model-authored opaque working intention that the framework stores/returns without interpreting its semantics. Engine-owned `recentDialogue` is also outside `mind`; it is bounded conversational working context containing own validated speech plus only speech actually delivered through perception.

Experience enters `verbatimObservations` only after canonical commit/delivery. Raw scheduler envelopes, provider diagnostics, failed intentions, speculative model output, hidden information, and timelapse summaries are not memory. Normal STM consolidation is eligible strictly above 40 verbatim records. It snapshots the complete current buffer, marks every record older than the newest 20 as the exact eviction set, gives the retained 20 as interpretive context, and removes only the captured eviction IDs after a validated atomic commit. Newly arriving observations survive an older in-flight job. Direct belief reinforcement/contradiction may use only the current eviction set as fresh evidence, preventing rolling-window double reinforcement.

STM and LTM are topic-oriented records with stable engine-owned IDs; topics are labels, never identity. STM favors minimal information loss and topic upsert. LTM preserves durable relationship history, discoveries, conflict, commitments, identity-relevant episodes and recurring patterns while intentionally discarding routine detail. Protected-memory semantics remain authoritative: protected STM/LTM cannot be silently rewritten or retired. LTM consolidation is an evidence-driven delta with no arbitrary operation-count cap: the model may make as many material durable-memory and higher-order belief changes as the supplied autobiographical material justifies. Every material LTM write names its source STM/LTM provenance. Any number of unprotected STM records may retire in one atomic pass only through explicit coverage groups marking them either `represented` by resulting LTM or `safe_to_forget` with a compact `routine`/`redundant`/`transient` reason; omitted STM remains available for later consolidation.

Beliefs answer what remembered experience means rather than what happened. Every model request in which beliefs influence interpretation receives one centralized belief-semantics block. Existing belief confidence is changed only by engine-owned bounded log-odds math from model-reported `supports | contradicts | ambiguous` evidence and strength. Activation independently represents salience; relevant evidence/use raises it with a saturating update and timelapse maintenance decays it exponentially. Time alone does not lower confidence. Ordinary character turns/reflection may update relationship summaries and explicitly activate supplied beliefs, but may not directly author autobiographical memory, belief text/confidence, or belief deletion.

Belief reconciliation replaces the v2 contradiction scanner. Candidate clusters favor activated/recently changed or tension-bearing beliefs and receive relevant STM/LTM evidence. Outcomes may revise, merge, weaken, reinforce, contextualize, supersede, remove, or deliberately leave dissonance unresolved. Reconciliation never mutates autobiographical memory merely to make belief text coherent.

All model-produced mind changes use snapshot -> asynchronous computation -> schema/source validation -> stale check -> candidate-clone validation -> atomic commit. Normal STM jobs run in a transient non-blocking Utility-model lane with at most one queued/active job per character; canonical decisions/reaction waves have priority. Appended verbatim records do not by themselves stale an otherwise compatible job, but changes to the maintained mind revision/source snapshot do. In-flight auxiliary jobs are not persisted. Multi-character timelapse mind work may prepare concurrently while commits allocate IDs from the then-current global counter, so unrelated global allocator advancement is not a stale-mind condition.

Timelapse is a cognitive boundary. Before planning, all current character verbatim buffers are force-consolidated with the entire snapshot marked for eviction; failure preserves source records and is diagnostic rather than destructive. Committed timelapse actions/interactions/settlement append actual experienced records at commit time. After the period, eligible STM/LTM consolidation, higher-order belief reappraisal/reconciliation, and activation decay run; after lived rounds/settlement have committed, auxiliary/reflection failure does not roll back the period.

v2->v3 save and portable-mind migration is deterministic and requires no model call. Existing beliefs keep stable IDs/text and confidence semantics while receiving neutral activation; old `recentMemories` become one-for-one legacy STM records; old LTM and relationships survive; v3 verbatim begins empty because the pre-v3 engine did not store a genuine canonical verbatim stream. Migration preserves the established character rather than re-inducing beliefs from historical memory.

Portable mind v3 is replace-only and exact-character-ID guarded. It carries beliefs including activation, relationships, STM, LTM, and bounded verbatim observations. It excludes `knownFacts`, pending observations, scheduler/controller/physical state, continuation, recentDialogue, active auxiliary work and provider state. Import preserves the destination's current authored facts and pending inbox, clears continuation, invalidates transient background mind work, validates atomically, and advances the shared memory/belief allocator beyond imported engine-generated IDs.

Post-timelapse reflection still reuses grounded nearby-character identity and can repair/drop malformed relationship target IDs without turning invalid relationship residue into a failed lived day/night. Epistemic grounding continues to allow deliberate lies and mistaken inferences while preventing unsupported connective confabulation.

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

Examples include movement, moving within a location, item transfer, placement, item use, equip/unequip, money transfer, locks, sleep, and character abilities.

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

Events generate recipient-specific pending observations. `character.mind.pendingObservations` is the authoritative reaction inbox. Event-journal recipient/processed metadata is retained only for diagnostics/history and must not drive a second independent pending queue. Pending observations are already perception-filtered; the model must treat a delivered observation as perceived.

Model context receives a compact recipient-safe observation projection rather than a cloned event envelope. Routing/scheduler/provider bookkeeping (`recipients`, legacy `pendingFor`, `processedBy`, controller/provider metadata) is excluded.

A failed attempt to traverse a locked passage is itself a grounded physical event. Perceivers on the actor side can identify the actor normally; perceivers on the far side receive an anonymous form such as `Someone tried the door from the other side.` The lock remains unchanged, and observation alone does not mechanically wake a sleeping character.

Each character also owns a bounded engine-managed `recentDialogue` window (currently eight utterances) outside `mind`. It contains the character's own validated speech and speech actually delivered to that character through normal perception, including HumanController speech arriving through the normal `submitIntent` path. Delivered Human and AI utterances are interleaved in delivery order. It survives save/load, does not clear merely on movement, and is intentionally excluded from portable character-mind export/import. This is conversational working context, not autobiographical long-term memory.

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

Overnight and daytime timelapse are currently exposed.

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

Tick-mode `continuation` is cut at the timelapse boundary and is not passed into coarse planning. Pre-existing pending observations are likewise treated as boundary input for every AI character, including characters already sleeping and skipped by active planning: their entry observation IDs are snapshotted before planner eligibility and consumed only after the first successfully committed coarse round, so stale pre-timelapse reactions cannot leak into the post-timelapse phase while rollback before any commit remains truthful.

`narrate` may describe untracked background activity but cannot mutate tracked items, ownership, money, locks, movement, sleeping state, or deterministic world flags.

### 12.2 Concurrency

Rounds are causal/sequential. Within safe phases, independent model work may run concurrently (plans, intents, independent encounter groups, replans, reflections, consolidations as permitted by the implementation).

Progressive UI may show committed blocks while work continues; speculative planning/thinking is never presented as committed world fact.

### 12.3 Daytime mode and jobs

Canonical global environment state contains `timePhase` and `weatherNarrative`. Valid phases are `evening`, `nighttime_timelapse`, `morning`, and `daytime_timelapse`; UI labels are Evening/Night/Morning/Day. New worlds and legacy saves without a phase begin in Evening. Ordinary ticks never advance time. Evening permits overnight entry; Morning permits daytime activities. Successful overnight returns Morning; successful daytime returns Evening.

Daytime is a five-round policy over the same `24-timelapse-core.js`. Entering it wakes every character. Free NPCs plan ordinary coarse activity. A sponsored job binds its sponsor to the authored worksite and treats the Human worker as physically present but non-interactive for encounter arbitration. Accepted sponsor/Human pairs reach the worksite through ordinary timelapse reachability; an unreachable worksite fails the activity without consuming the day.

`world.dayActivities` is authored data. Initial policies are Mara assistance at her cottage, Harlan forge assistance at the smithy, and sponsorless hunting at the forest stream. `offer_day_work(activity_id)` is an AI-owned grounded action available only in Morning when the Human is physically reachable. It creates a single pending offer and pauses the current causal wave. Accept begins the job; Decline emits grounded refusal feedback and resumes the original wave while preserving already-reacted character IDs.

Settlement is a hook after five committed rounds and before reflection/maintenance. Sponsor settlement uses a narrow Character-model request with full sponsor context but reward-only output. Mara may choose 1-3 Healing Salve/Stamina Potion instances; Harlan may choose 3-7 gold, minted only by this settlement policy. Solo hunting uses engine RNG for 1-5 Squirrel Pelts. No reward exists before settlement, and a failed settlement does not advance to Evening.

Timelapse planning also exposes `study_item` for existing `abstract_study` items when the item is carried by the actor or physically present in the chosen room/accessible sublocation. The existing item-owned per-reader study progress is reused; no parallel study system exists.

### 12.4 Global weather

Weather is optional external environmental input, never a gameplay dependency. The browser resolves approximate location through the CORS-capable public `https://ipwho.is/` endpoint, requests current conditions from Open-Meteo, deterministically normalizes them, and sends only that normalized weather plus a minimal `rural, low-technology environment` style contract to the Narrator role. The Narrator is not given game time, lore, characters, or scene state and must not mention time of day or modern measurements. The resulting prose is saved as canonical `weatherNarrative` and shown globally.

New worlds and legacy saves without initialized weather attempt initialization when an AI key is available. Existing saved weather is preserved on load. Successful day/night timelapse attempts refresh weather. Any fetch/narrator failure preserves the prior narrative; if none exists, a fixed neutral fallback is used. Weather failure never blocks a time transition. The latest refresh retains explicit `ip-geolocation`, `weather-fetch`, `weather-narration`, and `weather-commit` diagnostics, including the failed stage when applicable; the ordinary presentation-Narrator toggle does not disable this infrastructure weather renderer.

## 13. AI model roles and request profiles

Production requests resolve through `setup.AIRequestProfiles`.

Current model roles:

- **Character**: ordinary AIController decision;
- **Utility**: timelapse structural work, reflection, memory consolidation, authored non-character information-source queries;
- **Narrator**: presentation prose plus explicitly bounded rendering of engine-supplied non-mechanical facts such as weather. The ordinary presentation narrator remains non-canonical; the weather renderer is a narrow exception whose output is saved as canonical ambient prose but cannot create mechanics or additional world facts.

Profiles centralize model role, max output, reasoning settings, temperature, provider routing, and telemetry labels without encoding gameplay semantics.

Ordinary character decisions intentionally retain the existing larger reasoning/output budget until measured tuning demonstrates a safe reduction.

Structural timelapse requests use bounded outputs and reasoning disabled. Utility default is DeepSeek V4 Flash.

## 14. OpenRouter transport

The browser calls OpenRouter directly using the user-supplied key.

Requests are non-streaming today. Every physical OpenRouter attempt is also captured by a bounded low-level transport diagnostic ring at the provider boundary, including pre-response network/timeout failures, HTTP/provider status, sanitized provider diagnostics, and executor-propagated actor/purpose/stage metadata where available. This complements rather than replaces the high-level semantic exchange log.

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
- `Retry-After` aware shared provider cooldown after 429;
- a hard per-transport liveness timeout (default 180 seconds) covering both fetch and complete response-body read;
- optional presentation-request suppression while provider rate-limit cooldown is active;
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

Structured timelapse workflows use separate exact JSON protocols with their own validators/repair prompts. Timelapse action contracts are mode-aware: `sleep` is exposed/valid during nighttime but omitted and defensively rejected during daytime. Beds are correspondingly removed from the daytime planner's reachable-location projection. Committed timelapse `narrate` prose is requested as third-person world narration; sponsored daytime work receives the sponsor's grounded canonical ID/name explicitly so public prose addresses the sponsor by visible name rather than from a `You/I/We` sponsor perspective.

## 17. Presentation narrator

The optional narrator is a presentation layer only. It does not decide actions, mutate world state, or rewrite canonical history.

It receives deterministic facts/committed tick structure and returns literary prose. If disabled or failed, deterministic presentation remains available.

Progressive committed ordinary/timelapse output may be displayed before all AI work finishes; the input remains locked until the canonical operation ends.

## 18. Persistence synchronization

In-place async world mutations can occur without SugarCube passage navigation. Before save serialization, the persistence layer synchronizes the active save moment with current live `State.variables` so exported saves contain the actual committed runtime state.

This synchronization is bookkeeping only: it does not create a gameplay turn, event, observation, AI reaction, or fake passage navigation.

## 19. World editor

The standalone editor is a browser-only authoring tool for `data/world.json`. It does not write directly into repository files; Save downloads a new JSON file.

The editor mirrors authored data but is not a runtime/save editor. It also exposes top-level `travelerProfiles` as authored identity templates containing only stable ID, name, player-facing description and AI-facing authoring; Traveler mechanics and aura are deliberately not profile-authorable.

Fresh-world initialization uses the stable canonical `player` shell. Before gameplay, the user acknowledges the project AI-interaction disclaimer and then chooses Generic Traveler, one authored Traveler profile, or Custom per-save authoring. Identity overlays may change only name/playerDescription/aiDescription plus derived presentation labels; all mechanical shell state and the shared otherworldly aura remain canonical.

## 20. Debug tooling

The crystal sphere/prompt lab exposes scheduler/request state, dry runs, exchange import/export, replay and diagnostics. Debug tooling must observe normal architecture rather than offer alternate gameplay commit paths.

Normal sidebar may expose read-only scheduler information, but there is no manual gameplay “process pending AI request” button. Admin/debug controls may safely dismiss pending reactions, clear continuation, or clear both (including a global keep-list operation) only when no AI/executor/wave/migration work is live. Such cleanup is runtime administration, emits no story event, and never implicitly sleeps/wakes a character.

A red **Emergency dump** control exports one best-effort ZIP without requiring world validation. It is also exposed as a top-level fixed control above blocking overlays so diagnostics remain reachable regardless of gameplay lock, pending day-work offer, AI/timelapse work, or migration UI. Independent JSON files capture live game/SugarCube state, full minds (including Mind v3 verbatim/STM/LTM/beliefs with confidence+activation, recent dialogue, maintenance snapshots, and belief diagnostic history), scheduler/request diagnostics, the same portable Sphere/AI exchange-log representation used by Prompt Lab export, bounded low-level OpenRouter transport history, bounded framework-owned external network history, latest weather-pipeline diagnostics, the most recent handled timelapse result/failure stage, narrator/UI state, and recent uncaught browser errors while defensively redacting API/authentication secrets. `manifest.json` records per-section success/failure; failure to capture one section must not prevent the remaining files from being downloaded.

`frameworkUI.turnBusy` is obsolete as persisted state. Busy UI derives only from live runtime operations. Save/load strips or ignores stale serialized busy flags; rendering (`Engine.show()`) is not recovery logic because passage rendering may itself request optional narration.

## 21. Current authored story/world notes

The current authored world includes the tavern, village/street/temple, village edge, a separate Mara's Garden location, Mara's Cottage (`secludedCottage`) as an interior-only location, and a working village Smithy (`villageSmithy`) reached from the Street near the temple.

The Smithy contains the forge floor plus Harlan the Blacksmith's rear living room and sleeping bed. Harlan (`blacksmith`) begins AI-controlled at the forge with coarse work clothing and a smith's hammer equipped in `right_hand`. His authored role centers on mundane village ironwork—nails, horseshoes, harness/tack fittings, practical repairs and sharpening—rather than weapons. Seeded local relationships capture mutual irritation/respect with Garrick, friendly explicitly non-romantic familiarity with Nell, and wary practical treatment history with Mara; Price has no pre-authored relationship with him.

Mara's cottage includes a work table, a private key-gated chest, and a stable authored **Slab of Full Arcane Knowledge** instance stored inside that chest. `Consult slab` uses deterministic `abstract_study`. Mara/another holder supplies a subject or question in `input_text`; the engine returns authored private feedback for the reader's current study stage. A new line gives broad orientation, a related follow-up gives focused understanding, and continued reading on the same line reaches `saturated` feedback with diminishing theoretical returns. The slab never asks a model to invent or summarize the subject, so it cannot introduce new schools, spells, techniques, taxonomies, history, dates, mechanisms, recipes, or other setting facts through this interaction. It provides no buffs, stats, automatic mastery, or omniscient current/future knowledge.

Mara's Garden (`maraCottageGardenLocation`) connects reciprocally to village edge, Mara's Cottage, and **Forest stream** (`forestMountainStream`). The cottage no longer connects directly to village edge or the stream. The stream has an ordinary bank plus `forestStreamSittingPlace`, a capacity-two sublocation represented by broad smooth stones beside the water; its enter action moves only the acting character. Save migration preserves surviving stable sublocation identity and derives its current authored parent, so old garden positions reparent safely while cottage-bed occupants remain on the bed.

Story-specific activation of an existing save is performed by editing that save's runtime observation inbox when desired, not by embedding Mara/slab special cases into migration.

## 22. Deferred architecture

Explicitly deferred:

- professional NPC daily schedules/travel-to-work;
- broader village economy, prices, barter/shop abstractions, and additional production chains;
- retrieval-based hybrid memory/embeddings;
- large-crowd optimization beyond current emergency limits;
- expanded loudness propagation/shouts;
- equipment stacking/layering/concealment controls;
- combat/quest systems;
- narrator grounding redesign.
