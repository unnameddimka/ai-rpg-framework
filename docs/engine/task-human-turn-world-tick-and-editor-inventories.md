# Task: Human-Turn World Tick, Initiative, Visibility, and Editor Inventories

## Status

Implementation specification for the current repository state.

The deterministic engine remains authoritative. Human and AI controllers submit intentions; only engine-confirmed formal actions change objective world state.

## Goals

1. Make every consumed HumanController turn advance one bounded global AI world tick.
2. Give each eligible AI character at most one model decision in that tick.
3. Preserve and accumulate observations across ticks, including off-screen observations and an AI actor's own grounded action result.
4. Derive reaction order from accumulated pending targeted observations.
5. Stop a tick cleanly on model/provider failure without losing earlier committed work.
6. Route player-visible output by canonical event recipients, not by a blanket per-reaction visibility snapshot.
7. Represent room/location movement with one canonical `character_moved` event visible from both sides.
8. Keep AI prose and memory grounded against the current canonical `view` and deterministic action result.
9. Add a presentation-only **Show invisible events** debug toggle for the current HumanController turn.
10. Add embedded initial-inventory editing to character, location, and position forms without changing the flat item model.

---

# 1. Human turn boundary

A normal HumanController **Submit** or explicit **Pass / Next turn** is a world-tick boundary.

For Submit:

1. validate any formal action against the current canonical `view.available_actions`, including concrete option values;
2. commit the HumanController intent if valid;
3. determine whether the HumanController turn was consumed;
4. if consumed, run one bounded global AI world tick.

For Pass:

1. consume the HumanController turn;
2. run one bounded global AI world tick.

There is no timer or background execution in this task.

## 1.1 Valid failed attempt versus invalid request

A **valid in-world attempt** consumes the HumanController turn even when deterministic execution fails.

Example: the action is structurally available and could succeed in principle, but its engine validation/resolution reports a grounded game-world failure. Preserve the grounded failure and advance the AI world tick.

An **invalid/impossible request** does not consume the turn and does not start the AI tick. This includes requests that should never have passed the current canonical action contract, such as:

- unavailable action type;
- stale or illegal option value;
- unavailable target;
- malformed action fields;
- stale UI/protocol submission.

Do not infer this distinction from prose. Keep contract rejection distinct from an engine action result with `ok: false`.

---

# 2. Eligibility and one-reaction rule

During one AI world tick, an AI character is eligible only when:

- its current controller assignment is `ai`;
- it has pending observations;
- it has not already reacted in the current tick.

Each eligible AI character receives **at most one model decision per world tick**.

There are no idle model calls. An AI character with no pending observations is not invoked merely because a tick occurred.

Later AI characters in the same tick see observations already committed by earlier reactions when those observations are in their pending inbox.

If a character already reacted and receives new observations later in the same tick, those observations stay pending for a later HumanController tick. They never grant a second same-tick reaction.

This includes the grounded result/failure of the character's own formal action. The self result remains pending and can motivate a later step, enabling deliberately slow behavior such as:

```text
tick N:     take empty mug
tick N + 1: fill mug
tick N + 2: hand mug over
```

Do not chain multiple formal actions inside one AI response.

---

# 3. Global pending observations

A HumanController turn advances the global pending AI simulation, not only NPCs near the player.

Pre-existing pending observations remain eligible regardless of where they were created. Do not filter the queue by a cascade ID or by the HumanController's current location.

Therefore NPCs left behind in another room may continue reacting across later HumanController turns, one reaction per character per tick, as long as they have pending observations.

When building an AI request:

- snapshot the exact pending observation records included in that request;
- retain their exact IDs;
- after a successfully committed AI reaction, consume only those IDs;
- observations created while that request/reaction is executing are newer and remain pending.

---

# 4. Accumulated initiative

Initiative is not a stored character stat and is not merely a one-time queue move.

Before selecting each next unreacted eligible AI character, derive an **initiative score** from that character's current pending targeted observations.

Scoring:

- explicitly addressed speech: **+1**;
- targeted formal-action event/attempt: **+2**;
- if the originating actor was controlled by `HumanController` when that observation/event was created: **+2 additional**.

Examples:

- AI addresses Mara: `+1`;
- AI performs a targeted formal action toward Mara: `+2`;
- HumanController addresses Mara: `+3`;
- HumanController performs a targeted formal action toward Mara: `+4`;
- four accumulated AI addressed-speech observations toward Mara: `+4`.

All pending targeted observations add together. This means a character directly affected by the HumanController tends to react early, but a character being repeatedly pulled by several AI interactions can overtake it naturally.

Ordering:

1. highest current initiative score;
2. normal saved deterministic queue order as tie-breaker.

Recompute before every next AI selection because earlier reactions can add observations and change scores.

Only pending observations count. Once an observation is successfully consumed, its initiative contribution disappears automatically.

Use explicit structured targeting only. Do not parse `spokenText` or `publicNarrative` to guess an addressee.

## 4.1 Structured speech target

The AI decision protocol includes:

```json
"spokenTargetId": null
```

When `spokenText` is addressed to a specific visible character, `spokenTargetId` may contain that character ID. The speech target and formal-action target may be different.

The protocol must validate `spokenTargetId` against characters currently visible in the canonical request view. `spokenTargetId` must be `null` when there is no `spokenText`.

---

# 5. AI reaction ordering inside one response

Model-authored `spokenText` and `publicNarrative` belong to the **action-attempt phase**.

They may describe speech, gesture, motion, effort, or an action already in progress. Speech may naturally happen while the character is performing an action, for example while pouring ale.

However the formal action does not become a completed objective fact until deterministic engine execution succeeds.

Conceptual order:

1. model chooses attempt-phase narrative/speech and at most one formal action;
2. formal request is hard-validated against the current canonical available-action contract;
3. attempt-phase speech/narrative uses the pre-completion scene/perception context;
4. deterministic engine executes the formal action;
5. grounded success/failure events and feedback become authoritative;
6. same-response memory changes must not persist a successful result that the engine did not confirm.

The prompt must explicitly forbid claiming an unconfirmed formal action as already completed.

---

# 6. Canonical movement event

A successful transition between major rooms/locations emits **one** canonical event:

```text
character_moved {
  actorId,
  fromLocationId,
  toLocationId
}
```

Human-readable example:

```text
Mara moved from The common room to The street.
```

Recipients are the union of characters who can perceive the actor from either side of the transition:

- observers in the source location;
- observers in the destination location.

All recipients receive the same full movement fact, including both source and destination. Do not create separate departure and arrival events or separate textual projections in this milestone.

The moving AI actor separately receives its normal grounded self `action_result`.

---

# 7. Per-event HumanController visibility

Normal **Latest turn** presentation must be derived from canonical event recipients/perception **for each emitted event**, not from one visibility value captured at the start of an AI reaction.

Consequences:

- attempt-phase narrative/speech is visible when its narrative event includes the HumanController as a recipient;
- a grounded formal-action event is visible when that event includes the HumanController;
- a `character_moved` event is visible when the HumanController is on either perceivable side of the move;
- off-screen events still mutate the world and reach AI recipients normally even when hidden from the player-facing narrative.

Do not suppress simulation merely because the player cannot currently see it.

## 7.1 Show invisible events

Add a sidebar checkbox:

**Show invisible events**

Requirements:

- unchecked by default;
- presentation-only;
- applies only to the current HumanController turn / **Latest turn**;
- suppressed current-turn narrative/action-event entries are retained transiently so the checkbox can reveal/hide them immediately without another model call;
- each revealed entry is visibly marked, for example:

```text
[DEBUG — NOT VISIBLE TO PLAYER]
```

- use a distinct debug CSS class/style;
- do not alter world state, recipients, pending observations, scheduler order, memory, saves, or canonical perception;
- do not expose prompts, private memories, beliefs, relationships, raw JSON, or unrelated scheduler internals.

The hidden presentation buffer is replaced when the next HumanController turn begins.

---

# 8. Current view overrides historical state

The AI prompt must state that the canonical `context.view` is authoritative for present public/operational reality.

In particular:

- a character absent from `view.location.characters` is not currently visible;
- `view.self.position_text` is authoritative for the actor's current posture/position;
- each visible character's current `position_text` overrides stale posture/location memories;
- old observations and memories are historical facts, not proof of the current scene.

Memory guidance should prefer decision-relevant information such as constraints, refusals, promises, resource availability, goals, and meaningful changes over repeated social filler.

---

# 9. Failed AI formal actions

AI formal actions must be hard-validated again against the **current** canonical available-action contract immediately before engine execution. A choice legal when the model request was built can become stale while the request is in flight.

If the requested action is no longer legal:

- do not execute it;
- create grounded failure feedback for the AI actor;
- do not treat the requested outcome as completed;
- leave that new failure observation pending for a later HumanController tick.

If deterministic engine execution itself returns an in-world failure, preserve the grounded failure observation the same way. Attempt-phase speech/narrative that was already validly emitted remains part of the scene because it happened during the attempt; it is not itself an objective success claim.

The AI actor has already used its one reaction opportunity for this tick, so failure feedback never causes an immediate second request in the same tick.

Do not apply same-response memory/belief/relationship changes that depend on the failed action having succeeded. If the formal request is rejected by the current canonical contract before a legitimate attempt begins, do not emit the model's stale attempt narrative/speech.

---

# 10. Model/provider failure during a world tick

Keep the existing request/protocol repair policy. When it is exhausted and a usable AI response still cannot be obtained:

- stop the current AI world tick immediately;
- do not invoke later AI characters in that tick;
- do not fabricate a reaction;
- do not consume the failed request's observation snapshot;
- retain the failed character and all later/unprocessed work as pending;
- keep all earlier successfully committed Human/AI world changes;
- do not roll back the entire world tick;
- surface a clear model/provider error/debug status.

HumanController may continue taking later turns. Their resulting observations continue accumulating while the model is unavailable.

When AI processing becomes available again, a later world tick uses the entire still-pending accumulated batch subject to the normal request observation cap.

---

# 11. Emergency tick guard

Keep a high defensive guard of **64 model decisions per world tick**.

This is corruption protection, not gameplay pacing. Normal termination should come from the one-reaction-per-character rule.

If the guard is reached:

- stop scheduling additional AI requests for the current tick;
- retain all already committed state;
- leave all unprocessed characters/observations pending;
- return a debug warning that the tick was truncated;
- do not crash gameplay or roll back the whole HumanController turn.

---

# 12. Editor embedded inventories

Do not change the runtime item schema. Keep the existing flat model:

```text
item definition
    <- item instance.definitionId
item instance
    -> inventoryId
```

The editor should provide embedded views over the same `items` collection.

## 12.1 Character

Inside each character form:

- show all item instances whose `inventoryId` equals the character's `inventoryId`;
- add an item by choosing an existing item definition;
- edit the instance definition;
- move the instance to another existing inventory;
- delete the instance.

## 12.2 Location

Inside each location form, provide the same controls for the location inventory.

## 12.3 Sublocation / position container

When a position has an optional inventory enabled, provide the same embedded controls.

If that optional inventory contains items, block disabling/removing it until the items are moved or deleted.

Equivalent deletion safety applies to characters, locations, and positions whose owned inventories still contain item instances.

## 12.4 Instance creation

Adding from an embedded inventory creates one normal flat item instance with:

- a unique valid instance ID;
- selected existing `definitionId`;
- the embedded inventory's `inventoryId`.

Do not clone item definitions and do not nest item objects inside character/location records.

The global **Items** tab and all embedded inventory views operate on the same data and therefore remain synchronized.

---

# 13. Save/runtime behavior

`world.json` inventory placement defines **initial new-game state**.

Runtime item instances and inventories remain part of saved runtime world state. Loading a compatible save must restore the saved runtime item state rather than reapplying authored initial inventory placement over it.

---

# 14. Tests

Regression coverage must include at least:

- Human invalid action-contract request => no consumed turn and no AI tick;
- valid Human in-world action failure => consumed turn and AI tick;
- one reaction maximum per AI character per world tick;
- later unreacted AI sees events created earlier in the same tick;
- actor's own grounded action result remains pending for a later tick;
- exact request observation IDs are the only IDs consumed;
- additive initiative from pending targeted observations;
- Human-origin `+2` initiative bonus;
- stable deterministic tie-break order;
- structured `spokenTargetId` validation;
- one canonical `character_moved` event reaching source- and destination-side observers;
- provider failure stops the current wave and preserves the failed/unprocessed pending observations;
- later recovery request includes observations accumulated during the outage;
- **Show invisible events** exists, is default-off, and uses explicit debug-only rendering;
- embedded character/location/position inventories use the same flat items catalog;
- unique item-instance ID generation;
- deletion/disable protection for nonempty inventories;
- existing engine, controller, save, security, editor, generator, UI, and protocol tests remain green.

---

# 15. Out of scope

Do not add in this task:

- timer/background AI execution;
- idle/goal-driven AI turns without observations;
- same-response multi-action chains;
- semantic promise tracking in the engine;
- memory compression/retrieval;
- off-screen time-compression / mega-pass simulation;
- crowd/group entity mechanics;
- special hidden-route movement projections.
