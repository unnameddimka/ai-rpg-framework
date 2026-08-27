# Mallowstead — Chugaister and Old Well Secrets

**Status:** Authored world implementation specification  
**Scope:** First two Mallowstead secret modules using the generic authored-secrets/random-outcomes engine  
**Target:** `docs/world/`  
**Product:** Mallowstead  
**Engine dependency:** `docs/engine/authored-secrets-and-random-outcomes.md`

---

## 1. Purpose

Introduce the first modular hidden/mystery layer for Mallowstead.

The intended tone is not a single central quest mystery. Mallowstead may contain multiple independent pieces of folklore, supernatural activity, ordinary human secrecy, and misleading coincidence.

The first two secret modules are:

```text
chugaister
old_well
```

Both are enabled in the default authored world for this implementation.

They demonstrate two different shapes of secret content:

- **Chugaister:** hidden location/discovery content, authored reference knowledge, and future hidden-character encounter mechanics;
- **Old Well:** an openly visible ordinary-looking place whose unusual behavior is hidden in authored outcomes and local knowledge.

`secretId` is authoring membership only. It is not shown to players or characters.

---

# Part A — Secret Registry

## 2. Default registry

Add:

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

These names are author-facing metadata and are not automatic world lore.

---

# Part B — Chugaister Secret

## 3. Existing Trampled Glade ownership

The existing location:

```text
trampledGlade
```

becomes owned by:

```json
{
  "secretId": "chugaister",
  "requiresDiscovery": true
}
```

Its existing topology remains:

```text
Village Edge ↔ Trampled Glade ↔ Forest Stream
```

The location remains individually discovered per character through the existing `discoveredLocationIds` system.

If the Chugaister secret is disabled at world materialization:

- `trampledGlade` is absent;
- exits/reachable references to it are pruned;
- no character receives initial discovery of it;
- no hunting outcome can reveal it.

Do not replace per-character discovery with a global secret flag.

---

## 4. Mara's initial knowledge of the glade

Preserve Mara's current initial discovery:

```text
hoodedWoman.initialDiscoveredLocationIds includes trampledGlade
```

and preserve the current known fact, but mark the known-fact record as Chugaister-secret-owned so it is removed when the secret is disabled.

Current intended content:

> I know a concealed path to a secluded clearing between the forest stream and the village edge. The grass there is repeatedly trampled and some branches have been broken unusually high, but I do not know for certain what causes it.

Do not upgrade this seed into certainty about the cause.

Mara knowing the clearing does not mean every other character knows it.

---

## 5. Tablet article ownership

The existing Chugaister authored knowledge entry on Mara's Slab of Full Arcane Knowledge becomes owned by:

```text
secretId = chugaister
```

Preserve its existing keyword behavior and article intent.

The current article may remain substantially as authored:

> Old woodland bestiaries describe the Chugaister as a large, shaggy forest being whose frightening appearance is at odds with most surviving accounts of its temperament. It is usually described as friendly or indifferent toward people and fiercely hostile to predatory forest wraiths and other things that hunt travelers. Some traditions say a Chugaister may challenge a lone passerby to dance, and repeated reports associate its resting or dancing places with broad trampled clearings. Reliable sightings are rare, and scholars still disagree whether the name describes a species, a class of forest spirit, or one exceptionally long-lived being.

The article is **reference lore**, not proof that a concrete Chugaister currently exists in Mallowstead.

Reading it must not reveal a hidden Chugaister character through character-discovery state.

The separate Outer-World Construct Hypothesis article remains ordinary tablet/world lore and is **not** part of the Chugaister secret merely because a future mystery may make it relevant.

---

## 6. Hunting outcome migration

The current `soloHunting.completionDiscovery` 10% Trampled Glade mechanic must move to the generic authored random-outcome system.

Preserve ordinary hunting settlement:

```text
1–5 squirrel pelts
```

as the existing `random_items` settlement.

Add a completion mystery table conceptually:

```json
{
  "id": "soloHuntingMystery",
  "noOutcomeWeight": 90,
  "outcomes": [
    {
      "id": "discoverTrampledGladeWhileHunting",
      "secretId": "chugaister",
      "weight": 10,
      "once": true,
      "effects": [
        {
          "type": "reveal_location",
          "locationId": "trampledGlade",
          "observationText": "During the hunt, {actorName} notices broken branches and heavily trampled grass beside a concealed way into a secluded clearing."
        }
      ]
    }
  ]
}
```

Exact schema may follow the engine implementation.

Required semantics:

- before discovery, the current effective chance remains 10%;
- when it occurs, only the hunting actor discovers the glade;
- after successful discovery the once-outcome is consumed;
- if that actor already knows the glade through another grounded route, `reveal_location` is inapplicable and hunting must not emit a fake duplicate discovery;
- pelt settlement remains independent of whether a mystery event occurs;
- disabling the Chugaister secret removes this outcome while leaving ordinary hunting intact.

No Chugaister encounter is added to hunting in this task.

---

## 7. Chugaister character membership

Reserve the concrete authored character identity:

```text
character id: chugaister
secretId: chugaister
requiresDiscovery: true
playerControllable: false
```

The intended final secret module includes Chugaister as a real Character-engine actor, not merely narration or a monster-result string.

However, **activation/placement is deferred** in this task because the design for summoning/encountering Chugaister has not yet been chosen.

Do not invent one of the following merely to make the character active now:

- a permanent hidden holding room;
- random teleportation;
- a weekly schedule;
- an off-map life simulation;
- automatic presence in the Trampled Glade;
- automatic appearance when the glade is discovered.

The generic engine may implement character discovery and the `encounter_character` effect now, but the Mallowstead world must not invoke `encounter_character` for Chugaister until a later world/mechanics spec defines how Chugaister becomes objectively present.

This deferred boundary is deliberate.

---

## 8. Chugaister non-goals for this task

Do not yet define:

- how to summon or attract Chugaister;
- whether it is permanently embodied or intermittently present;
- its normal schedule;
- whether it sleeps/eats/travels like a human NPC;
- special movement/topology rules;
- combat;
- dancing mechanics;
- supernatural powers;
- how it chooses whom to approach;
- whether it can cross ordinary locked topology;
- any deterministic relationship between the tablet article and an encounter.

---

# Part C — Old Well Secret

## 9. Placement

Add a new openly available sublocation at the existing:

```text
Village edge
location id: villageEdge
```

Conceptual sublocation:

```text
id: oldWell
name: Old well
secretId: old_well
requiresDiscovery: false / no discovery gate
```

It is reachable from `villageEdgePath` and the path is reachable back from the well.

The player does not need to discover a hidden route to reach it.

When the `old_well` secret is enabled, anyone who reaches the Village Edge may see and approach the well.

When the secret is disabled for a newly materialized world, the well sublocation and its interaction disappear cleanly while the rest of the Village Edge remains.

---

## 10. Physical description

The well should be described approximately as:

> An old stone well stands among tall grass and overgrown bushes at the edge of the village. Everything around it looks neglected, yet the well itself is suspiciously sound: its masonry is solid, with scarcely a shifted or crumbling stone. A weathered wooden lid covers the opening.

The important authored facts are:

- it is old;
- grass and bushes have grown around it;
- it appears neglected;
- the stone structure itself is strangely intact rather than collapsing with age;
- it is covered by a wooden lid.

Do not label it "cursed" in the objective scene description. That interpretation belongs to character knowledge and rumor.

Do not display `secretId`, secret name, probabilities, or outcome table information to the player.

---

# Part D — Old Well Character Knowledge

## 11. Basic local warning

Seed an initial known fact for the following current local characters:

```text
Mara (`hoodedWoman`)
Garrick (`innkeeper`)
Nell (`nell`)
Harlan (`blacksmith`)
```

Do **not** seed it to:

```text
Traveler (`player`)
Maksym (`roadMerchant`)
```

This is explicit authored mapping. The engine must not contain a concept such as `all locals except Maksym`.

The fact should express approximately:

> The old well at the edge of Mallowstead is cursed. It is better to leave it alone and not go near it without a reason.

Use the same semantic knowledge for each relevant character, adapted only as necessary for first-person known-fact wording.

Each such known-fact record belongs to:

```text
secretId = old_well
```

so it is absent when that secret is disabled at world generation.

---

## 12. Mara's deeper knowledge

Mara receives an additional initial known fact, also owned by `old_well`:

> I know that drawing from the old well does not always bring up what a well ought to contain. Unexpected things have been found in its bucket.

This is additional knowledge, not a replacement for the basic local warning.

Do not tell Mara the exact 90/9/1 distribution as character knowledge.

Do not automatically tell her what every possible result is unless separately authored later.

---

# Part E — Old Well Interaction

## 13. Environment action

At the Old Well sublocation, expose the ordinary formal environmental interaction:

```text
Raise the bucket
```

It is available to both HumanController and AIController through the normal available-action path when the actor is at the well.

It is an ordinary in-world action and consumes the normal tick/turn.

The engine, not a model, rolls the result.

The interaction is repeatable with no cooldown in this version.

---

## 14. Exact authored outcome distribution

Each use rolls this table:

```text
90% — ordinary water
 9% — water with one gold coin in the bucket
 1% — a bucket filled with wine
```

Implement as relative weights:

```json
{
  "id": "oldWellBucketDraw",
  "noOutcomeWeight": 0,
  "outcomes": [
    {
      "id": "oldWellOrdinaryWater",
      "secretId": "old_well",
      "weight": 90,
      "once": false,
      "effects": [
        {
          "type": "emit_observation",
          "text": "The bucket comes up with nothing but cold, clear water."
        }
      ]
    },
    {
      "id": "oldWellGoldCoin",
      "secretId": "old_well",
      "weight": 9,
      "once": false,
      "effects": [
        {
          "type": "emit_observation",
          "text": "The bucket comes up full of water, and a single gold coin gleams at the bottom."
        },
        {
          "type": "modify_wallet",
          "target": "actor",
          "amount": 1
        }
      ]
    },
    {
      "id": "oldWellWineBucket",
      "secretId": "old_well",
      "weight": 1,
      "once": false,
      "effects": [
        {
          "type": "emit_observation",
          "text": "The bucket rises from the well filled with dark red wine instead of water."
        },
        {
          "type": "create_item",
          "itemDefinitionId": "bucketOfWine",
          "destination": "actor_inventory",
          "quantity": 1
        }
      ]
    }
  ]
}
```

Exact JSON shape may follow engine conventions, but the percentages and effects are authoritative.

---

## 15. Ordinary-water outcome

On the 90% result:

- produce grounded result text;
- do not create a water item;
- do not modify wallet;
- do not create persistent well state.

The water is only part of the immediate action result.

No `Bucket of Water` item is generated.

---

## 16. Gold outcome

On the 9% result:

- the bucket contains ordinary water plus one gold coin;
- produce grounded result text;
- add exactly `+1` to the acting character's canonical wallet;
- do not create a separate coin item;
- do not create a water/bucket item for this outcome.

The coin is considered taken into the actor's wallet as part of settlement.

Nearby characters may perceive the physical result only through normal observation/perception delivery.

---

## 17. Wine outcome

On the 1% result:

- produce grounded result text;
- create exactly one ordinary canonical `Bucket of wine` item in the actor's inventory;
- no separate water result exists;
- after creation the item is governed only by ordinary item mechanics.

The well secret does not retain ownership/control of the generated item at runtime.

---

# Part F — Bucket of Wine Item

## 18. Item definition

Add an ordinary item definition conceptually:

```text
id: bucketOfWine
name: Bucket of wine
```

Suggested description:

> A wooden bucket filled with dark red wine.

It is drinkable through the existing consume-item contract.

Follow the established filled-container pattern rather than creating a special well-consumption action.

Preferred implementation:

```text
Bucket of wine --drink--> Empty bucket
```

with a simple ordinary `emptyBucket` item definition if needed.

The exact empty-bucket text may follow current item conventions.

No further bucket-filling mechanics are required in this task.

---

# Part G — Perception and Rumor Consequences

## 19. No automatic secret dissemination

Neither secret creates global knowledge when something happens.

Examples:

- Traveler finding the Trampled Glade does not tell Nell;
- Traveler reading the Chugaister article does not reveal a concrete Chugaister NPC;
- Garrick's starting warning about the well does not imply Maksym knows it;
- someone drawing wine from the well does not automatically add the fact to every villager's mind.

Information spreads only through:

- grounded perception;
- ordinary dialogue;
- existing memory/cognition mechanisms;
- explicit authored starting knowledge.

This separation is important for future detective/social-mystery play.

---

## 20. Physical well results are observable events

Raising the bucket is a physical local action.

If another character is present and ordinary perception says they can witness the result, they may receive the grounded observation that:

- water came up;
- a coin was found;
- or wine came up.

That character's later interpretation is left to its mind/model.

Do not automatically convert the event into a canonical belief such as "the well is magical" or "the well is cursed."

---

# Part H — Save/Migration Expectations

## 21. Existing Trampled Glade saves

Existing saves that already discovered `trampledGlade` must preserve that discovery.

After migration to the generic hunting random outcome:

- do not replay the discovery;
- do not remove the location from the character's knowledge;
- the once reveal outcome is simply inapplicable for a character who already knows the glade.

No model call is required.

---

## 22. Old Well in migrated saves

The Old Well is authored world content, not historical generated state.

When this authored world update is loaded/migrated under normal current world-migration rules:

- preserve existing character locations, inventories, wallets, minds, and discoveries;
- add the new authored Village Edge well topology according to normal current-authoring reconciliation;
- do not retroactively roll the bucket;
- do not seed any new observation saying a character has visited it;
- add only the authored starting known facts according to the project's normal rules for current-authoring mind migration; do not overwrite model-writable developed mind state if current migration conventions forbid doing so.

If current migration intentionally preserves saved mind instead of reapplying new `initialMind`, do not special-case the well to inject knowledge into an established mind. Fresh-world authoring is authoritative for the initial knowledge requirement.

---

# Part I — Required World Tests

## 23. Secret-profile tests

With `chugaister` enabled:

- Trampled Glade exists;
- Mara begins with its discovery/known fact;
- the slab contains the Chugaister article;
- hunting contains the 10-weight discovery outcome.

With `chugaister` disabled:

- Trampled Glade and its topology references disappear;
- Mara does not receive the secret-owned glade fact/discovery;
- Chugaister tablet article disappears;
- ordinary hunting still works and still settles pelts;
- no Chugaister encounter is invented.

With `old_well` enabled:

- Old Well is openly reachable at Village Edge;
- it is not discovery-gated;
- Raise the bucket is available there;
- local starting knowledge is seeded exactly as authored.

With `old_well` disabled:

- Old Well sublocation/interaction disappear;
- Village Edge remains valid;
- all `old_well` known facts disappear from the fresh authored world;
- unrelated world content remains unchanged.

---

## 24. Knowledge tests

Fresh world:

- Mara knows the basic cursed-well warning;
- Mara also knows unexpected things may come up in its bucket;
- Garrick knows the basic warning;
- Nell knows the basic warning;
- Harlan knows the basic warning;
- Maksym has no authored starting Old Well knowledge;
- Traveler has no authored starting Old Well knowledge.

No engine code may derive this list using a `local` category or a Maksym exception.

---

## 25. Old Well RNG tests

With injectable deterministic RNG, verify exact weighted boundaries for total weight 100:

- rolls in the first 90 weight units select ordinary water;
- the next 9 select gold;
- the final 1 selects wine.

Also verify repeated invocations can produce the same result again because all three outcomes are `once:false`.

---

## 26. Old Well effect tests

Water:

- emits grounded result;
- wallet unchanged;
- inventory unchanged;
- no water item generated.

Gold:

- emits grounded result;
- actor wallet increases by exactly 1;
- no coin item generated;
- no water item generated.

Wine:

- emits grounded result;
- actor receives exactly one unique `bucketOfWine` instance;
- it can be transferred through ordinary item mechanics;
- drinking it uses the existing consume contract;
- no secret-specific logic is needed after item creation.

---

## 27. Interaction/perception tests

- HumanController at the well sees `Raise the bucket` as an available formal action.
- AIController at the well receives the same authored action through `available_actions`.
- The action is absent from other Village Edge sublocations when not at the well.
- Raising the bucket spends an ordinary action/tick.
- A nearby perceiver can receive the physical result through normal perception.
- A remote character receives nothing automatically.

---

## 28. Chugaister leakage tests

Once the concrete Chugaister character definition is activated by its later mechanics:

- prior tablet reading alone does not expose it in selectors;
- prior rumor/known fact alone does not expose it;
- discovery of Trampled Glade alone does not automatically expose it;
- only grounded encounter reveals that concrete character to the perceiving character;
- even after discovery it remains `playerControllable:false`.

Until the later activation spec exists, tests must also assert that this task does not place/summon Chugaister merely because the secret is enabled or the glade is discovered.

---

# Part J — Documentation/Authoring Notes

## 29. World lore separation

`data/world-lore.md` may mention only information intended for human continuity/documentation.

Do not use it as runtime source for secret mechanics.

Secret probabilities, effect tables, membership, and knowledge seeds belong in authored world data and engine-supported schemas.

---

## 30. Detective-layer principle

These secrets establish an authoring pattern for future Mallowstead mysteries:

```text
objective hidden authored content
        ↓
real events / clues / encounters
        ↓
individual character perception
        ↓
memory, belief, rumor, contradiction
```

The engine should preserve the distinction between:

```text
world truth
lore/reference knowledge
character knowledge
character belief
clue/discovery
concrete direct encounter
```

Do not collapse these into one global quest state.

---

# Part K — Non-Goals

## 31. Explicit non-goals

This world patch does **not**:

- define a central mystery or victory condition;
- define Chugaister summon/behavior mechanics;
- make the Trampled Glade automatically contain Chugaister;
- teach all villagers about secrets dynamically at world start;
- give Maksym Old Well knowledge;
- tell Traveler about the Old Well curse at world start;
- expose Old Well probabilities in UI/model context;
- create a Bucket of Water item;
- create a gold-coin inventory item for the well result;
- impose a cooldown on the well;
- make well outcomes one-shot;
- add belief/knowledge conditions to hunting or well rolls;
- make the Outer-World Construct Hypothesis part of the Chugaister secret;
- infer truth from rumor or rumor from truth.

---

# Part L — Acceptance Criteria

## 32. Chugaister acceptance

Complete when:

1. `chugaister` exists as an enabled authored secret module.
2. Trampled Glade belongs to it and remains per-character discoverable.
3. Mara's existing glade knowledge/discovery is secret-owned and preserved.
4. The Chugaister slab article is secret-owned reference lore.
5. Hunting uses the generic random-outcome system instead of the special `completionDiscovery` mechanism for the 10% glade reveal.
6. Ordinary hunting/pelt settlement remains unchanged.
7. The reveal is one-shot and does not duplicate an already-known glade.
8. Concrete Chugaister character identity is reserved as hidden and non-player-controllable.
9. No summon/presence/behavior mechanic is invented in this task.

---

## 33. Old Well acceptance

Complete when:

1. `old_well` exists as an enabled authored secret module.
2. Old Well is an openly visible/reachable Village Edge sublocation when enabled.
3. Its objective description is old, overgrown, wooden-covered, and suspiciously structurally intact without explicitly declaring it cursed.
4. Mara, Garrick, Nell, and Harlan receive the authored basic curse warning on a fresh world.
5. Maksym and Traveler do not.
6. Mara additionally knows that unexpected things may come up in the bucket.
7. `Raise the bucket` is an ordinary controller-agnostic environment action.
8. Each use rolls exactly 90% water / 9% +1 gold / 1% Bucket of wine.
9. Water produces no item.
10. Gold goes directly into canonical wallet and creates no coin item.
11. Wine creates one ordinary drinkable Bucket of wine item.
12. All three well outcomes are repeatable.
13. Physical results spread only through ordinary perception/dialogue/memory paths.
14. Disabling `old_well` in a newly generated world removes the well and its authored knowledge without disturbing the rest of Village Edge.

