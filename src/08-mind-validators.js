(function () {
    "use strict";

    const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
    const MEMORY_ID_MAX = 160;
    const CHARACTER_ID_MAX = 160;
    const CANONICAL_TEXT_MAX = 2000;
    const DIALOGUE_TEXT_MAX = 2000;
    const TOPIC_TEXT_MAX = 240;
    const RETRIEVAL_BRIEF_MAX = 600;
    const VERBATIM_TEXT_MAX = 3000;
    const RECENT_DIALOGUE_LIMIT = 8;
    const EPISTEMIC_SOURCE_TYPES = ["formal_fact", "direct_observation", "heard_speech", "own_speech"];

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


    function normalizeEpistemicSources(value) {
        if (!Array.isArray(value)) return value;
        const seen = new Set();
        const output = [];
        value.forEach(function (entry) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) { output.push(entry); return; }
            const type = entry.type;
            const normalized = { type: type };
            if (Object.prototype.hasOwnProperty.call(entry, "sourceCharacterId")) normalized.sourceCharacterId = entry.sourceCharacterId;
            Object.keys(entry).forEach(function (key) {
                if (key !== "type" && key !== "sourceCharacterId") normalized[key] = entry[key];
            });
            const key = JSON.stringify(normalized);
            if (seen.has(key)) return;
            seen.add(key);
            output.push(normalized);
        });
        return output;
    }

    function validateEpistemicSources(value, options) {
        const opts = options || {};
        if (!Array.isArray(value) || value.length < 1 || value.length > 16) return result(false, "Epistemic sources must be a non-empty array of at most 16 descriptors.");
        const seen = new Set();
        for (const entry of value) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry) || !EPISTEMIC_SOURCE_TYPES.includes(entry.type)) {
                return result(false, "Epistemic source descriptor is invalid.");
            }
            const speech = entry.type === "heard_speech" || entry.type === "own_speech";
            const keys = Object.keys(entry).sort();
            const expected = speech ? ["sourceCharacterId", "type"] : ["type"];
            if (keys.length !== expected.length || !keys.every(function (key, index) { return key === expected[index]; })) {
                return result(false, "Epistemic source descriptor has invalid fields.");
            }
            if (speech && !idTextValid(entry.sourceCharacterId, CHARACTER_ID_MAX)) return result(false, "Epistemic speech source character id is invalid.");
            if (speech && opts.requireSourceCharacterExists) {
                const world = opts.world;
                const character = world && world.entities && world.entities[entry.sourceCharacterId];
                const sourceIds = Array.isArray(opts.sourceCharacterIds) ? new Set(opts.sourceCharacterIds) : null;
                if ((!character || character.type !== "character") && (!sourceIds || !sourceIds.has(entry.sourceCharacterId))) return result(false, "Epistemic speech source character does not exist.");
            }
            const key = JSON.stringify(entry);
            if (seen.has(key)) return result(false, "Epistemic source descriptors must be unique.");
            seen.add(key);
        }
        return result(true);
    }

    function validateEpistemicParts(value, options) {
        const opts = options || {};
        if (!Array.isArray(value) || value.length < 1 || value.length > 16) return result(false, "Epistemic parts must be a non-empty array of at most 16 parts.");
        for (const part of value) {
            if (!part || typeof part !== "object" || Array.isArray(part) || !EPISTEMIC_SOURCE_TYPES.includes(part.type) || !textValid(part.text, VERBATIM_TEXT_MAX)) {
                return result(false, "Epistemic part is invalid.");
            }
            const speech = part.type === "heard_speech" || part.type === "own_speech";
            const allowed = speech ? new Set(["type", "sourceCharacterId", "text"]) : new Set(["type", "actorId", "text"]);
            if (Object.keys(part).some(function (key) { return !allowed.has(key); })) return result(false, "Epistemic part has invalid fields.");
            if (speech) {
                if (!idTextValid(part.sourceCharacterId, CHARACTER_ID_MAX)) return result(false, "Epistemic part speech source character id is invalid.");
                if (opts.requireSourceCharacterExists) {
                    const world = opts.world;
                    const character = world && world.entities && world.entities[part.sourceCharacterId];
                    const sourceIds = Array.isArray(opts.sourceCharacterIds) ? new Set(opts.sourceCharacterIds) : null;
                    if ((!character || character.type !== "character") && (!sourceIds || !sourceIds.has(part.sourceCharacterId))) return result(false, "Epistemic part speech source character does not exist.");
                }
            } else if (part.actorId !== undefined && part.actorId !== null && !idTextValid(part.actorId, CHARACTER_ID_MAX)) {
                return result(false, "Epistemic part actor id is invalid.");
            }
        }
        return result(true);
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

    function retrievalBriefValid(value, options) {
        const opts = options || {};
        if (typeof value !== "string" || value.length > RETRIEVAL_BRIEF_MAX) return false;
        if (opts.requireNonEmpty === true && value.trim().length === 0) return false;
        return true;
    }

    function validateMemoryRecord(record, options) {
        const opts = options || {};
        const maxSummaryLength = Number.isInteger(opts.maxSummaryLength) ? opts.maxSummaryLength : CANONICAL_TEXT_MAX;
        const requireTopic = opts.requireTopic !== false;
        if (!record || typeof record !== "object" || Array.isArray(record)) return result(false, "Memory must be an object.");
        if (!idTextValid(record.id, MEMORY_ID_MAX)) return result(false, "Memory id is invalid.");
        if (requireTopic && !textValid(record.topic, TOPIC_TEXT_MAX)) return result(false, "Memory topic is invalid.");
        if (!textValid(record.summary, maxSummaryLength)) return result(false, "Memory summary is invalid.");
        if (record.retrievalBrief !== undefined && !retrievalBriefValid(record.retrievalBrief)) return result(false, "Memory retrieval brief is invalid.");
        if (!validUnitInterval(record.importance, false)) return result(false, "Memory importance is invalid.");
        if (typeof record.protected !== "boolean") return result(false, "Memory protected flag is invalid.");
        if (record.epistemicSources !== undefined) {
            if (opts.allowEpistemicSources === false) return result(false, "Epistemic sources are not allowed on this memory partition.");
            const validation = validateEpistemicSources(record.epistemicSources, opts);
            if (!validation.ok) return validation;
        }
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
        if (record.worldStateAuthority !== undefined && record.worldStateAuthority !== null &&
                !["narrative_only", "grounded_event", "grounded_result"].includes(record.worldStateAuthority)) {
            return result(false, "Verbatim observation world-state authority is invalid.");
        }
        if (record.epistemicParts !== undefined) {
            const validation = validateEpistemicParts(record.epistemicParts, opts);
            if (!validation.ok) return validation;
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
        RETRIEVAL_BRIEF_MAX: RETRIEVAL_BRIEF_MAX,
        RECENT_DIALOGUE_LIMIT: RECENT_DIALOGUE_LIMIT,
        EPISTEMIC_SOURCE_TYPES: Object.freeze(EPISTEMIC_SOURCE_TYPES.slice()),
        normalizeEpistemicSources: normalizeEpistemicSources,
        validateEpistemicSources: validateEpistemicSources,
        validateEpistemicParts: validateEpistemicParts,
        retrievalBriefValid: retrievalBriefValid,
        validateBeliefRecord: validateBeliefRecord,
        validateRelationshipRecord: validateRelationshipRecord,
        validateMemoryRecord: validateMemoryRecord,
        validateVerbatimObservation: validateVerbatimObservation,
        validateRecentDialogueRecord: validateRecentDialogueRecord,
        sanitizeRecentDialogue: sanitizeRecentDialogue
    };
}());
