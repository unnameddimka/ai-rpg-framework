(function () {
    "use strict";

    const CONFIG = Object.freeze({
        SCHEMA_VERSION: 3,
        VERBATIM_RETAIN_COUNT: 20,
        STM_TRIGGER_COUNT: 40,
        MIGRATED_BELIEF_ACTIVATION: 0.5,
        NEW_BELIEF_ACTIVATION: 0.7,
        BELIEF_CONFIDENCE_MIN: 0.001,
        BELIEF_CONFIDENCE_MAX: 0.999,
        SUPPORT_LOG_ODDS_GAIN: 1.0,
        CONTRADICTION_LOG_ODDS_LOSS: 1.15,
        ACTIVATION_GAIN: 1.35,
        STRONG_ACTIVATION_GAIN: 1.8,
        ACTIVATION_DECAY_PER_MAINTENANCE_UNIT: 0.35,
        MAX_STM_COUNT: 80,
        MAX_LTM_COUNT: 80,
        BELIEF_DIAGNOSTIC_LIMIT: 8,
        NORMAL_CONTEXT_VERBATIM_LIMIT: 20,
        NORMAL_CONTEXT_BELIEF_LIMIT: 16,
        NORMAL_CONTEXT_STM_LIMIT: 12,
        NORMAL_CONTEXT_LTM_LIMIT: 8,
        STM_WRITE_SET_LIMIT: 8,
        STM_SUMMARY_PREFERRED_MAX_CHARS: 2000,
        STM_SUMMARY_MAX_CHARS: 4000,
        LTM_SUMMARY_MAX_CHARS: 4000,
        STM_BELIEF_EFFECT_LIMIT: 12,
        STM_NEW_BELIEF_LIMIT: 4,
        STM_ACTIVATED_BELIEF_LIMIT: 12,
        LTM_CONSOLIDATION_MAX_COMPLETION_TOKENS: 12000,
        RECONCILIATION_RESOLUTION_LIMIT: 5,
        RECONCILIATION_CANDIDATE_LIMIT: 8,
        RECONCILIATION_ACTIVATED_BELIEF_LIMIT: 12,
        BALANCED_CONSOLIDATION_MIN_CLUSTER_SIZE: 5
    });

    const BELIEF_SEMANTICS = [
        "Beliefs are this character's inductive interpretations of what remembered experience means; they are not objective facts.",
        "Beliefs may be mistaken, biased, incomplete, or mutually contradictory.",
        "confidence is a number strictly between 0 and 1 describing how strongly the character currently considers that interpretation true.",
        "activation is a number strictly between 0 and 1 describing how psychologically salient, accessible, and influential the belief currently is.",
        "Highly activated beliefs should receive more weight in current interpretation and attention, while a dormant high-confidence belief can still matter when directly relevant.",
        "Beliefs may bias how new experience is interpreted, but a belief is never evidence for itself. New remembered evidence may support, contradict, or reshape beliefs."
    ].join(" ");

    const MODEL_OUTPUT_EFFECT_INVARIANT = [
        "MODEL OUTPUT MUST HAVE EFFECT: structured mutation output represents actual changes, not relevance or records merely considered as context.",
        "Do not return an upsert merely because an existing record was relevant, retrieved, inspected, or used in reasoning.",
        "Every upsert must materially change model-writable state after protocol normalization; if the effective state would remain unchanged, omit that upsert entirely.",
        "Unmentioned existing records remain unchanged automatically, so never echo unchanged records just to preserve them.",
        "Engine-owned fields, provenance/debug metadata, cosmetic rewording, or equivalent normalized representations do not justify an otherwise no-op upsert.",
        "Explicit protocol-level null or negative decisions remain valid when the decision itself is the semantic result of the invocation."
    ].join(" ");

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeConfidence(value) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return clamp(value, CONFIG.BELIEF_CONFIDENCE_MIN, CONFIG.BELIEF_CONFIDENCE_MAX);
        }
        if (value === "low") return 0.3;
        if (value === "medium") return 0.6;
        if (value === "high") return 0.85;
        return 0.5;
    }

    function normalizeActivation(value, fallback) {
        const defaultValue = typeof fallback === "number" && Number.isFinite(fallback) ? fallback : CONFIG.MIGRATED_BELIEF_ACTIVATION;
        if (typeof value !== "number" || !Number.isFinite(value)) return clamp(defaultValue, 0.001, 0.999);
        return clamp(value, 0.001, 0.999);
    }

    function updateConfidence(confidence, effect, strength) {
        const p = normalizeConfidence(confidence);
        const s = clamp(Number(strength) || 0, 0, 1);
        if (effect === "ambiguous" || s <= 0) return p;
        const odds = Math.log(p / (1 - p));
        const delta = effect === "supports"
            ? CONFIG.SUPPORT_LOG_ODDS_GAIN * s
            : effect === "contradicts"
                ? -CONFIG.CONTRADICTION_LOG_ODDS_LOSS * s
                : 0;
        const result = 1 / (1 + Math.exp(-(odds + delta)));
        return clamp(result, CONFIG.BELIEF_CONFIDENCE_MIN, CONFIG.BELIEF_CONFIDENCE_MAX);
    }

    function bumpActivation(activation, strength, strong) {
        const a = normalizeActivation(activation, 0.001);
        const s = clamp(Number(strength) || 0, 0, 1);
        const gain = strong ? CONFIG.STRONG_ACTIVATION_GAIN : CONFIG.ACTIVATION_GAIN;
        const result = 1 - (1 - a) * Math.exp(-gain * s);
        return clamp(result, 0.001, 0.999);
    }

    function decayActivation(activation, elapsedUnits) {
        const a = normalizeActivation(activation);
        const units = Math.max(0, Number(elapsedUnits) || 0);
        return clamp(a * Math.exp(-CONFIG.ACTIVATION_DECAY_PER_MAINTENANCE_UNIT * units), 0.001, 0.999);
    }

    function stableLegacyTopic(prefix, id) {
        const safeId = String(id || "unknown").replace(/[^A-Za-z0-9_-]+/g, "-");
        return `${prefix} ${safeId}`;
    }

    setup.MindV3 = {
        CONFIG: CONFIG,
        BELIEF_SEMANTICS: BELIEF_SEMANTICS,
        MODEL_OUTPUT_EFFECT_INVARIANT: MODEL_OUTPUT_EFFECT_INVARIANT,
        normalizeConfidence: normalizeConfidence,
        normalizeActivation: normalizeActivation,
        updateConfidence: updateConfidence,
        bumpActivation: bumpActivation,
        decayActivation: decayActivation,
        stableLegacyTopic: stableLegacyTopic
    };
}());
