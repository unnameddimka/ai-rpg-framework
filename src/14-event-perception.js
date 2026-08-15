(function () {
    "use strict";

    const I = setup.GameInternals;
    const DIALOGUE_LIMIT = setup.MindValidators.RECENT_DIALOGUE_LIMIT;
    const FORBIDDEN_MODEL_KEYS = new Set([
        "recipients", "pendingFor", "processedBy", "sourceControllerId", "controllerId",
        "providerResponse", "authorization", "apiKey", "turnQueue"
    ]);

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }

    function worldOrCurrent(world) {
        return world || I.ensureWorld();
    }

    function getCharacter(characterId, world) {
        return I.getCharacter(characterId, world);
    }

    function getCharacters(world) {
        return I.getCharacters(world);
    }

    function recipientsForEvent(event, world) {
        world = worldOrCurrent(world);
        if (event.noticeability === "hidden") return event.targetId ? [event.targetId] : [];

        if (event.type === "character_moved") {
            const visibleLocationIds = new Set([event.fromLocationId, event.toLocationId].filter(Boolean));
            return getCharacters(world).filter(function (character) {
                return character.id !== event.actorId && visibleLocationIds.has(character.locationId);
            }).map(function (character) { return character.id; });
        }

        if (event.type === "passage_interaction_attempted") {
            const locationIds = new Set([event.sourceLocationId, event.destinationLocationId].filter(Boolean));
            return getCharacters(world).filter(function (character) {
                return character.id !== event.actorId && locationIds.has(character.locationId);
            }).map(function (character) { return character.id; });
        }

        return getCharacters(world).filter(function (character) {
            return character.id !== event.actorId && character.locationId === event.locationId;
        }).map(function (character) { return character.id; });
    }

    function appendDialogue(recipientId, speakerId, text, turn, interactionId, world) {
        if (typeof text !== "string" || !text.trim()) return null;
        const recipient = getCharacter(recipientId, world);
        if (!recipient) return null;
        if (!Array.isArray(recipient.recentDialogue)) recipient.recentDialogue = [];
        recipient.recentDialogue.push({
            speakerId: speakerId,
            text: text.trim(),
            turn: Number.isInteger(turn) && turn > 0 ? turn : null,
            interactionId: Number.isInteger(interactionId) && interactionId > 0 ? interactionId : null
        });
        recipient.recentDialogue = setup.MindValidators.sanitizeRecentDialogue(recipient.recentDialogue, world).slice(-DIALOGUE_LIMIT);
        return recipient.recentDialogue[recipient.recentDialogue.length - 1] || null;
    }

    function semanticEventData(event) {
        const copyFields = [
            "type", "locationId", "fromLocationId", "toLocationId", "fromSublocationId", "toSublocationId",
            "destinationId", "sourceLocationId", "destinationLocationId", "lockId", "itemId", "definitionId",
            "sourceInventoryId", "targetInventoryId", "amount", "interactionId", "actionType", "code"
        ];
        const data = {};
        copyFields.forEach(function (field) {
            if (event[field] !== undefined && event[field] !== null && event[field] !== "") data[field] = clone(event[field]);
        });
        return data;
    }

    function eventProjectionForRecipient(event, recipientId, world) {
        const projection = {
            id: event.id,
            type: event.type,
            actorId: event.actorId || null,
            targetId: event.targetId || null,
            locationId: event.locationId || null,
            noticeability: event.noticeability || "noticeable",
            text: event.text || "",
            interactionId: event.interactionId || null,
            sourceControllerId: event.sourceControllerId || null
        };
        Object.assign(projection, semanticEventData(event));

        if (event.type === "passage_interaction_attempted") {
            const recipient = getCharacter(recipientId, world);
            const onFarSide = Boolean(recipient && recipient.locationId === event.destinationLocationId);
            if (onFarSide) {
                projection.actorId = null;
                projection.targetId = null;
                projection.text = event.farSideText || "Someone tried the door from the other side.";
                delete projection.sourceControllerId;
            } else {
                projection.text = event.sourceSideText || event.text || "Someone tried the locked passage.";
            }
        }
        return projection;
    }

    function enqueueObservation(recipientId, observation, world) {
        world = worldOrCurrent(world);
        const recipient = getCharacter(recipientId, world);
        if (!recipient) return null;
        const record = Object.assign({ id: world.nextObservationId++ }, clone(observation));
        recipient.mind.pendingObservations.push(record);
        if (world.control.assignments[recipientId] === "ai") I.enqueueAITurn(recipientId, observation.kind || "observation", world);
        return record;
    }

    function routeFeedback(feedback, action, world, metadata) {
        world = worldOrCurrent(world);
        for (const entry of feedback || []) {
            enqueueObservation(entry.recipientId, {
                kind: "action_feedback",
                actionType: action.type,
                turn: world.nextEventId,
                actorId: entry.recipientId,
                targetId: entry.data && entry.data.targetId ? entry.data.targetId : null,
                text: entry.text,
                data: clone(entry.data || {}),
                code: entry.code,
                interactionId: metadata && metadata.interactionId || null
            }, world);
        }
    }

    function eventById(eventId, world) {
        return (world.events || []).find(function (candidate) { return candidate.id === eventId; }) || null;
    }

    function acknowledgeEvent(eventId, characterId, world) {
        world = worldOrCurrent(world);
        const event = eventById(eventId, world);
        if (!event) return fail("EVENT_NOT_FOUND", "Event does not exist.");
        if (!Array.isArray(event.processedBy)) event.processedBy = [];
        if (!event.processedBy.includes(characterId)) event.processedBy.push(characterId);
        return ok();
    }

    function acknowledgeConsumedObservations(characterId, observations, world) {
        world = worldOrCurrent(world);
        (observations || []).forEach(function (observation) {
            if (Number.isInteger(observation && observation.sourceEventId)) {
                const event = eventById(observation.sourceEventId, world);
                if (event) acknowledgeEvent(event.id, characterId, world);
            }
        });
        return ok();
    }

    function dispatchEvent(event, world) {
        world = worldOrCurrent(world);
        if (!setup.Controllers) return;
        for (const characterId of event.recipients || []) {
            const controllerId = world.control.assignments[characterId];
            const controller = setup.Controllers[controllerId];
            if (!controller || typeof controller.onEvent !== "function") continue;
            try {
                const delivered = eventProjectionForRecipient(event, characterId, world);
                const result = controller.onEvent(characterId, clone(delivered));
                if (result && result.processed) acknowledgeEvent(event.id, characterId, world);
            } catch (error) {
                I.pushDebugLog(world, {
                    controllerId: controllerId,
                    actorId: characterId,
                    message: `Controller event error: ${error.message}`
                });
            }
        }
    }

    function emitEvent(eventData, world) {
        world = worldOrCurrent(world);
        const event = Object.assign({
            id: world.nextEventId++,
            targetId: "",
            noticeability: "noticeable",
            text: "",
            processedBy: []
        }, clone(eventData || {}));
        if (!event.sourceControllerId && event.actorId && world.control.assignments[event.actorId]) {
            event.sourceControllerId = world.control.assignments[event.actorId];
        }
        event.recipients = recipientsForEvent(event, world);
        world.events.push(event);

        const observationRecipients = event.recipients.slice();
        if (event.targetId && observationRecipients.includes(event.targetId)) {
            observationRecipients.splice(observationRecipients.indexOf(event.targetId), 1);
            observationRecipients.unshift(event.targetId);
        }
        for (const recipientId of observationRecipients) {
            const delivered = eventProjectionForRecipient(event, recipientId, world);
            enqueueObservation(recipientId, {
                kind: "event",
                sourceEventId: event.id,
                eventType: event.type,
                turn: event.id,
                actorId: delivered.actorId || null,
                targetId: delivered.targetId || null,
                sourceControllerId: delivered.sourceControllerId || null,
                text: delivered.text,
                interactionId: event.interactionId || null,
                data: semanticEventData(delivered)
            }, world);
        }

        if (typeof event.spokenText === "string" && event.spokenText.trim() && event.actorId) {
            appendDialogue(event.actorId, event.actorId, event.spokenText, event.id, event.interactionId, world);
            observationRecipients.forEach(function (recipientId) {
                appendDialogue(recipientId, event.actorId, event.spokenText, event.id, event.interactionId, world);
            });
        }

        if (world.events.length > 200) world.events = world.events.slice(-200);
        dispatchEvent(event, world);
        return event;
    }

    function emitLockedPassageAttempt(actorId, destinationId, world, metadata) {
        world = worldOrCurrent(world);
        const actor = getCharacter(actorId, world);
        const source = actor && world.entities[actor.locationId];
        const destination = world.entities[destinationId];
        if (!actor || !source || source.type !== "location" || !destination || destination.type !== "location") return null;
        const sourceSideText = `${actor.name} tried the locked door to ${destination.name}.`;
        return emitEvent({
            type: "passage_interaction_attempted",
            actorId: actor.id,
            locationId: source.id,
            sourceLocationId: source.id,
            destinationLocationId: destination.id,
            destinationId: destination.id,
            noticeability: "noticeable",
            interactionId: metadata && metadata.interactionId || null,
            text: sourceSideText,
            sourceSideText: sourceSideText,
            farSideText: "Someone tried the door from the other side."
        }, world);
    }

    function getPendingEventsFor(characterId, world) {
        world = worldOrCurrent(world);
        const character = getCharacter(characterId, world);
        if (!character || !character.mind || !Array.isArray(character.mind.pendingObservations)) return [];
        const sourceIds = new Set(character.mind.pendingObservations.map(function (observation) {
            return observation && observation.sourceEventId;
        }).filter(Number.isInteger));
        return (world.events || []).filter(function (event) { return sourceIds.has(event.id); });
    }

    function parseStructuredNarrative(text) {
        const source = typeof text === "string" ? text.trim() : "";
        if (!source) return { text: "", spokenText: "", publicNarrative: "" };
        const speech = [];
        const narrative = [];
        let cursor = 0;
        while (cursor < source.length) {
            const open = source.indexOf("*", cursor);
            if (open < 0) {
                speech.push(source.slice(cursor));
                break;
            }
            const close = source.indexOf("*", open + 1);
            if (close < 0) {
                speech.push(source.slice(cursor));
                break;
            }
            speech.push(source.slice(cursor, open));
            const inner = source.slice(open + 1, close).trim();
            if (inner) narrative.push(inner);
            cursor = close + 1;
        }
        function cleanSpeech(parts) {
            return parts.join(" ").split(/\s+/).filter(Boolean).join(" ").trim();
        }
        return {
            text: source,
            spokenText: cleanSpeech(speech),
            publicNarrative: narrative.join("\n").trim()
        };
    }

    function sanitizeSemanticData(value, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 5) return null;
        if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
        if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) : value;
        if (Array.isArray(value)) return value.slice(0, 64).map(function (item) { return sanitizeSemanticData(item, depth + 1); });
        if (typeof value !== "object") return null;
        const output = {};
        Object.keys(value).forEach(function (key) {
            if (FORBIDDEN_MODEL_KEYS.has(key)) return;
            const sanitized = sanitizeSemanticData(value[key], depth + 1);
            if (sanitized !== undefined) output[key] = sanitized;
        });
        return output;
    }

    function projectObservationForModel(characterId, observation, world) {
        world = worldOrCurrent(world);
        if (!observation || typeof observation !== "object") return null;
        const projected = {};
        ["id", "kind", "eventType", "actionType", "turn", "actorId", "targetId", "text", "interactionId", "code"].forEach(function (key) {
            if (observation[key] !== undefined && observation[key] !== null && observation[key] !== "") projected[key] = clone(observation[key]);
        });
        if (observation.kind === "event") {
            if (!projected.eventType && observation.data && observation.data.type) projected.eventType = observation.data.type;
            const data = sanitizeSemanticData(observation.data || {});
            if (data && Object.keys(data).length) projected.data = data;
        } else if (observation.kind === "action_result") {
            const data = observation.data || {};
            projected.data = sanitizeSemanticData({
                ok: data.ok,
                action: data.action,
                events: Array.isArray(data.events) ? data.events.map(function (event) {
                    const compact = semanticEventData(event || {});
                    compact.text = event && event.text || "";
                    compact.actorId = event && event.actorId || null;
                    compact.targetId = event && event.targetId || null;
                    return compact;
                }) : []
            });
        } else if (observation.data && typeof observation.data === "object") {
            const data = sanitizeSemanticData(observation.data);
            if (data && Object.keys(data).length) projected.data = data;
        }
        return projected;
    }

    function projectObservationsForModel(characterId, observations, world) {
        return (Array.isArray(observations) ? observations : []).map(function (observation) {
            return projectObservationForModel(characterId, observation, world);
        }).filter(Boolean);
    }

    setup.EventPerception = {
        DIALOGUE_LIMIT: DIALOGUE_LIMIT,
        recipientsForEvent: recipientsForEvent,
        eventProjectionForRecipient: eventProjectionForRecipient,
        enqueueObservation: enqueueObservation,
        routeFeedback: routeFeedback,
        acknowledgeEvent: acknowledgeEvent,
        acknowledgeConsumedObservations: acknowledgeConsumedObservations,
        dispatchEvent: dispatchEvent,
        emitEvent: emitEvent,
        emitLockedPassageAttempt: emitLockedPassageAttempt,
        getPendingEventsFor: getPendingEventsFor,
        parseStructuredNarrative: parseStructuredNarrative,
        appendDialogue: appendDialogue,
        projectObservationForModel: projectObservationForModel,
        projectObservationsForModel: projectObservationsForModel,
        sanitizeSemanticData: sanitizeSemanticData
    };
}());
