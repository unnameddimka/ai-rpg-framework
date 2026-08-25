(function () {
    "use strict";

    const BOUNDARY_PHASES = new Set(["Morning", "Evening"]);
    const AWAY_STATE_REVISION = 1;

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

    function fixedSchedule(character) {
        return character && character.weeklyPresence && typeof character.weeklyPresence === "object" && !Array.isArray(character.weeklyPresence)
            ? character.weeklyPresence : null;
    }

    function awayable(character) {
        return character && character.awayable && typeof character.awayable === "object" && !Array.isArray(character.awayable)
            ? character.awayable : null;
    }

    function boundary(dayNumber, phase) {
        return { dayNumber: dayNumber, phase: phase };
    }

    function validBoundary(value) {
        return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
            Number.isInteger(value.dayNumber) && value.dayNumber >= 0 && BOUNDARY_PHASES.has(value.phase));
    }

    function boundaryOrdinal(value) {
        if (!validBoundary(value)) return null;
        return value.dayNumber * 2 + (value.phase === "Evening" ? 1 : 0);
    }

    function compareBoundaries(left, right) {
        const a = boundaryOrdinal(left);
        const b = boundaryOrdinal(right);
        if (a === null || b === null) return null;
        return a === b ? 0 : (a < b ? -1 : 1);
    }

    function nextBoundary(value) {
        if (!validBoundary(value)) return null;
        return value.phase === "Morning"
            ? boundary(value.dayNumber, "Evening")
            : boundary(value.dayNumber + 1, "Morning");
    }

    function formatBoundary(world, value) {
        return validBoundary(value) ? `${weekdayName(world, value.dayNumber)} ${value.phase}` : "unknown boundary";
    }

    function ordinaryCurrentBoundary(world) {
        world = worldOrCurrent(world);
        if (!world || !world.environment) return null;
        if (world.environment.timePhase === "morning") return boundary(ensureCalendar(world).dayNumber, "Morning");
        if (world.environment.timePhase === "evening") return boundary(ensureCalendar(world).dayNumber, "Evening");
        return null;
    }

    function nextTimelapseBoundary(world) {
        const current = ordinaryCurrentBoundary(world);
        return current ? nextBoundary(current) : null;
    }

    function isFixedCharacterPresentOnDay(character, world, dayNumber) {
        const weekly = fixedSchedule(character);
        if (!weekly) return true;
        const indexes = Array.isArray(weekly.presentWeekdayIndexes) ? weekly.presentWeekdayIndexes : [];
        return indexes.includes(weekdayIndex(world, dayNumber));
    }

    function initialAwayState(character, world) {
        const config = awayable(character);
        if (!config) return null;
        const initial = config.initialState && typeof config.initialState === "object" && !Array.isArray(config.initialState) ? config.initialState : {};
        const present = initial.present !== false;
        let plannedDeparture = null;
        let travelPeriodsRemaining = 0;
        if (present) {
            const plan = initial.plannedDeparture;
            if (plan && Number.isInteger(plan.dayOffset) && plan.dayOffset >= 0 && BOUNDARY_PHASES.has(plan.phase)) {
                plannedDeparture = boundary(ensureCalendar(world).dayNumber + plan.dayOffset, plan.phase);
            } else {
                plannedDeparture = defaultDepartureFromBoundary(character, world, boundary(ensureCalendar(world).dayNumber, "Morning"));
            }
        } else if (Number.isInteger(initial.travelPeriodsRemaining) && initial.travelPeriodsRemaining >= 0) {
            travelPeriodsRemaining = initial.travelPeriodsRemaining;
        }
        return {
            present: present,
            plannedDeparture: plannedDeparture,
            travelPeriodsRemaining: travelPeriodsRemaining,
            lifecycleRevision: AWAY_STATE_REVISION
        };
    }

    function ensureAwayState(character, world) {
        if (!awayable(character)) return null;
        if (!character.awayState || typeof character.awayState !== "object" || Array.isArray(character.awayState)) {
            character.awayState = initialAwayState(character, world);
        }
        return character.awayState;
    }

    function isCharacterPresent(characterOrId, world, dayNumber) {
        world = worldOrCurrent(world);
        if (!world) return false;
        const character = typeof characterOrId === "string" ? world.entities[characterOrId] : characterOrId;
        if (!character || character.type !== "character") return false;
        if (awayable(character)) {
            const state = ensureAwayState(character, world);
            return Boolean(state && state.present === true);
        }
        const weekly = fixedSchedule(character);
        if (!weekly) return true;
        return isFixedCharacterPresentOnDay(character, world, dayNumber);
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

    function arrivalSchedule(character) {
        const config = awayable(character);
        return config && Array.isArray(config.arrivalSchedule) ? config.arrivalSchedule : [];
    }

    function arrivalOpportunityAt(character, world, value) {
        if (!validBoundary(value)) return false;
        const day = weekdayName(world, value.dayNumber);
        return arrivalSchedule(character).some(function (entry) {
            return entry && entry.weekday === day && entry.phase === value.phase;
        });
    }

    function defaultDepartureFromBoundary(character, world, arrivalBoundary) {
        const config = awayable(character);
        const policy = config && config.defaultDeparture;
        if (!policy || policy.relativeToArrival !== "next_morning" || !validBoundary(arrivalBoundary)) return null;
        return boundary(arrivalBoundary.dayNumber + 1, "Morning");
    }

    function findNextArrivalOpportunity(character, world, afterBoundary, predicate) {
        if (!validBoundary(afterBoundary)) return null;
        const startOrdinal = boundaryOrdinal(afterBoundary) + 1;
        const maxOrdinal = startOrdinal + 28; // fourteen days; more than enough for a seven-day recurring authored schedule.
        for (let ordinal = startOrdinal; ordinal <= maxOrdinal; ordinal += 1) {
            const dayNumber = Math.floor(ordinal / 2);
            const phase = ordinal % 2 === 0 ? "Morning" : "Evening";
            const candidate = boundary(dayNumber, phase);
            if (!arrivalOpportunityAt(character, world, candidate)) continue;
            if (!predicate || predicate(candidate)) return candidate;
        }
        return null;
    }

    function departureReachability(character, world, departureBoundary) {
        const config = awayable(character);
        if (!config || !validBoundary(departureBoundary)) return null;
        const travelPeriods = Number(config.travelPeriods) || 0;
        const nextRegular = findNextArrivalOpportunity(character, world, departureBoundary);
        const nextEligible = findNextArrivalOpportunity(character, world, departureBoundary, function (candidate) {
            return boundaryOrdinal(candidate) - boundaryOrdinal(departureBoundary) >= travelPeriods;
        });
        const canMakeNext = Boolean(nextRegular && boundaryOrdinal(nextRegular) - boundaryOrdinal(departureBoundary) >= travelPeriods);
        return {
            departure: clone(departureBoundary),
            travelPeriods: travelPeriods,
            nextRegularArrival: nextRegular ? clone(nextRegular) : null,
            nextEligibleArrival: nextEligible ? clone(nextEligible) : null,
            canMakeNextRegularArrival: canMakeNext
        };
    }

    function scheduleSummary(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        if (!world || !character) return null;
        const config = awayable(character);
        if (config) {
            const state = ensureAwayState(character, world);
            const names = ensureCalendar(world).weekdayNames;
            const days = Array.from(new Set(arrivalSchedule(character).map(function (entry) { return entry.weekday; })))
                .sort(function (a, b) { return names.indexOf(a) - names.indexOf(b); });
            const result = {
                currentWeekday: weekdayName(world),
                currentDayNumber: ensureCalendar(world).dayNumber,
                present: Boolean(state && state.present),
                regularPresenceDays: days,
                arrivalSchedule: clone(arrivalSchedule(character)),
                roadTimePeriods: config.travelPeriods,
                plannedDeparture: state && state.present ? clone(state.plannedDeparture) : null,
                travelPeriodsRemaining: state && !state.present ? state.travelPeriodsRemaining : 0
            };
            if (state && state.present && validBoundary(state.plannedDeparture)) {
                const currentReachability = departureReachability(character, world, state.plannedDeparture);
                const deferredBoundary = nextBoundary(state.plannedDeparture);
                const deferredReachability = departureReachability(character, world, deferredBoundary);
                result.currentDepartureConsequence = currentReachability;
                result.onePeriodDelayConsequence = deferredReachability;
                const plannedText = `Current planned departure: ${formatBoundary(world, state.plannedDeparture)}. Road time after departure: ${config.travelPeriods} timelapse periods.`;
                const currentText = currentReachability && currentReachability.nextRegularArrival
                    ? (currentReachability.canMakeNextRegularArrival
                        ? ` Leaving then still allows your next regular ${formatBoundary(world, currentReachability.nextRegularArrival)} visit.`
                        : ` Leaving then is too late for the next regular ${formatBoundary(world, currentReachability.nextRegularArrival)} visit; the next reachable regular return is ${currentReachability.nextEligibleArrival ? formatBoundary(world, currentReachability.nextEligibleArrival) : "not currently known"}.`)
                    : "";
                const delayText = deferredReachability && deferredReachability.nextRegularArrival
                    ? (deferredReachability.canMakeNextRegularArrival
                        ? ` Delaying this departure by one period still allows ${formatBoundary(world, deferredReachability.nextRegularArrival)}.`
                        : ` Delaying this departure by one more period will miss ${formatBoundary(world, deferredReachability.nextRegularArrival)}; the following reachable regular return is ${deferredReachability.nextEligibleArrival ? formatBoundary(world, deferredReachability.nextEligibleArrival) : "not currently known"}.`)
                    : "";
                result.text = plannedText + currentText + delayText;
            } else if (state && !state.present) {
                const next = findNextArrivalOpportunity(character, world, ordinaryCurrentBoundary(world) || boundary(ensureCalendar(world).dayNumber, "Morning"), function () {
                    return state.travelPeriodsRemaining === 0;
                });
                result.nextRegularArrivalWhenEligible = next;
                result.text = `You are currently away from the local village. Road periods still required: ${state.travelPeriodsRemaining}. You return only on an authored regular arrival opportunity after the road requirement is complete.`;
            }
            return result;
        }

        const weekly = fixedSchedule(character);
        if (!weekly) return null;
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

    function awayableKnowledge(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        const config = character && awayable(character);
        if (!world || !character || !config) return null;
        const schedule = scheduleSummary(character, world);
        return {
            instructions: typeof config.aiDescription === "string" ? config.aiDescription : "",
            present: schedule && schedule.present,
            plannedDeparture: schedule && schedule.plannedDeparture || null,
            travelPeriodsRemaining: schedule && schedule.travelPeriodsRemaining || 0,
            roadTimePeriods: config.travelPeriods,
            currentDepartureConsequence: schedule && schedule.currentDepartureConsequence || null,
            onePeriodDelayConsequence: schedule && schedule.onePeriodDelayConsequence || null,
            scheduleText: schedule && schedule.text || ""
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

    function arrivalPlacement(character) {
        const config = awayable(character);
        if (config) return { locationId: config.arrivalLocationId, sublocationId: config.arrivalSublocationId };
        const weekly = fixedSchedule(character);
        return weekly ? { locationId: weekly.arrivalLocationId, sublocationId: weekly.arrivalSublocationId } : null;
    }

    function placeArrival(character, world, useInitialPlacement) {
        const config = awayable(character);
        const weekly = fixedSchedule(character);
        let locationId;
        let sublocationId;
        if (config) {
            locationId = config.arrivalLocationId;
            sublocationId = config.arrivalSublocationId;
        } else if (weekly) {
            locationId = useInitialPlacement === true && weekly.initialLocationId ? weekly.initialLocationId : weekly.arrivalLocationId;
            sublocationId = useInitialPlacement === true && weekly.initialSublocationId ? weekly.initialSublocationId : weekly.arrivalSublocationId;
        } else {
            return ok({ characterId: character.id, moved: false });
        }
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
        const initialized = [];
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character") return;
            if (awayable(entity)) {
                entity.awayState = initialAwayState(entity, world);
                initialized.push({ characterId: entity.id, awayState: clone(entity.awayState), bootstrap: true });
                return;
            }
            if (!fixedSchedule(entity) || !isCharacterPresent(entity, world)) return;
            const placement = placeArrival(entity, world, true);
            if (!placement.ok) throw new Error(placement.error.message);
            const restock = restockCharacter(entity, world);
            if (!restock.ok) throw new Error(restock.error.message);
            initialized.push({ characterId: entity.id, placement: clone(placement), restock: clone(restock), bootstrap: true });
        });
        return ok({ weekday: weekdayName(world), dayNumber: ensureCalendar(world).dayNumber, initialized: initialized });
    }

    function canDeferDeparture(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        if (!world || !character || !awayable(character)) return false;
        const state = ensureAwayState(character, world);
        if (!state || state.present !== true || !validBoundary(state.plannedDeparture)) return false;
        const imminent = nextTimelapseBoundary(world);
        return Boolean(imminent && compareBoundaries(state.plannedDeparture, imminent) === 0);
    }

    function deferOptions(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        if (!canDeferDeparture(character, world)) return {};
        const state = ensureAwayState(character, world);
        const deferred = nextBoundary(state.plannedDeparture);
        return {
            current_planned_departure: clone(state.plannedDeparture),
            deferred_planned_departure: clone(deferred),
            current_planned_departure_text: formatBoundary(world, state.plannedDeparture),
            deferred_planned_departure_text: formatBoundary(world, deferred)
        };
    }

    function deferDeparture(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = typeof characterOrId === "string" ? world && world.entities[characterOrId] : characterOrId;
        if (!world || !character || !awayable(character)) return fail("DEPARTURE_DEFER_UNAVAILABLE", "This character does not have an awayable departure to defer.");
        if (!canDeferDeparture(character, world)) return fail("DEPARTURE_DEFER_NOT_IMMINENT", "Departure can only be deferred when it is the boundary reached by the next timelapse.");
        const state = ensureAwayState(character, world);
        const previous = clone(state.plannedDeparture);
        state.plannedDeparture = nextBoundary(state.plannedDeparture);
        return ok({
            characterId: character.id,
            previousPlannedDeparture: previous,
            plannedDeparture: clone(state.plannedDeparture),
            text: `You have privately delayed your planned departure from ${formatBoundary(world, previous)} to ${formatBoundary(world, state.plannedDeparture)}.`
        });
    }

    function departAwayable(character, world, targetBoundary) {
        const config = awayable(character);
        const state = ensureAwayState(character, world);
        if (!config || !state || state.present !== true) return fail("AWAYABLE_DEPARTURE_INVALID", `Awayable departure state for ${character && character.name || "character"} is invalid.`);
        const settlement = settleDeparture(character, world);
        if (!settlement.ok) return settlement;
        state.present = false;
        state.plannedDeparture = null;
        state.travelPeriodsRemaining = config.travelPeriods;
        state.lifecycleRevision = AWAY_STATE_REVISION;
        character.sleeping = false;
        return ok({
            type: "departure",
            characterId: character.id,
            boundary: clone(targetBoundary),
            travelPeriodsRemaining: state.travelPeriodsRemaining,
            settlement: clone(settlement)
        });
    }

    function arriveAwayable(character, world, targetBoundary, options) {
        const state = ensureAwayState(character, world);
        if (!state || state.present === true) return fail("AWAYABLE_ARRIVAL_INVALID", `Awayable arrival state for ${character && character.name || "character"} is invalid.`);
        const placement = placeArrival(character, world);
        if (!placement.ok) return placement;
        state.present = true;
        state.travelPeriodsRemaining = 0;
        state.plannedDeparture = defaultDepartureFromBoundary(character, world, targetBoundary);
        state.lifecycleRevision = AWAY_STATE_REVISION;
        const hooks = runArrivalHooks(character, world, options);
        if (!hooks.ok) return hooks;
        return ok({
            type: "arrival",
            characterId: character.id,
            boundary: clone(targetBoundary),
            placement: clone(placement),
            plannedDeparture: clone(state.plannedDeparture),
            hooks: clone(hooks.hooks || [])
        });
    }

    function advanceAwayTravelForCompletedPeriod(characters) {
        const updates = [];
        characters.forEach(function (character) {
            const state = character.awayState;
            if (!state || state.present === true || !Number.isInteger(state.travelPeriodsRemaining) || state.travelPeriodsRemaining <= 0) return;
            state.travelPeriodsRemaining -= 1;
            updates.push({ characterId: character.id, travelPeriodsRemaining: state.travelPeriodsRemaining });
        });
        return updates;
    }

    function advanceCoarseBoundary(world, targetBoundary, options) {
        world = worldOrCurrent(world);
        options = options && typeof options === "object" ? options : {};
        if (!world) return fail("WORLD_MISSING", "World state is unavailable.");
        ensureCalendar(world);
        if (!validBoundary(targetBoundary)) return fail("COARSE_BOUNDARY_INVALID", "Target coarse-time boundary is invalid.");
        const currentDayNumber = world.calendar.dayNumber;
        if (targetBoundary.dayNumber < currentDayNumber || targetBoundary.dayNumber > currentDayNumber + 1 ||
                (targetBoundary.dayNumber === currentDayNumber + 1 && targetBoundary.phase !== "Morning")) {
            return fail("COARSE_BOUNDARY_INVALID", "Target coarse-time boundary is not the next canonical boundary.");
        }
        const snapshot = clone(world);
        const transitions = [];
        try {
            const awayableCharacters = Object.values(world.entities || {}).filter(function (entity) {
                return entity && entity.type === "character" && awayable(entity);
            });
            awayableCharacters.forEach(function (character) { ensureAwayState(character, world); });

            // Only characters already away for the period that just completed receive travel credit.
            const awayAtPeriodStart = awayableCharacters.filter(function (character) {
                return character.awayState && character.awayState.present === false;
            });
            const travelUpdates = advanceAwayTravelForCompletedPeriod(awayAtPeriodStart);

            // Preserve simple legacy fixed-weekly presence behavior at Morning day boundaries.
            const fixedCharacters = Object.values(world.entities || {}).filter(function (entity) {
                return entity && entity.type === "character" && !awayable(entity) && fixedSchedule(entity);
            });
            if (targetBoundary.phase === "Morning" && targetBoundary.dayNumber === currentDayNumber + 1) {
                fixedCharacters.forEach(function (character) {
                    const wasPresent = isFixedCharacterPresentOnDay(character, world, currentDayNumber);
                    const willBePresent = isFixedCharacterPresentOnDay(character, world, targetBoundary.dayNumber);
                    if (wasPresent && !willBePresent) {
                        const settlement = settleDeparture(character, world);
                        if (!settlement.ok) throw new Error(settlement.error.message);
                        transitions.push({ type: "departure", characterId: character.id, settlement: clone(settlement), legacyFixedWeekly: true });
                    }
                });
            }

            world.calendar.dayNumber = targetBoundary.dayNumber;

            awayableCharacters.forEach(function (character) {
                const state = ensureAwayState(character, world);
                if (state.present === true && validBoundary(state.plannedDeparture) && compareBoundaries(state.plannedDeparture, targetBoundary) === 0) {
                    const departure = departAwayable(character, world, targetBoundary);
                    if (!departure.ok) throw new Error(departure.error.message);
                    transitions.push(clone(departure));
                }
            });

            awayableCharacters.forEach(function (character) {
                const state = ensureAwayState(character, world);
                if (state.present === false && arrivalOpportunityAt(character, world, targetBoundary) && state.travelPeriodsRemaining === 0) {
                    const arrival = arriveAwayable(character, world, targetBoundary, options);
                    if (!arrival.ok) throw new Error(arrival.error.message);
                    transitions.push(clone(arrival));
                }
            });

            if (targetBoundary.phase === "Morning" && targetBoundary.dayNumber === currentDayNumber + 1) {
                fixedCharacters.forEach(function (character) {
                    const wasPresent = isFixedCharacterPresentOnDay(character, world, currentDayNumber);
                    const isPresent = isFixedCharacterPresentOnDay(character, world, targetBoundary.dayNumber);
                    if (!wasPresent && isPresent) {
                        const placement = placeArrival(character, world);
                        if (!placement.ok) throw new Error(placement.error.message);
                        const restock = restockCharacter(character, world, options);
                        if (!restock.ok) throw new Error(restock.error.message);
                        transitions.push({ type: "arrival", characterId: character.id, placement: clone(placement), restock: clone(restock), legacyFixedWeekly: true });
                    }
                });
            }

            if (setup.GameInternals && typeof setup.GameInternals.repairAIQueue === "function") setup.GameInternals.repairAIQueue(world);
            return ok({
                dayNumber: world.calendar.dayNumber,
                weekday: weekdayName(world),
                boundary: clone(targetBoundary),
                travelUpdates: travelUpdates,
                transitions: transitions
            });
        } catch (error) {
            Object.keys(world).forEach(function (key) { delete world[key]; });
            Object.assign(world, snapshot);
            return fail("COARSE_BOUNDARY_FAILED", error && error.message || "Coarse-time boundary processing failed.");
        }
    }

    function advanceEveningBoundary(world, options) {
        world = worldOrCurrent(world);
        if (!world) return fail("WORLD_MISSING", "World state is unavailable.");
        return advanceCoarseBoundary(world, boundary(ensureCalendar(world).dayNumber, "Evening"), options);
    }

    function advanceDayBoundary(world, options) {
        world = worldOrCurrent(world);
        if (!world) return fail("WORLD_MISSING", "World state is unavailable.");
        return advanceCoarseBoundary(world, boundary(ensureCalendar(world).dayNumber + 1, "Morning"), options);
    }

    function sourceLegacyPresence(savedCharacter, savedWorld) {
        const weekly = savedCharacter && fixedSchedule(savedCharacter);
        if (!weekly) return null;
        const calendar = savedWorld && savedWorld.calendar;
        const dayNumber = calendar && Number.isInteger(calendar.dayNumber) && calendar.dayNumber >= 0 ? calendar.dayNumber : 0;
        const initialWeekdayIndex = calendar && Number.isInteger(calendar.initialWeekdayIndex) ? calendar.initialWeekdayIndex : 0;
        const index = (initialWeekdayIndex + dayNumber) % 7;
        return Array.isArray(weekly.presentWeekdayIndexes) && weekly.presentWeekdayIndexes.includes(index);
    }

    function migrationPresentDeparture(character, world) {
        const currentDay = ensureCalendar(world).dayNumber;
        const config = awayable(character);
        if (config && config.defaultDeparture && config.defaultDeparture.relativeToArrival === "next_morning") {
            return boundary(currentDay + 1, "Morning");
        }
        return null;
    }

    function initializeMigratedAwayState(character, savedCharacter, savedWorld, world) {
        world = worldOrCurrent(world);
        if (!world || !character || !awayable(character)) return ok({ characterId: character && character.id || null, changed: false });
        const savedState = savedCharacter && savedCharacter.awayState;
        if (savedState && typeof savedState === "object" && !Array.isArray(savedState) && typeof savedState.present === "boolean") {
            if (savedState.present) {
                const currentFloor = boundary(ensureCalendar(world).dayNumber, "Morning");
                const savedPlanUsable = validBoundary(savedState.plannedDeparture) && compareBoundaries(savedState.plannedDeparture, currentFloor) >= 0;
                character.awayState = {
                    present: true,
                    plannedDeparture: savedPlanUsable ? clone(savedState.plannedDeparture) : migrationPresentDeparture(character, world),
                    travelPeriodsRemaining: 0,
                    lifecycleRevision: AWAY_STATE_REVISION
                };
            } else {
                character.awayState = {
                    present: false,
                    plannedDeparture: null,
                    travelPeriodsRemaining: Number.isInteger(savedState.travelPeriodsRemaining) && savedState.travelPeriodsRemaining >= 0 ? savedState.travelPeriodsRemaining : 0,
                    lifecycleRevision: AWAY_STATE_REVISION
                };
            }
            return ok({ characterId: character.id, changed: true, preserved: true, awayState: clone(character.awayState) });
        }

        const legacyPresence = sourceLegacyPresence(savedCharacter, savedWorld);
        const present = legacyPresence === null ? true : legacyPresence;
        character.awayState = present ? {
            present: true,
            plannedDeparture: migrationPresentDeparture(character, world),
            travelPeriodsRemaining: 0,
            lifecycleRevision: AWAY_STATE_REVISION
        } : {
            present: false,
            plannedDeparture: null,
            travelPeriodsRemaining: 0,
            lifecycleRevision: AWAY_STATE_REVISION
        };
        return ok({ characterId: character.id, changed: true, preserved: false, legacyPresence: legacyPresence, awayState: clone(character.awayState) });
    }

    function validateAwayState(character, world) {
        const config = awayable(character);
        const state = character && character.awayState;
        if (!config) {
            if (state !== undefined) return fail("AWAY_STATE_WITHOUT_AUTHORING", `Character ${character.id} has awayState but is not authored as awayable.`);
            return ok();
        }
        if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.present !== "boolean" ||
                !Number.isInteger(state.travelPeriodsRemaining) || state.travelPeriodsRemaining < 0 ||
                !Number.isInteger(state.lifecycleRevision) || state.lifecycleRevision < 1) {
            return fail("AWAY_STATE_INVALID", `Character ${character.id} has invalid awayable lifecycle state.`);
        }
        if (state.present) {
            if (!validBoundary(state.plannedDeparture) || state.travelPeriodsRemaining !== 0) {
                return fail("AWAY_STATE_INVALID", `Present awayable character ${character.id} must have a valid planned departure and no remaining travel.`);
            }
            if (boundaryOrdinal(state.plannedDeparture) < ensureCalendar(world).dayNumber * 2) {
                return fail("AWAY_STATE_INVALID", `Character ${character.id} has a stale planned departure boundary.`);
            }
        } else if (state.plannedDeparture !== null) {
            return fail("AWAY_STATE_INVALID", `Away character ${character.id} cannot retain an active planned departure.`);
        }
        return ok();
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

    setup.WeeklyRhythm = {
        AWAY_STATE_REVISION: AWAY_STATE_REVISION,
        ensureCalendar: ensureCalendar,
        currentWeekdayIndex: function (world) { return weekdayIndex(worldOrCurrent(world)); },
        currentWeekdayName: function (world) { return weekdayName(worldOrCurrent(world)); },
        isCharacterPresent: isCharacterPresent,
        isLocationAvailable: isLocationAvailable,
        isSublocationAvailable: isSublocationAvailable,
        scheduleSummary: scheduleSummary,
        tradeKnowledge: tradeKnowledge,
        awayableKnowledge: awayableKnowledge,
        initializeFreshWorld: initializeFreshWorld,
        advanceCoarseBoundary: advanceCoarseBoundary,
        advanceEveningBoundary: advanceEveningBoundary,
        advanceDayBoundary: advanceDayBoundary,
        canDeferDeparture: canDeferDeparture,
        deferOptions: deferOptions,
        deferDeparture: deferDeparture,
        validateAwayState: validateAwayState,
        initializeMigratedAwayState: initializeMigratedAwayState,
        runArrivalHooks: runArrivalHooks,
        restockCharacter: restockCharacter,
        settleDeparture: settleDeparture,
        noteItemTransfer: noteItemTransfer,
        formatBoundary: formatBoundary,
        nextBoundary: nextBoundary,
        departureReachability: departureReachability
    };
}());
