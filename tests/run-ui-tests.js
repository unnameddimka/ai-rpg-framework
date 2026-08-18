"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const uiSource = fs.readFileSync(path.join(root, "src/30-game-ui.js"), "utf8");
const narratorSource = fs.readFileSync(path.join(root, "src/26-presentation-narrator.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
let historyOnSave = null;
let historyOnLoad = null;
const context = {
    setup: {},
    State: { variables: {} },
    document: {},
    Engine: {},
    Save: {
        onSave: { add: function (handler) { historyOnSave = handler; } },
        onLoad: { add: function (handler) { historyOnLoad = handler; } }
    },
    $: function () { return { on: function () {} }; }
};
vm.createContext(context);
vm.runInContext(narratorSource, context, { filename: "26-presentation-narrator.js" });
vm.runInContext(uiSource, context, { filename: "30-game-ui.js" });
const model = context.setup.AbilityUIModel;
const promptLabModel = context.setup.PromptLabUIModel;
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(uiSource.includes('id="openrouter-utility-model-select"') && uiSource.includes('selectUtilityModel'),
    "AI settings UI should expose an independent Utility model selector");
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



const presentationAssembler = context.setup.PresentationAssembler;
const narratorView = {
    self: {
        id: "player",
        name: "Traveler",
        position_text: "You are standing by the fire.",
        inventory: [{ id: "ownedKey", name: "Room key" }]
    },
    location: {
        id: "commonRoom",
        name: "The common room",
        description: ["Smoke gathers under the rafters."],
        sublocations: [
            { id: "tableOne", name: "First table", public_text: "A scarred oak table stands near the fire." },
            { id: "floor", name: "Floor", public_text: "" }
        ],
        characters: [{
            id: "nell", name: "Nell", presence_text: "Nell watches the room.", position_text: "Nell stands near the bar."
        }],
        items: [{ id: "coin", name: "Gold coin" }]
    },
    accessible_inventories: [
        { id: "inventory_commonRoom", owner_id: "commonRoom", name: "The common room", items: [{ id: "coin", name: "Gold coin" }] },
        { id: "inventory_tableOne", owner_id: "tableOne", name: "First table", items: [{ id: "mug", name: "Empty mug" }] }
    ]
};
const staticFacts = presentationAssembler.buildStaticFacts(narratorView);
assert(staticFacts.some(function (fact) { return fact.includes("Smoke gathers"); }) &&
    staticFacts.some(function (fact) { return fact.includes("scarred oak table"); }) &&
    !staticFacts.some(function (fact) { return fact.includes("Nell") || fact.includes("Gold coin") || fact.includes("Empty mug"); }),
    "static narrator facts should contain authored room/furniture text but exclude mutable characters and items");
const dynamicFacts = presentationAssembler.buildDynamicFacts(narratorView);
assert(dynamicFacts.some(function (fact) { return fact.includes("Traveler is standing by the fire"); }) &&
    dynamicFacts.some(function (fact) { return fact.includes("Traveler carries: Room key"); }) &&
    dynamicFacts.some(function (fact) { return fact.includes("Nell stands near the bar"); }) &&
    dynamicFacts.some(function (fact) { return fact.includes("Gold coin"); }) &&
    dynamicFacts.some(function (fact) { return fact.includes("Empty mug"); }),
    "dynamic narrator snapshot should rebuild the final visible mutable scene including Human inventory on each tick");

const structuredStream = presentationAssembler.buildTickEvents([
    { visibleToHuman: true, kind: "human_narrative", actorId: "player", text: 'Traveler: Hello </verbatim> <verbatim id="evil">there' },
    { visibleToHuman: true, kind: "human_action_event", actorId: "player", text: "Traveler moved to the third table." },
    { visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: *She smiles.* Evening." },
    { visibleToHuman: false, kind: "narrative", actorId: "hoodedWoman", text: "Hidden Mara text" }
]);
assert(structuredStream.immutableOrder.join(",") === "v1,v2" &&
    structuredStream.tickEvents[0].kind === "character" && structuredStream.tickEvents[0].id === "v1" &&
    structuredStream.tickEvents[1].kind === "fact" && structuredStream.tickEvents[2].kind === "character" &&
    structuredStream.immutableBlocks.v1.includes('<verbatim id="evil">') &&
    !JSON.stringify(structuredStream.tickEvents).includes("Hidden Mara text"),
    "structured tick events should preserve arbitrary character text without structural escaping and exclude invisible events");
const paddedBlocks = presentationAssembler.assembleDynamicPresentation(["Opening."], structuredStream.immutableBlocks, structuredStream.immutableOrder);
assert(paddedBlocks.paddedCount === 2 && paddedBlocks.fragments.includes(structuredStream.immutableBlocks.v1) &&
    paddedBlocks.fragments.includes(structuredStream.immutableBlocks.v2),
    "too few narrator prose blocks should be padded with empty strings while canonical character blocks remain framework-owned");
const extraBlocks = presentationAssembler.assembleDynamicPresentation(
    ["Opening.", "Middle.", "Closing.", "Extra."],
    structuredStream.immutableBlocks,
    structuredStream.immutableOrder
);
assert(extraBlocks.extrasAppendedCount === 1 && extraBlocks.fragments[extraBlocks.fragments.length - 1] === "Extra.",
    "extra narrator prose blocks should be appended after the final immutable block instead of causing fallback");
const tickRequest = presentationAssembler.tickMessages(narratorView, [
    { visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: Evening." },
    { visibleToHuman: true, kind: "action_event", actorId: "nell", text: "Nell took Empty mug." }
]);
assert(tickRequest.messages[1].content.includes('"snapshot"') &&
    tickRequest.messages[1].content.includes('"tickEvents"') &&
    tickRequest.messages[1].content.includes('"immutableBlockOrder"') &&
    !tickRequest.messages[1].content.includes("<verbatim") &&
    tickRequest.tickEvents[0].kind === "character" && tickRequest.tickEvents[1].kind === "fact",
    "tick narrator request should separate final snapshot from chronological tickEvents and use immutable block IDs instead of returned tags");

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
        inventory: [{ id: "mug", name: "Empty mug" }, { id: "memoryStone_01", name: "Memory Stone", description: "A smooth dark stone." }, { id: "chain", name: "Silver chain" }],
        equipped_items: [{ id: "hat", name: "Boonie hat", slot: "head", visible: true }],
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
        use_item: { description: "Use an owned item.", options: { item_ids: ["memoryStone_01"], items: [{ id: "memoryStone_01", name: "Memory Stone", action_label: "Squeeze in hand", effect_id: "report_memory_counts" }] }, schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] } },
        equip: { description: "Equip item.", options: { item_ids: ["chain"], items: [{ id: "chain", name: "Silver chain", slots: ["neck"] }] }, schema: { properties: { type: {}, item_id: {}, slot: {} }, required: ["type", "item_id", "slot"] } },
        unequip: { description: "Unequip item.", options: { item_ids: ["hat"], items: [{ id: "hat", name: "Boonie hat", slot: "head" }] }, schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] } },
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
    groups.here.some(function (entry) { return entry.label === "Squeeze in hand" && entry.action.type === "use_item" && entry.action.item_id === "memoryStone_01"; }) &&
    groups.here.some(function (entry) { return entry.label === "Read aura"; }) &&
    groups.travel.length === 1 && groups.travel[0].label === "Go to Village Street" &&
    !groups.here.some(function (entry) { return entry.action.type === "equip" || entry.action.type === "unequip"; }),
    "contextual shortcuts should be grouped into Characters, Here, and Travel without equip/unequip quick buttons");
assert(gameUIModel.actionAvailableInView({ type: "move", destination_id: "street" }, contextualView) &&
    !gameUIModel.actionAvailableInView({ type: "move", destination_id: "missing" }, contextualView) &&
    gameUIModel.actionAvailableInView({ type: "use_item", item_id: "memoryStone_01" }, contextualView) &&
    !gameUIModel.actionAvailableInView({ type: "use_item", item_id: "mug" }, contextualView) &&
    gameUIModel.actionAvailableInView({ type: "equip", item_id: "chain", slot: "neck" }, contextualView) &&
    !gameUIModel.actionAvailableInView({ type: "equip", item_id: "chain", slot: "head" }, contextualView) &&
    gameUIModel.actionAvailableInView({ type: "unequip", item_id: "hat" }, contextualView) &&
    gameUIModel.actionLabel({ type: "use_item", item_id: "memoryStone_01" }, contextualView) === "Squeeze in hand" &&
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
    uiSource.includes('radioField("use_item", "Use item"') && uiSource.includes('id="action-use-item-input"') &&
    uiSource.includes('option.input_required') && uiSource.includes('input_text') && uiSource.includes('item.description || ""') &&
    uiSource.includes('title: "Here"') && uiSource.includes('title: "Travel"') &&
    !uiSource.includes("setup.CharacterAPI.perform") &&
    !uiSource.includes("Use the narrative or formal-action controls below") &&
    !uiSource.includes("Back to location"),
    "normal location shortcuts should select shared turn state without immediate action execution or obsolete interaction panels");
assert(uiSource.includes("framework-spinner") && uiSource.includes("AIRequestExecutor.getStatus") &&
    uiSource.includes("executorStatus.blockingBusy") && uiSource.includes("AITurnScheduler.isWaveInFlight") &&
    uiSource.includes('text: busy ? "Thinking..." : ""') &&
    uiSource.includes('appendTextElement(row, "span", "Thinking...", "framework-busy-text")') &&
    !uiSource.includes("Narrator is writing…") && !uiSource.includes("is thinking…"),
    "busy presentation should use one generic Thinking indicator only for blocking canonical work, not optional narrator requests");
assert(uiSource.includes('renderMigrationOverlay("Migrating save..."') &&
    uiSource.includes("setup.SaveMigration.migrate()") && uiSource.includes("yieldForMigrationPaint") &&
    uiSource.includes('"Save migration failed. Your original save was not changed."'),
    "restored old saves should render a blocking migration status before transactional migration and preserve explicit failure messaging");
assert(stylesSource.includes(".framework-migration-overlay") && stylesSource.includes("z-index: 12000") &&
    stylesSource.includes(".framework-migration-panel"),
    "save migration should use a dedicated modal blocking overlay rather than ordinary turn status text");
assert(uiSource.includes("AI Interaction Disclaimer") && uiSource.includes("Okay, fine") && uiSource.includes("If you decide to get kinky with the characters") &&
    uiSource.includes("Choose your Traveler") && uiSource.includes("framework-startup-custom-name") && uiSource.includes("setup.Game.acceptPlayerDisclaimer") && uiSource.includes("setup.Game.finalizePlayerSetup") &&
    uiSource.includes("renderStartupOverlayIfNeeded"),
    "fresh worlds should use the disclaimer then Generic/Authored/Custom Traveler initialization flow before rendering gameplay");
assert(stylesSource.includes(".framework-startup-overlay") && stylesSource.includes("z-index: 29000") && stylesSource.includes(".framework-startup-choice"),
    "Traveler initialization should be a dedicated blocking startup surface");
assert(uiSource.includes("What ${view.self.name} notices") && uiSource.includes("abilityResultsByActor[result.actorId]"),
    "grounded private human-action feedback should remain visible after unified Submit");

const aiPanelSource = uiSource.slice(uiSource.indexOf('id="ai-settings-panel"'), uiSource.indexOf("`;", uiSource.indexOf('id="ai-settings-panel"')));
assert(aiPanelSource.includes("Provider: OpenRouter") && aiPanelSource.includes('id="openrouter-model-select"') &&
    aiPanelSource.includes("${modelOptions}") && aiPanelSource.includes('type="password"') &&
    aiPanelSource.includes("${queueText}") && !aiPanelSource.includes("Process next AI event"),
    "AI panel should show model/key controls plus read-only scheduler diagnostics without a manual processing button");
assert(aiPanelSource.includes('id="openrouter-narrator-model-select"') &&
    uiSource.includes("setup.AIRuntimeSettings.selectNarratorModel") &&
    uiSource.includes('id="enable-narrator"') && uiSource.includes("Enable narrator") &&
    uiSource.includes("setup.NarratorService.setEnabled"),
    "sidebar should expose an independent narrator model and an enable toggle next to presentation debug controls");
assert(uiSource.includes("setup.NarratorService.describeLocation") &&
    uiSource.includes("rawTurnNarrative") && uiSource.includes("narratedTurnNarrative") &&
    uiSource.includes("currentTurnPresentation"),
    "core UI should request static narration per location visit and retain raw turn presentation for narrator fallback");
const narratorModelHandler = uiSource.slice(
    uiSource.indexOf('$("#openrouter-narrator-model-select").on("change"'),
    uiSource.indexOf('$("#save-ai-settings")', uiSource.indexOf('$("#openrouter-narrator-model-select").on("change"'))
);
assert(narratorModelHandler.includes("selectNarratorModel") && !narratorModelHandler.includes("resetStaticNarration") &&
    !narratorModelHandler.includes("renderLocationView"),
    "changing narrator model should change the model for the next request without itself forcing a new narration request");
assert(uiSource.includes("setup.AIRuntimeSettings.selectModel") && !uiSource.includes("ai-character-select"),
    "model selection should update runtime settings while the AI queue UI remains free of a character picker");
assert(!uiSource.includes('id="take-next-ai-turn"') && !uiSource.includes('$("#take-next-ai-turn")') &&
    !uiSource.includes("setup.AITurnScheduler.processNext();"),
    "normal gameplay sidebar must not provide a manual one-head AI execution path");
assert(uiSource.includes('id="stop-auto-ai-processing"') &&
    uiSource.includes("setup.AITurnScheduler.setAutoProcessingPaused"),
    "sidebar should expose a persistent switch that pauses automatic AI processing after Submit");
assert(uiSource.includes('id="compress-memory-button"') && uiSource.includes("Compress memory") &&
    uiSource.includes('$("#human-character-select").val()') && uiSource.includes("setup.MemoryConsolidator.compress"),
    "sidebar should expose manual memory compression for the character selected in the existing Human-controller selector");
assert(uiSource.includes('id="emergency-dump-button"') && uiSource.includes("Emergency dump") &&
    uiSource.includes("setup.EmergencyDiagnostics.download") &&
    uiSource.indexOf('id="emergency-dump-button"') > uiSource.indexOf('id="ai-settings-panel"'),
    "the very bottom of the sidebar should expose a dedicated emergency diagnostic dump control");
assert(stylesSource.includes(".framework-emergency-block") && stylesSource.includes("#emergency-dump-button") &&
    stylesSource.includes("background: #8b1e1e"),
    "emergency diagnostics should be visually distinct as a red emergency control");
assert(uiSource.includes('<strong>Character</strong>') && uiSource.includes('<details class="framework-mind-tools">') &&
    uiSource.includes('<summary>Mind tools</summary>') && uiSource.includes('id="export-character-mind"') &&
    uiSource.includes('id="import-character-mind"') && uiSource.includes('id="import-character-mind-file"') &&
    uiSource.includes("setup.CharacterMindTransfer.exportMind") && uiSource.includes("setup.CharacterMindTransfer.importMind") &&
    uiSource.includes("CHARACTER_MIND_ID_MISMATCH") === false && uiSource.includes("window.confirm"),
    "sidebar should group character mind maintenance under a collapsed Mind tools section and use the strict transfer facade");
assert(uiSource.includes('id="auto-compress-character-memory"') && uiSource.includes("Auto-compress character memory") &&
    uiSource.includes("setup.AITurnScheduler.setAutoMemoryCompressionEnabled"),
    "AI scheduler controls should expose the optional automatic memory-compression toggle");
assert(uiSource.includes('id="show-invisible-events"') && uiSource.includes("Show invisible events") &&
    uiSource.includes("[DEBUG — NOT VISIBLE TO PLAYER]") && uiSource.includes("framework-invisible-debug-entry") &&
    gameUIModel.getInvisibleEventDebugState().show === false,
    "sidebar should expose a default-off presentation-only toggle for the current turn's suppressed invisible events");
assert(uiSource.includes("History") && uiSource.includes("framework-history") &&
    uiSource.includes("appendHistory") && uiSource.includes("Save.onSave.add") && uiSource.includes("Save.onLoad.add"),
    "player-facing History should be rendered directly by the core UI and keep a bounded save mirror");
assert(uiSource.includes('id="action-unlock-destination"') && uiSource.includes('id="action-lock-destination"') &&
    uiSource.includes('doorActionLabel("Unlock"') && uiSource.includes('doorActionLabel("Lock"') && uiSource.includes("the door to"),
    "lock and unlock controls should be derived from canonical available actions and label the connecting door");
assert(uiSource.includes('return "Get up"') && uiSource.includes('return "Stand up"') && uiSource.includes("moveWithinActionLabel"),
    "same-location reverse movement should use posture-aware labels instead of re-entering the room");
assert(uiSource.includes('id="action-submit"') && uiSource.includes('id="action-pass"') &&
    uiSource.includes('name="formal-action"') && uiSource.includes('value=""') &&
    uiSource.includes("setup.TurnFlow.submitHumanIntent") && uiSource.includes("setup.TurnFlow.pass") &&
    uiSource.includes("Submit turn") && uiSource.includes("Advanced actions") && uiSource.includes("Selected action:") &&
    uiSource.includes('id="action-narrative-text" rows="1"') && uiSource.includes("resizeNarrativeTextarea") &&
    uiSource.includes("narrativeNoticeability") && uiSource.includes("reconcileConversationState") &&
    uiSource.includes('actionRoot.className = "framework-turn-panel"') &&
    !uiSource.includes("Your turn &mdash;") && !uiSource.includes("Framework debug"),
    "turn UI should stay minimal, auto-grow narrative input, preserve conversation settings, and submit one shared action or Pass");
assert(uiSource.includes('id="action-fill-item"') && uiSource.includes('id="action-consume-item"') &&
    uiSource.includes('id="action-use-item"') && uiSource.includes('["fill", "consume", "use_item"]') && !uiSource.includes("pour_ale"),
    "human controls should derive fill, consume, and generic use interactions from item actions and expose no source-less pour action");
assert(!uiSource.includes('<button id="action-narrate"') && !uiSource.includes('<button id="action-give-money"') &&
    !uiSource.includes('<button id="action-move"'),
    "formal debug actions should no longer execute through independent buttons");
assert(uiSource.includes('id="open-character-window"') && uiSource.includes('overlay.id = "framework-character-overlay"') &&
    uiSource.includes('id="framework-character-name"') && uiSource.includes('id="framework-character-description"') &&
    uiSource.includes("view.self.playerDescription") && uiSource.includes("view.self.inventory") &&
    uiSource.includes("setup.Game.updateCharacterProfile") && uiSource.includes("Save and close") &&
    uiSource.includes("Close without saving") && !uiSource.includes("framework-character-ai-description"),
    "sidebar Character window should edit Name/playerDescription, show read-only inventory, and never expose aiDescription");
assert(stylesSource.includes(".framework-character-window") && stylesSource.includes("background: #24211d;") &&
    stylesSource.includes("background: #151310;") && stylesSource.includes("color: #f3eee7;"),
    "Character window and editable fields should use an explicit dark, high-contrast palette");

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

assert(typeof historyOnSave === "function" && typeof historyOnLoad === "function",
    "History should register directly with SugarCube Save events when available");
const savedHistoryFixture = Array.from({ length: 120 }, function (_, index) {
    return { text: "Entry " + index, visibleToHuman: index % 2 === 0, actorName: "Actor", locationName: "Room" };
});
gameUIModel.busyState();
context.State.variables.frameworkUI.turnBusy = true;
historyOnLoad({ state: { index: 0, history: [{ variables: { frameworkUI: { history: savedHistoryFixture, turnBusy: true } } }] } });
assert(!Object.prototype.hasOwnProperty.call(context.State.variables.frameworkUI, "turnBusy") && gameUIModel.busyState().busy === false,
    "loading a save with stale serialized turnBusy must initialize the UI unlocked when no live operation exists");
context.setup.AIRequestExecutor = { getStatus: function () { return { busy: true, blockingBusy: false, activePurpose: "presentation-location" }; } };
assert(gameUIModel.busyState().busy === false,
    "an optional static narrator request started after save load must not lock the game or show Thinking");
context.setup.AIRequestExecutor = { getStatus: function () { return { busy: true, blockingBusy: true, activePurpose: "game-decision" }; } };
assert(gameUIModel.busyState().busy === true,
    "a canonical executor request must still lock the game and show Thinking");
delete context.setup.AIRequestExecutor;
const restoredHistory = gameUIModel.getHistoryEntries();
assert(restoredHistory.length === 100 && restoredHistory[0].text === "Entry 20" &&
    restoredHistory.some(function (entry) { return entry.visibleToHuman === false; }),
    "loading should restore only the most recent 100 History entries while preserving visibility metadata");
const saveObject = { state: { index: 2, history: [
    { variables: { frameworkUI: { history: [{ text: "old" }], turnBusy: true } } },
    { variables: { frameworkUI: { history: [{ text: "older" }], turnBusy: true } } },
    { variables: { frameworkUI: { history: [], turnBusy: true } } }
] } };
historyOnSave(saveObject);
assert(saveObject.state.history[0].variables.frameworkUI.history.length === 0 &&
    saveObject.state.history[1].variables.frameworkUI.history.length === 0 &&
    saveObject.state.history[2].variables.frameworkUI.history.length === 100,
    "save serialization should keep History only in the active save moment and cap it at 100 entries total");
assert(saveObject.state.history.every(function (moment) {
    return !Object.prototype.hasOwnProperty.call(moment.variables.frameworkUI, "turnBusy");
}), "save serialization must strip transient turnBusy from every history moment");

// Unified narrator presentation mode: successful tick narration replaces both Latest turn and raw dynamic scene.
context.setup.NarratorService.setEnabled(true);
const narratedPresentation = gameUIModel.currentTurnPresentation({
    dynamicNarrationValid: true,
    narratedTurnNarrative: ["Literary scene", "Nell: Hello."],
    rawTurnNarrative: ["RAW TURN"],
    turnNarrative: ["RAW TURN"]
});
assert(narratedPresentation.narrated && narratedPresentation.fragments[0] === "Literary scene" &&
    !narratedPresentation.fragments.includes("RAW TURN"),
    "valid narrator output should select one unified narrated dynamic scene instead of the legacy Latest turn transcript");
context.setup.NarratorService.setEnabled(false);
const disabledNarratorPresentation = gameUIModel.currentTurnPresentation({
    dynamicNarrationValid: true,
    narratedTurnNarrative: ["Literary scene"],
    rawTurnNarrative: ["RAW TURN"],
    turnNarrative: ["fallback"]
});
assert(!disabledNarratorPresentation.narrated && disabledNarratorPresentation.fragments[0] === "RAW TURN",
    "disabling narrator should immediately select the complete raw dynamic presentation path");
context.setup.NarratorService.setEnabled(true);
assert(uiSource.includes("renderCharacterScene(root, view)") &&
    uiSource.includes("renderDynamicItems(root, view)") &&
    uiSource.includes("renderCurrentTurn(root, turnPresentation)") &&
    uiSource.indexOf("renderStaticScene(root, view)") < uiSource.indexOf("renderCharacterScene(root, view)") &&
    uiSource.indexOf("renderCharacterScene(root, view)") < uiSource.indexOf("renderDynamicItems(root, view)") &&
    uiSource.indexOf("renderDynamicItems(root, view)") < uiSource.indexOf("renderHistory(root)") &&
    uiSource.indexOf("renderHistory(root)") < uiSource.indexOf("renderCurrentTurn(root, turnPresentation)") &&
    uiSource.indexOf("renderBusyIndicator(root, busyState)") < uiSource.indexOf("const groups = buildContextualActionGroups(view)"),
    "location rendering should order static scene, characters, dynamic items, History, current tick, then gameplay shortcuts");
assert(stylesSource.includes(".framework-narrated-static") && stylesSource.includes(".framework-narrated-dynamic") &&
    stylesSource.includes(".framework-raw-presentation") && stylesSource.includes("rgba(74, 96, 116, 0.16)") &&
    stylesSource.includes("rgba(73, 106, 84, 0.16)") && stylesSource.includes("rgba(116, 76, 76, 0.16)"),
    "static, dynamic, and raw presentation should use persistent subtle blue, green, and red diagnostic backgrounds without labels");
assert(stylesSource.includes("width: 3.25rem") && stylesSource.includes("height: 3.25rem") &&
    stylesSource.includes("flex-direction: column") && !uiSource.includes('id="framework-busy-text"'),
    "busy spinner should be roughly three to four body-text sizes, centered above generic Thinking text, and no longer live inside the action panel markup");

console.log("All UI tests passed.");
