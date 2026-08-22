# AI RPG — MVP Display Name / Stable Save Identity Hotfix

## Status

Superseded by `mvp-save-identity-backward-compatibility-hotfix.md`. This document records the first compatibility attempt and is retained as historical implementation context.

## Superseded

The stable-POC-identity approach was rejected. The current MVP uses its own SugarCube save identity and accepts the legacy POC ID only when loading.


Compatibility hotfix for the POC → MVP product rename.

## Problem

SugarCube derives `Config.saves.id` from `StoryTitle`. Changing the Twine/SugarCube story title from `AI RPG Framework POC` to `AI RPG Framework MVP` therefore changes the save identity even though the game data format itself is compatible. Existing disk saves then fail with `Save is from the wrong game.`

## Invariant

> Product/display naming is not persistence identity.

The internal SugarCube `StoryTitle` / save identity is a stable compatibility identifier and must not be changed by branding or lifecycle-status renames.

For compatibility with all existing saves, keep:

```text
StoryTitle = AI RPG Framework POC
Config.saves.id = ai-rpg-framework-poc
```

Current user-facing/product terminology remains:

```text
AI RPG Framework MVP
```

The legacy `POC` string in `StoryTitle` is an internal persistence identifier, not the current product status.

## Build/display behavior

- Keep `src/story.twee` `StoryTitle` at the legacy stable value.
- Runtime UI/browser title presents `AI RPG Framework MVP`.
- Build postprocessing may change the HTML `<title>` display text to MVP, but must not rewrite `StoryTitle`, SugarCube story identity, or save ID.
- Historical and newly created saves use the same stable save identity.

## Regression requirements

1. Current README/product terminology uses MVP.
2. `StoryTitle` remains exactly `AI RPG Framework POC`.
3. Runtime/browser display title is MVP.
4. Build output can display MVP without changing the internal SugarCube story/save identity.
5. Future product renames must not alter `StoryTitle` or `Config.saves.id` without an explicit save-format migration plan.

## Final invariant

```text
branding may change
persistence identity must remain stable
```
