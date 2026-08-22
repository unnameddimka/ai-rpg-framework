(function () {
    "use strict";

    const AI_TRANSPORT_LIMIT = 200;
    const NETWORK_LIMIT = 100;
    let nextAITransportId = 1;
    let nextNetworkId = 1;
    let aiTransportEntries = [];
    let networkEntries = [];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function redactText(value) {
        let text = String(value === undefined || value === null ? "" : value);
        try {
            const key = setup.AIRuntimeSettings && typeof setup.AIRuntimeSettings.getKey === "function"
                ? setup.AIRuntimeSettings.getKey()
                : "";
            if (key && key.length >= 8) text = text.split(key).join("[REDACTED_API_KEY]");
        } catch (error) {}
        return text
            .replace(/sk-or-v1-[A-Za-z0-9_-]{12,}/g, "[REDACTED_OPENROUTER_KEY]")
            .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]");
    }

    function sanitize(value, seen, depth) {
        depth = depth || 0;
        if (depth > 40) return "[MaxDepth]";
        if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value === undefined ? null : value;
        if (typeof value === "string") return redactText(value);
        if (typeof value !== "object") return String(value);
        seen = seen || new WeakSet();
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        if (Array.isArray(value)) return value.map(function (item) { return sanitize(item, seen, depth + 1); });
        const output = {};
        Object.keys(value).forEach(function (key) {
            const normalized = String(key).toLowerCase().replace(/[^a-z]/g, "");
            if (["apikey", "authorization", "accesstoken", "refreshtoken", "password", "secret"].includes(normalized)) {
                output[key] = "[REDACTED]";
            } else if (normalized === "ip" || normalized === "ipaddress") {
                output[key] = "[REDACTED_IP]";
            } else {
                output[key] = sanitize(value[key], seen, depth + 1);
            }
        });
        return output;
    }

    function trim(list, limit) {
        if (list.length > limit) list.splice(0, list.length - limit);
    }

    function sanitizedEndpoint(url) {
        try {
            const parsed = new URL(String(url));
            return parsed.origin + parsed.pathname;
        } catch (error) {
            return redactText(url);
        }
    }

    function beginAITransport(metadata) {
        const meta = metadata && typeof metadata === "object" ? metadata : {};
        const now = Date.now();
        const entry = {
            id: nextAITransportId++,
            startedAt: new Date(now).toISOString(),
            finishedAt: null,
            durationMs: null,
            state: "in_flight",
            actorId: meta.actorId || null,
            purpose: meta.purpose || null,
            stage: meta.stage || null,
            modelId: meta.modelId || null,
            provider: meta.provider || "OpenRouter",
            endpoint: sanitizedEndpoint(meta.endpoint || ""),
            attempt: Number.isFinite(meta.attempt) ? meta.attempt : null,
            ok: null,
            status: null,
            statusText: "",
            timeout: false,
            error: null,
            rawContent: "",
            providerResponse: null
        };
        aiTransportEntries.push(entry);
        trim(aiTransportEntries, AI_TRANSPORT_LIMIT);
        return { id: entry.id, startedAt: now };
    }

    function completeAITransport(token, details) {
        try {
            const data = details && typeof details === "object" ? details : {};
            const entry = aiTransportEntries.find(function (candidate) { return candidate.id === token.id; });
            if (!entry) return null;
            const now = Date.now();
            entry.finishedAt = new Date(now).toISOString();
            entry.durationMs = Math.max(0, now - token.startedAt);
            entry.state = "finished";
            entry.ok = Boolean(data.ok);
            entry.status = Number.isFinite(Number(data.status)) ? Number(data.status) : 0;
            entry.statusText = redactText(data.statusText || "");
            entry.timeout = Boolean(data.timeout);
            entry.error = data.error ? sanitize(data.error, new WeakSet(), 0) : null;
            entry.rawContent = typeof data.rawContent === "string" ? redactText(data.rawContent) : "";
            entry.providerResponse = data.providerResponse ? sanitize(data.providerResponse, new WeakSet(), 0) : null;
            return clone(entry);
        } catch (error) {
            return null;
        }
    }

    function networkSummary(value) {
        if (!value || typeof value !== "object") return null;
        const summary = { keys: Object.keys(value).slice(0, 40) };
        if (typeof value.success === "boolean") summary.success = value.success;
        const message = value.message || value.error || value.reason;
        if (typeof message === "string") summary.message = redactText(message).slice(0, 1000);
        if (value.current && typeof value.current === "object") summary.currentKeys = Object.keys(value.current).slice(0, 40);
        return summary;
    }

    function beginNetwork(metadata) {
        const meta = metadata && typeof metadata === "object" ? metadata : {};
        const now = Date.now();
        const entry = {
            id: nextNetworkId++,
            startedAt: new Date(now).toISOString(),
            finishedAt: null,
            durationMs: null,
            state: "in_flight",
            purpose: meta.purpose || null,
            stage: meta.stage || null,
            service: meta.service || null,
            endpoint: sanitizedEndpoint(meta.url || ""),
            ok: null,
            status: null,
            statusText: "",
            timeout: false,
            error: null,
            responseSummary: null
        };
        networkEntries.push(entry);
        trim(networkEntries, NETWORK_LIMIT);
        return { id: entry.id, startedAt: now };
    }

    function completeNetwork(token, details) {
        try {
            const data = details && typeof details === "object" ? details : {};
            const entry = networkEntries.find(function (candidate) { return candidate.id === token.id; });
            if (!entry) return null;
            const now = Date.now();
            entry.finishedAt = new Date(now).toISOString();
            entry.durationMs = Math.max(0, now - token.startedAt);
            entry.state = "finished";
            entry.ok = Boolean(data.ok);
            entry.status = Number.isFinite(Number(data.status)) ? Number(data.status) : 0;
            entry.statusText = redactText(data.statusText || "");
            entry.timeout = Boolean(data.timeout);
            entry.error = data.error ? sanitize(data.error, new WeakSet(), 0) : null;
            entry.responseSummary = data.responseSummary ? sanitize(data.responseSummary, new WeakSet(), 0) : null;
            return clone(entry);
        } catch (error) {
            return null;
        }
    }

    async function fetchJson(specification) {
        const spec = specification && typeof specification === "object" ? specification : {};
        const fetcher = spec.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
        if (!fetcher) throw new Error("Browser network access is unavailable.");
        const token = beginNetwork(spec);
        let response = null;
        try {
            response = await fetcher(spec.url, spec.fetchOptions || undefined);
            let data;
            if (response && typeof response.text === "function") {
                const raw = await response.text();
                try { data = raw ? JSON.parse(raw) : null; }
                catch (error) {
                    completeNetwork(token, {
                        ok: false,
                        status: response && response.status,
                        statusText: response && response.statusText,
                        error: { code: "NETWORK_JSON_PARSE_FAILED", message: error && error.message || "Response was not valid JSON." }
                    });
                    const parseError = new Error("External API returned invalid JSON.");
                    parseError.code = "NETWORK_JSON_PARSE_FAILED";
                    throw parseError;
                }
            } else if (response && typeof response.json === "function") {
                data = await response.json();
            } else {
                throw new Error("External API returned no readable response body.");
            }
            if (!response || !response.ok) {
                completeNetwork(token, {
                    ok: false,
                    status: response && response.status,
                    statusText: response && response.statusText,
                    error: { code: "NETWORK_HTTP_ERROR", message: `External API request failed with HTTP ${response && response.status || 0}.` },
                    responseSummary: networkSummary(data)
                });
                const httpError = new Error(`External API request failed with HTTP ${response && response.status || 0}.`);
                httpError.code = "NETWORK_HTTP_ERROR";
                throw httpError;
            }
            completeNetwork(token, {
                ok: true,
                status: response.status,
                statusText: response.statusText,
                responseSummary: networkSummary(data)
            });
            return data;
        } catch (error) {
            const existing = networkEntries.find(function (entry) { return entry.id === token.id; });
            if (existing && existing.state === "in_flight") {
                completeNetwork(token, {
                    ok: false,
                    status: response && response.status,
                    statusText: response && response.statusText,
                    error: {
                        code: error && error.code || "NETWORK_FETCH_FAILED",
                        name: error && error.name || "Error",
                        message: error && error.message || "External network request failed."
                    }
                });
            }
            throw error;
        }
    }

    setup.RuntimeDiagnostics = {
        AI_TRANSPORT_LIMIT: AI_TRANSPORT_LIMIT,
        NETWORK_LIMIT: NETWORK_LIMIT,
        beginAITransport: beginAITransport,
        completeAITransport: completeAITransport,
        beginNetwork: beginNetwork,
        completeNetwork: completeNetwork,
        fetchJson: fetchJson,
        getAITransportLog: function () { return { maxEntries: AI_TRANSPORT_LIMIT, count: aiTransportEntries.length, entries: clone(aiTransportEntries) }; },
        getNetworkLog: function () { return { maxEntries: NETWORK_LIMIT, count: networkEntries.length, entries: clone(networkEntries) }; },
        clear: function () { aiTransportEntries = []; networkEntries = []; nextAITransportId = 1; nextNetworkId = 1; return { ok: true }; }
    };
}());
