# Project Status

## Implemented now

### Runtime/world

- Browser/SugarCube deterministic world simulation.
- Exactly one HumanController with Human/AI/Dummy controller switching.
- Canonical restricted character view shared by Human UI and ordinary AIController.
- Locations, sublocations, beds/posture positions, explicit inventories and stable item instances.
- Atomic formal actions with current-state action catalogs and concrete option validation.
- Movement, item transfer/placement/transformation/use, item-defined equip/unequip, money, persistent passage locks/keys, key-gated containers, sleep, and character abilities.
- Single canonical `character_moved` event routed to source/destination perceivers.
- Locked-passage attempts produce grounded observations on both sides; the far side is anonymized rather than leaking actor identity through a closed door.
- Recipient pending-observation inbox is authoritative; model-facing observations are compact and omit routing/scheduler metadata.
- Bounded eight-utterance `recentDialogue` working context preserves own speech and actually heard Human/AI speech in delivery order across save/load without entering portable mind.
- Explicit sleeping state and wake-on-own-action/speech behavior.

### Authored world

- Roadside tavern with Garrick, Nell, Guest Rooms, bar/common-room furniture and keys. Garrick's private room now has a key-gated personal chest whose ordinary key starts in Garrick's inventory.
- Captain Price as a character.
- Village street/temple/edge, separate Mara's Garden and Mara's Cottage locations (cottage floor/bed/table/alchemical shelves/private keyed chest), plus a reciprocal nearby Forest stream reached from the garden with a normal capacity-two sitting sublocation. Mara carries separate ordinary keys for her chest and the now-lockable, initially unlocked cottage entrance.
- Working village Smithy off the Street near the temple, with forge floor, rear living room/bed/private keyed chest, and Harlan the Blacksmith starting at work with equipped clothing, smith's hammer, and his chest key. Harlan is authored around practical nails/horseshoes/fittings/tool repair, with seeded local ties to Garrick, Nell and Mara and no prior Price relationship.
- Memory Stone deterministic item/use effect.
- Deterministic `abstract_study` authored item effect: bounded `use_item.input_text` -> committed item use -> authored private study feedback with `{inputText}` interpolation. Reader progress is owned by the physical item instance and keyed independently per character; related consecutive queries classify as `survey`, `focused`, then `saturated`, while unrelated questions reset that reader's thread. No Utility/model request occurs.
- Generic `utility_query` authored item effect remains available for genuinely model-backed information sources: bounded `input_text` -> committed physical item use -> deferred Utility-model information request -> private grounded result observation to the reader, with optional per-item output-token cap.
- **Slab of Full Arcane Knowledge** authored inside Mara's keyed private chest and implemented through `abstract_study`. A reader freely chooses a question/topic. The first consultation gives broad orientation, a related follow-up gives focused theoretical understanding, and a third related consultation reports diminishing returns and points toward practice or a genuinely different question. The slab still does not generate classifications, mechanisms, schools, spells, dates, recipes, or other new setting facts. It remains non-sentient, grants no instant mastery, and has no oracle access to current hidden facts/future.

### Ordinary AI turns

- Human Submit advances one world tick and synchronously drains the causally created AI reaction wave.
- Each eligible AI reacts at most once per Human tick.
- Targeted formal action > targeted speech > deterministic queue ordering.
- Later AI in the same tick see observations committed by earlier AI.
- AI actions hard-validate against current `view.available_actions` including option values.
- Combined speech/narrative + at most one formal action attempt.
- Formal Action Precedence: if a currently available formal action represents an intended tracked state change, AI must use it instead of narratively substituting for it; multi-step tracked goals proceed one formal action at a time, while action classes the engine does not model at all remain narratively expressible.
- Grounding barrier between model attempt prose and deterministic engine result.
- Epistemic grounding allows deliberate lying, misunderstanding and false inference while rejecting unmotivated connective fabrication; mind updates preserve the distinction between an observed fact, an inference/belief, and something the character knowingly lied about.
- Opaque model-authored `continuation` for unfinished ordinary-tick purpose.
- Mind v3 ordinary turns no longer author autobiographical memories or arbitrary belief replacements. They may update durable relationships and explicitly activate supplied beliefs; committed experience is captured separately into verbatim memory.
- Persistent Mind v3 layers are pending observations (unprocessed scheduler inbox), verbatim experienced history, thematic STM, thematic lossy LTM, and beliefs with independent numeric confidence + activation. Ordinary STM consolidation uses the full buffer, triggers strictly above 40, retains newest 20, and evicts exact older IDs only after validated atomic commit.
- Existing belief confidence is engine-owned log-odds math from semantic support/contradiction strength; activation is saturating salience that can rise even while confidence falls and decays during timelapse. Belief reconciliation can revise/merge/contextualize/supersede/remove or deliberately leave cognitive dissonance unresolved.
- Background STM work runs non-blocking through the Utility lane with one job per character, snapshot/stale/atomic-commit safety and canonical-decision priority. Its stale check is operation-specific: new verbatim and activation-only gameplay changes are compatible and merge onto current state, while STM/LTM/relationship changes or belief ID/text/confidence changes reject the result. New observations arriving while a job is in flight are never removed by that older job. Live STM consolidation has a dedicated 6000-token Utility completion profile; prompts require thematic grouping and canonical 0..1 importance, while common accidental model output on a >1..10 importance scale is normalized deterministically at protocol ingress before strict validation. STM output is now explicitly delta-only: persisted/migrated STM is read-only by default, cleanup/beautification rewrites are forbidden, unchanged records are omitted, and one roll is bounded to 8 total STM writes, 12 belief effects, 4 new beliefs and 12 activation IDs. Oversized/no-op responses are rejected atomically rather than truncated.
- Shared belief/relationship/STM/LTM/verbatim/dialogue validators are reused across runtime validation, migration, and portable mind import.

### Timelapse

- Generic timelapse core separated from overnight wrapper.
- Overnight mode: five coarse rounds, implicit reachable-room travel, sleep/narrate/authored macros.
- Private encounter intents + shared resolver + affected-character replanning.
- Safe parallelism for independent structural requests and per-character Mind v3 maintenance preparation; rounds remain sequential. Auxiliary computations never mutate shared state before validated commit, and engine-generated memory/belief IDs allocate from the then-current global counter.
- Structural timelapse requests use reasoning disabled and bounded outputs.
- Tick-mode `continuation` is cut before timelapse planning.
- AI that end the night sleeping remain sleeping in the morning; only Human control is returned/woken.
- Timelapse now has a forced pre-boundary verbatim->STM consolidation (entire pre-period buffer is the eviction set), committed-experience verbatim capture during coarse rounds, then STM/LTM consolidation, belief reconciliation and activation decay. Reflection updates only relationships/belief activation. After all rounds/required settlement commit, reflection/maintenance failures are diagnostic-only and never silently drop source memory. LTM maintenance is evidence-driven rather than count-limited: the Utility model sees the full STM set and may make as many material LTM/belief changes as justified, with a dedicated 12000-token completion profile. Every material LTM write carries `sourceStmIds`/`sourceLtmIds` provenance. Any number of unprotected STM records may retire only through explicit `represented` coverage or `safe_to_forget` groups using `routine`/`redundant`/`transient` reason codes. New LTM proposals use response-local refs for coverage links; refs/provenance/reason metadata never persist into character consciousness.
- Timelapse routing preserves canonical passage lock state: unlocked passages are available to everyone; a locked passage is available to a matching direct key holder without synthetic unlock/relock or lock-state mutation.
- Progressive committed output during long ticks/timelapse.

### Global time, daytime work, and weather

- Canonical `world.environment` stores `timePhase` and saved `weatherNarrative`; every character view and the main UI receive the same global conditions. New/legacy worlds default to Evening, and ordinary ticks never advance time.
- AI sponsors use formal `offer_day_work`; a custom blocking Accept/Decline overlay pauses causal AI processing. Decline resumes without allowing already-reacted characters a second reaction in the same Human tick.
- Daytime uses the shared five-round timelapse core. It wakes all characters on entry, supports fixed sponsor work narration while other NPCs remain autonomous, performs reward settlement before reflection/maintenance, refreshes weather, and ends Evening.
- Solo hunting at Forest stream has one Narrator block per committed round and engine-RNG Squirrel Pelt settlement.
- Timelapse planners can formally `study_item` when an `abstract_study` source is carried or accessible in the selected room. Items inside keyed containers are included only for characters directly carrying the exact required key item.
- Real weather uses CORS-capable `ipwho.is` IP geolocation + Open-Meteo + narrowly scoped narrator prose. Saved weather survives load; failure preserves old/fixed fallback and never blocks play. Latest refresh diagnostics retain the exact failed pipeline stage, and the ordinary presentation-Narrator toggle does not disable weather rendering.

### AI inference

- OpenRouter browser client with Character, Utility and Narrator model roles. The ordinary presentation Narrator defaults OFF and remains opt-in; bounded environment rendering such as canonical weather prose uses the Narrator role independently.
- Model catalog currently includes Cydonia, Llama Euryale variants, Mistral Small 3.2, DeepSeek V4 Pro and DeepSeek V4 Flash.
- Utility model default: DeepSeek V4 Flash.
- Central `AIRequestProfiles` for ordinary decisions, timelapse structural jobs, reflection, consolidation and narrator requests.
- Ordinary character decisions remain on Character model with conservative existing budget.
- Utility jobs use Utility model, including authored non-character item information queries.
- Narration uses Narrator model.
- Provider routing prefers `latency` with fallbacks enabled.
- Stable non-secret OpenRouter `session_id` values improve sticky routing/cache locality where supported.
- Prompt construction keeps stable prefixes where practical; provider prompt caching may be used implicitly.
- Response caching is not used for gameplay.
- Shared request executor retains the intentional one-second live transport pacing guard.
- Every OpenRouter transport has a configurable hard timeout (180 seconds by default), including response-body reads.
- HTTP 429 preserves `Retry-After`, starts shared provider cooldown, stops the current canonical reaction wave cleanly while leaving remaining observations queued, and suppresses optional static/tick narrator calls until cooldown ends.
- Serialized `frameworkUI.turnBusy` is ignored/stripped; UI busy state is derived only from live runtime work, so interrupted saves cannot reopen permanently stuck on `Thinking...`.
- Ordinary causal AI reactions are serialized. Background mind work is explicitly non-blocking, while independent timelapse mind model work may run concurrently and commits remain source/stale validated against current canonical state.
- Latest 100 sanitized semantic AI exchanges remain available for diagnostics/export. A separate bounded low-level OpenRouter transport ring records every physical provider attempt, including early network/timeout/HTTP failures, while a bounded external-network ring records framework-owned weather/geolocation fetches.

### Save/load

- Current authored world + compatible runtime overlay migration.
- Current authored descriptions/definitions/known facts replace stale saved authored copies.
- Runtime beliefs, relationships, memories, continuation, wallet, sleeping, position/controller and valid item instances survive. Legacy character-owned `abstractStudyProgress` is migrated generically onto compatible item instances as per-reader runtime state.
- Dynamic reciprocal lock state survives by stable lock ID.
- Compatible saved event journal and pending observations survive migration; invalid references can be discarded safely.
- AI queue is restored/repaired from surviving pending observations.
- Runtime `nextEventId` / `nextObservationId` are reconstructed beyond preserved/injected IDs.
- A well-formed externally patched pending observation can therefore be used for story/debug experiments without engine-specific migration logic.
- In-place async mutations are synchronized into SugarCube's serializable active state before save export, preventing stale pre-tick/pre-timelapse saves.

### UI/editor/debug

- Main scene is split into deterministic static-scene, visible-character, dynamic-item, History, current-tick, quick-action, and player-control panels; empty normal panels collapse.
- Progressive committed scene rendering while input remains locked.
- Optional current-turn invisible-event debug display.
- Sidebar AI-activity admin controls can dismiss pending reactions, clear continuation, combine both, or globally clear non-kept AI characters on a safe idle boundary without emitting story events.
- Character runtime profile modal plus collapsed **Mind tools** showing verbatim/pending counts, STM/LTM topics, belief confidence+activation, diagnostic changes and auxiliary job state. Portable mind v3 carries beliefs/activation, relationships, STM/LTM and bounded verbatim; v1/v2 imports migrate deterministically. Snapshots/recentDialogue stay world-local.
- Standalone offline world editor for `data/world.json`, including free-form item equipment slots, Inventory/Equipped starting placement, and minimal visibility/editing for authored `dayActivities`. The editor visibility invariant is that every authored entity type must be surfaced even when its editing UX is crude.
- Crystal-sphere/prompt-lab diagnostics, dry runs and AI exchange import/export.
- **Emergency dump** remains available from the sidebar and an always-on top-level fixed control above blocking overlays; it exports one best-effort ZIP containing independent JSON diagnostics (`manifest`, game/SugarCube state, Mind v3 state/snapshots/diagnostics, scheduler/observations/aux-job state, raw/portable semantic AI exchanges, low-level AI transport history, external network history, weather runtime, latest handled timelapse result/failure stage, UI/narrator state, recent runtime errors), redacting API/authentication secrets and tolerating partially broken state.
- No normal gameplay button that manually processes pending AI work.

- Deterministic v2->v3 migration preserves developed character identity: old belief IDs/text/confidence semantics survive with neutral activation, old recent memories become one-for-one legacy STM, old LTM/relationships survive, and no historical summaries are fabricated into verbatim evidence. Portable mind uses the same migration semantics.
- Fresh worlds now block gameplay behind a one-button AI-interaction 18+ disclaimer followed by Traveler identity selection. The canonical runtime entity remains `player`; Generic, authored `travelerProfiles`, or per-save Custom authoring may overlay only name/public description/AI description. Location, inventory, wallet, controllers, abilities, mind, equipment and canonical gender-neutral otherworldly aura remain shared Traveler-shell state. Existing saves migrate as already initialized.

### Code organization

The former monolithic GameAPI has been partially extracted while preserving its public facade:

- `10-game-api.js`: deterministic world/action/event facade;
- `11-save-migration.js`: migration/reconciliation;
- `07-mind-v3.js`: centralized Mind v3 semantics/config/math;
- `12-character-context.js`: canonical restricted view + bounded Mind v3 context selection;
- `13-character-memory.js`: mind/continuation/portable-mind helpers;
- `13-verbatim-memory.js`: committed-experience capture;
- `24-memory-consolidator.js`: STM/LTM/reconciliation protocols and atomic commits;
- `24-mind-aux-executor.js`: non-blocking per-character background mind jobs.

Timelapse is split into a generic core plus overnight and daytime wrappers/policies.

## Known limitations / deferred work

- AI world progression is still Human-tick driven; there is no background real-time scheduler.
- Overnight and daytime timelapse are both exposed. Daytime supports AI-offered Mara/Harlan work and solo hunting, all using five committed rounds. Daytime planner contracts omit beds/sleep entirely and validation rejects any returned daytime sleep step; nighttime sleep remains available.
- Committed timelapse prose uses third-person world narration. Sponsored work narration receives the grounded sponsor ID/name explicitly and narrates the sponsor with the Traveler rather than emitting sponsor-perspective `You/I/We` prose.
- A first production layer is implemented: Mara work produces sponsor-selected Healing Salve/Stamina Potion items, Harlan work pays sponsor-selected 3-7 minted gold, and solo hunting produces 1-5 Squirrel Pelts by engine RNG. A general economy/pricing/shop system is still deferred.
- Professional NPC morning wake/work travel schedules are not implemented.
- Sleeping AI do not wake merely from receiving an observation; wake behavior still depends on normal action/speech semantics. Pre-existing pending observations for sleeping AI are nevertheless consumed at the first committed timelapse boundary, preventing stale pre-night reactions from resurfacing after coarse time.
- There is no formal `wake_other_character` action yet.
- Ordinary AI decision prompts can still become large as memories/beliefs grow. Retrieval-based hybrid memory is deferred.
- Ordinary game-decision reasoning/output budget has not yet been aggressively tuned; request profiles make measured tuning possible without scattering constants.
- Prompt caching/sticky routing are best-effort provider optimizations, not guaranteed cache hits.
- Generic `utility_query` sources that deliberately generate concrete lore still have no persistent encyclopedia corpus, so such sources can drift across repeated requests unless a future persistence layer is added. The current arcane slab avoids this class of inconsistency entirely because it uses deterministic `abstract_study` and performs no lore-generating model call.
- OpenRouter transport is non-streaming.
- Loudness currently supports noticeable/hidden only; shout propagation is absent.
- The ordinary presentation Narrator remains presentation-only and can still embellish incorrectly; deeper presentation grounding is deferred. The separate weather renderer is narrowly constrained to normalized API weather facts.
- Combat, equipment stacking/layering/concealment controls, quests, dialogue trees and a full economy are not implemented.
- Crystal sphere/temple debug scaffolding remains development-oriented.

## Next planned product work

Live-play and bug-fix the daytime/environment patch. After it stabilizes, the intended follow-up is a separate consistency/refactoring pass against the accumulated architecture/spec baseline. Broader professional schedules, additional production chains, prices/known-fact anchors, and a natural village economy remain future product work rather than part of this patch.
