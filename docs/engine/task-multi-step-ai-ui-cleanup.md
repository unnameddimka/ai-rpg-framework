# Task: Multi-Step AI Behavior and Game UI Cleanup

## Base Version

Implement the task on top of:

`ai-rpg-framework(20260805-220416).zip`

## Goals

1. Allow AI-controlled characters to complete multi-step tasks as a sequence of separate turns.
2. Display a clear loading indicator while an AI request is in progress.
3. Organize the contextual controls shown between the location description and the turn panel.
4. Rename the displayed name of the `You` character to `Traveler`.

---

# 1. Multi-Step AI Behavior

## Existing Architecture to Preserve

A single model response must continue to contain:

- an optional `publicNarrative`;
- an optional `spokenText`;
- optional `memoryUpdates`;
- no more than one formal `action`.

Do not add an array of actions.

The engine must continue to:

1. receive one model intent;
2. execute no more than one formal action;
3. store the grounded action result as an observation;
4. allow the character to continue the task during a later reaction wave.

Do not add:

- automatic execution of an entire action chain within one request;
- a separate plan object;
- engine-owned promise tracking;
- timers or background AI loops;
- an immediate second model request after executing an action;
- new engine-level psychology mechanics.

## Prompt Changes

Update the decision-stage system prompt in:

`src/23-ai-protocol.js`

Remove the wording that unnecessarily encourages the model to select `action: null`:

> Prefer action null unless a formal action clearly serves the character's goals...

Replace it with instructions that express the following rules:

- When the current goal requires several formal actions, select only the first currently available step.
- Do not merely promise to perform a task when a practical first step is available immediately.
- After receiving a grounded result, continue the task using the next available action.
- Before every step, reevaluate the current `view`, `available_actions`, and new observations.
- Do not claim through narrative or speech that a physical result has already happened before the engine confirms it.
- When the character must retain the current goal between reaction waves, use a minimal `memoryUpdates` entry.
- Memory should contain only the brief current goal and meaningful progress, not a detailed predefined plan.
- Stop the sequence when the goal is complete, impossible, abandoned, or requires a new decision or action from another character.
- After an action failure, use the grounded feedback and do not blindly repeat the same action.

A single AI character must still react no more than once during one reaction wave. To continue the sequence, the player uses another `Pass` or creates a new reaction wave through another turn.

## Protocol Compatibility

Do not change:

- the JSON response shape;
- the response validator;
- the limit of one formal action per response;
- `CharacterAPI.submitIntent()`;
- the scheduler queue mechanism;
- the once-per-wave rule;
- the memory schema.

---

# 2. Contextual Action Area

Keep one unified contextual shortcut area between the location description and the turn panel.

Organize buttons into three groups:

- `Characters`: visible character addressee shortcuts.
- `Here`: local movement, item operations, and available zero-input abilities.
- `Travel`: exits to other locations.

Character shortcuts select the addressee and focus the narrative textarea. They do not submit a turn or select a formal action.

Action shortcuts select the corresponding formal action for the next `Submit turn`. They must never execute immediately.

General rules:

- no more than one formal action may be selected at a time;
- a newly selected action replaces the previous one;
- the selected shortcut is visibly highlighted;
- clicking the selected shortcut again may clear it;
- empty groups are hidden;
- shortcuts are derived only from the canonical character `view`;
- unavailable actions are not shown;
- shortcuts do not call `CharacterAPI.perform()` or create separate immediate turns.

Remove the obsolete normal-location UI:

- separate ungrouped `.framework-location-links` rows;
- separate surface panels used only for `Take` and `Place`;
- the immediate-execution ability panel;
- the interaction instruction panel;
- the `Back to location` button.

---

# 3. Turn Panel

Replace:

`Framework controls — acting as <character>`

with:

`Your turn — <character>`

The panel must contain:

- a large narrative textarea;
- `Addressee`;
- `Loudness`;
- a compact `Selected action` row with a `Clear` button;
- `Submit turn`;
- `Pass`.

Keep the complete radio-control action grid in a collapsed section named `Advanced formal actions`.

Advanced controls and contextual shortcuts must share one selected-action state and remain synchronized. `No formal action` corresponds to an empty selection.

`Submit turn` uses the existing unified intent. `Pass` submits neither narrative nor a formal action and invokes the existing scheduler behavior.

---

# 4. AI Request Indicator

Reserve a status row at the top of the turn panel.

While processing, show an animated spinner with one of:

- `<Character name> is thinking…` when the queued AI recipient is known;
- `AI is thinking…` when the recipient cannot be determined;
- `Processing turn…` before a live AI request has begun.

While busy, disable:

- `Submit turn`;
- `Pass`;
- contextual shortcuts;
- advanced action controls;
- addressee and loudness controls;
- the narrative textarea.

The location description and `Latest turn` remain visible. The panel must not jump in height when the spinner appears.

Use the existing busy state sources:

- `frameworkUI.turnBusy`;
- `AIController.isInFlight()`;
- `AIRequestExecutor.getStatus().busy`;
- `AITurnScheduler.isWaveInFlight()`.

Do not add an independent network-request flag.

The indicator and blocking must cover normal submit, pass, sidebar live processing, and crystal-sphere live processing. Prompt Lab dry runs may keep their own status display, but duplicate live requests remain blocked.

---

# 5. Grounded Private Feedback

Private grounded feedback from a human formal action must remain visible in the normal game UI.

For example, `read_aura` selected through a contextual shortcut and submitted through `Submit turn` must display its result in a compact block such as:

`What Traveler notices`

Do not restore immediate ability execution to display this feedback.

---

# 6. Rename You to Traveler

Change only the displayed name of the character with ID `player`:

`You` → `Traveler`

The authoritative change is:

`data/world.json → characters[player].name`

Do not change the character ID, descriptions, references, actions, controllers, save keys, or UI code for special-case name handling.

Generated files are normally updated through the build process, but this patch must not include a rebuilt `dist/game.html`.

---

# 7. Expected Files to Change

Primary source files:

- `src/23-ai-protocol.js`
- `src/30-game-ui.js`
- `src/styles.css`
- `data/world.json`
- `docs/task-multi-step-ai-ui-cleanup.md`

Tests:

- `tests/run-ai-tests.js`
- `tests/run-ui-tests.js`

Do not change engine action mechanics unless a concrete technical requirement is discovered during implementation.

---

# 8. Acceptance Criteria

- The model is explicitly instructed to begin the first available step of a multi-step task.
- A promise does not replace an available practical formal action.
- The response schema and one-action limit remain unchanged.
- Contextual buttons are grouped into `Characters`, `Here`, and `Travel`.
- Shortcuts select an intent without changing world state.
- Selected contextual and advanced actions remain synchronized.
- The old duplicate interaction, surface, and ability panels are absent.
- A spinner and character-aware busy message appear during live processing.
- Controls capable of starting another turn or request are disabled while busy.
- Grounded private feedback remains visible in the normal game UI.
- The character with ID `player` is displayed as `Traveler` and otherwise remains unchanged.
- Existing turn flow, scheduler, sphere, controller switching, canonical-view action availability, tests, and source build remain functional.
