(function () {
    "use strict";

    const WORLD_VERSION = 6;
    const CONTROLLER_IDS = new Set(["human", "dummy", "ai"]);
    const BASE_ACTION_TYPES = ["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money"];

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function ok(extra) {
        return Object.assign({ ok: true }, extra || {});
    }

    function fail(code, message, extra) {
        return Object.assign({
            ok: false,
            error: { code: code, message: message }
        }, extra || {});
    }

    function installGeneratedData(world) {
        const document = setup.GeneratedWorldData;
        if (!document || document.schemaVersion !== 2 || !document.locations || !document.characters ||
                !document.abilities || !document.itemDefinitions || !document.items) {
            throw new Error("Generated world data is missing or uses an unsupported schema version.");
        }

        world.startLocationId = document.startLocationId;
        world.abilities = clone(document.abilities);
        world.itemDefinitions = clone(document.itemDefinitions);

        for (const [locationId, sourceLocation] of Object.entries(document.locations)) {
            const location = clone(sourceLocation);
            const sublocations = location.sublocations || {};
            delete location.sublocations;
            location.id = locationId;
            location.type = "location";
            world.entities[locationId] = location;
            if (world.inventories[location.inventoryId]) {
                throw new Error(`Duplicate inventory ID ${location.inventoryId}.`);
            }
            world.inventories[location.inventoryId] = {
                id: location.inventoryId,
                ownerId: locationId,
                itemIds: []
            };

            for (const [sublocationId, sourceSublocation] of Object.entries(sublocations)) {
                const sublocation = clone(sourceSublocation);
                sublocation.id = sublocationId;
                sublocation.type = "sublocation";
                sublocation.locationId = locationId;
                world.entities[sublocationId] = sublocation;
                if (sublocation.inventoryId) {
                    if (world.inventories[sublocation.inventoryId]) {
                        throw new Error(`Duplicate inventory ID ${sublocation.inventoryId}.`);
                    }
                    world.inventories[sublocation.inventoryId] = {
                        id: sublocation.inventoryId,
                        ownerId: sublocationId,
                        itemIds: []
                    };
                }
            }
        }

        for (const [characterId, sourceCharacter] of Object.entries(document.characters)) {
            const character = clone(sourceCharacter);
            character.id = characterId;
            character.type = "character";
            character.mind = clone(character.initialMind || {});
            delete character.initialMind;
            character.mind.pendingObservations = [];
            world.entities[characterId] = character;
            if (world.inventories[character.inventoryId]) {
                throw new Error(`Duplicate inventory ID ${character.inventoryId}.`);
            }
            world.inventories[character.inventoryId] = {
                id: character.inventoryId,
                ownerId: characterId,
                itemIds: []
            };
            world.control.assignments[characterId] = character.initialControllerId;
            delete character.initialControllerId;
        }

        for (const [itemId, sourceItem] of Object.entries(document.items)) {
            const item = clone(sourceItem);
            item.id = itemId;
            item.type = "item";
            if (!world.itemDefinitions[item.definitionId]) {
                throw new Error(`Item ${itemId} references missing definition ${item.definitionId}.`);
            }
            const inventory = world.inventories[item.containerId];
            if (!inventory) {
                throw new Error(`Item ${itemId} references missing inventory ${item.containerId}.`);
            }
            if (world.entities[itemId]) {
                throw new Error(`Duplicate entity ID ${itemId}.`);
            }
            world.entities[itemId] = item;
            inventory.itemIds.push(itemId);
        }
    }

    function createInitialWorld() {
        const world = {
            version: WORLD_VERSION,
            entities: {},
            itemDefinitions: {},
            inventories: {},
            control: { assignments: {} },
            events: [],
            nextEventId: 1,
            nextObservationId: 1,
            nextMemoryId: 1,
            nextGeneratedItemId: 1,
            nextIntentId: 1,
            ai: { turnQueue: [] },
            debug: {
                lastActionResult: null,
                controllerLog: [],
                repairs: []
            }
        };
        installGeneratedData(world);
        const validation = validateWorld(world);
        if (!validation.ok) {
            throw new Error(validation.error.message);
        }
        return world;
    }

    function getWorld() {
        return State.variables.world;
    }

    function getCharacters(world) {
        return Object.values(world.entities).filter(function (entity) {
            return entity.type === "character";
        });
    }

    function getCharacter(characterId, world) {
        const entity = world.entities[characterId];
        return entity && entity.type === "character" ? entity : null;
    }

    function isAIQueueEligible(characterId, world) {
        const character = getCharacter(characterId, world);
        return Boolean(character && world.control.assignments[characterId] === "ai" &&
            character.mind && character.mind.pendingObservations.length > 0);
    }

    function enqueueAITurn(characterId, reason, world) {
        world = world || ensureWorld();
        repairAIQueue(world);
        if (!isAIQueueEligible(characterId, world)) return fail("AI_NOT_ELIGIBLE", "Character is not eligible for an AI turn.");
        if (!world.ai.turnQueue.some(function (entry) { return entry.characterId === characterId; })) {
            world.ai.turnQueue.push({ characterId: characterId, reason: reason || "observation" });
        }
        return ok({ characterId: characterId });
    }

    function hasDirectPendingObservation(characterId, world) {
        const character = getCharacter(characterId, world);
        if (!character || !character.mind || !Array.isArray(character.mind.pendingObservations)) return false;
        return character.mind.pendingObservations.some(function (observation) {
            const targetId = observation.targetId || observation.data && observation.data.targetId || null;
            return targetId === characterId;
        });
    }

    function repairAIQueue(world) {
        if (!world.ai || !Array.isArray(world.ai.turnQueue)) world.ai = { turnQueue: [] };
        const seen = new Set();
        world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) {
            const characterId = typeof entry === "string" ? entry : entry && entry.characterId;
            if (!characterId || seen.has(characterId) || !isAIQueueEligible(characterId, world)) return false;
            seen.add(characterId);
            if (typeof entry === "string") return true;
            entry.characterId = characterId;
            entry.reason = typeof entry.reason === "string" ? entry.reason : "observation";
            return true;
        }).map(function (entry, index) {
            const normalized = typeof entry === "string" ? { characterId: entry, reason: "repaired" } : entry;
            return { entry: normalized, index: index, direct: hasDirectPendingObservation(normalized.characterId, world) };
        }).sort(function (left, right) {
            if (left.direct !== right.direct) return left.direct ? -1 : 1;
            return left.index - right.index;
        }).map(function (record) { return record.entry; });
        return world.ai.turnQueue;
    }

    function getAIQueueStatus(world) {
        world = world || ensureWorld();
        repairAIQueue(world);
        const head = world.ai.turnQueue[0] || null;
        const character = head ? getCharacter(head.characterId, world) : null;
        return clone({ count: world.ai.turnQueue.length, head: head ? {
            characterId: head.characterId, name: character.name, reason: head.reason
        } : null, entries: world.ai.turnQueue });
    }

    function getLocation(locationId, world) {
        const entity = world.entities[locationId];
        return entity && entity.type === "location" ? entity : null;
    }

    function getSublocation(sublocationId, world) {
        const entity = world.entities[sublocationId];
        return entity && entity.type === "sublocation" ? entity : null;
    }

    function getSublocations(locationId, world) {
        return Object.values(world.entities).filter(function (entity) {
            return entity.type === "sublocation" && entity.locationId === locationId;
        });
    }

    function getItemDefinition(definitionId, world) {
        return world.itemDefinitions && world.itemDefinitions[definitionId] || null;
    }

    function getItem(itemId, world) {
        const entity = world.entities[itemId];
        return entity && entity.type === "item" ? entity : null;
    }

    function itemName(item, world) {
        const definition = item && getItemDefinition(item.definitionId, world);
        return definition && definition.name || item && item.name || item && item.id || "Unknown item";
    }

    function itemView(item, world) {
        if (!item) return null;
        const definition = getItemDefinition(item.definitionId, world) || {};
        return {
            id: item.id,
            name: itemName(item, world),
            definition_id: item.definitionId,
            family_id: definition.familyId || "",
            tags: clone(definition.tags || []),
            consumable: Boolean(definition.consumable),
            equippable: Boolean(definition.equippable),
            fillable: Boolean(definition.fillable)
        };
    }

    function renderItemText(template, actor, item, resultDefinition, world) {
        const sourceName = itemName(item, world);
        const resultName = resultDefinition && resultDefinition.name || sourceName;
        return String(template || "")
            .replaceAll("{actor}", actor.name)
            .replaceAll("{item}", sourceName)
            .replaceAll("{result}", resultName);
    }

    function sublocationOccupants(sublocationId, world, excludedCharacterId) {
        return getCharacters(world).filter(function (character) {
            return character.id !== excludedCharacterId && character.sublocationId === sublocationId;
        });
    }

    function accessibleInventories(actor, world) {
        const location = getLocation(actor.locationId, world);
        const sublocation = getSublocation(actor.sublocationId, world);
        const inventoryIds = [location.inventoryId];
        if (sublocation.inventoryId) {
            inventoryIds.push(sublocation.inventoryId);
        }
        return inventoryIds.map(function (inventoryId) {
            return world.inventories[inventoryId];
        }).filter(Boolean);
    }

    function canReachCharacter(actor, target, world) {
        if (!actor || !target || actor.locationId !== target.locationId) {
            return false;
        }
        const actorPosition = getSublocation(actor.sublocationId, world);
        return Boolean(actorPosition &&
            (actor.sublocationId === target.sublocationId ||
                (actorPosition.reachableSublocationIds || []).includes(target.sublocationId)));
    }

    function positionText(character, world) {
        const sublocation = getSublocation(character.sublocationId, world);
        return (sublocation.occupantTemplate || "{name} is here.")
            .replace("{name}", character.name);
    }

    function pushDebugLog(world, entry) {
        world.debug.controllerLog.push(Object.assign({
            sequence: world.debug.controllerLog.length + 1
        }, entry));

        if (world.debug.controllerLog.length > 200) {
            world.debug.controllerLog = world.debug.controllerLog.slice(-200);
        }
    }

    function validateControlAssignments(assignments, world) {
        const characters = getCharacters(world);
        const humanIds = [];

        for (const character of characters) {
            const controllerId = assignments[character.id];

            if (!CONTROLLER_IDS.has(controllerId)) {
                return fail(
                    "UNKNOWN_CONTROLLER",
                    `Character ${character.id} has unknown controller ${String(controllerId)}.`
                );
            }

            if (controllerId === "human") {
                humanIds.push(character.id);
            }
        }

        if (humanIds.length !== 1) {
            return fail(
                "HUMAN_CONTROLLER_INVARIANT",
                `Exactly one character must use HumanController; found ${humanIds.length}.`,
                { humanCharacterIds: humanIds }
            );
        }

        return ok({ humanCharacterId: humanIds[0] });
    }

    function repairControlInvariant(world, reason) {
        const assignments = {};
        const characters = getCharacters(world);
        const previous = world.control && world.control.assignments
            ? world.control.assignments
            : {};

        let chosenHumanId = null;
        const previousHumans = characters.filter(function (character) {
            return previous[character.id] === "human";
        });

        if (previousHumans.length === 1) {
            chosenHumanId = previousHumans[0].id;
        } else if (getCharacter("player", world)) {
            chosenHumanId = "player";
        } else if (characters.length > 0) {
            chosenHumanId = characters[0].id;
        }

        for (const character of characters) {
            const requested = previous[character.id];
            const fallback = character.defaultControllerId || "dummy";
            assignments[character.id] = CONTROLLER_IDS.has(requested)
                ? requested
                : fallback;

            if (assignments[character.id] === "human") {
                assignments[character.id] = fallback;
            }
        }

        if (chosenHumanId) {
            assignments[chosenHumanId] = "human";
        }

        world.control = { assignments: assignments };
        world.debug.repairs.push({
            type: "control_invariant_repair",
            reason: reason || "unspecified",
            chosenHumanId: chosenHumanId
        });

        return validateControlAssignments(assignments, world);
    }

    function validateItemInvariants(world) {
        if (!world.itemDefinitions || typeof world.itemDefinitions !== "object") {
            return fail("ITEM_DEFINITIONS_MISSING", "World item definitions are missing.");
        }

        for (const [definitionId, definition] of Object.entries(world.itemDefinitions)) {
            if (!definition || definition.id !== definitionId || typeof definition.name !== "string" || !definition.name.trim()) {
                return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} is invalid.`);
            }
            if (!Array.isArray(definition.tags)) {
                return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} tags must be an array.`);
            }
            if (definition.consumable) {
                if (!["destroy", "transform"].includes(definition.consumable.resultType)) {
                    return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} has an invalid consumable result.`);
                }
                if (definition.consumable.resultType === "transform" &&
                        !getItemDefinition(definition.consumable.resultDefinitionId, world)) {
                    return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} has a missing consume result definition.`);
                }
            }
            if (definition.fillable && !getItemDefinition(definition.fillable.resultDefinitionId, world)) {
                return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} has a missing fill result definition.`);
            }
        }

        const itemMembership = {};
        for (const inventory of Object.values(world.inventories)) {
            if (!Array.isArray(inventory.itemIds)) {
                return fail("INVENTORY_ITEMS_INVALID", `Inventory ${inventory.id} has invalid item membership.`);
            }
            for (const itemId of inventory.itemIds) {
                const item = getItem(itemId, world);
                if (!item) {
                    return fail("INVENTORY_ITEM_INVALID", `Inventory ${inventory.id} contains invalid item ${itemId}.`);
                }
                if (!getItemDefinition(item.definitionId, world)) {
                    return fail("ITEM_DEFINITION_MISSING", `Item ${itemId} references missing definition ${item.definitionId}.`);
                }
                if (itemMembership[itemId]) {
                    return fail("ITEM_IN_MULTIPLE_INVENTORIES", `Item ${itemId} appears in more than one inventory.`);
                }
                itemMembership[itemId] = inventory.id;
            }
        }

        for (const entity of Object.values(world.entities)) {
            if (entity.type !== "item") continue;
            if (itemMembership[entity.id] !== entity.containerId) {
                return fail("ITEM_CONTAINER_MISMATCH", `Item ${entity.id} containerId does not match inventory membership.`);
            }
        }
        return ok();
    }

    function validateSpatialInvariants(world) {
        const entityIds = new Set();
        for (const [key, entity] of Object.entries(world.entities)) {
            if (!entity.id || entity.id !== key || entityIds.has(entity.id)) {
                return fail("ENTITY_ID_INVALID", `Entity key ${key} does not have a unique matching ID.`);
            }
            entityIds.add(entity.id);
        }
        const locations = Object.values(world.entities).filter(function (entity) {
            return entity.type === "location";
        });
        const sublocations = Object.values(world.entities).filter(function (entity) {
            return entity.type === "sublocation";
        });

        const passageNames = new Set();
        const inventoryOwners = new Map();
        for (const location of locations) {
            if (typeof location.passage !== "string" || !location.passage.trim() || passageNames.has(location.passage)) {
                return fail("LOCATION_PASSAGE_INVALID", `Location ${location.id} has a missing or duplicate passage name.`);
            }
            passageNames.add(location.passage);
        }
        if (!getLocation(world.startLocationId, world)) {
            return fail("START_LOCATION_INVALID", "The configured start location is invalid.");
        }
        for (const inventory of Object.values(world.inventories)) {
            if (inventoryOwners.has(inventory.id)) {
                return fail("DUPLICATE_INVENTORY_ID", `Inventory ${inventory.id} is owned by both ${inventoryOwners.get(inventory.id)} and ${inventory.ownerId}.`);
            }
            inventoryOwners.set(inventory.id, inventory.ownerId);
        }

        for (const location of locations) {
            const defaultPosition = getSublocation(location.defaultSublocationId, world);
            if (!defaultPosition || defaultPosition.locationId !== location.id) {
                return fail("INVALID_DEFAULT_SUBLOCATION", `Location ${location.id} has an invalid default sublocation.`);
            }
            if (!world.inventories[location.inventoryId] ||
                    world.inventories[location.inventoryId].ownerId !== location.id) {
                return fail("LOCATION_INVENTORY_INVALID", `Location ${location.id} has an invalid inventory.`);
            }
        }

        for (const sublocation of sublocations) {
            if (!getLocation(sublocation.locationId, world)) {
                return fail("INVALID_SUBLOCATION_PARENT", `Sublocation ${sublocation.id} has an invalid parent location.`);
            }
            if (!Number.isInteger(sublocation.capacity) || sublocation.capacity < 1) {
                return fail("INVALID_SUBLOCATION_CAPACITY", `Sublocation ${sublocation.id} has invalid capacity.`);
            }
            if (sublocation.inventoryId && (!world.inventories[sublocation.inventoryId] ||
                    world.inventories[sublocation.inventoryId].ownerId !== sublocation.id)) {
                return fail("SUBLOCATION_INVENTORY_MISSING", `Sublocation ${sublocation.id} has no valid inventory.`);
            }
            for (const reachableId of sublocation.reachableSublocationIds || []) {
                const reachable = getSublocation(reachableId, world);
                if (!reachable || reachable.locationId !== sublocation.locationId) {
                    return fail("INVALID_REACHABLE_SUBLOCATION", `Sublocation ${sublocation.id} has an invalid reachability reference.`);
                }
            }
            if (sublocationOccupants(sublocation.id, world).length > sublocation.capacity) {
                return fail("SUBLOCATION_CAPACITY_EXCEEDED", `Sublocation ${sublocation.id} exceeds capacity.`);
            }
        }

        for (const character of getCharacters(world)) {
            const location = getLocation(character.locationId, world);
            const sublocation = getSublocation(character.sublocationId, world);
            if (!location) {
                return fail("CHARACTER_LOCATION_INVALID", `Character ${character.id} has an invalid location.`);
            }
            if (!sublocation || sublocation.locationId !== location.id) {
                return fail("CHARACTER_SUBLOCATION_INVALID", `Character ${character.id} has an invalid sublocation.`);
            }
            if (!world.inventories[character.inventoryId] ||
                    world.inventories[character.inventoryId].ownerId !== character.id) {
                return fail("CHARACTER_INVENTORY_MISSING", `Character ${character.id} has no valid inventory.`);
            }
            if (!Number.isInteger(character.wallet) || character.wallet < 0) {
                return fail("CHARACTER_WALLET_INVALID", `Character ${character.id} has an invalid wallet.`);
            }
            if (!CONTROLLER_IDS.has(character.defaultControllerId) || character.defaultControllerId === "human") {
                return fail("DEFAULT_CONTROLLER_INVALID", `Character ${character.id} has an invalid default controller.`);
            }
            if (!character.mind || !Array.isArray(character.mind.pendingObservations)) {
                return fail("CHARACTER_MIND_INVALID", `Character ${character.id} has an invalid mind.`);
            }
            for (const partition of ["knownFacts", "beliefs", "relationships", "recentMemories", "longTermMemories"]) {
                if (!Array.isArray(character.mind[partition])) {
                    return fail("CHARACTER_MIND_INVALID", `Character ${character.id} mind.${partition} must be an array.`);
                }
            }
            for (const abilityId of character.abilityIds || []) {
                if (!world.abilities[abilityId]) {
                    return fail("ABILITY_REFERENCE_INVALID", `Character ${character.id} references missing ability ${abilityId}.`);
                }
            }
        }

        for (const [abilityId, ability] of Object.entries(world.abilities || {})) {
            if (!ability || ability.id !== abilityId || !ActionRegistry[ability.actionType]) {
                return fail("ABILITY_DEFINITION_INVALID", `Ability ${abilityId} has an invalid registered action type.`);
            }
        }

        return ok();
    }

    function validateWorld(world) {
        if (!world || typeof world !== "object") {
            return fail("WORLD_MISSING", "World state does not exist.");
        }

        const controlResult = validateControlAssignments(
            world.control && world.control.assignments
                ? world.control.assignments
                : {},
            world
        );

        if (!controlResult.ok) {
            return controlResult;
        }

        const spatialResult = validateSpatialInvariants(world);
        return spatialResult.ok ? validateItemInvariants(world) : spatialResult;
    }

    function ensureWorld() {
        const current = State.variables.world;

        if (!current || current.version !== WORLD_VERSION) {
            State.variables.world = createInitialWorld();
        }

        const world = getWorld();

        if (!world.debug) {
            world.debug = {
                lastActionResult: null,
                controllerLog: [],
                repairs: []
            };
        }

        if (!world.control || !world.control.assignments) {
            repairControlInvariant(world, "missing control state");
        } else {
            const controlResult = validateControlAssignments(
                world.control.assignments,
                world
            );

            if (!controlResult.ok) {
                repairControlInvariant(world, controlResult.error.message);
            }
        }

        if (!Number.isInteger(world.nextIntentId) || world.nextIntentId < 1) {
            world.nextIntentId = 1;
        }

        repairAIQueue(world);

        return world;
    }

    function getHumanCharacterId(world) {
        const result = validateControlAssignments(
            world.control.assignments,
            world
        );

        if (!result.ok) {
            const repaired = repairControlInvariant(world, result.error.message);
            if (!repaired.ok) {
                throw new Error(repaired.error.message);
            }
            return repaired.humanCharacterId;
        }

        return result.humanCharacterId;
    }

    function takeHumanControl(characterId) {
        const world = ensureWorld();
        const target = getCharacter(characterId, world);

        if (!target) {
            return fail("CHARACTER_NOT_FOUND", "Character does not exist.");
        }

        const previousAssignments = world.control.assignments;
        const candidate = clone(previousAssignments);
        const previousHumanId = getHumanCharacterId(world);

        for (const character of getCharacters(world)) {
            if (candidate[character.id] === "human") {
                candidate[character.id] = character.defaultControllerId || "dummy";
            }
        }

        candidate[target.id] = "human";

        const validation = validateControlAssignments(candidate, world);
        if (!validation.ok) {
            return validation;
        }

        world.control.assignments = candidate;
        if (previousHumanId !== target.id && candidate[previousHumanId] === "ai") {
            enqueueAITurn(previousHumanId, "released_from_human", world);
        }
        pushDebugLog(world, {
            controllerId: "human",
            actorId: target.id,
            message: `Human control moved from ${previousHumanId} to ${target.id}.`
        });

        return ok({
            previousHumanCharacterId: previousHumanId,
            humanCharacterId: target.id
        });
    }

    function assignNonHumanController(characterId, controllerId) {
        const world = ensureWorld();
        const character = getCharacter(characterId, world);

        if (!character) {
            return fail("CHARACTER_NOT_FOUND", "Character does not exist.");
        }

        if (controllerId === "human") {
            return fail(
                "USE_TAKE_HUMAN_CONTROL",
                "HumanController may be assigned only through takeHumanControl()."
            );
        }

        if (!CONTROLLER_IDS.has(controllerId)) {
            return fail("UNKNOWN_CONTROLLER", "Unknown controller.");
        }

        if (world.control.assignments[characterId] === "human") {
            return fail(
                "CANNOT_REMOVE_ONLY_HUMAN",
                "Move HumanController to another character before changing this assignment."
            );
        }

        const candidate = clone(world.control.assignments);
        candidate[characterId] = controllerId;
        const validation = validateControlAssignments(candidate, world);

        if (!validation.ok) {
            return validation;
        }

        world.control.assignments = candidate;
        return ok({ characterId: characterId, controllerId: controllerId });
    }

    function inventoryItems(inventoryId, world) {
        const inventory = world.inventories[inventoryId];
        if (!inventory) return [];
        return inventory.itemIds.map(function (itemId) {
            return itemView(getItem(itemId, world), world);
        }).filter(Boolean);
    }

    function nearbyCharacters(actor, world) {
        return getCharacters(world).filter(function (character) {
            return character.id !== actor.id &&
                character.locationId === actor.locationId;
        });
    }

    function transferItem(itemId, sourceInventory, targetInventory, world) {
        sourceInventory.itemIds = sourceInventory.itemIds.filter(function (id) {
            return id !== itemId;
        });
        targetInventory.itemIds.push(itemId);
        world.entities[itemId].containerId = targetInventory.id;
    }

    function recipientsForEvent(event, world) {
        if (event.noticeability === "hidden") {
            return event.targetId ? [event.targetId] : [];
        }

        return getCharacters(world)
            .filter(function (character) {
                return character.id !== event.actorId &&
                    character.locationId === event.locationId;
            })
            .map(function (character) {
                return character.id;
            });
    }

    function enqueueObservation(recipientId, observation, world) {
        const recipient = getCharacter(recipientId, world);
        if (!recipient) {
            return;
        }
        const record = Object.assign({ id: world.nextObservationId++ }, clone(observation));
        recipient.mind.pendingObservations.push(record);
        if (world.control.assignments[recipientId] === "ai") enqueueAITurn(recipientId, observation.kind || "observation", world);
        return record;
    }

    function routeFeedback(feedback, action, world, metadata) {
        for (const entry of feedback) {
            enqueueObservation(entry.recipientId, {
                kind: "action_feedback",
                actionType: action.type,
                turn: world.nextEventId,
                actorId: entry.recipientId,
                targetId: entry.data && entry.data.targetId ? entry.data.targetId : null,
                text: entry.text,
                data: clone(entry.data || {}),
                code: entry.code,
                interactionId: metadata && metadata.interactionId || null
            }, world);
        }
    }

    function acknowledgeEvent(eventId, characterId) {
        const world = ensureWorld();
        const event = world.events.find(function (candidate) {
            return candidate.id === eventId;
        });

        if (!event) {
            return fail("EVENT_NOT_FOUND", "Event does not exist.");
        }

        event.pendingFor = event.pendingFor.filter(function (id) {
            return id !== characterId;
        });

        if (!event.processedBy.includes(characterId)) {
            event.processedBy.push(characterId);
        }

        return ok();
    }

    function dispatchEvent(event, world) {
        if (!setup.Controllers) {
            return;
        }

        for (const characterId of event.recipients) {
            const controllerId = world.control.assignments[characterId];
            const controller = setup.Controllers[controllerId];

            if (!controller || typeof controller.onEvent !== "function") {
                continue;
            }

            try {
                const result = controller.onEvent(characterId, clone(event));
                if (result && result.processed) {
                    acknowledgeEvent(event.id, characterId);
                }
            } catch (error) {
                pushDebugLog(world, {
                    controllerId: controllerId,
                    actorId: characterId,
                    message: `Controller event error: ${error.message}`
                });
            }
        }
    }

    function emitEvent(eventData, world) {
        const event = Object.assign({
            id: world.nextEventId++,
            targetId: "",
            noticeability: "noticeable",
            text: "",
            processedBy: []
        }, eventData);

        event.recipients = recipientsForEvent(event, world);
        event.pendingFor = event.recipients.slice();
        world.events.push(event);

        const observationRecipients = event.recipients.slice();
        if (event.targetId && observationRecipients.includes(event.targetId)) {
            observationRecipients.splice(observationRecipients.indexOf(event.targetId), 1);
            observationRecipients.unshift(event.targetId);
        }
        for (const recipientId of observationRecipients) {
            enqueueObservation(recipientId, {
                kind: "event",
                sourceEventId: event.id,
                turn: event.id,
                actorId: event.actorId || null,
                targetId: event.targetId || null,
                text: event.text,
                data: clone(event)
            }, world);
        }

        if (world.events.length > 200) {
            world.events = world.events.slice(-200);
        }

        dispatchEvent(event, world);
        return event;
    }

    const ActionRegistry = {
        move: {
            description: "Move to a directly connected location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "move" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                const location = getLocation(actor.locationId, world);
                return {
                    destination_ids: Object.values(location.exits || {})
                };
            },
            validate: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                const destination = getLocation(action.destination_id, world);

                if (!destination) {
                    return fail("DESTINATION_NOT_FOUND", "Destination does not exist.");
                }

                if (!Object.values(location.exits || {}).includes(destination.id)) {
                    return fail(
                        "DESTINATION_NOT_REACHABLE",
                        "Destination is not connected to the current location."
                    );
                }

                const defaultPosition = getSublocation(destination.defaultSublocationId, world);
                if (!defaultPosition) {
                    return fail("DESTINATION_SUBLOCATION_INVALID", "Destination has no valid default position.");
                }
                if (sublocationOccupants(defaultPosition.id, world, actor.id).length >= defaultPosition.capacity) {
                    return fail("SUBLOCATION_FULL", "The destination's default position is full.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const fromLocationId = actor.locationId;
                const fromSublocationId = actor.sublocationId;
                const destination = getLocation(action.destination_id, world);
                actor.locationId = action.destination_id;
                actor.sublocationId = destination.defaultSublocationId;
                return [{
                    type: "character_left_location",
                    actorId: actor.id,
                    locationId: fromLocationId,
                    fromLocationId: fromLocationId,
                    toLocationId: action.destination_id,
                    fromSublocationId: fromSublocationId,
                    text: `${actor.name} left ${fromLocationId}.`
                }, {
                    type: "character_entered_location",
                    actorId: actor.id,
                    locationId: action.destination_id,
                    fromLocationId: fromLocationId,
                    toLocationId: action.destination_id,
                    toSublocationId: actor.sublocationId,
                    text: `${actor.name} entered ${destination.name}.`
                }];
            }
        },

        move_within_location: {
            description: "Move to another position within the current location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "move_within_location" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                const current = getSublocation(actor.sublocationId, world);
                return {
                    destination_ids: (current.reachableSublocationIds || []).filter(function (id) {
                        const destination = getSublocation(id, world);
                        return id !== actor.sublocationId && destination &&
                            sublocationOccupants(id, world, actor.id).length < destination.capacity;
                    })
                };
            },
            validate: function (actor, action, world) {
                const current = getSublocation(actor.sublocationId, world);
                const destination = getSublocation(action.destination_id, world);
                if (!destination) {
                    return fail("SUBLOCATION_NOT_FOUND", "Destination position does not exist.");
                }
                if (destination.locationId !== actor.locationId) {
                    return fail("SUBLOCATION_WRONG_LOCATION", "Destination position is in another major location.");
                }
                if (destination.id === actor.sublocationId) {
                    return fail("ALREADY_AT_SUBLOCATION", "Actor is already at that position.");
                }
                if (!(current.reachableSublocationIds || []).includes(destination.id)) {
                    return fail("SUBLOCATION_NOT_REACHABLE", "Destination position is not reachable from here.");
                }
                if (sublocationOccupants(destination.id, world, actor.id).length >= destination.capacity) {
                    return fail("SUBLOCATION_FULL", "Destination position is full.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const fromSublocationId = actor.sublocationId;
                actor.sublocationId = action.destination_id;
                return [{
                    type: "character_changed_sublocation",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    fromSublocationId: fromSublocationId,
                    toSublocationId: action.destination_id,
                    text: positionText(actor, world)
                }];
            }
        },

        take_item: {
            description: "Take an item from the current location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "take_item" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    item_ids: accessibleInventories(actor, world).flatMap(function (inventory) {
                        return inventory.itemIds;
                    })
                };
            },
            validate: function (actor, action, world) {
                const item = world.entities[action.item_id];

                if (!item || item.type !== "item") {
                    return fail("ITEM_NOT_FOUND", "Item does not exist.");
                }

                if (!accessibleInventories(actor, world).some(function (inventory) {
                    return inventory.itemIds.includes(item.id);
                })) {
                    return fail(
                        "ITEM_NOT_ACCESSIBLE",
                        "Item is not in an inventory accessible from the current position."
                    );
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const sourceInventory = world.inventories[world.entities[action.item_id].containerId];
                transferItem(
                    action.item_id,
                    sourceInventory,
                    world.inventories[actor.inventoryId],
                    world
                );

                return [{
                    type: "item_taken",
                    actorId: actor.id,
                    itemId: action.item_id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} took ${itemName(world.entities[action.item_id], world)}.`
                }];
            }
        },

        drop_item: {
            description: "Drop an owned item in the current location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "drop_item" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice()
                };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[location.inventoryId],
                    world
                );

                return [{
                    type: "item_dropped",
                    actorId: actor.id,
                    itemId: action.item_id,
                    locationId: location.id,
                    text: `${actor.name} dropped ${itemName(world.entities[action.item_id], world)}.`
                }];
            }
        },

        give_item: {
            description: "Give an owned item to another character nearby.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "give_item" },
                    target_id: { type: "string" },
                    item_id: { type: "string" }
                },
                required: ["type", "target_id", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    target_ids: nearbyCharacters(actor, world).filter(function (character) {
                        return canReachCharacter(actor, character, world);
                    }).map(function (character) {
                        return character.id;
                    }),
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice()
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);

                if (!target) {
                    return fail("TARGET_NOT_FOUND", "Target character does not exist.");
                }

                if (target.id === actor.id) {
                    return fail("INVALID_TARGET", "A character cannot give to itself.");
                }

                if (!canReachCharacter(actor, target, world)) {
                    return fail("TARGET_NOT_REACHABLE", "Target cannot be reached from the actor's current position.");
                }

                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[target.inventoryId],
                    world
                );

                return [{
                    type: "item_transferred",
                    actorId: actor.id,
                    targetId: target.id,
                    itemId: action.item_id,
                    locationId: actor.locationId,
                    text: `${actor.name} gave ${itemName(world.entities[action.item_id], world)} to ${target.name}.`
                }];
            }
        },

        give_money: {
            description: "Give money to another character nearby.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "give_money" },
                    target_id: { type: "string" },
                    amount: { type: "integer", minimum: 1 }
                },
                required: ["type", "target_id", "amount"]
            },
            getOptions: function (actor, world) {
                return {
                    target_ids: nearbyCharacters(actor, world).filter(function (character) {
                        return canReachCharacter(actor, character, world);
                    }).map(function (character) {
                        return character.id;
                    }),
                    maximum_amount: actor.wallet
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);

                if (!target) {
                    return fail("TARGET_NOT_FOUND", "Target character does not exist.");
                }

                if (target.id === actor.id) {
                    return fail("INVALID_TARGET", "A character cannot give to itself.");
                }

                if (!canReachCharacter(actor, target, world)) {
                    return fail("TARGET_NOT_REACHABLE", "Target cannot be reached from the actor's current position.");
                }

                if (!Number.isInteger(action.amount) || action.amount <= 0) {
                    return fail("INVALID_AMOUNT", "Amount must be a positive integer.");
                }

                if (actor.wallet < action.amount) {
                    return fail("INSUFFICIENT_FUNDS", "Actor does not have enough money.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                actor.wallet -= action.amount;
                target.wallet += action.amount;

                return [{
                    type: "money_transferred",
                    actorId: actor.id,
                    targetId: target.id,
                    amount: action.amount,
                    locationId: actor.locationId,
                    text: `${actor.name} gave ${action.amount} gold to ${target.name}.`
                }];
            }
        },

        place_item: {
            description: "Place an owned item on an accessible surface.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "place_item" },
                    item_id: { type: "string" },
                    target_inventory_id: { type: "string" }
                },
                required: ["type", "item_id", "target_inventory_id"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                return {
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice(),
                    target_inventory_ids: sublocation.inventoryId ? [sublocation.inventoryId] : []
                };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!sublocation.inventoryId || action.target_inventory_id !== sublocation.inventoryId) {
                    return fail("INVENTORY_NOT_ACCESSIBLE", "Target surface is not accessible from the current position.");
                }
                if (!world.inventories[action.target_inventory_id]) {
                    return fail("INVENTORY_NOT_FOUND", "Target inventory does not exist.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[action.target_inventory_id],
                    world
                );
                return [{
                    type: "item_placed",
                    actorId: actor.id,
                    itemId: action.item_id,
                    targetInventoryId: action.target_inventory_id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} placed ${itemName(world.entities[action.item_id], world)} on ${getSublocation(actor.sublocationId, world).name}.`
                }];
            }
        },

        consume: {
            description: "Consume an owned item that supports consumption.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "consume" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const items = world.inventories[actor.inventoryId].itemIds.map(function (itemId) {
                    const item = getItem(itemId, world);
                    const definition = item && getItemDefinition(item.definitionId, world);
                    if (!definition || !definition.consumable) return null;
                    return {
                        id: item.id,
                        name: itemName(item, world),
                        action_label: definition.consumable.actionLabel,
                        result_type: definition.consumable.resultType,
                        result_definition_id: definition.consumable.resultDefinitionId || null
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = getItem(action.item_id, world);
                const definition = item && getItemDefinition(item.definitionId, world);
                if (!definition || !definition.consumable) {
                    return fail("ITEM_NOT_CONSUMABLE", "This item cannot be consumed.");
                }
                if (definition.consumable.resultType === "transform" &&
                        !getItemDefinition(definition.consumable.resultDefinitionId, world)) {
                    return fail("ITEM_TRANSFORM_INVALID", "The item's consume result definition does not exist.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = getItem(action.item_id, world);
                const sourceDefinition = getItemDefinition(item.definitionId, world);
                const component = sourceDefinition.consumable;
                const fromDefinitionId = item.definitionId;
                const fromName = sourceDefinition.name;
                let resultDefinition = null;
                if (component.resultType === "destroy") {
                    const inventory = world.inventories[actor.inventoryId];
                    inventory.itemIds = inventory.itemIds.filter(function (itemId) { return itemId !== item.id; });
                    delete world.entities[item.id];
                } else {
                    resultDefinition = getItemDefinition(component.resultDefinitionId, world);
                    item.definitionId = resultDefinition.id;
                }
                const publicText = renderItemText(component.publicText || `${actor.name} consumes {item}.`, actor,
                    { id: item.id, definitionId: fromDefinitionId, name: fromName }, resultDefinition, world);
                const event = {
                    type: component.resultType === "destroy" ? "item_consumed" : "item_transformed",
                    actorId: actor.id,
                    itemId: action.item_id,
                    actionType: "consume",
                    fromDefinitionId: fromDefinitionId,
                    toDefinitionId: resultDefinition ? resultDefinition.id : null,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: publicText
                };
                const feedbackText = renderItemText(component.feedbackText || "You consume the item.", actor,
                    { id: action.item_id, definitionId: fromDefinitionId, name: fromName }, resultDefinition, world);
                return { events: [event], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "ITEM_CONSUMED",
                    text: feedbackText,
                    data: {
                        itemId: action.item_id,
                        fromDefinitionId: fromDefinitionId,
                        toDefinitionId: resultDefinition ? resultDefinition.id : null
                    }
                }] };
            }
        },

        fill: {
            description: "Fill an owned item when its current definition and the environment allow it.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "fill" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                const environment = new Set(sublocation.environmentCapabilities || []);
                const items = world.inventories[actor.inventoryId].itemIds.map(function (itemId) {
                    const item = getItem(itemId, world);
                    const definition = item && getItemDefinition(item.definitionId, world);
                    const component = definition && definition.fillable;
                    if (!component || !environment.has(component.requiredEnvironmentCapability)) return null;
                    return {
                        id: item.id,
                        name: itemName(item, world),
                        action_label: component.actionLabel,
                        required_environment_capability: component.requiredEnvironmentCapability,
                        result_definition_id: component.resultDefinitionId
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = getItem(action.item_id, world);
                const definition = item && getItemDefinition(item.definitionId, world);
                const component = definition && definition.fillable;
                if (!component) return fail("ITEM_NOT_FILLABLE", "This item cannot be filled in its current state.");
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!(sublocation.environmentCapabilities || []).includes(component.requiredEnvironmentCapability)) {
                    return fail("ENVIRONMENT_CAPABILITY_REQUIRED", "The required filling source is not available here.");
                }
                if (!getItemDefinition(component.resultDefinitionId, world)) {
                    return fail("ITEM_TRANSFORM_INVALID", "The item's fill result definition does not exist.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = getItem(action.item_id, world);
                const sourceDefinition = getItemDefinition(item.definitionId, world);
                const component = sourceDefinition.fillable;
                const resultDefinition = getItemDefinition(component.resultDefinitionId, world);
                const fromDefinitionId = item.definitionId;
                const fromName = sourceDefinition.name;
                item.definitionId = resultDefinition.id;
                const itemSnapshot = { id: item.id, definitionId: fromDefinitionId, name: fromName };
                return { events: [{
                    type: "item_transformed",
                    actorId: actor.id,
                    itemId: item.id,
                    actionType: "fill",
                    fromDefinitionId: fromDefinitionId,
                    toDefinitionId: resultDefinition.id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: renderItemText(component.publicText || `${actor.name} fills {item}.`, actor,
                        itemSnapshot, resultDefinition, world)
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "ITEM_FILLED",
                    text: renderItemText(component.feedbackText || "You fill the item.", actor,
                        itemSnapshot, resultDefinition, world),
                    data: {
                        itemId: item.id,
                        fromDefinitionId: fromDefinitionId,
                        toDefinitionId: resultDefinition.id
                    }
                }] };
            }
        },

        read_aura: {
            description: "Read every currently perceivable character's aura.",
            schema: {
                type: "object",
                properties: { type: { const: "read_aura" } },
                required: ["type"],
                additionalProperties: false
            },
            getOptions: function () {
                return {};
            },
            validate: function (actor, action, world) {
                if (Object.keys(action).some(function (key) { return key !== "type"; })) {
                    return fail("INVALID_ACTION_INPUT", "read_aura does not accept caller-supplied targets or parameters.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const visibleCharacters = getCharacterView(actor.id).location.characters;
                const results = visibleCharacters.map(function (visibleCharacter) {
                    const target = getCharacter(visibleCharacter.id, world);
                    const authoredAura = target && target.engineFacts && typeof target.engineFacts.aura === "string"
                        ? target.engineFacts.aura.trim()
                        : "";
                    return {
                        characterId: visibleCharacter.id,
                        name: visibleCharacter.name,
                        aura: authoredAura || "You perceive nothing unusual."
                    };
                });
                return { events: [], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "AURA_SCAN_RESULT",
                    text: results.length > 0 ? "You read the nearby auras." : "You sense no other auras nearby.",
                    data: { results: results }
                }] };
            }
        }
    };

    function grantedActionSources(actor, world) {
        const grants = {};
        function grant(type, source) {
            if (!grants[type]) grants[type] = [];
            grants[type].push(source);
        }
        for (const type of BASE_ACTION_TYPES) grant(type, { kind: "base" });
        const sublocation = getSublocation(actor.sublocationId, world);
        for (const type of (sublocation.capabilities || [])) grant(type, { kind: "sublocation", id: sublocation.id });
        for (const abilityId of (actor.abilityIds || [])) {
            const ability = world.abilities[abilityId];
            if (ability) grant(ability.actionType, { kind: "character_ability", id: ability.id, name: ability.name });
        }

        const environment = new Set(sublocation.environmentCapabilities || []);
        const inventory = world.inventories[actor.inventoryId];
        for (const itemId of inventory.itemIds) {
            const item = getItem(itemId, world);
            const definition = item && getItemDefinition(item.definitionId, world);
            if (!definition) continue;
            if (definition.consumable) {
                grant("consume", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
            if (definition.fillable && environment.has(definition.fillable.requiredEnvironmentCapability)) {
                grant("fill", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
        }
        return grants;
    }

    function getAvailableActions(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }

        const actions = {};
        const grants = grantedActionSources(actor, world);

        for (const [type, sources] of Object.entries(grants)) {
            const definition = ActionRegistry[type];
            if (!definition) continue;
            actions[type] = {
                description: definition.description,
                schema: clone(definition.schema),
                options: definition.getOptions(actor, world),
                sources: clone(sources)
            };
        }

        return actions;
    }

    function getCharacterView(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }

        const location = getLocation(actor.locationId, world);

        return {
            self: {
                id: actor.id,
                name: actor.name,
                controller_id: world.control.assignments[actor.id],
                location_id: actor.locationId,
                sublocation_id: actor.sublocationId,
                position_text: getSublocation(actor.sublocationId, world).selfText,
                wallet: actor.wallet,
                inventory: inventoryItems(actor.inventoryId, world),
                abilities: (actor.abilityIds || []).map(function (abilityId) {
                    const ability = world.abilities[abilityId];
                    return ability ? {
                        id: ability.id,
                        name: ability.name,
                        playerDescription: ability.playerDescription,
                        actionType: ability.actionType
                    } : null;
                }).filter(Boolean)
            },
            location: {
                id: location.id,
                name: location.name,
                passage: location.passage,
                characters: nearbyCharacters(actor, world).map(function (character) {
                    return {
                        id: character.id,
                        name: character.name,
                        playerDescription: character.playerDescription || `${character.name} is here.`,
                        presence_text: character.playerDescription || `${character.name} is here.`,
                        interaction_label: character.interactionLabel || `Speak with ${character.name}`,
                        sublocation_id: character.sublocationId,
                        position_text: positionText(character, world),
                        reachable: canReachCharacter(actor, character, world)
                    };
                }),
                description: clone(location.description || []),
                sublocations: getSublocations(location.id, world).map(function (sublocation) {
                    return {
                        id: sublocation.id,
                        name: sublocation.name,
                        enter_label: sublocation.enterLabel,
                        public_text: sublocation.publicText || "",
                        capacity: sublocation.capacity
                    };
                }),
                items: inventoryItems(location.inventoryId, world),
                exits: Object.values(location.exits || {}).map(function (locationId) {
                    const destination = getLocation(locationId, world);
                    return { id: destination.id, name: destination.name };
                })
            },
            accessible_inventories: accessibleInventories(actor, world).map(function (inventory) {
                const owner = world.entities[inventory.ownerId];
                return {
                    id: inventory.id,
                    owner_id: inventory.ownerId,
                    name: owner ? (owner.inventoryName || owner.name) : inventory.id,
                    items: inventoryItems(inventory.id, world)
                };
            }),
            available_actions: getAvailableActions(actorId)
        };
    }

    function executeAction(actorId, action, metadata) {
        let world = ensureWorld();
        const actor = getCharacter(actorId, world);
        const attempted = action && typeof action === "object" ? clone(action) : {};

        if (!actor) {
            return { ok: false, action: attempted, events: [], feedback: [], error: { code: "ACTOR_NOT_FOUND", message: "Actor character does not exist." } };
        }

        if (!action || typeof action !== "object") {
            return { ok: false, action: attempted, events: [], feedback: [], error: { code: "INVALID_ACTION", message: "Action must be an object." } };
        }

        const definition = ActionRegistry[action.type];
        if (!definition) {
            return { ok: false, action: attempted, events: [], feedback: [], error: {
                code: "UNKNOWN_ACTION", message: `Unknown action type: ${String(action.type)}.`
            } };
        }

        if (!grantedActionSources(actor, world)[action.type]) {
            const result = {
                ok: false, action: clone(action), events: [], feedback: [],
                error: { code: "ACTION_NOT_AVAILABLE", message: "Action is not currently available to this actor." }
            };
            world.debug.lastActionResult = result;
            return result;
        }

        const validation = definition.validate(actor, action, world);
        if (!validation.ok) {
            const feedback = [{
                recipientId: actor.id, kind: "observation", code: validation.error.code,
                text: validation.error.message, data: clone(action)
            }];
            routeFeedback(feedback, action, world, metadata);
            const result = { ok: false, action: clone(action), events: [], feedback: feedback, error: clone(validation.error) };
            world.debug.lastActionResult = result;
            return result;
        }

        const snapshot = clone(world);

        try {
            const raw = definition.execute(actor, action, world);
            const rawEvents = Array.isArray(raw) ? raw : (raw.events || []);
            const feedback = Array.isArray(raw) ? [] : clone(raw.feedback || []);
            const invariantResult = validateWorld(world);

            if (!invariantResult.ok) {
                throw new Error(invariantResult.error.message);
            }

            const events = rawEvents.map(function (eventData) {
                const enriched = Object.assign({}, eventData);
                if (metadata && metadata.interactionId) enriched.interactionId = metadata.interactionId;
                return emitEvent(enriched, world);
            });
            routeFeedback(feedback, action, world, metadata);
            if (world.control.assignments[actor.id] === "ai") {
                enqueueObservation(actor.id, {
                    kind: "action_result",
                    actionType: action.type,
                    turn: events.length > 0 ? events[events.length - 1].id : world.nextEventId,
                    actorId: actor.id,
                    targetId: action.target_id || null,
                    text: events.map(function (event) { return event.text; }).filter(Boolean).join(" ") || `Your ${action.type} action succeeded.`,
                    data: { ok: true, action: clone(action), events: clone(events) },
                    code: "ACTION_SUCCEEDED",
                    interactionId: metadata && metadata.interactionId || null
                }, world);
            }

            const result = { ok: true, action: clone(action), events: clone(events), feedback: feedback, error: null };
            world.debug.lastActionResult = result;
            return result;
        } catch (error) {
            State.variables.world = snapshot;
            world = getWorld();
            const result = { ok: false, action: clone(action), events: [], feedback: [], error: { code: "ACTION_EXECUTION_FAILED", message: error.message } };
            world.debug.lastActionResult = result;
            return result;
        }
    }

    function submitNarrative(actorId, input, metadata) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }

        const text = input && typeof input.text === "string"
            ? input.text.trim()
            : "";

        if (!text) {
            return fail("EMPTY_NARRATIVE", "Narrative text is empty.");
        }

        const targetId = input.target_id || "";
        const narrativeLocationId = metadata && metadata.locationId || actor.locationId;
        if (targetId) {
            const target = getCharacter(targetId, world);
            if (!target || target.locationId !== narrativeLocationId) {
                return fail("TARGET_NOT_NEARBY", "Narrative target is not nearby.");
            }
        }

        const noticeability = input.noticeability === "hidden"
            ? "hidden"
            : "noticeable";

        const event = emitEvent({
            type: "narrative_input",
            actorId: actor.id,
            targetId: targetId,
            locationId: narrativeLocationId,
            noticeability: noticeability,
            interactionId: metadata && metadata.interactionId || null,
            text: text
        }, world);

        const result = ok({ event: clone(event) });
        world.debug.lastActionResult = result;
        return result;
    }


    function submitIntent(actorId, input) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");

        input = input && typeof input === "object" ? input : {};
        const text = typeof input.text === "string" ? input.text.trim() : "";
        const action = input.action && typeof input.action === "object" ? clone(input.action) : null;
        if (!text && !action) return fail("EMPTY_INTENT", "Submit a narrative, one formal action, or both.");

        const snapshot = clone(world);
        const interactionId = world.nextIntentId++;
        const originLocationId = actor.locationId;
        let actionResult = null;
        let narrativeResult = null;

        try {
            if (action) {
                actionResult = executeAction(actorId, action, { interactionId: interactionId });
            }
            if (text) {
                narrativeResult = submitNarrative(actorId, {
                    text: text,
                    target_id: input.target_id || "",
                    noticeability: input.noticeability || "noticeable"
                }, {
                    interactionId: interactionId,
                    locationId: action && action.type === "move" ? originLocationId : getCharacter(actorId, world).locationId
                });
                if (!narrativeResult.ok) throw narrativeResult.error;
            }
            const validation = validateWorld(world);
            if (!validation.ok) throw validation.error;
            const result = ok({
                interactionId: interactionId,
                action: action,
                actionResult: actionResult,
                narrativeResult: narrativeResult
            });
            world.debug.lastActionResult = clone(result);
            return result;
        } catch (error) {
            State.variables.world = snapshot;
            return fail(error && error.code || "INTENT_EXECUTION_FAILED", error && error.message || "The combined intent could not be executed.");
        }
    }

    function getPendingEventsFor(characterId) {
        const world = ensureWorld();
        return world.events.filter(function (event) {
            return event.pendingFor.includes(characterId);
        });
    }

    function buildContext(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        return clone({
            schemaVersion: 1,
            character: {
                id: actor.id,
                name: actor.name,
                aiDescription: actor.aiDescription,
                abilities: (actor.abilityIds || []).map(function (id) { return world.abilities[id]; }).filter(Boolean)
            },
            mind: actor.mind,
            view: getCharacterView(actorId),
            availableActions: getAvailableActions(actorId)
        });
    }

    function applyAIMemoryUpdates(actorId, updates) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        updates = updates || {};
        const memories = updates.recentMemoriesToAdd || [];
        const beliefs = updates.beliefsToUpsert || [];
        const relationships = updates.relationshipsToUpsert || [];
        if (!Array.isArray(memories) || !Array.isArray(beliefs) || !Array.isArray(relationships) ||
            memories.length > 5 || beliefs.length > 5 || relationships.length > 5) {
            return fail("MEMORY_UPDATE_INVALID", "Memory updates exceed the allowed record limits.");
        }
        function validText(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 500; }
        for (const memory of memories) if (!memory || !validText(memory.summary) ||
            typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
            return fail("MEMORY_UPDATE_INVALID", "A recent memory update is invalid.");
        }
        for (const belief of beliefs) if (!belief || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id || "") ||
            !validText(belief.text) || !["low", "medium", "high"].includes(belief.confidence)) {
            return fail("MEMORY_UPDATE_INVALID", "A belief update is invalid.");
        }
        for (const relationship of relationships) if (!relationship || relationship.targetCharacterId === actorId ||
            !getCharacter(relationship.targetCharacterId, world) || !validText(relationship.summary)) {
            return fail("MEMORY_UPDATE_INVALID", "A relationship update is invalid.");
        }
        for (const memory of memories) {
            let memoryId;
            const existingMemoryIds = new Set(actor.mind.recentMemories.concat(actor.mind.longTermMemories).map(function (item) { return item.id; }));
            do { memoryId = `memory_ai_${world.nextMemoryId++}`; } while (existingMemoryIds.has(memoryId));
            actor.mind.recentMemories.push({
                id: memoryId, summary: memory.summary.trim(), importance: memory.importance, protected: false
            });
        }
        for (const belief of beliefs) {
            const record = { id: belief.id, text: belief.text.trim(), confidence: belief.confidence };
            const index = actor.mind.beliefs.findIndex(function (item) { return item.id === belief.id; });
            if (index < 0) actor.mind.beliefs.push(record); else actor.mind.beliefs[index] = record;
        }
        for (const relationship of relationships) {
            const record = { targetCharacterId: relationship.targetCharacterId, summary: relationship.summary.trim() };
            const index = actor.mind.relationships.findIndex(function (item) { return item.targetCharacterId === relationship.targetCharacterId; });
            if (index < 0) actor.mind.relationships.push(record); else actor.mind.relationships[index] = record;
        }
        return ok();
    }

    function consumeObservations(actorId, observationIds) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor || !Array.isArray(observationIds)) return fail("OBSERVATION_CONSUME_INVALID", "Observation consumption request is invalid.");
        const ids = new Set(observationIds.filter(Number.isInteger));
        actor.mind.pendingObservations = actor.mind.pendingObservations.filter(function (item) { return !ids.has(item.id); });
        repairAIQueue(world);
        return ok();
    }

    setup.Game = {
        WORLD_VERSION: WORLD_VERSION,
        ActionRegistry: ActionRegistry,
        createInitialWorld: createInitialWorld,
        bootstrap: function () {
            ensureWorld();
            return validateWorld(getWorld());
        },
        resetWorld: function () {
            State.variables.world = createInitialWorld();
            return ok();
        },
        getWorld: function () {
            return ensureWorld();
        },
        validateWorld: function () {
            return validateWorld(ensureWorld());
        },
        validateHumanControllerInvariant: function () {
            const world = ensureWorld();
            return validateControlAssignments(world.control.assignments, world);
        },
        getHumanCharacterId: function () {
            return getHumanCharacterId(ensureWorld());
        },
        takeHumanControl: takeHumanControl,
        assignNonHumanController: assignNonHumanController,
        acknowledgeEvent: acknowledgeEvent,
        getPendingEventsFor: getPendingEventsFor,
        canReachCharacter: function (actorId, targetId) {
            const world = ensureWorld();
            return canReachCharacter(
                getCharacter(actorId, world),
                getCharacter(targetId, world),
                world
            );
        },
        logController: function (entry) {
            pushDebugLog(ensureWorld(), entry);
        }
    };

    setup.AITurnQueue = {
        enqueue: function (characterId, reason) { return enqueueAITurn(characterId, reason, ensureWorld()); },
        peek: function () { return getAIQueueStatus(ensureWorld()).head; },
        remove: function (characterId) { const world = ensureWorld(); world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) { return entry.characterId !== characterId; }); return ok(); },
        getStatus: function () { return getAIQueueStatus(ensureWorld()); },
        repair: function () { const world = ensureWorld(); repairAIQueue(world); return getAIQueueStatus(world); }
    };

    setup.AIMemory = { applyUpdates: applyAIMemoryUpdates, consumeObservations: consumeObservations };

    setup.CharacterAPI = {
        getView: getCharacterView,
        getAvailableActions: getAvailableActions,
        perform: executeAction,
        narrate: submitNarrative,
        submitIntent: submitIntent
    };
    setup.ContextBuilder = { build: buildContext };
}());
