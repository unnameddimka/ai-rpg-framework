"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
function source(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}
function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function memoryStorage() {
    return {
        data: {},
        getItem(key) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null; },
        setItem(key, value) { this.data[key] = String(value); },
        removeItem(key) { delete this.data[key]; }
    };
}

async function testRuntimeSettingsTransportAndLogging() {
    const storage = memoryStorage();
    const context = {
        setup: {},
        localStorage: storage,
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Date: Date,
        Promise: Promise
    };
    vm.createContext(context);
    [
        "src/00-model-list.js",
        "src/21-ai-settings.js",
        "src/22-openrouter-client.js",
        "src/24-ai-request-executor.js",
        "src/26-presentation-narrator.js",
        "src/24-prompt-lab.js"
    ].forEach(function (file) {
        vm.runInContext(source(file), context, { filename: file });
    });

    const settings = context.setup.AIRuntimeSettings;
    assert(settings.getDefaultNarratorModelId() === "sao10k/l3.3-euryale-70b:nitro",
        "Llama 3.3 Euryale 70B Nitro should be the narrator default");
    const characterModelId = settings.getSelectedModelId();
    const selected = settings.selectNarratorModel("deepseek/deepseek-v4-pro", storage);
    assert(selected.ok && settings.getSelectedNarratorModelId() === "deepseek/deepseek-v4-pro",
        "narrator model should be independently selectable");
    assert(settings.getSelectedModelId() === characterModelId,
        "selecting a narrator model must not change the character model");
    settings.selectNarratorModel("sao10k/l3.3-euryale-70b:nitro", storage);
    settings.save("sk-or-v1-narrator-test-key-1234567890", false, storage, Date.now());

    let capturedBody = null;
    async function fakeFetch(url, options) {
        capturedBody = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            url: url,
            headers: { get: function () { return null; }, forEach: function () {} },
            text: async function () {
                return JSON.stringify({
                    choices: [{ finish_reason: "stop", message: { content: "Narrated." } }],
                    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
                });
            }
        };
    }

    const narratorTransport = await context.setup.OpenRouterClient.chatWithOptions(
        [{ role: "user", content: "Narrate." }],
        {
            modelId: settings.getSelectedNarratorModelId(),
            maxTokens: 1200,
            reasoningMaxTokens: 0,
            temperature: 0.7
        },
        fakeFetch
    );
    assert(narratorTransport.ok, "narrator transport should accept a successful provider response");
    assert(capturedBody.model === "sao10k/l3.3-euryale-70b:nitro" && capturedBody.max_tokens === 1200 && capturedBody.temperature === 0.7,
        "narrator transport should use its independent model and lightweight generation budget");
    assert(!Object.prototype.hasOwnProperty.call(capturedBody, "reasoning"),
        "narrator transport should not send the character reasoning budget");

    await context.setup.OpenRouterClient.chat([{ role: "user", content: "Character turn." }], fakeFetch);
    assert(capturedBody.model === characterModelId && capturedBody.max_tokens === 3000 &&
        capturedBody.reasoning && capturedBody.reasoning.max_tokens === 1500,
        "existing character-model transport defaults should remain unchanged");

    const view = {
        self: { id: "player", name: "Traveler", position_text: "You are standing in the room." },
        location: {
            id: "room",
            name: "Room",
            description: ["Stone walls."],
            sublocations: [],
            characters: [],
            items: []
        },
        accessible_inventories: []
    };
    const entries = [
        { visibleToHuman: true, kind: "narrative", text: "Nell: *She smiles.* Hello." },
        { visibleToHuman: true, kind: "action_event", text: "Nell took Empty mug." }
    ];
    const goodClient = {
        chat: async function () {
            return {
                ok: true,
                modelId: "fake/narrator",
                content: [
                    "The room settles into a quieter rhythm.",
                    '<verbatim id="v1">MODEL-CHANGED TEXT</verbatim>',
                    "Nell takes the mug."
                ].join("\n\n"),
                usage: { total_tokens: 7 }
            };
        }
    };
    const narrated = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, goodClient);
    assert(narrated.ok && narrated.value.fragments.includes("Nell: *She smiles.* Hello."),
        "successful tick narration should restore the canonical character-authored block");
    assert(!narrated.value.text.includes("MODEL-CHANGED TEXT"),
        "model-returned verbatim payload must never reach final presentation");

    const history = context.setup.AIRequestExecutor.getExchangeHistory();
    const last = history.entries[history.entries.length - 1];
    assert(last.request.purpose === "narration" && last.request.stage === "tick" && last.result.ok,
        "narrator requests should use the shared executor and be marked in exchange history");
    context.setup.Game = {
        getWorld: function () { return { turn: 7, entities: { player: { id: "player", locationId: "room" } } }; },
        getHumanCharacterId: function () { return "player"; }
    };
    context.setup.AITurnScheduler = { getQueueView: function () { return { count: 0, entries: [], head: null }; } };
    const exported = context.setup.PromptLab.buildExchangeLog(0);
    assert(exported.ok && exported.data.exchangeHistory.entries.some(function (entry) {
        return entry.request && entry.request.purpose === "narration" && entry.request.stage === "tick";
    }), "sphere exchange export should include narrator requests with narration-specific purpose/stage metadata");

    const badClient = {
        chat: async function () {
            return { ok: true, modelId: "fake/narrator", content: '<verbatim id="v2">wrong id</verbatim>', usage: null };
        }
    };
    const invalid = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, badClient);
    assert(!invalid.ok && invalid.fallbackUsed && invalid.error.code === "NARRATOR_INVALID_VERBATIM",
        "invalid paired verbatim framing should fail narration and request raw fallback");
}

async function testTurnFlowIntegration() {
    let narratorCalls = 0;
    const world = {
        entities: {
            player: { id: "player", name: "Traveler", locationId: "room" },
            room: { id: "room", name: "Room" },
            nell: { id: "nell", name: "Nell", locationId: "room" }
        }
    };
    const context = {
        setup: {
            Game: {
                getWorld: function () { return world; },
                getHumanCharacterId: function () { return "player"; }
            },
            CharacterAPI: {
                validateActionRequest: function () { return { ok: true }; },
                submitIntent: function () {
                    return {
                        ok: true,
                        narrativeResult: { event: { locationId: "room" } },
                        actionResult: { ok: true, events: [{ text: "Traveler took Mug.", locationId: "room" }] }
                    };
                },
                getView: function () {
                    return { self: { id: "player" }, location: { id: "room", characters: [{ id: "nell" }] } };
                }
            },
            AITurnScheduler: {
                processAfterSubmit: async function () {
                    return {
                        ok: true,
                        results: [{
                            ok: true,
                            actorId: "nell",
                            narrativeText: "*Nell smiles.* Hi.",
                            intentResult: { narrativeResult: { event: { locationId: "room", recipients: ["player"] } } },
                            actionResult: { ok: true, events: [{ text: "Nell moved.", locationId: "room", recipients: ["player"] }] }
                        }]
                    };
                },
                processWave: async function () { return { ok: true, results: [] }; }
            },
            OpenRouterClient: {},
            NarratorService: {
                isEnabled: function () { return true; },
                narrateTick: async function (input) {
                    narratorCalls++;
                    assert(input.entries.length === 4, "narrator should receive the complete raw presentation after the wave");
                    return { ok: true, value: { fragments: ["LITERARY", "Traveler: hello", "Nell: *Nell smiles.* Hi."] } };
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(source("src/25-turn-flow.js"), context, { filename: "src/25-turn-flow.js" });
    const result = await context.setup.TurnFlow.submitHumanIntent({
        text: "hello",
        target_id: "",
        action: { type: "take_item", item_id: "mug" }
    });
    assert(narratorCalls === 1, "one completed human turn/reaction wave should produce exactly one narrator request");
    assert(result.narrativeFragments[0] === "LITERARY" && result.rawNarrativeFragments[0] === "Traveler: hello",
        "narrated display output should coexist with the retained raw fallback presentation");
    assert(result.historyEntries[0].text === "Traveler: hello" && result.historyEntries.some(function (entry) { return entry.text === "Nell moved."; }),
        "History must remain the original raw grounded presentation rather than narrator prose");

    context.setup.NarratorService.narrateTick = async function () {
        throw new Error("synthetic narrator failure");
    };
    const fallback = await context.setup.TurnFlow.submitHumanIntent({
        text: "fallback line",
        target_id: "",
        action: null
    });
    assert(fallback.ok && fallback.narrativeFragments[0] === "Traveler: fallback line" &&
        fallback.narrator && fallback.narrator.fallbackUsed && fallback.narrator.error.code === "NARRATOR_PRESENTATION_EXCEPTION",
        "unexpected narrator exceptions must fall back to raw presentation without failing the completed world tick");
}

Promise.resolve()
    .then(testRuntimeSettingsTransportAndLogging)
    .then(testTurnFlowIntegration)
    .then(function () { console.log("All presentation narrator tests passed."); })
    .catch(function (error) {
        console.error(error && error.stack || error);
        process.exitCode = 1;
    });
