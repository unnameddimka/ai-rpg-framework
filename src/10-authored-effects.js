(function () {
    "use strict";

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

    function createObservationEventData(effect, context) {
        context = context && typeof context === "object" ? context : {};
        return {
            type: context.eventType || "authored_effect_observed",
            actorId: effect && effect.actorCharacterId || context.actorId || "",
            locationId: effect && effect.locationId || context.locationId || null,
            sublocationId: effect && effect.sublocationId || context.sublocationId || null,
            noticeability: effect && effect.noticeability || context.noticeability || "noticeable",
            text: effect && typeof effect.text === "string" ? effect.text : String(context.text || ""),
            authoredEffectType: "emit_observation"
        };
    }

    function emitObservationEventData(eventData, world) {
        if (!eventData || typeof eventData.text !== "string" || !eventData.text.trim()) {
            return { ok: false, error: { code: "AUTHORED_OBSERVATION_INVALID", message: "Authored observation text is required." } };
        }
        if (!setup.EventPerception || typeof setup.EventPerception.emitEvent !== "function") {
            return { ok: false, error: { code: "PERCEPTION_UNAVAILABLE", message: "Event perception is unavailable." } };
        }
        const clean = clone(eventData);
        delete clean.authoredEffectType;
        const event = setup.EventPerception.emitEvent(clean, world);
        return {
            ok: true,
            event: clone(event),
            recipientIds: Array.isArray(event && event.recipients) ? event.recipients.slice() : []
        };
    }

    function emitObservation(effect, context, world) {
        return emitObservationEventData(createObservationEventData(effect, context), world);
    }

    setup.AuthoredEffects = {
        createObservationEventData: createObservationEventData,
        emitObservationEventData: emitObservationEventData,
        emitObservation: emitObservation
    };
}());
