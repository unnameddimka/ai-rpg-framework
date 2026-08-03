(function () {
    "use strict";

    let inFlight = false;
    setup.AITransientDebug = {
        lastContext: null, lastMessages: null, lastRawContent: "", lastParsedResponse: null,
        lastUsage: null, lastSafeError: ""
    };

    function log(controllerId, actorId, message) {
        setup.Game.logController({
            controllerId: controllerId,
            actorId: actorId,
            message: message
        });
    }

    setup.Controllers = {
        human: {
            id: "human",

            takeTurn: function (actorId) {
                log("human", actorId, "Waiting for browser input.");
                return {
                    ok: true,
                    waitingForHumanInput: true,
                    actions: []
                };
            },

            onEvent: function (actorId, event) {
                log("human", actorId, `Observed event ${event.id}: ${event.type}.`);
                return { processed: true, actions: [] };
            }
        },

        dummy: {
            id: "dummy",

            takeTurn: function (actorId) {
                log("dummy", actorId, "DummyController took no action.");
                return { ok: true, actions: [] };
            },

            onEvent: function (actorId, event) {
                log("dummy", actorId, `Ignored event ${event.id}: ${event.type}.`);
                return { processed: true, actions: [] };
            }
        },

        ai: {
            id: "ai",
            implemented: true,

            takeTurn: function (actorId, client) {
                return takeQueuedTurn(actorId, client || setup.OpenRouterClient);
            },

            onEvent: function (actorId, event) {
                log("ai", actorId, `Queued event ${event.id} for a manual AI turn.`);
                return { processed: false, actions: [] };
            }
        }
    };

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function combineNarrative(parts) {
        const text = [];
        for (const part of parts) {
            if (part.publicNarrative && part.publicNarrative.trim()) text.push(part.publicNarrative.trim());
            if (part.spokenText && part.spokenText.trim()) text.push(`"${part.spokenText.trim()}"`);
        }
        return text.join("\n");
    }
    function recordFailure(error) {
        const safe = error && error.code && error.message ? error.message : "Unexpected AI turn failure.";
        setup.AITransientDebug.lastSafeError = safe;
        return { ok: false, error: { code: error && error.code || "AI_TURN_FAILED", message: safe } };
    }
    function commitResponse(actorId, responses, consumedIds) {
        const finalResponse = responses[responses.length - 1];
        const memoryResult = setup.AIMemory.applyUpdates(actorId, finalResponse.memoryUpdates);
        if (!memoryResult.ok) throw memoryResult.error;
        const narrativeText = combineNarrative(responses);
        if (narrativeText) {
            const narrativeResult = setup.CharacterAPI.narrate(actorId, { text: narrativeText, noticeability: "noticeable" });
            if (!narrativeResult.ok) throw narrativeResult.error;
        }
        const consumeResult = setup.AIMemory.consumeObservations(actorId, consumedIds);
        if (!consumeResult.ok) throw consumeResult.error;
        setup.AITurnQueue.remove(actorId);
        const actor = setup.Game.getWorld().entities[actorId];
        if (actor.mind.pendingObservations.length > 0) setup.AITurnQueue.enqueue(actorId, "remaining_observations");
        const validation = setup.Game.validateWorld();
        if (!validation.ok) throw validation.error;
        return { narrativeText: narrativeText };
    }

    async function takeQueuedTurn(expectedActorId, client) {
        if (inFlight) return recordFailure({ code: "AI_TURN_IN_FLIGHT", message: "An AI turn is already in progress." });
        const status = setup.AITurnQueue.getStatus();
        if (!status.head) return recordFailure({ code: "AI_QUEUE_EMPTY", message: "No pending AI turns." });
        if (expectedActorId && expectedActorId !== status.head.characterId) return recordFailure({ code: "AI_QUEUE_HEAD_CHANGED", message: "The queued AI character changed." });
        const actorId = status.head.characterId;
        const before = JSON.stringify(setup.Game.getWorld());
        inFlight = true;
        setup.AITransientDebug.lastSafeError = "";
        try {
            const actor = setup.Game.getWorld().entities[actorId];
            const observations = clone(actor.mind.pendingObservations.slice(0, 50));
            const originalIds = observations.map(function (item) { return item.id; });
            const context = setup.ContextBuilder.build(actorId);
            context.mind.pendingObservations = clone(observations);
            const decisionMessages = setup.AIProtocol.decisionMessages(context, observations);
            setup.AITransientDebug.lastContext = clone(context);
            setup.AITransientDebug.lastMessages = clone(decisionMessages);
            const decisionResult = await setup.AIProtocol.requestValidated(decisionMessages, "decision", context.availableActions, client);
            if (!decisionResult.ok) throw decisionResult.error;
            setup.AITransientDebug.lastRawContent = decisionResult.rawContent;
            setup.AITransientDebug.lastParsedResponse = clone(decisionResult.value);
            setup.AITransientDebug.lastUsage = decisionResult.usage || null;
            const decision = decisionResult.value;
            if (decision.action === null) {
                const committed = commitResponse(actorId, [decision], originalIds);
                log("ai", actorId, "Completed one manual no-action AI turn.");
                return { ok: true, actorId: actorId, stages: 1, narrativeText: committed.narrativeText, usage: decisionResult.usage || null };
            }

            const idsBeforeAction = new Set(actor.mind.pendingObservations.map(function (item) { return item.id; }));
            const actionResult = setup.CharacterAPI.perform(actorId, clone(decision.action));
            const actorAfterAction = setup.Game.getWorld().entities[actorId];
            const actionFeedbackIds = actorAfterAction.mind.pendingObservations.filter(function (item) {
                return !idsBeforeAction.has(item.id) && item.kind === "action_feedback";
            }).map(function (item) { return item.id; });
            const resultMessages = setup.AIProtocol.resultMessages(context, observations, decision.action, actionResult);
            setup.AITransientDebug.lastMessages = clone(resultMessages);
            const finalResult = await setup.AIProtocol.requestValidated(resultMessages, "result", context.availableActions, client);
            if (!finalResult.ok) throw finalResult.error;
            setup.AITransientDebug.lastRawContent = finalResult.rawContent;
            setup.AITransientDebug.lastParsedResponse = clone(finalResult.value);
            setup.AITransientDebug.lastUsage = finalResult.usage || decisionResult.usage || null;
            const committed = commitResponse(actorId, [decision, finalResult.value], originalIds.concat(actionFeedbackIds));
            log("ai", actorId, "Completed one grounded manual AI turn.");
            return { ok: true, actorId: actorId, stages: 2, actionResult: clone(actionResult), narrativeText: committed.narrativeText, usage: setup.AITransientDebug.lastUsage };
        } catch (error) {
            State.variables.world = JSON.parse(before);
            return recordFailure(error);
        } finally {
            inFlight = false;
        }
    }

    setup.AIController = {
        takeNextTurn: function (client) { const head = setup.AITurnQueue.peek(); return takeQueuedTurn(head && head.characterId, client || setup.OpenRouterClient); },
        isInFlight: function () { return inFlight; },
        clearDebug: function () { setup.AITransientDebug.lastContext = null; setup.AITransientDebug.lastMessages = null; setup.AITransientDebug.lastRawContent = ""; setup.AITransientDebug.lastParsedResponse = null; setup.AITransientDebug.lastUsage = null; setup.AITransientDebug.lastSafeError = ""; }
    };
}());
