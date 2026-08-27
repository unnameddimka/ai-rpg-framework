# Mallowstead — Authored Secrets, Per-Character Discovery, and Random Outcomes

**Status:** Implementation specification  
**Scope:** Generic authored secret modules + build-time filtering + per-character discovery for hidden characters + generic authored random outcome tables + environment interactions + first deterministic outcome effects  
**Target:** `docs/engine/`  
**Product:** Mallowstead  
**Baseline:** current `0.1.2c-maksym` codebase with authored abstract-study knowledge entries

---

## 1. Purpose

Add a reusable authoring layer for optional mystery content without mixing objective hidden world authoring into character cognition.

The engine must support:

- named authored **secrets** that can be enabled or disabled when producing a world/build;
- ordinary world records that may belong to a secret through `secretId`;
- secret-owned content that may be either hidden or openly visible;
- per-character discovery of hidden locations and hidden characters;
- characters that can never be assigned to the HumanController;
- generic authored weighted random outcome tables;
- one-shot and repeatable random outcomes;
- deterministic, validated engine-side effects from those outcomes;
- reuse of the same outcome system by ordinary gameplay systems such as hunting and environmental interactions.

The first authored consumers are:

- the **Chugaister** mystery, including the existing Trampled Glade, Mara's initial knowledge of that clearing, the Chugaister tablet article, and the existing random hunting discovery;
- the **Old Well** mystery, whose well is openly present at the Village Edge and whose bucket produces repeatable random results.

The engine implementation must not contain story-specific branches for Chugaister, the Old Well, hunting, wells, villagers, Maksym, or any particular secret ID.

---

# Part A — Architectural Boundary

## 2. Secrets are world authoring, not character mind

A secret is objective authoring metadata describing optional world content.

It is **not**:

- STM;
- LTM;
- a belief;
- a known fact;
- dialogue context;
- a quest state;
- a model continuation;
- a global `secretDiscovered` flag.

A character learns about secret-owned content only through ordinary initial authored knowledge, grounded perception, conversation, memory, or other existing cognition paths.

The intended separation is:

```text
Authored world
├── ordinary world content
├── lore / reference material
└── optional secret-owned content

Character mind
├── known facts seeded for this character
├── observations
├── STM / LTM
├── beliefs
└── relationships/dialogue state
```

No mechanism should continuously synchronize a secret's author description into character minds.

---

## 3. Secret membership is not visibility

`secretId` means only:

> this authored record belongs to this optional secret module.

It does **not** mean:

- hidden from the player;
- undiscovered;
- supernatural;
- inaccessible;
- known only to one NPC.

A secret may own content that is visible from the start.

The Old Well is the acceptance example: the well belongs to the `old_well` secret but is an ordinary visible place at the Village Edge when that secret is enabled.

Visibility/discovery must be expressed independently with the relevant authored capability, such as `requiresDiscovery`.

---

# Part B — Authored Secret Registry

## 4. Top-level registry

Add a top-level authored registry conceptually shaped as:

```json
{
  "secrets": {
    "chugaister": {
      "id": "chugaister",
      "enabled": true,
      "name": "Chugaister"
    },
    "old_well": {
      "id": "old_well",
      "enabled": true,
      "name": "Old Well"
    }
  }
}
```

Exact field placement may follow current world-schema conventions, but the semantics are required.

### 4.1 Registry data is author-facing

`name` and any future author notes are authoring metadata.

They must not automatically become:

- model context;
- UI labels;
- player knowledge;
- character knowledge.

The secret ID itself must not be used as a gameplay clue.

---

## 5. `secretId` on authored records

Supported authored records may optionally contain:

```json
{
  "secretId": "chugaister"
}
```

The implementation should add support only at explicitly validated schema locations rather than recursively accepting `secretId` on arbitrary JSON.

The first required secret-ownable record types are:

- locations;
- sublocations;
- characters;
- item definitions;
- authored item instances where needed;
- initial `knownFacts` entries;
- initial relationship/mind records where later required;
- abstract-study `knowledgeEntries`;
- day activities or their random outcomes;
- environment interactions;
- random outcome tables and individual outcomes/effects where appropriate.

A child record may inherit practical removal from a secret-owned parent, but inheritance must not be used to infer hidden/discovery semantics.

---

# Part C — Build-Time Secret Materialization

## 6. Preferred boundary

Secret enable/disable should be resolved while generating the active world, preferably in the existing world-generation/build path before `src/generated/world-data.js` is emitted.

Conceptual flow:

```text
data/world.json
    ↓
validate complete authored source
    ↓
materialize enabled-secret world
    ↓
validate materialized world
    ↓
generate runtime world data
```

The complete authored source must be validated **before filtering**, including disabled secrets, so a disabled secret does not become a place to hide broken authoring.

---

## 7. Disabled secret filtering

When a secret is disabled, records whose `secretId` refers to it are removed from the materialized world.

The materializer must also prune references that are mechanically derived from removed records where pruning is unambiguous, including at least:

- exits whose destination location was removed;
- reachable-sublocation IDs whose sublocation was removed;
- `initialDiscoveredLocationIds` entries whose location was removed;
- secret-owned tablet knowledge entries;
- secret-owned initial known-fact records;
- secret-owned random outcomes;
- secret-owned environment interactions;
- protected-ID lists for removed secret-owned entities if such an entry is explicitly allowed by current authoring;
- other generated indexes whose source entity has been removed.

Do **not** silently repair arbitrary dangling story references. After filtering, the normal authored validator must reject non-prunable references to removed entities.

Example: a non-secret relationship targeting a removed secret character is an authoring error unless that relationship record itself is secret-owned and filtered with the character.

---

## 8. Runtime should not need secret logic

After materialization, ordinary runtime systems should operate on the resulting active world.

In particular:

- the random-outcome executor does not need to test `secret.enabled`;
- pathfinding does not need to test secrets;
- perception does not need to test secrets;
- the item engine does not need to test secrets.

The generator may strip the `secrets` registry and `secretId` metadata from runtime world data after filtering if they have no remaining runtime purpose.

This is an architectural preference, not a secrecy/security boundary: enabled authored content embedded in a browser build can still be inspected by a determined user.

---

## 9. Existing saves and secret profiles

Secret enable/disable is not an in-save toggle.

Do not add a gameplay action, admin action, or model operation that enables/disables a secret in an existing world.

Changing a build/world's active secret profile is conceptually a **new world-generation choice**. A future editor or build profile may expose that choice.

Do not attempt to retroactively erase characters' memories, observations, or canonical events merely because a secret is disabled in some other newly generated world.

If future releases intentionally change the active secret profile of an existing save lineage, that requires explicit compatibility/migration design rather than silent runtime toggling.

---

# Part D — Per-Character Discovery

## 10. Preserve existing hidden-location discovery

The current `requiresDiscovery` + per-character `discoveredLocationIds` behavior remains authoritative for hidden locations.

Secret ownership does not replace it.

For example:

```text
Trampled Glade
secretId = chugaister
requiresDiscovery = true
```

means:

- the location exists only when the Chugaister secret is enabled;
- while it exists, each character discovers it independently using the existing discovery system.

---

## 11. Hidden-character discovery

Add the equivalent capability for authored characters.

Conceptually:

```json
{
  "id": "chugaister",
  "secretId": "chugaister",
  "requiresDiscovery": true,
  "playerControllable": false
}
```

Exact naming may follow existing conventions, but these semantics must remain separate.

### 11.1 Runtime discovery state

Characters need canonical per-character discovered-character state, conceptually:

```json
{
  "discoveredCharacterIds": ["..."]
}
```

Only characters authored with character-level discovery requirements need to appear in this list.

This state:

- persists through save/load;
- is objective engine state;
- is not stored in STM/LTM/beliefs;
- does not automatically mean the discovering character understands what the target is.

### 11.2 Grounded discovery invariant

A hidden character is discovered only from **real grounded perception/encounter**.

The following do **not** reveal the concrete hidden NPC:

- reading its species/name in an encyclopedia;
- hearing a rumor;
- another character claiming it exists;
- forming a belief about it;
- model narration unsupported by canonical perception.

A real grounded encounter may reveal it.

---

## 12. No UI leakage before discovery

A discovery-gated character must not leak through ordinary player-facing or HumanController-facing surfaces before the current human-controlled character has discovered it.

At minimum, filter it from:

- scene character lists when not actually perceived;
- character selectors;
- HumanController switching;
- addressee selectors;
- give/take/trade target selectors;
- character-target formal-action options;
- ordinary Elsewhere/roster summaries;
- any non-admin UI that would reveal its name or existence merely by enumeration.

Dedicated developer diagnostics may deliberately inspect hidden content, but that must be clearly separated from ordinary gameplay UI.

---

## 13. `playerControllable`

Add/retain an explicit authored controllability capability independent of discovery:

```json
{
  "playerControllable": false
}
```

A character with `playerControllable: false` may never be assigned to the HumanController through ordinary game/admin controls, even after discovery.

This is separate from:

- secret membership;
- visibility;
- controller type used by the NPC itself.

Future non-secret NPCs may also use `playerControllable: false`.

---

# Part E — Generic Authored Random Outcome Tables

## 14. Purpose

Random world facts must be chosen by deterministic engine-side RNG from authored data.

Do not ask a language model to decide whether a canonical random event occurred.

The model may react to the result after the engine commits it.

---

## 15. Authored table

Introduce reusable authored weighted outcome tables conceptually shaped as:

```json
{
  "randomOutcomeTables": {
    "exampleTable": {
      "id": "exampleTable",
      "noOutcomeWeight": 0,
      "outcomes": [
        {
          "id": "exampleOutcome",
          "weight": 10,
          "once": true,
          "effects": []
        }
      ]
    }
  }
}
```

Exact naming may follow current conventions.

### 15.1 Weights

- `weight` must be a positive finite integer.
- `noOutcomeWeight` is optional and defaults to `0`.
- `noOutcomeWeight`, when present, must be a non-negative finite integer.
- Probabilities are derived from the eligible total weight at invocation time.
- Authoring does not need to sum to 100.

`noOutcomeWeight` exists so systems such as hunting can represent "nothing unusual happened" without inventing a fake effect record.

### 15.2 Stable IDs

Outcome IDs must be stable technical IDs suitable for save persistence.

Prefer the project's existing global technical-ID uniqueness discipline where practical.

---

## 16. `once`

Each outcome explicitly declares:

```json
{
  "once": true
}
```

or:

```json
{
  "once": false
}
```

For `once: true`, canonical save state records successful consumption, conceptually:

```json
{
  "consumedAuthoredOutcomeIds": ["discoverTrampledGlade"]
}
```

A consumed once-outcome is no longer eligible in later rolls.

A repeatable outcome is never added to this set.

### 16.1 Commit timing

Mark a once-outcome consumed only **after**:

1. it was selected;
2. all effects executed successfully on the candidate world;
3. candidate world validation succeeded;
4. the transaction committed.

Failed/rolled-back execution must not consume it.

---

## 17. Eligibility is not an authored condition language

This version deliberately does **not** add a generic authored condition/rule DSL.

Do not add arbitrary conditions such as:

- character belief checks;
- model-memory queries;
- arbitrary expression evaluation;
- authored JavaScript;
- custom script callbacks.

An outcome may still be mechanically ineligible when a registered effect cannot validly apply.

Examples:

- `reveal_location` is inapplicable if that actor has already discovered the location;
- `encounter_character` is inapplicable if the required grounded target is not objectively encounterable;
- a negative wallet mutation that would make the wallet invalid is inapplicable.

An outcome with any unmet hard effect precondition is excluded before weighted selection.

That is effect validation, not a general conditions engine.

---

## 18. Selection algorithm

For one invocation:

1. load the referenced authored table;
2. discard consumed `once:true` outcomes;
3. discard outcomes whose registered effects are currently inapplicable;
4. compute the sum of eligible outcome weights plus `noOutcomeWeight`;
5. perform exactly one weighted RNG selection using the supplied/injectable random source;
6. if the no-outcome bucket wins, commit no mystery effect;
7. otherwise execute the selected outcome's effects in authored order as one atomic candidate transaction;
8. validate the candidate world;
9. commit and mark `once:true` consumed.

Tests must use injectable RNG and verify boundary behavior.

---

# Part F — Invocation Points

## 19. Generic environmental interaction

The Old Well requires a reusable ordinary interaction with authored world geometry rather than pretending a well is a portable inventory item.

Add a generic location/sublocation authored-interaction concept, conceptually:

```json
{
  "interactions": [
    {
      "id": "raiseOldWellBucket",
      "actionLabel": "Raise the bucket",
      "effectId": "random_outcome",
      "outcomeTableId": "oldWellDraw"
    }
  ]
}
```

Exact schema may follow current action conventions.

### 19.1 Formal action

Expose eligible environmental interactions through the normal `available_actions` contract to both:

- HumanController;
- AIController.

Conceptually the formal action may be:

```json
{
  "type": "authored_interaction",
  "interaction_id": "raiseOldWellBucket"
}
```

Do not make the interaction a UI-only button or an AI-only hidden mechanism.

### 19.2 Applicability

An environmental interaction is available only when:

- the actor occupies the authored location/sublocation that owns it;
- its referenced effect/table exists and validates;
- executing it can have a valid effect according to that effect's applicability rules.

It is an ordinary in-world action and spends the ordinary turn/tick according to current action semantics.

### 19.3 Perception

Physical interaction and its physical result should enter the existing grounded observation/perception path.

Do not silently inject the result into every character's mind.

Nearby perceivers learn only through normal delivery.

---

## 20. Day-activity completion integration

Allow a day activity to invoke an authored random outcome table at completion, conceptually:

```json
{
  "completionOutcomeTableId": "soloHuntingMystery"
}
```

This generalizes the current hunting-specific `completionDiscovery` behavior.

For Mallowstead's hunting activity:

- ordinary pelt settlement remains its existing `random_items` settlement;
- the mystery outcome roll happens as an additional authored completion step;
- the current 10% Trampled Glade discovery moves into the generic random outcome system.

The base settlement and completion outcome should remain part of the same candidate/rollback discipline currently used by daytime settlement.

Do not make `random_outcome` a model decision.

---

# Part G — Initial Outcome Effect Registry

## 21. Registry boundary

Random outcomes execute only effect types registered and validated by the engine.

No arbitrary authored JavaScript/functions.

An outcome may contain multiple effects, executed in authored order inside one atomic transaction.

The first supported effect types are:

```text
emit_observation
reveal_location
encounter_character
modify_wallet
create_item
```

The first three are the mystery/discovery core. The latter two are required by the Old Well.

---

## 22. `emit_observation`

Purpose: commit authored grounded sensory/result text through the normal event/perception system.

Required semantics:

- the acting character receives the grounded result;
- other characters receive it only through ordinary local perception/delivery;
- the effect does not directly write STM/LTM/beliefs;
- text may use safe deterministic placeholders such as `{actorName}` where current conventions permit;
- the event records source/action/outcome IDs for diagnostics where practical.

This effect may be used alone for a purely textual physical result such as ordinary well water.

---

## 23. `reveal_location`

Purpose: use the existing per-character hidden-location discovery machinery.

Conceptual authored effect:

```json
{
  "type": "reveal_location",
  "locationId": "trampledGlade",
  "observationText": "..."
}
```

Required semantics:

- target location must exist and `requiresDiscovery === true`;
- discovery is granted only to the acting/targeted character for this first version;
- if the character already knows the location, the effect is inapplicable rather than producing a fake repeat discovery;
- use existing canonical `grantLocationDiscovery` behavior rather than a competing discovery store;
- emit the grounded discovery observation through existing mechanisms.

---

## 24. `encounter_character`

Purpose: mark a concrete hidden character as actually encountered/discovered.

Conceptual authored effect:

```json
{
  "type": "encounter_character",
  "characterId": "chugaister",
  "observationText": "..."
}
```

Required semantics:

- target must be an authored character requiring discovery;
- the target must already be objectively present/encounterable according to canonical simulation state;
- the effect does **not** teleport, spawn, summon, or invent the target's presence;
- on success it records character discovery for the perceiving actor and emits a grounded encounter observation;
- if already discovered, it is inapplicable/no repeat reveal.

How Chugaister becomes objectively encounterable is deliberately deferred to a later Chugaister-mechanics specification.

---

## 25. `modify_wallet`

Purpose: deterministic canonical wallet mutation.

First-version authored shape may be restricted to:

```json
{
  "type": "modify_wallet",
  "target": "actor",
  "amount": 1
}
```

Required semantics:

- `amount` is a non-zero integer;
- result must satisfy existing wallet validation;
- the effect mutates canonical wallet state directly;
- it does not create a coin item unless authoring separately requests one.

The Old Well uses `+1` gold.

---

## 26. `create_item`

Purpose: create ordinary canonical item instances from authored item definitions.

First-version authored shape may be restricted to:

```json
{
  "type": "create_item",
  "itemDefinitionId": "bucketOfWine",
  "destination": "actor_inventory",
  "quantity": 1
}
```

Required semantics:

- referenced definition must exist;
- quantity is a positive bounded integer, default `1`;
- create unique normal item instance IDs using existing item-instance rules;
- created items become ordinary canonical items after creation;
- the secret system has no special ownership over their later use, transfer, consumption, or persistence.

---

# Part H — Validation

## 27. Secret validation

Reject at least:

- secret registry key/id mismatch;
- blank/duplicate secret IDs;
- non-Boolean `enabled`;
- `secretId` referencing a missing secret;
- unsupported placement of `secretId` in schemas where it has not been defined;
- active-world dangling references after disabled-secret filtering.

Validate disabled secret content before filtering.

---

## 28. Character discovery validation

Reject at least:

- non-Boolean character `requiresDiscovery`;
- non-Boolean `playerControllable`;
- malformed/duplicate runtime `discoveredCharacterIds`;
- discovered IDs pointing to missing or non-discovery-gated characters where current validation follows the existing hidden-location discipline;
- HumanController assignment to `playerControllable:false` characters.

Migration may safely repair/prune stale discovered-character IDs similarly to existing location discovery normalization.

---

## 29. Random table validation

Reject at least:

- missing/duplicate table IDs;
- missing/duplicate outcome IDs;
- empty table with no positive `noOutcomeWeight`;
- invalid/zero/negative/non-finite weights;
- non-Boolean `once`;
- missing or empty effects for an outcome unless a future explicit no-effect outcome type is introduced;
- unknown effect types;
- malformed effect parameters;
- references to missing locations, characters, item definitions, or interactions;
- `reveal_location` referencing a location that does not require discovery;
- `encounter_character` referencing a character that does not require discovery;
- invalid wallet amount;
- invalid item quantity/destination.

---

## 30. Environment interaction validation

Reject at least:

- duplicate interaction IDs;
- blank labels;
- unknown effect IDs;
- missing outcome table references;
- interactions attached to malformed locations/sublocations;
- secret references that become dangling after materialization.

---

# Part I — Save and Migration

## 31. New canonical runtime fields

Persist at least:

- per-character hidden-character discovery state;
- consumed one-shot authored outcome IDs.

Exact placement may follow current world state conventions.

---

## 32. Legacy save migration

For saves predating this system:

- initialize `discoveredCharacterIds` to an empty valid set except where objective current location/perception requires deterministic repair;
- preserve existing `discoveredLocationIds` exactly through current normalization;
- initialize consumed authored outcome IDs empty;
- if a legacy save already has Trampled Glade discovered, the migrated reveal outcome naturally becomes inapplicable and must not create a duplicate discovery;
- prune stale consumed outcome IDs if their authoring no longer exists;
- do not invent secret knowledge, encounters, or retrospective random events.

No model call is allowed for migration.

---

# Part J — Required Tests

## 33. Build/materialization tests

Cover at least:

1. Enabled secret-owned content remains in the materialized world.
2. Disabled secret-owned content is removed.
3. Disabled secret content is still validated before filtering.
4. Secret-owned open content is not treated as hidden merely because it has `secretId`.
5. Exits/reachable-sublocation lists are safely pruned when their secret destination is removed.
6. Secret-owned known facts and tablet entries are removed with a disabled secret.
7. Non-secret dangling references to removed secret entities fail validation.
8. Runtime generated world does not need secret-enabled checks for random execution.

---

## 34. Character discovery tests

Cover at least:

1. Hidden character discovery is per-character.
2. A rumor/known fact does not reveal the concrete hidden character.
3. Tablet knowledge does not reveal the concrete hidden character.
4. Grounded `encounter_character` can reveal it when objective encounter preconditions are met.
5. Discovery persists through save/load.
6. An undiscovered hidden character does not leak through ordinary player-facing target/selector lists.
7. `playerControllable:false` blocks HumanController assignment before and after discovery.
8. A public secret-owned character fixture with no discovery requirement remains visible, proving `secretId != hidden`.

---

## 35. Random outcome tests

Cover at least:

1. Injectable RNG selects the correct weighted boundary outcomes.
2. `noOutcomeWeight` behaves as a real weighted no-event bucket.
3. `once:true` outcome is consumed only after successful commit.
4. Consumed once-outcome is excluded from later rolls.
5. `once:false` outcome remains repeatable indefinitely.
6. Inapplicable effects exclude their outcome before selection.
7. Multiple effects execute in authored order atomically.
8. A failing effect rolls back all prior effects and does not consume the outcome.
9. Unknown/malformed effects fail authored validation.
10. Save/load preserves consumed outcome IDs.

---

## 36. Effect tests

Cover at least:

- `emit_observation` follows normal perception rather than global mind injection;
- `reveal_location` uses existing discovery state and does not rediscover;
- `encounter_character` does not summon/teleport an absent target;
- `modify_wallet +1` changes only canonical wallet state;
- invalid wallet result is rejected/rolled back;
- `create_item` creates unique ordinary item instances in actor inventory;
- created item persists and is subsequently governed only by normal item mechanics.

---

## 37. Invocation tests

Cover at least:

- environmental interaction appears in HumanController available actions at the correct sublocation;
- same interaction is exposed through ordinary AIController `available_actions`;
- it is absent away from the authored location/sublocation;
- it spends an ordinary action/turn;
- day-activity completion may invoke a mystery table in addition to existing settlement;
- existing hunting pelt settlement still works when no mystery outcome occurs.

---

# Part K — Non-Goals

## 38. Explicit non-goals

This task does **not**:

- create a quest/progress system;
- create global `secretDiscovered` state;
- copy objective secret truth into every character mind;
- add a knowledge cache;
- add a generic authored condition language;
- inspect STM/LTM/beliefs to decide random eligibility;
- execute arbitrary authored JS/functions;
- let models decide canonical random outcomes;
- add cooldowns, max-occurrence counters, or complex prerequisites beyond `once` and hard effect applicability;
- define how Chugaister is summoned, spawned, scheduled, or behaves;
- make secret IDs a security mechanism against source inspection;
- permit runtime secret toggling in an existing save.

---

# Part L — Acceptance Criteria

## 39. Engine acceptance

Implementation is complete when:

1. Secrets are optional authored world modules, not character cognition.
2. Full authored source including disabled secrets is validated.
3. Disabled secret-owned records are removed before runtime world generation.
4. `secretId` alone never implies hidden/discovered state.
5. Hidden locations keep the existing per-character discovery system.
6. Hidden characters gain equivalent per-character grounded discovery.
7. `playerControllable:false` independently blocks HumanController use.
8. Ordinary UI/action enumeration does not leak undiscovered hidden characters.
9. Weighted authored random outcomes execute engine-side with injectable RNG.
10. One-shot outcome consumption persists canonically and commits atomically.
11. Repeatable outcomes remain repeatable.
12. Random outcomes support the first five validated effect types.
13. Environmental interactions expose authored world actions through the normal formal-action path.
14. Day activities can invoke the same random-outcome system at completion.
15. Runtime random/perception/pathfinding code contains no Chugaister/Old-Well/secret-ID branches.

