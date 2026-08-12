# AI RPG Patch Specification — Night Sleep Timelapse

## 1. Scope

Implement a coarse-grained overnight timelapse that is triggered when the HumanController chooses `sleep` while lying on a bed.

The feature must:

- preserve the existing canonical HumanController/AIController `view` architecture;
- keep normal world-tick actions atomic and grounded;
- add a separate coarse-grained timelapse planning/execution mode;
- allow AI characters to spend the skipped night independently, meet each other, interact in compressed form, rethink the remainder of their plans, reflect on the day, and consolidate memory;
- keep all model calls isolated per character except for a dedicated public interaction resolver;
- expose only final committed overnight facts in the invisible narrative UI;
- retain detailed LLM request/response diagnostics in the existing AI interaction log.

This specification does **not** add or modify aura content.

## 2. Realtime Sleeping State

### 2.1 Canonical state

Characters must have an explicit canonical sleeping state.

`lying` on a bed and `sleeping` are different states.

### 2.2 Realtime `sleep`

All canonical beds must expose the same formal `sleep` interaction through the shared controller action contract.

For an AI-controlled character in normal world-tick mode:

- choosing `sleep` while on a bed sets `sleeping = true`;
- the reaction ends pass-like;
- sleeping itself must not generate a self-observation whose only purpose would be to schedule another AI reaction.

For the HumanController:

- choosing `sleep` while on a bed starts the overnight timelapse;
- the HumanController is unavailable during the timelapse;
- after the timelapse completes, the HumanController wakes and control returns.

### 2.3 Automatic wake on acting or speaking

If a character currently has `sleeping = true`:

- any formal action clears `sleeping` before processing;
- any non-empty `spokenText` clears `sleeping` before processing.

No explicit self-`wake_up` action is required.

Receiving an observation alone does not clear `sleeping`.

## 3. Overnight Timelapse Overview

A HumanController sleep-to-morning operation consists of:

1. five coarse timelapse rounds;
2. end-of-day reflection for every AI character;
3. memory consolidation for every AI character.

The operation is a dedicated timelapse workflow, not five ordinary world ticks.

AI characters already sleeping when the HumanController starts the timelapse do not need an initial activity plan and remain sleeping through the five timelapse rounds.

## 4. Timelapse Round Model

### 4.1 Five abstract rounds

The overnight activity phase contains five abstract rounds.

Rounds are not mapped to exact clock times.

### 4.2 Fundamental plan unit

For every active round, a character chooses:

`(location, action)`

There is no separate timelapse `move` action.

Selecting a location implies that the engine attempts to move the character to that location before executing the selected action, all within the same timelapse round.

### 4.3 Allowed action classes

For a selected reachable location, an AI may choose:

1. `narrate`;
2. `sleep`;
3. an authored location-specific `timelapseAction`.

There is no `null`/pass timelapse action.

If a character wants to remain somewhere doing little, it must use `narrate` and explain what it is doing there.

## 5. Reachable Locations

### 5.1 Route search

At planning and replanning time, construct the set of locations reachable from the character's current canonical location.

Use a simple graph search over the canonical location-transition graph.

A transition is traversable when:

- it is open/unblocked; or
- existing lock/key mechanics allow the actor to traverse it because the required key is in the character's canonical inventory.

Cut off a graph branch when a blocking transition cannot be traversed and the actor lacks the required key/access.

Do not bypass existing lock/key authorization semantics.

### 5.2 Planning context

The timelapse planner receives a compact reachable-location catalog.

For each reachable location expose:

- location identity/name;
- authored `timelapseActions`;
- available concrete bed IDs, if any.

### 5.3 Revalidation during execution

Reachability calculated during planning is not a guarantee.

Immediately before executing a round step, revalidate the route and target action against current canonical state.

If the route or selected action has become impossible:

- the round is spent;
- keep the character at the last valid canonical state;
- record a grounded failure;
- replan only the remaining future rounds.

## 6. Movement Is Included in the Round

For every round step:

1. validate/resolve a route to the selected target location;
2. move the character there using coarse timelapse movement;
3. execute the selected action.

Travel never consumes an additional timelapse round.

This applies to `narrate`, `sleep`, and authored location-specific `timelapseActions`.

Do not simulate ordinary world ticks for intermediate rooms.

## 7. `narrate`

`narrate` is a free-form model-authored description of what the character does during that round in the selected room.

It is intentionally permissive.

Examples include reading, working with herbs, cleaning personal equipment, waiting, thinking, resting without sleeping, or any other ordinary background activity.

A `narrate` step is not a general canonical mutation channel. It must not directly create/delete/transfer canonical items, money, keys, ownership, or other deterministic world state, and must not author another autonomous character's decisions as fact.

The committed narration is an autobiographical/background fact of the character's night.

## 8. `sleep`

A timelapse `sleep` action must specify a concrete `bedId`.

The bed must:

- exist;
- belong to the selected target location;
- be reachable under the same route/access rules.

On success the engine:

- moves the character to the target room within the same timelapse round;
- places the character on/in the chosen canonical bed sublocation through the existing location/sublocation/posture system;
- sets `sleeping = true`.

After successful sleep, that character takes no further timelapse rounds.

The contract must support rooms with multiple beds even if the current authored world usually has only one.

## 9. Location-Specific `timelapseActions`

Locations may define a separate authored collection:

`timelapseActions`

These actions:

- are visible only to the timelapse planner;
- must not appear in normal `view.available_actions`;
- may compress routine multi-step physical work into one coarse round.

Implement them using the same general pattern as deterministic authored item-use mechanisms:

- authored action ID;
- label/description;
- allowlisted deterministic `effectId`;
- authored effect parameters;
- engine-side validation and deterministic execution;
- grounded committed result.

Do not create world-specific narrative hard-coding when a reusable effect mechanism is appropriate.

## 10. Initial AI Planning

At the start of the five-round phase, every AI character with `sleeping != true` receives its own isolated planning request.

The request includes:

- that character's private AI context;
- current canonical self-state;
- relevant memory/belief/relationship/continuation data;
- reachable-location catalog;
- number of remaining rounds, initially 5;
- instructions to produce coarse `(location, action)` steps.

A `sleep` step terminates active participation; no later active steps are needed after successful sleep.

Never combine multiple characters' private minds in one planning request.

## 11. Round Execution Order

For each timelapse round:

### Phase A — movement

Resolve all active characters' movement to their selected target rooms.

### Phase B — current-round action execution

Execute the selected `narrate`, `sleep`, or deterministic location-specific `timelapseAction`.

For conflicting deterministic effects, use a stable deterministic character ordering consistent with existing scheduler conventions.

### Phase C — encounter detection

After current-round movement/actions resolve, group currently awake characters by canonical room/location.

Ignore sublocation differences.

Only groups of two or more awake characters need encounter processing.

## 12. Compressed Social Encounters

### 12.1 One group encounter

Treat 2+ awake characters in the same room as one group encounter.

Do not decompose a group into pairwise conversations.

### 12.2 Per-character `interactionIntent`

For every participant, make one isolated AI request.

Provide:

- that participant's private AI context;
- committed previous timelapse facts relevant to it;
- its own current-round activity;
- identities and observable current-round activities of the other awake characters in the room;
- relevant earlier compressed encounter facts from this timelapse.

Ask for an `interactionIntent`, not a line-by-line dialogue.

The intent may express whether the character engages, desired topics/questions, tone, what it is willing to reveal, what it avoids, notable statements, and intentions after the encounter.

Never include other participants' private contexts.

### 12.3 Shared resolver

After all intents are available, make one resolver request for the whole encounter group.

The resolver receives only:

- public/observable room context;
- observable current-round activities;
- all participant `interactionIntent` outputs;
- relevant already committed public encounter facts if needed.

It must not receive any participant's private memories, beliefs, relationships, continuation, or hidden self-state.

The resolver returns one grounded `interactionResume` describing what actually happened in compressed form.

It may establish who engaged, topics discussed, information actually said/revealed, questions asked/answered, notable statements, and how the encounter ended.

It must not invent hidden motivation, perform deterministic formal actions, or create canonical physical state changes.

## 13. Replanning

A timelapse plan is an intention, not a commitment.

Replan only the remaining future rounds when:

- the character participated in an encounter; or
- its current planned step failed canonical validation/execution.

A replanning request receives:

- the character's own private context;
- committed results of previous rounds;
- latest `interactionResume`, if applicable;
- grounded failure information, if applicable;
- current canonical state;
- freshly recalculated reachable-location catalog;
- number of remaining rounds.

The replacement plan starts with the next round.

Unaffected characters keep their existing remaining plan.

If multiple replan reasons affect one character in the same round, combine them into one replanning request after the round fully resolves.

## 14. End-of-Day Reflection

After round 5, run a private reflection operation for **every AI-controlled character**, including AI characters that slept through the entire night.

Reflection may update model-owned private state already supported by the project, such as memories, beliefs, relationships, and other private psychological/self-state fields.

Reflection is not a public world action and must not fabricate deterministic canonical physical results.

The HumanController does not receive an AI reflection request.

## 15. Memory Consolidation

After reflection, run the existing memory-consolidation mechanism for every AI-controlled character.

Reuse the existing consolidator.

Order:

1. five timelapse rounds;
2. reflection;
3. consolidation.

## 16. Morning Completion

After reflection and consolidation:

- end timelapse mode;
- set the HumanController `sleeping = false`;
- return control to the HumanController;
- preserve the final canonical locations/sublocations/sleeping states of AI characters.

Do not automatically wake all AI characters merely because morning has arrived.

## 17. Invisible Narrative

`Show invisible events` must show only final committed facts from the completed night.

Do not show:

- initial plans;
- replacement plans;
- raw `interactionIntent`;
- planning scaffolding;
- reflection/consolidation internals.

Build the overnight invisible text deterministically by concatenating/formatting committed round results and `interactionResume` results.

Do not make a separate LLM summarization call.

The invisible narrative exists to show what actually happened, not how the models planned it.

## 18. AI Interaction Log

All timelapse model calls continue to appear in the existing AI interaction diagnostics:

- initial planning;
- interaction intents;
- group resolver;
- replanning;
- reflection;
- consolidation where already logged.

Increase retained AI interaction log capacity from the current approximately 50 entries to **100 entries**.

Prefer a named constant/configuration value such as:

`MAX_AI_INTERACTION_LOG_ENTRIES = 100`

instead of a duplicated magic literal.

## 19. Validation Requirements

Validate all model-authored structured choices before canonical execution.

At minimum:

- `locationId` is reachable at execution time;
- `sleep` references a valid concrete bed in the target room;
- a location-specific `timelapseAction` exists in that room;
- its deterministic effect is allowlisted and parameters are valid;
- planner/resolver text cannot directly mutate canonical state.

A legitimate planned step that becomes impossible consumes the round and produces grounded failure information for replanning.

## 20. Existing Architectural Invariants

Preserve:

- shared restricted `view` for normal HumanController and AIController gameplay;
- private AI context isolation;
- deterministic engine ownership of canonical state;
- atomic ordinary world-tick gameplay;
- model narrative as subordinate to canonical engine truth;
- no normal-game exposure of timelapse-only macro actions.

## 21. Required Tests

Add or update tests covering at least:

### Realtime sleeping
- AI sleep on a bed sets `sleeping = true`;
- sleep does not self-schedule another reaction;
- a later formal action clears sleeping;
- later non-empty speech clears sleeping;
- observation alone does not clear sleeping;
- Human sleep on a bed starts overnight timelapse.

### Reachability
- open paths are reachable;
- locked path without required key is unreachable;
- locked path with required key is reachable;
- reachability is revalidated on execution/replan.

### Plan validation
- only reachable rooms may be chosen;
- `narrate` works in any reachable room;
- `sleep` requires a concrete valid bed;
- location-specific action must belong to the target room;
- no timelapse `null`;
- travel does not consume a second round.

### Five-round execution
- exactly five global rounds are processed;
- a character that sleeps exits later rounds;
- already sleeping AI characters skip initial activity planning;
- failed current-round step consumes the round and replans only future rounds.

### Encounters
- awake characters sharing a room form one group;
- sublocation differences do not split it;
- sleeping characters are excluded;
- 3+ characters use one group encounter rather than pairs;
- each participant receives a private intent request;
- resolver gets intents/public context but not private memories/beliefs;
- participants replan from next round;
- unaffected characters keep existing plans.

### End-of-day
- reflection runs for every AI, including those asleep all night;
- HumanController gets no AI reflection;
- consolidation runs after reflection;
- Human wakes and regains control.

### Invisible output
- only committed results are shown;
- plans/intents are not shown;
- no LLM recap call is made.

### Diagnostics
- AI interaction log retains up to 100 entries;
- timelapse calls appear in that log.
