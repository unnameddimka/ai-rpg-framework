# Daytime Sleep Ban & Third-Person Timelapse Narration Bugfix

## Status

Implemented historical bugfix specification.

## 1. Scope

This bugfix closes two contract/presentation defects in daytime timelapse:

1. free AI planners were still allowed to choose `sleep` during `daytime`;
2. sponsored daytime work narration could be generated from the sponsor's second-person perspective, e.g. `You lead the Traveler...`.

No new fatigue, nap, schedule, work, or Narrator subsystem is introduced.

## 2. Daytime sleep invariant

For `mode = daytime`, `sleep` is not a valid timelapse round action.

Daytime planners may still narrate grounded background activity, use supplied authored timelapse actions, study accessible items, move implicitly between reachable locations, and participate in existing timelapse interactions. They may not choose sleep.

Successful daytime finalization still guarantees that every character is awake at Evening, but that final wake invariant must not conceal intermediate daytime sleeping.

## 3. Planner contract

For daytime planning/replanning:

- omit the `sleep` union branch from the model contract;
- do not advertise the `sleep` JSON shape in the prompt;
- do not expose beds as daytime sleep targets in the supplied reachable-location catalog;
- require exactly one step per remaining daytime round.

Nighttime remains unchanged: a valid final `sleep` step may still end a night plan early.

## 4. Defensive validation

The engine must reject a returned daytime `sleep` step even if it somehow arrives from stale prompt/schema data or future regression.

The timelapse core must also defensively refuse to execute `sleep` in daytime mode if a malformed/fixed plan bypasses ordinary plan validation.

No restriction is added to normal realtime sleep actions or nighttime timelapse sleep.

## 5. Third-person committed narration

Committed timelapse narration is public world narration and should be written in third person.

For ordinary `narrate` plan steps, the model is instructed to use the acting character's visible grounded name rather than narratorial `I`, `you`, or `we` for that actor.

Quoted character dialogue may naturally contain first- or second-person pronouns.

## 6. Sponsored daytime narration

Sponsored work narration must not frame the model as the sponsor speaking to itself in second person.

The request supplies the sponsor explicitly in `context.daytimeJob.sponsor` with canonical ID and visible name, and the worker as the Human-controlled Traveler.

Correct examples:

- `Mara leads the Traveler to the damp patch behind the cottage.`
- `Mara shows the Traveler how to clean the mushrooms.`
- `Harlan keeps the Traveler at the bellows while he works the heated iron.`

Incorrect narrative voice:

- `You lead the Traveler...`
- `I show the Traveler...`
- `We prepare the salve...`

The fix is performed at generation source through prompt/context contract, not by blind pronoun string replacement and not by adding a separate presentation Narrator pass.

## 7. Narrator setting independence

Correct timelapse perspective does not depend on the optional scene Narrator setting. The timelapse planner/work-narration requests themselves must generate suitable committed prose.

## 8. Regression coverage

Tests must prove:

1. daytime validation rejects `sleep` even when supplied a catalog containing a valid bed;
2. nighttime validation still accepts the same valid final sleep step;
3. daytime planner context exposes no bed sleep targets;
4. daytime model response contract contains no `sleep` branch;
5. daytime system prompt does not advertise the sleep JSON variant and explicitly forbids daytime sleep;
6. ordinary committed `narrate` instructions require third-person world narration;
7. sponsored daytime narration explicitly uses the grounded sponsor name + Traveler in third person and no longer primes the model with `You are the sponsoring character`;
8. successful daytime timelapse still ends in Evening with all characters awake;
9. existing nighttime sleep behavior remains green.

## 9. Non-goals

This patch does not add:

- daytime naps;
- fatigue;
- sleep schedules;
- professional routines;
- a prose-rewriting subsystem;
- a second Narrator pass;
- grammatical post-processing;
- changes to work settlement or timelapse encounter arbitration.
