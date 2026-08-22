# Daytime Timelapse, Jobs, Global Time, and Weather

Status: implemented patch contract. This file records the agreed behavior for the daytime/environment patch. Older task specifications remain historical and are not rewritten by this patch.

## Scope

Add a second five-round coarse-time mode on the existing shared timelapse core, plus global time/weather context and a small authored daytime-activity layer. Do not build a general economy, professional schedule system, price system, crafting system, or editor redesign.

## Global environment

Canonical runtime state owns:

```text
world.environment.timePhase
world.environment.weatherNarrative
```

Valid phases are:

```text
evening
nighttime_timelapse
morning
daytime_timelapse
```

UI labels are `Evening`, `Night`, `Morning`, and `Day`.

A new world begins in `evening`. A legacy compatible save without a phase migrates to `evening`. Ordinary Human/AI ticks never advance time automatically.

The coarse cycle is:

```text
Evening -> Nighttime Timelapse -> Morning -> Daytime Timelapse -> Evening
```

Human `Sleep till morning` is an Evening-only coarse-time entry. Morning does not provide it. Daytime activities are Morning-only.

Every character context and the main game UI receive the same global time and saved weather narrative.

## Weather

Weather is an optional external ambient input, never a gameplay dependency.

Pipeline:

```text
public-IP geolocation -> approximate coordinates -> current weather API
-> deterministic normalization -> narrowly scoped Narrator rendering
-> saved weatherNarrative
```

The weather Narrator receives only normalized current-weather fields and a minimal `rural, low-technology environment` style instruction. It must not receive game time, world lore, characters, dialogue, memories, or scene state. It must not mention time of day, real-world places, APIs, forecasts, modern measurements, people, or invented events.

`weatherNarrative` itself contains weather only; time is displayed separately.

Refresh behavior:

- new world: initialize once an AI key is available;
- compatible old save without initialized weather: initialize the same way;
- save with initialized weather: preserve the saved text on load;
- successful daytime timelapse: refresh after canonical day work and mind maintenance;
- successful nighttime timelapse: refresh before returning to Morning.

If refresh fails, preserve the previous narrative. If no real narrative exists, use the fixed neutral fallback:

> The air is mild and still beneath an unremarkable sky.

Weather failure never blocks gameplay or a successful time transition.

## Day activities as authored data

Day activities are authored entities under `world.dayActivities`. Generic timelapse code must not scatter sponsor-specific branches throughout the engine.

Initial activities:

### Mara assistance

- sponsor: Mara (`hoodedWoman`);
- worksite: Mara's Cottage (`secludedCottage`);
- fiction: garden, water, herb sorting/preparation, nearby unnamed woodland around the property;
- canonical position remains the configured worksite; narration may not claim travel to another named canonical location;
- settlement: Mara chooses 1-3 total ordinary item instances from `Healing Salve` and `Stamina Potion`.

### Harlan forge assistance

- sponsor: Harlan (`blacksmith`);
- worksite: Smithy (`villageSmithy`);
- Traveler performs auxiliary labor while Harlan remains the smith;
- settlement: Harlan chooses 3-7 gold;
- this salary is minted only by successful job settlement and does not come from Harlan's purse;
- Harlan receives no ordinary gold-generation capability.

### Solo hunting

- no sponsor;
- entry/worksite: Forest Stream (`forestMountainStream`);
- Human formal entry: `Go hunting`;
- Morning only;
- Narrator writes one committed hunting passage per round;
- other NPCs continue their normal daytime rounds;
- settlement: engine RNG creates 1-5 `Squirrel Pelt` instances.

Required ordinary item definitions are `Healing Salve`, `Stamina Potion`, and `Squirrel Pelt`. No prices, recipes, buy/sell actions, or special trading rules are added.

## AI job offers

`offer_day_work(activity_id)` is an AI-owned formal action. The sponsor model decides socially whether to use it; the engine does not implement a persuasion roll or relationship threshold.

The action is technically available only during Morning, with no other pending/active day activity, while the Human-controlled Traveler is physically within the sponsor's normal local interaction reach. A neutral stranger asking reasonably for simple work should normally be acceptable, but personality, memories, relationships, recent conflict, or context may justify refusal. Spontaneous offers are allowed when contextually natural but should not be repetitive spam.

Formal Action Precedence applies: once the sponsor has actually decided to offer the tracked full-day job, the formal action must represent that offer rather than narrative alone.

## Blocking work-offer state

A committed job offer creates one pending formal offer and pauses the current causal AI wave.

The UI displays a custom full-screen game overlay with `Accept work` and `Decline`. Native JavaScript confirm/prompt UI is not used. Normal game controls, movement, dialogue, actions, and further causal processing are blocked until resolution.

Only one pending day-work offer may exist.

`Emergency Dump` is a cross-cutting escape invariant and must remain directly usable above this overlay and every other gameplay/migration/AI/timelapse blocking state.

### Decline

Decline:

- resolves the pending offer;
- leaves time in Morning;
- emits grounded refusal feedback to the sponsor;
- resumes the original AI reaction wave;
- preserves already-reacted IDs so no AI character reacts twice in the same Human tick;
- is not a new Human world tick.

### Accept

Accept resolves the offer and immediately begins the daytime activity. It is not a separate ordinary Human tick.

## Worksite preflight

A job may be offered anywhere the sponsor and Traveler physically meet.

At daytime setup, sponsor and Traveler must reach the authored worksite through existing timelapse reachability/path rules. Do not teleport through blocked/locked routes.

If either cannot reach the worksite:

- restore the preflight world state;
- clear the active activity;
- emit grounded failure;
- issue no reward;
- consume no successful daytime round;
- remain in Morning.

After successful preflight, the pair is physically at the worksite before first-round encounters are resolved.

## Daytime timelapse

Daytime is a policy over `24-timelapse-core.js`, not a second independent engine.

It has five sequential committed rounds.

Entering a valid daytime timelapse wakes every character. Successful completion also leaves every character awake.

Free AI NPCs continue ordinary coarse planning. A sponsored job binds its sponsor to the worksite for all five rounds and uses sponsor-authored grounded work narration. The Human worker is physically present but occupied/non-interactive and receives no mid-timelapse Human turns.

Other NPCs may arrive and interact with the sponsor through normal timelapse encounter machinery. Encounter prompts must explicitly state that the Human worker is occupied and will not speak, answer, or independently act during the timelapse.

Sponsored work narration may describe ordinary labor and social texture but may not create/transfer reward items, mint money, claim final settlement, or claim unexecuted canonical movement/state changes.

Solo hunting uses one bounded Narrator passage per committed round. Hunting narration cannot determine the final catch.

## Timelapse study

Daytime planning supports formal `study_item(itemId, inputText)` for existing `abstract_study` items.

Reuse the existing item effect and item-owned `abstractStudyProgressByCharacterId`; do not create a parallel study system.

An item is accessible to a timelapse actor when either:

- it is carried in that actor's inventory, in which case it can be used from any selected room; or
- it is physically present in the selected room or an accessible sublocation inventory there.

An item in another character's inventory or another room is not accessible. Study does not automatically transfer or move the item.

No special privacy rule is added for the Slab. Physical access plus model knowledge/motivation determines whether an NPC chooses to study it.

## Settlement and maintenance order

Successful daytime finalization is:

```text
5 committed rounds
-> formal activity settlement / reward delivery
-> reward facts available to character reflection
-> existing mind reflection/maintenance pipeline
-> weather refresh
-> Evening
```

No activity reward exists before all five rounds commit.

Sponsored settlement is a dedicated narrow Character-model request, not an ordinary turn. The sponsor receives full relevant character context (personality, mind, memories, beliefs/known facts, relationships, recent context) plus the completed job context and strict authored reward contract. Its only allowed output is the reward choice.

Mara may return only 1-3 allowed remedy items. Harlan may return only 3-7 gold. Invalid structured output receives at most the normal single repair attempt; unresolved settlement failure aborts successful finalization and creates no reward.

Hunting settlement is engine-owned RNG and needs no sponsor call.

## Rollback/liveness

Preserve existing `TimelapseCore` committed-round semantics:

- an uncommitted failing round is restored;
- earlier committed rounds remain canonical;
- progressive UI never shows speculative output as committed;
- a failed activity receives no settlement reward;
- a failed daytime activity does not transition to Evening;
- a zero-round preflight failure restores the preflight snapshot.

Model/network failure must unwind the timelapse rather than leaving permanent busy state.

## Editor visibility

Editor Visibility Invariant: every authored entity type present in world data must be surfaced by the standalone editor.

For `dayActivities`, provide only a minimal generic list/inspector/editor sufficient to show the entities and basic/raw fields and preserve them through editor round trip. A polished job designer and broad editor cleanup are out of scope.

## Explicit non-goals

Do not add in this patch:

- exact clocks/hours;
- automatic tick-count time progression;
- generic `Skip day`/`Wait until evening`;
- automatic professional schedules/commuting for free NPCs;
- prices or price known-facts;
- `buy`/`sell` mechanics;
- shops/market UI;
- recipes/resource consumption/crafting chains;
- supply-demand simulation;
- weather mechanical modifiers;
- generic persuasion mechanics;
- Slab/home privacy systems;
- editor redesign;
- broad consistency/refactoring unrelated to these new features.

The intended economic experiment after this patch is emergent exchange using existing grounded item/money transfer actions. Produced items are ordinary canonical items; what NPCs later do with them is not special-cased here.
