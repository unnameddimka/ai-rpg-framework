(function () {
    "use strict";

    const MIN_INTERVAL_MS = 1000;
    const DEFAULT_RATE_LIMIT_MS = 10000;
    let chain = Promise.resolve();
    let queuedExecutions = 0;
    let activeExecutions = 0;
    let activeTransportCalls = 0;
    let nextTransportAt = 0;
    let lastStartedAt = 0;
    let lastFinishedAt = 0;

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

    async function chatWithPolicy(messages, client) {
        const transport = client || setup.OpenRouterClient;
        const timed = usesLiveTiming(transport);
        if (timed) {
            await wait(Math.max(0, nextTransportAt - Date.now()));
        }

        activeTransportCalls++;
        lastStartedAt = Date.now();
        let result;
        try {
            result = await transport.chat(messages);
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

    function execute(specification) {
        const spec = specification || {};
        queuedExecutions++;
        const work = chain.catch(function () {}).then(async function () {
            queuedExecutions--;
            activeExecutions++;
            try {
                const policyClient = {
                    chat: function (messages) {
                        return chatWithPolicy(messages, spec.client || setup.OpenRouterClient);
                    }
                };
                const result = await setup.AIProtocol.requestValidated(
                    clone(spec.messages || []),
                    spec.stage,
                    clone(spec.availableActions || {}),
                    policyClient
                );
                if (result && typeof result === "object") {
                    result.execution = {
                        purpose: spec.purpose || "unspecified",
                        actorId: spec.actorId || null
                    };
                }
                return result;
            } finally {
                activeExecutions--;
            }
        });
        chain = work.then(function () {}, function () {});
        return work;
    }

    function getStatus() {
        const now = Date.now();
        return {
            busy: activeExecutions > 0 || queuedExecutions > 0,
            activeExecutions: activeExecutions,
            queuedExecutions: queuedExecutions,
            activeTransportCalls: activeTransportCalls,
            minIntervalMs: MIN_INTERVAL_MS,
            nextTransportAt: nextTransportAt,
            cooldownRemainingMs: Math.max(0, nextTransportAt - now),
            lastStartedAt: lastStartedAt,
            lastFinishedAt: lastFinishedAt
        };
    }

    setup.AIRequestExecutor = {
        MIN_INTERVAL_MS: MIN_INTERVAL_MS,
        DEFAULT_RATE_LIMIT_MS: DEFAULT_RATE_LIMIT_MS,
        execute: execute,
        getStatus: getStatus
    };
}());
