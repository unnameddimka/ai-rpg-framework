"use strict";

// Canonical cross-cutting runtime module ordering used by test scenarios.
// Individual suites may still omit unrelated subsystems, but should pass their
// scenario list through augment() so shared infrastructure additions have one home.
const BEFORE = new Map([
    ["src/10-game-api.js", ["src/09-action-option-validation.js", "src/10-game-00-item-mechanics.js", "src/10-game-01-validation.js", "src/10-game-02-actions.js"]],
    ["src/24-timelapse-core.js", ["src/23-timelapse-protocol.js"]]
]);

const AFTER = new Map([
    ["src/08-mind-validators.js", ["src/09-world-state-authority.js", "src/09-passage-rules.js", "src/09-world-derived-state.js"]],
    ["src/10-game-api.js", ["src/10-trade-lifecycle.js", "src/10-weekly-rhythm.js", "src/10-presence.js", "src/10-authored-effects.js", "src/10-triggered-events.js"]],
    ["src/23-ai-protocol.js", ["src/09-action-option-validation.js", "src/23-mind-consolidation-protocols.js", "src/23-structured-ai-request.js"]],
    ["src/24-ai-request-executor.js", ["src/24-mind-semantic-retrieval.js"]],
    ["src/24-memory-consolidator.js", ["src/24-retrieval-brief-backfill.js"]],
    ["src/26-presentation-narrator.js", ["src/29-debug-ui-formatters.js"]]
]);

function augment(files) {
    const out = [];
    const seen = new Set();
    for (const file of files || []) {
        for (const extra of BEFORE.get(file) || []) {
            if (!seen.has(extra)) { out.push(extra); seen.add(extra); }
        }
        if (!seen.has(file)) { out.push(file); seen.add(file); }
        for (const extra of AFTER.get(file) || []) {
            if (!seen.has(extra)) { out.push(extra); seen.add(extra); }
        }
    }
    return out;
}

module.exports = { augment };
