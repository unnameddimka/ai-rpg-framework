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


const gameUIModel = context.setup.GameUIModel;
const inlineRP = gameUIModel.inlineRPMarkup('Hello. *Mara narrows <her> eyes.* Still listening.');
assert(inlineRP.includes('Hello. ') && inlineRP.includes('<em class="framework-inline-narration">Mara narrows &lt;her&gt; eyes.</em>') &&
    inlineRP.includes(' Still listening.') && !inlineRP.includes('*Mara') && !inlineRP.includes('<her>'),
    "inline RP rendering should hide paired asterisks, style narration, and safely escape content");
const unmatchedRP = gameUIModel.inlineRPMarkup('Wait *this never closes');
assert(unmatchedRP.includes('Wait *this never closes'),
    "unmatched asterisks should remain literal instead of breaking RP rendering");
const contextualView = {
    self: {
        id: "player",
        name: "Traveler",
        inventory: [{ id: "mug", name: "Empty mug" }],
        abilities: [{ id: "readAura", name: "Read aura", playerDescription: "Sense auras.", actionType: "read_aura" }]
    },
    location: {
        characters: [{ id: "innkeeper", name: "Bartender" }],
        exits: [{ id: "street", name: "Village Street" }],
        sublocations: [{ id: "bar", name: "Behind the bar", enter_label: "Stand behind the bar" }]
    },
    accessible_inventories: [{ id: "cabinet", name: "Mug cabinet", items: [{ id: "cabinetMug", name: "Empty mug" }] }],
    available_actions: {
        move: { options: { destination_ids: ["street"] }, schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] } },
        move_within_location: { options: { destination_ids: ["bar"] }, schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] } },
        take_item: { options: { item_ids: ["cabinetMug"] }, schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] } },
        drop_item: { options: { item_ids: ["mug"] }, schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] } },
        place_item: { options: { item_ids: ["mug"], target_inventory_ids: ["cabinet"] }, schema: { properties: { type: {}, item_id: {}, target_inventory_id: {} }, required: ["type", "item_id", "target_inventory_id"] } },
        read_aura: {
            description: "Read nearby auras.",
            options: {},
            schema: { type: "object", properties: { type: { const: "read_aura" } }, required: ["type"] },
            sources: [{ kind: "character_ability", id: "readAura", name: "Read aura" }]
        }
    }
};
const groups = gameUIModel.buildContextualActionGroups(contextualView);
assert(groups.characters.length === 1 && groups.characters[0].label === "Talk to Bartender" &&
    groups.here.some(function (entry) { return entry.label === "Stand behind the bar"; }) &&
    groups.here.some(function (entry) { return entry.label === "Take Empty mug"; }) &&
    groups.here.some(function (entry) { return entry.label === "Read aura"; }) &&
    groups.travel.length === 1 && groups.travel[0].label === "Go to Village Street",
    "contextual shortcuts should be grouped into Characters, Here, and Travel from the canonical view");
assert(gameUIModel.actionAvailableInView({ type: "move", destination_id: "street" }, contextualView) &&
    !gameUIModel.actionAvailableInView({ type: "move", destination_id: "missing" }, contextualView) &&
    gameUIModel.actionLabel({ type: "take_item", item_id: "cabinetMug" }, contextualView) === "Take Empty mug",
    "selected actions should be validated and labeled from the current canonical view");
const conversationState = { interactionTargetId: "innkeeper", narrativeNoticeability: "hidden" };
gameUIModel.reconcileConversationState(contextualView, conversationState);
assert(conversationState.interactionTargetId === "innkeeper" && conversationState.narrativeNoticeability === "hidden",
    "conversation state should preserve a still-visible addressee and quiet loudness across rerenders");
gameUIModel.reconcileConversationState({ location: { characters: [] } }, conversationState);
assert(conversationState.interactionTargetId === "" && conversationState.narrativeNoticeability === "hidden",
    "conversation state should clear an unavailable addressee without resetting loudness");
const fakeTextarea = { style: {}, scrollHeight: 72, clientHeight: 40 };
gameUIModel.resizeNarrativeTextarea(fakeTextarea);
assert(fakeTextarea.style.height === "72px" && fakeTextarea.style.overflowY === "auto",
    "auto-growing narrative input should size itself from content and allow overflow only beyond its visible height");
assert(uiSource.includes("framework-contextual-actions") && uiSource.includes('title: "Characters"') &&
    uiSource.includes('title: "Here"') && uiSource.includes('title: "Travel"') &&
    !uiSource.includes("setup.CharacterAPI.perform") &&
    !uiSource.includes("Use the narrative or formal-action controls below") &&
    !uiSource.includes("Back to location"),
    "normal location shortcuts should select shared turn state without immediate action execution or obsolete interaction panels");
assert(uiSource.includes("framework-spinner") && uiSource.includes("AIRequestExecutor.getStatus") &&
    uiSource.includes("AITurnScheduler.isWaveInFlight") && uiSource.includes("is thinking…") &&
    uiSource.includes("Processing turn…"),
    "turn panel should expose a spinner and derive busy state from existing AI execution sources");
assert(uiSource.includes("What ${view.self.name} notices") && uiSource.includes("abilityResultsByActor[result.actorId]"),
    "grounded private human-action feedback should remain visible after unified Submit");

const aiPanelSource = uiSource.slice(uiSource.indexOf('id="ai-settings-panel"'), uiSource.indexOf("`;", uiSource.indexOf('id="ai-settings-panel"')));
assert(aiPanelSource.includes("Provider: OpenRouter") && aiPanelSource.includes('id="openrouter-model-select"') &&
    aiPanelSource.includes("${modelOptions}") && aiPanelSource.includes('type="password"') &&
    aiPanelSource.includes("${queueText}") && !aiPanelSource.includes("Process next AI event"),
    "AI panel should show model/key controls plus read-only scheduler diagnostics without a manual processing button");
assert(uiSource.includes("setup.AIRuntimeSettings.selectModel") && !uiSource.includes("ai-character-select"),
    "model selection should update runtime settings while the AI queue UI remains free of a character picker");
assert(!uiSource.includes('id="take-next-ai-turn"') && !uiSource.includes('$("#take-next-ai-turn")') &&
    !uiSource.includes("setup.AITurnScheduler.processNext();"),
    "normal gameplay sidebar must not provide a manual one-head AI execution path");
assert(uiSource.includes('id="stop-auto-ai-processing"') &&
    uiSource.includes("setup.AITurnScheduler.setAutoProcessingPaused"),
    "sidebar should expose a persistent switch that pauses automatic AI processing after Submit");
assert(uiSource.includes('id="show-invisible-events"') && uiSource.includes("Show invisible events") &&
    uiSource.includes("[DEBUG — NOT VISIBLE TO PLAYER]") && uiSource.includes("framework-invisible-debug-entry") &&
    gameUIModel.getInvisibleEventDebugState().show === false,
    "sidebar should expose a default-off presentation-only toggle for the current turn's suppressed invisible events");
assert(uiSource.includes('id="action-submit"') && uiSource.includes('id="action-pass"') &&
    uiSource.includes('name="formal-action"') && uiSource.includes('value=""') &&
    uiSource.includes("setup.TurnFlow.submitHumanIntent") && uiSource.includes("setup.TurnFlow.pass") &&
    uiSource.includes("Submit turn") && uiSource.includes("Advanced formal actions") && uiSource.includes("Selected action:") &&
    uiSource.includes('id="action-narrative-text" rows="1"') && uiSource.includes("resizeNarrativeTextarea") &&
    uiSource.includes("narrativeNoticeability") && uiSource.includes("reconcileConversationState") &&
    uiSource.includes('actionRoot.className = "framework-turn-panel"') &&
    !uiSource.includes("Your turn &mdash;") && !uiSource.includes("Framework debug"),
    "turn UI should stay minimal, auto-grow narrative input, preserve conversation settings, and submit one shared action or Pass");
assert(uiSource.includes('id="action-fill-item"') && uiSource.includes('id="action-consume-item"') &&
    uiSource.includes('["fill", "consume"]') && !uiSource.includes("pour_ale"),
    "human controls should derive fill and consume from item actions and expose no source-less pour action");
assert(!uiSource.includes('<button id="action-narrate"') && !uiSource.includes('<button id="action-give-money"') &&
    !uiSource.includes('<button id="action-move"'),
    "formal debug actions should no longer execute through independent buttons");
assert(uiSource.includes('id="open-character-window"') && uiSource.includes('overlay.id = "framework-character-overlay"') &&
    uiSource.includes('id="framework-character-name"') && uiSource.includes('id="framework-character-description"') &&
    uiSource.includes("view.self.playerDescription") && uiSource.includes("view.self.inventory") &&
    uiSource.includes("setup.Game.updateCharacterProfile") && uiSource.includes("Save and close") &&
    uiSource.includes("Close without saving") && !uiSource.includes("framework-character-ai-description"),
    "sidebar Character window should edit Name/playerDescription, show read-only inventory, and never expose aiDescription");

assert(uiSource.includes('view.location.id !== "villageTemple"') &&
    uiSource.includes("Scheduler queue") &&
    uiSource.includes("Inspect request") &&
    uiSource.includes("Dry-run exact request") &&
    uiSource.includes("Narrative history") &&
    uiSource.includes('id="prompt-lab-clear-narrative"') &&
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


const escapedNarrativeHistory = promptLabModel.narrativeHistoryMarkup([{
    actorId: "unsafe",
    actorName: "<img src=x onerror=alert(1)>",
    fragments: ["<unsafe narrative>", "Safe second paragraph"]
}]);
assert(!escapedNarrativeHistory.includes("<img") &&
    escapedNarrativeHistory.includes("&lt;img") &&
    escapedNarrativeHistory.includes("&lt;unsafe narrative&gt;"),
    "prompt-lab narrative history should escape actor names and model-produced public text");
const styledNarrativeHistory = promptLabModel.narrativeHistoryMarkup([{
    actorId: "mara",
    actorName: "Mara",
    fragments: ["Maybe. *She smiles faintly.* Maybe not."]
}]);
assert(styledNarrativeHistory.includes('framework-inline-narration') && !styledNarrativeHistory.includes('*She smiles faintly.*'),
    "prompt-lab narrative history should use the same inline RP narration renderer");

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
assert(uiSource.includes("<dt>Initiative</dt>") && uiSource.includes("Initiative: ${escapeHtml(aiQueue.head.initiativeScore || 0)}"),
    "debug queue UIs should expose the derived initiative score used for next-reaction ordering");

console.log("All ability UI tests passed.");
