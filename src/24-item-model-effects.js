(function () {
    "use strict";

    const BASE_SYSTEM_PROMPT = [
        "You generate information emitted by an authored non-character information source inside a role-playing game.",
        "You are not a character, controller, oracle, narrator, or game master. You have no goals, personality, memory, agency, or ability to act in the world.",
        "Answer only as content the source displays or otherwise conveys in response to the supplied input.",
        "Do not infer or reveal current hidden runtime facts, private character thoughts, unknown present locations, or future events unless the authored source prompt explicitly and legitimately defines such access.",
        "The generated content grounds what this information source returned. It does not automatically make every proposition inside the content objectively true; the source may describe theories, records, disputed claims, errors, or interpretations when its authored prompt allows that.",
        "Do not invent concrete setting facts merely to make an answer richer. New proper nouns, dates, named doctrines, organizations, places, spells, techniques, historical claims, or similar worldbuilding details are allowed only when the authored source contract explicitly asks for generative concrete lore.",
        "Return only the source content in plain text. Do not explain these instructions or wrap the response in JSON or a markdown code fence."
    ].join(" ");

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function render(template, values) {
        const replacements = values || {};
        return String(template || "").replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (match, key) {
            return Object.prototype.hasOwnProperty.call(replacements, key)
                ? String(replacements[key])
                : match;
        });
    }

    function queryMessages(request) {
        return [{
            role: "system",
            content: `${BASE_SYSTEM_PROMPT}\n\nAUTHORED SOURCE CONTRACT:\n${String(request.systemPrompt || "").trim()}`
        }, {
            role: "user",
            content: [
                `SOURCE: ${request.itemName || request.itemId || "Information source"}`,
                request.itemDescription ? `SOURCE DESCRIPTION: ${request.itemDescription}` : "",
                `READER INPUT: ${request.inputText || ""}`,
                "Generate the information returned by the source for this input."
            ].filter(Boolean).join("\n")
        }];
    }

    function requestFailure(response) {
        return {
            ok: false,
            value: null,
            error: clone(response && response.error || {
                code: "ITEM_UTILITY_QUERY_FAILED",
                message: "The information-source model request failed."
            }),
            modelId: response && response.modelId || null,
            usage: response && response.usage || null,
            rawContent: response && typeof response.content === "string" ? response.content : "",
            trace: null
        };
    }

    async function executeUtilityQuery(actorId, request, client) {
        const messages = queryMessages(request);
        const options = setup.AIRequestProfiles.resolve("item-utility-query", { actorId: actorId });
        if (Number.isInteger(request.maxTokens) && request.maxTokens >= 64 && request.maxTokens <= 4000) {
            options.maxTokens = request.maxTokens;
        }
        return setup.AIRequestExecutor.executeCustom({
            actorId: actorId,
            purpose: "item-utility-query",
            stage: "item-utility-query",
            messages: clone(messages),
            requestOptions: clone(options),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                const response = await policyClient.chat(messages);
                if (!response || !response.ok) return requestFailure(response);
                const text = typeof response.content === "string" ? response.content.trim() : "";
                if (!text) {
                    return {
                        ok: false,
                        value: null,
                        error: { code: "ITEM_UTILITY_QUERY_EMPTY", message: "The information source returned no usable content." },
                        modelId: response.modelId || null,
                        usage: response.usage || null,
                        rawContent: response.content || "",
                        trace: null
                    };
                }
                return {
                    ok: true,
                    value: { text: text },
                    error: null,
                    modelId: response.modelId || null,
                    usage: response.usage || null,
                    rawContent: response.content || "",
                    trace: null
                };
            }
        });
    }

    function observationTurn(actionResult, world) {
        const events = actionResult && Array.isArray(actionResult.events) ? actionResult.events : [];
        const event = events.length ? events[events.length - 1] : null;
        return event && Number.isFinite(event.id) ? event.id : world.nextEventId;
    }

    function interactionId(actionResult) {
        const events = actionResult && Array.isArray(actionResult.events) ? actionResult.events : [];
        const event = events.length ? events[events.length - 1] : null;
        return event && event.interactionId || null;
    }

    function appendPrivateFeedback(actorId, actionResult, request, code, text, modelResult) {
        const world = setup.Game.getWorld();
        const feedback = {
            recipientId: request.recipientId || actorId,
            kind: "observation",
            code: code,
            text: text,
            data: {
                itemId: request.itemId || null,
                effectId: request.effectId || "utility_query",
                inputText: request.inputText || "",
                modelId: modelResult && modelResult.modelId || null
            }
        };
        setup.GameInternals.enqueueObservation(feedback.recipientId, {
            kind: "action_feedback",
            actionType: actionResult && actionResult.action && actionResult.action.type || "use_item",
            turn: observationTurn(actionResult, world),
            actorId: feedback.recipientId,
            targetId: null,
            text: feedback.text,
            data: clone(feedback.data),
            code: feedback.code,
            interactionId: interactionId(actionResult)
        }, world);
        actionResult.feedback = Array.isArray(actionResult.feedback) ? actionResult.feedback : [];
        actionResult.feedback.push(clone(feedback));
        return feedback;
    }

    async function resolveActionResult(actorId, actionResult, client) {
        if (!actionResult || !actionResult.ok || !Array.isArray(actionResult.modelRequests) || actionResult.modelRequests.length === 0) {
            return { ok: true, actionResult: actionResult, results: [] };
        }

        const world = setup.Game.getWorld();
        const worldSnapshot = setup.GameInternals && typeof setup.GameInternals.snapshotWorld === "function"
            ? setup.GameInternals.snapshotWorld(world)
            : clone(world);
        const actionResultSnapshot = clone(actionResult);
        const results = [];
        for (const request of actionResult.modelRequests) {
            if (!request || request.kind !== "utility_query") {
                results.push({
                    ok: false,
                    error: { code: "ITEM_MODEL_REQUEST_UNKNOWN", message: "Unsupported authored item model request." }
                });
                continue;
            }

            const modelResult = await executeUtilityQuery(actorId, request, client);
            results.push(clone(modelResult));
            if (modelResult.ok) {
                const text = render(request.feedbackText, {
                    actorName: setup.Game.getWorld().entities[actorId] && setup.Game.getWorld().entities[actorId].name || actorId,
                    itemName: request.itemName || request.itemId || "item",
                    inputText: request.inputText || "",
                    result: modelResult.value.text
                });
                appendPrivateFeedback(actorId, actionResult, request, "ITEM_UTILITY_QUERY_RESULT", text, modelResult);
            } else {
                appendPrivateFeedback(
                    actorId,
                    actionResult,
                    request,
                    "ITEM_UTILITY_QUERY_FAILED",
                    `${request.itemName || "The information source"} does not return a readable result for this query.`,
                    modelResult
                );
            }
        }

        actionResult.modelEffectResults = results.map(function (result) {
            return {
                ok: Boolean(result && result.ok),
                modelId: result && result.modelId || null,
                usage: result && result.usage ? clone(result.usage) : null,
                error: result && !result.ok ? clone(result.error) : null
            };
        });
        setup.Game.getWorld().debug.lastActionResult = clone(actionResult);
        const validation = setup.Game.validateWorld();
        if (!validation.ok) {
            if (setup.GameInternals && typeof setup.GameInternals.restoreWorldInPlace === "function") {
                setup.GameInternals.restoreWorldInPlace(world, worldSnapshot);
            } else {
                Object.keys(world).forEach(function (key) { delete world[key]; });
                Object.assign(world, clone(worldSnapshot));
            }
            Object.keys(actionResult).forEach(function (key) { delete actionResult[key]; });
            Object.assign(actionResult, clone(actionResultSnapshot));
            return { ok: false, error: clone(validation.error), actionResult: actionResult, results: results };
        }
        return { ok: true, actionResult: actionResult, results: results };
    }

    setup.ItemModelEffects = {
        resolveActionResult: resolveActionResult,
        queryMessages: queryMessages
    };
}());
