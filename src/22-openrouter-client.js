(function () {
    "use strict";

    const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
    const MAX_TOKENS = 6000;
    const REASONING_MAX_TOKENS = 1500;
    const TEMPERATURE = 0.4;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function redactSecretText(value) {
        let text = String(value === undefined || value === null ? "" : value);
        const currentKey = setup.AIRuntimeSettings && typeof setup.AIRuntimeSettings.getKey === "function"
            ? setup.AIRuntimeSettings.getKey()
            : "";
        if (currentKey && currentKey.length >= 8) text = text.split(currentKey).join("[REDACTED_API_KEY]");
        return text
            .replace(/sk-or-v1-[A-Za-z0-9_-]{12,}/g, "[REDACTED_OPENROUTER_KEY]")
            .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]")
            .replace(/\buser_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_OPENROUTER_USER_ID]");
    }

    function sanitizeValue(value) {
        if (typeof value === "string") return redactSecretText(value);
        if (Array.isArray(value)) return value.map(sanitizeValue);
        if (value && typeof value === "object") {
            const output = {};
            Object.keys(value).forEach(function (key) {
                const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
                output[key] = ["apikey", "openrouterkey", "authorization", "accesstoken"].includes(normalized)
                    ? "[REDACTED]"
                    : normalized === "userid"
                        ? "[REDACTED_OPENROUTER_USER_ID]"
                        : sanitizeValue(value[key]);
            });
            return output;
        }
        return value;
    }

    function safeFailure(code, message, status, extra) {
        const additions = extra || {};
        const providerResponse = additions.providerResponse ? sanitizeValue(additions.providerResponse) : null;
        const error = {
            code: code,
            message: redactSecretText(message)
        };
        if (providerResponse) error.providerResponse = clone(providerResponse);
        return Object.assign({
            ok: false,
            status: status || 0,
            modelId: additions.modelId || (setup.AIRuntimeSettings && setup.AIRuntimeSettings.getSelectedModelId
                ? setup.AIRuntimeSettings.getSelectedModelId()
                : null),
            content: "",
            usage: null,
            retryAfterMs: null,
            providerResponse: providerResponse,
            error: error
        }, additions, {
            providerResponse: providerResponse,
            error: error
        });
    }

    function retryAfterMilliseconds(response) {
        const header = response && response.headers && typeof response.headers.get === "function"
            ? response.headers.get("Retry-After")
            : null;
        if (!header) return null;
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
        const date = Date.parse(header);
        return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
    }

    function exposedHeaders(response) {
        const result = {};
        const headers = response && response.headers;
        if (!headers) return result;
        if (typeof headers.forEach === "function") {
            try {
                headers.forEach(function (value, name) {
                    result[String(name).toLowerCase()] = redactSecretText(value);
                });
            } catch (error) {}
        }
        if (typeof headers.get === "function") {
            [
                "content-type",
                "date",
                "retry-after",
                "server",
                "cf-ray",
                "x-request-id",
                "x-openrouter-request-id",
                "x-generation-id"
            ].forEach(function (name) {
                try {
                    const value = headers.get(name);
                    if (value !== null && value !== undefined && value !== "") result[name] = redactSecretText(value);
                } catch (error) {}
            });
        }
        return result;
    }

    async function readBody(response) {
        let rawBody = "";
        let parsedBody = null;
        let bodyReadError = null;
        try {
            if (response && typeof response.text === "function") {
                rawBody = await response.text();
                if (rawBody) {
                    try { parsedBody = JSON.parse(rawBody); }
                    catch (error) { parsedBody = null; }
                }
            } else if (response && typeof response.json === "function") {
                parsedBody = await response.json();
                rawBody = JSON.stringify(parsedBody);
            }
        } catch (error) {
            bodyReadError = {
                name: error && error.name || "Error",
                message: redactSecretText(error && error.message || "Response body could not be read.")
            };
        }
        const sanitizedParsedBody = sanitizeValue(parsedBody);
        const sanitizedRawBody = parsedBody && typeof parsedBody === "object"
            ? JSON.stringify(sanitizedParsedBody)
            : redactSecretText(rawBody);
        return {
            rawBody: sanitizedRawBody,
            parsedBody: sanitizedParsedBody,
            bodyReadError: bodyReadError
        };
    }

    function providerDiagnostics(response, body, retryAfterMs) {
        const diagnostics = {
            endpoint: ENDPOINT,
            url: response && response.url || ENDPOINT,
            status: response && Number.isFinite(response.status) ? response.status : 0,
            statusText: response && typeof response.statusText === "string" ? response.statusText : "",
            headers: exposedHeaders(response),
            retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null,
            rawBody: body && body.rawBody || "",
            parsedBody: body && body.parsedBody !== undefined ? body.parsedBody : null
        };
        if (body && body.bodyReadError) diagnostics.bodyReadError = clone(body.bodyReadError);
        return sanitizeValue(diagnostics);
    }

    function providerMessage(body) {
        const parsed = body && body.parsedBody;
        const message = parsed && parsed.error && parsed.error.message;
        return typeof message === "string" && message.trim() ? redactSecretText(message.trim()) : "";
    }

    function messageWithProvider(base, body) {
        const detail = providerMessage(body);
        return detail ? `${base} OpenRouter says: ${detail}` : base;
    }

    function selectedModelId() {
        return setup.AIRuntimeSettings.getSelectedModelId();
    }

    function normalizedRequestOptions(options) {
        const source = options && typeof options === "object" ? options : {};
        const modelId = typeof source.modelId === "string" && source.modelId.trim()
            ? source.modelId.trim()
            : selectedModelId();
        const maxTokens = Number.isFinite(source.maxTokens) && source.maxTokens > 0
            ? Math.floor(source.maxTokens)
            : MAX_TOKENS;
        const reasoningMaxTokens = source.reasoningMaxTokens === null || source.reasoningMaxTokens === false || source.reasoningMaxTokens === 0
            ? 0
            : Number.isFinite(source.reasoningMaxTokens) && source.reasoningMaxTokens > 0
                ? Math.floor(source.reasoningMaxTokens)
                : REASONING_MAX_TOKENS;
        const reasoningEffort = typeof source.reasoningEffort === "string" && source.reasoningEffort.trim()
            ? source.reasoningEffort.trim()
            : null;
        const temperature = Number.isFinite(source.temperature)
            ? source.temperature
            : TEMPERATURE;
        return {
            modelId: modelId,
            maxTokens: maxTokens,
            reasoningMaxTokens: reasoningMaxTokens,
            reasoningEffort: reasoningEffort,
            temperature: temperature
        };
    }

    async function chatWithOptions(messages, options, fetchOverride) {
        const requestOptions = normalizedRequestOptions(options);
        const modelId = requestOptions.modelId;
        const key = setup.AIRuntimeSettings.getKey();
        function failure(code, message, status, extra) {
            return safeFailure(code, message, status, Object.assign({ modelId: modelId }, extra || {}));
        }
        if (!key) return failure("API_KEY_MISSING", "Enter an OpenRouter API key before taking an AI turn.");
        const fetchFunction = fetchOverride || (typeof fetch === "function" ? fetch : null);
        if (!fetchFunction) return failure("NETWORK_ERROR", "Browser network access is unavailable.");
        const requestBody = {
            model: modelId,
            stream: false,
            max_tokens: requestOptions.maxTokens,
            temperature: requestOptions.temperature,
            messages: messages
        };
        if (requestOptions.reasoningEffort) {
            requestBody.reasoning = { effort: requestOptions.reasoningEffort };
        } else if (requestOptions.reasoningMaxTokens > 0) {
            requestBody.reasoning = { max_tokens: requestOptions.reasoningMaxTokens };
        }

        let response;
        try {
            response = await fetchFunction(ENDPOINT, {
                method: "POST",
                headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });
        } catch (error) {
            return failure("NETWORK_ERROR", "OpenRouter could not be reached. Check browser network or CORS access.", 0, {
                providerResponse: {
                    endpoint: ENDPOINT,
                    url: ENDPOINT,
                    status: 0,
                    statusText: "",
                    headers: {},
                    retryAfterMs: null,
                    rawBody: "",
                    parsedBody: null,
                    networkError: {
                        name: error && error.name || "Error",
                        message: redactSecretText(error && error.message || "Network request failed.")
                    }
                }
            });
        }

        const retryAfterMs = retryAfterMilliseconds(response);
        const body = await readBody(response);
        const diagnostics = providerDiagnostics(response, body, retryAfterMs);

        if (!response.ok) {
            if (response.status === 401) return failure("AUTHENTICATION_FAILED", messageWithProvider("OpenRouter authentication failed.", body), 401, { providerResponse: diagnostics });
            if (response.status === 402) return failure("INSUFFICIENT_CREDITS", messageWithProvider("OpenRouter reports insufficient credits.", body), 402, { providerResponse: diagnostics });
            if (response.status === 429) {
                const suffix = Number.isFinite(retryAfterMs)
                    ? ` Retry after ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
                    : "";
                return failure("RATE_LIMITED", messageWithProvider(`OpenRouter rate limited the request.${suffix}`, body), 429, {
                    retryAfterMs: retryAfterMs,
                    providerResponse: diagnostics
                });
            }
            if (response.status >= 500) return failure("PROVIDER_UNAVAILABLE", messageWithProvider("OpenRouter is temporarily unavailable.", body), response.status, { providerResponse: diagnostics });
            return failure("PROVIDER_REQUEST_FAILED", messageWithProvider("OpenRouter rejected the request.", body), response.status, { providerResponse: diagnostics });
        }

        const parsed = body.parsedBody;
        if (!parsed || typeof parsed !== "object") {
            return failure("MALFORMED_PROVIDER_RESPONSE", "OpenRouter returned an unreadable response.", response.status, { providerResponse: diagnostics });
        }
        const choice = parsed && parsed.choices && parsed.choices[0];
        const finishReason = choice && typeof choice.finish_reason === "string" ? choice.finish_reason : "";
        const content = choice && choice.message && choice.message.content;
        if (finishReason === "length") {
            return failure(
                "MODEL_OUTPUT_TRUNCATED",
                "OpenRouter stopped generation at the completion token limit before a complete assistant response was available.",
                response.status,
                { providerResponse: diagnostics }
            );
        }
        if (typeof content !== "string") {
            return failure("MALFORMED_PROVIDER_RESPONSE", "OpenRouter returned no assistant content.", response.status, { providerResponse: diagnostics });
        }
        return {
            ok: true,
            status: response.status,
            modelId: modelId,
            content: content,
            usage: parsed.usage || null,
            retryAfterMs: null,
            providerResponse: diagnostics,
            error: null
        };
    }

    async function chat(messages, fetchOverride) {
        return chatWithOptions(messages, null, fetchOverride);
    }

    const client = {
        ENDPOINT: ENDPOINT,
        MAX_TOKENS: MAX_TOKENS,
        REASONING_MAX_TOKENS: REASONING_MAX_TOKENS,
        getModelId: selectedModelId,
        chat: chat,
        chatWithOptions: chatWithOptions
    };
    Object.defineProperty(client, "MODEL", { enumerable: true, get: selectedModelId });
    setup.OpenRouterClient = client;
}());
