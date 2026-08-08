(function () {
    "use strict";

    const EMPTY_UPDATES = { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] };
    const DECISION_KEYS = ["action", "publicNarrative", "spokenText", "memoryUpdates"];
    const RESULT_KEYS = ["publicNarrative", "spokenText", "memoryUpdates"];
    const UPDATE_KEYS = ["recentMemoriesToAdd", "beliefsToUpsert", "relationshipsToUpsert"];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function extractObject(content) {
        if (typeof content !== "string") throw new Error("Model response is not text.");
        let text = content.trim();
        const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        if (fence) text = fence[1].trim();
        if (!text.startsWith("{") || !text.endsWith("}")) throw new Error("Model response must contain one JSON object only.");
        return JSON.parse(text);
    }

    function isPlainObject(value) {
        return value && typeof value === "object" && !Array.isArray(value);
    }

    function exactKeyErrors(value, keys, path) {
        if (!isPlainObject(value)) return [`${path} must be an object.`];
        const errors = [];
        Object.keys(value).forEach(function (key) {
            if (!keys.includes(key)) errors.push(`${path}.${key} is not allowed.`);
        });
        keys.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required.`);
        });
        return errors;
    }

    function nullableTextErrors(value, path) {
        if (value === null) return [];
        if (typeof value !== "string") return [`${path} must be a string or null.`];
        if (value.length > 2000) return [`${path} must not exceed 2000 characters.`];
        return [];
    }

    function requiredTextErrors(value, path, maxLength) {
        if (typeof value !== "string" || !value.trim()) return [`${path} must be a non-empty string.`];
        if (value.trim().length > maxLength) return [`${path} must not exceed ${maxLength} characters.`];
        return [];
    }

    function validateUpdatesDetailed(updates, path) {
        const errors = exactKeyErrors(updates, UPDATE_KEYS, path);
        if (!isPlainObject(updates)) return errors;

        UPDATE_KEYS.forEach(function (key) {
            if (!Array.isArray(updates[key])) errors.push(`${path}.${key} must be an array.`);
            else if (updates[key].length > 5) errors.push(`${path}.${key} may contain at most 5 records.`);
        });
        (Array.isArray(updates.recentMemoriesToAdd) ? updates.recentMemoriesToAdd : []).forEach(function (memory, index) {
            const recordPath = `${path}.recentMemoriesToAdd[${index}]`;
            errors.push.apply(errors, exactKeyErrors(memory, ["summary", "importance"], recordPath));
            if (!isPlainObject(memory)) return;
            errors.push.apply(errors, requiredTextErrors(memory.summary, `${recordPath}.summary`, 500));
            if (typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
                errors.push(`${recordPath}.importance must be a finite number from 0 to 1.`);
            }
        });

        (Array.isArray(updates.beliefsToUpsert) ? updates.beliefsToUpsert : []).forEach(function (belief, index) {
            const recordPath = `${path}.beliefsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(belief, ["id", "text", "confidence"], recordPath));
            if (!isPlainObject(belief)) return;
            if (typeof belief.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id)) {
                errors.push(`${recordPath}.id must start with a letter and contain only letters, digits, underscores, or hyphens.`);
            }
            errors.push.apply(errors, requiredTextErrors(belief.text, `${recordPath}.text`, 500));
            if (!["low", "medium", "high"].includes(belief.confidence)) {
                errors.push(`${recordPath}.confidence must be low, medium, or high.`);
            }
        });

        (Array.isArray(updates.relationshipsToUpsert) ? updates.relationshipsToUpsert : []).forEach(function (relationship, index) {
            const recordPath = `${path}.relationshipsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(relationship, ["targetCharacterId", "summary"], recordPath));
            if (!isPlainObject(relationship)) return;
            errors.push.apply(errors, requiredTextErrors(relationship.targetCharacterId, `${recordPath}.targetCharacterId`, 200));
            errors.push.apply(errors, requiredTextErrors(relationship.summary, `${recordPath}.summary`, 500));
        });
        return errors;
    }

    function updatesEmpty(updates) {
        return updates.recentMemoriesToAdd.length === 0 && updates.beliefsToUpsert.length === 0 && updates.relationshipsToUpsert.length === 0;
    }

    function validateActionProperties(action, actionDefinition, path) {
        const errors = [];
        const schema = actionDefinition.schema || {};
        const properties = schema.properties || {};
        const required = schema.required || ["type"];
        Object.keys(action).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed for action ${action.type}.`);
        });
        required.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) errors.push(`${path}.${key} is required for action ${action.type}.`);
        });
        Object.keys(properties).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) return;
            const rule = properties[key] || {};
            const value = action[key];
            if (Object.prototype.hasOwnProperty.call(rule, "const") && value !== rule.const) {
                errors.push(`${path}.${key} must equal ${JSON.stringify(rule.const)}.`);
            }
            if (rule.type === "string" && typeof value !== "string") errors.push(`${path}.${key} must be a string.`);
            if (rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${path}.${key} must be a finite number.`);
            if (rule.type === "integer" && !Number.isInteger(value)) errors.push(`${path}.${key} must be an integer.`);
            if (typeof rule.minimum === "number" && typeof value === "number" && value < rule.minimum) errors.push(`${path}.${key} must be at least ${rule.minimum}.`);
            if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${path}.${key} must be one of ${rule.enum.join(", ")}.`);
        });
        return errors;
    }

    function finishValidation(value, errors) {
        return errors.length === 0
            ? { ok: true, value: value, errors: [] }
            : { ok: false, message: errors[0], errors: errors };
    }

    function validateDecision(value, actionCatalog) {
        const errors = exactKeyErrors(value, DECISION_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates"));

        if (value.action !== null) {
            if (!isPlainObject(value.action) || typeof value.action.type !== "string") {
                errors.push("response.action must be null or one action object with a string type.");
            } else {
                const actionDefinition = actionCatalog && actionCatalog[value.action.type];
                if (!actionDefinition) errors.push(`response.action.type selected unavailable action ${JSON.stringify(value.action.type)}.`);
                else errors.push.apply(errors, validateActionProperties(value.action, actionDefinition, "response.action"));
            }
        }
        return finishValidation(value, errors);
    }

    function validateResult(value) {
        const errors = exactKeyErrors(value, RESULT_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates"));
        return finishValidation(value, errors);
    }

    function baseSystem(stage) {
        const stageRule = stage === "decision"
            ? "Return exactly the keys action, publicNarrative, spokenText, and memoryUpdates. action is null or one available formal action and may accompany speech or narrative behavior. Choose an action only when it serves the character's current goals or answers the situation, but do not merely promise future work when a practical first step is available now. When a goal requires multiple formal actions, choose only the first currently available step. After a grounded result arrives in a later observation, reevaluate the current view, view.available_actions, and new observations, then continue with the next available step when appropriate. Use a minimal recent memory update only when needed to retain the brief current goal and meaningful progress between reaction waves; do not write a detailed predetermined plan. Stop when the goal is complete, impossible, abandoned, or requires a new decision or action from another character. After failure, use the grounded feedback and do not blindly repeat the same action. The engine executes the selected action after this response. Do not claim through narrative or speech that a physical result succeeded before the engine confirms it; its grounded result will arrive later as an ordinary observation."
            : "Return exactly the keys publicNarrative, spokenText, and memoryUpdates. Do not choose another action; react only to the supplied grounded action result.";
        const styleRule = "Treat each response as a moment in an ongoing role-playing scene, not merely as action selection or protocol completion. When natural, use publicNarrative for brief visible behavior such as expression, posture, gesture, hesitation, attention, or other atmospheric detail, and use spokenText for natural dialogue in this particular character's own voice. Let the supplied character description, memories, beliefs, relationships, and current situation shape that voice. Prefer concrete, characterful phrasing over generic assistant-like or functional NPC replies. Keep it concise by default: one or two short narrative sentences plus dialogue is usually enough when both are useful. Do not force narration or speech into every response; silence, null fields, or an action-only response remain valid when natural. Do not repeat information just to make the response longer. When selecting a formal action, narrative may describe accompanying non-state-changing behavior, preparation, expression, or intent, but it must not claim that the formal action successfully changed the world before the engine confirms it.";
        return `You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return exactly one JSON object and nothing else: no markdown fence, prose, chain-of-thought, hidden reasoning, patches, or extra fields. ${stageRule} ${styleRule} memoryUpdates must always contain exactly recentMemoriesToAdd, beliefsToUpsert, and relationshipsToUpsert, even when all are empty arrays. A recent memory record is {"summary":"...","importance":0.0}; use summary, never text, and importance must be from 0 to 1. A belief record is {"id":"letter_started_id","text":"...","confidence":"low|medium|high"}. A relationship record is {"targetCharacterId":"character_id","summary":"..."}.`;
    }

    function requestPayloadFromMessages(messages) {
        for (let index = (messages || []).length - 1; index >= 0; index--) {
            const message = messages[index];
            if (!message || message.role !== "user" || typeof message.content !== "string") continue;
            try {
                const payload = JSON.parse(message.content);
                if (isPlainObject(payload) && isPlainObject(payload.context)) return payload;
            } catch (error) {
                // Repair instructions and other user prose are not request payloads.
            }
        }
        return null;
    }

    function actionCatalogFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const view = context && context.view;
        if (isPlainObject(view) && isPlainObject(view.available_actions)) {
            return clone(view.available_actions);
        }
        return {};
    }

    function decisionMessages(context) {
        return [{ role: "system", content: baseSystem("decision") }, { role: "user", content: JSON.stringify({
            stage: "decision",
            context: clone(context || {}),
            requiredResponseShape: { action: null, publicNarrative: null, spokenText: null, memoryUpdates: EMPTY_UPDATES }
        }) }];
    }

    function resultMessages(context, action, actionResult) {
        return [{ role: "system", content: baseSystem("result") }, { role: "user", content: JSON.stringify({
            stage: "result",
            context: clone(context || {}),
            action: action,
            groundedActionResult: actionResult,
            requiredResponseShape: { publicNarrative: null, spokenText: null, memoryUpdates: EMPTY_UPDATES }
        }) }];
    }

    function buildRepairMessages(messages, responseContent, stage, errors) {
        const errorList = (errors && errors.length ? errors : ["The response did not match the protocol."])
            .map(function (error) { return `- ${error}`; }).join("\n");
        return messages.concat([
            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
            { role: "user", content: `Your previous response failed validation:\n${errorList}\nReturn the complete corrected ${stage} JSON object. Include every required field, no extra fields, no prose, and no markdown fence.` }
        ]);
    }

    async function requestValidated(messages, stage, client) {
        const actionCatalog = actionCatalogFromMessages(messages);
        const trace = {
            stage: stage,
            originalMessages: clone(messages),
            attempts: [],
            finalStatus: "pending"
        };
        let currentMessages = clone(messages);
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await client.chat(currentMessages);
            const attemptTrace = {
                attempt: attempt + 1,
                kind: attempt === 0 ? "initial" : "repair",
                messages: clone(currentMessages),
                modelId: response && response.modelId || null,
                rawContent: response && typeof response.content === "string" ? response.content : "",
                usage: response && response.usage || null,
                providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                parsedValue: null,
                validationErrors: []
            };
            trace.attempts.push(attemptTrace);
            if (!response || !response.ok) {
                trace.finalStatus = "request_failed";
                trace.safeError = clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "AI request failed." });
                return { ok: false, error: trace.safeError, modelId: response && response.modelId || null, trace: trace };
            }

            let value;
            let validation;
            try {
                value = extractObject(response.content);
                attemptTrace.parsedValue = clone(value);
                validation = stage === "decision" ? validateDecision(value, actionCatalog) : validateResult(value);
            } catch (error) {
                validation = { ok: false, message: error.message, errors: [error.message] };
            }

            if (validation.ok) {
                trace.finalStatus = "valid";
                trace.repaired = attempt === 1;
                return {
                    ok: true,
                    value: validation.value,
                    modelId: response.modelId || null,
                    usage: response.usage,
                    rawContent: response.content,
                    repaired: attempt === 1,
                    trace: trace
                };
            }

            attemptTrace.validationErrors = (validation.errors || [validation.message]).slice();
            if (attempt === 1) {
                trace.finalStatus = "invalid_after_repair";
                trace.safeError = {
                    code: "INVALID_MODEL_JSON",
                    message: "The model returned invalid JSON protocol data.",
                    details: attemptTrace.validationErrors.slice()
                };
                return { ok: false, error: trace.safeError, modelId: response && response.modelId || null, trace: trace };
            }
            currentMessages = buildRepairMessages(messages, response.content, stage, attemptTrace.validationErrors);
        }
    }

    setup.AIProtocol = {
        EMPTY_UPDATES: EMPTY_UPDATES,
        extractObject: extractObject,
        validateDecision: validateDecision,
        validateResult: validateResult,
        actionCatalogFromMessages: actionCatalogFromMessages,
        decisionMessages: decisionMessages,
        resultMessages: resultMessages,
        buildRepairMessages: buildRepairMessages,
        requestValidated: requestValidated
    };
}());
