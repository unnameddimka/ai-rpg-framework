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

function narratorContext() {
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
        "src/21-ai-request-profiles.js",
        "src/22-openrouter-client.js",
        "src/24-ai-request-executor.js",
        "src/26-presentation-narrator.js"
    ].forEach(function (file) {
        vm.runInContext(source(file), context, { filename: file });
    });
    return { context: context, storage: storage };
}

function sampleView() {
    return {
        self: {
            id: "player",
            name: "Traveler",
            position_text: "You are standing by the fire.",
            inventory: [{ id: "ownedMug", name: "Mug of ale" }]
        },
        location: {
            id: "room",
            name: "Room",
            description: ["Stone walls."],
            sublocations: [{ id: "table", name: "Table", public_text: "A scarred table stands by the wall." }],
            characters: [{
                id: "nell",
                name: "Nell",
                presence_text: "Nell watches the room.",
                position_text: "Nell stands beside the table."
            }],
            items: [{ id: "coin", name: "Gold coin" }]
        },
        accessible_inventories: [
            { id: "inventory_room", owner_id: "room", name: "Room", items: [] },
            { id: "inventory_table", owner_id: "table", name: "Table", items: [{ id: "mug", name: "Mug of ale" }] }
        ]
    };
}

async function testStructuredInputAndTolerantAssembly() {
    const { context } = narratorContext();
    const assembler = context.setup.PresentationAssembler;
    const entries = [
        { visibleToHuman: true, kind: "human_narrative", actorId: "player", text: "Traveler: Hello." },
        { visibleToHuman: true, kind: "human_action_event", actorId: "player", text: "Traveler paid 2 gold." },
        { visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: *She nods.* Right away." },
        { visibleToHuman: true, kind: "action_event", actorId: "nell", text: "Nell gave Mug of ale to Traveler." },
        { visibleToHuman: false, kind: "narrative", actorId: "hidden", text: "Invisible text." }
    ];

    const request = assembler.tickMessages(sampleView(), entries);
    assert(Array.isArray(request.snapshot) && request.snapshot.some(function (fact) { return fact.includes("Traveler is standing by the fire"); }) &&
        request.snapshot.some(function (fact) { return fact.includes("Traveler carries: Mug of ale"); }),
        "dynamic input should contain an authoritative final visible snapshot including the Human character's own inventory");
    assert(request.tickEvents.length === 4 && request.tickEvents[0].kind === "character" && request.tickEvents[0].id === "v1" &&
        request.tickEvents[1].kind === "fact" && request.tickEvents[2].kind === "character" && request.tickEvents[2].id === "v2" &&
        !JSON.stringify(request.tickEvents).includes("Invisible text"),
        "tickEvents should preserve causal order, mark immutable character blocks, and exclude invisible events");
    assert(request.immutableOrder.join(",") === "v1,v2" && request.immutableBlocks.v1 === "Traveler: Hello." &&
        request.immutableBlocks.v2.includes("Right away"),
        "framework should retain canonical immutable block contents and order outside the model output");
    assert(!request.messages[1].content.includes("<verbatim") && request.messages[1].content.includes('"snapshot"') &&
        request.messages[1].content.includes('"tickEvents"'),
        "dynamic request should use structured snapshot/tickEvents JSON instead of the old verbatim-tag protocol");
    assert(context.setup.NarratorService.TICK_SYSTEM_PROMPT.includes("tickEvents is the chronological spine") &&
        context.setup.NarratorService.TICK_SYSTEM_PROMPT.includes("not a checklist to repeat") &&
        context.setup.NarratorService.TICK_SYSTEM_PROMPT.includes("the game will insert them unchanged"),
        "dynamic prompt should frame the task as concise literary writing, make tickEvents primary, and treat snapshot as reference rather than a checklist");

    const tooFew = assembler.assembleDynamicPresentation(["Opening."], request.immutableBlocks, request.immutableOrder);
    assert(tooFew.paddedCount === 2 && tooFew.extrasAppendedCount === 0 &&
        tooFew.fragments.join("|") === "Opening.|Traveler: Hello.|Nell: *She nods.* Right away.",
        "too few prose segments should be padded with empty strings instead of causing fallback");

    const extras = assembler.assembleDynamicPresentation(
        ["Opening.", "Between.", "Closing.", "Extra one.", "Extra two."],
        request.immutableBlocks,
        request.immutableOrder
    );
    assert(extras.paddedCount === 0 && extras.extrasAppendedCount === 2 &&
        extras.fragments.join("|") === "Opening.|Traveler: Hello.|Between.|Nell: *She nods.* Right away.|Closing.|Extra one.|Extra two.",
        "extra prose segments should be appended after the last immutable block in returned order");

    const empties = assembler.assembleDynamicPresentation(["", "", ""], request.immutableBlocks, request.immutableOrder);
    assert(empties.fragments.length === 2 && empties.fragments[0] === request.immutableBlocks.v1 && empties.fragments[1] === request.immutableBlocks.v2,
        "empty prose slots should be valid and should not force filler around immutable character text");
}

async function testRuntimeTransportBudgetsHotSwitchingAndLogging() {
    const { context, storage } = narratorContext();
    const settings = context.setup.AIRuntimeSettings;
    const narrator = context.setup.NarratorService;
    assert(narrator.STATIC_MAX_TOKENS === 400 && narrator.DYNAMIC_MAX_TOKENS === 700,
        "static and dynamic narrator completion ceilings should be 400 and 700 tokens");
    assert(settings.getDefaultNarratorModelId() === "sao10k/l3.3-euryale-70b:nitro",
        "Llama 3.3 Euryale 70B Nitro should remain the narrator default");

    const characterModelId = settings.getSelectedModelId();
    settings.save("sk-or-v1-narrator-test-key-1234567890", false, storage, Date.now());
    const bodies = [];
    context.fetch = async function (url, options) {
        const body = JSON.parse(options.body);
        bodies.push(body);
        const content = body.max_tokens === 400
            ? "Stone walls frame the quiet room."
            : JSON.stringify({ prose: ["Nell crosses the room.", "The mug is now in the Traveler's hands."] });
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            url: url,
            headers: { get: function () { return null; }, forEach: function () {} },
            text: async function () {
                return JSON.stringify({
                    choices: [{ finish_reason: "stop", message: { content: content } }],
                    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
                });
            }
        };
    };

    settings.selectNarratorModel("sao10k/l3.3-euryale-70b:nitro", storage);
    const staticResult = await narrator.describeLocation(sampleView());
    assert(staticResult.ok && bodies[0].model === "sao10k/l3.3-euryale-70b:nitro" && bodies[0].max_tokens === 400 &&
        !Object.prototype.hasOwnProperty.call(bodies[0], "reasoning"),
        "static narrator request should use the currently selected narrator model, 400-token ceiling, and no reasoning budget");

    const switched = settings.selectNarratorModel("deepseek/deepseek-v4-pro", storage);
    assert(switched.ok && settings.getSelectedModelId() === characterModelId,
        "narrator hot switching must remain independent from the selected character model");
    const tickResult = await narrator.narrateTick({
        view: sampleView(),
        entries: [{ visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: Here you are." }]
    });
    assert(tickResult.ok && bodies[1].model === "deepseek/deepseek-v4-pro" && bodies[1].max_tokens === 700 &&
        bodies[1].temperature === 0.7 && !Object.prototype.hasOwnProperty.call(bodies[1], "reasoning"),
        "changing narrator model during gameplay should affect the next narrator request without changing character transport defaults");

    const history = context.setup.AIRequestExecutor.getExchangeHistory();
    const narrationEntries = history.entries.filter(function (entry) {
        return entry.request.purpose === "presentation-location" || entry.request.purpose === "presentation-tick";
    });
    assert(narrationEntries.length === 2 && narrationEntries[0].request.stage === "location" && narrationEntries[1].request.stage === "tick" &&
        narrationEntries[1].request.modelId === "deepseek/deepseek-v4-pro" &&
        narrationEntries[1].result.trace.presentationInput && Array.isArray(narrationEntries[1].result.trace.presentationInput.snapshot) &&
        Array.isArray(narrationEntries[1].result.trace.presentationInput.tickEvents),
        "exchange logging should expose narration purpose/stage/model plus structured snapshot and tickEvents input");

    let capturedCharacterBody = null;
    async function fakeCharacterFetch(url, options) {
        capturedCharacterBody = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            url: url,
            headers: { get: function () { return null; }, forEach: function () {} },
            text: async function () {
                return JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
            }
        };
    }
    await context.setup.OpenRouterClient.chat([{ role: "user", content: "Character turn." }], fakeCharacterFetch);
    assert(capturedCharacterBody.model === characterModelId && capturedCharacterBody.max_tokens === 6000 &&
        capturedCharacterBody.reasoning && capturedCharacterBody.reasoning.max_tokens === 1500,
        "existing character transport should keep its independent 6000/1500 defaults after narrator model switching");
}

async function testTolerantDynamicJsonRecovery() {
    const { context } = narratorContext();
    const parser = context.setup.PresentationAssembler.parseDynamicResponse;

    const exact = parser('{"prose":["Exact."]}');
    assert(exact.ok && exact.prose[0] === "Exact." && exact.responseParsing.mode === "exact" &&
        exact.responseParsing.ignoredPrefixLength === 0 && exact.responseParsing.ignoredSuffixLength === 0,
        "clean dynamic JSON should use the exact fast path");

    const whitespace = parser('  \n {"prose":["Whitespace."]} \n ');
    assert(whitespace.ok && whitespace.responseParsing.mode === "exact",
        "surrounding whitespace should remain an exact parse after normalization");

    const prefixed = parser('NARRATOR OUTPUT JSON:\n{"prose":["Recovered prefix."]}');
    assert(prefixed.ok && prefixed.prose[0] === "Recovered prefix." && prefixed.responseParsing.mode === "recovered" &&
        prefixed.responseParsing.ignoredPrefixLength > 0,
        "an explanatory prefix should not invalidate a usable embedded narrator object");

    const fenced = parser('```json\n{"prose":["Recovered fence."]}\n```');
    assert(fenced.ok && fenced.prose[0] === "Recovered fence." && fenced.responseParsing.mode === "recovered",
        "markdown fences should be tolerated by balanced-object recovery rather than special-case exact parsing");

    const trailingProse = parser('{"prose":["Recovered prose tail."]}\nHope this helps.');
    assert(trailingProse.ok && trailingProse.responseParsing.mode === "recovered" &&
        trailingProse.responseParsing.ignoredSuffixLength > 0,
        "trailing prose should be ignored after a valid narrator object");

    const trailingCode = parser('{"prose":[]}\n```python\ndef narrate(scene):\n    return scene\n```');
    assert(trailingCode.ok && trailingCode.prose.length === 0 && trailingCode.responseParsing.mode === "recovered",
        "trailing code should be ignored after a valid narrator object");

    const extraBrace = parser('{"prose":["Recovered extra brace."]}}');
    assert(extraBrace.ok && extraBrace.prose[0] === "Recovered extra brace." && extraBrace.responseParsing.mode === "recovered",
        "a harmless extra closing brace after a valid object should be recoverable");

    const bracesInString = parser('prefix {"prose":["A {brace} stays inside the string."]} suffix');
    assert(bracesInString.ok && bracesInString.prose[0].includes("{brace}") && bracesInString.responseParsing.mode === "recovered",
        "balanced-object scanning must ignore braces inside JSON strings");

    const escapedQuote = parser('prefix {"prose":["She said \\\"stay {here}\\\" quietly."]} suffix');
    assert(escapedQuote.ok && escapedQuote.prose[0].includes('"stay {here}"') && escapedQuote.responseParsing.mode === "recovered",
        "balanced-object scanning must handle escaped quotes and braces inside strings");

    const nestedExtra = parser('{"prose":["Nested extra."],"debug":{"shape":{"ok":true}}}');
    assert(nestedExtra.ok && nestedExtra.responseParsing.mode === "exact" && nestedExtra.ignoredKeys.join(",") === "debug",
        "irrelevant nested extra fields should be ignored without weakening the prose string-array contract");

    const laterValid = parser('{"status":"not narration"}\n{"prose":["Use the later object."]}');
    assert(laterValid.ok && laterValid.prose[0] === "Use the later object." && laterValid.responseParsing.mode === "recovered" &&
        laterValid.responseParsing.acceptedCandidateIndex > 0,
        "recovery should continue past earlier JSON-looking objects that do not satisfy the narrator contract");

    const invalidMember = parser('{"prose":["ok",null]}');
    assert(!invalidMember.ok && invalidMember.responseParsing.mode === "failed",
        "the semantic contract should still require every prose member to be a string");

    const candidates = context.setup.PresentationAssembler.balancedJsonObjectCandidates(
        'text {"a":"{not structural}","b":{"c":1}} tail'
    );
    assert(candidates.length >= 1 && JSON.parse(candidates[0].text).b.c === 1,
        "the exported scanner helper should recover a balanced nested JSON object without regex parsing");
}

async function testNarratorResponseToleranceAndFallback() {
    const { context } = narratorContext();
    const view = sampleView();
    const entries = [
        { visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: First line." },
        { visibleToHuman: true, kind: "action_event", actorId: "nell", text: "Nell moved." },
        { visibleToHuman: true, kind: "narrative", actorId: "nell", text: "Nell: Second line." }
    ];

    const shortClient = {
        chat: async function () {
            return { ok: true, modelId: "fake/short", content: JSON.stringify({ prose: ["Before."] }), usage: null };
        }
    };
    const shortResult = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, shortClient);
    assert(shortResult.ok && !shortResult.fallbackUsed && shortResult.value.assembly.paddedCount === 2 &&
        shortResult.value.fragments.includes("Nell: First line.") && shortResult.value.fragments.includes("Nell: Second line."),
        "a short prose array should remain a valid narration and preserve canonical immutable blocks");

    const extraClient = {
        chat: async function () {
            return {
                ok: true,
                modelId: "fake/extra",
                content: JSON.stringify({ prose: ["Before.", "Middle.", "After.", "Tail one.", "Tail two."] }),
                usage: null
            };
        }
    };
    const extraResult = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, extraClient);
    const tail = extraResult.value.fragments.slice(-2).join("|");
    assert(extraResult.ok && extraResult.value.assembly.extrasAppendedCount === 2 && tail === "Tail one.|Tail two.",
        "extra prose blocks should be appended instead of causing narrator fallback");

    const fencedClient = {
        chat: async function () {
            return { ok: true, modelId: "fake/fenced", content: '```json\n{"prose":["","",""]}\n```', usage: null };
        }
    };
    const fencedResult = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, fencedClient);
    assert(fencedResult.ok && fencedResult.value.fragments.length === 2 &&
        fencedResult.value.assembly.responseParsing.mode === "recovered" &&
        fencedResult.trace.responseParsing.mode === "recovered" &&
        fencedResult.trace.attempts[0].responseParsing.mode === "recovered",
        "recovered dynamic JSON should be used normally and exchange diagnostics should record recovery mode");

    const extraKeyClient = {
        chat: async function () {
            return {
                ok: true,
                modelId: "fake/extra-key",
                content: JSON.stringify({ prose: ["Before.", "Between.", "After."], note: "ignore me" }),
                usage: null
            };
        }
    };
    const extraKeyResult = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, extraKeyClient);
    assert(extraKeyResult.ok && extraKeyResult.value.assembly.ignoredResponseKeys.join(",") === "note",
        "harmless extra response keys should be ignored and logged rather than causing presentation fallback");

    const badClient = {
        chat: async function () {
            return { ok: true, modelId: "fake/bad", content: "not json at all", usage: null };
        }
    };
    const invalid = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, badClient);
    assert(!invalid.ok && invalid.fallbackUsed && invalid.error.code === "NARRATOR_INVALID_RESPONSE" &&
        invalid.trace.responseParsing.mode === "failed",
        "genuinely unparsable dynamic narrator output should still request raw fallback with failed parsing diagnostics");

    const apiFailureClient = {
        chat: async function () {
            return { ok: false, modelId: "fake/failure", error: { code: "RATE_LIMITED", message: "Synthetic failure." } };
        }
    };
    const apiFailure = await context.setup.NarratorService.narrateTick({ view: view, entries: entries }, apiFailureClient);
    assert(!apiFailure.ok && apiFailure.fallbackUsed && apiFailure.error.code === "RATE_LIMITED" &&
        apiFailure.trace.responseParsing === null,
        "transport/API failure should still use raw fallback without pretending JSON parsing ran");
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
                    assert(input.entries.length === 4, "narrator should receive the complete current-tick raw presentation after the wave");
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
    assert(narratorCalls === 1, "one completed human turn/reaction wave should produce exactly one dynamic narrator request");
    assert(result.narrativeFragments[0] === "LITERARY" && result.rawNarrativeFragments[0] === "Traveler: hello",
        "narrated display output should coexist internally with the retained raw fallback presentation");
    assert(result.historyEntries[0].text === "Traveler: hello" && result.historyEntries.some(function (entry) { return entry.text === "Nell moved."; }),
        "History must remain original raw grounded presentation rather than narrator prose");

    context.setup.NarratorService.narrateTick = async function () {
        throw new Error("synthetic narrator failure");
    };
    const fallback = await context.setup.TurnFlow.submitHumanIntent({ text: "fallback line", target_id: "", action: null });
    assert(fallback.ok && fallback.narrativeFragments[0] === "Traveler: fallback line" && fallback.narrator &&
        fallback.narrator.fallbackUsed && fallback.narrator.error.code === "NARRATOR_PRESENTATION_EXCEPTION",
        "unexpected narrator exceptions must fall back to raw presentation without failing the completed world tick");
}

Promise.resolve()
    .then(testStructuredInputAndTolerantAssembly)
    .then(testRuntimeTransportBudgetsHotSwitchingAndLogging)
    .then(testTolerantDynamicJsonRecovery)
    .then(testNarratorResponseToleranceAndFallback)
    .then(testTurnFlowIntegration)
    .then(function () { console.log("All presentation narrator tests passed."); })
    .catch(function (error) {
        console.error(error && error.stack || error);
        process.exitCode = 1;
    });
