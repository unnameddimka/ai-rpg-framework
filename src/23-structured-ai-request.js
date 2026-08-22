(function () {
    "use strict";

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

    function safeErrors(validation, fallback) {
        if (validation && Array.isArray(validation.errors) && validation.errors.length) return validation.errors.slice();
        if (validation && validation.message) return [String(validation.message)];
        return [fallback || "The response did not match the required structured protocol."];
    }

    function defaultParse(content) {
        return setup.AIProtocol.extractObject(content);
    }

    function defaultRepairMessages(baseMessages, responseContent, errors, spec) {
        const contract = spec && spec.contract ? `\nCanonical response contract:\n${String(spec.contract)}` : "";
        return clone(baseMessages).concat([
            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
            { role: "user", content: `Your previous response failed validation:\n${errors.map(function (error) { return `- ${error}`; }).join("\n")}${contract}\nReturn the complete corrected JSON object only. Use exactly the requested field names and supplied IDs. No markdown or extra prose.` }
        ]);
    }

    async function run(policyClient, specification) {
        const spec = specification || {};
        const baseMessages = clone(spec.messages || []);
        const parse = typeof spec.parse === "function" ? spec.parse : defaultParse;
        const normalize = typeof spec.normalize === "function" ? spec.normalize : function (value) { return value; };
        const validate = typeof spec.validate === "function" ? spec.validate : function (value) { return { ok: true, value: value }; };
        const repairMessages = typeof spec.buildRepairMessages === "function" ? spec.buildRepairMessages : defaultRepairMessages;
        const maxRepairAttempts = Number.isInteger(spec.maxRepairAttempts) && spec.maxRepairAttempts >= 0 ? spec.maxRepairAttempts : 1;
        const retryOnTruncation = spec.retryOnTruncation === true;
        const maxTruncationRetries = retryOnTruncation ? (Number.isInteger(spec.maxTruncationRetries) ? Math.max(0, spec.maxTruncationRetries) : 1) : 0;
        let repairCount = 0;
        let truncationCount = 0;
        let currentMessages = clone(baseMessages);
        let requestOptions = clone(spec.requestOptions || null);
        const trace = {
            stage: spec.stage || null,
            attempts: [],
            finalStatus: "pending"
        };

        while (true) {
            const kind = repairCount > 0 ? "repair" : (truncationCount > 0 ? "truncation-retry" : "initial");
            const response = await policyClient.chat(currentMessages, requestOptions || undefined);
            const attemptTrace = {
                attempt: trace.attempts.length + 1,
                kind: kind,
                requestOptions: clone(requestOptions),
                modelId: response && response.modelId || null,
                rawContent: response && typeof response.content === "string" ? response.content : "",
                usage: response && response.usage || null,
                providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                parsedValue: null,
                validationErrors: []
            };
            // The executor already stores the base request messages once. Preserve only non-initial
            // structured-attempt messages (repair/retry) when they differ from that canonical request.
            if (spec.traceMessages === true && kind !== "initial") attemptTrace.messages = clone(currentMessages);
            trace.attempts.push(attemptTrace);

            if (!response || !response.ok) {
                const error = clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "AI request failed." });
                if (error.code === "MODEL_OUTPUT_TRUNCATED" && truncationCount < maxTruncationRetries) {
                    truncationCount += 1;
                    currentMessages = clone(baseMessages);
                    if (typeof spec.onTruncationRetryOptions === "function") {
                        requestOptions = clone(spec.onTruncationRetryOptions(requestOptions || {}, truncationCount));
                    }
                    continue;
                }
                trace.finalStatus = error.code === "MODEL_OUTPUT_TRUNCATED" ? "truncated" : "request_failed";
                trace.safeError = clone(error);
                return {
                    ok: false,
                    error: error,
                    modelId: response && response.modelId || null,
                    usage: response && response.usage || null,
                    rawContent: response && response.content || "",
                    trace: trace
                };
            }

            let parsed;
            let normalized;
            let validation;
            let parseFailed = false;
            try {
                parsed = parse(response.content);
                normalized = normalize(parsed);
                attemptTrace.parsedValue = clone(normalized);
                validation = validate(normalized);
            } catch (error) {
                parseFailed = true;
                validation = { ok: false, errors: [error && error.message || "The response was not valid JSON."] };
            }

            if (validation && validation.ok) {
                trace.finalStatus = "valid";
                trace.repaired = repairCount > 0;
                return {
                    ok: true,
                    value: clone(Object.prototype.hasOwnProperty.call(validation, "value") ? validation.value : normalized),
                    modelId: response.modelId || null,
                    usage: response.usage || null,
                    rawContent: response.content,
                    repaired: repairCount > 0,
                    trace: trace
                };
            }

            const errors = safeErrors(validation, spec.validationFailureMessage);
            attemptTrace.validationErrors = clone(errors);
            if (repairCount >= maxRepairAttempts) {
                trace.finalStatus = parseFailed ? "parse_failed_after_repair" : "invalid_after_repair";
                const error = {
                    code: parseFailed ? (spec.parseErrorCode || "MODEL_JSON_PARSE_FAILED") : (spec.validationErrorCode || "MODEL_PROTOCOL_INVALID"),
                    message: parseFailed
                        ? (spec.parseErrorMessage || "The model returned malformed JSON.")
                        : (spec.validationErrorMessage || "The model returned JSON that failed protocol validation."),
                    details: clone(errors)
                };
                trace.safeError = clone(error);
                return { ok: false, error: error, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content, trace: trace };
            }

            repairCount += 1;
            currentMessages = repairMessages(baseMessages, response.content, errors, spec);
        }
    }

    setup.StructuredAIRequest = {
        run: run,
        defaultRepairMessages: defaultRepairMessages
    };
}());
