# User Friendliness Patch: Settings, Onboarding, Starter Characters, Off-Screen World, and Timelapse UX

## Status

Implementation specification for the current AI RPG MVP baseline.

This patch is a product-facing UX pass. It does not redesign the deterministic RPG engine, mind architecture, grounding rules, or save model. Its purpose is to make the existing systems understandable and pleasant for a normal player while preserving the developer/recovery capabilities already required by the project.

This specification supersedes the authored `travelerProfiles` portion of `belief-consolidation-traveler-initialization.md`. The world keeps one canonical Traveler/player shell, but the list of reusable starting identities becomes a browser-only pre-entry feature and is no longer authored world data.

Existing engine invariants remain authoritative unless explicitly changed below. In particular:

- the deterministic engine owns objective world state;
- exactly one character is HumanController-controlled;
- `visibleToHuman` continues to govern what the controlled character perceived, even though the human player may now be shown off-screen world events;
- model output must have effect;
- Formal Action Precedence remains unchanged;
- Emergency Dump remains a cross-cutting escape hatch that must work above blocking UI.

---

## 1. Product surface: clean gameplay sidebar + Settings modal

### Goal

The normal gameplay sidebar should primarily describe the current player and expose actual gameplay controls. Configuration, diagnostics, model selection, world operations, and maintenance controls should not dominate the play surface.

### Main gameplay sidebar

Keep the current player-facing controls and information:

- character selector;
- `Take control`;
- `Character` window button;
- current character name;
- location;
- position;
- gold;
- inventory summary;
- compact AI status indicator;
- one `Settings` button.

Do not keep ordinary configuration/admin blocks expanded directly in the sidebar.

Move the following into Settings:

- OpenRouter key controls;
- Character / Utility / Narrator model selectors;
- narrator enable toggle;
- pause/resume automatic AI request processing;
- automatic mind-maintenance/compression toggle;
- queue/status diagnostics;
- mind maintenance/export/import tools;
- AI activity cleanup tools;
- Validate world;
- Reset world;
- transient usage/debug diagnostics.

The Settings UI must be a modal/overlay or equivalent out-of-world UI. Opening/closing Settings:

- consumes no turn;
- emits no event or observation;
- advances no time;
- creates no memory;
- does not navigate SugarCube history as a world passage.

### Suggested Settings sections

The exact visual layout may use tabs, grouped sections, or collapsible subsections, but the conceptual grouping should be:

#### AI

- Provider: OpenRouter
- OpenRouter key editor + key status
- Character model
- Utility model
- Narrator model
- Enable narrator
- Pause automatic AI processing
- Automatic mind maintenance

#### Character / AI maintenance

- Maintain mind
- Export mind
- Import mind
- Dismiss pending reactions
- Clear current intention
- Clear selected AI activity
- Clear AI activity globally with keep-list support
- queue/runtime details

Developer-oriented explanations may be behind `Advanced details`; the default labels should explain the user-visible effect rather than internal scheduler terminology wherever practical.

#### World

- Validate world
- Reset world

Reset retains the existing confirmation requirement.

#### Starter characters

- manage browser-local starter characters;
- export library ZIP;
- import library ZIP.

This section operates only on browser-local preset data and must not mutate the active world.

#### About

- build timestamp.

### Emergency Dump exception

Emergency Dump is explicitly exempt from the “move technical controls into Settings” cleanup.

The red top-level Emergency Dump control must remain globally and immediately accessible in normal gameplay and above every blocking modal/overlay, including:

- Settings;
- startup/onboarding;
- timelapse;
- save migration;
- AI error UI;
- day-work offer UI;
- any future blocking operation.

Its availability must not depend on:

- API-key presence;
- model/provider health;
- AI executor state;
- scheduler state;
- timelapse success;
- normal sidebar rendering;
- Settings being open.

Settings may contain a duplicate Emergency Dump action, but this can never replace the always-available global control.

---

## 2. Supported model catalog and role-specific selectors

### Current production model set

Remove obsolete experimental models from the shipped model catalog. The current supported set is:

| Model | Role eligibility | Product meaning |
| --- | --- | --- |
| `deepseek/deepseek-v4-pro` | Character | recommended / stable character default |
| `deepseek/deepseek-v4-flash` | Character, Utility | lower-cost character alternative; Utility default |
| `sao10k/l3.3-euryale-70b:nitro` | Narrator | current Narrator default |

Defaults:

```text
Character: deepseek/deepseek-v4-pro
Utility:   deepseek/deepseek-v4-flash
Narrator:  sao10k/l3.3-euryale-70b:nitro
```

### Selectors remain a product feature

Do not replace model selectors with immutable labels. The current trio is a known-good configuration, not a permanent hard-coded model architecture.

The model catalog should express role eligibility so that adding a future model to `data/model_list.json` can make it testable in one or more role selectors without changing UI code.

A compatible catalog shape is:

```json
{
  "schemaVersion": 2,
  "defaultModelId": "deepseek/deepseek-v4-pro",
  "defaultUtilityModelId": "deepseek/deepseek-v4-flash",
  "defaultNarratorModelId": "sao10k/l3.3-euryale-70b:nitro",
  "models": [
    {
      "id": "deepseek/deepseek-v4-pro",
      "name": "DeepSeek V4 Pro",
      "roles": ["character"]
    },
    {
      "id": "deepseek/deepseek-v4-flash",
      "name": "DeepSeek V4 Flash",
      "roles": ["character", "utility"]
    },
    {
      "id": "sao10k/l3.3-euryale-70b:nitro",
      "name": "Llama 3.3 Euryale 70B (Nitro)",
      "roles": ["narrator"]
    }
  ]
}
```

The Character selector therefore currently offers exactly:

- DeepSeek V4 Pro — `Recommended`;
- DeepSeek V4 Flash — `Lower cost`.

The Utility selector currently contains Flash only, and the Narrator selector currently contains Euryale only. They remain actual selectors so future catalog additions automatically become available when assigned the corresponding role.

### Product explanation

Settings should briefly explain that model changes are experimental and can materially affect behavior/output quality.

Suggested copy:

> Character model changes can noticeably affect character behavior and consistency. DeepSeek V4 Pro is the current recommended configuration; Flash is available as a lower-cost alternative.

Do not claim a concrete play-session cost yet. Cost guidance is deferred until real MVP usage statistics are collected.

### Persistence compatibility

Existing persisted model IDs that are absent from the new catalog or ineligible for their role are discarded/reset to the current role default. This is browser-setting cleanup, not save migration.

---

## 3. OpenRouter key UX and onboarding

### Startup order

A genuinely fresh world uses this out-of-world bootstrap sequence:

1. AI Interaction Disclaimer;
2. OpenRouter / AI Setup information step;
3. Choose your Traveler;
4. enter the world.

Completed existing saves continue directly into gameplay.

### Disclaimer: local memory and AI-provider processing

The AI Interaction Disclaimer must clearly disclose the data-flow boundary for character memory and player-provided content. Use concise product copy equivalent to:

> **Character memory and privacy**
>
> Character memory is stored locally on your device as part of the game state. It can be exported with game saves or exported separately through the game’s memory tools.
>
> To generate AI responses, some or all of a character’s memory and relevant conversation/world context may be sent to OpenRouter and/or the selected AI model provider for processing.
>
> The game does not otherwise transmit your data. If you share sensitive information from your real life with AI characters, remember that this information may be included in requests to third-party AI services. Share and store such information responsibly.

This disclosure is informational and does not change the existing local-memory architecture or portable-memory behavior. It must appear in the disclaimer step before the separate OpenRouter setup step.

### AI Setup is informative, not blocking

The OpenRouter step must explicitly allow the player to continue without entering a key. They can configure it later in Settings.

Use short product copy equivalent to:

> **Connect AI**
>
> The game itself is free, but AI interactions are not.
>
> To use AI-controlled characters and narration, you need an OpenRouter account with credits and an OpenRouter API key. OpenRouter uses your account credits to process the AI requests made by the game.
>
> You can add your API key here now, or continue and add it later in Settings.

Provide official links:

- Create/manage API keys: `https://openrouter.ai/keys`
- OpenRouter documentation / getting started: `https://openrouter.ai/docs/quickstart`

The step should also make clear that the game itself does not bill the user; model usage is charged by OpenRouter.

Do not provide a typical hourly/day/session cost yet.

### Shared key editor component

The onboarding key editor and Settings key editor must use the same semantics.

Controls:

- empty password input for entering a new key;
- `Remember for 7 days` checkbox;
- `Save key`;
- `Forget saved key`;
- adjacent key-status indicator.

The key input is **always empty** on render, including when a key is already stored/available. It is an input for a new secret, not a display of stored state.

Do not show:

- masked stored values;
- last four characters;
- `Stored key` text inside the field;
- any recovered secret in HTML attributes or UI state.

### Key status

Key availability is shown separately from the empty input.

Required states:

- `Key status: Available` — visibly green when a key is currently available to the runtime;
- `Key status: Not set` — neutral when no key is available;
- `Key status: Rejected` — red only after the currently loaded key has actually received an authentication rejection (for example HTTP 401).

`Available` means the runtime has a key it can attempt to use. Do not spend credits or send a model request solely to validate the key.

Insufficient credits do **not** make the key invalid. A 402/credit failure should leave key status as Available while the broader AI status/error explains the credit problem.

Saving a replacement key clears a previous `Rejected` state back to Available. Forgetting the key returns to Not set.

Existing seven-day key persistence remains authoritative.

### Bootstrap persistence

Extend fresh-world bootstrap state only as needed to resume the three-step startup flow safely. A compatible shape is:

```json
{
  "playerSetup": {
    "disclaimerAccepted": false,
    "aiSetupAcknowledged": false,
    "completed": false,
    "mode": null,
    "customAuthoring": null
  }
}
```

The acknowledgement stores no API key and no provider secret. It only records that the informational step was passed for this fresh world bootstrap.

Accepting/continuing any startup step remains out-of-world and creates no events, turns, observations, memories, or time advancement.

---

## 4. Browser-only Starter Character Library

### Boundary invariant

The world has **no knowledge of the starter-character library**.

The library is a browser/pre-entry product feature only. It is not:

- authored world data;
- a world entity collection;
- canonical runtime state;
- a save dependency;
- part of portable mind;
- referenced by preset ID from a playthrough.

### Canonical Traveler shell remains world-authored

The world continues to author one canonical player/Traveler placeholder. This shell owns all world-bound starting state, including:

- canonical entity ID (`player`);
- starting location and sublocation;
- inventory and starting items;
- equipment;
- wallet;
- abilities;
- controller assignment;
- engine facts/aura;
- starting mind/known facts;
- any other mechanical setup.

A browser starter character can replace only the identity-authoring fields already allowed by Custom Traveler setup:

- `name`;
- `playerDescription`;
- `aiDescription`.

Entering the world applies those fields to the canonical player shell. It never swaps or recreates the shell.

Conceptually:

```text
world-authored Traveler shell
  +
selected browser identity authoring
  ->
actual player character for this playthrough
```

### No live link after entry

When the player enters the world using a saved browser character, the UI passes only the resolved Custom Traveler authoring to normal player setup.

The resulting world/save may preserve that resolved authoring exactly as an ordinary Custom Traveler, but must not preserve:

- browser preset ID;
- library revision;
- link/reference back to localStorage;
- synchronization metadata.

Editing/deleting a browser preset later cannot change an existing playthrough.

### Remove authored `travelerProfiles`

The current top-level `travelerProfiles` world-authoring collection is removed from the canonical world schema.

Update:

- `data/world.json`;
- generated world data;
- authored validator;
- standalone editor;
- editor tests;
- generator tests;
- startup UI;
- save migration.

Remove the `Traveler profiles` editor tab and profile authoring controls.

Fresh-world choices become:

- Generic Traveler from the world-authored player shell;
- browser-local saved characters (`My Characters`);
- New custom character.

### Browser persistence

Use a dedicated versioned localStorage record, independent of saves and AI settings, for example:

```text
aiRpg.starterCharacters.v1
```

Each record contains only identity-authoring data plus local library metadata:

```json
{
  "id": "local-generated-id",
  "name": "Price",
  "playerDescription": "...",
  "aiDescription": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`id` is a browser-library identifier only. It is never passed into world state.

Character authoring limits remain the existing Custom Traveler limits:

- name: 1-120 characters;
- player-facing description: non-empty, max 2000 characters;
- AI-facing authoring: non-empty, max 4000 characters.

### Startup UI

`Choose your Traveler` should expose:

- Generic Traveler;
- `My Characters` list when non-empty;
- `New custom character`.

A selected saved character may be loaded into the same editable authoring form. The user should be able to:

- Enter world with the current form contents;
- Save changes to the selected browser character;
- Save as new / duplicate;
- Delete the browser character.

Entering the world does not require saving the current custom authoring to the browser library.

### ZIP export

Export the complete browser library as one ZIP, for example:

```text
ai-rpg-starter-characters-YYYYMMDD-HHMMSSZ.zip
  manifest.json
  starter-characters.json
```

`manifest.json` identifies the portable format and version. `starter-characters.json` contains the character records.

Example logical payload:

```json
{
  "schema": "ai-rpg.starter-character-library",
  "version": 1,
  "exportedAt": "2026-08-21T00:00:00.000Z",
  "characters": []
}
```

The ZIP must never include:

- OpenRouter/API keys;
- AI settings;
- world state;
- saves;
- mind data;
- diagnostics.

The existing dependency-free stored-ZIP implementation used by Emergency Dump may be factored into a small reusable ZIP helper if useful; do not introduce a large third-party runtime dependency only for this feature.

### ZIP import

Import must:

1. verify ZIP structure;
2. verify schema/version;
3. parse JSON safely;
4. validate every accepted character against the Custom Traveler authoring contract;
5. ignore/reject unknown dangerous structure rather than copying arbitrary fields into runtime objects;
6. merge into the browser library without silently overwriting conflicts.

For ID conflicts expose user choice:

- Replace;
- Keep both (allocate a new local ID);
- Skip.

A batch-level “apply this choice to all conflicts” affordance is acceptable.

Import failure must leave the previous browser library intact.

### Legacy authored-profile save migration

Old saves may contain `playerSetup.mode === "authored"` and `profileId` from the superseded world profile system.

Migration must preserve the already-selected player identity without requiring the old profile to still exist:

1. read the saved player's resolved `name`, `playerDescription`, and `aiDescription`;
2. materialize them as ordinary Custom Traveler authoring in the migrated setup;
3. remove future dependency on `profileId` / `travelerProfiles`;
4. preserve all world-bound player shell/runtime state under the normal fresh-authored-world + runtime-overlay migration invariant.

New worlds never create `mode: "authored"`.

---

## 5. Off-screen world events become first-class player content

### Semantic split

Keep the engine distinction between events the controlled character perceived and events they did not perceive.

`visibleToHuman === false` continues to mean:

> the HumanController-controlled character did not perceive this event through normal world delivery.

It must continue to affect:

- character knowledge/perception;
- observation delivery;
- memory;
- AI reactions;
- narrator/grounding semantics where relevant.

It no longer means:

> hide this generated world content from the human player unless debug mode is enabled.

The human player is allowed an omniscient presentation layer over off-screen simulation.

### Remove debug gating

Remove the `Show invisible events` product toggle and the `showInvisibleEvents` presentation gate.

Off-screen committed narrative is always eligible for presentation to the human player.

Do not change canonical delivery/knowledge merely because the UI displays it.

### Presentation language

Remove all player-facing labels such as:

- `[DEBUG — NOT VISIBLE TO PLAYER]`;
- `invisible debug`;
- other wording that frames off-screen life as developer diagnostics.

Render these entries as world narrative with a small contextual heading, for example:

```text
Elsewhere — Garrick · Tavern Bar

Garrick ...
```

or:

```text
Elsewhere
Nell · Common Room

Nell ...
```

Use actor/location metadata when available. Missing metadata must not suppress the event.

Rename presentation-only CSS/classes/functions away from `invisible-debug` terminology. Engine-facing `visibleToHuman` or `hiddenNarrativeEntries` names may remain if changing them would create unnecessary protocol churn; their semantic contract is what matters.

### Committed-only invariant

As with existing progressive output, never display speculative model plans/thinking as off-screen events. Only already committed world narrative may appear.

---

## 6. Timelapse progress modal

### Goal

Replace the generic “Thinking...” spinner experience during daytime/nighttime timelapse with a dedicated modal that makes long simulation visibly productive.

The modal should show two kinds of entries in chronological order:

1. committed world events;
2. engine/process status lines.

### Lifecycle

Open the modal when a daytime or overnight timelapse actually starts.

During execution, append stage/status lines such as:

- `Preparing timelapse...`
- `Simulating round 1/5...`
- `Simulating round 2/5...`
- `Settling daytime activity...` when applicable
- `Reflecting on events...`
- `Consolidating memories...`
- `Updating weather...`
- `Finishing timelapse...`
- final `Evening has begun.` / `Morning has begun.`

Exact wording may be polished, but it must remain short and understandable.

### Progress callback contract

Add a presentation-only timelapse lifecycle callback/event path rather than inferring every stage from DOM timing.

A generic shape may be:

```js
onTimelapseProgress({
  kind: "stage",
  stage: "maintenance",
  text: "Consolidating memories..."
})
```

Existing committed presentation callbacks remain authoritative for narrative batches.

Progress callbacks:

- do not mutate canonical world state;
- are not saved as world events;
- are not observations;
- are not memories;
- are not added to History as narrative events;
- must not expose model chain-of-thought/plans/raw prompts.

### Event stream

Every committed narrative batch produced during timelapse should appear in the modal as soon as it is committed.

Both player-perceived and off-screen entries are shown. Off-screen entries use the new `Elsewhere` presentation style.

The ordinary scene/history presentation may still receive the same committed results; the modal is an additional live progress surface, not a second canonical data source.

### Completion and failure

On success, leave the completed log visible with a clear completion state and close action.

On failure:

- keep all already committed events visible;
- state how far the timelapse got when known;
- show a human-readable failure message;
- provide expandable technical details;
- do not pretend committed rounds were rolled back if the engine preserved them.

### Emergency Dump layering

The global Emergency Dump control must remain clickable above the timelapse modal throughout the entire operation.

---

## 7. Compact AI status indicator

Add a small status light plus a short label to the normal gameplay surface.

Required user-facing states:

- `AI ready`
- `AI working...`
- `AI paused`
- `AI needs key`
- `AI error`

The indicator should be compact; detailed executor/scheduler state belongs in Settings.

A reasonable precedence is:

1. active blocking AI/timelapse work -> `AI working...`;
2. current unresolved AI failure -> `AI error`;
3. no available API key -> `AI needs key`;
4. automatic processing paused -> `AI paused`;
5. otherwise -> `AI ready`.

A new successful canonical AI request may clear the transient `AI error` health state. Saving a new key may clear authentication-error state. The diagnostic error log itself must not be deleted.

The exact lamp colors are presentation details, except that positive/healthy state should read as healthy and errors should read as errors. Key status has the explicit green requirement from section 3.

---

## 8. Human-readable AI errors + technical details

### Goal

Normal users should see what they can do next, not raw provider/protocol internals.

Create one shared UI-facing error formatter for AI/provider failures. Preserve raw sanitized diagnostics separately.

Examples:

| Error | Primary user message |
| --- | --- |
| missing key | `Add an OpenRouter API key in Settings to use AI features.` |
| authentication / 401 | `OpenRouter rejected this API key. Add a valid key in Settings.` |
| insufficient credits / 402 | `Your OpenRouter account does not have enough credits for this request.` |
| rate limited / 429 | `OpenRouter is rate-limiting requests right now. Try again shortly.` |
| network error | `The game could not reach OpenRouter. Check your connection and try again.` |
| timeout | `The AI request took too long and timed out.` |
| provider unavailable / 5xx | `OpenRouter or the selected model is temporarily unavailable.` |
| invalid/truncated structured model output | `The AI returned a response the game could not use. You can retry; details are available below.` |
| fallback | `The AI request failed.` |

When useful, primary errors should offer a direct action such as opening Settings or retrying.

### Technical details

Raw sanitized details remain available behind an explicit disclosure such as `Technical details`.

They may include:

- internal error code;
- HTTP status;
- selected model ID;
- sanitized provider message;
- request/response diagnostic IDs where available.

Never reveal API keys or unsanitized Authorization data.

Do not weaken Emergency Dump or runtime diagnostic capture while simplifying normal error text.

---

## 9. History UX

### Always include off-screen world narrative

History now represents the human player's narrative history, not only what the controlled character perceived.

Therefore:

- include both perceived and off-screen committed narrative;
- use the same `Elsewhere` styling for off-screen entries;
- remove the invisible-event filter/gate;
- keep the existing bounded persistence policy unless another specification changes it.

### Open at the newest entries

Opening History must immediately show the latest entries without requiring manual scrolling.

On each closed -> open transition:

- lay out the panel;
- scroll its internal content to the bottom/newest entry.

If History remains open while new entries arrive:

- keep it pinned to the bottom only when the user was already at/near the bottom;
- if the user scrolled upward to read old history, do not yank their scroll position.

### Upward expansion

On desktop/wide layouts, prefer an anchored History panel whose bottom edge stays near the History trigger and which grows upward when there is room. Give it a bounded max height with internal scrolling.

This is preferable to an inline `<details>` block that pushes the rest of the page downward and opens at the oldest content.

On narrow/mobile layouts, a practical bounded overlay/sheet is acceptable as long as it still opens on the newest entries.

---

## 10. Deterministic NPC routine anchors

### Motivation

A coarse daytime timelapse should end in a production-plausible evening state. The tavern owner should normally be at his evening workstation rather than ending wherever an autonomous coarse plan happened to stop and causing Nell to search for him as an accidental default storyline.

This should not be solved only by stronger model prompting.

### Generic authored contract

Add optional phase-based routine anchors to character authoring:

```json
{
  "routineAnchors": {
    "evening": {
      "locationId": "bar",
      "sublocationId": "barBehindCounter"
    }
  }
}
```

For this patch, stable `morning` and `evening` phase keys are sufficient. Do not build a Sims-style hourly schedule system.

Authoring validation must verify:

- referenced location exists;
- referenced sublocation exists inside that location;
- unsupported phase keys are rejected or ignored according to one consistent validator rule.

The standalone editor must expose routine anchors because they are authored character data.

### Application semantics

After a **successful daytime timelapse**, at the transition into Evening, apply each character's `evening` routine anchor deterministically.

This is coarse-time final positioning, not a model-selected formal action and not a player-visible claim that the character instantaneously teleported.

Anchor movement must respect canonical coarse traversal capability, including passage locks/keys. Do not synthesize unlock/relock operations.

If an otherwise valid runtime anchor cannot currently be reached because of dynamic world constraints:

- leave the character at the last valid committed position;
- record a diagnostic warning;
- do not roll back the already completed daytime timelapse solely because the routine anchor could not be applied.

The final canonical world still undergoes normal validation.

### Current world authoring

Add:

```text
Garrick (`innkeeper`):
  evening -> bar / barBehindCounter

Nell (`nell`):
  evening -> commonRoom / commonRoomFloor
```

This guarantees the default evening tavern staging under ordinary reachable conditions.

### Model context

Timelapse planning context may expose a character's relevant end-of-period routine anchor as a soft planning fact (for example, that Garrick normally returns behind the bar for evening service), so autonomous behavior can lead naturally toward the deterministic final state.

The engine remains responsible for the final anchor; model compliance is not the invariant.

---

## 11. Build timestamp

Add build metadata generated by the build pipeline and expose it in Settings -> About.

For this patch only a build date/timestamp is required, for example:

```text
Build: 2026-08-21 00:53:12 UTC
```

Use an unambiguous generated timestamp, preferably ISO-8601/UTC internally.

Do not require Git/commit metadata yet.

The build timestamp is product metadata only and must not alter save compatibility.

---

## 12. Persistence, migration, and security boundaries

### Browser-local product data

The following remain outside world/save authority:

- OpenRouter API key persistence;
- selected model settings;
- starter-character library;
- Settings UI state.

### World/save data

A playthrough stores only the resolved player identity authoring needed to reconstruct that playthrough, not the starter-library source record.

### Secrets

No new export, diagnostic, history, build, or starter-character feature may expose a stored API key.

Emergency Dump continues its existing redaction rules.

### Legacy startup compatibility

Old saves without new bootstrap fields remain playable and must not be forced back through onboarding.

Old incomplete startup saves should resume at the earliest incomplete required bootstrap step after migration.

Old `authored` Traveler setup is converted as described in section 4.

Because canonical runtime startup structure changes and runtime `travelerProfiles` is removed, bump the runtime `WORLD_SCHEMA_VERSION` and add the previous current version to the supported migration set. Save migration remains fresh current authored world + compatible saved runtime overlay; do not patch old world objects in place.

The authored `world.json` schema may remain on its current authoring schema version if the shared validator/generator cleanly treats legacy `travelerProfiles` input as deprecated/ignored and generated canonical data never contains it. If strict removal would otherwise make old authored documents ambiguous, bump the authored schema instead. In either case, new editor output and shipped `data/world.json` must omit `travelerProfiles`.

### No-op / authority invariants

This UX patch does not authorize model-written settings/world mutation channels. Settings and startup UI continue to call deterministic engine/configuration APIs.

---

## 13. Testing and acceptance criteria

### Settings/sidebar

- Main sidebar no longer contains model/key/scheduler/world-maintenance blocks.
- Settings opens/closes without changing turn/time/history/world state.
- Existing moved controls still perform their previous deterministic operations.
- Emergency Dump remains usable while Settings is open.

### Models

- Shipped catalog contains only Pro, Flash, Euryale Nitro.
- Character selector offers Pro + Flash and defaults Pro.
- Utility selector offers Flash and defaults Flash.
- Narrator selector offers Euryale Nitro and defaults Euryale Nitro.
- Persisted obsolete/ineligible IDs fall back safely.
- Role metadata allows a future catalog model to appear in the appropriate selector without UI code changes.

### Key/onboarding

- Fresh world order is Disclaimer -> AI Setup -> Traveler -> gameplay.
- AI Setup can be skipped/continued without a key.
- Both key inputs are empty on render even when a key exists.
- Available key status is green.
- A stored key never appears in DOM value/placeholder text.
- 401 marks the current key Rejected; 402 does not.
- seven-day persistence remains intact.

### Starter characters

- World JSON and generated world state contain no starter-character library and no authored `travelerProfiles` collection.
- Browser library survives page reload independent of saves.
- Selecting a browser character overlays only name/playerDescription/aiDescription onto the canonical `player` shell.
- Starting inventory/location/equipment/wallet/abilities/aura remain the world-authored Traveler shell's values.
- No preset ID is stored in the playthrough.
- Editing/deleting a preset after entry does not affect existing saves.
- ZIP export/import round-trips valid libraries.
- malformed imports are atomic/non-destructive.
- ID conflict choices work without silent overwrite.
- old authored-profile saves migrate to self-contained Custom Traveler authoring.

### Off-screen presentation

- No `Show invisible events` toggle remains.
- Off-screen committed events always appear to the human player.
- No player-facing `DEBUG — NOT VISIBLE TO PLAYER` labels remain.
- The controlled character still does not receive off-screen observations/memories merely because the UI shows them.

### Timelapse modal

- Timelapse opens a dedicated progress modal.
- committed narrative appears progressively;
- off-screen entries use `Elsewhere` presentation;
- stage messages include memory consolidation/maintenance when that phase runs;
- progress text never enters canonical history/memory;
- failure preserves already committed event display;
- Emergency Dump stays clickable above the modal.

### AI status/errors

- normal play shows a compact AI status light + short label;
- missing key / paused / working / error / ready are distinguishable;
- normal errors use friendly text;
- sanitized technical details remain available;
- full diagnostic capture remains available through Emergency Dump.

### History

- opens at newest entry;
- desktop presentation prefers upward expansion from its trigger;
- bounded internal scrolling works;
- off-screen entries are included;
- reading older entries is not forcibly scrolled down when new content arrives.

### Routine anchors

- after successful daytime timelapse Garrick ends in `bar/barBehindCounter` under normal reachable conditions;
- Nell ends in `commonRoom/commonRoomFloor`;
- anchors preserve lock/key traversal rules;
- unreachable anchors do not roll back the completed day;
- editor/validator surface and validate routine anchors.

### Build info

- Settings shows the generated build date/timestamp;
- rebuilding produces a new timestamp;
- loading/saving worlds is unaffected.

---

## 14. Non-goals

This patch does **not** add:

- a hosted backend/account system;
- cloud synchronization of starter characters;
- a world-visible starter-character collection;
- portrait/image assets for starter characters;
- profile-specific inventory/location/mechanics;
- live linkage between a preset and an existing playthrough;
- hard OpenRouter key verification requests;
- automatic OpenRouter account creation or payment;
- estimated play costs before real usage statistics are available;
- a general hourly NPC schedule simulation;
- omniscient character knowledge (only omniscient human-player presentation);
- changes to mind, grounding, formal-action, or controller authority beyond the routine-anchor final-positioning rule described here;
- a general redesign of existing gameplay action buttons, which are considered adequate for this patch.

---

## 15. Canonical implementation summary

```text
Normal gameplay surface is clean.
Configuration/admin work lives in Settings.
Emergency Dump remains globally reachable above everything.

Fresh world:
    disclaimer
    -> optional OpenRouter setup/info
    -> choose Generic / browser-saved / new Custom Traveler
    -> copy resolved identity onto canonical world-authored player shell
    -> enter world

Starter-character library:
    browser-only localStorage
    ZIP import/export
    never referenced by world/save ID

Models:
    Character = DeepSeek V4 Pro (recommended) or V4 Flash (lower cost)
    Utility   = DeepSeek V4 Flash
    Narrator  = Euryale 3.3 70B Nitro
    role-specific selectors remain extensible for future testing

Off-screen simulation:
    still invisible to the controlled character when canonically unperceived
    always visible to the human player as “Elsewhere” world narrative
    never labeled debug

Long operations:
    compact AI status in normal UI
    human-readable errors
    timelapse modal streams committed events + understandable engine stages

History:
    includes Elsewhere events
    opens at latest
    prefers upward anchored expansion

Day -> Evening:
    deterministic authored routine anchors restore expected work staging
    Garrick behind the bar
    Nell on the common-room floor

Settings -> About:
    build timestamp
```
