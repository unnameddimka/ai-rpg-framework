# Mallowstead Public/Private Release Profile

Status: implementation specification  
Scope: product identity + build system + authored world profiles + startup/onboarding + AI defaults + environment initialization + persistence compatibility + diagnostics + public packaging + tests  
Baseline: `ai-rpg-framework(20260821-184209).zip`

## 1. Purpose

Prepare the current AI RPG codebase for a first public downloadable release under the working product/world name **Mallowstead**, while preserving a private developer build that contains the existing Captain Price experiment.

The public and private builds must remain the same game and the same engine. They may differ only where this specification explicitly requires it:

- authored world source;
- public disclosure/onboarding behavior;
- build metadata/output naming.

Everything else should stay shared so that private development continues to exercise the code shipped publicly.

Before implementation, read and preserve the current contracts in:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/status.md`
- relevant `docs/engine/*`
- relevant `docs/world/*`

Do not create a second runtime, a second save schema, or profile-specific copies of engine modules.

---

## 2. Product decisions

The following decisions are authoritative for this patch.

### 2.1 Product and village name

The working public product name and village name are:

```text
Mallowstead
```

This is a working name and may be renamed in a future patch. That possibility must not be used as a reason to keep old MVP branding in user-facing UI.

### 2.2 Author credit

Use the passport spelling exactly:

```text
Dmytro Turovskiy
```

### 2.3 License

The repository/public release uses the **MIT License**.

Use the standard MIT license text with:

```text
Copyright (c) 2026 Dmytro Turovskiy
```

No additional copyleft or non-commercial restriction is required.

### 2.4 Initial public version

Introduce a product version and use:

```text
0.1.0
```

for the first Mallowstead public release created by this patch.

The version must have one authoritative source used by build metadata and public package naming. Do not duplicate independent hard-coded version strings across UI/build/diagnostics.

---

## 3. Non-goals

This patch does **not**:

- rewrite Git history yet;
- add telemetry or analytics;
- add a game server or account system;
- add a payment system;
- add bundled/shared OpenRouter credentials;
- intentionally make public/private saves incompatible;
- create a demo/feature-reduced public game;
- remove Advanced/admin/debug tools from gameplay;
- add a hard-coded runtime/build scanner for Captain Price or other third-party names;
- redesign the world editor;
- redesign the AI protocol or memory system;
- further rebalance daytime jobs unless the currently relaxed job-offer wording has regressed.

Historical Git cleanup is explicitly deferred to a later pre-publication operation.

---

# Part A — Build Profiles and World Ownership

## 4. Two build profiles

There are exactly two build profiles:

```text
public
private
```

### 4.1 Default profile

Running either build script without a profile builds **public**:

```bat
build.bat
```

```bash
./build.sh
```

### 4.2 Private profile

Private is selected explicitly:

```bat
build.bat private
```

```bash
./build.sh private
```

Unknown profile arguments must fail clearly instead of silently falling back.

The Windows and Bash build entry points must implement equivalent profile semantics.

## 5. Authored world files

### 5.1 Public canonical world

The committed authoritative world remains:

```text
data/world.json
```

After this patch it is the **public Mallowstead world** and contains no Captain Price authored content.

All ordinary generation/editor/documentation assumptions that `data/world.json` is the canonical public authored world remain valid.

### 5.2 Private world

The developer-only authored world is:

```text
data/world.private.json
```

It contains the private Mallowstead world including Captain Price.

Add this path to `.gitignore`.

The private file must not be required to clone, test, edit, or build the public repository.

### 5.3 Implementation ordering

The current baseline `data/world.json` contains the private Price world. During implementation, preserve that authored state before converting `data/world.json` to public form:

1. copy the current authored world to `data/world.private.json`;
2. add shared Mallowstead authoring changes to both worlds;
3. remove Price-specific authored content from committed `data/world.json`;
4. keep `data/world.private.json` ignored and local.

Do not accidentally destroy the current private world while deriving the public one.

## 6. Generated-world isolation invariant

Ignoring `data/world.private.json` is not sufficient if a private build writes Price-derived data into tracked generated files.

Therefore:

> A private build must never leave private authored world content in tracked repository build products.

In particular, `build.bat private` / `build.sh private` must not leave a Price-containing version of tracked files such as:

```text
src/generated/world-data.js
src/generated/world-passages.twee
src/generated/world-storydata.twee
```

Use staging/temporary source generation or another deterministic isolated build mechanism.

Do **not** rely on developers remembering to regenerate the public world after every private build.

A successful private build should leave the repository working tree no more likely to leak private authored content than it was before the build.

## 7. Private world missing

If `data/world.private.json` does not exist:

```bat
build.bat private
```

must fail with a concise actionable message explaining that the local private world is unavailable.

It must never silently build the public world under a private label.

---

# Part B — Public and Private World Authoring

## 8. Public removal of Captain Price

The public authored world must behave as though Captain Price was never authored into it.

Remove Price-specific authored content from `data/world.json`, including current baseline references such as:

- character `captainPrice`;
- Price-specific `knownFacts`, including `price_lodging` on other characters;
- the Captain Price sentence in Harlan's `aiDescription`;
- Price-specific clothing/gear definitions and instances;
- Price-owned ale/item instances;
- Price inventory placement;
- any Price-owned/equipped item links;
- any authored relationship/memory/reference that directly depends on Price.

This list describes the current baseline but is not a requirement to implement a special name scanner. Use ordinary authored-reference review and normal world validation.

### 8.1 Generic world assets formerly used by Price

Do not remove generic village infrastructure merely because Price used it.

In particular, Guest Room 1 remains part of the tavern.

Its ordinary room key should return to an appropriate public-world owner such as Garrick rather than becoming a dangling item or being removed solely because Price previously carried it.

Price-specific ale instances may be removed or normalized into ordinary tavern/table ale instances as appropriate, but the public authored world must not retain Price-specific naming merely for inert IDs.

## 9. Private world

The private world keeps Captain Price and the private experimental authoring built around him, subject to shared changes in this specification such as:

- Mallowstead village-name knowledge;
- current engine/world schema requirements;
- ordinary future authored fixes.

Private is not a frozen historical snapshot. It is the developer world variant of the same current game.

## 10. Everyone knows the village name

Every authored character in both world profiles receives the same objective `knownFact`:

```text
id: village_name
text: The village is called Mallowstead.
```

This includes:

- Traveler/player;
- Mara;
- Garrick;
- Nell;
- Harlan;
- Maksym;
- Captain Price in the private world;
- any other authored character present in a profile.

Use `initialMind.knownFacts`, not beliefs, STM, LTM, dialogue context, or prose-only authoring.

The village name is objective canonical background knowledge and must not decay, require semantic retrieval, or be inferred from conversation.

Because current authored known facts win during save migration, compatible older MVP saves should receive the current Mallowstead village-name fact when migrated.

## 11. Human/developer continuity notes

Update human-facing world continuity documentation where useful so current docs call the village **Mallowstead** rather than only “the village.”

Do not turn `data/world-lore.md` into runtime data; its current developer-only boundary remains unchanged.

---

# Part C — Product Identity, Build Metadata, and Credits

## 12. User-facing product rename

Replace user-facing `AI RPG Framework MVP` branding with:

```text
Mallowstead
```

At minimum this includes:

- browser/document title;
- SugarCube story/product title for new Mallowstead builds;
- top-level UI/product labels where present;
- About section;
- public HTML filename;
- public ZIP filename;
- public player README;
- diagnostic application/product labels intended for humans.

Internal source/module names such as `ai-rpg-*`, `framework-*` CSS IDs/classes, engine symbol names, historical spec titles, and other non-user-facing implementation identifiers do **not** need a mechanical rename.

Avoid a large low-value identifier churn.

## 13. Build metadata

Extend the current `setup.BuildInfo` concept to expose at least:

```text
productName
version
profile
commit
builtAt
```

Expected example:

```text
productName: Mallowstead
version: 0.1.0
profile: public
commit: <git commit or "unknown">
builtAt: <ISO timestamp>
```

### 13.1 Commit lookup

Use the current Git commit when available.

Building from an unpacked source archive or other environment without Git metadata must not fail. Use a stable fallback such as:

```text
unknown
```

## 14. About section

Settings → About must show at least:

```text
Mallowstead
Created by Dmytro Turovskiy
Version 0.1.0
Build profile: public/private
Commit: <commit or unknown>
Built: <timestamp>
```

Presentation may be compact, but the author/version/profile/commit must be readable without opening a diagnostic dump.

---

# Part D — AI Defaults

## 15. Flash defaults

Make **DeepSeek V4 Flash** the default for ordinary Character decisions as well as Utility work.

Required catalog defaults:

```text
Character default = deepseek/deepseek-v4-flash
Utility default   = deepseek/deepseek-v4-flash
```

This applies to both public and private builds.

The Narrator default remains the current narrator model unless changed by a separate specification. Do not force the Narrator role onto Flash if the current model catalog does not authorize Flash for that role.

## 16. Persisted user choices

This is a default change, not a forced override.

If a browser already contains an explicitly saved eligible model selection, preserve the current settings behavior and restore that selection.

Fresh/no-selection state must choose Flash for Character and Utility.

## 17. UI copy

Remove obsolete guidance such as:

```text
Pro is the known-good default. Flash is cheaper and may behave differently.
```

The model UI must accurately reflect Flash as the default/recommended Character option.

Do not claim a quality level that has not been established by testing.

## 18. Day-work acceptance regression

The current authored daytime work offers already contain the relaxed intent:

> Neutral strangers who ask reasonably for work should usually be acceptable, but personality, memories, relationships, and recent conflict may justify refusal.

Preserve this behavior for Mara and Harlan.

This patch does not require lowering it further unless implementation review finds that the currently authored relaxed wording is no longer reaching the relevant model decision context.

---

# Part E — Public Disclosures and Private Startup

## 19. Shared startup principle

Public/private should share the same startup implementation and Traveler selection system. Build profile controls which disclosure stage is required; it must not fork the whole startup UI.

The existing generic/custom/saved Traveler flow remains available in both profiles.

## 20. Public startup flow

A new public Mallowstead world uses this sequence:

1. full public disclosures;
2. Connect AI / API-key status;
3. Choose your Traveler;
4. resolve initial weather;
5. enter gameplay.

### 20.1 Public disclosure copy

Show the following substance in full. Minor typography/line wrapping is allowed; do not weaken or contradict it.

#### AI Interaction Disclaimer

> Mallowstead does not contain explicit adult content by default. Its characters are controlled by generative AI, however, and AI-generated responses can be unpredictable. Depending on the model and your interactions, generated content may be mature, offensive, violent, sexual, or otherwise unexpected.
>
> If you decide to get kinky with the characters — or otherwise take things into adult territory — you should be 18 or older.

#### AI, privacy, and network use

> Mallowstead has no game server of its own. Character memory and game state are stored locally in your browser and can be included in saves, memory exports, and diagnostic exports.
>
> To generate AI responses, some or all of a character's memory and relevant conversation or world context may be sent to OpenRouter and may be processed by the selected third-party model provider.
>
> The weather system uses ipwho.is to obtain approximate IP-based location and Open-Meteo to obtain current weather for those approximate coordinates. Mallowstead does not send your save or character memory to those weather services.
>
> If you share sensitive real-life information with AI characters, it may be included in requests to third-party AI services.

#### Cost and exported data

> Mallowstead itself is free. AI requests use your OpenRouter account and may consume paid credits. Cost depends on the models you select and how much you play; timelapse and memory maintenance can make multiple AI requests.
>
> Game saves and diagnostic exports may contain character conversations, memories, generated content, and other game state. API keys and authorization headers are excluded from diagnostic exports. Review exported files before sharing them publicly.

Keep the existing informal acknowledgement button tone:

```text
Okay, fine
```

### 20.2 Do not make false privacy claims

Remove the existing categorical sentence:

```text
The game does not otherwise transmit your data.
```

It is inaccurate because the weather feature contacts `ipwho.is` and Open-Meteo.

The public text must describe actual network behavior rather than pretending OpenRouter is the only external request path.

## 21. Connect AI — public

After disclosures, show the shared OpenRouter setup UI.

Public explanatory text should communicate:

- the player supplies their own OpenRouter API key;
- AI requests use the player's OpenRouter account and may consume credits;
- costs vary by model and play volume;
- the key may be remembered locally for 7 days;
- the player may continue and configure the key later in Settings.

Links to the OpenRouter key/quickstart pages may remain.

The key status must remain visible.

## 22. Private startup flow

Private skips the public disclosure stage.

Its initial AI setup surface should be intentionally minimal and contain the practical controls/status only:

- OpenRouter API key input;
- current key status;
- remember-for-7-days control;
- save/forget controls as currently needed;
- Continue.

Do not show the public maturity/privacy/cost disclosure prose in the private startup path.

After AI setup, private continues through the same shared Traveler-selection flow as public.

## 23. Disclosure state/versioning

Do not overload a historical boolean in a way that makes the new public disclosure impossible to distinguish from the older MVP text.

Introduce a small versioned public-disclosure acknowledgement (or an equivalent migration-safe representation) so that:

- new public worlds must acknowledge the current full disclosure;
- an old compatible MVP save that only accepted the previous shorter disclaimer can be shown the new public disclosure once when opened in a public Mallowstead build;
- private profile may bypass the public disclosure requirement without creating a different save schema;
- future disclosure copy can be versioned without invalidating gameplay saves.

Keep this state small and deterministic. It is setup metadata, not character/world simulation state.

## 24. Persistent public disclosure access

Add a readable `Privacy & AI` (or equivalent) section in public Settings containing the same essential public information after startup.

The exact startup acknowledgement controls do not need to be repeated there.

Private Settings may omit this public information section.

---

# Part F — Initial Weather Resolution

## 25. One shared weather mechanism

Do not implement a special second weather pipeline for new-world startup.

The same canonical weather refresh/fallback mechanism must be used for:

- initial new-world weather resolution;
- successful Night → Morning boundary refresh;
- successful Day → Evening boundary refresh.

Refactor shared orchestration if needed so the fallback and diagnostics semantics cannot drift between these call sites.

## 26. New-world weather timing

For a newly created world, resolve initial weather after required startup setup (including Traveler identity and available AI configuration) and **before the first normal gameplay state is presented as ready**.

The first playable view should therefore already contain either:

- successfully resolved real-weather narrative; or
- the same canonical fallback outcome used when a coarse-time boundary weather refresh fails.

A short “preparing world/weather” startup state is acceptable if necessary.

Do not require the player to take a turn or complete a timelapse before initial weather exists.

## 27. Weather failure remains non-blocking

Initial weather failure must never prevent a new game from starting.

The fallback behavior must be the same semantic behavior as at a new tick/coarse-time period boundary:

- preserve/use the canonical saved/default weather narrative as appropriate;
- mark weather initialization/source consistently;
- record ordinary diagnostics;
- continue into gameplay.

No special startup-only emergency weather string is allowed.

## 28. Save/load behavior

Loading a current save with initialized canonical weather does **not** fetch replacement weather merely because the game application started.

Preserve saved weather as current runtime state.

Compatible legacy/uninitialized saves may use the existing initialization path after migration.

---

# Part G — Save Compatibility Through the Mallowstead Rename

## 29. Same save schema for both profiles

Public and private builds use the same persistence format, world schema, migration code, and save API.

Do not add separate public/private save namespaces merely to prevent cross-profile loading.

## 30. Mallowstead becomes current save identity

The Mallowstead product should own its current SugarCube identity.

Use:

```text
StoryTitle = Mallowstead
current save id = mallowstead
```

New saves created by Mallowstead use the Mallowstead identity.

## 31. Backward-compatible accepted save IDs

Mallowstead must load compatible historical saves tagged with:

```text
mallowstead
ai-rpg-framework-mvp
ai-rpg-framework-poc
```

Unknown unrelated save IDs remain rejected.

This is one-way input compatibility. Re-saving through Mallowstead produces the current Mallowstead save identity.

## 32. Browser save namespace migration

Existing browser save slots from the MVP namespace must remain discoverable after the StoryTitle/product rename.

Replace the previous browser-save namespace-copy behavior with a quota-neutral namespace migration. Mallowstead moves missing SugarCube save entries from both historical namespaces:

```text
ai-rpg-framework-mvp
ai-rpg-framework-poc
```

into the current Mallowstead namespace.

Rules:

- current Mallowstead entries win collisions;
- if a legacy key and an existing Mallowstead key are byte-identical (for example after an interrupted older copy-based migration), the redundant legacy key may be deleted to reclaim quota; differing collision data is preserved;
- successfully migrated source save entries are removed from the legacy namespace so migration does not temporarily or permanently duplicate multi-megabyte save payloads in `localStorage`;
- each move must keep the raw source payload in memory and restore the legacy key if the target write fails;
- migration failure must never abort game startup; warn and continue if browser storage refuses the migration;
- only actual SugarCube save slot/autosave keys are moved;
- unrelated settings/session/runtime data is not moved.

Rationale: real AI-RPG saves can approach the browser `localStorage` quota. Copying a legacy save while keeping the source can exceed quota even though either namespace fits independently.

## 33. Authored-world migration semantics remain generic

Save migration remains:

> fresh current authored world + compatible saved runtime overlay

Do not add story-specific Price migration code.

Consequences are acceptable and intentional:

- opening a private save in public may remove authored entities that no longer exist in the public authored world through ordinary generic migration/sanitization;
- opening a public save in private may introduce current private authored baseline entities that are absent from the public authored world;
- compatible runtime state for entities present in both profiles continues to migrate normally.

The engine should not “censor” or special-case imported runtime data by character name.

---

# Part H — Distribution Packaging

## 34. Public HTML filename

The public standalone game artifact is:

```text
mallowstead.html
```

It remains a self-contained standalone HTML game as today.

## 35. Public ZIP

The public distributable is named:

```text
Mallowstead-0.1.0.zip
```

Its root contains exactly the player-facing release payload:

```text
mallowstead.html
README.md
LICENSE
```

Do not package the whole repository.

## 36. Whitelist packaging

Public packaging must be whitelist-based.

The ZIP must not contain:

- `data/world.private.json`;
- any other private world file;
- source code unless deliberately added by a future distribution decision;
- tests;
- engine/world implementation specs;
- editor files;
- emergency dumps;
- logs;
- local API/settings data;
- staging/build directories.

The private world must not enter the public ZIP even when it exists locally.

No Price-name scanner is required; structural whitelist packaging is the protection here.

## 37. Private output

Private build output must be visibly distinct from the public distributable, for example:

```text
dist/mallowstead-private.html
```

A private build should not automatically overwrite or regenerate the public release ZIP.

The exact internal temporary paths are implementation details, but the resulting files must make accidental upload of private instead of public less likely.

---

# Part I — Player README and License

## 38. Player README source

Provide a concise player-oriented README used as `README.md` inside the public ZIP.

It may come from a dedicated repository source such as `PLAYER-README.md` and be renamed during packaging, or from another single maintained source. Avoid maintaining two divergent player README copies.

The existing repository/developer README may remain developer-oriented.

## 39. Required player README content

The player README must include, in plain language:

### 39.1 What it is

- game name: Mallowstead;
- free/open-source AI-driven RPG;
- created by Dmytro Turovskiy;
- MIT-licensed.

### 39.2 How to run

- extract the ZIP;
- open `mallowstead.html` in a modern browser;
- no installer or game server is required.

### 39.3 OpenRouter setup

- the player needs their own OpenRouter API key for AI interactions;
- the key can be entered on startup or in Settings;
- remembering it for 7 days is optional;
- the game does not bundle a shared API key;
- AI use may consume paid OpenRouter credits.

### 39.4 Model defaults

Explain that:

- Character defaults to DeepSeek V4 Flash;
- Utility/maintenance defaults to DeepSeek V4 Flash;
- models can be changed in Settings;
- narrator is a separate role and remains optional for presentation behavior as currently designed.

### 39.5 How time passes

Include these concrete gameplay instructions:

- **To skip the night:** sleep in any bed and continue sleeping until morning.
- **To skip the day:** in the morning, ask the hedge witch or the blacksmith for work and accept a day job, or go hunting squirrels.

Use the current character names if helpful:

- Mara — hedge witch;
- Harlan — blacksmith.

Do not imply that the AI sponsor is guaranteed to offer a job regardless of relationships/context.

### 39.6 Saves, exports, and diagnostics

Explain briefly:

- saves/game state are local/browser-side;
- exported saves/diagnostics may contain conversations and character memories;
- API keys are not included in diagnostic exports;
- Settings → Emergency dump is useful when reporting a bug.

### 39.7 Network/privacy summary

Briefly mention:

- AI requests go through OpenRouter/selected model providers;
- weather uses approximate IP geolocation through `ipwho.is` and weather data from Open-Meteo;
- there is currently no Mallowstead game server or telemetry service.

## 40. License file

Add the standard MIT `LICENSE` file at repository root and package that exact license in the public ZIP.

The public README may summarize the license but must not replace the actual `LICENSE` file.

---

# Part J — Diagnostics and Human-Readable Build Identity

## 41. Diagnostics metadata

Include Mallowstead build identity in major diagnostic exports where build identity is useful, including at minimum Emergency Dump metadata.

Expose:

```text
productName
version
profile
commit
builtAt
```

Do not change diagnostic schema semantics merely for branding if adding optional metadata is sufficient.

## 42. Human-facing diagnostic names

Where diagnostics currently identify the application as `AI RPG Framework`, change human-facing application/product naming to Mallowstead when it does not break a machine compatibility contract.

Historical schema IDs/constants should not be renamed merely for appearance.

## 43. API-key redaction remains mandatory

All existing API-key/authorization-header redaction invariants remain unchanged.

The public disclosures rely on the statement that diagnostic exports exclude API keys and authorization headers; tests must protect that claim.

---

# Part K — Tests and Release Smoke Coverage

## 44. Existing tests remain authoritative

All existing automated tests must continue to pass.

Do not weaken current tests to accommodate the profile refactor.

## 45. Build-profile tests

Add deterministic coverage for at least:

1. no profile resolves to `public`;
2. explicit `private` resolves to private;
3. unknown profile fails;
4. private build fails clearly if `data/world.private.json` is absent;
5. public build does not require the private world;
6. private generation uses isolated/staged generated files and does not leave private world data in tracked generated outputs;
7. build metadata contains product/version/profile/builtAt and a valid commit-or-unknown value.

## 46. Packaging tests

Test the public packaging contract:

```text
Mallowstead-0.1.0.zip
```

contains exactly:

```text
mallowstead.html
README.md
LICENSE
```

and does not accidentally contain local private/staging files.

This is a structural package-content test, not a Captain Price keyword scanner.

## 47. World-profile tests

At minimum:

- committed `data/world.json` passes the ordinary authored validator;
- available local private world passes the same validator when present;
- all characters in each validated profile contain the `village_name` known fact with `Mallowstead`;
- generic public room/key placement remains valid after public-world cleanup;
- ordinary generated-world references have no dangling entities/items/inventories.

Do not add a special engine invariant saying that `captainPrice` is forbidden. The editor and engine remain generic and allow users to author whatever characters they want.

## 48. AI-default tests

Verify fresh settings select:

```text
Character = DeepSeek V4 Flash
Utility   = DeepSeek V4 Flash
```

and that a valid persisted explicit model choice still overrides the default.

Update UI assertions so they no longer expect Pro to be the recommended Character default.

## 49. Startup/profile tests

Cover:

- public requires the current full disclosure before AI setup/Traveler selection;
- private bypasses the disclosure screen;
- both profiles retain shared API-key setup/status behavior;
- both profiles retain generic/custom/saved Traveler selection;
- old MVP disclaimer state does not incorrectly count as acceptance of a newer public-disclosure version;
- public Settings exposes the persistent Privacy & AI information.

## 50. Weather tests

Add regression coverage proving:

1. a new world resolves weather through the shared weather refresh path before normal gameplay becomes ready;
2. successful initial weather uses the canonical result;
3. failed initial weather uses the same fallback semantics as coarse-time boundary refresh;
4. weather failure does not block new-world startup;
5. an initialized loaded save does not perform an unnecessary startup weather replacement;
6. diagnostics still identify weather stages/fallbacks normally.

Mocks only; automated tests must not spend OpenRouter credits or make live weather/geolocation requests.

## 51. Save compatibility tests

Extend current rename compatibility coverage:

- Mallowstead is current save identity;
- new Mallowstead saves use `mallowstead`;
- imported/disk/base64 `ai-rpg-framework-mvp` saves load;
- legacy `ai-rpg-framework-poc` saves still load;
- unrelated save IDs are rejected;
- browser MVP save slots are moved into the Mallowstead namespace without overwriting existing Mallowstead slots;
- migration is tested with a quota-limited storage fixture so a large legacy payload does not require duplicate capacity;
- legacy POC browser save compatibility remains intact;
- old compatible MVP world saves migrate onto current Mallowstead authored data and receive current authored `village_name` knowledge.

## 52. Public release smoke test

Add one lightweight public release smoke path/checklist that verifies the actual public artifact, not only isolated modules:

- public build completes;
- public authored world validates;
- `mallowstead.html` opens/bootstrap path is structurally valid;
- default AI roles resolve as specified;
- new Traveler setup can complete;
- save → load remains valid;
- overnight timelapse entry remains available by sleeping in a bed;
- daytime activity paths remain available for Mara work, Harlan work, and squirrel hunting under their normal conditions;
- public ZIP contains exactly the expected three files.

This smoke coverage may combine automated checks and an explicitly documented short manual release checklist where browser-only behavior is impractical to automate.

---

# Part L — Documentation and Status

## 53. Repository documentation

After implementation, update current documentation so it no longer claims the product is named `AI RPG Framework MVP` where that is meant as current user-facing branding.

Preserve historical specification text when it is documenting historical migrations; do not rewrite history just to replace strings.

At minimum update:

- `README.md` where it describes current product/build behavior;
- `docs/status.md` current naming/build/save/default-model baseline;
- relevant architecture/build sections if profile/staging behavior changes architecture-level ownership rules.

## 54. Build commands documentation

Document:

```bat
build.bat
build.bat private
```

and Bash equivalents.

Clearly state:

- public is the default;
- private requires ignored `data/world.private.json`;
- public build/package never includes private world data.

---

# Part M — Deferred Git History Cleanup

## 55. Not part of this implementation

Do **not** rewrite repository history while implementing this patch.

The current plan for a later pre-publication cleanup is:

1. reach a clean public Mallowstead repository state;
2. keep the private world ignored/local;
3. create a new clean root history from the desired public state;
4. force-push the public main branch as a separate deliberate operation.

No `git rebase`, `git filter-repo`, orphan-root rewrite, or force-push belongs in this patch unless separately requested.

---

# Part N — Acceptance Criteria

The patch is complete when all of the following are true.

1. `Mallowstead` is the current user-facing product/village name.
2. Public build is the default build profile.
3. `data/world.json` is the committed public Mallowstead world.
4. `data/world.private.json` is ignored, local, and used only by explicit private build.
5. Public world contains no authored Captain Price content or dangling Price-owned state.
6. Private world still contains the developer Captain Price experiment.
7. Private build cannot leak private generated world content into tracked generated files as a normal side effect.
8. Character and Utility defaults are DeepSeek V4 Flash in both profiles.
9. Narrator role remains on its existing authorized default unless separately changed.
10. Every authored character knows `The village is called Mallowstead.` as a known fact.
11. Public startup shows full mature-content/privacy/network/cost/export disclosures.
12. Private startup skips those disclosures and goes directly to practical API-key setup/status before the shared Traveler choice.
13. The public privacy text accurately mentions OpenRouter/model providers, `ipwho.is`, and Open-Meteo.
14. Initial new-world weather is resolved before normal gameplay is ready using the same refresh/fallback mechanism as coarse-time boundary weather updates.
15. Weather failure does not block startup.
16. Public/private share one save format and one generic migration system.
17. New saves use Mallowstead identity while compatible MVP and POC saves remain loadable.
18. Existing browser MVP saves remain discoverable through namespace migration.
19. Settings → About shows Mallowstead, `Dmytro Turovskiy`, version, profile, commit, and build time.
20. Emergency diagnostics contain sufficient build identity to identify version/profile/commit.
21. Root `LICENSE` is standard MIT with `Copyright (c) 2026 Dmytro Turovskiy`.
22. Public ZIP is `Mallowstead-0.1.0.zip` and contains only `mallowstead.html`, `README.md`, and `LICENSE`.
23. The player README explains OpenRouter, costs, Flash defaults, local saves/diagnostics, weather network services, night skipping by sleeping in any bed, and day skipping through Mara/Harlan work or squirrel hunting.
24. Existing relaxed Mara/Harlan neutral-stranger job-offer behavior is preserved.
25. Existing tests pass and new public/profile/package/weather/save smoke coverage passes.
26. Git history has **not** been rewritten by this patch.

---

## 56. Final design invariant

> **Mallowstead public and private are one engine and one save-compatible game. Public is the canonical distributable world; private is an ignored authored-world overlay selected only at build time. Differences stay at the product/world/onboarding boundary rather than forking gameplay.**
