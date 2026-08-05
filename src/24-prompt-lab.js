(function () {
    "use strict";

    const EXCHANGE_LOG_SCHEMA = "ai-rpg.ai-exchange-log";
    const EXCHANGE_LOG_VERSION = 1;
    const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
    let state = createEmptyState();

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function ok(extra) {
        return Object.assign({ ok: true }, extra || {});
    }

    function fail(code, message) {
        return { ok: false, error: { code: code, message: message } };
    }

    function createEmptyState() {
        return {
            sourceRequest: null,
            selectedQueueCharacterId: null,
            editedSystemPrompt: "",
            lastRun: null,
            importedExchange: null,
            status: "The crystal sphere is quiet.",
            busy: false
        };
    }

    function systemPromptFrom(messages) {
        const system = (messages || []).find(function (message) { return message.role === "system"; });
        return system && typeof system.content === "string" ? system.content : "";
    }

    function actorName(actorId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        return actor && actor.name || actorId || "unknown";
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeSourceRequest(request, fallbackLabel) {
        if (!isPlainObject(request)) return fail("PROMPT_LAB_IMPORT_SOURCE", "The exchange log does not contain a valid source request.");
        if (typeof request.actorId !== "string" || !request.actorId.trim()) {
            return fail("PROMPT_LAB_IMPORT_ACTOR", "The exchange log source request has no actor ID.");
        }
        if (request.stage !== "decision" && request.stage !== "result") {
            return fail("PROMPT_LAB_IMPORT_STAGE", "The exchange log source request has an unsupported protocol stage.");
        }
        if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 20) {
            return fail("PROMPT_LAB_IMPORT_MESSAGES", "The exchange log source request has an invalid message list.");
        }
        for (const message of request.messages) {
            if (!isPlainObject(message) || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
                return fail("PROMPT_LAB_IMPORT_MESSAGE", "The exchange log contains a malformed chat message.");
            }
        }
        if (!isPlainObject(request.availableActions || {})) {
            return fail("PROMPT_LAB_IMPORT_ACTIONS", "The exchange log contains malformed available-action data.");
        }
        return ok({
            sourceRequest: {
                actorId: request.actorId,
                actorName: typeof request.actorName === "string" && request.actorName.trim()
                    ? request.actorName
                    : request.actorId,
                stage: request.stage,
                label: typeof request.label === "string" && request.label.trim()
                    ? request.label
                    : fallbackLabel,
                messages: clone(request.messages),
                availableActions: clone(request.availableActions || {})
            }
        });
    }

    function setSource(request, label, options) {
        options = options || {};
        state.sourceRequest = {
            actorId: request.actorId,
            actorName: options.actorName || request.actorName || actorName(request.actorId),
            stage: request.stage,
            label: label,
            messages: clone(request.messages),
            availableActions: clone(request.availableActions || {})
        };
        state.selectedQueueCharacterId = request.actorId || null;
        state.editedSystemPrompt = systemPromptFrom(state.sourceRequest.messages);
        state.lastRun = options.lastRun ? clone(options.lastRun) : null;
        state.importedExchange = options.importedExchange ? clone(options.importedExchange) : null;
        state.status = options.status || `${label} loaded. Nothing will be applied to the game world.`;
        return ok({ sourceRequest: clone(state.sourceRequest) });
    }

    function loadLastGameRequest() {
        const request = setup.AITransientDebug && setup.AITransientDebug.lastRequest;
        if (!request) {
            const missing = fail("PROMPT_LAB_NO_GAME_REQUEST", "No game AI request has been captured yet.");
            state.status = missing.error.message;
            return missing;
        }
        return setSource(request, `Last game ${request.stage} request`);
    }

    function loadQueuedDecision(characterId) {
        const queue = setup.AITurnScheduler.getQueueView();
        const selected = characterId
            ? queue.entries.find(function (entry) { return entry.characterId === characterId; })
            : queue.head;
        if (!selected) {
            const missing = fail("PROMPT_LAB_QUEUE_EMPTY", "No matching pending AI turn is available to inspect.");
            state.status = missing.error.message;
            return missing;
        }
        const request = setup.AITurnScheduler.buildDecisionRequest(selected.characterId);
        if (!request.ok) {
            state.status = request.error.message;
            return request;
        }
        return setSource(request, `Queued decision #${selected.position} for ${selected.recipientName}`);
    }

    function loadNextQueuedDecision() {
        return loadQueuedDecision(null);
    }

    function messagesWithSystemPrompt(messages, prompt) {
        const edited = clone(messages || []);
        const systemIndex = edited.findIndex(function (message) { return message.role === "system"; });
        if (systemIndex < 0) edited.unshift({ role: "system", content: prompt });
        else edited[systemIndex].content = prompt;
        return edited;
    }

    function statusForResult(result, label) {
        if (result.ok) {
            const repaired = result.repaired ? " after one repair" : "";
            return `${label} returned valid protocol data${repaired}. The result was not applied to the game.`;
        }
        const details = result.error && Array.isArray(result.error.details) && result.error.details.length
            ? ` ${result.error.details.join(" ")}`
            : "";
        return `${label} failed. ${result.error && result.error.message || "Unknown prompt-lab failure."}${details}`;
    }

    async function runMessages(messages, label, client) {
        if (state.busy) return fail("PROMPT_LAB_BUSY", "The crystal sphere is already considering a request.");
        if (!state.sourceRequest) return fail("PROMPT_LAB_NO_SOURCE", "Load a game request or a queued decision first.");
        state.busy = true;
        state.status = `${label}...`;
        try {
            const result = await setup.AIRequestExecutor.execute({
                actorId: state.sourceRequest.actorId,
                purpose: "prompt-lab-dry-run",
                messages: messages,
                stage: state.sourceRequest.stage,
                availableActions: state.sourceRequest.availableActions,
                client: client || setup.OpenRouterClient
            });
            state.lastRun = {
                label: label,
                ok: result.ok,
                value: result.ok ? clone(result.value) : null,
                error: result.ok ? null : clone(result.error),
                trace: clone(result.trace),
                testedMessages: clone(messages)
            };
            state.status = statusForResult(result, label);
            return result;
        } finally {
            state.busy = false;
        }
    }

    async function testQueued(characterId, client) {
        const loaded = loadQueuedDecision(characterId);
        if (!loaded.ok) return loaded;
        return runMessages(clone(state.sourceRequest.messages), `Testing queued decision for ${state.sourceRequest.actorName}`, client);
    }

    async function testNextQueued(client) {
        const queue = setup.AITurnScheduler.getQueueView();
        return testQueued(queue.head && queue.head.characterId, client);
    }

    async function processNextLive(client) {
        if (state.busy) return fail("PROMPT_LAB_BUSY", "The crystal sphere is already considering a request.");
        state.busy = true;
        state.status = "Processing the next queued AI turn and applying it to the world...";
        try {
            const result = await setup.AITurnScheduler.processNext(client || setup.OpenRouterClient);
            state.status = result.ok
                ? `Processed live AI turn for ${actorName(result.actorId)}. The queue advanced.`
                : `Live AI turn failed. ${result.error && result.error.message || "Unknown failure."}`;
            return result;
        } finally {
            state.busy = false;
        }
    }

    async function retryExact(client) {
        if (!state.sourceRequest) {
            const loaded = loadLastGameRequest();
            if (!loaded.ok) return loaded;
        }
        return runMessages(clone(state.sourceRequest.messages), "Retrying exact request", client);
    }

    async function retryEdited(systemPrompt, client) {
        if (!state.sourceRequest) {
            const loaded = loadLastGameRequest();
            if (!loaded.ok) return loaded;
        }
        if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
            const invalid = fail("PROMPT_LAB_SYSTEM_PROMPT_EMPTY", "The edited system prompt is empty.");
            state.status = invalid.error.message;
            return invalid;
        }
        state.editedSystemPrompt = systemPrompt;
        return runMessages(
            messagesWithSystemPrompt(state.sourceRequest.messages, systemPrompt),
            "Retrying with edited system prompt",
            client
        );
    }

    function runFromHistoryEntry(entry) {
        if (!entry || !entry.result) return null;
        return {
            label: `Recorded ${entry.request && entry.request.purpose || "AI"} exchange`,
            ok: Boolean(entry.result.ok),
            value: entry.result.ok ? clone(entry.result.value) : null,
            error: entry.result.ok ? null : clone(entry.result.error),
            trace: clone(entry.result.trace),
            testedMessages: clone(entry.request && entry.request.messages || [])
        };
    }

    function sourceFromHistoryEntry(entry) {
        if (!entry || !entry.request) return null;
        return {
            actorId: entry.request.actorId || "unknown",
            actorName: entry.request.actorId || "unknown",
            stage: entry.request.stage,
            label: `Recorded ${entry.request.purpose || "AI"} request`,
            messages: clone(entry.request.messages || []),
            availableActions: clone(entry.request.availableActions || {})
        };
    }

    function redactSecrets(value) {
        const currentKey = setup.AIRuntimeSettings && typeof setup.AIRuntimeSettings.getKey === "function"
            ? setup.AIRuntimeSettings.getKey()
            : "";
        function visit(item) {
            if (typeof item === "string") {
                let text = item;
                if (currentKey && currentKey.length >= 8) text = text.split(currentKey).join("[REDACTED_API_KEY]");
                return text
                    .replace(/sk-or-v1-[A-Za-z0-9_-]{12,}/g, "[REDACTED_OPENROUTER_KEY]")
                    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, "Bearer [REDACTED]");
            }
            if (Array.isArray(item)) return item.map(visit);
            if (isPlainObject(item)) {
                const result = {};
                Object.keys(item).forEach(function (key) {
                    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
                    if (["apikey", "openrouterkey", "authorization", "accesstoken"].includes(normalized)) {
                        result[key] = "[REDACTED]";
                    } else {
                        result[key] = visit(item[key]);
                    }
                });
                return result;
            }
            return item;
        }
        return visit(value);
    }

    function exportFilename(exportedAt) {
        return `ai-rpg-ai-exchange-${exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-")}.json`;
    }

    function buildExchangeLog(now) {
        const history = setup.AIRequestExecutor.getExchangeHistory();
        const latest = history.entries.length ? history.entries[history.entries.length - 1] : null;
        const sphereSource = state.sourceRequest ? clone(state.sourceRequest) : null;
        const sphereRun = state.lastRun ? clone(state.lastRun) : null;
        const source = sphereSource && sphereRun
            ? sphereSource
            : (sourceFromHistoryEntry(latest) || sphereSource);
        const lastRun = sphereSource && sphereRun
            ? sphereRun
            : runFromHistoryEntry(latest);
        if (!source && history.count === 0) {
            const missing = fail("PROMPT_LAB_EXPORT_EMPTY", "There is no AI exchange to export yet.");
            state.status = missing.error.message;
            return missing;
        }
        const exportedAt = new Date(now === undefined ? Date.now() : now).toISOString();
        const world = setup.Game.getWorld();
        const humanId = setup.Game.getHumanCharacterId();
        const human = world.entities[humanId];
        const data = redactSecrets({
            schema: EXCHANGE_LOG_SCHEMA,
            version: EXCHANGE_LOG_VERSION,
            exportedAt: exportedAt,
            application: "AI RPG Framework",
            runtime: {
                provider: "OpenRouter",
                model: setup.OpenRouterClient && setup.OpenRouterClient.MODEL || null
            },
            security: {
                apiKeyIncluded: false,
                note: "API keys and authorization headers are not exported."
            },
            focus: {
                sourceRequest: clone(source),
                lastRun: clone(lastRun)
            },
            sphereState: {
                sourceRequest: sphereSource,
                lastRun: sphereRun
            },
            exchangeHistory: clone(history),
            schedulerQueue: clone(setup.AITurnScheduler.getQueueView()),
            gameSummary: {
                turn: Number.isFinite(world.turn) ? world.turn : null,
                humanCharacterId: humanId || null,
                humanLocationId: human && human.locationId || null
            }
        });
        const text = JSON.stringify(data, null, 2);
        const currentKey = setup.AIRuntimeSettings && setup.AIRuntimeSettings.getKey ? setup.AIRuntimeSettings.getKey() : "";
        if (currentKey && text.includes(currentKey)) {
            const unsafe = fail("PROMPT_LAB_EXPORT_SECRET", "The exchange log could not be exported safely because a secret remained in it.");
            state.status = unsafe.error.message;
            return unsafe;
        }
        return ok({ data: data, text: text, filename: exportFilename(exportedAt) });
    }

    function exportExchangeLog(now) {
        const result = buildExchangeLog(now);
        if (result.ok) {
            state.status = `Prepared ${result.filename}. The file contains ${result.data.exchangeHistory.count} recorded exchange(s) and no API key.`;
        }
        return result;
    }

    function parseExchangeLog(input, filename) {
        let text;
        if (typeof input === "string") text = input;
        else if (isPlainObject(input)) text = JSON.stringify(input);
        else return fail("PROMPT_LAB_IMPORT_TYPE", "Choose a JSON exchange-log file.");
        if (text.length > MAX_IMPORT_BYTES) return fail("PROMPT_LAB_IMPORT_SIZE", "The exchange-log file is larger than 5 MB.");
        let data;
        try { data = JSON.parse(text); }
        catch (error) { return fail("PROMPT_LAB_IMPORT_JSON", "The selected file is not valid JSON."); }
        if (!isPlainObject(data) || data.schema !== EXCHANGE_LOG_SCHEMA || data.version !== EXCHANGE_LOG_VERSION) {
            return fail("PROMPT_LAB_IMPORT_SCHEMA", "The selected file is not a supported AI RPG exchange log.");
        }
        const focus = isPlainObject(data.focus) ? data.focus : {};
        let source = focus.sourceRequest;
        let lastRun = focus.lastRun || null;
        const entries = data.exchangeHistory && Array.isArray(data.exchangeHistory.entries)
            ? data.exchangeHistory.entries
            : [];
        const latest = entries.length ? entries[entries.length - 1] : null;
        if (!source) source = sourceFromHistoryEntry(latest);
        if (!lastRun) lastRun = runFromHistoryEntry(latest);
        const normalized = normalizeSourceRequest(source, `Imported request from ${filename || "exchange log"}`);
        if (!normalized.ok) return normalized;
        return ok({
            data: clone(data),
            sourceRequest: normalized.sourceRequest,
            lastRun: lastRun ? clone(lastRun) : null,
            filename: filename || "exchange-log.json"
        });
    }

    function importExchangeLog(input, filename) {
        if (state.busy) return fail("PROMPT_LAB_BUSY", "The crystal sphere is already considering a request.");
        const parsed = parseExchangeLog(input, filename);
        if (!parsed.ok) {
            state.status = parsed.error.message;
            return parsed;
        }
        const imported = {
            filename: parsed.filename,
            data: parsed.data
        };
        return setSource(parsed.sourceRequest, parsed.sourceRequest.label, {
            actorName: parsed.sourceRequest.actorName,
            lastRun: parsed.lastRun,
            importedExchange: imported,
            status: `Imported ${parsed.filename}. The recorded response is visible below and can be replayed without a key.`
        });
    }

    function replayAttemptsFromImported() {
        const imported = state.importedExchange && state.importedExchange.data;
        const run = imported && imported.focus && imported.focus.lastRun;
        if (run && run.trace && Array.isArray(run.trace.attempts)) return clone(run.trace.attempts);
        const entries = imported && imported.exchangeHistory && Array.isArray(imported.exchangeHistory.entries)
            ? imported.exchangeHistory.entries
            : [];
        const latest = entries.length ? entries[entries.length - 1] : null;
        return latest && latest.result && latest.result.trace && Array.isArray(latest.result.trace.attempts)
            ? clone(latest.result.trace.attempts)
            : [];
    }

    function replayFailureFromImported() {
        const imported = state.importedExchange && state.importedExchange.data;
        const run = imported && imported.focus && imported.focus.lastRun;
        if (run && run.trace && run.trace.safeError) return clone(run.trace.safeError);
        const entries = imported && imported.exchangeHistory && Array.isArray(imported.exchangeHistory.entries)
            ? imported.exchangeHistory.entries
            : [];
        const latest = entries.length ? entries[entries.length - 1] : null;
        return latest && latest.result && latest.result.trace && latest.result.trace.safeError
            ? clone(latest.result.trace.safeError)
            : null;
    }

    async function replayImportedExchange() {
        if (!state.importedExchange) {
            const missing = fail("PROMPT_LAB_REPLAY_NOT_IMPORTED", "Import an exchange log before replaying it.");
            state.status = missing.error.message;
            return missing;
        }
        const attempts = replayAttemptsFromImported();
        if (!attempts.length) {
            const missing = fail("PROMPT_LAB_REPLAY_EMPTY", "The imported exchange log has no recorded model attempts to replay.");
            state.status = missing.error.message;
            return missing;
        }
        const safeError = replayFailureFromImported();
        let index = 0;
        const replayClient = {
            chat: async function () {
                const attempt = attempts[index++];
                if (!attempt) {
                    return { ok: false, content: "", usage: null, error: { code: "REPLAY_EXHAUSTED", message: "The recorded exchange ended before replay completed." } };
                }
                if (!attempt.rawContent && safeError && index === attempts.length) {
                    return { ok: false, content: "", usage: attempt.usage || null, error: clone(safeError) };
                }
                return {
                    ok: true,
                    content: typeof attempt.rawContent === "string" ? attempt.rawContent : "",
                    usage: clone(attempt.usage || null)
                };
            }
        };
        return runMessages(clone(state.sourceRequest.messages), "Replaying recorded exchange", replayClient);
    }

    function clear() {
        state = createEmptyState();
        return ok();
    }

    function clearExchangeHistory() {
        if (state.busy) return fail("PROMPT_LAB_BUSY", "The crystal sphere is already considering a request.");
        setup.AIRequestExecutor.clearExchangeHistory();
        state.status = "The transient AI exchange history was cleared.";
        return ok();
    }

    function getSnapshot() {
        const queue = setup.AITurnScheduler.getQueueView();
        const history = setup.AIRequestExecutor.getExchangeHistory();
        return clone({
            sourceRequest: state.sourceRequest,
            selectedQueueCharacterId: state.selectedQueueCharacterId,
            editedSystemPrompt: state.editedSystemPrompt,
            lastRun: state.lastRun,
            status: state.status,
            busy: state.busy,
            hasLastGameRequest: !!(setup.AITransientDebug && setup.AITransientDebug.lastRequest),
            hasImportedExchange: Boolean(state.importedExchange),
            importedFilename: state.importedExchange && state.importedExchange.filename || null,
            canReplayImported: replayAttemptsFromImported().length > 0,
            canExport: Boolean(state.sourceRequest || state.lastRun || history.count > 0),
            exchangeHistoryCount: history.count,
            queue: queue,
            executor: setup.AIRequestExecutor.getStatus(),
            nextQueuedCharacter: queue.head ? { id: queue.head.characterId, name: queue.head.recipientName } : null
        });
    }

    setup.PromptLab = {
        EXCHANGE_LOG_SCHEMA: EXCHANGE_LOG_SCHEMA,
        EXCHANGE_LOG_VERSION: EXCHANGE_LOG_VERSION,
        MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
        loadLastGameRequest: loadLastGameRequest,
        loadQueuedDecision: loadQueuedDecision,
        loadNextQueuedDecision: loadNextQueuedDecision,
        testQueued: testQueued,
        testNextQueued: testNextQueued,
        processNextLive: processNextLive,
        retryExact: retryExact,
        retryEdited: retryEdited,
        replayImportedExchange: replayImportedExchange,
        buildExchangeLog: buildExchangeLog,
        exportExchangeLog: exportExchangeLog,
        parseExchangeLog: parseExchangeLog,
        importExchangeLog: importExchangeLog,
        clearExchangeHistory: clearExchangeHistory,
        clear: clear,
        getSnapshot: getSnapshot,
        messagesWithSystemPrompt: messagesWithSystemPrompt
    };
}());
