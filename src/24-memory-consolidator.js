(function () {
    "use strict";

    const RETAIN_RECENT_COUNT = 10;
    const AUTO_THRESHOLD = 30;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }

    function recordTransientResult(characterId, messages, result) {
        if (!setup.AITransientDebug) return;
        setup.AITransientDebug.lastUsage = result && result.usage ? clone(result.usage) : null;
        setup.AITransientDebug.lastSafeError = result && !result.ok && result.error ? result.error.message : "";
    }

    async function compress(characterId, client, options) {
        options = options && typeof options === "object" ? options : {};
        const automatic = options.automatic === true;
        const executorStatus = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus
            ? setup.AIRequestExecutor.getStatus()
            : { busy: false };
        if (!automatic && executorStatus.busy) {
            return failure("MEMORY_CONSOLIDATION_BUSY", "Another AI request is already in progress.");
        }
        if (!automatic && setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight()) {
            return failure("MEMORY_CONSOLIDATION_BUSY", "An AI reaction wave is already in progress.");
        }

        const plan = setup.AIMemory.prepareConsolidation(characterId, RETAIN_RECENT_COUNT);
        if (!plan.ok) return plan;
        if (plan.nothingToCompress) {
            return {
                ok: true,
                actorId: characterId,
                nothingToCompress: true,
                consolidation: clone(plan.summary)
            };
        }

        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before compressing character memory.");
        }

        const messages = setup.AIProtocol.memoryConsolidationMessages(plan.context);
        const executeCustom = options.parallel === true && setup.AIRequestExecutor.executeCustomConcurrent
            ? setup.AIRequestExecutor.executeCustomConcurrent
            : setup.AIRequestExecutor.executeCustom;
        const result = await executeCustom({
            actorId: characterId,
            purpose: "memory-consolidation",
            stage: "memory-consolidation",
            messages: messages,
            requestOptions: setup.AIRequestProfiles.resolve("memory-consolidation", { actorId: characterId }),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                const protocolResult = await setup.AIProtocol.requestValidated(
                    clone(messages),
                    "memory-consolidation",
                    policyClient
                );
                if (!protocolResult.ok) {
                    protocolResult.consolidation = {
                        committed: false,
                        consolidatedRecentCount: plan.summary.consolidatedRecentCount,
                        retainedRecentCount: plan.summary.retainedRecentCount
                    };
                    return protocolResult;
                }

                const commitResult = setup.AIMemory.commitConsolidation(
                    characterId,
                    plan.sourceState,
                    protocolResult.value
                );
                if (!commitResult.ok) {
                    return {
                        ok: false,
                        value: clone(protocolResult.value),
                        error: clone(commitResult.error),
                        modelId: protocolResult.modelId || null,
                        usage: protocolResult.usage || null,
                        rawContent: protocolResult.rawContent || "",
                        repaired: Boolean(protocolResult.repaired),
                        trace: clone(protocolResult.trace),
                        consolidation: {
                            committed: false,
                            consolidatedRecentCount: plan.summary.consolidatedRecentCount,
                            retainedRecentCount: plan.summary.retainedRecentCount,
                            error: clone(commitResult.error)
                        }
                    };
                }

                const commitReport = clone(commitResult);
                delete commitReport.ok;
                return Object.assign({}, protocolResult, {
                    consolidation: Object.assign({ committed: true }, commitReport)
                });
            }
        });

        recordTransientResult(characterId, messages, result);
        if (!result.ok) return result;
        return Object.assign({ actorId: characterId, nothingToCompress: false }, result);
    }

    setup.MemoryConsolidator = {
        RETAIN_RECENT_COUNT: RETAIN_RECENT_COUNT,
        AUTO_THRESHOLD: AUTO_THRESHOLD,
        compress: compress
    };
}());
