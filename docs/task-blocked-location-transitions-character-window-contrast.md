# Task: Blocked Location Transitions and Character Window Contrast

## Goal

Add a generic authored blocked-transition state to existing location exits while preserving the ordinary `move` action contract. Also fix the in-game Character window so it uses a dark, readable background.

## Transition authoring

Existing string exits remain valid:

```json
"commonRoom": "commonRoom"
```

A blocked exit may instead use an object:

```json
{
  "destinationId": "guestRoom1",
  "blocked": true,
  "blockedReason": "The door is locked."
}
```

No schema-version bump is required. Old authored worlds remain compatible.

## Canonical action contract

A blocked destination remains present in the ordinary `move` action's `destination_ids`. It is therefore a legitimate action attempt for HumanController and AIController rather than an invalid request.

The controller does not receive a new door-specific action type.

## Engine result

When `move` targets an authored blocked transition:

- return a grounded `TRANSITION_BLOCKED` failure;
- use the authored `blockedReason`, falling back to a generic blocked-path message;
- keep the actor in the source location;
- emit no `character_moved` event.

For HumanController this is a valid in-world failed attempt, so the turn is consumed and the normal AI world tick follows. A destination absent from the current action contract remains an invalid request and does not consume the turn.

## Editor and generators

The standalone world editor must support:

- a Blocked checkbox on an exit;
- editable failure text for blocked exits;
- legacy string exits and new blocked-exit objects in the same document.

The world generators validate destination references, duplicate/self exits, Boolean `blocked`, and text `blockedReason`.

## Future compatibility / non-goals

The authored `blocked` state is intentionally simple so a future key/unlock mechanic can toggle it. This task does not implement keys, lock ownership, open/close, lockpicking, conditional predicates, pathfinding, or automatic retries.

## Character window

Change only presentation styling:

- dark Character panel background;
- dark editable fields with readable light text;
- readable inventory separator and buttons;
- no functional Character-window changes.
