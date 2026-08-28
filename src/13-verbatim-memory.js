(function () {
    "use strict";

    const I = setup.GameInternals;
    const V = setup.MindValidators;

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

    function currentOr(world) { return world || setup.Game.getWorld(); }

    function normalizedAuthority(value) {
        return ["narrative_only", "grounded_event", "grounded_result"].includes(value) ? value : null;
    }

    function observationAuthority(observation) {
        const explicit = normalizedAuthority(observation && observation.worldStateAuthority);
        if (explicit) return explicit;
        if (!observation || typeof observation !== "object") return null;
        if (observation.kind === "action_result" || observation.kind === "action_feedback") return "grounded_result";
        if (observation.kind === "event") {
            const eventType = observation.eventType || observation.data && observation.data.type || null;
            return eventType === "narrative_input" ? "narrative_only" : "grounded_event";
        }
        return null;
    }

    function eventAuthority(event) {
        const explicit = normalizedAuthority(event && event.worldStateAuthority);
        if (explicit) return explicit;
        if (!event || typeof event !== "object") return null;
        return event.type === "narrative_input" ? "narrative_only" : "grounded_event";
    }

    function timelapseAuthority(kind, metadata) {
        const explicit = normalizedAuthority(metadata && metadata.worldStateAuthority);
        if (explicit) return explicit;
        if (kind === "timelapse_narrate" || kind === "timelapse_interaction") return "narrative_only";
        return "grounded_result";
    }

    function recordWithAuthority(record, world) {
        const projected = clone(record);
        if (!projected || typeof projected !== "object") return projected;
        const explicit = normalizedAuthority(projected.worldStateAuthority);
        if (explicit) {
            projected.worldStateAuthority = explicit;
            return projected;
        }
        if (projected.kind === "narrative_input" || projected.kind === "timelapse_narrate" || projected.kind === "timelapse_interaction") {
            projected.worldStateAuthority = "narrative_only";
            return projected;
        }
        if (projected.kind === "action_result" || projected.kind === "action_feedback" || String(projected.kind || "").startsWith("timelapse_")) {
            projected.worldStateAuthority = "grounded_result";
            return projected;
        }
        if (Number.isInteger(projected.sourceEventId)) {
            const sourceEvent = ((world && world.events) || []).find(function (event) { return event && event.id === projected.sourceEventId; }) || null;
            if (sourceEvent && sourceEvent.type) {
                projected.worldStateAuthority = sourceEvent.type === "narrative_input" ? "narrative_only" : "grounded_event";
            }
        }
        return projected;
    }

    function compactRecord(record) {
        const output = {
            id: String(record.id),
            turn: record.turn,
            kind: String(record.kind || "observation"),
            text: String(record.text || "").trim()
        };
        ["actorId", "targetId"].forEach(function (key) { if (record[key]) output[key] = String(record[key]); });
        const authority = normalizedAuthority(record.worldStateAuthority);
        if (authority) output.worldStateAuthority = authority;
        if (Number.isInteger(record.interactionId) && record.interactionId > 0) output.interactionId = record.interactionId;
        if (Number.isInteger(record.sourceEventId) && record.sourceEventId > 0) output.sourceEventId = record.sourceEventId;
        return output;
    }

    function append(characterId, record, world) {
        world = currentOr(world);
        const actor = I.getCharacter(characterId, world);
        if (!actor || !actor.mind || !Array.isArray(actor.mind.verbatimObservations)) return null;
        const compact = compactRecord(record);
        if (!V.validateVerbatimObservation(compact).ok) return null;
        if (actor.mind.verbatimObservations.some(function (entry) { return entry.id === compact.id; })) return null;
        actor.mind.verbatimObservations.push(compact);
        if (setup.MindAuxExecutor && typeof setup.MindAuxExecutor.noteVerbatimChanged === "function") {
            setup.MindAuxExecutor.noteVerbatimChanged(characterId, world);
        }
        return clone(compact);
    }

    function appendFromObservation(characterId, observation, world) {
        if (!observation || typeof observation !== "object" || typeof observation.text !== "string" || !observation.text.trim()) return null;
        if (observation.kind === "action_result" && observation.data && Array.isArray(observation.data.events) && observation.data.events.length > 0) return null;
        return append(characterId, {
            id: `verbatim_${characterId}_observation_${observation.id}`,
            turn: Number.isInteger(observation.turn) && observation.turn > 0 ? observation.turn : Math.max(1, (world && world.nextEventId || 2) - 1),
            kind: observation.kind || "observation",
            actorId: observation.actorId || null,
            targetId: observation.targetId || null,
            text: observation.text,
            worldStateAuthority: observationAuthority(observation),
            interactionId: observation.interactionId || null,
            sourceEventId: observation.sourceEventId || null
        }, world);
    }

    function appendOwnEvent(characterId, event, world) {
        if (!event || event.actorId !== characterId || typeof event.text !== "string" || !event.text.trim()) return null;
        return append(characterId, {
            id: `verbatim_${characterId}_event_${event.id}`,
            turn: event.id,
            kind: event.type || "event",
            actorId: characterId,
            targetId: event.targetId || null,
            text: event.text,
            worldStateAuthority: eventAuthority(event),
            interactionId: event.interactionId || null,
            sourceEventId: event.id
        }, world);
    }

    function appendTimelapseExperience(characterId, sequenceId, text, metadata, world) {
        metadata = metadata || {};
        return append(characterId, {
            id: `verbatim_${characterId}_timelapse_${String(sequenceId).replace(/[^A-Za-z0-9_-]+/g, "-")}`,
            turn: Number.isInteger(metadata.turn) && metadata.turn > 0 ? metadata.turn : Math.max(1, (world && world.nextEventId || 2) - 1),
            kind: metadata.kind || "timelapse_experience",
            actorId: metadata.actorId || characterId,
            targetId: metadata.targetId || null,
            text: text,
            worldStateAuthority: timelapseAuthority(metadata.kind || "timelapse_experience", metadata),
            interactionId: metadata.interactionId || null,
            sourceEventId: metadata.sourceEventId || null
        }, world);
    }

    setup.VerbatimMemory = {
        append: append,
        appendFromObservation: appendFromObservation,
        appendOwnEvent: appendOwnEvent,
        appendTimelapseExperience: appendTimelapseExperience,
        withWorldStateAuthority: function (record, world) { return recordWithAuthority(record, currentOr(world)); }
    };
}());
