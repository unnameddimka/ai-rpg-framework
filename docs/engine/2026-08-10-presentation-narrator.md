# Presentation Narrator

Status: implemented specification, 2026-08-10.

## Goal

Add an optional AI-powered presentation narrator that rewrites deterministic player-facing scene material into concise literary prose without participating in simulation. The narrator is not a controller, does not decide actions, does not mutate state, and never creates canonical facts.

The intended flow is:

`controllers -> deterministic engine -> canonical state/events -> PresentationAssembler -> NarratorService -> PresentationRenderer -> UI`

`NarratorService` may reuse the shared OpenRouter transport and serialized request executor, but it has its own model selection, prompt, request/response validation, generation budget, error handling, and exchange-log metadata. It does not receive character memory, beliefs, relationships, continuation, psychology, AI descriptions, action schemas, initiative, controller identity, or scheduler internals.

## Presentation categories

### 1. Static scene

Static scene material contains the room/location description and static fixtures/sublocations such as stairs, tables, beds, counters, and permanent scenery. It contains no dynamic items or other state that may change during the visit.

Rule: if something may change after the player enters the location, it belongs to dynamic presentation.

Static narration is requested once for every location entry. There is no cross-visit cache in this version; re-entering a location creates a fresh request and model variation is acceptable.

### 2. Dynamic grounded scene

Dynamic presentation contains the full current visible mutable scene, including character descriptions/positions, visible dynamic items, movement, and grounded formal actions/results/failures. It is rebuilt from the current canonical Human-visible projection.

Exactly one dynamic narrator request is made after the complete Human turn and resulting AI reaction wave. It receives the full current dynamic snapshot, not only a delta. Slightly different prose for unchanged positions on different ticks is intentional.

Human- and AI-controlled actors are not distinguished for narration purposes.

### 3. Verbatim character-authored content

Human narrative/speech and AI `publicNarrative`/`spokenText` are immutable character-authored RP. They may be supplied to the narrator as read-only context so surrounding prose can flow naturally, but the narrator never becomes their authoritative source.

Character-authored text reaches the renderer with an explicit actor attribution and is restored byte-for-byte from a separately retained canonical original.

## Protected paired verbatim blocks

The mixed tick stream uses paired protected regions:

```text
<verbatim id="v1">
Captain John Price: *Price raises his mug slightly.* Evening, Nell.
</verbatim>
```

Paired tags explicitly delimit arbitrary multi-line RP text. Before embedding a payload in the narrator request, framing-significant markup characters are escaped so character text cannot close its own block or create a fake block. The unescaped canonical original is stored separately by ID.

The narrator may read protected payloads but must not rewrite, translate, shorten, extend, split, merge, move, remove, or reorder them.

The framework does not trust the model to obey that instruction. Returned verbatim payloads are discarded and canonical originals are reinserted by ID before rendering.

A narrator response is invalid if any expected block is missing, duplicated, reordered, nested, malformed, has a changed ID, or if an unexpected block is introduced. Invalid framing causes raw fallback.

## Narrator operations

### `describeLocation(view)`

Called when the Human-controlled character enters a location. Receives only static presentation facts and returns literary static scene prose.

### `narrateTick({ view, entries })`

Called once after the full reaction wave. Receives:

- the full current Human-visible dynamic scene;
- chronological grounded player-facing presentation entries for the tick;
- paired verbatim character blocks as read-only context.

The narrator may rewrite only non-verbatim material. Causal order between character RP and grounded actions/results must remain intact.

## Prompt contract

The narrator system prompt is independent from character decision prompts. It establishes that supplied facts are authoritative; the model is a presentation rewriter rather than an actor or GM; it may improve syntax, combine repetition, vary wording, and create natural transitions; and it must not invent, remove, or change facts, actions, state, identity, possession, results, dialogue, or causal order.

Narrator requests are stateless and intentionally small. Do not send full character/world context or any private cognition/state irrelevant to presentation.

## Model and UI

Narrator model selection is independent from the character model.

Default narrator model:

`sao10k/l3.3-euryale-70b:nitro`

The left sidebar exposes:

- Character model selector;
- Narrator model selector;
- `Enable narrator` checkbox near `Show invisible events`.

When narrator is disabled, the existing raw presentation path is used.

## Failure semantics

Narration is non-canonical presentation work. Network errors, provider errors, truncation, empty/malformed output, or verbatim validation failures must never roll back, repeat, or otherwise affect a world tick.

On any narrator failure, render the existing raw/canonical presentation. Automatic narration retries are not required.

## Shared request executor and logging

Narrator requests use the same serialized request/cooldown infrastructure as character model calls, but bypass the character `AIProtocol` response validator through a generic/custom execution path.

They are recorded in the existing transient exchange history and therefore in the crystal-sphere exchange export with:

- `purpose: "narration"`;
- `stage: "location"` or `"tick"`;
- selected narrator model;
- sent messages;
- raw response;
- narration validation trace;
- usage/cost/provider diagnostics;
- fallback status where applicable.

API keys and authorization secrets remain excluded by the existing export redaction rules.

## History and simulation invariants

Existing History remains unchanged and continues to store raw grounded/player-facing entries. Narrator prose does not replace History and never becomes world state, event truth, memory, belief, relationship state, continuation, or an AI observation.

The deterministic engine remains the sole owner of objective state and formal action results. Existing restricted-view/perception rules remain authoritative. Narrator output must never expand what the HumanController is allowed to perceive.

## Unified narrated scene presentation

When narration succeeds, the narrator is a replacement presentation path rather than an extra layer on top of the legacy UI.

The normal narrated location view is composed as one main scene:

`History -> narrated static location prose -> narrated dynamic tick prose with inline verbatim character blocks -> gameplay/debug controls`

A successful dynamic narration therefore replaces both of the legacy dynamic presentation components:

- the boxed `Latest turn` transcript; and
- the raw current-position/presence paragraphs such as `You are standing...`, `Nell stands...`, or `Price sits...`.

Character-authored Human/AI text remains inside the narrated dynamic scene at its causal position. It is not collected into a separate panel. The paired `<verbatim id="...">...</verbatim>` blocks are only an internal narrator framing protocol; after validation, the renderer discards model-returned inner payloads, restores the canonical originals, and renders the resulting fragments inline as ordinary scene prose.

Static and dynamic narrator validity are independent. A valid narrated static room description may remain visible if a later tick narration fails. The dynamic portion itself is all-or-nothing:

- successful `narrateTick` -> render only the narrated dynamic scene (plus optional invisible-event debug rows when explicitly enabled);
- narrator disabled or `narrateTick` failure -> render the complete legacy dynamic fallback: `Latest turn` plus raw dynamic scene state.

Never render successful narrated dynamic prose simultaneously with its raw `Latest turn` or raw character-position equivalent.

Disabling `Enable narrator` immediately selects the legacy raw presentation path without advancing the world. Re-enabling may reuse currently valid presentation state; it does not itself imply a simulation tick.

Narrator presentation state is non-canonical. It must not enter world state, History, character memory, beliefs, observations, or action semantics. Loading a save invalidates cached narrated presentation so stale prose is not reused across restored runtime state.
