# Project Status

## Implemented now

### Mallowstead release profile

- The user-facing product and village name is **Mallowstead**, version `0.1.2b`, created by **Dmytro Turovskiy** and licensed under MIT.
- `data/world.json` is the committed public canonical world. `data/world.private.json` is a local ignored private world. Default builds are public; explicit `private` builds use isolated staging so private authored/generated data never overwrites tracked public generated source.
- Public startup shows the full AI-content/privacy/network/cost/export disclosure before AI-key setup; private startup skips that disclosure and goes directly to practical API-key/status setup. Both profiles share gameplay and save schema.
- Public release packaging is a whitelist ZIP containing exactly `mallowstead.html`, player `README.md`, and `LICENSE`. Build metadata exposes version/profile/commit/build time in About and diagnostics.


### Runtime/world

- Canonical weekly rhythm is implemented: `calendar.dayNumber` derives the authored seven-day week, new worlds start Monday evening, and the overnight boundary advances the day exactly once before the new Morning is presented. Generic `weeklyPresence` excludes away characters from local scheduler/timelapse/observations/actions without deleting their persistent state; `presenceOwnerCharacterId` hides associated locations/sublocations from local topology while preserving them canonically.
- On a fresh Monday evening, Maksym the Wagoner begins seated at the tavern's second table with one tracked filled mug of ale. His later recurring visit lifecycle is unchanged: normal scheduled arrivals use Market Square and his sleep/work behavior remains governed by the existing wagon/weekly-rhythm systems.
- Narrow trade lifecycle support is implemented for scheduled merchants: deterministic arrival restock, item-level `sale_stock` / `acquired_stock` provenance, merchant-visible external sale values on explicitly authored goods, and departure settlement of eligible acquired goods only.
- Generic atomic `transfer_items` supports explicit multi-item character→character, character→accessible-container, and accessible-container→character transfers for Human and AI controllers.
- Generic writable paper is implemented: `Paper Sheet.content` is one persistent mixed string, `*...*` denotes drawing metadata, reusable accessible `Writing Set` enables `write_paper` without consumption, and `read_paper` exposes content only through a grounded read. Written Paper Sheet instances use one shared UI-only preview label across inventory, transfer/action pickers, Advanced Actions, and container/surface lists; canonical item names/content remain unchanged.

- Quick item actions are presentation-grouped from already validated formal actions: `Use item` expands to item-specific action labels, `Drop item` expands to distinct instances, and placement is grouped by destination; Advanced Actions retains the formal action list.
- Quick `Give gold` is presentation-only sugar over the existing `give_money` formal action: it appears only when the Human has transferable gold and a valid present recipient, then expands to recipient + bounded whole-number amount controls.

- Browser/SugarCube deterministic world simulation.
- Exactly one HumanController with Human/AI/Dummy controller switching.
- Canonical restricted character view shared by Human UI and ordinary AIController.
- Generic per-character discoverable locations are canonical runtime access state, separate from mind/known-fact prose. Undiscovered locations are filtered from exits/actions/model views and actor-specific timelapse routing, cannot be used as hidden shortcuts, and are suppressed from Human off-screen/`Elsewhere` presentation. A character can learn a hidden location by directly witnessing someone enter it or through the reusable validated `show_hidden_location` action.
- Locations, sublocations, beds/posture positions, explicit inventories and stable item instances.
- Atomic formal actions with current-state action catalogs and concrete option validation.
- Movement, item transfer/placement/transformation/use, item-defined equip/unequip, money, persistent passage locks/keys, key-gated containers, sleep, and character abilities.
- Single canonical `character_moved` event routed to source/destination perceivers. Move+speech can address an origin character or a destination character grounded by the Human player’s actually delivered last-known movement evidence; hidden current occupants are never exposed as destination targets, and stale knowledge does not block movement or leak the absent character’s real location.
- Locked-passage attempts produce grounded observations on both sides; the far side is anonymized rather than leaking actor identity through a closed door.
- Recipient pending-observation inbox is authoritative; model-facing observations are compact and omit routing/scheduler metadata.
- Bounded eight-utterance `recentDialogue` working context preserves own speech and actually heard Human/AI speech in delivery order across save/load without entering portable mind.
- Explicit sleeping state and wake-on-own-action/speech behavior.

### Authored world

- The local week is Sunday → Monday → Flamesday → Flowday → Woodsday → Goldsday → Earthsday; fresh worlds begin Monday evening.
- Market Square is permanent. Maksym the Wagoner, a young armed road merchant/adventurer, visits Monday and Woodsday; by Flamesday/Goldsday morning he and his conditional armored wagon topology are already away. He participates as an ordinary AI character in both local timelapses while present and receives ordinary maintenance before the departure boundary. Villagers know and generally enjoy his visits for goods/news/stories without special intimacy; he knows them as familiar customers/acquaintances and is not preoccupied with Mara/demon gossip.
- Maksym's four-ox armored wagon is a normal keyed location with a cramped sleeping bunk/cargo/private keyed chest. A separate locked sales chest sits on Market Square while he is present, uses the existing `requiredKeyItemId` container contract, and is stocked on arrival with variable regional/town goods including salt, cloth/clothing, sewing/household goods, paper, Writing Sets, small jewelry/luxuries and specialized tools. Bought local goods remain in his personal carried inventory.
- Squirrel Pelts, Healing Salve and Stamina Potion currently have narrow merchant-visible external sale values for this first material-wage liquidation loop; no universal price/common-knowledge economy is implied.

- Roadside tavern with Garrick, Nell, Guest Rooms, bar/common-room furniture and keys. Garrick's private room now has a key-gated personal chest whose ordinary key starts in Garrick's inventory.
- The committed public Mallowstead world does not author Captain Price. The developer-only private world may retain that experiment locally through the ignored `data/world.private.json` profile.
- Village street/temple/edge, separate Mara's Garden and Mara's Cottage locations (cottage floor/bed/table/alchemical shelves/private keyed chest), plus a reciprocal nearby Forest stream reached from the garden with a normal capacity-two sitting sublocation. Mara carries separate ordinary keys for her chest and the now-lockable, initially unlocked cottage entrance.
- **Trampled Glade** is the first authored discoverable location, concealed behind entrances from the Forest stream and Village Edge. Mara starts knowing it mechanically and through a grounded authored known fact; other existing characters do not. Its physical hook is only trampled circular grass, crushed twigs and unusually high broken branches—no supernatural explanation is authored yet. Completing a full solo squirrel-hunting day has one 10% discovery roll while the Traveler still does not know the glade.
- Working village Smithy off the Street near the temple, with forge floor, rear living room/bed/private keyed chest, and Harlan the Blacksmith starting at work with equipped clothing, smith's hammer, and his chest key. Harlan is authored around practical nails/horseshoes/fittings/tool repair, with seeded local ties to Garrick, Nell and Mara.
- Memory Stone deterministic item/use effect.
- Deterministic `abstract_study` authored item effect: bounded `use_item.input_text` -> committed item use -> authored private study feedback with `{inputText}` interpolation. Reader progress is owned by the physical item instance and keyed independently per character; related consecutive queries classify as `survey`, `focused`, then `saturated`, while unrelated questions reset that reader's thread. No Utility/model request occurs.
- Generic `utility_query` authored item effect remains available for genuinely model-backed information sources: bounded `input_text` -> committed physical item use -> deferred Utility-model information request -> private grounded result observation to the reader, with optional per-item output-token cap.
- **Slab of Full Arcane Knowledge** authored inside Mara's keyed private chest and implemented through `abstract_study`. A reader freely chooses a question/topic. The first consultation gives broad orientation, a related follow-up gives focused theoretical understanding, and a third related consultation reports diminishing returns and points toward practice or a genuinely different question. The slab still does not generate classifications, mechanisms, schools, spells, dates, recipes, or other new setting facts. It remains non-sentient, grants no instant mastery, and has no oracle access to current hidden facts/future.

### Ordinary AI turns

- Before an expensive Character-model decision, a Utility-model `mind-retrieval-preflight` sees current compact runtime context plus `STM/LTM id+topic+retrievalBrief` and `belief id+text+confidence+activation`, returns IDs only, and never receives full STM/LTM summaries. Empty briefs remain usable by topic; independent ambient backfill repairs all empty briefs and cannot block gameplay/maintenance.
- `pendingObservations` is now strictly an AI scheduler inbox. Human/Dummy characters retain committed experience in verbatim memory but do not accumulate scheduler backlog; controller switching and migration clear stale non-AI pending records.

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
- Structured model mutation output now follows the shared **Model Output Must Have Effect** invariant. Prompts explicitly tell models not to return unchanged upserts just because a record was relevant, and deterministic validators reject exact normalized no-op STM/LTM/relationship updates as a safety net. Unmentioned persistent records remain unchanged automatically; provenance does not turn an unchanged LTM into a valid write; repair removes no-ops rather than cosmetically rewriting them. Explicit `action:null`/negative decisions remain valid protocol results.
- Persistent Mind v3 layers are pending observations (unprocessed scheduler inbox), verbatim experienced history, thematic STM, thematic lossy LTM, and beliefs with independent numeric confidence + activation. Ordinary STM consolidation uses the full buffer, triggers strictly above 40, retains newest 20, and evicts exact older IDs only after validated atomic commit.
- Existing belief confidence is engine-owned log-odds math from semantic support/contradiction strength; activation is saturating salience that can rise even while confidence falls and decays during timelapse. Belief reconciliation can revise/merge/contextualize/supersede/remove or deliberately leave cognitive dissonance unresolved.
- Background STM work runs non-blocking through the Utility lane with one job per character, snapshot/stale/atomic-commit safety and canonical-decision priority. Its stale check is operation-specific: new verbatim and activation-only gameplay changes are compatible and merge onto current state, while STM/LTM/relationship changes or belief ID/text/confidence changes reject the result. New observations arriving while a job is in flight are never removed by that older job. Live STM consolidation has a dedicated 6000-token Utility completion profile; prompts require thematic grouping and canonical 0..1 importance, while common accidental model output on a >1..10 importance scale is normalized deterministically at protocol ingress before strict validation. STM summaries prefer <=2000 characters when practical but use 4000 as a per-record hard boundary across protocol/world/migration/portable-mind validation; LTM now shares the same 4000-character boundary. STM/LTM distinction is semantic rather than container-sized: STM optimizes for fidelity, while LTM is explicitly subtractive and retains the most significant facts that should survive after source STM deletion. When a broad STM can no longer remain coherent/high-fidelity inside that boundary, the STM protocol supports explicit model-owned semantic repartition of one or more unprotected source records into an atomic replacement set rather than stronger forced compression. Repartition may retain at most one source ID; all other replacement IDs are engine-allocated from the live global counter at commit. Source/upsert conflicts, overlapping sources, protected sources, invalid replacement records and stale source state reject the whole operation without source deletion or verbatim eviction. Every replacement counts toward the existing eight-write STM budget, and resulting STM continues into ordinary LTM consolidation without special persistent schema. STM `retrievalBrief` generation treats the brief as compact retrieval metadata rather than a second summary and states the hard maximum of 600 characters in the model prompt. STM output remains explicitly delta-only: persisted/migrated STM is read-only by default, cleanup/beautification rewrites are forbidden, unchanged records are omitted, and one roll is bounded to 8 total STM writes, 12 belief effects, 4 new beliefs and 12 activation IDs.
- Shared belief/relationship/STM/LTM/verbatim/dialogue validators are reused across runtime validation, migration, and portable mind import.

### Timelapse

- Generic timelapse core separated from overnight wrapper.
- Overnight mode: five coarse rounds, implicit reachable-room travel, sleep/narrate/authored macros.
- Private encounter intents + shared resolver + affected-character replanning.
- Safe parallelism for independent structural requests and per-character Mind v3 maintenance preparation; rounds remain sequential. Auxiliary computations never mutate shared state before validated commit, and engine-generated memory/belief IDs allocate from the then-current global counter.
- Structural timelapse requests use reasoning disabled and bounded outputs.
- Tick-mode `continuation` is cut before timelapse planning.
- AI that end the night sleeping remain sleeping in the morning; only Human control is returned/woken.
- Timelapse now has a forced pre-boundary verbatim->STM consolidation (entire pre-period buffer is the eviction set), committed-experience verbatim capture during coarse rounds, then STM/LTM consolidation, belief reconciliation and activation decay. Reflection updates only relationships/belief activation and relationship upserts are delta-only under the shared effect invariant. After all rounds/required settlement commit, reflection/maintenance failures are diagnostic-only and never silently drop source memory. LTM maintenance is evidence-driven rather than count-limited for genuinely required durable-memory writes/STM retirement, with a dedicated 12000-token completion profile. Its belief side now has an explicit fresh-evidence contract: supplied STM/LTM/relationships/beliefs are context rather than fresh evidence merely by being reread, consistency is not reinforcement, the model is forbidden to scan the belief table for compatible memories, `higherOrderBeliefEffects` is a sparse usually-empty channel for genuinely new cross-memory inference, and `activatedBeliefIds` is likewise materially-salient-only. Existing LTM may be read as relevant context without being echoed; unchanged normalized upserts are omitted before generation when the prompt is followed and rejected by validation otherwise. STM→LTM uses no fixed compression ratio and may fan one or more STM records into multiple coherent durable topics; low-value detail may be discarded, but significant durable facts should not be thrown away merely to minimize record count. STM, LTM, and ambient backfill reuse one retrievalBrief contract/validator (`<=600`, semantic retrieval metadata rather than a second summary). Every material LTM write carries `sourceStmIds`/`sourceLtmIds` provenance, but provenance is not itself an effect. Any number of unprotected STM records may retire only through explicit `represented` coverage or `safe_to_forget` groups using `routine`/`redundant`/`transient` reason codes. New LTM proposals use response-local refs for coverage links; refs/provenance/reason metadata never persist into character consciousness.
- Timelapse routing preserves canonical passage lock state: unlocked passages are available to everyone; a locked passage is available to a matching direct key holder without synthetic unlock/relock or lock-state mutation.
- Timelapse planning/encounter prompts explicitly keep every coarse round inside the authoritative source phase; models may anticipate the next phase but cannot narrate it as begun. Deterministic wrapper boundary work owns the single canonical phase transition.
- Progressive committed output during long ticks/timelapse.

### Global time, daytime work, and weather

- Canonical `world.environment` stores `timePhase` and saved `weatherNarrative`; every character view and the main UI receive the same global conditions. New/legacy worlds default to Evening, and ordinary ticks never advance time.
- AI sponsors use formal `offer_day_work`; a custom blocking Accept/Decline overlay pauses causal AI processing. Decline resumes without allowing already-reacted characters a second reaction in the same Human tick.
- Daytime uses the shared five-round timelapse core. It wakes all characters on entry, supports fixed sponsor work narration while other NPCs remain autonomous, performs reward settlement before reflection/maintenance, refreshes weather, and keeps canonical time in the Day span through deterministic boundary processing. Optional authored `routineAnchors` are applied while the source phase is still authoritative; only then does the engine perform the single transition to Evening. Anchor failure is soft and does not erase the lived day.
- Solo hunting at Forest stream has one Narrator block per committed round and engine-RNG Squirrel Pelt settlement.
- Timelapse planners can formally `study_item` when an `abstract_study` source is carried or accessible in the selected room. Items inside keyed containers are included only for characters directly carrying the exact required key item.
- Real weather uses CORS-capable `ipwho.is` IP geolocation + Open-Meteo + narrowly scoped narrator prose. Fresh-world gameplay now renders immediately while initial weather resolves asynchronously through the same refresh/fallback pipeline; a revision guard discards stale startup results after simulation advances. Saved weather survives load; failure preserves old/fixed fallback and never blocks play. Latest refresh diagnostics retain the exact failed pipeline stage, and the ordinary presentation-Narrator toggle does not disable weather rendering.

### AI inference

- OpenRouter browser client with Character, Utility and Narrator model roles. The ordinary presentation Narrator defaults OFF and remains opt-in; bounded environment rendering such as canonical weather prose uses the Narrator role independently.
- Shipped model catalog is role-filtered: Character offers DeepSeek V4 Flash as the default and DeepSeek V4 Pro as an available alternative; Utility currently defaults to DeepSeek V4 Flash only; Narrator currently offers Euryale 3.3 70B Nitro only. Selectors remain data-driven for future model testing.
- Utility model default: DeepSeek V4 Flash; Narrator default: Euryale 3.3 70B Nitro.
- Central `AIRequestProfiles` for ordinary decisions, timelapse structural jobs, reflection, consolidation and narrator requests.
- Ordinary Character requests include a compact `relevantMechanics` guide derived from relaxed action-source gating: it explains grounded mechanics whose anchor is present even when a non-anchor prerequisite is missing, while `view.available_actions` remains the executable-now authority. The prompt explicitly forbids narratively completing tracked effects merely because their formal action is not currently available and tells the Character to use a currently available prerequisite instead. Ordinary Character turns remain single-pass so retail Flash playtesting measures first-pass behavior directly.
- Ordinary character decisions remain on Character model with conservative existing budget.
- Utility jobs use Utility model, including authored non-character item information queries.
- Narration uses Narrator model.
- Provider routing prefers `latency` with fallbacks enabled.
- Stable non-secret OpenRouter `session_id` values improve sticky routing/cache locality where supported.
- Prompt construction keeps stable prefixes where practical; provider prompt caching may be used implicitly.
- Response caching is not used for gameplay.
- Shared request executor retains the intentional one-second live transport pacing guard.
- `StructuredAIRequest` now centralizes JSON parse/truncation/normalization/validation/repair/retry lifecycle for structured ordinary/timelapse/mind/retrieval calls while domain modules retain their own validators.
- Every OpenRouter transport has a configurable hard timeout (180 seconds by default), including response-body reads. The expensive Stage 2 Mind v3 LTM consolidation profile currently overrides this to 300 seconds; LTM preflight and ordinary gameplay keep the 180-second default.
- HTTP 429 preserves `Retry-After`, starts shared provider cooldown, stops the current canonical reaction wave cleanly while leaving remaining observations queued, and suppresses optional static/tick narrator calls until cooldown ends.
- Serialized `frameworkUI.turnBusy` is ignored/stripped; UI busy state is derived only from live runtime work, so interrupted saves cannot reopen permanently stuck on `Thinking...`.
- Ordinary causal AI reactions are serialized. Background mind work is explicitly non-blocking, while independent timelapse mind model work may run concurrently and commits remain source/stale validated against current canonical state.
- Latest 100 sanitized semantic AI exchanges remain available for diagnostics/export. A separate bounded low-level OpenRouter transport ring records every physical provider attempt, including early network/timeout/HTTP failures, while a bounded external-network ring records framework-owned weather/geolocation fetches.

### Save/load

- Current authored world + compatible runtime overlay migration.
- Current authored descriptions/definitions/known facts replace stale saved authored copies.
- Runtime beliefs, relationships, memories, continuation, wallet, sleeping, position/controller and valid item instances survive. Legacy character-owned `abstractStudyProgress` is migrated generically onto compatible item instances as per-reader runtime state.
- Dynamic reciprocal lock state survives by stable lock ID.
- Migration candidate validation is explicitly world-scoped: presence-aware exit/lock validation must inspect the fresh candidate being validated, never implicitly consult the restored legacy `State.variables.world`. This prevents older saves that predate newly authored conditional locations from failing merely because the candidate contains new keyed passages.
- Compatible saved event journal survives migration. Pending observations survive only for AI-controlled characters; legacy Human/Dummy scheduler backlogs are discarded while verbatim experience remains.
- AI queue is restored/repaired from surviving pending observations.
- Runtime `nextEventId` / `nextObservationId` are reconstructed beyond preserved/injected IDs.
- A well-formed externally patched pending observation can therefore be used for story/debug experiments without engine-specific migration logic.
- In-place async mutations are synchronized into SugarCube's serializable active state before save export, preventing stale pre-tick/pre-timelapse saves.

### UI/editor/debug

- Main scene is split into deterministic static-scene, visible-character, dynamic-item, History, current-tick, quick-action, and player-control panels; empty normal panels collapse.
- Progressive committed scene rendering while input remains locked. Day/night timelapse uses a blocking live-feed modal that streams committed world/Elsewhere events plus lifecycle stages such as planning, reflection, memory consolidation, weather refresh and routine return.
- Committed off-screen events are always shown to the human as styled **Elsewhere** narrative while remaining canonically invisible to the controlled character. History contains both witnessed and Elsewhere entries, opens upward from its trigger, lands on the latest entries, and preserves user scroll position when they browse older history.
- The gameplay sidebar is compact: character/gameplay state, a small AI status lamp, and Settings. API/model controls plus AI-activity admin tools (dismiss pending reactions, clear continuation, combine both, or globally clear non-kept AI characters on a safe idle boundary) live in Settings and emit no story events.
- Character runtime profile modal plus collapsed **Mind tools** showing verbatim/pending counts, STM/LTM topics, belief confidence+activation, diagnostic changes and auxiliary job state. Portable mind v3 carries beliefs/activation, relationships, STM/LTM and bounded verbatim; v1/v2 imports migrate deterministically. Snapshots/recentDialogue stay world-local.
- Standalone offline world editor for `data/world.json`, including current Mind v3 records/briefs, free-form item equipment slots, Inventory/Equipped starting placement, and authored `dayActivities`. Editor and world-data generator now share one authored validator embedded into the single offline HTML, preventing editor/build schema drift. The editor visibility invariant is that every authored entity type must be surfaced even when its editing UX is crude.
- Crystal-sphere/prompt-lab diagnostics, dry runs and AI exchange import/export.
- Settings shows a generated build date/timestamp.
- **Emergency dump** remains available from Settings and an always-on top-level fixed red control above blocking overlays. It preserves canonical world/SugarCube/minds/recovery points and complete semantic request/response diagnostics once, plus low-level transport/network/weather/timelapse/runtime-error data. Redundant exchange-log/message copies were removed while keeping enough state to reconstruct represented recovery points and diagnose network/protocol/structural failures.
- No normal gameplay button that manually processes pending AI work.

- Deterministic v2->v3 migration preserves developed character identity: old belief IDs/text/confidence semantics survive with neutral activation, old recent memories become one-for-one legacy STM, old LTM/relationships survive, and no historical summaries are fabricated into verbatim evidence. Portable mind uses the same migration semantics.
- Fresh worlds now use onboarding: AI-interaction disclaimer -> optional OpenRouter setup/help -> Traveler identity selection. The API-key field is always empty and input-only; adjacent status reports Available/Not set/Rejected. Reusable starter identities live only in a browser-local Starter Character Library with ZIP import/export and never become world/save references. The canonical runtime entity remains `player`; Generic or copied Custom authoring overlays only name/public description/AI description while location, inventory, wallet, controllers, abilities, mind, equipment and canonical aura remain Traveler-shell state. Legacy authored-profile saves migrate by materializing their saved runtime identity as Custom authoring.

### Code organization

The former monolithic GameAPI has been partially extracted while preserving its public facade:

- `10-game-api.js`: deterministic world/action/event facade;
- `10-weekly-rhythm.js`: calendar derivation, scheduled presence/conditional topology, merchant restock/settlement/provenance hooks;
- `11-save-migration.js`: migration/reconciliation;
- `07-mind-v3.js`: centralized Mind v3 semantics/config/math;
- `12-character-context.js`: canonical restricted view + bounded Mind v3 context selection;
- `13-character-memory.js`: mind/continuation/portable-mind helpers;
- `13-verbatim-memory.js`: committed-experience capture;
- `23-structured-ai-request.js`: shared structured-response lifecycle;
- `23-mind-consolidation-protocols.js`: STM/LTM/reconciliation protocol normalization, prompts and validators;
- `24-memory-consolidator.js`: maintenance orchestration and atomic commits, with at most one full recovery snapshot per logical run;
- `24-mind-semantic-retrieval.js`: ordinary-turn semantic mind selector with deterministic fallback;
- `24-retrieval-brief-backfill.js`: independent idempotent empty-brief recovery;
- `24-mind-aux-executor.js`: non-blocking per-character background mind jobs;
- `09-passage-rules.js`: extracted passage/lock/key rules used by the stable Game facade;
- `09-world-derived-state.js`: derived item-placement synchronization separated from validation;
- `29-debug-ui-formatters.js`: extracted Prompt Lab/Mind debug formatting.

Timelapse is split into a generic core plus overnight and daytime wrappers/policies.

## Known limitations / deferred work

- AI world progression is still Human-tick driven; there is no background real-time scheduler.
- Overnight and daytime timelapse are both exposed. Daytime supports AI-offered Mara/Harlan work and solo hunting, all using five committed rounds. Daytime planner contracts omit beds/sleep entirely and validation rejects any returned daytime sleep step; nighttime sleep remains available.
- Committed timelapse prose uses third-person world narration. Sponsored work narration receives the grounded sponsor ID/name explicitly and narrates the sponsor with the Traveler rather than emitting sponsor-perspective `You/I/We` prose.
- A first production/economy layer is implemented: Mara work produces sponsor-selected Healing Salve/Stamina Potion items, Harlan work still pays sponsor-selected 3-7 minted gold, solo hunting produces 1-5 Squirrel Pelts by engine RNG, and the scheduled road merchant can buy/receive goods through ordinary grounded transfers and liquidate only explicitly valued acquired goods off-map. A general common-knowledge pricing system, atomic Trade action, barter/shop abstraction, farmer production, and material Harlan wages are still deferred.
- Professional NPC morning wake/work travel schedules are not implemented.
- Sleeping AI do not wake merely from receiving an observation; wake behavior still depends on normal action/speech semantics. Pre-existing pending observations for sleeping AI are nevertheless consumed at the first committed timelapse boundary, preventing stale pre-night reactions from resurfacing after coarse time.
- There is no formal `wake_other_character` action yet.
- Ordinary `game-decision` uses cheap semantic preflight retrieval over compact STM/LTM/belief catalog entries, then supplies only full selected records to the Character model within the configurable 16-belief / 12-STM / 8-LTM budgets. Production hardening now sanitizes unknown/wrong-layer/duplicate/over-budget selector IDs instead of discarding the whole useful selection; valid empty selection is accepted, while true transport/parse/required-structure failure falls back to deterministic ranking without an extra selector repair request. Timelapse semantic retrieval remains deferred.
- STM consolidation ingress ignores an echoed model `protected` field as engine-owned metadata before strict validation, preventing unnecessary repair calls while preserving canonical protected-memory enforcement and rejecting unrelated unknown write fields.
- Ordinary game-decision reasoning/output budget has not yet been aggressively tuned; request profiles make measured tuning possible without scattering constants.
- Prompt caching/sticky routing are best-effort provider optimizations, not guaranteed cache hits.
- Generic `utility_query` sources that deliberately generate concrete lore still have no persistent encyclopedia corpus, so such sources can drift across repeated requests unless a future persistence layer is added. The current arcane slab avoids this class of inconsistency entirely because it uses deterministic `abstract_study` and performs no lore-generating model call.
- OpenRouter transport is non-streaming.
- Speech loudness supports Normal, Quiet/private, and Shout. Shout is stationary and targetless, uses the normal observation/reaction pipeline, reaches the current location plus exactly one authored topology hop regardless of lock state, and introduces no special forced-wake behavior.
- The ordinary presentation Narrator remains presentation-only and can still embellish incorrectly; deeper presentation grounding is deferred. The separate weather renderer is narrowly constrained to normalized API weather facts.
- Combat, equipment stacking/layering/concealment controls, quests, dialogue trees and a full economy are not implemented.
- Crystal sphere/temple debug scaffolding remains development-oriented.

## Next planned product work

Live-play the consolidated Mind v3 semantic retrieval and watch selector diagnostics/fallback frequency. Timelapse-specific semantic context reduction, professional schedules, broader economy/production, embeddings/vector prefiltering, and other product expansion remain future work.

## Current MVP / LTM maintenance scaling baseline

The project is now treated as an **MVP**; the proof-of-concept is considered demonstrated.

Save compatibility note: current SugarCube `StoryTitle` and save identity are `Mallowstead` / `mallowstead`. Mallowstead loaders also accept legacy `ai-rpg-framework-mvp` and `ai-rpg-framework-poc` save IDs. Browser save payloads are copied forward non-destructively into the Mallowstead namespace when the corresponding current entry is absent; legacy records remain intact.

Mind v3 LTM maintenance now uses a two-stage semantic preflight. Stage 1 sends full current STM plus the complete background significance context and a compact index of every historical LTM, then returns a high-recall list of relevant LTM IDs. Stage 2 repeats the full STM but loads full historical summaries only for the selected IDs. Selected existing LTM is the only historical upsert/provenance scope for that prepared proposal; new LTM creation is unaffected. Reflection belief activation is explicitly sparse and driven by fresh timelapse events rather than by merely seeing the belief table.

Optional browser persistence of the OpenRouter API key now expires after seven 24-hour days.
