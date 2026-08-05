"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const uiSource = fs.readFileSync(path.join(root, "src/30-game-ui.js"), "utf8");
const context = {
    setup: {},
    State: { variables: {} },
    document: {},
    Engine: {},
    $: function () { return { on: function () {} }; }
};
vm.createContext(context);
vm.runInContext(uiSource, context, { filename: "30-game-ui.js" });
const model = context.setup.AbilityUIModel;
const promptLabModel = context.setup.PromptLabUIModel;
function assert(condition, message) { if (!condition) throw new Error(message); }
function viewFor(actorId, abilityIds, grant) {
    return {
        self: {
            id: actorId,
            abilities: abilityIds.map(function (id) {
                return { id: id, name: "Read aura", playerDescription: "Sense nearby auras.", actionType: "read_aura" };
            })
        },
        available_actions: grant ? {
            read_aura: {
                schema: { type: "object", properties: { type: { const: "read_aura" } }, required: ["type"] },
                sources: [{ kind: "character_ability", id: "readAura", name: "Read aura" }]
            }
        } : {}
    };
}

for (const actorId of ["player", "innkeeper", "futureCharacter"]) {
    const buttons = model.discoverAvailableAbilities(viewFor(actorId, ["readAura"], true));
    assert(buttons.length === 1 && buttons[0].actionType === "read_aura", `${actorId} should receive the same generic ability model`);
}
const controlledPlayerView = viewFor("player", [], false);
const controlledInnkeeperView = viewFor("innkeeper", ["readAura"], true);
assert(model.discoverAvailableAbilities(controlledPlayerView).length === 0 &&
    model.discoverAvailableAbilities(controlledInnkeeperView).length === 1,
    "switching HumanController should recalculate controls entirely from the new actor view");
assert(model.discoverAvailableAbilities(viewFor("hoodedWoman", [], true)).length === 0,
    "an action grant without an assigned ability should not render a control");
assert(model.discoverAvailableAbilities(viewFor("hoodedWoman", ["readAura"], false)).length === 0,
    "an assigned but unavailable ability should not render a control");
const parameterized = viewFor("player", ["readAura"], true);
parameterized.available_actions.read_aura.schema.properties.target_id = { type: "string" };
assert(model.discoverAvailableAbilities(parameterized).length === 0,
    "the milestone renderer should not guess parameters for parameterized actions");

const escaped = model.abilityResultMarkup({ ok: true, feedback: [{ code: "AURA_SCAN_RESULT", text: "Read.", data: {
    results: [{ name: "<img src=x onerror=alert(1)>", aura: "<& dangerous>" }]
} }] });
assert(!escaped.includes("<img") && escaped.includes("&lt;img") && escaped.includes("&lt;&amp; dangerous&gt;"),
    "structured aura result names and text should be HTML escaped");
const escapedError = model.abilityResultMarkup({ ok: false, error: { message: "<unsafe failure>" } });
assert(escapedError.includes("&lt;unsafe failure&gt;") && !escapedError.includes("<unsafe failure>"),
    "ability execution errors should be escaped for the normal result area");
const state = { abilityResultsByActor: { player: { ok: true, marker: "private-player" }, innkeeper: { ok: true, marker: "private-innkeeper" } } };
assert(model.getActorAbilityResult(state, "player").marker === "private-player" &&
    model.getActorAbilityResult(state, "innkeeper").marker === "private-innkeeper" &&
    model.getActorAbilityResult(state, "hoodedWoman") === null,
    "displayed private results should be isolated by controlled actor ID");

const aiPanelSource = uiSource.slice(uiSource.indexOf('id="ai-settings-panel"'), uiSource.indexOf("`;", uiSource.indexOf('id="ai-settings-panel"')));
assert(aiPanelSource.includes("Provider: OpenRouter") && aiPanelSource.includes('id="openrouter-model-select"') &&
    aiPanelSource.includes("${modelOptions}") && aiPanelSource.includes('type="password"') &&
    aiPanelSource.includes("Process next AI event"),
    "AI panel should show a model selector backed by generated options, password key input, and one global scheduler button");
assert(uiSource.includes("setup.AIRuntimeSettings.selectModel") && !uiSource.includes("ai-character-select"),
    "model selection should update runtime settings while the AI queue UI remains free of a character picker");
assert(uiSource.includes("!aiQueue.head || !aiSettings.hasKey || aiBusy"),
    "queue button should disable for empty queue, missing key, or in-flight request");

assert(uiSource.includes('view.location.id !== "villageTemple"') &&
    uiSource.includes("Scheduler queue") &&
    uiSource.includes("Inspect request") &&
    uiSource.includes("Dry-run exact request") &&
    uiSource.includes("Process live"),
    "the village-temple crystal sphere should expose the scheduler queue and dry-run/live controls only in its special room");
assert(uiSource.includes("Download AI log") && uiSource.includes("Import AI log") &&
    uiSource.includes("Replay recorded exchange") && uiSource.includes('accept="application/json,.json"') &&
    uiSource.includes("API keys and authorization headers are excluded") &&
    uiSource.includes("complete browser-visible OpenRouter HTTP error details") &&
    uiSource.includes("OpenRouter HTTP response"),
    "the sphere should expose safe JSON download, import, and offline replay controls");
const escapedTrace = promptLabModel.traceMarkup({ trace: { attempts: [{
    attempt: 1,
    kind: "initial",
    messages: [{ role: "user", content: "<unsafe request>" }],
    providerResponse: { status: 429, rawBody: "<unsafe provider error>" },
    rawContent: "<img src=x onerror=alert(1)>",
    parsedValue: { text: "<unsafe parsed>" },
    validationErrors: ["<unsafe error>"],
    usage: null
}] } });
assert(!escapedTrace.includes("<img") && escapedTrace.includes("&lt;img") &&
    escapedTrace.includes("&lt;unsafe error&gt;") && escapedTrace.includes("&lt;unsafe request&gt;") &&
    escapedTrace.includes("&lt;unsafe provider error&gt;"),
    "prompt-lab request, provider diagnostics, response, parsed JSON, and validation errors should be HTML escaped");

const escapedQueue = promptLabModel.queueMarkup({
    busy: false,
    selectedQueueCharacterId: "unsafe",
    queue: {
        count: 1,
        entries: [{
            position: 1,
            isNext: true,
            characterId: "unsafe",
            recipientName: "<img src=x onerror=alert(1)>",
            locationName: "<& location>",
            reason: "<unsafe reason>",
            requestObservationCount: 1,
            availableActionCount: 2,
            observationPreview: [{ turn: 7, type: "<event>", summary: "<unsafe observation>" }],
            hiddenObservationCount: 0
        }]
    }
}, true);
assert(!escapedQueue.includes("<img") && escapedQueue.includes("&lt;img") &&
    escapedQueue.includes("NEXT REQUEST") && escapedQueue.includes("Recipient") &&
    escapedQueue.includes("&lt;unsafe observation&gt;"),
    "prompt-lab queue cards should identify the next recipient/event and escape authored or model-adjacent text");

console.log("All ability UI tests passed.");
