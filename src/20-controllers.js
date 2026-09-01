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
        if (response.publicNarrative && response.publicNarrative.trim()) {
            const narrative = response.publicNarrative.trim().replace(/\*/g, "");
            if (narrative) text.push(`*${narrative}*`);
        }
        if (response.spokenText && response.spokenText.trim()) text.push(response.spokenText.trim());
        return text.join("\n");
    }

    function recordFailure(error) {
        const safe = error && error.code && error.message ? error.message : "Unexpected AI turn failure.";
        setup.AITransientDebug.lastSafeError = safe;
        const normalized = { code: error && error.code || "AI_TURN_FAILED", message: safe };
        if (error && Array.isArray(error.details)) normalized.details = clone(error.details);
        if (error && Number.isFinite(error.status)) normalized.status = error.status;
        if (error && Number.isFinite(error.retryAfterMs)) normalized.retryAfterMs = error.retryAfterMs;
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


    function normalizedIntimateUpdates(decision) {
        const value = decision && decision.intimateUpdates;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return { enablePartnerIds: [], disablePartnerIds: [], anticipationReplacements: [] };
        }
        return {
            enablePartnerIds: Array.isArray(value.enablePartnerIds) ? value.enablePartnerIds.slice() : [],
            disablePartnerIds: Array.isArray(value.disablePartnerIds) ? value.disablePartnerIds.slice() : [],
            anticipationReplacements: Array.isArray(value.anticipationReplacements) ? clone(value.anticipationReplacements) : []
        };
    }

    function intimateMotivationValidation(value) {
        const errors = [];
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 ||
                !Object.prototype.hasOwnProperty.call(value, "impulse") ||
                !Object.prototype.hasOwnProperty.call(value, "imaginedMoments") ||
                !Object.prototype.hasOwnProperty.call(value, "openAnticipations")) {
            return { ok: false, errors: ["response must contain exactly impulse, imaginedMoments, and openAnticipations."] };
        }
        if (typeof value.impulse !== "string" || !value.impulse.trim() || value.impulse.length > 400) errors.push("impulse must be non-empty text up to 400 characters.");
        [["imaginedMoments", value.imaginedMoments], ["openAnticipations", value.openAnticipations]].forEach(function (entry) {
            const key = entry[0], list = entry[1];
            if (!Array.isArray(list) || list.length !== 2) errors.push(`${key} must contain exactly two entries.`);
            else list.forEach(function (text, index) {
                if (typeof text !== "string" || !text.trim() || text.length > 400) errors.push(`${key}[${index}] must be non-empty text up to 400 characters.`);
            });
        });
        if (errors.length) return { ok: false, errors: errors };
        return { ok: true, value: {
            impulse: value.impulse.trim(),
            imaginedMoments: value.imaginedMoments.map(function (text) { return text.trim(); }),
            openAnticipations: value.openAnticipations.map(function (text) { return text.trim(); })
        } };
    }

    async function generateIntimateMotivation(actorId, partnerId, observations, client) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        const partner = world.entities[partnerId];
        if (!actor || actor.type !== "character" || !partner || partner.type !== "character") {
            return { ok: false, error: { code: "INTIMATE_PARTNER_INVALID", message: "Intimate motivation generation references a missing character." } };
        }
        if (actor.adult === false || partner.adult === false) {
            return { ok: false, error: { code: "INTIMATE_MINOR_NOT_ALLOWED", message: "Intimate mode requires both characters to be adults." } };
        }
        if (!setup.MindSemanticRetrieval || typeof setup.MindSemanticRetrieval.select !== "function") {
            return { ok: false, error: { code: "INTIMATE_RETRIEVAL_UNAVAILABLE", message: "Semantic retrieval is unavailable for intimate-mode activation." } };
        }
        const retrieval = await setup.MindSemanticRetrieval.select(actorId, observations || [], client || setup.OpenRouterClient, {
            intimateFocus: { partnerId: partnerId, partnerName: partner.name, purpose: "Generate structured private intimate motivation for this directed adult partner context." }
        });
        if (!retrieval || !retrieval.ok) return retrieval || { ok: false, error: { code: "INTIMATE_RETRIEVAL_FAILED", message: "Intimate memory retrieval failed." } };
        const context = setup.ContextBuilder.build(actorId, { pendingObservations: observations || [], mindSelection: retrieval.selection });
        if (!context || context.ok === false) return context;
        context.intimateGeneration = {
            partner: { id: partner.id, name: partner.name, playerDescription: partner.playerDescription || "" },
            instruction: "Create one proactive impulse, two desired imagined moments, and two open anticipations for this character toward this partner."
        };
        const messages = [{
            role: "system",
            content: [
                "You are generating private motivational state for one adult fictional Character in a romantic or otherwise intimate encounter. The engine contains no explicit sexual mechanics; this is generic private motivation and imagination, not a formal action script.",
                "Use only the supplied grounded scene, character identity, relationship state, beliefs, selected full memories, recent context, and existing intimate contexts.",
                "Return exactly three fields: impulse, imaginedMoments, openAnticipations.",
                "impulse is exactly one concrete character-owned proactive drive for the near development of the scene: something this character wants to do, initiate, cause, try, or steer toward. It is not merely something the partner should do and it is not a multi-step action queue.",
                "imaginedMoments contains exactly two concrete possible future scene-images this character currently wants to realize or move toward. They are private imagined possibilities, not objective future facts, guaranteed goals, or formal engine actions.",
                "openAnticipations contains exactly two other free-form current anticipations: hoped-for reactions, sensations, discoveries, emotional results, additional impulses, imagined moments, or other scene-specific concerns.",
                "Keep the five motivational elements semantically distinct when possible. Prefer concrete scene-relevant content. Do not collapse them into generic variations of deepen trust, feel closer, strengthen the bond, feel safe, or feel connected.",
                "Do not write objective claims about the partner's private mind. Return one JSON object only with no extra keys."
            ].join(" ")
        }, {
            role: "user",
            content: JSON.stringify({ context: context, requiredResponseShape: { impulse: "", imaginedMoments: ["", ""], openAnticipations: ["", ""] } })
        }];
        const result = await setup.AIRequestExecutor.executeCustom({
            actorId: actorId,
            purpose: "intimate-anticipations",
            stage: "intimate-anticipations",
            messages: clone(messages),
            requestOptions: setup.AIRequestProfiles.resolve("intimate-anticipations", { actorId: actorId }),
            client: client || setup.OpenRouterClient,
            run: function (policyClient) {
                return setup.StructuredAIRequest.run(policyClient, {
                    stage: "intimate-anticipations",
                    messages: clone(messages),
                    requestOptions: setup.AIRequestProfiles.resolve("intimate-anticipations", { actorId: actorId }),
                    validate: intimateMotivationValidation,
                    maxRepairAttempts: 1,
                    validationErrorCode: "INTIMATE_MOTIVATION_INVALID",
                    validationErrorMessage: "The Character model returned invalid intimate motivation.",
                    parseErrorCode: "INTIMATE_MOTIVATION_INVALID",
                    parseErrorMessage: "The Character model returned malformed intimate motivation JSON."
                });
            }
        });
        if (!result || !result.ok) return result || { ok: false, error: { code: "INTIMATE_MOTIVATION_FAILED", message: "Intimate motivation generation failed." } };
        return { ok: true, partnerId: partnerId, motivation: clone(result.value), retrieval: retrieval };
    }

    async function prepareIntimateDecision(actorId, decision, observations, client) {
        const updates = normalizedIntimateUpdates(decision);
        const generatedByPartnerId = {};
        for (const partnerId of updates.enablePartnerIds) {
            const generated = await generateIntimateMotivation(actorId, partnerId, observations, client);
            if (!generated.ok) return generated;
            generatedByPartnerId[partnerId] = generated.motivation;
        }
        return { ok: true, updates: updates, generatedByPartnerId: generatedByPartnerId };
    }

    async function commitDecision(actorId, decision, consumedIds, client, preparedIntimate) {
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
                publicNarrative: decision.publicNarrative,
                spokenText: decision.spokenText,
                target_id: decision.spokenTargetId || "",
                noticeability: decision.spokenLoudness || undefined,
                action: decision.action
            });
            if (!intentResult.ok) throw intentResult.error;
            actionFailed = Boolean(decision.action && intentResult.actionResult && !intentResult.actionResult.ok);
        }

        if (!actionFailed && intentResult.actionResult && intentResult.actionResult.ok && setup.ItemModelEffects) {
            const modelEffects = await setup.ItemModelEffects.resolveActionResult(
                actorId,
                intentResult.actionResult,
                client || setup.OpenRouterClient
            );
            if (!modelEffects.ok) throw modelEffects.error;
        }

        if (!actionFailed) {
            const memoryResult = setup.AIMemory.applyUpdates(actorId, decision.memoryUpdates);
            if (!memoryResult.ok) throw memoryResult.error;
            if (setup.AIIntimacy && typeof setup.AIIntimacy.applyUpdates === "function") {
                const intimateResult = setup.AIIntimacy.applyUpdates(actorId,
                    preparedIntimate && preparedIntimate.updates || normalizedIntimateUpdates(decision),
                    preparedIntimate && preparedIntimate.generatedByPartnerId || {});
                if (!intimateResult.ok) throw intimateResult.error;
            }
        }

        const continuationResult = setup.AIWorkingState.setContinuation(actorId, decision.continuation);
        if (!continuationResult.ok) throw continuationResult.error;

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
            intimateSuppressed: actionFailed,
            intentResult: clone(intentResult),
            actionResult: intentResult.actionResult ? clone(intentResult.actionResult) : null
        };
    }

    async function takeQueuedTurn(expectedActorId, client) {
        if (setup.Game.isPlayerSetupComplete && !setup.Game.isPlayerSetupComplete()) return recordFailure({ code: "PLAYER_SETUP_INCOMPLETE", message: "Complete Traveler setup before AI processing begins." });
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
            const request = setup.AITurnScheduler.buildDecisionRequest(actorId, { skipContext: true });
            if (!request.ok) throw request.error;
            const retrieval = setup.MindSemanticRetrieval
                ? await setup.MindSemanticRetrieval.select(actorId, request.observations, client || setup.OpenRouterClient)
                : { ok: true, selection: setup.CharacterContext.selectMindDeterministically(actorId, request.observations), fallbackUsed: true };
            if (!retrieval.ok) throw retrieval.error;
            const context = setup.ContextBuilder.build(actorId, { pendingObservations: request.observations, mindSelection: retrieval.selection });
            if (context && context.ok === false) throw context.error;
            const messages = setup.AIProtocol.decisionMessages(context);
            const observationIds = clone(request.observationIds);
            setup.AITransientDebug.lastContext = clone(context);
            setup.AITransientDebug.lastMessages = clone(messages);

            const decisionResult = await setup.AIRequestExecutor.execute({
                actorId: actorId,
                purpose: "game-decision",
                messages: messages,
                stage: "decision",
                requestOptions: setup.AIRequestProfiles.resolve("game-decision", { actorId: actorId }),
                client: client
            });
            recordProtocolResult(actorId, "decision", messages, decisionResult);
            if (decisionResult.intimateMaintenanceFallback && setup.EmergencyDiagnostics && typeof setup.EmergencyDiagnostics.recordError === "function") {
                try {
                    setup.EmergencyDiagnostics.recordError("intimate-maintenance-fallback", {
                        message: "Invalid intimate motivation replacement was suppressed after bounded repair; previous motivation block was preserved and the ordinary Character decision continued.",
                        details: clone(decisionResult.intimateMaintenanceFallback)
                    });
                } catch (ignored) { /* Diagnostics must never affect gameplay. */ }
            }
            if (!decisionResult.ok) throw decisionResult.error;

            const finalDecision = clone(decisionResult.value);
            if (!Object.prototype.hasOwnProperty.call(finalDecision, "intimateUpdates")) {
                finalDecision.intimateUpdates = { enablePartnerIds: [], disablePartnerIds: [], anticipationReplacements: [] };
            }
            const preparedIntimate = await prepareIntimateDecision(actorId, finalDecision, request.observations, client || setup.OpenRouterClient);
            if (!preparedIntimate.ok) throw preparedIntimate.error || { code: "INTIMATE_PREPARE_FAILED", message: "Failed to prepare intimate-mode state." };
            const committed = await commitDecision(actorId, finalDecision, observationIds, client, preparedIntimate);
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
                intimateSuppressed: committed.intimateSuppressed,
                intimateMaintenanceFallback: decisionResult.intimateMaintenanceFallback ? clone(decisionResult.intimateMaintenanceFallback) : null,
                usage: decisionResult.usage || null,
                retrieval: { semantic: retrieval.semantic === true, fallbackUsed: retrieval.fallbackUsed === true, selectorUsage: retrieval.selectorResult && retrieval.selectorResult.usage || null }
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
            const status = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus ? setup.AIRequestExecutor.getStatus() : null;
            return inFlight || Boolean(status && (status.blockingBusy !== undefined ? status.blockingBusy : status.busy));
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
