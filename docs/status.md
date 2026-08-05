# Project Status

## Implemented

- `data/world.json` authoritatively defines locations, characters, initial minds, permanent
  nonhuman controller defaults, abilities, and hidden engine facts.
- Exactly one HumanController remains an atomic temporary override. Released characters
  return directly to their authored `defaultControllerId`; no controller stack is stored.
- The sample player, hooded woman, and innkeeper use permanent AI defaults so temporary
  HumanController takeover always returns them to AI control.
- Formal actions, restricted views, grounded feedback, observations, `ContextBuilder`, the
  generic zero-input ability UI, and targetless `read_aura` remain deterministic.
- A JSON-serializable, saveable, deduplicated AI queue orders direct targets before other
  observers, repairs stale entries, and is advanced only by one manual `AITurnScheduler`
  operation. No timer or autonomous drain exists yet.
- The browser uses fixed OpenRouter with non-streaming requests and a build-validated model
  catalog from `data/model_list.json`. Cydonia is the authored default and Llama 3.3 Euryale
  70B is the second candidate. The sidebar selector applies immediately; the selected model
  persists separately from the API key and falls back to the authored default when invalid.
  The API key remains in transient memory, with optional expiring 24-hour `localStorage`
  persistence and a forget control. Storage failures degrade safely to memory-only operation.
- One shared `AIRequestExecutor` serializes game, repair, and prompt-lab traffic. It leaves at
  least one second between live transport calls, honors `Retry-After` after HTTP 429, exposes
  transient busy/cooldown status, and performs no automatic rate-limit retry.
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
- Safe transient UI status reports the next scheduler recipient and event preview, key
  availability, errors, provider usage, and reported cost data without saving credentials in
  SugarCube state.
- OpenRouter failures now preserve a sanitized `providerResponse` end to end: HTTP status,
  diagnostic headers, raw/parsed error body, retry information, and provider metadata remain
  available in the sphere and exchange-log export. API keys, Authorization values, OpenRouter
  `user_id` fields, and `user_...` identifiers are redacted before the diagnostics leave the
  client layer. Failed requests leave their queue item and observations intact.
- A temporary village-temple room contains a crystal-sphere scheduler/prompt lab. It can
  download/import versioned JSON exchange logs and replay recorded raw responses offline
  through the current parser and validator. It renders
  the ordered queue as recipient/event cards, marks the exact next live request, allows any
  entry to be inspected or dry-run, and lets only the queue head be processed live through the
  same scheduler as the sidebar. Exact and edited-system-prompt dry runs show original/repair
  messages, raw content, parsed JSON, concrete validation paths, and usage without mutation.
- Protocol validation now checks the exact nested memory record shapes before commit and
  passes concrete validation failures into the single repair request.
- The primary speak/narrative input is the first full-width framework control, with a larger
  vertically resizable text area; compact formal debug actions remain in the grid below it.
- Engine, UI, editor, world/model-list generators, settings, client, protocol, executor, scheduler, queue,
  transaction, privacy, and rollback tests use mocked fetch and preserve the deterministic
  baseline.

## Remaining limitations

- AI turns require an explicit button press; there is no autonomous or timer-driven loop.
- The provider is fixed to OpenRouter and streaming is disabled. Model choice is limited to
  the authored catalog; there is no arbitrary model entry or provider selector.
- One AI turn may choose at most one formal action.
- Browser `file://` network/CORS and localStorage behavior depends on the browser.
- There is no memory compression, token budgeting, local token counting, embeddings, or
  retrieval. Usage/cost is shown only when OpenRouter reports it.
- Editable ability effects, arbitrary author code, combat, economy, equipment, quests, and
  dialogue trees remain out of scope.
- The village temple and crystal-sphere laboratory are temporary development scaffolding
  and should be removed or hidden before a final release.
- A real OpenRouter smoke test requires the user to enter a real key and explicitly initiate
  a turn; automated tests never make live requests.
