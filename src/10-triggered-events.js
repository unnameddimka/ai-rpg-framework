(function () {
    "use strict";

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
    function currentWorld() { return setup.Game.getWorld(); }
    const debugStats = { transactionSnapshots: 0, transactionCandidates: 0 };

    function ensureRuntime(world) {
        if (!world.triggeredEventRuntime || typeof world.triggeredEventRuntime !== "object" || Array.isArray(world.triggeredEventRuntime)) world.triggeredEventRuntime = {};
        if (!Number.isInteger(world.triggeredEventRuntime.lastProcessedOrdinaryTickId) || world.triggeredEventRuntime.lastProcessedOrdinaryTickId < 0) {
            const legacy = Object.values(world.triggeredEventRuntime.lastProcessedOrdinaryTickByEvent || {}).filter(function (value) { return Number.isInteger(value) && value >= 0; });
            world.triggeredEventRuntime.lastProcessedOrdinaryTickId = legacy.length ? Math.max.apply(Math, legacy) : 0;
        }
        delete world.triggeredEventRuntime.ordinaryTickCounter;
        delete world.triggeredEventRuntime.lastProcessedOrdinaryTickByEvent;
        return world.triggeredEventRuntime;
    }

    function ordinaryPhaseName(world) {
        if (!world || !world.environment) return "";
        if (world.environment.timePhase === "morning") return "Morning";
        if (world.environment.timePhase === "evening") return "Evening";
        return "";
    }

    function characterActivationIs(characterId, value, world) {
        const character = setup.GameInternals.getCharacter(characterId, world);
        if (!character) return false;
        const state = character.activationState === "inactive" ? "inactive" : "active";
        return state === value;
    }

    function characterLocallyPresent(characterId, value, world) {
        const present = Boolean(setup.Presence && setup.Presence.isLocallyPresent(characterId, world));
        return present === (value !== false);
    }

    function locationGroundInventory(locationId, world) {
        const location = setup.GameInternals.getLocation(locationId, world);
        return location && world.inventories[location.inventoryId] || null;
    }

    function matchingGroundItems(locationId, tag, world) {
        const inventory = locationGroundInventory(locationId, world);
        if (!inventory) return [];
        return inventory.itemIds.map(function (itemId) { return world.entities[itemId]; }).filter(function (item) {
            const definition = item && world.itemDefinitions[item.definitionId];
            return Boolean(definition && Array.isArray(definition.tags) && definition.tags.includes(tag));
        });
    }

    function prerequisiteSatisfied(prerequisite, world) {
        if (!prerequisite || typeof prerequisite !== "object") return false;
        if (prerequisite.type === "phase_is") return ordinaryPhaseName(world) === prerequisite.phase;
        if (prerequisite.type === "location_inventory_contains_tag") return matchingGroundItems(prerequisite.locationId, prerequisite.tag, world).length >= (Number.isInteger(prerequisite.minimum) ? prerequisite.minimum : 1);
        if (prerequisite.type === "character_activation_is") return characterActivationIs(prerequisite.characterId, prerequisite.value, world);
        if (prerequisite.type === "character_locally_present") return characterLocallyPresent(prerequisite.characterId, prerequisite.value, world);
        // Narrow compatibility aliases: activation only, never local presence.
        if (prerequisite.type === "character_active") return characterActivationIs(prerequisite.characterId, "active", world);
        if (prerequisite.type === "character_inactive") return characterActivationIs(prerequisite.characterId, "inactive", world);
        return false;
    }

    function eligible(event, world) {
        return (event.prerequisites || []).every(function (record) { return prerequisiteSatisfied(record, world); });
    }

    function activateCharacter(effect, world) {
        let character = setup.GameInternals.getCharacter(effect.characterId, world);
        if (!character && setup.GameInternals.instantiateDeferredCharacter) {
            character = setup.GameInternals.instantiateDeferredCharacter(effect.characterId, world, { locationId: effect.locationId, sublocationId: effect.sublocationId });
        }
        if (!character) return fail("TRIGGERED_ACTIVATION_INVALID", `Cannot activate character ${String(effect.characterId)}.`);
        const location = setup.GameInternals.getLocation(effect.locationId, world);
        const sublocationId = effect.sublocationId || location && location.defaultSublocationId;
        const sublocation = setup.GameInternals.getSublocation(sublocationId, world);
        if (!location || !sublocation || sublocation.locationId !== location.id) return fail("TRIGGERED_ACTIVATION_DESTINATION_INVALID", "Activation destination is invalid.");
        character.activationState = "active";
        character.locationId = location.id;
        character.sublocationId = sublocation.id;
        character.sleeping = false;
        if (location.requiresDiscovery === true) setup.GameInternals.grantLocationDiscovery(character.id, location.id, world);
        if (!world.control.assignments[character.id]) world.control.assignments[character.id] = character.defaultControllerId || "ai";
        if (world.control.assignments[character.id] === "ai" && setup.GameInternals.enqueueObservation) {
            setup.GameInternals.enqueueObservation(character.id, { kind: "activation", code: "CHARACTER_ACTIVATED", actorId: character.id, turn: world.nextEventId, text: `You become locally present at ${location.name}.`, data: { locationId: location.id, sublocationId: sublocation.id } }, world);
        }
        return ok({ character: character });
    }

    function deactivateCharacter(effect, world) {
        const character = setup.GameInternals.getCharacter(effect.characterId, world);
        if (!character) return ok({ changed: false });
        const displacedCharacterIds = setup.Presence && typeof setup.Presence.collectOwnedTopologyOccupants === "function"
            ? setup.Presence.collectOwnedTopologyOccupants(character.id, world) : [];
        character.activationState = "inactive";
        character.locationId = null;
        character.sublocationId = null;
        character.sleeping = false;
        const reconciliation = displacedCharacterIds.length && setup.Presence && typeof setup.Presence.reconcileOwnedTopologyOccupants === "function"
            ? setup.Presence.reconcileOwnedTopologyOccupants(character.id, displacedCharacterIds, world)
            : ok({ relocations: [] });
        if (!reconciliation.ok) return reconciliation;
        if (character.mind && Array.isArray(character.mind.pendingObservations)) character.mind.pendingObservations = [];
        if (world.ai && Array.isArray(world.ai.turnQueue)) world.ai.turnQueue = world.ai.turnQueue.filter(function (entry) {
            return (typeof entry === "string" ? entry : entry && entry.characterId) !== character.id;
        });
        if (world.ai && world.ai.continuations && Object.prototype.hasOwnProperty.call(world.ai.continuations, character.id)) world.ai.continuations[character.id] = null;
        return ok({ changed: true, forcedRelocations: clone(reconciliation.relocations || []) });
    }

    function consumeMatchingItems(effect, world) {
        const source = effect.source || {};
        const items = source.type === "location_inventory" ? matchingGroundItems(source.locationId, effect.itemTag, world) : [];
        const changes = [];
        for (const item of items) {
            if (!setup.GameInternals.applyItemConsume) return fail("TRIGGERED_CONSUME_INVALID", "Shared item-consumption primitive is unavailable.");
            const result = setup.GameInternals.applyItemConsume(item, world);
            if (!result.ok) return result;
            changes.push(result.value);
        }
        return ok({ itemIds: items.map(function (item) { return item.id; }), changes: changes });
    }

    function executeEffect(effect, world, pendingObservations) {
        if (effect.type === "activate_character") return activateCharacter(effect, world);
        if (effect.type === "deactivate_character") return deactivateCharacter(effect, world);
        if (effect.type === "consume_matching_items") return consumeMatchingItems(effect, world);
        if (effect.type === "emit_observation") {
            const eventData = setup.AuthoredEffects.createObservationEventData(effect, { eventType: "authored_triggered_event" });
            pendingObservations.push({ eventData: eventData, discoveryCharacterId: null });
            return ok();
        }
        return fail("TRIGGERED_EFFECT_UNSUPPORTED", `Unsupported triggered-event effect ${String(effect.type)}.`);
    }

    function executeEvent(event, world) {
        const pendingObservations = [];
        let activatedDiscoverableCharacterId = null;
        for (const effect of (event.effects || [])) {
            const result = executeEffect(effect, world, pendingObservations);
            if (!result.ok) return result;
            if (effect.type === "activate_character") {
                const target = setup.GameInternals.getCharacter(effect.characterId, world);
                if (target && setup.GameInternals.characterRequiresDiscovery(target, world)) activatedDiscoverableCharacterId = target.id;
            }
        }
        if (activatedDiscoverableCharacterId) {
            pendingObservations.forEach(function (record) {
                record.discoveryCharacterId = activatedDiscoverableCharacterId;
                record.eventData.revealsCharacterId = activatedDiscoverableCharacterId;
            });
        }
        return ok({ pendingObservations: event.narrationPolicy === "none" ? [] : pendingObservations });
    }

    function process(triggerType, options) {
        options = options && typeof options === "object" ? options : {};
        const sourceWorld = currentWorld();
        if (!sourceWorld) return fail("WORLD_MISSING", "World state does not exist.");
        const runtime = ensureRuntime(sourceWorld);
        const random = typeof options.random === "function" ? options.random : Math.random;
        const tickId = triggerType === "ordinary_tick" ? options.tickId : null;
        if (triggerType === "ordinary_tick") {
            if (!Number.isInteger(tickId) || tickId < 1 || tickId !== sourceWorld.ordinaryTickId) return fail("TRIGGERED_TICK_ID_INVALID", "Ordinary triggered-event processing requires the current canonical tickId.");
            if (runtime.lastProcessedOrdinaryTickId >= tickId) return ok({ triggerType: triggerType, tickId: tickId, results: [], events: [], duplicate: true });
        }

        const definitions = Object.values(sourceWorld.triggeredEvents || {}).filter(function (event) { return event && event.trigger && event.trigger.type === triggerType; });
        const eventResults = [];
        let candidate = null;
        const pending = [];
        try {
            for (const event of definitions) {
                // Eligibility for every definition in this logical tick is evaluated against the same tick-start world.
                // Earlier triggered effects may mutate the candidate, but cannot create or revoke same-tick eligibility.
                if (!eligible(event, sourceWorld)) {
                    eventResults.push({ eventId: event.id, eligible: false, rolled: false, triggered: false });
                    continue;
                }
                let roll = null;
                if (typeof event.chance === "number") {
                    roll = Number(random());
                    if (!(roll >= 0 && roll < event.chance)) {
                        eventResults.push({ eventId: event.id, eligible: true, rolled: true, roll: roll, triggered: false });
                        continue;
                    }
                }
                if (!candidate) {
                    // A real proc is the transaction boundary. No prerequisite/miss path clones the world.
                    debugStats.transactionSnapshots += 1;
                    debugStats.transactionCandidates += 1;
                    candidate = clone(sourceWorld);
                    ensureRuntime(candidate);
                }
                const executed = executeEvent(event, candidate);
                if (!executed.ok) throw new Error(executed.error.message);
                pending.push.apply(pending, (executed.pendingObservations || []).map(function (record) { return Object.assign({ eventId: event.id }, record); }));
                eventResults.push({ eventId: event.id, eligible: true, rolled: typeof event.chance === "number", roll: roll, triggered: true });
            }

            if (!candidate) {
                // Only processed-tick bookkeeping changes on a no-op/miss; no world transaction or full validation is needed.
                if (triggerType === "ordinary_tick") runtime.lastProcessedOrdinaryTickId = tickId;
                return ok({ triggerType: triggerType, tickId: tickId, results: eventResults, events: [] });
            }

            const emittedEvents = [];
            for (const record of pending) {
                const emitted = setup.AuthoredEffects.emitObservationEventData(record.eventData, candidate);
                if (!emitted.ok) throw new Error(emitted.error.message);
                emittedEvents.push(emitted.event);
                if (record.discoveryCharacterId) {
                    emitted.recipientIds.forEach(function (recipientId) {
                        if (recipientId !== record.discoveryCharacterId) setup.GameInternals.grantCharacterDiscovery(recipientId, record.discoveryCharacterId, candidate);
                    });
                }
            }
            if (triggerType === "ordinary_tick") ensureRuntime(candidate).lastProcessedOrdinaryTickId = tickId;
            const validation = setup.GameInternals.validateWorld(candidate);
            if (!validation.ok) throw new Error(validation.error.message);
            State.variables.world = candidate;
            return ok({ triggerType: triggerType, tickId: tickId, results: eventResults, events: clone(emittedEvents) });
        } catch (error) {
            // Candidate mutations were never committed, so the canonical source world remains untouched.
            return fail("TRIGGERED_EVENT_EXECUTION_FAILED", error.message);
        }
    }

    setup.TriggeredEvents = {
        process: process,
        processOrdinaryTick: function (options) { return process("ordinary_tick", options); },
        processTimelapseStart: function (options) { return process("timelapse_start", options); },
        prerequisiteSatisfied: prerequisiteSatisfied,
        characterActivationIs: characterActivationIs,
        characterLocallyPresent: characterLocallyPresent,
        getDebugStats: function () { return clone(debugStats); },
        resetDebugStats: function () { debugStats.transactionSnapshots = 0; debugStats.transactionCandidates = 0; }
    };
}());
