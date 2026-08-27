# Mallowstead — Presence, Triggered Events, Abilities, Editor, and Consistency Hardening

**Status:** Implementation specification  
**Scope:** Current-documentation consistency pass + generic local-presence boundary + activatable-character hardening + triggered-event tick/transaction optimization + shared authored effects + shared item-consumption primitive + generic ability action + editor completeness/reference integrity + migration/tests  
**Target:** `docs/engine/`  
**Product:** Mallowstead  
**Baseline:** current `0.1.2d-secrets` line including awayable Maksym, authored secrets/random outcomes, slab knowledge entries, `read_aura` delivery fix, tavern food, triggered authored events, and Chuhaister activation/deactivation lifecycle  
**Supersedes/clarifies:** current implementation details in the awayable, secrets/random-outcomes, and triggered-events specs where this document explicitly defines a later generic boundary. Historical specs remain historical and should not be globally rewritten.

---

## 1. Purpose

The recent awayable/secrets/triggered-event work introduced several correct capabilities through historically convenient integration points. This pass hardens the architecture before additional secret modules and detective content are added.

The goals are:

- synchronize authoritative current documentation with shipped behavior;
- separate **character activation state** from **local presence**;
- remove the generic presence predicate from the historically narrow `WeeklyRhythm` namespace;
- fully materialize inactive/deferred authored characters at world creation while keeping them off-map and hidden;
- make triggered-event checks cheap when no event will mutate the world while preserving the project-wide transactional mutation pattern when an event really fires;
- establish one canonical ordinary `tickId` owned by turn flow;
- reuse one deterministic authored observation effect across independent authored-event mechanisms;
- derive secret-character discovery from actual grounded perception recipients rather than a parallel location scan;
- extract one deterministic item-consumption primitive shared by ordinary `consume` and silent authored consumption;
- replace one-action-per-ability assumptions with a generic `use_ability { ability_id }` formal action;
- bring the offline editor up to the project's authored-feature completeness invariant instead of weakening that invariant;
- preserve current gameplay behavior unless explicitly changed below.

This is a **hardening/refactor task**, not a new content feature.

---

# Part A — Project-Wide Invariants

## 2. Canonical world mutations remain transactional

Preserve the existing project pattern for mutations of canonical world state:

```text
validate request / prerequisites
    -> take world snapshot
    -> apply deterministic mutation(s)
    -> validate candidate canonical world
    -> commit on success
    -> rollback snapshot on failure
```

This pattern remains intentionally conservative.

Do **not** remove world snapshots from ordinary formal actions or from triggered events that are actually about to mutate canonical state merely for optimization.

The optimization required by this specification is narrower:

> A triggered event that does not satisfy its prerequisites, or whose chance roll misses, must not clone the world because no canonical mutation is being attempted.

---

## 3. State change does not imply player-visible narration

Preserve and document the distinction:

```text
canonical world mutation != automatic observation != automatic narration
```

Examples already required by authored content:

- Chuhaister may deactivate at timelapse start without appearing in timelapse narration;
- food may be silently consumed from Trampled Glade while no eligible observer is present;
- an authored effect may mutate state without creating a player-visible event unless its authoring explicitly emits grounded perception/presentation.

Do not add a generic rule that every mutation must be narrated.

---

## 4. Secret membership is authoring/build metadata

`secretId` remains an authored-content ownership relation.

After enabled-secret materialization, ordinary runtime systems should operate on ordinary characters, locations, items, actions, abilities, events, and inventories. They should not repeatedly branch on story-specific secret IDs.

`secretId` by itself still does **not** imply hidden state.

---

# Part B — Current Documentation Consistency

## 5. `docs/status.md`

Update current-status prose to the actual shipped Chuhaister behavior.

It must no longer describe Chuhaister as only a reserved/deferred placeholder with no appearance/schedule mechanics.

Current status should state at least that:

- `Chuhaister The Forest Man` is authored as a secret-owned activatable Character;
- Evening edible food on Trampled Glade enables a persistent 10%-per-ordinary-tick appearance proc;
- successful appearance is grounded by the wind/appearance event and reveals the concrete character only to actual perceivers;
- while locally present, Chuhaister is locked to Trampled Glade and participates as an ordinary AI Character there;
- `Play sopilka` is an authored ability;
- Chuhaister deactivates at the next timelapse boundary while preserving canonical mind/state;
- remaining ground food at the glade may be silently consumed at that boundary according to current authoring.

Do not rewrite unrelated historical status notes.

---

## 6. `data/world-lore.md`

Synchronize the human continuity document with current authored world facts.

Use canonical player-facing spelling/name:

```text
Chuhaister The Forest Man
```

Update stale `Chugaister` current-world references where they purport to describe the present authored world. Historical aliases/keywords may remain where explicitly relevant to search compatibility.

The continuity document may summarize the currently authored glade/food/appearance behavior, but it remains human documentation and must not become runtime truth.

---

## 7. `docs/architecture.md`

Add/refresh current architectural documentation for:

- `Presence` as the canonical local-participation facade;
- activation state versus local presence;
- awayable lifecycle versus activation lifecycle;
- triggered authored events versus action-bound random outcome tables;
- transactional mutation only after a real triggered-event proc;
- `tickId` ownership;
- shared authored deterministic effects;
- silent timelapse effects/presentation separation;
- fully materialized inactive characters;
- generic `use_ability` dispatch;
- shared item-consumption primitive.

Do not erase historical POC compatibility identifiers or old implementation-spec history.

---

# Part C — Activation State and Local Presence

## 8. Separate concepts

Treat these as different axes:

### 8.1 Character activation

Activation answers:

> Is this authored Character currently activated as a locally placeable/encounterable actor at all?

Canonical values for activatable characters:

```text
active
inactive
```

Chuhaister between appearances is `inactive`.

### 8.2 Local presence

Local presence answers:

> Does this Character currently participate in the local simulated world at a valid local position?

A character can be activation-`active` but not locally present.

Example:

```text
Maksym travelling away:
activation = active
local presence = false
```

Example:

```text
Chuhaister between appearances:
activation = inactive
local presence = false
```

These must not be treated as equivalent states.

---

## 9. New generic Presence facade

Introduce a neutral generic boundary conceptually named:

```js
Presence.isLocallyPresent(character, world)
```

Exact module/file naming may follow project conventions.

All generic consumers that currently ask whether a Character participates locally should route through this facade rather than calling a weekly-merchant-specific helper directly.

Relevant consumers include at least:

- perception/event delivery;
- local target/addressee enumeration;
- local action availability;
- AI turn participation;
- timelapse participant selection;
- pathfinding/local movement eligibility;
- user-facing local character lists;
- any other current usage of the old genericized `WeeklyRhythm.isCharacterPresent()` concept.

### 9.1 Presence composition

The facade should compose existing objective lifecycle systems.

At minimum:

- `activationState === inactive` => not locally present;
- awayable runtime state saying the character is away => not locally present;
- legacy/simple fixed presence content remains supported according to its existing semantics;
- otherwise the character must have a valid local placement consistent with current topology/runtime rules.

Do not infer presence from model memory, dialogue, beliefs, continuation, or prose.

---

## 10. `WeeklyRhythm` responsibility after extraction

`WeeklyRhythm` (or its current equivalent) should remain responsible for calendar/schedule mechanics such as:

- weekday/calendar helpers;
- arrival opportunities;
- planned departure;
- travel-period accounting;
- fixed weekly authored schedules where still used.

It should no longer be the public generic namespace for the question "is this arbitrary Character locally present?"

Keep compatibility wrappers temporarily if useful during the refactor, but new engine code should depend on `Presence`.

---

## 11. Triggered-event prerequisite semantics

Replace ambiguous new authoring with explicit concepts.

Canonical prerequisite form for activation:

```json
{
  "type": "character_activation_is",
  "characterId": "...",
  "value": "inactive"
}
```

or:

```json
{
  "type": "character_activation_is",
  "characterId": "...",
  "value": "active"
}
```

Canonical prerequisite for local participation:

```json
{
  "type": "character_locally_present",
  "characterId": "...",
  "value": true
}
```

`value` may default to `true` if current schema conventions favor that style, but semantics must remain explicit.

The old `character_active` / `character_inactive` prerequisite spellings introduced by the first triggered-event implementation may remain accepted as deterministic compatibility aliases for existing saves/world payloads, but current generated/authored data should normalize to `character_activation_is`.

A travelling Maksym must not satisfy `character_activation_is = inactive` merely because he is not locally present.

---

# Part D — Fully Materialized Inactive Characters

## 12. Materialize at world creation

An authored Character marked for inactive/deferred activation must still be **fully materialized in canonical runtime state at world creation/migration**.

This includes the same ordinary persistent identity/state that other characters receive, including as applicable:

- canonical Character runtime record;
- mind state;
- inventory record and authored initial inventory contents;
- wallet/money state;
- ability references;
- personality/AI state;
- any other normal persistent Character-owned data.

Do not postpone inventory or mind construction until first appearance.

### 12.1 Off-map state

Inactive means the character does not occupy local topology and is not locally present.

The exact current representation may use null/absent local placement fields according to project conventions, but validators and generic view/action code must treat this as a valid inactive state rather than throwing on a null sublocation.

---

## 13. Inactive UI/privacy invariant

An inactive Character must be hidden from normal player-facing character discovery surfaces unless an existing surface intentionally represents previously discovered but currently absent characters.

At minimum inactive, undiscovered secret characters must not leak through:

- playable-character selection;
- HumanController switching;
- addressee dropdowns;
- give/take/trade target lists;
- local scene character lists;
- ordinary Elsewhere/local-presence summaries;
- action target enumeration;
- other normal user-facing entity selectors.

`playerControllable: false` remains a separate permanent restriction and is not replaced by activation state.

Diagnostics/emergency dumps may retain the canonical inactive state for debugging; normal gameplay UI must not reveal it.

---

# Part E — Canonical Ordinary Tick Identity

## 14. `tickId` ownership

Introduce one canonical monotonically increasing ordinary tick identifier conceptually named:

```text
tickId
```

It belongs to the ordinary turn/tick lifecycle, **not** to `TriggeredEvents`.

`TriggeredEvents` must not invent/increment its own independent ordinary-tick counter.

### 14.1 Exactly-once rule

One logical ordinary tick receives exactly one `tickId`.

The ID must not change because of:

- UI rerender/view refresh;
- model retry/repair within the same logical turn;
- presentation regeneration;
- multiple triggered-event definitions;
- multiple matching items;
- multiple observers.

The tick identity/bookkeeping needed to prevent reprocessing must survive save/load according to current save semantics.

### 14.2 Triggered-event processing

Ordinary-tick triggered events are processed at most once for a given `tickId`.

Use the central turn flow plus a small persisted/runtime processed-tick guard if needed. Do not use a self-incrementing event-system counter as a substitute for logical tick identity.

Preserve the existing observable rule from the triggered-event spec:

> A prerequisite condition created during the current ordinary tick does not receive a retroactive chance roll in that same tick; its first eligible roll is the next ordinary tick.

---

# Part F — Triggered Event Fast Path and Transactions

## 15. No clone before an event can occur

Refactor ordinary triggered-event processing to follow this order:

```text
read canonical world
    -> evaluate trigger/prerequisites read-only
    -> prerequisite failure: exit, no clone
    -> if chance exists, perform one RNG roll
    -> RNG miss: exit, no clone
    -> event will attempt effects
    -> snapshot/clone canonical world
    -> apply deterministic effects
    -> validate canonical candidate
    -> commit or rollback
```

This preserves the same conservative transactional mutation pattern as ordinary formal actions while removing deep copies from the no-op hot path.

### 15.1 Multiple events

If several triggered events truly fire at one boundary, implementation may either:

- transact them one by one in deterministic authored order; or
- validate/apply a single deterministic batch candidate;

provided failure semantics are deterministic and tests cover them.

Prefer the smaller change consistent with the current implementation.

Do not clone merely to evaluate prerequisites.

---

## 16. RNG behavior

Continue using injectable deterministic RNG for tests.

One eligible event definition gets one chance roll per eligible `tickId`, regardless of the number of matching prerequisite items, unless a future authored mechanic explicitly defines otherwise.

A failed prerequisite performs no RNG roll.

A failed transactional effect application must not cause uncontrolled repeated rerolls within the same logical tick.

---

# Part G — Shared Authored Deterministic Effects

## 17. Keep invocation mechanisms separate

Do **not** merge:

```text
randomOutcomeTable
triggeredEvents
```

They represent different causal models and remain separate engine mechanisms.

This task extracts only deterministic effect implementations that are semantically the same in both mechanisms.

---

## 18. Common authored-effect executor/registry

Introduce a small generic deterministic authored-effect boundary conceptually named:

```text
AuthoredEffects
```

or equivalent project-convention name.

It must:

- validate only registered effect types;
- execute deterministic engine-owned primitives;
- never execute arbitrary authored JavaScript;
- allow each calling mechanism to whitelist only the effect types it supports;
- return structured result information needed by the caller, including actual perception recipients where applicable.

### 18.1 Mandatory first shared effect: `emit_observation`

At minimum, remove duplicate implementations of authored grounded observation emission.

`emit_observation` must route through the existing perception system and return the actual recipient Character IDs (or equivalent structured recipient result) produced by perception routing.

Do not determine recipients with a second parallel "same location" scan.

### 18.2 Other effects

Other effects may be moved into the shared registry during implementation **only where their semantics are genuinely identical** across callers.

Do not force unrelated or caller-specific operations into a generic abstraction merely for symmetry.

---

# Part H — Secret Character Discovery from Perception

## 19. Grounded recipient invariant

Concrete discovery of a hidden/secret Character must be granted only to Characters who actually receive the grounded appearance/perception event that reveals that Character.

Required flow:

```text
activate / reveal appearance
    -> emit grounded appearance observation through normal perception
    -> obtain actual recipients
    -> grant discoveredCharacterId only to those recipients
```

Do not independently grant discovery to every present Character sharing a broad location ID.

This must remain correct if future topology/perception adds walls, sublocation visibility restrictions, deafness/blindness rules, distance rules, or other routing distinctions.

Hearing lore, reading a tablet article, or hearing another Character describe Chuhaister still does not discover the concrete Character entity unless a separate authored mechanic explicitly says so.

---

# Part I — Shared Item Consumption Primitive

## 20. Extract `applyItemConsume()`

Create one deterministic canonical-state primitive conceptually named:

```js
applyItemConsume(...)
```

Exact signature may follow current project conventions.

It owns **only canonical item-consumption mutation**, including current reusable-container/transform behavior.

Examples:

```text
Bowl of banush -> Empty bowl
Plate of syrnyky -> Empty plate
filled mug -> Empty mug / current authored transform
consumable-without-container -> removed according to current item semantics
```

The primitive must return structured information about what changed.

It must **not** inherently emit speech, observations, or narration.

### 20.1 Callers

Use the same primitive from at least:

- ordinary formal `consume` / eat/drink execution;
- silent authored `consume_matching_items` used by timelapse/secret effects.

The ordinary action caller may emit grounded consumption observations.

The silent authored caller may intentionally emit none.

This preserves the invariant that identical item state transitions do not have two drifting implementations.

---

# Part J — Generic Ability Formal Action

## 21. Replace one-formal-action-per-ability assumptions

Introduce/standardize one controller-agnostic formal action:

```json
{
  "type": "use_ability",
  "ability_id": "..."
}
```

Exact field casing follows current action-schema conventions.

This action must be available through the same canonical `available_actions` path to HumanController and AIController when an owned ability is currently usable.

### 21.1 Ability definitions remain registered/validated

An authored ability may identify a registered engine ability implementation/effect type. Do not allow arbitrary authored code.

Current abilities such as:

```text
readAura
playSopilka
```

should remain authored ability identities but dispatch through `use_ability` rather than relying on the assumption that there can be only one ability of a given generic action type.

### 21.2 AI-facing action grounding

`available_actions` must expose enough structured information for the model to choose a valid `ability_id`, including the actual ability-specific label/description/prerequisites.

The model should conceptually see choices equivalent to:

```text
Use ability: Read aura
Use ability: Play sopilka
```

while the formal contract remains:

```json
{ "type": "use_ability", "ability_id": "readAura" }
```

### 21.3 Human UI

Human-facing controls should display the authored ability label, not a generic unlabeled `Use ability` button when a more specific label is available.

### 21.4 Compatibility

Update current world authoring/tests to the canonical action.

If existing saves/action logs require compatibility with old specific action spellings such as `read_aura`/`play_sopilka`, use narrow deterministic compatibility normalization rather than preserving duplicate long-term action systems.

---

# Part K — Offline Editor Completeness

## 22. Preserve the editor invariant

Do **not** weaken the current project invariant that authored runtime concepts must be represented in the offline world editor.

When the engine/world schema gains an authored entity or relation, the editor is part of the implementation task.

The answer is to extend the editor, not to document that authors should hand-edit hidden JSON indefinitely.

---

## 23. Required editor coverage in this pass

Extend the editor so current authored data can be inspected and edited without silently losing new fields.

At minimum cover:

### 23.1 Secrets

- secret registry entries;
- `enabled` state/default authored configuration;
- `secretId` ownership on supported entities;
- clear distinction between secret ownership and hidden/discovery settings.

### 23.2 Random outcome tables

- table IDs;
- weighted outcomes;
- `once` behavior;
- registered effects and their typed parameters;
- references to locations/items/characters.

### 23.3 Triggered events

- event ID;
- `secretId`;
- trigger type;
- canonical prerequisites including `character_activation_is` and `character_locally_present`;
- chance;
- registered effect list;
- timelapse/ordinary trigger semantics required by current schema.

### 23.4 Character lifecycle/visibility

- activation/deferred/inactive authored defaults;
- `playerControllable`;
- movement/location-lock constraints;
- abilities/ability IDs;
- awayable schedule data where already supported by authored schema.

### 23.5 Food/item mechanics

- item tags such as `edible`;
- consume/transform target definitions;
- reusable dish relationships;
- phase-aware `serve_food` authored configuration and dish requirements.

`serve_food` remains its own formal action in this pass; do not refactor it into a generic crafting system.

---

## 24. Editor reference integrity

Update editor deletion/reference checks so they understand the new relations rather than only older fields such as legacy hunting discovery links.

Deletion or ID rename workflows must detect relevant references from at least:

- `secretId` ownership;
- triggered-event prerequisites/effects;
- random-outcome effects;
- ability IDs;
- character IDs;
- location/sublocation IDs;
- inventory/container IDs;
- item-definition IDs;
- consume transforms;
- serving definitions;
- movement/location constraints;
- awayable arrival/hook references where already present.

Prefer one reusable editor-side reference graph/index rather than adding a new hard-coded deletion check for every feature.

The runtime/world validator remains authoritative; editor checks improve authoring safety and UX rather than replacing validation.

---

# Part L — Migration and Runtime Validation

## 25. Existing save migration

Migration must remain deterministic and model-free.

### 25.1 Missing newly materialized inactive Character

For a legacy save created before full materialization of a deferred/inactive authored Character:

- instantiate the missing canonical Character state from authored defaults;
- create its inventory/mind/runtime identity immediately;
- set it to the authored inactive/off-map state;
- do not reveal/discover it merely because migration materialized it;
- do not run appearance events or other authored proc effects during migration.

### 25.2 Existing Chuhaister state

If a save already contains Chuhaister state from the current implementation:

- preserve mind, beliefs, STM/LTM, dialogue continuity, inventory, discovery state, and activation state as applicable;
- do not recreate or duplicate inventory/items;
- do not reactivate him merely because a new canonical representation is loaded.

### 25.3 Trigger prerequisite compatibility

Normalize legacy `character_active` / `character_inactive` authored/runtime trigger definitions to the new activation-specific semantics or continue to accept them as compatibility aliases.

Do not reinterpret them as local-presence checks.

---

## 26. Runtime validation

Extend runtime validation to reject or safely migrate malformed combinations without inventing story state.

Cover at least:

- malformed activation state;
- inactive character occupying an active local topology slot where current conventions prohibit it;
- active locally present character with invalid local placement;
- missing canonical inventory/mind for a fully materialized inactive Character;
- malformed `tickId` / processed-tick bookkeeping;
- triggered prerequisite references to nonexistent characters/locations;
- `use_ability` references to an ability not owned/available to the actor;
- consume transforms to nonexistent item definitions;
- editor/world data using unsupported authored effect types.

Do not couple activation validation to Maksym-specific awayable semantics or Chuhaister-specific story logic.

---

# Part M — Required Tests

## 27. Documentation/build consistency tests

Where current project tests assert version/current documentation invariants, update them to the new current facts.

At minimum ensure current docs no longer claim Chuhaister has no implemented activation lifecycle.

Historical specs are not required to be text-rewritten.

---

## 28. Presence tests

Add deterministic tests proving:

1. a normal active local Character is locally present;
2. an activation-`inactive` Character is not locally present;
3. an awayable travelling Maksym is activation-`active` but not locally present;
4. `character_activation_is: inactive` matches Chuhaister between appearances but not travelling Maksym;
5. `character_locally_present: false` can match both for the correct separate reason;
6. perception/AI/timelapse/targeting use the new Presence facade rather than direct weekly-specific presence logic;
7. inactive undiscovered characters do not leak into normal user-facing selectors.

---

## 29. Materialization tests

Cover a generic inactive authored Character fixture that is **not Chuhaister**:

1. runtime Character record exists immediately;
2. initial mind exists;
3. initial inventory exists and contains authored starting items;
4. character is off-map/not locally present;
5. activation makes the same canonical Character locally placeable without recreating mind/inventory;
6. deactivate/reactivate preserves item instance identity and mind state;
7. save/load while inactive preserves all state;
8. no normal UI leaks the undiscovered inactive fixture.

This test prevents future story-specific implementation.

---

## 30. Triggered-event/tick tests

Cover:

1. failed prerequisites cause no RNG call and no world clone;
2. eligible chance miss causes exactly one RNG call and no world clone;
3. chance hit takes a transactional snapshot before mutation;
4. failed post-mutation world validation rolls back effects;
5. one logical ordinary tick uses one canonical `tickId`;
6. rerender/retry does not process the same triggered event twice for one `tickId`;
7. save/load does not duplicate an already processed tick;
8. multiple matching food items still create one chance roll for the event definition;
9. condition created during a tick first becomes eligible on the next tick.

Tests may instrument the clone/snapshot helper to verify the no-clone fast path.

---

## 31. Shared authored observation tests

Prove that both:

```text
randomOutcomeTable -> emit_observation
triggeredEvent -> emit_observation
```

use the same shared deterministic effect implementation/perception route.

Cover actual recipient return values.

Add a topology/perception fixture where two characters share a broader location context but only one is an actual perception recipient; only that recipient may receive secret-character discovery.

---

## 32. Consumption tests

Cover one shared `applyItemConsume()` behavior from both ordinary and silent callers:

- ordinary `eat` of `Bowl of banush` -> same bowl instance becomes `Empty bowl` and ordinary grounded consumption feedback is emitted by the caller;
- silent timelapse authored consumption of the same item -> same canonical transform but no observation/narration;
- plate transform behaves similarly;
- a consumable without reusable container follows current remove/consume semantics;
- invalid transform target is rejected before/at candidate validation with rollback.

---

## 33. Ability tests

Cover:

1. `use_ability` requires an owned available ability ID;
2. HumanController sees ability-specific labels;
3. AI `available_actions` exposes specific ability IDs/descriptions;
4. Mara `readAura` executes through `use_ability` and still delivers full private aura text into pending observation/verbatim mind path;
5. Chuhaister `playSopilka` executes through `use_ability` and emits the current public grounded music/urge-to-dance observation;
6. two abilities using the same generic engine ability/effect family remain unambiguous because selection is by `ability_id`;
7. invalid/unowned ability IDs are rejected without mutation.

---

## 34. Editor tests

Add/update editor tests proving at least:

- current `world.json` imports and exports without losing secrets, random outcomes, triggered events, activation/mobility, abilities, food tags/transforms, or serving configuration;
- secret ownership is visible/editable without automatically forcing hidden state;
- triggered-event prerequisite/effect references are editable through structured controls;
- deletion of referenced characters/items/locations is blocked or explicitly surfaced with dependency information;
- current Chuhaister and Old Well authored content survives editor round-trip;
- current tavern Kitchen/Dish Cabinet/menu data survives editor round-trip.

---

## 35. Migration tests

Cover:

- legacy save missing newly materialized inactive generic Character -> added inactive with authored starting state;
- legacy save where Chuhaister was already encountered -> mind/discovery preserved;
- save where Chuhaister is inactive between appearances -> remains inactive after load;
- migration does not run triggered events, consume food, or reveal secret entities;
- old trigger prerequisite aliases normalize without changing meaning.

---

# Part N — Non-Goals

## 36. Explicit non-goals

This task does **not**:

- change the 10% Chuhaister appearance probability;
- change the rule that item quantity does not multiply that roll;
- add forced dancing or a dance mechanic;
- redesign timelapse narration discipline generally;
- merge triggered events with random outcome tables;
- turn authored effects into arbitrary scripting;
- turn `serve_food` into a generic crafting/recipe framework;
- add hunger, nutrition, dirty dishes, or cooking ingredients;
- change Maksym's awayable authored schedule/business logic;
- merge activation and awayable state into one lifecycle concept;
- make inactive characters globally "undiscovered" if a character previously encountered them;
- delete historical specs or globally rewrite old terminology;
- perform broad architecture cleanup unrelated to the concrete issues listed here.

After this hardening pass, prefer returning to world/detective content rather than continuing speculative refactoring without a second real use case.

---

# Part O — Acceptance Criteria

## 37. Architecture acceptance

Implementation is complete when:

1. `Presence` is the generic local-participation boundary and generic systems no longer depend on a weekly-merchant namespace for presence.
2. Character activation and local presence are independently represented and queried.
3. Inactive/deferred authored characters are fully materialized, including inventory/mind, while remaining off-map and hidden from normal UI.
4. Travelling Maksym remains activation-active but locally absent.
5. Triggered-event prerequisites use explicit activation/local-presence semantics.
6. Triggered-event no-op checks perform no deep world clone; a real proc still uses transactional snapshot/mutate/validate/rollback.
7. Ordinary logical ticks have one canonical `tickId` owned by turn flow.
8. Random outcome tables and triggered events remain separate mechanisms.
9. Authored grounded observation emission uses one shared deterministic effect implementation.
10. Secret-character discovery is granted from actual grounded perception recipients rather than a parallel broad location scan.
11. Ordinary and silent item consumption share one canonical mutation primitive.
12. Abilities dispatch through `use_ability { ability_id }` without one-ability-per-action-type assumptions.
13. The offline editor can inspect/edit/round-trip the current authored feature set and understands its references.
14. Existing saves migrate model-free without revealing or duplicating inactive secret characters.

## 38. Documentation acceptance

Implementation is complete when current authoritative documentation no longer contradicts shipped behavior:

- `docs/status.md` describes the implemented Chuhaister lifecycle;
- `data/world-lore.md` uses current canonical `Chuhaister The Forest Man` continuity wording;
- `docs/architecture.md` documents Presence, activation/local-presence separation, triggered-event fast-path transactions, `tickId`, shared authored effects, silent mutation/presentation separation, materialized inactive characters, shared consumption, and generic ability dispatch;
- historical implementation specs remain preserved as historical records except for explicit supersession notes where useful.

## 39. Regression acceptance

The full existing test suite plus the new hardening/editor/migration tests must pass.

Public/private build profiles must still build successfully, and disabled-secret materialization must continue to remove secret-owned authored content without removing ordinary tavern Kitchen/food infrastructure.
