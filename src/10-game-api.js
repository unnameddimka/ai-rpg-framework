(function () {
    "use strict";

    const WORLD_VERSION = 3;
    const CONTROLLER_IDS = new Set(["human", "dummy", "ai"]);

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

    function installGeneratedSpatialData(world) {
        const document = setup.GeneratedWorldData;
        if (!document || document.schemaVersion !== 1 || !document.locations) {
            throw new Error("Generated world data is missing or uses an unsupported schema version.");
        }

        for (const [locationId, sourceLocation] of Object.entries(document.locations)) {
            const location = clone(sourceLocation);
            const sublocations = location.sublocations || {};
            delete location.sublocations;
            location.id = locationId;
            location.type = "location";
            world.entities[locationId] = location;
            world.inventories[location.inventoryId] = {
                id: location.inventoryId,
                ownerId: locationId,
                itemIds: locationId === "bar" ? ["beerMug"] : []
            };
            if (locationId === "bar" && world.entities.beerMug) {
                world.entities.beerMug.containerId = location.inventoryId;
            }

            for (const [sublocationId, sourceSublocation] of Object.entries(sublocations)) {
                const sublocation = clone(sourceSublocation);
                sublocation.id = sublocationId;
                sublocation.type = "sublocation";
                sublocation.locationId = locationId;
                world.entities[sublocationId] = sublocation;
                if (sublocation.inventoryId) {
                    world.inventories[sublocation.inventoryId] = {
                        id: sublocation.inventoryId,
                        ownerId: sublocationId,
                        itemIds: []
                    };
                }
            }
        }
    }

    function createInitialWorld() {
        const world = {
            version: WORLD_VERSION,

            entities: {
                player: {
                    id: "player",
                    type: "character",
                    name: "You",
                    locationId: "tavernEntrance",
                    sublocationId: "tavernEntranceFloor",
                    inventoryId: "inventory_player",
                    wallet: 10,
                    presenceText: "A rain-soaked traveller takes in the surroundings.",
                    interactionLabel: "Speak with the traveller",
                    defaultControllerId: "dummy"
                },

                hoodedWoman: {
                    id: "hoodedWoman",
                    type: "character",
                    name: "Hooded woman",
                    locationId: "commonRoom",
                    sublocationId: "commonRoomTableOne",
                    inventoryId: "inventory_hoodedWoman",
                    wallet: 8,
                    presenceText: "A hooded woman watches the room from beneath the edge of her hood.",
                    interactionLabel: "Speak with the hooded woman",
                    defaultControllerId: "dummy"
                },

                innkeeper: {
                    id: "innkeeper",
                    type: "character",
                    name: "Innkeeper",
                    locationId: "bar",
                    sublocationId: "barBehindCounter",
                    inventoryId: "inventory_innkeeper",
                    wallet: 25,
                    presenceText: "The innkeeper wipes a wooden mug with a worn cloth.",
                    interactionLabel: "Speak with the innkeeper",
                    defaultControllerId: "dummy"
                },

                beerMug: {
                    id: "beerMug",
                    type: "item",
                    name: "Mug of ale",
                    containerId: "inventory_bar"
                },

                cleaningRag: {
                    id: "cleaningRag",
                    type: "item",
                    name: "Cleaning rag",
                    containerId: "inventory_innkeeper"
                }
            },

            inventories: {
                inventory_player: {
                    id: "inventory_player",
                    ownerId: "player",
                    itemIds: []
                },
                inventory_hoodedWoman: {
                    id: "inventory_hoodedWoman",
                    ownerId: "hoodedWoman",
                    itemIds: []
                },
                inventory_innkeeper: {
                    id: "inventory_innkeeper",
                    ownerId: "innkeeper",
                    itemIds: ["cleaningRag"]
                },
            },

            control: {
                assignments: {
                    player: "human",
                    hoodedWoman: "dummy",
                    innkeeper: "dummy"
                }
            },

            events: [],
            nextEventId: 1,
            nextGeneratedItemId: 1,

            debug: {
                lastActionResult: null,
                controllerLog: [],
                repairs: []
            }
        };
        installGeneratedSpatialData(world);
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
        const itemMembership = {};

        for (const inventory of Object.values(world.inventories)) {
            for (const itemId of inventory.itemIds) {
                const item = world.entities[itemId];
                if (!item || item.type !== "item") {
                    return fail("INVENTORY_ITEM_INVALID", `Inventory ${inventory.id} contains invalid item ${itemId}.`);
                }
                if (itemMembership[itemId]) {
                    return fail(
                        "ITEM_IN_MULTIPLE_INVENTORIES",
                        `Item ${itemId} appears in more than one inventory.`
                    );
                }
                itemMembership[itemId] = inventory.id;
            }
        }

        for (const entity of Object.values(world.entities)) {
            if (entity.type !== "item") {
                continue;
            }

            if (itemMembership[entity.id] !== entity.containerId) {
                return fail(
                    "ITEM_CONTAINER_MISMATCH",
                    `Item ${entity.id} containerId does not match inventory membership.`
                );
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
        if (!inventory) {
            return [];
        }

        return inventory.itemIds.map(function (itemId) {
            const item = world.entities[itemId];
            return { id: item.id, name: item.name };
        });
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
                    text: `${actor.name} took ${world.entities[action.item_id].name}.`
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
                    text: `${actor.name} dropped ${world.entities[action.item_id].name}.`
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
                    text: `${actor.name} gave ${world.entities[action.item_id].name} to ${target.name}.`
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
                    text: `${actor.name} placed ${world.entities[action.item_id].name} on ${getSublocation(actor.sublocationId, world).name}.`
                }];
            }
        },

        pour_ale: {
            description: "Pour a fresh mug of ale.",
            schema: {
                type: "object",
                properties: { type: { const: "pour_ale" } },
                required: ["type"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                return {
                    available: (sublocation.capabilities || []).includes("pour_ale")
                };
            },
            validate: function (actor, action, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!(sublocation.capabilities || []).includes("pour_ale")) {
                    return fail("CAPABILITY_REQUIRED", "Ale can be poured only from behind the bar.");
                }
                if (!world.inventories[actor.inventoryId]) {
                    return fail("ACTOR_INVENTORY_MISSING", "Actor has no valid inventory.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                let itemId;
                do {
                    itemId = `mugOfAle_${world.nextGeneratedItemId++}`;
                } while (world.entities[itemId]);

                world.entities[itemId] = {
                    id: itemId,
                    type: "item",
                    templateId: "mugOfAle",
                    name: "Mug of ale",
                    containerId: actor.inventoryId
                };
                world.inventories[actor.inventoryId].itemIds.push(itemId);
                return [{
                    type: "ale_poured",
                    actorId: actor.id,
                    itemId: itemId,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} poured a mug of ale.`
                }];
            }
        }
    };

    function getAvailableActions(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }

        const actions = {};

        for (const [type, definition] of Object.entries(ActionRegistry)) {
            actions[type] = {
                description: definition.description,
                schema: clone(definition.schema),
                options: definition.getOptions(actor, world)
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
                inventory: inventoryItems(actor.inventoryId, world)
            },
            location: {
                id: location.id,
                name: location.name,
                passage: location.passage,
                characters: nearbyCharacters(actor, world).map(function (character) {
                    return {
                        id: character.id,
                        name: character.name,
                        presence_text: character.presenceText || `${character.name} is here.`,
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
                    name: owner ? owner.name : inventory.id,
                    items: inventoryItems(inventory.id, world)
                };
            }),
            available_actions: getAvailableActions(actorId)
        };
    }

    function executeAction(actorId, action) {
        let world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }

        if (!action || typeof action !== "object") {
            return fail("INVALID_ACTION", "Action must be an object.");
        }

        const definition = ActionRegistry[action.type];
        if (!definition) {
            return fail(
                "UNKNOWN_ACTION",
                `Unknown action type: ${String(action.type)}.`
            );
        }

        const validation = definition.validate(actor, action, world);
        if (!validation.ok) {
            world.debug.lastActionResult = validation;
            return validation;
        }

        const snapshot = clone(world);

        try {
            const rawEvents = definition.execute(actor, action, world);
            const invariantResult = validateWorld(world);

            if (!invariantResult.ok) {
                throw new Error(invariantResult.error.message);
            }

            const events = rawEvents.map(function (eventData) {
                return emitEvent(eventData, world);
            });

            const result = ok({ action: clone(action), events: clone(events) });
            world.debug.lastActionResult = result;
            return result;
        } catch (error) {
            State.variables.world = snapshot;
            world = getWorld();
            const result = fail("ACTION_EXECUTION_FAILED", error.message);
            world.debug.lastActionResult = result;
            return result;
        }
    }

    function submitNarrative(actorId, input) {
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
        if (targetId) {
            const target = getCharacter(targetId, world);
            if (!target || target.locationId !== actor.locationId) {
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
            locationId: actor.locationId,
            noticeability: noticeability,
            text: text
        }, world);

        const result = ok({ event: clone(event) });
        world.debug.lastActionResult = result;
        return result;
    }

    function getPendingEventsFor(characterId) {
        const world = ensureWorld();
        return world.events.filter(function (event) {
            return event.pendingFor.includes(characterId);
        });
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

    setup.CharacterAPI = {
        getView: getCharacterView,
        getAvailableActions: getAvailableActions,
        perform: executeAction,
        narrate: submitNarrative
    };
}());
