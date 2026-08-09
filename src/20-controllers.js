(function () {
    "use strict";

    let inFlight = false;
    setup.AITransientDebug = {
        lastContext: null,
        lastMessages: null,
        lastRawContent: "",
        lastParsedResponse: null,
        lastUsage: null,
        lastSafeError: "",
        lastRequest: null,
        lastTrace: null
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
                log("ai", actorId, `Queued event ${event.id} for an AI reaction turn.`);
                return { processed: false, actions: [] };
            }
        }
    };

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function combineNarrative(response) {
        const text = [];
        if (response.publicNarrative && response.publicNarrative.trim()) text.push(response.publicNarrative.trim());
        if (response.spokenText && response.spokenText.trim()) text.push(`"${response.spokenText.trim()}"`);
        return text.join("\n");
    }

    function recordFailure(error) {
        const safe = error && error.code && error.message ? error.message : "Unexpected AI turn failure.";
        setup.AITransientDebug.lastSafeError = safe;
        const normalized = { code: error && error.code || "AI_TURN_FAILED", message: safe };
        if (error && Array.isArray(error.details)) normalized.details = clone(error.details);
        if (error && error.providerResponse) normalized.providerResponse = clone(error.providerResponse);
        return { ok: false, error: normalized };
    }

    function recordProtocolResult(actorId, stage, messages, result) {
        const trace = result && result.trace ? clone(result.trace) : null;
        const attempts = trace && Array.isArray(trace.attempts) ? trace.attempts : [];
        const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
        setup.AITransientDebug.lastRequest = {
            actorId: actorId,
            stage: stage,
            messages: clone(messages)
        };
        setup.AITransientDebug.lastTrace = trace;
        setup.AITransientDebug.lastMessages = clone(messages);
        setup.AITransientDebug.lastRawContent = result && typeof result.rawContent === "string"
            ? result.rawContent
            : (lastAttempt && lastAttempt.rawContent || "");
        setup.AITransientDebug.lastParsedResponse = result && result.value
            ? clone(result.value)
            : (lastAttempt && lastAttempt.parsedValue ? clone(lastAttempt.parsedValue) : null);
        setup.AITransientDebug.lastUsage = result && result.usage
            ? clone(result.usage)
            : (lastAttempt && lastAttempt.usage ? clone(lastAttempt.usage) : null);
    }

    function commitDecision(actorId, decision, consumedIds) {
        const narrativeText = combineNarrative(decision);
        let intentResult = { ok: true, action: decision.action, actionResult: null, narrativeResult: null, narrativeSuppressed: false };
        let actionFailed = false;

        if (decision.action) {
            const currentValidation = setup.CharacterAPI.validateActionRequest(actorId, decision.action);
            if (!currentValidation.ok) {
                const groundedFailure = setup.CharacterAPI.recordGroundedActionFailure(actorId, decision.action, {
                    code: "ACTION_NO_LONGER_AVAILABLE",
                    message: currentValidation.error.message
                });
                intentResult = {
                    ok: true,
                    action: clone(decision.action),
                    actionResult: clone(groundedFailure),
                    narrativeResult: null,
                    narrativeSuppressed: Boolean(narrativeText)
                };
                actionFailed = true;
            }
        }

        if (!actionFailed && (decision.action || narrativeText)) {
            intentResult = setup.CharacterAPI.submitIntent(actorId, {
                text: narrativeText,
                target_id: decision.spokenTargetId || "",
                noticeability: "noticeable",
                action: decision.action
            });
            if (!intentResult.ok) throw intentResult.error;
            actionFailed = Boolean(decision.action && intentResult.actionResult && !intentResult.actionResult.ok);
        }

        if (!actionFailed) {
            const memoryResult = setup.AIMemory.applyUpdates(actorId, decision.memoryUpdates);
            if (!memoryResult.ok) throw memoryResult.error;
        }

        const consumeResult = setup.AIMemory.consumeObservations(actorId, consumedIds);
        if (!consumeResult.ok) throw consumeResult.error;

        setup.AITurnQueue.remove(actorId);
        const actor = setup.Game.getWorld().entities[actorId];
        if (actor.mind.pendingObservations.length > 0) {
            setup.AITurnQueue.enqueue(actorId, "next_reaction_wave");
        }

        const validation = setup.Game.validateWorld();
        if (!validation.ok) throw validation.error;
        const narrativeCommitted = Boolean(intentResult.narrativeResult);
        return {
            narrativeText: narrativeCommitted ? narrativeText : "",
            narrativeSuppressed: Boolean(narrativeText && !narrativeCommitted),
            memorySuppressed: actionFailed,
            intentResult: clone(intentResult),
            actionResult: intentResult.actionResult ? clone(intentResult.actionResult) : null
        };
    }

    async function takeQueuedTurn(expectedActorId, client) {
        if (inFlight) return recordFailure({ code: "AI_TURN_IN_FLIGHT", message: "An AI turn is already in progress." });
        const status = setup.AITurnQueue.getStatus();
        if (!status.head) return recordFailure({ code: "AI_QUEUE_EMPTY", message: "No pending AI turns." });

        const actorId = expectedActorId || status.head.characterId;
        if (!status.entries.some(function (entry) { return entry.characterId === actorId; })) {
            return recordFailure({ code: "AI_QUEUE_ENTRY_MISSING", message: "The requested AI character is no longer queued." });
        }

        const before = JSON.stringify(setup.Game.getWorld());
        inFlight = true;
        setup.AITransientDebug.lastSafeError = "";
        try {
            const request = setup.AITurnScheduler.buildDecisionRequest(actorId);
            if (!request.ok) throw request.error;
            const context = clone(request.context);
            const messages = clone(request.messages);
            const observationIds = clone(request.observationIds);
            setup.AITransientDebug.lastContext = clone(context);
            setup.AITransientDebug.lastMessages = clone(messages);

            const decisionResult = await setup.AIRequestExecutor.execute({
                actorId: actorId,
                purpose: "game-decision",
                messages: messages,
                stage: "decision",
                client: client
            });
            recordProtocolResult(actorId, "decision", messages, decisionResult);
            if (!decisionResult.ok) throw decisionResult.error;

            const committed = commitDecision(actorId, decisionResult.value, observationIds);
            log("ai", actorId, "Completed one single-request AI reaction turn.");
            return {
                ok: true,
                actorId: actorId,
                stages: 1,
                actionResult: committed.actionResult,
                intentResult: committed.intentResult,
                narrativeText: committed.narrativeText,
                narrativeSuppressed: committed.narrativeSuppressed,
                memorySuppressed: committed.memorySuppressed,
                usage: decisionResult.usage || null
            };
        } catch (error) {
            State.variables.world = JSON.parse(before);
            return recordFailure(error);
        } finally {
            inFlight = false;
        }
    }

    setup.AIController = {
        takeNextTurn: function (client) {
            const schedulerHead = setup.AITurnScheduler && setup.AITurnScheduler.getQueueView
                ? setup.AITurnScheduler.getQueueView().head
                : null;
            const fallbackHead = schedulerHead || setup.AITurnQueue.peek();
            return takeQueuedTurn(fallbackHead && fallbackHead.characterId, client || setup.OpenRouterClient);
        },
        takeQueuedTurn: function (characterId, client) {
            return takeQueuedTurn(characterId, client || setup.OpenRouterClient);
        },
        isInFlight: function () {
            return inFlight || Boolean(setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus().busy);
        },
        clearDebug: function () {
            setup.AITransientDebug.lastContext = null;
            setup.AITransientDebug.lastMessages = null;
            setup.AITransientDebug.lastRawContent = "";
            setup.AITransientDebug.lastParsedResponse = null;
            setup.AITransientDebug.lastUsage = null;
            setup.AITransientDebug.lastSafeError = "";
            setup.AITransientDebug.lastRequest = null;
            setup.AITransientDebug.lastTrace = null;
        }
    };
}());
