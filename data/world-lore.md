# World Continuity Notes

Human/developer reference only. The runtime must not load, parse, validate, export, save, prompt with, or include this file in Emergency Dump output.

## Village Week

The local seven-day week is:

Sunday → Monday → Flamesday → Flowday → Woodsday → Goldsday → Earthsday.

The current authored starting point is Monday evening.

## The Road Merchant

A recurring young road merchant follows a wider circuit through settlements beyond the currently simulated village. He is a wagoner-adventurer as much as a trader: curious, energetic, comfortable with risk, and more attached to life on the road than to accumulating wealth for its own sake. He has already seen serious violence and hardship on the road, so his friendliness is paired with the measured distance and courtesy of an armed man who assumes other people may also be armed.

His regular return opportunities are Monday Morning and Woodsday Morning. After a true return, his default planned departure is the following Morning, but while he is locally present he may deliberately defer an imminent departure by one coarse period at a time. After actual departure he needs three fully completed timelapse periods on the road before he can use a later regular return opportunity; an opportunity reached too early is missed rather than replayed later. While away, his life is deliberately not simulated by the game engine.

His broader road life includes moving between villages and larger market towns, buying local goods, selling them farther along his route, acquiring regional and city-made stock, maintaining his wagon and oxen, hearing outside news and rumors, and hiring extra guards when a route looks dangerous.

The villagers already know him. They generally enjoy his arrivals because he brings goods, outside news, road stories, and a break from village monotony. He knows the regular villagers but does not begin as anyone's intimate friend or factional ally. He treats them broadly as familiar customers and acquaintances. Village gossip interests him little unless it affects safety, trade, travel, or is genuinely unusual; rumors about Mara and demons are not a special preoccupation.

## Armored Wagon

The merchant's wagon is an unusually heavy four-ox covered vehicle built from thick oak and reinforced or patched with tin and iron. It functions as cargo transport, road home, and mobile defensive position.

A closable roof hatch mounts a costly heavy mechanical repeating crossbow. A magazine/hopper supplies several heavy bolts, and a lever-driven mechanism lets one operator repeatedly cock a bow with very high string tension. It is specialist machinery: the merchant can maintain and operate it, but major repairs require expertise beyond ordinary village craft.

The weapon is intended to stop attackers. A hit can badly wound or kill lightly armored people. Exceptional plate may resist penetration, but the impact can still knock a person down or out of the saddle. On dangerous road legs the merchant commonly hires several melee guards with wooden shields to hold attackers away from the wagon while he fires from above. These guards and road battles are setting facts, not currently simulated persistent entities/mechanics.

The wagon interior is a cramped lived-in cargo room with a narrow mattress, tied-down crates, travel gear, and a small iron-bound private chest.

## Trade Context

The merchant commonly brings goods the village does not make in useful quantity or variety: salt, dyed cloth, simple town clothing, good leather goods, needles and sewing supplies, soap, modest jewelry, paper, writing sets, specialized small tools, and occasional small luxuries.

The village itself produces practical local goods. Current examples intended for external sale include small-game pelts, Mara's potions/salves, and ordinary farm produce from Radovan and Bozhena's household. Harlan's smithy is a source of nails, horseshoes, fittings, repairs, and other practical ironwork. The farm supplies much of Garrick's regular food stock and may sell or trade grain, root vegetables, garden produce, wool, or similar local products.

Do not treat current exact engine-side external sale values as universal cultural price knowledge. A later economy pass may define approximate common market knowledge/ranges shared by characters.

## Merchant sale chest

When the road merchant is visiting, he sets a locked sales chest beside the armored wagon on the Market Square. His fresh city/regional stock is kept in that chest, while goods he buys from villagers travel in his personal carried inventory until the visit ends. The chest leaves with the wagon.

## Arcane slab indexed lore

Mara's Slab of Full Arcane Knowledge has a growing authored reference index layered over its broader abstract-study behavior. Indexed subjects return canonical text rather than model-generated lore.

**Chuhaister The Forest Man.** Old woodland bestiaries describe Chuhaister, also called the Forest Man, as an enormous shaggy forest person generally friendly or indifferent toward people and hostile to dangerous demons and other predatory beings of the wild. Mallowstead's authored Chuhaister is nearly three metres tall, broader than any villager, covered in coarse greying hair, blue-eyed, intelligent rather than bestial, and able to make his blue eyes glow brightly at will as a voluntary expressive emphasis. He can also play a sopilka whose wild music gives nearby listeners a strong urge to dance without mechanically forcing them to do so. Some traditions associate the Forest Man with broad trampled clearings and food left by people in the woods. The slab article remains reference lore: reading it does not itself reveal Mallowstead's Trampled Glade or the concrete Chuhaister Character.

The current authored secret lifecycle uses Trampled Glade as his only local place. While Chuhaister is inactive he remains a fully persistent canonical Character off-map, with mind and inventory preserved, but does not appear in normal local/player-facing character selectors. During Evening, if any amount of edible food lies on the ground at the glade, each ordinary tick receives one 10% appearance opportunity. A successful appearance is preceded by a sudden grounded wind event; only characters who actually perceive that appearance discover the concrete Character. While active he cannot leave the glade. At the next timelapse boundary he becomes inactive again, and remaining edible food on the glade is silently consumed in place, leaving reusable empty dishes where the item's normal consume transform does so. These mechanics are authored through the `chugaister` secret rather than hard-coded story branches in the engine.

**Outer-World Construct Hypothesis.** A small and unfashionable school among the archmages of Veyra proposes that experienced reality may be a self-sustaining magical construct, or in a stranger formulation the dream of such a construct. The hypothesis permits entities originating outside the construct to enter it under rare conditions while carrying properties native magic can observe without fully explaining. No known divination, planar experiment, soul-reading, or causal test can currently prove or refute the hypothesis by distinguishing an underlying reality from a sufficiently complete construct. It remains philosophical speculation rather than accepted cosmology.

## Chort's Rock

Chort's Rock is a huge round boulder, roughly five metres high, standing alone in otherwise flat cultivated fields. Roughly twenty metres around it is traditionally left unploughed and has gone to grass, weeds, and bushes before cultivated ground resumes. The villagers regard the immediate ground as unclean and avoid working it; contradictory local stories associate the stone with нечистая сила without establishing one objective supernatural explanation.

The rock itself is ordinary common local knowledge and does **not** belong to the `medallion` secret. As of `0.1.4c-farmers` it is a canonical playable location reached from the farm field. Materializing the rock does not reveal Harlan's private iron provenance or any other `medallion`-secret fact.

## Harlan's Medallion Secret

The optional `medallion` secret adds Harlan's strange iron medallion and its private provenance. Harlan found an unusual piece of iron near Chort's Rock and then felt an inexplicable certainty that he had to make one particular small medallion from it. He worked the piece with extraordinary care and without a proper sketch, experiencing the dense interlaced animal-geometric engraving as though each next line were being remembered rather than invented. The finished pattern resembles old northern knotwork and branching/trident-like motifs without matching a known local sign.

Harlan cannot explain the compulsion. He is nevertheless certain that he must eventually give the medallion to someone he personally judges worthy. Worthiness is entirely Harlan's character-level judgment based on the person he comes to know; there is no deterministic threshold, quest flag, morality score, or authored whitelist.

The medallion is displayed conspicuously in the smithy's front room behind the glass of a locked wall frame. Good glass is expensive and unusual in the village, making the display itself evidence of how seriously Harlan treats the object. Harlan carries the frame's ordinary physical key. The frame uses the generic transparent keyed-container mechanic: the medallion can be seen without the key but cannot be physically manipulated through the container until ordinary key access is available.

No objective soul, curse, possession, artifact intelligence, magical power, or other supernatural medallion mechanic is defined as of `0.1.4c-farmers`. The true cause remains deliberately unspecified for later design.

## Farm Household and Lower Stream

Radovan and Bozhena keep the working farm beyond Village Edge with their fifteen-year-old daughter Zlata and several younger children. Only Radovan, Bozhena, and Zlata are currently full simulated Characters. The younger children are canonical household members but remain background population: their presence is conveyed through family knowledge, dialogue, toys, bedding, a hanging cradle for the youngest, and other traces rather than through invisible or non-interactable pseudo-characters.

Radovan is cheerful, easy-going, a little overweight, fond of good food and children, and deeply attached to the household he and Bozhena built. He tends to answer Bozhena's practical scolding with humor. He may joke or flirt lightly with Nell but has no present wish to betray his wife. Bozhena is capable, industrious, practical, somewhat gloomy and habitually scolding; she loves Radovan, understands his temperament, and is more likely to grumble at his flirting than seriously fear he will leave. Zlata combines her mother's stubbornness with her father's appetite for life, filtered through ordinary adolescent nervousness, self-consciousness and overthinking. She works substantially around the farm and is explicitly a minor.

The farmhouse is a whitewashed earthen mazanka under a thatched roof. Entry from the farm yard first reaches the utility/work room and then the living room. A large clay/masonry stove forms the household's warm center. Radovan and Bozhena normally sleep on its sleeping platform; Zlata normally sleeps on a broad wall bench. In cold weather the family is understood narratively to crowd onto or around the stove, while in warmer weather the younger children use wall benches and the smallest child sleeps in the cradle suspended from the ceiling. No weather-dependent sleep scheduler is implied.

The farm yard doubles as a kitchen garden and household work space. Beyond it lies the cultivated field, with separate playable routes to Chort's Rock and to the farm stream crossing. The stream crossing is downstream from the wooded stretch that passes Mara's garden: the same watercourse descends from the mountains through the forest, leaves the trees near the flatter farmland, passes the farm fields and simple plank crossing/watering place, and then continues off-map across the plain while gradually widening. The family chiefly uses this lower access for livestock and irrigation.

The household's ordinary village ties are practical. Garrick is a major regular buyer of farm food. Harlan supplies and repairs iron tools, blades, hinges, fittings and cart hardware. Maksym's visits are welcome mainly for salt and occasional unusual small goods or trinkets; the family is not a major luxury customer.

The family openly fears Mara, especially on behalf of the younger children, and normally avoids her. Yet they have gone to her in serious need, particularly when children were ill, and she helped them. Mara understands their fear, is privately sympathetic to the family and especially the children, and normally keeps her distance because she believes that not imposing her presence is kinder and safer for everyone. If they genuinely need help she gives it without demanding closeness.

Nell treats the household with unusual tenderness and protectiveness because it consciously or subconsciously resembles the family and home she lost. This also makes her more anxious than usual about something terrible happening to them. The farm is not authored as a replacement-family quest; the resemblance is simply emotionally significant to her.

## Village Well

A maintained public well stands on Street near the tavern frontage with a long communal bench beside it. It is the village's ordinary drinking-water well and a natural social stopping point. Raising its bucket always produces ordinary cold clear water as grounded outcome text; the interaction does not create a portable bucket or water item and has none of the Old Well's coin/wine randomness. The Old Well at Village Edge remains a separate avoided and uncanny place.

## Nell and Garrick's Tavern Arrangement

Nell's place at Garrick's tavern is not a modern equal-wage job. In material terms she works for food, shelter, safety, and a stable place in the tavern household. By modern standards the dependency is markedly unequal and semi-servile. This should not be romanticized into ordinary twenty-first-century employment, but neither is the current relationship authored as constant coercion or captivity.

Years of ordinary life have produced stable situational trust. Garrick does not expect Nell to disappear without warning, and Nell does not currently plan to do so. Morning is generally Nell's free time when there is no genuine work: Garrick may ask for help when the tavern actually needs it, but he does not invent chores merely to keep her supervised. He has genuine paternal/guardian-like feelings toward her and also rationalizes the freedom practically: a cheerful, lively Nell is good for the room and for business.

During the Day Nell understands that she needs to return and help prepare the tavern before Evening. The existing deterministic Evening routine anchor remains the canonical boundary guarantee that places her back on the Common Room floor for her ordinary waitress/barmaid role; no separate professional scheduler or Morning anchor is implied.
