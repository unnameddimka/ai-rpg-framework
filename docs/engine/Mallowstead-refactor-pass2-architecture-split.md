# Mallowstead 0.1.4e-candidate3 — Architecture Split Refactor

## Status

Implementation specification.

Base: `0.1.4e-candidate2` after the current-document reconciliation and Refactor Pass 1 structural cleanup.

Target version: `0.1.4e-candidate3`.

This is a behavior-preserving architecture refactor. The purpose is to remove the largest remaining ownership violations and duplicated validation/request paths without changing authored gameplay, model-facing semantics, save semantics, or transaction semantics.

---

# 1. Goals

This pass has four primary goals:

1. split the remaining god-object responsibilities out of `src/10-game-api.js` while preserving `setup.Game` as the stable gameplay facade;
2. separate trade/restock/departure-settlement mechanics from `src/10-weekly-rhythm.js`, leaving WeeklyRhythm responsible for calendar/schedule/presence rhythm rather than merchant inventory mechanics;
3. split timelapse AI protocol/request logic from transactional timelapse execution, and route sponsored-job reward settlement through the existing `StructuredAIRequest` lifecycle rather than a private repair engine;
4. centralize pure action-option validation used by the AI protocol and Game preflight while preserving execution-time revalidation and TOCTOU behavior.

A secondary goal is to make the new ownership boundaries visible in current canonical documentation and runtime test loading.

---

# 2. Hard non-regression rule

This candidate must not intentionally alter gameplay behavior.

Preserve all of the following:

- `setup.Game` external behavior and callable facade;
- `setup.CharacterAPI` and `setup.TimelapseAPI` model/runtime behavior;
- authored action availability and labels;
- action result/error semantics;
- movement/presence/trigger ordering;
- tick-start and consumed-turn failure semantics;
- TOCTOU revalidation after tick-start triggers;
- save schema and migration behavior;
- public/private world authoring;
- Character/Utility/Narrator prompt content except mechanically unavoidable wording needed to move an existing contract unchanged to a new module;
- model context shape and token budgets;
- number of structured-output repair attempts;
- transaction snapshot/rollback behavior;
- validation strictness;
- timelapse round count, movement rules, visibility, memory effects, and settlement semantics;
- merchant schedule, stock generation, acquisition provenance, valuation, and departure settlement behavior.

Do not weaken validation or remove defensive revalidation for performance.

Do not parse free-form narration to infer actions, state, contract compliance, or authority.

---

# 3. General extraction rules

## 3.1 Extract by ownership, not by line count

New modules must own coherent domains. Do not merely cut contiguous line ranges into arbitrary files.

Prefer narrow modules whose public/internal surface is obvious from their name and responsibility.

## 3.2 No new broad global facade

Do not replace one god-object with another.

New `setup.*` modules may be used as internal browser-runtime module boundaries where necessary, but they should expose only the functions required by actual callers.

`setup.Game` remains the player/gameplay facade. New extracted modules are implementation dependencies, not alternate gameplay APIs.

## 3.3 Avoid circular lexical dependencies

When an extracted domain needs helpers formerly lexical to `10-game-api.js`, use one of:

- a narrow dependency/factory contract;
- an already-existing shared module;
- a small new pure helper module when the helper is genuinely cross-domain.

Do not export dozens of former private helpers merely to make extraction easy.

## 3.4 Preserve runtime load order explicitly

Update `tests/runtime-files.js` and any build/runtime ordering assumptions required for new modules.

Tests must not pass accidentally because one suite manually loads a module that normal runtime ordering would omit.

---

# 4. Split `10-game-api.js`

## 4.1 End state

`src/10-game-api.js` should become primarily:

- assembly/bootstrap glue that truly belongs to the Game facade;
- high-level intent entry points;
- stable `setup.Game` exposure;
- only small orchestration helpers that do not have a clearer domain owner.

It should no longer directly own every item mechanic, action catalog, affordance projection, and runtime validation rule.

The exact filenames may be adjusted slightly during implementation if dependency analysis reveals a cleaner split, but the ownership boundaries below are required.

---

## 4.2 Action catalog / affordance module

Extract the action-definition layer currently centered around:

- `ActionRegistry`;
- `ACTION_AI_METADATA`;
- metadata parity checking;
- base/relevant action source selection;
- action option/affordance projection;
- AI-facing action descriptions/prerequisites;
- action-definition lookup required by protocol/preflight consumers.

Suggested module:

`src/10-game-actions.js`

or equivalently named `10-action-registry.js` if that better matches the resulting ownership.

### Requirements

- Preserve every existing action type and option shape.
- Preserve the candidate2 fail-fast exact parity invariant between action definitions and AI metadata.
- Do not change action labels, descriptions, prerequisites, repair keywords, availability, or option ordering merely while moving code.
- Avoid maintaining independent action-name lists in multiple modules when a single catalog can derive them.
- Expose the smallest practical lookup/projection surface to Game and AI protocol code.

---

## 4.3 Runtime/world validation module

Extract large pure/semi-pure runtime validation logic that validates canonical world/action prerequisites but does not itself own transaction sequencing.

Suggested module:

`src/10-game-validation.js`

Likely ownership includes coherent groups such as:

- runtime world structural validation currently embedded in Game API;
- location/sublocation/entity/inventory consistency validation that is not already owned by `09-world-derived-state.js`, `09-passage-rules.js`, Presence, WeeklyRhythm, or authored-data validators;
- reusable pure checks consumed by action/preflight code.

### Requirements

- Do not duplicate authored validation already owned elsewhere.
- Do not move transaction ordering into this module.
- Return the same error codes/messages/details for equivalent invalid states unless a test demonstrates that the old text was purely unreachable/debug-only.
- Preserve full-world validation frequency.

If a validation helper clearly belongs to an existing domain module instead, move it there rather than building a dumping-ground `game-validation` module.

---

## 4.4 Inventory/item mechanics module

Extract generic runtime item/inventory mechanics that currently make `10-game-api.js` responsible for both facade orchestration and low-level item state mutation.

Suggested module:

`src/10-item-mechanics.js`

Likely ownership includes generic operations/helpers for:

- inventory transfer/place/take state mutation;
- item accessibility and inventory ownership helpers that are not action-specific presentation;
- generic consume/fill/write/equip/unequip or other item-state primitives where they can be separated cleanly from action dispatch;
- creation/mutation primitives reused by multiple action definitions.

### Requirements

- Preserve canonical clone/validate/commit behavior.
- Preserve key-gated container semantics.
- Preserve item-transfer hooks into trade lifecycle after the WeeklyRhythm split.
- Preserve equipment invariants and item-instance identity.
- Do not introduce a new generic effect framework in this pass.

Action definitions may call these primitives; the primitives should not need to know about AI prompts or UI rendering.

---

## 4.5 Intent pipeline remains transaction-aware

`preflightIntent()` and `submitIntent()` may share extracted pure normalization/validation helpers, but must remain semantically distinct phases.

Required ordering invariant:

- preflight validates the intent against the current state before tick-start side effects;
- submit performs the actual tick-start/transaction flow;
- after tick-start triggers or equivalent same-tick mutations, submit revalidates canonical executability;
- an action invalidated within that same tick fails according to the current consumed-turn semantics;
- validation after control passes to another controller remains governed by the existing transaction boundary rules.

Do not “DRY” these functions by collapsing away the second validation phase.

---

# 5. Split trade lifecycle from `10-weekly-rhythm.js`

## 5.1 WeeklyRhythm target responsibility

After this pass `setup.WeeklyRhythm` should primarily own:

- weekday/calendar computation;
- authored weekly schedule evaluation;
- scheduled presence/absence transitions;
- morning/evening boundary rhythm;
- arrival/departure timing policy;
- departure deferral policy;
- away-state/schedule-related validation;
- orchestration of schedule boundaries.

It should not be the domain owner for merchant stock provenance and inventory settlement simply because those effects happen at a schedule boundary.

---

## 5.2 New trade lifecycle module

Extract current merchant/trade-specific responsibilities such as:

- `tradeKnowledge(...)`;
- restock execution/generation hooks;
- generated trade-stock provenance;
- transfer provenance bookkeeping currently reached through `WeeklyRhythm.noteItemTransfer(...)`;
- departure valuation/settlement currently centered around `settleDeparture(...)`;
- helper logic whose only purpose is stock generation/acquired-stock settlement.

Suggested module:

`src/10-trade-lifecycle.js`

Expose a narrow internal API such as the operations actually required by:

- WeeklyRhythm at arrival/departure boundaries;
- CharacterContext for trade knowledge;
- item transfer mechanics for acquisition provenance.

### Required dependency direction

Preferred direction:

`WeeklyRhythm -> TradeLifecycle` for schedule-bound restock/settlement calls.

`CharacterContext -> TradeLifecycle` for trade knowledge.

`ItemMechanics/Game -> TradeLifecycle` for transfer provenance.

Do not make `TradeLifecycle` call back into `WeeklyRhythm` for ordinary merchant inventory mechanics unless unavoidable for a narrow read-only calendar query.

---

## 5.3 Behavior preservation

Preserve exactly:

- Maksym Monday/Woodsday rhythm;
- initial fresh-world presence semantics;
- arrival/departure placement;
- defer-departure behavior;
- sales-chest generation/restock;
- key ownership;
- provenance distinguishing generated sales stock from acquired goods;
- supported valued-goods settlement;
- wallet effects;
- non-valued acquired stock behavior;
- Character trade context visible to AI.

Do not generalize the economy beyond current behavior in this pass.

---

# 6. Split timelapse protocol from transactional core

## 6.1 Problem

`src/24-timelapse-core.js` currently owns both:

- AI protocol/request concerns;
- canonical execution/transaction concerns.

This makes prompt/JSON contract work tightly coupled to movement, rollback, encounter resolution, memory capture, and round commit.

---

## 6.2 New timelapse protocol module

Extract model-request/contract responsibilities into a separate module.

Suggested module:

`src/23-timelapse-protocol.js`

It should own coherent protocol functionality currently represented by functions such as:

- structured request wrapper use for timelapse contracts;
- plan schema/validation and `requestPlan(...)`;
- temporal discipline/planner system text;
- interaction intent validation/request;
- interaction resume validation/request;
- reflection contract/validation/request;
- reflection repair salvage logic where that logic is protocol-level rather than canonical commit logic.

### Requirements

- Preserve request stages/purposes/models/options.
- Preserve exact structural validation behavior.
- Preserve one-repair policy and truncation handling.
- Preserve planner/reflection prompt semantics and context content.
- Do not move canonical world mutation into the protocol module.
- Protocol module may receive compact context/facts prepared by the core or use existing context builders, but it must not own transaction snapshots or commits.

---

## 6.3 `TimelapseCore` target responsibility

After extraction `src/24-timelapse-core.js` should remain responsible for:

- round orchestration;
- canonical location/formal action execution;
- snapshots, validation, rollback and commit;
- encounter grouping/orchestration;
- replan decisions based on committed failures/events;
- public/hidden committed records;
- committed timelapse experience delivery;
- pre-boundary/post-timelapse memory orchestration;
- progress and final diagnostics;
- common phase/final-result helpers already centralized in candidate2.

It calls `TimelapseProtocol` for model-produced structures and treats validated protocol output as proposals, not state.

---

# 7. Sponsored-job settlement must use `StructuredAIRequest`

## 7.1 Remove private structured-output lifecycle

`src/24-daytime-timelapse.js` currently has a separate sponsor reward path with its own JSON parsing and manual repair request.

Remove the private lifecycle centered around local helpers such as `parseJsonObject(...)` and manual second-request repair orchestration.

Use `setup.StructuredAIRequest.run(...)` with the existing sponsor-reward domain validator.

## 7.2 Preserve domain ownership

Daytime timelapse still owns:

- sponsor reward schema semantics;
- allowed reward definition IDs;
- min/max total count;
- item creation after validated completion;
- reward narration/grounded outcome records.

`StructuredAIRequest` owns only the common request/parse/truncation/repair/attempt lifecycle.

## 7.3 Required behavioral parity

Preserve:

- same Utility model/profile/purpose/stage where currently observable;
- same maximum number of initial + repair attempts;
- same successful accepted reward shapes;
- same rejection of disallowed IDs/count totals;
- same no-reward-before-settlement invariant;
- same failure result when settlement cannot be validated after repair;
- same trace/diagnostic visibility or better, using the common structured-request trace format.

Do not silently broaden the reward protocol because `StructuredAIRequest` supports richer policies.

---

# 8. Shared pure action-option validation

## 8.1 Problem

The AI protocol currently validates only part of the canonical option constraints before accepting a structured action, while Game preflight has the stronger canonical checks.

This can allow syntactically valid but impossible model output to bypass the protocol repair opportunity and fail only later in Game execution.

## 8.2 Required shared contract

Extract or expose a **pure option-validation helper** derived from canonical action definitions/options.

It must be usable by:

- AI protocol validation before a Character response is accepted;
- Game preflight structural/canonical validation.

The shared validator should cover the current action option relationships, including where applicable:

- `destination_id`;
- `item_id`;
- `target_id`;
- `target_inventory_id`;
- `activity_id`;
- `location_id`;
- `interaction_id`;
- `ability_id`;
- `serving_action_id`;
- equip/use-item suboptions;
- bulk-transfer route combinations;
- paired/cross-field constraints such as the location/target relationship for hidden-location disclosure.

Use the action catalog/options as the authority. Do not create a second manually maintained list of legal IDs if the canonical option record already contains them.

---

## 8.3 Execution-time revalidation remains mandatory

Shared protocol/preflight validation does **not** replace submit-time validation.

`submitIntent()` must still re-check action availability/options after tick-start mutations according to existing TOCTOU semantics.

The new helper improves early rejection/repair of impossible AI proposals; it is not a cache of future executability.

---

# 9. `GameInternals` and internal surfaces

Refactor Pass 1 already narrowed `GameInternals`.

During this pass:

- do not expand `GameInternals` merely to make extraction convenient;
- move tests toward domain-module surfaces or `setup.Game` where appropriate;
- if a newly extracted helper truly needs cross-module visibility, expose it from its domain owner rather than re-exporting everything through `GameInternals`;
- retain only compatibility exports that have a real current caller or explicit regression purpose.

Add exact-surface/static tests where a narrow module boundary is important enough to protect against accidental re-growth.

---

# 10. Current documentation updates

Update only current/canonical project documents affected by this refactor, primarily:

- `AGENTS.md`;
- `docs/architecture.md`;
- `docs/status.md`;
- root `README.md` repository/module map if needed.

Document new ownership boundaries:

- action catalog/affordances;
- item mechanics;
- runtime validation;
- trade lifecycle vs WeeklyRhythm;
- timelapse protocol vs TimelapseCore;
- shared action-option validation.

Do not rewrite old versioned implementation specs in `docs/engine/` or `docs/world/`.

---

# 11. Version/build metadata

Set product version to:

`0.1.4e-candidate3`

Regenerate build info through the existing generator/tooling. Do not hand-edit generated build metadata.

No public release behavior change is intended.

---

# 12. Test strategy — staged suite gates are mandatory

This refactor must be implemented in stages. Do not perform all extractions first and run tests only at the end.

For every stage below:

1. make only that stage's coherent architectural change;
2. run the listed targeted suites immediately;
3. fix all failures before proceeding;
4. run the complete `test.sh` before beginning the next major stage.

This is part of the implementation requirement, not optional process advice.

---

## 12.1 Stage 0 — baseline

Before changing candidate2:

- run full `test.sh`;
- confirm `build.sh` succeeds;
- record the baseline as green.

If baseline is not green, stop and identify whether the failure belongs to candidate2 rather than masking it inside candidate3.

---

## 12.2 Stage A — Game API split

After extracting action catalog/affordances, runtime validation, item mechanics, and any narrow shared intent helpers, run at minimum:

- `tests/run-tests.js`
- `tests/run-ai-tests.js`
- `tests/run-action-contract-repair-tests.js`
- `tests/run-playtest-action-availability-tests.js`
- `tests/run-secrets-tests.js`
- `tests/run-chuhaister-food-tests.js`
- `tests/run-hardening-tests.js`
- `tests/run-transaction-presence-hardening-tests.js`
- `tests/run-014d-cognitive-tests.js`
- `tests/run-014e-candidate1-tests.js`
- `tests/run-014e-candidate2-tests.js`

Then run full `test.sh` before Stage B.

### New Stage-A regressions

Add candidate3 tests that assert at least:

- `setup.Game` still exposes the expected stable gameplay facade;
- action catalog contains exactly the previous action types;
- AI metadata parity remains exact;
- representative available-action option records are unchanged for deterministic fixtures;
- representative item transfer/consume/equip/lock/movement actions preserve result and error semantics;
- extracted module loading is represented in `tests/runtime-files.js` rather than only ad-hoc suite loaders;
- `GameInternals` does not re-expand simply because code moved.

Where practical, snapshot normalized action-option structures rather than source text.

---

## 12.3 Stage B — WeeklyRhythm / TradeLifecycle split

After trade/restock/departure settlement extraction, run at minimum:

- `tests/run-weekly-merchant-tests.js`
- `tests/run-awayable-tests.js`
- `tests/run-transaction-presence-hardening-tests.js`
- `tests/run-migration-tests.js`
- `tests/run-persistence-tests.js`
- `tests/run-ai-tests.js`
- `tests/run-release-profile-tests.js`
- `tests/run-tests.js`

Then run full `test.sh` before Stage C.

### New Stage-B regressions

Assert at least:

- `WeeklyRhythm` still drives the same arrival/departure boundaries;
- restock produces the same deterministic stock under a fixed RNG/stub;
- acquired-stock provenance is recorded on transfer exactly as before;
- supported valued goods settle exactly as before;
- non-valued goods do not acquire unintended wallet value;
- `CharacterContext` receives the same trade knowledge shape/content for equivalent world state;
- `WeeklyRhythm` no longer owns the extracted trade implementation surface except optional narrow compatibility wrappers if a real current caller requires them.

---

## 12.4 Stage C — Timelapse protocol split + sponsored settlement lifecycle

After extracting timelapse protocol/request logic and routing sponsor settlement through `StructuredAIRequest`, run at minimum:

- `tests/run-daytime-tests.js`
- `tests/run-night-timelapse-tests.js`
- `tests/run-ai-tests.js`
- `tests/run-ai-liveness-tests.js`
- `tests/run-memory-consolidation-tests.js`
- `tests/run-mind-retrieval-tests.js`
- `tests/run-hardening-tests.js`
- `tests/run-transaction-presence-hardening-tests.js`
- `tests/run-014d-cognitive-tests.js`
- `tests/run-014e-candidate1-tests.js`
- `tests/run-014e-candidate2-tests.js`

Then run full `test.sh` before Stage D.

### New Stage-C regressions

Assert at least:

- planner protocol accepts/rejects the same deterministic fixtures;
- daytime still rejects sleep and night still permits it where available;
- interaction intent/resume validators preserve exact accepted structure;
- reflection validation/repair behavior remains bounded as before;
- TimelapseCore transaction rollback still restores canonical state after a failed round;
- sponsor reward valid first-attempt output succeeds;
- malformed first attempt followed by valid repair succeeds through `StructuredAIRequest`;
- two invalid attempts fail with no reward mutation;
- sponsor settlement performs no more repair attempts than before;
- reward items are created only after validated final settlement;
- structured diagnostics record the settlement attempts through the common lifecycle.

---

## 12.5 Stage D — shared option validation

After AI protocol and Game preflight share pure option validation, run at minimum:

- `tests/run-ai-tests.js`
- `tests/run-action-contract-repair-tests.js`
- `tests/run-playtest-action-availability-tests.js`
- `tests/run-hardening-tests.js`
- `tests/run-transaction-presence-hardening-tests.js`
- `tests/run-tests.js`
- `tests/run-014e-candidate1-tests.js`
- `tests/run-014e-candidate2-tests.js`

Then run full `test.sh`.

### New Stage-D regressions

For deterministic available-action fixtures, verify that AI protocol rejects and becomes repair-eligible for illegal values/relationships in at least:

- `activity_id`;
- `ability_id`;
- `interaction_id`;
- `serving_action_id`;
- representative invalid `location_id`;
- representative invalid bulk-transfer route combination;
- invalid paired hidden-location target/location combination.

Also verify:

- legal equivalents still pass without repair;
- the shared validator does not mutate action/options/world;
- submit-time post-trigger revalidation remains active;
- an action valid at preflight but invalidated by a same-tick trigger still fails according to existing TOCTOU/consumed-turn semantics.

---

# 13. Final verification

After all stages are green:

1. run full `test.sh` once more from the final working tree;
2. run `build.sh` and confirm the public build succeeds;
3. run the private/profile generation path covered by the normal suites/build tooling as applicable;
4. audit the diff for accidental prompt/world/schema changes;
5. build a patch relative to the exact candidate2 base;
6. apply that patch to a completely fresh unpack of candidate2;
7. on the clean-room copy run full `test.sh`;
8. run `build.sh` on the clean-room copy;
9. confirm version reports `0.1.4e-candidate3`;
10. produce the usual overlay ZIP for application on top of candidate2, plus a full agent/development ZIP as a checkpoint/reference.

The clean-room copy must not depend on untracked residue from the implementation workspace.

---

# 14. Explicit non-goals

This pass does **not**:

- shrink or redesign Character/Mind/timelapse context;
- optimize token use;
- rewrite prompts for quality/style;
- alter repair count/policy except replacing the duplicate sponsor-settlement implementation with the existing equivalent common lifecycle;
- change authored world content;
- create new economy/trade rules;
- change weekly schedules;
- change save schema or migration policy;
- weaken full-world validation;
- reduce transaction snapshots;
- add prose parsing/similarity enforcement;
- split `30-game-ui.js`;
- redesign public/private world parity tooling;
- consolidate historical versioned tests into domain suites;
- perform performance optimizations without profiling evidence.

UI decomposition and context construction optimization belong to later passes.

---

# 15. Acceptance summary

`0.1.4e-candidate3` is acceptable when:

1. `10-game-api.js` is materially reduced and no longer directly owns the action catalog, generic item mechanics, and large runtime-validation domains that have clear extracted owners.
2. `WeeklyRhythm` owns weekly schedule/presence rhythm, while trade stock/restock/provenance/departure settlement live in a dedicated trade-lifecycle module.
3. timelapse model contracts/requests live outside the transactional core; `TimelapseCore` remains the canonical execution/rollback orchestrator.
4. sponsored-job reward settlement uses `StructuredAIRequest` instead of a private JSON/repair engine with no change to accepted rewards or repair bounds.
5. AI protocol and Game preflight share canonical pure action-option validation, while submit-time revalidation remains independent for TOCTOU safety.
6. `setup.Game` and gameplay behavior remain compatible.
7. no model context, authored world, save schema, transaction semantics, or validation strictness is intentionally changed.
8. every architectural stage passes its targeted suites **and a full `test.sh` before the next stage begins**.
9. final working-tree and clean-room `test.sh`/`build.sh` runs pass.
10. current architecture/status documentation describes the new ownership boundaries.
