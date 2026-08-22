# AI RPG Framework MVP — Backward-Compatible Save Identity Hotfix

## Status

Canonical follow-up correction to `mvp-display-name-stable-save-identity-hotfix.md`.

The previous hotfix kept the internal SugarCube story/save identity at the legacy POC value. That preserved old saves, but it incorrectly prevented the MVP build from owning its own persistence identity.

## Correct invariant

The current product and SugarCube story identity are:

```text
StoryTitle = AI RPG Framework MVP
Config.saves.id = ai-rpg-framework-mvp
```

New saves created by the MVP build therefore identify themselves as MVP saves.

Backward compatibility is one-way on load:

```text
MVP loads:
- ai-rpg-framework-mvp
- ai-rpg-framework-poc

MVP saves:
- ai-rpg-framework-mvp only
```

The legacy POC build is not required to recognize MVP saves.

## Disk/base64 save compatibility

SugarCube normally rejects any save whose `save.id !== Config.saves.id` before project `Save.onLoad` handlers run. The built MVP artifact therefore patches that load guard to also accept the legacy `ai-rpg-framework-poc` ID.

This is an input-compatibility alias only. It does not change the current `Config.saves.id` and does not cause newly marshalled saves to use the legacy identity.

## Browser-save namespace compatibility

Changing `StoryTitle` also changes SugarCube's browser storage namespace. Legacy POC browser save slots would otherwise become invisible even though their payloads are compatible.

During MVP startup, before `Save.init()`, missing legacy POC save keys are copied from the old browser-storage namespace into the MVP namespace.

Only SugarCube browser save payloads are copied:

```text
save.auto.info:N
save.auto.data:N
save.slot.info:N
save.slot.data:N
```

Rules:

- existing MVP save entries win collisions;
- POC source entries are not deleted;
- unrelated POC settings/runtime/session data is not copied;
- copied legacy payloads remain tagged as POC internally and are accepted by the legacy-ID load alias;
- once saved again by MVP, the new save uses the MVP ID.

## Regression requirements

1. `StoryTitle` is `AI RPG Framework MVP`.
2. Normal MVP saves marshal with `ai-rpg-framework-mvp`.
3. MVP accepts imported/disk/base64 saves tagged `ai-rpg-framework-poc`.
4. Unknown third-party save IDs remain rejected.
5. Legacy POC browser-save entries are copied into the MVP namespace when the target entry is absent.
6. Existing MVP browser-save entries are never overwritten by legacy copies.
7. Legacy POC source entries remain intact.
8. Non-save legacy storage entries are not copied.
