(function () {
    "use strict";

    const MIND_V3_LTM_REQUEST_TIMEOUT_MS = 300000;
    const mindV3LtmMaxTokens = setup.MindV3 && setup.MindV3.CONFIG && Number.isFinite(setup.MindV3.CONFIG.LTM_CONSOLIDATION_MAX_COMPLETION_TOKENS)
        ? setup.MindV3.CONFIG.LTM_CONSOLIDATION_MAX_COMPLETION_TOKENS
        : 12000;

    const profiles = Object.freeze({
        "game-decision": Object.freeze({ modelRole: "character", maxTokens: 6000, reasoningMaxTokens: 1500, temperature: 0.4 }),
        "mind-retrieval-preflight": Object.freeze({ modelRole: "utility", maxTokens: 700, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.1 }),
        "mind-retrieval-brief-backfill": Object.freeze({ modelRole: "utility", maxTokens: 6000, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.1 }),
        "timelapse-plan": Object.freeze({ modelRole: "utility", maxTokens: 1200, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2 }),
        "timelapse-replan": Object.freeze({ modelRole: "utility", maxTokens: 1200, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2 }),
        "timelapse-intent": Object.freeze({ modelRole: "utility", maxTokens: 700, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.3 }),
        "timelapse-resolver": Object.freeze({ modelRole: "utility", maxTokens: 1000, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.3 }),
        "reflection": Object.freeze({ modelRole: "utility", maxTokens: 1800, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.4 }),
        "memory-consolidation": Object.freeze({ modelRole: "utility", maxTokens: 2400, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.25 }),
        "mind-v3-stm": Object.freeze({ modelRole: "utility", maxTokens: 6000, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2 }),
        "mind-v3-ltm-preflight": Object.freeze({ modelRole: "utility", maxTokens: 6000, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.1 }),
        "mind-v3-ltm": Object.freeze({ modelRole: "utility", maxTokens: mindV3LtmMaxTokens, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2, timeoutMs: MIND_V3_LTM_REQUEST_TIMEOUT_MS }),
        "item-utility-query": Object.freeze({ modelRole: "utility", maxTokens: 1800, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.55 }),
        "daytime-job-narration": Object.freeze({ modelRole: "character", maxTokens: 900, reasoningMaxTokens: 200, temperature: 0.45 }),
        "daytime-job-settlement": Object.freeze({ modelRole: "character", maxTokens: 500, reasoningMaxTokens: 200, temperature: 0.25 }),
        "daytime-hunting-narration": Object.freeze({ modelRole: "narrator", maxTokens: 420, reasoningMaxTokens: 0, temperature: 0.7 }),
        "weather-narration": Object.freeze({ modelRole: "narrator", maxTokens: 300, reasoningMaxTokens: 0, temperature: 0.6 }),
        "presentation-location": Object.freeze({ modelRole: "narrator", maxTokens: 400, reasoningMaxTokens: 0, temperature: 0.7 }),
        "presentation-tick": Object.freeze({ modelRole: "narrator", maxTokens: 700, reasoningMaxTokens: 0, temperature: 0.7 }),
        "prompt-lab": Object.freeze({ modelRole: "character", maxTokens: 6000, reasoningMaxTokens: 1500, temperature: 0.4 })
    });

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function selectedModelId(role) {
        const settings = setup.AIRuntimeSettings;
        if (!settings) return null;
        if (role === "utility" && typeof settings.getSelectedUtilityModelId === "function") {
            return settings.getSelectedUtilityModelId() || settings.getSelectedModelId();
        }
        if (role === "narrator" && typeof settings.getSelectedNarratorModelId === "function") {
            return settings.getSelectedNarratorModelId() || settings.getSelectedModelId();
        }
        return settings.getSelectedModelId();
    }

    function baseSessionId() {
        try {
            const world = setup.Game && setup.Game.getWorld ? setup.Game.getWorld() : null;
            const value = world && world.ai && typeof world.ai.inferenceSessionId === "string"
                ? world.ai.inferenceSessionId.trim()
                : "";
            return value || null;
        } catch (error) {
            return null;
        }
    }

    function sessionIdFor(profileName, role, actorId) {
        const base = baseSessionId();
        if (!base) return null;
        const family = actorId ? `${role}:${actorId}` : role;
        return `${base}:${family}:${profileName}`.slice(0, 256);
    }

    function resolve(name, context) {
        const profile = profiles[name];
        if (!profile) throw new Error(`Unknown AI request profile '${String(name)}'.`);
        const details = context && typeof context === "object" ? context : {};
        const result = clone(profile);
        result.profile = name;
        result.modelId = selectedModelId(profile.modelRole);
        result.providerSort = "latency";
        result.allowProviderFallbacks = true;
        result.sessionId = sessionIdFor(name, profile.modelRole, details.actorId || null);
        return result;
    }

    setup.AIRequestProfiles = {
        names: function () { return Object.keys(profiles); },
        get: function (name) { return clone(profiles[name] || null); },
        resolve: resolve
    };
}());
