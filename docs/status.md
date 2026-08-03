# Project Status

## Implemented

- `data/world.json` authoritatively defines locations, characters, initial minds, permanent
  nonhuman controller defaults, abilities, and hidden engine facts.
- Exactly one HumanController remains an atomic temporary override. Released characters
  return directly to their authored `defaultControllerId`; no controller stack is stored.
- The sample player and hooded woman use permanent AI defaults, while the innkeeper remains
  dummy-controlled.
- Formal actions, restricted views, grounded feedback, observations, `ContextBuilder`, the
  generic zero-input ability UI, and targetless `read_aura` remain deterministic.
- A JSON-serializable, saveable, deduplicated AI queue orders direct targets before other
  observers, repairs stale entries, and is advanced only by one global manual button.
- The browser uses fixed OpenRouter/Cydonia, non-streaming requests. The API key remains in
  transient memory, with optional expiring 24-hour `localStorage` persistence and a forget
  control. Storage failures degrade safely to memory-only operation.
- The local JSON-only protocol accepts no action or one available formal action, rejects
  arbitrary fields, and permits at most one repair request for malformed/schema-invalid JSON.
- One-stage narrative turns and two-stage engine-grounded action turns commit atomically.
  Failed second-stage requests, invalid memory data, and transaction errors restore the full
  pre-turn world, queue, events, feedback, and observations.
- Engine-owned bounded memory updates support recent-memory append, belief upsert, and
  relationship upsert only. Observation consumption removes supplied IDs rather than clearing
  an inbox wholesale.
- AI narrative commits only through `CharacterAPI.narrate()`. Other AI recipients are queued
  but never run automatically.
- Safe transient UI status reports queue head, key availability, errors, provider usage, and
  reported cost data without saving credentials or raw request state.
- Engine, UI, editor, generator, settings, client, protocol, queue, transaction, privacy, and
  rollback tests use mocked fetch and preserve the deterministic baseline.

## Remaining limitations

- AI turns require an explicit button press; there is no autonomous or timer-driven loop.
- Provider and model are fixed to OpenRouter and Cydonia; there is no streaming or selection.
- One AI turn may choose at most one formal action.
- Browser `file://` network/CORS and localStorage behavior depends on the browser.
- There is no memory compression, token budgeting, local token counting, embeddings, or
  retrieval. Usage/cost is shown only when OpenRouter reports it.
- Editable ability effects, arbitrary author code, combat, economy, equipment, quests, and
  dialogue trees remain out of scope.
- A real OpenRouter smoke test requires the user to enter a real key and explicitly initiate
  a turn; automated tests never make live requests.
