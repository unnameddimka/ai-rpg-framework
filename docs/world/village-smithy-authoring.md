# Village Smithy and Blacksmith Authoring Update

## Scope

This is a world-authoring/content update using existing mechanics only.

Add a low-tech village smithy and one new AI-controlled blacksmith. Do not introduce smithing simulation, profession systems, schedules, economy mechanics, romance code, combat mechanics, or special blacksmith-only engine actions.

## 1. Location topology

Add a new top-level location:

```text
villageSmithy
```

Visible name:

```text
Smithy
```

Connect it reciprocally to:

```text
street ↔ villageSmithy
```

The Street description should make clear that the smithy entrance stands near the village temple.

## 2. Smithy tone

The smithy is an ordinary grounded low-tech working forge with no franchise/meta references and no flashy setting-specific lore.

It should visibly contain or describe:

- a working forge/hearth;
- an anvil;
- a scarred workbench;
- iron bars/blanks and scrap;
- half-finished practical metalwork;
- hammers/tongs and normal forge clutter;
- a grindstone/sharpening wheel in one corner;
- soot, heat, scale, and signs of constant practical labor.

The shop is mainly for everyday village needs, not a dedicated sword/armor workshop.

## 3. Interior structure

The main work area is the location default.

Use authored sublocations for practical positioning, including at minimum:

```text
smithyForgeArea
smithyLivingRoom
smithyLivingBed
```

The rear living room is modest and functional: bed/sleeping space, sparse personal storage, simple domestic necessities, and little decoration.

`smithyLivingBed` uses the existing sleep capability so the blacksmith has a normal authored sleeping place.

## 4. Blacksmith

Add stable character ID:

```text
blacksmith
```

Visible name:

```text
Harlan the Blacksmith
```

He starts AI-controlled in:

```text
villageSmithy / smithyForgeArea
```

He begins with a normal smith's hammer equipped in `right_hand`.

## 5. Characterization

Harlan is a serious, practical, businesslike working man, but not humorless. His humor is usually dry and understated.

He is slightly arrogant and privately regards himself as something close to an informal ruler/pillar of the village because nearly every household eventually depends on his work.

He values usefulness, competence, settled obligations, and people who understand the practical limits of their own domain.

His ordinary trade centers on mundane work:

- nails, especially in quantity;
- horseshoes;
- small iron fittings for tack/harness and ordinary household/agricultural use;
- straightening/repairing practical tools;
- sharpening or repairing knives, axes, and scythes.

He may work on more unusual pieces when needed, but he is not authored primarily as a weapon smith.

## 6. Garrick relationship

Harlan and Garrick dislike one another personally but respect one another's competence and local importance.

They have an implicit boundary between their spheres of influence and generally avoid stepping across it.

They speak relatively little and are not active enemies.

Seed this relationship reciprocally where appropriate.

## 7. Nell relationship

When Harlan drinks at the tavern, Nell is usually the person there he most naturally talks to.

He likes her and finds her good company.

This is explicitly friendly/familiar rather than sexual or romantic:

- no sexual attraction seed;
- no romantic longing seed;
- no hidden seduction agenda.

Seed reciprocal familiarity where appropriate without forcing Nell into any particular future emotional development.

## 8. Mara relationship

Harlan shares the ordinary local caution around Mara and witchcraft, but his relationship is grounded by repeated practical experience.

He has gone to Mara several times for treatment of burns and other injuries associated with forge work.

He therefore combines:

- caution;
- reluctance to advertise the association;
- respect for her actual skill and usefulness;
- no special intimacy or open hostility.

Mara should know him as a repeat practical patient/customer.

## 9. Price

Captain Price is an outsider and has no authored pre-existing relationship with Harlan.

Do not seed a relationship between them.

## 10. Tavern behavior background

Harlan may sometimes go to the tavern in the evening to drink.

This is characterization/background only in this authoring patch. Do not add a schedule mechanic.

At the tavern he tends to speak with Nell more than Garrick, without implying that Nell is the reason he goes there.

## 11. Appearance/equipment

Follow the current equipment-based appearance architecture.

Harlan's base `playerDescription` describes intrinsic physical appearance and bearing, not current clothing.

Add a coarse `clothing` item for his work clothes, suitable for heat/soot/heavy labor and including a practical leather apron in the equipped description.

Add a normal smith's hammer item definition and start its instance equipped in:

```text
right_hand
```

Do not add special hammer mechanics in this patch.

## 12. Seed knowledge

Seed factual local awareness so existing village residents know the village has a blacksmith and who he is, where appropriate.

Harlan should know Garrick, Nell, and Mara from established local life.

Do not seed prior knowledge/relationship with Price.

Keep factual known facts separate from subjective relationship summaries.

## 13. Acceptance

After the update:

1. Street has a reciprocal exit to the Smithy near the temple;
2. Smithy has grounded low-tech forge description and rear living space;
3. Harlan starts at the forge as an AI character;
4. Harlan has equipped work clothing and a hammer in `right_hand`;
5. he has a real sleeping bed in the rear room;
6. Garrick/Harlan mutual dislike + respect is seeded;
7. Harlan/Nell friendly non-romantic familiarity is seeded;
8. Harlan/Mara wary practical treatment history is seeded;
9. no pre-authored Harlan/Price relationship exists;
10. world generator, tests, and production build pass.

## 14. Existing-save authoring reconciliation

The blacksmith is a newly authored stable character, so compatible older saves that predate him must receive the fresh authored Smithy, Harlan, and his authored starting equipment through the normal fresh-authoring-plus-runtime-overlay migration model.

Existing characters should also receive authored relationship seeds that target a genuinely new character that did not exist in the saved world. Implement this generically rather than with a Harlan-specific migration exception: saved relationships to characters that already existed in the old save continue to win, while an authored relationship whose target character is genuinely new may be added if no saved record for that target exists.

This lets Garrick, Nell, and Mara know their established local relationship with a newly introduced Harlan without resetting or overwriting unrelated relationships already developed during play.
