# AI RPG Architecture

## 1. Design goal

AI RPG combines a deterministic stateful RPG engine with stateless model inference. The framework should permit emergent character behavior without allowing generated prose to become an alternate game engine.

The core separation is:

> **engine = objective world; controller/model = intention; presentation = prose**

## 2. Authored world and runtime save

### 2.1 Authored/static source

`data/world.json` is the authoritative committed public authored world document. A developer workspace may additionally contain ignored `data/world.private.json`, which carries the same shared world plus private-only authored experiments. Shared authoring changes must be kept in parity without replacing private-only content. Build tools validate the selected profile and generate embedded source data; generated artifacts are never authored by hand.

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
- authored timelapse actions;
- authored seven-day calendar labels, optional scheduled character presence, conditional topology owners, and narrow trade lifecycle/restock metadata.

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
- AI inference session identity;
- canonical calendar day counter;
- generated trade-stock provenance and writable paper instance `content`.

### 2.3 Migration

Compatible older saves are reconciled transactionally as:

> **fresh current authored world + compatible saved runtime overlay**

Current authoring wins for static definitions. Compatible runtime state wins for what actually happened during play.

New authored stable entities absent from an old save appear from current authoring. Stable existing runtime item instances preserve saved state/placement. Removed authored entities are not resurrected merely because an old save contained them.

Dynamic reciprocal lock state is restored by stable `lockId` when compatible.

Valid saved runtime events and pending observations survive migration when their referenced current entities remain valid. Invalid references may be sanitized/discarded with migration warnings. Runtime counters are reconstructed above all preserved IDs.

A manually patched save may therefore add a well-formed pending observation for a current character. No special story migration code is required: queue restoration/repair makes an AI-controlled recipient with pending observations normally eligible.

Migration validates the complete candidate before atomically replacing the restored world. Failure leaves the original save state untouched.

### 2.4 Read, repair, validation, and mutation boundaries

Canonical reads are observationally pure. `Game.getWorld()` returns the current canonical world; it does not normalize, migrate, repair, allocate IDs, or otherwise change it. Repair/migration/preparation are explicit operations owned by load/bootstrap/migration or another named mutation boundary.

World validation is likewise observationally pure. `validateWorld(candidate)` inspects the supplied candidate and returns success/failure without repairing it in place. Missing or malformed runtime structures therefore remain validation failures unless an explicit migration/repair step has already produced a valid candidate.

Every untrusted canonical mutation unit follows the same discipline: snapshot or candidate -> apply deterministic/model-derived changes -> final whole-world validation -> atomic commit. A failed validation leaves the previous canonical state unchanged. When an outer logical transaction already owns the world candidate, nested action helpers operate on that candidate instead of taking a second full-world snapshot merely for defensive rollback.

## 3. Entities, inventories, items

The runtime world contains stable entity IDs. Locations, sublocations, characters, and item instances are entities. Inventories are explicit containers owned by characters/locations/sublocations.

An item instance references an authored item definition. The definition supplies type-level behavior/metadata; the instance supplies identity and runtime container/state.

A sublocation inventory may optionally declare `requiredKeyItemId`, which references one concrete ordinary item instance. Access is granted only while that exact key is directly present in the acting character's normal inventory. Without it, the container itself may remain visible but its canonical contents are omitted from accessible inventories and cannot be targeted by take/place/use/study, including timelapse study. With the key, contents are exposed normally even if the character had forgotten them. Container keys are ordinary transferable items; there is intentionally no open/closed or lock/unlock state for these containers. This differs from passage locks, whose persistent reciprocal `locked` state is world state.

A sleep-capable sublocation may optionally declare `sleepCapacity` as a positive integer no greater than ordinary `capacity`. Ordinary occupancy always uses `capacity`; starting/placing sleep additionally requires fewer other sleeping occupants than the effective sleep capacity. When omitted, sleeping capacity defaults to ordinary capacity for compatibility. Awake occupants consume ordinary capacity but not sleeping capacity, and the existing character `sleeping` boolean remains the authoritative posture state.

Writable item definitions may set `writable:true`; the concrete item instance owns one persistent string `content`. Plain text is literal writing and `*...*` is the canonical textual description of a drawing/visual mark. A reusable accessible item definition with `writingCapability:true` enables the grounded `write_paper` action without consumption. `read_paper` is a separate grounded action and requires no writing tool.

`transfer_items` is the generic atomic bulk-transfer action for explicit loose item-instance IDs. Current routes cover character→character, character→accessible container, and accessible container→character. Validation is all-or-nothing; no implicit item stacks are introduced.

Equipment is item-defined rather than character-slot-defined. A definition with non-empty `equipSlots` is equippable and supplies `equippedDescription`; slots are free-form exact-match strings. A character stores `equippedItems` records `{itemId, slot, visible}`. Inventory placement uses `item.containerId = inventoryId`; equipped placement uses `item.containerId = characterId`, and one item may occupy a slot at a time. `equip`/`unequip` are ordinary formal actions from `view.available_actions`; equipped items remain eligible for `use_item`, while transfer/drop/place require unequipping first. The `visible` flag currently defaults true and is reserved for future concealment/layering rules.

Character visual descriptions are intrinsic only. Canonical current appearance is computed from base `playerDescription`, neutral `undressed` state when the exact `clothing` slot is empty, and visible equipped-item descriptions. The canonical view exposes both assembled appearance text and structured `equipped_items` to Human/AI consumers.

Tracked transformations change the instance's definition/subtype deterministically rather than replacing narrative text only.

Item definitions may expose authored `useAction` effects. Most effects are synchronous/deterministic, such as `report_memory_counts`, and may return only grounded public/private feedback without adding stats or buffs.

`abstract_study` is a deterministic text-input effect for educational/reference interactions and never asks a model to invent lore. The controller supplies bounded `input_text`; the engine validates and commits `use_item`, then first checks optional authored `knowledgeEntries` attached to that item action. Each entry owns canonical article text plus one or more token/phrase aliases; a single trailing wildcard such as `otherworld*` performs prefix matching on the final token. A matched entry returns its canonical article privately and bypasses generic study-depth bookkeeping. Otherwise the existing authored study templates apply: progress belongs to the **item instance** and is keyed by reader character ID (`item.abstractStudyProgressByCharacterId[characterId]`), so one physical source can remember independent threads for multiple readers and separate copies of the same item definition do not share progress. Consecutive lexically related unmatched queries advance through `survey`, `focused`, and `saturated`; an unrelated unmatched query begins a new survey. `focusedFeedbackText` and `saturatedFeedbackText` are optional authored stage templates, with `feedbackText` as the survey/fallback template. No model request is created by either path.

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

`mind.pendingObservations` is strictly an AI-controller scheduler inbox. Human/Dummy characters still receive committed experience into verbatim memory, but do not retain scheduler pending records. Switching away from AI clears the inbox; switching a former Human character back to AI starts with a clean inbox plus any newly generated controller-transition observation. Migration repairs legacy non-AI backlogs away rather than replaying old Human experience.

## 5. Character mind

Mind v3 separates runtime stimuli, experienced history, autobiographical memory, and interpretation. This document describes the current canonical Mind v3 architecture; versioned implementation specs under `docs/engine/` are historical implementation records rather than normative current design.

A character mind contains:

- `knownFacts`: authored baseline, refreshed from current authoring during migration;
- `pendingObservations`: authoritative unprocessed **AI scheduler** reaction inbox; non-AI controllers do not retain this backlog;
- `verbatimObservations`: persistent compact records of actually committed/delivered recent experience;
- `shortTermMemories`: thematic, relatively detailed autobiographical memory;
- `longTermMemories`: thematic, intentionally more lossy durable autobiographical memory;
- STM/LTM also persist derived `retrievalBrief` index metadata used only for semantic recall;
- `beliefs`: subjective inductive interpretations with stable `id`, `text`, numeric `confidence`, and numeric `activation`;
- `relationships`: runtime durable social summaries.

`continuation` remains AI runtime state outside autobiographical mind: a model-authored opaque working intention that the framework stores/returns without interpreting its semantics. Engine-owned `recentDialogue` is also outside `mind`; it is bounded conversational working context containing own validated speech plus only speech actually delivered through perception.

Directional per-partner intimate motivation is likewise transient AI runtime state outside autobiographical mind. For eligible adult-to-adult pairs, each active context contains exactly one proactive `impulse`, two private `imaginedMoments`, and two free `openAnticipations`. The Character model owns their semantics; the engine validates only structure/eligibility and never parses narration for fulfillment. Maintenance replaces the complete block atomically and may degrade to preserving the previous valid block after bounded repair failure without cancelling an otherwise-valid ordinary turn. Legacy flat-five active contexts are discarded during migration rather than semantically guessed, and successful timelapse clears all active intimate contexts. The framework adds no explicit adult action/body/progression mechanics through this state.

Experience enters `verbatimObservations` only after canonical commit/delivery. Raw scheduler envelopes, provider diagnostics, failed intentions, speculative model output, hidden information, and timelapse summaries are not memory. Verbatim records preserve structured `worldStateAuthority` provenance through STM maintenance. Mechanical authority and epistemic source are deliberately orthogonal: `worldStateAuthority` says whether a record can establish tracked canonical state, while engine-known `epistemicParts` identify `formal_fact`, `direct_observation`, `heard_speech`, or `own_speech`. `narrative_only` therefore has no tracked-state authority, but a delivered direct narrative observation may still be legitimate witnessed story history in an untracked domain. Heard/own speech grounds that the utterance occurred, not that every proposition inside it is objectively true. New STM records may carry compact optional `epistemicSources`; LTM does not persist that field and must preserve source stance semantically instead. `narrative_only` records may preserve dialogue, apparent intent, gesture, lies, promises, or literary continuity but are not evidence that a tracked world transition occurred, while `grounded_event` / `grounded_result` records may establish their corresponding committed event/result. Grounded evidence wins tracked-state conflicts. Free-form narration is never deterministically parsed to reconstruct actions or authority; authority comes from engine-known structured provenance, with compatible older records backfilled only from structured record/event metadata where available. Normal STM consolidation is eligible strictly above 40 verbatim records. It snapshots the complete current buffer, marks every record older than the newest 20 as the exact eviction set, gives the retained 20 as interpretive context, and removes only the captured eviction IDs after a validated atomic commit. Newly arriving observations survive an older in-flight job. Direct belief reinforcement/contradiction may use only the current eviction set as fresh evidence, preventing rolling-window double reinforcement.

STM and LTM are topic-oriented records with stable engine-owned IDs; topics are labels, never identity. Both use a 4000-character summary hard boundary and the same <=600 `retrievalBrief` semantic-index contract; their difference is function rather than container size. STM favors minimal information loss and bounded coherent topic upsert. Its 4000-character limit is per record, not a forgetting target: when a broad STM can no longer absorb relevant evidence without losing useful detail, the model may explicitly semantically repartition one or more unprotected source STM records into multiple coherent replacement records. Repartition is atomic, source-owned and stale-checked; source STM cannot simultaneously be normally upserted, overlapping source sets are invalid, every replacement counts toward the existing eight-write STM budget, and at most one replacement may retain one source ID while all new IDs are allocated by the engine from the live global counter at commit. A retained-ID replacement must itself materially change normalized model-writable memory state; an unchanged source plus genuinely new material should use ordinary creation rather than a fake repartition echo. Failed repartition preserves both source STM and verbatim evidence. Protected-memory semantics remain authoritative: protected STM/LTM cannot be silently rewritten, repartitioned, or retired. LTM is a subtractive transformation: after asking what the character should still know once source STM is gone, it intentionally discards minor/repetitive/transient detail while preserving significant durable facts. There is no fixed compression ratio and no goal to minimize LTM record count; if several distinct durable themes deserve preservation, multiple semantically coherent LTM records are preferred over deleting significant facts merely to fit one record. LTM consolidation is an evidence-driven delta with no arbitrary operation-count cap on genuinely required durable-memory writes/STM retirement. Higher-order belief output follows a separate fresh-evidence semantic contract rather than a quantity target: supplied STM/LTM/relationships/beliefs are context, consistency is not new evidence, and `higherOrderBeliefEffects` is a sparse (usually empty) channel only for genuinely new cross-memory inference rather than a scan of compatible existing beliefs. Relevance alone never requires an LTM upsert; every upsert must materially change normalized topic/summary/importance/retrievalBrief, while unmentioned LTM remains intact automatically. Every material LTM write names its source STM/LTM provenance; provenance supports an actual transformation but is not itself an effect, and for an upsert citing only the target LTM itself is insufficient evidence for a rewrite. Any number of unprotected STM records may retire in one atomic pass only through explicit coverage groups marking them either `represented` by resulting LTM or `safe_to_forget` with a compact `routine`/`redundant`/`transient` reason; omitted STM remains available for later consolidation. Existing-belief higher-order effects remain semantic `{beliefId,effect,strength}` evidence and never assign replacement confidence/activation directly.

Beliefs answer what remembered experience means rather than what happened. Belief-induction prompts explicitly reject pure chronological events, completed/current plans/actions, transient locations and temporary physical/world states as belief content unless the evidence supports a durable interpretation that remains useful beyond the originating scene. Every model request in which beliefs influence interpretation receives one centralized belief-semantics block. Existing belief confidence is changed only by engine-owned bounded log-odds math from model-reported `supports | contradicts | ambiguous` evidence and strength. Activation independently represents salience; relevant evidence/use raises it with a saturating update and timelapse maintenance decays it exponentially. Time alone does not lower confidence. Ordinary character turns/reflection may update relationship summaries and explicitly activate supplied beliefs, but may not directly author autobiographical memory, belief text/confidence, or belief deletion.

Belief reconciliation replaces the v2 contradiction scanner. Its ordinary salient candidate set remains bounded at eight and favors activated/recently changed or tension-bearing beliefs with relevant STM/LTM evidence. Outcomes may revise, merge, weaken, reinforce, contextualize, supersede, remove, or deliberately leave dissonance unresolved. Its structured contract is exact: revise/merge/contextualize/supersede require non-empty `replacementText` up to the canonical 2000-character belief-text boundary; weaken/reinforce/remove/leave_unresolved require `replacementText:null`, with weaken/reinforce also requiring an evidence effect. Primary and repair prompts mirror the validator rather than weakening it. Reconciliation never mutates autobiographical memory merely to make belief text coherent.

Night maintenance adds a separate balanced belief-housekeeping pass after successful ordinary reconciliation. A read-only Utility preflight receives the complete belief catalog and groups only existing IDs into narrow semantic clusters; beliefs may remain unclustered and the engine performs no textual clustering itself. If every cluster contains fewer than five beliefs, housekeeping stops without a second model call. Otherwise exactly one largest qualifying cluster is sent to a second Utility request that must account for every selected source ID exactly once using `keep`, `revise`, `merge`, or `remove_as_non_belief`, with no requested compression ratio or target belief count. The whole selected-cluster result is validated and committed atomically; failed repair preserves the cluster unchanged. Housekeeping review itself does not alter confidence or activation. Surviving reviewed beliefs may carry engine-owned `lastConsolidatedAt` housekeeping metadata for diagnostics/tie-breaking; this metadata is omitted from ordinary Character mind projections and is not conscious evidence.

All model-produced mind changes use snapshot -> asynchronous computation -> schema/source validation -> stale check -> candidate-clone validation -> atomic commit. Normal STM jobs run in a transient non-blocking Utility-model lane with at most one queued/active job per character; canonical decisions/reaction waves have priority. Appended verbatim records do not by themselves stale an otherwise compatible job, but incompatible changes to the maintained source state do. In-flight auxiliary jobs are not persisted. Multi-character timelapse mind work may prepare concurrently while commits allocate IDs from the then-current global counter, so unrelated global allocator advancement is not a stale-mind condition. Persistent developer recovery history stores at most one full pre-run mind snapshot per logical maintenance run rather than near-identical per-stage copies. Independent retrieval-brief backfill is derived metadata recovery, writes only still-empty briefs whose topic/summary remain unchanged, and creates no full recovery snapshot.

Ordinary `game-decision` uses a cheap Utility-model semantic preflight to choose bounded autobiographical context. The selector sees current compact runtime context plus a catalog of `STM/LTM: id + topic + retrievalBrief` and `beliefs: id + text + confidence + activation`; it never receives full STM/LTM summaries or the formal-action catalog. It returns IDs only, up to the configurable 12 STM / 8 LTM / 16 belief budgets. This read-only ingress is deliberately tolerant: unknown/wrong-layer/duplicate IDs are dropped and over-budget results are truncated in model order, while a valid empty result remains valid. The Character-model decision then receives the full canonical records for the sanitized selected IDs. Empty briefs remain usable through `topic` alone. Only genuine selector transport/parse/required-structure failure uses the previous deterministic bounded selector as fallback; malformed/truncated selector JSON is not repaired with another model call. Semantic retrieval is Phase 1 for ordinary `game-decision` only; timelapse planning/reflection continue their existing context paths.

Timelapse is a cognitive boundary. Before planning, all current character verbatim buffers are force-consolidated with the entire snapshot marked for eviction; failure preserves source records and is diagnostic rather than destructive. Committed timelapse actions/interactions/settlement append actual experienced records at commit time. After the period, eligible STM/LTM consolidation, higher-order belief reappraisal/reconciliation, and activation decay run. Overnight maintenance additionally runs one balanced belief-housekeeping cluster after successful ordinary reconciliation when a qualifying cluster exists; daytime maintenance deliberately skips that stage. After lived rounds/settlement have committed, auxiliary/reflection failure does not roll back the period.

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

Human UI and ordinary AIController both reason from this same base projection. Ordinary in-world affordances should remain controller-neutral wherever the mechanic itself is controller-neutral: an AI-controlled character should generally be able to express the same ordinary actions that the same character could perform under Human control in the same canonical situation. This parity is per character and subject to authored capabilities and limitations; unique Mara/Chuhaister/future abilities remain intentional distinctions, while settings/debug/controller-management operations are outside the rule.

AI ordinary-decision context adds private data (AI description, ability instructions, mind records, continuation, prepared pending observations) but does not replace the public view with a second interpretation. **Canonical State Precedence:** for tracked mechanics, current canonical view plus validated grounded action results outrank previous Character narration. Narration remains useful literary/dialogue history but is not a second world-state store. Shared structured authority normalization/projection is owned by `09-world-state-authority.js`. Model-facing verbatim/pending projections mark narrative input as `worldStateAuthority: "narrative_only"`, while grounded events/results are marked `grounded_event` / `grounded_result`; a narrative-only record must never override current ownership, placement, movement, lock, money, posture, presence, or other deterministic state. Model-facing context should stay as small, relevant, and role-appropriate as practical. For an ordinary Character decision, prefer information that helps the model understand the situation, make a human-like character decision, or execute an available operation. Information that serves none of those purposes should preferably be omitted. This is signal-over-noise guidance rather than a hard minimization invariant: grounding, validation, identity/personality, relevant mind state, repair, and other correctness-preserving context remain legitimate. Utility/repair/maintenance and Narrator contexts apply the same discipline according to their bounded task rather than receiving the Character projection by default.

Ordinary Character context also adds `relevantMechanics`, derived from the same action registry through relaxed source gating. Relevant mechanics expose only mechanics anchored in the actor's grounded current scene/items and may describe missing prerequisites; they are not executable authority. `view.available_actions` remains the exact executable-now contract and omits action records for which no valid current invocation exists. This lets a Character reason toward prerequisites (for example, an ale source makes `fill` relevant even before a mug is held) without receiving a global catalog of hidden/world actions or dead capability noise.

**Action prerequisite consistency:** natural-language descriptions/prerequisites exposed to models must be semantically consistent with the deterministic action contract. They may omit implementation detail, but must not weaken or strengthen material requirements such as direct inventory possession vs accessibility, equipped vs carried state, reachability, tool/source requirements, or other conditions that determine executability. A mechanic being present in `relevantMechanics` does not imply that those prerequisites are already satisfied.

Maintenance workflows such as timelapse/reflection/consolidation may build purpose-specific compact contexts directly; they are not ordinary controller decisions.

## 7. Formal actions

The deterministic action registry/CharacterAPI is the sole authority for formal mechanics. Runtime ownership is split without changing that facade: `10-game-02-actions.js` owns the action catalog, AI metadata, source gating and affordance projection; `10-game-00-item-mechanics.js` owns reusable item/inventory mutation primitives; `10-game-01-validation.js` owns runtime world invariants; and `10-game-api.js` assembles the stable `setup.Game` facade plus high-level intent/transaction sequencing.

`view.available_actions` is generated from current state and contains an action only when at least one invocation can currently satisfy that action's deterministic prerequisite/options contract (with any required free-form input supplied validly). Zero-input actions remain valid when their prerequisites are satisfied. A requested action must match:

- a currently offered action type;
- that action's schema;
- its current concrete option values.

Human formal-action controls and AI capability exposure derive from this same deterministic action truth rather than independent controller-specific capability lists. `relevantMechanics` is intentionally broader and may still expose a grounded mechanic whose executable prerequisites are missing.

Examples include movement, moving within a location, item transfer, placement, item use, equip/unequip, money transfer, showing a known hidden location to a nearby character, locks, sleep, and character abilities.

Narrative cannot establish a tracked state transition that the engine did not execute.
A character must also wait when its next step depends on another actor completing a tracked prerequisite that canonical state still shows as false; `action: null` plus a pending `continuation` is a valid deliberate response. Neither the character's own nor another character's speech, preparation, apparent intent, or prior narration confirms a tracked completion; only canonical view or grounded engine results do.

### 7.1 Attempt vs result

A controller response may contain speech/narrative and one formal action attempt. Speech and visible attempt-phase narration happen before deterministic completion.

The engine then executes the formal action and emits grounded result/failure.

If prose claims something inconsistent with the deterministic result, the engine wins.

### 7.2 Invalid vs grounded failure

- Impossible/out-of-contract Human request: reject before `beginOrdinaryTick()`; no world tick and no canonical/presentation side effects. The pure Human preflight covers the complete combined intent, including empty intent, formal action schema/current options, speech/loudness structure, shout restrictions, direct-addressee grounding, and move+speech grounding.
- Valid available attempt that fails in-world: turn is spent; grounded failure becomes part of the tick.
- A request admitted by preflight is checked again after committed tick-start triggers wherever current mechanics can have changed. If a trigger makes an already-valid formal action or grounded speech delivery impossible, the request remains a legitimate attempt: the tick/trigger stay committed, the turn is spent, and execution returns the grounded post-trigger failure rather than reclassifying the original Human input as malformed.
- Structural invalidity never becomes TOCTOU. For example `Shout + target_id` or `Shout + move` is rejected before tick start regardless of what triggers could have done.
- Once a Human formal action commits successfully and initiative passes to the next controller/reaction wave, later mutations are consequences of that completed action and cannot retroactively rewrite it as failure.

## 8. Intent, speech and loudness

Human and AI use the same canonical combined intent path: optional speech/visible narrative plus at most one formal action.

Speech may have an explicit addressee independently of formal-action target.

Speech volume currently has three UI/mechanical choices:

- Normal (`noticeable`);
- Quiet/private (`hidden`);
- Shout.

Whisper-like prose does not change loudness by itself. Shout is a separate stationary, targetless speech mode: it cannot be combined with movement or an addressee, is heard in the current location plus one directly connected authored topology hop regardless of passage lock state, and uses ordinary observation/reaction handling without a special deterministic wake rule.

## 9. Events, perception and observations

The engine emits canonical events after deterministic commits.

Major location transitions use one event:

```text
character_moved { actorId, fromLocationId, toLocationId, ... }
```

The same event is delivered to the union of recipients who can perceive the actor from source or destination. It is not split into separate departure/arrival canonical events.

Events generate recipient-specific experienced observations. For AI-controlled recipients, `character.mind.pendingObservations` is the authoritative reaction inbox until scheduler processing. Human/Dummy recipients do not retain scheduler pending records; their delivered committed experience still reaches verbatim memory. Event-journal recipient/processed metadata is retained only for diagnostics/history and must not drive a second independent pending queue. Pending AI observations are already perception-filtered; the model must treat a delivered observation as perceived.

Model context receives a compact recipient-safe observation projection rather than a cloned event envelope. Routing/scheduler/provider bookkeeping (`recipients`, legacy `pendingFor`, `processedBy`, controller/provider metadata) is excluded.

`hidden` delivery is still local perception, not a remote messaging channel. An explicitly authored/structured hidden `targetId` receives the observation only while locally present and otherwise receives nothing; rejected hidden observations are not queued for return or replayed later.

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

- `23-timelapse-protocol.js`: planner/interaction/reflection JSON contracts, validation, repair and model requests;
- `24-timelapse-core.js`: canonical coarse-time orchestration, movement/formal action execution, snapshots, rollback/commit, encounters, replans, committed experience delivery, memory orchestration and progress diagnostics;
- `24-daytime-timelapse.js`: daytime entry/exit policy, sponsored jobs, hunting, and domain-owned reward settlement; sponsored reward JSON uses the shared `StructuredAIRequest` lifecycle;
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

Daytime is a five-round policy over the same `24-timelapse-core.js`. Entering it wakes every character. Free NPCs plan ordinary coarse activity. Model-facing reachable-location records include authored location descriptions plus visible/relevant sublocation affordance text so coarse narration remains physically grounded without revealing undiscovered/secret topology. Canonical movement between named locations is owned by the formal timelapse layer: a round narrates activity only at its selected `locationId`, never departure/arrival into another canonical location. If an intended activity needs a tracked mechanic for which no supplied formal timelapse/study/action contract exists, the model must choose another local narratable activity rather than simulating the missing tracked operation in prose. A sponsored job binds its sponsor to the authored worksite and treats the Human worker as physically present but non-interactive for encounter arbitration. Accepted sponsor/Human pairs reach the worksite through ordinary timelapse reachability; an unreachable worksite fails the activity without consuming the day. Characters may optionally author phase `routineAnchors`; the planner sees the end-of-period anchor as soft context, and after a successful daytime -> Evening transition the engine deterministically applies reachable/capacity-valid evening anchors. Anchor application never bypasses lock/key traversal and failure is a soft warning rather than rollback of committed daytime history.

`world.dayActivities` is authored data. Current policies include Mara assistance at her cottage, Harlan forge assistance at the smithy, Radovan farm assistance and Bozhena farmstead assistance anchored at `farmYard`, plus sponsorless hunting at the forest stream. `offer_day_work(activity_id)` is an AI-owned grounded action available only in Morning when the Human is physically reachable. It creates a single pending offer and pauses the current causal wave. Accept begins the job; Decline emits grounded refusal feedback and resumes the original wave while preserving already-reacted character IDs.

Settlement is a hook after five committed rounds and before reflection/maintenance. Sponsor settlement uses a narrow Character-model request with full sponsor context but reward-only output. Mara may choose 1-3 Healing Salve/Stamina Potion instances; Harlan may choose 3-7 gold, minted only by this settlement policy; Radovan may choose 2-3 ordinary produce items from turnip/onion/buckwheat groats/apple; Bozhena may choose 2-3 household-food items from eggs/farm cheese/bread. Solo hunting uses engine RNG for 1-5 Squirrel Pelts. No reward exists before settlement, and a failed settlement does not advance to Evening.

Timelapse planning also exposes `study_item` for existing `abstract_study` items when the item is carried by the actor or physically present in the chosen room/accessible sublocation. The same authored-article matcher and existing item-owned per-reader study progress are reused; no parallel study system exists. Indexed article contents are committed only to the reader's private timelapse experience while the public activity remains a generic statement that the item was consulted.

### 12.4 Weekly rhythm, fixed presence, and awayable lifecycle

The runtime owns a monotonically increasing calendar `dayNumber`; the current weekday is derived from that counter plus the authored seven-name sequence. Coarse lifecycle processing runs at both canonical Morning and Evening boundaries: overnight completion reaches the next Morning, while successful daytime timelapse reaches the same-day Evening. A newly departing character does not receive road credit for the period that just ended at its departure boundary.

Simple authored `weeklyPresence` remains supported for fixed schedules. Characters that need runtime-divergent visits may instead define generic `awayable` authoring: regular arrival opportunities, a supported default-departure policy, travel-period duration, local arrival placement, and validated deterministic `onArrival` hooks. Canonical neutral `presenceState.present` is the single save-owned authority for whether a character is locally present. `awayState` owns only lifecycle details such as the current visit's `plannedDeparture`, remaining required travel periods, and revision. These are objective simulation state and are never inferred from continuation, beliefs, STM/LTM, or model prose.

`defer_departure` is an ordinary controller-agnostic formal action exposed only when the current planned departure is exactly the boundary reached by the next timelapse. A successful defer privately moves that planned boundary forward by one canonical coarse period. Timelapse planner protocols do not expose or accept this ordinary action. If departure is not deferred before the relevant timelapse begins, reaching the planned boundary deterministically makes the character away.

Local participation is mediated by the neutral `Presence.isLocallyPresent(character, world)` base mechanism rather than by the historically narrow weekly-rhythm namespace. Presence reads neutral `presenceState.present` plus independent objective axes such as activation, and it does not depend on `WeeklyRhythm` or any schedule policy. Perception, local targeting/action availability, AI participation, timelapse participant selection and ordinary local character lists use this same boundary. `WeeklyRhythm` remains responsible only for calendar/schedule/arrival/departure/travel policy: it decides when a character should arrive or leave, then changes local presence through Presence. Compatibility wrappers may remain for old callers, but dependency direction is one-way: `WeeklyRhythm -> Presence`, never `Presence -> WeeklyRhythm`.

While away, a character keeps canonical mind/inventory/wallet/equipment state but is excluded from local views, pathfinding targets, observations, scheduler eligibility and timelapse participant sets. A location/sublocation may declare `presenceOwnerCharacterId`; while that owner is locally absent it remains persisted canonically but disappears from local topology. A locally present foreign character may never remain inside such unavailable topology. Before an owner-presence transition commits, affected occupants are reconciled deterministically: an owner-dependent sublocation whose parent remains available falls back to the parent's default sublocation; an owner-dependent location with exactly one external exit falls back through that exit to the destination's default sublocation; ambiguous/no-exit cases require explicit authored `presenceFallbackPlacement`. A forced relocation wakes a sleeping occupant and produces grounded committed experience for that character. Items/containers inside disappearing topology are not evacuated; they remain canonically there and become locally accessible again when the topology returns. The owner itself follows its own activation/away lifecycle rather than this foreign-occupant fallback.

Travel counts only fully completed coarse periods after actual departure. A scheduled arrival opportunity reached before travel is complete is missed; completing travel later does not create a catch-up spawn. A true `away -> present` transition restores authored placement, initializes the new visit's default departure, and runs validated arrival hooks. Merely crossing an arrival-schedule boundary while already present does nothing.

The first supported generic arrival hook is deterministic authored `restock`; hook types are registry-validated rather than arbitrary executable authoring. `10-trade-lifecycle.js` owns trade stock generation/restock, item-level `sale_stock`/`acquired_stock` provenance, Character trade grounding, and departure settlement; WeeklyRhythm only invokes that domain at the appropriate schedule boundaries. Generated sale stock and acquired stock are tracked by item-level trade provenance so personal possessions and keyed-container contents are not mistaken for commerce. Awayable private Character grounding may expose current schedule reachability plus authored business interpretation without hard-coded decision thresholds.

### 12.5 Discoverable location topology

A location may author `requiresDiscovery`. Access to such a location is canonical **per-character runtime state** (`discoveredLocationIds` plus authored initial discoveries), separate from mind text. Ordinary locations are implicitly known. Discovery applies to the whole location rather than to individual entrances: once a character knows a secret location, all of its authored entrances are usable by that character.

Character views, formal movement options and actor-specific timelapse routing all use the same discovery filter. An undiscovered secret location is therefore neither a destination nor an intermediate pathfinding shortcut. Direct action validation remains authoritative even if UI/model filtering is bypassed. A character can gain discovery through an explicit deterministic grant, the generic validated `show_hidden_location` formal action, or by being a source-side perceiver when another character visibly enters the secret location. Off-screen inference does not grant discovery.

Human-facing committed off-screen presentation is additionally epistemic: an event touching a secret location that the current Human character has not discovered is suppressed from ordinary `Elsewhere`, history and the `Show invisible events` gameplay surface. Canonical events remain available to administrative diagnostics/emergency dumps. Saved discoveries survive migration, current authored initial discoveries are unioned in, removed IDs are discarded, and being restored physically inside a secret location repairs discovery automatically. Portable mind export/import does not carry location discovery.

### 12.6 Authored secret modules and random outcomes

Optional mystery content is authored through a top-level secret registry plus explicit `secretId` membership on supported records. Secrets are objective world-authoring modules, not STM/LTM/beliefs/quests, and membership alone has no visibility semantics: a secret may own an ordinary public sublocation. World generation validates the complete authored document first, materializes only enabled secret-owned content while pruning unambiguous mechanical references, then validates that active document again before emitting `src/generated/world-data.js`. Ordinary runtime topology, item, perception and random systems therefore do not branch on `secret.enabled`.

Hidden characters use per-observer canonical `discoveredCharacterIds`, parallel to location discovery but independent from it and from mind text. `requiresDiscovery` filters an undiscovered concrete character from ordinary targeting/views/perception; `playerControllable:false` separately prevents HumanController assignment even after discovery. Authored deferred/inactive characters are fully materialized at world creation and migration, including persistent mind, inventory, wallet and ordinary Character identity, but `activationState: inactive` places them off-map and hides them from normal local/player selectors. Activation and awayability are independent: travelling Maksym remains activation-`active` while locally absent, whereas Chuhaister between appearances is activation-`inactive`.

Authored `randomOutcomeTables` provide engine-side weighted selection with injectable RNG, persistent `once:true` consumption, effect-applicability filtering and atomic candidate validation/rollback. They can be invoked by ordinary sublocation `authored_interaction` actions or as an additional day-activity completion hook. `triggeredEvents` are a separate causal mechanism: they are evaluated at authored boundaries such as `ordinary_tick` or `timelapse_start` from objective prerequisites. Ordinary logical turns own one persisted monotonic `ordinaryTickId`; rerenders/retries do not create another event check for the same ID. For one ordinary tick, every triggered-event prerequisite is evaluated against the same tick-start canonical snapshot: a condition created by an earlier proc first becomes eligible on the next tick, while an event already eligible at tick start does not lose that eligibility merely because an earlier proc removes one of its prerequisites. Successful effects still apply in deterministic authored order. Failed prerequisites do not roll RNG; a chance miss performs no world clone or full-world validation. Only a real proc creates a transactional candidate, applies deterministic effects/perception/discovery to it, validates it, and commits atomically. Silent authored effects may mutate canonical state without automatically creating observations or narrator-visible events.

`randomOutcomeTables` and `triggeredEvents` stay separate, but semantically identical deterministic primitives may share the small validated `AuthoredEffects` boundary. The first shared primitive is `emit_observation`, which routes through ordinary `EventPerception` and returns the actual recipient IDs. Discovery of a concrete hidden character from an appearance is granted only to those actual recipients rather than by a second broad location scan. Random-outcome-specific effects such as `reveal_location`, `encounter_character`, `modify_wallet`, and `create_item`, and triggered lifecycle effects such as activation/deactivation/ground-food consumption, remain separately whitelisted; arbitrary authored executable code and model-decided canonical randomness are unsupported.

### 12.7 Shared consumption and generic abilities

Canonical item consumption is owned by one deterministic `applyItemConsume` primitive. It performs only item-state mutation (for example `Bowl of banush -> Empty bowl`, filled mug -> empty mug, or removal for a consumable without a reusable result) and returns structured change data; it never inherently emits speech, observation or narration. Ordinary `consume` adds its grounded public/private presentation around that primitive, while silent authored effects such as Trampled Glade timelapse cleanup reuse the same mutation without presentation.

Character abilities dispatch through the controller-agnostic formal action `use_ability { ability_id }`. Authored ability IDs such as `readAura` and `playSopilka` point to registered engine-owned `effectType` implementations and are exposed with their own labels/descriptions/options to Human and AI controllers. Legacy specific spellings such as `read_aura` remain only as narrow deterministic request normalization when exactly one owned canonical ability matches; they are not parallel long-term actions.

### 12.8 Global weather

Weather is optional external environmental input, never a gameplay dependency. The browser resolves approximate location through the CORS-capable public `https://ipwho.is/` endpoint, requests current conditions from Open-Meteo, deterministically normalizes them, and sends only that normalized weather plus a minimal `rural, low-technology environment` style contract to the Narrator role. The Narrator is not given game time, lore, characters, or scene state and must not mention time of day or modern measurements. The resulting prose is saved as canonical `weatherNarrative` and shown globally.

A fresh playable world renders immediately while initial weather resolution runs asynchronously through this same canonical refresh/fallback pipeline. The startup attempt carries an applicability/revision guard: if the simulation advances first, the stale result is discarded rather than overwriting the newer period or committing fallback into it. While applicable, any fetch/narrator failure commits/preserves the same shared fallback semantics and never blocks play. Existing saved weather is preserved on load. Successful day/night timelapse attempts refresh weather. The latest refresh retains explicit `ip-geolocation`, `weather-fetch`, `weather-narration`, and `weather-commit` diagnostics, including the failed stage when applicable; the ordinary presentation-Narrator toggle does not disable this infrastructure weather renderer.

## 13. AI model roles and request profiles

Production requests resolve through `setup.AIRequestProfiles`.

Current model roles:

- **Character**: ordinary AIController decision;
- **Utility**: timelapse structural work, reflection, memory consolidation, authored non-character information-source queries;
- **Narrator**: presentation prose plus explicitly bounded rendering of engine-supplied non-mechanical facts such as weather. The ordinary presentation narrator remains non-canonical; the weather renderer is a narrow exception whose output is saved as canonical ambient prose but cannot create mechanics or additional world facts.

Profiles centralize model role, max output, reasoning settings, temperature, provider routing, and telemetry labels without encoding gameplay semantics.

Ordinary character decisions intentionally retain the existing larger reasoning/output budget until measured tuning demonstrates a safe reduction.

Structural timelapse requests use bounded outputs and reasoning disabled. Current shipped selections are Character = DeepSeek V4 Flash by default with DeepSeek V4 Pro as an available alternative, Utility = DeepSeek V4 Flash, and Narrator = Euryale 3.3 70B Nitro. Role eligibility comes from the model catalog; selectors remain present so later supported models can be tested without changing request architecture.

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

The low-level shared executor provides:

- serialized causal request execution by default;
- an explicit concurrent path used only by workflows that prove requests independent;
- at least one second between live transport calls;
- `Retry-After` aware shared provider cooldown after 429;
- a hard per-transport liveness timeout (default 180 seconds) covering both fetch and complete response-body read; the Stage 2 `mind-v3-ltm` profile may use its targeted 300-second override while preflight and ordinary gameplay retain the default;
- optional presentation-request suppression while provider rate-limit cooldown is active;
- no automatic rate-limit retry loop;
- sanitized exchange logging (latest 100 exchanges);
- request purpose/stage/model/options and provider diagnostics.

The one-second pacing guard remains intentional even when timelapse permits safe parallel work.

Above the transport executor, `StructuredAIRequest` centralizes the repeated structured-output lifecycle: transport call, JSON extraction/parsing, truncation detection, protocol-specific normalization/validation callbacks, configurable repair/retry policy, and attempt diagnostics. Domain protocols still own their schemas and semantic validators. Ordinary AI decisions, timelapse structured work (including sponsored-job reward settlement), Mind v3 maintenance, semantic retrieval and brief backfill reuse this lifecycle rather than maintaining separate repair engines.

### Model Output Must Have Effect

Structured model→engine mutation protocols follow a project-wide **Model Output Must Have Effect** invariant. The model may inspect far more state than it returns: relevance, retrieval, contextual use, or continued importance do not justify echoing an existing record. Every upsert must materially change model-writable state after protocol normalization; unchanged normalized records are omitted before generation whenever the model follows the prompt and are rejected deterministically where comparison is available. Unmentioned persistent records remain unchanged automatically. Engine-owned fields, provenance/debug metadata, or cosmetic paraphrase do not manufacture an effect. Prompt prevention is the primary token-efficiency mechanism; validator rejection/repair is defense in depth. Explicit protocol-level negative/null decisions such as `action:null`, intentional no-reaction, `safe_to_forget`, or an empty mutation set remain valid when the decision itself is the semantic result of the invocation.

Current model-facing upsert channels applying this rule are STM, LTM, retained-ID STM repartition replacements, and relationship summaries in ordinary decisions/results and post-timelapse reflection. LTM provenance supports an actual transformation but is not itself a reason to emit an unchanged memory. No arbitrary LTM write cap is introduced: high-volume **meaningful** consolidation remains valid; useless echoed work is forbidden.

## 16. AI protocol

Ordinary character decisions return one strict JSON object containing:

- `action`;
- `publicNarrative`;
- `spokenText`;
- `spokenTargetId`;
- `spokenLoudness`;
- `continuation`;
- `memoryUpdates`.

For AI output, `publicNarrative` contains visible narration/behavior only and `spokenText` contains only words actually spoken; accompanying gestures/actions belong in `publicNarrative`. Model-facing experience preserves engine-known epistemic source rather than asking the model or deterministic code to infer it from prose. `formal_fact`, `direct_observation`, `heard_speech`, and `own_speech` are distinct from mechanical `worldStateAuthority`: testimony grounds who said what, not the objective truth of every embedded proposition. Character prompting preserves actual attribution, forbids silently converting testimony into firsthand memory or inventing source circumstances, and in crowded conversation prefers a distinct contribution or a genuine no-op over filler paraphrase. None of these contracts are enforced by regex, semantic similarity scoring, or other free-form prose parsing.

Protocol validation rejects unknown/malformed fields and illegal action options. Pure current-option/cross-field validation is centralized in `09-action-option-validation.js` and is shared by ordinary AI protocol validation and Game preflight, covering scalar option IDs plus relational constraints such as bulk-transfer routes, equip slots, hidden-location location/target pairs, bounded amounts, and required item input. The canonical `available_actions` record remains the authority; this shared early validator never replaces submit-time action availability revalidation after tick-start mutations, so TOCTOU/consumed-turn semantics remain intact. Action-specific authored text input (currently `use_item.input_text` for `abstract_study` and `utility_query`) is also required/bounded from the current option record before execution. One repair attempt may be made for malformed/schema-invalid output.
Tracked state is never completed through Character narrative/speech merely because a formal mechanic is currently unavailable. Action definitions carry compact AI descriptions and prerequisite descriptions. Ordinary Character context includes only scene/item-grounded relevant mechanics through relaxed source gating, while `view.available_actions` remains the exact executable-now authority. Character prompting schedules tracked work one formal step at a time: when several tracked actions are required at once, it prefers the one requiring the fewest formal steps, preserves unfinished purposes in `continuation`, and forbids narration from performing or implying queued/preparatory tracked steps before their formal actions succeed. Ordinary Character turns remain single-pass after normal structured-response validation.

Structured timelapse workflows use separate exact JSON protocols with their own validators/repair prompts. Timelapse action contracts are mode-aware: `sleep` is exposed/valid during nighttime but omitted and defensively rejected during daytime. Beds are correspondingly removed from the daytime planner's reachable-location projection. Committed timelapse `narrate` prose is requested as third-person world narration; sponsored daytime work receives the sponsor's grounded canonical ID/name explicitly so public prose addresses the sponsor by visible name rather than from a `You/I/We` sponsor perspective.

### OpenRouter role routing

Each AI role resolves one configured primary model plus an ordered fallback-model list. Same-model provider fallback remains enabled inside OpenRouter; the ordered model list is sent through OpenRouter native fallback routing so transient provider/routing failures may broaden to another configured model without an engine-managed unbounded retry loop. Character, Utility, and Narrator chains are independent. Structured-output/schema failure remains the responsibility of the bounded protocol repair path and does not by itself trigger transport/model fallback. Low-level diagnostics retain requested primary/fallback IDs and the actual selected model/provider when OpenRouter returns them.

## 17. Presentation narrator

The optional narrator is a presentation layer only. It does not decide actions, mutate world state, or rewrite canonical history.

It receives deterministic facts/committed tick structure and returns literary prose. If disabled or failed, deterministic presentation remains available.

Progressive committed ordinary/timelapse output may be displayed before all AI work finishes; the input remains locked until the canonical operation ends. Committed off-screen output is a product-facing **Elsewhere** presentation, not debug data: `visibleToHuman=false` is preserved for character epistemics while the human user may still read it. Timelapse uses a live-feed modal that receives committed round entries even when the optional presentation Narrator is enabled, plus non-canonical lifecycle status lines such as planning, reflecting and consolidating memories.

## 18. Persistence synchronization

In-place async world mutations can occur without SugarCube passage navigation. Before save serialization, the persistence layer synchronizes the active save moment with current live `State.variables` so exported saves contain the actual committed runtime state.

This synchronization is bookkeeping only: it does not create a gameplay turn, event, observation, AI reaction, or fake passage navigation.

## 19. World editor

The standalone editor is a browser-only authoring tool for `data/world.json`. It does not write directly into repository files; Save downloads a new JSON file.

The editor mirrors authored data but is not a runtime/save editor. Authored validation has one shared JavaScript implementation used by both `tools/generate-world-data.js` and the editor; the build embeds that validator into the single offline HTML artifact. Runtime validation must enforce the same semantic contract for authored triggered-event/effect structures and conditional-topology fallback state that can survive through saves/migration: malformed narration policies, unsupported consume modes/container destruction, invalid/non-deferred activation targets, cross-location activation sublocations, and ambiguous/invalid presence fallbacks are rejected rather than becoming valid merely because they entered through runtime state. The editor is part of the authored-feature completeness invariant rather than a best-effort viewer: current first-class panels/structured controls cover secrets, random outcome tables, triggered events and their typed prerequisites/effects, activation/player-controllability/location locks, conditional-presence owner/fallback placement, generic abilities/effect types, item tags/consume transforms, phase-aware `serve_food` authoring, and existing awayable schedule/restock authoring. A reusable editor-side reference walker supplements the authoritative validator so deletion/ID workflows surface references from these newer structures instead of checking only legacy fields. Unknown fields still round-trip rather than being silently discarded. Reusable starter identities are deliberately absent from authored world data.

Fresh-world initialization uses the stable canonical `player`/Traveler shell for location, sublocation, inventory, equipment, wallet and other world-bound setup. Onboarding is disclaimer -> optional OpenRouter setup -> Traveler selection. Reusable custom starter identities are browser-local presets with ZIP import/export; choosing one copies only name/playerDescription/aiDescription onto the canonical shell and stores no preset/library reference in the world or save. Legacy saves that used authored Traveler profiles materialize their already-saved identity as ordinary Custom authoring during migration.

## 19.1 Product settings and onboarding UI

The normal sidebar is gameplay-oriented and contains only character/player state, a compact AI status light, and a Settings entry point. Settings owns OpenRouter/model configuration, maintenance/admin operations, world validation/reset, starter-library transfer controls, and the generated build timestamp. Every OpenRouter key input is always empty and accepts only a new key; stored-key availability is communicated separately as Available (green), Not set, or Rejected after a confirmed authentication failure. Player-facing AI failures use short human-readable messages, with raw provider/protocol detail secondary and expandable.

The global red Emergency Dump control is intentionally outside this consolidation and must remain directly usable above Settings, startup, timelapse and migration blocking surfaces.

## 20. Debug tooling

The crystal sphere/prompt lab exposes scheduler/request state, dry runs, exchange import/export, replay and diagnostics. Debug tooling must observe normal architecture rather than offer alternate gameplay commit paths.

Normal sidebar may expose read-only scheduler information, but there is no manual gameplay “process pending AI request” button. Admin/debug controls may safely dismiss pending reactions, clear continuation, or clear both (including a global keep-list operation) only when no AI/executor/wave/migration work is live. Such cleanup is runtime administration, emits no story event, and never implicitly sleeps/wakes a character.

A red **Emergency dump** control exports one best-effort ZIP without requiring world validation. It is also exposed as a top-level fixed control above blocking overlays so diagnostics remain reachable regardless of gameplay lock, pending day-work offer, AI/timelapse work, or migration UI. The dump preserves canonical world/SugarCube state, full minds and recovery snapshots needed to reconstruct represented recovery points, scheduler/aux state, event/history data, current retrieval diagnostics, latest handled timelapse state, weather/network/runtime errors, and one complete high-level request/response record per semantic AI exchange. The archive uses lossless ZIP DEFLATE (balanced normal compression) rather than STORE; compression changes transport size only and does not trim diagnostic sections/history. Low-level transport diagnostics remain separate for network/provider failure analysis. Full request/response payloads are not duplicated into parallel exchange files/traces; structured traces retain repair/retry metadata and only attempt-specific message deltas where needed. `recovery-points.json` indexes current state and persisted mind-recovery boundaries. `manifest.json` records per-section success/failure; failure to capture one section must not prevent the remaining files from being downloaded. API/authentication secrets are defensively redacted.


`frameworkUI.turnBusy` is obsolete as persisted state. Busy UI derives only from live runtime operations. Save/load strips or ignores stale serialized busy flags; rendering (`Engine.show()`) is not recovery logic because passage rendering may itself request optional narration.

## 21. Current authored story/world notes

The current authored world includes the tavern, village/street/temple, village edge, a separate Mara's Garden location, Mara's Cottage (`secludedCottage`) as an interior-only location, a working village Smithy (`villageSmithy`) reached from the Street near the temple, a permanent Market Square, and a farm beyond Village Edge with yard/garden, two-room mazanka, field, playable Chort's Rock, and a downstream stream crossing. A normal public well with communal bench stands on Street near the tavern.

The authored week is Sunday → Monday → Flamesday → Flowday → Woodsday → Goldsday → Earthsday, with fresh worlds beginning Monday evening. On that fresh initial evening Maksym the Wagoner starts seated at the tavern's second table with one filled mug of ale; this is initial authored placement only. His recurring Monday/Woodsday arrival placement remains Market Square, and he is already away when the following morning begins. His armored four-ox wagon and locked sales-chest sublocation are conditional local topology tied to his presence. Fresh merchandise is generated into the existing key-gated sales chest; Maksym carries its key and the separate wagon key. Goods directly handed to him by other characters become acquired trade stock in his personal inventory; supported valued goods settle to his wallet when he leaves.

Maksym is a familiar but not deeply bonded recurring visitor: villagers generally enjoy the goods/news/stories and break in monotony, while he treats them with cordial commercial even-handedness and little interest in local gossip unless it matters to safety/trade/travel. Current narrow externally valued local goods are Squirrel Pelts, Healing Salve, and Stamina Potion. The merchant also introduces Paper Sheets and reusable Writing Sets alongside salt, cloth/clothing, household/town goods, small jewelry, and specialized tools.

The Smithy contains the forge floor plus Harlan the Blacksmith's rear living room and sleeping bed. Harlan (`blacksmith`) begins AI-controlled at the forge with coarse work clothing and a smith's hammer equipped in `right_hand`. His authored role centers on mundane village ironwork—nails, horseshoes, harness/tack fittings, practical repairs and sharpening—rather than weapons. Seeded local relationships capture mutual irritation/respect with Garrick, friendly explicitly non-romantic familiarity with Nell, and wary practical treatment history with Mara.

Mara's cottage includes a work table, a private key-gated chest, and a stable authored **Slab of Full Arcane Knowledge** instance stored inside that chest. `Consult slab` uses deterministic `abstract_study`. Mara/another holder supplies a subject or question in `input_text`; indexed canonical topics may return an authored reference article directly, while unmatched topics use the existing private survey/focused/saturated progression. The first indexed entries cover Chuhaister lore and the archmages of Veyra's Outer-World Construct Hypothesis. The slab never asks a model to invent or summarize the subject, so any concrete setting facts it returns must already exist in authored `knowledgeEntries`; generic unmatched study still does not materialize new schools, spells, techniques, taxonomies, history, dates, mechanisms, recipes, or other setting facts. It provides no buffs, stats, automatic mastery, or omniscient current/future knowledge.

Mara's Garden (`maraCottageGardenLocation`) connects reciprocally to village edge, Mara's Cottage, and **Forest stream** (`forestMountainStream`). The cottage no longer connects directly to village edge or the stream. The stream has an ordinary bank plus `forestStreamSittingPlace`, a capacity-two sublocation represented by broad smooth stones beside the water; its enter action moves only the acting character. Save migration preserves surviving stable sublocation identity and derives its current authored parent, so old garden positions reparent safely while cottage-bed occupants remain on the bed.

Story-specific activation of an existing save is performed by editing that save's runtime observation inbox when desired, not by embedding Mara/slab special cases into migration.

## 22. Deferred architecture

Explicitly deferred:

- professional NPC daily schedules/travel-to-work;
- broader village economy, prices, barter/shop abstractions, and additional production chains;
- embeddings/vector indexing if the future compact semantic-retrieval catalog itself becomes too large;
- large-crowd optimization beyond current emergency limits;
- equipment stacking/layering/concealment controls;
- combat/quest systems;
- narrator grounding redesign.

## LTM maintenance semantic preflight

STM→LTM consolidation uses a two-stage archive lookup. The read-only preflight receives every source STM in full, the complete compact belief/relationship significance context, and every historical LTM only as `id/topic/retrievalBrief/importance/protected`; it returns only a high-recall `relevantLtmIds` set with no arbitrary count cap. The main consolidation request then receives every source STM in full again plus only those selected historical LTM bodies in full. Unselected LTM remains canonical and unchanged and cannot be upserted or cited as LTM provenance by that prepared Stage-2 proposal. New durable-memory creation remains unconstrained by the selected historical set. Preflight failure or stale mind state before Stage 2 aborts safely without retiring STM or mutating LTM.

Timelapse reflection uses fresh event-driven belief salience: seeing, rereading, or finding an existing belief compatible with context is not activation evidence. `activatedBeliefIds` should be sparse and may be empty; existing deterministic reflection bounds remain a safety layer.

The active user-facing product is **Mallowstead**; the engine remains at MVP maturity rather than POC.

**Release-profile invariant:** the committed `data/world.json` is the public canonical Mallowstead world. A local ignored `data/world.private.json` may contain developer-only authored experiments. `build.bat` / `build.sh` default to public; the explicit `private` profile generates into isolated `.build/<profile>/src` staging so private authored/generated state cannot replace tracked public generated files. Public packaging is whitelist-based. Runtime/gameplay/save schemas stay shared between profiles; only authored world, build identity, and disclosure onboarding differ.

**Persistence identity invariant:** the current SugarCube `StoryTitle` is `Mallowstead`, producing current save ID `mallowstead`. Load compatibility accepts both legacy `ai-rpg-framework-mvp` and `ai-rpg-framework-poc` IDs. Legacy browser-save slots are copied forward non-destructively into the Mallowstead storage namespace only when the corresponding current entry is absent; current Mallowstead entries win collisions, MVP wins over older POC entries, and unrelated legacy settings/runtime storage is not copied. Persisted OpenRouter keys use a seven-day (`7 * 24h`) TTL; credential-storage architecture is otherwise unchanged.

**Initial-weather invariant:** after Player/AI setup completes, a fresh world renders the first playable scene immediately and resolves `environment.weatherInitialized` in the background. Startup reuses the same canonical weather refresh/fallback pipeline used at coarse-time boundaries; while it is pending the UI may show `Checking current weather…`. A startup result may commit only while the same world/revision is still current, so a slow response cannot overwrite a later tick-period state. Missing AI credentials or network/model failure commits the shared neutral fallback when the startup request is still applicable and never blocks play. Already initialized saved weather is not refreshed merely because a save is opened.


### Authored grounded-item policy

World documents may define optional top-level `groundedItemPolicy` free-form text. It is authored world law supplied to Character-role scene-authoring requests: semantic categories reserved there, plus any concrete canonical item instance explicitly supplied by the engine, are mechanically grounded and cannot be invented or mechanically mutated through narration. Objects outside those categories may remain free narrative props. The engine deliberately does not parse narration, infer semantic category coverage, or enumerate hidden item definitions into the policy; secret coverage is authored through broad categories. Runtime/save reconciliation always takes this policy from the current authored world rather than stale saved text.

Character-role OpenRouter requests prefer provider `throughput`; Utility and Narrator roles remain latency-sorted. SugarCube's visible back/forward history controls are disabled, while its internal history and Mallowstead's framework narrative-history panel remain intact.
