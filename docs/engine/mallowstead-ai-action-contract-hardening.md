# Mallowstead AI Action Contract Hardening
## Relevant Mechanics and First-Pass Character Guidance

**Status:** Implementation specification for 0.1.2b  
**Scope:** Character decision context and prompt contract

---

# 1. Goal

Improve first-pass Character decisions, especially on Flash, by teaching the model which formal mechanics are relevant in its current grounded scene even when one or more non-anchor prerequisites are still missing.

Ordinary Character decisions remain single-pass after the existing structured-response validation. The goal is for the Character model itself to choose the correct atomic formal action.

The deterministic engine remains authoritative for all tracked world state.

---

# 2. Problem

`view.available_actions` intentionally contains only actions executable **right now**. By itself, this can make a cheaper Character model confuse:

- "this mechanic does not exist"; and
- "this mechanic exists here but a prerequisite is missing".

Example: Garrick is standing at the ale tap, but empty mugs are still in the mug cabinet. `fill` is not executable yet, while `transfer_items` can obtain the mugs. The Character must understand that `fill` is a real relevant mechanic whose missing vessel prerequisite can be satisfied by first taking the mugs.

---

# 3. Two Separate Contracts

## 3.1 Relevant mechanics

The Character request contains a compact `relevantMechanics` section.

It describes mechanics grounded in the actor's current scene or grounded items and may include mechanics that are not yet executable because a non-anchor prerequisite is missing.

Relevant mechanics are explanatory only. They never grant execution authority.

## 3.2 Available actions

`context.view.available_actions` remains the only executable-now formal action contract.

A Character may return only an action and option currently offered there.

The prompt must state the distinction explicitly:

> Relevant mechanics describe engine mechanics grounded in your current scene/items. A listed mechanic may still be unavailable because prerequisites are missing. `available_actions` contains only actions executable right now. If an intended relevant mechanic is unavailable, look for a currently available prerequisite action that advances the same intention.

---

# 4. Action AI Metadata

Generic and item-specific formal actions may expose:

```text
aiDescription
aiPrerequisites
```

`aiDescription` briefly explains what the tracked mechanic does.

`aiPrerequisites` briefly explains the conditions required for it to become available.

This metadata must be:

- concise;
- mechanical;
- stable enough for repeated Character requests;
- free of hidden world information;
- independent of current hidden target IDs/options.

ActionRegistry/current formal action definitions remain the source of truth. Do not maintain a separate hand-written global mechanics encyclopedia.

---

# 5. Relevant Source Gating

Extend the existing action-source architecture rather than creating a separate global anchor system.

For every mechanic, answer separately:

```text
Is this mechanic relevant enough to explain to this actor now?
Is this action executable right now?
```

Strict/current source gating continues to produce `available_actions`.

Relaxed source gating produces `relevantMechanics` by requiring the mechanic's grounded anchor while allowing other prerequisites to be missing.

## 5.1 Paper writing

```text
paper present, writing set absent:
    relevant = yes
    available = no

paper present, writing set present:
    relevant = yes
    available = yes

paper absent, writing set present:
    relevant = no
```

The paper is the relevance anchor.

## 5.2 Filling from an ale source

```text
ale source present, mug absent:
    relevant = yes
    available = no

ale source present, compatible mug available:
    relevant = yes
    available = yes

ale source absent, mug present:
    relevant = no
```

The environmental fill source is the relevance anchor.

## 5.3 Unlocking

```text
locked passage present, matching key absent:
    relevant = yes
    available = no

locked passage present, matching key present:
    relevant = yes
    available = yes

no relevant locked passage:
    relevant = no
```

The passage is the relevance anchor.

## 5.4 Equipping

```text
equippable item grounded, slot occupied:
    relevant = yes
    available = no

equippable item grounded, slot free:
    relevant = yes
    available = yes

item not grounded:
    relevant = no
```

The item is the relevance anchor.

## 5.5 Item-specific mechanics

Item-specific action descriptions are exposed only while the relevant item is grounded for the actor through normal visibility/access rules.

Examples include paper actions, Memory Stone use, and other authored item-specific effects.

Do not reveal mechanics for hidden or unrelated artifacts merely because their definitions exist somewhere in the world.

## 5.6 General/source-less mechanics

Do not send a global catalog of every action in Mallowstead.

If a mechanic has no meaningful relaxed relevance source, showing it only when currently available is sufficient.

---

# 6. Narrative / Formal Action Contract

The Character prompt must use this invariant:

> Narrative and speech may describe cosmetic or untracked behavior. They must never claim completion of an engine-tracked state change without the corresponding formal action.

Tracked state includes, at minimum:

- item possession/location/container contents;
- item tracked state, filling, transformation, or full consumption;
- money transfer;
- character canonical movement/position;
- equipment;
- passage lock/open state;
- sleeping state;
- formal ability/item results;
- any other engine-owned canonical state.

If an intended mechanic is relevant but unavailable:

1. use one currently available prerequisite action when it clearly advances the intention;
2. keep later unfinished purpose in `continuation` when appropriate;
3. otherwise do not narrate the tracked result as already completed.

A response performing one formal action must not narratively claim that later formal steps also succeeded.

Cosmetic behavior that does not mutate tracked state remains valid narrative: glances, smiles, sighs, hesitation, scratching a beard, adjusting clothing, and similar details.

## 6.1 External prerequisite wait rule

A character must not assume that another character has already completed a tracked prerequisite merely because that other character expressed an intention, visibly prepared for it, or completed an earlier step.

If the actor's next intended step depends on another character first giving, moving, unlocking, placing, filling, transferring, or otherwise changing tracked state, and the current canonical view shows that prerequisite is still false:

1. do not narrate the prerequisite as completed;
2. do not proceed with a later step that depends on it;
3. use `action: null` unless some other currently available formal action genuinely advances the goal;
4. keep the pending purpose in `continuation`, explicitly noting what the actor is waiting for when useful.

A deliberate wait is a correct response, not an accidental no-op.

Example:

```text
Garrick has filled a mug and told Nell to take it to another patron.
The mug is still canonically in Garrick's possession.

Correct Nell response:
  action: null
  continuation: wait for Garrick to formally give/transfer the filled mug, then deliver it

Incorrect:
  narrate taking the mug and move away to deliver it
```

Another character's dialogue or preparation is not proof that their next tracked formal action has already happened. Only canonical state / grounded engine results establish completion.

---

# 7. Garrick Ale Example

Grounded state:

- Garrick is at the ale tap;
- two empty mugs are in the mug cabinet;
- Garrick is not holding a mug;
- `fill` is relevant but not available;
- `transfer_items` from the mug cabinet is available.

Expected first-pass reasoning:

```text
Goal: serve ale.
fill is a relevant engine mechanic here.
fill is unavailable because I do not yet have a vessel.
transfer_items can satisfy that prerequisite.
Choose transfer_items now.
Keep serving/filling as unfinished continuation.
```

The Character must not narrate taking, filling, and serving the mugs while returning `action: null`.

---

# 8. Diagnostics

Existing AI exchange diagnostics remain the source for inspecting first-pass Character behavior.

Emergency Dump should preserve the actual Character request, including `relevantMechanics`, the exact `available_actions`, and the returned decision through the existing exchange/trace diagnostics.

No additional action-contract second-stage diagnostics are required by this specification.

---

# 9. Required Tests

Test at least:

- ale source present + no mug -> `fill` relevant, unavailable;
- ale source present + mug -> `fill` relevant and available;
- no ale source + mug -> `fill` not relevant;
- paper present + no writing set -> `write_paper` relevant, unavailable;
- paper + writing set -> relevant and available;
- writing set without grounded paper -> `write_paper` not relevant;
- locked passage without key -> `unlock` relevant, unavailable;
- locked passage with key -> relevant and available;
- hidden/ungrounded item-specific mechanics do not leak;
- Character decision prompt contains both relevant mechanics and available actions and explains their distinction;
- prompt forbids narratively completing unavailable tracked effects;
- ordinary Character reaction uses the normal single Character decision request path;
- normal structural/deterministic action validation remains unchanged.

---

# 10. Acceptance Criteria

1. Character requests expose only scene/item-grounded relevant mechanics, not the whole ActionRegistry.
2. Relevant mechanics may describe missing prerequisites without granting execution authority.
3. `view.available_actions` remains the sole executable-now contract.
4. Garrick sees `fill` as relevant while standing at the ale source even before obtaining a mug.
5. Paper writing and unlocking follow the same anchor-versus-prerequisite principle.
6. The prompt explicitly directs the Character toward prerequisite formal actions.
7. Narrative/speech cannot legitimately stand in for tracked engine effects.
8. The old narrative loophole for tracked physical state changes is removed.
9. Ordinary Character turns remain single-pass after normal structured response validation.
10. Existing saves, world simulation behavior, and formal action validation remain compatible.

13. A character waiting on another actor's uncompleted tracked prerequisite is explicitly allowed and instructed to return `action: null` while preserving the pending purpose in `continuation`.
