(function () {
    "use strict";

    const PRESENCE_STATE_REVISION = 1;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }

    function worldOrCurrent(world) {
        return world || (setup.Game && setup.Game.getWorld ? setup.Game.getWorld() : null);
    }

    function characterOrNull(characterOrId, world) {
        world = worldOrCurrent(world);
        if (!world) return null;
        if (typeof characterOrId === "string") {
            const entity = world.entities && world.entities[characterOrId];
            return entity && entity.type === "character" ? entity : null;
        }
        return characterOrId && characterOrId.type === "character" ? characterOrId : null;
    }

    function locationOrNull(locationOrId, world) {
        world = worldOrCurrent(world);
        if (!world) return null;
        if (typeof locationOrId === "string") {
            const entity = world.entities && world.entities[locationOrId];
            return entity && entity.type === "location" ? entity : null;
        }
        return locationOrId && locationOrId.type === "location" ? locationOrId : null;
    }

    function sublocationOrNull(sublocationOrId, world) {
        world = worldOrCurrent(world);
        if (!world) return null;
        if (typeof sublocationOrId === "string") {
            const entity = world.entities && world.entities[sublocationOrId];
            return entity && entity.type === "sublocation" ? entity : null;
        }
        return sublocationOrId && sublocationOrId.type === "sublocation" ? sublocationOrId : null;
    }

    function activationIs(characterOrId, value, world) {
        const character = characterOrNull(characterOrId, world);
        if (!character) return false;
        const state = character.activationState === "inactive" ? "inactive" : "active";
        return state === value;
    }

    function structuralPlacement(character, world) {
        if (!character || typeof character.locationId !== "string" || typeof character.sublocationId !== "string") return false;
        const location = locationOrNull(character.locationId, world);
        const sublocation = sublocationOrNull(character.sublocationId, world);
        return Boolean(location && sublocation && sublocation.locationId === location.id);
    }

    function stateRecord(characterOrId, world) {
        const character = characterOrNull(characterOrId, world);
        const state = character && character.presenceState;
        return state && typeof state === "object" && !Array.isArray(state) ? state : null;
    }

    function stateAllowsPresence(characterOrId, world) {
        const state = stateRecord(characterOrId, world);
        return Boolean(state && state.present === true);
    }

    function setLocalPresence(characterOrId, present, world) {
        world = worldOrCurrent(world);
        const character = characterOrNull(characterOrId, world);
        if (!world || !character) return fail("PRESENCE_CHARACTER_MISSING", "Presence state can only be changed for an existing character.");
        if (typeof present !== "boolean") return fail("PRESENCE_VALUE_INVALID", "Presence state must be Boolean.");
        character.presenceState = { present: present, revision: PRESENCE_STATE_REVISION };
        return ok({ characterId: character.id, present: present });
    }

    function initializeFreshWorld(world) {
        world = worldOrCurrent(world);
        if (!world) return fail("PRESENCE_WORLD_MISSING", "World state is unavailable.");
        const initialized = [];
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character") return;
            const present = true;
            entity.presenceState = { present: present, revision: PRESENCE_STATE_REVISION };
            initialized.push({ characterId: entity.id, present: present });
        });
        return ok({ initialized: initialized });
    }

    function prepareCurrentWorld(world) {
        world = worldOrCurrent(world);
        if (!world) return fail("PRESENCE_WORLD_MISSING", "World state is unavailable.");
        Object.values(world.entities || {}).forEach(function (entity) {
            if (!entity || entity.type !== "character") return;
            const state = stateRecord(entity, world);
            if (state && typeof state.present === "boolean" && Number.isInteger(state.revision) && state.revision >= 1) return;
            const present = true;
            entity.presenceState = { present: present, revision: PRESENCE_STATE_REVISION };
        });
        return ok();
    }

    function initializeMigratedState(characterOrId, savedCharacter, world) {
        world = worldOrCurrent(world);
        const character = characterOrNull(characterOrId, world);
        if (!world || !character) return fail("PRESENCE_CHARACTER_MISSING", "Migrated presence state requires an existing character.");
        const saved = savedCharacter && savedCharacter.presenceState;
        const present = saved && typeof saved === "object" && !Array.isArray(saved) && typeof saved.present === "boolean"
            ? saved.present
            : true;
        character.presenceState = { present: present, revision: PRESENCE_STATE_REVISION };
        return ok({ characterId: character.id, present: present, preserved: Boolean(saved && typeof saved.present === "boolean") });
    }

    function validateState(characterOrId, world) {
        const character = characterOrNull(characterOrId, world);
        if (!character) return fail("PRESENCE_CHARACTER_MISSING", "Presence validation requires an existing character.");
        const state = character.presenceState;
        if (!state || typeof state !== "object" || Array.isArray(state) || typeof state.present !== "boolean" ||
                !Number.isInteger(state.revision) || state.revision < 1) {
            return fail("CHARACTER_PRESENCE_STATE_INVALID", `Character ${character.id} has invalid neutral presence state.`);
        }
        return ok();
    }

    function baseLocalPresence(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = characterOrNull(characterOrId, world);
        if (!world || !character) return false;
        if (!activationIs(character, "active", world)) return false;
        if (!stateAllowsPresence(character, world)) return false;
        return structuralPlacement(character, world);
    }

    function ownerAllowsTopology(ownerId, world, visiting) {
        if (!ownerId) return true;
        const owner = characterOrNull(ownerId, world);
        if (!owner || !baseLocalPresence(owner, world)) return false;

        // An owner is allowed to occupy topology that it owns. This breaks the natural ownership cycle
        // without weakening checks for topology owned by some other absent character.
        const key = `character:${owner.id}`;
        if (visiting.has(key)) return true;
        const next = new Set(visiting);
        next.add(key);
        const location = locationOrNull(owner.locationId, world);
        const sublocation = sublocationOrNull(owner.sublocationId, world);
        if (!location || !sublocation) return false;
        if (location.presenceOwnerCharacterId && location.presenceOwnerCharacterId !== owner.id && !ownerAllowsTopology(location.presenceOwnerCharacterId, world, next)) return false;
        if (sublocation.presenceOwnerCharacterId && sublocation.presenceOwnerCharacterId !== owner.id && !ownerAllowsTopology(sublocation.presenceOwnerCharacterId, world, next)) return false;
        return true;
    }

    function isLocationAvailable(locationOrId, world) {
        world = worldOrCurrent(world);
        const location = locationOrNull(locationOrId, world);
        if (!world || !location) return false;
        return ownerAllowsTopology(location.presenceOwnerCharacterId, world, new Set([`location:${location.id}`]));
    }

    function isSublocationAvailable(sublocationOrId, world) {
        world = worldOrCurrent(world);
        const sublocation = sublocationOrNull(sublocationOrId, world);
        if (!world || !sublocation || !isLocationAvailable(sublocation.locationId, world)) return false;
        return ownerAllowsTopology(sublocation.presenceOwnerCharacterId, world, new Set([`sublocation:${sublocation.id}`]));
    }

    function validLocalPlacement(character, world) {
        if (!structuralPlacement(character, world)) return false;
        return isLocationAvailable(character.locationId, world) && isSublocationAvailable(character.sublocationId, world);
    }

    function isLocallyPresent(characterOrId, world) {
        world = worldOrCurrent(world);
        const character = characterOrNull(characterOrId, world);
        if (!world || !character) return false;
        if (!baseLocalPresence(character, world)) return false;
        return validLocalPlacement(character, world);
    }

    function explicitFallback(record) {
        const value = record && record.presenceFallbackPlacement;
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return {
            locationId: typeof value.locationId === "string" ? value.locationId : "",
            sublocationId: typeof value.sublocationId === "string" ? value.sublocationId : ""
        };
    }

    function resolveFallbackPlacement(recordOrId, world) {
        world = worldOrCurrent(world);
        if (!world) return fail("PRESENCE_FALLBACK_WORLD_MISSING", "World state is unavailable.");
        const record = typeof recordOrId === "string" ? world.entities && world.entities[recordOrId] : recordOrId;
        if (!record || !["location", "sublocation"].includes(record.type) || !record.presenceOwnerCharacterId) {
            return fail("PRESENCE_FALLBACK_NOT_CONDITIONAL", "Presence fallback can only be resolved for conditional topology.");
        }

        const explicit = explicitFallback(record);
        if (explicit) {
            const location = locationOrNull(explicit.locationId, world);
            const sublocation = sublocationOrNull(explicit.sublocationId, world);
            if (!location || !sublocation || sublocation.locationId !== location.id) {
                return fail("PRESENCE_FALLBACK_INVALID", `Conditional topology ${record.id} has an invalid explicit fallback placement.`);
            }
            return ok({ placement: { locationId: location.id, sublocationId: sublocation.id }, inferred: false });
        }

        if (record.type === "sublocation") {
            const parent = locationOrNull(record.locationId, world);
            const fallback = parent && sublocationOrNull(parent.defaultSublocationId, world);
            if (!parent || !fallback || parent.presenceOwnerCharacterId === record.presenceOwnerCharacterId) {
                return fail("PRESENCE_FALLBACK_AMBIGUOUS", `Conditional sublocation ${record.id} requires an explicit fallback placement.`);
            }
            return ok({ placement: { locationId: parent.id, sublocationId: fallback.id }, inferred: true });
        }

        const transitions = setup.GameInternals && typeof setup.GameInternals.locationExitEntries === "function"
            ? setup.GameInternals.locationExitEntries(record, world)
            : [];
        const destinationIds = Array.from(new Set(transitions.map(function (entry) { return entry && entry.destinationId; }).filter(Boolean)));
        if (destinationIds.length !== 1) {
            return fail("PRESENCE_FALLBACK_AMBIGUOUS", `Conditional location ${record.id} requires an explicit fallback placement.`);
        }
        const destination = locationOrNull(destinationIds[0], world);
        const fallback = destination && sublocationOrNull(destination.defaultSublocationId, world);
        if (!destination || !fallback || destination.presenceOwnerCharacterId === record.presenceOwnerCharacterId) {
            return fail("PRESENCE_FALLBACK_AMBIGUOUS", `Conditional location ${record.id} requires an explicit fallback placement.`);
        }
        return ok({ placement: { locationId: destination.id, sublocationId: fallback.id }, inferred: true });
    }

    function collectOwnedTopologyOccupants(ownerId, world) {
        world = worldOrCurrent(world);
        if (!world || typeof ownerId !== "string" || !ownerId) return [];
        return Object.values(world.entities || {}).filter(function (entity) {
            if (!entity || entity.type !== "character" || entity.id === ownerId || !isLocallyPresent(entity, world)) return false;
            const location = locationOrNull(entity.locationId, world);
            const sublocation = sublocationOrNull(entity.sublocationId, world);
            return Boolean((location && location.presenceOwnerCharacterId === ownerId) || (sublocation && sublocation.presenceOwnerCharacterId === ownerId));
        }).map(function (character) { return character.id; });
    }

    function topologyForDisplacedCharacter(character, ownerId, world) {
        const sublocation = sublocationOrNull(character && character.sublocationId, world);
        if (sublocation && sublocation.presenceOwnerCharacterId === ownerId) return sublocation;
        const location = locationOrNull(character && character.locationId, world);
        if (location && location.presenceOwnerCharacterId === ownerId) return location;
        return null;
    }

    function locallyPresentOccupantCount(sublocationId, world, excludedCharacterId) {
        return Object.values(world.entities || {}).filter(function (entity) {
            return entity && entity.type === "character" && entity.id !== excludedCharacterId && entity.sublocationId === sublocationId && isLocallyPresent(entity, world);
        }).length;
    }

    function relocationText(character, topology, destination) {
        const characterName = character && character.name || character && character.id || "A character";
        const topologyName = topology && topology.name || topology && topology.id || "the place";
        const destinationName = destination && destination.name || destination && destination.id || "a nearby place";
        return `${topologyName} becomes unavailable, forcing ${characterName} out to ${destinationName}.`;
    }

    function restoreWorld(world, snapshot) {
        Object.keys(world).forEach(function (key) { delete world[key]; });
        Object.assign(world, snapshot);
    }

    function reconcileOwnedTopologyOccupants(ownerId, occupantIds, world) {
        world = worldOrCurrent(world);
        if (!world) return fail("PRESENCE_RECONCILE_WORLD_MISSING", "World state is unavailable.");
        const snapshot = clone(world);
        const relocations = [];
        try {
            for (const characterId of occupantIds || []) {
                const character = characterOrNull(characterId, world);
                if (!character || character.id === ownerId) continue;
                const topology = topologyForDisplacedCharacter(character, ownerId, world);
                if (!topology) continue;
                const resolved = resolveFallbackPlacement(topology, world);
                if (!resolved.ok) throw resolved.error;
                const location = locationOrNull(resolved.placement.locationId, world);
                const sublocation = sublocationOrNull(resolved.placement.sublocationId, world);
                if (!location || !sublocation || !isLocationAvailable(location, world) || !isSublocationAvailable(sublocation, world)) {
                    throw { code: "PRESENCE_FALLBACK_UNAVAILABLE", message: `Fallback placement for ${topology.id} is not locally available after the owner transition.` };
                }
                if (locallyPresentOccupantCount(sublocation.id, world, character.id) >= sublocation.capacity) {
                    throw { code: "PRESENCE_FALLBACK_CAPACITY", message: `Fallback sublocation ${sublocation.id} has no capacity for ${character.id}.` };
                }
                const fromLocationId = character.locationId;
                const fromSublocationId = character.sublocationId;
                character.locationId = location.id;
                character.sublocationId = sublocation.id;
                character.sleeping = false;
                if (!isLocallyPresent(character, world)) {
                    throw { code: "PRESENCE_FALLBACK_INVALID", message: `Forced relocation left ${character.id} outside valid local topology.` };
                }
                let event = null;
                if (setup.EventPerception && typeof setup.EventPerception.emitEvent === "function") {
                    event = setup.EventPerception.emitEvent({
                        type: "presence_forced_relocation",
                        actorId: ownerId,
                        targetId: character.id,
                        locationId: location.id,
                        fromLocationId: fromLocationId,
                        toLocationId: location.id,
                        fromSublocationId: fromSublocationId,
                        toSublocationId: sublocation.id,
                        noticeability: "noticeable",
                        text: relocationText(character, topology, location)
                    }, world);
                } else if (setup.GameInternals && typeof setup.GameInternals.enqueueObservation === "function") {
                    setup.GameInternals.enqueueObservation(character.id, {
                        kind: "presence_forced_relocation",
                        code: "PRESENCE_FORCED_RELOCATION",
                        actorId: ownerId,
                        targetId: character.id,
                        turn: world.nextEventId,
                        text: relocationText(character, topology, location),
                        data: { fromLocationId: fromLocationId, toLocationId: location.id, fromSublocationId: fromSublocationId, toSublocationId: sublocation.id }
                    }, world);
                }
                relocations.push({
                    characterId: character.id,
                    fromLocationId: fromLocationId,
                    fromSublocationId: fromSublocationId,
                    locationId: location.id,
                    sublocationId: sublocation.id,
                    inferredFallback: resolved.inferred,
                    event: event ? clone(event) : null
                });
            }
            if (setup.GameInternals && typeof setup.GameInternals.validateWorld === "function") {
                const validation = setup.GameInternals.validateWorld(world);
                if (!validation.ok) throw validation.error;
            }
            return ok({ relocations: relocations });
        } catch (error) {
            restoreWorld(world, snapshot);
            return fail(error && error.code || "PRESENCE_RECONCILE_FAILED", error && error.message || "Presence reconciliation failed.");
        }
    }

    setup.Presence = {
        PRESENCE_STATE_REVISION: PRESENCE_STATE_REVISION,
        isLocallyPresent: isLocallyPresent,
        activationIs: activationIs,
        baseLocalPresence: baseLocalPresence,
        validLocalPlacement: validLocalPlacement,
        isLocationAvailable: isLocationAvailable,
        isSublocationAvailable: isSublocationAvailable,
        stateAllowsPresence: stateAllowsPresence,
        setLocalPresence: setLocalPresence,
        initializeFreshWorld: initializeFreshWorld,
        prepareCurrentWorld: prepareCurrentWorld,
        initializeMigratedState: initializeMigratedState,
        validateState: validateState,
        resolveFallbackPlacement: resolveFallbackPlacement,
        collectOwnedTopologyOccupants: collectOwnedTopologyOccupants,
        reconcileOwnedTopologyOccupants: reconcileOwnedTopologyOccupants
    };
}());
