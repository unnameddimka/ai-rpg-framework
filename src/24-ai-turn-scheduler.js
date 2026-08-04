(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function characterName(characterId, world) {
        const character = world.entities[characterId];
        return character && character.type === "character" ? character.name : characterId || "Unknown";
    }

    function locationName(locationId, world) {
        const location = world.entities[locationId];
        return location && location.type === "location" ? location.name : locationId || "Unknown";
    }

    function observationType(observation) {
        return observation && observation.data && observation.data.type
            ? observation.data.type
            : (observation && observation.actionType) || (observation && observation.kind) || "observation";
    }

    function describeObservation(observation, world) {
        const data = observation && observation.data || {};
        const type = observationType(observation);
        const actorId = observation.actorId || data.actorId || null;
        const targetId = observation.targetId || data.targetId || null;
        const actor = actorId ? characterName(actorId, world) : "World";
        const target = targetId ? characterName(targetId, world) : "";
        const text = observation && typeof observation.text === "string" ? observation.text : "";
        let summary = text || type;

        if (type === "narrative_input") {
            summary = target
                ? `${actor} to ${target}: “${text}”`
                : `${actor}: “${text}”`;
        } else if (type === "character_entered_location") {
            summary = `${actor} entered ${locationName(data.toLocationId || data.locationId, world)}.`;
        } else if (type === "character_left_location") {
            summary = `${actor} left ${locationName(data.fromLocationId || data.locationId, world)}.`;
        } else if (observation && observation.kind === "action_feedback") {
            summary = `${observation.code || observation.actionType || "Action feedback"}: ${text}`;
        }

        return {
            id: observation.id,
            turn: observation.turn || null,
            kind: observation.kind || "observation",
            type: type,
            actorId: actorId,
            actorName: actor,
            targetId: targetId,
            targetName: target,
            text: text,
            summary: summary
        };
    }

    function buildDecisionRequest(characterId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character" || !actor.mind || !Array.isArray(actor.mind.pendingObservations)) {
            return { ok: false, error: { code: "AI_SCHEDULER_ACTOR_INVALID", message: "The queued AI character has no valid observation inbox." } };
        }
        if (world.control.assignments[characterId] !== "ai" || actor.mind.pendingObservations.length === 0) {
            return { ok: false, error: { code: "AI_SCHEDULER_ENTRY_STALE", message: "The selected AI queue entry is no longer eligible." } };
        }
        const observations = clone(actor.mind.pendingObservations.slice(0, 50));
        const context = setup.ContextBuilder.build(actor.id);
        if (context && context.ok === false) return context;
        context.mind.pendingObservations = clone(observations);
        return {
            ok: true,
            actorId: actor.id,
            actorName: actor.name,
            stage: "decision",
            observations: observations,
            observationIds: observations.map(function (item) { return item.id; }),
            context: context,
            messages: setup.AIProtocol.decisionMessages(context, observations),
            availableActions: context.availableActions
        };
    }

    function getQueueView() {
        const world = setup.Game.getWorld();
        const status = setup.AITurnQueue.getStatus();
        const entries = status.entries.map(function (entry, index) {
            const actor = world.entities[entry.characterId];
            const observations = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
                ? actor.mind.pendingObservations.slice(0, 50)
                : [];
            const described = observations.map(function (observation) {
                return describeObservation(observation, world);
            });
            const available = actor ? setup.CharacterAPI.getAvailableActions(actor.id) : {};
            return {
                index: index,
                position: index + 1,
                isNext: index === 0,
                characterId: entry.characterId,
                recipientName: actor && actor.name || entry.characterId,
                locationId: actor && actor.locationId || null,
                locationName: actor ? locationName(actor.locationId, world) : "Unknown",
                reason: entry.reason || "observation",
                pendingObservationCount: actor && actor.mind && actor.mind.pendingObservations
                    ? actor.mind.pendingObservations.length
                    : 0,
                requestObservationCount: observations.length,
                availableActionCount: available && typeof available === "object" ? Object.keys(available).length : 0,
                primaryObservation: described[0] || null,
                observationPreview: described.slice(0, 4),
                hiddenObservationCount: Math.max(0, described.length - 4)
            };
        });
        return {
            count: entries.length,
            entries: entries,
            head: entries[0] || null
        };
    }

    async function processNext(client) {
        return setup.AIController.takeNextTurn(client || setup.OpenRouterClient);
    }

    setup.AITurnScheduler = {
        processNext: processNext,
        buildDecisionRequest: buildDecisionRequest,
        getQueueView: getQueueView,
        describeObservation: function (observation) {
            return clone(describeObservation(observation, setup.Game.getWorld()));
        },
        getStatus: function () {
            return {
                queue: getQueueView(),
                executor: setup.AIRequestExecutor.getStatus()
            };
        }
    };
}());
