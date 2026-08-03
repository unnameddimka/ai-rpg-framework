# Project Status

## Implemented

- Schema version 2 `data/world.json` is authoritative for the start location, locations,
  sublocations, characters, initial minds, controller defaults, abilities, and hidden
  engine facts.
- Major locations retain separate generated physical passages. Generated StoryData derives
  its start passage from `startLocationId`.
- Generator, editor, and runtime validation cover passage uniqueness, start references,
  globally unique inventory IDs, character positions/controllers, ability references and
  action types, and structured mind records.
- Runtime characters and all mind partitions live in JSON-serializable SugarCube world state.
- Exactly one HumanController is preserved through atomic takeover and load repair.
- Formal action availability is the deduplicated union of base actions, current sublocation
  capabilities, and individual ability grants, with grant-source metadata.
- Every formal action returns the normalized `ok/action/events/feedback/error` result shape.
  Grounded private feedback and perceptible confirmed events are copied into recipient
  `mind.pendingObservations` inboxes.
- Existing movement, internal positioning, inventories, wallets, item and money transfer,
  table placement, ale pouring, events, restricted views, rollback, and debug takeover remain.
- `read_aura` exists as a private feedback-only formal action granted through the authored
  `readAura` ability. It accepts no target, derives every scan target from the actor's
  restricted perception view, and reads only grounded `engineFacts.aura` data. Missing aura
  text produces a neutral grounded result.
- The normal location view generically discovers currently available assigned zero-input
  abilities for whichever character is under HumanController. It renders authored public
  ability metadata, executes through `CharacterAPI.perform()`, and immediately displays
  structured private feedback in an HTML-escaped, actor-isolated result area.
- `setup.ContextBuilder.build(actorId)` returns a deep-cloned, non-mutating bundle containing
  only the actor's private identity/mind/abilities, restricted view, and available actions.
- The single-file offline editor provides Locations, Characters, and Abilities workflows,
  repeatable mind rows, reference-aware deletion, validation-blocked export, unknown-field
  preservation, and local draft storage.
- Engine, pure ability-UI, editor, and generator-focused Node tests cover the milestone and
  legacy behavior.

## Remaining limitations

- No model or API integration, API-key UI, prompt construction, or token counting.
- No autonomous NPC decisions or observation interpretation.
- No memory compression, summarization, embeddings, or retrieval.
- Character interaction selects a target but does not generate dialogue.
- The formal action panel remains a developer/debug interface below the normal ability UI.
- The generic player-facing ability renderer currently supports assigned zero-input actions
  only; parameterized actions remain in the developer/debug interface until a later UI contract.
- Combat, health effects, buying/selling, equipment, quests, dialogue trees, and arbitrary
  author scripts remain out of scope.
- Browser acceptance scenarios still require manual checking after UI changes.
