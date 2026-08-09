# Task: Tavern World Expansion — Captain Price, Nell, and Upstairs Rooms

## Scope

This is world authoring in `data/world.json` using existing mechanics plus the generic blocked-transition capability. No character-specific engine code or scripted behavior is introduced.

## Captain John Price

Add AI-controlled **Captain John Price** exactly as the recognizable modern Call of Duty character, with no fantasy conversion and no explanation for his presence.

Initial state:

- in the common room at the second table, next to Mara's table;
- one concrete `mugOfAle` item instance in Price's inventory;
- three additional concrete `mugOfAle` instances on the second table.

His AI description presents him as a seasoned British commander: observant, pragmatic, calm, direct, dryly funny, and capable of rough friendliness. He is currently off duty, drinking and resting. He is not looking for missions, fights, errands, or busywork and primarily serves as a conversational character.

## Nell, tavern waitress

Add AI-controlled **Nell**, approximately eighteen years old.

Appearance and history:

- poor, repeatedly mended but clean and carefully kept clothing;
- cheerful and approachable but visibly a little cautious around unfamiliar patrons;
- her parents were killed and her nearby village home burned by bandits a few years ago;
- the innkeeper took her in;
- she works largely for food, shelter, and safety;
- she sleeps in a tiny nook beneath the common-room stairs.

Personality and ordinary role:

- cheerful, friendly, helpful, and non-intrusive;
- aware of her low social status;
- somewhat nervous around threatening, armed, wealthy, drunk, or angry customers;
- moves around the tavern, collects empty mugs, returns them toward the bar, and sometimes asks guests whether they want anything else;
- when a patron clearly gives her money to buy ale, she normally takes payment to the innkeeper, obtains ale from him, and returns it to the patron.

This workflow remains emergent model behavior using existing atomic actions and continuation. There is no waitress script, service action, transaction state machine, action queue, or quest entity.

Nell starts standing on the common-room floor.

## Sleeping nook

Add a cramped, clean sleeping nook beneath the common-room stairs as an ordinary common-room sublocation. Nell does not start there.

## Upstairs

Add a normal traversable stair connection:

`Common room <-> Upstairs corridor`

Add five actual room locations off the corridor:

1. Innkeeper's room
2. Guest room 1
3. Guest room 2
4. Guest room 3
5. Guest room 4

The five corridor-to-room transitions are initially blocked with the authored failure text:

`The door is locked.`

The rooms themselves contain only minimal authored descriptions. No guests, loot, rental mechanics, keys, or unlocking mechanics are added yet.
