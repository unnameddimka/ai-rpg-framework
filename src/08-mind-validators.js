(function () {
    "use strict";

    const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
    const MEMORY_ID_MAX = 160;
    const CHARACTER_ID_MAX = 160;
    const CANONICAL_TEXT_MAX = 2000;
    const DIALOGUE_TEXT_MAX = 2000;
    const TOPIC_TEXT_MAX = 240;
    const VERBATIM_TEXT_MAX = 3000;
    const RECENT_DIALOGUE_LIMIT = 8;

    function result(ok, message) {
        return ok ? { ok: true } : { ok: false, error: { code: "MIND_RECORD_INVALID", message: message } };
    }

    function textValid(value, maximumLength) {
        const max = Number.isInteger(maximumLength) && maximumLength > 0 ? maximumLength : CANONICAL_TEXT_MAX;
        return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
    }

    function idTextValid(value, maximumLength) {
        const max = Number.isInteger(maximumLength) && maximumLength > 0 ? maximumLength : CHARACTER_ID_MAX;
        return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
    }

    function validUnitInterval(value, strict) {
        return typeof value === "number" && Number.isFinite(value) && (strict ? value > 0 && value < 1 : value >= 0 && value <= 1);
    }

    function validateBeliefRecord(record, options) {
        const opts = options || {};
        const maxTextLength = Number.isInteger(opts.maxTextLength) ? opts.maxTextLength : CANONICAL_TEXT_MAX;
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Belief must be an object.");
        if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) return result(false, "Belief id is invalid.");
        if (!textValid(record.text, maxTextLength)) return result(false, "Belief text is invalid.");
        if (!validUnitInterval(record.confidence, true)) return result(false, "Belief confidence is invalid.");
        if (!validUnitInterval(record.activation, true)) return result(false, "Belief activation is invalid.");
        return result(true);
    }

    function validateRelationshipRecord(record, actorId, world, options) {
        const opts = options || {};
        const maxSummaryLength = Number.isInteger(opts.maxSummaryLength) ? opts.maxSummaryLength : CANONICAL_TEXT_MAX;
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Relationship must be an object.");
        if (!idTextValid(record.targetCharacterId, CHARACTER_ID_MAX)) return result(false, "Relationship target character id is invalid.");
        if (actorId && record.targetCharacterId === actorId) return result(false, "Relationship cannot target self.");
        if (!textValid(record.summary, maxSummaryLength)) return result(false, "Relationship summary is invalid.");
        if (opts.requireTargetExists) {
            const target = world && world.entities && world.entities[record.targetCharacterId];
            if (!target || target.type !== "character") return result(false, "Relationship target character does not exist.");
        }
        return result(true);
    }

    function validateMemoryRecord(record, options) {
        const opts = options || {};
        const maxSummaryLength = Number.isInteger(opts.maxSummaryLength) ? opts.maxSummaryLength : CANONICAL_TEXT_MAX;
        const requireTopic = opts.requireTopic !== false;
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Memory must be an object.");
        if (!idTextValid(record.id, MEMORY_ID_MAX)) return result(false, "Memory id is invalid.");
        if (requireTopic && !textValid(record.topic, TOPIC_TEXT_MAX)) return result(false, "Memory topic is invalid.");
        if (!textValid(record.summary, maxSummaryLength)) return result(false, "Memory summary is invalid.");
        if (!validUnitInterval(record.importance, false)) return result(false, "Memory importance is invalid.");
        if (typeof record.protected !== "boolean") return result(false, "Memory protected flag is invalid.");
        return result(true);
    }

    function validateVerbatimObservation(record, options) {
        const opts = options || {};
        const maxTextLength = Number.isInteger(opts.maxTextLength) ? opts.maxTextLength : VERBATIM_TEXT_MAX;
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Verbatim observation must be an object.");
        if (!idTextValid(record.id, MEMORY_ID_MAX)) return result(false, "Verbatim observation id is invalid.");
        if (!Number.isInteger(record.turn) || record.turn < 1) return result(false, "Verbatim observation turn is invalid.");
        if (!textValid(record.kind, 120)) return result(false, "Verbatim observation kind is invalid.");
        if (!textValid(record.text, maxTextLength)) return result(false, "Verbatim observation text is invalid.");
        for (const key of ["actorId", "targetId"]) {
            if (record[key] !== undefined && record[key] !== null && !idTextValid(record[key], CHARACTER_ID_MAX)) return result(false, `Verbatim observation ${key} is invalid.`);
        }
        if (record.interactionId !== undefined && record.interactionId !== null && (!Number.isInteger(record.interactionId) || record.interactionId < 1)) {
            return result(false, "Verbatim observation interaction id is invalid.");
        }
        if (record.sourceEventId !== undefined && record.sourceEventId !== null && (!Number.isInteger(record.sourceEventId) || record.sourceEventId < 1)) {
            return result(false, "Verbatim observation source event id is invalid.");
        }
        return result(true);
    }

    function validateRecentDialogueRecord(record, world, options) {
        const opts = options || {};
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Recent dialogue entry must be an object.");
        if (!idTextValid(record.speakerId, CHARACTER_ID_MAX)) return result(false, "Recent dialogue speaker id is invalid.");
        if (!textValid(record.text, DIALOGUE_TEXT_MAX)) return result(false, "Recent dialogue text is invalid.");
        if (record.turn !== undefined && record.turn !== null && (!Number.isInteger(record.turn) || record.turn < 1)) return result(false, "Recent dialogue turn is invalid.");
        if (record.interactionId !== undefined && record.interactionId !== null && (!Number.isInteger(record.interactionId) || record.interactionId < 1)) return result(false, "Recent dialogue interaction id is invalid.");
        if (opts.requireSpeakerExists) {
            const speaker = world && world.entities && world.entities[record.speakerId];
            if (!speaker || speaker.type !== "character") return result(false, "Recent dialogue speaker does not exist.");
        }
        return result(true);
    }

    function sanitizeRecentDialogue(records, world) {
        const source = Array.isArray(records) ? records : [];
        return source.filter(function (record) {
            return validateRecentDialogueRecord(record, world, { requireSpeakerExists: false }).ok;
        }).slice(-RECENT_DIALOGUE_LIMIT).map(function (record) {
            return {
                speakerId: record.speakerId,
                text: record.text.trim(),
                turn: Number.isInteger(record.turn) && record.turn > 0 ? record.turn : null,
                interactionId: Number.isInteger(record.interactionId) && record.interactionId > 0 ? record.interactionId : null
            };
        });
    }

    setup.MindValidators = {
        ID_PATTERN: ID_PATTERN,
        CANONICAL_TEXT_MAX: CANONICAL_TEXT_MAX,
        RECENT_DIALOGUE_LIMIT: RECENT_DIALOGUE_LIMIT,
        validateBeliefRecord: validateBeliefRecord,
        validateRelationshipRecord: validateRelationshipRecord,
        validateMemoryRecord: validateMemoryRecord,
        validateVerbatimObservation: validateVerbatimObservation,
        validateRecentDialogueRecord: validateRecentDialogueRecord,
        sanitizeRecentDialogue: sanitizeRecentDialogue
    };
}());
