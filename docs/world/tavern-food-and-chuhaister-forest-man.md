# Mallowstead — Tavern Food and Chuhaister The Forest Man

**Status:** Authored world implementation specification  
**Scope:** Tavern kitchen + reusable food dishware + morning/evening menu + full first-pass Chuhaister activation/lifecycle/sopilka mechanics  
**Target:** `docs/world/`  
**Product:** Mallowstead  
**Baseline:** current `0.1.2d-secrets` authored world with Old Well, Trampled Glade, Chuhaister placeholder character, slab knowledge entries, and `read_aura` delivery fix  
**Engine dependencies:**

- `docs/engine/authored-secrets-and-random-outcomes.md`
- `docs/engine/triggered-authored-events-food-and-activatable-characters.md`

This specification supersedes the earlier deferred-activation/non-goal boundary for Chuhaister in `docs/world/mallowstead-secrets-chugaister-old-well.md`. Old Well behavior remains unchanged.

---

## 1. Purpose

Turn Chuhaister from a reserved hidden character definition into an intermittently present real Character actor while preserving strict separation between:

- generic engine capability;
- ordinary tavern food authoring;
- `chugaister` secret-owned world content.

The authored composition should produce this gameplay:

1. ordinary food can be obtained from the tavern kitchen in reusable dishware;
2. during Evening, any amount of edible food dropped on the ground at Trampled Glade makes one 10% Chuhaister appearance roll per ordinary tick;
3. on success, a sudden wind is perceived at the glade and Chuhaister appears there as an ordinary AI Character;
4. while present, he cannot leave the glade but may converse and use ordinary formal actions available there;
5. he has a unique `Play sopilka` ability;
6. at the next timelapse boundary he disappears from local simulation while preserving his mind/state;
7. at that same boundary, all edible food still lying on the glade's ground is silently consumed, leaving reusable empty bowls/plates behind;
8. neither hidden consumption nor Chuhaister's off-camera disappearance appears in player-facing timelapse narration.

---

# Part A — Canonical Name and Secret Ownership

## 2. Display name

Keep the stable technical character ID unless migration conventions require otherwise:

```text
id: chugaister
```

Change the user-facing canonical name to exactly:

```text
Chuhaister The Forest Man
```

Use the official Ukrainian-style transliteration `Chuhaister` in canonical player-facing authoring.

The older spelling `Chugaister` may remain in search keywords/aliases for compatibility and discoverability but should not remain the canonical display name.

---

## 3. Secret ownership

The following authored content belongs to:

```text
secretId: chugaister
```

- Trampled Glade;
- Chuhaister The Forest Man character;
- Mara's secret-owned glade/Chuhaister starting knowledge already associated with this module;
- Chuhaister slab article;
- the Evening food-proc triggered event;
- the ordinary-tick wind/activation effects;
- the next-timelapse deactivation event;
- the next-timelapse silent glade-food consumption effect;
- the `Play sopilka` ability;
- any new Chuhaister-specific authored lifecycle metadata.

If the `chugaister` secret is disabled at world materialization, this entire footprint disappears according to the existing secret materializer.

Ordinary tavern food, bowls, plates, Kitchen, and Dish Cabinet are **not** secret-owned.

---

# Part B — Tavern Kitchen

## 4. Kitchen sublocation

Add a new sublocation inside the existing tavern `bar` location:

```text
id: barKitchen
name: Kitchen
location: bar
```

Topology:

```text
Public side of bar <-> Behind the bar <-> Kitchen
```

The Kitchen should be reachable from `barBehindCounter` and return there.

Suggested objective public description:

> Behind the serving counter, a compact kitchen crowds around a heavy stove. Pots, pans, ladles, and bundles of dried herbs hang close at hand, and a sturdy wooden cabinet holds the tavern's bowls and plates.

Morning/evening food fixtures should be reflected in phase-appropriate view/action context rather than permanently claiming all dishes are hot at once.

No separate cook NPC is added.

---

## 5. Garrick and Nell authoring

Update AI-facing grounding consistently:

### Garrick

Garrick the Innkeeper is also responsible for the tavern's ordinary cooking as part of running the establishment.

He may prepare/maintain the currently served menu narratively, but ingredients/cooking stock are not mechanically simulated in this version.

### Nell

Nell continues to serve patrons and may fetch/serve prepared food from the Kitchen using the same formal serving actions as any eligible actor.

Her role remains waitress/barmaid rather than a newly defined dedicated cook.

Do not create deterministic behavior forcing either character to serve food whenever asked; normal Character judgment remains authoritative.

---

# Part C — Dish Cabinet

## 6. Sublocation inventory

Attach a sublocation inventory to `barKitchen`:

```text
inventory name: Dish Cabinet
```

This follows the existing `barBehindCounter -> Mug cabinet` pattern.

The Dish Cabinet contains reusable canonical food dishware.

Required item definitions:

```text
Empty bowl
Empty plate
```

Suggested fresh authored stock for the first implementation:

```text
6 x Empty bowl
6 x Empty plate
```

If implementation chooses a nearby small finite count for practical existing-world conventions, keep it explicit and test it. The important invariant is finite reusable stock rather than infinite generated dishes.

There is no dirty/clean state and no washing procedure.

A returned empty bowl/plate is immediately reusable.

---

# Part D — Menu and Serving

## 7. Morning menu

Only during **Morning**, Kitchen serving actions expose:

```text
Syrnyky
Buckwheat porridge
```

Dish requirements:

```text
Syrnyky             -> plate
Buckwheat porridge  -> bowl
```

Suggested canonical filled-item names:

```text
Plate of syrnyky
Bowl of buckwheat porridge
```

---

## 8. Evening menu

Only during **Evening**, Kitchen serving actions expose:

```text
Banush
Borshch
Kulish
```

All three require bowls.

Suggested canonical filled-item names:

```text
Bowl of banush
Bowl of borshch
Bowl of kulish
```

Morning breakfast serving actions must not remain available during Evening, and evening pot serving actions must not remain available during Morning.

---

## 9. AI-facing dish grounding

Kitchen/serving action authoring must tell Character models explicitly:

> Syrnyky are served on a plate. Buckwheat porridge, banush, borshch, and kulish are served in bowls. Serving food requires the appropriate empty dish from the Dish Cabinet in the Kitchen.

This must also be represented mechanically in formal action prerequisites; prose alone is not sufficient validation.

The model must never be expected to infer that borshch belongs in a bowl or that syrnyky belong on a plate.

---

## 10. Serving result

Serving transforms one existing reusable empty dish from the Dish Cabinet into the corresponding filled food item and gives that item to the serving actor.

Examples:

```text
Empty bowl in Dish Cabinet
+ Serve banush
-> same canonical item instance becomes Bowl of banush
-> moves to serving actor inventory
```

```text
Empty plate in Dish Cabinet
+ Serve syrnyky
-> same canonical item instance becomes Plate of syrnyky
-> moves to serving actor inventory
```

No ingredients are consumed and no bowl/plate is generated.

If no correct empty dish exists, that serving action is unavailable.

---

# Part E — Edible Food Items

## 11. Food item definitions

Each filled dish is an ordinary canonical consumable with:

```text
tag: edible
consumeAction: transform to its reusable empty dish
```

Required transformations:

```text
Plate of syrnyky            -> Empty plate
Bowl of buckwheat porridge  -> Empty bowl
Bowl of banush              -> Empty bowl
Bowl of borshch             -> Empty bowl
Bowl of kulish              -> Empty bowl
```

Each consume action should have appropriate authored first-person and public text using `eat`, not drink/ale wording.

No hunger, nutrition, buffs, spoilage, ingredients, or dishwashing mechanics.

The resulting empty dish remains wherever ordinary consumption semantics place it; when a character eats from inventory it remains in that character's inventory and may be returned through ordinary transfer/place mechanics.

---

# Part F — Chuhaister Appearance and Physical Grounding

## 12. Physical description

Update Chuhaister's player-facing and Character-facing physical description.

Authoritative appearance:

- enormous humanoid;
- approximately three metres tall;
- taller and broader than anyone in Mallowstead;
- covered in coarse, greying hair;
- blue eyes;
- he may voluntarily make those blue eyes glow brightly as an expressive emphasis, especially in speech; the glow is not constant or automatic;
- visually something like a gigantic shaggy forest man / yeti-like being;
- imposing and clearly supernatural, but not literally tree-sized;
- intelligent rather than a mindless beast.

Suggested player description:

> An enormous humanoid nearly three metres tall, broader than any man in Mallowstead and covered in coarse, greying hair, with distinctly blue eyes. At a distance he could be mistaken for some gigantic forest beast; up close his expression and movements are unmistakably intelligent.

---

## 13. Character grounding

Chuhaister is an intelligent supernatural forest person.

AI-facing context should ground at least:

- he is known as **The Forest Man**;
- he is a supernatural hunter of dangerous demons and other hostile beings of the wild;
- he is not authored as a mindless monster;
- he should rely on ordinary perception, mind, and formal actions like other Characters;
- do not invent unprovided supernatural powers merely because he is supernatural.

For this version omit folklore-specific authored claims about eating mavky or a detailed mavka ecology.

His personality may emerge through normal Character play unless separately authored later.

---

# Part G — Chuhaister Activation State

## 14. Initial state

Fresh world:

```text
Chuhaister = inactive / off-map
requiresDiscovery = true
playerControllable = false
```

He must not be present merely because:

- the secret is enabled;
- Trampled Glade exists;
- a character discovers Trampled Glade;
- someone reads the slab article;
- someone believes the folklore.

The concrete character is revealed only through a grounded appearance/encounter.

---

## 15. Location lock

When active, Chuhaister is locked to:

```text
Trampled Glade
```

Author via the generic location movement constraint.

He cannot use formal `move` actions to leave the glade.

Within the glade he remains an ordinary Character and may use any formally available non-forbidden action, including for example:

- speak;
- take/drop/give accessible items;
- consume food he possesses;
- use ordinary item actions;
- use his unique `Play sopilka` ability.

Do not implement a Chuhaister-specific whitelist of every action he may perform.

If he wants to eat food lying on the ground, ordinary action composition (`take_item` then `consume`) is sufficient; no special `eat_offering` action is required.

---

# Part H — Evening Food Proc

## 16. Persistent condition

Add a `chugaister` secret-owned triggered event conceptually:

```text
trigger: ordinary_tick
phase: Evening
Trampled Glade location inventory contains at least one item tagged edible
Chuhaister is inactive
chance: 10% per eligible tick
```

The important semantics are:

- **any positive quantity** of ground edible food satisfies the condition;
- one bowl and ten bowls give the same 10% chance;
- the engine performs exactly one roll for this event per eligible ordinary tick;
- failure does not consume the food and does not disable future rolls;
- as long as prerequisites remain true, the next ordinary tick may roll again;
- food placed during the current tick receives its first roll on the **next** ordinary tick, not retroactively in the drop tick.

There is no guaranteed cumulative threshold.

Do not create an explicit `offering` item/state. Ordinary dropped edible items are sufficient.

---

## 17. Appearance success

On a successful 10% roll:

1. emit a grounded local observation of a sudden unusual wind moving through Trampled Glade;
2. activate/place `chugaister` at Trampled Glade;
3. characters who genuinely perceive the appearance discover the concrete `Chuhaister The Forest Man` individually through the ordinary hidden-character discovery mechanism;
4. Chuhaister becomes eligible for ordinary CharacterController simulation from that point onward.

Suggested observation tone:

> A sudden wind sweeps through the clearing, stirring grass and branches though the air beyond the glade seems still. From the edge of the trees steps an enormous shaggy figure.

Do not make this text reveal secret metadata or explain why the food worked.

### 17.1 Food is not automatically consumed on appearance

Successful activation does **not** consume or transform the food.

The food remains canonical on the ground until:

- a character takes/eats/moves it through ordinary actions; or
- the next timelapse secret cleanup consumes remaining ground food.

Chuhaister may choose to eat it, but the Character model is not forced to do so.

---

# Part I — Next-Timelapse Disappearance and Hidden Consumption

## 18. Chuhaister deactivation

At the next daytime/nighttime timelapse start after Chuhaister is active:

```text
Chuhaister -> inactive/off-map
```

This is deterministic authored lifecycle, not a Character choice.

Deactivation happens before timelapse planner input is constructed.

Preserve:

- STM/LTM/beliefs;
- dialogue continuity and other mind state;
- relationships;
- inventory;
- wallet;
- prior discovery by characters who met him;
- other ordinary canonical character state.

On a future successful Evening food proc, the same continuing Character returns with this state intact.

---

## 19. Silent glade-food cleanup

At each relevant next timelapse start, the `chugaister` secret also silently consumes **all** edible items still lying in the ordinary Trampled Glade location inventory.

Required examples:

```text
Bowl of banush on glade ground -> Empty bowl on glade ground
Plate of syrnyky on glade ground -> Empty plate on glade ground
Bowl of borshch on glade ground -> Empty bowl on glade ground
```

If several food dishes lie there, all are consumed in that boundary effect.

The empty reusable dishes remain on Trampled Glade's ground inventory.

Do not move them to Chuhaister's inventory.

This hidden cleanup applies whether or not the ordinary-tick appearance proc succeeded before the timelapse, provided the food still remains there.

The canonical result therefore allows a player to leave food, fail to see Chuhaister, leave the area, advance timelapse, and later return to find empty dishware.

---

## 20. No timelapse leakage

The deactivation/hidden food-consumption event uses:

```text
narrationPolicy: none
```

Required consequences:

- timelapse narration does not say Chuhaister ate the food;
- timelapse narration does not say "something ate the food";
- timelapse narration does not narrate Chuhaister disappearing;
- hidden Chuhaister actions are not planned or narrated during that timelapse because he is deactivated before planner input;
- the player discovers the changed food state only later through ordinary world observation.

This is deliberate mystery design, not missing narration.

---

# Part J — Unique Ability: Play Sopilka

## 21. Ability

Add a secret-owned ability analogous architecturally to Mara's `Read aura`:

```text
ability id: playSopilka
name/action label: Play sopilka
owner: Chuhaister
secretId: chugaister
```

It does not require a separate tracked sopilka item in this version. Treat the instrument as part of the authored personal ability unless a later item spec changes that.

---

## 22. Effect

`Play sopilka` is an ordinary formal action available while Chuhaister is active.

On success:

- everyone who can perceive sound in Chuhaister's current **location** receives grounded observation of wild sopilka music;
- the observation explicitly grounds a strong urge/desire to dance;
- no canonical forced-dance state is set;
- no automatic movement/action is executed for listeners;
- Character models decide freely how to react using ordinary actions/dialogue.

Suggested grounded text:

> Chuhaister raises a wooden sopilka and plays a wild, piercing forest melody. The rhythm catches in the body with an almost irresistible urge to dance.

The action must not directly alter beliefs/STM/LTM; listeners remember it only through ordinary observation/memory processing.

---

# Part K — Slab Article Update

## 23. Canonical title/name

Update the existing secret-owned slab entry to canonical player-facing naming:

```text
Title: Chuhaister The Forest Man
```

Preserve legacy/alternate keyword spellings for search compatibility, including current `chugaister`/`chuhaister` variants and Ukrainian forms.

The article should refer to the being as `Chuhaister` and `the Forest Man`.

Suggested updated article intent:

> Old woodland bestiaries describe Chuhaister, also called the Forest Man, as an enormous shaggy forest being whose frightening appearance is at odds with most surviving accounts of his temperament. He is usually described as friendly or indifferent toward people and as a hunter of dangerous demons and other hostile beings of the wild. Some traditions say the Forest Man may challenge a lone passerby to dance, and repeated reports associate his resting or dancing places with broad trampled clearings. Reliable sightings are rare, and scholars still disagree whether the name describes a kind of being or one exceptionally long-lived individual.

The article remains lore/reference material, not proof that Mallowstead's concrete Chuhaister exists.

Reading it does not discover the hidden character.

---

# Part L — Mara Knowledge

## 24. Preserve separation of knowledge and discovery

Keep Mara's existing Chugaister-secret-owned knowledge/discovery of Trampled Glade.

Do not automatically seed her with knowledge of the new exact 10%-per-tick food mechanic unless separately authored.

If existing or later authoring says she knows folklore about leaving food for the Forest Man, express that as a Character known fact, not as engine access to the triggered-event definition.

The engine proc percentage itself is author-facing mechanics and must never appear in Character context.

---

# Part M — Required World Tests

## 25. Kitchen topology/content tests

Verify fresh world:

- `barKitchen` exists inside `bar`;
- it is reachable only through the intended bar sublocation topology;
- it owns `Dish Cabinet` as its sublocation inventory;
- finite Empty bowls/plates exist there;
- no dirty/clean dish state exists.

---

## 26. Menu tests

Morning:

- Syrnyky serving available with plate;
- Buckwheat porridge available with bowl;
- Banush/Borshch/Kulish unavailable.

Evening:

- Banush/Borshch/Kulish available with bowls;
- Syrnyky/Buckwheat breakfast serving unavailable.

AI-facing metadata explicitly says syrnyky -> plate and all other current dishes -> bowl.

---

## 27. Dish lifecycle tests

- serving Banush consumes/transforms exactly one existing Empty bowl from Dish Cabinet;
- actor receives Bowl of banush;
- eating it produces Empty bowl;
- returning that bowl to Dish Cabinet enables serving again;
- equivalent plate lifecycle works for Syrnyky;
- stealing/losing dishware reduces tavern serving capacity naturally;
- no new dish is generated by serving or eating.

---

## 28. Chuhaister proc tests

With secret enabled and injectable RNG:

- no food -> no roll/no activation;
- edible on Trampled Glade during Morning -> no roll;
- edible on Trampled Glade during Evening + Chuhaister inactive -> one roll per ordinary tick;
- food dropped during tick N does not roll until tick N+1;
- one food item -> one 10% roll;
- ten food items -> still one 10% roll;
- failed roll leaves food unchanged and permits next-tick retry;
- successful roll emits wind/appearance observation and activates Chuhaister;
- after activation, further appearance proc is ineligible while he remains active.

With secret disabled, no proc definition remains in active world.

---

## 29. Discovery/leakage tests

- slab article alone does not expose Chuhaister in selectors;
- discovering Trampled Glade alone does not expose him;
- successful appearance reveals him only to grounded local perceivers;
- remote characters do not discover him;
- once discovered he remains known to that character after Chuhaister later deactivates;
- he remains `playerControllable:false` forever.

---

## 30. Active Character tests

While active:

- Chuhaister uses normal AI CharacterController;
- he receives normal observations/actions at Trampled Glade;
- outbound movement from Trampled Glade is absent/rejected;
- ordinary local speech/item actions remain possible;
- he may take and consume tavern food if he chooses;
- mind changes made during conversation survive later deactivation/reappearance.

---

## 31. Timelapse tests

At the next timelapse start:

- active Chuhaister becomes inactive before planner requests;
- no Chuhaister planner call occurs;
- all edible ground food on Trampled Glade is consumed;
- all bowls/plates remain there empty;
- non-edible ground items remain untouched;
- effect works even when Chuhaister never appeared during the preceding Evening;
- no narrator/public event describes eating, disappearance, or hidden secret activity;
- subsequent reactivation restores the same mind/inventory state.

---

## 32. Sopilka tests

- only Chuhaister receives `Play sopilka` through his authored ability;
- action unavailable while inactive;
- success produces a grounded audible observation to local perceivers;
- observation contains the urge to dance;
- no listener is mechanically forced to move/dance;
- no `mustDance`/status flag is added;
- remote characters receive nothing.

---

## 33. Article/name tests

- display name is exactly `Chuhaister The Forest Man`;
- slab article/title uses canonical `Chuhaister` spelling;
- legacy keyword spelling `chugaister` still finds the article;
- disabling the secret removes the article, character, glade, proc/lifecycle events, and `Play sopilka` ability without removing ordinary tavern food.

---

# Part N — Non-Goals

## 34. Explicit non-goals

This world update does **not** add:

- forced dancing;
- dance skill/contest mechanics;
- combat mechanics;
- detailed mavka ecology or authored mavka-eating behavior;
- hunger/satiety;
- ingredient/cooking economy;
- dish washing;
- food spoilage;
- a separate cook NPC;
- a special `offer_to_chuhais­ter` action;
- increased summon probability from multiple dishes;
- a guaranteed appearance after N failed ticks;
- Chuhaister movement outside Trampled Glade;
- hidden narrated timelapse scenes explaining what happened off-camera.

---

# Part O — Acceptance Criteria

## 35. World acceptance

Implementation is complete when:

1. The tavern has a real Kitchen sublocation and finite reusable bowl/plate stock.
2. Morning and Evening expose the correct authored menu and dish requirements.
3. All five foods are ordinary edible canonical items returning reusable dishware.
4. `Chuhaister The Forest Man` is the canonical display name and slab terminology.
5. During Evening, ground edible food on Trampled Glade creates exactly one 10% appearance opportunity per ordinary tick while Chuhaister is inactive.
6. Quantity of food does not change that per-tick chance.
7. Successful proc produces wind + grounded appearance and activates the real continuing Character.
8. Chuhaister cannot leave Trampled Glade but otherwise participates through ordinary formal action contracts.
9. `Play sopilka` is a unique formal ability that grounds music/urge-to-dance without forcing behavior.
10. At the next timelapse Chuhaister deactivates with mind/state preserved.
11. All remaining ground edible food on Trampled Glade is silently consumed at that timelapse, leaving reusable empty dishes.
12. Hidden consumption/deactivation never leaks through timelapse narration.
13. All glade/Chuhaister-specific event/lifecycle/ability content is owned by the `chugaister` secret and disappears when that secret is disabled.
14. Ordinary food/kitchen content remains present independently of whether the Chugaister secret is enabled.
