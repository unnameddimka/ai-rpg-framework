# Weekly Rhythm, Scheduled Presence, Bulk Transfer, and Writable Paper — Engine Specification

Status: implementation specification  
Scope: reusable engine/runtime mechanics  
Target baseline: AI RPG framework after the User Friendliness Patch

## 1. Purpose

This document defines the reusable engine mechanisms required by the first weekly traveling-merchant world content:

- a persistent weekly calendar;
- schedule-driven local presence / away state;
- conditional local topology for world entities that travel with scheduled characters;
- deterministic arrival/departure lifecycle hooks, including authored restock and supported off-map settlement;
- atomic bulk item transfer for humans and AI characters;
- persistent writable/readable paper using a reusable Writing Set;
- persistence, migration, model-view, and validation rules for those mechanics.

This document deliberately does **not** define the concrete village weekday names, merchant personality, visit days, Market Square flavor, wagon description, stock list, relationships, or starting world content. Those belong in the companion world specification.

The existing project principles remain binding:

- canonical world state is engine-owned and deterministic;
- model intent never substitutes for a grounded state change when a formal action exists;
- model output should have effect; no-op operations should be omitted and rejected deterministically;
- absent/off-map entities are not silently simulated;
- save/load must preserve authored world state and canonical runtime state without cross-contamination.

---

## 2. Weekly Calendar Core

### 2.1 Canonical day counter

Add a monotonically increasing canonical day counter to world runtime state.

The engine derives the current weekday from:

- the canonical day counter;
- the authored seven-day weekday-name sequence.

Do not persist redundant weekday display text when it can be derived deterministically.

### 2.2 Seven-day authored week

The engine supports exactly seven ordered weekday names for this world generation.

The concrete names and initial weekday are world-authored data, not engine constants.

### 2.3 Day transition

Advance the canonical day counter exactly once when the overnight/night timelapse completes and the world enters the next morning.

Schedule transitions are resolved **across the overnight boundary**. Morning begins with the new day's presence/topology already applied.

If a scheduled character leaves between two days, there is no mandatory simulated departure scene. The next morning simply begins with that character already away unless a future feature explicitly adds such a scene.

### 2.4 Player-visible time

Where the current phase is presented to the player, expose weekday + phase in a compact form, for example:

`<Weekday> · Evening`

The exact weekday labels come from world authoring.

---

## 3. Generic Scheduled Presence

### 3.1 Purpose

Provide a reusable authored mechanism allowing a character to participate in the local simulated world only on selected weekdays/visit windows.

This mechanism must not contain merchant-specific IDs or behavior.

### 3.2 Present vs away

A scheduled character has a derived local-presence state:

- **present** — participates in the local world normally;
- **away** — remains persisted canonically but is not part of the local simulation.

While `away`, the character:

- is not present in any local location;
- is not a valid local interaction target;
- is excluded from local pathfinding and local `available_actions` targets;
- does not receive local observations;
- does not enter the ordinary AI scheduler;
- does not enter daytime/evening/night timelapse participant sets;
- does not run autonomous off-map model turns or maintenance merely because time passes locally;
- retains persistent mind, relationships, wallet, inventory, equipment, dialogue state, and other canonical character data.

Off-map life is therefore **not simulated** unless a later explicit mechanic says otherwise.

### 3.3 Canonical schedule data

A scheduled character's recurring presence windows must be represented as canonical authored structured data.

The same schedule data must drive:

1. engine presence decisions;
2. grounded self-knowledge supplied to that AI character.

Do not rely on duplicating the schedule only as prose in `aiDescription`.

### 3.4 AI schedule self-knowledge

When constructing the scheduled character's grounded model view, include a concise human-readable representation of its own regular local schedule and the current weekday/phase.

This lets the character accurately reason or speak about when it will be locally present without making the model responsible for enforcing the schedule.

---

## 4. Conditional Local Topology

### 4.1 General mechanism

Support authored world entities/passages whose **local availability** depends on a scheduled-presence owner or another deterministic presence condition.

A conditionally unavailable entity remains canonical and persisted; it is only removed from the currently playable local topology.

### 4.2 Hidden/unavailable semantics

While conditionally unavailable, an entity/location:

- is not shown to the player as a reachable local destination;
- is not exposed through local exits/passages;
- cannot be targeted by local pathfinding;
- does not produce local `available_actions` merely by existing canonically;
- retains state, inventory, lock state, containers, and authored identity.

Do not delete and recreate canonical entities to represent temporary absence.

### 4.3 Locks remain ordinary locks

If a conditionally available passage is lockable, once it is locally available it must obey the existing normal lock/key traversal rules.

Presence does not bypass locks. Locks do not make an absent topology node locally available.

---

## 5. Arrival / Departure Lifecycle

### 5.1 Boundary timing

Arrival and departure effects are applied deterministically at the day-boundary resolution so the new morning begins in its final local state.

### 5.2 Arrival hooks

The engine may support authored deterministic arrival operations such as refreshing a designated sale-stock collection from an authored restock definition.

Canonical stock generation must be engine-side/authored. The model must not invent item instances into existence.

### 5.3 Restock pool semantics

A restock definition may specify:

- eligible item definitions;
- fixed or ranged quantities;
- optional chance/selection rules;
- which inventory/stock collection receives the instances.

Restock must never overwrite or clear unrelated personal belongings, equipped items, keys, private-container contents, or other non-stock state.

### 5.4 Stock provenance

The implementation must retain enough canonical provenance/role information to distinguish at minimum:

- character personal belongings;
- current sale stock generated for visitors/customers;
- goods acquired locally for later off-map sale;
- structural/container contents that are not trade stock.

This may reuse existing inventory primitives; it does not require a second inventory engine if role/provenance can be represented safely another way.

Provenance must follow the **item's commercial role**, not merely whichever inventory currently contains it. In particular, moving a merchant's own generated sale stock between its designated sale-stock container and the merchant's personal carried inventory must not relabel it as locally acquired stock. Likewise, taking an unrelated personal belonging from an ordinary keyed container must not create acquired-stock provenance simply because the destination character happens to be trade-enabled.

For the first merchant world content, acquired-stock provenance is created by a direct item transfer from another character into the trade-enabled merchant's personal inventory. More elaborate purchase sources can be added later with explicit grounded rules rather than inferred from arbitrary container movement.

### 5.5 Supported off-map settlement

Provide a deterministic departure settlement for locally acquired goods that carry explicit external-sale metadata.

For each eligible acquired item instance at departure:

1. read its authored external/merchant sale value;
2. remove the settled item instance from the character's acquired-trade stock;
3. credit the owning character's wallet by that value.

Do not settle:

- personal equipment;
- keys;
- structural belongings;
- generated sale stock that originated with the merchant;
- goods lacking supported external-sale metadata.

Goods without valuation metadata remain persisted off-map rather than receiving an invented value.

### 5.6 No universal economy implied

External-sale metadata is a narrow capability, not a global price table.

This patch must not infer prices for unrelated items and must not expose a universal economy unless authored by the companion world content.

---

## 6. Bulk Item Transfer

### 6.1 General formal action

Add a reusable formal bulk item transfer action that transfers an explicit bundle of canonical item-instance IDs in one operation.

Conceptual shape:

```json
{
  "type": "transfer_items",
  "targetId": "...",
  "itemIds": ["item-1", "item-2", "item-3"]
}
```

Follow existing project naming/wire conventions where a different exact shape is more consistent.

### 6.2 Required directions

Support at minimum:

- character -> character;
- character -> accessible container;
- accessible container -> character.

Container -> container may be included if it follows naturally from the existing placement model, but is not required.

### 6.3 Atomicity

Bulk transfer is all-or-nothing.

Before commit, validate the complete bundle:

- every item instance exists;
- every ID occurs at most once in the request;
- every item is currently at the expected source and accessible to the actor;
- target character/container is valid and accessible;
- target capacity/placement constraints are satisfied;
- equipped/locked/protected-placement rules are respected;
- the operation would actually change canonical state.

If any element fails validation, transfer **none** of the items and return one clear failure result.

### 6.4 AI availability

AI characters receive the same bulk-transfer formal capability in `available_actions` whenever valid.

Model protocols must use explicit canonical instance IDs and must not emit empty/no-op bundles.

### 6.5 Human UI

Keep existing convenient single-item transfer affordances.

Add a bulk path such as `Give items…` / `Transfer items…` with a compact multi-select dialog that:

- lists eligible items;
- allows multiple selection;
- may visually group equivalent item definitions;
- allows quantity/all selection from a visual group;
- expands the final selection back to explicit canonical instance IDs before dispatch;
- clearly shows source/target and selected count.

Do not introduce engine-level implicit item stacks solely for UI convenience.

---

## 7. Gold Settlement Compatibility

Do **not** add a special two-sided formal `Trade` action in this patch.

Negotiated commerce is represented by ordinary grounded operations:

- one or more bulk/single item transfers;
- ordinary gold transfer(s).

The model may negotiate narratively, but each resulting world-state change must still be represented by existing/formal grounded actions.

The lack of an atomic barter transaction is an accepted scope limitation for this patch.

---

## 8. Writable Paper

### 8.1 Capability items

Support authored items with a reusable writing capability, initially consumed by the world-defined **Writing Set** item.

The capability has no charges and consumes no ink/resource in this patch.

### 8.2 Writable item state

Support writable paper-like item instances with one persisted instance-level string field:

`content`

`content` is the single canonical representation of both literal writing and drawings.

Semantics:

- text outside single asterisks is verbatim written text;
- text inside `*...*` is canonical descriptive metadata for a drawing or other non-text visual mark.

Example:

```text
Meet me by the stream after sunset.

*a small crooked house is drawn beneath the note*

Do not tell Garrick.
```

Do not split writing and drawing into separate canonical fields.

### 8.3 Write / Draw formal action

Add a grounded action allowing an actor to set/replace the `content` of an accessible writable paper instance when the actor also has access to a reusable writing-capability item.

Rules:

- no writing resource is consumed;
- the specific target item instance changes;
- content persists through transfer, containers, save/load, and ordinary item movement;
- a no-op rewrite to the already-normalized same content must be rejected/omitted under the model-output-must-have-effect invariant.

Human UI may use a simple modal/textarea. No visual canvas or vision model is required.

### 8.4 View / Read formal action

Add a separate grounded action to inspect/read accessible writable-paper content.

Reading does not require the writing capability.

The human UI presents the canonical mixed string faithfully.

An AI character receives the canonical content only after a legitimate read/inspect observation/action according to normal perception rules.

### 8.5 No ambient omniscience

Merely seeing that a paper item exists does not grant knowledge of its `content`.

---

## 9. Persistence and Migration

### 9.1 Save/load

Persist or deterministically reconstruct as appropriate:

- canonical day counter;
- scheduled character persistent state while away;
- current stock/acquired-stock provenance necessary for safe lifecycle handling;
- hidden conditional-location state and contents;
- lock states;
- writable item `content`.

### 9.2 Migration

Existing saves without weekly calendar state migrate to the world-authored initial weekday/day baseline unless a later migration has a more precise deterministic source.

Existing writable item instances without `content` default to empty content.

Migration must not rewrite unrelated authored world state.

---

## 10. Model View and Prompt Contracts

When relevant, model views must ground:

- current weekday and time phase;
- the acting scheduled character's own canonical schedule;
- only currently present local characters/entities as local actionable targets;
- authored external-sale values only where the item actually has them and the acting merchant is permitted to see them;
- valid bulk-transfer actions with explicit canonical item-instance IDs;
- accessible writing capability when determining write/draw availability;
- writable-paper content only after legitimate inspection/read.

Models are **not** responsible for enforcing:

- day advancement;
- presence/away transitions;
- conditional topology;
- lock traversal rules;
- restock item creation;
- deterministic departure settlement;
- atomic bulk-transfer validation.

---

## 11. Explicit Non-Goals

This engine patch does not add:

- a universal item-price table;
- common-knowledge approximate market prices;
- a dedicated atomic `Trade` action;
- fully atomic two-sided barter + gold settlement;
- off-map AI/timelapse simulation;
- simulated caravan guards as a system;
- mounted repeating-crossbow combat;
- ink consumption or writing charges;
- freehand canvas drawing;
- vision-model interpretation of drawings;
- months, seasons, or calendar dates beyond the seven-day rhythm.

---

## 12. Engine Acceptance Criteria

### Calendar

- Canonical day increments exactly once at overnight -> morning transition.
- Weekday derives deterministically from day + authored seven-day sequence.
- Weekday survives save/load through canonical state.

### Scheduled presence

- Present scheduled characters participate normally.
- Away scheduled characters retain persistent state but are absent from local scheduler, timelapse, observations, pathfinding, targets, and actions.
- The character sees its own schedule as grounded self-knowledge from the same structured data that drives presence.

### Conditional topology

- A conditionally unavailable canonical location/entity is invisible/unreachable locally without being deleted.
- State and inventory survive absence and reappearance.
- Normal lock/key rules apply once the passage is locally available.

### Lifecycle

- Arrival restock creates only authored sale stock.
- Personal belongings/keys/private storage are not confused with sale stock.
- Departure settlement converts only eligible acquired goods with explicit external-sale metadata.
- Unsupported acquired goods remain persisted; no price is invented.

### Bulk transfer

- Humans and AI can transfer multiple explicit instances in one formal action.
- Required character/container directions work.
- One invalid item causes the entire bundle to fail without partial mutation.
- No engine-level implicit stacks are introduced.

### Writable paper

- Instance-level `content` persists exactly.
- Writing requires accessible reusable writing capability and consumes nothing.
- Reading requires no writing capability.
- AI does not know content until legitimately read/inspected.

---

## 13. Engine Principle Summary

The engine models **when local things exist, where they are reachable, and what grounded operations change state**. It does not simulate an unseen external world merely to justify absence.

Scheduled characters remain persistent people while away, but local AI computation stops. Arrival/departure, topology, stock, settlement, transfers, and paper state are deterministic mechanics. AI remains responsible for social behavior, negotiation, choices, and narrative expression within those grounded boundaries.
