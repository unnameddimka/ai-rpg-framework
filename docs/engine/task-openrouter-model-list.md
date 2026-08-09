# Task: Authored OpenRouter Model List and Runtime Selector

## Goal

Replace the hard-coded OpenRouter model with a small validated catalog while preserving the
single-file offline game build and every existing AI queue, protocol, rollback, diagnostics,
and redaction guarantee.

## Authoritative configuration

`data/model_list.json` is the only editable source for:

- the ordered list of models exposed in the game;
- the player-facing model names;
- `defaultModelId`.

Initial catalog:

```json
{
  "schemaVersion": 1,
  "defaultModelId": "thedrummer/cydonia-24b-v4.1",
  "models": [
    {
      "id": "thedrummer/cydonia-24b-v4.1",
      "name": "Cydonia 24B V4.1"
    },
    {
      "id": "sao10k/l3.3-euryale-70b",
      "name": "Llama 3.3 Euryale 70B"
    }
  ]
}
```

The generator must reject an empty list, malformed IDs or names, duplicates, unsupported
schema versions, and a default ID absent from the list. It writes `src/00-model-list.js`.
That file and `dist/game.html` are generated outputs.

## Runtime behavior

- Provider remains fixed to OpenRouter.
- AI Settings renders a selector from the generated catalog; no arbitrary free-text model ID.
- The authored default is selected on first load.
- A valid selection is applied to all later game, repair, and prompt-lab requests.
- The selection is stored outside SugarCube state and saves.
- It may persist independently in namespaced `localStorage` without an expiry.
- An unknown saved ID is removed and replaced by the authored default.
- Forgetting the API key does not erase the harmless model preference.
- If browser storage fails, selection remains available in memory and a nonfatal warning is
  shown.

## Standalone build constraint

The game must remain one self-contained HTML file. The build embeds the generated catalog;
the browser does not fetch `model_list.json` at runtime because sibling-file fetches are
unreliable under `file://` and would break the existing phone workflow.

## Logging

The selected model ID must appear in the portable exchange log. Each executor exchange and
protocol attempt should retain the model ID used for that request so changing the selector
later does not relabel earlier calls. Existing credential and OpenRouter user-ID redaction
continues unchanged.

## Tests

Mocked tests must verify:

- catalog order and authored default;
- duplicate/default-missing/name validation;
- valid selection and independent persistence;
- rejection of arbitrary unknown model IDs;
- restoration and fallback behavior;
- selected model in the OpenRouter request body;
- selected model in exchange-log metadata;
- selector presence in AI Settings;
- no live OpenRouter calls.
