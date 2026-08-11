# AI RPG Framework POC

AI RPG Framework is a browser-based role-playing game prototype with a deterministic world simulation and AI-controlled characters.

If you only want to play, you do **not** need Node.js, Twine, Tweego, a web server, or a development environment. Open the built HTML file, provide an OpenRouter API key, and play.

---

## 1. Just play the game

### What you need

- a modern browser;
- an OpenRouter account and API key;
- the built game file:

```text
dist/game.html
```

### Start the game

1. Open `dist/game.html` in your browser. Double-clicking the file is normally enough.
2. In the left sidebar, paste your **OpenRouter API key** into the API-key field.
3. Optionally enable **Remember for 24 hours** if you do not want to paste the key again during that period.
4. Leave the default Character and Narrator models selected, or choose other models from the dropdowns.
5. Play.

The **Character model** controls AI characters. The **Narrator model** is a separate presentation model that rewrites visible scene information into literary prose. You can change either model while the game is running; the new selection is used by the next corresponding request.

The Narrator is optional. If it is disabled or fails, the game falls back to the raw deterministic presentation instead of breaking the turn.

### Basic gameplay

The main text area is used for what your character says or visibly does. You may also choose:

- who you are addressing;
- whether the utterance is noticeable or hidden;
- one currently available formal action, when appropriate.

Formal actions are generated from the current game state. Examples include moving, taking or giving items, drinking, locking doors, or using a character-specific ability.

After you submit a turn, the world processes the Human action and then any AI reactions caused by that turn. The game waits until the complete reaction wave has finished before presenting the final result.

The collapsed **History** section contains the canonical player-facing history of previous turns. The optional Narrator changes presentation only; it does not rewrite the canonical game history.

### API-key privacy

The OpenRouter API key is not written into:

- `world.json`;
- game saves;
- model context;
- exported AI exchange logs;
- generated world files.

If **Remember for 24 hours** is enabled, the key is stored temporarily in namespaced browser storage with an expiry. **Forget saved key** clears both the saved and current in-memory key.

OpenRouter requests may cost money according to the models you select.

---

## 2. Edit the world without programming

The project includes a standalone offline world editor:

```text
editor/world-editor.html
```

You do **not** need Node.js, Twine, Tweego, a server, or a command line to use the editor.

### Typical editor workflow

1. Open `editor/world-editor.html` in a browser.
2. Use **Open file** and select the current:

```text
data/world.json
```

3. Edit the world.
4. Validate the document in the editor.
5. Use **Save** to download the edited `world.json`.
6. Give that file to whoever builds the game.

The editor does not rebuild `game.html` itself. Its job is to edit and export the authoritative world description.

### What the editor can author

The current editor supports the main authored game data, including:

- locations and connections;
- sublocations such as tables, beds, the bar area, and other positions;
- characters and their starting positions;
- public and AI-facing character descriptions;
- character abilities;
- item definitions;
- persistent item instances and their initial placement;
- passage blocking and locking;
- ordinary key compatibility;
- authored initial character mind data.

The authoritative authored file is always:

```text
data/world.json
```

Files under `src/generated/` are build products. Do not edit them manually.

---

## 3. Build a game after editing the world

A builder takes the edited `world.json`, puts it back into the repository as `data/world.json`, runs the tests, and builds a new standalone:

```text
dist/game.html
```

The project does **not** require the Twine desktop application. Clean source builds use **Tweego**, the command-line compiler, together with SugarCube.

### Windows

Required for development/building:

- Node.js;
- Tweego + SugarCube for a completely clean build.

From the repository root, first run the tests:

```bat
test.bat
```

Then build:

```bat
build.bat
```

The finished game is:

```text
dist/game.html
```

You can then copy that single HTML file to another machine and play it directly in a browser.

### Linux / WSL

Required:

- Node.js;
- Tweego + SugarCube for a completely clean build.

Run:

```bash
./test.sh
./build.sh
```

`build.sh` searches for Tweego on `PATH`, in the project `.tools/tweego/` directory, and in common user-local locations. `TWEEGO_EXE` and `TWEEGO_PATH` may also be supplied explicitly.

If Tweego is unavailable but a valid existing `dist/game.html` is already present, the Bash build can reuse its embedded SugarCube runtime through `tools/build-from-existing-runtime.js` and replace the authored story/style/script payload with the current sources.

A completely clean build with no existing SugarCube runtime still requires Tweego.

### Tests do not spend API money

The automated tests use mocked model transports. Running `test.bat` or `./test.sh` does not make live OpenRouter requests.

---

## 4. Repository map

At this point you only need the rest of this README if you want to understand or modify the framework itself.

```text
dist/game.html                 Standalone playable game

editor/world-editor.html       Standalone offline world editor
data/world.json                Authoritative authored world
data/model_list.json           Selectable OpenRouter models and defaults

src/story.twee                 SugarCube/Twine passages
src/00-model-list.js           Generated embedded model catalog
src/10-game-api.js             World model, actions, restricted views, invariants
src/20-controllers.js          Human, Dummy, and AI character controllers
src/21-ai-settings.js          API key and model preferences
src/22-openrouter-client.js    Browser-side OpenRouter transport
src/23-ai-protocol.js          Character response protocol and validation
src/24-ai-request-executor.js  Shared serialized AI request transport and exchange log
src/24-ai-turn-scheduler.js    AI reaction-wave scheduler
src/24-prompt-lab.js           Crystal-sphere AI debugging tools
src/25-turn-flow.js            Human turn + completed AI reaction wave
src/26-presentation-narrator.js Presentation Narrator
src/30-game-ui.js              Browser gameplay UI
src/styles.css                 UI styles
src/generated/                 Generated build inputs; do not hand-edit

tools/generate-world-data.js   Validates/embeds world data
tools/generate-model-list.js   Validates/embeds model catalog
tools/build-from-existing-runtime.js Fallback HTML builder

test.bat / test.sh             Complete automated test entry points
build.bat / build.sh           Complete build entry points

tests/                         Automated test suites
docs/                          Architecture and implementation documentation
AGENTS.md                      Instructions for coding agents
```

The numeric prefixes on JavaScript source files make their dependency/load order explicit when Tweego reads `src/`.

---

## 5. How the simulation works

### The engine owns objective reality

The deterministic engine is authoritative for objective world state, including:

- character locations and positions;
- inventories and persistent item instances;
- money;
- passage locks and keys;
- item transformations;
- formal action success/failure;
- perception and observation delivery;
- controller ownership.

AI models do not directly mutate those systems.

An AI character chooses at most one formal action from the exact actions currently offered by its restricted view. The engine validates the action and then performs it locally.

A valid in-world action attempt may still fail. Such a failure is a real spent turn and produces grounded failure feedback. A request that was impossible under the current action contract is rejected before the world tick advances.

### Human and AI use the same restricted view

The restricted character `view` is the canonical public and operational projection of the world.

The player UI is built from this view. AI characters receive the same view for their controlled character, plus only that character's private information such as:

- AI-facing identity instructions;
- beliefs and relationships;
- memories;
- pending observations;
- private ability instructions;
- `continuation`.

The model does not receive an alternate hidden copy of the world with extra operational powers.

### AI reactions are causal, not autonomous timers

After a Human Submit:

1. the Human intent is committed;
2. grounded observations are delivered;
3. eligible AI characters react synchronously;
4. later AI characters can see observations produced earlier in the same reaction wave;
5. each eligible AI character reacts at most once during that Human world tick;
6. the final scene is presented only after the wave completes.

There is no free-running autonomous NPC timer loop.

Formal-action targets receive the strongest scheduler priority, speech targets receive secondary priority, and remaining eligible AI characters use deterministic scheduler order.

### `continuation`

`continuation` is a private model-authored working intention, for example an unfinished purpose such as fetching something for a patron.

The framework stores the latest value and returns it on later reactions. The engine does not interpret, validate, prioritize, expire, or turn it into an action queue.

---

## 6. Items, positions, locks, and perception

### Persistent item instances

Items are persistent instances that refer to item definitions.

For example, one physical mug can change definition while remaining the same item instance:

```text
Empty mug -> fill -> Mug of ale -> consume -> Empty mug
```

This allows reusable physical objects instead of creating a new mug every time someone orders ale.

### Sublocations

Tables, beds, the bar counter, and similar positions are authored sublocations. They are ordinary world entities used by the general movement, reachability, inventory, and capability systems rather than hard-coded one-off mechanics.

### Locks and keys

Passage locks use authored lock IDs. Ordinary item definitions may carry a matching key lock ID.

`lock` and `unlock` are normal grounded actions. Reciprocal sides of the same physical passage stay synchronized, but unrelated doors do not share state merely because they use the same mechanics.

### Movement perception

A successful major-location transition produces one canonical movement event conceptually equivalent to:

```text
character_moved { actorId, fromLocationId, toLocationId }
```

That same event is delivered to the union of characters who can perceive the actor from either the source side or destination side.

---

## 7. Character memory and observations

Runtime character state contains separate partitions for things such as:

- known facts;
- beliefs;
- relationships;
- recent memories;
- long-term memories;
- pending observations.

Pending observations are grounded inputs delivered by the deterministic engine. Character models may decide what is worth remembering or updating.

The current implementation does **not** yet perform automatic context summarization, memory compression, embeddings, or retrieval-based old-memory selection. Long-running characters can therefore accumulate increasingly large memory context.

Game saves store canonical world/character state needed to continue the game. The detailed AI request/response exchange log is runtime debugging data and is **not** stored in saves.

Compatible older playthroughs are migrated automatically after a rebuild using a **fresh authored world + preserved lives** model. Current locations, exits, character authoring, item definitions, abilities, and authored `knownFacts` come from the new build; surviving characters keep their beliefs, relationships, recent/long-term memories, continuation, wallet, valid position/controller state, and valid runtime item instances. During this process the UI shows **Migrating save...** and commits the candidate world only after full validation. Failed migration never silently resets the playthrough.

---

## 8. Presentation Narrator

The Narrator is a presentation service, not a character Controller and not part of the simulation scheduler.

It cannot:

- move characters;
- execute actions;
- change inventories;
- change memories or beliefs;
- alter History;
- decide whether an action succeeded.

### Static narration

When the Human-controlled character enters a location, the Narrator can turn relatively static visible location facts into concise literary prose.

Static narration is regenerated on each location entry and has a 400-token completion ceiling.

### Dynamic narration

After a complete Human tick and AI reaction wave, the dynamic Narrator receives two distinct sources of information:

- `snapshot` — what is visibly true at the end of the completed tick;
- `tickEvents` — what happened during that tick in causal order.

These are not the UI History.

Human-authored narrative and AI character-authored `publicNarrative` / `spokenText` are immutable framework-owned blocks. The Narrator may read them for continuity but does not rewrite them.

The Narrator returns only prose segments around those immutable blocks:

```json
{
  "prose": [
    "Narration before the first character block.",
    "Narration between character blocks.",
    "Narration after the last character block."
  ]
}
```

Empty prose segments are valid. Missing segments are treated as empty. Extra segments are appended after the final immutable block rather than causing a simulation failure.

Dynamic narration has a 700-token completion ceiling.

Narrator output is presentation-only. If narration fails, the already-completed world tick remains valid and the UI falls back to raw deterministic presentation.

### Presentation diagnostics

The scene currently uses subtle background colours to make the presentation path visible without labels:

- narrated static: muted blue;
- narrated dynamic: muted green;
- raw/fallback: muted red.

While processing, the previous completed scene remains visible and the UI shows a large centered:

```text
Thinking...
```

between the scene and gameplay controls.

---

## 9. OpenRouter transport and debugging

The browser calls OpenRouter directly using the player-supplied API key.

Character and Narrator requests share the same serialized request executor and browser-side timing/rate-limit policy, but they use separate model selections and separate response protocols.

The in-memory exchange log records recent AI requests and responses for debugging. It includes character and Narrator exchanges, request purpose/stage, model IDs, usage information, parser traces, and sanitized provider details.

The exchange history is bounded in memory and can be exported manually for debugging. It is not part of the normal game save.

The temporary crystal-sphere prompt lab in the Village temple provides additional AI debugging facilities such as request inspection, dry runs, scheduler state, and exchange-log import/export.

---

## 10. Automated tests

The full test entry points are:

Windows:

```bat
test.bat
```

Bash/Linux/WSL:

```bash
./test.sh
```

The current test entry point runs:

```text
tests/run-tests.js
tests/run-editor-tests.js
tests/run-ui-tests.js
tests/run-ai-tests.js
tests/run-generator-tests.js
tests/run-narrator-tests.js
```

The suites cover the deterministic engine, editor, browser UI, AI protocol/controller behavior, generated-data validation, and Presentation Narrator behavior.

---

## 11. Development rules and source of truth

For development, the authoritative authored world is:

```text
data/world.json
```

Generated world/model JavaScript is produced from the source JSON during tests/build and should not be manually edited.

Likewise:

```text
dist/game.html
```

is a generated distributable, not the source of truth.

Framework behavior should be implemented in the appropriate existing core subsystem rather than through runtime monkey patches or wrapper hacks.

Exactly one character must be Human-controlled. Controller switching must preserve that invariant atomically.

Coding agents should read:

```text
AGENTS.md
```

before modifying the project.

More detailed design and implementation documentation lives under:

```text
docs/architecture.md
docs/status.md
docs/engine/
docs/world/
```
