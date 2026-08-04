(function () {
    "use strict";

    const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
    const MODEL = "thedrummer/cydonia-24b-v4.1";
    const MAX_TOKENS = 1200;
    const TEMPERATURE = 0.4;

    function safeFailure(code, message, status, extra) {
        return Object.assign({
            ok: false,
            status: status || 0,
            content: "",
            usage: null,
            retryAfterMs: null,
            error: { code: code, message: message }
        }, extra || {});
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

    async function chat(messages, fetchOverride) {
        const key = setup.AIRuntimeSettings.getKey();
        if (!key) return safeFailure("API_KEY_MISSING", "Enter an OpenRouter API key before taking an AI turn.");
        const fetchFunction = fetchOverride || (typeof fetch === "function" ? fetch : null);
        if (!fetchFunction) return safeFailure("NETWORK_ERROR", "Browser network access is unavailable.");
        let response;
        try {
            response = await fetchFunction(ENDPOINT, {
                method: "POST",
                headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: MODEL, stream: false, max_tokens: MAX_TOKENS, temperature: TEMPERATURE, messages: messages })
            });
        } catch (error) {
            return safeFailure("NETWORK_ERROR", "OpenRouter could not be reached. Check browser network or CORS access.");
        }
        if (!response.ok) {
            if (response.status === 401) return safeFailure("AUTHENTICATION_FAILED", "OpenRouter authentication failed.", 401);
            if (response.status === 402) return safeFailure("INSUFFICIENT_CREDITS", "OpenRouter reports insufficient credits.", 402);
            if (response.status === 429) {
                const retryAfterMs = retryAfterMilliseconds(response);
                const suffix = Number.isFinite(retryAfterMs)
                    ? ` Retry after ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
                    : "";
                return safeFailure("RATE_LIMITED", `OpenRouter rate limited the request.${suffix}`, 429, { retryAfterMs: retryAfterMs });
            }
            if (response.status >= 500) return safeFailure("PROVIDER_UNAVAILABLE", "OpenRouter is temporarily unavailable.", response.status);
            return safeFailure("PROVIDER_REQUEST_FAILED", "OpenRouter rejected the request.", response.status);
        }
        let body;
        try { body = await response.json(); } catch (error) { return safeFailure("MALFORMED_PROVIDER_RESPONSE", "OpenRouter returned an unreadable response.", response.status); }
        const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
        if (typeof content !== "string") return safeFailure("MALFORMED_PROVIDER_RESPONSE", "OpenRouter returned no assistant content.", response.status);
        return { ok: true, status: response.status, content: content, usage: body.usage || null, retryAfterMs: null, error: null };
    }

    setup.OpenRouterClient = { ENDPOINT: ENDPOINT, MODEL: MODEL, chat: chat };
}());
