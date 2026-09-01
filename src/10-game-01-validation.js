(function () {
    "use strict";

    function create(deps) {
        if (!deps || typeof deps !== "object") throw new Error("GameValidation requires dependencies.");
        const { ok, fail, validCustomTravelerAuthoring, getCharacters, getCharacter, validIntimateMotivationRecord, getLocation, locationRequiresDiscovery, characterRequiresDiscovery, locationExitEntries, reciprocalTransition, getSublocation, getItemDefinition, sublocationOccupants, effectiveSleepCapacity, sleepingSublocationOccupants, currentAuthoringRevision, knowledgeMatchTokens, CONTROLLER_IDS, LOCK_ID_PATTERN, TIME_PHASES, WORLD_SCHEMA_VERSION, itemEffectSupported, abilityEffectSupported } = deps;

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
                if (character.playerControllable === false) {
                    return fail("CHARACTER_NOT_PLAYER_CONTROLLABLE", `Character ${character.id} cannot be assigned to HumanController.`);
                }
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
            return previous[character.id] === "human" && character.playerControllable !== false;
        });

        if (previousHumans.length === 1) {
            chosenHumanId = previousHumans[0].id;
        } else if (getCharacter("player", world) && getCharacter("player", world).playerControllable !== false) {
            chosenHumanId = "player";
        } else if (characters.some(function (character) { return character.playerControllable !== false; })) {
            chosenHumanId = characters.find(function (character) { return character.playerControllable !== false; }).id;
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

    function synchronizeDerivedItemPlacement(world) {
        return setup.WorldDerivedState.synchronizeItemPlacement(world);
    }

    function validateItemInvariants(world) {
        const itemMembership = {};
        const equipmentMembership = {};
        const lockIds = new Set();
        Object.values(world.entities).forEach(function (entity) {
            if (entity && entity.type === "location") {
                locationExitEntries(entity, world).forEach(function (transition) {
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
            if (definition.externalSaleValue !== undefined && (!Number.isInteger(definition.externalSaleValue) || definition.externalSaleValue < 0)) {
                return fail("ITEM_EXTERNAL_SALE_VALUE_INVALID", `Item definition ${definitionId} externalSaleValue must be a non-negative integer.`);
            }
            if (definition.writable !== undefined && typeof definition.writable !== "boolean") {
                return fail("ITEM_WRITABLE_INVALID", `Item definition ${definitionId} writable must be Boolean.`);
            }
            if (definition.writingCapability !== undefined && typeof definition.writingCapability !== "boolean") {
                return fail("ITEM_WRITING_CAPABILITY_INVALID", `Item definition ${definitionId} writingCapability must be Boolean.`);
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
            if (definition.fillAction && !world.itemDefinitions[definition.fillAction.resultDefinitionId]) {
                return fail("ITEM_TRANSFORM_TARGET_INVALID", `Item definition ${definitionId} references missing fill result definition ${definition.fillAction.resultDefinitionId}.`);
            }
            if (definition.consumeAction) {
                const consumeAction = definition.consumeAction;
                if (!["transform", "remove"].includes(consumeAction.resultType)) {
                    return fail("ITEM_CONSUME_ACTION_INVALID", `Item definition ${definitionId} has invalid consume resultType ${String(consumeAction.resultType)}.`);
                }
                if (consumeAction.resultType === "transform" && !world.itemDefinitions[consumeAction.resultDefinitionId]) {
                    return fail("ITEM_TRANSFORM_TARGET_INVALID", `Item definition ${definitionId} references missing consume result definition ${consumeAction.resultDefinitionId}.`);
                }
                if (consumeAction.resultType === "remove" && consumeAction.resultDefinitionId) {
                    return fail("ITEM_CONSUME_ACTION_INVALID", `Item definition ${definitionId} remove consume action must not define resultDefinitionId.`);
                }
            }
            if (definition.useAction) {
                const action = definition.useAction;
                if (!action || typeof action.actionLabel !== "string" || !action.actionLabel.trim() ||
                        typeof action.effectId !== "string" || !itemEffectSupported(action.effectId) ||
                        typeof action.publicText !== "string" || !action.publicText.trim() ||
                        typeof action.feedbackText !== "string" || !action.feedbackText.trim()) {
                    return fail("ITEM_USE_ACTION_INVALID", `Item definition ${definitionId} has an invalid useAction.`);
                }
                if (action.effectId === "utility_query" || action.effectId === "abstract_study") {
                    if (typeof action.inputLabel !== "string" || !action.inputLabel.trim()) return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} ${action.effectId} requires inputLabel.`);
                    if (action.inputPlaceholder !== undefined && typeof action.inputPlaceholder !== "string") return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} inputPlaceholder must be text.`);
                    if (action.inputMaxLength !== undefined && (!Number.isInteger(action.inputMaxLength) || action.inputMaxLength < 1 || action.inputMaxLength > 2000)) return fail("ITEM_TEXT_INPUT_INVALID", `Item definition ${definitionId} inputMaxLength must be an integer from 1 to 2000.`);
                }
                if (action.effectId === "abstract_study" && action.knowledgeEntries !== undefined) {
                    if (!Array.isArray(action.knowledgeEntries) || action.knowledgeEntries.length > 500) {
                        return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledgeEntries must be an array with at most 500 entries.`);
                    }
                    const knowledgeEntryIds = new Set();
                    for (const entry of action.knowledgeEntries) {
                        if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 120 || knowledgeEntryIds.has(entry.id)) {
                            return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} has an invalid or duplicate knowledge entry ID.`);
                        }
                        knowledgeEntryIds.add(entry.id);
                        if (entry.title !== undefined && (typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 240)) {
                            return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} has an invalid title.`);
                        }
                        if (typeof entry.article !== "string" || !entry.article.trim() || entry.article.length > 8000) {
                            return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} must contain article text up to 8000 characters.`);
                        }
                        if (entry.priority !== undefined && (!Number.isInteger(entry.priority) || entry.priority < -1000 || entry.priority > 1000)) {
                            return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} priority must be an integer from -1000 to 1000.`);
                        }
                        if (!Array.isArray(entry.keywords) || entry.keywords.length < 1 || entry.keywords.length > 32) {
                            return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} requires 1 to 32 keywords.`);
                        }
                        const seenKeywords = new Set();
                        for (const keyword of entry.keywords) {
                            if (typeof keyword !== "string" || !keyword.trim() || keyword.length > 120 || seenKeywords.has(keyword)) {
                                return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} has an invalid or duplicate keyword.`);
                            }
                            seenKeywords.add(keyword);
                            const starIndex = keyword.indexOf("*");
                            if (starIndex >= 0 && (starIndex !== keyword.length - 1 || keyword.lastIndexOf("*") !== starIndex)) {
                                return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} keyword ${keyword} may use only one trailing wildcard.`);
                            }
                            const stem = keyword.endsWith("*") ? keyword.slice(0, -1).trim() : keyword.trim();
                            if (!stem || knowledgeMatchTokens(stem).length < 1) {
                                return fail("ITEM_KNOWLEDGE_ENTRIES_INVALID", `Item definition ${definitionId} knowledge entry ${entry.id} contains an unusable keyword.`);
                            }
                        }
                    }
                }
                if (action.effectId === "utility_query") {
                    if (typeof action.utilityPrompt !== "string" || !action.utilityPrompt.trim()) return fail("ITEM_UTILITY_QUERY_INVALID", `Item definition ${definitionId} utility_query requires utilityPrompt.`);
                    if (action.utilityMaxTokens !== undefined && (!Number.isInteger(action.utilityMaxTokens) || action.utilityMaxTokens < 64 || action.utilityMaxTokens > 4000)) return fail("ITEM_UTILITY_QUERY_INVALID", `Item definition ${definitionId} utilityMaxTokens must be an integer from 64 to 4000.`);
                }
            }
        }

        for (const inventory of Object.values(world.inventories)) {
            if (inventory.transparent !== undefined && typeof inventory.transparent !== "boolean") {
                return fail("INVENTORY_TRANSPARENCY_INVALID", `Inventory ${inventory.id} transparent must be Boolean when present.`);
            }
            if (inventory.requiredKeyItemId !== undefined && inventory.requiredKeyItemId !== null) {
                if (typeof inventory.requiredKeyItemId !== "string" || !inventory.requiredKeyItemId.trim()) {
                    return fail("INVENTORY_KEY_INVALID", `Inventory ${inventory.id} has an invalid required key item ID.`);
                }
                const keyItem = world.entities[inventory.requiredKeyItemId];
                if (!keyItem || keyItem.type !== "item") {
                    return fail("INVENTORY_KEY_MISSING", `Inventory ${inventory.id} references missing required key item ${String(inventory.requiredKeyItemId)}.`);
                }
            }
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
                equipmentMembership[item.id] = character.id;
            }
        }

        for (const entity of Object.values(world.entities)) {
            if (entity.type !== "item") continue;
            const runtimeDefinition = getItemDefinition(entity, world);
            if (!runtimeDefinition) return fail("ITEM_DEFINITION_MISSING", `Item ${entity.id} references missing definition ${entity.definitionId}.`);
            if (runtimeDefinition.writable === true && (typeof entity.content !== "string" || entity.content.length > 12000)) {
                return fail("ITEM_CONTENT_INVALID", `Writable item ${entity.id} content must be text up to 12000 characters.`);
            }
            if (entity.tradeProvenance !== undefined) {
                const provenance = entity.tradeProvenance;
                if (!provenance || typeof provenance !== "object" || Array.isArray(provenance) ||
                        !getCharacter(provenance.ownerCharacterId, world) || !["sale_stock", "acquired_stock"].includes(provenance.role) ||
                        !Number.isInteger(provenance.dayNumber) || provenance.dayNumber < 0) {
                    return fail("ITEM_TRADE_PROVENANCE_INVALID", `Item ${entity.id} has invalid trade provenance.`);
                }
            }
            const placedIn = itemMembership[entity.id] || equipmentMembership[entity.id];
            if (!placedIn) return fail("ITEM_CONTAINER_MISSING", `Item ${entity.id} does not have a canonical physical placement.`);
            // Inventory/equipment membership is canonical. containerId is derived and synchronized separately.
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
                const exit = setup.PassageRules.locationExitEntries({ exits: { [exitKey]: rawExit } })[0];
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
            if (sublocation.sleepCapacity !== undefined) {
                if (!Number.isInteger(sublocation.sleepCapacity) || sublocation.sleepCapacity < 1 || sublocation.sleepCapacity > sublocation.capacity) {
                    return fail("INVALID_SUBLOCATION_SLEEP_CAPACITY", `Sublocation ${sublocation.id} has invalid sleepCapacity.`);
                }
                if (!(sublocation.capabilities || []).includes("sleep")) {
                    return fail("INVALID_SUBLOCATION_SLEEP_CAPACITY", `Sublocation ${sublocation.id} defines sleepCapacity without sleep capability.`);
                }
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
            if (sleepingSublocationOccupants(sublocation.id, world).length > effectiveSleepCapacity(sublocation)) {
                return fail("SUBLOCATION_SLEEP_CAPACITY_EXCEEDED", `Sublocation ${sublocation.id} exceeds sleeping capacity.`);
            }
        }

        for (const character of getCharacters(world)) {
            if (setup.Presence && typeof setup.Presence.validateState === "function") {
                const presenceValidation = setup.Presence.validateState(character, world);
                if (!presenceValidation.ok) return presenceValidation;
            }
            if (!["active", "inactive"].includes(character.activationState)) {
                return fail("CHARACTER_ACTIVATION_INVALID", `Character ${character.id} activationState must be active or inactive.`);
            }
            const inactive = character.activationState === "inactive";
            const location = getLocation(character.locationId, world);
            const sublocation = getSublocation(character.sublocationId, world);
            if (inactive) {
                if (character.locationId !== null || character.sublocationId !== null) return fail("CHARACTER_INACTIVE_POSITION_INVALID", `Inactive character ${character.id} must be off-map.`);
            } else {
                if (!location) return fail("CHARACTER_LOCATION_INVALID", `Character ${character.id} has an invalid location.`);
                if (!sublocation || sublocation.locationId !== location.id) return fail("CHARACTER_SUBLOCATION_INVALID", `Character ${character.id} has an invalid sublocation.`);
                const constraint = character.movementConstraint;
                if (constraint && constraint.type === "location_locked" && character.locationId !== constraint.locationId) {
                    return fail("CHARACTER_MOVEMENT_CONSTRAINT_INVALID", `Character ${character.id} is outside its location lock.`);
                }
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
            if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.validateAwayState === "function") {
                const awayValidation = setup.WeeklyRhythm.validateAwayState(character, world);
                if (!awayValidation.ok) return awayValidation;
            }
            if (!inactive && setup.Presence && typeof setup.Presence.baseLocalPresence === "function" &&
                    setup.Presence.baseLocalPresence(character, world) && !setup.Presence.validLocalPlacement(character, world)) {
                return fail("CHARACTER_LOCAL_TOPOLOGY_UNAVAILABLE", `Locally present character ${character.id} occupies unavailable conditional topology.`);
            }
            if (!Array.isArray(character.discoveredLocationIds) || new Set(character.discoveredLocationIds).size !== character.discoveredLocationIds.length) {
                return fail("CHARACTER_DISCOVERY_INVALID", `Character ${character.id} discoveredLocationIds must be a unique array.`);
            }
            for (const locationId of character.discoveredLocationIds) {
                const discoveredLocation = getLocation(locationId, world);
                if (!discoveredLocation || !locationRequiresDiscovery(discoveredLocation, world)) {
                    return fail("CHARACTER_DISCOVERY_INVALID", `Character ${character.id} has invalid discovered location ${String(locationId)}.`);
                }
            }
            if (locationRequiresDiscovery(location, world) && !character.discoveredLocationIds.includes(location.id)) {
                return fail("CHARACTER_DISCOVERY_INVALID", `Character ${character.id} must know the secret location they currently occupy.`);
            }
            if (!Array.isArray(character.discoveredCharacterIds) || new Set(character.discoveredCharacterIds).size !== character.discoveredCharacterIds.length) {
                return fail("CHARACTER_DISCOVERY_INVALID", `Character ${character.id} discoveredCharacterIds must be a unique array.`);
            }
            for (const targetCharacterId of character.discoveredCharacterIds) {
                const targetCharacter = getCharacter(targetCharacterId, world);
                if (!targetCharacter || targetCharacter.id === character.id || !characterRequiresDiscovery(targetCharacter, world)) {
                    return fail("CHARACTER_DISCOVERY_INVALID", `Character ${character.id} has invalid discovered character ${String(targetCharacterId)}.`);
                }
            }
            if (typeof character.playerControllable !== "boolean") {
                return fail("CHARACTER_CONTROLLABLE_INVALID", `Character ${character.id} playerControllable must be Boolean.`);
            }
            if (!CONTROLLER_IDS.has(character.defaultControllerId) || character.defaultControllerId === "human") {
                return fail("DEFAULT_CONTROLLER_INVALID", `Character ${character.id} has an invalid default controller.`);
            }
            if (!character.mind || character.mind.schemaVersion !== setup.MindV3.CONFIG.SCHEMA_VERSION || !Array.isArray(character.mind.pendingObservations)) {
                return fail("CHARACTER_MIND_INVALID", `Character ${character.id} has an invalid Mind v3 state.`);
            }
            for (const partition of ["knownFacts", "beliefs", "relationships", "verbatimObservations", "shortTermMemories", "longTermMemories"]) {
                if (!Array.isArray(character.mind[partition])) {
                    return fail("CHARACTER_MIND_INVALID", `Character ${character.id} mind.${partition} must be an array.`);
                }
            }
            if (!Number.isInteger(character.mindRevision) || character.mindRevision < 0) {
                return fail("CHARACTER_MIND_INVALID", `Character ${character.id} mindRevision must be a non-negative integer.`);
            }
            if (!character.mindDiagnostics || typeof character.mindDiagnostics !== "object" || Array.isArray(character.mindDiagnostics) ||
                    !character.mindDiagnostics.beliefHistoryById || typeof character.mindDiagnostics.beliefHistoryById !== "object" || Array.isArray(character.mindDiagnostics.beliefHistoryById)) {
                return fail("CHARACTER_MIND_INVALID", `Character ${character.id} mind diagnostics are invalid.`);
            }
            if (!Array.isArray(character.recentDialogue)) {
                return fail("CHARACTER_DIALOGUE_INVALID", `Character ${character.id} recentDialogue must be an array.`);
            }
            if (character.recentDialogue.length > setup.MindValidators.RECENT_DIALOGUE_LIMIT) {
                return fail("CHARACTER_DIALOGUE_INVALID", `Character ${character.id} recentDialogue exceeds the bounded dialogue window.`);
            }
            if (!Array.isArray(character.mindMaintenanceSnapshots) || character.mindMaintenanceSnapshots.length > 5) {
                return fail("CHARACTER_MIND_SNAPSHOT_INVALID", `Character ${character.id} maintenance snapshots must be an array of at most five entries.`);
            }
            for (const snapshot of character.mindMaintenanceSnapshots) {
                if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || typeof snapshot.createdAt !== "string" || !snapshot.createdAt.trim() ||
                        !Number.isInteger(snapshot.turn) || snapshot.turn < 1 || !["manual", "automatic", "timelapse", "timelapse-boundary"].includes(snapshot.trigger) ||
                        !snapshot.mind || typeof snapshot.mind !== "object" || Array.isArray(snapshot.mind)) {
                    return fail("CHARACTER_MIND_SNAPSHOT_INVALID", `Character ${character.id} has an invalid maintenance snapshot.`);
                }
            }
            const beliefIds = new Set();
            for (const belief of character.mind.beliefs) {
                const recordValidation = setup.MindValidators.validateBeliefRecord(belief);
                if (!recordValidation.ok || beliefIds.has(belief.id)) return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate belief.`);
                beliefIds.add(belief.id);
            }
            const relationshipTargets = new Set();
            for (const relationship of character.mind.relationships) {
                const recordValidation = setup.MindValidators.validateRelationshipRecord(relationship, character.id, world, { requireTargetExists: false });
                if (!recordValidation.ok || relationshipTargets.has(relationship.targetCharacterId)) return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate relationship.`);
                relationshipTargets.add(relationship.targetCharacterId);
            }
            const memoryIds = new Set();
            for (const partition of ["shortTermMemories", "longTermMemories"]) {
                for (const memory of character.mind[partition]) {
                    const recordValidation = setup.MindValidators.validateMemoryRecord(memory, {
                        maxSummaryLength: partition === "shortTermMemories"
                            ? setup.MindV3.CONFIG.STM_SUMMARY_MAX_CHARS
                            : setup.MindV3.CONFIG.LTM_SUMMARY_MAX_CHARS,
                        allowEpistemicSources: partition === "shortTermMemories",
                        requireSourceCharacterExists: true,
                        world: world
                    });
                    if (!recordValidation.ok || memoryIds.has(memory.id)) return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate memory.`);
                    memoryIds.add(memory.id);
                }
            }
            const verbatimIds = new Set();
            for (const observation of character.mind.verbatimObservations) {
                const recordValidation = setup.MindValidators.validateVerbatimObservation(observation, { requireSourceCharacterExists: true, world: world });
                if (!recordValidation.ok || verbatimIds.has(observation.id)) return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate verbatim observation.`);
                verbatimIds.add(observation.id);
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
            if (!ability || ability.id !== abilityId || ability.actionType !== "use_ability" || !abilityEffectSupported(ability.effectType)) {
                return fail("ABILITY_DEFINITION_INVALID", `Ability ${abilityId} must use canonical use_ability with a registered effectType.`);
            }
        }

        return ok();
    }

    function validateEnvironmentAndDaytime(world) {
        if (!world.environment || typeof world.environment !== "object" || Array.isArray(world.environment)) {
            return fail("WORLD_ENVIRONMENT_INVALID", "World environment state is missing.");
        }
        if (!TIME_PHASES.has(world.environment.timePhase)) {
            return fail("WORLD_TIME_PHASE_INVALID", "World time phase is invalid.");
        }
        if (typeof world.environment.weatherNarrative !== "string" || !world.environment.weatherNarrative.trim() || world.environment.weatherNarrative.length > 2000) {
            return fail("WORLD_WEATHER_INVALID", "World weather narrative must contain 1 to 2000 characters.");
        }
        if (typeof world.environment.weatherInitialized !== "boolean") {
            return fail("WORLD_WEATHER_INVALID", "World weather initialization state must be Boolean.");
        }
        if (!world.calendar || typeof world.calendar !== "object" || Array.isArray(world.calendar) ||
                !Array.isArray(world.calendar.weekdayNames) || world.calendar.weekdayNames.length !== 7 ||
                world.calendar.weekdayNames.some(function (name) { return typeof name !== "string" || !name.trim(); }) ||
                !Number.isInteger(world.calendar.initialWeekdayIndex) || world.calendar.initialWeekdayIndex < 0 || world.calendar.initialWeekdayIndex > 6 ||
                !Number.isInteger(world.calendar.dayNumber) || world.calendar.dayNumber < 0) {
            return fail("WORLD_CALENDAR_INVALID", "World weekly calendar state is invalid.");
        }
        if (!world.dayActivities || typeof world.dayActivities !== "object" || Array.isArray(world.dayActivities)) {
            return fail("DAY_ACTIVITIES_INVALID", "World day activities are missing.");
        }
        for (const [activityId, activity] of Object.entries(world.dayActivities)) {
            if (!activity || activity.id !== activityId || (activity.kind !== "sponsored_job" && activity.kind !== "solo")) {
                return fail("DAY_ACTIVITY_INVALID", `Day activity ${activityId} is invalid.`);
            }
            if (!getLocation(activity.workLocationId, world)) return fail("DAY_ACTIVITY_INVALID", `Day activity ${activityId} references a missing work location.`);
            if (activity.kind === "sponsored_job" && !getCharacter(activity.sponsorCharacterId, world)) {
                return fail("DAY_ACTIVITY_INVALID", `Day activity ${activityId} references a missing sponsor.`);
            }
            if (activity.kind === "solo" && !getLocation(activity.entryLocationId, world)) {
                return fail("DAY_ACTIVITY_INVALID", `Day activity ${activityId} references a missing entry location.`);
            }
        }
        if (!world.daytime || typeof world.daytime !== "object" || Array.isArray(world.daytime)) {
            return fail("DAYTIME_STATE_INVALID", "World daytime runtime state is missing.");
        }
        if (world.daytime.pendingOffer !== null) {
            const offer = world.daytime.pendingOffer;
            const activity = offer && world.dayActivities[offer.activityId];
            if (!activity || activity.kind !== "sponsored_job" || activity.sponsorCharacterId !== offer.sponsorCharacterId || !getCharacter(offer.humanCharacterId, world)) {
                return fail("DAYTIME_OFFER_INVALID", "Pending daytime work offer is invalid.");
            }
        }
        if (world.daytime.activeActivity !== null) {
            const active = world.daytime.activeActivity;
            if (!active || !world.dayActivities[active.activityId] || !getCharacter(active.humanCharacterId, world)) {
                return fail("DAYTIME_ACTIVITY_INVALID", "Active daytime activity is invalid.");
            }
        }
        return ok();
    }

    function validateTravelerProfilesAndSetup(world) {
        if (Object.prototype.hasOwnProperty.call(world, "travelerProfiles")) {
            return fail("TRAVELER_PROFILES_DEPRECATED", "Runtime world state must not contain authored Traveler profiles.");
        }
        const state = world.playerSetup;
        if (!state || typeof state !== "object" || Array.isArray(state)) return fail("PLAYER_SETUP_INVALID", "Player initialization state is missing.");
        const keys = Object.keys(state).sort();
        const expected = ["aiSetupAcknowledged", "completed", "customAuthoring", "disclaimerAccepted", "disclosureVersion", "mode"].sort();
        if (keys.length !== expected.length || keys.some(function (key, index) { return key !== expected[index]; })) {
            return fail("PLAYER_SETUP_INVALID", "Player initialization state has an invalid shape.");
        }
        if (typeof state.disclaimerAccepted !== "boolean" || typeof state.aiSetupAcknowledged !== "boolean" || typeof state.completed !== "boolean") {
            return fail("PLAYER_SETUP_INVALID", "Player initialization flags must be Boolean.");
        }
        if (!Number.isInteger(state.disclosureVersion) || state.disclosureVersion < 0) {
            return fail("PLAYER_SETUP_INVALID", "Player disclosure version must be a non-negative integer.");
        }
        if (state.disclosureVersion > 0 && !state.disclaimerAccepted) {
            return fail("PLAYER_SETUP_INVALID", "Acknowledged public disclosure requires disclaimerAccepted=true.");
        }
        if (!state.completed) {
            if (state.mode !== null || state.customAuthoring !== null) return fail("PLAYER_SETUP_INVALID", "Incomplete player setup cannot contain a selected Traveler identity.");
            return ok();
        }
        if (!state.aiSetupAcknowledged || !["generic", "custom", "legacy"].includes(state.mode)) {
            return fail("PLAYER_SETUP_INVALID", "Completed player setup must have completed AI setup and a valid mode.");
        }
        if (state.mode === "custom") {
            if (!validCustomTravelerAuthoring(state.customAuthoring)) return fail("PLAYER_SETUP_INVALID", "Custom Traveler setup has invalid authoring state.");
        } else if (state.customAuthoring !== null) {
            return fail("PLAYER_SETUP_INVALID", "Generic/legacy Traveler setup cannot contain custom authoring.");
        }
        return ok();
    }

    function validateAuthoredOutcomeRuntime(world) {
        if (!world.randomOutcomeTables || typeof world.randomOutcomeTables !== "object" || Array.isArray(world.randomOutcomeTables)) {
            return fail("RANDOM_OUTCOME_TABLES_INVALID", "randomOutcomeTables must be an object.");
        }
        const onceIds = new Set();
        const seenOutcomeIds = new Set();
        for (const [tableId, table] of Object.entries(world.randomOutcomeTables)) {
            if (!table || typeof table !== "object" || Array.isArray(table) || table.id !== tableId || !Array.isArray(table.outcomes) ||
                    !Number.isInteger(table.noOutcomeWeight) || table.noOutcomeWeight < 0) {
                return fail("RANDOM_OUTCOME_TABLE_INVALID", `Random outcome table ${tableId} is malformed.`);
            }
            let positiveWeight = table.noOutcomeWeight;
            for (const outcome of table.outcomes) {
                if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || typeof outcome.id !== "string" || !outcome.id ||
                        seenOutcomeIds.has(outcome.id) || !Number.isInteger(outcome.weight) || outcome.weight <= 0 || typeof outcome.once !== "boolean" ||
                        !Array.isArray(outcome.effects) || outcome.effects.length === 0) {
                    return fail("RANDOM_OUTCOME_INVALID", `Random outcome in table ${tableId} is malformed or duplicated.`);
                }
                seenOutcomeIds.add(outcome.id);
                positiveWeight += outcome.weight;
                if (outcome.once) onceIds.add(outcome.id);
                for (const effect of outcome.effects) {
                    if (!effect || typeof effect !== "object" || Array.isArray(effect) || !["emit_observation", "reveal_location", "encounter_character", "modify_wallet", "create_item"].includes(effect.type)) {
                        return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} contains an unsupported effect.`);
                    }
                    if (effect.type === "emit_observation" && (typeof effect.text !== "string" || !effect.text.trim())) return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} has invalid observation text.`);
                    if (effect.type === "reveal_location" && (!getLocation(effect.locationId, world) || !locationRequiresDiscovery(effect.locationId, world))) return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} has invalid reveal_location target.`);
                    if (effect.type === "encounter_character") {
                        const target = getCharacter(effect.characterId, world);
                        if (!target || !characterRequiresDiscovery(target, world)) return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} has invalid encounter_character target.`);
                    }
                    if (effect.type === "modify_wallet" && (effect.target !== "actor" || !Number.isInteger(effect.amount) || effect.amount === 0)) return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} has invalid modify_wallet effect.`);
                    if (effect.type === "create_item" && (effect.destination !== "actor_inventory" || !world.itemDefinitions[effect.itemDefinitionId] ||
                            (effect.quantity !== undefined && (!Number.isInteger(effect.quantity) || effect.quantity < 1 || effect.quantity > 100)))) {
                        return fail("RANDOM_OUTCOME_EFFECT_INVALID", `Random outcome ${outcome.id} has invalid create_item effect.`);
                    }
                }
            }
            if (!(positiveWeight > 0)) return fail("RANDOM_OUTCOME_TABLE_INVALID", `Random outcome table ${tableId} has no positive weighted result.`);
        }
        if (!Array.isArray(world.consumedAuthoredOutcomeIds) || new Set(world.consumedAuthoredOutcomeIds).size !== world.consumedAuthoredOutcomeIds.length) {
            return fail("RANDOM_OUTCOME_CONSUMED_INVALID", "consumedAuthoredOutcomeIds must be a unique array.");
        }
        for (const outcomeId of world.consumedAuthoredOutcomeIds) {
            if (!onceIds.has(outcomeId)) return fail("RANDOM_OUTCOME_CONSUMED_INVALID", `Consumed authored outcome ${String(outcomeId)} is not a current one-shot outcome.`);
        }
        return ok();
    }

    function validatePresenceTopologyRuntimeDefinitions(world) {
        const records = [];
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || !["location", "sublocation"].includes(entity.type)) return;
            if (entity.presenceFallbackPlacement !== undefined && !entity.presenceOwnerCharacterId) {
                records.push({ ok: false, error: { code: "PRESENCE_FALLBACK_INVALID", message: `${entity.type} ${entity.id} cannot define presenceFallbackPlacement without presenceOwnerCharacterId.` } });
                return;
            }
            if (!entity.presenceOwnerCharacterId) return;
            if (!getCharacter(entity.presenceOwnerCharacterId, world)) {
                records.push({ ok: false, error: { code: "PRESENCE_OWNER_INVALID", message: `${entity.type} ${entity.id} references missing presence owner ${String(entity.presenceOwnerCharacterId)}.` } });
                return;
            }
            const fallback = entity.presenceFallbackPlacement;
            if (fallback !== undefined) {
                const keys = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? Object.keys(fallback) : [];
                const location = fallback && getLocation(fallback.locationId, world);
                const sublocation = fallback && getSublocation(fallback.sublocationId, world);
                if (!fallback || typeof fallback !== "object" || Array.isArray(fallback) || keys.some(function (key) { return !["locationId", "sublocationId"].includes(key); }) ||
                        keys.length !== 2 || !location || !sublocation || sublocation.locationId !== location.id ||
                        location.presenceOwnerCharacterId === entity.presenceOwnerCharacterId || sublocation.presenceOwnerCharacterId === entity.presenceOwnerCharacterId) {
                    records.push({ ok: false, error: { code: "PRESENCE_FALLBACK_INVALID", message: `${entity.type} ${entity.id} has an invalid presenceFallbackPlacement.` } });
                }
                return;
            }
            if (entity.type === "sublocation") {
                const parent = getLocation(entity.locationId, world);
                const defaultPosition = parent && getSublocation(parent.defaultSublocationId, world);
                if (!parent || !defaultPosition || defaultPosition.id === entity.id || parent.presenceOwnerCharacterId === entity.presenceOwnerCharacterId ||
                        defaultPosition.presenceOwnerCharacterId === entity.presenceOwnerCharacterId) {
                    records.push({ ok: false, error: { code: "PRESENCE_FALLBACK_AMBIGUOUS", message: `Sublocation ${entity.id} requires an explicit presenceFallbackPlacement.` } });
                }
                return;
            }
            const destinations = Array.from(new Set(locationExitEntries(entity, world).map(function (entry) { return entry.destinationId; }).filter(Boolean)));
            const destination = destinations.length === 1 ? getLocation(destinations[0], world) : null;
            const defaultPosition = destination && getSublocation(destination.defaultSublocationId, world);
            if (destinations.length !== 1 || !destination || !defaultPosition || destination.presenceOwnerCharacterId === entity.presenceOwnerCharacterId ||
                    defaultPosition.presenceOwnerCharacterId === entity.presenceOwnerCharacterId) {
                records.push({ ok: false, error: { code: "PRESENCE_FALLBACK_AMBIGUOUS", message: `Location ${entity.id} requires an explicit presenceFallbackPlacement.` } });
            }
        });
        return records.length ? records[0] : ok();
    }

    function validateTriggeredEventRuntimeDefinitions(world) {
        if (!world.triggeredEvents || typeof world.triggeredEvents !== "object" || Array.isArray(world.triggeredEvents)) {
            return fail("TRIGGERED_EVENTS_INVALID", "triggeredEvents must be an object.");
        }
        for (const [eventId, event] of Object.entries(world.triggeredEvents)) {
            if (!event || event.id !== eventId || !event.trigger || !["ordinary_tick", "timelapse_start"].includes(event.trigger.type) ||
                    !Array.isArray(event.prerequisites) || !Array.isArray(event.effects) || event.effects.length < 1) {
                return fail("TRIGGERED_EVENT_DEFINITION_INVALID", `Triggered event ${eventId} is malformed.`);
            }
            if (event.chance !== undefined && (typeof event.chance !== "number" || !Number.isFinite(event.chance) || event.chance <= 0 || event.chance > 1)) {
                return fail("TRIGGERED_EVENT_DEFINITION_INVALID", `Triggered event ${eventId} has invalid chance.`);
            }
            if (![undefined, "normal", "none"].includes(event.narrationPolicy)) {
                return fail("TRIGGERED_EVENT_DEFINITION_INVALID", `Triggered event ${eventId} has invalid narrationPolicy.`);
            }
            for (const prerequisite of event.prerequisites) {
                if (!prerequisite || typeof prerequisite.type !== "string") return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has malformed prerequisite.`);
                if (prerequisite.type === "phase_is") {
                    if (!["Morning", "Evening"].includes(prerequisite.phase)) return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has invalid phase prerequisite.`);
                } else if (prerequisite.type === "location_inventory_contains_tag") {
                    if (!getLocation(prerequisite.locationId, world) || typeof prerequisite.tag !== "string" || !prerequisite.tag.trim() || (prerequisite.minimum !== undefined && prerequisite.minimum !== 1)) {
                        return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has invalid inventory-tag prerequisite.`);
                    }
                } else if (prerequisite.type === "character_activation_is") {
                    if (!getCharacter(prerequisite.characterId, world) || !["active", "inactive"].includes(prerequisite.value)) return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has invalid activation prerequisite.`);
                } else if (prerequisite.type === "character_locally_present") {
                    if (!getCharacter(prerequisite.characterId, world) || typeof prerequisite.value !== "boolean") return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has invalid local-presence prerequisite.`);
                } else if (!["character_active", "character_inactive"].includes(prerequisite.type)) {
                    return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} has unsupported prerequisite ${String(prerequisite.type)}.`);
                } else if (!getCharacter(prerequisite.characterId, world)) {
                    return fail("TRIGGERED_EVENT_PREREQUISITE_INVALID", `Triggered event ${eventId} legacy activation prerequisite references missing character.`);
                }
            }
            for (const effect of event.effects) {
                if (!effect || !["activate_character", "deactivate_character", "consume_matching_items", "emit_observation"].includes(effect.type)) {
                    return fail("TRIGGERED_EVENT_EFFECT_INVALID", `Triggered event ${eventId} has unsupported effect ${String(effect && effect.type)}.`);
                }
                if ((effect.type === "activate_character" || effect.type === "deactivate_character") && !getCharacter(effect.characterId, world)) {
                    return fail("TRIGGERED_EVENT_EFFECT_INVALID", `Triggered event ${eventId} references missing character ${String(effect.characterId)}.`);
                }
                if (effect.type === "activate_character") {
                    const target = getCharacter(effect.characterId, world);
                    const location = getLocation(effect.locationId, world);
                    const sublocation = effect.sublocationId ? getSublocation(effect.sublocationId, world) : null;
                    if (!target || target.deferredActivation !== true || !location || (effect.sublocationId && (!sublocation || sublocation.locationId !== location.id))) {
                        return fail("TRIGGERED_EVENT_EFFECT_INVALID", `Triggered event ${eventId} has invalid activation target/destination.`);
                    }
                }
                if (effect.type === "consume_matching_items" && (!effect.source || effect.source.type !== "location_inventory" || !getLocation(effect.source.locationId, world) ||
                        typeof effect.itemTag !== "string" || !effect.itemTag.trim() || effect.mode !== "all" || effect.preserveContainers !== true)) {
                    return fail("TRIGGERED_EVENT_EFFECT_INVALID", `Triggered event ${eventId} has invalid consume-matching effect.`);
                }
                if (effect.type === "emit_observation" && (!getLocation(effect.locationId, world) || typeof effect.text !== "string" || !effect.text.trim() || (effect.actorCharacterId && !getCharacter(effect.actorCharacterId, world)))) {
                    return fail("TRIGGERED_EVENT_EFFECT_INVALID", `Triggered event ${eventId} has invalid observation effect.`);
                }
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
        const travelerResult = validateTravelerProfilesAndSetup(world);
        if (!travelerResult.ok) return travelerResult;

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
        const presenceTopologyResult = validatePresenceTopologyRuntimeDefinitions(world);
        if (!presenceTopologyResult.ok) return presenceTopologyResult;
        const itemResult = validateItemInvariants(world);
        if (!itemResult.ok) return itemResult;
        const environmentResult = validateEnvironmentAndDaytime(world);
        if (!environmentResult.ok) return environmentResult;
        const randomOutcomeResult = validateAuthoredOutcomeRuntime(world);
        if (!randomOutcomeResult.ok) return randomOutcomeResult;
        const triggeredDefinitionResult = validateTriggeredEventRuntimeDefinitions(world);
        if (!triggeredDefinitionResult.ok) return triggeredDefinitionResult;
        if (!Number.isInteger(world.ordinaryTickId) || world.ordinaryTickId < 0) return fail("ORDINARY_TICK_ID_INVALID", "ordinaryTickId must be a non-negative integer.");
        if (!world.triggeredEventRuntime || typeof world.triggeredEventRuntime !== "object" || Array.isArray(world.triggeredEventRuntime) ||
                !Number.isInteger(world.triggeredEventRuntime.lastProcessedOrdinaryTickId) || world.triggeredEventRuntime.lastProcessedOrdinaryTickId < 0 ||
                world.triggeredEventRuntime.lastProcessedOrdinaryTickId > world.ordinaryTickId) {
            return fail("TRIGGERED_EVENT_RUNTIME_INVALID", "Triggered-event runtime bookkeeping is invalid.");
        }

        if (!world.ai || typeof world.ai !== "object" || Array.isArray(world.ai) ||
                !Array.isArray(world.ai.turnQueue) || !world.ai.continuations || typeof world.ai.continuations !== "object" || Array.isArray(world.ai.continuations) ||
                !world.ai.intimateContexts || typeof world.ai.intimateContexts !== "object" || Array.isArray(world.ai.intimateContexts)) {
            return fail("AI_STATE_INVALID", "AI runtime state is missing or malformed.");
        }
        const queuedCharacters = new Set();
        for (const entry of world.ai.turnQueue) {
            const characterId = entry && typeof entry === "object" ? entry.characterId : null;
            if (typeof characterId !== "string" || !getCharacter(characterId, world) || queuedCharacters.has(characterId) ||
                    typeof entry.reason !== "string") {
                return fail("AI_TURN_QUEUE_INVALID", "AI turn queue contains a malformed, duplicate, or missing-character entry.");
            }
            queuedCharacters.add(characterId);
        }
        for (const [characterId, continuation] of Object.entries(world.ai.continuations)) {
            if (!getCharacter(characterId, world)) {
                return fail("AI_CONTINUATION_CHARACTER_INVALID", `AI continuation references missing character ${characterId}.`);
            }
            if (continuation !== null && (typeof continuation !== "string" || continuation.length > 2000)) {
                return fail("AI_CONTINUATION_INVALID", `AI continuation for ${characterId} must be a string up to 2000 characters or null.`);
            }
        }
        for (const [characterId, contexts] of Object.entries(world.ai.intimateContexts)) {
            if (!getCharacter(characterId, world) || !contexts || typeof contexts !== "object" || Array.isArray(contexts)) {
                return fail("AI_INTIMATE_CONTEXT_INVALID", `Intimate contexts for ${characterId} are malformed or reference a missing character.`);
            }
            for (const [partnerId, record] of Object.entries(contexts)) {
                const actor = getCharacter(characterId, world);
                const partner = getCharacter(partnerId, world);
                if (partnerId === characterId || !actor || !partner || actor.adult === false || partner.adult === false || !validIntimateMotivationRecord(record)) {
                    return fail("AI_INTIMATE_CONTEXT_INVALID", `Intimate context ${characterId} -> ${partnerId} is invalid.`);
                }
            }
        }
        return ok();
    }


        return {
            validateControlAssignments: validateControlAssignments,
            repairControlInvariant: repairControlInvariant,
            synchronizeDerivedItemPlacement: synchronizeDerivedItemPlacement,
            validateItemInvariants: validateItemInvariants,
            validateSpatialInvariants: validateSpatialInvariants,
            validateEnvironmentAndDaytime: validateEnvironmentAndDaytime,
            validateTravelerProfilesAndSetup: validateTravelerProfilesAndSetup,
            validateAuthoredOutcomeRuntime: validateAuthoredOutcomeRuntime,
            validatePresenceTopologyRuntimeDefinitions: validatePresenceTopologyRuntimeDefinitions,
            validateTriggeredEventRuntimeDefinitions: validateTriggeredEventRuntimeDefinitions,
            validateWorld: validateWorld
        };
    }

    setup.GameValidation = { create: create };
}());
