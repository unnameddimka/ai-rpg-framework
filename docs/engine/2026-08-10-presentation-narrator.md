# Presentation Narrator v2

## Status

Implemented presentation-only architecture for the AI RPG Framework.

The Narrator is not a controller. It never chooses character actions, mutates canonical world state, creates observations, writes memories, changes initiative, or rewrites History. It transforms the Human player's already-grounded visible scene into concise literary presentation.

## Successful presentation path

When narration succeeds, normal gameplay renders:

```text
Location title
History ▾

[muted blue static narration]

[muted green dynamic narration with immutable character-authored blocks inline]

          spinner
         Thinking...
       (while busy)

[gameplay controls]
[turn input]
```

A successful dynamic Narrator result replaces the legacy `Latest turn` plus raw dynamic scene presentation. Narrated and equivalent raw dynamic presentation are never shown at the same time.

## Static narration

Static narration is generated freshly when the Human-controlled character enters a location.

Input is derived only from the Human restricted canonical view and contains relatively static public facts such as:

- location name;
- authored location description;
- public sublocation text / permanent fixtures.

Dynamic character positions and mutable item state are excluded.

Static failure affects only the static section. A valid dynamic Narrator result may still be used independently.

The static completion ceiling is 400 tokens. The prompt asks for one or two compact paragraphs and strongly discourages filler.

## Dynamic Narrator input

Dynamic narration runs exactly once after the complete Human turn and resulting AI reaction wave have resolved.

Its input deliberately separates two concepts.

### `snapshot`

`snapshot` is the final visible state after the complete tick.

It answers: **what is visibly true now?**

It is rebuilt from the Human restricted view and may include:

- Human position;
- Human character inventory visible to the player;
- visible character presence and positions;
- visible mutable items in the location;
- items in currently accessible non-location inventories/surfaces.

The snapshot is authoritative for the final visible state.

### `tickEvents`

`tickEvents` is the causal sequence of visible presentation events produced during the current tick.

It answers: **what just happened?**

This is not the UI History. History remains a separate raw canonical journal and is not supplied to the Narrator as previous literary context.

Grounded engine action events/results/failures remain ordinary fact events in `tickEvents`.

## Immutable character-authored blocks

Human-authored narrative and AI character-authored public narrative/speech are immutable presentation material.

They are represented in `tickEvents` as structured `kind: "character"` entries with framework-owned IDs such as `v1`, `v2`, etc.

The framework separately retains:

- canonical block contents;
- canonical block order.

The Narrator receives the block text for linguistic context, but it never returns that text. It therefore cannot edit, omit, reorder, translate, shorten, extend, or corrupt character-authored material.

The old `<verbatim>...</verbatim>` return protocol is removed.

## Dynamic request contract

Conceptually:

```json
{
  "snapshot": [
    "Traveler sits at the third table.",
    "Nell stands nearby.",
    "Traveler has a mug of ale."
  ],
  "tickEvents": [
    {
      "kind": "fact",
      "sourceKind": "action_event",
      "text": "Nell returned from the bar."
    },
    {
      "kind": "character",
      "id": "v1",
      "sourceKind": "narrative",
      "text": "Nell: *She smiles.* Here's your ale."
    },
    {
      "kind": "fact",
      "sourceKind": "action_event",
      "text": "Nell gave Mug of ale to Traveler."
    }
  ],
  "immutableBlockOrder": ["v1"]
}
```

The dynamic Narrator returns JSON only:

```json
{
  "prose": [
    "Narration before v1.",
    "Narration after v1."
  ]
}
```

No character-authored text is returned by the model.

## Tolerant block assembly

For `N` immutable blocks the natural response shape is `N + 1` prose strings:

- before the first immutable block;
- between each pair;
- after the final immutable block.

Empty prose strings are valid and encouraged when there is nothing useful to add.

The framework deliberately tolerates segment-count mistakes:

- too few prose segments are padded with empty strings;
- extra prose segments are appended after the last immutable block in returned order;
- no repair request is made merely because the count differs.

The assembler deterministically interleaves model prose with canonical framework-owned character blocks.

Fallback is reserved for genuinely unusable Narrator output such as transport failure, empty response, or dynamic content from which no usable `{ "prose": [...] }` object can be recovered.

### Tolerant dynamic JSON recovery

Dynamic parsing is deliberately pragmatic. The framework first attempts `JSON.parse()` on the whole trimmed response. If that exact fast path fails, it scans the raw response for balanced JSON objects with a string-aware brace scanner that respects quoted strings, escaped quotes, backslashes, and nested objects. It then accepts the first candidate whose `prose` field is an array containing only strings.

This allows otherwise usable Narrator output to survive harmless model chatter such as:

- an explanatory heading before the JSON;
- a markdown/code-fence wrapper;
- prose or code after a valid JSON object;
- an extra closing brace after an otherwise complete object;
- earlier JSON-looking objects that do not satisfy the Narrator contract.

Irrelevant extra keys on an otherwise valid response are ignored and recorded diagnostically. The framework does not make a second repair request. The path is `exact parse -> tolerant recovery -> raw fallback`.

## Grounded events and character text

Character-authored attempt-phase text and later grounded engine events may both appear in the same tick input.

Example:

```text
IMMUTABLE CHARACTER BLOCK
*Nell offers the mug.*
Here's your ale.

GROUNDED FACT
Nell gave Mug of ale to Traveler.
```

The Narrator may use the grounded fact to connect the presentation coherently but cannot modify the immutable character block.

## Grounding and literary freedom

The Narrator is allowed restrained flavour but must not invent concrete unsupplied world facts.

Allowed:

- sentence rhythm and compression;
- restrained metaphor;
- slightly ornate novel-like phrasing;
- mild stylistic atmosphere that does not become a new objective fact.

Forbidden inventions include new:

- objects;
- people;
- actions;
- sounds;
- weather;
- architecture;
- visible environmental details;
- character emotions or intentions asserted as fact;
- causal events.

There is intentionally no second semantic-validator model pass. Grounding is primarily prompt-enforced and observed through presentation diagnostics/exchange logs.

## Style

Target style: **a well-written novel that has been edited aggressively**.

Guidelines:

- concise and vivid;
- one strong detail rather than several weak ones;
- no filler;
- no repeated restatement of the same fact;
- do not re-describe the entire room every tick;
- `tickEvents` are the narrative spine;
- `snapshot` is authoritative reference information, not a checklist to restate;
- unchanged snapshot facts may be omitted unless needed for clarity;
- important new events may receive slightly more vivid treatment;
- prose slots may be empty when immutable character material already carries the scene.

Static narration may be somewhat more atmospheric than dynamic narration.

Dynamic completion ceiling: 700 tokens.

Narrator requests have no character-style reasoning budget.

## Failure semantics

Narrator failure is presentation-only.

It never:

- rolls back a world tick;
- repeats AI reactions;
- retries character actions;
- changes canonical state;
- modifies History.

Static and dynamic failure are independent.

Raw fallback uses the existing deterministic presentation.

## Persistent presentation colours

Presentation sections use subtle diagnostic backgrounds as normal UI presentation for the foreseeable future.

- successful static Narrator section: muted blue;
- successful dynamic Narrator section: muted green;
- raw/fallback section: muted red.

The colours are intentionally close to the page background, with modest padding and rounding and no `STATIC`, `DYNAMIC`, or `RAW` labels.

The entire assembled dynamic scene, including immutable character-authored blocks, shares the same green dynamic container.

## Busy indicator

While turn processing is active, the previous completed scene remains visible.

One generic busy indicator is shown between scene/debug presentation and gameplay shortcut controls:

```text
[large centered spinner]
Thinking...
```

The spinner is roughly three to four times the body-text size: clearly visible but not giant.

The UI does not expose which character, Narrator, or model is currently processing.

Existing busy-state disabling of gameplay controls remains in effect.

## Hot model switching

Character and Narrator model selections are independent runtime preferences.

Changing either selector during gameplay applies to the next corresponding request. It does not reset the game or mutate world state.

An already-running transport call is unaffected by later selector changes.

Changing the Narrator model does not itself trigger a fresh narration request. Existing presentation remains until the next normal Narrator lifecycle request.

## Location transitions

After Human movement and the complete reaction wave:

1. the tick resolves;
2. the destination Human restricted view is authoritative;
3. destination static narration is generated freshly;
4. dynamic narration uses the completed tick's `tickEvents` plus the final destination `snapshot`;
5. previous-location presentation must not leak into the new scene.

## History

History remains canonical/raw and independent from Narrator presentation.

Narrator prose is never written into History and previous History entries are never rewritten.

## Exchange logging

Narrator calls continue through the shared AI request executor and exchange history with:

- `purpose: "narration"`;
- `stage: "location"` or `stage: "tick"`;
- actual selected model ID;
- request messages containing structured static input or `snapshot`/`tickEvents`;
- raw provider content;
- parsed prose / assembly result;
- tolerant padding and extra-segment counts;
- response parsing mode (`exact`, `recovered`, or `failed`) plus recovery diagnostics;
- fallback/error information.

The trace also exposes a structured `presentationInput` copy for easier debugging.

## Acceptance criteria

The implementation is accepted when:

1. successful static narration replaces raw static description;
2. successful dynamic narration replaces legacy `Latest turn` plus raw dynamic scene;
3. immutable Human/AI character text appears inline and cannot be altered by the Narrator;
4. the Narrator no longer returns `<verbatim>` blocks;
5. dynamic input separates final `snapshot` from causal current-tick `tickEvents`;
6. UI History remains separate and raw;
7. empty prose slots are valid;
8. missing prose slots are padded with empty strings;
9. extra prose slots are appended after the final immutable block;
10. count mismatch alone never triggers fallback or a repair request;
11. grounded engine events remain available alongside immutable character blocks;
12. Narrator failure never affects simulation state;
13. narrated and equivalent raw dynamic presentation never appear simultaneously;
14. static / dynamic / raw sections use subtle blue / green / red backgrounds;
15. no colour labels are shown;
16. previous completed scene remains visible while processing;
17. the centered spinner appears between presentation and gameplay controls;
18. busy text is exactly `Thinking...`;
19. static and dynamic ceilings are 400 and 700 completion tokens;
20. prompts strongly prefer concise edited literary prose without concrete hallucinated facts;
21. character and Narrator models can be changed live and independently;
22. model selection affects the next corresponding request without forcing a reset or immediate re-narration;
23. location-entry narration is fresh and does not leak previous-location presentation;
24. Narrator traces/exchange logs expose the structured input and assembly diagnostics.
