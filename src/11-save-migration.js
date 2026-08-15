(function () {
    "use strict";

    const I = setup.GameInternals;
    const LEGACY_WORLD_VERSION = I.LEGACY_WORLD_VERSION;
    const WORLD_SCHEMA_VERSION = I.WORLD_SCHEMA_VERSION;
    const SUPPORTED_MIGRATION_SCHEMA_VERSIONS = new Set(I.SUPPORTED_MIGRATION_SCHEMA_VERSIONS);
    const CONTROLLER_IDS = new Set(I.CONTROLLER_IDS);
    const clone = I.clone;
    const ok = I.ok;
    const fail = I.fail;
    const createInitialWorld = I.createInitialWorld;
    const getCharacters = I.getCharacters;
    const getCharacter = I.getCharacter;
    const getLocation = I.getLocation;
    const getSublocation = I.getSublocation;
    const locationExitEntries = I.locationExitEntries;
    const validateWorld = I.validateWorld;
    const validateControlAssignments = I.validateControlAssignments;
    const repairControlInvariant = I.repairControlInvariant;
    const currentAuthoringRevision = I.currentAuthoringRevision;
    let migrationInFlight = false;
    let lastMigrationReport = null;

    function persistedSchemaVersion(world) {
        if (!world || typeof world !== "object") return null;
        if (Number.isInteger(world.schemaVersion)) return world.schemaVersion;
        if (world.version === LEGACY_WORLD_VERSION) return LEGACY_WORLD_VERSION;
        return null;
    }

    function getMigrationStatus(world) {
        const currentRevision = currentAuthoringRevision();
        if (!world) {
            return {
                required: false,
                supported: true,
                fresh: true,
                fromSchemaVersion: null,
                toSchemaVersion: WORLD_SCHEMA_VERSION,
                fromAuthoringRevision: null,
                toAuthoringRevision: currentRevision
            };
        }
        const fromSchemaVersion = persistedSchemaVersion(world);
        const fromAuthoringRevision = typeof world.authoringRevision === "string" ? world.authoringRevision : null;
        const supported = SUPPORTED_MIGRATION_SCHEMA_VERSIONS.has(fromSchemaVersion) && fromSchemaVersion <= WORLD_SCHEMA_VERSION;
        return {
            required: Boolean(supported && (fromSchemaVersion !== WORLD_SCHEMA_VERSION || fromAuthoringRevision !== currentRevision)),
            supported: supported,
            fresh: false,
            fromSchemaVersion: fromSchemaVersion,
            toSchemaVersion: WORLD_SCHEMA_VERSION,
            fromAuthoringRevision: fromAuthoringRevision,
            toAuthoringRevision: currentRevision
        };
    }

    function migrationFailure(status, message) {
        return fail("SAVE_MIGRATION_UNSUPPORTED", message || "This save uses an unsupported world schema and cannot be migrated automatically.", {
            migration: clone(status)
        });
    }

    function migrationArray(savedCharacter, partition, candidate) {
        if (!savedCharacter || !savedCharacter.mind || !Array.isArray(savedCharacter.mind[partition])) {
            throw new Error(`Character ${savedCharacter && savedCharacter.id || "unknown"} has invalid saved mind.${partition}.`);
        }
        const records = clone(savedCharacter.mind[partition]);
        const actorId = savedCharacter.id;
        const validators = setup.MindValidators;
        records.forEach(function (record) {
            let validation = { ok: true };
            if (partition === "beliefs") validation = validators.validateBeliefRecord(record, { maxTextLength: 2000 });
            else if (partition === "relationships") validation = validators.validateRelationshipRecord(record, actorId, candidate, { requireTargetExists: false, maxSummaryLength: 2000 });
            else if (partition === "recentMemories" || partition === "longTermMemories") validation = validators.validateMemoryRecord(record, { maxSummaryLength: 2000 });
            if (!validation.ok) throw new Error(`Character ${actorId} has invalid saved mind.${partition}: ${validation.error.message}`);
        });
        return records;
    }

    function migrationAbstractStudyProgress(savedCharacter) {
        const source = savedCharacter && savedCharacter.mind && savedCharacter.mind.abstractStudyProgress;
        if (!source || typeof source !== "object" || Array.isArray(source)) return {};
        const result = {};
        Object.entries(source).slice(0, 64).forEach(function (entry) {
            const itemId = String(entry[0] || "").slice(0, 160);
            const value = entry[1];
            if (!itemId || !value || typeof value !== "object" || Array.isArray(value)) return;
            const lastInput = typeof value.lastInput === "string" ? value.lastInput.trim().slice(0, 600) : "";
            const depth = Number.isInteger(value.depth) ? Math.max(1, Math.min(3, value.depth)) : 1;
            if (!lastInput) return;
            result[itemId] = { lastInput: lastInput, depth: depth };
        });
        return result;
    }

    function migrationItemStudyProgress(savedItem) {
        const source = savedItem && savedItem.abstractStudyProgressByCharacterId;
        if (!source || typeof source !== "object" || Array.isArray(source)) return {};
        const result = {};
        Object.entries(source).slice(0, 512).forEach(function (entry) {
            const characterId = String(entry[0] || "").slice(0, 160);
            const value = entry[1];
            if (!characterId || !value || typeof value !== "object" || Array.isArray(value)) return;
            const lastInput = typeof value.lastInput === "string" ? value.lastInput.trim().slice(0, 600) : "";
            const depth = Number.isInteger(value.depth) ? Math.max(1, Math.min(3, value.depth)) : 1;
            if (!lastInput) return;
            result[characterId] = { lastInput: lastInput, depth: depth };
        });
        return result;
    }

    function candidateInventoryForSavedContainer(savedWorld, candidate, savedContainerId) {
        if (savedContainerId && candidate.inventories[savedContainerId]) return savedContainerId;
        const savedInventory = savedContainerId && savedWorld.inventories && savedWorld.inventories[savedContainerId];
        const ownerId = savedInventory && savedInventory.ownerId;
        if (!ownerId) return null;
        const candidateOwner = candidate.entities[ownerId];
        if (candidateOwner) {
            const candidateInventoryId = candidateOwner.inventoryId;
            if (candidateInventoryId && candidate.inventories[candidateInventoryId]) return candidateInventoryId;
        }
        const savedOwner = savedWorld.entities && savedWorld.entities[ownerId];
        if (savedOwner && savedOwner.type === "sublocation" && savedOwner.locationId) {
            const candidateLocation = getLocation(savedOwner.locationId, candidate);
            if (candidateLocation && candidate.inventories[candidateLocation.inventoryId]) return candidateLocation.inventoryId;
        }
        return null;
    }

    function removeItemFromCandidate(candidate, itemId) {
        Object.values(candidate.inventories).forEach(function (inventory) {
            inventory.itemIds = inventory.itemIds.filter(function (candidateId) { return candidateId !== itemId; });
        });
        getCharacters(candidate).forEach(function (character) {
            character.equippedItems = Array.isArray(character.equippedItems)
                ? character.equippedItems.filter(function (record) { return record && record.itemId !== itemId; }) : [];
        });
        if (candidate.entities[itemId] && candidate.entities[itemId].type === "item") delete candidate.entities[itemId];
    }

    function restoreSavedPassageLocks(candidate, savedWorld, report) {
        const savedStates = new Map();
        const conflictingLockIds = new Set();

        Object.values(savedWorld.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "location") return;
            locationExitEntries(entity).forEach(function (transition) {
                if (!transition.lockId) return;
                if (!savedStates.has(transition.lockId)) {
                    savedStates.set(transition.lockId, transition.locked === true);
                    return;
                }
                if (savedStates.get(transition.lockId) !== (transition.locked === true)) {
                    conflictingLockIds.add(transition.lockId);
                }
            });
        });

        conflictingLockIds.forEach(function (lockId) {
            savedStates.delete(lockId);
            report.warnings.push(`Saved lock ${lockId} had inconsistent reciprocal state; current authored default was used.`);
        });

        const candidateTransitionsByLockId = new Map();
        Object.values(candidate.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "location") return;
            locationExitEntries(entity).forEach(function (transition) {
                if (!transition.lockId) return;
                if (!candidateTransitionsByLockId.has(transition.lockId)) candidateTransitionsByLockId.set(transition.lockId, []);
                candidateTransitionsByLockId.get(transition.lockId).push({ location: entity, transition: transition });
            });
        });

        savedStates.forEach(function (locked, lockId) {
            const matches = candidateTransitionsByLockId.get(lockId);
            if (!matches || matches.length < 2) return;
            matches.forEach(function (match) {
                const raw = match.location.exits[match.transition.key];
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
                raw.locked = locked;
            });
            report.passageLocksPreserved += 1;
        });
    }

    function runtimeCharacterRefIsValid(candidate, characterId) {
        if (characterId === null || characterId === undefined || characterId === "") return true;
        const entity = candidate.entities[String(characterId)];
        return Boolean(entity && entity.type === "character");
    }

    function runtimeEntityRefIsValid(candidate, entityId) {
        if (entityId === null || entityId === undefined || entityId === "") return true;
        return Boolean(candidate.entities[String(entityId)] || candidate.inventories[String(entityId)]);
    }

    function sanitizeSavedEvent(event, candidate, report) {
        if (!event || typeof event !== "object" || !Number.isInteger(event.id) || event.id < 1) return null;
        if (!runtimeCharacterRefIsValid(candidate, event.actorId) || !runtimeCharacterRefIsValid(candidate, event.targetId)) {
            report.runtimeEventsDiscarded += 1;
            return null;
        }
        const copy = clone(event);
        ["recipients", "processedBy"].forEach(function (field) {
            if (!Array.isArray(copy[field])) copy[field] = [];
            copy[field] = Array.from(new Set(copy[field].filter(function (id) {
                return runtimeCharacterRefIsValid(candidate, id) && Boolean(id);
            })));
        });
        delete copy.pendingFor;
        if (copy.locationId && !runtimeEntityRefIsValid(candidate, copy.locationId)) copy.locationId = null;
        if (copy.fromLocationId && !runtimeEntityRefIsValid(candidate, copy.fromLocationId)) copy.fromLocationId = null;
        if (copy.toLocationId && !runtimeEntityRefIsValid(candidate, copy.toLocationId)) copy.toLocationId = null;
        report.runtimeEventsPreserved += 1;
        return copy;
    }

    function sanitizeSavedObservation(observation, recipientId, candidate, preservedEventIds, seenObservationIds, report) {
        if (!observation || typeof observation !== "object" || !Number.isInteger(observation.id) || observation.id < 1 ||
                seenObservationIds.has(observation.id)) {
            report.runtimeObservationsDiscarded += 1;
            return null;
        }
        if (!runtimeCharacterRefIsValid(candidate, observation.actorId) ||
                !runtimeCharacterRefIsValid(candidate, observation.targetId)) {
            report.runtimeObservationsDiscarded += 1;
            return null;
        }
        if (observation.sourceEventId !== undefined && observation.sourceEventId !== null &&
                (!Number.isInteger(observation.sourceEventId) || !preservedEventIds.has(observation.sourceEventId))) {
            report.runtimeObservationsDiscarded += 1;
            return null;
        }
        const copy = clone(observation);
        if (copy.data && typeof copy.data === "object") {
            for (const field of ["actorId", "targetId"]) {
                if (!runtimeCharacterRefIsValid(candidate, copy.data[field])) copy.data[field] = null;
            }
            for (const field of ["locationId", "fromLocationId", "toLocationId", "fromSublocationId", "toSublocationId", "itemId"]) {
                if (copy.data[field] && !runtimeEntityRefIsValid(candidate, copy.data[field])) delete copy.data[field];
            }
        }
        seenObservationIds.add(copy.id);
        report.runtimeObservationsPreserved += 1;
        return copy;
    }

    function restoreRuntimeJournal(candidate, savedWorld, report) {
        const seenEventIds = new Set();
        candidate.events = [];
        (Array.isArray(savedWorld.events) ? savedWorld.events : []).forEach(function (event) {
            const copy = sanitizeSavedEvent(event, candidate, report);
            if (!copy || seenEventIds.has(copy.id)) {
                if (copy) report.runtimeEventsDiscarded += 1;
                return;
            }
            seenEventIds.add(copy.id);
            candidate.events.push(copy);
        });
        if (candidate.events.length > 200) candidate.events = candidate.events.slice(-200);
        const preservedEventIds = new Set(candidate.events.map(function (event) { return event.id; }));
        const seenObservationIds = new Set();
        getCharacters(candidate).forEach(function (character) {
            const savedCharacter = savedWorld.entities && savedWorld.entities[character.id];
            character.mind.pendingObservations = [];
            if (!savedCharacter || !savedCharacter.mind || !Array.isArray(savedCharacter.mind.pendingObservations)) return;
            savedCharacter.mind.pendingObservations.forEach(function (observation) {
                const copy = sanitizeSavedObservation(observation, character.id, candidate, preservedEventIds, seenObservationIds, report);
                if (copy) character.mind.pendingObservations.push(copy);
            });
        });

        const savedQueue = savedWorld.ai && Array.isArray(savedWorld.ai.turnQueue) ? savedWorld.ai.turnQueue : [];
        candidate.ai.turnQueue = [];
        const queued = new Set();
        savedQueue.forEach(function (entry) {
            const characterId = typeof entry === "string" ? entry : entry && entry.characterId;
            const character = characterId && candidate.entities[characterId];
            if (!character || character.type !== "character" || candidate.control.assignments[characterId] !== "ai" ||
                    !character.mind.pendingObservations.length || queued.has(characterId)) return;
            candidate.ai.turnQueue.push({
                characterId: characterId,
                reason: typeof entry === "object" && typeof entry.reason === "string" ? entry.reason : "observation"
            });
            queued.add(characterId);
        });
        getCharacters(candidate).forEach(function (character) {
            if (candidate.control.assignments[character.id] === "ai" && character.mind.pendingObservations.length && !queued.has(character.id)) {
                candidate.ai.turnQueue.push({ characterId: character.id, reason: "restored_observation" });
                queued.add(character.id);
            }
        });
        report.runtimeQueueEntriesPreserved = candidate.ai.turnQueue.length;
    }

    function reconstructPersistentCounters(candidate, savedWorld) {
        let nextMemoryId = Number.isInteger(savedWorld.nextMemoryId) && savedWorld.nextMemoryId > 0
            ? savedWorld.nextMemoryId
            : 1;
        let nextEventId = Number.isInteger(savedWorld.nextEventId) && savedWorld.nextEventId > 0 ? savedWorld.nextEventId : 1;
        let nextObservationId = Number.isInteger(savedWorld.nextObservationId) && savedWorld.nextObservationId > 0 ? savedWorld.nextObservationId : 1;
        getCharacters(candidate).forEach(function (character) {
            ["recentMemories", "longTermMemories"].forEach(function (partition) {
                (character.mind[partition] || []).forEach(function (memory) {
                    const match = memory && typeof memory.id === "string" && memory.id.match(/^memory_ai_(\d+)$/);
                    if (match) nextMemoryId = Math.max(nextMemoryId, Number(match[1]) + 1);
                });
            });
            (character.mind.pendingObservations || []).forEach(function (observation) {
                if (Number.isInteger(observation.id)) nextObservationId = Math.max(nextObservationId, observation.id + 1);
            });
        });
        (candidate.events || []).forEach(function (event) {
            if (Number.isInteger(event.id)) nextEventId = Math.max(nextEventId, event.id + 1);
        });
        candidate.nextMemoryId = nextMemoryId;
        candidate.nextGeneratedItemId = Number.isInteger(savedWorld.nextGeneratedItemId) && savedWorld.nextGeneratedItemId > 0
            ? Math.max(candidate.nextGeneratedItemId, savedWorld.nextGeneratedItemId)
            : candidate.nextGeneratedItemId;
        candidate.nextEventId = nextEventId;
        candidate.nextObservationId = nextObservationId;
        candidate.nextIntentId = Number.isInteger(savedWorld.nextIntentId) && savedWorld.nextIntentId > 0
            ? savedWorld.nextIntentId
            : 1;
    }

    function migrateSavedWorld(savedWorld) {
        const status = getMigrationStatus(savedWorld);
        if (!status.supported) return migrationFailure(status);
        if (!status.required) return ok({ migrated: false, report: null });
        if (migrationInFlight) return fail("SAVE_MIGRATION_IN_FLIGHT", "A save migration is already in progress.");

        migrationInFlight = true;
        const report = {
            fromSchemaVersion: status.fromSchemaVersion,
            toSchemaVersion: status.toSchemaVersion,
            fromAuthoringRevision: status.fromAuthoringRevision,
            toAuthoringRevision: status.toAuthoringRevision,
            status: "running",
            charactersPreserved: 0,
            charactersRemoved: 0,
            characterPositionFallbacks: 0,
            passageLocksPreserved: 0,
            itemInstancesPreserved: 0,
            itemInstancesRemoved: 0,
            itemInstancesRepositioned: 0,
            authoredKnownFactsLoaded: 0,
            memoriesPreserved: 0,
            relationshipsPreserved: 0,
            beliefsPreserved: 0,
            abstractStudyProgressPreserved: 0,
            abstractStudyProgressMigratedFromCharacter: 0,
            runtimeEventsPreserved: 0,
            runtimeEventsDiscarded: 0,
            runtimeObservationsPreserved: 0,
            runtimeObservationsDiscarded: 0,
            runtimeQueueEntriesPreserved: 0,
            warnings: [],
            errors: []
        };

        try {
            const source = clone(savedWorld);
            const candidate = createInitialWorld();
            candidate.events = [];
            candidate.ai.turnQueue = [];
            candidate.ai.continuations = {};
            if (source.ai && typeof source.ai.inferenceSessionId === "string" && source.ai.inferenceSessionId.trim()) {
                candidate.ai.inferenceSessionId = source.ai.inferenceSessionId.trim().slice(0, 160);
            }
            candidate.debug = {
                lastActionResult: null,
                controllerLog: [],
                repairs: [],
                migrationReports: []
            };

            const savedCharacters = Object.values(source.entities || {}).filter(function (entity) {
                return entity && entity.type === "character";
            });
            const candidateCharacterIds = new Set(getCharacters(candidate).map(function (character) { return character.id; }));
            report.charactersRemoved = savedCharacters.filter(function (character) {
                return !candidateCharacterIds.has(character.id);
            }).length;

            getCharacters(candidate).forEach(function (character) {
                report.authoredKnownFactsLoaded += Array.isArray(character.mind.knownFacts) ? character.mind.knownFacts.length : 0;
                const savedCharacter = source.entities && source.entities[character.id];
                if (!savedCharacter || savedCharacter.type !== "character") return;

                report.charactersPreserved += 1;
                character.mind.beliefs = migrationArray(savedCharacter, "beliefs", candidate);
                character.mind.relationships = migrationArray(savedCharacter, "relationships", candidate);
                character.mind.recentMemories = migrationArray(savedCharacter, "recentMemories", candidate);
                character.mind.longTermMemories = migrationArray(savedCharacter, "longTermMemories", candidate);
                character.recentDialogue = setup.MindValidators.sanitizeRecentDialogue(savedCharacter.recentDialogue, candidate);
                delete character.mind.abstractStudyProgress;
                character.mind.pendingObservations = [];
                character.sleeping = savedCharacter.sleeping === true;
                report.beliefsPreserved += character.mind.beliefs.length;
                report.relationshipsPreserved += character.mind.relationships.length;
                report.memoriesPreserved += character.mind.recentMemories.length + character.mind.longTermMemories.length;

                if (Number.isInteger(savedCharacter.wallet) && savedCharacter.wallet >= 0) {
                    character.wallet = savedCharacter.wallet;
                } else {
                    report.warnings.push(`Character ${character.id} had an invalid saved wallet; current authored wallet was used.`);
                }

                const savedSublocation = getSublocation(savedCharacter.sublocationId, candidate);
                if (savedSublocation) {
                    character.locationId = savedSublocation.locationId;
                    character.sublocationId = savedSublocation.id;
                    if (savedCharacter.locationId !== savedSublocation.locationId) {
                        report.warnings.push(`Character ${character.id} kept saved sublocation ${savedSublocation.id} under its current authored parent ${savedSublocation.locationId}.`);
                    }
                } else {
                    const savedLocation = getLocation(savedCharacter.locationId, candidate);
                    if (!savedLocation) {
                        const fallbackLocation = getLocation(candidate.startLocationId, candidate);
                        character.locationId = fallbackLocation.id;
                        character.sublocationId = fallbackLocation.defaultSublocationId;
                        report.characterPositionFallbacks += 1;
                        report.warnings.push(`Character ${character.id} was moved to the start location because saved location ${String(savedCharacter.locationId)} no longer exists.`);
                    } else {
                        character.locationId = savedLocation.id;
                        character.sublocationId = savedLocation.defaultSublocationId;
                        report.characterPositionFallbacks += 1;
                        report.warnings.push(`Character ${character.id} was moved to ${savedLocation.defaultSublocationId} because saved sublocation ${String(savedCharacter.sublocationId)} no longer exists.`);
                    }
                }

                const savedControllerId = source.control && source.control.assignments && source.control.assignments[character.id];
                if (CONTROLLER_IDS.has(savedControllerId)) {
                    candidate.control.assignments[character.id] = savedControllerId;
                }
                const continuation = source.ai && source.ai.continuations && source.ai.continuations[character.id];
                if (typeof continuation === "string" && continuation.length <= 2000) {
                    candidate.ai.continuations[character.id] = continuation;
                }
            });

            const controlValidation = validateControlAssignments(candidate.control.assignments, candidate);
            if (!controlValidation.ok) {
                report.warnings.push(`Human controller assignment required repair: ${controlValidation.error.message}`);
                const repaired = repairControlInvariant(candidate, "save migration controller repair");
                if (!repaired.ok) throw new Error(repaired.error.message);
            }

            const savedEquipmentByItemId = new Map();
            savedCharacters.forEach(function (savedCharacter) {
                (Array.isArray(savedCharacter.equippedItems) ? savedCharacter.equippedItems : []).forEach(function (record) {
                    if (!record || typeof record.itemId !== "string" || savedEquipmentByItemId.has(record.itemId)) return;
                    savedEquipmentByItemId.set(record.itemId, {
                        characterId: savedCharacter.id,
                        slot: String(record.slot || ""),
                        visible: record.visible !== false
                    });
                });
            });

            const savedItems = Object.values(source.entities || {}).filter(function (entity) {
                return entity && entity.type === "item";
            });
            savedItems.forEach(function (savedItem) {
                const definition = candidate.itemDefinitions[savedItem.definitionId];
                if (!definition) {
                    removeItemFromCandidate(candidate, savedItem.id);
                    report.itemInstancesRemoved += 1;
                    report.warnings.push(`Item ${savedItem.id} was removed because definition ${String(savedItem.definitionId)} no longer exists.`);
                    return;
                }
                const collision = candidate.entities[savedItem.id];
                if (collision && collision.type !== "item") {
                    report.itemInstancesRemoved += 1;
                    report.warnings.push(`Item ${savedItem.id} was removed because its ID now belongs to a non-item authored entity.`);
                    return;
                }

                removeItemFromCandidate(candidate, savedItem.id);
                const migratedItem = clone(savedItem);
                migratedItem.id = savedItem.id;
                migratedItem.type = "item";
                migratedItem.definitionId = savedItem.definitionId;
                migratedItem.name = definition.name;
                if (migratedItem.abstractStudyProgressByCharacterId !== undefined) {
                    migratedItem.abstractStudyProgressByCharacterId = migrationItemStudyProgress(savedItem);
                    report.abstractStudyProgressPreserved += Object.keys(migratedItem.abstractStudyProgressByCharacterId).length;
                    if (Object.keys(migratedItem.abstractStudyProgressByCharacterId).length === 0) delete migratedItem.abstractStudyProgressByCharacterId;
                }

                const savedEquipment = savedEquipmentByItemId.get(savedItem.id);
                if (savedEquipment) {
                    const owner = getCharacter(savedEquipment.characterId, candidate);
                    const allowed = Array.isArray(definition.equipSlots) && definition.equipSlots.includes(savedEquipment.slot);
                    const occupied = owner && Array.isArray(owner.equippedItems) && owner.equippedItems.some(function (record) { return record.slot === savedEquipment.slot; });
                    if (owner && allowed && !occupied) {
                        migratedItem.containerId = owner.id;
                        candidate.entities[migratedItem.id] = migratedItem;
                        owner.equippedItems.push({ itemId: migratedItem.id, slot: savedEquipment.slot, visible: savedEquipment.visible });
                        report.itemInstancesPreserved += 1;
                        return;
                    }
                    if (owner && candidate.inventories[owner.inventoryId]) {
                        migratedItem.containerId = owner.inventoryId;
                        candidate.entities[migratedItem.id] = migratedItem;
                        candidate.inventories[owner.inventoryId].itemIds.push(migratedItem.id);
                        report.itemInstancesPreserved += 1;
                        report.itemInstancesRepositioned += 1;
                        report.warnings.push(`Item ${savedItem.id} could not restore saved equipment slot ${savedEquipment.slot}; it was moved to ${owner.inventoryId}.`);
                        return;
                    }
                }

                let targetInventoryId = candidateInventoryForSavedContainer(source, candidate, savedItem.containerId);
                const savedContainerCharacter = getCharacter(savedItem.containerId, candidate);
                if (!targetInventoryId && savedContainerCharacter) targetInventoryId = savedContainerCharacter.inventoryId;
                if (!targetInventoryId) {
                    report.itemInstancesRemoved += 1;
                    report.warnings.push(`Item ${savedItem.id} was removed because saved container ${String(savedItem.containerId)} no longer has a safe destination.`);
                    return;
                }
                migratedItem.containerId = targetInventoryId;
                candidate.entities[migratedItem.id] = migratedItem;
                candidate.inventories[targetInventoryId].itemIds.push(migratedItem.id);
                report.itemInstancesPreserved += 1;
                if (targetInventoryId !== savedItem.containerId) {
                    report.itemInstancesRepositioned += 1;
                    report.warnings.push(`Item ${savedItem.id} moved from missing container ${String(savedItem.containerId)} to ${targetInventoryId}.`);
                }
            });

            savedCharacters.forEach(function (savedCharacter) {
                const legacyProgress = migrationAbstractStudyProgress(savedCharacter);
                Object.entries(legacyProgress).forEach(function (entry) {
                    const itemId = entry[0];
                    const progress = entry[1];
                    const item = candidate.entities[itemId];
                    const definition = item && item.type === "item" ? candidate.itemDefinitions[item.definitionId] : null;
                    if (!item || !definition || !definition.useAction || definition.useAction.effectId !== "abstract_study") {
                        report.warnings.push(`Character ${savedCharacter.id} had abstract-study progress for missing or incompatible item ${itemId}; that progress was discarded.`);
                        return;
                    }
                    if (!item.abstractStudyProgressByCharacterId || typeof item.abstractStudyProgressByCharacterId !== "object" ||
                            Array.isArray(item.abstractStudyProgressByCharacterId)) {
                        item.abstractStudyProgressByCharacterId = {};
                    }
                    if (!item.abstractStudyProgressByCharacterId[savedCharacter.id]) {
                        item.abstractStudyProgressByCharacterId[savedCharacter.id] = clone(progress);
                        report.abstractStudyProgressPreserved += 1;
                        report.abstractStudyProgressMigratedFromCharacter += 1;
                    }
                });
            });

            restoreSavedPassageLocks(candidate, source, report);
            restoreRuntimeJournal(candidate, source, report);
            reconstructPersistentCounters(candidate, source);
            const validation = validateWorld(candidate);
            if (!validation.ok) throw new Error(validation.error.message);

            report.status = report.warnings.length > 0 ? "success_with_warnings" : "success";
            candidate.debug.migrationReports.push(clone(report));
            State.variables.world = candidate;
            lastMigrationReport = clone(report);
            return ok({ migrated: true, report: clone(report) });
        } catch (error) {
            report.status = "failed";
            report.errors.push(error && error.message ? error.message : String(error));
            lastMigrationReport = clone(report);
            return fail("SAVE_MIGRATION_FAILED", "Save migration failed. Your original save was not changed.", {
                migration: clone(report)
            });
        } finally {
            migrationInFlight = false;
        }
    }


    setup.SaveMigration = {
        getStatusForWorld: function (world) { return clone(getMigrationStatus(world)); },
        getStatus: function () { return clone(getMigrationStatus(State.variables.world)); },
        migrate: function () { return migrateSavedWorld(State.variables.world); },
        isInFlight: function () { return migrationInFlight; },
        getLastReport: function () { return clone(lastMigrationReport); }
    };
}());
