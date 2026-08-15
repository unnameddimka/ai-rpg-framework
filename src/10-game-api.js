(function () {
    "use strict";

    const LEGACY_WORLD_VERSION = 6;
    const WORLD_SCHEMA_VERSION = 9;
    const SUPPORTED_MIGRATION_SCHEMA_VERSIONS = new Set([LEGACY_WORLD_VERSION, 7, 8, WORLD_SCHEMA_VERSION]);
    const CONTROLLER_IDS = new Set(["human", "dummy", "ai"]);
    const BASE_ACTION_TYPES = ["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money"];
    const SPEECH_LOUDNESS_VALUES = Object.freeze(["noticeable", "hidden"]);
    const LOCK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createInferenceSessionId() {
        try {
            if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
                return `ai-rpg-${crypto.randomUUID()}`;
            }
        } catch (error) { /* Fall through to a non-secret local identifier. */ }
        return `ai-rpg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
        if (!document || document.schemaVersion !== 2 || typeof document.authoringRevision !== "string" || !document.authoringRevision ||
                !document.locations || !document.characters || !document.abilities || !document.itemDefinitions || !document.items) {
            throw new Error("Generated world data is missing, lacks an authoring revision, or uses an unsupported schema version.");
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
                name: location.inventoryName || location.name,
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
                        name: sublocation.inventoryName || sublocation.name,
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
            character.recentDialogue = [];
            character.equippedItems = [];
            character.sleeping = character.sleeping === true;
            world.entities[characterId] = character;
            if (world.inventories[character.inventoryId]) {
                throw new Error(`Duplicate inventory ID ${character.inventoryId}.`);
            }
            world.inventories[character.inventoryId] = {
                id: character.inventoryId,
                ownerId: characterId,
                name: character.name,
                itemIds: []
            };
            world.control.assignments[characterId] = character.initialControllerId;
            delete character.initialControllerId;
        }

        for (const [itemId, sourceItem] of Object.entries(document.items)) {
            const item = clone(sourceItem);
            const definition = world.itemDefinitions[item.definitionId];
            if (!definition) throw new Error(`Item ${itemId} references missing definition ${item.definitionId}.`);
            item.id = itemId;
            item.type = "item";
            item.name = definition.name;
            if (item.inventoryId) {
                const inventory = world.inventories[item.inventoryId];
                if (!inventory) throw new Error(`Item ${itemId} references missing inventory ${item.inventoryId}.`);
                item.containerId = item.inventoryId;
                delete item.inventoryId;
                world.entities[itemId] = item;
                inventory.itemIds.push(itemId);
                continue;
            }
            const character = getCharacter(item.equippedByCharacterId, world);
            if (!character || !Array.isArray(definition.equipSlots) || !definition.equipSlots.includes(item.equippedSlot)) {
                throw new Error(`Item ${itemId} has invalid equipped starting placement.`);
            }
            item.containerId = character.id;
            const slot = item.equippedSlot;
            delete item.equippedByCharacterId;
            delete item.equippedSlot;
            world.entities[itemId] = item;
            character.equippedItems.push({ itemId: itemId, slot: slot, visible: true });
        }
    }

    function createInitialWorld() {
        const world = {
            schemaVersion: WORLD_SCHEMA_VERSION,
            authoringRevision: setup.GeneratedWorldData.authoringRevision,

            entities: {},

            inventories: {},
            itemDefinitions: {},

            control: {
                assignments: {}
            },

            events: [],
            nextEventId: 1,
            nextObservationId: 1,
            nextMemoryId: 1,
            nextGeneratedItemId: 1,
            nextIntentId: 1,
            ai: { turnQueue: [], continuations: {}, inferenceSessionId: createInferenceSessionId() },

            debug: {
                lastActionResult: null,
                controllerLog: [],
                repairs: [],
                migrationReports: []
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

    function ensureAIState(world) {
        if (!world.ai || typeof world.ai !== "object" || Array.isArray(world.ai)) world.ai = {};
        if (!Array.isArray(world.ai.turnQueue)) world.ai.turnQueue = [];
        if (!world.ai.continuations || typeof world.ai.continuations !== "object" || Array.isArray(world.ai.continuations)) {
            world.ai.continuations = {};
        }
        Object.keys(world.ai.continuations).forEach(function (characterId) {
            const value = world.ai.continuations[characterId];
            if (!getCharacter(characterId, world) || (value !== null && (typeof value !== "string" || value.length > 2000))) {
                delete world.ai.continuations[characterId];
            }
        });
        return world.ai;
    }

    function repairAIQueue(world) {
        ensureAIState(world);
        const seen = new Set();
        world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) {
            const characterId = typeof entry === "string" ? entry : entry && entry.characterId;
            if (!characterId || seen.has(characterId) || !isAIQueueEligible(characterId, world)) return false;
            seen.add(characterId);
            return true;
        }).map(function (entry) {
            const characterId = typeof entry === "string" ? entry : entry.characterId;
            return {
                characterId: characterId,
                reason: typeof entry === "object" && typeof entry.reason === "string" ? entry.reason : "observation"
            };
        });
        return world.ai.turnQueue;
    }

    function hydrateAIQueueFromPendingObservations(world) {
        repairAIQueue(world);
        const queued = new Set(world.ai.turnQueue.map(function (entry) { return entry.characterId; }));
        getCharacters(world).forEach(function (character) {
            if (world.control.assignments[character.id] !== "ai" ||
                    !character.mind || !Array.isArray(character.mind.pendingObservations) ||
                    character.mind.pendingObservations.length === 0 || queued.has(character.id)) return;
            world.ai.turnQueue.push({ characterId: character.id, reason: "restored_observation" });
            queued.add(character.id);
        });
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

    function locationExitEntries(location) {
        return Object.entries(location && location.exits || {}).map(function (entry) {
            const key = entry[0];
            const raw = entry[1];
            if (typeof raw === "string") {
                return {
                    key: key,
                    destinationId: raw,
                    blocked: false,
                    blockedReason: "",
                    lockId: "",
                    locked: false,
                    lockedReason: ""
                };
            }
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                return {
                    key: key,
                    destinationId: typeof raw.destinationId === "string" ? raw.destinationId : "",
                    blocked: raw.blocked === true,
                    blockedReason: typeof raw.blockedReason === "string" ? raw.blockedReason : "",
                    lockId: typeof raw.lockId === "string" ? raw.lockId : "",
                    locked: raw.locked === true,
                    lockedReason: typeof raw.lockedReason === "string" ? raw.lockedReason : ""
                };
            }
            return {
                key: key,
                destinationId: "",
                blocked: false,
                blockedReason: "",
                lockId: "",
                locked: false,
                lockedReason: ""
            };
        });
    }

    function findLocationExit(location, destinationId) {
        return locationExitEntries(location).find(function (entry) {
            return entry.destinationId === destinationId;
        }) || null;
    }

    function matchingKeyItems(actor, lockId, world) {
        const inventory = actor && world.inventories[actor.inventoryId];
        if (!inventory || !lockId) return [];
        return inventory.itemIds.map(function (itemId) {
            return world.entities[itemId];
        }).filter(function (item) {
            const definition = getItemDefinition(item, world);
            return Boolean(definition && definition.keyLockId === lockId);
        });
    }

    function reciprocalTransition(sourceLocationId, transition, world) {
        const destination = transition && getLocation(transition.destinationId, world);
        return destination ? findLocationExit(destination, sourceLocationId) : null;
    }

    function lockActionOptions(actor, world, expectedLockedState) {
        const location = getLocation(actor.locationId, world);
        const passages = locationExitEntries(location).map(function (transition) {
            if (!transition.lockId || transition.locked !== expectedLockedState) return null;
            const keys = matchingKeyItems(actor, transition.lockId, world);
            if (keys.length === 0) return null;
            const destination = getLocation(transition.destinationId, world);
            return {
                id: transition.destinationId,
                name: destination ? destination.name : transition.destinationId,
                lock_id: transition.lockId,
                key_item_ids: keys.map(function (item) { return item.id; })
            };
        }).filter(Boolean);
        return {
            destination_ids: passages.map(function (passage) { return passage.id; }),
            passages: passages
        };
    }

    function validateLockAction(actor, action, world, expectedLockedState) {
        const location = getLocation(actor.locationId, world);
        const destination = getLocation(action.destination_id, world);
        if (!destination) return fail("DESTINATION_NOT_FOUND", "Destination does not exist.");
        const transition = findLocationExit(location, destination.id);
        if (!transition) return fail("DESTINATION_NOT_REACHABLE", "Destination is not connected to the current location.");
        if (!transition.lockId) return fail("PASSAGE_NOT_LOCKABLE", "This passage has no lock.");
        if (transition.locked !== expectedLockedState) {
            return fail(
                expectedLockedState ? "PASSAGE_ALREADY_UNLOCKED" : "PASSAGE_ALREADY_LOCKED",
                expectedLockedState ? "This passage is already unlocked." : "This passage is already locked."
            );
        }
        if (matchingKeyItems(actor, transition.lockId, world).length === 0) {
            return fail("MATCHING_KEY_REQUIRED", "Actor does not possess a key for this lock.");
        }
        const reciprocal = reciprocalTransition(location.id, transition, world);
        if (!reciprocal || reciprocal.lockId !== transition.lockId || reciprocal.locked !== transition.locked) {
            return fail("PASSAGE_LOCK_STATE_INVALID", "The reciprocal side of this lock is inconsistent.");
        }
        return ok({ transition: transition });
    }

    function setPassageLocked(sourceLocationId, destinationId, locked, world) {
        const source = getLocation(sourceLocationId, world);
        const transition = findLocationExit(source, destinationId);
        const destination = transition && getLocation(transition.destinationId, world);
        const reciprocal = transition && reciprocalTransition(sourceLocationId, transition, world);
        if (!source || !transition || !destination || !reciprocal || !transition.lockId ||
                reciprocal.lockId !== transition.lockId) {
            throw new Error("Cannot update an inconsistent passage lock.");
        }

        function update(location, entry) {
            const raw = location.exits[entry.key];
            const record = raw && typeof raw === "object" && !Array.isArray(raw)
                ? raw
                : { destinationId: entry.destinationId };
            record.destinationId = entry.destinationId;
            record.lockId = entry.lockId;
            record.locked = Boolean(locked);
            if (!Object.prototype.hasOwnProperty.call(record, "lockedReason")) {
                record.lockedReason = entry.lockedReason || "The door is locked.";
            }
            location.exits[entry.key] = record;
        }

        update(source, transition);
        update(destination, reciprocal);
        return transition;
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

    function getItemDefinition(itemOrDefinitionId, world) {
        const definitionId = typeof itemOrDefinitionId === "string"
            ? itemOrDefinitionId
            : itemOrDefinitionId && itemOrDefinitionId.definitionId;
        return definitionId && world.itemDefinitions
            ? world.itemDefinitions[definitionId] || null
            : null;
    }

    function itemView(item, world) {
        const definition = getItemDefinition(item, world);
        return {
            id: item.id,
            name: definition ? definition.name : item.name,
            definition_id: definition ? definition.id : item.definitionId,
            family_id: definition ? definition.familyId : "",
            description: definition && typeof definition.description === "string" ? definition.description : "",
            tags: definition ? clone(definition.tags || []) : [],
            consumable: Boolean(definition && definition.consumable),
            equippable: Boolean(definition && Array.isArray(definition.equipSlots) && definition.equipSlots.length),
            equip_slots: definition ? clone(definition.equipSlots || []) : [],
            equipped_description: definition && typeof definition.equippedDescription === "string" ? definition.equippedDescription : "",
            fillable: Boolean(definition && definition.fillable)
        };
    }

    function equippedRecords(character) {
        return character && Array.isArray(character.equippedItems) ? character.equippedItems : [];
    }

    function equippedItemView(record, world) {
        const item = record && world.entities[record.itemId];
        if (!item || item.type !== "item") return null;
        const view = itemView(item, world);
        view.slot = record.slot;
        view.visible = record.visible !== false;
        return view;
    }

    function characterAppearanceText(character, world) {
        const fragments = [];
        const base = String(character && character.playerDescription || "").trim();
        if (base) fragments.push(base);
        const records = equippedRecords(character);
        if (!records.some(function (record) { return record.slot === "clothing"; })) {
            fragments.push(`${character.name} is undressed.`);
        }
        records.filter(function (record) { return record.visible !== false; }).forEach(function (record) {
            const item = world.entities[record.itemId];
            const definition = getItemDefinition(item, world);
            const description = definition && typeof definition.equippedDescription === "string"
                ? definition.equippedDescription.trim() : "";
            if (description) fragments.push(description);
        });
        return fragments.join(" ");
    }

    function actorOwnsItem(actor, itemId, world) {
        const inventory = world.inventories[actor.inventoryId];
        return Boolean(inventory && inventory.itemIds.includes(itemId)) || equippedRecords(actor).some(function (record) { return record.itemId === itemId; });
    }

    function transformItem(item, resultDefinitionId, world) {
        const definition = getItemDefinition(resultDefinitionId, world);
        if (!definition) {
            throw new Error(`Missing result item definition ${resultDefinitionId}.`);
        }
        item.definitionId = definition.id;
        item.name = definition.name;
        return item;
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
        const equipmentMembership = {};
        const lockIds = new Set();
        Object.values(world.entities).forEach(function (entity) {
            if (entity && entity.type === "location") {
                locationExitEntries(entity).forEach(function (transition) {
                    if (transition.lockId) lockIds.add(transition.lockId);
                });
            }
        });

        for (const [definitionId, definition] of Object.entries(world.itemDefinitions || {})) {
            if (!definition || definition.id !== definitionId || typeof definition.name !== "string" || !definition.name.trim()) {
                return fail("ITEM_DEFINITION_INVALID", `Item definition ${definitionId} is invalid.`);
            }
            if (definition.description !== undefined && typeof definition.description !== "string") {
                return fail("ITEM_DESCRIPTION_INVALID", `Item definition ${definitionId} description must be text.`);
            }
            const equipSlots = definition.equipSlots === undefined ? [] : definition.equipSlots;
            if (!Array.isArray(equipSlots) || equipSlots.some(function (slot) { return typeof slot !== "string" || !slot.trim(); }) ||
                    new Set(equipSlots).size !== equipSlots.length) {
                return fail("ITEM_EQUIP_SLOTS_INVALID", `Item definition ${definitionId} has invalid equipSlots.`);
            }
            if (equipSlots.length > 0 && (typeof definition.equippedDescription !== "string" || !definition.equippedDescription.trim())) {
                return fail("ITEM_EQUIPPED_DESCRIPTION_INVALID", `Item definition ${definitionId} requires equippedDescription.`);
            }
            if (definition.keyLockId !== undefined &&
                    (typeof definition.keyLockId !== "string" || !LOCK_ID_PATTERN.test(definition.keyLockId) || !lockIds.has(definition.keyLockId))) {
                return fail("ITEM_KEY_LOCK_INVALID", `Item definition ${definitionId} references invalid lock ID ${String(definition.keyLockId)}.`);
            }
            for (const actionField of ["fillAction", "consumeAction"]) {
                const action = definition[actionField];
                if (action && !world.itemDefinitions[action.resultDefinitionId]) {
                    return fail("ITEM_TRANSFORM_TARGET_INVALID", `Item definition ${definitionId} references missing result definition ${action.resultDefinitionId}.`);
                }
            }
            if (definition.useAction) {
                const action = definition.useAction;
                if (!action || typeof action.actionLabel !== "string" || !action.actionLabel.trim() ||
                        typeof action.effectId !== "string" || !ItemEffectRegistry[action.effectId] ||
                        typeof action.publicText !== "string" || !action.publicText.trim() ||
                        typeof action.feedbackText !== "string" || !action.feedbackText.trim()) {
                    return fail("ITEM_USE_ACTION_INVALID", `Item definition ${definitionId} has an invalid useAction.`);
                }
                if (action.effectId === "utility_query" || action.effectId === "abstract_study") {
                    if (typeof action.inputLabel !== "string" || !action.inputLabel.trim()) return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} ${action.effectId} requires inputLabel.`);
                    if (action.inputPlaceholder !== undefined && typeof action.inputPlaceholder !== "string") return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} inputPlaceholder must be text.`);
                    if (action.inputMaxLength !== undefined && (!Number.isInteger(action.inputMaxLength) || action.inputMaxLength < 1 || action.inputMaxLength > 2000)) return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} inputMaxLength must be an integer from 1 to 2000.`);
                }
                if (action.effectId === "utility_query") {
                    if (typeof action.utilityPrompt !== "string" || !action.utilityPrompt.trim()) return fail("ITEM_UTILITY_QUERY_INVALID", `Item definition ${definitionId} utility_query requires utilityPrompt.`);
                    if (action.utilityMaxTokens !== undefined && (!Number.isInteger(action.utilityMaxTokens) || action.utilityMaxTokens < 64 || action.utilityMaxTokens > 4000)) return fail("ITEM_UTILITY_QUERY_INVALID", `Item definition ${definitionId} utilityMaxTokens must be an integer from 64 to 4000.`);
                }
            }
        }

        for (const inventory of Object.values(world.inventories)) {
            for (const itemId of inventory.itemIds) {
                const item = world.entities[itemId];
                if (!item || item.type !== "item") return fail("INVENTORY_ITEM_INVALID", `Inventory ${inventory.id} contains invalid item ${itemId}.`);
                if (itemMembership[itemId] || equipmentMembership[itemId]) return fail("ITEM_MULTIPLE_PLACEMENT", `Item ${itemId} has more than one physical placement.`);
                itemMembership[itemId] = inventory.id;
            }
        }

        for (const character of getCharacters(world)) {
            if (!Array.isArray(character.equippedItems)) return fail("CHARACTER_EQUIPMENT_INVALID", `Character ${character.id} equippedItems must be an array.`);
            const occupied = new Set();
            for (const record of character.equippedItems) {
                if (!record || typeof record.itemId !== "string" || typeof record.slot !== "string" || !record.slot.trim() || typeof record.visible !== "boolean") {
                    return fail("CHARACTER_EQUIPMENT_INVALID", `Character ${character.id} has an invalid equipment record.`);
                }
                if (occupied.has(record.slot)) return fail("EQUIPMENT_SLOT_CONFLICT", `Character ${character.id} has multiple items in slot ${record.slot}.`);
                occupied.add(record.slot);
                const item = world.entities[record.itemId];
                const definition = item && item.type === "item" ? getItemDefinition(item, world) : null;
                if (!item || !definition || !Array.isArray(definition.equipSlots) || !definition.equipSlots.includes(record.slot)) {
                    return fail("EQUIPMENT_ITEM_INVALID", `Character ${character.id} has invalid equipped item ${record.itemId}.`);
                }
                if (itemMembership[item.id] || equipmentMembership[item.id]) return fail("ITEM_MULTIPLE_PLACEMENT", `Item ${item.id} has more than one physical placement.`);
                if (item.containerId !== character.id) return fail("ITEM_CONTAINER_MISMATCH", `Equipped item ${item.id} containerId must match character ${character.id}.`);
                equipmentMembership[item.id] = character.id;
            }
        }

        for (const entity of Object.values(world.entities)) {
            if (entity.type !== "item") continue;
            if (!getItemDefinition(entity, world)) return fail("ITEM_DEFINITION_MISSING", `Item ${entity.id} references missing definition ${entity.definitionId}.`);
            const placedIn = itemMembership[entity.id] || equipmentMembership[entity.id];
            if (!placedIn || placedIn !== entity.containerId) return fail("ITEM_CONTAINER_MISMATCH", `Item ${entity.id} containerId does not match canonical placement.`);
            if (entity.abstractStudyProgressByCharacterId !== undefined) {
                const progressByReader = entity.abstractStudyProgressByCharacterId;
                if (!progressByReader || typeof progressByReader !== "object" || Array.isArray(progressByReader)) return fail("ITEM_STUDY_PROGRESS_INVALID", `Item ${entity.id} has invalid abstract-study reader progress.`);
                for (const [readerId, progress] of Object.entries(progressByReader)) {
                    if (!readerId || readerId.length > 160 || !progress || typeof progress !== "object" || Array.isArray(progress) ||
                            typeof progress.lastInput !== "string" || !progress.lastInput.trim() || progress.lastInput.length > 600 ||
                            !Number.isInteger(progress.depth) || progress.depth < 1 || progress.depth > 3) {
                        return fail("ITEM_STUDY_PROGRESS_INVALID", `Item ${entity.id} has invalid abstract-study progress for reader ${String(readerId)}.`);
                    }
                }
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
            if (!location.exits || typeof location.exits !== "object" || Array.isArray(location.exits)) {
                return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exits must be an object.`);
            }
            const exitTargets = new Set();
            for (const [exitKey, rawExit] of Object.entries(location.exits)) {
                const exit = locationExitEntries({ exits: { [exitKey]: rawExit } })[0];
                if (!exit.destinationId || !getLocation(exit.destinationId, world)) {
                    return fail("LOCATION_EXIT_INVALID", `Location ${location.id} has an invalid exit ${exitKey}.`);
                }
                if (exit.destinationId === location.id) {
                    return fail("LOCATION_EXIT_INVALID", `Location ${location.id} cannot exit to itself.`);
                }
                if (exitTargets.has(exit.destinationId)) {
                    return fail("LOCATION_EXIT_INVALID", `Location ${location.id} contains a duplicate exit to ${exit.destinationId}.`);
                }
                exitTargets.add(exit.destinationId);
                if (rawExit && typeof rawExit === "object" && !Array.isArray(rawExit)) {
                    if (rawExit.blocked !== undefined && typeof rawExit.blocked !== "boolean") {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} blocked must be Boolean.`);
                    }
                    if (rawExit.blockedReason !== undefined && typeof rawExit.blockedReason !== "string") {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} blockedReason must be text.`);
                    }
                    if (rawExit.lockId !== undefined && (typeof rawExit.lockId !== "string" || !LOCK_ID_PATTERN.test(rawExit.lockId))) {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} lockId is invalid.`);
                    }
                    if (rawExit.locked !== undefined && typeof rawExit.locked !== "boolean") {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} locked must be Boolean.`);
                    }
                    if (rawExit.lockedReason !== undefined && typeof rawExit.lockedReason !== "string") {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} lockedReason must be text.`);
                    }
                    if (!exit.lockId && (rawExit.locked !== undefined || rawExit.lockedReason !== undefined)) {
                        return fail("LOCATION_EXIT_INVALID", `Location ${location.id} exit ${exitKey} cannot define lock state without lockId.`);
                    }
                }
                if (exit.lockId) {
                    const reciprocal = reciprocalTransition(location.id, exit, world);
                    if (!reciprocal || reciprocal.lockId !== exit.lockId || reciprocal.locked !== exit.locked) {
                        return fail("LOCATION_EXIT_LOCK_MISMATCH", `Location ${location.id} exit ${exitKey} has an inconsistent reciprocal lock.`);
                    }
                }
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
            if (typeof character.sleeping !== "boolean") {
                return fail("CHARACTER_SLEEPING_INVALID", `Character ${character.id} sleeping must be Boolean.`);
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
            if (!Array.isArray(character.recentDialogue)) {
                return fail("CHARACTER_DIALOGUE_INVALID", `Character ${character.id} recentDialogue must be an array.`);
            }
            if (character.recentDialogue.length > setup.MindValidators.RECENT_DIALOGUE_LIMIT) {
                return fail("CHARACTER_DIALOGUE_INVALID", `Character ${character.id} recentDialogue exceeds the bounded dialogue window.`);
            }
            const beliefIds = new Set();
            for (const belief of character.mind.beliefs) {
                const recordValidation = setup.MindValidators.validateBeliefRecord(belief);
                if (!recordValidation.ok || beliefIds.has(belief.id)) {
                    return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate belief.`);
                }
                beliefIds.add(belief.id);
            }
            const relationshipTargets = new Set();
            for (const relationship of character.mind.relationships) {
                const recordValidation = setup.MindValidators.validateRelationshipRecord(relationship, character.id, world, { requireTargetExists: false });
                if (!recordValidation.ok || relationshipTargets.has(relationship.targetCharacterId)) {
                    return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate relationship.`);
                }
                relationshipTargets.add(relationship.targetCharacterId);
            }
            const memoryIds = new Set();
            for (const partition of ["recentMemories", "longTermMemories"]) {
                for (const memory of character.mind[partition]) {
                    const recordValidation = setup.MindValidators.validateMemoryRecord(memory);
                    if (!recordValidation.ok || memoryIds.has(memory.id)) {
                        return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate memory.`);
                    }
                    memoryIds.add(memory.id);
                }
            }
            for (const dialogue of character.recentDialogue) {
                const recordValidation = setup.MindValidators.validateRecentDialogueRecord(dialogue, world, { requireSpeakerExists: false });
                if (!recordValidation.ok) {
                    return fail("CHARACTER_DIALOGUE_INVALID", `Character ${character.id} contains an invalid recent dialogue record.`);
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
        if (world.schemaVersion !== WORLD_SCHEMA_VERSION) {
            return fail("WORLD_SCHEMA_VERSION_INVALID", `World schemaVersion must be ${WORLD_SCHEMA_VERSION}.`);
        }
        if (world.authoringRevision !== currentAuthoringRevision()) {
            return fail("WORLD_AUTHORING_REVISION_INVALID", "World authoringRevision does not match the current generated world.");
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
        if (!spatialResult.ok) return spatialResult;
        const itemResult = validateItemInvariants(world);
        if (!itemResult.ok) return itemResult;

        ensureAIState(world);
        for (const [characterId, continuation] of Object.entries(world.ai.continuations)) {
            if (!getCharacter(characterId, world)) {
                return fail("AI_CONTINUATION_CHARACTER_INVALID", `AI continuation references missing character ${characterId}.`);
            }
            if (continuation !== null && (typeof continuation !== "string" || continuation.length > 2000)) {
                return fail("AI_CONTINUATION_INVALID", `AI continuation for ${characterId} must be a string up to 2000 characters or null.`);
            }
        }
        return ok();
    }

    function currentAuthoringRevision() {
        const revision = setup.GeneratedWorldData && setup.GeneratedWorldData.authoringRevision;
        return typeof revision === "string" ? revision : "";
    }

    function prepareCurrentWorld(world) {
        if (!world.debug) {
            world.debug = {
                lastActionResult: null,
                controllerLog: [],
                repairs: [],
                migrationReports: []
            };
        }
        if (!Array.isArray(world.debug.repairs)) world.debug.repairs = [];
        if (!Array.isArray(world.debug.controllerLog)) world.debug.controllerLog = [];
        if (!Array.isArray(world.debug.migrationReports)) world.debug.migrationReports = [];

        if (!world.control || !world.control.assignments) {
            repairControlInvariant(world, "missing control state");
        } else {
            const controlResult = validateControlAssignments(world.control.assignments, world);
            if (!controlResult.ok) repairControlInvariant(world, controlResult.error.message);
        }
        if (!Number.isInteger(world.nextIntentId) || world.nextIntentId < 1) world.nextIntentId = 1;
        if (!Array.isArray(world.events)) world.events = [];
        world.events.forEach(function (event) {
            if (!event || typeof event !== "object") return;
            delete event.pendingFor;
            if (!Array.isArray(event.processedBy)) event.processedBy = [];
        });
        getCharacters(world).forEach(function (character) {
            character.recentDialogue = setup.MindValidators.sanitizeRecentDialogue(character.recentDialogue, world);
        });
        if (!world.ai || typeof world.ai !== "object") world.ai = { turnQueue: [], continuations: {} };
        if (typeof world.ai.inferenceSessionId !== "string" || !world.ai.inferenceSessionId.trim()) {
            world.ai.inferenceSessionId = createInferenceSessionId();
        }
        repairAIQueue(world);
        return world;
    }

    function ensureWorld() {
        if (!State.variables.world) {
            State.variables.world = createInitialWorld();
        }
        const status = setup.SaveMigration.getStatusForWorld(State.variables.world);
        if (!status.supported) {
            throw new Error("This save uses an unsupported world schema and cannot be migrated automatically.");
        }
        if (status.required) {
            throw new Error("This save must be migrated before gameplay can continue.");
        }
        return prepareCurrentWorld(State.variables.world);
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
        if (!inventory) {
            return [];
        }

        return inventory.itemIds.map(function (itemId) {
            const item = world.entities[itemId];
            return itemView(item, world);
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
        return setup.EventPerception.recipientsForEvent(event, world);
    }

    function enqueueObservation(recipientId, observation, world) {
        return setup.EventPerception.enqueueObservation(recipientId, observation, world);
    }

    function routeFeedback(feedback, action, world, metadata) {
        return setup.EventPerception.routeFeedback(feedback, action, world, metadata);
    }

    function acknowledgeEvent(eventId, characterId) {
        return setup.EventPerception.acknowledgeEvent(eventId, characterId, ensureWorld());
    }

    function dispatchEvent(event, world) {
        return setup.EventPerception.dispatchEvent(event, world);
    }

    function emitEvent(eventData, world) {
        return setup.EventPerception.emitEvent(eventData, world);
    }

    function renderItemActionText(template, values) {
        const replacements = values || {};
        return String(template || "").replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (match, key) {
            return Object.prototype.hasOwnProperty.call(replacements, key)
                ? String(replacements[key])
                : match;
        });
    }

    const ABSTRACT_STUDY_STOP_WORDS = new Set([
        "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "describe", "do", "does", "for", "from",
        "how", "i", "in", "including", "into", "is", "it", "learn", "learning", "method", "methods", "of", "on", "or",
        "practical", "practice", "practices", "question", "relevant", "safe", "safely", "simple", "step", "steps", "study",
        "studying", "subject", "suitable", "technique", "techniques", "the", "their", "them", "theory", "this", "to", "use",
        "using", "what", "when", "where", "which", "with", "would", "your", "novice", "beginner", "basic", "exact", "exercise",
        "exercises", "archive", "slab", "knowledge", "material", "materials"
    ]);

    function normalizeAbstractStudyToken(token) {
        let value = String(token || "").toLowerCase();
        if (value.length > 6 && value.endsWith("ing")) value = value.slice(0, -3);
        else if (value.length > 5 && value.endsWith("ed")) value = value.slice(0, -2);
        else if (value.length > 5 && value.endsWith("es")) value = value.slice(0, -2);
        else if (value.length > 4 && value.endsWith("s")) value = value.slice(0, -1);
        return value;
    }

    function abstractStudyTokens(text) {
        return String(text || "").toLowerCase()
            .replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/g, " ")
            .split(/\s+/)
            .map(normalizeAbstractStudyToken)
            .filter(function (token) {
                return token.length >= 3 && !ABSTRACT_STUDY_STOP_WORDS.has(token);
            });
    }

    function abstractStudyTopicsRelated(previousText, nextText) {
        const previousNormalized = String(previousText || "").trim().toLowerCase();
        const nextNormalized = String(nextText || "").trim().toLowerCase();
        if (!previousNormalized || !nextNormalized) return false;
        if (previousNormalized === nextNormalized) return true;
        const previous = new Set(abstractStudyTokens(previousNormalized));
        const next = new Set(abstractStudyTokens(nextNormalized));
        if (!previous.size || !next.size) return false;
        let overlap = 0;
        previous.forEach(function (token) {
            if (next.has(token)) overlap += 1;
        });
        if (overlap >= 2) return true;
        return overlap === 1 && Math.min(previous.size, next.size) <= 2;
    }

    function ensureAbstractStudyProgress(item) {
        if (!item.abstractStudyProgressByCharacterId || typeof item.abstractStudyProgressByCharacterId !== "object" ||
                Array.isArray(item.abstractStudyProgressByCharacterId)) {
            item.abstractStudyProgressByCharacterId = {};
        }
        return item.abstractStudyProgressByCharacterId;
    }

    function abstractStudyStage(actor, item, inputText) {
        const progressByReader = ensureAbstractStudyProgress(item);
        const previous = progressByReader[actor.id] && typeof progressByReader[actor.id] === "object"
            ? progressByReader[actor.id]
            : null;
        const related = Boolean(previous && abstractStudyTopicsRelated(previous.lastInput, inputText));
        const depth = related ? Math.min(3, Math.max(1, Number(previous.depth) || 1) + 1) : 1;
        progressByReader[actor.id] = {
            lastInput: inputText.slice(0, 600),
            depth: depth
        };
        return {
            id: depth === 1 ? "survey" : (depth === 2 ? "focused" : "saturated"),
            depth: depth,
            relatedToPrevious: related
        };
    }

    function abstractStudyFeedbackTemplate(useAction, stage) {
        if (stage.id === "focused" && typeof useAction.focusedFeedbackText === "string" && useAction.focusedFeedbackText.trim()) {
            return useAction.focusedFeedbackText;
        }
        if (stage.id === "saturated" && typeof useAction.saturatedFeedbackText === "string" && useAction.saturatedFeedbackText.trim()) {
            return useAction.saturatedFeedbackText;
        }
        return useAction.feedbackText;
    }

    const ItemEffectRegistry = {
        report_memory_counts: {
            execute: function (actor, item, definition, useAction) {
                const recentCount = actor.mind && Array.isArray(actor.mind.recentMemories)
                    ? actor.mind.recentMemories.length
                    : 0;
                const longTermCount = actor.mind && Array.isArray(actor.mind.longTermMemories)
                    ? actor.mind.longTermMemories.length
                    : 0;
                return {
                    feedback: [{
                        recipientId: actor.id,
                        kind: "observation",
                        code: "MEMORY_COUNTS_REPORTED",
                        text: renderItemActionText(useAction.feedbackText, {
                            actorName: actor.name,
                            itemName: definition.name,
                            shortTermCount: recentCount,
                            shortTermEntryWord: recentCount === 1 ? "entry" : "entries",
                            longTermCount: longTermCount,
                            longTermEntryWord: longTermCount === 1 ? "entry" : "entries"
                        }),
                        data: {
                            itemId: item.id,
                            effectId: useAction.effectId
                        }
                    }]
                };
            }
        },
        narrative_feedback: {
            execute: function (actor, item, definition, useAction) {
                return {
                    feedback: [{
                        recipientId: actor.id,
                        kind: "observation",
                        code: "ITEM_NARRATIVE_FEEDBACK",
                        text: renderItemActionText(useAction.feedbackText, {
                            actorName: actor.name,
                            itemName: definition.name
                        }),
                        data: { itemId: item.id, effectId: useAction.effectId }
                    }]
                };
            }
        },
        abstract_study: {
            execute: function (actor, item, definition, useAction, world, action) {
                const inputText = action && typeof action.input_text === "string" ? action.input_text.trim() : "";
                const stage = abstractStudyStage(actor, item, inputText);
                const feedbackTemplate = abstractStudyFeedbackTemplate(useAction, stage);
                return {
                    feedback: [{
                        recipientId: actor.id,
                        kind: "observation",
                        code: "ITEM_ABSTRACT_STUDY_RESULT",
                        text: renderItemActionText(feedbackTemplate, {
                            actorName: actor.name,
                            itemName: definition.name,
                            inputText: inputText,
                            studyStage: stage.id,
                            studyDepth: stage.depth
                        }),
                        data: {
                            itemId: item.id,
                            effectId: useAction.effectId,
                            inputText: inputText,
                            studyStage: stage.id,
                            studyDepth: stage.depth,
                            relatedToPrevious: stage.relatedToPrevious
                        }
                    }]
                };
            }
        },
        utility_query: {
            execute: function (actor, item, definition, useAction, world, action) {
                const inputText = action && typeof action.input_text === "string" ? action.input_text.trim() : "";
                return {
                    feedback: [],
                    modelRequests: [{
                        kind: "utility_query",
                        recipientId: actor.id,
                        itemId: item.id,
                        itemName: definition.name,
                        itemDescription: typeof definition.description === "string" ? definition.description : "",
                        effectId: useAction.effectId,
                        inputText: inputText,
                        systemPrompt: useAction.utilityPrompt,
                        feedbackText: useAction.feedbackText,
                        maxTokens: Number.isInteger(useAction.utilityMaxTokens) ? useAction.utilityMaxTokens : null
                    }]
                };
            }
        }
    };

    const TimelapseEffectRegistry = {
        collect_mugs_to_storage: {
            execute: function (actor, location, actionDefinition, world) {
                const params = actionDefinition.effectParams || {};
                const destination = world.inventories[params.destinationInventoryId];
                const emptyDefinition = world.itemDefinitions[params.emptyDefinitionId];
                if (!destination || !emptyDefinition) {
                    return fail("TIMELAPSE_EFFECT_INVALID", "The cleanup destination or empty mug definition is missing.");
                }

                const sourceInventoryIds = [location.inventoryId];
                getSublocations(location.id, world).forEach(function (sublocation) {
                    if (sublocation.inventoryId) sourceInventoryIds.push(sublocation.inventoryId);
                });

                const eligible = [];
                sourceInventoryIds.forEach(function (inventoryId) {
                    const inventory = world.inventories[inventoryId];
                    if (!inventory) return;
                    inventory.itemIds.slice().forEach(function (itemId) {
                        const item = world.entities[itemId];
                        const definition = getItemDefinition(item, world);
                        if (item && definition && definition.familyId === params.itemFamilyId) {
                            eligible.push({ item: item, source: inventory });
                        }
                    });
                });

                eligible.forEach(function (entry) {
                    transformItem(entry.item, params.emptyDefinitionId, world);
                    transferItem(entry.item.id, entry.source, destination, world);
                });

                const count = eligible.length;
                return ok({
                    text: count > 0
                        ? `${actor.name} cleaned ${location.name}, emptied ${count} mug${count === 1 ? "" : "s"}, and returned ${count === 1 ? "it" : "them"} to ${destination.name || "storage"}.`
                        : `${actor.name} cleaned ${location.name}, but there were no unattended mugs to put away.`,
                    affectedItemIds: eligible.map(function (entry) { return entry.item.id; })
                });
            }
        }
    };

    function timelapseActionDefinitions(location) {
        return Array.isArray(location && location.timelapseActions) ? location.timelapseActions : [];
    }

    function bedSublocations(locationId, world) {
        return getSublocations(locationId, world).filter(function (sublocation) {
            return Array.isArray(sublocation.capabilities) && sublocation.capabilities.includes("sleep");
        });
    }

    function canTraverseTimelapseTransition(actor, transition, world) {
        if (!transition || !transition.destinationId || transition.blocked) return false;
        if (!transition.lockId || !transition.locked) return true;
        return matchingKeyItems(actor, transition.lockId, world).length > 0;
    }

    function timelapseRoute(actor, destinationId, world) {
        if (!actor || !getLocation(destinationId, world)) return null;
        const startId = actor.locationId;
        const queue = [startId];
        const previous = new Map([[startId, null]]);
        while (queue.length > 0) {
            const locationId = queue.shift();
            if (locationId === destinationId) break;
            const location = getLocation(locationId, world);
            locationExitEntries(location).forEach(function (transition) {
                const nextId = transition.destinationId;
                if (!nextId || previous.has(nextId) || !canTraverseTimelapseTransition(actor, transition, world)) return;
                previous.set(nextId, locationId);
                queue.push(nextId);
            });
        }
        if (!previous.has(destinationId)) return null;
        const path = [];
        let cursor = destinationId;
        while (cursor !== null) {
            path.push(cursor);
            cursor = previous.get(cursor);
        }
        path.reverse();
        return path;
    }

    function getTimelapseReachableCatalog(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        return Object.values(world.entities).filter(function (entity) {
            return entity && entity.type === "location";
        }).map(function (location) {
            const route = timelapseRoute(actor, location.id, world);
            if (!route) return null;
            return {
                id: location.id,
                name: location.name,
                route: route,
                beds: bedSublocations(location.id, world).map(function (bed) {
                    return { id: bed.id, name: bed.name };
                }),
                timelapseActions: timelapseActionDefinitions(location).map(function (action) {
                    return { id: action.id, label: action.label, description: action.description };
                })
            };
        }).filter(Boolean);
    }

    function moveTimelapseActor(actorId, destinationId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        const destination = getLocation(destinationId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (!destination) return fail("DESTINATION_NOT_FOUND", "Timelapse destination does not exist.");
        const route = timelapseRoute(actor, destinationId, world);
        if (!route) return fail("TIMELAPSE_ROUTE_BLOCKED", "The planned destination is no longer reachable.");
        const fromLocationId = actor.locationId;
        if (fromLocationId === destinationId) {
            return ok({ actorId: actorId, fromLocationId: fromLocationId, toLocationId: destinationId, route: route, moved: false, text: "" });
        }
        const targetSublocation = getSublocation(destination.defaultSublocationId, world);
        if (!targetSublocation) return fail("DESTINATION_SUBLOCATION_INVALID", "Destination has no valid default position.");
        if (sublocationOccupants(targetSublocation.id, world, actor.id).length >= targetSublocation.capacity) {
            return fail("SUBLOCATION_FULL", "The destination's default position is full.");
        }
        actor.locationId = destinationId;
        actor.sublocationId = targetSublocation.id;
        const validation = validateWorld(world);
        if (!validation.ok) return validation;
        return ok({
            actorId: actorId,
            fromLocationId: fromLocationId,
            toLocationId: destinationId,
            route: route,
            moved: true,
            text: `${actor.name} moved from ${getLocation(fromLocationId, world).name} to ${destination.name}.`
        });
    }

    function executeTimelapseAction(actorId, locationId, action) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        const location = getLocation(locationId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (!location || actor.locationId !== locationId) return fail("TIMELAPSE_LOCATION_MISMATCH", "Actor is not in the selected timelapse location.");
        if (!action || typeof action !== "object" || Array.isArray(action) || typeof action.type !== "string") {
            return fail("TIMELAPSE_ACTION_INVALID", "Timelapse action must be an object with a type.");
        }

        if (action.type === "narrate") {
            const text = typeof action.text === "string" ? action.text.trim() : "";
            if (!text || text.length > 2000) return fail("TIMELAPSE_NARRATIVE_INVALID", "Timelapse narration must contain 1 to 2000 characters.");
            return ok({ actorId: actorId, locationId: locationId, type: "narrate", text: `${actor.name}: ${text}` });
        }

        if (action.type === "sleep") {
            const bed = getSublocation(action.bedId, world);
            if (!bed || bed.locationId !== locationId || !(bed.capabilities || []).includes("sleep")) {
                return fail("TIMELAPSE_BED_INVALID", "The selected bed is not available in this room.");
            }
            if (sublocationOccupants(bed.id, world, actor.id).length >= bed.capacity) {
                return fail("SUBLOCATION_FULL", "The selected bed is full.");
            }
            actor.sublocationId = bed.id;
            actor.sleeping = true;
            const validation = validateWorld(world);
            if (!validation.ok) return validation;
            return ok({ actorId: actorId, locationId: locationId, type: "sleep", bedId: bed.id, text: `${actor.name} went to sleep in ${location.name}.` });
        }

        if (action.type === "timelapse_action") {
            const definition = timelapseActionDefinitions(location).find(function (candidate) { return candidate.id === action.actionId; });
            if (!definition) return fail("TIMELAPSE_ACTION_UNAVAILABLE", "The selected timelapse action is not available in this room.");
            const effect = TimelapseEffectRegistry[definition.effectId];
            if (!effect) return fail("TIMELAPSE_EFFECT_UNKNOWN", "The selected timelapse effect is not supported by the engine.");
            const result = effect.execute(actor, location, definition, world);
            if (!result || !result.ok) return result || fail("TIMELAPSE_EFFECT_FAILED", "The timelapse action failed.");
            const validation = validateWorld(world);
            if (!validation.ok) return validation;
            return ok({
                actorId: actorId,
                locationId: locationId,
                type: "timelapse_action",
                actionId: definition.id,
                effectId: definition.effectId,
                text: result.text || `${actor.name} completed ${definition.label}.`,
                affectedItemIds: clone(result.affectedItemIds || [])
            });
        }

        return fail("TIMELAPSE_ACTION_INVALID", `Unknown timelapse action type: ${String(action.type)}.`);
    }

    const ActionRegistry = {
        move: {
            description: "Leave the current location and enter another directly connected location. destination_id must be one of this action's listed location IDs.",
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
                    destination_ids: locationExitEntries(location).map(function (entry) {
                        return entry.destinationId;
                    }).filter(Boolean)
                };
            },
            validate: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                const destination = getLocation(action.destination_id, world);

                if (!destination) {
                    return fail("DESTINATION_NOT_FOUND", "Destination does not exist.");
                }

                const transition = findLocationExit(location, destination.id);
                if (!transition) {
                    return fail(
                        "DESTINATION_NOT_REACHABLE",
                        "Destination is not connected to the current location."
                    );
                }

                if (transition.blocked) {
                    return fail("TRANSITION_BLOCKED", transition.blockedReason.trim() || "The way is blocked.");
                }
                if (transition.lockId && transition.locked) {
                    return fail("PASSAGE_LOCKED", transition.lockedReason.trim() || "The door is locked.");
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
                    type: "character_moved",
                    actorId: actor.id,
                    locationId: action.destination_id,
                    fromLocationId: fromLocationId,
                    toLocationId: action.destination_id,
                    fromSublocationId: fromSublocationId,
                    toSublocationId: actor.sublocationId,
                    text: `${actor.name} moved from ${getLocation(fromLocationId, world).name} to ${destination.name}.`
                }];
            }
        },

        unlock: {
            description: "Unlock a directly connected lockable passage using a matching key.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "unlock" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                return lockActionOptions(actor, world, true);
            },
            validate: function (actor, action, world) {
                return validateLockAction(actor, action, world, true);
            },
            execute: function (actor, action, world) {
                const destination = getLocation(action.destination_id, world);
                const transition = setPassageLocked(actor.locationId, action.destination_id, false, world);
                return [{
                    type: "passage_unlocked",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    destinationId: action.destination_id,
                    lockId: transition.lockId,
                    text: `${actor.name} unlocked the door to ${destination.name}.`
                }];
            }
        },

        lock: {
            description: "Lock a directly connected lockable passage using a matching key.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "lock" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                return lockActionOptions(actor, world, false);
            },
            validate: function (actor, action, world) {
                return validateLockAction(actor, action, world, false);
            },
            execute: function (actor, action, world) {
                const destination = getLocation(action.destination_id, world);
                const transition = setPassageLocked(actor.locationId, action.destination_id, true, world);
                return [{
                    type: "passage_locked",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    destinationId: action.destination_id,
                    lockId: transition.lockId,
                    text: `${actor.name} locked the door to ${destination.name}.`
                }];
            }
        },

        move_within_location: {
            description: "Stay in the current location and change only the current sublocation/position. destination_id must be one of this action's listed sublocation IDs, never a location ID.",
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
                const capabilities = new Set(sublocation.capabilities || []);
                const items = world.inventories[actor.inventoryId].itemIds.map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const action = definition && definition.fillAction;
                    if (!action || !capabilities.has(action.requiredEnvironmentCapability)) return null;
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: action.actionLabel,
                        required_environment_capability: action.requiredEnvironmentCapability,
                        result_definition_id: action.resultDefinitionId
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const fillAction = definition && definition.fillAction;
                if (!fillAction) {
                    return fail("ITEM_NOT_FILLABLE", "This item cannot be filled in its current state.");
                }
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!(sublocation.capabilities || []).includes(fillAction.requiredEnvironmentCapability)) {
                    return fail("CAPABILITY_REQUIRED", "This item cannot be filled in the current environment.");
                }
                if (!getItemDefinition(fillAction.resultDefinitionId, world)) {
                    return fail("RESULT_DEFINITION_MISSING", "The configured filled item definition does not exist.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const fromDefinition = getItemDefinition(item, world);
                const fillAction = fromDefinition.fillAction;
                const fromDefinitionId = fromDefinition.id;
                transformItem(item, fillAction.resultDefinitionId, world);
                return { events: [{
                    type: "item_transformed",
                    actorId: actor.id,
                    itemId: item.id,
                    actionType: "fill",
                    fromDefinitionId: fromDefinitionId,
                    toDefinitionId: item.definitionId,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} fills ${fromDefinition.name} with ale.`
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "ITEM_FILLED",
                    text: fillAction.feedbackText || `You fill ${fromDefinition.name}.`,
                    data: {
                        itemId: item.id,
                        fromDefinitionId: fromDefinitionId,
                        toDefinitionId: item.definitionId
                    }
                }] };
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
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const consumeAction = definition && definition.consumeAction;
                    if (!consumeAction) return null;
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: consumeAction.actionLabel,
                        result_type: consumeAction.resultType,
                        result_definition_id: consumeAction.resultDefinitionId
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const consumeAction = definition && definition.consumeAction;
                if (!consumeAction) {
                    return fail("ITEM_NOT_CONSUMABLE", "This item cannot be consumed in its current state.");
                }
                if (consumeAction.resultType !== "transform" || !getItemDefinition(consumeAction.resultDefinitionId, world)) {
                    return fail("CONSUME_RESULT_INVALID", "The configured consume result is invalid.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const fromDefinition = getItemDefinition(item, world);
                const consumeAction = fromDefinition.consumeAction;
                const fromDefinitionId = fromDefinition.id;
                transformItem(item, consumeAction.resultDefinitionId, world);
                return { events: [{
                    type: "item_transformed",
                    actorId: actor.id,
                    itemId: item.id,
                    actionType: "consume",
                    fromDefinitionId: fromDefinitionId,
                    toDefinitionId: item.definitionId,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} drinks the ale from ${fromDefinition.name}.`
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "ITEM_CONSUMED",
                    text: consumeAction.feedbackText || `You consume ${fromDefinition.name}.`,
                    data: {
                        itemId: item.id,
                        fromDefinitionId: fromDefinitionId,
                        toDefinitionId: item.definitionId
                    }
                }] };
            }
        },

        equip: {
            description: "Equip an owned item into one of that item's currently available slots.",
            schema: {
                type: "object",
                properties: { type: { const: "equip" }, item_id: { type: "string" }, slot: { type: "string" } },
                required: ["type", "item_id", "slot"]
            },
            getOptions: function (actor, world) {
                const occupied = new Set(equippedRecords(actor).map(function (record) { return record.slot; }));
                const inventory = world.inventories[actor.inventoryId];
                const items = (inventory ? inventory.itemIds : []).map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const slots = definition && Array.isArray(definition.equipSlots)
                        ? definition.equipSlots.filter(function (slot) { return !occupied.has(slot); }) : [];
                    if (!slots.length) return null;
                    return { id: item.id, name: definition.name, slots: slots.slice() };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                const inventory = world.inventories[actor.inventoryId];
                if (!inventory || !inventory.itemIds.includes(action.item_id)) return fail("ITEM_NOT_OWNED", "Actor does not possess this item in inventory.");
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                if (!definition || !Array.isArray(definition.equipSlots) || !definition.equipSlots.includes(action.slot)) return fail("EQUIP_SLOT_INVALID", "This item cannot be equipped in that slot.");
                if (equippedRecords(actor).some(function (record) { return record.slot === action.slot; })) return fail("EQUIP_SLOT_OCCUPIED", "That equipment slot is already occupied.");
                return ok();
            },
            execute: function (actor, action, world) {
                const inventory = world.inventories[actor.inventoryId];
                inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== action.item_id; });
                const item = world.entities[action.item_id];
                item.containerId = actor.id;
                actor.equippedItems.push({ itemId: item.id, slot: action.slot, visible: true });
                return [{ type: "item_equipped", actorId: actor.id, itemId: item.id, slot: action.slot,
                    locationId: actor.locationId, sublocationId: actor.sublocationId, text: `${actor.name} puts on ${item.name}.` }];
            }
        },

        unequip: {
            description: "Remove one currently equipped item and return it to inventory.",
            schema: {
                type: "object",
                properties: { type: { const: "unequip" }, item_id: { type: "string" } },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const items = equippedRecords(actor).map(function (record) {
                    const item = world.entities[record.itemId];
                    const definition = getItemDefinition(item, world);
                    return item && definition ? { id: item.id, name: definition.name, slot: record.slot } : null;
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action) {
                if (!equippedRecords(actor).some(function (record) { return record.itemId === action.item_id; })) return fail("ITEM_NOT_EQUIPPED", "Actor is not wearing this item.");
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                actor.equippedItems = actor.equippedItems.filter(function (record) { return record.itemId !== action.item_id; });
                world.inventories[actor.inventoryId].itemIds.push(item.id);
                item.containerId = actor.inventoryId;
                return [{ type: "item_unequipped", actorId: actor.id, itemId: item.id,
                    locationId: actor.locationId, sublocationId: actor.sublocationId, text: `${actor.name} takes off ${item.name}.` }];
            }
        },

        use_item: {
            description: "Use an owned item through its authored interaction. item_id must be one of this action's listed item IDs.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "use_item" },
                    item_id: { type: "string" },
                    input_text: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const inventory = world.inventories[actor.inventoryId];
                const ownedIds = (inventory ? inventory.itemIds.slice() : []).concat(equippedRecords(actor).map(function (record) { return record.itemId; }));
                const items = Array.from(new Set(ownedIds)).map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const useAction = definition && definition.useAction;
                    if (!useAction || !ItemEffectRegistry[useAction.effectId]) return null;
                    const queryInput = useAction.effectId === "utility_query" || useAction.effectId === "abstract_study";
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: useAction.actionLabel,
                        effect_id: useAction.effectId,
                        instructions: typeof useAction.aiInstructions === "string" ? useAction.aiInstructions : "",
                        input_required: queryInput,
                        input_label: queryInput ? useAction.inputLabel : "",
                        input_placeholder: queryInput && typeof useAction.inputPlaceholder === "string" ? useAction.inputPlaceholder : "",
                        input_max_length: queryInput && Number.isInteger(useAction.inputMaxLength) ? useAction.inputMaxLength : (queryInput ? 600 : 0)
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!actorOwnsItem(actor, action.item_id, world)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const useAction = definition && definition.useAction;
                if (!useAction) {
                    return fail("ITEM_NOT_USABLE", "This item has no authored use interaction.");
                }
                if (!ItemEffectRegistry[useAction.effectId]) {
                    return fail("ITEM_EFFECT_UNKNOWN", "The configured item effect is not supported by the engine.");
                }
                if (useAction.effectId === "utility_query" || useAction.effectId === "abstract_study") {
                    const inputText = typeof action.input_text === "string" ? action.input_text.trim() : "";
                    const maxLength = Number.isInteger(useAction.inputMaxLength) ? useAction.inputMaxLength : 600;
                    if (!inputText) return fail("ITEM_INPUT_REQUIRED", `${useAction.inputLabel || "Input"} is required.`);
                    if (inputText.length > maxLength) return fail("ITEM_INPUT_TOO_LONG", `${useAction.inputLabel || "Input"} must not exceed ${maxLength} characters.`);
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const useAction = definition.useAction;
                const effect = ItemEffectRegistry[useAction.effectId];
                const effectResult = effect.execute(actor, item, definition, useAction, world, action) || {};
                return {
                    events: [{
                        type: "item_used",
                        actorId: actor.id,
                        itemId: item.id,
                        actionType: "use_item",
                        effectId: useAction.effectId,
                        locationId: actor.locationId,
                        sublocationId: actor.sublocationId,
                        text: renderItemActionText(useAction.publicText, {
                            actorName: actor.name,
                            itemName: definition.name
                        })
                    }],
                    feedback: clone(effectResult.feedback || []),
                    modelRequests: clone(effectResult.modelRequests || [])
                };
            }
        },

        sleep: {
            description: "Fall asleep while lying on a bed.",
            schema: {
                type: "object",
                properties: { type: { const: "sleep" } },
                required: ["type"],
                additionalProperties: false
            },
            getOptions: function () { return {}; },
            validate: function (actor, action, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!sublocation || !(sublocation.capabilities || []).includes("sleep")) {
                    return fail("BED_REQUIRED", "You must be lying on a bed before sleeping.");
                }
                return ok();
            },
            execute: function (actor) {
                actor.sleeping = true;
                return [{
                    type: "character_slept",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} went to sleep.`
                }];
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
        const environmentCapabilities = new Set(sublocation.capabilities || []);
        const actorInventory = world.inventories[actor.inventoryId];
        for (const itemId of actorInventory ? actorInventory.itemIds : []) {
            const item = world.entities[itemId];
            const definition = getItemDefinition(item, world);
            if (!definition) continue;
            if (Array.isArray(definition.equipSlots) && definition.equipSlots.some(function (slot) {
                    return !equippedRecords(actor).some(function (record) { return record.slot === slot; });
                })) {
                grant("equip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
            if (definition.fillAction && environmentCapabilities.has(definition.fillAction.requiredEnvironmentCapability)) {
                grant("fill", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name
                });
            }
            if (definition.consumeAction) {
                grant("consume", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name
                });
            }
            if (definition.useAction && ItemEffectRegistry[definition.useAction.effectId]) {
                grant("use_item", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name,
                    effectId: definition.useAction.effectId
                });
            }
        }
        equippedRecords(actor).forEach(function (record) {
            const item = world.entities[record.itemId];
            const definition = getItemDefinition(item, world);
            if (!item || !definition) return;
            grant("unequip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name, slot: record.slot });
            if (definition.useAction && ItemEffectRegistry[definition.useAction.effectId]) {
                grant("use_item", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name, effectId: definition.useAction.effectId });
            }
        });

        const location = getLocation(actor.locationId, world);
        locationExitEntries(location).forEach(function (transition) {
            if (!transition.lockId) return;
            matchingKeyItems(actor, transition.lockId, world).forEach(function (keyItem) {
                const definition = getItemDefinition(keyItem, world);
                grant(transition.locked ? "unlock" : "lock", {
                    kind: "item_key",
                    id: keyItem.id,
                    definitionId: definition && definition.id || keyItem.definitionId,
                    name: definition && definition.name || keyItem.name,
                    lockId: transition.lockId,
                    destinationId: transition.destinationId
                });
            });
        });

        for (const abilityId of (actor.abilityIds || [])) {
            const ability = world.abilities[abilityId];
            if (ability) grant(ability.actionType, { kind: "character_ability", id: ability.id, name: ability.name });
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
                playerDescription: actor.playerDescription || "",
                appearance_text: characterAppearanceText(actor, world),
                equipped_items: equippedRecords(actor).map(function (record) { return equippedItemView(record, world); }).filter(Boolean),
                controller_id: world.control.assignments[actor.id],
                location_id: actor.locationId,
                sublocation_id: actor.sublocationId,
                sleeping: actor.sleeping === true,
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
                        presence_text: characterAppearanceText(character, world) || `${character.name} is here.`,
                        equipped_items: equippedRecords(character).map(function (record) { return equippedItemView(record, world); }).filter(Boolean),
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
                exits: locationExitEntries(location).map(function (transition) {
                    const destination = getLocation(transition.destinationId, world);
                    return { id: destination.id, name: destination.name };
                })
            },
            accessible_inventories: accessibleInventories(actor, world).map(function (inventory) {
                const owner = world.entities[inventory.ownerId];
                return {
                    id: inventory.id,
                    owner_id: inventory.ownerId,
                    name: inventory.name || (owner ? owner.name : inventory.id),
                    items: inventoryItems(inventory.id, world)
                };
            }),
            available_actions: getAvailableActions(actorId)
        };
    }

    function actionRequestErrors(action, actionDefinition) {
        const errors = [];
        if (!action || typeof action !== "object" || Array.isArray(action) || typeof action.type !== "string") {
            return ["Action must be one object with a string type."];
        }
        if (!actionDefinition) return [`Action ${String(action.type)} is not currently available.`];
        const schema = actionDefinition.schema || {};
        const properties = schema.properties || {};
        const required = schema.required || ["type"];
        Object.keys(action).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`Action field ${key} is not allowed for ${action.type}.`);
        });
        required.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) errors.push(`Action field ${key} is required for ${action.type}.`);
        });
        Object.keys(properties).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) return;
            const rule = properties[key] || {};
            const value = action[key];
            if (Object.prototype.hasOwnProperty.call(rule, "const") && value !== rule.const) errors.push(`Action field ${key} has an invalid value.`);
            if (rule.type === "string" && typeof value !== "string") errors.push(`Action field ${key} must be a string.`);
            if (rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`Action field ${key} must be a finite number.`);
            if (rule.type === "integer" && !Number.isInteger(value)) errors.push(`Action field ${key} must be an integer.`);
            if (typeof rule.minimum === "number" && typeof value === "number" && value < rule.minimum) errors.push(`Action field ${key} is below its minimum.`);
            if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`Action field ${key} selected an invalid value.`);
        });
        const options = actionDefinition.options && typeof actionDefinition.options === "object" ? actionDefinition.options : {};
        const optionKeys = {
            destination_id: "destination_ids",
            item_id: "item_ids",
            target_id: "target_ids",
            target_inventory_id: "target_inventory_ids"
        };
        Object.entries(optionKeys).forEach(function (entry) {
            const propertyKey = entry[0];
            const optionKey = entry[1];
            if (!Object.prototype.hasOwnProperty.call(action, propertyKey) || !Array.isArray(options[optionKey])) return;
            if (!options[optionKey].includes(action[propertyKey])) errors.push(`Action field ${propertyKey} selected an unavailable option.`);
        });
        if (Object.prototype.hasOwnProperty.call(action, "amount") && typeof options.maximum_amount === "number" &&
                typeof action.amount === "number" && action.amount > options.maximum_amount) {
            errors.push("Action amount exceeds the currently available maximum.");
        }
        if (action.type === "equip" && typeof action.item_id === "string" && typeof action.slot === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate.id === action.item_id; });
            if (!itemOption || !Array.isArray(itemOption.slots) || !itemOption.slots.includes(action.slot)) {
                errors.push("Action field slot selected an unavailable option for the selected item.");
            }
        }
        if (action.type === "use_item" && typeof action.item_id === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate.id === action.item_id; });
            if (itemOption && itemOption.input_required) {
                const inputText = typeof action.input_text === "string" ? action.input_text.trim() : "";
                const maxLength = Number.isInteger(itemOption.input_max_length) ? itemOption.input_max_length : 600;
                if (!inputText) errors.push(`Action field input_text is required for ${itemOption.action_label || action.item_id}.`);
                else if (inputText.length > maxLength) errors.push(`Action field input_text exceeds the maximum length of ${maxLength}.`);
            }
        }
        return errors;
    }

    function validateActionRequest(actorId, action) {
        const actor = getCharacter(actorId, ensureWorld());
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const available = getAvailableActions(actorId);
        const definition = action && typeof action === "object" ? available[action.type] : null;
        const errors = actionRequestErrors(action, definition);
        if (errors.length > 0) {
            return fail("ACTION_CONTRACT_REJECTED", errors[0], { details: errors });
        }
        return ok({ action: clone(action) });
    }

    function recordGroundedActionFailure(actorId, action, errorData, metadata) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return { ok: false, action: clone(action || {}), events: [], feedback: [], error: { code: "ACTOR_NOT_FOUND", message: "Actor character does not exist." } };
        if (actor.sleeping === true) actor.sleeping = false;
        const normalizedError = {
            code: errorData && errorData.code || "ACTION_FAILED",
            message: errorData && errorData.message || "The formal action could not be completed."
        };
        const feedback = [{
            recipientId: actor.id,
            kind: "observation",
            code: normalizedError.code,
            text: normalizedError.message,
            data: { ok: false, action: clone(action || {}), targetId: action && action.target_id || null }
        }];
        routeFeedback(feedback, action || { type: "unknown" }, world, metadata);
        const result = { ok: false, action: clone(action || {}), events: [], feedback: clone(feedback), error: normalizedError };
        world.debug.lastActionResult = clone(result);
        return result;
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

        if (actor.sleeping === true) actor.sleeping = false;

        const validation = definition.validate(actor, action, world);
        if (!validation.ok) {
            const feedback = [{
                recipientId: actor.id, kind: "observation", code: validation.error.code,
                text: validation.error.message, data: clone(action)
            }];
            routeFeedback(feedback, action, world, metadata);
            const events = [];
            if (action.type === "move" && validation.error.code === "PASSAGE_LOCKED") {
                const attemptEvent = setup.EventPerception.emitLockedPassageAttempt(actor.id, action.destination_id, world, metadata);
                if (attemptEvent) events.push(clone(attemptEvent));
            }
            const result = { ok: false, action: clone(action), events: events, feedback: feedback, error: clone(validation.error) };
            world.debug.lastActionResult = result;
            return result;
        }

        const snapshot = clone(world);

        try {
            const raw = definition.execute(actor, action, world);
            const rawEvents = Array.isArray(raw) ? raw : (raw.events || []);
            const feedback = Array.isArray(raw) ? [] : clone(raw.feedback || []);
            const modelRequests = Array.isArray(raw) ? [] : clone(raw.modelRequests || []);
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
            if (world.control.assignments[actor.id] === "ai" && action.type !== "sleep") {
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

            const result = { ok: true, action: clone(action), events: clone(events), feedback: feedback, modelRequests: modelRequests, error: null };
            world.debug.lastActionResult = result;
            return result;
        } catch (error) {
            State.variables.world = snapshot;
            world = getWorld();
            const failure = { code: "ACTION_EXECUTION_FAILED", message: error.message };
            if (world.control.assignments[actorId] === "ai") {
                return recordGroundedActionFailure(actorId, action, failure, metadata);
            }
            const result = { ok: false, action: clone(action), events: [], feedback: [], error: failure };
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
        const parsed = setup.EventPerception.parseStructuredNarrative(text);
        const hasStructuredSpeech = input && Object.prototype.hasOwnProperty.call(input, "spokenText");
        const hasStructuredNarrative = input && Object.prototype.hasOwnProperty.call(input, "publicNarrative");
        const spokenText = hasStructuredSpeech
            ? (typeof input.spokenText === "string" ? input.spokenText.trim() : "")
            : parsed.spokenText;
        const publicNarrative = hasStructuredNarrative
            ? (typeof input.publicNarrative === "string" ? input.publicNarrative.trim() : "")
            : parsed.publicNarrative;

        const targetId = input.target_id || "";
        const narrativeLocationId = metadata && metadata.locationId || actor.locationId;
        if (targetId) {
            const target = getCharacter(targetId, world);
            if (!target || target.locationId !== narrativeLocationId) {
                return fail("TARGET_NOT_NEARBY", "Narrative target is not nearby.");
            }
        }

        const noticeability = SPEECH_LOUDNESS_VALUES.includes(input.noticeability)
            ? input.noticeability
            : "noticeable";

        if (actor.sleeping === true) actor.sleeping = false;

        const event = emitEvent({
            type: "narrative_input",
            actorId: actor.id,
            targetId: targetId,
            locationId: narrativeLocationId,
            noticeability: noticeability,
            interactionId: metadata && metadata.interactionId || null,
            text: text,
            publicNarrative: publicNarrative || null,
            spokenText: spokenText || null,
            spokenTargetId: spokenText ? (targetId || null) : null,
            spokenLoudness: spokenText ? noticeability : null
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

        if (action) {
            const contractValidation = validateActionRequest(actorId, action);
            if (!contractValidation.ok) return contractValidation;
        }

        const snapshot = clone(world);
        const interactionId = world.nextIntentId++;
        let actionResult = null;
        let narrativeResult = null;

        try {
            if (text) {
                narrativeResult = submitNarrative(actorId, {
                    text: text,
                    target_id: input.target_id || "",
                    noticeability: input.noticeability || "noticeable",
                    publicNarrative: Object.prototype.hasOwnProperty.call(input, "publicNarrative") ? input.publicNarrative : undefined,
                    spokenText: Object.prototype.hasOwnProperty.call(input, "spokenText") ? input.spokenText : undefined
                }, {
                    interactionId: interactionId,
                    locationId: actor.locationId
                });
                if (!narrativeResult.ok) throw narrativeResult.error;
            }
            if (action) {
                actionResult = executeAction(actorId, action, { interactionId: interactionId });
            }
            const validation = validateWorld(getWorld());
            if (!validation.ok) throw validation.error;
            const result = ok({
                interactionId: interactionId,
                action: action,
                actionResult: actionResult,
                narrativeResult: narrativeResult,
                narrativeSuppressed: false
            });
            getWorld().debug.lastActionResult = clone(result);
            return result;
        } catch (error) {
            State.variables.world = snapshot;
            return fail(error && error.code || "INTENT_EXECUTION_FAILED", error && error.message || "The combined intent could not be executed.");
        }
    }

    function getPendingEventsFor(characterId) {
        return setup.EventPerception.getPendingEventsFor(characterId, ensureWorld());
    }

    function updateCharacterProfile(characterId, input) {
        const world = ensureWorld();
        const character = getCharacter(characterId, world);
        if (!character) return fail("CHARACTER_NOT_FOUND", "Character does not exist.");
        input = input && typeof input === "object" ? input : {};
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const playerDescription = typeof input.playerDescription === "string" ? input.playerDescription.trim() : "";
        if (!name || name.length > 120) {
            return fail("CHARACTER_NAME_INVALID", "Character name must contain 1 to 120 characters.");
        }
        if (playerDescription.length > 2000) {
            return fail("CHARACTER_DESCRIPTION_INVALID", "Character description must not exceed 2000 characters.");
        }
        character.name = name;
        character.playerDescription = playerDescription;
        if (world.inventories[character.inventoryId]) world.inventories[character.inventoryId].name = name;
        const validation = validateWorld(world);
        if (!validation.ok) return validation;
        return ok({
            characterId: characterId,
            name: character.name,
            playerDescription: character.playerDescription
        });
    }

    setup.GameInternals = {
        LEGACY_WORLD_VERSION: LEGACY_WORLD_VERSION,
        WORLD_SCHEMA_VERSION: WORLD_SCHEMA_VERSION,
        SUPPORTED_MIGRATION_SCHEMA_VERSIONS: Array.from(SUPPORTED_MIGRATION_SCHEMA_VERSIONS),
        CONTROLLER_IDS: CONTROLLER_IDS,
        clone: clone,
        ok: ok,
        fail: fail,
        createInitialWorld: createInitialWorld,
        getCharacters: getCharacters,
        getCharacter: getCharacter,
        getLocation: getLocation,
        getSublocation: getSublocation,
        locationExitEntries: locationExitEntries,
        inventoryItems: inventoryItems,
        positionText: positionText,
        validateWorld: validateWorld,
        validateControlAssignments: validateControlAssignments,
        repairControlInvariant: repairControlInvariant,
        repairAIQueue: repairAIQueue,
        hydrateAIQueueFromPendingObservations: hydrateAIQueueFromPendingObservations,
        currentAuthoringRevision: currentAuthoringRevision,
        ensureWorld: ensureWorld,
        enqueueAITurn: enqueueAITurn,
        pushDebugLog: pushDebugLog,
        enqueueObservation: enqueueObservation,
        createInferenceSessionId: createInferenceSessionId
    };

    setup.Game = {
        WORLD_VERSION: WORLD_SCHEMA_VERSION,
        WORLD_SCHEMA_VERSION: WORLD_SCHEMA_VERSION,
        ActionRegistry: ActionRegistry,
        ItemEffectRegistry: ItemEffectRegistry,
        TimelapseEffectRegistry: TimelapseEffectRegistry,
        createInitialWorld: createInitialWorld,
        bootstrap: function () {
            if (!State.variables.world) {
                State.variables.world = createInitialWorld();
                return ok({ created: true, migrationRequired: false });
            }
            const migration = setup.SaveMigration.getStatusForWorld(State.variables.world);
            if (!migration.supported) return migrationFailure(migration);
            if (migration.required) return ok({ migrationRequired: true, migration: clone(migration) });
            const world = prepareCurrentWorld(State.variables.world);
            hydrateAIQueueFromPendingObservations(world);
            const validation = validateWorld(world);
            return validation.ok ? ok({ migrationRequired: false }) : validation;
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
        updateCharacterProfile: updateCharacterProfile,
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
        repair: function () { const world = ensureWorld(); hydrateAIQueueFromPendingObservations(world); return getAIQueueStatus(world); }
    };

    setup.TimelapseAPI = {
        getReachableCatalog: getTimelapseReachableCatalog,
        moveToLocation: moveTimelapseActor,
        executeAction: executeTimelapseAction,
        getBeds: function (locationId) {
            return bedSublocations(locationId, ensureWorld()).map(function (bed) { return { id: bed.id, name: bed.name }; });
        }
    };

    setup.CharacterAPI = {
        getView: getCharacterView,
        getAvailableActions: getAvailableActions,
        validateActionRequest: validateActionRequest,
        recordGroundedActionFailure: recordGroundedActionFailure,
        perform: executeAction,
        narrate: submitNarrative,
        submitIntent: submitIntent,
        getSpeechLoudnessValues: function () { return SPEECH_LOUDNESS_VALUES.slice(); }
    };
}());
