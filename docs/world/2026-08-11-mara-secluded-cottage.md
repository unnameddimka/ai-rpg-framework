# Mara's Secluded Cottage

## Purpose

Extend the authored world beyond the tavern with Mara's permanent home and workplace, using only existing world primitives: locations, sublocations, movement, beds, surfaces/containers, character descriptions, and authored `knownFacts`.

No new crafting, farming, schedule, quest, or AI-psychology subsystem is introduced.

## Route

Add the bidirectional route:

```text
street <-> villageEdge <-> secludedCottage
```

Existing street connections remain unchanged.

## Village edge

`villageEdge` is the transition between the inhabited village and surrounding woodland. The ordinary houses, fences, and gardens thin out here and a less-travelled path continues toward Mara's cottage.

The cottage is isolated from normal village housing but remains within ordinary walking distance. Local villagers know where it is.

Do not add monsters, magical wards, supernatural hazards, ruins, or artificial quest obstacles.

## Mara's cottage

`secludedCottage` represents the cottage and its immediately surrounding garden as one major gameplay location.

The cottage stands in a forest clearing, apart from other homes. Cultivated beds around it contain herbs, mushrooms, and other useful medicinal/alchemical ingredients.

The cottage is modest and practical rather than a grand magical laboratory. It is both Mara's home and workplace.

### Sublocations

Use existing sublocation mechanics for:

- the garden / arrival area;
- the cottage interior floor;
- Mara's bed;
- a work table with an ordinary surface inventory;
- alchemical shelves with an ordinary container inventory.

The stove/hearth is an authored environmental fixture. No new cooking or brewing action is added.

The shelves may visibly contain jars, bottles, dried herbs, mushrooms, powders, a mortar and pestle, and other ordinary hedge-witch supplies without requiring every described fixture to be a takeable item instance.

## Mara

Keep the existing canonical character ID `hoodedWoman`; do not create a second Mara.

Update her authored AI description so it establishes that Mara:

- lives alone in the secluded cottage beyond the village edge;
- is surrounded by forest;
- grows herbs and mushrooms there;
- prepares medicines, remedies, potions, and simple alchemical mixtures there;
- remains secretive and distrustful of authority;
- has strong practical knowledge of medicine/alchemy but limited magical ability and no academic magical education;
- is sometimes suspected of darker supernatural dealings, but those suspicions are false.

The cottage is canonically her home, sleeping place, private space, workplace, storage space, and ingredient garden.

## Village social context

Mara's position in village society is an open secret:

- many villagers are uneasy about Mara and witchcraft;
- the cottage has an unsettling reputation among respectable locals;
- some of those same people quietly seek Mara for medical advice, remedies, medicines, potions, or private problems;
- people broadly know that villagers visit her, while individuals often avoid publicly admitting that they themselves do so.

This is social hypocrisy and caution, not active persecution.

Do not establish that Mara is outlawed, hunted, routinely attacked, banned from the village, or actually associated with demons.

## Authored known facts

`knownFacts` are authored baseline knowledge about the current world.

### Mara

Mara receives stable authored facts covering:

- `mara_home`;
- `mara_work`;
- `mara_village_reputation`;
- `mara_village_clients`;
- `mara_open_secret`.

### Garrick

Garrick receives local authored facts covering:

- Mara's cottage and location;
- Mara's services;
- local unease about her;
- the open secret that villagers privately rely on her.

These facts do not assert that Garrick personally visits Mara.

### Nell

Nell receives the same ordinary local social baseline from her own perspective: where Mara lives, what she does, the village's unease, and the open secret around seeking her help.

Nell is not made an expert on Mara's private magical life.

### Captain Price

Do **not** add any new authored Mara facts to Captain Price.

Price is an external element from another world. His knowledge of Mara must come only from the actual playthrough through observations, memories, beliefs, and relationships.

### Traveler

Do not inject local Mara facts into the Human-controlled Traveler simply to expose them to the player. The player should learn the social context through the world and its characters.

## Fresh-game behavior

In a new game:

- the cottage already exists;
- Mara already lives and works there;
- the route is available immediately;
- Mara, Garrick, and Nell have their authored local knowledge;
- Price has no retroactive native village knowledge.

There is no cottage-building quest or property-construction mechanic.

## Out of scope

Do not add:

- a full village;
- world clock or schedules;
- time skip;
- farming/harvesting/regrowth;
- potion crafting or recipes;
- dynamic customers;
- reputation mechanics;
- cottage construction;
- property ownership;
- witch-hunt plot;
- new AI psychology systems.

## Acceptance criteria

1. `street <-> villageEdge` exists.
2. `villageEdge <-> secludedCottage` exists.
3. The cottage is in a forest clearing apart from normal village homes.
4. The garden visibly contains cultivated herbs and mushrooms.
5. The cottage contains a bed, stove/hearth, work table, and alchemical shelves.
6. Existing bed/table/container mechanics are reused.
7. Mara remains the existing `hoodedWoman` character.
8. Mara's authored AI description establishes the cottage as her home/workplace.
9. Mara, Garrick, and Nell receive appropriate authored local facts.
10. Captain Price receives no authored Mara facts.
11. Village dependence on Mara is an open secret, not a persecution system.
12. No new engine subsystem is required by this world-content change.
