# Codex Task — Generic Ability UI and Working Read Aura

## Goal

Make the existing authored ability system usable by a human-controlled character in the normal game interface.

The implementation must be generic with respect to characters:

- do not special-case `hoodedWoman`;
- if `readAura` is assigned in the editor to the player, innkeeper, hooded woman, or any future character, the same ability control appears when that character is controlled by HumanController;
- remove the current explicit-target requirement from `read_aura`;
- show the grounded private result in the normal player-facing UI.

This is a narrow hardening task. Do not design arbitrary author scripts or a general effect language.

## Read first

Read and follow:

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/status.md`
4. this task file

Preserve all currently working world editor, character, ability, sublocation, action, controller, save, generator, and build behavior unless this task explicitly changes it.

## 1. No executable code in the editor

Keep the current editor rule:

- ability definitions contain metadata and a known `actionType` only;
- do not add a JavaScript/code textarea;
- do not use `eval`, `Function`, inline scripts from `world.json`, or any equivalent mechanism;
- do not add editable effect definitions in this task.

The existing character field labeled `Hidden aura` remains the authored source for aura scan results. Do not add another aura field or rename the stored property unless migration is complete and backward compatible.

## 2. Generic player-facing ability discovery

The normal player-facing UI must derive ability controls from the character currently owned by HumanController.

Do not check character IDs.

Required discovery rule:

1. obtain the current actor through `setup.Game.getHumanCharacterId()`;
2. obtain the actor's restricted view/current action availability;
3. inspect the actor's assigned ability records;
4. render a control only when that ability's `actionType` is currently present in `available_actions` with a matching `character_ability` grant source.

The ability metadata exposed to the UI may include only public fields required for display:

- ability ID;
- `name`;
- `playerDescription`;
- `actionType`;
- current availability/grant metadata.

Do not expose `aiDescription`, another character's private data, minds, or `engineFacts` through the UI view.

For this milestone, the player-facing generic renderer only needs to execute assigned abilities that require no user-supplied parameters. `read_aura` is the only required example.

If an assigned ability maps to an unsupported parameterized action, do not guess parameters or build a target picker. It may remain available only in the developer/debug interface until a later task defines its UI contract.

## 3. Player-facing ability section

Add a normal section to the location/player view, above the developer/debug formal-action panel.

Example:

```text
Abilities

Read aura
Sense the hidden auras of everyone you can currently perceive.

[Read aura]
```

Requirements:

- the section is absent when the controlled character has no currently available assigned abilities supported by this renderer;
- use authored ability `name` and `playerDescription`;
- create one execution button for `readAura`;
- button execution must call `setup.CharacterAPI.perform()`;
- do not call the action handler directly;
- switching HumanController immediately recalculates the section;
- assigning `readAura` to any character in `world.json` must make the control appear for that character without changing UI JavaScript.

Do not remove the existing developer/debug formal-action panel.

## 4. Change read_aura to a zero-input scan

Change the formal action invocation to:

```json
{
  "type": "read_aura"
}
```

The action must reject or ignore caller-supplied target fields rather than trusting them. The engine determines scan targets.

Validation:

- actor exists;
- actor currently receives `read_aura` from an assigned character ability;
- action is currently available;
- no explicit target is required.

Target derivation:

- use the engine's current perception/restricted-view logic;
- scan all other characters currently perceivable to the actor;
- exclude the actor;
- under current milestone rules, this normally means other characters in the same major location/passage regardless of sublocation;
- do not scan raw global character state and then invent a second visibility rule.

For each scanned character:

- read only the existing hidden aura value (`engineFacts.aura`, edited as `Hidden aura`);
- include the public character ID/name needed to label the result;
- never return the rest of `engineFacts`;
- when the hidden aura field is empty or absent, return a neutral grounded value such as `You perceive nothing unusual.` rather than omitting the character.

When no other characters are perceivable, the action succeeds and returns private feedback such as:

```text
You sense no other auras nearby.
```

## 5. Normalized private feedback

`read_aura` must keep using the unified formal action result contract.

Recommended successful result fragment:

```json
{
  "ok": true,
  "action": {
    "type": "read_aura"
  },
  "events": [],
  "feedback": [
    {
      "recipientId": "hoodedWoman",
      "kind": "observation",
      "code": "AURA_SCAN_RESULT",
      "text": "You read the nearby auras.",
      "data": {
        "results": [
          {
            "characterId": "player",
            "name": "Traveller",
            "aura": "A faint current of unrealized potential surrounds them."
          }
        ]
      }
    }
  ],
  "error": null
}
```

`recipientId` is always the actor that performed the scan. It must not be hardcoded.

Keep existing observation routing:

- deep-clone the private feedback into that actor's `mind.pendingObservations`;
- do not send it to scanned characters;
- do not create a public aura-result event;
- do not expose it in another character's view.

## 6. Immediate player-facing result display

After a HumanController executes an ability, show its private feedback immediately in the normal UI.

For `read_aura`, render structured results in a readable form, for example:

```text
Aura reading

Traveller
A faint current of unrealized potential surrounds them.

Innkeeper
You perceive nothing unusual.
```

Requirements:

- do not require the user to open Framework debug JSON;
- do not parse literary text to recover result records; use structured `feedback.data.results`;
- preserve HTML escaping;
- the result belongs to the acting character only;
- after switching HumanController, do not show the previous character's private result as if it belonged to the new actor;
- the result may be stored in JSON-serializable UI state keyed by actor ID, or rendered from the immediate result in another robust way that survives the current passage refresh;
- `mind.pendingObservations` remains future-controller input and is not itself the player-facing rendering API.

Errors from ability execution must also appear in the normal ability result/status area.

## 7. Generic behavior, not hooded-woman behavior

Required proof:

- with `readAura` assigned only to `hoodedWoman`, the button appears when controlling her and not when controlling others;
- assign `readAura` to `player` in a test fixture: the button appears when controlling the player without UI code changes;
- assign `readAura` to `innkeeper` in a test fixture: the button appears when controlling the innkeeper without UI code changes;
- remove `readAura` from `hoodedWoman`: the button disappears for her;
- a manual forged `perform(actor, {type: "read_aura"})` still returns `ACTION_NOT_AVAILABLE` when the actor lacks the grant.

Do not encode any of these character IDs into the ability renderer or action implementation.

## 8. Tests

Extend automated tests to cover at least:

1. `read_aura` action schema/input no longer requires `target_id`;
2. scan targets come from current perception and exclude self;
3. all perceivable characters are included;
4. characters outside the actor's major location are excluded;
5. empty `Hidden aura` produces a neutral result instead of omitting the character;
6. result feedback recipient is the acting character;
7. feedback is private and routed only into the actor's pending observations;
8. no world mutation or public event is required;
9. forged use without an assigned ability fails;
10. ability UI discovery is based on assigned ability/current grant, not character ID;
11. assigning the same `readAura` ability to different test characters produces the same button model;
12. switching HumanController recalculates visible ability controls;
13. structured aura results render with escaped names/text;
14. private displayed results are isolated by actor ID;
15. all existing engine, editor, generator, and build tests still pass.

Prefer extracting small pure UI-model/formatting helpers that Node tests can exercise without a full browser. Keep manual browser acceptance checks as well.

## 9. Manual acceptance scenarios

### Scenario A — Hooded woman

1. Start the game.
2. Take HumanController control of the hooded woman.
3. Verify a normal `Abilities` section shows `Read aura`.
4. Place at least one other character in the same major location.
5. Click the button.
6. Verify every visible other character is listed with its `Hidden aura` or the neutral fallback.
7. Verify the result is visible outside Framework debug.

### Scenario B — Ability reassignment

1. In `editor/world-editor.html`, assign `readAura` to the player or innkeeper.
2. Export `world.json`, replace project `data/world.json`, and build.
3. Take HumanController control of that character.
4. Verify the same button appears and works without source-code changes.

### Scenario C — Privacy

1. Perform `read_aura` as one character.
2. Switch HumanController to another character.
3. Verify the new actor does not see the first actor's private aura result.
4. Verify scanned characters did not receive the aura result in their pending observations.

## 10. Out of scope

Do not add:

- arbitrary JavaScript or executable code fields in the editor;
- `eval`, `Function`, or runtime compilation;
- editable effect definitions;
- a universal target picker;
- a universal action form/schema renderer;
- new abilities or new formal action types;
- AI/model integration;
- prompt construction;
- memory compression;
- combat or other unrelated mechanics.

## 11. Completion

Run:

```text
node tests/run-tests.js
node tests/run-editor-tests.js
node tests/run-generator-tests.js
build.bat
```

Update `docs/status.md` and `README.md` to describe the completed generic ability UI and targetless aura scan.

Do not mark the task complete unless the ability is usable from the normal player-facing UI by any human-controlled character to whom it is assigned.
