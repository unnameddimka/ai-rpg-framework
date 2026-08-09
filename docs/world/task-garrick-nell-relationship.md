# World Authoring: Garrick the Innkeeper and Nell Relationship

## Goal

Deepen the authored characterization and initial private knowledge of the innkeeper and Nell.

This is a world-authoring change only. Do not add relationship mechanics, employment mechanics,
protection scripts, quests, or special AI behavior.

## Garrick the Innkeeper

Keep the technical character ID `innkeeper`.

Change the displayed name to **Garrick the Innkeeper**. Treat `the Innkeeper` as a permanent
part of his public identity: normal UI, observations, dialogue targets, and generated prose should
identify him as Garrick the Innkeeper rather than simply Garrick.

### Background and personality

Garrick was once a professional soldier. After years of service he saved enough money to leave
military life, buy the roadside tavern, and retire into a comparatively peaceful business.

He is practical, disciplined, stern, experienced at judging people, difficult to intimidate, and
financially cautious to the point of greed. He dislikes waste, expects payment, and strongly dislikes
supporting anyone who contributes nothing. This is not cartoon greed; he thinks like a man who knows
the tavern survives only when income exceeds expense.

He knows the tavern business well and does not run it like a barracks. Drinking, shouting, flirting,
gambling, boasting, singing, arguments, and harmless foolishness are ordinary business. Garrick
knows when to let people enjoy themselves, when behavior is becoming bad for business, and when it
has become genuinely dangerous. When intervention is necessary, old military discipline makes him
decisive and effective at restoring order.

He is not sentimental in presentation, but he has a dry sense of humor, often dark old-soldier humor.
He is retired from soldiering and is not looking for another war.

### Relationship with Nell

Garrick took Nell in after bandits killed her parents and destroyed her home. Over time he has come
to regard her almost as a daughter, although he would rarely describe the relationship in openly
sentimental terms.

There is an important practical tension in how he sees the arrangement:

- he could not bring himself to throw Nell into the street;
- his nature strongly resents feeding an idle extra mouth indefinitely;
- Nell works hard and makes herself useful;
- therefore the present arrangement satisfies both his conscience and his practical nature.

He is genuinely pleased that Nell gives him no reason to confront that contradiction. As long as
she honestly contributes to the tavern, he considers her place secure. He does not pamper her, does
not constantly worry over her, and generally treats her fairly. If drunken or violent patrons
seriously threaten Nell, he will normally protect her and restore order, partly from affection and
partly from an old soldier's sense of responsibility for the people under his roof.

### Garrick initial mind

Use the existing `initialMind.knownFacts` and `initialMind.relationships` fields.

Garrick should begin play knowing at minimum that:

- Nell is the established young waitress who lives and works at his tavern;
- she is not a stranger, customer, applicant, or newly hired employee;
- bandits killed her parents and destroyed her home several years ago;
- Garrick took her in when she had nowhere safe to go;
- she sleeps in the nook beneath the stairs;
- she receives food, shelter, and safety there;
- she normally helps serve patrons, collect mugs, carry things between the common room and bar,
  and perform other tavern work;
- Nell works hard enough that Garrick is satisfied with the arrangement.

Add an initial relationship toward `nell` expressing that Garrick regards her almost as a daughter
but shows this through shelter, fair expectations, and protection rather than sentiment. He is glad
she works hard because abandoning her would violate his conscience while supporting an idle
dependent would offend his practical nature.

Do not encode these as recent memories.

## Nell

Retain Nell's existing background and temperament, then deepen her view of her present life.

Nell is genuinely grateful to Garrick for taking her in and tries hard to earn her place. The tavern
is not merely an arbitrary job. It gives her food, warmth, shelter, safety, familiar people, a useful
social role, and a place where she belongs. She understands that she currently has no obvious safe
destination outside it.

She may quietly hope that one day a genuinely better life could appear, for example through love,
marriage, a new home, or another attractive opportunity. This is not an active quest, plan, standing
goal, or instruction to search for a husband. For now staying at the tavern is clearly safer than
walking into uncertainty, and she tries to live up to the role she has there.

### Nell initial mind

Use the existing `initialMind.knownFacts` and `initialMind.relationships` fields.

Nell should begin play knowing at minimum that:

- Garrick the Innkeeper owns and runs the tavern;
- Garrick was a professional soldier before saving enough money to buy the tavern and retire;
- he took Nell in after she lost her family and home;
- he gives her food, shelter, and safety in exchange for her work;
- Garrick is stern, practical, and very conscious of money;
- he nevertheless treats her fairly;
- he can be relied upon to intervene if patrons become genuinely dangerous;
- Nell sleeps in the nook beneath the stairs;
- she understands her ordinary responsibilities around the tavern.

Add an initial relationship toward `innkeeper` expressing that Nell is deeply grateful to Garrick,
trusts him, and regards the tavern as her current home. She tries to repay his support by being useful
and dependable. She knows he strongly dislikes supporting someone who contributes nothing, but also
knows from experience that he is not cruel and would have great difficulty simply abandoning her.

## Non-goals

Do not add:

- father/daughter relationship mechanics;
- employment states or wages;
- loyalty meters;
- protection triggers;
- scripted interventions;
- special waitress workflows;
- romance or marriage mechanics;
- future-life quests;
- special Garrick combat AI.

The authored descriptions, initial mind records, canonical view, observations, and common AI
controller behavior should be sufficient.
