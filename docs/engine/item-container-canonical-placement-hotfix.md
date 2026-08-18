# Item Container Canonical Placement Hotfix

## Status

Implemented hotfix.

## Problem

Older or externally reconstructed saves may contain a stale `item.containerId` even though the item has one unambiguous canonical physical placement in `inventories[*].itemIds` or `character.equippedItems`.

Rejecting such a save with `ITEM_CONTAINER_MISMATCH` makes a redundant cache field stronger than the actual placement state and can prevent otherwise recoverable saves from loading.

## Rule

`containerId` is no longer an independent placement invariant.

Canonical physical placement is determined exclusively by:

- membership in exactly one inventory; or
- membership in exactly one character equipment list.

During world validation, a valid item's `containerId` is synchronized to that canonical placement.

A stale or mismatching `containerId` therefore does not fail validation or save migration.

## Errors that remain

Validation still fails when:

- an item has no canonical physical placement;
- an item has more than one physical placement;
- equipment references an invalid item/slot;
- any other ordinary item invariant is violated.

This keeps placement ownership strict while removing redundant `containerId` mismatch failures.
