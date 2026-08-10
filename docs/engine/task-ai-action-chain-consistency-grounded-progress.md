# Task: AI Action-Chain Consistency and Grounded Task Progress

## Goal

Improve AI consistency when pursuing short multi-step purposes across multiple reactions.

The model remains responsible for character intent and decision-making. The deterministic engine remains responsible for mechanics and canonical state.

The target relationship is:

```text
current view + continuation
    -> one current formal step
    -> grounded engine result
    -> later view + continuation
    -> reevaluation
```

Do not introduce an engine-side planner, workflow state machine, promise tracker, action queue authored by the model, or character-specific behavior.

## Model catalog scope

Ensure the OpenRouter catalog contains:

```text
deepseek/deepseek-v4-pro — DeepSeek V4 Pro
```

`data/model_list.json` remains authoritative and `src/00-model-list.js` remains generated.

Do not change the authored default model as part of this task. DeepSeek V4 Pro is the primary manual benchmark model for this iteration, but model choice remains configuration rather than architecture.

## Core principles

### 1. Continuation is purpose, not state

`continuation` remains one nullable model-owned short-term working intention.

It never overrides `context.view`.

Before following an existing continuation, the model must re-check canonical mechanical facts it depends on, including possession, item state, money, current location and sublocation, visible characters, and grounded results or failures.

If those facts changed, the model should adapt, recover, revise, abandon, or clear the purpose instead of narrating stale assumptions as true.

Example: if continuation says `Take the empty mug to the bar` but the current view shows the character no longer possesses the mug, the model must not narrate carrying it.

### 2. Progress an adopted purpose when a useful current step exists

When the character has adopted a concrete purpose and a currently available formal action clearly advances it, the model should normally take that action unless personality, circumstances, new observations, failure, or a higher priority justifies postponing, refusing, revising, or abandoning the purpose.

Speech or decorative narration should not replace an obvious required mechanical step.

This rule applies both to a newly adopted intention and an existing `continuation`.

This is not mandatory obedience. Character motivation remains model-owned.

### 3. Available actions describe only the current moment

`context.view.available_actions` is the canonical catalog of actions available **right now**. It is not a catalog of every action that could become available after the world changes.

The model must not conclude that a later step is impossible merely because it is absent now.

Example: if Garrick has no mug, `fill` may correctly be absent while `take_item(emptyMug_1)` is available. He can take the mug, retain the purpose of preparing ale, and reevaluate after the grounded result exposes a new view.

The model should reason one atomic grounded step at a time.

### 4. Choose action type before action parameters

The model should first select the action type whose semantic description matches the intended operation. Only then should it select parameter values from that action's own current `options`.

Never move an option value from one action type into another action type merely because the parameter field has the same name.

Strengthen the canonical movement descriptions:

- `move`: leave the current location and enter another directly connected location; its destination IDs are location IDs.
- `move_within_location`: stay in the current location and change only sublocation/position; its destination IDs are sublocation IDs and never location IDs.

The descriptions live in the canonical action registry and therefore appear in the same `view.available_actions` consumed by HumanController/API users and AIController.

### 5. Narrative is not an alternate execution channel

Narrative remains valid for small visible behavior that does not change canonical state.

Examples that may remain narrative:

- looking or glancing;
- smiling, sighing, hesitating;
- gesturing;
- adjusting clothing;
- wiping part of a counter;
- taking a small sip when the whole drink is not mechanically consumed.

Narrative must not establish a canonical state transition that has not been grounded by the engine.

Examples requiring grounded mechanics when applicable include:

- taking or dropping an item;
- transferring or placing an item;
- filling, transforming, or fully consuming an item;
- transferring money;
- moving between canonical locations or sublocations;
- producing a formal ability result.

`publicNarrative` and `spokenText` may describe intent, effort, preparation, anticipation, or accompanying non-state-changing behavior before confirmation. They must not claim the resulting canonical state already exists.

### 6. Do not declare a multi-step mechanical task complete early

A purpose requiring multiple canonical transitions remains unfinished until grounded engine results establish the required result.

The model must not clear `continuation` merely because it narrated an imagined completion.

Likewise, memory updates, beliefs, relationships, and dialogue must not record an unconfirmed mechanical result as completed.

Example: Garrick must not record `I served the traveler an ale` until the required item preparation/delivery has actually been grounded.

### 7. Repair should preserve intent and repair mechanics

A protocol validation error does not normally invalidate the underlying character purpose.

For a decision repair attempt:

1. preserve the original situation and underlying intention;
2. identify the concrete mechanical validation error;
3. re-read the current action catalog;
4. select the action type by semantic meaning;
5. select parameters only from that action's current options;
6. use `action: null` only when no useful valid action exists or the character deliberately decides not to act.

For option-validation failures, include the allowed values directly in the validation error.

The repair message should also include a compact deterministic summary of the current action catalog: action type, description, and current option values. This is duplicated presentation of the already-canonical view, not new world knowledge and not engine-side planning.

Do not instruct the model that a particular alternative action is mandatory. The repair layer exposes mechanics; the model still owns intent.

### 8. Silent response consistency check

Before returning decision JSON, the prompt should ask the model to silently verify:

- current canonical view versus continuation;
- whether a useful current formal action advances the still-relevant purpose;
- whether the chosen action type semantically matches the intended operation;
- whether every action parameter belongs to that exact action's current options;
- whether narrative, dialogue, memory, belief, or relationship updates jump ahead of grounded mechanical results.

The model must not output this verification or chain-of-thought.

## Preserve existing semantics

Do not change:

- one formal action maximum per AI response;
- deterministic action validation;
- canonical restricted `view`;
- perception and observation delivery;
- world-tick scheduling;
- initiative rules;
- one AI reaction maximum per eligible character per HumanController tick;
- movement event semantics;
- engine ownership of state mutation;
- model ownership of personality, intention, refusal, priorities, and continuation.

Do not automatically execute an entire multi-step chain in one tick. Each step remains atomic and later steps require a later eligible model reaction over a refreshed canonical view.

## Explicit non-goals

Do not add:

- engine-side task planning;
- semantic validation of whether an action is a good choice for `continuation`;
- model-authored action arrays or queues;
- promise tracking;
- scripted Garrick/Nell workflows;
- NLP parsing of narrative to infer state mutations;
- automatic conversion of narrative into formal actions;
- automatic execution of future steps;
- a rule that every physical gesture must be a formal action.

A mechanically valid but strategically foolish action remains mechanically valid. Improving that choice is a prompt/model concern, not a new engine planner.

## Deterministic tests

Add or extend tests proving:

1. The decision prompt says continuation never overrides current canonical view.
2. The decision prompt encourages an obvious current step for an adopted purpose without creating a plan queue.
3. The prompt explains that future actions may appear after prerequisites.
4. The prompt requires semantic action-type selection before parameter selection.
5. The prompt distinguishes harmless non-state-changing RP narration from canonical state transitions.
6. The prompt forbids ungrounded task completion in narrative and memory.
7. `move` and `move_within_location` canonical descriptions clearly distinguish location from sublocation movement.
8. Invalid option errors expose the current allowed values.
9. Repair receives a compact current action catalog and purpose-preserving correction guidance.
10. A mocked `move_within_location { destination_id: "bar" }` can be repaired to `move { destination_id: "bar" }` when the current catalog supports that correction.
11. Strict validation still prevents unavailable actions/options from reaching engine execution.
12. The validator still accepts a mechanically valid action even when its free-form continuation appears strategically inconsistent; the engine must not become a planner.

## Manual regression scenarios

### Garrick: paid ale

Start with a paid ale purpose while Garrick has no mug but can take an empty mug.

Expected tendency across later reactions:

1. take an empty mug;
2. keep the unfinished service purpose in continuation;
3. after a grounded result and refreshed view, fill the mug when available;
4. later deliver/place/give it as appropriate;
5. only then treat the service as mechanically complete.

No narrative or memory should jump directly from payment to completed service.

### Nell: empty mug

Give Nell an empty mug while she is seated in the common room.

Expected tendency:

1. understand returning it as ordinary work;
2. retain the purpose in continuation;
3. stand/change sublocation if necessary;
4. use `move`, not `move_within_location`, to travel to the bar;
5. never narrate carrying the mug after canonical state shows she no longer owns it.

### Repair

Mock an invalid movement action where `bar` is supplied to `move_within_location` while the catalog offers `bar` under `move`.

Expected: the invalid first response is rejected; repair exposes the relevant option sets and semantic descriptions; the corrected response may select `move(bar)` without losing the continuation.

## Benchmark

Use `deepseek/deepseek-v4-pro` as the primary manual benchmark model after implementation.

Repeat the same compact Garrick/Nell scenarios on later candidate models so model quality is compared against one clarified, model-independent contract.
