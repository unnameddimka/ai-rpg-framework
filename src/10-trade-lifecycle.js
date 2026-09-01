(function () {
    "use strict";

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message, extra) { return Object.assign({ ok: false, error: { code: code, message: message } }, extra || {}); }
    function worldOrCurrent(world) { return world || (setup.Game && typeof setup.Game.getWorld === "function" ? setup.Game.getWorld() : null); }
    function awayable(character) {
        return character && character.awayable && typeof character.awayable === "object" && !Array.isArray(character.awayable) ? character.awayable : null;
    }
    function ensureCalendar(world) {
        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.ensureCalendar === "function") return setup.WeeklyRhythm.ensureCalendar(world);
        if (world && world.calendar && Number.isInteger(world.calendar.dayNumber)) return world.calendar;
        throw new Error("Trade lifecycle requires canonical calendar state.");
    }

    function restockHooks(character) {
        const config = awayable(character);
        const hooks = config && Array.isArray(config.onArrival) ? config.onArrival.filter(function (hook) { return hook && hook.action === "restock"; }) : [];
        if (hooks.length > 0) return hooks;
        const legacy = character && character.tradeLifecycle && character.tradeLifecycle.restock;
        return legacy ? [Object.assign({ action: "restock" }, legacy)] : [];
    }

    function tradeKnowledge(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        if (!world || !character || !character.tradeLifecycle) return null;
        const values = Object.values(world.itemDefinitions || {}).filter(function (definition) {
            return definition && Number.isInteger(definition.externalSaleValue) && definition.externalSaleValue >= 0;
        }).map(function (definition) {
            return { definitionId: definition.id, name: definition.name, externalSaleValue: definition.externalSaleValue };
        });
        const restock = restockHooks(character)[0] || null;
        const saleInventory = restock && world.inventories[restock.targetInventoryId] || null;
        const saleStock = (saleInventory && saleInventory.itemIds || []).map(function (itemId) {
            const item = world.entities[itemId];
            const provenance = item && item.tradeProvenance;
            if (!item || item.type !== "item" || !provenance || provenance.ownerCharacterId !== character.id || provenance.role !== "sale_stock") return null;
            const definition = world.itemDefinitions[item.definitionId];
            return { itemId: item.id, definitionId: item.definitionId, name: definition && definition.name || item.name };
        }).filter(Boolean);
        const ownInventory = world.inventories[character.inventoryId];
        const acquiredStock = (ownInventory && ownInventory.itemIds || []).map(function (itemId) {
            const item = world.entities[itemId];
            const provenance = item && item.tradeProvenance;
            if (!item || item.type !== "item" || !provenance || provenance.ownerCharacterId !== character.id || provenance.role !== "acquired_stock") return null;
            const definition = world.itemDefinitions[item.definitionId];
            return {
                itemId: item.id,
                definitionId: item.definitionId,
                name: definition && definition.name || item.name,
                expectedExternalResaleValue: definition && Number.isInteger(definition.externalSaleValue) ? definition.externalSaleValue : null
            };
        }).filter(Boolean);
        const acquiredValue = acquiredStock.reduce(function (sum, entry) {
            return sum + (Number.isInteger(entry.expectedExternalResaleValue) ? entry.expectedExternalResaleValue : 0);
        }, 0);
        return {
            currentWallet: character.wallet,
            saleStockInventoryId: saleInventory && saleInventory.id || null,
            currentSaleStock: saleStock,
            currentSaleStockCount: saleStock.length,
            acquiredStock: acquiredStock,
            expectedExternalResaleValueOfAcquiredStock: acquiredValue,
            externalSaleValues: values,
            personalInventoryIsAutomaticallySaleStock: false
        };
    }


    function removeItem(world, itemId) {
        const item = world.entities[itemId];
        if (!item || item.type !== "item") return false;
        Object.values(world.inventories || {}).forEach(function (inventory) {
            if (inventory && Array.isArray(inventory.itemIds)) inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== itemId; });
        });
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character" || !Array.isArray(entity.equippedItems)) return;
            entity.equippedItems = entity.equippedItems.filter(function (record) { return record.itemId !== itemId; });
        });
        delete world.entities[itemId];
        return true;
    }

    function nextGeneratedItemId(world, prefix) {
        let value;
        do {
            value = `${prefix || "generated"}_${world.nextGeneratedItemId++}`;
        } while (world.entities[value]);
        return value;
    }

    function randomInt(min, max, random) {
        const rng = typeof random === "function" ? random : Math.random;
        return min + Math.floor(rng() * (max - min + 1));
    }

    function characterInventoryOwnerId(inventory, world) {
        if (!inventory || !world) return null;
        const owner = world.entities[inventory.ownerId];
        return owner && owner.type === "character" && owner.inventoryId === inventory.id ? owner.id : null;
    }

    function tradeCharacterForInventory(inventory, world) {
        const ownerId = characterInventoryOwnerId(inventory, world);
        const owner = ownerId ? world.entities[ownerId] : null;
        return owner && owner.tradeLifecycle ? owner : null;
    }

    function saleInventoryOwnerId(inventory, world) {
        if (!inventory || !world) return null;
        const character = Object.values(world.entities || {}).find(function (entity) {
            if (!entity || entity.type !== "character") return false;
            return restockHooks(entity).some(function (hook) { return hook.targetInventoryId === inventory.id; });
        });
        return character ? character.id : null;
    }

    function executeRestockHook(character, hook, world, options) {
        options = options && typeof options === "object" ? options : {};
        if (!hook || hook.action !== "restock" || !Array.isArray(hook.entries)) {
            return fail("ARRIVAL_HOOK_INVALID", `Restock arrival hook for ${character && character.name || "character"} is invalid.`);
        }
        const inventory = world.inventories[hook.targetInventoryId || character.inventoryId];
        if (!inventory) return fail("RESTOCK_INVENTORY_MISSING", `Restock inventory for ${character.name} is missing.`);
        const rng = typeof options.random === "function" ? options.random : Math.random;

        const removedItemIds = Object.values(world.entities || {}).filter(function (item) {
            const provenance = item && item.type === "item" && item.tradeProvenance;
            return provenance && provenance.ownerCharacterId === character.id && provenance.role === "sale_stock";
        }).map(function (item) { return item.id; });
        removedItemIds.forEach(function (itemId) { removeItem(world, itemId); });

        const createdItemIds = [];
        hook.entries.forEach(function (entry) {
            if (!entry || typeof entry.definitionId !== "string") return;
            const definition = world.itemDefinitions[entry.definitionId];
            if (!definition) return;
            const chance = typeof entry.chance === "number" ? Math.max(0, Math.min(1, entry.chance)) : 1;
            if (chance <= 0 || (chance < 1 && rng() >= chance)) return;
            const min = Number.isInteger(entry.min) ? Math.max(0, entry.min) : 1;
            const max = Number.isInteger(entry.max) ? Math.max(min, entry.max) : min;
            const count = randomInt(min, max, rng);
            for (let index = 0; index < count; index += 1) {
                const itemId = nextGeneratedItemId(world, `restock_${character.id}`);
                const item = {
                    id: itemId,
                    type: "item",
                    definitionId: definition.id,
                    name: definition.name,
                    containerId: inventory.id,
                    tradeProvenance: {
                        ownerCharacterId: character.id,
                        role: "sale_stock",
                        dayNumber: ensureCalendar(world).dayNumber
                    }
                };
                if (definition.writable === true) item.content = "";
                world.entities[itemId] = item;
                inventory.itemIds.push(itemId);
                createdItemIds.push(itemId);
            }
        });
        return ok({ characterId: character.id, hook: "restock", targetInventoryId: inventory.id, createdItemIds: createdItemIds, removedItemIds: removedItemIds });
    }

    const ARRIVAL_HOOK_REGISTRY = Object.freeze({
        restock: executeRestockHook
    });

    function runArrivalHooks(character, world, options) {
        const config = awayable(character);
        const hooks = config && Array.isArray(config.onArrival) ? config.onArrival : [];
        const results = [];
        for (const hook of hooks) {
            const handler = hook && ARRIVAL_HOOK_REGISTRY[hook.action];
            if (!handler) return fail("ARRIVAL_HOOK_UNSUPPORTED", `Unsupported arrival hook '${hook && hook.action || "unknown"}' for ${character.name}.`);
            const result = handler(character, hook, world, options);
            if (!result.ok) return result;
            results.push(clone(result));
        }
        return ok({ characterId: character.id, hooks: results });
    }

    // Backward-compatible helper for legacy authored tradeLifecycle.restock content.
    function restockCharacter(character, world, options) {
        const legacy = character && character.tradeLifecycle && character.tradeLifecycle.restock;
        if (!legacy) return ok({ characterId: character && character.id || null, createdItemIds: [], removedItemIds: [] });
        return executeRestockHook(character, Object.assign({ action: "restock" }, legacy), world, options);
    }

    function settleDeparture(character, world) {
        const lifecycle = character && character.tradeLifecycle;
        if (!lifecycle || lifecycle.settleAcquiredOnDeparture !== true) return ok({ characterId: character && character.id || null, settledItemIds: [], gold: 0 });
        const directInventory = world.inventories[character.inventoryId];
        const inventories = directInventory ? [directInventory] : [];
        if (!inventories.length) return fail("SETTLEMENT_INVENTORY_MISSING", `Settlement inventory for ${character.name} is missing.`);
        const settled = [];
        let gold = 0;
        inventories.forEach(function (inventory) {
            inventory.itemIds.slice().forEach(function (itemId) {
                const item = world.entities[itemId];
                const provenance = item && item.tradeProvenance;
                if (!provenance || provenance.ownerCharacterId !== character.id || provenance.role !== "acquired_stock") return;
                const definition = world.itemDefinitions[item.definitionId];
                if (!definition || !Number.isInteger(definition.externalSaleValue) || definition.externalSaleValue < 0) return;
                gold += definition.externalSaleValue;
                settled.push(itemId);
            });
        });
        settled.forEach(function (itemId) { removeItem(world, itemId); });
        character.wallet += gold;
        return ok({ characterId: character.id, settledItemIds: settled, gold: gold });
    }


    function noteItemTransfer(item, sourceInventory, targetInventory, world) {
        world = worldOrCurrent(world);
        if (!item || !sourceInventory || !targetInventory || !world) return;

        const sourceCharacterId = characterInventoryOwnerId(sourceInventory, world);
        const targetCharacterId = characterInventoryOwnerId(targetInventory, world);
        const sourceTradeCharacter = tradeCharacterForInventory(sourceInventory, world);
        const targetTradeCharacter = tradeCharacterForInventory(targetInventory, world);
        const sourceSaleOwnerId = saleInventoryOwnerId(sourceInventory, world);
        const targetSaleOwnerId = saleInventoryOwnerId(targetInventory, world);
        const provenance = item.tradeProvenance;

        if (provenance && provenance.role === "sale_stock") {
            const ownerId = provenance.ownerCharacterId;
            const stillOwnedByMerchant = targetCharacterId === ownerId || targetSaleOwnerId === ownerId;
            if (stillOwnedByMerchant) return;
            const leavingMerchant = sourceCharacterId === ownerId || sourceSaleOwnerId === ownerId;
            if (leavingMerchant) delete item.tradeProvenance;
            return;
        }

        if (provenance && provenance.role === "acquired_stock") {
            const ownerId = provenance.ownerCharacterId;
            const stillOwnedByMerchant = targetCharacterId === ownerId || targetSaleOwnerId === ownerId;
            if (stillOwnedByMerchant) return;
            const leavingMerchant = sourceCharacterId === ownerId || sourceSaleOwnerId === ownerId;
            if (leavingMerchant) delete item.tradeProvenance;
            return;
        }

        if (targetTradeCharacter && sourceCharacterId && sourceCharacterId !== targetTradeCharacter.id) {
            item.tradeProvenance = {
                ownerCharacterId: targetTradeCharacter.id,
                role: "acquired_stock",
                dayNumber: ensureCalendar(world).dayNumber
            };
            return;
        }

        if (sourceTradeCharacter && targetCharacterId !== sourceTradeCharacter.id) delete item.tradeProvenance;
    }


    setup.TradeLifecycle = {
        tradeKnowledge: tradeKnowledge,
        runArrivalHooks: runArrivalHooks,
        restockCharacter: restockCharacter,
        settleDeparture: settleDeparture,
        noteItemTransfer: noteItemTransfer
    };
}());
