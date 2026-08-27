# Mallowstead — Triggered Authored Events, Food Service, and Activatable Characters

**Status:** Implementation specification  
**Scope:** Generic persistent proc events + objective prerequisite registry + activatable/deactivatable characters + location-locked movement + silent timelapse effects + reusable edible/serving mechanics  
**Target:** `docs/engine/`  
**Product:** Mallowstead  
**Baseline:** current `0.1.2d-secrets` codebase including authored secrets/random outcomes and the `read_aura` delivery fix  
**Depends on:** `docs/engine/authored-secrets-and-random-outcomes.md`

---

## 1. Purpose

Add the generic engine capabilities required for authored world events that may occur because objective world conditions remain true over time.

This is intentionally separate from the existing authored random-outcome tables.

The engine must support:

- authored **triggered events** checked at explicit simulation boundaries;
- a small validated registry of objective prerequisites rather than arbitrary authored expressions;
- one RNG roll per event definition per eligible ordinary tick, independent of how many matching items satisfy a prerequisite;
- generic activation/deactivation of authored characters while preserving canonical character state;
- generic character movement constraints such as being locked to one location;
- deterministic timelapse-boundary effects that may mutate canonical world state without entering narrator-visible event text;
- ordinary edible items using the existing item-consumption model;
- reusable tavern/fixture serving actions that turn an appropriate reusable dish into authored food;
- authored phase availability for serving actions.

The first authored consumer is `Chuhaister The Forest Man`, but no engine code may contain story-specific branches for Chuhaister, Trampled Glade, food offerings, sopilka music, Banush, or any secret ID.

---

# Part A — Architectural Boundary

## 2. Triggered events are not random outcome tables

Preserve the existing distinction:

```text
randomOutcomeTable
    explicit gameplay action/activity already occurred
    -> engine chooses one authored result

triggeredEvent
    simulation boundary occurs
    -> engine checks objective world prerequisites
    -> optionally rolls chance
    -> executes authored effects
```

Examples:

- Old Well `Raise the bucket` remains a `randomOutcomeTable` invocation.
- Hunting completion remains a `randomOutcomeTable` invocation.
- "While food remains at a place, each ordinary tick has a chance to activate a character" is a `triggeredEvent`.
- "At the next timelapse boundary, deactivate this character and silently consume matching ground items" is a `triggeredEvent`.

Do not merge the two systems into one universal rule language.

---

## 3. No story-specific engine logic

The engine may understand concepts such as:

```text
ordinary_tick
next_timelapse
phase_is
location_inventory_contains_tag
character_active / character_inactive
chance
activate_character
deactivate_character
consume_matching_items
emit_observation
```

It must not understand:

```text
Chuhaister
Forest Man
Trampled Glade
offering
Banush
summoning
secret forest spirit
```

The authored composition of generic capabilities creates the story mechanic.

---

# Part B — Generic Triggered Event Model

## 4. Authored registry

Add a validated top-level triggered-event registry conceptually shaped as:

```json
{
  "triggeredEvents": {
    "example": {
      "id": "example",
      "trigger": { "type": "ordinary_tick" },
      "prerequisites": [],
      "chance": 0.1,
      "effects": [],
      "narrationPolicy": "normal"
    }
  }
}
```

Exact schema names may follow current project conventions.

Triggered events may carry `secretId` and therefore participate in the existing build-time secret materialization/filtering system.

The complete authored source must validate before disabled-secret filtering, as with other secret-owned content.

---

## 5. Initial trigger types

Support only these trigger types in this version:

### 5.1 `ordinary_tick`

Evaluated exactly once for each completed ordinary gameplay tick/cycle.

A condition created by actions during the current ordinary tick must not receive a retroactive roll in that same tick. The first eligible roll is on the next ordinary tick.

Implementation may evaluate from the canonical world snapshot at tick start or use equivalent bookkeeping, but the observable invariant is required.

### 5.2 `timelapse_start`

Evaluated once when a daytime/nighttime timelapse is committed to begin, **before local timelapse planner requests are constructed**.

This ordering allows an authored character to disappear before timelapse participation and allows silent canonical cleanup to occur without creating hidden-character narrator events.

Do not add arbitrary cron/calendar expression support in this task.

---

## 6. Objective prerequisite registry

This version deliberately supports a small closed prerequisite registry rather than arbitrary JSON expressions or authored JavaScript.

Initial prerequisite types:

```text
phase_is
location_inventory_contains_tag
character_active
character_inactive
```

### 6.1 `phase_is`

Checks canonical current coarse phase.

Conceptual authoring:

```json
{ "type": "phase_is", "phase": "Evening" }
```

Validate against canonical phase names.

### 6.2 `location_inventory_contains_tag`

Checks whether the ordinary **location ground inventory** contains at least one item whose current item definition has a given tag.

Conceptual authoring:

```json
{
  "type": "location_inventory_contains_tag",
  "locationId": "someLocation",
  "tag": "edible",
  "minimum": 1
}
```

For this version `minimum` may default to `1` and need not provide quantity-based probability scaling.

Crucially, this prerequisite is boolean. Ten matching items still satisfy one prerequisite and do not imply ten RNG rolls.

This means ordinary `drop_item`, which places an item into the current location inventory, naturally participates without an offering-specific action.

### 6.3 `character_active` / `character_inactive`

Checks the canonical activation state of an authored activatable character.

No model memory or continuation is consulted.

---

## 7. Chance semantics

`chance` is optional:

```text
0 < chance <= 1
```

If omitted, the event is deterministic once prerequisites hold.

For an eligible `ordinary_tick` event:

1. evaluate all prerequisites;
2. if any fail, do nothing and do not roll;
3. if all pass, perform exactly **one** RNG roll for this event definition for this tick;
4. success executes the event effects atomically;
5. failure does nothing and the event may be eligible again next tick.

Matching object count never multiplies the number of checks unless a future explicit authored mechanic says so.

RNG must be injectable in tests.

### 7.1 Persistent chance

An event may remain eligible across many ordinary ticks.

There is no automatic `once` consumption merely because the event failed.

For example, `chance: 0.10` over ten eligible ticks means ten independent 10% opportunities.

Do not replace this with a cumulative hidden counter or guaranteed threshold.

---

## 8. Exactly-once-per-tick invariant

A triggered event must never roll twice for the same canonical ordinary tick because of:

- view refresh;
- UI rerender;
- save/load;
- retrying model output;
- multiple matching items;
- multiple characters looking at the same state.

Use explicit persisted or deterministic tick-boundary bookkeeping if the current engine lifecycle requires it.

Save/load during an eligible period must not create duplicate checks for an already processed tick.

---

# Part C — Triggered Event Effects

## 9. Effect registry boundary

Triggered events execute only registered validated effect types. No arbitrary JS/functions.

Existing generic authored effects may be reused where their audience/actor assumptions fit. This feature additionally requires:

```text
activate_character
deactivate_character
consume_matching_items
emit_observation
```

`emit_observation` may share implementation with the current authored-outcome observation effect but must support a world/location-scoped event without requiring an initiating actor.

All effects of one triggered event execute on a candidate world and commit atomically after validation.

---

## 10. `activate_character`

Conceptual authoring:

```json
{
  "type": "activate_character",
  "characterId": "someCharacter",
  "locationId": "someLocation",
  "sublocationId": "optionalSublocation"
}
```

Required semantics:

- if the character has never been activated in this save, instantiate its runtime canonical state from authored data;
- if it was previously deactivated, reuse the existing saved character state rather than rebuilding its mind;
- set canonical activation/presence state to active;
- place it at the authored destination;
- preserve any previously developed mind, inventory, wallet, relationships, memories, beliefs, and other canonical model-writable state;
- ordinary local simulation resumes for that character after activation.

Activation itself is engine state. It is not inferred from dialogue or memory.

### 10.1 Grounded discovery on visible appearance

If an activation is accompanied by an observable appearance in a location, characters who actually receive that grounded appearance through ordinary perception must discover a `requiresDiscovery` character individually.

Do not globally reveal the character.

A hidden character activating with nobody able to perceive it does not grant discovery to remote characters.

---

## 11. `deactivate_character`

Conceptual authoring:

```json
{
  "type": "deactivate_character",
  "characterId": "someCharacter"
}
```

Required semantics:

- remove the character from ordinary local topology/presence;
- exclude it from ordinary local action/reaction waves while inactive;
- exclude it from daytime/nighttime timelapse planners while inactive;
- preserve canonical mind, inventory, wallet, relationships, discovery consequences already created in other characters, and other character state;
- allow a later `activate_character` to restore the same continuing person.

Deactivation is not death, deletion, memory reset, or save removal.

An inactive discovery-gated character must not leak through ordinary player UI merely because its runtime state now exists.

---

## 12. `emit_observation`

Triggered-event observations are grounded world events.

Conceptual fields may include:

```json
{
  "type": "emit_observation",
  "locationId": "...",
  "text": "A sudden wind sweeps through the clearing."
}
```

Required semantics:

- deliver only through normal perception for characters who can perceive the authored event;
- do not directly write STM/LTM/beliefs;
- remote characters receive nothing;
- the event may be independently marked non-narratable for timelapse use, but an ordinary-tick observation is ordinarily delivered immediately.

---

## 13. `consume_matching_items`

Purpose: silently or visibly apply ordinary authored consumption semantics to a set of canonical items selected by objective location/tag criteria.

Conceptual authoring:

```json
{
  "type": "consume_matching_items",
  "source": {
    "type": "location_inventory",
    "locationId": "someLocation"
  },
  "itemTag": "edible",
  "mode": "all"
}
```

Required semantics:

- select matching items from the specified canonical inventory only;
- this version requires `mode: all` for the first consumer;
- apply each matched item's authored `consumeAction` result without inventing a consuming actor;
- if consumption transforms the item into reusable empty dishware, transform it **in the same source inventory**;
- do not move empty dishes into any character inventory;
- if a future supported consumable destroys itself rather than transforming, normal generic consume semantics may remove it;
- fail authored validation if an item tag is used in a context where matching current definitions cannot be consumed under the supported contract, unless the implementation explicitly filters non-consumable matches.

The effect itself does not imply observation or narration.

---

# Part D — Timelapse Visibility Discipline

## 14. `narrationPolicy`

Triggered events may explicitly declare:

```text
normal
none
```

This is not secrecy logic; it is event-delivery policy.

### `normal`

Eligible committed events may participate in existing public observation/narration systems according to their effect types.

### `none`

Canonical effects commit but:

- no public observation is generated solely from those effects;
- no timelapse event record is supplied to the narrator;
- no hidden actor name is exposed;
- no synthetic "something happened" narration is generated.

This allows canonical off-camera world mutation without pretending the player witnessed it.

### 14.1 Hidden characters and timelapse

If an authored `timelapse_start` event deactivates a character, the deactivation must occur before planner/narrator input is assembled.

The character therefore contributes no hidden timelapse actions and does not appear merely because it existed one tick earlier.

---

# Part E — Generic Movement Constraint

## 15. Location-locked characters

Add an authored movement constraint independent of secret membership:

```json
{
  "movementConstraint": {
    "type": "location_locked",
    "locationId": "someLocation"
  }
}
```

Required semantics:

- ordinary `move` actions leaving that location are not exposed in `available_actions`;
- validator rejects attempts to leave through formal action execution;
- `move_within_location` remains available where ordinary sublocation topology permits;
- other non-movement formal actions remain available normally;
- HumanController and AIController receive the same gating.

The engine does not know why the character is location-locked.

---

# Part F — Generic Edible Items

## 16. Reuse the existing consume contract

Food should use the existing canonical item `consumeAction` transformation model rather than a separate hunger system.

A filled food item is an ordinary item definition with:

```text
tags includes "edible"
consumable = true
consumeAction.resultType = transform
consumeAction.resultDefinitionId = reusable empty dish
```

No hunger, nutrition, buffs, spoilage, cooking ingredients, or satiety system is introduced.

### 16.1 Generic consume narration

The current consume implementation must not hard-code ale/drinking prose for every consumable.

Extend/normalize the consume contract so authored definitions can provide appropriate public action text, conceptually:

```json
{
  "consumeAction": {
    "actionLabel": "Eat the banush",
    "resultType": "transform",
    "resultDefinitionId": "emptyBowl",
    "feedbackText": "You eat the banush. The bowl is now empty.",
    "publicText": "{actorName} eats the banush."
  }
}
```

Existing ale behavior must remain correct through authored/default drink text rather than a food-specific special case.

---

# Part G — Generic Authored Serving

## 17. Purpose

Provide ordinary authored prepared-food service without simulating ingredients, recipes, kitchen stock, or cooking time.

A serving source is effectively unlimited authored prepared food for the currently authored phase; **reusable dishware is the finite canonical resource**.

---

## 18. Sublocation serving actions

Allow a sublocation to expose authored serving interactions conceptually shaped as:

```json
{
  "servingActions": [
    {
      "id": "serveExample",
      "actionLabel": "Serve example food",
      "phases": ["Evening"],
      "requiredDishDefinitionId": "emptyBowl",
      "resultDefinitionId": "bowlOfExampleFood",
      "aiDescription": "...",
      "aiPrerequisites": ["..."]
    }
  ]
}
```

Exact schema may follow current action conventions.

### 18.1 Formal action

Expose serving through normal `available_actions` to AIController and HumanController.

The formal action may conceptually be:

```json
{
  "type": "serve_food",
  "serving_action_id": "serveExample"
}
```

The engine may deterministically select one matching accessible empty dish instance from the current sublocation inventory, or include a concrete dish item ID in the formal contract if that better matches current item-action conventions.

Whichever representation is chosen must remain canonical and deterministic.

### 18.2 Effect

One successful serve:

1. requires the actor to be at the serving sublocation;
2. requires current phase to be in the authored `phases` list;
3. requires an accessible item with `requiredDishDefinitionId` in the authored local dish inventory/access scope;
4. transforms exactly one such reusable dish into `resultDefinitionId`;
5. transfers the resulting filled dish to the acting character's inventory;
6. emits grounded authored feedback/public action text.

No dish -> no available serve action.

Serving must never silently create a new bowl or plate.

### 18.3 Model Output Must Have Effect

A phase-inapplicable or dish-impossible serving action must not appear in `available_actions`.

The AI-facing description must state the required dish type explicitly so the model need not infer bowl-vs-plate conventions.

---

# Part H — Secret Ownership Expansion

## 19. New secret-ownable record types

Extend the existing authored secret schema/materializer to allow `secretId` on the new relevant records, including:

```text
triggeredEvents
abilities (when a secret-owned character ability is itself optional authored content)
movement/lifecycle authoring attached to secret-owned characters
```

A disabled secret removes its triggered events and secret-owned ability definitions along with the existing character/location/knowledge footprint.

Ordinary food/kitchen authoring does not need a `secretId` merely because one secret can make use of food.

---

# Part I — Validation

## 20. Authored validation

Reject at least:

- unknown trigger type;
- invalid trigger configuration;
- unknown prerequisite type;
- invalid phase;
- unknown location/character/item-tag references where references are explicit;
- invalid chance (`<=0`, `>1`, NaN/non-number);
- empty effect list;
- unsupported triggered-event effect type;
- invalid activation destination;
- `deactivate_character` target that is not a character;
- invalid movement constraint;
- serving action with nonexistent dish/result definitions;
- serving result that does not consume/return the expected reusable dish family under current item conventions;
- invalid phase lists;
- duplicate technical IDs;
- secret-owned triggered event/ability referencing a missing secret.

No arbitrary authored functions or expression evaluation.

---

## 21. Runtime validation

Reject/safely repair impossible runtime state such as:

- inactive character still occupying local topology;
- active activatable character with no valid location/sublocation;
- location-locked active character outside its authored lock location;
- duplicate/invalid per-tick triggered-event bookkeeping;
- malformed activation state;
- serving transformation that loses or duplicates the dish item instance.

Use candidate validation before commit.

---

# Part J — Required Tests

## 22. Triggered-event tests

Add deterministic tests covering:

1. `ordinary_tick` prerequisites are evaluated once per tick.
2. A prerequisite becoming true during a tick does not roll until the next tick.
3. A persistent 10% event can fail and become eligible again on the following tick.
4. Ten matching tagged items still cause one event roll, not ten.
5. Removing all matching items makes the event ineligible.
6. `character_inactive`/`character_active` prerequisites use canonical state.
7. Save/load cannot double-roll the same already-processed tick.
8. Failed candidate execution rolls back without partial mutation.
9. Injectable RNG covers success/failure boundaries.

---

## 23. Activation/deactivation tests

Cover:

- first activation creates/restores a valid runtime character;
- deactivation removes local presence;
- inactive character is excluded from local actions/reactions/timelapse;
- mind and inventory survive deactivate -> save/load -> activate;
- previously granted per-character discovery survives deactivation;
- visible appearance grants discovery only to actual perceivers;
- inactive discovery-gated characters do not leak into ordinary UI;
- `playerControllable:false` remains enforced after discovery/activation.

---

## 24. Movement-constraint tests

- location-locked character receives no outbound `move` actions;
- outbound execution attempt is rejected;
- within-location movement remains possible where topology allows;
- ordinary speech/item/ability actions remain available.

---

## 25. Food/consume tests

- edible filled dish is a normal canonical item;
- `consume` transforms it into authored empty dish;
- food public event says `eats`, not hard-coded ale/drinking text;
- ale still says `drinks` correctly;
- `edible` is only a tag/selection capability and does not add hunger state.

---

## 26. Serving tests

- phase-correct serving action is exposed only at the owning sublocation;
- wrong-phase menu is absent;
- required bowl/plate is explicitly represented in AI-facing action metadata;
- serving transforms one existing dish and moves it to actor inventory;
- no empty dish -> no serve action;
- returning the empty dish to the local cabinet makes it usable again;
- no dish creation/duplication occurs.

---

## 27. Silent timelapse tests

For a `timelapse_start` event with `narrationPolicy: none`:

- canonical effects commit;
- no public observation is emitted solely for the effect;
- no narrator-visible event record is created;
- deactivated character is absent from timelapse planner input;
- `consume_matching_items` transforms all matching ground food in place;
- empty reusable dishes remain in the source location inventory.

---

# Part K — Non-Goals

## 28. Explicit non-goals

This task does **not** add:

- hunger/satiety/nutrition;
- ingredient inventories or recipes;
- cooking skill or cooking timers;
- dirty/clean dish state or washing;
- food spoilage;
- quantity-scaled proc chances;
- a general boolean/rule expression language;
- arbitrary scripted event callbacks;
- forced emotional/behavioral state such as `mustDance`;
- a general combat/demon system;
- hidden/off-map Character simulation while inactive;
- narrator reconstruction of secret events that nobody observed.

---

# Part L — Acceptance Criteria

## 29. Engine acceptance

Implementation is complete when:

1. Triggered events are a generic system separate from action-bound random outcome tables.
2. `ordinary_tick` events perform at most one roll per event per eligible tick.
3. Objective prerequisites use a closed validated registry.
4. Activatable characters can disappear/reappear while preserving canonical mind/state.
5. Location-locked movement is enforced through normal action gating and validation.
6. Silent timelapse events can mutate canonical world state without narrator/UI leakage.
7. Generic edible items reuse the normal consume/transform contract with authored public text.
8. Generic phase-aware serving consumes existing reusable dishware rather than generating dishes.
9. All new secret-owned event/ability authoring is removed cleanly when its secret is disabled.
10. No engine branch names Chuhaister, Trampled Glade, Banush, or any Mallowstead-specific story concept.
