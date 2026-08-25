(function () {
    "use strict";

    const LEGACY_WORLD_VERSION = 6;
    const WORLD_SCHEMA_VERSION = 17;
    const SUPPORTED_MIGRATION_SCHEMA_VERSIONS = new Set([LEGACY_WORLD_VERSION, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, WORLD_SCHEMA_VERSION]);
    const CONTROLLER_IDS = new Set(["human", "dummy", "ai"]);
    const BASE_ACTION_TYPES = ["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money"];
    const SPEECH_LOUDNESS_VALUES = Object.freeze(["noticeable", "hidden", "shout"]);
    const LOCK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
    const TIME_PHASES = new Set(["evening", "nighttime_timelapse", "morning", "daytime_timelapse"]);
    const DEFAULT_WEATHER_NARRATIVE = "The air is mild and still beneath an unremarkable sky.";

    function buildProfile() {
        return setup.BuildInfo && setup.BuildInfo.profile === "private" ? "private" : "public";
    }

    function requiredDisclosureVersion() {
        if (buildProfile() === "private") return 0;
        const value = Number(setup.BuildInfo && setup.BuildInfo.publicDisclosureVersion);
        return Number.isInteger(value) && value >= 1 ? value : 1;
    }

    function disclosureSatisfied(state) {
        const required = requiredDisclosureVersion();
        return required === 0 || Boolean(state && Number.isInteger(state.disclosureVersion) && state.disclosureVersion >= required);
    }

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
                !document.locations || !document.characters || !document.abilities || !document.itemDefinitions || !document.items || !document.dayActivities) {
            throw new Error("Generated world data is missing, lacks an authoring revision, or uses an unsupported schema version.");
        }

        world.startLocationId = document.startLocationId;
        world.abilities = clone(document.abilities);
        world.itemDefinitions = clone(document.itemDefinitions);
        world.dayActivities = clone(document.dayActivities || {});
        world.randomOutcomeTables = clone(document.randomOutcomeTables || {});
        world.calendar = {
            weekdayNames: clone(document.calendar && document.calendar.weekdayNames || ["Sunday", "Monday", "Flamesday", "Flowday", "Woodsday", "Goldsday", "Earthsday"]),
            initialWeekdayIndex: Number.isInteger(document.calendar && document.calendar.initialWeekdayIndex) ? document.calendar.initialWeekdayIndex : 0,
            dayNumber: 0
        };

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
                        requiredKeyItemId: typeof sublocation.requiredKeyItemId === "string" && sublocation.requiredKeyItemId.trim() ? sublocation.requiredKeyItemId.trim() : null,
                        itemIds: []
                    };
                }
            }
        }

        for (const [characterId, sourceCharacter] of Object.entries(document.characters)) {
            if (sourceCharacter && sourceCharacter.deferredActivation === true) continue;
            const character = clone(sourceCharacter);
            character.id = characterId;
            character.type = "character";
            character.mind = clone(character.initialMind || {});
            delete character.initialMind;
            character.mind.schemaVersion = setup.MindV3.CONFIG.SCHEMA_VERSION;
            character.mind.verbatimObservations = Array.isArray(character.mind.verbatimObservations) ? character.mind.verbatimObservations : [];
            character.mind.shortTermMemories = Array.isArray(character.mind.shortTermMemories) ? character.mind.shortTermMemories : [];
            delete character.mind.recentMemories;
            character.mind.pendingObservations = [];
            character.recentDialogue = [];
            character.discoveredCharacterIds = [];
            character.playerControllable = character.playerControllable !== false;
            character.discoveredLocationIds = Array.isArray(character.initialDiscoveredLocationIds)
                ? Array.from(new Set(character.initialDiscoveredLocationIds.filter(function (locationId) {
                    const location = world.entities[locationId];
                    return location && location.type === "location" && location.requiresDiscovery === true;
                })))
                : [];
            delete character.initialDiscoveredLocationIds;
            const authoredStartingLocation = world.entities[character.locationId];
            if (authoredStartingLocation && authoredStartingLocation.type === "location" && authoredStartingLocation.requiresDiscovery === true &&
                    !character.discoveredLocationIds.includes(authoredStartingLocation.id)) {
                character.discoveredLocationIds.push(authoredStartingLocation.id);
            }
            character.mindRevision = 0;
            character.mindDiagnostics = { beliefHistoryById: {} };
            character.mindMaintenanceSnapshots = [];
            character.mindMaintenanceState = {};
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
            if (definition.writable === true && typeof item.content !== "string") item.content = "";
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
            dayActivities: {},
            randomOutcomeTables: {},
            consumedAuthoredOutcomeIds: [],
            environment: {
                timePhase: "evening",
                weatherNarrative: "The air is mild and still beneath an unremarkable sky.",
                weatherInitialized: false,
                weatherSource: "fallback"
            },
            daytime: { pendingOffer: null, activeActivity: null },
            playerSetup: { disclaimerAccepted: false, disclosureVersion: 0, aiSetupAcknowledged: false, completed: false, mode: null, customAuthoring: null },

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
        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.initializeFreshWorld === "function") {
            const rhythmInit = setup.WeeklyRhythm.initializeFreshWorld(world);
            if (!rhythmInit.ok) throw new Error(rhythmInit.error.message);
        }
        synchronizeDerivedItemPlacement(world);
        const validation = validateWorld(world);
        if (!validation.ok) {
            throw new Error(validation.error.message);
        }
        return world;
    }

    function validCustomTravelerAuthoring(value) {
        return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
            Object.keys(value).length === 3 &&
            typeof value.name === "string" && value.name.trim() && value.name.trim().length <= 120 &&
            typeof value.playerDescription === "string" && value.playerDescription.trim() && value.playerDescription.trim().length <= 2000 &&
            typeof value.aiDescription === "string" && value.aiDescription.trim() && value.aiDescription.trim().length <= 4000);
    }

    function normalizePlayerSetup(setupState, fallbackLegacy) {
        if (!setupState || typeof setupState !== "object" || Array.isArray(setupState)) {
            return fallbackLegacy
                ? { disclaimerAccepted: true, disclosureVersion: 0, aiSetupAcknowledged: true, completed: true, mode: "legacy", customAuthoring: null }
                : { disclaimerAccepted: false, disclosureVersion: 0, aiSetupAcknowledged: false, completed: false, mode: null, customAuthoring: null };
        }
        const accepted = setupState.disclaimerAccepted === true;
        const disclosureVersion = Number.isInteger(setupState.disclosureVersion) && setupState.disclosureVersion >= 0 ? setupState.disclosureVersion : 0;
        const acknowledged = setupState.aiSetupAcknowledged === true || setupState.completed === true;
        const completed = setupState.completed === true;
        const mode = ["generic", "custom", "legacy"].includes(setupState.mode) ? setupState.mode : null;
        const customAuthoring = validCustomTravelerAuthoring(setupState.customAuthoring)
            ? {
                name: setupState.customAuthoring.name.trim(),
                playerDescription: setupState.customAuthoring.playerDescription.trim(),
                aiDescription: setupState.customAuthoring.aiDescription.trim()
            }
            : null;
        return { disclaimerAccepted: accepted, disclosureVersion: disclosureVersion, aiSetupAcknowledged: acknowledged, completed: completed, mode: mode, customAuthoring: customAuthoring };
    }

    function applyTravelerIdentity(world, identity) {
        const player = getCharacter("player", world);
        if (!player) return fail("PLAYER_CHARACTER_MISSING", "The canonical Traveler character is missing.");
        if (!identity || typeof identity !== "object") return fail("TRAVELER_IDENTITY_INVALID", "Traveler identity authoring is invalid.");
        const normalized = {
            name: typeof identity.name === "string" ? identity.name.trim() : "",
            playerDescription: typeof identity.playerDescription === "string" ? identity.playerDescription.trim() : "",
            aiDescription: typeof identity.aiDescription === "string" ? identity.aiDescription.trim() : ""
        };
        if (!normalized.name || normalized.name.length > 120) return fail("TRAVELER_NAME_INVALID", "Traveler name must contain 1 to 120 characters.");
        if (!normalized.playerDescription || normalized.playerDescription.length > 2000) return fail("TRAVELER_DESCRIPTION_INVALID", "Traveler visible description must contain 1 to 2000 characters.");
        if (!normalized.aiDescription || normalized.aiDescription.length > 4000) return fail("TRAVELER_AUTHORING_INVALID", "Traveler character authoring must contain 1 to 4000 characters.");
        player.name = normalized.name;
        player.playerDescription = normalized.playerDescription;
        player.aiDescription = normalized.aiDescription;
        player.interactionLabel = `Speak with ${normalized.name}`;
        if (world.inventories[player.inventoryId]) world.inventories[player.inventoryId].name = normalized.name;
        return ok({ identity: normalized });
    }

    function playerSetupComplete(world) {
        const state = world && world.playerSetup;
        return Boolean(state && state.aiSetupAcknowledged === true && state.completed === true && disclosureSatisfied(state));
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
            (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(character, world)) &&
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

    function clearSchedulerInbox(characterId, world) {
        const character = getCharacter(characterId, world);
        if (character && character.mind && Array.isArray(character.mind.pendingObservations)) character.mind.pendingObservations = [];
        ensureAIState(world);
        world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) {
            return (typeof entry === "string" ? entry : entry && entry.characterId) !== characterId;
        });
    }

    function enqueueControllerTransition(characterId, reason, world) {
        const character = getCharacter(characterId, world);
        if (!character || world.control.assignments[characterId] !== "ai" || !character.mind) return;
        if (!Array.isArray(character.mind.pendingObservations)) character.mind.pendingObservations = [];
        const record = {
            id: world.nextObservationId++,
            kind: "controller_transition",
            turn: Number.isInteger(world.nextEventId) ? world.nextEventId : 1,
            actorId: characterId,
            targetId: characterId,
            text: "Human control was released. Reassess the current situation and resume acting autonomously.",
            code: reason || "released_from_human"
        };
        character.mind.pendingObservations.push(record);
        enqueueAITurn(characterId, reason || "released_from_human", world);
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
            if (!isAIQueueEligible(character.id, world) || queued.has(character.id)) return;
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

    function locationRequiresDiscovery(locationOrId, world) {
        const w = world || getWorld();
        const location = typeof locationOrId === "string" ? getLocation(locationOrId, w) : locationOrId;
        return Boolean(location && location.type === "location" && location.requiresDiscovery === true);
    }

    function characterHasDiscoveredLocation(characterOrId, locationId, world) {
        const w = world || getWorld();
        const location = getLocation(locationId, w);
        if (!location) return false;
        if (!locationRequiresDiscovery(location, w)) return true;
        const character = typeof characterOrId === "string" ? getCharacter(characterOrId, w) : characterOrId;
        return Boolean(character && Array.isArray(character.discoveredLocationIds) && character.discoveredLocationIds.includes(location.id));
    }

    function grantLocationDiscovery(characterOrId, locationId, world) {
        const w = world || getWorld();
        const character = typeof characterOrId === "string" ? getCharacter(characterOrId, w) : characterOrId;
        const location = getLocation(locationId, w);
        if (!character || !location || !locationRequiresDiscovery(location, w)) return false;
        if (!Array.isArray(character.discoveredLocationIds)) character.discoveredLocationIds = [];
        if (character.discoveredLocationIds.includes(location.id)) return false;
        character.discoveredLocationIds.push(location.id);
        return true;
    }

    function normalizeCharacterDiscoveries(character, world, savedIds) {
        if (!character) return [];
        const ids = [];
        const seen = new Set();
        function add(locationId) {
            if (typeof locationId !== "string" || seen.has(locationId)) return;
            const location = getLocation(locationId, world);
            if (!location || !locationRequiresDiscovery(location, world)) return;
            seen.add(locationId);
            ids.push(locationId);
        }
        (Array.isArray(character.discoveredLocationIds) ? character.discoveredLocationIds : []).forEach(add);
        (Array.isArray(savedIds) ? savedIds : []).forEach(add);
        if (locationRequiresDiscovery(character.locationId, world)) add(character.locationId);
        character.discoveredLocationIds = ids;
        return ids;
    }


    function characterRequiresDiscovery(characterOrId, world) {
        const w = world || getWorld();
        const character = typeof characterOrId === "string" ? getCharacter(characterOrId, w) : characterOrId;
        return Boolean(character && character.type === "character" && character.requiresDiscovery === true);
    }

    function characterHasDiscoveredCharacter(observerOrId, targetOrId, world) {
        const w = world || getWorld();
        const target = typeof targetOrId === "string" ? getCharacter(targetOrId, w) : targetOrId;
        if (!target) return false;
        if (!characterRequiresDiscovery(target, w)) return true;
        const observer = typeof observerOrId === "string" ? getCharacter(observerOrId, w) : observerOrId;
        if (observer && observer.id === target.id) return true;
        return Boolean(observer && Array.isArray(observer.discoveredCharacterIds) && observer.discoveredCharacterIds.includes(target.id));
    }

    function grantCharacterDiscovery(observerOrId, targetOrId, world) {
        const w = world || getWorld();
        const observer = typeof observerOrId === "string" ? getCharacter(observerOrId, w) : observerOrId;
        const target = typeof targetOrId === "string" ? getCharacter(targetOrId, w) : targetOrId;
        if (!observer || !target || !characterRequiresDiscovery(target, w)) return false;
        if (!Array.isArray(observer.discoveredCharacterIds)) observer.discoveredCharacterIds = [];
        if (observer.discoveredCharacterIds.includes(target.id)) return false;
        observer.discoveredCharacterIds.push(target.id);
        return true;
    }

    function normalizeCharacterDiscoveriesByCharacter(character, world, savedIds) {
        if (!character) return [];
        const seen = new Set();
        const ids = [];
        function add(characterId) {
            if (typeof characterId !== "string" || seen.has(characterId) || characterId === character.id) return;
            const target = getCharacter(characterId, world);
            if (!target || !characterRequiresDiscovery(target, world)) return;
            seen.add(characterId);
            ids.push(characterId);
        }
        (Array.isArray(character.discoveredCharacterIds) ? character.discoveredCharacterIds : []).forEach(add);
        (Array.isArray(savedIds) ? savedIds : []).forEach(add);
        character.discoveredCharacterIds = ids;
        return ids;
    }

    function locationExitEntriesForActor(location, actor, world) {
        const w = world || getWorld();
        return locationExitEntries(location, w).filter(function (transition) {
            return characterHasDiscoveredLocation(actor, transition.destinationId, w);
        });
    }

    function eventLocationIds(event, world) {
        const result = [];
        const seen = new Set();
        ["locationId", "fromLocationId", "toLocationId", "sourceLocationId", "destinationLocationId", "destinationId", "revealedLocationId"].forEach(function (field) {
            const locationId = event && event[field];
            if (typeof locationId !== "string" || seen.has(locationId) || !getLocation(locationId, world)) return;
            seen.add(locationId);
            result.push(locationId);
        });
        return result;
    }

    function eventTouchesUndiscoveredLocation(event, characterOrId, world) {
        const w = world || getWorld();
        return eventLocationIds(event, w).some(function (locationId) {
            return locationRequiresDiscovery(locationId, w) && !characterHasDiscoveredLocation(characterOrId, locationId, w);
        });
    }

    function eventTouchesUndiscoveredCharacter(event, characterOrId, world) {
        const w = world || getWorld();
        const observer = typeof characterOrId === "string" ? getCharacter(characterOrId, w) : characterOrId;
        if (!observer) return false;
        const ids = [event && event.actorId, event && event.targetId, event && event.discoveredCharacterId].filter(function (id, index, values) {
            return typeof id === "string" && id && id !== observer.id && values.indexOf(id) === index;
        });
        return ids.some(function (characterId) {
            const target = getCharacter(characterId, w);
            return Boolean(target && characterRequiresDiscovery(target, w) && !characterHasDiscoveredCharacter(observer, target, w));
        });
    }

    function passageDeps() { return { getLocation:getLocation, getItemDefinition:getItemDefinition, fail:fail, ok:ok }; }
    function locationExitEntries(location, world) {
        const entries = setup.PassageRules.locationExitEntries(location);
        const w = world || getWorld();
        if (!w || !setup.WeeklyRhythm || typeof setup.WeeklyRhythm.isLocationAvailable !== "function") return entries;
        return entries.filter(function (transition) {
            const destination = getLocation(transition.destinationId, w);
            return destination && setup.WeeklyRhythm.isLocationAvailable(destination, w);
        });
    }
    function findLocationExit(location, destinationId) { return setup.PassageRules.findLocationExit(location, destinationId); }
    function matchingKeyItems(actor, lockId, world) { return setup.PassageRules.matchingKeyItems(actor, lockId, world, getItemDefinition); }
    function reciprocalTransition(sourceLocationId, transition, world) { return setup.PassageRules.reciprocalTransition(sourceLocationId, transition, world, getLocation); }
    function lockActionOptions(actor, world, expectedLockedState) {
        const options = setup.PassageRules.lockActionOptions(actor, world, expectedLockedState, passageDeps());
        const passages = (options.passages || []).filter(function (passage) {
            const destination = getLocation(passage.id, world);
            if (!destination || !characterHasDiscoveredLocation(actor, destination.id, world)) return false;
            return !setup.WeeklyRhythm || typeof setup.WeeklyRhythm.isLocationAvailable !== "function" || setup.WeeklyRhythm.isLocationAvailable(destination, world);
        });
        return { destination_ids: passages.map(function (passage) { return passage.id; }), passages: passages };
    }
    function validateLockAction(actor, action, world, expectedLockedState) {
        const destination = getLocation(action && action.destination_id, world);
        if (destination && !characterHasDiscoveredLocation(actor, destination.id, world)) {
            return fail("DESTINATION_UNDISCOVERED", "That destination has not been discovered by this character.");
        }
        if (destination && setup.WeeklyRhythm && typeof setup.WeeklyRhythm.isLocationAvailable === "function" && !setup.WeeklyRhythm.isLocationAvailable(destination, world)) {
            return fail("DESTINATION_NOT_AVAILABLE", "Destination is not currently available in the local world.");
        }
        return setup.PassageRules.validateLockAction(actor, action, world, expectedLockedState, passageDeps());
    }
    function setPassageLocked(sourceLocationId, destinationId, locked, world) { return setup.PassageRules.setPassageLocked(sourceLocationId, destinationId, locked, world, passageDeps()); }

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

    function itemInstanceDisplayName(item, world) {
        const definition = getItemDefinition(item, world);
        const canonicalName = definition ? definition.name : item && item.name || "Item";
        if (!item || !definition || definition.writable !== true) return canonicalName;
        const normalized = String(item.content || "")
            .replace(/\*/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!normalized) return canonicalName;
        const words = normalized.split(" ").filter(Boolean);
        const preview = words.slice(0, 5).join(" ");
        return `${canonicalName} — ${preview}${words.length > 5 ? "…" : ""}`;
    }

    function itemView(item, world) {
        const definition = getItemDefinition(item, world);
        return {
            id: item.id,
            name: definition ? definition.name : item.name,
            display_name: itemInstanceDisplayName(item, world),
            definition_id: definition ? definition.id : item.definitionId,
            family_id: definition ? definition.familyId : "",
            description: definition && typeof definition.description === "string" ? definition.description : "",
            tags: definition ? clone(definition.tags || []) : [],
            consumable: Boolean(definition && definition.consumable),
            equippable: Boolean(definition && Array.isArray(definition.equipSlots) && definition.equipSlots.length),
            equip_slots: definition ? clone(definition.equipSlots || []) : [],
            equipped_description: definition && typeof definition.equippedDescription === "string" ? definition.equippedDescription : "",
            fillable: Boolean(definition && definition.fillable),
            writable: Boolean(definition && definition.writable === true),
            writing_capability: Boolean(definition && definition.writingCapability === true)
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

    function actorDirectlyCarriesItem(actor, itemId, world) {
        const inventory = actor && world.inventories[actor.inventoryId];
        return Boolean(inventory && inventory.itemIds.includes(itemId));
    }

    function canAccessInventory(actor, inventory, world) {
        if (!inventory) return false;
        if (!inventory.requiredKeyItemId) return true;
        return actorDirectlyCarriesItem(actor, inventory.requiredKeyItemId, world);
    }

    function actorOwnsItem(actor, itemId, world) {
        return actorDirectlyCarriesItem(actor, itemId, world) || equippedRecords(actor).some(function (record) { return record.itemId === itemId; });
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


    function createGeneratedItemInstance(definitionId, inventoryId, world) {
        const definition = world.itemDefinitions && world.itemDefinitions[definitionId];
        const inventory = world.inventories && world.inventories[inventoryId];
        if (!definition || !inventory) throw new Error("Generated item definition or destination inventory is missing.");
        if (!Number.isInteger(world.nextGeneratedItemId) || world.nextGeneratedItemId < 1) world.nextGeneratedItemId = 1;
        let id;
        do { id = `generated_${definition.id}_${world.nextGeneratedItemId++}`; } while (world.entities[id]);
        world.entities[id] = { id: id, type: "item", definitionId: definition.id, name: definition.name, containerId: inventory.id };
        inventory.itemIds.push(id);
        return id;
    }

    function renderAuthoredOutcomeText(template, actor, details) {
        const values = Object.assign({ actorName: actor && actor.name || "Someone" }, details || {});
        return String(template || "").replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (_, key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`;
        });
    }

    function authoredOutcomeEffectApplicable(effect, actor, world) {
        if (!effect || typeof effect !== "object") return false;
        if (effect.type === "emit_observation") return typeof effect.text === "string" && Boolean(effect.text.trim());
        if (effect.type === "reveal_location") {
            return Boolean(getLocation(effect.locationId, world) && locationRequiresDiscovery(effect.locationId, world) &&
                !characterHasDiscoveredLocation(actor, effect.locationId, world));
        }
        if (effect.type === "encounter_character") {
            const target = getCharacter(effect.characterId, world);
            return Boolean(target && characterRequiresDiscovery(target, world) && !characterHasDiscoveredCharacter(actor, target, world) &&
                target.locationId === actor.locationId && (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(target, world)));
        }
        if (effect.type === "modify_wallet") {
            return effect.target === "actor" && Number.isInteger(effect.amount) && effect.amount !== 0 &&
                Number.isInteger(actor.wallet) && actor.wallet + effect.amount >= 0;
        }
        if (effect.type === "create_item") {
            return effect.destination === "actor_inventory" && Boolean(world.itemDefinitions && world.itemDefinitions[effect.itemDefinitionId]) &&
                Number.isInteger(effect.quantity || 1) && (effect.quantity || 1) > 0 && Boolean(world.inventories[actor.inventoryId]);
        }
        return false;
    }

    function authoredOutcomeApplicable(outcome, actor, world) {
        return Boolean(outcome && Array.isArray(outcome.effects) && outcome.effects.length > 0 &&
            outcome.effects.every(function (effect) { return authoredOutcomeEffectApplicable(effect, actor, world); }));
    }

    function eligibleAuthoredOutcomeRecords(actor, table, world) {
        const consumed = new Set(Array.isArray(world.consumedAuthoredOutcomeIds) ? world.consumedAuthoredOutcomeIds : []);
        return (table && Array.isArray(table.outcomes) ? table.outcomes : []).filter(function (outcome) {
            return outcome && !(outcome.once === true && consumed.has(outcome.id)) && authoredOutcomeApplicable(outcome, actor, world);
        });
    }

    function authoredOutcomeTableCanAffect(actor, table, world) {
        return Boolean(table && eligibleAuthoredOutcomeRecords(actor, table, world).length > 0);
    }

    function executeAuthoredOutcomeEffects(actor, outcome, world, context) {
        const events = [];
        const createdItemIds = [];
        (outcome.effects || []).forEach(function (effect) {
            if (!authoredOutcomeEffectApplicable(effect, actor, world)) throw new Error(`Authored outcome effect '${String(effect.type)}' is not applicable.`);
            if (effect.type === "emit_observation") {
                events.push({
                    type: "authored_outcome_observed", actorId: actor.id, locationId: actor.locationId, sublocationId: actor.sublocationId,
                    actionType: context && context.actionType || "authored_outcome", outcomeId: outcome.id,
                    authoredInteractionId: context && context.authoredInteractionId || null,
                    text: renderAuthoredOutcomeText(effect.text, actor, {})
                });
            } else if (effect.type === "reveal_location") {
                const location = getLocation(effect.locationId, world);
                if (!grantLocationDiscovery(actor, location.id, world)) throw new Error(`Location '${location.id}' could not be discovered.`);
                events.push({
                    type: "location_discovered", actorId: actor.id, targetId: actor.id, locationId: actor.locationId,
                    revealedLocationId: location.id, actionType: context && context.actionType || "authored_outcome", outcomeId: outcome.id,
                    text: renderAuthoredOutcomeText(effect.observationText || `${actor.name} discovered ${location.name}.`, actor, { locationName: location.name })
                });
            } else if (effect.type === "encounter_character") {
                const target = getCharacter(effect.characterId, world);
                if (!grantCharacterDiscovery(actor, target, world)) throw new Error(`Character '${target.id}' could not be discovered.`);
                events.push({
                    type: "character_discovered", actorId: actor.id, targetId: target.id, locationId: actor.locationId,
                    discoveredCharacterId: target.id, actionType: context && context.actionType || "authored_outcome", outcomeId: outcome.id,
                    text: renderAuthoredOutcomeText(effect.observationText || `${actor.name} encounters ${target.name}.`, actor, { characterName: target.name })
                });
            } else if (effect.type === "modify_wallet") {
                actor.wallet += effect.amount;
            } else if (effect.type === "create_item") {
                const count = effect.quantity || 1;
                for (let index = 0; index < count; index++) createdItemIds.push(createGeneratedItemInstance(effect.itemDefinitionId, actor.inventoryId, world));
            }
        });
        return { events: events, createdItemIds: createdItemIds };
    }

    function restoreWorldObject(target, snapshot) {
        Object.keys(target).forEach(function (key) { delete target[key]; });
        Object.assign(target, clone(snapshot));
    }

    function runAuthoredOutcomeTable(actorOrId, tableId, world, options) {
        const w = world || ensureWorld();
        const actor = typeof actorOrId === "string" ? getCharacter(actorOrId, w) : actorOrId;
        const table = w.randomOutcomeTables && w.randomOutcomeTables[tableId];
        if (!actor) return fail("OUTCOME_ACTOR_INVALID", "Authored outcome actor does not exist.");
        if (!table) return fail("OUTCOME_TABLE_INVALID", `Random outcome table '${String(tableId)}' does not exist.`);
        const eligible = eligibleAuthoredOutcomeRecords(actor, table, w);
        const noOutcomeWeight = Number(table.noOutcomeWeight || 0);
        const total = noOutcomeWeight + eligible.reduce(function (sum, outcome) { return sum + Number(outcome.weight || 0); }, 0);
        if (!(total > 0)) return fail("OUTCOME_NONE_APPLICABLE", "No authored outcome is currently applicable.");
        const random = options && typeof options.random === "function" ? options.random : Math.random;
        let roll = Number(random());
        if (!Number.isFinite(roll)) roll = 0;
        roll = Math.max(0, Math.min(roll, 0.9999999999999999)) * total;
        if (roll < noOutcomeWeight) return ok({ selectedOutcomeId: null, noOutcome: true, events: [], createdItemIds: [] });
        roll -= noOutcomeWeight;
        let selected = null;
        for (const outcome of eligible) {
            if (roll < outcome.weight) { selected = outcome; break; }
            roll -= outcome.weight;
        }
        selected = selected || eligible[eligible.length - 1];
        if (!selected) return ok({ selectedOutcomeId: null, noOutcome: true, events: [], createdItemIds: [] });

        const snapshot = clone(w);
        try {
            const liveActor = getCharacter(actor.id, w);
            if (!liveActor) throw Object.assign(new Error("Authored outcome actor disappeared before execution."), { code: "OUTCOME_ACTOR_INVALID" });
            const executed = executeAuthoredOutcomeEffects(liveActor, selected, w, options || {});
            if (selected.once === true) {
                if (!Array.isArray(w.consumedAuthoredOutcomeIds)) w.consumedAuthoredOutcomeIds = [];
                if (!w.consumedAuthoredOutcomeIds.includes(selected.id)) w.consumedAuthoredOutcomeIds.push(selected.id);
            }
            const invariant = validateWorld(w);
            if (!invariant.ok) throw Object.assign(new Error(invariant.error.message), { code: invariant.error.code || "OUTCOME_WORLD_INVALID" });
            return ok({ selectedOutcomeId: selected.id, noOutcome: false, events: executed.events, createdItemIds: executed.createdItemIds });
        } catch (error) {
            restoreWorldObject(w, snapshot);
            return fail(error && error.code || "OUTCOME_EXECUTION_FAILED", error && error.message || "Authored outcome execution failed.");
        }
    }

    function authoredInteractionRecords(actor, world) {
        const sublocation = getSublocation(actor && actor.sublocationId, world);
        if (!sublocation || !Array.isArray(sublocation.interactions)) return [];
        return sublocation.interactions.filter(function (interaction) {
            const table = world.randomOutcomeTables && world.randomOutcomeTables[interaction.outcomeTableId];
            return interaction && interaction.effectId === "random_outcome" && table && authoredOutcomeTableCanAffect(actor, table, world);
        });
    }

    function sublocationOccupants(sublocationId, world, excludedCharacterId) {
        return getCharacters(world).filter(function (character) {
            return character.id !== excludedCharacterId && character.sublocationId === sublocationId &&
                (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(character, world));
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
        }).filter(function (inventory) {
            return canAccessInventory(actor, inventory, world);
        });
    }

    function canReachCharacter(actor, target, world) {
        if (!actor || !target || actor.locationId !== target.locationId) {
            return false;
        }
        if (!characterHasDiscoveredCharacter(actor, target, world)) return false;
        if (setup.WeeklyRhythm && (!setup.WeeklyRhythm.isCharacterPresent(actor, world) || !setup.WeeklyRhythm.isCharacterPresent(target, world))) {
            return false;
        }
        const actorPosition = getSublocation(actor.sublocationId, world);
        return Boolean(actorPosition &&
            (actor.sublocationId === target.sublocationId ||
                (actorPosition.reachableSublocationIds || []).includes(target.sublocationId)));
    }

    function inventoryOwnerLabel(inventory, world) {
        if (!inventory) return "inventory";
        const owner = world.entities[inventory.ownerId];
        return inventory.name || (owner && owner.name) || inventory.id;
    }

    function bulkTransferRoutes(actor, world) {
        const actorInventory = world.inventories[actor.inventoryId];
        if (!actorInventory) return [];
        const routes = [];
        nearbyCharacters(actor, world).filter(function (character) {
            return canReachCharacter(actor, character, world);
        }).forEach(function (character) {
            const targetInventory = world.inventories[character.inventoryId];
            if (!targetInventory || actorInventory.itemIds.length === 0) return;
            routes.push({
                source_inventory_id: actorInventory.id,
                target_inventory_id: targetInventory.id,
                target_character_id: character.id,
                direction: "character_to_character",
                label: `Give items to ${character.name}`,
                item_ids: actorInventory.itemIds.slice()
            });
        });
        accessibleInventories(actor, world).forEach(function (inventory) {
            if (!inventory || inventory.id === actorInventory.id) return;
            if (actorInventory.itemIds.length > 0) {
                routes.push({
                    source_inventory_id: actorInventory.id,
                    target_inventory_id: inventory.id,
                    direction: "character_to_container",
                    label: `Put items in ${inventoryOwnerLabel(inventory, world)}`,
                    item_ids: actorInventory.itemIds.slice()
                });
            }
            if (inventory.itemIds.length > 0) {
                routes.push({
                    source_inventory_id: inventory.id,
                    target_inventory_id: actorInventory.id,
                    direction: "container_to_character",
                    label: `Take items from ${inventoryOwnerLabel(inventory, world)}`,
                    item_ids: inventory.itemIds.slice()
                });
            }
        });
        return routes;
    }

    function accessibleLooseItemEntries(actor, world) {
        const inventories = [world.inventories[actor.inventoryId]].concat(accessibleInventories(actor, world));
        const seen = new Set();
        const result = [];
        inventories.forEach(function (inventory) {
            if (!inventory || !canAccessInventory(actor, inventory, world)) return;
            inventory.itemIds.forEach(function (itemId) {
                if (seen.has(itemId)) return;
                const item = world.entities[itemId];
                if (!item || item.type !== "item") return;
                seen.add(itemId);
                result.push({ item: item, inventory: inventory, definition: getItemDefinition(item, world) });
            });
        });
        return result;
    }

    function hasWritingCapability(actor, world) {
        return accessibleLooseItemEntries(actor, world).some(function (entry) {
            return entry.definition && entry.definition.writingCapability === true;
        });
    }

    function writableItemEntries(actor, world) {
        return accessibleLooseItemEntries(actor, world).filter(function (entry) {
            return entry.definition && entry.definition.writable === true;
        });
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
            if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.validateAwayState === "function") {
                const awayValidation = setup.WeeklyRhythm.validateAwayState(character, world);
                if (!awayValidation.ok) return awayValidation;
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
                            : setup.MindV3.CONFIG.LTM_SUMMARY_MAX_CHARS
                    });
                    if (!recordValidation.ok || memoryIds.has(memory.id)) return fail("CHARACTER_MIND_INVALID", `Character ${character.id} contains an invalid or duplicate memory.`);
                    memoryIds.add(memory.id);
                }
            }
            const verbatimIds = new Set();
            for (const observation of character.mind.verbatimObservations) {
                const recordValidation = setup.MindValidators.validateVerbatimObservation(observation);
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
            if (!ability || ability.id !== abilityId || !ActionRegistry[ability.actionType]) {
                return fail("ABILITY_DEFINITION_INVALID", `Ability ${abilityId} has an invalid registered action type.`);
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
        const itemResult = validateItemInvariants(world);
        if (!itemResult.ok) return itemResult;
        const environmentResult = validateEnvironmentAndDaytime(world);
        if (!environmentResult.ok) return environmentResult;
        const randomOutcomeResult = validateAuthoredOutcomeRuntime(world);
        if (!randomOutcomeResult.ok) return randomOutcomeResult;

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

        if (!world.environment || typeof world.environment !== "object" || Array.isArray(world.environment)) {
            world.environment = { timePhase: "evening", weatherNarrative: DEFAULT_WEATHER_NARRATIVE, weatherInitialized: false, weatherSource: "fallback" };
        }
        if (!TIME_PHASES.has(world.environment.timePhase)) world.environment.timePhase = "evening";
        if (typeof world.environment.weatherNarrative !== "string" || !world.environment.weatherNarrative.trim()) world.environment.weatherNarrative = DEFAULT_WEATHER_NARRATIVE;
        if (typeof world.environment.weatherInitialized !== "boolean") world.environment.weatherInitialized = false;
        if (typeof world.environment.weatherSource !== "string") world.environment.weatherSource = world.environment.weatherInitialized ? "saved" : "fallback";
        if (!world.dayActivities || typeof world.dayActivities !== "object" || Array.isArray(world.dayActivities)) world.dayActivities = clone(setup.GeneratedWorldData.dayActivities || {});
        delete world.travelerProfiles;
        world.playerSetup = normalizePlayerSetup(world.playerSetup, true);
        if (!world.daytime || typeof world.daytime !== "object" || Array.isArray(world.daytime)) world.daytime = { pendingOffer: null, activeActivity: null };
        if (!Object.prototype.hasOwnProperty.call(world.daytime, "pendingOffer")) world.daytime.pendingOffer = null;
        if (!Object.prototype.hasOwnProperty.call(world.daytime, "activeActivity")) world.daytime.activeActivity = null;
        getCharacters(world).forEach(function (character) {
            normalizeCharacterDiscoveries(character, world);
            normalizeCharacterDiscoveriesByCharacter(character, world);
            character.playerControllable = character.playerControllable !== false;
        });
        if (!world.randomOutcomeTables || typeof world.randomOutcomeTables !== "object" || Array.isArray(world.randomOutcomeTables)) {
            world.randomOutcomeTables = clone(setup.GeneratedWorldData.randomOutcomeTables || {});
        }
        const validOnceOutcomeIds = new Set();
        Object.values(world.randomOutcomeTables || {}).forEach(function (table) {
            (table && Array.isArray(table.outcomes) ? table.outcomes : []).forEach(function (outcome) {
                if (outcome && outcome.once === true && typeof outcome.id === "string") validOnceOutcomeIds.add(outcome.id);
            });
        });
        world.consumedAuthoredOutcomeIds = Array.from(new Set((Array.isArray(world.consumedAuthoredOutcomeIds) ? world.consumedAuthoredOutcomeIds : []).filter(function (id) {
            return typeof id === "string" && validOnceOutcomeIds.has(id);
        })));

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
            ["shortTermMemories", "longTermMemories"].forEach(function (partition) {
                (character.mind && character.mind[partition] || []).forEach(function (memory) {
                    if (memory.retrievalBrief === undefined || memory.retrievalBrief === null) memory.retrievalBrief = "";
                });
            });
            if (world.control.assignments[character.id] !== "ai" && character.mind && Array.isArray(character.mind.pendingObservations) && character.mind.pendingObservations.length) {
                character.mind.pendingObservations = [];
            }
            if (setup.AIMemory && typeof setup.AIMemory.ensureRuntimeMindFields === "function") setup.AIMemory.ensureRuntimeMindFields(character);
            if (setup.AIMemory && typeof setup.AIMemory.sanitizeMaintenanceSnapshots === "function") {
                character.mindMaintenanceSnapshots = setup.AIMemory.sanitizeMaintenanceSnapshots(character.mindMaintenanceSnapshots);
            } else if (!Array.isArray(character.mindMaintenanceSnapshots)) {
                character.mindMaintenanceSnapshots = [];
            }
            character.mindMaintenanceState = setup.AIMemory && typeof setup.AIMemory.sanitizeMindMaintenanceState === "function"
                ? setup.AIMemory.sanitizeMindMaintenanceState(character.mindMaintenanceState)
                : {};
        });
        if (!world.ai || typeof world.ai !== "object") world.ai = { turnQueue: [], continuations: {} };
        if (typeof world.ai.inferenceSessionId !== "string" || !world.ai.inferenceSessionId.trim()) {
            world.ai.inferenceSessionId = createInferenceSessionId();
        }
        synchronizeDerivedItemPlacement(world);
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
        if (target.playerControllable === false) {
            return fail("CHARACTER_NOT_PLAYER_CONTROLLABLE", "This character cannot be assigned to HumanController.");
        }
        const currentHuman = getCharacter(getHumanCharacterId(world), world);
        if (target.requiresDiscovery === true && currentHuman && target.id !== currentHuman.id && !characterHasDiscoveredCharacter(currentHuman, target, world)) {
            return fail("CHARACTER_UNDISCOVERED", "This character has not been discovered by the current Human-controlled character.");
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
        clearSchedulerInbox(target.id, world);
        if (previousHumanId !== target.id) {
            clearSchedulerInbox(previousHumanId, world);
            if (candidate[previousHumanId] === "ai") enqueueControllerTransition(previousHumanId, "released_from_human", world);
        }
        repairAIQueue(world);
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
        if (controllerId !== "ai") clearSchedulerInbox(characterId, world);
        repairAIQueue(world);
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
                (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(character, world)) &&
                character.locationId === actor.locationId &&
                characterHasDiscoveredCharacter(actor, character, world);
        });
    }

    function transferItem(itemId, sourceInventory, targetInventory, world) {
        sourceInventory.itemIds = sourceInventory.itemIds.filter(function (id) {
            return id !== itemId;
        });
        targetInventory.itemIds.push(itemId);
        world.entities[itemId].containerId = targetInventory.id;
        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.noteItemTransfer === "function") {
            setup.WeeklyRhythm.noteItemTransfer(world.entities[itemId], sourceInventory, targetInventory, world);
        }
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

    function knowledgeMatchTokens(text) {
        return String(text || "").normalize("NFKC").toLowerCase()
            .replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/g, " ")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function knowledgeKeywordMatch(inputText, keyword) {
        const raw = typeof keyword === "string" ? keyword.normalize("NFKC").trim().toLowerCase() : "";
        if (!raw) return null;
        const wildcard = raw.endsWith("*");
        const stem = wildcard ? raw.slice(0, -1).trim() : raw;
        if (!stem || stem.includes("*")) return null;
        const patternTokens = knowledgeMatchTokens(stem);
        const inputTokens = knowledgeMatchTokens(inputText);
        if (!patternTokens.length || inputTokens.length < patternTokens.length) return null;
        for (let start = 0; start <= inputTokens.length - patternTokens.length; start += 1) {
            let matched = true;
            for (let offset = 0; offset < patternTokens.length; offset += 1) {
                const expected = patternTokens[offset];
                const actual = inputTokens[start + offset];
                const last = offset === patternTokens.length - 1;
                if (wildcard && last ? !actual.startsWith(expected) : actual !== expected) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return {
                    keyword: raw,
                    wildcard: wildcard,
                    specificity: patternTokens.reduce(function (sum, token) { return sum + token.length; }, 0) * 2 + (wildcard ? 0 : 1)
                };
            }
        }
        return null;
    }

    function matchingKnowledgeEntry(useAction, inputText) {
        const entries = useAction && Array.isArray(useAction.knowledgeEntries) ? useAction.knowledgeEntries : [];
        let best = null;
        entries.forEach(function (entry, entryIndex) {
            if (!entry || !Array.isArray(entry.keywords)) return;
            let bestKeyword = null;
            entry.keywords.forEach(function (keyword) {
                const match = knowledgeKeywordMatch(inputText, keyword);
                if (match && (!bestKeyword || match.specificity > bestKeyword.specificity)) bestKeyword = match;
            });
            if (!bestKeyword) return;
            const priority = Number.isInteger(entry.priority) ? entry.priority : 0;
            const candidate = { entry: entry, entryIndex: entryIndex, keywordMatch: bestKeyword, priority: priority };
            if (!best || candidate.priority > best.priority ||
                    (candidate.priority === best.priority && candidate.keywordMatch.specificity > best.keywordMatch.specificity) ||
                    (candidate.priority === best.priority && candidate.keywordMatch.specificity === best.keywordMatch.specificity && candidate.entryIndex < best.entryIndex)) {
                best = candidate;
            }
        });
        return best;
    }

    const ItemEffectRegistry = {
        report_memory_counts: {
            execute: function (actor, item, definition, useAction) {
                const recentCount = actor.mind && Array.isArray(actor.mind.shortTermMemories)
                    ? actor.mind.shortTermMemories.length
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
                const knowledgeMatch = matchingKnowledgeEntry(useAction, inputText);
                if (knowledgeMatch) {
                    const entry = knowledgeMatch.entry;
                    return {
                        feedback: [{
                            recipientId: actor.id,
                            kind: "observation",
                            code: "ITEM_AUTHORED_KNOWLEDGE_RESULT",
                            text: renderItemActionText(entry.article, {
                                actorName: actor.name,
                                itemName: definition.name,
                                inputText: inputText,
                                articleTitle: entry.title || ""
                            }),
                            data: {
                                itemId: item.id,
                                effectId: useAction.effectId,
                                inputText: inputText,
                                studyStage: "article",
                                studyDepth: 0,
                                relatedToPrevious: false,
                                knowledgeEntryId: entry.id,
                                knowledgeEntryTitle: entry.title || null,
                                matchedKeyword: knowledgeMatch.keywordMatch.keyword
                            }
                        }]
                    };
                }
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
            return (!setup.WeeklyRhythm || setup.WeeklyRhythm.isSublocationAvailable(sublocation, world)) &&
                Array.isArray(sublocation.capabilities) && sublocation.capabilities.includes("sleep");
        });
    }

    function canTraverseTimelapseTransition(actor, transition, world) {
        if (!transition || !transition.destinationId || transition.blocked) return false;
        if (!transition.lockId || !transition.locked) return true;
        return matchingKeyItems(actor, transition.lockId, world).length > 0;
    }

    function timelapseRoute(actor, destinationId, world) {
        if (!actor || !getLocation(destinationId, world) || (setup.WeeklyRhythm && (!setup.WeeklyRhythm.isCharacterPresent(actor, world) || !setup.WeeklyRhythm.isLocationAvailable(destinationId, world)))) return null;
        const startId = actor.locationId;
        const queue = [startId];
        const previous = new Map([[startId, null]]);
        while (queue.length > 0) {
            const locationId = queue.shift();
            if (locationId === destinationId) break;
            const location = getLocation(locationId, world);
            locationExitEntriesForActor(location, actor, world).forEach(function (transition) {
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

    function timelapseStudyItems(actor, location, world) {
        if (!actor || !location) return [];
        const itemIds = new Set();
        const actorInventory = world.inventories[actor.inventoryId];
        (actorInventory && actorInventory.itemIds || []).forEach(function (itemId) { itemIds.add(itemId); });
        const locationInventory = world.inventories[location.inventoryId];
        if (canAccessInventory(actor, locationInventory, world)) {
            (locationInventory && locationInventory.itemIds || []).forEach(function (itemId) { itemIds.add(itemId); });
        }
        getSublocations(location.id, world).forEach(function (sublocation) {
            const inventory = sublocation.inventoryId && world.inventories[sublocation.inventoryId];
            if (!canAccessInventory(actor, inventory, world)) return;
            (inventory && inventory.itemIds || []).forEach(function (itemId) { itemIds.add(itemId); });
        });
        return Array.from(itemIds).map(function (itemId) {
            const item = world.entities[itemId];
            const definition = item && item.type === "item" ? getItemDefinition(item, world) : null;
            const useAction = definition && definition.useAction;
            if (!item || !definition || !useAction || useAction.effectId !== "abstract_study") return null;
            return {
                id: item.id,
                name: definition.name,
                actionLabel: useAction.actionLabel || `Study ${definition.name}`,
                inputLabel: useAction.inputLabel || "Question or topic",
                inputMaxLength: Number.isInteger(useAction.inputMaxLength) ? useAction.inputMaxLength : 600,
                instructions: useAction.aiInstructions || "Choose a specific subject to study."
            };
        }).filter(Boolean);
    }

    function getTimelapseReachableCatalog(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        return Object.values(world.entities).filter(function (entity) {
            return entity && entity.type === "location" && (!setup.WeeklyRhythm || setup.WeeklyRhythm.isLocationAvailable(entity, world));
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
                }),
                studyItems: timelapseStudyItems(actor, location, world)
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

    function applyRoutineAnchor(actorId, phase) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Routine actor character does not exist.");
        const anchors = actor.routineAnchors && typeof actor.routineAnchors === "object" ? actor.routineAnchors : null;
        const anchor = anchors && anchors[phase];
        if (!anchor) return ok({ actorId: actorId, phase: phase, applied: false, skipped: true });
        const destination = getLocation(anchor.locationId, world);
        const targetSublocation = getSublocation(anchor.sublocationId, world);
        if (!destination || !targetSublocation || targetSublocation.locationId !== destination.id) {
            return fail("ROUTINE_ANCHOR_INVALID", "The authored routine destination is invalid.");
        }
        const route = timelapseRoute(actor, destination.id, world);
        if (!route) return fail("ROUTINE_ANCHOR_UNREACHABLE", `${actor.name} could not reach the usual ${phase} position.`);
        if (sublocationOccupants(targetSublocation.id, world, actor.id).length >= targetSublocation.capacity) {
            return fail("ROUTINE_ANCHOR_FULL", `${actor.name}'s usual ${phase} position is full.`);
        }
        if (actor.locationId === destination.id && actor.sublocationId === targetSublocation.id) {
            return ok({ actorId: actorId, phase: phase, applied: false, skipped: false, route: route });
        }
        const before = { locationId: actor.locationId, sublocationId: actor.sublocationId };
        actor.locationId = destination.id;
        actor.sublocationId = targetSublocation.id;
        const validation = validateWorld(world);
        if (!validation.ok) {
            actor.locationId = before.locationId;
            actor.sublocationId = before.sublocationId;
            return validation;
        }
        return ok({
            actorId: actorId,
            phase: phase,
            applied: true,
            skipped: false,
            route: route,
            fromLocationId: before.locationId,
            fromSublocationId: before.sublocationId,
            toLocationId: destination.id,
            toSublocationId: targetSublocation.id
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

        if (action.type === "study_item") {
            const available = timelapseStudyItems(actor, location, world);
            const option = available.find(function (candidate) { return candidate.id === action.itemId; });
            const inputText = typeof action.inputText === "string" ? action.inputText.trim() : "";
            if (!option) return fail("TIMELAPSE_STUDY_ITEM_UNAVAILABLE", "The selected study item is not accessible in this room.");
            if (!inputText || inputText.length > option.inputMaxLength) return fail("TIMELAPSE_STUDY_INPUT_INVALID", `Study input must contain 1 to ${option.inputMaxLength} characters.`);
            const item = world.entities[action.itemId];
            const definition = getItemDefinition(item, world);
            const effectResult = ItemEffectRegistry.abstract_study.execute(actor, item, definition, definition.useAction, world, { input_text: inputText });
            const feedback = effectResult && effectResult.feedback && effectResult.feedback[0];
            const stage = feedback && feedback.data && feedback.data.studyStage || "survey";
            const validation = validateWorld(world);
            if (!validation.ok) return validation;
            return ok({
                actorId: actorId, locationId: locationId, type: "study_item", itemId: item.id, inputText: inputText, studyStage: stage,
                knowledgeEntryId: feedback && feedback.data && feedback.data.knowledgeEntryId || null,
                privateExperienceText: feedback && feedback.data && feedback.data.knowledgeEntryId ? feedback.text : null,
                text: `${actor.name} consulted ${definition.name}, studying “${inputText}” (${stage}).`
            });
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

    function observedMoveDestinationTargets(actor, destinationId, world) {
        const latestObservedMoveByActor = new Map();
        const events = Array.isArray(world && world.events) ? world.events : [];
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index];
            if (!event || event.type !== "character_moved" || !event.actorId || event.actorId === actor.id) continue;
            if (latestObservedMoveByActor.has(event.actorId)) continue;
            if (!Array.isArray(event.recipients) || !event.recipients.includes(actor.id)) continue;
            latestObservedMoveByActor.set(event.actorId, event.toLocationId || event.locationId || null);
        }
        return Array.from(latestObservedMoveByActor.entries()).filter(function (entry) {
            return entry[1] === destinationId;
        }).map(function (entry) {
            const character = getCharacter(entry[0], world);
            return character && (!setup.WeeklyRhythm || setup.WeeklyRhythm.isCharacterPresent(character, world))
                ? { id: character.id, name: character.name }
                : null;
        }).filter(Boolean);
    }

    function groundedMoveSpeechTargets(actor, destinationId, world) {
        const destination = getLocation(destinationId, world);
        if (!destination) return [];
        const location = getLocation(actor.locationId, world);
        if (!location || !findLocationExit(location, destinationId) || !characterHasDiscoveredLocation(actor, destinationId, world)) return [];
        return observedMoveDestinationTargets(actor, destinationId, world);
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
                const destinationIds = locationExitEntriesForActor(location, actor, world).map(function (entry) {
                    return entry.destinationId;
                }).filter(Boolean);
                const speechTargetsByDestination = {};
                destinationIds.forEach(function (destinationId) {
                    const targets = groundedMoveSpeechTargets(actor, destinationId, world);
                    if (targets.length > 0) speechTargetsByDestination[destinationId] = targets;
                });
                return {
                    destination_ids: destinationIds,
                    speech_targets_by_destination: speechTargetsByDestination
                };
            },
            validate: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                const destination = getLocation(action.destination_id, world);

                if (!destination || (setup.WeeklyRhythm && !setup.WeeklyRhythm.isLocationAvailable(destination, world))) {
                    return fail("DESTINATION_NOT_FOUND", "Destination does not exist or is not currently present in the local world.");
                }
                if (!characterHasDiscoveredLocation(actor, destination.id, world)) {
                    return fail("DESTINATION_UNDISCOVERED", "That destination has not been discovered by this character.");
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
                            (!setup.WeeklyRhythm || setup.WeeklyRhythm.isSublocationAvailable(destination, world)) &&
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
                if (setup.WeeklyRhythm && !setup.WeeklyRhythm.isSublocationAvailable(destination, world)) {
                    return fail("SUBLOCATION_NOT_AVAILABLE", "Destination position is not currently available in the local world.");
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

        transfer_items: {
            description: "Transfer an explicit bundle of loose item instances between the actor, a nearby character, or an accessible local container. The whole bundle succeeds or fails atomically.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "transfer_items" },
                    source_inventory_id: { type: "string" },
                    target_inventory_id: { type: "string" },
                    item_ids: { type: "array", minItems: 1, items: { type: "string" } }
                },
                required: ["type", "source_inventory_id", "target_inventory_id", "item_ids"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { routes: bulkTransferRoutes(actor, world) };
            },
            validate: function (actor, action, world) {
                if (!Array.isArray(action.item_ids) || action.item_ids.length === 0) {
                    return fail("EMPTY_ITEM_BUNDLE", "Choose at least one item to transfer.");
                }
                if (new Set(action.item_ids).size !== action.item_ids.length) {
                    return fail("DUPLICATE_ITEM_ID", "A bulk transfer cannot contain the same item more than once.");
                }
                if (action.source_inventory_id === action.target_inventory_id) {
                    return fail("NO_OP_TRANSFER", "Source and target inventories must be different.");
                }
                const route = bulkTransferRoutes(actor, world).find(function (candidate) {
                    return candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
                });
                if (!route) return fail("TRANSFER_ROUTE_UNAVAILABLE", "That transfer route is not currently accessible.");
                const allowed = new Set(route.item_ids || []);
                for (const itemId of action.item_ids) {
                    const item = world.entities[itemId];
                    if (!item || item.type !== "item") return fail("ITEM_NOT_FOUND", `Item ${itemId} does not exist.`);
                    if (!allowed.has(itemId) || item.containerId !== action.source_inventory_id) {
                        return fail("ITEM_NOT_ACCESSIBLE", `${item.name || itemId} is not available from the selected source.`);
                    }
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const source = world.inventories[action.source_inventory_id];
                const target = world.inventories[action.target_inventory_id];
                const names = action.item_ids.map(function (itemId) { return world.entities[itemId].name; });
                action.item_ids.forEach(function (itemId) { transferItem(itemId, source, target, world); });
                const targetOwner = world.entities[target.ownerId];
                return [{
                    type: "items_transferred",
                    actorId: actor.id,
                    targetId: targetOwner && targetOwner.type === "character" ? targetOwner.id : null,
                    itemIds: action.item_ids.slice(),
                    sourceInventoryId: source.id,
                    targetInventoryId: target.id,
                    locationId: actor.locationId,
                    text: `${actor.name} transferred ${action.item_ids.length} item${action.item_ids.length === 1 ? "" : "s"}: ${names.join(", ")}.`
                }];
            }
        },

        read_paper: {
            description: "Read or view the persistent content of an accessible writable paper item.",
            schema: {
                type: "object",
                properties: { type: { const: "read_paper" }, item_id: { type: "string" } },
                required: ["type", "item_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { item_ids: writableItemEntries(actor, world).map(function (entry) { return entry.item.id; }) };
            },
            validate: function (actor, action, world) {
                const entry = writableItemEntries(actor, world).find(function (candidate) { return candidate.item.id === action.item_id; });
                return entry ? ok() : fail("PAPER_NOT_ACCESSIBLE", "That paper is not accessible to the actor.");
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const content = typeof item.content === "string" ? item.content : "";
                return { events: [{
                    type: "paper_read",
                    actorId: actor.id,
                    itemId: item.id,
                    locationId: actor.locationId,
                    text: `${actor.name} reads ${definition ? definition.name : item.name}.`
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "PAPER_CONTENT",
                    text: content || "The paper is blank.",
                    data: { itemId: item.id, content: content }
                }] };
            }
        },

        write_paper: {
            description: "Write or draw on an accessible paper item. Plain text is verbatim writing; *...* describes a drawing or other visual mark. Requires an accessible reusable Writing Set.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "write_paper" },
                    item_id: { type: "string" },
                    content: { type: "string", maxLength: 12000 }
                },
                required: ["type", "item_id", "content"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { item_ids: hasWritingCapability(actor, world) ? writableItemEntries(actor, world).map(function (entry) { return entry.item.id; }) : [] };
            },
            validate: function (actor, action, world) {
                if (!hasWritingCapability(actor, world)) return fail("WRITING_SET_REQUIRED", "A Writing Set is required to write or draw on paper.");
                const entry = writableItemEntries(actor, world).find(function (candidate) { return candidate.item.id === action.item_id; });
                if (!entry) return fail("PAPER_NOT_ACCESSIBLE", "That paper is not accessible to the actor.");
                if (typeof action.content !== "string" || action.content.length > 12000) return fail("INVALID_PAPER_CONTENT", "Paper content must be text no longer than 12000 characters.");
                const normalized = action.content.replace(/\r\n/g, "\n");
                const current = (typeof entry.item.content === "string" ? entry.item.content : "").replace(/\r\n/g, "\n");
                if (normalized === current) return fail("NO_OP_PAPER_EDIT", "The paper already has exactly that content.");
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                item.content = action.content.replace(/\r\n/g, "\n");
                const definition = getItemDefinition(item, world);
                return [{
                    type: "paper_written",
                    actorId: actor.id,
                    itemId: item.id,
                    locationId: actor.locationId,
                    text: `${actor.name} writes or draws on ${definition ? definition.name : item.name}.`
                }];
            }
        },

        show_hidden_location: {
            description: "Show a nearby character the concealed entrance to a hidden location that you already know.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "show_hidden_location" },
                    target_id: { type: "string" },
                    location_id: { type: "string" }
                },
                required: ["type", "target_id", "location_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const source = getLocation(actor.locationId, world);
                const candidates = locationExitEntries(source, world).map(function (transition) {
                    const location = getLocation(transition.destinationId, world);
                    if (!location || !locationRequiresDiscovery(location, world) || !characterHasDiscoveredLocation(actor, location.id, world)) return null;
                    const targets = nearbyCharacters(actor, world).filter(function (target) {
                        return canReachCharacter(actor, target, world) && !characterHasDiscoveredLocation(target, location.id, world);
                    }).map(function (target) { return { id: target.id, name: target.name }; });
                    return targets.length > 0 ? { id: location.id, name: location.name, target_ids: targets.map(function (target) { return target.id; }), targets: targets } : null;
                }).filter(Boolean);
                return {
                    location_ids: candidates.map(function (candidate) { return candidate.id; }),
                    target_ids: Array.from(new Set(candidates.flatMap(function (candidate) { return candidate.target_ids; }))),
                    locations: candidates
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                const destination = getLocation(action.location_id, world);
                const source = getLocation(actor.locationId, world);
                if (!target || target.id === actor.id) return fail("TARGET_NOT_FOUND", "A valid other character is required.");
                if (!canReachCharacter(actor, target, world)) return fail("TARGET_NOT_REACHABLE", "Target cannot currently perceive the actor nearby.");
                if (!destination || !locationRequiresDiscovery(destination, world)) return fail("HIDDEN_LOCATION_INVALID", "The selected hidden location is invalid.");
                if (!findLocationExit(source, destination.id)) return fail("HIDDEN_LOCATION_NOT_ADJACENT", "The concealed entrance is not at the current location.");
                if (!characterHasDiscoveredLocation(actor, destination.id, world)) return fail("HIDDEN_LOCATION_UNKNOWN", "The actor does not know that hidden location.");
                if (characterHasDiscoveredLocation(target, destination.id, world)) return fail("HIDDEN_LOCATION_ALREADY_KNOWN", "The target already knows that hidden location.");
                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                const destination = getLocation(action.location_id, world);
                grantLocationDiscovery(target, destination.id, world);
                return [{
                    type: "hidden_location_shown",
                    actorId: actor.id,
                    targetId: target.id,
                    locationId: actor.locationId,
                    revealedLocationId: destination.id,
                    noticeability: "hidden",
                    text: `${actor.name} showed ${target.name} the concealed way to ${destination.name}.`
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
                const target = sublocation.inventoryId ? world.inventories[sublocation.inventoryId] : null;
                return {
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice(),
                    target_inventory_ids: target && canAccessInventory(actor, target, world) ? [target.id] : []
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
                const targetInventory = world.inventories[action.target_inventory_id];
                if (!targetInventory) {
                    return fail("INVENTORY_NOT_FOUND", "Target inventory does not exist.");
                }
                if (!canAccessInventory(actor, targetInventory, world)) {
                    return fail("INVENTORY_KEY_REQUIRED", "Actor does not possess the key required to access this container.");
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

        authored_interaction: {
            description: "Perform one authored physical interaction available at the actor's current position. interaction_id must be one of this action's listed interaction IDs.",
            schema: {
                type: "object",
                properties: { type: { const: "authored_interaction" }, interaction_id: { type: "string" } },
                required: ["type", "interaction_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const interactions = authoredInteractionRecords(actor, world).map(function (interaction) {
                    return { id: interaction.id, action_label: interaction.actionLabel, outcome_table_id: interaction.outcomeTableId };
                });
                return { interaction_ids: interactions.map(function (entry) { return entry.id; }), interactions: interactions };
            },
            validate: function (actor, action, world) {
                const interaction = authoredInteractionRecords(actor, world).find(function (entry) { return entry.id === action.interaction_id; });
                if (!interaction) return fail("AUTHORED_INTERACTION_UNAVAILABLE", "That authored interaction is not available at the actor's current position.");
                return ok();
            },
            execute: function (actor, action, world) {
                const interaction = authoredInteractionRecords(actor, world).find(function (entry) { return entry.id === action.interaction_id; });
                if (!interaction) throw new Error("Authored interaction became unavailable before execution.");
                const result = runAuthoredOutcomeTable(actor, interaction.outcomeTableId, world, {
                    random: Math.random,
                    actionType: "authored_interaction",
                    authoredInteractionId: interaction.id
                });
                if (!result.ok) throw new Error(result.error.message);
                return { events: result.events || [], feedback: [] };
            }
        },

        offer_day_work: {
            description: "Formally offer the Human-controlled Traveler one of your available full-day jobs. Use this only when you have actually decided to offer work. A neutral stranger who asks reasonably for simple work should usually be acceptable, but your personality, memories, relationships, and recent context may justify refusal. You may offer proactively when there is a natural reason, but do not repeatedly offer work without context. The player will separately accept or decline.",
            schema: {
                type: "object",
                properties: { type: { const: "offer_day_work" }, activity_id: { type: "string" } },
                required: ["type", "activity_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const activities = Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "sponsored_job" && activity.sponsorCharacterId === actor.id;
                }).map(function (activity) {
                    return { id: activity.id, name: activity.name, description: activity.offerDescription || "" };
                });
                return { activity_ids: activities.map(function (activity) { return activity.id; }), activities: activities };
            },
            validate: function (actor, action, world) {
                if (world.environment.timePhase !== "morning") return fail("DAY_WORK_NOT_MORNING", "Full-day work can only be offered during Morning.");
                if (world.daytime.pendingOffer || world.daytime.activeActivity) return fail("DAY_WORK_ALREADY_PENDING", "Another daytime activity is already pending or active.");
                const activity = world.dayActivities[action.activity_id];
                if (!activity || activity.kind !== "sponsored_job" || activity.sponsorCharacterId !== actor.id) return fail("DAY_WORK_ACTIVITY_INVALID", "That daytime job is not available to this sponsor.");
                const human = getCharacter(getHumanCharacterId(world), world);
                if (!human || !canReachCharacter(actor, human, world)) return fail("DAY_WORK_TRAVELER_NOT_REACHABLE", "The Traveler is not physically reachable for this work offer.");
                return ok({ activity: activity, human: human });
            },
            execute: function (actor, action, world) {
                const activity = world.dayActivities[action.activity_id];
                const humanId = getHumanCharacterId(world);
                world.daytime.pendingOffer = {
                    activityId: activity.id,
                    sponsorCharacterId: actor.id,
                    humanCharacterId: humanId,
                    reactedCharacterIds: []
                };
                return [{
                    type: "day_work_offered",
                    actorId: actor.id,
                    targetId: humanId,
                    locationId: actor.locationId,
                    activityId: activity.id,
                    text: `${actor.name} offered ${getCharacter(humanId, world).name} a day of work: ${activity.name}.`
                }];
            }
        },

        go_hunting: {
            description: "Spend the full day hunting small game alone. This begins the daytime timelapse and is available only at the authored hunting entry location during Morning.",
            schema: { type: "object", properties: { type: { const: "go_hunting" } }, required: ["type"], additionalProperties: false },
            getOptions: function (actor, world) {
                const activities = Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "solo" && activity.entryLocationId === actor.locationId;
                });
                return { activity_ids: activities.map(function (activity) { return activity.id; }) };
            },
            validate: function (actor, action, world) {
                if (world.control.assignments[actor.id] !== "human") return fail("DAY_ACTIVITY_HUMAN_ONLY", "This daytime activity entry is HumanController-only.");
                if (world.environment.timePhase !== "morning") return fail("DAY_ACTIVITY_NOT_MORNING", "Hunting for the day can only begin during Morning.");
                if (world.daytime.pendingOffer || world.daytime.activeActivity) return fail("DAY_ACTIVITY_ALREADY_PENDING", "Another daytime activity is already pending or active.");
                const activity = Object.values(world.dayActivities || {}).find(function (candidate) {
                    return candidate && candidate.kind === "solo" && candidate.entryLocationId === actor.locationId;
                });
                if (!activity) return fail("DAY_ACTIVITY_UNAVAILABLE", "No solo daytime activity is available here.");
                return ok({ activity: activity });
            },
            execute: function (actor, action, world) {
                const activity = Object.values(world.dayActivities || {}).find(function (candidate) {
                    return candidate && candidate.kind === "solo" && candidate.entryLocationId === actor.locationId;
                });
                world.daytime.activeActivity = { activityId: activity.id, sponsorCharacterId: null, humanCharacterId: actor.id };
                return [{
                    type: "day_activity_started",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    activityId: activity.id,
                    text: `${actor.name} set out to spend the day hunting.`
                }];
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

        defer_departure: {
            description: "Delay this visit's imminent planned departure by exactly one timelapse period.",
            schema: {
                type: "object",
                properties: { type: { const: "defer_departure" } },
                required: ["type"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return setup.WeeklyRhythm && typeof setup.WeeklyRhythm.deferOptions === "function"
                    ? setup.WeeklyRhythm.deferOptions(actor, world)
                    : {};
            },
            validate: function (actor, action, world) {
                if (!setup.WeeklyRhythm || typeof setup.WeeklyRhythm.canDeferDeparture !== "function" ||
                        !setup.WeeklyRhythm.canDeferDeparture(actor, world)) {
                    return fail("DEPARTURE_DEFER_NOT_IMMINENT", "Departure can only be deferred when it is the boundary reached by the next timelapse.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const result = setup.WeeklyRhythm.deferDeparture(actor, world);
                if (!result.ok) throw new Error(result.error.message);
                return { events: [], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "DEPARTURE_DEFERRED",
                    text: result.text,
                    data: {
                        previousPlannedDeparture: clone(result.previousPlannedDeparture),
                        plannedDeparture: clone(result.plannedDeparture)
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
                const feedbackText = results.length > 0
                    ? ["You read the nearby auras."].concat(results.map(function (result) {
                        return `${result.name}: ${result.aura}`;
                    })).join("\n")
                    : "You sense no other auras nearby.";
                return { events: [], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "AURA_SCAN_RESULT",
                    text: feedbackText,
                    data: { results: results }
                }] };
            }
        }
    };

    const ACTION_AI_METADATA = Object.freeze({
        move: {
            aiDescription: "Move to a directly connected major location.",
            aiPrerequisites: ["The destination must be directly connected, discovered, available, unblocked, and unlocked.", "The destination's default position must have capacity."],
        },
        unlock: {
            aiDescription: "Unlock a directly connected lockable passage.",
            aiPrerequisites: ["A locked passage must be present here.", "The actor must directly carry a matching key."],
        },
        lock: {
            aiDescription: "Lock a directly connected lockable passage.",
            aiPrerequisites: ["An unlocked lockable passage must be present here.", "The actor must directly carry a matching key."],
        },
        move_within_location: {
            aiDescription: "Change tracked position within the current major location.",
            aiPrerequisites: ["The destination position must be reachable, available, and have capacity."],
        },
        take_item: {
            aiDescription: "Take an accessible item into the actor's inventory.",
            aiPrerequisites: ["The item must be in an inventory accessible from the actor's current position."],
        },
        drop_item: {
            aiDescription: "Drop an owned item into the current location inventory.",
            aiPrerequisites: ["The actor must possess the item."],
        },
        give_item: {
            aiDescription: "Give an owned item to a nearby reachable character.",
            aiPrerequisites: ["The actor must possess the item.", "The recipient must be nearby and reachable."],
        },
        transfer_items: {
            aiDescription: "Move one or more accessible items between the actor and an accessible inventory or container.",
            aiPrerequisites: ["The source and destination inventories must be accessible from the actor's current position.", "The selected items must be on the offered transfer route."],
        },
        read_paper: {
            aiDescription: "Read the tracked contents of an accessible writable paper item.",
            aiPrerequisites: ["A writable paper item must be accessible to the actor."],
        },
        write_paper: {
            aiDescription: "Write or draw tracked content on an accessible paper item.",
            aiPrerequisites: ["A writable paper item must be accessible.", "An appropriate reusable Writing Set must be accessible to the actor."],
        },
        show_hidden_location: {
            aiDescription: "Show a nearby character the concealed entrance to a hidden location the actor has already discovered.",
            aiPrerequisites: ["The actor must know the hidden location.", "The actor and target must be together at an authored entrance.", "The target must not already know the location."],
        },
        give_money: {
            aiDescription: "Transfer tracked gold from the actor to a nearby character.",
            aiPrerequisites: ["The actor must have enough gold.", "The recipient must be nearby and reachable."],
        },
        place_item: {
            aiDescription: "Place an owned item into an accessible sublocation/container inventory.",
            aiPrerequisites: ["The actor must possess the item.", "The target inventory must be accessible from the current position."],
        },
        fill: {
            aiDescription: "Fill a compatible vessel from a compatible environmental source.",
            aiPrerequisites: ["A compatible fill source must be present at the actor's current position.", "A compatible vessel must be accessible to or held by the actor."],
        },
        consume: {
            aiDescription: "Fully consume an eligible tracked consumable item and apply its authored result.",
            aiPrerequisites: ["The consumable item must be accessible to or held by the actor."],
        },
        equip: {
            aiDescription: "Equip an owned equippable item into its tracked equipment slot or slots.",
            aiPrerequisites: ["The actor must possess the equippable item.", "All required equipment slots must be free."],
        },
        unequip: {
            aiDescription: "Remove a tracked equipped item and return it to the actor's inventory.",
            aiPrerequisites: ["The item must currently be equipped by the actor."],
        },
        use_item: {
            aiDescription: "Use an accessible item through its authored tracked item-specific effect.",
            aiPrerequisites: ["The relevant item must be accessible to or equipped by the actor.", "Any item-specific input requirements must be satisfied."],
        },
        authored_interaction: {
            aiDescription: "Perform an authored physical interaction available at the actor's exact current position.",
            aiPrerequisites: ["The interaction must be authored at the actor's current sublocation and currently applicable."],
        },
        offer_day_work: {
            aiDescription: "Formally offer the Human-controlled Traveler an authored full-day sponsored job.",
            aiPrerequisites: ["It must be Morning.", "No other daytime activity may be pending or active.", "The Traveler must be reachable.", "The actor must sponsor the offered job."],
        },
        go_hunting: {
            aiDescription: "Begin the authored full-day solo squirrel-hunting activity.",
            aiPrerequisites: ["The actor must be the Human-controlled character.", "It must be Morning.", "The actor must be at the authored hunting entry location.", "No other daytime activity may be pending or active."],
        },
        sleep: {
            aiDescription: "Enter tracked sleeping state while positioned on a bed.",
            aiPrerequisites: ["The actor must be at a sublocation with the sleep capability.", "For the Human-controlled character, overnight sleep is available in Evening."],
        },
        defer_departure: {
            aiDescription: "Privately defer the current visit's imminent planned departure by exactly one coarse timelapse period.",
            aiPrerequisites: ["The actor must be authored as awayable and currently present.", "The current planned departure must be exactly the boundary reached by the next timelapse transition.", "This action is available only during ordinary Morning or Evening gameplay, never inside timelapse planning."],
        },
        read_aura: {
            aiDescription: "Use the actor's formal aura-reading ability to request private engine-grounded aura information for currently perceivable characters.",
            aiPrerequisites: ["The actor must possess the authored aura-reading ability."],
        }
    });

    Object.entries(ACTION_AI_METADATA).forEach(function (entry) {
        const type = entry[0];
        const metadata = entry[1];
        if (!ActionRegistry[type]) return;
        ActionRegistry[type].aiDescription = metadata.aiDescription;
        ActionRegistry[type].aiPrerequisites = clone(metadata.aiPrerequisites || []);
    });

    function grantedActionSources(actor, world) {
        const grants = {};
        function grant(type, source) {
            if (!grants[type]) grants[type] = [];
            grants[type].push(source);
        }
        for (const type of BASE_ACTION_TYPES) grant(type, { kind: "base" });
        const sublocation = getSublocation(actor.sublocationId, world);
        for (const type of (sublocation.capabilities || [])) {
            if (type === "sleep" && world.control.assignments[actor.id] === "human" && world.environment.timePhase !== "evening") continue;
            grant(type, { kind: "sublocation", id: sublocation.id });
        }
        authoredInteractionRecords(actor, world).forEach(function (interaction) {
            grant("authored_interaction", { kind: "environment_interaction", id: interaction.id, label: interaction.actionLabel });
        });
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

        const bulkRoutes = bulkTransferRoutes(actor, world);
        if (bulkRoutes.length > 0) grant("transfer_items", { kind: "bulk_transfer" });
        const writableEntries = writableItemEntries(actor, world);
        if (writableEntries.length > 0) grant("read_paper", { kind: "writable_item" });
        if (writableEntries.length > 0 && hasWritingCapability(actor, world)) grant("write_paper", { kind: "writing_set" });

        const location = getLocation(actor.locationId, world);
        if (ActionRegistry.show_hidden_location.getOptions(actor, world).locations.length > 0) {
            grant("show_hidden_location", { kind: "location_discovery" });
        }
        locationExitEntriesForActor(location, actor, world).forEach(function (transition) {
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

        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.canDeferDeparture === "function" && setup.WeeklyRhythm.canDeferDeparture(actor, world)) {
            grant("defer_departure", { kind: "awayable_lifecycle" });
        }

        if (world.environment.timePhase === "morning" && world.daytime && !world.daytime.pendingOffer && !world.daytime.activeActivity) {
            const humanId = getHumanCharacterId(world);
            const human = getCharacter(humanId, world);
            if (world.control.assignments[actor.id] === "ai" && human && canReachCharacter(actor, human, world)) {
                Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "sponsored_job" && activity.sponsorCharacterId === actor.id;
                }).forEach(function (activity) {
                    grant("offer_day_work", { kind: "day_activity", id: activity.id, name: activity.name });
                });
            }
            if (world.control.assignments[actor.id] === "human") {
                Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "solo" && activity.entryLocationId === actor.locationId;
                }).forEach(function (activity) {
                    grant("go_hunting", { kind: "day_activity", id: activity.id, name: activity.name });
                });
            }
        }

        for (const abilityId of (actor.abilityIds || [])) {
            const ability = world.abilities[abilityId];
            if (ability) grant(ability.actionType, { kind: "character_ability", id: ability.id, name: ability.name });
        }
        return grants;
    }

    function relevantActionSources(actor, world) {
        const relevant = {};
        function grant(type, source) {
            if (!ActionRegistry[type]) return;
            if (!relevant[type]) relevant[type] = [];
            const serialized = JSON.stringify(source || { kind: "relevant" });
            if (!relevant[type].some(function (existing) { return JSON.stringify(existing) === serialized; })) {
                relevant[type].push(source || { kind: "relevant" });
            }
        }

        const strict = grantedActionSources(actor, world);
        Object.entries(strict).forEach(function (entry) {
            const type = entry[0];
            if (BASE_ACTION_TYPES.includes(type)) return;
            (entry[1] || []).forEach(function (source) { grant(type, clone(source)); });
        });

        const baseOptions = {};
        BASE_ACTION_TYPES.forEach(function (type) { baseOptions[type] = ActionRegistry[type].getOptions(actor, world); });
        if ((baseOptions.move.destination_ids || []).length > 0) grant("move", { kind: "base" });
        if ((baseOptions.move_within_location.destination_ids || []).length > 0) grant("move_within_location", { kind: "base" });
        if ((baseOptions.take_item.item_ids || []).length > 0) grant("take_item", { kind: "base" });
        if ((baseOptions.drop_item.item_ids || []).length > 0) grant("drop_item", { kind: "base" });
        if ((baseOptions.give_item.target_ids || []).length > 0 && (baseOptions.give_item.item_ids || []).length > 0) grant("give_item", { kind: "base" });
        if ((baseOptions.give_money.target_ids || []).length > 0 && Number(baseOptions.give_money.maximum_amount || 0) > 0) grant("give_money", { kind: "base" });

        const sublocation = getSublocation(actor.sublocationId, world);
        const environmentCapabilities = new Set(sublocation && sublocation.capabilities || []);
        Object.values(world.itemDefinitions || {}).forEach(function (definition) {
            const fillAction = definition && definition.fillAction;
            if (!fillAction || !fillAction.requiredEnvironmentCapability || !environmentCapabilities.has(fillAction.requiredEnvironmentCapability)) return;
            grant("fill", { kind: "environment", sublocationId: sublocation.id, capability: fillAction.requiredEnvironmentCapability });
        });

        const writableEntries = writableItemEntries(actor, world);
        if (writableEntries.length > 0) grant("write_paper", { kind: "writable_item" });

        const actorInventory = world.inventories[actor.inventoryId];
        for (const itemId of actorInventory ? actorInventory.itemIds : []) {
            const item = world.entities[itemId];
            const definition = getItemDefinition(item, world);
            if (definition && Array.isArray(definition.equipSlots) && definition.equipSlots.length > 0) {
                grant("equip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
        }

        const location = getLocation(actor.locationId, world);
        locationExitEntriesForActor(location, actor, world).forEach(function (transition) {
            if (!transition.lockId) return;
            grant(transition.locked ? "unlock" : "lock", {
                kind: "passage",
                lockId: transition.lockId,
                destinationId: transition.destinationId
            });
        });

        return relevant;
    }

    function itemSpecificMechanicVariants(type, sources, world) {
        const variants = [];
        (sources || []).forEach(function (source) {
            if (!source || source.kind !== "item" || !source.id) return;
            const item = world.entities[source.id];
            const definition = getItemDefinition(item, world);
            if (!definition) return;
            let action = null;
            if (type === "use_item") action = definition.useAction;
            else if (type === "fill") action = definition.fillAction;
            else if (type === "consume") action = definition.consumeAction;
            if (!action || typeof action !== "object") return;
            const record = {
                itemId: item.id,
                itemName: definition.name,
                actionLabel: typeof action.actionLabel === "string" ? action.actionLabel : null
            };
            if (typeof action.aiDescription === "string" && action.aiDescription.trim()) record.description = action.aiDescription.trim();
            if (Array.isArray(action.aiPrerequisites) && action.aiPrerequisites.length > 0) record.prerequisites = action.aiPrerequisites.map(String);
            variants.push(record);
        });
        return variants;
    }

    function getRelevantMechanics(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const sourcesByType = relevantActionSources(actor, world);
        const mechanics = {};
        Object.entries(sourcesByType).forEach(function (entry) {
            const type = entry[0];
            const definition = ActionRegistry[type];
            if (!definition) return;
            const record = {
                description: definition.aiDescription || definition.description,
                prerequisites: clone(definition.aiPrerequisites || []),
                sources: clone(entry[1] || [])
            };
            const variants = itemSpecificMechanicVariants(type, entry[1], world);
            if (variants.length > 0) record.itemSpecific = variants;
            mechanics[type] = record;
        });
        return mechanics;
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
            world_conditions: {
                time_phase: world.environment.timePhase,
                time_label: world.environment.timePhase === "daytime_timelapse" ? "Day" : (world.environment.timePhase === "nighttime_timelapse" ? "Night" : (world.environment.timePhase === "morning" ? "Morning" : "Evening")),
                weekday: setup.WeeklyRhythm ? setup.WeeklyRhythm.currentWeekdayName(world) : "",
                day_number: world.calendar && Number.isInteger(world.calendar.dayNumber) ? world.calendar.dayNumber : 0,
                display_time: `${setup.WeeklyRhythm ? setup.WeeklyRhythm.currentWeekdayName(world) : ""} · ${world.environment.timePhase === "daytime_timelapse" ? "Day" : (world.environment.timePhase === "nighttime_timelapse" ? "Night" : (world.environment.timePhase === "morning" ? "Morning" : "Evening"))}`.replace(/^ · /, ""),
                weather: world.environment.weatherNarrative
            },
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
                sublocations: getSublocations(location.id, world).filter(function (sublocation) {
                    return !setup.WeeklyRhythm || setup.WeeklyRhythm.isSublocationAvailable(sublocation, world);
                }).map(function (sublocation) {
                    return {
                        id: sublocation.id,
                        name: sublocation.name,
                        enter_label: sublocation.enterLabel,
                        public_text: sublocation.publicText || "",
                        capacity: sublocation.capacity
                    };
                }),
                items: inventoryItems(location.inventoryId, world),
                exits: locationExitEntriesForActor(location, actor, world).map(function (transition) {
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
            if (rule.type === "array") {
                if (!Array.isArray(value)) errors.push(`Action field ${key} must be an array.`);
                else {
                    if (Number.isInteger(rule.minItems) && value.length < rule.minItems) errors.push(`Action field ${key} must contain at least ${rule.minItems} item(s).`);
                    if (Number.isInteger(rule.maxItems) && value.length > rule.maxItems) errors.push(`Action field ${key} must contain no more than ${rule.maxItems} item(s).`);
                    if (rule.items && rule.items.type === "string" && value.some(function (entry) { return typeof entry !== "string"; })) errors.push(`Action field ${key} must contain only strings.`);
                }
            }
            if (typeof rule.maxLength === "number" && typeof value === "string" && value.length > rule.maxLength) errors.push(`Action field ${key} exceeds its maximum length of ${rule.maxLength}.`);
            if (typeof rule.minimum === "number" && typeof value === "number" && value < rule.minimum) errors.push(`Action field ${key} is below its minimum.`);
            if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`Action field ${key} selected an invalid value.`);
        });
        const options = actionDefinition.options && typeof actionDefinition.options === "object" ? actionDefinition.options : {};
        const optionKeys = {
            destination_id: "destination_ids",
            item_id: "item_ids",
            target_id: "target_ids",
            target_inventory_id: "target_inventory_ids",
            activity_id: "activity_ids",
            location_id: "location_ids",
            interaction_id: "interaction_ids"
        };
        Object.entries(optionKeys).forEach(function (entry) {
            const propertyKey = entry[0];
            const optionKey = entry[1];
            if (!Object.prototype.hasOwnProperty.call(action, propertyKey) || !Array.isArray(options[optionKey])) return;
            if (!options[optionKey].includes(action[propertyKey])) errors.push(`Action field ${propertyKey} selected an unavailable option.`);
        });
        if (action.type === "transfer_items" && Array.isArray(options.routes) && Array.isArray(action.item_ids)) {
            const route = options.routes.find(function (candidate) {
                return candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
            });
            if (!route) errors.push("Selected bulk-transfer route is unavailable.");
            else if (action.item_ids.some(function (itemId) { return !route.item_ids.includes(itemId); })) errors.push("Bulk transfer contains an unavailable item.");
        }
        if (action.type === "show_hidden_location" && Array.isArray(options.locations)) {
            const locationOption = options.locations.find(function (candidate) { return candidate.id === action.location_id; });
            if (!locationOption || !Array.isArray(locationOption.target_ids) || !locationOption.target_ids.includes(action.target_id)) {
                errors.push("Selected hidden-location reveal target is unavailable for that location.");
            }
        }
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
        const noticeability = SPEECH_LOUDNESS_VALUES.includes(input.noticeability)
            ? input.noticeability
            : "noticeable";
        if (noticeability === "shout") {
            if (targetId) return fail("SHOUT_TARGET_FORBIDDEN", "A shout cannot have an addressee.");
            if (!spokenText) return fail("SHOUT_SPEECH_REQUIRED", "Shout requires spoken text.");
        }
        if (targetId) {
            const target = getCharacter(targetId, world);
            if (!target || target.locationId !== narrativeLocationId || !characterHasDiscoveredCharacter(actor, target, world)) {
                return fail("TARGET_NOT_NEARBY", "Narrative target is not nearby.");
            }
        }

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

        const parsed = text ? setup.EventPerception.parseStructuredNarrative(text) : { spokenText: "", publicNarrative: "" };
        const structuredSpokenText = Object.prototype.hasOwnProperty.call(input, "spokenText")
            ? (typeof input.spokenText === "string" ? input.spokenText.trim() : "")
            : parsed.spokenText;
        const targetId = input.target_id || "";
        const noticeability = SPEECH_LOUDNESS_VALUES.includes(input.noticeability) ? input.noticeability : "noticeable";
        if (noticeability === "shout") {
            if (targetId) return fail("SHOUT_TARGET_FORBIDDEN", "A shout cannot have an addressee.");
            if (action && action.type === "move") return fail("SHOUT_MOVE_FORBIDDEN", "A shout cannot be combined with movement.");
            if (!structuredSpokenText) return fail("SHOUT_SPEECH_REQUIRED", "Shout requires spoken text.");
        }

        let moveSpeechPhase = "origin";
        if (text && targetId && action && action.type === "move") {
            const target = getCharacter(targetId, world);
            const targetInOrigin = Boolean(target && target.locationId === actor.locationId);
            const availableActions = getAvailableActions(actorId);
            const moveOptions = availableActions.move && availableActions.move.options || {};
            const knownDestinationTargets = moveOptions.speech_targets_by_destination && moveOptions.speech_targets_by_destination[action.destination_id] || [];
            const targetKnownInDestination = knownDestinationTargets.some(function (candidate) { return candidate.id === targetId; });
            if (!targetInOrigin && !targetKnownInDestination) {
                return fail("SPEECH_TARGET_NOT_GROUNDED", "That addressee is neither nearby nor known to be at the selected destination.");
            }
            if (!targetInOrigin && targetKnownInDestination) moveSpeechPhase = "destination";
        }

        const snapshot = clone(world);
        const interactionId = world.nextIntentId++;
        let actionResult = null;
        let narrativeResult = null;

        function narrativeInputFor(targetOverride) {
            const narrativeInput = {
                text: text,
                target_id: targetOverride === undefined ? targetId : targetOverride,
                noticeability: noticeability
            };
            if (Object.prototype.hasOwnProperty.call(input, "publicNarrative")) narrativeInput.publicNarrative = input.publicNarrative;
            if (Object.prototype.hasOwnProperty.call(input, "spokenText")) narrativeInput.spokenText = input.spokenText;
            return narrativeInput;
        }

        try {
            if (text && moveSpeechPhase === "origin") {
                narrativeResult = submitNarrative(actorId, narrativeInputFor(), {
                    interactionId: interactionId,
                    locationId: actor.locationId
                });
                if (!narrativeResult.ok) throw narrativeResult.error;
            }
            if (action) {
                actionResult = executeAction(actorId, action, { interactionId: interactionId });
            }
            if (text && moveSpeechPhase === "destination") {
                const currentWorld = getWorld();
                const currentActor = getCharacter(actorId, currentWorld);
                const target = getCharacter(targetId, currentWorld);
                const deliveryLocationId = currentActor && currentActor.locationId || actor.locationId;
                const directTargetId = actionResult && actionResult.ok && target && target.locationId === action.destination_id && deliveryLocationId === action.destination_id
                    ? targetId
                    : "";
                narrativeResult = submitNarrative(actorId, narrativeInputFor(directTargetId), {
                    interactionId: interactionId,
                    locationId: deliveryLocationId
                });
                if (!narrativeResult.ok) throw narrativeResult.error;
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
        locationRequiresDiscovery: locationRequiresDiscovery,
        characterHasDiscoveredLocation: characterHasDiscoveredLocation,
        grantLocationDiscovery: grantLocationDiscovery,
        normalizeCharacterDiscoveries: normalizeCharacterDiscoveries,
        characterRequiresDiscovery: characterRequiresDiscovery,
        characterHasDiscoveredCharacter: characterHasDiscoveredCharacter,
        grantCharacterDiscovery: grantCharacterDiscovery,
        normalizeCharacterDiscoveriesByCharacter: normalizeCharacterDiscoveriesByCharacter,
        runAuthoredOutcomeTable: runAuthoredOutcomeTable,
        eligibleAuthoredOutcomeRecords: eligibleAuthoredOutcomeRecords,
        authoredOutcomeTableCanAffect: authoredOutcomeTableCanAffect,
        locationExitEntries: locationExitEntries,
        locationExitEntriesForActor: locationExitEntriesForActor,
        eventLocationIds: eventLocationIds,
        eventTouchesUndiscoveredLocation: eventTouchesUndiscoveredLocation,
        eventTouchesUndiscoveredCharacter: eventTouchesUndiscoveredCharacter,
        inventoryItems: inventoryItems,
        canAccessInventory: canAccessInventory,
        actorDirectlyCarriesItem: actorDirectlyCarriesItem,
        itemInstanceDisplayName: itemInstanceDisplayName,
        observedMoveDestinationTargets: observedMoveDestinationTargets,
        positionText: positionText,
        synchronizeDerivedItemPlacement: synchronizeDerivedItemPlacement,
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
        createInferenceSessionId: createInferenceSessionId,
        normalizePlayerSetup: normalizePlayerSetup,
        buildProfile: buildProfile,
        requiredDisclosureVersion: requiredDisclosureVersion,
        disclosureSatisfied: disclosureSatisfied,
        applyTravelerIdentity: applyTravelerIdentity,
        validCustomTravelerAuthoring: validCustomTravelerAuthoring,
        playerSetupComplete: playerSetupComplete
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
        getPlayerSetup: function () {
            return clone(ensureWorld().playerSetup);
        },
        getBuildProfile: function () {
            return buildProfile();
        },
        getRequiredDisclosureVersion: function () {
            return requiredDisclosureVersion();
        },
        isPublicDisclosureRequired: function () {
            const state = ensureWorld().playerSetup;
            return buildProfile() === "public" && !disclosureSatisfied(state);
        },
        isPlayerSetupComplete: function () {
            return playerSetupComplete(ensureWorld());
        },
        acceptPlayerDisclaimer: function () {
            const world = ensureWorld();
            world.playerSetup.disclaimerAccepted = true;
            world.playerSetup.disclosureVersion = Math.max(world.playerSetup.disclosureVersion || 0, requiredDisclosureVersion(), 1);
            return ok({ playerSetup: clone(world.playerSetup) });
        },
        acknowledgeAISetup: function () {
            const world = ensureWorld();
            if (world.playerSetup.completed) return fail("PLAYER_SETUP_ALREADY_COMPLETED", "Player setup is already complete.");
            if (!disclosureSatisfied(world.playerSetup)) return fail("PLAYER_DISCLAIMER_REQUIRED", "Accept the current public AI/privacy disclosure before AI setup.");
            world.playerSetup.aiSetupAcknowledged = true;
            return ok({ playerSetup: clone(world.playerSetup) });
        },
        finalizePlayerSetup: function (input) {
            const world = ensureWorld();
            if (!disclosureSatisfied(world.playerSetup)) return fail("PLAYER_DISCLAIMER_REQUIRED", "Accept the current public AI/privacy disclosure before choosing a Traveler.");
            if (!world.playerSetup.aiSetupAcknowledged) return fail("PLAYER_AI_SETUP_REQUIRED", "Continue past AI setup before choosing a Traveler.");
            if (world.playerSetup.completed) return fail("PLAYER_SETUP_ALREADY_COMPLETED", "Player setup is already complete.");
            input = input && typeof input === "object" ? input : {};
            const mode = input.mode;
            const candidate = clone(world);
            let applied = null;
            if (mode === "generic") {
                candidate.playerSetup = { disclaimerAccepted: candidate.playerSetup.disclaimerAccepted, disclosureVersion: candidate.playerSetup.disclosureVersion, aiSetupAcknowledged: true, completed: true, mode: "generic", customAuthoring: null };
            } else if (mode === "custom") {
                if (!validCustomTravelerAuthoring(input.customAuthoring)) return fail("TRAVELER_CUSTOM_INVALID", "Custom Traveler authoring is incomplete or invalid.");
                const custom = {
                    name: input.customAuthoring.name.trim(),
                    playerDescription: input.customAuthoring.playerDescription.trim(),
                    aiDescription: input.customAuthoring.aiDescription.trim()
                };
                applied = applyTravelerIdentity(candidate, custom);
                if (!applied.ok) return applied;
                candidate.playerSetup = { disclaimerAccepted: candidate.playerSetup.disclaimerAccepted, disclosureVersion: candidate.playerSetup.disclosureVersion, aiSetupAcknowledged: true, completed: true, mode: "custom", customAuthoring: clone(custom) };
            } else {
                return fail("TRAVELER_MODE_INVALID", "Choose the generic Traveler or a Custom Traveler.");
            }
            const validation = validateWorld(candidate);
            if (!validation.ok) return validation;
            State.variables.world = candidate;
            return ok({ playerSetup: clone(candidate.playerSetup), character: clone(candidate.entities.player) });
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
        applyRoutineAnchor: applyRoutineAnchor,
        executeAction: executeTimelapseAction,
        getBeds: function (locationId) {
            return bedSublocations(locationId, ensureWorld()).map(function (bed) { return { id: bed.id, name: bed.name }; });
        }
    };

    setup.CharacterAPI = {
        getView: getCharacterView,
        getAvailableActions: getAvailableActions,
        getRelevantMechanics: getRelevantMechanics,
        validateActionRequest: validateActionRequest,
        recordGroundedActionFailure: recordGroundedActionFailure,
        perform: executeAction,
        narrate: submitNarrative,
        submitIntent: submitIntent,
        getItemInstanceDisplayName: function (itemId) {
            const world = ensureWorld();
            const item = world.entities[itemId];
            return item && item.type === "item" ? itemInstanceDisplayName(item, world) : "";
        },
        getSpeechLoudnessValues: function () { return SPEECH_LOUDNESS_VALUES.slice(); }
    };
}());
