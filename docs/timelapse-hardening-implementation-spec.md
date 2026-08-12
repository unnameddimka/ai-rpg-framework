# AI RPG Patch Specification — Timelapse Hardening and Progressive Committed Output

## 1. Scope

Harden the existing overnight timelapse implementation based on the first live playtest, reduce unnecessary latency/model work, and make already-committed gameplay output appear incrementally instead of waiting for an entire world operation to finish.

This patch must:

- make all timelapse structured-response contracts explicit and unambiguous;
- prevent structured timelapse calls from exhausting the global completion budget on hidden reasoning;
- use compact timelapse-specific model context instead of sending unnecessary normal-tick action machinery;
- parallelize model calls that are causally independent while preserving deterministic canonical execution;
- prevent the social encounter resolver from turning future intentions into already-completed world facts;
- avoid resolver/replan work for encounters in which nobody actually interacts;
- strengthen `narrate` grounding so it does not claim tracked canonical mutations;
- progressively publish committed output for both normal world ticks and timelapse rounds;
- add DeepSeek V4 Flash to the selectable model list;
- keep the current overnight/sleep behavior as the only implemented timelapse entry mode, while making the reusable timelapse core less night-specific where practical.

The existing overnight timelapse mechanics from the previous patch remain the behavioral baseline unless this specification explicitly changes them.

## 2. Explicitly Out of Scope

Do **not** implement or redesign the following in this patch:

- daytime timelapse triggering, procedure, round count, work/job mechanics, or completion semantics;
- narrator grounding/prompt changes;
- equippables or gift mechanics;
- new memory architecture beyond the existing reflection/consolidation flow;
- new timelapse authored actions beyond those already present;
- new aura content or aura rewrites.

The presentation narrator is currently being tested disabled. Preserve it, but do not use this patch to fix its hallucination/grounding behavior.

## 3. Generic Timelapse Architecture Boundary

A daytime timelapse mode is planned for the future. The current patch must not implement it, but shared timelapse code should avoid unnecessary overnight-only assumptions.

Use a reusable timelapse core where practical, conceptually:

- generic timelapse runner/context;
- current mode value: `overnight`;
- overnight sleep remains the only implemented HumanController entry point;
- overnight-specific postconditions such as waking the HumanController in the morning remain in the overnight wrapper/orchestrator rather than becoming universal timelapse assumptions.

It is acceptable to keep existing night-specific compatibility wrappers if renaming them would create unnecessary churn. New shared APIs and data structures should prefer neutral `timelapse` terminology.

Do not define a daytime mode contract yet beyond noting that the reusable core is expected to support another mode later.

## 4. Structured Timelapse Protocols

### 4.1 General rule

Every model-facing timelapse request that expects structured JSON must receive the **exact response contract accepted by the parser/validator**.

Do not provide a single example that represents only one branch of a union while verbally describing additional branches.

Do not require the model to infer field names such as `bedId` versus `bed_id` or `actionId` versus an authored action ID used directly as `type`.

The prompt contract, parser, validator, repair prompt, and tests must agree on the same canonical property names.

### 4.2 Plan/replan response contract

Use the following canonical plan shape:

```json
{
  "steps": [
    {
      "locationId": "reachable_location_id",
      "action": {
        "type": "narrate",
        "text": "what the character does during this round"
      }
    },
    {
      "locationId": "reachable_location_id",
      "action": {
        "type": "sleep",
        "bedId": "concrete_bed_id"
      }
    },
    {
      "locationId": "reachable_location_id",
      "action": {
        "type": "timelapse_action",
        "actionId": "authored_timelapse_action_id"
      }
    }
  ]
}
```

The three action variants above are a union, not a requirement to include all three.

Validation rules:

- `locationId` must be one of the supplied reachable locations;
- `narrate.text` must be non-empty;
- `sleep.bedId` must be one of the supplied beds for that selected location;
- `timelapse_action.actionId` must be one of the supplied timelapse actions for that selected location;
- if no `sleep` step is returned, the plan must contain exactly one step per remaining round;
- if `sleep` is returned, it must be the final returned step and may terminate the plan before all remaining rounds are explicitly listed;
- no step may appear after `sleep`;
- there is no `null`, `pass`, ordinary `move`, or ordinary world-tick formal action in the timelapse plan protocol.

This same contract is used for initial plan and replan requests.

### 4.3 Interaction intent contract

Keep interaction intent compact. The model does not need a large nested protocol to express a social intention.

Use a canonical shape equivalent to:

```json
{
  "engage": true,
  "intent": "Brief description of what this character tries to do socially, including relevant topic, tone, question, reveal/avoid choice, or desire to disengage."
}
```

For a deliberate non-interaction:

```json
{
  "engage": false,
  "intent": "Keep to myself and continue my own activity."
}
```

`intent` is private planning input to the resolver. It is **not** a committed fact and is never shown to the player.

If the current implementation already stores additional intent metadata internally, it may keep it, but the model-facing contract should remain as small and explicit as practical.

### 4.4 Encounter resolver contract

The group resolver returns only the public social result of the encounter:

```json
{
  "interactionOccurred": true,
  "interactionResume": "Compressed public summary of the interaction that actually occurred in this encounter."
}
```

For a resolved encounter with no actual social exchange:

```json
{
  "interactionOccurred": false,
  "interactionResume": ""
}
```

The engine must use the explicit boolean rather than trying to infer no-op status by parsing prose.

### 4.5 Reflection and existing consolidation contracts

Do not redesign reflection or memory consolidation in this patch.

However, any structured reflection response must follow the same protocol-hardening rule: the prompt must show the exact schema currently accepted by its parser/validator, not an incomplete example.

Existing memory consolidation remains the existing mechanism and continues after reflection.

## 5. Timelapse-Specific Compact Model Context

The timelapse planner/replanner must not receive the entire ordinary controller `view` when that information is irrelevant to coarse planning.

In particular, do not resend the full ordinary `view.available_actions` action schemas/options to timelapse plan/replan calls.

Build a compact purpose-specific context containing only information needed for the coarse decision, such as:

- character ID/name;
- stable scene-independent character description required for roleplay;
- current canonical location and sleeping state;
- compact inventory identity information when relevant to character behavior;
- private known facts, beliefs, relationships, memories, and `continuation` already allowed for that AI;
- the reachable-location catalog already computed by the engine;
- concrete bed IDs per reachable location;
- authored timelapse action IDs/labels/descriptions per reachable location;
- remaining round count;
- compact, relevant, already-committed timelapse facts;
- latest meaningful encounter resume, if any;
- latest grounded failure, if any.

Route/key authorization remains engine-owned. The planner does not need ordinary move/key action schemas when the reachable-location catalog already encodes which locations are currently reachable.

### 5.1 Canonical state wins over summaries

If a prior compressed fact or encounter summary conflicts with current canonical state, current canonical state is authoritative.

The engine should avoid creating such conflicts in the first place, but the planner prompt must explicitly state that current canonical state wins.

### 5.2 Avoid redundant committed-fact growth

Do not repeatedly resend multiple semantically duplicate summaries of the same encounter or activity.

For replanning, provide a compact ordered set of relevant committed facts, deduplicated where practical. The full diagnostic history remains available in the AI interaction log and does not need to be copied into every model request.

## 6. Reasoning and Completion Budgets for Structural Calls

Timelapse planning, replanning, interaction intent, and encounter resolution are short structured tasks. They must not be allowed to consume the full global completion budget as hidden reasoning.

For these structural timelapse calls:

- disable reasoning when the selected provider/model supports doing so cleanly; otherwise
- use a small dedicated reasoning cap, with a target ceiling of roughly 512 reasoning tokens or less;
- use a purpose-specific completion/output budget appropriate to the small JSON response rather than the normal large RP budget;
- leave enough completion budget for the visible JSON response even when reasoning is enabled.

Implementation details may vary by model/provider, but the invariant is:

> A structural timelapse call must never be able to spend thousands of tokens debating its own response schema before producing the JSON object.

Reflection may use a larger reasoning/output allowance than plan/intent/resolver calls because it is a semantic character-state task, but it must still have an explicit bounded configuration rather than accidentally inheriting an unlimited structural-call budget.

## 7. Error Classification and Retry Behavior

Do not collapse transport/generation truncation into a generic "invalid timelapse protocol data" message.

At minimum distinguish:

- `MODEL_OUTPUT_TRUNCATED` / provider `finish_reason = length`;
- JSON parse failure;
- parsed JSON that fails protocol validation;
- provider/network failure.

For a structural call that ends with `finish_reason = length` before a complete response is available:

1. record the exact truncation reason in the AI interaction log;
2. retry once with reasoning disabled or reduced to the minimum supported setting and the same exact structured contract;
3. if the retry also fails, abort the current timelapse operation with the explicit truncation error rather than relabeling it as schema invalidity.

Existing repair behavior may remain for parseable-but-invalid JSON, but repair prompts must repeat the exact canonical schema.

Do not fabricate a fallback plan when both the original call and allowed retry fail.

## 8. Parallelize Only Causally Independent Model Calls

Parallelization applies to model inference work, not to conflicting canonical state mutations.

### 8.1 Initial planning wave

All awake AI characters' initial timelapse planning requests are based on the same committed timelapse-start state and may run concurrently.

Use one concurrent wave and wait for all required plans before executing round 1.

### 8.2 Interaction intent wave

Within one encounter group, all participants' isolated `interactionIntent` requests may run concurrently because each receives only its own private context plus the same already-committed public encounter context.

### 8.3 Independent encounter groups

Different encounter groups in different rooms within the same fully-resolved round may perform their intent/resolver model work concurrently.

No private context may cross between groups or participants.

### 8.4 Replan wave

After a round is fully committed, all characters that genuinely require replanning may replan concurrently from that same committed round boundary.

### 8.5 Reflection and consolidation waves

After round 5:

1. run reflection for every AI character concurrently;
2. wait for the full reflection phase to complete and commit private reflection updates;
3. then run the existing consolidation operation for every AI character concurrently.

Preserve the phase barrier: reflection precedes consolidation.

### 8.6 What remains sequential

The following must remain causally sequential:

- timelapse round 1 -> round 2 -> round 3 -> round 4 -> round 5;
- deterministic canonical mutations whose order can conflict;
- ordinary world-tick AI reaction cascade, because later reactions must see observations/results committed by earlier reactions.

Use the existing stable scheduler ordering for deterministic canonical mutations.

## 9. Social Encounter No-Op Optimization

After interaction intents are collected for a room:

- if every participant returns `engage = false`, skip the shared resolver call entirely;
- commit no social interaction resume for that group;
- do not trigger replanning merely because the characters occupied the same room;
- each character keeps its existing future plan unless another independent reason requires replanning.

If at least one participant attempts engagement, call the shared resolver.

After the resolver:

- if `interactionOccurred = false`, do not replan solely because of that encounter;
- if `interactionOccurred = true`, participants may replan their remaining future rounds as in the existing design;
- a grounded step failure independently requires replanning even if the social encounter was a no-op.

Combine multiple replan reasons into one request per character per round.

## 10. Encounter Resolver Grounding

The encounter resolver describes **only what happened socially during the current encounter**.

It must not execute or commit future intentions contained in an `interactionIntent`.

Examples of forbidden resolver behavior:

- intent says "after this I will go to my room" -> resolver claims the character already moved to the room;
- intent says "I plan to sleep afterward" -> resolver claims the character is now asleep;
- intent says "I will clean the tables after talking" -> resolver claims the cleaning happened;
- resolver moves items, changes money, locks doors, or performs other canonical actions.

The resolver may establish public social facts such as:

- who actually engaged whom;
- who declined or ignored an attempt;
- topics discussed;
- questions asked/answered;
- statements actually made;
- information actually revealed;
- public tone of the exchange;
- that somebody verbally excused themselves or ended the conversation.

A statement such as "Price said he was turning in" may be a social fact if the resolver determines he actually said it. It must **not** become "Price went upstairs and slept" unless a later canonical timelapse step actually performs that movement/sleep action.

The resolver remains public-only and receives no participants' private memories/beliefs/relationships/continuations beyond the private intents that each participant deliberately produced for this encounter.

## 11. `narrate` Grounding Hardening

`narrate` remains useful for arbitrary coarse background activity, but it is not a hidden canonical action channel.

Strengthen its system prompt so that committed `narrate` text must not claim a transition of tracked canonical state that the engine did not perform.

Tracked state includes at least:

- character location/sublocation/sleeping state;
- canonical inventory membership;
- item placement between inventories/surfaces/containers;
- item definition/state transformations;
- money;
- keys/ownership;
- locks/doors;
- deterministic world flags or authored mechanical effects.

Allowed `narrate` examples include:

- thinking or reflecting informally;
- reading or studying without creating a new canonical item/state;
- tending herbs in a non-mechanical descriptive sense;
- cleaning/polishing one's gear without transferring or transforming tracked items;
- waiting, resting while awake, watching the room, writing, praying, stretching, or similar background activity;
- transient gestures that do not claim a persistent tracked-state transition.

Forbidden examples include:

- "puts four tracked mugs on the table" when those mugs remain in inventory;
- "places the room key on the nightstand" when the key remains in inventory;
- "locks the door" without a canonical lock action/effect;
- "gives Nell two gold" without a canonical money transfer;
- "empties all mugs and stores them" unless the authored deterministic timelapse action actually executes that effect.

Do not add another LLM grounding pass merely to police `narrate`. Prefer a tighter prompt, smaller context, exact contracts, and deterministic canonical effects for stateful actions.

Canonical state remains authoritative if prose ever disagrees with it.

## 12. Progressive Committed Output — General Rule

Already-committed gameplay output must become visible as soon as its commit boundary is reached.

Never expose:

- model reasoning/thinking;
- initial plans;
- replans;
- private interaction intents;
- pending/unresolved actions;
- speculative results;
- reflection/consolidation internals.

Only already-committed narrative/action-result blocks may be published.

Input/control remains locked until the entire canonical operation is complete.

### 12.1 Normal world ticks

During one HumanController world tick:

1. execute and commit the HumanController action/attempt result;
2. immediately append its visible committed output;
3. process the causally next AI reaction;
4. when that AI attempt/result is committed, immediately append the output visible under existing perception/invisible-event rules;
5. continue the reaction cascade one committed reaction at a time;
6. unlock HumanController input only after the entire canonical world tick/reaction cascade is complete.

Do not wait for all AI reactions before showing the human action or earlier AI reactions.

Preserve the existing rule that off-screen/invisible events remain hidden unless the existing `Show invisible events` debug option allows them.

The current ordinary world-tick reaction order remains sequential and deterministic; this requirement changes presentation timing, not initiative/causality.

### 12.2 Timelapse rounds

For timelapse:

1. fully resolve the current round's movement/actions;
2. resolve any actual social encounters for that round;
3. commit the final facts of that round;
4. immediately append the round's visible/invisible-debug committed output;
5. then perform any required replanning for future rounds and continue.

Therefore a later replan/model failure must not erase already-committed earlier-round output.

Do not wait until all five rounds, reflection, and consolidation are complete before showing the five rounds.

Reflection/consolidation remains private and is not rendered as gameplay prose.

### 12.3 No duplicate final rendering

The existing final aggregation path must not append a second copy of blocks already published progressively.

Use stable committed block/event IDs or another deterministic bookkeeping mechanism so each committed output block is rendered at most once.

If the runtime still needs a complete canonical operation transcript internally after completion, build it from the same committed records without re-emitting them to the UI.

### 12.4 Failure after partial progress

If a later AI request fails after earlier parts of a tick/timelapse have already committed:

- keep the already-committed canonical state;
- keep already-rendered committed output visible;
- show the specific failure/error state;
- do not rewrite prior output as if the whole operation never happened.

Any rollback behavior, if the current runtime has an explicit transactional rule that conflicts with this, must be handled consciously and tested. Do not silently display uncommitted output.

## 13. Presentation Narrator Compatibility

Do not change narrator prompts, narrator grounding rules, or narrator model selection in this patch.

Progressive committed-output plumbing should be implemented below/alongside the narrator-specific presentation layer so committed gameplay blocks can be emitted incrementally when the narrator is disabled, which is the current test configuration.

If the narrator is enabled and the existing architecture requires a completed batch before prose generation, preserve existing narrator behavior rather than introducing speculative narrator streaming in this patch.

A later narrator-focused patch may adapt the narrator to the same commit-event stream.

## 14. DeepSeek V4 Flash Model Entry

Add **DeepSeek V4 Flash** to the project's selectable/supported AI model list using the same central model-registry/configuration mechanism as existing selectable models.

Requirements:

- it is selectable anywhere the current character AI model list is used;
- do not automatically switch existing characters or saves to Flash;
- do not change the default model solely because this entry is added;
- preserve save compatibility for existing model IDs;
- use the project's normal OpenRouter model-ID/config convention rather than hard-coding provider behavior in timelapse logic.

The purpose of this patch is to make Flash available for live A/B testing against the current Pro model, not to make an untested global migration.

## 15. AI Interaction Log

Preserve the existing detailed AI exchange log and the current retention target of 100 entries.

For parallel waves, each exchange must still record:

- actor;
- stage;
- model ID;
- start/end timestamps or duration;
- raw response when available;
- usage;
- parse/validation/repair state;
- explicit truncation/provider failure information.

Parallel execution must not scramble the logical stage/actor identity of log entries.

No planning/thinking/debug trace is shown in normal gameplay output merely because it is retained in this diagnostic log.

## 16. Save/Load Compatibility

Do not invalidate the current playthrough save merely because this patch changes prompts, orchestration, model options, or authored descriptions.

Preserve the existing save/load principle:

- fresh authored world data supplies canonical authored definitions/descriptions/new stable authored IDs;
- save data overlays runtime state;
- a saved runtime copy must not overwrite a newly corrected authored AI/public description if the current save architecture already treats those descriptions as fresh authored data.

No save migration should be required solely for the timelapse protocol hardening.

## 17. Tests

Add or update automated tests for at least the following cases.

### 17.1 Exact plan protocol

- valid `narrate` step parses without repair;
- valid `sleep` step uses exactly `bedId` and parses without repair;
- valid authored action uses exactly `type: "timelapse_action"` + `actionId` and parses without repair;
- `bed_id`, authored action ID used directly as `type`, ordinary `move`, and steps after `sleep` are rejected;
- sleep may legally terminate a plan before the remaining-round count is exhausted.

### 17.2 Truncation handling

- provider `finish_reason = length` is classified as truncation, not generic protocol invalidity;
- one reduced-reasoning retry is attempted for a structural truncation;
- a second truncation produces the explicit final error;
- no fabricated plan is committed.

### 17.3 No-op encounters

- all participants `engage = false` -> no resolver call and no encounter-driven replan;
- resolver returns `interactionOccurred = false` -> no encounter-driven replan;
- `interactionOccurred = true` -> affected participants may replan remaining rounds;
- grounded action failure still causes replan even when social interaction is a no-op.

### 17.4 Resolver grounding

- an intent containing a future sleep/move does not mutate canonical location/sleeping state;
- resolver summary cannot cause item/money/lock mutations;
- current canonical state remains unchanged until later deterministic timelapse execution.

### 17.5 Parallel waves

Using delayed/mock model calls, verify that:

- initial plans overlap in wall-clock execution;
- same-group interaction intents overlap;
- independent encounter groups can overlap;
- required replans overlap after a committed round boundary;
- reflections overlap;
- consolidations overlap only after the reflection phase barrier;
- deterministic canonical mutations retain stable scheduler order.

### 17.6 Progressive normal tick output

For a HumanController action followed by multiple AI reactions:

- human committed output is emitted before the full tick promise resolves;
- each AI committed block is emitted after that reaction commits and before later reactions finish;
- input remains locked until the complete tick ends;
- invisible/off-screen events obey the existing debug visibility rule;
- no output block is duplicated at finalization.

### 17.7 Progressive timelapse output

- round 1 output appears before round 2 completion;
- each round is emitted only after its encounter result is committed;
- a later replan failure leaves earlier committed round output visible;
- planning/intents/replanning/reflection/consolidation internals are never emitted as gameplay text;
- final aggregation does not duplicate progressively emitted rounds.

### 17.8 Compact context

- timelapse plan/replan requests do not include the full ordinary `view.available_actions` contract;
- reachable locations/beds/timelapse actions remain present;
- canonical current location/sleeping state is present;
- private context isolation is preserved.

### 17.9 Model list

- DeepSeek V4 Flash appears in the selectable model registry/UI;
- existing model IDs still load;
- adding Flash does not change an existing character's selected model automatically.

## 18. Acceptance Criteria

The patch is complete when:

- valid timelapse plan/replan responses no longer require repair because of ambiguous field names;
- structural calls cannot burn the full 6000-token completion budget on reasoning before emitting JSON;
- causally independent model calls execute in parallel while canonical world mutation remains deterministic;
- no-op social co-location avoids unnecessary resolver/replan calls;
- encounter summaries do not execute future movement/sleep/action intentions;
- `narrate` no longer instructs the model that tracked canonical transfers may be asserted as free prose;
- normal world ticks visibly advance block-by-block as committed reactions complete;
- timelapse visibly advances round-by-round as committed rounds complete;
- input stays locked until each full canonical operation completes;
- DeepSeek V4 Flash is selectable without becoming the default;
- current overnight behavior still works and daytime timelapse remains unimplemented;
- all existing relevant tests plus the new regression tests pass;
- the project builds successfully.
