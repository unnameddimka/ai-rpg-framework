(function () {
    "use strict";

    function synchronizeItemPlacement(world) {
        if (!world || !world.entities || !world.inventories) return world;
        const placements = new Map();
        const duplicate = new Set();
        function note(itemId, containerId) {
            if (placements.has(itemId)) duplicate.add(itemId);
            else placements.set(itemId, containerId);
        }
        Object.values(world.inventories || {}).forEach(function (inventory) {
            (inventory && Array.isArray(inventory.itemIds) ? inventory.itemIds : []).forEach(function (itemId) {
                note(itemId, inventory.id);
            });
        });
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character") return;
            (Array.isArray(entity.equippedItems) ? entity.equippedItems : []).forEach(function (record) {
                if (record && typeof record.itemId === "string") note(record.itemId, entity.id);
            });
        });
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "item" || duplicate.has(entity.id)) return;
            const placement = placements.get(entity.id);
            if (placement) entity.containerId = placement;
        });
        return world;
    }

    setup.WorldDerivedState = {
        synchronizeItemPlacement: synchronizeItemPlacement
    };
}());
