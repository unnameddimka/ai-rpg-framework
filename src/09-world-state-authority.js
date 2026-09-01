(function () {
    "use strict";

    const ALLOWED = Object.freeze(["narrative_only", "grounded_event", "grounded_result"]);

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function normalize(value) {
        return ALLOWED.includes(value) ? value : null;
    }

    function forObservation(observation) {
        const explicit = normalize(observation && observation.worldStateAuthority);
        if (explicit) return explicit;
        if (!observation || typeof observation !== "object") return null;
        if (observation.kind === "action_result" || observation.kind === "action_feedback") return "grounded_result";
        if (observation.kind === "event") {
            const eventType = observation.eventType || observation.data && observation.data.type || null;
            return eventType === "narrative_input" ? "narrative_only" : "grounded_event";
        }
        return null;
    }

    function forEvent(event) {
        const explicit = normalize(event && event.worldStateAuthority);
        if (explicit) return explicit;
        if (!event || typeof event !== "object") return null;
        return event.type === "narrative_input" ? "narrative_only" : "grounded_event";
    }

    function forTimelapse(kind, metadata) {
        const explicit = normalize(metadata && metadata.worldStateAuthority);
        if (explicit) return explicit;
        if (kind === "timelapse_narrate" || kind === "timelapse_interaction") return "narrative_only";
        return "grounded_result";
    }

    function withRecordAuthority(record, world) {
        const projected = clone(record);
        if (!projected || typeof projected !== "object") return projected;
        const explicit = normalize(projected.worldStateAuthority);
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
            if (sourceEvent && sourceEvent.type) projected.worldStateAuthority = forEvent(sourceEvent);
        }
        return projected;
    }

    setup.WorldStateAuthority = Object.freeze({
        VALUES: ALLOWED,
        normalize: normalize,
        forObservation: forObservation,
        forEvent: forEvent,
        forTimelapse: forTimelapse,
        withRecordAuthority: withRecordAuthority
    });
}());
