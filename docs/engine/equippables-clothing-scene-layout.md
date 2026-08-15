# Equippables, Clothing-Based Appearance, Scene Layout, and Mara Area Refactor

## Status

Implemented in the equipment/scene-layout patch based on `ai-rpg-framework(20260815-123944)`.

## Goals

This change introduces a minimal general-purpose equipment layer, turns the current characters' clothing into real authored item instances, assembles visible character appearance from intrinsic description plus equipped items, reorganizes the main scene page into deterministic presentation panels, and corrects the Mara cottage/garden/stream topology.

The deterministic engine remains authoritative. Narrator remains presentation-only and is disabled by default.

## Equipment model

Characters do not declare a fixed body-slot schema. An item definition declares the free-form slots in which it may be worn:

```json
{
  "equipSlots": ["neck"],
  "equippedDescription": "A fine silver chain rests around the wearer's neck."
}
```

`equipSlots` is an array because a future item may offer alternative placements such as `left_horn` / `right_horn`. Slot names are ordinary exact-match strings. There is no global slot registry.

An item is equippable iff `equipSlots.length > 0`. The legacy `equippable` boolean is not the runtime source of truth. Any equippable definition must have non-empty `equippedDescription`.

For this MVP, one character may have at most one item in a particular slot. Slot stacking is deferred.

## Runtime state and physical placement

Characters store equipment records:

```json
{
  "equippedItems": [
    {
      "itemId": "maraHoodedCloak_01",
      "slot": "shoulders",
      "visible": true
    }
  ]
}
```

`visible` belongs to the equipment record because concealment is a property of how an item is currently worn. In this version all normal equips and authored starting equipment use `visible: true`; no conceal/reveal action or layering logic exists yet.

Inventory items use `item.containerId = inventoryId`. Equipped items use `item.containerId = characterId`. An item cannot simultaneously exist in inventory and equipment.

## Authored starting placement

Every authored item instance starts in exactly one mode:

```json
{
  "inventoryId": "inventory_player"
}
```

or:

```json
{
  "equippedByCharacterId": "nell",
  "equippedSlot": "clothing"
}
```

These are mutually exclusive. An authored `equippedSlot` must occur in the selected definition's `equipSlots` and must not conflict with another starting item on that character.

## Formal actions

`equip` and `unequip` are ordinary canonical formal actions exposed through `view.available_actions`, the same contract used by HumanController and AIController.

`equip` submits:

```json
{
  "type": "equip",
  "item_id": "silverChain_01",
  "slot": "neck"
}
```

The available-action option record preserves the item/slot relation, for example:

```json
{
  "items": [
    { "id": "silverChain_01", "name": "Silver chain", "slots": ["neck"] },
    { "id": "hornRing_01", "name": "Horn ring", "slots": ["left_horn", "right_horn"] }
  ]
}
```

Validation must reject a slot that belongs to some other item. Equip removes the item from inventory, sets `containerId` to the actor ID, adds `{itemId, slot, visible:true}`, and emits a public canonical physical event.

`unequip` submits only `{type:"unequip", item_id}`. It removes the equipment record, returns the item to the actor inventory, updates `containerId`, and emits a public canonical event.

There is no protection for “default” clothing: ordinary clothing can be removed, carried, dropped, given away, and re-equipped.

Equipped items remain eligible for `use_item` so worn rings/amulets/artifacts can be activated. `give_item`, `drop_item`, `place_item`, etc. continue to require ordinary inventory placement first.

Do not generate contextual quick buttons for `equip` or `unequip`. Both remain in the normal formal-action controls. Human equip UI follows the existing `give_item` pattern: item selector plus slot selector, with the only available slot auto-selected when there is exactly one.

## Canonical appearance

`playerDescription` describes intrinsic visible traits only: face, hair, build, age appearance, bearing, expression, and other persistent non-clothing features. Current clothing and wearable gear are not stored there. `aiDescription` must not become a second source of current equipment state.

Current deterministic appearance is assembled from:

1. base `playerDescription`;
2. neutral `undressed` state if no item occupies the exact `clothing` slot;
3. every visible equipment record's `equippedDescription` in stable deterministic order;
4. existing canonical posture/position text where the UI already uses it.

If the `clothing` slot is empty, the engine states only that the character is undressed. It does not invent nudity/anatomy/NSFW consequences.

Both self and visible-character canonical views expose structured `equipped_items` in addition to human-readable appearance text. Visible-character `presence_text` therefore reflects current equipment without relying on Narrator.

The `visible` field is deliberately future-facing: later rules may allow a chain under clothing, bracelets beneath sleeves, chainmail beneath a shirt, etc. Such rules are not part of this patch.

## Authored character equipment

All current characters begin with real equipment:

- Traveler: coarse `clothing` item.
- Mara: coarse `clothing` item plus a separate hooded cloak in `shoulders`.
- Garrick: coarse `clothing` item.
- Captain Price: one coarse tactical clothing/field-gear item in `clothing`, plus a separate boonie hat in `head`.
- Nell: coarse dress/apron item in `clothing`.

Character base visual descriptions are rewritten so the base plus equipped descriptions reconstructs the intended canonical appearance.

Mara keeps stable technical ID `hoodedWoman` but visible name becomes **Mara the Hedge Witch**. Observer-relative/discovered character names are deferred.

A `silverChain` definition/instance is authored with `equipSlots:["neck"]` and begins in Traveler's inventory. The intended flow is ordinary `give_item`, then Nell may choose to equip it herself.

## Editor

The standalone editor supports:

- free-form `Equip slots` on item definitions;
- `Equipped description`;
- item-instance starting placement mode `Inventory` or `Equipped`;
- character and allowed-slot selection for starting equipment;
- validation of mutually exclusive placement and duplicate occupied slots.

There is no clothing-specific editor or global body-slot list.

## Main scene layout

Below the existing location name, gameplay content is rendered as a vertical sequence of visual panels/cards with no technical section headings:

1. static authored scene description;
2. visible other-character descriptions;
3. visible movable/dynamic item instances;
4. the existing collapsed History component, behavior unchanged;
5. current tick presentation, including existing invisible/debug records when enabled;
6. contextual quick actions;
7. normal player controls/formal-action selectors.

Empty normal panels are not rendered. History keeps its functional disclosure label. The current tick keeps its current semantics rather than being redesigned.

Narrator architecture is not redesigned. Existing narrator flow is adapted only as necessary to the reorganized rendering, and Narrator defaults to **OFF**. Canonical panels must remain understandable without narration.

## Mara garden/cottage/stream topology

Keep top-level technical ID `secludedCottage`, rename its display name to **Mara's Cottage**, make it interior-only, and use `maraCottageFloor` as its default sublocation. It contains the existing floor, bed, table, and shelves sublocations.

Create top-level location `maraCottageGardenLocation`, display name **Mara's Garden**, and reparent the existing stable `maraCottageGarden` sublocation under it. The stable garden sublocation ID is intentionally preserved.

The authored graph becomes:

```text
Village Edge <-> Mara's Garden <-> Mara's Cottage
                         |
                         +-------- <-> Forest Stream
```

There is no direct Village Edge <-> Cottage exit and no direct Cottage <-> Forest Stream exit.

`forestStreamSittingPlace` remains an ordinary capacity-2 sublocation. Rename its enter label from the misleading “Sit together by the stream” to **“Sit on the stones by the stream”**. Entering it moves only the acting character; no group-movement mechanic is added.

## Save migration

Migration continues to use fresh current authoring plus compatible saved runtime overlay.

New authored clothing appears when migrating saves from before the equipment schema. Once an item exists in a compatible saved runtime, saved physical placement wins over its authored starting placement: a cloak dropped, hat given away, or clothing removed must not respawn on its original wearer.

Compatible equipment preserves `item.containerId`, `{itemId, slot, visible}`, and physical ownership. Invalid saved equipment is recovered into the surviving owner's inventory with a migration warning rather than deleted.

Position reconciliation is generic and sublocation-first: if a saved stable `sublocationId` still exists, preserve it and derive its current parent `locationId`. Therefore an old save in `maraCottageGarden` follows that stable sublocation into `maraCottageGardenLocation`, while characters already on `maraCottageBed` remain inside `secludedCottage` on the bed.

No Mara-, clothing-, or story-specific migration branch is allowed.

## Deferred

Not implemented here:

- multiple items in one slot / stacking flags;
- clothing layers or automatic occlusion;
- player/AI controls for toggling `visible`;
- dressing or undressing another character directly;
- armor stats, buffs, durability;
- item-instance description overrides, sentient items, or item memory;
- observer-relative/discovered names;
- Narrator redesign;
- explicit NSFW/nudity mechanics beyond neutral `undressed` canonical state.
