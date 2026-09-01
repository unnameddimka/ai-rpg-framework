(function () {
    "use strict";

    const LEGACY_WORLD_VERSION = 6;
    const WORLD_SCHEMA_VERSION = 18;
    const SUPPORTED_MIGRATION_SCHEMA_VERSIONS = new Set([LEGACY_WORLD_VERSION, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, WORLD_SCHEMA_VERSION]);
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

    const worldTransactionDebug = { snapshots: 0 };
    function snapshotWorld(world) {
        worldTransactionDebug.snapshots += 1;
        return clone(world);
    }
    function restoreWorldInPlace(world, snapshot) {
        Object.keys(world).forEach(function (key) { delete world[key]; });
        Object.assign(world, snapshot);
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

    function initializeCharacterRuntime(characterId, sourceCharacter, world) {
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
        character.mindRevision = 0;
        character.mindDiagnostics = { beliefHistoryById: {} };
        character.mindMaintenanceSnapshots = [];
        character.mindMaintenanceState = {};
        character.equippedItems = [];
        character.sleeping = character.sleeping === true;
        return character;
    }

    function grantCurrentLocationDiscovery(character, world) {
        const location = world.entities[character.locationId];
        if (location && location.type === "location" && location.requiresDiscovery === true && !character.discoveredLocationIds.includes(location.id)) {
            character.discoveredLocationIds.push(location.id);
        }
    }

    function installCharacterInventory(character, world) {
        if (world.inventories[character.inventoryId]) throw new Error(`Duplicate inventory ID ${character.inventoryId}.`);
        world.inventories[character.inventoryId] = {
            id: character.inventoryId,
            ownerId: character.id,
            name: character.name,
            itemIds: []
        };
    }

    function installGeneratedData(world) {
        const document = setup.GeneratedWorldData;
        if (!document || document.schemaVersion !== 2 || typeof document.authoringRevision !== "string" || !document.authoringRevision ||
                !document.locations || !document.characters || !document.abilities || !document.itemDefinitions || !document.items || !document.dayActivities) {
            throw new Error("Generated world data is missing, lacks an authoring revision, or uses an unsupported schema version.");
        }

        world.startLocationId = document.startLocationId;
        world.groundedItemPolicy = typeof document.groundedItemPolicy === "string" ? document.groundedItemPolicy : "";
        world.abilities = clone(document.abilities);
        world.itemDefinitions = clone(document.itemDefinitions);
        world.dayActivities = clone(document.dayActivities || {});
        world.randomOutcomeTables = clone(document.randomOutcomeTables || {});
        world.triggeredEvents = clone(document.triggeredEvents || {});
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
                        transparent: sublocation.transparent === true,
                        itemIds: []
                    };
                }
            }
        }

        for (const [characterId, sourceCharacter] of Object.entries(document.characters)) {
            const startsInactive = Boolean(sourceCharacter && sourceCharacter.deferredActivation === true);
            const character = initializeCharacterRuntime(characterId, sourceCharacter, world);
            character.activationState = startsInactive ? "inactive" : "active";
            if (startsInactive) {
                character.locationId = null;
                character.sublocationId = null;
                character.sleeping = false;
            }
            grantCurrentLocationDiscovery(character, world);
            world.entities[characterId] = character;
            installCharacterInventory(character, world);
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

    function instantiateDeferredCharacter(characterId, world, placement) {
        const existing = getCharacter(characterId, world);
        if (existing) return existing;
        const source = setup.GeneratedWorldData && setup.GeneratedWorldData.characters && setup.GeneratedWorldData.characters[characterId];
        if (!source || source.deferredActivation !== true) return null;
        const character = initializeCharacterRuntime(characterId, source, world);
        character.sleeping = false;
        character.activationState = "active";
        character.locationId = placement && placement.locationId || null;
        character.sublocationId = placement && placement.sublocationId || null;
        grantCurrentLocationDiscovery(character, world);
        world.entities[characterId] = character;
        installCharacterInventory(character, world);
        world.control.assignments[characterId] = character.initialControllerId || character.defaultControllerId || "ai";
        delete character.initialControllerId;
        for (const [itemId, authoredItem] of Object.entries(setup.GeneratedWorldData.items || {})) {
            if (world.entities[itemId]) continue;
            const definition = world.itemDefinitions[authoredItem.definitionId];
            if (!definition) continue;
            if (authoredItem.inventoryId === character.inventoryId) {
                const item = clone(authoredItem);
                item.id = itemId; item.type = "item"; item.name = definition.name; item.containerId = character.inventoryId; delete item.inventoryId;
                world.entities[itemId] = item; world.inventories[character.inventoryId].itemIds.push(itemId);
            } else if (authoredItem.equippedByCharacterId === character.id && Array.isArray(definition.equipSlots) && definition.equipSlots.includes(authoredItem.equippedSlot)) {
                const item = clone(authoredItem); const slot = item.equippedSlot;
                item.id = itemId; item.type = "item"; item.name = definition.name; item.containerId = character.id;
                delete item.equippedByCharacterId; delete item.equippedSlot; world.entities[itemId] = item; character.equippedItems.push({ itemId: itemId, slot: slot, visible: true });
            }
        }
        return character;
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
            triggeredEvents: {},
            ordinaryTickId: 0,
            triggeredEventRuntime: { lastProcessedOrdinaryTickId: 0 },
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
            ai: { turnQueue: [], continuations: {}, intimateContexts: {}, inferenceSessionId: createInferenceSessionId() },

            debug: {
                lastActionResult: null,
                controllerLog: [],
                repairs: [],
                migrationReports: []
            }
        };
        installGeneratedData(world);
        if (setup.Presence && typeof setup.Presence.initializeFreshWorld === "function") {
            const presenceInit = setup.Presence.initializeFreshWorld(world);
            if (!presenceInit.ok) throw new Error(presenceInit.error.message);
        }
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
            (!setup.Presence || setup.Presence.isLocallyPresent(character, world)) &&
            character.mind && character.mind.pendingObservations.length > 0);
    }

    function enqueueAITurn(characterId, reason, world) {
        world = world || ensureWorld();
        if (!world.ai || typeof world.ai !== "object" || Array.isArray(world.ai) ||
                !Array.isArray(world.ai.turnQueue) || !world.ai.continuations || typeof world.ai.continuations !== "object" || Array.isArray(world.ai.continuations) ||
                !world.ai.intimateContexts || typeof world.ai.intimateContexts !== "object" || Array.isArray(world.ai.intimateContexts)) {
            return fail("AI_STATE_INVALID", "AI runtime state is missing or malformed.");
        }
        if (!isAIQueueEligible(characterId, world)) return fail("AI_NOT_ELIGIBLE", "Character is not eligible for an AI turn.");
        if (!world.ai.turnQueue.some(function (entry) { return entry && typeof entry === "object" && entry.characterId === characterId; })) {
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

    function validIntimateMotivationRecord(record) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return false;
        const keys = Object.keys(record).sort();
        if (JSON.stringify(keys) !== JSON.stringify(["imaginedMoments", "impulse", "openAnticipations"])) return false;
        if (typeof record.impulse !== "string" || !record.impulse.trim() || record.impulse.length > 400) return false;
        for (const field of ["imaginedMoments", "openAnticipations"]) {
            if (!Array.isArray(record[field]) || record[field].length !== 2 ||
                    record[field].some(function (text) { return typeof text !== "string" || !text.trim() || text.length > 400; })) return false;
        }
        return true;
    }

    function ensureAIState(world) {
        if (!world.ai || typeof world.ai !== "object" || Array.isArray(world.ai)) world.ai = {};
        if (!Array.isArray(world.ai.turnQueue)) world.ai.turnQueue = [];
        if (!world.ai.continuations || typeof world.ai.continuations !== "object" || Array.isArray(world.ai.continuations)) {
            world.ai.continuations = {};
        }
        if (!world.ai.intimateContexts || typeof world.ai.intimateContexts !== "object" || Array.isArray(world.ai.intimateContexts)) {
            world.ai.intimateContexts = {};
        }
        Object.keys(world.ai.continuations).forEach(function (characterId) {
            const value = world.ai.continuations[characterId];
            if (!getCharacter(characterId, world) || (value !== null && (typeof value !== "string" || value.length > 2000))) {
                delete world.ai.continuations[characterId];
            }
        });
        Object.keys(world.ai.intimateContexts).forEach(function (characterId) {
            const contexts = world.ai.intimateContexts[characterId];
            if (!getCharacter(characterId, world) || !contexts || typeof contexts !== "object" || Array.isArray(contexts)) {
                delete world.ai.intimateContexts[characterId];
                return;
            }
            Object.keys(contexts).forEach(function (partnerId) {
                const record = contexts[partnerId];
                const actor = getCharacter(characterId, world);
                const partner = getCharacter(partnerId, world);
                if (partnerId === characterId || !actor || !partner || actor.adult === false || partner.adult === false || !validIntimateMotivationRecord(record)) {
                    delete contexts[partnerId];
                }
            });
            if (Object.keys(contexts).length === 0) delete world.ai.intimateContexts[characterId];
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
        const queue = world.ai && Array.isArray(world.ai.turnQueue) ? world.ai.turnQueue : [];
        const head = queue[0] && typeof queue[0] === "object" ? queue[0] : null;
        const character = head && typeof head.characterId === "string" ? getCharacter(head.characterId, world) : null;
        return clone({ count: queue.length, head: head ? {
            characterId: head.characterId, name: character && character.name || head.characterId, reason: head.reason
        } : null, entries: queue });
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
            if (!characterHasDiscoveredLocation(actor, transition.destinationId, w)) return false;
            const constraint = actor && actor.movementConstraint;
            if (constraint && constraint.type === "location_locked" && actor.locationId === constraint.locationId && transition.destinationId !== constraint.locationId) return false;
            return true;
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
        if (!w || !setup.Presence || typeof setup.Presence.isLocationAvailable !== "function") return entries;
        return entries.filter(function (transition) {
            const destination = getLocation(transition.destinationId, w);
            return destination && setup.Presence.isLocationAvailable(destination, w);
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
            return !setup.Presence || typeof setup.Presence.isLocationAvailable !== "function" || setup.Presence.isLocationAvailable(destination, world);
        });
        return { destination_ids: passages.map(function (passage) { return passage.id; }), passages: passages };
    }
    function validateLockAction(actor, action, world, expectedLockedState) {
        const destination = getLocation(action && action.destination_id, world);
        if (destination && !characterHasDiscoveredLocation(actor, destination.id, world)) {
            return fail("DESTINATION_UNDISCOVERED", "That destination has not been discovered by this character.");
        }
        if (destination && setup.Presence && typeof setup.Presence.isLocationAvailable === "function" && !setup.Presence.isLocationAvailable(destination, world)) {
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

    const ItemMechanics = setup.GameItemMechanics.create({
        clone: clone, ok: ok, fail: fail,
        getCharacter: getCharacter, getLocation: getLocation,
        locationRequiresDiscovery: locationRequiresDiscovery, characterHasDiscoveredLocation: characterHasDiscoveredLocation, grantLocationDiscovery: grantLocationDiscovery,
        characterRequiresDiscovery: characterRequiresDiscovery, characterHasDiscoveredCharacter: characterHasDiscoveredCharacter, grantCharacterDiscovery: grantCharacterDiscovery,
        getSublocation: getSublocation, getSublocations: getSublocations,
        validateWorld: function (world) { return validateWorld(world); },
        ensureWorld: function () { return ensureWorld(); },
        nearbyCharacters: function (actor, world) { return nearbyCharacters(actor, world); }
    });
    const { getItemDefinition, itemInstanceDisplayName, itemView, equippedRecords, equippedItemView, characterAppearanceText, actorDirectlyCarriesItem, canAccessInventory, actorOwnsItem, transformItem, itemConsumePlan, applyItemConsume, createGeneratedItemInstance, renderAuthoredOutcomeText, authoredOutcomeEffectApplicable, authoredOutcomeApplicable, eligibleAuthoredOutcomeRecords, authoredOutcomeTableCanAffect, executeAuthoredOutcomeEffects, restoreWorldObject, runAuthoredOutcomeTable, authoredInteractionRecords, accessibleInventories, observableTransparentInventories, canReachCharacter, inventoryOwnerLabel, bulkTransferRoutes, accessibleLooseItemEntries, hasWritingCapability, writableItemEntries, positionText, transferItem } = ItemMechanics;

    function sublocationOccupants(sublocationId, world, excludedCharacterId) {
        return getCharacters(world).filter(function (character) {
            return character.id !== excludedCharacterId && character.sublocationId === sublocationId &&
                (!setup.Presence || setup.Presence.isLocallyPresent(character, world));
        });
    }

    function effectiveSleepCapacity(sublocation) {
        return sublocation && Number.isInteger(sublocation.sleepCapacity) ? sublocation.sleepCapacity : sublocation && sublocation.capacity;
    }

    function sleepingSublocationOccupants(sublocationId, world, excludedCharacterId) {
        return sublocationOccupants(sublocationId, world, excludedCharacterId).filter(function (character) { return character.sleeping === true; });
    }

    function sleepSlotAvailable(sublocation, world, actorId) {
        if (!sublocation || !(sublocation.capabilities || []).includes("sleep")) return false;
        return sublocationOccupants(sublocation.id, world, actorId).length < sublocation.capacity &&
            sleepingSublocationOccupants(sublocation.id, world, actorId).length < effectiveSleepCapacity(sublocation);
    }

    function pushDebugLog(world, entry) {
        world.debug.controllerLog.push(Object.assign({
            sequence: world.debug.controllerLog.length + 1
        }, entry));

        if (world.debug.controllerLog.length > 200) {
            world.debug.controllerLog = world.debug.controllerLog.slice(-200);
        }
    }

    const GameValidation = setup.GameValidation.create({
        ok: ok, fail: fail,
        validCustomTravelerAuthoring: validCustomTravelerAuthoring, getCharacters: getCharacters, getCharacter: getCharacter, validIntimateMotivationRecord: validIntimateMotivationRecord,
        getLocation: getLocation, locationRequiresDiscovery: locationRequiresDiscovery, characterRequiresDiscovery: characterRequiresDiscovery,
        locationExitEntries: locationExitEntries, reciprocalTransition: reciprocalTransition, getSublocation: getSublocation, getItemDefinition: getItemDefinition,
        sublocationOccupants: sublocationOccupants, effectiveSleepCapacity: effectiveSleepCapacity, sleepingSublocationOccupants: sleepingSublocationOccupants,
        currentAuthoringRevision: function () { return currentAuthoringRevision(); },
        knowledgeMatchTokens: function (value) { return knowledgeMatchTokens(value); },
        CONTROLLER_IDS: CONTROLLER_IDS, LOCK_ID_PATTERN: LOCK_ID_PATTERN, TIME_PHASES: TIME_PHASES, WORLD_SCHEMA_VERSION: WORLD_SCHEMA_VERSION,
        itemEffectSupported: function (effectId) { return Boolean(ItemEffectRegistry && ItemEffectRegistry[effectId]); },
        abilityEffectSupported: function (effectType) { return Boolean(AbilityEffectRegistry && AbilityEffectRegistry[effectType]); }
    });
    const { validateControlAssignments, repairControlInvariant, synchronizeDerivedItemPlacement, validateItemInvariants, validateSpatialInvariants, validateEnvironmentAndDaytime, validateTravelerProfilesAndSetup, validateAuthoredOutcomeRuntime, validatePresenceTopologyRuntimeDefinitions, validateTriggeredEventRuntimeDefinitions, validateWorld } = GameValidation;

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

        if (setup.Presence && typeof setup.Presence.prepareCurrentWorld === "function") {
            const presencePreparation = setup.Presence.prepareCurrentWorld(world);
            if (!presencePreparation.ok) throw new Error(presencePreparation.error.message);
        }
        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.preparePresenceState === "function") {
            const schedulePresencePreparation = setup.WeeklyRhythm.preparePresenceState(world);
            if (!schedulePresencePreparation.ok) throw new Error(schedulePresencePreparation.error.message);
        }

        if (!world.environment || typeof world.environment !== "object" || Array.isArray(world.environment)) {
            world.environment = { timePhase: "evening", weatherNarrative: DEFAULT_WEATHER_NARRATIVE, weatherInitialized: false, weatherSource: "fallback" };
        }
        if (!TIME_PHASES.has(world.environment.timePhase)) world.environment.timePhase = "evening";
        if (typeof world.environment.weatherNarrative !== "string" || !world.environment.weatherNarrative.trim()) world.environment.weatherNarrative = DEFAULT_WEATHER_NARRATIVE;
        if (typeof world.environment.weatherInitialized !== "boolean") world.environment.weatherInitialized = false;
        if (typeof world.environment.weatherSource !== "string") world.environment.weatherSource = world.environment.weatherInitialized ? "saved" : "fallback";
        world.groundedItemPolicy = setup.GeneratedWorldData && typeof setup.GeneratedWorldData.groundedItemPolicy === "string"
            ? setup.GeneratedWorldData.groundedItemPolicy : "";
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
        if (!world.ai || typeof world.ai !== "object") world.ai = { turnQueue: [], continuations: {}, intimateContexts: {} };
        ensureAIState(world);
        if (typeof world.ai.inferenceSessionId !== "string" || !world.ai.inferenceSessionId.trim()) {
            world.ai.inferenceSessionId = createInferenceSessionId();
        }
        if (!world.triggeredEvents || typeof world.triggeredEvents !== "object" || Array.isArray(world.triggeredEvents)) world.triggeredEvents = clone(setup.GeneratedWorldData.triggeredEvents || {});
        if (!Number.isInteger(world.ordinaryTickId) || world.ordinaryTickId < 0) {
            const legacyCounter = world.triggeredEventRuntime && Number.isInteger(world.triggeredEventRuntime.ordinaryTickCounter) && world.triggeredEventRuntime.ordinaryTickCounter >= 0
                ? world.triggeredEventRuntime.ordinaryTickCounter : 0;
            world.ordinaryTickId = legacyCounter;
        }
        if (!world.triggeredEventRuntime || typeof world.triggeredEventRuntime !== "object" || Array.isArray(world.triggeredEventRuntime)) world.triggeredEventRuntime = {};
        if (!Number.isInteger(world.triggeredEventRuntime.lastProcessedOrdinaryTickId) || world.triggeredEventRuntime.lastProcessedOrdinaryTickId < 0) {
            const legacyValues = Object.values(world.triggeredEventRuntime.lastProcessedOrdinaryTickByEvent || {}).filter(function (value) { return Number.isInteger(value) && value >= 0; });
            world.triggeredEventRuntime.lastProcessedOrdinaryTickId = legacyValues.length ? Math.max.apply(Math, legacyValues) : Math.min(world.ordinaryTickId, 0);
        }
        if (world.triggeredEventRuntime.lastProcessedOrdinaryTickId > world.ordinaryTickId) world.triggeredEventRuntime.lastProcessedOrdinaryTickId = world.ordinaryTickId;
        delete world.triggeredEventRuntime.ordinaryTickCounter;
        delete world.triggeredEventRuntime.lastProcessedOrdinaryTickByEvent;
        synchronizeDerivedItemPlacement(world);
        repairAIQueue(world);
        return world;
    }

    function ensureWorld() {
        if (!State.variables.world) {
            throw new Error("World state has not been bootstrapped.");
        }
        const status = setup.SaveMigration.getStatusForWorld(State.variables.world);
        if (!status.supported) {
            throw new Error("This save uses an unsupported world schema and cannot be migrated automatically.");
        }
        if (status.required) {
            throw new Error("This save must be migrated before gameplay can continue.");
        }
        return State.variables.world;
    }

    function getHumanCharacterId(world) {
        const result = validateControlAssignments(
            world && world.control && world.control.assignments ? world.control.assignments : {},
            world
        );
        if (!result.ok) throw new Error(result.error.message);
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
                (!setup.Presence || setup.Presence.isLocallyPresent(character, world)) &&
                character.locationId === actor.locationId &&
                characterHasDiscoveredCharacter(actor, character, world);
        });
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

    function bedSublocations(locationId, world, actorId) {
        return getSublocations(locationId, world).filter(function (sublocation) {
            return (!setup.Presence || setup.Presence.isSublocationAvailable(sublocation, world)) &&
                Array.isArray(sublocation.capabilities) && sublocation.capabilities.includes("sleep") &&
                sleepSlotAvailable(sublocation, world, actorId);
        });
    }

    function canTraverseTimelapseTransition(actor, transition, world) {
        if (!transition || !transition.destinationId || transition.blocked) return false;
        if (!transition.lockId || !transition.locked) return true;
        return matchingKeyItems(actor, transition.lockId, world).length > 0;
    }

    function timelapseRoute(actor, destinationId, world) {
        if (!actor || !getLocation(destinationId, world) || (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) || (setup.Presence && !setup.Presence.isLocationAvailable(destinationId, world))) return null;
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
            return entity && entity.type === "location" && (!setup.Presence || setup.Presence.isLocationAvailable(entity, world));
        }).map(function (location) {
            const route = timelapseRoute(actor, location.id, world);
            if (!route) return null;
            return {
                id: location.id,
                name: location.name,
                description: clone(location.description || []),
                route: route,
                sublocations: getSublocations(location.id, world).filter(function (sublocation) {
                    return !setup.Presence || setup.Presence.isSublocationAvailable(sublocation, world);
                }).map(function (sublocation) {
                    const record = {
                        id: sublocation.id,
                        name: sublocation.name,
                        publicText: sublocation.publicText || "",
                        selfText: sublocation.selfText || "",
                        capabilities: clone(sublocation.capabilities || []),
                        capacity: sublocation.capacity
                    };
                    if (sublocation.sleepCapacity !== undefined) record.sleepCapacity = sublocation.sleepCapacity;
                    return record;
                }),
                beds: bedSublocations(location.id, world, actor.id).map(function (bed) {
                    return { id: bed.id, name: bed.name, capacity: bed.capacity, sleepCapacity: effectiveSleepCapacity(bed) };
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
        const snapshot = snapshotWorld(world);
        actor.locationId = destinationId;
        actor.sublocationId = targetSublocation.id;
        const validation = validateWorld(world);
        if (!validation.ok) {
            restoreWorldInPlace(world, snapshot);
            return validation;
        }
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
        const snapshot = snapshotWorld(world);
        actor.locationId = destination.id;
        actor.sublocationId = targetSublocation.id;
        const validation = validateWorld(world);
        if (!validation.ok) {
            restoreWorldInPlace(world, snapshot);
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
            if (sleepingSublocationOccupants(bed.id, world, actor.id).length >= effectiveSleepCapacity(bed)) {
                return fail("BED_SLEEP_CAPACITY_FULL", "The selected bed already has its maximum number of sleeping occupants.");
            }
            const snapshot = snapshotWorld(world);
            actor.sublocationId = bed.id;
            actor.sleeping = true;
            const validation = validateWorld(world);
            if (!validation.ok) {
                restoreWorldInPlace(world, snapshot);
                return validation;
            }
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
            const snapshot = snapshotWorld(world);
            const effectResult = ItemEffectRegistry.abstract_study.execute(actor, item, definition, definition.useAction, world, { input_text: inputText });
            if (effectResult && effectResult.ok === false) {
                restoreWorldInPlace(world, snapshot);
                return effectResult;
            }
            const feedback = effectResult && effectResult.feedback && effectResult.feedback[0];
            const stage = feedback && feedback.data && feedback.data.studyStage || "survey";
            const validation = validateWorld(world);
            if (!validation.ok) {
                restoreWorldInPlace(world, snapshot);
                return validation;
            }
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
            const snapshot = snapshotWorld(world);
            const result = effect.execute(actor, location, definition, world);
            if (!result || !result.ok) {
                restoreWorldInPlace(world, snapshot);
                return result || fail("TIMELAPSE_EFFECT_FAILED", "The timelapse action failed.");
            }
            const validation = validateWorld(world);
            if (!validation.ok) {
                restoreWorldInPlace(world, snapshot);
                return validation;
            }
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
            return character && (!setup.Presence || setup.Presence.isLocallyPresent(character, world))
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

    const GameActions = setup.GameActions.create({
        clone: clone, ok: ok, fail: fail,
        getCharacter: getCharacter, getLocation: getLocation, locationRequiresDiscovery: locationRequiresDiscovery, characterHasDiscoveredLocation: characterHasDiscoveredLocation, grantLocationDiscovery: grantLocationDiscovery,
        locationExitEntriesForActor: locationExitEntriesForActor, locationExitEntries: locationExitEntries, findLocationExit: findLocationExit, matchingKeyItems: matchingKeyItems, lockActionOptions: lockActionOptions, validateLockAction: validateLockAction, setPassageLocked: setPassageLocked,
        getSublocation: getSublocation, getItemDefinition: getItemDefinition, equippedRecords: equippedRecords, canAccessInventory: canAccessInventory, actorOwnsItem: actorOwnsItem, transformItem: transformItem, itemConsumePlan: itemConsumePlan, applyItemConsume: applyItemConsume,
        runAuthoredOutcomeTable: runAuthoredOutcomeTable, authoredInteractionRecords: authoredInteractionRecords, sublocationOccupants: sublocationOccupants, effectiveSleepCapacity: effectiveSleepCapacity, sleepingSublocationOccupants: sleepingSublocationOccupants,
        accessibleInventories: accessibleInventories, canReachCharacter: canReachCharacter, bulkTransferRoutes: bulkTransferRoutes, hasWritingCapability: hasWritingCapability, writableItemEntries: writableItemEntries, positionText: positionText,
        ensureWorld: ensureWorld, getHumanCharacterId: getHumanCharacterId, nearbyCharacters: nearbyCharacters, transferItem: transferItem, renderItemActionText: renderItemActionText, groundedMoveSpeechTargets: groundedMoveSpeechTargets, getCharacterView: getCharacterView,
        ItemEffectRegistry: ItemEffectRegistry, BASE_ACTION_TYPES: BASE_ACTION_TYPES
    });
    const AbilityEffectRegistry = GameActions.AbilityEffectRegistry;
    const ActionRegistry = GameActions.ActionRegistry;
    const { attachActionAIMetadata, grantedActionSources, relevantActionSources, itemSpecificMechanicVariants, getRelevantMechanics, actionHasExecutableInvocation, getAvailableActions } = GameActions;

    function getCharacterView(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }
        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return fail("ACTOR_NOT_PRESENT", "Actor character is not currently present in the local simulation.");
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
                        actionType: ability.actionType,
                        effectType: ability.effectType || null
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
                    return !setup.Presence || setup.Presence.isSublocationAvailable(sublocation, world);
                }).map(function (sublocation) {
                    const projected = {
                        id: sublocation.id,
                        name: sublocation.name,
                        enter_label: sublocation.enterLabel,
                        public_text: (function () {
                            const phase = world.environment && world.environment.timePhase === "morning" ? "Morning"
                                : world.environment && world.environment.timePhase === "evening" ? "Evening" : "";
                            return phase && sublocation.phasePublicText && sublocation.phasePublicText[phase]
                                || sublocation.publicText || "";
                        }()),
                        self_text: sublocation.selfText || "",
                        capabilities: clone(sublocation.capabilities || []),
                        capacity: sublocation.capacity
                    };
                    if ((sublocation.capabilities || []).includes("sleep")) projected.sleep_capacity = effectiveSleepCapacity(sublocation);
                    return projected;
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
            visible_inaccessible_inventories: observableTransparentInventories(actor, world).map(function (inventory) {
                const owner = world.entities[inventory.ownerId];
                return {
                    id: inventory.id,
                    owner_id: inventory.ownerId,
                    name: inventory.name || (owner ? owner.name : inventory.id),
                    transparent: true,
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
        const optionIssues = setup.ActionOptionValidation.validate(action, actionDefinition);
        optionIssues.forEach(function (issue) {
            switch (issue.code) {
                case "unavailable_option":
                    errors.push(`Action field ${issue.field} selected an unavailable option.`);
                    break;
                case "bulk_transfer_route_unavailable":
                    errors.push("Selected bulk-transfer route is unavailable.");
                    break;
                case "bulk_transfer_item_unavailable":
                    errors.push("Bulk transfer contains an unavailable item.");
                    break;
                case "hidden_location_target_unavailable":
                    errors.push("Selected hidden-location reveal target is unavailable for that location.");
                    break;
                case "amount_exceeds_maximum":
                    errors.push("Action amount exceeds the currently available maximum.");
                    break;
                case "equip_slot_unavailable":
                    errors.push("Action field slot selected an unavailable option for the selected item.");
                    break;
                case "item_input_required":
                    errors.push(`Action field input_text is required for ${issue.actionLabel}.`);
                    break;
                case "item_input_too_long":
                    errors.push(`Action field input_text exceeds the maximum length of ${issue.maximumLength}.`);
                    break;
                default:
                    throw new Error(`Unsupported action option issue ${String(issue.code)}.`);
            }
        });
        return errors;
    }

    function normalizeLegacyAbilityAction(actor, action, world) {
        if (!action || typeof action !== "object") return action;
        const legacyEffectType = action.type === "read_aura" ? "read_aura" : (action.type === "emit_location_observation" ? "emit_location_observation" : null);
        if (!legacyEffectType || Object.keys(action).some(function (key) { return key !== "type"; })) return action;
        const matches = (actor && actor.abilityIds || []).map(function (abilityId) { return world.abilities[abilityId]; }).filter(function (ability) {
            return ability && ability.actionType === "use_ability" && ability.effectType === legacyEffectType;
        });
        return matches.length === 1 ? { type: "use_ability", ability_id: matches[0].id } : action;
    }

    function validateActionRequest(actorId, action) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        action = normalizeLegacyAbilityAction(actor, action, world);
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

    function executePrevalidatedActionAfterContractChange(actorId, action, contractError, metadata) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return recordGroundedActionFailure(actorId, action, { code: "ACTOR_NOT_FOUND", message: "Actor character does not exist." }, metadata);
        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return recordGroundedActionFailure(actorId, action, { code: "ACTOR_NOT_PRESENT", message: "You are no longer present in the local simulation." }, metadata);
        }
        const normalized = normalizeLegacyAbilityAction(actor, action, world);
        const definition = normalized && ActionRegistry[normalized.type];
        if (!definition || !grantedActionSources(actor, world)[normalized.type]) {
            return recordGroundedActionFailure(actorId, normalized || action, { code: "ACTION_NOT_AVAILABLE", message: "The action became unavailable before the attempt could be completed." }, metadata);
        }
        const mechanical = definition.validate(actor, normalized, world);
        if (!mechanical.ok) {
            // Use the ordinary deterministic execution path so action-specific grounded feedback/events
            // (for example a locked-passage attempt) remain authoritative.
            return executeAction(actorId, normalized, metadata);
        }
        return recordGroundedActionFailure(actorId, normalized, {
            code: "ACTION_NOT_AVAILABLE",
            message: contractError && contractError.message || "The action became unavailable before the attempt could be completed."
        }, metadata);
    }

    function executeAction(actorId, action, metadata) {
        let world = ensureWorld();
        metadata = metadata && typeof metadata === "object" ? metadata : {};
        const transactionOwnedByCaller = metadata.worldTransactionOwned === true;
        const actor = getCharacter(actorId, world);
        const attempted = action && typeof action === "object" ? clone(action) : {};

        if (!actor) {
            return { ok: false, action: attempted, events: [], feedback: [], error: { code: "ACTOR_NOT_FOUND", message: "Actor character does not exist." } };
        }

        if (!action || typeof action !== "object") {
            return { ok: false, action: attempted, events: [], feedback: [], error: { code: "INVALID_ACTION", message: "Action must be an object." } };
        }
        action = normalizeLegacyAbilityAction(actor, action, world);

        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return { ok: false, action: attempted, events: [], feedback: [], error: { code: "ACTOR_NOT_PRESENT", message: "Actor character is not currently present in the local simulation." } };
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

        const snapshot = transactionOwnedByCaller ? null : snapshotWorld(world);

        try {
            const raw = definition.execute(actor, action, world);
            const rawEvents = Array.isArray(raw) ? raw : (raw.events || []);
            const feedback = Array.isArray(raw) ? [] : clone(raw.feedback || []);
            const modelRequests = Array.isArray(raw) ? [] : clone(raw.modelRequests || []);
            if (!transactionOwnedByCaller) {
                const invariantResult = validateWorld(world);
                if (!invariantResult.ok) throw invariantResult.error;
            }

            const events = rawEvents.map(function (eventData) {
                const enriched = Object.assign({}, eventData);
                if (metadata && metadata.interactionId) enriched.interactionId = metadata.interactionId;
                if (enriched.authoredEffectType === "emit_observation" && setup.AuthoredEffects && typeof setup.AuthoredEffects.emitObservationEventData === "function") {
                    const emitted = setup.AuthoredEffects.emitObservationEventData(enriched, world);
                    if (!emitted.ok) throw new Error(emitted.error.message);
                    return emitted.event;
                }
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
            if (transactionOwnedByCaller) throw error;
            State.variables.world = snapshot;
            world = getWorld();
            const failure = { code: "ACTION_EXECUTION_FAILED", message: error && error.message || "Action execution failed." };
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
        const transactionOwnedByCaller = Boolean(metadata && metadata.worldTransactionOwned === true);
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }
        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return fail("ACTOR_NOT_PRESENT", "Actor character is not currently present in the local simulation.");
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
            if (!target || target.locationId !== narrativeLocationId || !characterHasDiscoveredCharacter(actor, target, world) ||
                    (setup.Presence && !setup.Presence.isLocallyPresent(target, world))) {
                return fail("TARGET_NOT_NEARBY", "Narrative target is not nearby.");
            }
        }

        const snapshot = transactionOwnedByCaller ? null : snapshotWorld(world);
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
        if (!transactionOwnedByCaller) {
            const validation = validateWorld(world);
            if (!validation.ok) {
                restoreWorldInPlace(world, snapshot);
                return validation;
            }
        }
        return result;
    }


    function preflightIntent(actorId, input) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return fail("ACTOR_NOT_PRESENT", "Actor character is not currently present in the local simulation.");
        }

        input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        const text = typeof input.text === "string" ? input.text.trim() : "";
        const actionSupplied = Object.prototype.hasOwnProperty.call(input, "action") && input.action !== null && input.action !== undefined;
        if (actionSupplied && (typeof input.action !== "object" || Array.isArray(input.action))) {
            return fail("ACTION_CONTRACT_REJECTED", "Action must be a structured object.");
        }
        let action = actionSupplied ? clone(input.action) : null;
        if (!text && !action) return fail("EMPTY_INTENT", "Submit a narrative, one formal action, or both.");

        if (action) {
            const contractValidation = validateActionRequest(actorId, action);
            if (!contractValidation.ok) return contractValidation;
            action = clone(contractValidation.action);
        }

        const parsed = text ? setup.EventPerception.parseStructuredNarrative(text) : { spokenText: "", publicNarrative: "" };
        const spokenText = Object.prototype.hasOwnProperty.call(input, "spokenText")
            ? (typeof input.spokenText === "string" ? input.spokenText.trim() : "")
            : parsed.spokenText;
        const targetId = typeof input.target_id === "string" ? input.target_id : "";
        const noticeability = SPEECH_LOUDNESS_VALUES.includes(input.noticeability) ? input.noticeability : "noticeable";

        if (noticeability === "shout") {
            if (targetId) return fail("SHOUT_TARGET_FORBIDDEN", "A shout cannot have an addressee.");
            if (action && action.type === "move") return fail("SHOUT_MOVE_FORBIDDEN", "A shout cannot be combined with movement.");
            if (!spokenText) return fail("SHOUT_SPEECH_REQUIRED", "Shout requires spoken text.");
        }

        let moveSpeechPhase = "origin";
        if (text && targetId && action && action.type === "move") {
            const target = getCharacter(targetId, world);
            const targetInOrigin = Boolean(target && target.locationId === actor.locationId &&
                (!setup.Presence || setup.Presence.isLocallyPresent(target, world)) && characterHasDiscoveredCharacter(actor, target, world));
            const availableActions = getAvailableActions(actorId);
            const moveOptions = availableActions.move && availableActions.move.options || {};
            const knownDestinationTargets = moveOptions.speech_targets_by_destination && moveOptions.speech_targets_by_destination[action.destination_id] || [];
            const targetKnownInDestination = knownDestinationTargets.some(function (candidate) { return candidate.id === targetId; });
            if (!targetInOrigin && !targetKnownInDestination) {
                return fail("SPEECH_TARGET_NOT_GROUNDED", "That addressee is neither nearby nor known to be at the selected destination.");
            }
            if (!targetInOrigin && targetKnownInDestination) moveSpeechPhase = "destination";
        } else if (text && targetId) {
            const target = getCharacter(targetId, world);
            if (!target || target.locationId !== actor.locationId || !characterHasDiscoveredCharacter(actor, target, world) ||
                    (setup.Presence && !setup.Presence.isLocallyPresent(target, world))) {
                return fail("TARGET_NOT_NEARBY", "Narrative target is not nearby.");
            }
        }

        return ok({
            plan: {
                text: text,
                action: action,
                targetId: targetId,
                noticeability: noticeability,
                moveSpeechPhase: moveSpeechPhase,
                spokenText: spokenText
            }
        });
    }


    function submitIntent(actorId, input, options) {
        options = options && typeof options === "object" ? options : {};
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");

        input = input && typeof input === "object" ? input : {};
        const preflightPlan = options.preflightPlan && typeof options.preflightPlan === "object" ? options.preflightPlan : null;
        const text = preflightPlan ? preflightPlan.text : (typeof input.text === "string" ? input.text.trim() : "");
        const action = preflightPlan && preflightPlan.action ? clone(preflightPlan.action) : (input.action && typeof input.action === "object" ? clone(input.action) : null);
        if (!text && !action) return fail("EMPTY_INTENT", "Submit a narrative, one formal action, or both.");

        let postStartContractFailure = null;
        if (action) {
            const contractValidation = validateActionRequest(actorId, action);
            if (!contractValidation.ok) {
                if (options.actionWasPrevalidated === true) postStartContractFailure = clone(contractValidation.error);
                else return contractValidation;
            }
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

        const snapshot = snapshotWorld(world);
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
                    locationId: actor.locationId,
                    worldTransactionOwned: true
                });
                if (!narrativeResult.ok) throw narrativeResult.error;
            }
            if (action) {
                actionResult = postStartContractFailure
                    ? executePrevalidatedActionAfterContractChange(actorId, action, postStartContractFailure, { interactionId: interactionId, worldTransactionOwned: true })
                    : executeAction(actorId, action, { interactionId: interactionId, worldTransactionOwned: true });
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
                    locationId: deliveryLocationId,
                    worldTransactionOwned: true
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
        const snapshot = snapshotWorld(world);
        character.name = name;
        character.playerDescription = playerDescription;
        if (world.inventories[character.inventoryId]) world.inventories[character.inventoryId].name = name;
        const validation = validateWorld(world);
        if (!validation.ok) {
            restoreWorldInPlace(world, snapshot);
            return validation;
        }
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
        instantiateDeferredCharacter: instantiateDeferredCharacter,
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
        locationExitEntries: locationExitEntries,
        eventTouchesUndiscoveredLocation: eventTouchesUndiscoveredLocation,
        eventTouchesUndiscoveredCharacter: eventTouchesUndiscoveredCharacter,
        inventoryItems: inventoryItems,
        itemInstanceDisplayName: itemInstanceDisplayName,
        transformItem: transformItem,
        applyItemConsume: applyItemConsume,
        transferItem: transferItem,
        positionText: positionText,
        synchronizeDerivedItemPlacement: synchronizeDerivedItemPlacement,
        validateWorld: validateWorld,
        validateControlAssignments: validateControlAssignments,
        repairControlInvariant: repairControlInvariant,
        repairAIQueue: repairAIQueue,
        currentAuthoringRevision: currentAuthoringRevision,
        ensureWorld: ensureWorld,
        snapshotWorld: snapshotWorld,
        restoreWorldInPlace: restoreWorldInPlace,
        resetWorldTransactionDebug: function () { worldTransactionDebug.snapshots = 0; },
        getWorldTransactionDebug: function () { return clone(worldTransactionDebug); },
        enqueueAITurn: enqueueAITurn,
        pushDebugLog: pushDebugLog,
        enqueueObservation: enqueueObservation,
        normalizePlayerSetup: normalizePlayerSetup,
        applyTravelerIdentity: applyTravelerIdentity,
        validCustomTravelerAuthoring: validCustomTravelerAuthoring,
    };

    setup.Game = {
        WORLD_VERSION: WORLD_SCHEMA_VERSION,
        WORLD_SCHEMA_VERSION: WORLD_SCHEMA_VERSION,
        ActionRegistry: ActionRegistry,
        ItemEffectRegistry: ItemEffectRegistry,
        AbilityEffectRegistry: AbilityEffectRegistry,
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
            return State.variables.world || null;
        },
        validateWorld: function (world) {
            return validateWorld(world || State.variables.world);
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
        preflightIntent: preflightIntent,
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
