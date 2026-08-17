# Personal Storage & Mara Cottage Lock — Authoring Spec

## Status
Implementation specification for authored world changes accompanying the keyed-container engine patch.

## 1. Purpose

Apply the generic keyed-container and passage-lock mechanics to existing private spaces belonging to Garrick, Harlan, and Mara.

This document contains authored world changes only. No character-specific behavior belongs in engine code.

## 2. Garrick's Private Chest

Represent the small chest already described in Garrick's private room as an actual authored keyed container with its own inventory.

Create one ordinary transferable key item instance for that chest and place it initially in Garrick's direct inventory.

The chest must require that exact key item instance for canonical content visibility and interaction.

## 3. Harlan's Private Chest

Represent the small personal chest already described in Harlan's rear living room as an actual authored keyed container with its own inventory.

Create one ordinary transferable key item instance for that chest and place it initially in Harlan's direct inventory.

The same generic container-access rules apply.

## 4. Mara's Cottage Chest

Add a new practical private storage chest inside Mara's Cottage with its own inventory.

Create one ordinary transferable `Mara's Chest Key` item instance and place it initially in Mara's direct inventory.

Configure the chest to require this exact key instance.

The authored description should describe ordinary practical storage and must not imply additional mechanics that do not exist.

## 5. Move the Slab

Move the existing stable `Slab of Full Arcane Knowledge` item instance from Mara's work table into Mara's keyed chest for new authored worlds.

Do not duplicate or replace the Slab and do not reset its existing per-character study state during save migration.

Existing saves retain runtime item placement according to normal save-migration rules; the authored change controls the new-world/default placement.

## 6. Mara's Cottage Door

Make the passage between Mara's Garden and Mara's Cottage lockable through the existing ordinary passage lock system.

Create a separate ordinary transferable `Mara's Cottage Key` item instance and place it initially in Mara's direct inventory.

The cottage key and chest key are independent items. Possession of one must not grant access controlled by the other.

## 7. Initial Cottage Door State

The cottage entrance should start unlocked so current new-game accessibility is preserved.

Making the passage lockable must not itself make Mara's cottage initially inaccessible.

## 8. Daytime Work

Do not add any daytime-work instruction telling Mara to lock or unlock the cottage before work.

Do not make locking the cottage part of daytime setup, job planning, settlement, or timelapse narration policy.

Existing generic timelapse pathfinding handles lockable passages according to persistent lock state and carried passage keys.

## 9. Stable Authored IDs

Use stable explicit IDs for:

- Garrick's chest position/container inventory;
- Garrick's chest key definition and item instance;
- Harlan's chest position/container inventory;
- Harlan's chest key definition and item instance;
- Mara's chest position/container inventory;
- Mara's chest key definition and item instance;
- Mara's cottage lock ID;
- Mara's cottage key definition and item instance.

Do not derive runtime identity from display names.

## 10. Editor Visibility

The editor must visibly expose the keyed-container authoring field wherever an authored position/container inventory uses it.

At minimum the existing editor must preserve and allow inspection/editing of:

- the container inventory;
- `requiredKeyItemId`;
- the new key item instances;
- the new chest positions;
- the Slab's authored inventory placement;
- the cottage passage lock/key configuration.

A minimal control is sufficient; no broad editor redesign is required.

## 11. Save / Migration

Existing saves must remain loadable.

Migration must not duplicate the Slab or duplicate existing stable authored item instances.

New authored chests and new authored key instances may be introduced by the current authored world when absent from an older save, consistent with the framework's existing authored-world migration policy.

Existing saved passage lock state is preserved where the same canonical lock already existed in the save. The newly introduced Mara cottage lock uses its authored initial state when migrating a save that predates that lock.

## 12. Acceptance Cases

### Mara

A new world begins with Mara directly carrying both `Mara's Cottage Key` and `Mara's Chest Key`.

The Slab begins in Mara's keyed chest.

When Mara is physically at the chest and still carries the chest key, canonical view exposes the chest contents to her. If she gives the chest key to Nell, Nell gains the same access while directly carrying it and Mara loses that access if she no longer carries it.

A character entering the cottage without the chest key may perceive the chest itself but does not receive canonical disclosure or item actions for the Slab inside.

### Garrick

Garrick begins with the ordinary key to his private keyed chest. Another character does not gain chest access merely by entering Garrick's room.

### Harlan

Harlan begins with the ordinary key to his private keyed chest under the same rules.

### Cottage door

Mara may use the existing ordinary formal `lock` and `unlock` actions on the cottage entrance because she carries the cottage key.

If the cottage is persistently unlocked, any character may traverse it. If Mara persistently locks it while another character is inside and that character lacks the cottage key, that character may legitimately be unable to traverse the passage during ordinary gameplay.

During timelapse, Mara may traverse the locked cottage passage because she carries the key without requiring synthetic unlock/relock mutations.
