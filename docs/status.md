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
- Item definitions and item instances are authorable world data. The bar starts with ten
  concrete `emptyMug_*` instances in `inventory_barMugCabinet`; no ale mug is created from
  nothing. `fill` transforms an owned empty mug into `mugOfAle` only at an `ale_source`, and
  `consume` transforms that same instance back into `emptyMug`.
- The location UI and the unified formal-action panel derive **Fill with ale** and
  **Drink the ale** controls from the same canonical `view.available_actions` records sent
  to AI controllers.
- HumanController now submits one unified intent envelope containing optional narrative text
  and at most one formal action. The debug action panel uses one full-width text area,
  addressee and loudness controls, formal-action radio buttons, one **Submit** button, and one
  **Pass / Next turn** button. Empty narrative is valid when a formal action is selected, so
  actions may be performed silently.
- Narrative and formal-action records created by one intent share an `interactionId`. The
  scheduler groups them into one coherent AI observation while retaining the original event
  IDs for exact consumption.
- A JSON-serializable, saveable, deduplicated AI queue prioritizes direct addressees and
  formal-action targets before ordinary observers and repairs stale entries deterministically.
- **Submit** commits the human intent and normally runs one complete AI reaction wave. The
  sidebar checkbox **Stop automatic AI request processing** pauses that automatic wave.
  **Pass / Next turn**, the sidebar step, and the crystal sphere remain explicit controls.
  There is no timer or background loop.
- During one reaction wave, each AI character reacts at most once. Later characters see
  grounded events produced by earlier reactions. New observations delivered to a character
  that already reacted remain queued for the next wave, preventing infinite same-wave loops.
- A live AI reaction uses one model request returning optional narrative, optional speech,
  bounded memory updates, and at most one formal action. The old immediate `game-result`
  request has been removed. Grounded success or failure becomes an ordinary observation for
  a later reaction wave.
- `CharacterAPI.submitIntent()` is the common commit path for human and AI envelopes. Formal
  action authority remains deterministic: model or human prose cannot establish objective
  world consequences.
- The location UI renders a **Latest turn** block assembled from human narrative, AI narrative,
  and grounded action events in causal order. Movement Submit resolves its automatic reaction
  wave before rendering the destination passage, allowing departure reactions to remain
  visible in the completed turn narrative.
- The browser uses fixed OpenRouter with non-streaming requests and a build-validated model
  catalog from `data/model_list.json`. Cydonia remains the authored default; Llama 3.3
  Euryale, speed-routed Llama 3.1 Euryale, and Mistral Small 3.2 24B are
  selectable alternatives. The selected model persists separately from the API key and falls
  back to the authored default when invalid.
- The restricted character `view` is now the canonical shared projection for HumanController
  and AIController. The model receives that exact player-facing view unchanged, including the
  single authoritative `view.available_actions` catalog. `ContextBuilder` adds only private
  identity/ability instructions, projected mind records, and one prepared observation list;
  it never serializes the raw runtime inbox or duplicate aliases. The protocol validator
  derives its action catalog directly from the view already present in the request message.
- The API key remains in transient memory, with optional expiring 24-hour `localStorage`
  persistence and a forget control. Storage failures degrade safely to memory-only operation.
- One shared `AIRequestExecutor` serializes game, repair, and prompt-lab traffic. It leaves at
  least one second between live transport calls, honors `Retry-After` after HTTP 429, exposes
  transient busy/cooldown status, and performs no automatic rate-limit retry.
- The local JSON-only protocol rejects arbitrary fields and permits at most one repair request
  for malformed or schema-invalid JSON. Its prompt tells the model not to choose a formal
  action merely because it is available and not to claim ungrounded success.
- Engine-owned bounded memory updates support recent-memory append, belief upsert, and
  relationship upsert only. Observation consumption removes supplied IDs rather than clearing
  an inbox wholesale.
- Provider, parser, validator, or AI commit failures restore the pre-reaction snapshot and
  preserve the affected queue entry and unconsumed observations. A human intent committed
  before a later automatic-wave failure remains committed.
- OpenRouter failures preserve a sanitized `providerResponse` end to end: HTTP status,
  diagnostic headers, raw/parsed error body, retry information, and provider metadata remain
  available in the sphere and exchange-log export. API keys, Authorization values, OpenRouter
  `user_id` fields, and `user_...` identifiers are redacted in the client layer.
- The temporary village-temple crystal sphere renders the ordered queue, supports dry runs,
  offline replay, exchange-log import/export, live processing of only the current queue head,
  and a clearable transient narrative history containing successful live-turn public text and
  confirmed formal-action events.
- Engine, UI, editor, world/model-list generators, settings, client, protocol, executor,
  scheduler, queue, transaction, privacy, and rollback tests use mocked fetch and preserve the
  deterministic baseline.
- This is a reconciliation snapshot built after an older archive temporarily replaced the
  item-definition branch. Further feature work should wait for the next user-supplied base
  archive and treat that archive as the new source of truth.

## Remaining limitations

- AI progression is user-triggered only. There is no timer, background scheduler, or autonomous
  off-screen activity.
- The current loudness control distinguishes normal/public delivery from quiet/private
  delivery. Shouts and propagation into neighboring locations are not implemented.
- One submitted intent may contain at most one formal action. There is no multi-action ordering,
  partial commit, or rollback policy.
- The **Latest turn** output is deterministic concatenation of existing narrative and grounded
  fragments; there is no separate literary narrator or summarizer model.
- A paused movement Submit commits and renders the destination without first draining AI
  reactions; departure-scene suspension/interruption is later work.
- The provider is fixed to OpenRouter and streaming is disabled. Model choice is limited to
  the authored catalog; there is no arbitrary model entry or provider selector.
- Browser `file://` network/CORS and localStorage behavior depends on the browser.
- There is no memory compression, token budgeting, local token counting, embeddings, or
  retrieval. Usage/cost is shown only when OpenRouter reports it.
- Editable ability effects, arbitrary author code, combat, economy, equipment, quests, and
  dialogue trees remain out of scope.
- The village temple and crystal-sphere laboratory are temporary development scaffolding.
- Automated tests never make live OpenRouter requests.
