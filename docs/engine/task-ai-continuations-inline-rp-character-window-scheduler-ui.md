# Task: AI Continuations, Inline RP Narration, Character Window, and Scheduler UI Cleanup

## Base invariants

Implement this task on top of the current deterministic AI RPG architecture.

- The deterministic engine owns canonical world state.
- HumanController and AIController operate from the same canonical restricted character `view`.
- AI context may add only character-private data outside that view.
- One AI reaction may request at most one currently available formal action.
- A selected formal action is an attempt only. Objective success/failure is established only by the later engine result.
- Multi-step AI behavior remains emergent across separate reaction waves. Do not add plans, action queues, workflows, quests, promise entities, or goal stacks.

## 1. Model-owned `continuation`

Add a required nullable `continuation` field to every AI decision response:

```json
"continuation": "Serve the traveler the ale he paid for."
```

or:

```json
"continuation": null
```

`continuation` is a private working intention owned semantically by the model. The framework stores the latest value and returns it to that character on future AI reactions, but does not interpret, decompose, prioritize, complete, retry, or otherwise manage its meaning.

The model may keep, replace, rewrite, or clear it at any time. There is exactly one current value and no stack.

Store continuation outside durable character `mind`, but inside JSON-serializable runtime/SugarCube state so compatible save/load preserves it. It is not authoring data and has no world-editor field.

The private AI context includes the current continuation in addition to the unchanged canonical `view`, private character instructions, projected mind, and prepared observations.

## 2. Emergent multi-step behavior

A multi-step intention remains:

```text
continuation
    -> choose one available formal action
    -> engine resolves it
    -> later observation + updated view
    -> model reevaluates continuation
    -> choose another action if desired
```

The framework never stores a fixed sequence such as `take -> fill -> give`.

If an intermediate action fails, the current continuation remains available to the later reaction. The model decides whether to retry, choose another route, replace the goal, explain the failure, or abandon it.

## 3. Engine-confirmed results and memory grounding

When the model selects `fill`, `move`, `give_item`, or another formal action, it knows only that it requested/attempted that action. It must not record the requested world change as already completed in the same response.

For example, a response that requests `fill` must not simultaneously append a durable memory saying `Filled the mug` as a confirmed fact.

After the engine resolves the action, the success/failure observation and updated canonical view are supplied on a later reaction. Only then may the model treat the result as objective fact.

Do not add staged-memory transactions. `continuation` replaces using recent memory merely as workflow scratch space. Durable memories remain for information that may matter later, not routine action-step bookkeeping.

## 4. Shared inline RP syntax

The game uses one common scene-text convention:

- text outside paired single asterisks is spoken dialogue;
- text inside `*...*` is visible narration/behavior and is not speech.

Example:

```text
I don't trust you. *Mara narrows her eyes.* Not yet.
```

This applies to Human input and AI-authored scene text.

Narration does not mutate canonical world state by itself. A narrated modeled action such as `*hands over a coin*`, `*takes the mug*`, or `*walks through the door*` should be backed by the corresponding available formal action. If the formal action is absent or fails, canonical engine state wins.

Do not implement NLP matching between narration and formal actions.

Small unmodeled behaviors such as `*smiles*`, `*frowns*`, `*hesitates*`, or `*looks away*` may remain narration only.

## 5. AI output normalization

`publicNarrative` remains a standalone narrative field in the JSON protocol. `spokenText` remains dialogue and may itself contain short inline `*...*` narrative beats.

When an AI response is committed into the shared scene/narrative event stream, normalize standalone `publicNarrative` into the same asterisk convention before combining it with `spokenText`. This gives downstream observers one unambiguous common scene-text representation.

The common AI system prompt must explicitly explain:

- the `*...*` convention;
- narration vs speech;
- narration never overrides canonical state;
- modeled physical changes require formal actions;
- selected actions are attempts until engine-confirmed;
- continuation is model-owned working intent;
- continuation, not recent memory, is the preferred place for unfinished short-term workflow state.

## 6. Inline narration rendering

Normal gameplay must render matched `*...*` spans without literal delimiter asterisks. Render the enclosed text as slightly dimmed italic narration.

Use a small safe parser for this convention only. Do not add a general Markdown renderer.

Requirements:

- escape arbitrary user/model text;
- never execute raw HTML;
- matched spans receive narration styling;
- unmatched/malformed asterisks remain harmless literal text;
- the stored raw text may retain the `*...*` markers.

Use the same renderer for the Latest turn display and the prompt-lab narrative history.

## 7. In-game Character window

Add a `Character` button directly below the Human-control block in the left sidebar.

The button opens a modal/overlay over the current gameplay scene. Opening or closing it must not navigate the world, submit a turn, advance a world tick, emit an event/observation, or invoke AI processing.

For the currently Human-controlled character, show:

- editable `Name`;
- editable public/player-facing `playerDescription`;
- read-only current inventory.

Do not expose or edit `aiDescription`. `aiDescription` remains authoring-only and is edited only in the standalone world editor.

Provide exactly two closing actions:

- `Save and close` — apply Name and `playerDescription`, then close;
- `Close without saving` — discard edits and close.

No autosave is required.

Runtime Name/`playerDescription` changes are meta/runtime character customization. They produce no formal action, event, observation, or AI tick, and must survive ordinary compatible save/load. Existing authoring reconciliation continues to refresh only `aiDescription` from current generated world data.

The Character window should be structurally easy to extend later with Stats, Equipment, Abilities, etc., but none of those are implemented now. Future equipment changes will be formal gameplay actions, not metadata edits.

## 8. Sidebar scheduler cleanup

Remove the normal gameplay sidebar button that manually processes one pending AI request (`Process next AI event` / `Process pending AI request`).

Keep useful read-only scheduler diagnostics, including the current queue status/count and next-recipient information already available in the sidebar.

The gameplay sidebar may observe scheduler state but must not provide an alternate one-head processing path. Normal pending AI work is advanced through the canonical Human-triggered world-tick/reaction-wave flow (`Submit` / `Pass`, subject to the existing pause behavior).

Do not unnecessarily delete the internal `processNext` scheduler API because the crystal sphere/debug tooling still uses it.

## 9. Explicit non-goals

Do not add in this task:

- fixed multi-action plans;
- plan arrays or goal stacks;
- workflow/task engines;
- quest/promise/transaction entities;
- semantic parsing of continuation;
- NLP action/narration validation;
- staged memory transactions;
- equipment or stats;
- possession/mind-control mechanics;
- special control-switch catch-up behavior;
- keg depletion/replacement mechanics;
- autonomous timer/background AI.

## 10. Acceptance tests

Cover at least:

- continuation accepts string/null and rejects other types;
- latest continuation is stored, replaced/cleared by model output, restored to later AI context, and survives JSON save/load;
- continuation remains after an in-world action failure while success-dependent memory is suppressed;
- prompt teaches continuation ownership, action-result grounding, and inline RP syntax;
- normal AI responses normalize standalone public narrative into common `*...*` scene text;
- inline RP renderer hides valid delimiters, styles narration, escapes unsafe text, and tolerates unmatched asterisks;
- Character window edits only Name/`playerDescription`, shows inventory read-only, and never exposes `aiDescription`;
- profile edits create no events/queue work and survive save/load;
- current-world `aiDescription` reconciliation does not overwrite runtime public profile edits;
- sidebar no longer contains a manual one-head AI process button while queue diagnostics remain;
- sphere/internal manual scheduler debugging continues to function.
