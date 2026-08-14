(function () {
    "use strict";

    const profiles = Object.freeze({
        "game-decision": Object.freeze({ modelRole: "character", maxTokens: 6000, reasoningMaxTokens: 1500, temperature: 0.4 }),
        "timelapse-plan": Object.freeze({ modelRole: "utility", maxTokens: 1200, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2 }),
        "timelapse-replan": Object.freeze({ modelRole: "utility", maxTokens: 1200, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.2 }),
        "timelapse-intent": Object.freeze({ modelRole: "utility", maxTokens: 700, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.3 }),
        "timelapse-resolver": Object.freeze({ modelRole: "utility", maxTokens: 1000, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.3 }),
        "reflection": Object.freeze({ modelRole: "utility", maxTokens: 1800, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.4 }),
        "memory-consolidation": Object.freeze({ modelRole: "utility", maxTokens: 2400, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.25 }),
        "item-utility-query": Object.freeze({ modelRole: "utility", maxTokens: 1800, reasoningMaxTokens: 0, reasoningEffort: "none", temperature: 0.55 }),
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
