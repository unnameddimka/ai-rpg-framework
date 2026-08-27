# Mallowstead — Maksym Awayable Schedule, Arrival Restock, and AI-Facing Trade Grounding

**Status:** Implementation specification  
**Scope:** Maksym authored migration to the generic awayable-character engine capability, schedule, fresh-world bootstrap, arrival restock hook, trade-stock location, private Character grounding, integration tests, and world-side documentation consistency  
**Target:** `docs/world/`  
**Product:** Mallowstead  
**Baseline:** current `main` at implementation time; read `data/world.json`, `data/world-lore.md`, `docs/world/weekly-rhythm-traveling-merchant.md`, `docs/world/maxim-evening-world-update.md`, and the companion engine spec before changing authored world data.

> Generic awayable lifecycle mechanics, `defer_departure`, travel counting, arrival hooks, migration, validation, and engine tests live in `docs/engine/awayable-character-lifecycle-arrival-hooks.md`.

---

## 1. Purpose

Migrate Maksym the Wagoner from effectively fixed weekly presence to the reusable awayable-character lifecycle.

Maksym's timetable, trade reasons, sale chest, three-period road time, arrival restock, and AI-facing explanations are **authored content layered on top of the generic engine**.

The engine must not gain Maksym-, merchant-, Monday-, Woodsday-, or Mallowstead-specific lifecycle branches to implement this document.

---

# Part A — Maksym Authored Awayable Configuration

## 2. Regular arrival opportunities

Maksym's authored regular arrival opportunities are:

```text
Monday Morning
Woodsday Morning
```

These are opportunities for a true `away -> present` transition, not immutable presence days.

If Maksym is already present when Monday Morning or Woodsday Morning occurs, there is no new arrival.

## 3. Default departure policy

After every true scheduled return:

```text
default planned departure = following Morning
```

Examples:

- Monday Morning arrival -> Flamesday Morning planned departure;
- Woodsday Morning arrival -> Goldsday Morning planned departure.

The current visit may diverge from that default only through the generic ordinary formal `defer_departure` action.

## 4. Road requirement

Maksym's authored travel duration is:

```text
travelPeriods = 3
```

Travel counts three **fully completed timelapse periods after actual departure**.

This exact boundary must therefore hold:

```text
Flamesday Morning   Maksym is still present
Flamesday Evening   actual departure; now away

Flamesday Night     travel period 1 completes
Flowday Day         travel period 2 completes
Flowday Night       travel period 3 completes

Woodsday Morning    road requirement is complete
                    => Maksym is eligible for this scheduled arrival
                    => he arrives
```

Therefore **Flamesday Evening is still a safe departure for making Woodsday Morning**.

If he leaves late enough that fewer than three full periods have elapsed by Woodsday Morning, Woodsday is missed. Completing the road afterward does not cause an immediate catch-up arrival; he remains away until the next Monday opportunity.

After Woodsday he naturally has substantially more schedule slack before the next Monday opportunity. This is authored schedule consequence, not a special engine rule.

## 4.1 Wagon departure occupant fallback

Maksym's armored `merchantWagon` is conditional topology owned by his local presence. Its only external location exit leads to `marketSquare`, so the generic conditional-topology fallback is unambiguous and requires no explicit authored override:

```text
merchantWagon -> marketSquare -> marketSquareCenter
```

If Maksym departs while another locally present Character remains inside the wagon, that Character is forced outside to `marketSquareCenter` before the departure commits. A sleeping occupant wakes because the supporting wagon bed/topology is no longer locally available, and the displaced Character receives grounded committed experience of the relocation. Maksym himself follows the normal awayable departure path and is not processed as a foreign occupant.

Items, containers, locks, and inventories inside the wagon do **not** spill onto Market Square. They travel with the persisted unavailable wagon topology and are present in the same canonical storage when the wagon returns. This rule does not yet model passengers travelling with Maksym to another city.

---

# Part B — Fresh-World Monday Evening Bootstrap

## 5. Fresh start

A fresh world starts:

```text
Monday · Evening
```

with Maksym:

- present;
- seated at the second tavern table;
- holding/using the existing normal filled mug of ale authored for that scene.

This bootstrap is **not** a fake scheduled Monday-Morning arrival.

Initialize his current visit's lifecycle directly so that:

```text
plannedDeparture = Flamesday Morning
```

unless he formally defers it during ordinary Monday-evening ticks.

Do not trigger an extra arrival restock merely because the fresh bootstrap initializes him as present if the authored initial stock already exists.

---

# Part C — Maksym Arrival Restock

## 6. Restock hook

Attach the generic authored `restock` `onArrival` hook to Maksym's awayable configuration.

Target:

> his merchant sale chest on **Market Square**.

Migrate the current stock list/ranges/provenance into the authored restock hook without changing the intended assortment merely because the lifecycle mechanism is being generalized.

Use existing current merchant-restock behavior/data where possible instead of creating a competing second stock-generation system.

## 7. Restock trigger invariant

A later true Monday/Woodsday return after actual absence may restock.

Staying continuously in Mallowstead does not.

Specifically, restock must **not** happen merely because:

- Monday Morning or Woodsday Morning occurs while Maksym is already present;
- he uses `defer_departure`;
- travel completes between arrival opportunities;
- a save is loaded/migrated;
- he moves to Market Square;
- he says or thinks that he should restock.

If he stays in Mallowstead all the way through another Monday or Woodsday, he still has exactly the goods, cash, and state canonical play produced. He did not travel, so he did not restock.

---

# Part D — Trade-Stock Location and Inventory Semantics

## 8. Canonical sale-stock location

Maksym's merchant sale stock is kept in his merchant chest at **Market Square**.

His authored/private AI-facing context must explicitly ground:

> Your trade stock is kept in your merchant chest at the Market Square. When you want to sell goods, you normally conduct trade there. If someone asks to buy something while you are elsewhere, you may go to the square, arrange to meet them there later, or decline.

Do not imply that he must abandon a social interaction and immediately run to the chest because someone asks to buy something.

## 9. Personal inventory is not automatically merchandise

Maksym's ordinary personal inventory remains ordinary personal inventory.

It is not automatically part of `currentSaleStock`.

He may still choose to give/sell/trade a personal item when ordinary engine contracts permit it, but that is character discretion rather than automatic merchant stock.

---

# Part E — Maksym Private Character Grounding

## 10. Current trade situation

Maksym's private Character context should expose grounded current trade facts sufficient for business judgment, including:

- current wallet/cash;
- current sale stock remaining in the merchant chest;
- acquired stock currently carried for external resale;
- expected external resale value for acquired stock where the existing authored economy supports such valuation.

Do **not** introduce hard-coded decision thresholds such as:

```text
leave if wallet < 20
leave if stock < 4
```

The model decides significance.

Authored interpretation should explain that practical reasons to continue the road include:

- little cash remaining;
- much acquired stock waiting to be resold elsewhere;
- depleted local sale stock;
- opportunity cost of lingering instead of continuing the route.

These are motivations, not commands.

A sufficiently important personal/social/story reason may outweigh them.

## 11. AI-facing departure consequences

Do not require the model to manually count the custom calendar.

Provide compact grounded schedule consequences derived from generic awayable state and Maksym's authored schedule.

The context should be capable of communicating facts equivalent to:

```text
Current planned departure: Flamesday Evening.
Road time after departure: 3 timelapse periods.
Leaving then still allows your next regular Woodsday Morning visit.
```

or:

```text
Current planned departure: Flowday Morning.
If you delay this departure by one more period, you will miss the next regular Woodsday Morning visit.
Your following regular return opportunity would be Monday Morning.
```

Exact prose may follow current context architecture.

This is decision support, not deterministic coercion.

Maksym-specific authored wording may remind him that after Woodsday he has more schedule slack before Monday, while early-week delays can consume the margin needed to make Woodsday.

The engine may compute dates/reachability generically; the interpretation and character-specific emphasis remain authored content.

## 12. Staying is a current formal decision, not remembered intent

Maksym may defer repeatedly during ordinary ticks and may do so silently or while separately speaking through normal `spokenText`.

Do not encode an active stay decision into continuation, memory, beliefs, or dialogue history as a substitute for the canonical lifecycle action.

An old remembered wish to stay must not alter a later visit's current planned departure.

---

# Part F — Existing Merchant Departure Settlement

## 13. Departure-side acquired stock

Do not unnecessarily fold the existing acquired-stock departure settlement into the new arrival-restock mechanism.

It may remain the current separate trade lifecycle attached to actual departure if that is the cleanest architecture.

The authored world requirement here is only that Maksym's true return can restock his sale chest using the generic validated arrival hook.

Avoid broad unrelated economy refactors.

---

# Part G — Required Maksym Integration Tests

## 14. Fresh-world integration

Cover:

- fresh world = Monday Evening;
- Maksym is seated at the second tavern table;
- he has the existing normal filled mug;
- fresh planned departure = Flamesday Morning;
- fresh bootstrap does not trigger arrival restock.

## 15. Defer and road timing

Cover:

- defer Monday Evening => Flamesday Evening;
- defer again during Flamesday Morning => Flowday Morning;
- Flamesday Evening actual departure + exactly 3 periods => Woodsday Morning return;
- delaying beyond the safe boundary can make Woodsday missed;
- finishing travel after a missed Woodsday does not immediately return him;
- the next valid return is the later Monday opportunity.

## 16. Arrival/restock behavior

Cover:

- true return runs sale-chest restock;
- staying continuously through another Monday/Woodsday does not restock;
- already-present schedule opportunity does not reset stock, wallet, inventory, or planned departure merely because the calendar matches;
- actual return after absence sets a new default following-Morning departure;
- migration/load does not trigger restock.

## 17. Trade grounding

Cover:

- Market Square remains the canonical sale-stock location;
- personal inventory is not automatically listed as sale stock;
- private context includes current wallet/sale/acquired-value facts;
- private context communicates whether current/deferred departure can make or miss the next regular arrival;
- no hard-coded business-decision thresholds are introduced.

---

# Part H — World Documentation Consistency Pass

## 18. `data/world-lore.md`

Change the current authored starting point from Monday morning to:

```text
Monday evening
```

Do not otherwise turn this human continuity document into runtime data.

## 19. `docs/world/maxim-evening-world-update.md`

Correct current naming/content references:

- `Maxim` -> **Maksym**;
- `village square` -> **Market Square** where referring to the canonical location/workplace.

Do not alter the already-correct fresh Monday-Evening intent.

## 20. Existing world rhythm/merchant docs

Where current authoritative world documentation still presents Maksym's Monday/Woodsday presence as immutable fixed presence rather than arrival opportunities plus runtime lifecycle, update or supersede that wording consistently.

Historical implementation specs should remain historical where appropriate; prefer explicit supersession notes rather than rewriting past decisions as though they never existed.

Do not globally rewrite unrelated historical terminology or compatibility identifiers.

---

# Part I — Maksym Acceptance Criteria

## 21. Maksym acceptance

Implementation is complete when:

1. Fresh Mallowstead remains Monday Evening with Maksym at the tavern second table and one normal filled mug.
2. His fresh planned departure is Flamesday Morning.
3. He may defer in ordinary ticks, silently or while separately speaking through normal model prose.
4. Departing Flamesday Evening and completing exactly three periods allows Woodsday Morning return.
5. Leaving later can cause Woodsday to be missed.
6. Staying continuously through a normal arrival weekday gives no restock.
7. True return after absence restocks the merchant sale chest on Market Square from authored rules.
8. His private AI context grounds where sale stock is, distinguishes it from personal inventory, exposes current trade state, and explains schedule consequences without hard-coded decision thresholds.
9. The model can understand when a one-period delay is safe versus when it risks missing the next regular visit.
10. Existing merchant departure settlement continues to function without being conflated with the new arrival hook unless a minimal refactor is necessary.
11. Current world documentation uses `Maksym`, `Market Square`, and Monday Evening consistently for the current authored world.
12. The implementation satisfies the companion generic engine specification without introducing Maksym-specific engine branches.

---

## 22. Non-goals

This world task does **not**:

- add Maksym-specific engine branches;
- simulate Maksym's off-map road encounters;
- add a generic economy/pricing system;
- force Maksym to leave based on numeric thresholds;
- make his whole personal inventory sale stock;
- let timelapse planners decide to defer departure;
- infer active stay decisions from memory/continuation;
- create delayed catch-up arrivals after a missed schedule opportunity;
- restock merely because Monday/Woodsday occurs while he is already present;
- make `defer_departure` a public announcement;
- redesign unrelated merchant departure settlement unless required for clean integration.
