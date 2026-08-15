# Project Status

## Implemented now

### Runtime/world

- Browser/SugarCube deterministic world simulation.
- Exactly one HumanController with Human/AI/Dummy controller switching.
- Canonical restricted character view shared by Human UI and ordinary AIController.
- Locations, sublocations, beds/posture positions, explicit inventories and stable item instances.
- Atomic formal actions with current-state action catalogs and concrete option validation.
- Movement, item transfer/placement/transformation/use, money, locks/keys, sleep, and character abilities.
- Single canonical `character_moved` event routed to source/destination perceivers.
- Explicit sleeping state and wake-on-own-action/speech behavior.

### Authored world

- Roadside tavern with Garrick, Nell, Guest Rooms, bar/common-room furniture and keys.
- Captain Price as a character.
- Village street/temple/edge, Mara's secluded cottage with garden/bed/table/alchemical shelves, and a reciprocal nearby Forest stream location with a normal two-person sitting sublocation.
- Memory Stone deterministic item/use effect.
- Deterministic `abstract_study` authored item effect: bounded `use_item.input_text` -> committed item use -> authored private study feedback with `{inputText}` interpolation. Reader progress is owned by the physical item instance and keyed independently per character; related consecutive queries classify as `survey`, `focused`, then `saturated`, while unrelated questions reset that reader's thread. No Utility/model request occurs.
- Generic `utility_query` authored item effect remains available for genuinely model-backed information sources: bounded `input_text` -> committed physical item use -> deferred Utility-model information request -> private grounded result observation to the reader, with optional per-item output-token cap.
- **Slab of Full Arcane Knowledge** authored on Mara's work table and implemented through `abstract_study`. A reader freely chooses a question/topic. The first consultation gives broad orientation, a related follow-up gives focused theoretical understanding, and a third related consultation reports diminishing returns and points toward practice or a genuinely different question. The slab still does not generate classifications, mechanisms, schools, spells, dates, recipes, or other new setting facts. It remains non-sentient, grants no instant mastery, and has no oracle access to current hidden facts/future.

### Ordinary AI turns

- Human Submit advances one world tick and synchronously drains the causally created AI reaction wave.
- Each eligible AI reacts at most once per Human tick.
- Targeted formal action > targeted speech > deterministic queue ordering.
- Later AI in the same tick see observations committed by earlier AI.
- AI actions hard-validate against current `view.available_actions` including option values.
- Combined speech/narrative + at most one formal action attempt.
- Grounding barrier between model attempt prose and deterministic engine result.
- Opaque model-authored `continuation` for unfinished ordinary-tick purpose.
- Structured recent-memory/belief/relationship updates.

### Timelapse

- Generic timelapse core separated from overnight wrapper.
- Overnight mode: five coarse rounds, implicit reachable-room travel, sleep/narrate/authored macros.
- Private encounter intents + shared resolver + affected-character replanning.
- Safe parallelism for independent structural/maintenance waves; rounds remain sequential.
- Structural timelapse requests use reasoning disabled and bounded outputs.
- Tick-mode `continuation` is cut before timelapse planning.
- AI that end the night sleeping remain sleeping in the morning; only Human control is returned/woken.
- End-of-period reflection and transactional memory consolidation.
- Progressive committed output during long ticks/timelapse.

### AI inference

- OpenRouter browser client with Character, Utility and Narrator model roles.
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
- Ordinary causal AI reactions are serialized; explicitly safe timelapse maintenance work may run concurrently.
- Latest 100 sanitized AI exchanges are available for diagnostics/export.

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

- Minimal main Human input with persistent addressee/loudness selection and auto-growing text area.
- Progressive committed scene rendering while input remains locked.
- Optional current-turn invisible-event debug display.
- Character runtime profile modal plus collapsed **Mind tools** for manual compression and strict JSON export/import of portable character mind (`beliefs`, `relationships`, recent/long-term memories). Import is replace-only and exact-character-ID guarded.
- Standalone offline world editor for `data/world.json`.
- Crystal-sphere/prompt-lab diagnostics, dry runs and AI exchange import/export.
- No normal gameplay button that manually processes pending AI work.

### Code organization

The former monolithic GameAPI has been partially extracted while preserving its public facade:

- `10-game-api.js`: deterministic world/action/event facade;
- `11-save-migration.js`: migration/reconciliation;
- `12-character-context.js`: canonical restricted view + AI context primitives;
- `13-character-memory.js`: mind/continuation helpers.

Timelapse is split into generic core + overnight wrapper.

## Known limitations / deferred work

- AI world progression is still Human-tick driven; there is no background real-time scheduler.
- Only overnight timelapse is currently exposed. Daytime timelapse is deferred.
- Village professions/economy/work rewards are not yet implemented. Future direction is concrete local employers/jobs that produce tracked items or gold and support an evening return-to-tavern loop.
- Professional NPC morning wake/work travel schedules are not implemented.
- Sleeping AI do not wake merely from receiving an observation; wake behavior still depends on normal action/speech semantics.
- There is no formal `wake_other_character` action yet.
- Ordinary AI decision prompts can still become large as memories/beliefs grow. Retrieval-based hybrid memory is deferred.
- Ordinary game-decision reasoning/output budget has not yet been aggressively tuned; request profiles make measured tuning possible without scattering constants.
- Prompt caching/sticky routing are best-effort provider optimizations, not guaranteed cache hits.
- Generic `utility_query` sources that deliberately generate concrete lore still have no persistent encyclopedia corpus, so such sources can drift across repeated requests unless a future persistence layer is added. The current arcane slab avoids this class of inconsistency entirely because it uses deterministic `abstract_study` and performs no lore-generating model call.
- OpenRouter transport is non-streaming.
- Loudness currently supports noticeable/hidden only; shout propagation is absent.
- Narrator remains presentation-only and can still embellish incorrectly; deeper narrator grounding is deferred.
- Combat, equipment, quests, dialogue trees and a full economy are not implemented.
- Crystal sphere/temple debug scaffolding remains development-oriented.

## Next planned product work

After observing the Mara arcane-slab episode in live play, the next design phase is expected to focus on daytime timelapse and a grounded village work/economy loop: farmers, hunters, woodcutters, blacksmiths, tinkers/shepherds or similar persistent opportunities, with deterministic item/gold rewards that can fund food/drink/another tavern room.
