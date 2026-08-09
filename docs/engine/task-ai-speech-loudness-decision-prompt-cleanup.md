# AI Speech Loudness + Decision Prompt Cleanup

## Goal

Bring AI-controlled speech into the same mechanically meaningful loudness contract already used by HumanController, and improve AI decision coherence without adding scheduler, planning, relationship, or world-state mechanics.

This task has two parts:

1. AI speech exposes the same loudness choice already available to HumanController.
2. The shared AI decision prompt is shortened and reorganized around causal intent, continuation, stable character identity, and memory discipline.

Do not add character-specific fixes for Garrick, Nell, Mara, Captain Price, or any other authored NPC.

## Public capability parity

HumanController and AIController should expose the same canonical public gameplay capabilities wherever practical. Differences should primarily concern private AI state such as memories, beliefs, relationships, continuation, and model context.

If HumanController can mechanically choose a speech property that changes perception, AIController must be able to choose that property through its structured response contract.

## Structured AI loudness

Extend the AI decision response with `spokenLoudness`:

```json
{
  "action": null,
  "publicNarrative": null,
  "spokenText": null,
  "spokenTargetId": null,
  "spokenLoudness": null,
  "continuation": null,
  "memoryUpdates": {
    "recentMemoriesToAdd": [],
    "beliefsToUpsert": [],
    "relationshipsToUpsert": []
  }
}
```

Use exactly the same loudness values and semantics as HumanController. In the current engine these are `noticeable` (Normal) and `hidden` (Quiet / private). Keep the values canonical rather than inventing an AI-only vocabulary.

`spokenLoudness` is per utterance and is not persistent AI controller state. Human UI may preserve its last selection for interface convenience, but an AI chooses loudness independently on each response.

When `spokenText` is null, `spokenTargetId` and `spokenLoudness` are null. Invalid loudness values and non-null loudness without speech are rejected by the protocol validator.

## Shared speech/perception pipeline

AI speech must pass through the existing `CharacterAPI.submitIntent()` / narrative event path used by HumanController. Do not create separate AI recipient logic.

Conceptually:

```text
AI response
  -> spokenText + spokenTargetId + spokenLoudness
  -> canonical intent/narrative event creation
  -> existing noticeability/recipient logic
  -> delivered observations
```

The same target, loudness, location, and perception rules must produce the same recipient semantics regardless of controller type.

Natural-language wording does not own the mechanic. `*whispers*`, `*in a low voice*`, `quietly`, and similar prose are style/narration only and must not infer or override `spokenLoudness`.

## Decision prompt restructure

Do not append another large block to the existing prompt. Reorganize the decision instructions into a clearer decision order while preserving existing grounding and RP invariants.

### 1. Understand the current situation

- `context.view` is authoritative for current public and operational state.
- Delivered pending observations have already passed deterministic perception rules. Treat them as perceived and do not second-guess audibility or visibility.
- Current `position_text` overrides stale spatial memory.
- A character absent from the current visible character list is not presently visible.

### 2. Preserve stable identity and social continuity

Canonical character IDs represent persistent identity. The same `characterId` remains the same known person after leaving and returning to a room.

Room transitions do not reset familiarity, prior interaction, memories, beliefs, or relationships. Do not treat a returning known character as a new stranger merely because they re-entered the location.

Do not add a `hasMet` mechanic or conversation-session engine in this task.

### 3. Decide whether there is a reason to act

`view.available_actions` describes capabilities, not recommendations. Do not choose a formal action merely because it is available.

At the same time, do not suppress autonomous behavior. Characters may work, prepare things, clean, observe people, investigate, move, joke, refuse, interfere, or otherwise act spontaneously when coherent with personality, duties, observations, and existing intentions.

Meaningful direct address normally deserves an in-character response through dialogue, visible behavior, a formal action, or intentional silence. Intentional silence remains valid when character-driven.

### 4. Preserve causal intent in continuation

`continuation` remains nullable, free-form, private, model-authored working state. It records an unfinished purpose, not a plan, action queue, quest, workflow, or engine goal.

If the model chooses one atomic action as a step toward a purpose that remains unfinished after that action, keep the purpose in `continuation`.

Do not routinely:

1. express or imply an unfinished intention;
2. take only the first atomic step;
3. return `continuation: null`;
4. forget why the step was taken on the next reaction.

A complete local action may legitimately leave continuation null.

On every later reaction, reevaluate the current view, available actions, new observations, grounded results/failures, priorities, and continuation. The model may continue, revise, replace, abandon, or clear the purpose. Do not blindly repeat a failed action.

### 5. Structured speech loudness

Choose `spokenTargetId` structurally for direct address and choose `spokenLoudness` independently for the current utterance.

Writing that a character whispers does not change mechanical loudness. Conversely, mechanically quiet speech does not need the word "whisper" in visible prose.

The deterministic framework owns delivery; the model owns interpretation and reaction after delivery.

### 6. Memory discipline

Memory updates should normally remain empty unless something meaningfully worth retaining occurred.

- `recentMemories`: events likely to matter beyond the immediate reaction, not routine movement, greetings, mechanical progress, or workflow scratchpad.
- `beliefs`: meaningful inferred, uncertain, subjective, or strategically relevant propositions, not copies of obvious current view state.
- `relationships`: durable/developing social state such as trust, hostility, gratitude, familiarity, suspicion, loyalty, fear, affection, or role expectations; not momentary presence such as "a new patron entered".
- unfinished task continuity belongs in `continuation`, not routine recent memory.

## Grounding remains unchanged

A formal action returned by the model is an attempt. The deterministic engine owns success/failure.

Before engine confirmation, narrative, speech, memories, beliefs, and relationships may describe intent, effort, preparation, or anticipation, but must not claim that the formal action successfully changed the world. Later grounded result observations may be treated as confirmed.

## Out of scope

Do not modify:

- world tick semantics;
- once-per-AI-per-human-tick behavior;
- initiative ordering;
- observation batching;
- scheduler/background execution;
- movement event semantics;
- formal action execution;
- authored personalities/descriptions/minds for Garrick, Nell, Mara, Price, or Traveler;
- persistent AI loudness state;
- a conversation-session or `hasMet` engine.

## Tests

Add deterministic coverage for:

- every canonical Human loudness value accepted for AI speech;
- invalid AI loudness rejected;
- non-null loudness with null speech rejected;
- quiet AI speech producing the same recipients as equivalent Human speech;
- normal AI speech producing the same recipients as equivalent Human speech;
- `*whispers*` prose not overriding structured normal loudness;
- quiet structured loudness working without whisper wording;
- the prompt stating that available actions are capabilities, not recommendations;
- autonomous initiative remaining valid;
- unfinished purposive atomic actions retaining continuation;
- continuation remaining a purpose rather than an action queue;
- stable character IDs preserving identity across room transitions;
- memory updates defaulting to empty for trivial/transient state;
- beliefs not duplicating obvious view state;
- relationships representing durable social state;
- delivered observations already being perceived;
- loudness being structural rather than inferred from prose.

Do not unit-test probabilistic model compliance.

## Acceptance criteria

1. AI speech can select the same mechanical loudness options as Human speech.
2. AI speech reuses the same canonical perception/delivery logic.
3. AI loudness is per utterance and not persistent state.
4. Whisper-like prose does not control the mechanic.
5. The common decision prompt is shorter and more structured rather than merely enlarged.
6. Spontaneous NPC initiative remains valid.
7. Atomic steps toward unfinished purposes are explicitly tied to continuation.
8. Stable character identity is preserved conceptually across room transitions.
9. Trivial transient state is discouraged from memory/belief/relationship updates.
10. No character-specific hacks are introduced.
11. Scheduler, world-tick, movement, and formal-action semantics remain unchanged.
12. Existing tests remain green and new deterministic tests cover the protocol behavior.
