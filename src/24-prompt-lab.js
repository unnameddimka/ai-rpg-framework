(function () {
    "use strict";

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

    function setSource(request, label) {
        state.sourceRequest = {
            actorId: request.actorId,
            actorName: actorName(request.actorId),
            stage: request.stage,
            label: label,
            messages: clone(request.messages),
            availableActions: clone(request.availableActions || {})
        };
        state.selectedQueueCharacterId = request.actorId || null;
        state.editedSystemPrompt = systemPromptFrom(state.sourceRequest.messages);
        state.lastRun = null;
        state.status = `${label} loaded. Nothing will be applied to the game world.`;
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

    function clear() {
        state = createEmptyState();
        return ok();
    }

    function getSnapshot() {
        const queue = setup.AITurnScheduler.getQueueView();
        return clone({
            sourceRequest: state.sourceRequest,
            selectedQueueCharacterId: state.selectedQueueCharacterId,
            editedSystemPrompt: state.editedSystemPrompt,
            lastRun: state.lastRun,
            status: state.status,
            busy: state.busy,
            hasLastGameRequest: !!(setup.AITransientDebug && setup.AITransientDebug.lastRequest),
            queue: queue,
            executor: setup.AIRequestExecutor.getStatus(),
            nextQueuedCharacter: queue.head ? { id: queue.head.characterId, name: queue.head.recipientName } : null
        });
    }

    setup.PromptLab = {
        loadLastGameRequest: loadLastGameRequest,
        loadQueuedDecision: loadQueuedDecision,
        loadNextQueuedDecision: loadNextQueuedDecision,
        testQueued: testQueued,
        testNextQueued: testNextQueued,
        processNextLive: processNextLive,
        retryExact: retryExact,
        retryEdited: retryEdited,
        clear: clear,
        getSnapshot: getSnapshot,
        messagesWithSystemPrompt: messagesWithSystemPrompt
    };
}());
