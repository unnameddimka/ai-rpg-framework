(function () {
    "use strict";

    const MIN_INTERVAL_MS = 1000;
    const DEFAULT_RATE_LIMIT_MS = 10000;
    const MAX_EXCHANGE_HISTORY = 100;
    let chain = Promise.resolve();
    let queuedExecutions = 0;
    let activeExecutions = 0;
    let activeTransportCalls = 0;
    let activePurpose = null;
    let nextTransportAt = 0;
    let lastStartedAt = 0;
    let lastFinishedAt = 0;
    let nextExchangeId = 1;
    let exchangeHistory = [];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function wait(milliseconds) {
        if (milliseconds <= 0) return Promise.resolve();
        return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    }

    function usesLiveTiming(client) {
        return !client || client === setup.OpenRouterClient || client.enforceRequestTiming === true;
    }

    function safeResult(result) {
        return {
            ok: Boolean(result && result.ok),
            value: result && result.ok ? clone(result.value) : null,
            error: result && !result.ok ? clone(result.error) : null,
            repaired: Boolean(result && result.repaired),
            fallbackUsed: Boolean(result && result.fallbackUsed),
            modelId: result && result.modelId || null,
            usage: result && result.usage ? clone(result.usage) : null,
            rawContent: result && typeof result.rawContent === "string" ? result.rawContent : "",
            trace: result && result.trace ? clone(result.trace) : null,
            execution: result && result.execution ? clone(result.execution) : null,
            consolidation: result && result.consolidation ? clone(result.consolidation) : null
        };
    }

    function recordExchange(spec, result, startedAt, finishedAt) {
        exchangeHistory.push({
            id: nextExchangeId++,
            startedAt: new Date(startedAt).toISOString(),
            finishedAt: new Date(finishedAt).toISOString(),
            durationMs: Math.max(0, finishedAt - startedAt),
            request: {
                actorId: spec.actorId || null,
                purpose: spec.purpose || "unspecified",
                stage: spec.stage || null,
                modelId: result && result.modelId || null,
                messages: clone(spec.messages || []),
                requestOptions: spec.requestOptions ? clone(spec.requestOptions) : null
            },
            result: safeResult(result)
        });
        if (exchangeHistory.length > MAX_EXCHANGE_HISTORY) {
            exchangeHistory = exchangeHistory.slice(exchangeHistory.length - MAX_EXCHANGE_HISTORY);
        }
    }

    async function chatWithPolicy(messages, client, requestOptions) {
        const transport = client || setup.OpenRouterClient;
        const timed = usesLiveTiming(transport);
        if (timed) {
            await wait(Math.max(0, nextTransportAt - Date.now()));
        }

        activeTransportCalls++;
        lastStartedAt = Date.now();
        let result;
        try {
            if (requestOptions && typeof transport.chatWithOptions === "function") {
                result = await transport.chatWithOptions(messages, requestOptions);
            } else {
                result = await transport.chat(messages, requestOptions || undefined);
            }
        } catch (error) {
            result = {
                ok: false,
                status: 0,
                content: "",
                usage: null,
                retryAfterMs: null,
                error: {
                    code: "AI_TRANSPORT_EXCEPTION",
                    message: "The AI transport failed unexpectedly."
                }
            };
        } finally {
            activeTransportCalls--;
            lastFinishedAt = Date.now();
        }

        if (timed) {
            let delay = MIN_INTERVAL_MS;
            if (result && !result.ok && result.error && result.error.code === "RATE_LIMITED") {
                delay = Math.max(delay, Number.isFinite(result.retryAfterMs)
                    ? result.retryAfterMs
                    : DEFAULT_RATE_LIMIT_MS);
            }
            nextTransportAt = Math.max(nextTransportAt, Date.now() + delay);
        }
        return result;
    }

    async function runExecution(spec, operation) {
        activeExecutions++;
        activePurpose = activeExecutions > 1 ? "parallel" : (spec.purpose || "unspecified");
        const executionStartedAt = Date.now();
        let result;
        try {
            const policyClient = {
                chat: function (messages, requestOptions) {
                    return chatWithPolicy(
                        messages,
                        spec.client || setup.OpenRouterClient,
                        requestOptions || spec.requestOptions || null
                    );
                }
            };
            result = await operation(policyClient, spec);
            if (result && typeof result === "object") {
                result.execution = Object.assign({}, result.execution || {}, {
                    purpose: spec.purpose || "unspecified",
                    actorId: spec.actorId || null,
                    modelId: result.modelId || null
                });
            }
            return result;
        } catch (error) {
            result = {
                ok: false,
                value: null,
                error: {
                    code: "AI_EXECUTION_EXCEPTION",
                    message: "The model request failed unexpectedly."
                },
                modelId: null,
                usage: null,
                rawContent: "",
                trace: null,
                execution: {
                    purpose: spec.purpose || "unspecified",
                    actorId: spec.actorId || null,
                    modelId: null
                }
            };
            return result;
        } finally {
            const executionFinishedAt = Date.now();
            if (result && typeof result === "object") {
                recordExchange(spec, result, executionStartedAt, executionFinishedAt);
            }
            activeExecutions--;
            if (activeExecutions === 0) activePurpose = null;
            else if (activeExecutions > 1) activePurpose = "parallel";
        }
    }

    function enqueue(specification, operation) {
        const spec = specification || {};
        queuedExecutions++;
        const work = chain.catch(function () {}).then(async function () {
            queuedExecutions--;
            return runExecution(spec, operation);
        });
        chain = work.then(function () {}, function () {});
        return work;
    }

    function executeConcurrentOperation(specification, operation) {
        const spec = specification || {};
        return runExecution(spec, operation);
    }

    function execute(specification) {
        const spec = specification || {};
        return enqueue(spec, function (policyClient) {
            return setup.AIProtocol.requestValidated(
                clone(spec.messages || []),
                spec.stage,
                policyClient
            );
        });
    }

    function invalidCustomSpec() {
        return Promise.resolve({
            ok: false,
            value: null,
            error: { code: "AI_EXECUTOR_INVALID_SPEC", message: "Custom model execution requires a run function." },
            modelId: null,
            usage: null,
            rawContent: "",
            trace: null
        });
    }

    function executeCustom(specification) {
        const spec = specification || {};
        if (typeof spec.run !== "function") return invalidCustomSpec();
        return enqueue(spec, function (policyClient) {
            return spec.run(policyClient);
        });
    }

    function executeCustomConcurrent(specification) {
        const spec = specification || {};
        if (typeof spec.run !== "function") return invalidCustomSpec();
        return executeConcurrentOperation(spec, function (policyClient) {
            return spec.run(policyClient);
        });
    }

    function getStatus() {
        const now = Date.now();
        return {
            busy: activeExecutions > 0 || queuedExecutions > 0,
            activeExecutions: activeExecutions,
            queuedExecutions: queuedExecutions,
            activeTransportCalls: activeTransportCalls,
            activePurpose: activePurpose,
            minIntervalMs: MIN_INTERVAL_MS,
            nextTransportAt: nextTransportAt,
            cooldownRemainingMs: Math.max(0, nextTransportAt - now),
            lastStartedAt: lastStartedAt,
            lastFinishedAt: lastFinishedAt,
            exchangeHistoryCount: exchangeHistory.length
        };
    }

    function getExchangeHistory() {
        return {
            maxEntries: MAX_EXCHANGE_HISTORY,
            count: exchangeHistory.length,
            entries: clone(exchangeHistory)
        };
    }

    function clearExchangeHistory() {
        exchangeHistory = [];
        nextExchangeId = 1;
        return { ok: true };
    }

    setup.AIRequestExecutor = {
        MIN_INTERVAL_MS: MIN_INTERVAL_MS,
        DEFAULT_RATE_LIMIT_MS: DEFAULT_RATE_LIMIT_MS,
        MAX_EXCHANGE_HISTORY: MAX_EXCHANGE_HISTORY,
        execute: execute,
        executeCustom: executeCustom,
        executeCustomConcurrent: executeCustomConcurrent,
        getStatus: getStatus,
        getExchangeHistory: getExchangeHistory,
        clearExchangeHistory: clearExchangeHistory
    };
}());
