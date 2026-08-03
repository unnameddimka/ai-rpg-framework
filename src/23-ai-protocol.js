(function () {
    "use strict";

    const EMPTY_UPDATES = { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] };
    const DECISION_KEYS = ["action", "publicNarrative", "spokenText", "memoryUpdates"];
    const RESULT_KEYS = ["publicNarrative", "spokenText", "memoryUpdates"];

    function extractObject(content) {
        if (typeof content !== "string") throw new Error("Model response is not text.");
        let text = content.trim();
        const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        if (fence) text = fence[1].trim();
        if (!text.startsWith("{") || !text.endsWith("}")) throw new Error("Model response must contain one JSON object only.");
        return JSON.parse(text);
    }

    function exactKeys(value, keys) {
        return value && typeof value === "object" && !Array.isArray(value) &&
            Object.keys(value).every(function (key) { return keys.includes(key); }) && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
    }
    function nullableText(value) { return value === null || (typeof value === "string" && value.length <= 2000); }
    function validateUpdates(updates) {
        return exactKeys(updates, ["recentMemoriesToAdd", "beliefsToUpsert", "relationshipsToUpsert"]) &&
            Array.isArray(updates.recentMemoriesToAdd) && Array.isArray(updates.beliefsToUpsert) && Array.isArray(updates.relationshipsToUpsert);
    }
    function updatesEmpty(updates) { return updates.recentMemoriesToAdd.length === 0 && updates.beliefsToUpsert.length === 0 && updates.relationshipsToUpsert.length === 0; }

    function validateDecision(value, availableActions) {
        if (!exactKeys(value, DECISION_KEYS) || !nullableText(value.publicNarrative) || !nullableText(value.spokenText) || !validateUpdates(value.memoryUpdates)) return { ok: false, message: "Decision response has an invalid schema." };
        if (value.action !== null) {
            if (!value.action || typeof value.action !== "object" || Array.isArray(value.action) || typeof value.action.type !== "string") return { ok: false, message: "Decision action must be null or one action object." };
            const actionDefinition = availableActions[value.action.type];
            if (!actionDefinition) return { ok: false, message: "Decision selected an unavailable action." };
            const properties = actionDefinition.schema && actionDefinition.schema.properties || {};
            const required = actionDefinition.schema && actionDefinition.schema.required || ["type"];
            if (Object.keys(value.action).some(function (key) { return !Object.prototype.hasOwnProperty.call(properties, key); }) ||
                required.some(function (key) { return !Object.prototype.hasOwnProperty.call(value.action, key); })) {
                return { ok: false, message: "Decision action does not match the available action schema." };
            }
            if (!updatesEmpty(value.memoryUpdates)) return { ok: false, message: "Action-stage memory updates must be empty." };
        }
        return { ok: true, value: value };
    }
    function validateResult(value) {
        return exactKeys(value, RESULT_KEYS) && nullableText(value.publicNarrative) && nullableText(value.spokenText) && validateUpdates(value.memoryUpdates)
            ? { ok: true, value: value } : { ok: false, message: "Result-stage response has an invalid schema." };
    }

    function baseSystem(stage) {
        return `You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return JSON only with no chain-of-thought, hidden reasoning, arbitrary patches, or extra fields. ${stage === "decision" ? "Choose null or at most one available formal action using supplied IDs/options." : "Do not choose another action; react only to the grounded result."}`;
    }
    function decisionMessages(context, observations) {
        return [{ role: "system", content: baseSystem("decision") }, { role: "user", content: JSON.stringify({ stage: "decision", context: context, pendingObservations: observations, schema: { action: null, publicNarrative: null, spokenText: null, memoryUpdates: EMPTY_UPDATES } }) }];
    }
    function resultMessages(context, observations, action, actionResult) {
        return [{ role: "system", content: baseSystem("result") }, { role: "user", content: JSON.stringify({ stage: "result", context: context, pendingObservations: observations, action: action, groundedActionResult: actionResult, schema: { publicNarrative: null, spokenText: null, memoryUpdates: EMPTY_UPDATES } }) }];
    }

    async function requestValidated(messages, stage, availableActions, client) {
        let response = await client.chat(messages);
        if (!response.ok) return response;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const value = extractObject(response.content);
                const validation = stage === "decision" ? validateDecision(value, availableActions) : validateResult(value);
                if (validation.ok) return { ok: true, value: validation.value, usage: response.usage, rawContent: response.content, repaired: attempt === 1 };
                throw new Error(validation.message);
            } catch (error) {
                if (attempt === 1) return { ok: false, error: { code: "INVALID_MODEL_JSON", message: "The model returned invalid JSON protocol data." } };
                const repairMessages = messages.concat([{ role: "assistant", content: response.content.slice(0, 12000) }, { role: "user", content: `Repair the response. Return exactly one JSON object matching the required ${stage} schema, with no prose or extra fields.` }]);
                response = await client.chat(repairMessages);
                if (!response.ok) return response;
            }
        }
    }

    setup.AIProtocol = { EMPTY_UPDATES: EMPTY_UPDATES, extractObject: extractObject, validateDecision: validateDecision,
        validateResult: validateResult, decisionMessages: decisionMessages, resultMessages: resultMessages, requestValidated: requestValidated };
}());
