# Mallowstead — Human Intent, Transaction, Presence, and Validation Hardening

**Status:** Implementation specification  
**Scope:** strict Human intent preflight + post-tick TOCTOU semantics + Presence dependency inversion/completion + pure world reads/validation + transaction/rollback discipline + redundant full-world clone removal + current-documentation cleanup  
**Target:** `docs/engine/`  
**Product:** Mallowstead  
**Baseline:** `0.1.2e-candidate2`  
**Supersedes/clarifies:** the current implementation details in `presence-triggered-events-abilities-editor-hardening.md`, `awayable-character-lifecycle-arrival-hooks.md`, and `docs/architecture.md` only where this document explicitly tightens Human preflight, Presence dependency direction, or mutation/validation discipline. Historical specs remain historical.

---

## 1. Purpose

The `0.1.2e-candidate2` line has the intended ordinary-tick/triggered-event TOCTOU behavior for already-valid formal actions, but the audit found several boundaries where the same architectural invariants are only partially enforced.

This pass hardens those boundaries before further feature work.

Goals:

- reject every impossible/out-of-contract Human intent **before** an ordinary tick can begin;
- preserve committed tick-start effects when an intent was valid before the tick but became impossible because of that tick;
- make `Presence` a true base engine layer rather than a facade that still depends on `WeeklyRhythm`;
- make world getters and validators observationally pure;
- require explicit repair/migration/normalization boundaries;
- guarantee rollback/candidate validation for every untrusted canonical mutation unit;
- remove unnecessary nested full-world snapshots inside one logical mutation transaction;
- synchronize the current README/architecture wording with the actual current product without adding patch-note clutter;
- preserve current gameplay semantics unless explicitly changed below.

This is a **correctness and architecture hardening pass**, not a content feature.

---

# Part A — Human Intent Admission

## 2. Core invariant: invalid Human input creates no tick

The authoritative rule remains:

> Impossible or out-of-contract Human input is rejected before simulation advances.

A request rejected at this admission boundary must have **no canonical or presentation side effects**.

At minimum, rejection before tick start means all of the following remain unchanged:

- `ordinaryTickId`;
- triggered-event processed-tick bookkeeping;
- triggered-event runtime state;
- RNG state/calls owned by tick-start triggered events;
- `nextIntentId`;
- canonical events and observations;
- AI reaction queue;
- character/world canonical state;
- progressive committed-presentation callbacks;
- Human turn ownership.

The result must report:

```text
turnConsumed = false
```

This is stronger than merely rolling `ordinaryTickId` back afterward. A structurally invalid request must never enter tick execution at all.

---

## 3. Strict Human intent preflight

Introduce one pure preflight boundary for the complete Human intent before `beginOrdinaryTick()`.

Conceptually:

```text
Human input
    -> pure admission/preflight
    -> reject with no tick
       OR
    -> reserve/start ordinary tick
    -> process tick-start triggers
    -> execute the already-admitted attempt against the post-trigger world
```

Exact function naming may follow project conventions.

### 3.1 What preflight validates

Preflight must cover every condition that is already deterministically knowable from the current canonical world and request structure.

At minimum:

- player setup requirements;
- required external runtime prerequisites that intentionally block starting the action/timelapse, such as missing API key for a Human-requested timelapse;
- non-empty combined intent: narrative/speech and/or one formal action;
- formal action schema and current concrete option contract;
- speech/narrative structure;
- supported loudness value normalization/contract;
- shout rules;
- direct-addressee grounding;
- move+speech grounding and origin/destination delivery eligibility;
- any other current deterministic Human-only admission rule.

Do not leave a deterministic Human contract check only inside the post-tick `CharacterAPI.submitIntent()` path if it can reject the request before the tick.

### 3.2 Explicit invalid-structure examples

These are preflight rejection examples, not in-world failures:

```text
Shout + target_id
Shout + move
Shout with no spoken text
Malformed/unknown formal action schema
Formal option not currently available
Completely empty intent
Speech target that is already ungrounded before the tick
Move+speech addressee that is neither at origin nor grounded at destination
```

In particular:

> `Shout` with an addressee is structurally invalid. It must not start a tick “even briefly”.

### 3.3 Preflight is pure

Human preflight may inspect canonical state and deterministic derived views, but it must not:

- mutate or repair the world;
- consume IDs;
- emit events/observations;
- enqueue AI work;
- run triggered events;
- roll gameplay RNG;
- call committed-presentation callbacks;
- normalize canonical state in place.

If preflight requires a derived helper, that helper must be safe to call from a read-only path.

### 3.4 Preflight result may carry a plan

To avoid recomputing structural interpretation, preflight may return a pure validated plan containing facts such as:

- normalized action request;
- parsed structured speech;
- normalized loudness;
- grounded pre-tick target identity;
- move-speech phase (`origin` / `destination`);
- evidence that the formal action matched the pre-tick available-action contract.

Such a plan is evidence that the request was a legitimate attempt **at tick start**. It is not authority to skip post-trigger mechanical checks.

---

# Part B — Post-Tick TOCTOU Semantics

## 4. Tick-start changes may invalidate an already-valid attempt

Once preflight succeeds and the ordinary tick begins, tick-start triggered events are allowed to change canonical state before Human intent execution.

If that committed change makes an already-admitted request impossible, this is a **TOCTOU gameplay failure**, not a malformed Human request.

Required semantics:

```text
preflight valid
    -> tick begins
    -> tick-start trigger commits
    -> previously valid attempt is no longer mechanically possible
    -> trigger stays committed
    -> Human attempt fails in-world
    -> turnConsumed = true
```

Do not roll the tick or trigger back merely because the admitted action/speech can no longer complete.

---

## 5. Formal-action TOCTOU

Preserve the current intended behavior:

- a Human formal action is validated against `available_actions` before tick start;
- after tick-start triggers, the action is checked again against current canonical mechanics;
- if the contract changed because of the committed tick-start mutation, return the grounded mechanical failure appropriate to the new state;
- do **not** reinterpret it as `ACTION_CONTRACT_REJECTED` caused by bad Human input;
- the turn is spent.

Example:

```text
Preflight: door interaction is currently valid.
Tick-start trigger: door closes/locks or the relevant object becomes unavailable.
Execution: action fails for the grounded current-world reason.
Result: tick and trigger stay committed; Human turn is consumed.
```

---

## 6. Speech/narrative TOCTOU

Apply the same distinction to grounded speech/narrative constraints.

Example:

```text
Preflight: target is nearby and valid as direct addressee.
Tick-start trigger: target becomes locally absent or is relocated elsewhere.
Execution: direct addressed speech can no longer be delivered as requested.
Result: grounded post-start failure; trigger stays committed; turn is consumed.
```

The engine must not return a no-tick admission error for a condition that became false only after the tick started.

Structural request rules do not become TOCTOU rules. For example, `Shout + target_id` is always rejected before tick start; no trigger can make that malformed request legitimate retroactively.

### 6.1 Combined intents

Keep the existing combined-intent ordering/atomicity semantics unless a concrete correctness fix requires otherwise.

This specification requires only the admission distinction:

- invalid **before** tick -> reject/no tick;
- valid before tick but invalidated **by** committed tick-start state -> grounded consumed-turn failure.

Do not silently execute a structurally different Human intent as a fallback merely to avoid a failure.

---

# Part C — Presence as a Base Layer

## 7. Dependency direction

`Presence` is a base simulation capability.

The required dependency direction is:

```text
Presence
    ↑
WeeklyRhythm / awayable scheduling
```

not:

```text
Presence
    ↓
WeeklyRhythm
```

`WeeklyRhythm` decides **when** schedule-driven arrivals/departures/presence transitions happen. It operates the generic Presence mechanism/state.

`Presence` decides whether a Character/topology is locally participating **from generic canonical presence/activation/placement state**. It must not know calendar policy.

---

## 8. Presence must not depend on WeeklyRhythm

After this patch, the `Presence` implementation must not call or require `WeeklyRhythm` for:

- current weekday;
- fixed weekly schedule evaluation;
- arrival opportunity calculation;
- travel duration;
- planned departure calculation;
- schedule-specific `isSchedulePresent` checks;
- any other calendar/business semantics.

A grep-level module dependency from `10-presence.js` to `WeeklyRhythm` should not remain.

This explicitly supersedes the previous implementation detail where `Presence.isLocallyPresent()` delegated part of its answer back to `WeeklyRhythm.isSchedulePresent()`.

---

## 9. Generic Presence state/transition boundary

Schedule systems must express their result through a neutral Presence-owned representation/transition.

The exact internal representation may follow the least disruptive implementation, but it must satisfy all of these properties:

- it is not named or shaped around weekdays, merchants, or Maksym;
- it can represent an activation-`active` Character that is currently locally absent;
- `Presence.isLocallyPresent()` can answer without consulting schedule code;
- local topology availability can be derived through the same Presence boundary;
- save/load/migration preserves the state;
- ordinary non-awayable always-local characters remain simple;
- activation remains a separate axis.

If a new neutral persisted presence marker is introduced, legacy/current `awayState.present` and fixed-weekly content must be migrated/bridged deterministically rather than maintained as two competing authorities.

There must be one authoritative answer to “is this Character locally present?”

---

## 10. WeeklyRhythm after inversion

`WeeklyRhythm` remains responsible for schedule policy such as:

- weekday/calendar helpers;
- fixed authored schedule evaluation where still supported;
- arrival opportunities;
- planned departure;
- defer-departure schedule semantics;
- travel-period accounting;
- arrival hooks/business lifecycle timing.

When those policies imply arrival or departure, `WeeklyRhythm` invokes the generic Presence transition/state mechanism and then applies its schedule-specific surrounding work transactionally.

`WeeklyRhythm` may retain compatibility wrapper names such as:

```text
isCharacterPresent
isLocationAvailable
isSublocationAvailable
```

only as temporary forwarding compatibility surfaces.

New generic engine code must not depend on those wrappers.

---

## 11. Complete generic consumer migration

All generic local-participation/topology consumers must use `Presence` directly.

This includes the remaining direct `WeeklyRhythm.isLocationAvailable()` / `isSublocationAvailable()` uses in `GameAPI` and equivalent generic code paths.

At minimum audit:

- movement destinations;
- movement validation;
- local view generation;
- local target/addressee enumeration;
- action source gating;
- timelapse reachability/catalogs;
- topology exposure;
- local character lists;
- perception and scheduler participation;
- any other engine code asking a generic local-presence/topology question.

No generic subsystem should need to know that a weekly schedule exists merely to ask whether a place/person participates locally right now.

---

# Part D — Pure Read and Validation Boundaries

## 12. `Game.getWorld()` is a getter

`Game.getWorld()` must become observationally pure.

Calling it must not:

- run migration;
- normalize canonical structures;
- create missing AI state;
- repair the AI queue;
- synchronize item placement;
- sanitize dialogue/memory/control state;
- repair discovery;
- otherwise mutate canonical world state.

It returns the current canonical world object according to existing project API expectations and does nothing else.

Repeated reads of an unchanged world must leave that world unchanged.

---

## 13. Repair/preparation must be explicit

Repair, migration and normalization remain allowed and necessary at explicit lifecycle boundaries.

Examples:

- fresh-world construction/bootstrap;
- save migration;
- save load/import;
- editor/world import validation pipeline where applicable;
- an explicitly named repair/admin operation.

The implementation may retain a `prepareCurrentWorld`-style helper internally, but callers must invoke it intentionally at a documented repair/preparation boundary.

Do not hide repair inside ordinary getters or validation calls.

Runtime API calls against a malformed canonical world should fail validation/operation rather than silently healing unrelated state as a side effect of reading it.

---

## 14. `validateWorld()` is pure

World validation must answer only:

```text
valid
or
invalid + reason
```

It must not mutate the candidate being validated.

In particular, validation must not call mutating “ensure” helpers such as an AI-state initializer/queue repair on the object it is validating.

Example required behavior:

```text
candidate.ai missing
    -> validation failure
    -> candidate.ai remains missing
```

not:

```text
candidate.ai missing
    -> validator creates ai
    -> validation returns success
```

### 14.1 Validator helper discipline

If existing validation depends on helpers that combine “ensure” and “check”, split them as needed:

```text
prepare/repair/ensure  // mutating, explicit lifecycle use
validate/check         // pure
```

The same rule applies to nested validators where mutation is currently hidden behind convenience helpers.

---

# Part E — Transactional Mutation Discipline

## 15. No canonical mutation may survive failed validation

Treat every engine mutation path as untrusted.

The project deliberately prefers conservative validation over micro-optimizing deterministic JavaScript work because model calls dominate runtime cost.

For every logical canonical mutation unit that can fail:

```text
validate request/prerequisites
    -> create candidate or snapshot
    -> apply all mutations/events/observations for that unit
    -> pure validateWorld(candidate/current candidate)
    -> commit on success
    -> rollback/discard on failure
```

No function may mutate canonical state, discover validation failure, return `ok:false`, and leave the mutation behind.

---

## 16. Transaction unit, not giant global rollback

Transactionality applies at the actual commit unit.

Do **not** turn a multi-round timelapse into one giant all-or-nothing transaction if earlier rounds are already intentionally committed/presented.

Instead:

- each committed timelapse round/effect/movement uses its own valid commit boundary;
- each deterministic boundary transition uses its own transaction;
- already committed earlier rounds remain committed if a later independent stage fails;
- the currently failing uncommitted mutation unit rolls back completely.

This preserves existing progressive/causal timelapse semantics while removing dirty partial mutations inside each unit.

---

## 17. Known mutation paths to audit

The implementation pass must audit all mutation+validation paths, not only the examples found during review.

Known examples include at least:

- `moveTimelapseActor()`;
- `applyRoutineAnchor()`;
- `executeTimelapseAction()` including `sleep`, `study_item`, and authored timelapse effects;
- `updateCharacterProfile()`;
- ordinary action execution;
- combined Human intent execution;
- Presence forced relocation/transition callers;
- weekly/awayable arrival/departure and coarse boundary advancement;
- daytime/night wrapper phase/wake/boundary mutations;
- other paths that call `validateWorld()` only after directly changing canonical state.

Existing correctly transactional paths should be preserved rather than rewritten gratuitously.

---

## 18. Coarse boundary validation before success

`WeeklyRhythm.advanceCoarseBoundary()` (or the successor boundary owner after Presence inversion) must not report success for a mutated boundary candidate before that candidate has passed pure world validation.

Required shape:

```text
snapshot/candidate
    -> travel/accounting
    -> departures/arrivals
    -> Presence transitions/forced relocations
    -> arrival hooks/restock/settlement as applicable
    -> queue/state updates
    -> validate candidate
    -> commit/return success
```

If final validation fails, the entire boundary transition is rolled back/discarded.

The later timelapse wrapper must not be the first place that discovers the boundary left canonical state invalid.

---

# Part F — Full-World Snapshot Discipline

## 19. Preserve conservative transactions, remove redundant nesting

This patch does **not** remove full-world transactional protection from ordinary actions.

It removes unnecessary nested cloning of the same logical mutation unit.

Current problematic shape is conceptually:

```text
submitIntent
    -> clone(world)
    -> executeAction
         -> clone(world) again
```

A single logical Human intent/action transaction should not deep-clone the whole world twice merely because one safe executor calls another safe executor.

---

## 20. One owner per logical mutation transaction

A nested executor should be able to operate inside an already-owned candidate/snapshot transaction.

Exact API design may follow existing conventions and does not require a new general transaction framework.

Acceptable conceptual patterns include:

```text
submitIntent owns candidate
    -> executeActionOnCandidate(...)
```

or an explicit internal option/context saying that rollback/validation is owned by the caller.

Requirements:

- standalone `CharacterAPI.perform()` / direct action execution still gets its own safe snapshot/candidate;
- combined-intent execution reuses the outer mutation transaction rather than cloning the full world again;
- post-mutation validation still happens exactly at the correct owning boundary;
- inner failures cannot leak partial mutation;
- no optimization weakens TOCTOU correctness or grounded event emission.

Triggered events remain separate transactions: a real tick-start proc may legitimately have its own candidate because it commits before Human intent execution.

---

# Part G — Documentation and Source Hygiene

## 21. `docs/architecture.md`

Update current architecture to document the final behavior from this patch:

- complete Human intent preflight before ordinary tick start;
- structural/pre-tick invalid input versus post-start TOCTOU grounded failure;
- Presence as a base layer with schedule systems depending on it, never the reverse;
- pure `getWorld()`;
- pure `validateWorld()`;
- explicit repair/migration boundaries;
- transaction validation/rollback per commit unit;
- no redundant nested full-world clone for one logical action transaction.

Also remove/adjust the stale current-world Smithy sentence that presents Price as part of the public/default Mallowstead relationship authoring. Private-profile content must not be stated as an ordinary public-world fact in the current architecture narrative.

Historical implementation specs mentioning Price or older architecture remain historical unless explicitly superseded.

---

## 22. Root `README.md`

Fix the stale hard-coded public package filename/version wording so the current README does not instruct readers to expect the old `Mallowstead-0.1.2c-maksym.zip` artifact.

Prefer wording that remains correct across subsequent patch candidates rather than requiring a manual README version edit every build.

Do **not** add:

- a patch changelog;
- a second patch-specific README;
- an audit report dumped into the root README;
- implementation-detail prose unrelated to player/developer onboarding.

Keep README changes minimal and surgical.

---

## 23. `dist/` is outside this hardening task

`dist/` contents are build artifacts.

Do not treat stale files already present under `dist/` as source/documentation inconsistencies for this task, and do not rewrite/remove them merely to make the source tree look current.

Normal build scripts remain responsible for generated distribution output.

---

# Part H — Migration / Compatibility

## 24. Presence-state migration

If Presence dependency inversion introduces or changes a neutral persisted presence representation:

- migrate current `0.1.2e-candidate2` saves model-free;
- preserve whether each awayable/fixed-schedule character is locally present at the saved moment;
- preserve `activationState` independently;
- preserve `plannedDeparture`, travel accounting, arrival schedule policy, mind, inventory, wallet, equipment, discovery, and dialogue;
- do not spuriously run arrivals/departures/restock/settlement during migration;
- do not reveal secret/inactive characters;
- do not duplicate schedule state into two competing authorities.

Fresh-world initialization must establish the same neutral Presence truth explicitly before gameplay begins.

---

## 25. Compatibility wrappers

Old `WeeklyRhythm.isCharacterPresent/isLocationAvailable/isSublocationAvailable` APIs may remain as forwarding wrappers for compatibility if useful.

They must:

- forward to `Presence` for the generic current-presence answer;
- contain no independent second implementation of generic presence;
- not be used by new generic engine code.

Removal of wrappers is not required by this patch unless tests prove there are no remaining callers and removal is clearly safe.

---

# Part I — Required Tests

## 26. Human preflight no-tick tests

Add deterministic tests proving that each representative admission error causes **zero tick/world side effects**.

At minimum cover:

1. empty intent;
2. malformed/unavailable formal action;
3. `Shout + target_id`;
4. `Shout + move`;
5. shout without spoken text;
6. already-not-nearby direct speech target;
7. ungrounded move+speech destination target;
8. missing required AI key for a Human-requested timelapse.

For each relevant case assert at least:

```text
ok = false
turnConsumed = false
ordinaryTickId unchanged
world deep-equal to before request
no triggered-event proc/RNG
no committed presentation callback
```

Where practical, instrument `processOrdinaryTick()` to prove it was not called rather than only inferring from state.

---

## 27. TOCTOU tests

Add deterministic tick-start trigger fixtures proving:

### 27.1 Formal action

- action is available during preflight;
- tick-start trigger makes it unavailable;
- trigger remains committed;
- `ordinaryTickId` advances once;
- action returns grounded post-trigger failure, not preflight contract rejection;
- `turnConsumed = true`.

### 27.2 Direct speech target

- target is grounded/nearby during preflight;
- tick-start trigger makes target locally absent or relocates it;
- trigger remains committed;
- request becomes grounded post-start failure;
- `turnConsumed = true`;
- no rollback of the trigger/tick occurs.

### 27.3 Structural invalidity distinction

Use the same trigger fixture with `Shout + target_id` and prove the trigger never executes because structural rejection occurs before tick start.

---

## 28. Presence dependency tests

Prove both behavior and dependency direction:

1. `Presence.isLocallyPresent()` works when `WeeklyRhythm` is unavailable/stubbed out for the read;
2. `Presence.isLocationAvailable()` / `isSublocationAvailable()` do not call schedule helpers;
3. schedule-driven departure invokes/updates the neutral Presence state and then `Presence` reports absent;
4. schedule-driven arrival invokes/updates Presence and then `Presence` reports present;
5. travelling Maksym remains activation-`active` while locally absent;
6. activation-`inactive` Chuhaister remains locally absent for the independent activation reason;
7. generic `GameAPI` topology/target/action consumers call `Presence`, not weekly availability wrappers;
8. compatibility wrappers, if retained, forward to Presence and return identical answers.

A source-level guard/grep test preventing `10-presence.js` from depending on `WeeklyRhythm` is acceptable and encouraged.

---

## 29. Getter purity tests

Take a deliberately malformed-but-readable runtime object and prove repeated `Game.getWorld()` calls do not repair it.

At minimum cover one former hidden-repair case such as missing/malformed AI queue/state.

Assert deep equality before/after getter calls.

Also prove ordinary valid reads do not change event IDs, queue order, discoveries, item placement, dialogue, or other canonical state.

---

## 30. Validator purity tests

For representative malformed candidates:

- deep-clone candidate before validation;
- call `validateWorld(candidate)`;
- assert failure where appropriate;
- assert candidate deep-equals the before clone.

At minimum cover:

1. missing `world.ai`;
2. malformed AI continuation/queue state that previously got repaired;
3. one invalid placement/topology case;
4. one invalid inventory/item-placement case if the validator currently normalizes it.

Also run the same deep-equality assertion for a valid candidate: successful validation must not mutate either.

---

## 31. Transaction rollback tests

Inject a deterministic post-mutation validation failure for each representative mutation family and assert exact rollback/discard.

At minimum cover:

- timelapse movement;
- timelapse sleep;
- timelapse study/effect mutation;
- character profile update;
- coarse boundary transition;
- one Presence relocation/arrival/departure path;
- ordinary/combined action transaction.

A failed unit must leave canonical state equal to its pre-unit state, except for earlier independently committed units explicitly outside that transaction.

For coarse boundary failure, assert day/calendar, away/presence state, inventories/wallet changes, relocations, observations/events, and queue effects are all restored/discarded together.

---

## 32. Snapshot-count tests

Instrument the full-world clone/snapshot helper around combined Human intent execution.

Prove:

- an ordinary standalone formal action remains transactionally protected;
- a combined `submitIntent` + formal action does not perform a redundant nested full-world snapshot for the same Human mutation transaction;
- a real tick-start triggered event may still take its own separate transactional candidate;
- a trigger prerequisite failure/chance miss retains the existing no-clone fast path.

Do not assert an unnecessarily brittle global clone count for unrelated small object clones; instrument the world-transaction snapshot boundary specifically.

---

## 33. Documentation regression tests

Where current tests inspect product/docs consistency, add or update checks so that:

- root README no longer hard-codes the obsolete `0.1.2c-maksym` package as current output;
- current architecture states the final Human preflight/TOCTOU rule;
- current architecture states `WeeklyRhythm -> Presence` dependency direction;
- current architecture does not present private Price relationship authoring as a public/default Smithy fact.

Do not add tests requiring historical specs to be rewritten.

---

# Part J — Non-Goals

## 34. Explicit non-goals

This patch does **not**:

- change authored world content or story outcomes;
- change Chuhaister/Maksym schedules, probabilities, prices, inventory, or personality;
- change the one-tick trigger snapshot semantics established in candidate2;
- roll back a committed tick-start trigger merely because the Human attempt then fails;
- make all timelapse history globally atomic across multiple already-committed rounds;
- remove validation to save microseconds;
- introduce arbitrary scripting;
- redesign persistence beyond the minimum migration needed for neutral Presence state;
- require deletion of `WeeklyRhythm` compatibility APIs;
- rewrite historical implementation specs for cosmetic consistency;
- regenerate/clean stale `dist/` artifacts;
- add a patch README or dump audit notes into the root README;
- introduce a large generic transaction framework when existing candidate/snapshot primitives can satisfy the invariants.

---

# Part K — Acceptance Criteria

## 35. Human intent acceptance

Implementation is complete when:

1. every deterministically invalid Human combined intent is rejected before `beginOrdinaryTick()`;
2. `Shout + target_id` demonstrably causes no tick, trigger, RNG, event, observation, callback, or canonical mutation;
3. all preflight rejections return `turnConsumed:false`;
4. a valid pre-tick formal action invalidated by a tick-start trigger produces a grounded consumed-turn failure while the trigger remains committed;
5. a valid pre-tick grounded direct speech attempt invalidated by a tick-start trigger follows the same consumed-turn distinction;
6. no post-tick code path is the sole validator for a deterministic Human admission rule that could have been checked before tick start.

---

## 36. Presence acceptance

Implementation is complete when:

1. `Presence` is the generic base local-participation/topology authority;
2. `Presence` contains no runtime dependency on `WeeklyRhythm` or weekly/calendar policy;
3. `WeeklyRhythm` decides schedule timing and applies results through generic Presence state/transitions;
4. generic `GameAPI`/perception/targeting/pathing/timelapse consumers use `Presence` directly;
5. compatibility wrappers, if retained, are one-way forwards into Presence;
6. awayable/fixed-schedule current presence survives save/load/migration with exactly one authoritative state;
7. activation remains independent from local presence.

---

## 37. Read/validation acceptance

Implementation is complete when:

1. `Game.getWorld()` performs no repair/preparation/migration side effects;
2. all canonical repair/preparation occurs only through explicit lifecycle/admin boundaries;
3. `validateWorld()` is pure for valid and invalid candidates;
4. missing/malformed AI state is reported rather than silently repaired by validation;
5. tests deep-compare candidate/world state before and after getter/validator calls.

---

## 38. Transaction acceptance

Implementation is complete when:

1. no audited mutation path can return validation failure while leaving its uncommitted canonical mutation behind;
2. coarse boundary success is impossible before that complete boundary candidate validates;
3. timelapse uses transactionality per committed unit without undoing earlier intentionally committed rounds;
4. nested ordinary action execution reuses an outer Human intent transaction rather than taking a redundant second full-world snapshot;
5. standalone action execution remains independently safe;
6. triggered-event candidate2 no-clone miss behavior and transactional real-proc behavior remain intact.

---

## 39. Documentation acceptance

Implementation is complete when:

- `docs/architecture.md` reflects the final rules from this specification;
- root README's build-output wording is current/future-proof and minimally edited;
- the stale public/default Price relationship statement is removed or correctly scoped to private content;
- `dist/` is untouched solely for staleness cleanup;
- no new root patch README/changelog artifact is introduced.

---

## 40. Regression acceptance

Before delivery:

- all existing test suites pass;
- all new tests in this specification pass;
- public and private build-profile tests pass;
- public build/package contains no private-world leakage;
- ordinary action, triggered-event, awayable, Presence, timelapse, migration, editor, persistence, UI and release-profile regressions remain green;
- the patch is reviewed specifically for hidden read-time mutation and nested world-snapshot regressions.

