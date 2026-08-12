# Project Status

## Implemented

- `data/world.json` authoritatively defines locations, characters, initial minds, permanent
  nonhuman controller defaults, abilities, and hidden engine facts.
- Exactly one HumanController remains an atomic temporary override. Released characters
  return directly to their authored `defaultControllerId`; no controller stack is stored.
- The sample player, hooded woman, Garrick the Innkeeper, Captain Price, and Nell use permanent AI defaults so temporary
  HumanController takeover always returns them to AI control.
- Formal actions, restricted views, grounded feedback, observations, `ContextBuilder`, the
  generic zero-input ability UI, and targetless `read_aura` remain deterministic.
- Item definitions and item instances are authorable world data. The bar starts with ten
  concrete `emptyMug_*` instances in `inventory_barMugCabinet`; no ale mug is created from
  nothing. `fill` transforms an owned empty mug into `mugOfAle` only at an `ale_source`, and
  `consume` transforms that same instance back into `emptyMug`.
- The offline world editor now exposes embedded inventory editors inside character and location
  forms and inside positions with optional containers. These views edit the same flat item
  instances as the global **Items** tab, generate unique instance IDs, allow moving/deleting
  instances, and block removal of a container owner while item references remain.
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
- A JSON-serializable, saveable, deduplicated AI queue keeps stable fallback order while the
  scheduler derives additive initiative from pending targeted observations: addressed speech
  +1, targeted formal action +2, plus +2 when the originating actor was HumanController.
- **Submit** commits the human intent and normally runs one complete global AI world tick. The
  sidebar checkbox **Stop automatic AI request processing** pauses that automatic wave.
  **Pass / Next turn** remains the normal explicit world-tick trigger; the sidebar shows queue
  diagnostics but no longer exposes a manual one-head processing button. The crystal sphere
  keeps explicit single-head live processing for debug work. There is no timer or background loop.
- During one Human-triggered world tick, each eligible AI character reacts at most once.
  Later characters see grounded events produced by earlier reactions. New observations for an
  already-reacted character, including its own action result, remain pending for a later tick.
  Off-screen pending observations remain eligible; there are no idle model calls.
- Beds now expose grounded sleep capability through the shared action contract. AI sleep sets a
  canonical `sleeping` state without self-scheduling a continuation; any later formal action or
  non-empty speech/narrative wakes the actor, while observation receipt alone does not. Human sleep
  from a bed starts a dedicated user-triggered overnight timelapse rather than a normal reaction wave.
- Overnight timelapse runs exactly five abstract rounds. Each awake AI independently plans coarse
  `(location, action)` steps over rooms reachable through the canonical graph with existing lock/key
  ownership. Travel is implicit in the round; actions are free `narrate`, concrete-bed `sleep`, or
  authored location `timelapseActions` backed by allowlisted deterministic effects. Co-located awake
  characters are resolved as one group encounter using private per-character intents plus one public
  compressed resolver, then affected characters replan only the remaining rounds. After round five,
  every AI receives private end-of-day reflection followed by the existing memory consolidator.
- The tavern common room now authors a timelapse-only cleanup macro that empties unattended mugs and
  returns them to Garrick's mug cabinet without touching mugs held by characters. In ordinary world-tick
  play, mug cleanup remains atomic and must be performed one mug at a time.
- Captain Price now starts with the Guest Room 1 key and authored lodging knowledge. Garrick, Nell,
  Traveler, and Price know the agreed lodging fact while Mara does not; normal sleeping-place and
  residence facts are authored for the relevant characters. Nell's nook now contains a concrete cot
  sublocation so sleep always targets an actual bed ID.
- A live AI reaction uses one model request returning optional narrative, optional speech,
  one nullable model-owned `continuation`, bounded memory updates, and at most one formal action.
  Continuation is private working state outside durable `mind`; the framework stores and returns
  it without interpreting it. The old immediate `game-result` request has been removed. Grounded
  success or failure becomes an ordinary observation for a later Human-triggered world tick,
  where the model re-evaluates the continuation against the new canonical view.
- The common AI decision prompt is organized around current canonical state, coherent reasons to act,
  stable character identity, model-owned continuation, structured speech loudness, grounding, and
  memory discipline. Delivered observations are already perceived; returning character IDs remain the
  same known people; available actions are capabilities rather than recommendations; spontaneous NPC
  initiative remains valid; unfinished purposive atomic steps retain their purpose in `continuation`.
  Continuation never overrides the refreshed canonical view, a useful current formal step should normally
  advance an adopted purpose, future steps may appear only after prerequisites, and narrative/memory may
  not declare a multi-step mechanical task complete before grounded engine results establish it.
- AI decisions now include per-utterance `spokenLoudness` using the same canonical `noticeable` /
  `hidden` values and the same `CharacterAPI.submitIntent()` perception path as HumanController.
  Whisper-like prose has no mechanical effect on loudness, and AI loudness is not persisted between turns.
- `CharacterAPI.submitIntent()` is the common commit path for human and AI envelopes. Formal
  action authority remains deterministic: model or human prose cannot establish objective
  world consequences. Ordinary scene text is speech while paired `*...*` spans are inline visible
  narration; the UI renders those spans as dimmed italics, but narration never overrides engine
  state or substitutes for a modeled formal action.
- The gameplay sidebar now opens a modal **Character** window for the current Human-controlled
  character. It edits runtime Name and `playerDescription`, shows inventory read-only, never
  exposes authoring-only `aiDescription`, and provides **Save and close** / **Close without saving**
  without generating a world tick, event, or AI reaction. Runtime profile edits survive normal
  compatible save/load.
- The location UI renders **Latest turn** from canonical per-event recipients. Major-location
  movement emits one `character_moved` event visible to observers on both source and destination
  sides. A default-off **Show invisible events** checkbox can reveal only the current turn's
  suppressed presentation entries with an explicit debug-only marker.
- The browser uses fixed OpenRouter with non-streaming requests and a build-validated model
  catalog from `data/model_list.json`. Cydonia remains the authored default; Llama 3.3
  Euryale, speed-routed Llama 3.1 Euryale, Mistral Small 3.2 24B, and DeepSeek V4 Pro are
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
- One shared `AIRequestExecutor` serializes game, repair, prompt-lab, and overnight-timelapse traffic.
  It leaves at least one second between live transport calls, honors `Retry-After` after HTTP 429,
  exposes transient busy/cooldown status, performs no automatic rate-limit retry, and retains the most
  recent 100 sanitized AI interaction records for debugging/export.
- The local JSON-only protocol rejects arbitrary fields and permits at most one repair request
  for malformed or schema-invalid JSON. Option-validation errors expose the allowed values, and decision
  repairs receive a compact deterministic copy of the current action types, semantic descriptions, and
  option sets so a malformed action can be corrected without discarding the underlying purpose.
  `spokenTargetId` gives addressed speech an explicit structured target independent of the formal-action
  target, while `spokenLoudness` selects the canonical Human/AI noticeability for the current utterance.
  The prompt treats the current canonical view as authoritative and keeps narrative/speech in the attempt
  phase until engine confirmation.
- Engine-owned bounded memory updates support recent-memory append, belief upsert, and
  relationship upsert only. Observation consumption removes supplied IDs rather than clearing
  an inbox wholesale.
- The authored tavern world now names the innkeeper **Garrick the Innkeeper**. Garrick is a
  retired soldier turned practical, miserly tavern owner; he and Nell begin with mutual authored
  `knownFacts` and `relationships` describing their established almost-family/employer relationship,
  so neither AI treats the other as a stranger or new applicant.
- The authored world now extends from the street through **Village edge** to **Mara's cottage**.
  The cottage is a forest-surrounded hedge-witch home/workplace with a garden, bed, hearth, work
  table, and alchemical shelves. Mara, Garrick, and Nell receive authored local `knownFacts` about
  Mara's home, services, reputation, and the village's open-secret dependence on her; Captain Price
  receives no retroactive local knowledge.
- Saves now carry separate runtime `schemaVersion` and generated `authoringRevision` compatibility
  markers. Legacy `world.version = 6` and later compatible saves are reconciled transactionally as
  **fresh authored world + preserved lives**: current authoring supplies world structure, character
  profiles, item definitions, abilities, and `knownFacts`, while surviving characters preserve
  beliefs, relationships, recent/long-term memories, continuation, wallet, valid position/controller
  state, and valid runtime item instances. Transient events, pending observations, AI queues, and
  request state are discarded. The UI visibly blocks on **Migrating save...**; candidates validate
  before atomic commit, and migration failure leaves the original restored save unchanged.
- Task specifications are organized under `docs/engine/` for technical/framework work and
  `docs/world/` for authored world/character work.
- Provider, parser, validator, or AI commit failures restore the failed reaction snapshot,
  preserve its unconsumed observations, and stop the current AI world tick. Earlier committed
  reactions remain committed; later Human turns may add more observations until processing
  resumes. A 64-request emergency guard truncates safely without whole-tick rollback.
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

## Remaining limitations

- AI progression is user-triggered only. There is no timer/background scheduler or idle
  goal-driven autonomy. Off-screen pending observations are processed only when a Human turn
  advances a world tick.
- The current loudness control distinguishes normal/public delivery from quiet/private
  delivery. Shouts and propagation into neighboring locations are not implemented.
- In ordinary world-tick gameplay, one submitted intent may contain at most one formal action. Multi-step
  behavior there is model-driven across later reactions through one opaque `continuation`; there is no
  normal-tick plan array, goal stack, workflow engine, multi-action ordering, or partial multi-action commit.
  The overnight timelapse is a separate coarse five-round planning mode and does not relax ordinary
  atomic action semantics.
- The **Latest turn** output is deterministic concatenation of existing narrative and grounded
  fragments; there is no separate literary narrator or summarizer model.
- A paused movement Submit commits and renders the destination without first draining AI
  reactions; departure-scene suspension/interruption is later work.
- The provider is fixed to OpenRouter and streaming is disabled. Model choice is limited to
  the authored catalog; there is no arbitrary model entry or provider selector.
- Browser `file://` network/CORS and localStorage behavior depends on the browser.
- Transactional recent-to-long-term memory consolidation exists, including overnight consolidation, but
  there is still no retrieval-based old-memory selection, token budgeting, local token counting, or
  embeddings. Usage/cost is shown only when OpenRouter reports it.
- Editable ability effects, arbitrary author code, combat, economy, equipment, quests, and
  dialogue trees remain out of scope.
- The village temple and crystal-sphere laboratory are temporary development scaffolding.
- Automated tests never make live OpenRouter requests.
