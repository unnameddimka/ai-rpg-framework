(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function fail(code, message) {
        return { ok: false, error: { code: code, message: message } };
    }

    function privateCharacter(actor, world) {
        const abilityInstructions = {};
        (actor.abilityIds || []).forEach(function (abilityId) {
            const ability = world.abilities[abilityId];
            if (ability && typeof ability.aiDescription === "string" && ability.aiDescription.trim()) {
                abilityInstructions[abilityId] = ability.aiDescription.trim();
            }
        });
        const context = { aiDescription: typeof actor.aiDescription === "string" ? actor.aiDescription : "" };
        if (Object.keys(abilityInstructions).length > 0) context.abilityInstructions = abilityInstructions;
        return context;
    }

    function mindContext(actor) {
        const mind = actor.mind || {};
        return {
            knownFacts: clone(mind.knownFacts || []),
            beliefs: clone(mind.beliefs || []),
            relationships: clone(mind.relationships || []),
            recentMemories: clone(mind.recentMemories || []),
            longTermMemories: clone(mind.longTermMemories || [])
        };
    }

    function build(actorId, options) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        options = options && typeof options === "object" ? options : {};
        const preparedObservations = Array.isArray(options.pendingObservations) ? clone(options.pendingObservations) : [];
        return clone({
            schemaVersion: 1,
            view: setup.CharacterAPI.getView(actorId),
            character: privateCharacter(actor, world),
            mind: mindContext(actor),
            continuation: setup.AIWorkingState.getContinuation(actorId),
            pendingObservations: preparedObservations
        });
    }

    function buildMaintenance(actorId, options) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        options = options && typeof options === "object" ? options : {};
        const I = setup.GameInternals;
        const location = I.getLocation(actor.locationId, world);
        const selfInventory = I.inventoryItems(actor.inventoryId, world);
        return clone({
            schemaVersion: 1,
            view: {
                self: {
                    id: actor.id,
                    name: actor.name,
                    playerDescription: actor.playerDescription || "",
                    location_id: actor.locationId,
                    sublocation_id: actor.sublocationId,
                    sleeping: actor.sleeping === true,
                    position_text: I.positionText(actor, world),
                    inventory: selfInventory.map(function (item) {
                        return {
                            id: item.id,
                            name: item.name,
                            definition_id: item.definition_id,
                            family_id: item.family_id,
                            description: item.description || "",
                            tags: clone(item.tags || [])
                        };
                    })
                },
                location: { id: location.id, name: location.name }
            },
            character: privateCharacter(actor, world),
            mind: mindContext(actor),
            pendingObservations: Array.isArray(options.pendingObservations) ? clone(options.pendingObservations) : []
        });
    }

    setup.CharacterContext = {
        buildPrivateCharacter: function (actorId) {
            const world = setup.Game.getWorld();
            const actor = world.entities[actorId];
            return actor && actor.type === "character" ? clone(privateCharacter(actor, world)) : fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        },
        buildMind: function (actorId) {
            const actor = setup.Game.getWorld().entities[actorId];
            return actor && actor.type === "character" ? clone(mindContext(actor)) : fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        },
        buildMaintenance: buildMaintenance
    };
    setup.ContextBuilder = { build: build };
}());
