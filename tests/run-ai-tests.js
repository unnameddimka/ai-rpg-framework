"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(value, message) { assert(value && value.ok, `${message}: ${JSON.stringify(value)}`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function emptyUpdates() { return { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] }; }
function response(value, usage) { return { ok: true, content: JSON.stringify(value), usage: usage || null }; }
function fresh() { setup.Game.resetWorld(); setup.AITurnQueue.repair(); return setup.Game.getWorld(); }
function queueHooded() {
    const world = fresh();
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "player enters common room");
    ok(setup.CharacterAPI.narrate("player", { text: "Hello there.", target_id: "hoodedWoman" }), "narrative queues hooded woman");
    assert(setup.AITurnQueue.peek().characterId === "hoodedWoman", "hooded woman should be queue head");
    return world;
}

load("src/00-model-list.js"); load("src/generated/world-data.js"); load("src/10-game-api.js"); load("src/21-ai-settings.js");
load("src/22-openrouter-client.js"); load("src/23-ai-protocol.js"); load("src/24-ai-request-executor.js"); load("src/24-ai-turn-scheduler.js"); load("src/20-controllers.js"); load("src/24-prompt-lab.js"); load("src/25-turn-flow.js");

async function main() {
    let world = fresh();
    Object.values(setup.GeneratedWorldData.characters).forEach(function (authored) {
        assert(world.entities[authored.id].defaultControllerId === authored.defaultControllerId &&
            world.control.assignments[authored.id] === authored.initialControllerId,
        `runtime controllers for ${authored.id} should match the authoritative world fixture`);
    });
    assert(!Object.prototype.hasOwnProperty.call(world.control, "controllerBeforeHuman") &&
        !JSON.stringify(world).includes("controllerBeforeHuman"), "world must not contain controllerBeforeHuman state");
    world.entities.player.mind.pendingObservations.push({ id: world.nextObservationId++, kind: "event", text: "Pending", data: {} });
    ok(setup.Game.takeHumanControl("hoodedWoman"), "take control of AI-default character");
    assert(world.control.assignments.player === "ai" && setup.AITurnQueue.peek().characterId === "player",
        "released player should return to permanent AI default and queue with pending observations");
    world.entities.hoodedWoman.mind.pendingObservations.push({ id: world.nextObservationId++, kind: "event", text: "Pending", data: {} });
    ok(setup.Game.takeHumanControl("innkeeper"), "take control of dummy-default character");
    assert(world.control.assignments.hoodedWoman === "ai" && setup.AITurnQueue.getStatus().entries.some(function (e) { return e.characterId === "hoodedWoman"; }),
        "released hooded woman should return to AI default and queue");
    ok(setup.Game.takeHumanControl("player"), "return human control to player");
    assert(world.control.assignments.innkeeper === world.entities.innkeeper.defaultControllerId,
        "released innkeeper should return directly to its authored permanent default");

    world = fresh();
    ok(setup.Game.assignNonHumanController("innkeeper", "ai"), "test fixture makes innkeeper an AI observer");
    world.entities.hoodedWoman.locationId = "tavernEntrance"; world.entities.hoodedWoman.sublocationId = "tavernEntranceFloor";
    world.entities.innkeeper.locationId = "tavernEntrance"; world.entities.innkeeper.sublocationId = "tavernEntranceFloor";
    world.ai.turnQueue = []; world.entities.hoodedWoman.mind.pendingObservations = []; world.entities.innkeeper.mind.pendingObservations = [];
    ok(setup.CharacterAPI.narrate("player", { text: "A direct greeting.", target_id: "innkeeper" }), "targeted event");
    assert(setup.AITurnQueue.getStatus().entries.map(function (e) { return e.characterId; }).join(",") === "innkeeper,hoodedWoman",
        "direct addressee should queue before other observers");
    setup.AITurnQueue.enqueue("innkeeper", "duplicate");
    assert(setup.AITurnQueue.getStatus().count === 2, "queue should deduplicate without moving existing entries");
    const saved = JSON.parse(JSON.stringify(world)); State.variables.world = saved;
    assert(setup.AITurnQueue.getStatus().count === 2, "queue should survive JSON save/load");
    State.variables.world.ai.turnQueue.push({ characterId: "innkeeper" }, { characterId: "missing" });
    assert(setup.AITurnQueue.repair().count === 2, "queue repair should remove duplicate and invalid entries while preserving order");
    State.variables.world.control.assignments.innkeeper = "dummy";
    assert(setup.AITurnQueue.getStatus().head.characterId === "hoodedWoman", "stale queue head should be removed");

    const storageData = {};
    const storage = { getItem: function (k) { return storageData[k] || null; }, setItem: function (k, v) { storageData[k] = v; }, removeItem: function (k) { delete storageData[k]; } };
    const sentinel = "sk-or-SENTINEL-DO-NOT-SAVE";
    ok(setup.AIRuntimeSettings.save(sentinel, false, storage, 1000), "memory-only key save");
    assert(!storageData[setup.AIRuntimeSettings.STORAGE_KEY], "memory-only mode should not persist key");
    const remembered = setup.AIRuntimeSettings.save(sentinel, true, storage, 1000);
    assert(remembered.expiresAt === 1000 + setup.AIRuntimeSettings.TTL_MS, "remembered key should expire exactly after 24 hours");
    setup.AIRuntimeSettings.readSaved(storage, 1001);
    assert(setup.AIRuntimeSettings.getKey() === sentinel, "unexpired saved key should restore to transient memory");
    setup.AIRuntimeSettings.forget(storage);
    assert(!setup.AIRuntimeSettings.hasKey() && !storageData[setup.AIRuntimeSettings.STORAGE_KEY], "forget should clear in-memory and persisted key stores");
    storageData[setup.AIRuntimeSettings.STORAGE_KEY] = JSON.stringify({ apiKey: sentinel, expiresAt: 2 });
    setup.AIRuntimeSettings.readSaved(storage, 3);
    assert(!setup.AIRuntimeSettings.hasKey() && !storageData[setup.AIRuntimeSettings.STORAGE_KEY], "expired key should be deleted");
    storageData[setup.AIRuntimeSettings.STORAGE_KEY] = "bad json"; setup.AIRuntimeSettings.readSaved(storage, 3);
    assert(!storageData[setup.AIRuntimeSettings.STORAGE_KEY], "malformed saved key should be deleted");
    const brokenStorage = { getItem: function () { throw new Error("blocked"); }, setItem: function () { throw new Error("blocked"); }, removeItem: function () { throw new Error("blocked"); } };
    const degraded = setup.AIRuntimeSettings.save(sentinel, true, brokenStorage, 1);
    assert(degraded.ok && degraded.warning && setup.AIRuntimeSettings.getKey() === sentinel, "storage failure should degrade to memory-only");

    const modelIds = setup.AIRuntimeSettings.getModels().map(function (model) { return model.id; });
    assert(modelIds.join(",") === "thedrummer/cydonia-24b-v4.1,sao10k/l3.3-euryale-70b" &&
        setup.AIRuntimeSettings.getDefaultModelId() === "thedrummer/cydonia-24b-v4.1" &&
        setup.AIRuntimeSettings.getSelectedModelId() === "thedrummer/cydonia-24b-v4.1",
        "generated model list should expose two candidates and select its authored default");
    const euryaleId = "sao10k/l3.3-euryale-70b";
    const selectedEuryale = setup.AIRuntimeSettings.selectModel(euryaleId, storage);
    assert(selectedEuryale.ok && selectedEuryale.persisted &&
        storageData[setup.AIRuntimeSettings.MODEL_STORAGE_KEY] === euryaleId &&
        setup.AIRuntimeSettings.getSelectedModel().name === "Llama 3.3 Euryale 70B",
        "model selection should validate against model_list.json and persist independently of the API key");
    const rejectedModel = setup.AIRuntimeSettings.selectModel("unknown/model", storage);
    assert(!rejectedModel.ok && rejectedModel.error.code === "UNKNOWN_MODEL" &&
        setup.AIRuntimeSettings.getSelectedModelId() === euryaleId,
        "unknown models must be rejected without changing the active selection");
    storageData[setup.AIRuntimeSettings.MODEL_STORAGE_KEY] = "thedrummer/cydonia-24b-v4.1";
    setup.AIRuntimeSettings.readSaved(storage, 1001);
    assert(setup.AIRuntimeSettings.getSelectedModelId() === "thedrummer/cydonia-24b-v4.1",
        "saved model selection should restore when it still exists in model_list.json");
    setup.AIRuntimeSettings.selectModel(euryaleId, storage);

    let captured;
    const fetchOk = async function (url, options) { captured = { url: url, options: options }; return { ok: true, status: 200, json: async function () { return { choices: [{ message: { content: "{}" } }], usage: { total_tokens: 3 } }; } }; };
    const clientOk = await setup.OpenRouterClient.chat([{ role: "user", content: "test" }], fetchOk);
    const requestBody = JSON.parse(captured.options.body);
    assert(clientOk.ok && captured.url === setup.OpenRouterClient.ENDPOINT && captured.options.headers.Authorization === `Bearer ${sentinel}` &&
        requestBody.model === euryaleId && setup.OpenRouterClient.MODEL === euryaleId && requestBody.stream === false, "client should use the selected model from model_list.json, Bearer key, and non-streaming request");
    async function statusFetch(status) { return { ok: false, status: status, json: async function () { return {}; } }; }
    for (const pair of [[401,"AUTHENTICATION_FAILED"],[402,"INSUFFICIENT_CREDITS"],[429,"RATE_LIMITED"],[503,"PROVIDER_UNAVAILABLE"]]) {
        const result = await setup.OpenRouterClient.chat([], function () { return statusFetch(pair[0]); });
        assert(result.error.code === pair[1] && !JSON.stringify(result).includes(sentinel), `status ${pair[0]} should normalize safely`);
    }
    const rateLimited = await setup.OpenRouterClient.chat([], async function () {
        return {
            ok: false,
            status: 429,
            headers: { get: function (name) { return name === "Retry-After" ? "2" : null; } },
            json: async function () { return {}; }
        };
    });
    assert(rateLimited.error.code === "RATE_LIMITED" && rateLimited.retryAfterMs === 2000 &&
        rateLimited.error.message.includes("2 seconds"),
        "OpenRouter Retry-After should be normalized for the shared executor cooldown");
    const rawProviderError = '{"error":{"message":"Provider quota exceeded","metadata":{"error_type":"rate_limit_exceeded","provider_name":"Parasail"}},"request_id":"req_test_429","user_id":"user_test_fixture_123456"}';
    const sanitizedRawProviderError = '{"error":{"message":"Provider quota exceeded","metadata":{"error_type":"rate_limit_exceeded","provider_name":"Parasail"}},"request_id":"req_test_429","user_id":"[REDACTED_OPENROUTER_USER_ID]"}';
    const detailedRateLimited = await setup.OpenRouterClient.chat([], async function () {
        return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            url: "https://openrouter.ai/api/v1/chat/completions",
            headers: {
                forEach: function (callback) {
                    callback("application/json", "content-type");
                    callback("req_header_429", "x-request-id");
                    callback("3", "retry-after");
                },
                get: function (name) {
                    const values = {
                        "Retry-After": "3",
                        "retry-after": "3",
                        "content-type": "application/json",
                        "x-request-id": "req_header_429"
                    };
                    return values[name] || null;
                }
            },
            text: async function () { return rawProviderError; }
        };
    });
    assert(detailedRateLimited.error.code === "RATE_LIMITED" &&
        detailedRateLimited.error.message.includes("Provider quota exceeded") &&
        detailedRateLimited.error.providerResponse.status === 429 &&
        detailedRateLimited.error.providerResponse.statusText === "Too Many Requests" &&
        detailedRateLimited.error.providerResponse.headers["x-request-id"] === "req_header_429" &&
        detailedRateLimited.error.providerResponse.rawBody === sanitizedRawProviderError &&
        detailedRateLimited.error.providerResponse.parsedBody.error.metadata.provider_name === "Parasail" &&
        detailedRateLimited.error.providerResponse.parsedBody.user_id === "[REDACTED_OPENROUTER_USER_ID]" &&
        !JSON.stringify(detailedRateLimited).includes("user_test_fixture_123456") &&
        detailedRateLimited.retryAfterMs === 3000,
        "OpenRouter failures should retain the complete browser-visible HTTP status, headers, raw body, parsed body, and provider message");
    const network = await setup.OpenRouterClient.chat([], async function () { throw new Error(sentinel); });
    assert(network.error.code === "NETWORK_ERROR" && !JSON.stringify(network).includes(sentinel), "network errors must not leak key or raw exception");
    const malformed = await setup.OpenRouterClient.chat([], async function () { return { ok: true, status: 200, json: async function () { return {}; } }; });
    assert(malformed.error.code === "MALFORMED_PROVIDER_RESPONSE", "malformed provider body should normalize");

    assert(setup.AIProtocol.extractObject("```json\n{\"action\":null}\n```").action === null, "protocol should extract fenced JSON");
    const available = { move: { schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] } } };
    const tracedProviderFailure = await setup.AIProtocol.requestValidated([], "decision", available, {
        chat: async function () { return detailedRateLimited; }
    });
    assert(!tracedProviderFailure.ok &&
        tracedProviderFailure.error.providerResponse.rawBody === sanitizedRawProviderError &&
        tracedProviderFailure.trace.attempts[0].providerResponse.parsedBody.error.metadata.error_type === "rate_limit_exceeded",
        "AI protocol traces should preserve provider HTTP diagnostics instead of collapsing them to code and message");
    assert(setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "valid no-action decision should pass");
    assert(setup.AIProtocol.validateDecision({ action: { type: "move", destination_id: "bar" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "valid single action decision should pass");
    assert(!setup.AIProtocol.validateDecision({ action: [{ type: "move" }], publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "multiple actions should be rejected");
    assert(setup.AIProtocol.validateDecision({ action: { type: "move", destination_id: "bar" }, publicNarrative: "She starts walking.", spokenText: "Come on.",
        memoryUpdates: { recentMemoriesToAdd: [{ summary: "I decided to leave.", importance: .5 }], beliefsToUpsert: [], relationshipsToUpsert: [] } }, available).ok,
        "one response may combine narrative, one formal action, and memory updates");
    const detailedValidation = setup.AIProtocol.validateDecision({
        action: null,
        publicNarrative: null,
        spokenText: null,
        memoryUpdates: { recentMemoriesToAdd: [{ text: "wrong field", importance: 3 }] }
    }, available);
    assert(!detailedValidation.ok &&
        detailedValidation.errors.some(function (error) { return error.includes("beliefsToUpsert is required"); }) &&
        detailedValidation.errors.some(function (error) { return error.includes("summary is required"); }) &&
        detailedValidation.errors.some(function (error) { return error.includes("importance must be a finite number from 0 to 1"); }),
        "protocol validation should expose concrete JSON paths and record errors");
    assert(!setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates(), chainOfThought: "secret" }, available).ok,
        "chain-of-thought or arbitrary protocol fields should be rejected");
    let repairCalls = 0;
    let repairMessages = null;
    const repairClient = { chat: async function (messages) {
        repairCalls++;
        repairMessages = messages;
        return repairCalls === 1 ? { ok: true, content: "not json" } : response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const repairedProtocol = await setup.AIProtocol.requestValidated([], "decision", available, repairClient);
    assert(repairedProtocol.ok && repairCalls === 2 && repairedProtocol.trace.attempts.length === 2 &&
        repairMessages.some(function (message) { return message.role === "user" && message.content.includes("Model response must contain one JSON object only"); }),
        "malformed JSON should trigger one repair request containing the concrete validation error");
    repairCalls = 0;
    const badRepair = { chat: async function () { repairCalls++; return { ok: true, content: "still bad" }; } };
    assert(!(await setup.AIProtocol.requestValidated([], "decision", available, badRepair)).ok && repairCalls === 2,
        "second invalid response should abort after one repair");

    world = queueHooded();
    const schedulerView = setup.AITurnScheduler.getQueueView();
    assert(schedulerView.count === 1 && schedulerView.head.characterId === "hoodedWoman" &&
        schedulerView.head.recipientName === world.entities.hoodedWoman.name &&
        schedulerView.head.observationPreview.some(function (item) { return item.summary.includes("Hello there."); }),
        "scheduler queue view should identify the next recipient and the event that will enter its request");
    const scheduledRequest = setup.AITurnScheduler.buildDecisionRequest("hoodedWoman");
    assert(scheduledRequest.ok && scheduledRequest.actorId === "hoodedWoman" &&
        scheduledRequest.messages[1].content.includes("Hello there.") &&
        scheduledRequest.observationIds.length === schedulerView.head.requestObservationCount,
        "scheduler should build the exact decision request represented by the queue head");

    world = fresh();
    ok(setup.Game.assignNonHumanController("innkeeper", "ai"), "make innkeeper AI for combined-intent test");
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "bar" }), "player enters bar for combined-intent test");
    world.ai.turnQueue = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    const combinedIntent = setup.CharacterAPI.submitIntent("player", {
        text: "Pour me an ale.",
        target_id: "innkeeper",
        noticeability: "noticeable",
        action: { type: "give_money", target_id: "innkeeper", amount: 2 }
    });
    ok(combinedIntent, "combined human intent should be accepted");
    assert(combinedIntent.actionResult.ok && combinedIntent.actionResult.events[0].interactionId === combinedIntent.interactionId &&
        combinedIntent.narrativeResult.event.interactionId === combinedIntent.interactionId,
        "formal and narrative parts should share one interaction ID");
    const combinedRequest = setup.AITurnScheduler.buildDecisionRequest("innkeeper");
    assert(combinedRequest.ok && combinedRequest.observations.length === 1 &&
        combinedRequest.observations[0].kind === "intent" &&
        combinedRequest.observations[0].text.includes("gave 2 gold") &&
        combinedRequest.observations[0].text.includes("Pour me an ale"),
        "scheduler should present one combined intent observation instead of unrelated action and speech records");

    world = fresh();
    ok(setup.Game.assignNonHumanController("innkeeper", "ai"), "make innkeeper AI for reaction-wave test");
    world.entities.hoodedWoman.locationId = "bar";
    world.entities.hoodedWoman.sublocationId = "barPublicSide";
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "bar" }), "player enters bar for reaction-wave test");
    world.ai.turnQueue = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    world.entities.hoodedWoman.mind.pendingObservations = [];
    ok(setup.CharacterAPI.submitIntent("player", {
        text: "Serve me.", target_id: "innkeeper", noticeability: "noticeable", action: null
    }), "player intent should queue all AI observers");
    const waveCalls = [];
    const waveClient = { chat: async function (messages) {
        const payload = JSON.parse(messages[1].content);
        const actorId = payload.context.character.id;
        waveCalls.push({ actorId: actorId, content: messages[1].content });
        if (actorId === "innkeeper") {
            return response({ action: null, publicNarrative: "The innkeeper answers first.", spokenText: "One moment.", memoryUpdates: emptyUpdates() });
        }
        return response({ action: null, publicNarrative: "The hooded woman watches the exchange.", spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const waveResult = await setup.AITurnScheduler.processWave(waveClient);
    assert(waveResult.ok && waveResult.processedCount === 2 &&
        waveCalls.map(function (call) { return call.actorId; }).join(",") === "innkeeper,hoodedWoman" &&
        waveCalls[1].content.includes("The innkeeper answers first") &&
        setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "innkeeper"; }),
        "one reaction wave should process each observer once in priority order, expose earlier reactions to later observers, and defer repeat reactions");

    const executionOrder = [];
    const executorSpec = function (name, delay) {
        return {
            actorId: name,
            purpose: "executor-order-test",
            messages: [],
            stage: "decision",
            availableActions: {},
            client: { chat: async function () {
                executionOrder.push(`${name}:start`);
                if (delay) await new Promise(function (resolve) { setTimeout(resolve, delay); });
                executionOrder.push(`${name}:end`);
                return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
            } }
        };
    };
    const concurrentA = setup.AIRequestExecutor.execute(executorSpec("first", 15));
    const concurrentB = setup.AIRequestExecutor.execute(executorSpec("second", 0));
    const concurrentResults = await Promise.all([concurrentA, concurrentB]);
    assert(concurrentResults.every(function (result) { return result.ok; }) &&
        executionOrder.join(",") === "first:start,first:end,second:start,second:end",
        "shared request executor should serialize game, sphere, repair, and future scheduler requests");

    world = queueHooded();
    const oneStage = { chat: async function () { return response({ action: null, publicNarrative: "She nods.", spokenText: "Greetings.", memoryUpdates: {
        recentMemoriesToAdd: [{ summary: "The traveller greeted me.", importance: .5 }], beliefsToUpsert: [{ id: "belief_greeting", text: "The traveller is civil.", confidence: "medium" }], relationshipsToUpsert: [{ targetCharacterId: "player", summary: "A civil new acquaintance." }]
    } }, { total_tokens: 10 }); } };
    const oneResult = await setup.AIController.takeNextTurn(oneStage);
    assert(oneResult.ok && oneResult.stages === 1 && setup.AITurnQueue.peek() === null && world.entities.hoodedWoman.mind.recentMemories.some(function (m) { return m.summary.includes("greeted"); }),
        "one-stage turn should commit narrative/memory, consume observations, and remove queue head");

    world = queueHooded();
    ok(setup.Game.assignNonHumanController("innkeeper", "ai"), "make innkeeper an AI recipient");
    world.entities.innkeeper.locationId = "commonRoom"; world.entities.innkeeper.sublocationId = "commonRoomFloor";
    const recipientTurn = await setup.AIController.takeNextTurn({ chat: async function () { return response({
        action: null, publicNarrative: "She answers the room.", spokenText: null, memoryUpdates: emptyUpdates()
    }); } });
    assert(recipientTurn.ok && setup.AITurnQueue.peek().characterId === "innkeeper" && setup.AITurnQueue.getStatus().count === 1,
        "one manual turn should queue another AI narrative recipient but never drain or execute it automatically");

    world = queueHooded();
    let stage = 0;
    const singleAction = { chat: async function () { stage++; return response({
        action: { type: "read_aura" },
        publicNarrative: "She concentrates.",
        spokenText: "Curious.",
        memoryUpdates: { recentMemoriesToAdd: [{ summary: "I chose to read the traveller's aura.", importance: .7 }], beliefsToUpsert: [], relationshipsToUpsert: [] }
    }); } };
    const actionResult = await setup.AIController.takeNextTurn(singleAction);
    assert(actionResult.ok && actionResult.stages === 1 && actionResult.actionResult.feedback[0].code === "AURA_SCAN_RESULT" && stage === 1 &&
        setup.AITurnQueue.peek().characterId === "hoodedWoman" &&
        world.entities.hoodedWoman.mind.pendingObservations.some(function (item) { return item.kind === "action_result" || item.kind === "action_feedback"; }),
        "single-request action turn should execute one formal action and queue its grounded result for a later reaction");

    world = queueHooded(); stage = 0;
    const selectiveClient = { chat: async function () {
        stage++;
        ok(setup.CharacterAPI.narrate("player", { text: "A new unrelated observation arrives." }), "inject observation while request is in flight");
        return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const selectiveResult = await setup.AIController.takeNextTurn(selectiveClient);
    assert(selectiveResult.ok && stage === 1 && world.entities.hoodedWoman.mind.pendingObservations.some(function (item) {
        return item.text === "A new unrelated observation arrives.";
    }) && setup.AITurnQueue.peek().characterId === "hoodedWoman",
    "successful single-request turn should consume supplied IDs only and requeue the actor for observations that arrived during the request");

    world = queueHooded(); stage = 0;
    const failedActionClient = { chat: async function () { stage++; return response({
        action: { type: "take_item", item_id: "missing" }, publicNarrative: "She reaches for something that is not there.", spokenText: null, memoryUpdates: emptyUpdates()
    }); } };
    const failedActionTurn = await setup.AIController.takeNextTurn(failedActionClient);
    assert(failedActionTurn.ok && failedActionTurn.actionResult.error.code === "ITEM_NOT_FOUND" && stage === 1 &&
        setup.AITurnQueue.peek().characterId === "hoodedWoman",
        "grounded formal-action failure should complete the turn and remain as an observation for the next reaction wave");

    world = queueHooded();
    const beforeRollback = JSON.stringify(world);
    const failedRequest = await setup.AIController.takeNextTurn({ chat: async function () {
        return { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "OpenRouter is temporarily unavailable." } };
    } });
    assert(!failedRequest.ok && JSON.stringify(setup.Game.getWorld()) === beforeRollback,
        "a failed single model request must preserve the complete pre-turn world and queue");

    world = queueHooded();
    const badMemoryClient = { chat: async function () { return response({ action: null, publicNarrative: "Uncommitted.", spokenText: null, memoryUpdates: {
        recentMemoriesToAdd: [{ summary: "Bad", importance: 9 }], beliefsToUpsert: [], relationshipsToUpsert: []
    } }); } };
    const beforeBadMemory = JSON.stringify(world);
    assert(!(await setup.AIController.takeNextTurn(badMemoryClient)).ok && JSON.stringify(setup.Game.getWorld()) === beforeBadMemory,
        "memory-validation failure should roll back the whole turn");
    assert(setup.AITransientDebug.lastTrace && setup.AITransientDebug.lastTrace.attempts.length === 2 &&
        setup.AITransientDebug.lastTrace.attempts[1].validationErrors.some(function (error) { return error.includes("importance"); }),
        "failed game requests should retain a transient detailed protocol trace");

    world = queueHooded();
    const promptLabBefore = JSON.stringify(world);
    const dryRunClient = { chat: async function () { return response({
        action: null,
        publicNarrative: "A dry-run answer.",
        spokenText: null,
        memoryUpdates: emptyUpdates()
    }, { total_tokens: 4 }); } };
    const dryRun = await setup.PromptLab.testNextQueued(dryRunClient);
    assert(dryRun.ok && JSON.stringify(setup.Game.getWorld()) === promptLabBefore &&
        setup.AITurnQueue.peek().characterId === "hoodedWoman" &&
        setup.PromptLab.getSnapshot().lastRun.trace.attempts.length === 1,
        "prompt lab should test the real next queued prompt without changing world state or advancing the queue");
    let editedMessages = null;
    const editedPrompt = "Return exact JSON for this dry-run test.";
    const editedRun = await setup.PromptLab.retryEdited(editedPrompt, { chat: async function (messages) {
        editedMessages = messages;
        return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } });
    assert(editedRun.ok && editedMessages[0].role === "system" && editedMessages[0].content === editedPrompt &&
        JSON.stringify(setup.Game.getWorld()) === promptLabBefore,
        "prompt lab should retry with an edited system prompt through the same validator without applying the result");

    const exchangeHistory = setup.AIRequestExecutor.getExchangeHistory();
    assert(exchangeHistory.count > 0 && exchangeHistory.entries.some(function (entry) { return entry.request.purpose === "game-decision"; }) &&
        !exchangeHistory.entries.some(function (entry) { return entry.request.purpose === "game-result"; }) &&
        exchangeHistory.entries.some(function (entry) { return entry.request.purpose === "prompt-lab-dry-run"; }),
        "transient exchange history should retain single-request game decisions and sphere dry-runs without a game-result request");
    const exportedExchange = setup.PromptLab.exportExchangeLog(Date.UTC(2026, 7, 4, 19, 0, 0));
    assert(exportedExchange.ok && exportedExchange.filename === "ai-rpg-ai-exchange-20260804-190000Z.json" &&
        exportedExchange.data.schema === setup.PromptLab.EXCHANGE_LOG_SCHEMA &&
        exportedExchange.data.exchangeHistory.count === exchangeHistory.count &&
        exportedExchange.data.runtime.model === euryaleId &&
        exportedExchange.data.security.apiKeyIncluded === false,
        "sphere should export a versioned portable exchange log with the complete transient executor history");
    setup.PromptLab.clear();
    const importedExchange = setup.PromptLab.importExchangeLog(exportedExchange.text, "shared-ai-log.json");
    assert(importedExchange.ok && setup.PromptLab.getSnapshot().hasImportedExchange &&
        setup.PromptLab.getSnapshot().importedFilename === "shared-ai-log.json" &&
        setup.PromptLab.getSnapshot().canReplayImported &&
        JSON.stringify(setup.Game.getWorld()) === promptLabBefore,
        "importing a shared exchange log should restore its focused request and trace without changing the world");
    setup.AIRuntimeSettings.forget(storage);
    const replayedExchange = await setup.PromptLab.replayImportedExchange();
    assert(replayedExchange.ok && JSON.stringify(setup.Game.getWorld()) === promptLabBefore &&
        setup.PromptLab.getSnapshot().lastRun.label === "Replaying recorded exchange",
        "an imported exchange should replay recorded raw replies through the current validator without a key or world mutation");
    assert(!setup.PromptLab.importExchangeLog('{"schema":"wrong"}', "wrong.json").ok,
        "sphere should reject JSON files that are not supported exchange logs");

    world = queueHooded();
    const liveFromSphere = await setup.PromptLab.processNextLive({ chat: async function () { return response({
        action: null,
        publicNarrative: "The sphere permits the scheduled reaction.",
        spokenText: null,
        memoryUpdates: emptyUpdates()
    }); } });
    const liveNarrativeSnapshot = setup.PromptLab.getSnapshot();
    assert(liveFromSphere.ok && setup.AITurnQueue.peek() === null &&
        liveNarrativeSnapshot.status.includes("queue advanced"),
        "crystal sphere live processing should invoke the same manual scheduler and advance only its queue head");
    assert(liveNarrativeSnapshot.narrativeHistory.length === 1 &&
        liveNarrativeSnapshot.narrativeHistory[0].actorId === "hoodedWoman" &&
        liveNarrativeSnapshot.narrativeHistory[0].fragments.includes("The sphere permits the scheduled reaction."),
        "successful sphere live processing should append its public narrative to the transient narrative history");

    ok(setup.CharacterAPI.narrate("player", { text: "Please leave the room.", target_id: "hoodedWoman" }),
        "second narrative queues another sphere live turn");
    const liveActionFromSphere = await setup.PromptLab.processNextLive({ chat: async function () { return response({
        action: { type: "move", destination_id: "tavernEntrance" },
        publicNarrative: "The hooded woman rises and leaves.",
        spokenText: null,
        memoryUpdates: emptyUpdates()
    }); } });
    const liveActionEventTexts = liveActionFromSphere.actionResult.events.map(function (event) { return event.text; });
    const liveActionSnapshot = setup.PromptLab.getSnapshot();
    assert(liveActionFromSphere.ok && liveActionEventTexts.length > 0 &&
        liveActionSnapshot.narrativeHistory.length === 2 &&
        liveActionEventTexts.every(function (text) { return liveActionSnapshot.narrativeHistory[1].fragments.includes(text); }),
        "sphere narrative history should include confirmed formal-action event text as well as model narrative");
    assert(setup.PromptLab.clearNarrativeHistory().ok && setup.PromptLab.getSnapshot().narrativeHistory.length === 0,
        "the sphere narrative history should have an independent clear control");

    setup.AIRuntimeSettings.save(sentinel, false, storage, 1);
    const safeExportWithKey = setup.PromptLab.exportExchangeLog();
    assert(safeExportWithKey.ok && !safeExportWithKey.text.includes(sentinel) && safeExportWithKey.text.includes("apiKeyIncluded"),
        "portable exchange logs must redact the current API key and declare that no key is included");
    const serializedWorld = JSON.stringify(setup.Game.getWorld());
    const contextJson = JSON.stringify(setup.ContextBuilder.build("hoodedWoman"));
    const generated = fs.readFileSync(path.join(root, "src/generated/world-data.js"), "utf8");
    assert(!serializedWorld.includes(sentinel) && !contextJson.includes(sentinel) && !JSON.stringify(setup.Game.getWorld().debug).includes(sentinel) &&
        !generated.includes(sentinel) && !JSON.stringify(setup.AITransientDebug.lastContext || {}).includes(sentinel) &&
        !JSON.stringify(setup.PromptLab.getSnapshot()).includes(sentinel),
        "API key sentinel must never enter saveable world, context, logs, generated data, copied AI context, or prompt-lab traces");

    const timedStarts = [];
    const timedClient = {
        enforceRequestTiming: true,
        chat: async function () {
            timedStarts.push(Date.now());
            return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
        }
    };
    const timedSpec = {
        actorId: "timing-test",
        purpose: "minimum-interval-test",
        messages: [],
        stage: "decision",
        availableActions: {},
        client: timedClient
    };
    await setup.AIRequestExecutor.execute(timedSpec);
    await setup.AIRequestExecutor.execute(timedSpec);
    assert(timedStarts.length === 2 && timedStarts[1] - timedStarts[0] >= 900,
        "shared request executor should leave approximately one second between live transport calls");

    ok(setup.Game.validateWorld(), "world remains valid after mocked AI tests");
    console.log("All AI integration tests passed.");
}

main().catch(function (error) { console.error(error.stack || error); process.exit(1); });
