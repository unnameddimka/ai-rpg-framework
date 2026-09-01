# AI RPG Repository Instructions

This file contains hard repository rules for coding agents. `docs/architecture.md` is the canonical design description and `docs/status.md` is the canonical current-status summary.

## 1. Authority and state ownership

- The deterministic engine owns objective world state.
- Models/controllers choose intentions; they do not directly mutate canonical mechanics or mind arrays.
- `data/world.json` is the committed public authored/static source. `data/world.private.json`, when present in a developer workspace, is an ignored private authored profile; shared world changes must be applied equivalently without overwriting private-only content. Generated world files are build products.
- A save owns compatible runtime state. Active Promises/HTTP requests/UI busy flags are transient process state and are never authoritative save state.
- Save migration is always **fresh current authored world + compatible saved runtime overlay**.
- Current authored definitions/descriptions/known facts win over stale saved authored copies.
- Compatible runtime position, inventory/item state, money, sleeping, beliefs, relationships, memories, continuations, dynamic lock state, committed events, pending observations, queue state, and counters survive migration.
- Generic migration may sanitize references to removed entities, but must not contain story-specific special cases.
- A well-formed externally patched pending observation is legitimate runtime state and must survive generic migration when its references remain valid.

## 2. Formal actions and grounding

- All formal character actions go through the canonical `CharacterAPI` path.
- `ActionRegistry`/current GameAPI action implementation is the single deterministic authority for action mechanics.
- `view.available_actions` is the only current capability contract exposed to a controller and contains only actions with at least one executable invocation in the current canonical state.
- **Human/AI character affordance parity guideline:** an AI-controlled character should generally be able to express the same ordinary in-world actions that the same character could perform under Human control in the same canonical situation, subject to authored capabilities and limitations. This is per-character parity: Mara's, Chuhaister's, and future character-specific abilities remain intentional distinctions rather than universal grants. Controller/admin UI operations are outside this guideline.
- AI formal actions must be validated against the current action type and that action's current concrete options before execution.
- Narrative/speech never substitutes for tracked mechanics such as movement, item transfer/transformation, equip/unequip, money transfer, locks, sleeping state, or ability results. Worlds may additionally author top-level `groundedItemPolicy` text reserving semantic item categories to engine mechanics while leaving ordinary narrative props free; unavailable grounded items never become narrative props merely because no formal item action is offered.
- **Never deterministically parse free-form narration to infer tracked actions, state changes, or protocol compliance.** No regex/keyword/phrase/action extraction from prose. The engine must rely on structured provenance, formal contracts, canonical state, validated results, and structured repair paths instead.
- **Formal Action Precedence:** if the current `view.available_actions` contains a formal action representing the intended tracked world-state change, the AI must use it. Narrative may supplement that attempt but may not replace it or claim completion of additional grounded steps. Work one formal step at a time; if several tracked actions are required at once, prefer the one requiring the fewest formal steps and preserve unfinished purposes in `continuation` for later formal turns.
- Narrative may describe cosmetic/untracked behavior, but it must never claim completion of an engine-tracked state change without the corresponding formal action. If a relevant mechanic is currently unavailable, use an available prerequisite when appropriate or leave the tracked result unfinished.
- **External prerequisite wait:** if a character's next step depends on another actor first completing a tracked state change and canonical state shows it has not happened yet, the character must wait (`action: null` unless another valid step exists) and may keep the dependency in `continuation`; another actor's speech/preparation is not completion.
- Model prose belongs to the attempt phase; deterministic engine result is authoritative completion/failure.
- **Canonical State Precedence:** current canonical world state and validated grounded action results are authoritative for tracked mechanics. Previous narration is literary history, not evidence that an item moved, ownership changed, a passage changed state, money transferred, a character moved/slept, or another tracked transition occurred. Model-facing history may retain narration for dialogue/style continuity, but must mark it non-authoritative for world state and must re-ground tracked facts from the current view/results.
- An impossible request outside the current action contract does not advance the Human world tick.
- A legitimate available action attempt that fails in-world consumes the turn and emits grounded failure feedback.
- **Epistemic grounding:** characters may lie, mislead, misunderstand, and form false inferences, but unsupported claims about unobserved events, another character's words/intentions/permission/promises, etc. must not be invented merely to connect dialogue. Presenting such a claim as true requires deliberate in-character deception with a concrete motivation; uncertain conclusions stay framed/stored as inference or belief. Reflection must preserve this provenance instead of converting a lie/inference into an observed fact.

## 3. Canonical view and AI context

- Ordinary HumanController and AIController use the same canonical restricted character `view` for public/operational truth.
- AI ordinary-decision context may add private identity instructions, private mind state, continuation, prepared pending observations, and bounded engine-owned recent dialogue, but must not create an alternate public world projection. Beliefs/STM/LTM are selected by cheap semantic preflight within the configured 16/12/8 budgets; selector failure must fall back to deterministic bounded retrieval rather than fail the turn. STM/LTM preflight catalogs expose only `id/topic/retrievalBrief`, never full summaries.
- `pendingObservations` are strictly the authoritative **AI scheduler** reaction inbox. Human/Dummy recipients still gain committed verbatim experience but must not retain scheduler pending records; controller switching/migration clear stale non-AI backlogs. Event-journal recipient/processed metadata is diagnostic/history bookkeeping and must not become a second eligibility queue.
- Model-facing observations must be compact recipient-safe projections; never leak event routing/scheduler/provider metadata such as `recipients`, `pendingFor`, `processedBy`, controller IDs, or provider diagnostics.
- **Model-context minimality guideline:** keep model-facing context as small, relevant, and role-appropriate as practical. For an ordinary Character decision, prefer information that helps the model understand the current situation, make a human-like character decision, or execute an available operation; omit information that serves none of those purposes when practical. Utility/repair/maintenance and Narrator contexts should be similarly bounded to their assigned task. This is signal-over-noise guidance, not a hard token-minimization invariant; grounding, validation, identity/personality, relevant mind state, repair, and other correctness-preserving context remain legitimate.
- Do not duplicate large data already present in the view under aliases, and do not advertise impossible action records merely to show that an engine mechanic exists; grounded-but-not-yet-executable mechanic awareness belongs in `relevantMechanics`.
- **Action prerequisite consistency:** model-facing action/mechanic descriptions must mean the same thing as the deterministic executable contract. Do not blur distinctions the engine enforces (for example accessible vs directly carried, carried vs equipped, reachable vs merely visible). Relevant mechanics may describe prerequisites that are not yet satisfied, but must describe those prerequisites accurately.
- Maintenance workflows (timelapse planning, reflection, consolidation, narrator work) are not ordinary controller decisions and may use purpose-specific compact contexts. Reflection must reuse the ordinary grounded AI-visible character projection for relevant nearby character identity (`id`, display name, visible description) instead of reconstructing canonical IDs from prose; do not expose an omniscient world roster solely for ID lookup.
- Do not build a full ordinary character view only to discard most of it for a maintenance request.

## 4. Controllers and world ticks

- Exactly one character is HumanController-controlled.
- Switching Human control is atomic and repairs/rejects invalid zero/multiple-Human states.
- Human Submit creates one world tick.
- After a valid Human turn, synchronously process AI reactions causally created by that tick.
- Each eligible AI character reacts at most once per Human world tick.
- Ordinary AI reactions remain sequential because a later AI may need observations created by an earlier committed reaction.
- Formal-action targets receive stronger within-tick initiative than speech targets; speech targets outrank normal deterministic queue order.
- Off-screen AI reactions still execute canonically and are always presented to the human as **Elsewhere** content. Canonical `visibleToHuman=false` remains epistemic: the Human-controlled character did not perceive the event, and presentation must never leak it into that character's observations, memory, or model context.

## 5. Continuation

- `continuation` is model-authored opaque working intention.
- The engine stores/returns it but does not interpret, validate, prioritize, or execute its semantic content.
- Ordinary tick continuation must be re-evaluated against the refreshed canonical view on each reaction.
- Tick-mode continuation is cut when entering coarse timelapse. Do not pass unfinished granular tick obligations into timelapse planning.

## 6. Timelapse

- Timelapse is a generic coarse-time framework with both overnight and daytime modes exposed in gameplay.
- Timelapse model contracts/request validation belong in `23-timelapse-protocol.js`; transactional coarse-time execution belongs in `24-timelapse-core.js`; overnight entry/exit policy belongs in `24-night-timelapse.js`, while daytime jobs/settlement policy belongs in `24-daytime-timelapse.js`. Structured sponsor settlement uses the shared `23-structured-ai-request.js` lifecycle rather than a private parse/repair loop.
- Generic prompts must be mode-aware and must not hard-code overnight semantics.
- Current overnight and daytime modes each use five sequential committed rounds. Daytime sponsored jobs may bind a sponsor to a fixed worksite while free NPCs still use ordinary timelapse planning. `sleep` is a nighttime-only timelapse action: daytime planner contracts/catalogs must not expose it, and daytime validation/execution must reject it defensively.
- Committed timelapse narrative prose is third-person world narration. Sponsored daytime narration receives the sponsor's grounded canonical ID/name explicitly and must narrate `Mara/Harlan/...` with the Traveler rather than using sponsor-perspective `You/I/We`; quoted dialogue may use ordinary pronouns.
- Independent structural requests may run concurrently where explicitly allowed by the timelapse workflow.
- `narrate` is not a tracked-state mutation channel.
- Authored timelapse actions are deterministic macros for tracked coarse-time effects.
- AI characters sleeping at the end of overnight remain sleeping in the morning. HumanController is returned/woken. Entering daytime timelapse wakes all characters, and a successful daytime timelapse ends with all characters awake.
- Progressive output may reveal already committed results but never speculative plans/thinking. Daytime rewards are settlement-only and may not be created before all five rounds commit.
- After all required coarse rounds (and required settlement) have committed, reflection/maintenance failures are diagnostic-only: they must not undo the lived period or block Night→Morning / Day→Evening. World-state, round, settlement, and final canonical validation failures keep their existing failure semantics. Invalid reflection relationship IDs get one bounded repair attempt; if repair still fails, safely separable malformed relationship updates may be dropped while valid mind changes survive.
- Timelapse pathfinding respects persistent passage lock state without synthesizing unlock/relock: unlocked passages are traversable by everyone; locked passages are traversable only by actors directly carrying a matching passage key, and successful coarse traversal does not mutate `locked`.

- Canonical global environment state owns coarse `timePhase` and saved `weatherNarrative`. Ordinary ticks never advance time automatically; only valid coarse-time entry points change phase.
- Day-work offers are AI-owned formal actions. A pending offer pauses the current causal reaction wave until Human accepts/declines; resume must preserve the one-reaction-per-Human-tick invariant.
- Emergency Dump is a cross-cutting UI escape hatch and must remain directly usable even while gameplay/modal/AI/timelapse/migration UI is blocked. It must preserve enough canonical/SugarCube/mind/recovery-point state to reconstruct represented save points and enough complete request/response + transport/network/protocol metadata to diagnose failures. Full diagnostic payloads should exist once; remove duplication that serves neither recovery nor diagnosis.

## 7. AI request architecture

- Production requests should resolve through `setup.AIRequestProfiles` unless an exception is explicit and documented.
- Model roles:
  - Character: ordinary AIController decisions.
  - Utility: timelapse planning/replanning/intents/resolver, reflection, consolidation, authored non-character information-source queries.
  - Narrator: optional presentation prose plus explicitly bounded non-mechanical rendering jobs such as canonical weather prose. A bounded Narrator job may render engine-supplied facts but may not invent tracked mechanics or additional world changes.
- Current shipped role defaults are Character = DeepSeek V4 Flash (DeepSeek V4 Pro remains a supported Character alternative), Utility = DeepSeek V4 Flash, Narrator = Euryale 3.3 70B Nitro. Role selectors must remain catalog-driven so future supported models can be tested without code-path changes. If an invalid/unavailable configured Utility model cannot be resolved locally, fall back safely to Character role where the workflow supports fallback.
- Ordinary character decisions retain the Character model.
- OpenRouter routing keeps fallbacks enabled; Character-role requests use `provider.sort = "throughput"`, while Utility/Narrator roles use `provider.sort = "latency"`.
- Use stable non-secret `session_id` values for sticky routing/cache locality.
- Never put API keys or secrets into `session_id`, logs, saves, model context, or world data.
- Do not enable response caching for gameplay responses.
- Preserve stable prompt prefixes where practical to benefit provider prompt caching.
- The one-second live transport pacing guard is intentional and must remain unless explicitly redesigned.
- Every OpenRouter transport has a hard liveness timeout (default 180 seconds) covering fetch plus full response-body read. Timeout returns structured `AI_REQUEST_TIMEOUT` and must unwind all executor/controller/wave busy counters. Every physical provider attempt must also enter the bounded low-level transport diagnostics even if it fails before a normal semantic exchange completes; never log API keys or Authorization secrets.
- HTTP 429 preserves provider status/`Retry-After` and drives a shared provider cooldown. Optional presentation narrator work must skip instead of waiting/sending during that cooldown; canonical character work remains retryable and is never discarded.
- Framework-owned external API fetches that matter to runtime infrastructure (currently IP geolocation/Open-Meteo) must use bounded external-network diagnostics with sanitized endpoints and explicit logical stages. Weather keeps `ip-geolocation`, `weather-fetch`, `weather-narration`, and `weather-commit` diagnostics; failure is non-fatal and preserves prior/fallback weather.
- UI turn-busy state is transient runtime state. Never serialize or resurrect a saved `frameworkUI.turnBusy` as evidence of live asynchronous work.
- Ordinary causal reaction waves must not be parallelized for latency.

## 8. Model protocol and safety

- Model outputs are local JSON contracts, not executable code.
- AI `publicNarrative` is visible narration/behavior only; `spokenText` is words actually spoken only. Do not hide narration inside `spokenText` or use either channel as an alternate tracked-state commit path.
- Structured epistemic source is engine-known provenance, not prose interpretation: `formal_fact`, `direct_observation`, `heard_speech`, and `own_speech` remain distinct from mechanical `worldStateAuthority`. Heard/own speech grounds that the utterance happened, not that every proposition inside it is objectively true. Preserve the actual supplied source; never silently promote testimony to firsthand memory or invent when/where/from-whom a claim was learned.
- In crowded dialogue, prefer a distinct contribution or a genuine no-op over merely paraphrasing/revoicing the immediately preceding speaker. Repetition remains valid when it has a clear in-world function such as clarification, quotation, surprise, emphasis, or misunderstanding. Do not implement prose-similarity policing.
- Reject extra/invalid fields according to the relevant protocol.
- At most one repair request is permitted for malformed/schema-invalid structured output unless a workflow explicitly documents otherwise.
- Repair prompts must remain grounded in the current canonical contract/options.
- Model failures must not silently commit speculative state.
- A failed AI reaction restores that reaction's uncommitted snapshot; earlier committed reactions remain committed.

## 9. Memory

- `mind.pendingObservations` is the unprocessed scheduler/reaction inbox. It is not autobiographical memory.
- `mind.verbatimObservations` is persistent compact experienced history: committed delivered observations plus the character's own committed actions/speech and committed timelapse experiences. It must not contain uncommitted intentions, hidden information, provider/scheduler metadata, or fabricated summary events.
- `mind.shortTermMemories` and `mind.longTermMemories` are thematic autobiographical memory. STM is relatively detailed; LTM is intentionally more lossy and durable. Stable engine-owned IDs, protected-memory semantics, candidate-clone validation, and atomic commit remain mandatory.
- Beliefs are inductive interpretations, not event history. Every belief has numeric `confidence` and `activation` strictly inside `(0,1)`. Model output reports semantic evidence direction/strength; engine-owned log-odds math updates existing confidence. Activation is separate salience, rises from relevant use/evidence, and decays during timelapse; confidence does not generically decay with time.
- Ordinary AI/reflection output may update relationships and explicitly activate supplied beliefs, but may not directly author autobiographical memories, belief text/confidence, or belief deletion. Experience flows through verbatim -> STM -> LTM.
- Ordinary STM consolidation is eligible strictly above 40 verbatim observations. It snapshots the whole buffer, retains the newest 20, and treats every older record as the exact eviction set. Only eviction records count as newly consumed direct belief evidence; retained overlap is interpretive context and is not double-counted next pass. Source records are removed only after validated successful commit.
- Timelapse is a cognitive synchronization boundary. Before planning, force-consolidate the entire current verbatim snapshot as the eviction set. During timelapse, only actually committed/delivered experiences create verbatim records. Afterward, run eligible STM/LTM consolidation, higher-order belief reappraisal/reconciliation, and activation decay; failed mind work is diagnostic-only after lived coarse-time commits and never silently drops source memory.
- Belief reconciliation is evidence-backed reflective interpretation, not compulsory consistency repair. It may revise, merge, weaken, reinforce, contextualize, supersede, remove, or intentionally leave conflicting beliefs unresolved. It may not mutate autobiographical memory.
- Background STM work runs through the Utility model lane and is non-blocking for gameplay UI. At most one queued/active job exists per character. Every job is snapshot -> async prepare -> validate -> stale check -> atomic commit; new observations arriving after snapshot are never removed by an older job. Canonical decisions/reaction waves have priority. In-flight auxiliary jobs are transient and are not saved/resurrected.
- Multi-character timelapse mind work may prepare concurrently. No auxiliary model computation mutates shared canonical state before commit; IDs are allocated from the then-current global allocator at commit, so unrelated allocator advancement is not itself a stale condition.
- v2->v3 migration is deterministic and model-free: preserve belief IDs/text/confidence semantics and add neutral activation, map old `recentMemories` one-for-one into legacy STM, preserve old LTM/relationships, and start v3 verbatim empty. Do not re-induce the character's established personality from old memory.
- Portable mind v3 carries beliefs (confidence + activation), relationships, STM, LTM, and bounded verbatim observations. It excludes pending observations, scheduler/controller/world physical state, active auxiliary work, continuation, and recentDialogue. Older portable minds migrate through the same deterministic v2->v3 semantics.
- Shared canonical validators govern beliefs, relationships, STM/LTM, verbatim observations, and recentDialogue across live runtime, migration, portable import, and world validation. `knownFacts` remain authored/current-world knowledge and are never overwritten by belief/memory maintenance.
- Engine-owned `recentDialogue` remains bounded conversational working context outside `mind`: own validated speech plus only speech actually delivered through perception, saved normally but excluded from portable mind.

## 10. Movement, perception, sleeping

- Major location movement emits one canonical `character_moved` event with source and destination.
- Deliver that event to the union of characters who can perceive the actor from either side.
- Do not split one movement into separate departure/arrival canonical events.
- Sleeping is explicit canonical state, separate from ordinary occupancy of a sleep-capable position. A sleep-capable sublocation may define `sleepCapacity <= capacity`; missing `sleepCapacity` defaults to ordinary `capacity`. Awake occupants consume ordinary capacity but not sleeping capacity, while sleepers consume both.
- Observation alone does not mechanically wake a character.
- A blocked attempt to traverse a locked passage emits a grounded physical-attempt observation to perceivers on both sides. Far-side recipients must not learn the actor identity unless another rule independently establishes it; use anonymous wording such as “Someone tried the door from the other side.”
- Existing wake-on-own-action/speech semantics remain authoritative.

## 11. Items and authored content

- Item definitions are authored types; item entities are stable/runtime instances.
- Initial stable instances belong in `data/world.json` and appear in new worlds/fresh authored baselines.
- Saved compatible runtime placement/state for an existing stable item instance wins over its authored starting placement.
- New authored stable instances absent from an older save remain in their current authored starting placement after migration.
- Item use may emit private/public grounded feedback without requiring buffs/stats. Narrative-only effects are valid when explicitly authored.
- A sublocation inventory may declare `requiredKeyItemId`, referencing one concrete ordinary item instance. Protected contents are visible/actionable only while that exact item is directly in the actor's normal inventory; keys on surfaces, in other containers/characters, or equipped do not count. This gates take/place/use/study consistently, including timelapse, and deliberately adds no container open/closed/lock/unlock state.
- Text-input item effects may be deterministic (`abstract_study`) or model-backed (`utility_query`). `abstract_study` must return authored feedback only and make no model request. It may keep bounded reader-specific runtime study progress for the source and deterministically classify related follow-ups as `survey`, `focused`, or `saturated`; this state is learning/progress metadata, not generated lore. Model-backed item information effects must remain post-action effects: first validate/commit the deterministic physical `use_item`, then execute the deferred Utility request. Never let model output become an alternate mechanical commit path.
- A `utility_query` source is not a character: do not give it controller state, mind, relationships, autonomous turns, or the reader's private mind unless a future architecture explicitly authorizes such context.
- Generated information-source text grounds what the source returned; it does not automatically elevate every embedded claim to objective canonical truth.
- `utility_query` authoring must control lore specificity explicitly. Do not invent new proper nouns/dates/named world facts unless the authored source contract deliberately authorizes generative concrete lore. When only character learning/progress is needed, use deterministic `abstract_study` instead of asking a model to summarize the subject.
- `utility_query` may declare a bounded per-item `utilityMaxTokens`; use it to constrain genuinely model-backed sources. `abstract_study` has no model-output budget because no model is called.
- `abstract_study` progress belongs to the physical item instance and is keyed independently by reader character ID. Do not store this mechanic-specific bookkeeping in `character.mind`; legacy character-owned progress migrates generically onto compatible item instances.
- Do not add one-off story migration fields to item definitions/instances.

## 12. UI/editor

- Normal gameplay UI is generated from canonical state/action availability.
- Do not add alternate manual execution paths for pending AI work. Read-only/debug visibility and safe admin cancellation/cleanup are acceptable.
- Admin cleanup may dismiss pending reactions and/or clear opaque continuation, but must be rejected while live AI/migration work is in flight, must not emit story events, and must not implicitly sleep/wake characters or mutate persistent physical/mind state.
- The standalone editor edits `data/world.json`; it does not need Node/server/build tooling. The editor must surface every authored entity type present in world data, even when editing UX for a newly added entity is intentionally minimal.
- Do not hand-edit `src/generated/` artifacts.

## 13. Files and refactoring

- Keep the public runtime facades (`setup.Game`, `setup.CharacterAPI`, `setup.TimelapseAPI`) stable where practical. `setup.GameInternals` is an internal/testing surface, not a public gameplay API.
- Prefer extraction over broad rewrites.
- Current major ownership boundaries:
  - `07-mind-v3.js` / `08-mind-validators.js`: canonical Mind v3 semantics and shared record validation;
  - `09-persistence.js`: save-state synchronization helpers; `09-world-state-authority.js`: shared structured `worldStateAuthority` normalization/projection; `09-action-option-validation.js`: pure action-option/cross-field contract validation shared by Game preflight and AI protocol; `09-passage-rules.js`: passage/lock/key rules; `09-world-derived-state.js`: derived item-placement synchronization;
  - `10-game-api.js`: stable deterministic `setup.Game` facade and intent/transaction orchestration; `10-game-00-item-mechanics.js`: generic runtime item/inventory primitives; `10-game-01-validation.js`: runtime world validation; `10-game-02-actions.js`: action registry, AI metadata and affordance projection; `10-trade-lifecycle.js`: merchant stock/provenance/restock/departure settlement; `10-presence.js`: neutral local-presence authority; `10-weekly-rhythm.js`: calendar/schedule/awayable lifecycle policy; `10-triggered-events.js` / `10-authored-effects.js`: authored event/effect execution;
  - `11-save-migration.js`: fresh-authored-world + runtime-overlay reconciliation and deterministic legacy-mind migration;
  - `12-character-context.js`: restricted views and model-facing context; `13-character-memory.js` / `13-verbatim-memory.js`: mind helpers and committed-experience capture; `14-event-perception.js`: routing/perception/observation/dialogue projection;
  - `15-ai-admin.js` / `16-emergency-diagnostics.js` / `17-runtime-diagnostics.js`: safe runtime administration and diagnostics;
  - `20-controllers.js`: Human/Dummy/AI controllers; `20-starter-character-library.js`: browser-local reusable Traveler identity presets;
  - `21-ai-request-profiles.js` / `21-ai-settings.js` / `22-openrouter-client.js`: model-role profiles, settings, and transport;
  - `23-ai-protocol.js`: ordinary Character structured contract; `23-structured-ai-request.js`: shared structured JSON parse/normalize/validate/repair lifecycle; `23-timelapse-protocol.js`: timelapse planning/interaction/reflection model contracts and requests; `23-mind-consolidation-protocols.js`: Mind maintenance contracts; `23-world-environment.js`: canonical coarse time/weather; `23-z-action-contract-repair.js`: bounded action-contract repair;
  - `24-ai-request-executor.js` / `24-ai-turn-scheduler.js`: request execution and causal reaction scheduling; `24-timelapse-core.js` with `24-daytime-timelapse.js` / `24-night-timelapse.js`: transactional coarse-time core plus mode policy; `24-memory-consolidator.js`, `24-mind-semantic-retrieval.js`, `24-retrieval-brief-backfill.js`, `24-mind-aux-executor.js`: Mind maintenance/retrieval; `24-item-model-effects.js`: deferred Utility item effects; `24-prompt-lab.js`: prompt/debug tooling;
  - `25-turn-flow.js`: Human tick orchestration; `26-presentation-narrator.js`: optional presentation narration; `29-debug-ui-formatters.js`: debug formatting; `30-game-ui.js`: browser UI.
- Preserve stable IDs, JSON field names, save compatibility, event order, and available-action shapes during structural refactors.

## 14. Sensitive-content engineering

- Existing game/save/dump data may contain explicit material. Treat it as domain data: preserve canonical content faithfully during migration, validation, storage, diffing, recovery and testing.
- Engineering/psychological/narrative analysis may use such material as evidence for non-explicit concepts such as attraction, intimacy, trust, boundaries, attachment, jealousy and fear.
- Developer-facing explanations should prefer neutral semantic labels/IDs when exact explicit wording is unnecessary. Do not censor or rewrite canonical state merely to make diagnostics less explicit.
- Synthetic regression fixtures should prefer neutral content unless exact source text is technically necessary to reproduce a parser/protocol bug.

## 15. Validation before completion

For any implementation patch:

1. run `./test.sh` (or `test.bat` on Windows);
2. run `./build.sh` (or `build.bat`);
3. ensure generated files are current;
4. when delivering a patch, verify it by applying it to a clean copy of the declared source archive and rerun tests/build;
5. do not touch Git/GitHub unless explicitly asked.
