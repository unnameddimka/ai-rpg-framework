# Weekly Rhythm and Traveling Merchant — World Specification

Status: world-content / authoring specification  
Scope: concrete village content built on the companion engine specification  
Engine dependency: `docs/engine/weekly-rhythm-scheduled-presence-bulk-transfer-paper.md`

## 1. Purpose

This document defines the concrete world content for the first weekly-rhythm implementation:

- the village's weekday names and starting day;
- the traveling merchant's recurring visits;
- his personality and baseline relationships;
- Market Square;
- his armored wagon/home;
- his initial/restocked merchandise;
- limited external-sale values for initial natural-wage goods;
- Paper Sheets and Writing Sets as ordinary world goods;
- a human-only continuity/lore document for future world authoring.

This file should contain **world facts**, not generic engine architecture.

---

## 2. Village Week

Use this exact weekday order and spelling:

1. **Sunday**
2. **Monday**
3. **Flamesday**
4. **Flowday**
5. **Woodsday**
6. **Goldsday**
7. **Earthsday**

A new world starts on **Monday evening**.

The world UI should therefore initially show Monday as the current weekday.

No months are introduced in this patch.

---

## 3. Traveling Merchant: Discovery and Identity

Author one traveling merchant as a normal AI character.

Choose a fitting in-world name during implementation, but do **not** preannounce or explain that name in player-facing onboarding/patch prose. The intended experience is that the player enters the world and discovers what he is called naturally, as with Harlan.

Approximate age: **around 30**, clearly younger than Garrick and Harlan.

He is not a stereotypically greedy shopkeeper. He is a traveling wagoner, trader, and adventurer whose commerce is inseparable from life on the road.

### 3.1 Personality core

He should be authored as:

- energetic and still visibly young;
- driven by curiosity, appetite for life, and desire to keep moving;
- already experienced with danger and unpleasant realities of the road;
- practical rather than cynical;
- comfortable with weapons without swaggering about them;
- difficult to intimidate, but not eager to provoke violence;
- interested in useful goods, good workmanship, stories, distant places, and news;
- capable of bargaining firmly without making greed his defining trait;
- likely to settle someday, but not yet emotionally ready to stop traveling.

### 3.2 Social manner

His manner should feel Cossack-like in the broad character sense:

- relaxed self-possession;
- informal confidence;
- dry humor rather than loud clowning;
- understated teasing and small verbal jabs;
- may smirk into his moustache instead of performing for a room;
- treats other people with the caution of an armed man who assumes they may also be armed;
- maintains a little physical/social distance;
- avoids needlessly cornering or publicly humiliating people;
- understands that casual disrespect among armed people can create unnecessary bloodshed.

He should feel polite because he understands consequences, not because he is timid or aristocratic.

---

## 4. Baseline Relationships With Villagers

The merchant is **already known in the village**. This is a recurring route, not his first-ever arrival.

Do not author unusually deep or preferential starting relationships with individual villagers.

### 4.1 Villagers toward the merchant

The villagers generally:

- know who he is;
- are accustomed to his visits;
- like seeing him arrive;
- experience his visits as a welcome break in village monotony;
- value the outside goods he brings;
- also value the outside news, road stories, rumors, and anecdotes he brings with him.

His arrival should have some of the social feeling of a small event without making him a celebrity or intimate family friend.

### 4.2 Merchant toward villagers

He likewise knows the regular villagers, but his baseline stance is approximately even across them:

- cordial familiarity;
- recurring customers/acquaintances;
- people he may drink, joke, or bargain with;
- no special initial favorite;
- no strong starting factional allegiance.

He largely treats villagers as customers and familiar local contacts rather than becoming absorbed in village politics.

He has **low interest in local gossip for its own sake**. In particular, rumors such as Mara supposedly having connections with demons should not be authored as a major concern or fascination for him. Unless a rumor affects safety, trade, travel, or something directly interesting to him, he is inclined to treat it as background village chatter.

This does not prevent relationships from evolving naturally through play.

---

## 5. Weekly Visit Schedule

The merchant's regular arrival days are:

- **Monday**
- **Woodsday**

Recurring visits begin with him already present in the village in the morning and end across the following overnight boundary. The one fresh-world Monday-evening bootstrap is authored separately: Maksym starts in the tavern at the second table with one filled mug of ale, while subsequent scheduled arrivals continue to use Market Square.

Exact local pattern:

- Monday morning: present
- Monday daytime: present
- Monday evening/night: present
- Flamesday morning: already absent
- Flowday: absent
- Woodsday morning: present
- Woodsday daytime: present
- Woodsday evening/night: present
- Goldsday morning: already absent
- Earthsday: absent
- Sunday: absent
- next Monday morning: present again

“Leaves in the morning” specifically means **the new morning starts after he has already gone**. Do not show the wagon still standing there waiting for an explicit departure action.

While present he is a completely ordinary local AI participant. He may remain near his wagon, wander, trade, visit Mara/Harlan/others, or spend time drinking/socializing at the tavern.

While absent, neither he nor his wagon participates in local timelapse/model simulation.

A normal visit naturally gives him the existing maintenance passes associated with:

1. the daytime timelapse;
2. the evening/night timelapse before the next morning's absence is applied.

Do not invent extra special merchant-only maintenance.

---

## 6. Market Square

Add a permanent top-level village location:

**Market Square**

It exists every day whether the merchant is present or not.

When he is away, the square is simply empty of his caravan/wagon content. It should not look as if the wagon is invisibly parked there.

The Market Square may later host other temporary/weekly content, but that is not required now.

---

## 7. Armored Wagon / Mobile Home

The merchant travels with a very heavy covered wagon drawn by **four oxen**.

The wagon is a persistent canonical world location but is locally exposed only during his visits.

### 7.1 Exterior concept

The wagon should feel almost like a primitive mobile armored vehicle:

- thick oak construction;
- heavy reinforced sides;
- patched/reinforced in places with tin and iron;
- built to survive bad roads and attacks rather than to look elegant;
- large/heavy enough that four oxen make sense.

### 7.2 Defensive roof weapon

The roof has a closable hatch mounting an expensive heavy mechanical repeating crossbow.

World concept:

- several heavy bolts can be fed from a magazine/hopper arrangement;
- a lever/mechanical system allows one person to re-cock a very high-tension bow repeatedly;
- the mechanism is complex, costly, and not ordinary village craftsmanship;
- it can be fired from the wagon while stationary and, when necessary, on the move;
- against light armor a hit can badly wound or kill;
- against exceptional heavy plate it may fail to penetrate fully but can still produce a crushing impact capable of knocking a person down or out of the saddle;
- its tactical purpose is primarily to **stop an attacker**, not magically pierce every possible armor.

The merchant commonly hires several melee-oriented guards on dangerous road legs. Their role is to hold people away from the wagon behind wooden shields while he uses the mounted crossbow from above.

This is setting/character truth only in this patch. Do not implement a mounted-weapon combat subsystem or mandatory persistent guard party.

### 7.3 Wagon interior

The wagon interior is an ordinary small lockable location: cramped but genuinely lived in.

Include at minimum:

- a narrow mattress/bunk or practical sleeping arrangement among the cargo;
- crates / ordinary storage;
- one lockable private container for valuables/personal belongings.

It should feel like a working traveler's bedroom and cargo room, not a luxurious caravan salon.

### 7.4 Entrance/key

The wagon is connected to Market Square through an ordinary lockable passage while present.

- default state: locked;
- matching key: carried by the merchant;
- normal keyed traversal rules apply.

The wagon and its entrance disappear from the player's local topology when the merchant is away, but all canonical wagon state persists.

---

## 8. Merchant Merchandise and Restock

Every Monday/Woodsday arrival starts a new sale-stock cycle generated from authored definitions.

Use variable subset/quantity rules so successive visits need not look identical.

### 8.1 Core stock character

Favor things the village does not normally produce itself, especially regional or town-made goods:

- **salt**;
- dyed cloth;
- simple ready-made clothing;
- belts, gloves, or similar decent city-made leather goods;
- needles/sewing supplies;
- soap;
- small/simple jewelry such as a brass brooch;
- **Paper Sheets**;
- **Writing Set**;
- specialized small tools not normally made by Harlan;
- occasional modest luxury/interesting item.

Avoid using his standard stock to undercut core village production, especially ordinary nails/horseshoes that are part of Harlan's role.

### 8.2 Locked sale chest

While the merchant is present, place a separate ordinary **locked sales chest** beside the wagon on Market Square.

- It uses the existing keyed-container contract (`requiredKeyItemId`), not a new container-lock subsystem.
- The matching sale-chest key is carried directly in the merchant's personal inventory.
- Fresh arrival restock is generated into this chest.
- The player can see that the chest exists while the merchant is present, but cannot inspect its contents without the key.
- The merchant can access the chest normally with his key and also receives a grounded compact list of his current sale stock in his private AI trade context, so he can discuss what he has for sale even when conversation happens away from the chest (for example in the tavern).
- The chest leaves local topology together with the wagon when the merchant is away; its canonical state remains persisted.

Goods the merchant buys from villagers are **not** placed into this sales chest by the lifecycle mechanic. Direct character-to-merchant item transfers become acquired trade stock in his personal carried inventory and remain there until departure settlement or another explicit grounded transfer moves them.

His personal clothes, weapons, wagon key, sale-chest key, travel equipment, private-container contents, and defensive equipment are not merchandise merely because they are item instances.

Author stock/provenance accordingly. Moving the merchant's own generated sale merchandise between his sales chest and his carried inventory must preserve its `sale_stock` role; handing it to another character ends that merchant-sale provenance.

---

## 9. Initial Natural-Wage Economy Hooks

Do not create a full village price table in this patch.

For now, author explicit external merchant-sale values only on selected goods that are intended to let the player turn material wages into gold.

At minimum include:

- **squirrel pelts**;
- **Mara's potions** used as material compensation/product;
- **Mara's ointments/salves** used as material compensation/product.

Choose simple concrete initial values during implementation that make the first loop usable; these are balancing data, not a claim that every character knows a universal exact price list.

The merchant is allowed to see these external-sale values as grounded information when deciding what he can afford to offer.

He does not have to pay that exact amount. He bargains as a character. His profit is simply whatever remains between what he paid locally and what the supported good realizes when settled off-map.

Goods without authored external-sale value are not automatically liquidated for invented gold.

A later patch may add broadly shared approximate market-price/common-knowledge ranges.

---

## 10. Commerce Behavior in This Patch

There is no special formal Trade action yet.

Intended interaction:

1. player/NPC and merchant negotiate in ordinary dialogue;
2. one side uses grounded bulk/single item transfer;
3. gold is transferred through the existing grounded gold-transfer mechanism;
4. the resulting world state is real even though the overall negotiated deal is not one atomic transaction.

AI villagers and the merchant should be able to use the same bulk-transfer capability as the player.

This is intentionally enough for the first version.

---

## 11. Paper Sheets and Writing Sets as World Goods

Add ordinary item definitions/content for:

### Paper Sheet

- portable ordinary item;
- writable instance-level `content` field supplied by the engine mechanic;
- may be sold by the merchant;
- may be transferred, stored, left on tables, given to characters, etc.

### Writing Set

- reusable portable tool/capability item;
- may be sold by the merchant;
- no consumable charges;
- possession/access allows a character to write or draw on a Paper Sheet.

Content convention:

```text
Literal writing appears verbatim.

*a rough little house is drawn here*
```

Single-asterisk passages are descriptions of drawings/visual marks; all other text is literal writing.

The user/AI may fully replace the existing paper content when using the grounded writing action.

---

## 12. World Continuity Reference Document

Add a human-maintained documentation file alongside the authored world material, preferably under the world documentation/data area with an obvious name such as:

`world-lore.md`

This is **not a game resource**.

Its only purpose is to help us remember stable setting facts so future additions do not contradict earlier worldbuilding.

Seed it with the stable facts established by this patch, including at least:

- weekday names/order;
- the merchant's recurring Monday/Woodsday route through the village;
- the fact that he spends the rest of his life traveling/trading outside the modeled village;
- broad concept of his wagon/road lifestyle;
- the fact that surrounding towns/regions supply goods such as salt, cloth, paper, tools, and small luxuries;
- any off-map road/trade facts chosen during implementation that should remain stable later.

### 12.1 Absolute runtime boundary

The runtime must not know this document exists.

Do not:

- load it;
- parse it;
- validate it;
- send it to models;
- use it for prompts;
- put it in saves;
- put it in Emergency Dump;
- derive canonical state from it;
- mutate it through the editor/runtime.

Changing or deleting this file must have zero effect on game behavior.

---

## 13. Initial World State

The implementation should author a new-world state satisfying all of the following:

- current day is Monday evening;
- merchant is already present, seated at the second tavern table;
- merchant has one normal tracked filled mug of ale as his current drink;
- Market Square exists;
- wagon is present/reachable from Market Square subject to its lock;
- merchant carries the wagon key;
- merchant has appropriate ordinary personal clothing/weapons/travel gear;
- wagon has its sleeping arrangement and private lockable storage;
- initial sale stock exists according to the authored restock system;
- Paper Sheets and Writing Sets can appear in that stock;
- squirrel pelts and Mara's relevant potions/salves have the initial supported external-sale metadata;
- merchant and villagers begin with cordial familiar-recurring-visitor relationship framing rather than intimate bonds;
- merchant knows his own Monday/Woodsday schedule through canonical schedule grounding.

Do not add farmer NPCs merely to complete a hypothetical future economy in this patch.

---

## 14. World Acceptance Criteria

### Calendar / visits

- The displayed weekday sequence uses exactly: Sunday, Monday, Flamesday, Flowday, Woodsday, Goldsday, Earthsday.
- A fresh world starts Monday evening with the merchant present at the second tavern table with one filled mug of ale.
- Later scheduled Monday/Woodsday arrivals still place the merchant at Market Square.
- Flamesday morning starts with merchant and wagon already gone.
- Flowday has no merchant/wagon local presence.
- Woodsday morning starts with them present again.
- Goldsday morning starts with them already gone.
- Earthsday and Sunday are absent days.

### Social behavior

- Villagers know the merchant and are broadly pleased when he arrives because he brings goods, news, rumors, and stories from outside.
- No villager begins with an unusually privileged/deep relationship to him merely because of this spec.
- He knows the villagers but treats them with broadly even cordial-commercial familiarity.
- His authored baseline does not make Mara/demon gossip a special obsession or prejudice.
- He can still develop new preferences/relationships naturally through gameplay.

### Market / wagon

- Market Square exists permanently.
- Away days leave the square empty of the wagon rather than exposing an inaccessible visible wagon.
- Present wagon is an ordinary lockable location with persisted interior state.
- Merchant carries the matching key.
- Interior contains a practical sleeping place and private lockable storage.

### Stock / economy

- Each arrival refreshes authored sale stock with some variability.
- Stock includes plausible outside/regional goods and can include Paper Sheets/Writing Sets.
- Personal equipment/key/private contents are never treated as sale stock.
- Initial selected natural-wage goods have concrete external-sale values visible to the merchant.
- No universal item price system is implied.

### Documentation

- A human-only world continuity document records stable off-map/worldbuilding facts.
- Runtime behavior does not depend on that document in any way.

---

## 15. World Principle Summary

The merchant should make the village feel connected to a larger world **without requiring us to simulate that larger world**.

When he arrives, he brings goods, money, news, road stories, and social novelty. While present he is simply another full AI person who can wander into the tavern and form real experiences. When absent, he and the wagon are genuinely outside the local simulation, while their persistent canonical state waits for the next visit.

His baseline relationship to the village is warm familiarity without special intimacy: people are glad to see him because life becomes less boring, and he is glad to deal with familiar customers without becoming emotionally invested in every village rumor.
