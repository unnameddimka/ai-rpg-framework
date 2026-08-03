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

load("src/generated/world-data.js"); load("src/10-game-api.js"); load("src/21-ai-settings.js");
load("src/22-openrouter-client.js"); load("src/23-ai-protocol.js"); load("src/20-controllers.js");

async function main() {
    let world = fresh();
    assert(world.entities.player.defaultControllerId === "ai" && world.entities.hoodedWoman.defaultControllerId === "ai" &&
        world.control.assignments.hoodedWoman === "ai" && world.control.assignments.innkeeper === "dummy",
        "sample permanent defaults and initial controllers should match the integration fixture");
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
    assert(world.control.assignments.innkeeper === "dummy", "released innkeeper should return directly to dummy default and not queue");

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

    let captured;
    const fetchOk = async function (url, options) { captured = { url: url, options: options }; return { ok: true, status: 200, json: async function () { return { choices: [{ message: { content: "{}" } }], usage: { total_tokens: 3 } }; } }; };
    const clientOk = await setup.OpenRouterClient.chat([{ role: "user", content: "test" }], fetchOk);
    const requestBody = JSON.parse(captured.options.body);
    assert(clientOk.ok && captured.url === setup.OpenRouterClient.ENDPOINT && captured.options.headers.Authorization === `Bearer ${sentinel}` &&
        requestBody.model === setup.OpenRouterClient.MODEL && requestBody.stream === false, "client should use fixed endpoint/model, Bearer key, and non-streaming request");
    async function statusFetch(status) { return { ok: false, status: status, json: async function () { return {}; } }; }
    for (const pair of [[401,"AUTHENTICATION_FAILED"],[402,"INSUFFICIENT_CREDITS"],[429,"RATE_LIMITED"],[503,"PROVIDER_UNAVAILABLE"]]) {
        const result = await setup.OpenRouterClient.chat([], function () { return statusFetch(pair[0]); });
        assert(result.error.code === pair[1] && !JSON.stringify(result).includes(sentinel), `status ${pair[0]} should normalize safely`);
    }
    const network = await setup.OpenRouterClient.chat([], async function () { throw new Error(sentinel); });
    assert(network.error.code === "NETWORK_ERROR" && !JSON.stringify(network).includes(sentinel), "network errors must not leak key or raw exception");
    const malformed = await setup.OpenRouterClient.chat([], async function () { return { ok: true, status: 200, json: async function () { return {}; } }; });
    assert(malformed.error.code === "MALFORMED_PROVIDER_RESPONSE", "malformed provider body should normalize");

    assert(setup.AIProtocol.extractObject("```json\n{\"action\":null}\n```").action === null, "protocol should extract fenced JSON");
    const available = { move: { schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] } } };
    assert(setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "valid no-action decision should pass");
    assert(setup.AIProtocol.validateDecision({ action: { type: "move", destination_id: "bar" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "valid single action decision should pass");
    assert(!setup.AIProtocol.validateDecision({ action: [{ type: "move" }], publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }, available).ok,
        "multiple actions should be rejected");
    assert(!setup.AIProtocol.validateDecision({ action: { type: "move", destination_id: "bar" }, publicNarrative: null, spokenText: null,
        memoryUpdates: { recentMemoriesToAdd: [{ summary: "bad", importance: .5 }], beliefsToUpsert: [], relationshipsToUpsert: [] } }, available).ok,
        "action-stage memory updates should be rejected");
    assert(!setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates(), chainOfThought: "secret" }, available).ok,
        "chain-of-thought or arbitrary protocol fields should be rejected");
    let repairCalls = 0;
    const repairClient = { chat: async function () { repairCalls++; return repairCalls === 1 ? { ok: true, content: "not json" } : response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }); } };
    assert((await setup.AIProtocol.requestValidated([], "decision", available, repairClient)).ok && repairCalls === 2,
        "malformed JSON should trigger exactly one successful repair request");
    repairCalls = 0;
    const badRepair = { chat: async function () { repairCalls++; return { ok: true, content: "still bad" }; } };
    assert(!(await setup.AIProtocol.requestValidated([], "decision", available, badRepair)).ok && repairCalls === 2,
        "second invalid response should abort after one repair");

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
    const twoStage = { chat: async function () { stage++; return stage === 1
        ? response({ action: { type: "read_aura" }, publicNarrative: "She concentrates.", spokenText: null, memoryUpdates: emptyUpdates() })
        : response({ publicNarrative: "Her gaze sharpens.", spokenText: "Curious.", memoryUpdates: { recentMemoriesToAdd: [{ summary: "I read the traveller's aura.", importance: .7 }], beliefsToUpsert: [], relationshipsToUpsert: [] } }); } };
    const twoResult = await setup.AIController.takeNextTurn(twoStage);
    assert(twoResult.ok && twoResult.stages === 2 && twoResult.actionResult.feedback[0].code === "AURA_SCAN_RESULT" && stage === 2,
        "two-stage action turn should ground one formal action before final reaction");

    world = queueHooded(); stage = 0;
    const selectiveClient = { chat: async function () { stage++; if (stage === 1) return response({
        action: { type: "read_aura" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates()
    });
        ok(setup.CharacterAPI.narrate("player", { text: "A new unrelated observation arrives." }), "inject observation during second stage");
        return response({ publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const selectiveResult = await setup.AIController.takeNextTurn(selectiveClient);
    assert(selectiveResult.ok && world.entities.hoodedWoman.mind.pendingObservations.some(function (item) {
        return item.text === "A new unrelated observation arrives.";
    }) && setup.AITurnQueue.peek().characterId === "hoodedWoman",
    "successful two-stage turn should consume supplied IDs only and requeue the actor for unrelated new observations");

    world = queueHooded(); stage = 0;
    const failedActionClient = { chat: async function () { stage++; return stage === 1
        ? response({ action: { type: "take_item", item_id: "missing" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() })
        : response({ publicNarrative: "She finds nothing to take.", spokenText: null, memoryUpdates: emptyUpdates() }); } };
    const failedActionTurn = await setup.AIController.takeNextTurn(failedActionClient);
    assert(failedActionTurn.ok && failedActionTurn.actionResult.error.code === "ITEM_NOT_FOUND" && stage === 2,
        "grounded formal-action failure should still reach and complete result stage");

    world = queueHooded(); const beforeRollback = JSON.stringify(world); stage = 0;
    const rollbackClient = { chat: async function () { stage++; return stage === 1
        ? response({ action: { type: "move", destination_id: "tavernEntrance" }, publicNarrative: "She starts to leave.", spokenText: null, memoryUpdates: emptyUpdates() })
        : { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "OpenRouter is temporarily unavailable." } }; } };
    const rolledBack = await setup.AIController.takeNextTurn(rollbackClient);
    assert(!rolledBack.ok && JSON.stringify(setup.Game.getWorld()) === beforeRollback,
        "second-stage request failure must restore the complete pre-action world and queue");

    world = queueHooded();
    const badMemoryClient = { chat: async function () { return response({ action: null, publicNarrative: "Uncommitted.", spokenText: null, memoryUpdates: {
        recentMemoriesToAdd: [{ summary: "Bad", importance: 9 }], beliefsToUpsert: [], relationshipsToUpsert: []
    } }); } };
    const beforeBadMemory = JSON.stringify(world);
    assert(!(await setup.AIController.takeNextTurn(badMemoryClient)).ok && JSON.stringify(setup.Game.getWorld()) === beforeBadMemory,
        "memory-validation failure should roll back the whole turn");

    setup.AIRuntimeSettings.save(sentinel, false, storage, 1);
    const serializedWorld = JSON.stringify(setup.Game.getWorld());
    const contextJson = JSON.stringify(setup.ContextBuilder.build("hoodedWoman"));
    const generated = fs.readFileSync(path.join(root, "src/generated/world-data.js"), "utf8");
    assert(!serializedWorld.includes(sentinel) && !contextJson.includes(sentinel) && !JSON.stringify(setup.Game.getWorld().debug).includes(sentinel) &&
        !generated.includes(sentinel) && !JSON.stringify(setup.AITransientDebug.lastContext || {}).includes(sentinel),
        "API key sentinel must never enter saveable world, context, logs, generated data, or copied AI context");
    ok(setup.Game.validateWorld(), "world remains valid after mocked AI tests");
    console.log("All AI integration tests passed.");
}

main().catch(function (error) { console.error(error.stack || error); process.exit(1); });
