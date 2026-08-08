# Task: AI Grounding, Save Reconciliation, and Minimal Turn UI

## Base

Apply this task on top of the current AI RPG framework state, including multi-step AI behavior, narrative response style, contextual action shortcuts, the current world/item model, and the current save system.

Do not rebuild or include `dist/game.html` unless explicitly requested.

## Goals

1. Strengthen AI action and narrative grounding.
2. Keep runtime NPC history from saves while allowing authoring-time `aiDescription` changes to take effect after rebuild.
3. Simplify the normal gameplay turn interface and preserve conversation controls between turns.

Existing architecture remains unchanged unless explicitly described below.

## 1. Strict AI Formal Action Validation

`view.available_actions` is the authoritative set of formal actions the character may currently request.

An AI-selected action must satisfy both:

- its declared action schema;
- the concrete current values exposed by `view.available_actions.<type>.options`.

Examples:

- `move.destination_id` must be present in `destination_ids`;
- `move_within_location.destination_id` must be present in `destination_ids`;
- `take_item.item_id` and `drop_item.item_id` must be present in `item_ids`;
- `give_item.item_id` and `give_item.target_id` must both be present in their current option lists;
- `give_money.target_id` must be present in `target_ids`, and `amount` must not exceed the current `maximum_amount`;
- `place_item.item_id` and `target_inventory_id` must both be currently allowed;
- `fill.item_id` and `consume.item_id` must be present in `item_ids`;
- zero-input ability actions remain valid when the action itself is exposed and the response supplies no unsupported parameters.

A structurally valid but currently unavailable AI action must be rejected by the existing AI protocol validation / repair flow before `CharacterAPI.perform()` is called.

Do not silently substitute another action. The deterministic engine keeps its own validation as the final safety boundary.

## 2. Narrative and Memory Grounding for Pending Formal Actions

When an AI response contains a formal action, that action has not happened yet. The engine executes it only after the model response is accepted.

Strengthen the technical AI prompt so that, in the same response as an unconfirmed formal action:

- `publicNarrative` may describe intention, preparation, attention, posture, expression, or other non-state-changing behavior;
- `spokenText` may express intent or accompanying dialogue;
- neither narration nor speech may assert that the requested formal action already succeeded;
- `recentMemoriesToAdd`, `beliefsToUpsert`, and `relationshipsToUpsert` must not record the requested action as successfully completed.

Example acceptable before `give_item` confirmation:

> The innkeeper reaches for the mug and turns toward the traveler.

> "Here you are in a moment."

Example not acceptable before confirmation:

> The innkeeper gives the traveler the mug.

> "Here's your beer."

Likewise, do not add memories such as `Gave the traveler a beer` before the engine confirms that result.

The model may retain a brief pending goal such as `Preparing a beer for the traveler` when useful for multi-step continuity.

Once a grounded action result arrives as a later observation, the model may narrate or remember the confirmed result normally.

On failure, later reactions must use grounded failure feedback and must not reinforce a false success memory.

Do not add promise tracking, a plan engine, or new psychology mechanics.

## 3. Save Reconciliation for `aiDescription`

A save contains runtime world state, including NPC mind state. Editing an NPC's authoring-time `aiDescription` and rebuilding must not be undone by loading an older save.

For characters matched by stable character `id`:

- preserve saved runtime state, including `mind`, memories, beliefs, relationships, location, sublocation, inventory, wallet, controller state, pending observations, and other runtime data;
- refresh `character.aiDescription` from the current `setup.GeneratedWorldData.characters` after a compatible saved world is restored.

Conceptually:

```text
current generated authoring data
              +
saved runtime world
              ↓
reconciled runtime world
```

This task reconciles only `character.aiDescription`. Do not redesign the whole save format or automatically replace unrelated authoring fields.

Existing `WORLD_VERSION` incompatibility behavior remains unchanged.

## 4. Minimal Auto-Growing Narrative Input

Keep the main narrative control as a `<textarea>` so multiline input remains possible.

Required behavior:

- default/minimum visual height is approximately one text line;
- it grows vertically as text wraps or the user inserts newlines;
- it shrinks when text is removed;
- after a successful Submit, the cleared input returns to one-line height;
- avoid a persistent internal vertical scrollbar for normal short-to-medium input;
- a reasonable maximum height may be used for very long text, after which internal scrolling is acceptable;
- behavior must survive normal SugarCube rerenders.

## 5. Persistent Addressee

The selected narrative addressee persists across normal Submit and Pass operations.

Contextual `Talk to <character>` shortcuts continue to set/replace this same selected addressee.

On each UI refresh, reconcile the saved selected addressee against the current canonical view. If that character is no longer available in `view.location.characters`, automatically clear the addressee to `None`.

This includes cases where the player leaves the location, the target leaves, or the target otherwise disappears from the current conversational scope.

Do not create remote conversation behavior.

## 6. Persistent Loudness

The selected loudness persists across normal Submit and Pass operations until the player explicitly changes it.

If the addressee becomes unavailable and is automatically cleared, keep the loudness unchanged.

Example:

```text
Before leaving:
Addressee: Innkeeper
Loudness: Quiet

After leaving:
Addressee: None
Loudness: Quiet
```

## 7. Submission Reset Rules

After successful Submit:

Clear:

- narrative text;
- selected formal action.

Preserve:

- selected addressee, subject to current-view reconciliation;
- selected loudness.

`Pass` must not unnecessarily reset either conversation setting.

## 8. Minimal Normal Turn UI

Remove the visible normal-gameplay `Framework debug` section and its debug frame/content from the turn area.

Remove the heading:

```text
Your turn — <character>
```

Do not replace it with another large heading.

The normal gameplay interaction area should no longer use the heavy bordered/debug-panel presentation. Keep the functional controls but make the turn area visually lightweight.

The approximate target is:

```text
[ narrative input, initially one line and auto-growing ]

Addressee: [ Innkeeper ▼ ]    Loudness: [ Quiet ▼ ]

Selected action: None

[ Submit turn ] [ Pass ]

Advanced formal actions ▸
```

Contextual `Characters`, `Here`, and `Travel` shortcuts remain unchanged.

## 9. Existing Invariants

Do not change these rules:

- deterministic engine owns objective world state;
- canonical restricted `view` is shared by HumanController and AIController;
- AI private context may add only controlled-character private state;
- one AI response contains at most one formal action;
- formal actions execute locally through the existing CharacterAPI path;
- multi-step AI behavior uses separate grounded reaction waves;
- no immediate result-stage second model call;
- no timer/background loop in this milestone;
- no promise-tracking subsystem;
- exactly one HumanController invariant remains;
- `defaultControllerId` behavior remains;
- `data/world.json` remains authoritative authoring data;
- NPC mind remains serializable runtime/save state.

## 10. Tests

Add or update automated tests covering at least:

### AI action availability

- unavailable move destination rejected;
- unavailable take/drop/give/place/fill/consume item rejected as applicable;
- unavailable give/give-money target rejected;
- give-money amount above current maximum rejected;
- currently available action accepted;
- repair path receives concrete validation errors.

### Narrative grounding prompt

Verify the technical prompt explicitly states that:

- requested formal actions are still unconfirmed;
- narration/speech must not claim their success;
- memory/belief/relationship updates must not record unconfirmed success;
- later grounded observations are the authority for confirmed outcomes.

Do not test prose quality using model-generated exact strings.

### Save reconciliation

Create a saved runtime character with changed memories/beliefs/relationships, change/mock current generated `aiDescription`, restore/bootstrap the saved world, and verify:

- runtime mind state remains;
- current generated `aiDescription` replaces the saved copy.

### UI persistence and minimalism

Verify:

- addressee persists while still present in the current view;
- unavailable addressee is cleared;
- loudness persists independently;
- textarea is rendered as a one-row auto-growing control and has resize behavior;
- successful Submit still clears narrative text through rerender and selected formal action state;
- normal UI source no longer renders `Framework debug` or `Your turn —`;
- the turn area no longer uses the heavy `framework-panel` debug framing.

## Acceptance Criteria

The task is complete when:

1. AI formal actions cannot pass protocol validation with concrete parameters outside current `view.available_actions.options`.
2. Technical prompt prevents unconfirmed formal-action success from being asserted in narration, speech, or memory updates.
3. Confirmed engine results can still be handled normally in later reaction waves.
4. Loading a compatible old save preserves NPC runtime mind but uses the current build's `aiDescription`.
5. Narrative input starts at one-line height and auto-grows/shrinks with content.
6. Addressee persists across turns but clears automatically when unavailable.
7. Loudness persists across turns and survives addressee clearing.
8. Narrative text and selected formal action remain transient after Submit.
9. `Framework debug` and `Your turn — <character>` are absent from normal gameplay UI.
10. Existing multi-step AI, controller, item, save, editor, and grounding behavior remains functional.
11. All framework, editor, UI, AI, and generator tests pass.
