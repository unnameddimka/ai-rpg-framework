# Mallowstead — Generic Awayable Character Lifecycle, Deferred Departure, Arrival Hooks

**Status:** Implementation specification  
**Scope:** Generic awayable-character engine capability, deferred departure, travel/arrival semantics, deterministic arrival hooks, migration, validation, tests, and engine-side documentation consistency  
**Target:** `docs/engine/`  
**Product:** Mallowstead  
**Baseline:** current `main` at implementation time; read `AGENTS.md`, `docs/architecture.md`, `docs/status.md`, `docs/engine/weekly-rhythm-scheduled-presence-bulk-transfer-paper.md`, and current authored `data/world.json` before changing code.

> World-specific Maksym authoring, restock data, trade grounding, and integration acceptance live in `docs/world/maksym-awayable-schedule-arrival-restock.md`.

---

## 1. Purpose

Replace the current effectively fixed weekly merchant-presence behavior with a reusable engine capability for characters who may leave the locally simulated village and later return on authored schedule opportunities.

The engine must provide a generic **awayable character** lifecycle:

- a character may be locally present or away;
- authoring defines regular arrival opportunities and default departure timing;
- runtime state owns the currently planned departure;
- the character may consciously defer an imminent departure by one coarse period through an ordinary formal action;
- after actual departure, an authored number of full timelapse periods must elapse before the character can use a later arrival opportunity;
- arrival opportunities missed while the character is still travelling are lost rather than replayed later;
- a true `away -> present` transition may run authored deterministic arrival hooks;
- remaining absent/off-map does not simulate the character's remote life.

Maksym is the first authored consumer of this capability, but the engine implementation must not be special-cased for Maksym, merchants, trade, Monday/Woodsday, or Mallowstead-specific story reasons.

---

# Part A — Architectural Boundary

## 2. Hard invariant: no Maksym-specific engine logic

Do not add logic equivalent to:

```text
if character.id == maksym ...
if character is merchant ...
if weekday == Monday/Woodsday ...
```

inside the generic presence/departure/travel implementation.

The engine owns only generic temporal mechanics.

Character-specific facts belong in authored data or existing generic systems.

The intended architecture is:

```text
generic awayable engine
    +
authored schedule/lifecycle data
    +
optional generic deterministic arrival hooks
    +
character-specific AI-facing authoring
    =
authored character behavior
```

An authored character is a consumer of the capability, not a privileged runtime type.

## 3. Relationship to existing weekly presence

The existing weekly-presence system should be refactored or extended so that awayable presence is no longer derived solely from "is this weekday in a fixed present-day set?"

A fixed schedule may remain useful as authoring input, but canonical runtime presence for an awayable character must be able to diverge from the default schedule when that character deliberately delays departure.

The schedule defines **opportunities/defaults**, not immutable destiny.

Non-awayable characters and any simple fixed-presence content that does not need this capability must continue to work.

---

# Part B — Generic Awayable Character Model

## 4. Authored capability

Introduce a reusable authored capability for a character to be awayable.

Exact field names may follow current project conventions, but the semantic content should support at least:

```json
{
  "awayable": {
    "arrivalSchedule": [
      { "weekday": "Monday", "phase": "Morning" },
      { "weekday": "Woodsday", "phase": "Morning" }
    ],
    "defaultDeparture": {
      "relativeToArrival": "next_morning"
    },
    "travelPeriods": 3,
    "aiDescription": "..."
  }
}
```

This shape is conceptual, not a requirement to use these exact JSON names.

The engine must not parse prose to determine schedule mechanics.

### 4.1 Arrival schedule

An arrival schedule is a set of authored **arrival opportunities** at specific canonical calendar boundaries.

An arrival opportunity does not force a transition when the character is already present.

### 4.2 Default departure policy

Authoring defines how a new true arrival initializes that visit's planned departure.

A fresh-world authored bootstrap may initialize a compatible planned departure directly without pretending a scheduled arrival just occurred.

### 4.3 Travel duration

`travelPeriods` is the number of **fully completed timelapse periods after actual departure** required before the character is eligible to return.

Travel duration is generic absence/travel bookkeeping. The engine does not model what the character does off-map.

## 5. Canonical runtime state

Awayable lifecycle state belongs to the save, not to the model's continuation or memory.

The runtime must be able to represent at least:

- whether the character is currently locally present or away;
- the current visit's planned departure boundary while present;
- remaining required away/travel periods, or equivalent travel-completion state, while absent;
- enough state to avoid replaying a missed arrival opportunity;
- any lifecycle revision/source data required for deterministic migration and validation.

A conceptual shape is:

```json
{
  "awayState": {
    "present": true,
    "plannedDeparture": {
      "dayNumber": 42,
      "phase": "Morning"
    },
    "travelPeriodsRemaining": 0
  }
}
```

Exact representation may differ.

### 5.1 State ownership

This is objective canonical simulation state.

Do **not** infer a current decision to stay from:

- `continuation`;
- STM;
- LTM;
- beliefs;
- recent dialogue;
- model prose.

A remembered old wish to stay must never silently alter a future visit.

Only the current formal lifecycle action may change the active planned departure.

---

# Part C — Departure and `defer_departure`

## 6. Deterministic departure

When a canonical coarse-time boundary reaches the current `plannedDeparture` and it has not been deferred:

1. the character becomes away;
2. local topology/presence is removed using the generic awayable/presence system;
3. any existing independent departure lifecycle such as merchant acquired-stock settlement may run through its own existing contract;
4. away/travel countdown begins from the actual departure;
5. the character no longer participates in local ordinary reaction waves, timelapse planning, local observations, or local actions while away.

Departure itself is deterministic. The model is not asked whether it "really meant it" at the boundary.

## 7. Generic formal action: `defer_departure`

Add a generic formal action conceptually named:

```text
defer_departure
```

Exact naming may follow project conventions.

### 7.1 Controller-agnostic

This is an ordinary formal action.

It must be available through the same canonical action-contract path to:

- AIController;
- HumanController controlling an eligible awayable character.

Do not make it an AI-only control.

### 7.2 Ordinary ticks only

`defer_departure` is available **only during ordinary tick gameplay**.

It must **not** be exposed to or emitted by:

- daytime timelapse planners;
- overnight timelapse planners;
- encounter resolver/planner contracts;
- reflection/maintenance jobs.

A character that enters a timelapse without having deferred an imminent departure accepts the existing planned boundary.

### 7.3 Availability / no-op invariant

Expose `defer_departure` only when it can materially affect the current visit.

Specifically, it is relevant when the character's current `plannedDeparture` is the boundary reached by the **next timelapse transition from the current phase**.

If the departure is not imminent in that sense, do not expose a useless defer action.

This preserves the project-wide **Model Output Must Have Effect** invariant.

### 7.4 Effect

One successful `defer_departure` moves `plannedDeparture` forward by exactly **one canonical timelapse period/boundary**.

It does not create a permanent schedule change.

Example:

```text
Monday Evening
planned departure = Flamesday Morning

defer now
=> planned departure = Flamesday Evening

during Flamesday Morning ordinary ticks:
defer again
=> planned departure = Flowday Morning
```

The character may repeat this indefinitely across later ordinary periods if it continues to choose to stay.

### 7.5 Privacy

The canonical decision to defer departure is **private**.

The formal action must not automatically create public speech such as:

> "I'm staying another day."

The character may:

- say so in `spokenText`;
- imply it narratively;
- tell nobody and silently stay.

The engine may produce private grounded action feedback to the acting character as needed for protocol/state clarity, but the lifecycle state change itself is not a public announcement.

---

# Part D — Travel Counting and Missed Arrivals

## 8. Travel-period semantics

Travel counts **fully completed timelapse periods after departure**.

For a character with:

```text
travelPeriods = 3
```

three completed periods are sufficient to be eligible at the next arrival opportunity.

### 8.1 Authoritative boundary example

This exact case must work:

```text
Flamesday Morning   character is still present
Flamesday Evening   actual departure; now away

Flamesday Night     travel period 1 completes
Flowday Day         travel period 2 completes
Flowday Night       travel period 3 completes

Woodsday Morning    road requirement is complete
                    => character is eligible for this scheduled arrival
                    => character arrives
```

Therefore **Flamesday Evening is still a safe departure for making Woodsday Morning** when the authored schedule and travel duration match this example.

Do not introduce an off-by-one rule requiring the road to have completed one boundary earlier.

### 8.2 Missed arrival

If an authored arrival opportunity occurs while the character has **not yet completed** the required away/travel periods:

- that arrival opportunity is missed;
- the character remains away;
- the engine does not create a delayed/catch-up arrival when travel later finishes;
- the next return can occur only at a later authored arrival opportunity.

When travel later completes between opportunities, the character stays away until another authored arrival opportunity.

---

# Part E — Arrival Semantics

## 9. True arrival transition

An arrival occurs only on a real:

```text
away -> present
```

transition at an authored arrival opportunity for which travel requirements are complete.

On true arrival:

1. local character presence is restored;
2. conditional topology owned by that presence is exposed according to the existing generic mechanism;
3. a new visit's default `plannedDeparture` is initialized from authored policy;
4. authored `onArrival` deterministic hooks execute;
5. ordinary local simulation resumes.

## 10. Already-present arrival opportunity

If an arrival opportunity occurs while the character is already present because they stayed through it:

- there is **no new arrival transition**;
- do not reset `plannedDeparture` merely because the calendar matches an arrival weekday;
- do not run arrival hooks;
- do not restock;
- do not reset/replace carried state;
- do not pretend the character made an off-map trip.

The character may still later depart, but if that departure causes them to miss the next scheduled opportunity, they wait for the following one.

---

# Part F — Generic Authored Arrival Hooks

## 11. `onArrival` deterministic hook mechanism

Allow authored awayable content to attach deterministic actions to a **true return**.

Conceptual shape:

```json
{
  "awayable": {
    "...": "...",
    "onArrival": [
      {
        "action": "restock",
        "targetInventoryId": "merchantSalesChest",
        "stock": []
      }
    ]
  }
}
```

Do not hard-wire restocking into the awayable engine itself.

The lifecycle engine should invoke generic validated authored arrival actions/hooks.

Only actions explicitly supported by the hook registry/contract may run.

Unknown/invalid authored hooks must fail world validation rather than execute arbitrary code.

## 12. Initial supported arrival hook: `restock`

The first required hook type is deterministic authored:

```text
restock
```

It must support the current merchant use case without creating a second competing stock-generation system.

Authoring must be able to define at least:

- target inventory/container;
- allowed item definitions;
- quantities or min/max quantity rules;
- optional inclusion/probability/subset rules needed by the existing variable assortment;
- any existing provenance needed to mark generated merchandise as sale stock.

Use existing current merchant-restock behavior/data where possible.

### 12.1 Restock trigger invariant

Restock runs **only** on a true `away -> present` arrival.

It must not run because:

- a schedule boundary occurs while the character remained present;
- a save was loaded;
- `defer_departure` was used;
- travel completed between arrival opportunities;
- the character moved to the stock location;
- the model talked about restocking.

### 12.2 Restock is authored content

The generic engine knows only that an arrival hook of supported type `restock` exists.

It does not know the character's profession, story purpose, stock semantics, destination, or business motivation.

---

# Part G — Interaction with Timelapse and Existing Systems

## 13. Timelapse

Awayable presence must integrate with existing daytime/nighttime timelapse.

### Present character

While present, an awayable character participates normally until the boundary at which deterministic departure applies.

### Away character

While away:

- no local planner request;
- no local pathfinding;
- no local observations;
- no local maintenance that currently depends on local participation unless an existing generic maintenance contract explicitly says otherwise;
- no hidden off-map simulation is invented.

### Deferred departure

Timelapse never independently decides to defer.

The ordinary tick must have committed `defer_departure` before entering the relevant timelapse.

## 14. Existing departure-side settlement

Do not unnecessarily fold existing acquired-stock or other departure settlement into the new arrival-hook system.

Such behavior may remain a separate generic/narrow lifecycle attached to actual departure if that is the cleanest current architecture.

The new requirement is specifically:

> authored deterministic actions can be attached to a true return, with `restock` as the first supported arrival hook.

Avoid broad unrelated economy refactors.

---

# Part H — Save Migration

## 15. Migration from current saves

The new runtime lifecycle fields must migrate deterministically and model-free.

### 15.1 Legacy present awayable character

For an older save in which an authored awayable character is currently locally present but has no new awayable runtime state:

- preserve actual saved location/inventory/money/mind/etc.;
- initialize the nearest appropriate default planned departure according to the authored schedule and current canonical time;
- do not teleport the character;
- do not trigger arrival restock just because migration creates lifecycle state.

The goal is to let the next ordinary/coarse period behave naturally.

### 15.2 Legacy absent awayable character

For an older save in which an authored awayable character is absent:

- do not invent retroactive travel;
- treat required travel as already completed for migration purposes;
- keep the character away until the next valid authored regular arrival opportunity;
- do not immediately spawn the character between schedule opportunities.

### 15.3 Generic migration

The migration strategy must work for future awayable characters without story-specific branches keyed by character ID.

Authoring/default lifecycle data should drive generic initialization.

---

# Part I — Validation

## 16. Authored validation

Extend authored-world validation for awayable content.

Reject at least:

- invalid weekday names;
- invalid canonical phases;
- duplicate/invalid arrival opportunities where current conventions consider them malformed;
- non-positive/invalid travel period counts;
- unsupported departure-policy forms;
- invalid `onArrival` hook types;
- restock target inventory IDs that do not exist;
- restock item-definition references that do not exist;
- malformed quantity/range/probability rules;
- lifecycle references to topology/containers inconsistent with current world schema.

Do not execute arbitrary authored JS/functions.

## 17. Runtime validation

Canonical world validation should reject or safely repair impossible awayable state such as:

- present character with nonsensical travel-remaining state;
- away character with an active local sublocation inconsistent with existing presence-owner rules;
- malformed planned departure boundary;
- negative travel counters;
- lifecycle state referencing removed authored schedule data in a way current migration cannot reconcile.

Follow existing project principles: candidate validation before commit, no silent speculative world mutation.

---

# Part J — Required Engine Tests

## 18. Generic awayable engine tests

Add deterministic tests covering at least:

1. A generic awayable character can be present with a planned departure.
2. Reaching planned departure without defer makes the character away.
3. `defer_departure` shifts departure by exactly one coarse period.
4. Repeated ordinary-tick defers can extend a visit repeatedly.
5. `defer_departure` is not available when it would be a no-op.
6. `defer_departure` is available to HumanController when controlling an eligible awayable character.
7. The same action is available to AIController through normal `available_actions`.
8. Timelapse planners never receive/emit `defer_departure`.
9. Defer itself does not automatically create public speech/announcement.
10. Away characters are excluded from local ordinary/timelapse simulation through the existing presence rules.

## 19. Travel/arrival boundary tests

Cover exact coarse-time counting.

Mandatory case:

```text
depart Flamesday Evening
Night = 1
Flowday Day = 2
Flowday Night = 3
Woodsday Morning => eligible and arrives
```

Also test:

- fewer than 3 complete periods at Woodsday Morning => miss Woodsday;
- finishing travel after a missed Woodsday does not spawn immediately;
- next eligible arrival is the later authored opportunity;
- completed travel before an opportunity permits arrival;
- no off-by-one extra-period requirement.

## 20. Already-present schedule tests

Test that when an awayable character remains present across an authored arrival opportunity:

- no arrival transition fires;
- no restock fires;
- current stock/wallet/inventory remain whatever canonical play produced;
- no fake trip is recorded;
- no duplicate arrival effect occurs.

## 21. Arrival-hook tests

For generic `onArrival`:

- hook runs only on true `away -> present`;
- supported `restock` validates and executes deterministically;
- target container receives only authored valid stock;
- configured quantity/subset behavior is deterministic under injectable RNG where needed;
- sale-stock provenance remains correct;
- malformed hooks fail validation;
- unsupported hook type is rejected;
- load/migration does not accidentally fire the hook.

## 22. Migration tests

Cover at least:

- legacy save + present awayable character -> generic planned departure initialization;
- legacy save + absent awayable character -> travel treated complete; waits for next schedule window;
- no forced teleport;
- no migration-triggered restock;
- no loss of canonical saved inventory/money/mind/location state;
- future awayable test fixture migrates without character-specific code.

---

# Part K — Engine Documentation Consistency Pass

## 23. Scope

As part of the same implementation task, synchronize current authoritative documentation with already-shipped behavior discovered during review.

This pass is documentation-only except where generated/current data is the source of truth.

Do **not** globally rewrite historical terminology.

## 24. `AGENTS.md`

Update current shipped model defaults to:

```text
Character = DeepSeek V4 Flash
Utility   = DeepSeek V4 Flash
Narrator  = Euryale 3.3 70B Nitro
```

DeepSeek V4 Pro remains a supported Character alternative, not the shipped default.

Keep role selectors catalog-driven.

## 25. `README.md`

Correct current runtime statements:

- fresh world starts **Monday Evening**, not Monday Morning;
- initial weather is **non-blocking**;
- playable scene renders first;
- weather resolves asynchronously through the shared refresh/fallback mechanism;
- stale startup result must not overwrite a later simulation period.

Do not contradict current `docs/architecture.md` / `docs/status.md`.

## 26. `docs/engine/user-friendliness-patch.md`

This is a historical implementation spec and should not be silently rewritten as though its old decisions never existed.

Add an explicit supersession note for obsolete sections, especially:

- old Character = Pro default/recommended wording;
- old Flash = lower-cost-only framing;
- obsolete privacy sentence equivalent to "The game does not otherwise transmit your data."

Point readers to the later Mallowstead release-profile/current architecture documentation.

Preserve the historical body where useful.

## 27. `docs/architecture.md`

Remove or qualify stale public-world wording that presents Captain Price as if he were part of the current committed public authored world.

The correct current rule remains:

- committed public `data/world.json` does not author Captain Price;
- ignored private world may contain that experiment.

Private-profile notes may remain explicitly qualified as private.

## 28. Preserve POC history/compatibility

**Do not perform a global `POC -> MVP` replacement.**

Historical/technical POC references remain when they are semantically required, including:

- legacy save IDs such as `ai-rpg-framework-poc`;
- migration compatibility;
- historical spec/file names;
- references explaining earlier project states.

Current product/maturity prose should use Mallowstead/MVP where appropriate, but legacy compatibility identifiers must remain literal.

World-side documentation corrections are specified in `docs/world/maksym-awayable-schedule-arrival-restock.md`.

---

# Part L — Acceptance Criteria

## 29. Engine acceptance

Implementation is complete when:

1. Awayable-character behavior is reusable and contains no character/merchant-specific engine branches.
2. Canonical runtime state owns current departure/travel state.
3. `defer_departure` is a controller-agnostic ordinary formal action and is absent from timelapse planning.
4. Each defer shifts only the imminent planned departure by exactly one coarse period.
5. Actual departure starts generic authored travel-period counting.
6. Completing exactly N full periods makes the character eligible at the next authored arrival opportunity.
7. An arrival opportunity reached too early is missed, with no catch-up spawn.
8. Already-present characters do not receive a fake arrival or arrival hooks.
9. True arrival can invoke validated authored deterministic hooks.
10. `restock` is the first supported arrival hook and is driven entirely by authored stock data.

## 30. Migration/documentation acceptance

Implementation is complete when:

1. Current saves migrate without invented retroactive travel or forced position changes.
2. Present legacy awayable characters receive a sensible generic planned departure.
3. Absent legacy awayable characters are treated as travel-complete and wait for the next regular opportunity.
4. Migration never triggers restock by itself.
5. Current engine/project docs no longer contradict current Flash-default / Monday-Evening / non-blocking-weather / public-Price rules.
6. Historical POC compatibility references and legacy IDs remain intact.
7. World-side Maksym authoring satisfies the companion world specification.

---

## 31. Non-goals

This task does **not**:

- add character-specific engine branches;
- simulate off-map road encounters;
- add a generic economy/pricing system;
- force departure based on numeric thresholds;
- make trade stock equal to a whole personal inventory;
- let timelapse planners decide to defer departure;
- infer active stay decisions from memory/continuation;
- create delayed catch-up arrivals after a missed schedule opportunity;
- restock merely because a schedule weekday occurs while already present;
- make `defer_departure` a public announcement;
- redesign unrelated departure settlement unless required for clean integration;
- delete historical POC compatibility;
- globally rename old implementation-spec terminology.
