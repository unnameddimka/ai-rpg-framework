(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message, details) {
        const result = { ok: false, error: { code: code, message: message } };
        if (details !== undefined) result.error.details = clone(details);
        return result;
    }

    function worldOrCurrent(world) {
        return world || (setup.Game && setup.Game.getWorld ? setup.Game.getWorld() : null);
    }

    function authoredCalendar() {
        const document = setup.GeneratedWorldData || {};
        return document.calendar && typeof document.calendar === "object" ? document.calendar : null;
    }

    function ensureCalendar(world) {
        world = worldOrCurrent(world);
        if (!world) return null;
        const authored = authoredCalendar() || {};
        if (!world.calendar || typeof world.calendar !== "object" || Array.isArray(world.calendar)) world.calendar = {};
        if (!Array.isArray(world.calendar.weekdayNames) || world.calendar.weekdayNames.length !== 7) {
            world.calendar.weekdayNames = Array.isArray(authored.weekdayNames) ? authored.weekdayNames.slice(0, 7) : ["Sunday", "Monday", "Flamesday", "Flowday", "Woodsday", "Goldsday", "Earthsday"];
        }
        if (!Number.isInteger(world.calendar.initialWeekdayIndex) || world.calendar.initialWeekdayIndex < 0 || world.calendar.initialWeekdayIndex > 6) {
            world.calendar.initialWeekdayIndex = Number.isInteger(authored.initialWeekdayIndex) ? authored.initialWeekdayIndex : 0;
        }
        if (!Number.isInteger(world.calendar.dayNumber) || world.calendar.dayNumber < 0) world.calendar.dayNumber = 0;
        return world.calendar;
    }

    function weekdayIndex(world, dayNumber) {
        const calendar = ensureCalendar(world);
        if (!calendar) return 0;
        const day = Number.isInteger(dayNumber) ? dayNumber : calendar.dayNumber;
        return (calendar.initialWeekdayIndex + day) % 7;
    }

    function weekdayName(world, dayNumber) {
        const calendar = ensureCalendar(world);
        return calendar ? calendar.weekdayNames[weekdayIndex(world, dayNumber)] : "Sunday";
    }

    function schedule(character) {
        return character && character.weeklyPresence && typeof character.weeklyPresence === "object" && !Array.isArray(character.weeklyPresence)
            ? character.weeklyPresence : null;
    }

    function isCharacterPresent(characterOrId, world, dayNumber) {
        world = worldOrCurrent(world);
        if (!world) return false;
        const character = typeof characterOrId === "string" ? world.entities[characterOrId] : characterOrId;
        if (!character || character.type !== "character") return false;
        const weekly = schedule(character);
        if (!weekly) return true;
        const indexes = Array.isArray(weekly.presentWeekdayIndexes) ? weekly.presentWeekdayIndexes : [];
        return indexes.includes(weekdayIndex(world, dayNumber));
    }

    function isLocationAvailable(locationOrId, world, dayNumber) {
        world = worldOrCurrent(world);
        if (!world) return false;
        const location = typeof locationOrId === "string" ? world.entities[locationOrId] : locationOrId;
        if (!location || location.type !== "location") return false;
        if (!location.presenceOwnerCharacterId) return true;
        return isCharacterPresent(location.presenceOwnerCharacterId, world, dayNumber);
    }

    function isSublocationAvailable(sublocationOrId, world, dayNumber) {
        world = worldOrCurrent(world);
        if (!world) return false;
        const sublocation = typeof sublocationOrId === "string" ? world.entities[sublocationOrId] : sublocationOrId;
        if (!sublocation || sublocation.type !== "sublocation" || !isLocationAvailable(sublocation.locationId, world, dayNumber)) return false;
        if (!sublocation.presenceOwnerCharacterId) return true;
        return isCharacterPresent(sublocation.presenceOwnerCharacterId, world, dayNumber);
    }

    function scheduleSummary(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        const weekly = schedule(character);
        if (!world || !character || !weekly) return null;
        const names = ensureCalendar(world).weekdayNames;
        const days = (weekly.presentWeekdayIndexes || []).map(function (index) { return names[index]; }).filter(Boolean);
        return {
            currentWeekday: weekdayName(world),
            currentDayNumber: ensureCalendar(world).dayNumber,
            present: isCharacterPresent(character, world),
            regularPresenceDays: days,
            text: `You are regularly present in the local village from the morning through the following overnight period on ${days.join(" and ")}. When the next morning begins after each visit day, you are already away from the village. Today is ${weekdayName(world)}.`
        };
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
        const saleStock = Object.values(world.entities || {}).map(function (item) {
            if (!item || item.type !== "item") return null;
            const provenance = item.tradeProvenance;
            if (!provenance || provenance.ownerCharacterId !== character.id || provenance.role !== "sale_stock") return null;
            const definition = world.itemDefinitions[item.definitionId];
            return { itemId: item.id, definitionId: item.definitionId, name: definition && definition.name || item.name };
        }).filter(Boolean);
        if (!values.length && !saleStock.length) return null;
        return { externalSaleValues: values, currentSaleStock: saleStock };
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

    function randomInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
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
            const restock = entity && entity.type === "character" && entity.tradeLifecycle && entity.tradeLifecycle.restock;
            return restock && restock.targetInventoryId === inventory.id;
        });
        return character ? character.id : null;
    }

    function restockCharacter(character, world) {
        const lifecycle = character && character.tradeLifecycle;
        const restock = lifecycle && lifecycle.restock;
        if (!restock || !Array.isArray(restock.entries)) return ok({ characterId: character && character.id || null, createdItemIds: [], removedItemIds: [] });
        const inventory = world.inventories[restock.targetInventoryId || character.inventoryId];
        if (!inventory) return fail("RESTOCK_INVENTORY_MISSING", `Restock inventory for ${character.name} is missing.`);

        const removedItemIds = Object.values(world.entities || {}).filter(function (item) {
            const provenance = item && item.type === "item" && item.tradeProvenance;
            return provenance && provenance.ownerCharacterId === character.id && provenance.role === "sale_stock";
        }).map(function (item) { return item.id; });
        removedItemIds.forEach(function (itemId) { removeItem(world, itemId); });

        const createdItemIds = [];
        restock.entries.forEach(function (entry) {
            if (!entry || typeof entry.definitionId !== "string") return;
            const definition = world.itemDefinitions[entry.definitionId];
            if (!definition) return;
            const chance = typeof entry.chance === "number" ? Math.max(0, Math.min(1, entry.chance)) : 1;
            if (Math.random() > chance) return;
            const min = Number.isInteger(entry.min) ? Math.max(0, entry.min) : 1;
            const max = Number.isInteger(entry.max) ? Math.max(min, entry.max) : min;
            const count = randomInt(min, max);
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
        return ok({ characterId: character.id, createdItemIds: createdItemIds, removedItemIds: removedItemIds });
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

    function placeArrival(character, world, useInitialPlacement) {
        const weekly = schedule(character);
        if (!weekly) return ok({ characterId: character.id, moved: false });
        const locationId = useInitialPlacement === true && weekly.initialLocationId ? weekly.initialLocationId : weekly.arrivalLocationId;
        const sublocationId = useInitialPlacement === true && weekly.initialSublocationId ? weekly.initialSublocationId : weekly.arrivalSublocationId;
        const location = world.entities[locationId];
        const sublocation = world.entities[sublocationId];
        if (!location || location.type !== "location" || !sublocation || sublocation.type !== "sublocation" || sublocation.locationId !== location.id) {
            return fail("SCHEDULE_ARRIVAL_INVALID", `Scheduled arrival placement for ${character.name} is invalid.`);
        }
        character.locationId = location.id;
        character.sublocationId = sublocation.id;
        character.sleeping = false;
        return ok({ characterId: character.id, moved: true, locationId: location.id, sublocationId: sublocation.id });
    }

    function initializeFreshWorld(world) {
        world = worldOrCurrent(world);
        if (!world) return fail("WORLD_MISSING", "World state is unavailable.");
        ensureCalendar(world);
        const arrivals = [];
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character" || !schedule(entity) || !isCharacterPresent(entity, world)) return;
            const placement = placeArrival(entity, world, true);
            if (!placement.ok) throw new Error(placement.error.message);
            const restock = restockCharacter(entity, world);
            if (!restock.ok) throw new Error(restock.error.message);
            arrivals.push({ characterId: entity.id, restock: restock });
        });
        return ok({ weekday: weekdayName(world), dayNumber: ensureCalendar(world).dayNumber, arrivals: arrivals });
    }

    function advanceDayBoundary(world) {
        world = worldOrCurrent(world);
        if (!world) return fail("WORLD_MISSING", "World state is unavailable.");
        ensureCalendar(world);
        const snapshot = clone(world);
        const previousDayNumber = world.calendar.dayNumber;
        const nextDayNumber = previousDayNumber + 1;
        const transitions = [];
        try {
            const scheduled = Object.values(world.entities || {}).filter(function (entity) {
                return entity && entity.type === "character" && schedule(entity);
            });
            scheduled.forEach(function (character) {
                const wasPresent = isCharacterPresent(character, world, previousDayNumber);
                const willBePresent = isCharacterPresent(character, world, nextDayNumber);
                if (wasPresent && !willBePresent) {
                    const settlement = settleDeparture(character, world);
                    if (!settlement.ok) throw new Error(settlement.error.message);
                    transitions.push({ type: "departure", characterId: character.id, settlement: clone(settlement) });
                }
            });
            world.calendar.dayNumber = nextDayNumber;
            scheduled.forEach(function (character) {
                const wasPresent = isCharacterPresent(character, world, previousDayNumber);
                const isPresent = isCharacterPresent(character, world, nextDayNumber);
                if (!wasPresent && isPresent) {
                    const placement = placeArrival(character, world);
                    if (!placement.ok) throw new Error(placement.error.message);
                    const restock = restockCharacter(character, world);
                    if (!restock.ok) throw new Error(restock.error.message);
                    transitions.push({ type: "arrival", characterId: character.id, placement: clone(placement), restock: clone(restock) });
                }
            });
            if (setup.GameInternals && typeof setup.GameInternals.repairAIQueue === "function") setup.GameInternals.repairAIQueue(world);
            return ok({ dayNumber: world.calendar.dayNumber, weekday: weekdayName(world), transitions: transitions });
        } catch (error) {
            Object.keys(world).forEach(function (key) { delete world[key]; });
            Object.assign(world, snapshot);
            return fail("DAY_BOUNDARY_FAILED", error && error.message || "Weekly day-boundary processing failed.");
        }
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

        // Moving the merchant's own generated sale stock between its locked sale chest
        // and the merchant's carried inventory must not turn it into locally acquired stock.
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

        // In the current commerce loop, acquired stock is created only by another
        // character directly handing an item to a trade-enabled merchant. Taking a
        // personal belonging from an ordinary container must never mark it as trade cargo.
        if (targetTradeCharacter && sourceCharacterId && sourceCharacterId !== targetTradeCharacter.id) {
            item.tradeProvenance = {
                ownerCharacterId: targetTradeCharacter.id,
                role: "acquired_stock",
                dayNumber: ensureCalendar(world).dayNumber
            };
            return;
        }

        // A trade-enabled merchant handing out an unclassified item does not create
        // persistent provenance merely by moving it away from their inventory.
        if (sourceTradeCharacter && targetCharacterId !== sourceTradeCharacter.id) delete item.tradeProvenance;
    }

    setup.WeeklyRhythm = {
        ensureCalendar: ensureCalendar,
        currentWeekdayIndex: function (world) { return weekdayIndex(worldOrCurrent(world)); },
        currentWeekdayName: function (world) { return weekdayName(worldOrCurrent(world)); },
        isCharacterPresent: isCharacterPresent,
        isLocationAvailable: isLocationAvailable,
        isSublocationAvailable: isSublocationAvailable,
        scheduleSummary: scheduleSummary,
        tradeKnowledge: tradeKnowledge,
        initializeFreshWorld: initializeFreshWorld,
        advanceDayBoundary: advanceDayBoundary,
        restockCharacter: restockCharacter,
        settleDeparture: settleDeparture,
        noteItemTransfer: noteItemTransfer
    };
}());
