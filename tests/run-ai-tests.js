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
function normalizeDecisionFixture(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "action")) {
        const normalized = Object.assign({}, value);
        if (!Object.prototype.hasOwnProperty.call(normalized, "spokenTargetId")) normalized.spokenTargetId = null;
        if (!Object.prototype.hasOwnProperty.call(normalized, "spokenLoudness")) normalized.spokenLoudness = normalized.spokenText === null ? null : "noticeable";
        if (!Object.prototype.hasOwnProperty.call(normalized, "continuation")) normalized.continuation = null;
        return normalized;
    }
    return value;
}
function response(value, usage) { return { ok: true, content: JSON.stringify(normalizeDecisionFixture(value)), usage: usage || null }; }
function decisionFixture(value) { return normalizeDecisionFixture(value); }
function fresh() { setup.Game.resetWorld(); setup.AITurnQueue.repair(); return setup.Game.getWorld(); }
function queueHooded() {
    const world = fresh();
    ok(setup.Game.assignNonHumanController("captainPrice", "dummy"), "isolated queue fixture disables Price AI");
    ok(setup.Game.assignNonHumanController("nell", "dummy"), "isolated queue fixture disables Nell AI");
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "player enters common room");
    ok(setup.CharacterAPI.narrate("player", { text: "Hello there.", target_id: "hoodedWoman" }), "narrative queues hooded woman");
    assert(setup.AITurnQueue.peek().characterId === "hoodedWoman", "hooded woman should be queue head");
    return world;
}

load("src/00-model-list.js"); load("src/generated/world-data.js"); load("src/10-game-api.js");
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js"); load("src/21-ai-settings.js");
load("src/21-ai-request-profiles.js");
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

    world = fresh();
    world.entities.hoodedWoman.locationId = "tavernEntrance";
    world.entities.hoodedWoman.sublocationId = "tavernEntranceFloor";
    world.entities.innkeeper.locationId = "commonRoom";
    world.entities.innkeeper.sublocationId = "commonRoomFloor";
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    world.ai.turnQueue = [];
    const movement = setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" });
    ok(movement, "movement should succeed for source/destination perception test");
    assert(movement.events.length === 1 && movement.events[0].type === "character_moved" &&
        movement.events[0].fromLocationId === "tavernEntrance" && movement.events[0].toLocationId === "commonRoom" &&
        movement.events[0].recipients.includes("hoodedWoman") && movement.events[0].recipients.includes("innkeeper") &&
        movement.events[0].text.includes("moved from Tavern entrance to The common room"),
        "one canonical movement event should be delivered to observers on both the source and destination sides");

    world = fresh();
    world.entities.hoodedWoman.locationId = "tavernEntrance";
    world.entities.hoodedWoman.sublocationId = "tavernEntranceFloor";
    world.entities.innkeeper.locationId = "tavernEntrance";
    world.entities.innkeeper.sublocationId = "tavernEntranceFloor";
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    world.ai.turnQueue = [];
    ok(setup.CharacterAPI.narrate("player", { text: "Mara, look here.", target_id: "hoodedWoman" }), "human targeted speech");
    for (let i = 0; i < 4; i++) {
        ok(setup.CharacterAPI.narrate("hoodedWoman", { text: `Innkeeper ping ${i + 1}.`, target_id: "innkeeper" }), "AI targeted speech accumulates initiative");
    }
    assert(setup.AITurnScheduler.getInitiativeScore("hoodedWoman") === 3 &&
        setup.AITurnScheduler.getInitiativeScore("innkeeper") === 4 &&
        setup.AITurnQueue.getStatus().entries[0].characterId === "hoodedWoman" &&
        setup.AITurnScheduler.getQueueView().head.characterId === "innkeeper",
        "initiative should be derived additively from pending targeted observations and may reorder the stable saved queue");

    function prepareInnkeeperSpeechFixture() {
        const speechWorld = fresh();
        ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "bar" }), "speech loudness fixture moves player to bar");
        speechWorld.entities.hoodedWoman.locationId = "bar";
        speechWorld.entities.hoodedWoman.sublocationId = "barPublicSide";
        speechWorld.entities.hoodedWoman.mind.pendingObservations = [];
        return speechWorld;
    }
    function sortedRecipients(event) { return event.recipients.slice().sort().join(","); }

    world = prepareInnkeeperSpeechFixture();
    const humanQuietEvent = setup.CharacterAPI.narrate("innkeeper", {
        text: "Keep this between us.", target_id: "player", noticeability: "hidden"
    }).event;
    const expectedQuietRecipients = sortedRecipients(humanQuietEvent);
    world = prepareInnkeeperSpeechFixture();
    const aiQuietTurn = await setup.AIController.takeQueuedTurn("innkeeper", { chat: async function () { return response({
        action: null, publicNarrative: null, spokenText: "Keep this between us.", spokenTargetId: "player", spokenLoudness: "hidden", memoryUpdates: emptyUpdates()
    }); } });
    const aiQuietEvent = aiQuietTurn.intentResult.narrativeResult.event;
    assert(aiQuietTurn.ok && aiQuietEvent.noticeability === "hidden" && sortedRecipients(aiQuietEvent) === expectedQuietRecipients &&
        expectedQuietRecipients === "player" && !aiQuietEvent.recipients.includes("hoodedWoman"),
        "AI quiet speech should use the same canonical delivery semantics as equivalent HumanController quiet speech");

    world = prepareInnkeeperSpeechFixture();
    const humanNormalEvent = setup.CharacterAPI.narrate("innkeeper", {
        text: "*whispers* This wording is only style.", target_id: "player", noticeability: "noticeable"
    }).event;
    const expectedNormalRecipients = sortedRecipients(humanNormalEvent);
    world = prepareInnkeeperSpeechFixture();
    const aiNormalTurn = await setup.AIController.takeQueuedTurn("innkeeper", { chat: async function () { return response({
        action: null, publicNarrative: null, spokenText: "*whispers* This wording is only style.", spokenTargetId: "player", spokenLoudness: "noticeable", memoryUpdates: emptyUpdates()
    }); } });
    const aiNormalEvent = aiNormalTurn.intentResult.narrativeResult.event;
    assert(aiNormalTurn.ok && aiNormalEvent.noticeability === "noticeable" && sortedRecipients(aiNormalEvent) === expectedNormalRecipients &&
        aiNormalEvent.recipients.includes("hoodedWoman"),
        "AI narrated whisper wording must not override structured normal loudness or change canonical recipients");

    world = fresh();
    let automaticTickCalls = 0;
    const originalProcessAfterSubmit = setup.AITurnScheduler.processAfterSubmit;
    setup.AITurnScheduler.processAfterSubmit = async function () {
        automaticTickCalls++;
        return { ok: true, processedCount: 0, reactedCharacterIds: [], results: [], remainingQueue: setup.AITurnScheduler.getQueueView() };
    };
    const invalidHumanAttempt = await setup.TurnFlow.submitHumanIntent({ action: { type: "move", destination_id: "villageTemple" } });
    assert(!invalidHumanAttempt.ok && invalidHumanAttempt.turnConsumed === false && automaticTickCalls === 0,
        "a HumanController request rejected by the canonical action contract must not consume the turn or start an AI world tick");
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "blocked-turn fixture enters common room");
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "upstairsCorridor" }), "blocked-turn fixture climbs upstairs");
    const failedHumanAttempt = await setup.TurnFlow.submitHumanIntent({ action: { type: "move", destination_id: "guestRoom1" } });
    setup.AITurnScheduler.processAfterSubmit = originalProcessAfterSubmit;
    assert(failedHumanAttempt.ok && failedHumanAttempt.turnConsumed === true &&
        failedHumanAttempt.intentResult.actionResult && failedHumanAttempt.intentResult.actionResult.ok === false &&
        failedHumanAttempt.intentResult.actionResult.error.code === "TRANSITION_BLOCKED" &&
        failedHumanAttempt.intentResult.actionResult.error.message === "The door is locked." && automaticTickCalls === 1 &&
        setup.Game.getWorld().entities.player.locationId === "upstairsCorridor",
        "an authored blocked transition must consume the HumanController turn, preserve location, and start the AI world tick");

    // Normal ticks should publish each committed block before the full causal reaction wave resolves.
    world = fresh();
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "progressive tick fixture enters common room");
    const originalProgressiveProcessAfterSubmit = setup.AITurnScheduler.processAfterSubmit;
    const priceProgressResult = { ok: true, actorId: "captainPrice", narrativeText: "Price gives a brief nod.", intentResult: { narrativeResult: null }, actionResult: null };
    const nellProgressResult = { ok: true, actorId: "nell", narrativeText: "Nell smiles in passing.", intentResult: { narrativeResult: null }, actionResult: null };
    setup.AITurnScheduler.processAfterSubmit = async function (client, options) {
        options.onCommittedResult(priceProgressResult);
        await new Promise(function (resolve) { setTimeout(resolve, 5); });
        options.onCommittedResult(nellProgressResult);
        return { ok: true, processedCount: 2, reactedCharacterIds: ["captainPrice", "nell"], results: [priceProgressResult, nellProgressResult], remainingQueue: setup.AITurnScheduler.getQueueView() };
    };
    const progressiveTickBatches = [];
    let progressiveTickResolved = false;
    const progressiveTickPromise = setup.TurnFlow.submitHumanIntent({ text: "Evening.", target_id: "", noticeability: "noticeable" }, null, {
        onCommittedPresentation: function (batch) {
            assert(progressiveTickResolved === false, "committed tick blocks must publish before the whole tick promise resolves");
            progressiveTickBatches.push(clone(batch));
        }
    });
    const progressiveTickResult = await progressiveTickPromise;
    progressiveTickResolved = true;
    setup.AITurnScheduler.processAfterSubmit = originalProgressiveProcessAfterSubmit;
    ok(progressiveTickResult, "progressive normal tick fixture should complete");
    assert(progressiveTickBatches.length === 3 && progressiveTickBatches[0].meta.phase === "human" &&
        progressiveTickBatches[1].meta.phase === "ai-reaction" && progressiveTickBatches[1].meta.actorId === "captainPrice" &&
        progressiveTickBatches[2].meta.actorId === "nell",
        `normal tick output should commit in human -> AI -> AI order: ${JSON.stringify(progressiveTickBatches)}`);
    assert(progressiveTickResult.narrativeFragments.length === 3 &&
        progressiveTickResult.narrativeFragments.filter(function (text) { return text.includes("Price gives a brief nod"); }).length === 1,
        "final tick aggregation should contain the same committed blocks exactly once rather than duplicate progressive output");

    world = fresh();
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "AI presentation attribution fixture enters common room");
    const attributedNarrative = setup.TurnFlow.describeAIResult({
        ok: true,
        actorId: "captainPrice",
        narrativeText: "*Takes a slow sip of ale, eyes tracking the newcomer.*",
        intentResult: { narrativeResult: null },
        actionResult: null
    }, "player");
    assert(attributedNarrative.visible.length === 1 &&
        attributedNarrative.visible[0] === "Captain John Price: *Takes a slow sip of ale, eyes tracking the newcomer.*" &&
        attributedNarrative.entries[0].actorName === "Captain John Price",
        "player-facing AI narrative should explicitly identify the acting character while preserving actor metadata");

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
    assert(modelIds.join(",") === [
        "thedrummer/cydonia-24b-v4.1",
        "sao10k/l3.3-euryale-70b",
        "sao10k/l3.3-euryale-70b:nitro",
        "sao10k/l3.1-euryale-70b:nitro",
        "mistralai/mistral-small-3.2-24b-instruct",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4-flash"
    ].join(",") &&
        setup.AIRuntimeSettings.getDefaultModelId() === "thedrummer/cydonia-24b-v4.1" &&
        setup.AIRuntimeSettings.getSelectedModelId() === "thedrummer/cydonia-24b-v4.1",
        "generated model list should expose all configured candidates and select its authored default");
    assert(setup.AIRuntimeSettings.getDefaultNarratorModelId() === "sao10k/l3.3-euryale-70b:nitro" &&
        setup.AIRuntimeSettings.getSelectedNarratorModelId() === "sao10k/l3.3-euryale-70b:nitro",
        "narrator model selection should start from its independently authored default");
    assert(setup.AIRuntimeSettings.getDefaultUtilityModelId() === "deepseek/deepseek-v4-flash" &&
        setup.AIRuntimeSettings.getSelectedUtilityModelId() === "deepseek/deepseek-v4-flash",
        "utility model selection should start from the independently authored DeepSeek V4 Flash default");
    const characterBeforeUtilitySelection = setup.AIRuntimeSettings.getSelectedModelId();
    const utilitySelection = setup.AIRuntimeSettings.selectUtilityModel("deepseek/deepseek-v4-pro", storage);
    assert(utilitySelection.ok && utilitySelection.persisted &&
        storageData[setup.AIRuntimeSettings.UTILITY_MODEL_STORAGE_KEY] === "deepseek/deepseek-v4-pro" &&
        setup.AIRuntimeSettings.getSelectedModelId() === characterBeforeUtilitySelection,
        "utility model selection should persist independently without changing the character model");
    setup.AIRuntimeSettings.selectUtilityModel(setup.AIRuntimeSettings.getDefaultUtilityModelId(), storage);
    const characterModelBeforeNarratorSelection = setup.AIRuntimeSettings.getSelectedModelId();
    const narratorSelection = setup.AIRuntimeSettings.selectNarratorModel("deepseek/deepseek-v4-pro", storage);
    assert(narratorSelection.ok && narratorSelection.persisted &&
        storageData[setup.AIRuntimeSettings.NARRATOR_MODEL_STORAGE_KEY] === "deepseek/deepseek-v4-pro" &&
        setup.AIRuntimeSettings.getSelectedModelId() === characterModelBeforeNarratorSelection,
        "narrator model selection should persist independently without changing the character model");
    setup.AIRuntimeSettings.selectNarratorModel(setup.AIRuntimeSettings.getDefaultNarratorModelId(), storage);
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
        requestBody.model === euryaleId && setup.OpenRouterClient.MODEL === euryaleId && requestBody.stream === false &&
        requestBody.max_tokens === 6000 && requestBody.reasoning && requestBody.reasoning.max_tokens === 1500 &&
        requestBody.provider && requestBody.provider.sort === "latency" && requestBody.provider.allow_fallbacks === true,
        "client should use the selected model, Bearer key, non-streaming transport, explicit completion/reasoning headroom, and latency-first provider routing");
    const boundedClientOk = await setup.OpenRouterClient.chatWithOptions([{ role: "user", content: "structured" }], {
        maxTokens: 1200, reasoningEffort: "none", temperature: 0.2
    }, fetchOk);
    const boundedRequestBody = JSON.parse(captured.options.body);
    assert(boundedClientOk.ok && boundedRequestBody.max_tokens === 1200 && boundedRequestBody.temperature === 0.2 &&
        boundedRequestBody.reasoning && boundedRequestBody.reasoning.effort === "none" &&
        !Object.prototype.hasOwnProperty.call(boundedRequestBody.reasoning, "max_tokens"),
        "bounded structural requests should be able to disable model reasoning explicitly without changing the normal client defaults");
    const utilityProfile = setup.AIRequestProfiles.resolve("timelapse-plan", { actorId: "hoodedWoman" });
    assert(utilityProfile.modelId === setup.AIRuntimeSettings.getSelectedUtilityModelId() &&
        utilityProfile.reasoningEffort === "none" && utilityProfile.providerSort === "latency" &&
        typeof utilityProfile.sessionId === "string" && utilityProfile.sessionId.includes("hoodedWoman"),
        "timelapse request profile should use the utility model, no reasoning, latency routing, and a stable actor-scoped sticky session");
    await setup.OpenRouterClient.chatWithOptions([{ role: "user", content: "profiled" }], utilityProfile, fetchOk);
    const profiledBody = JSON.parse(captured.options.body);
    assert(profiledBody.model === setup.AIRuntimeSettings.getSelectedUtilityModelId() &&
        profiledBody.provider.sort === "latency" && profiledBody.session_id === utilityProfile.sessionId,
        "profiled OpenRouter requests should carry the resolved utility model, latency provider sort, and session_id");
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
    const truncated = await setup.OpenRouterClient.chat([], async function () {
        return { ok: true, status: 200, json: async function () {
            return { choices: [{ finish_reason: "length", message: { content: null } }], usage: { completion_tokens: 3000, reasoning_tokens: 1500 } };
        } };
    });
    assert(truncated.error.code === "MODEL_OUTPUT_TRUNCATED" &&
        truncated.error.message.includes("completion token limit"),
        "finish_reason length must be classified as model output truncation rather than malformed provider content");

    assert(setup.AIProtocol.extractObject("```json\n{\"action\":null}\n```").action === null, "protocol should extract fenced JSON");
    const available = { move: {
        schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] },
        options: { destination_ids: ["bar"] }
    } };
    const validationMessages = setup.AIProtocol.decisionMessages({
        schemaVersion: 1,
        view: { available_actions: available },
        character: { aiDescription: "Test actor" },
        mind: { knownFacts: [], beliefs: [], relationships: [], recentMemories: [], longTermMemories: [] },
        continuation: null,
        pendingObservations: []
    });
    const decisionPrompt = validationMessages[0].content;
    assert(decisionPrompt.includes("Available actions are capabilities, not recommendations") &&
        decisionPrompt.includes("Spontaneous initiative is valid") &&
        decisionPrompt.includes("Do not invent a task merely because an action is available") &&
        decisionPrompt.includes("continuation is your nullable, free-form, private working intention") &&
        decisionPrompt.includes("unfinished purpose, never an action queue") &&
        decisionPrompt.includes("keep that purpose in continuation") &&
        decisionPrompt.includes("do not start a purposive movement or task and immediately discard why") &&
        decisionPrompt.includes("complete local action may leave continuation null") &&
        decisionPrompt.includes("normally make progress rather than return an accidental no-op") &&
        decisionPrompt.includes("currently available formal action clearly advances it") &&
        decisionPrompt.includes("available_actions describes only what is possible right now") &&
        decisionPrompt.includes("Choose the action type from its semantic description first") &&
        decisionPrompt.includes("continuation never overrides the current canonical view") &&
        decisionPrompt.includes("do not blindly repeat the same action"),
        "decision prompt should distinguish capabilities from motives, preserve unfinished purpose, and advance one current grounded step without creating a plan queue");
    assert(decisionPrompt.includes("Directly addressed meaningful speech normally deserves an in-character response") &&
        decisionPrompt.includes("completely empty no-op after direct address should be deliberate") &&
        decisionPrompt.includes("already passed deterministic perception and delivery rules") &&
        decisionPrompt.includes("treat it as perceived") &&
        decisionPrompt.includes("do not second-guess audibility or visibility"),
        "decision prompt should treat delivered direct speech as perceived while preserving intentional in-character silence");
    assert(decisionPrompt.includes("Character IDs are persistent identities") &&
        decisionPrompt.includes("same character id is the same person after leaving and returning") &&
        decisionPrompt.includes("location changes do not reset familiarity") &&
        decisionPrompt.includes("memoryUpdates should normally remain empty") &&
        decisionPrompt.includes("not copies of obvious current view state") &&
        decisionPrompt.includes("relationships describe durable or developing social state") &&
        decisionPrompt.includes("do not use them to store momentary presence"),
        "decision prompt should preserve social identity across room transitions and avoid transient mind pollution");
    assert(decisionPrompt.includes("spokenLoudness is per utterance, not persistent state") &&
        decisionPrompt.includes('must be "noticeable" or "hidden"') &&
        decisionPrompt.includes("Choose spokenLoudness structurally for this utterance") &&
        decisionPrompt.includes("writing *whispers*, *in a low voice*, or similar prose does not change mechanical loudness") &&
        decisionPrompt.includes("framework owns who receives the resulting observation"),
        "decision prompt should make speech loudness a structured per-utterance mechanic rather than prose inference");
    assert(decisionPrompt.includes("ongoing role-playing scene") &&
        decisionPrompt.includes("publicNarrative is brief visible behavior or atmosphere") &&
        decisionPrompt.includes("Use spokenText for dialogue in the character's own voice") &&
        decisionPrompt.includes("ordinary text is spoken dialogue") &&
        decisionPrompt.includes("paired single asterisks") &&
        decisionPrompt.includes("spokenText may include short *inline narration*") &&
        decisionPrompt.includes("Narrated behavior never mutates canonical state") &&
        decisionPrompt.includes("generic assistant-like NPC replies") &&
        decisionPrompt.includes("formal action in this response is only an attempt") &&
        decisionPrompt.includes("Small visible behavior that does not change canonical state may stay narrative") &&
        decisionPrompt.includes("small sip that does not mechanically consume the whole drink") &&
        decisionPrompt.includes("Narrative is not an alternate execution channel") &&
        decisionPrompt.includes("multi-step mechanical task successfully changed the world or is complete") &&
        decisionPrompt.includes("Do not record an unconfirmed mechanical completion") &&
        decisionPrompt.includes("silently verify the current view against continuation") &&
        decisionPrompt.includes("must not claim that the formal action or a multi-step mechanical task successfully changed the world"),
        "technical prompt should retain concise RP while preventing narrative or memory from skipping grounded task progress");
    assert(setup.Game.ActionRegistry.move.description.includes("Leave the current location") &&
        setup.Game.ActionRegistry.move.description.includes("listed location IDs") &&
        setup.Game.ActionRegistry.move_within_location.description.includes("Stay in the current location") &&
        setup.Game.ActionRegistry.move_within_location.description.includes("listed sublocation IDs") &&
        setup.Game.ActionRegistry.move_within_location.description.includes("never a location ID"),
        "canonical movement action descriptions should clearly distinguish location movement from sublocation movement");
    const requiredShape = JSON.parse(validationMessages[1].content).requiredResponseShape;
    assert(Object.prototype.hasOwnProperty.call(requiredShape, "continuation") && requiredShape.continuation === null,
        "decision requests should require a nullable continuation field");
    assert(Object.prototype.hasOwnProperty.call(requiredShape, "spokenLoudness") && requiredShape.spokenLoudness === null,
        "decision requests should require per-utterance structured speech loudness");
    const tracedProviderFailure = await setup.AIProtocol.requestValidated(validationMessages, "decision", {
        chat: async function () { return detailedRateLimited; }
    });
    assert(!tracedProviderFailure.ok &&
        tracedProviderFailure.error.providerResponse.rawBody === sanitizedRawProviderError &&
        tracedProviderFailure.trace.attempts[0].providerResponse.parsedBody.error.metadata.error_type === "rate_limit_exceeded",
        "AI protocol traces should preserve provider HTTP diagnostics instead of collapsing them to code and message");
    assert(setup.AIProtocol.validateDecision(decisionFixture({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }), available).ok,
        "valid no-action decision should pass");
    assert(setup.AIProtocol.validateDecision(decisionFixture({ action: null, publicNarrative: null, spokenText: null, continuation: "Keep watching the traveler.", memoryUpdates: emptyUpdates() }), available).ok &&
        !setup.AIProtocol.validateDecision(decisionFixture({ action: null, publicNarrative: null, spokenText: null, continuation: { goal: "invalid" }, memoryUpdates: emptyUpdates() }), available).ok,
        "continuation should accept only a string or null");
    assert(setup.AIProtocol.validateDecision(decisionFixture({ action: { type: "move", destination_id: "bar" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }), available).ok,
        "valid single action decision should pass");
    const unavailableMove = setup.AIProtocol.validateDecision(decisionFixture({ action: { type: "move", destination_id: "street" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }), available);
    assert(!unavailableMove.ok && unavailableMove.errors.some(function (error) {
        return error.includes("selected unavailable option") && error.includes("street") && error.includes("Allowed values") && error.includes("bar");
    }), "action protocol should reject structurally valid values outside current view options and expose the allowed values");

    const optionCatalog = {
        take_item: { schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] }, options: { item_ids: ["mug"] } },
        drop_item: { schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] }, options: { item_ids: ["mug"] } },
        give_item: { schema: { properties: { type: {}, target_id: {}, item_id: {} }, required: ["type", "target_id", "item_id"] }, options: { target_ids: ["player"], item_ids: ["mug"] } },
        give_money: { schema: { properties: { type: {}, target_id: {}, amount: { type: "integer", minimum: 1 } }, required: ["type", "target_id", "amount"] }, options: { target_ids: ["player"], maximum_amount: 3 } },
        place_item: { schema: { properties: { type: {}, item_id: {}, target_inventory_id: {} }, required: ["type", "item_id", "target_inventory_id"] }, options: { item_ids: ["mug"], target_inventory_ids: ["table"] } },
        fill: { schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] }, options: { item_ids: ["mug"] } },
        consume: { schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] }, options: { item_ids: ["ale"] } },
        use_item: { schema: { properties: { type: {}, item_id: {} }, required: ["type", "item_id"] }, options: { item_ids: ["memoryStone_01"] } }
    };
    function optionDecision(action) {
        return setup.AIProtocol.validateDecision(decisionFixture({ action: action, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }), optionCatalog);
    }
    assert(!optionDecision({ type: "take_item", item_id: "missing" }).ok &&
        !optionDecision({ type: "drop_item", item_id: "missing" }).ok &&
        !optionDecision({ type: "give_item", target_id: "missing", item_id: "mug" }).ok &&
        !optionDecision({ type: "give_item", target_id: "player", item_id: "missing" }).ok &&
        !optionDecision({ type: "give_money", target_id: "missing", amount: 1 }).ok &&
        !optionDecision({ type: "give_money", target_id: "player", amount: 4 }).ok &&
        !optionDecision({ type: "place_item", item_id: "mug", target_inventory_id: "missing" }).ok &&
        !optionDecision({ type: "fill", item_id: "missing" }).ok &&
        !optionDecision({ type: "consume", item_id: "missing" }).ok &&
        !optionDecision({ type: "use_item", item_id: "missing" }).ok &&
        optionDecision({ type: "use_item", item_id: "memoryStone_01" }).ok &&
        optionDecision({ type: "give_item", target_id: "player", item_id: "mug" }).ok,
        "current action options should constrain item, target, destination, inventory, and amount parameters");
    assert(setup.AIProtocol.validateDecision(decisionFixture({
        action: { type: "place_item", item_id: "mug", target_inventory_id: "table" },
        publicNarrative: null,
        spokenText: null,
        continuation: "Take the mug to the bar",
        memoryUpdates: emptyUpdates()
    }), optionCatalog).ok,
        "mechanical validation should not become an engine-side planner that rejects a valid action merely because it appears inconsistent with free-form continuation");
    assert(!setup.AIProtocol.validateDecision(decisionFixture({ action: [{ type: "move" }], publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() }), available).ok,
        "multiple actions should be rejected");
    assert(setup.AIProtocol.validateDecision(decisionFixture({ action: { type: "move", destination_id: "bar" }, publicNarrative: "She starts walking.", spokenText: "Come on.",
        memoryUpdates: { recentMemoriesToAdd: [{ summary: "I decided to leave.", importance: .5 }], beliefsToUpsert: [], relationshipsToUpsert: [] } }), available).ok,
        "one response may combine narrative, one formal action, and memory updates");
    assert(setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: "Mara?", spokenTargetId: "hoodedWoman", spokenLoudness: "noticeable", continuation: null, memoryUpdates: emptyUpdates() }, available, ["hoodedWoman"]).ok &&
        !setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: "Who are you?", spokenTargetId: "missing", spokenLoudness: "noticeable", continuation: null, memoryUpdates: emptyUpdates() }, available, ["hoodedWoman"]).ok &&
        !setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, spokenTargetId: "hoodedWoman", spokenLoudness: null, continuation: null, memoryUpdates: emptyUpdates() }, available, ["hoodedWoman"]).ok,
        "structured spokenTargetId should identify a visible speech addressee without being inferred from free-form dialogue");
    const canonicalLoudness = setup.CharacterAPI.getSpeechLoudnessValues();
    assert(JSON.stringify(canonicalLoudness) === JSON.stringify(["noticeable", "hidden"]) &&
        canonicalLoudness.every(function (value) {
            return setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: "Test.", spokenTargetId: null, spokenLoudness: value, continuation: null, memoryUpdates: emptyUpdates() }, available).ok;
        }) &&
        !setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: "Test.", spokenTargetId: null, spokenLoudness: "whisper", continuation: null, memoryUpdates: emptyUpdates() }, available).ok &&
        !setup.AIProtocol.validateDecision({ action: null, publicNarrative: null, spokenText: null, spokenTargetId: null, spokenLoudness: "hidden", continuation: null, memoryUpdates: emptyUpdates() }, available).ok,
        "AI speech loudness should reuse the canonical HumanController values and reject inconsistent or invented values");
    const detailedValidation = setup.AIProtocol.validateDecision(decisionFixture({
        action: null,
        publicNarrative: null,
        spokenText: null,
        memoryUpdates: { recentMemoriesToAdd: [{ text: "wrong field", importance: 3 }] }
    }), available);
    assert(!detailedValidation.ok &&
        detailedValidation.errors.some(function (error) { return error.includes("beliefsToUpsert is required"); }) &&
        detailedValidation.errors.some(function (error) { return error.includes("summary is required"); }) &&
        detailedValidation.errors.some(function (error) { return error.includes("importance must be a finite number from 0 to 1"); }),
        "protocol validation should expose concrete JSON paths and record errors");
    assert(!setup.AIProtocol.validateDecision(decisionFixture({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates(), chainOfThought: "secret" }), available).ok,
        "chain-of-thought or arbitrary protocol fields should be rejected");
    let repairCalls = 0;
    let repairMessages = null;
    const repairClient = { chat: async function (messages) {
        repairCalls++;
        repairMessages = messages;
        return repairCalls === 1 ? { ok: true, content: "not json" } : response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const repairedProtocol = await setup.AIProtocol.requestValidated(validationMessages, "decision", repairClient);
    assert(repairedProtocol.ok && repairCalls === 2 && repairedProtocol.trace.attempts.length === 2 &&
        repairMessages.some(function (message) { return message.role === "user" && message.content.includes("Model response must contain one JSON object only"); }),
        "malformed JSON should trigger one repair request containing the concrete validation error");
    let optionRepairCalls = 0;
    let optionRepairMessages = null;
    const optionRepairClient = { chat: async function (messages) {
        optionRepairCalls++;
        optionRepairMessages = messages;
        return optionRepairCalls === 1
            ? response({ action: { type: "move", destination_id: "street" }, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() })
            : response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } };
    const optionRepaired = await setup.AIProtocol.requestValidated(validationMessages, "decision", optionRepairClient);
    assert(optionRepaired.ok && optionRepairCalls === 2 && optionRepairMessages.some(function (message) {
        return message.role === "user" && message.content.includes("selected unavailable option") && message.content.includes("street") &&
            message.content.includes("Preserve the character's underlying purpose") && message.content.includes("Current action catalog") &&
            message.content.includes("destination_ids=[\"bar\"]");
    }), "unavailable concrete action options should enter repair with allowed values, purpose-preserving guidance, and the current catalog");

    const movementCatalog = {
        move: {
            description: setup.Game.ActionRegistry.move.description,
            schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] },
            options: { destination_ids: ["bar"] }
        },
        move_within_location: {
            description: setup.Game.ActionRegistry.move_within_location.description,
            schema: { properties: { type: {}, destination_id: {} }, required: ["type", "destination_id"] },
            options: { destination_ids: ["commonRoomTableOne", "underStairsNook"] }
        }
    };
    const movementMessages = setup.AIProtocol.decisionMessages({
        schemaVersion: 1,
        view: { available_actions: movementCatalog },
        character: { aiDescription: "Test actor" },
        mind: { knownFacts: [], beliefs: [], relationships: [], recentMemories: [], longTermMemories: [] },
        continuation: "Take the empty mug to the bar",
        pendingObservations: []
    });
    let movementRepairCalls = 0;
    let movementRepairMessages = null;
    const movementRepairClient = { chat: async function (messages) {
        movementRepairCalls++;
        movementRepairMessages = messages;
        return movementRepairCalls === 1
            ? response({ action: { type: "move_within_location", destination_id: "bar" }, publicNarrative: null, spokenText: null, continuation: "Take the empty mug to the bar", memoryUpdates: emptyUpdates() })
            : response({ action: { type: "move", destination_id: "bar" }, publicNarrative: null, spokenText: null, continuation: "Take the empty mug to the bar", memoryUpdates: emptyUpdates() });
    } };
    const movementRepaired = await setup.AIProtocol.requestValidated(movementMessages, "decision", movementRepairClient);
    assert(movementRepaired.ok && movementRepaired.value.action.type === "move" && movementRepairCalls === 2 &&
        movementRepairMessages.some(function (message) {
            return message.role === "user" && message.content.includes('Allowed values for action "move_within_location"') &&
                message.content.includes("commonRoomTableOne") && message.content.includes("- move:") &&
                message.content.includes("destination_ids=[\"bar\"]") &&
                message.content.includes("Do not fall back to action:null solely because the previous action type or option was invalid");
        }), "repair should preserve the purpose and make the correct action type/options easy to recover after a movement-schema mistake");
    repairCalls = 0;
    const badRepair = { chat: async function () { repairCalls++; return { ok: true, content: "still bad" }; } };
    assert(!(await setup.AIProtocol.requestValidated(validationMessages, "decision", badRepair)).ok && repairCalls === 2,
        "second invalid response should abort after one repair");

    world = queueHooded();
    const schedulerView = setup.AITurnScheduler.getQueueView();
    assert(schedulerView.count === 1 && schedulerView.head.characterId === "hoodedWoman" &&
        schedulerView.head.recipientName === world.entities.hoodedWoman.name &&
        schedulerView.head.observationPreview.some(function (item) { return item.summary.includes("Hello there."); }),
        "scheduler queue view should identify the next recipient and the event that will enter its request");
    const scheduledRequest = setup.AITurnScheduler.buildDecisionRequest("hoodedWoman");
    const scheduledPayload = JSON.parse(scheduledRequest.messages[1].content);
    assert(scheduledRequest.ok && scheduledRequest.actorId === "hoodedWoman" &&
        scheduledRequest.messages[1].content.includes("Hello there.") &&
        scheduledRequest.observationIds.length === schedulerView.head.requestObservationCount,
        "scheduler should build the exact decision request represented by the queue head");
    const canonicalScheduledView = setup.CharacterAPI.getView("hoodedWoman");
    assert(JSON.stringify(scheduledPayload.context.view) === JSON.stringify(canonicalScheduledView) &&
        scheduledPayload.context.pendingObservations.length > 0 &&
        scheduledPayload.context.view.available_actions &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload.context, "availableActions") &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload, "pendingObservations") &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload.context.mind, "pendingObservations") &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload.context.character, "id") &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload.context.character, "name") &&
        !Object.prototype.hasOwnProperty.call(scheduledPayload.context.character, "abilities") &&
        scheduledPayload.context.continuation === null &&
        JSON.stringify(setup.AIProtocol.actionCatalogFromMessages(scheduledRequest.messages)) ===
            JSON.stringify(canonicalScheduledView.available_actions),
        "AI request should embed the unchanged canonical player view once and add only private character context");

    ok(setup.AIWorkingState.setContinuation("hoodedWoman", "Follow the traveler until I understand what they want."), "store model working continuation");
    const continuationRequest = setup.AITurnScheduler.buildDecisionRequest("hoodedWoman");
    assert(continuationRequest.context.continuation === "Follow the traveler until I understand what they want." &&
        setup.AIWorkingState.getContinuation("hoodedWoman") === "Follow the traveler until I understand what they want.",
        "stored continuation should return unchanged in later AI context without interpretation");
    State.variables.world = JSON.parse(JSON.stringify(setup.Game.getWorld()));
    assert(setup.Game.bootstrap().ok && setup.AIWorkingState.getContinuation("hoodedWoman") === "Follow the traveler until I understand what they want.",
        "continuation should survive a normal JSON save/load round trip");

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
        combinedIntent.narrativeResult.event.interactionId === combinedIntent.interactionId &&
        combinedIntent.narrativeResult.event.id < combinedIntent.actionResult.events[0].id,
        "attempt-phase narrative/speech should be recorded before the grounded formal-action event while both share one interaction ID");
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
        const actorId = payload.context.view.self.id;
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

    world = fresh();
    world.entities.hoodedWoman.locationId = "tavernEntrance";
    world.entities.hoodedWoman.sublocationId = "tavernEntranceFloor";
    world.entities.innkeeper.locationId = "tavernEntrance";
    world.entities.innkeeper.sublocationId = "tavernEntranceFloor";
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    world.ai.turnQueue = [];
    ok(setup.CharacterAPI.narrate("player", { text: "Both of you, pay attention." }), "queue two AI characters for provider-failure wave");
    const failureWaveActors = [];
    const failureWave = await setup.AITurnScheduler.processWave({ chat: async function (messages) {
        const actorId = JSON.parse(messages[1].content).context.view.self.id;
        failureWaveActors.push(actorId);
        if (failureWaveActors.length === 1) {
            return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
        }
        return { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "Model unavailable during wave." } };
    } });
    assert(!failureWave.ok && failureWave.processedCount === 1 && failureWaveActors.length === 2 &&
        failureWave.reactedCharacterIds.length === 1 &&
        world.entities[failureWaveActors[0]].mind.pendingObservations.length === 0 &&
        world.entities[failureWaveActors[1]].mind.pendingObservations.length === 1 &&
        setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === failureWaveActors[1]; }),
        "provider failure should stop the current world tick after preserving earlier committed AI reactions and the failed character's pending observations");
    world = setup.Game.getWorld();
    const failedActorId = failureWaveActors[1];
    ok(setup.CharacterAPI.narrate("player", { text: "This also happened while the model was unavailable.", target_id: failedActorId, noticeability: "hidden" }),
        "new observations should continue accumulating after a provider failure");
    assert(world.entities[failedActorId].mind.pendingObservations.length === 2,
        "the failed character should retain the old observation and accumulate later observations");
    let resumedFailedActorRequest = "";
    const resumedWave = await setup.AITurnScheduler.processWave({ chat: async function (messages) {
        const payload = JSON.parse(messages[1].content);
        if (payload.context.view.self.id === failedActorId) resumedFailedActorRequest = messages[1].content;
        return response({ action: null, publicNarrative: null, spokenText: null, memoryUpdates: emptyUpdates() });
    } });
    assert(resumedWave.ok && resumedFailedActorRequest.includes("Both of you, pay attention.") &&
        resumedFailedActorRequest.includes("This also happened while the model was unavailable."),
        "a later world tick should give the recovered model the accumulated pending observation batch");

    world = fresh();
    world.ai.turnQueue = [];
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.entities.innkeeper.mind.pendingObservations = [];
    const guardIds = [];
    for (let i = 0; i < 65; i++) {
        const id = `guardAI${i + 1}`;
        const inventoryId = `inventory_${id}`;
        const character = clone(world.entities.hoodedWoman);
        character.id = id;
        character.name = `Guard AI ${i + 1}`;
        character.inventoryId = inventoryId;
        character.mind = clone(world.entities.hoodedWoman.mind);
        character.mind.pendingObservations = [{
            id: world.nextObservationId++, kind: "event", actorId: "player", targetId: null,
            sourceControllerId: "human", text: "Emergency guard fixture.", data: { type: "narrative_input" }
        }];
        world.entities[id] = character;
        world.inventories[inventoryId] = { id: inventoryId, type: "inventory", ownerId: id, itemIds: [] };
        world.control.assignments[id] = "ai";
        world.ai.turnQueue.push({ characterId: id, reason: "guard_test" });
        guardIds.push(id);
    }
    const originalTakeQueuedTurn = setup.AIController.takeQueuedTurn;
    setup.AIController.takeQueuedTurn = async function (characterId) {
        const activeWorld = setup.Game.getWorld();
        activeWorld.entities[characterId].mind.pendingObservations = [];
        setup.AITurnQueue.remove(characterId);
        return { ok: true, actorId: characterId, actionResult: null, intentResult: { narrativeResult: null }, narrativeText: "" };
    };
    const guardedWave = await setup.AITurnScheduler.processWave({});
    setup.AIController.takeQueuedTurn = originalTakeQueuedTurn;
    assert(guardedWave.ok && guardedWave.truncated && guardedWave.processedCount === 64 &&
        guardedWave.remainingQueue.count === 1 && guardedWave.warning.includes("64") &&
        setup.Game.getWorld().entities[guardIds[64]].mind.pendingObservations.length === 1,
        "the emergency guard should stop after 64 AI decisions, preserve committed work, and leave remaining observations pending");

    const executionOrder = [];
    const executorSpec = function (name, delay) {
        return {
            actorId: name,
            purpose: "executor-order-test",
            messages: setup.AIProtocol.decisionMessages({
                schemaVersion: 1,
                view: { available_actions: {} },
                character: { aiDescription: name },
                mind: { knownFacts: [], beliefs: [], relationships: [], recentMemories: [], longTermMemories: [] },
                pendingObservations: []
            }),
            stage: "decision",
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
        "shared request executor should serialize game, sphere, repair, and ordinary scheduler requests");

    const parallelOrder = [];
    let parallelActive = 0;
    let parallelMaxActive = 0;
    function parallelSpec(name, delay) {
        return {
            actorId: name,
            purpose: "executor-parallel-timelapse-test",
            stage: "timelapse-plan",
            messages: [{ role: "user", content: name }],
            client: { enforceRequestTiming: false, chat: async function () {
                parallelActive++;
                parallelMaxActive = Math.max(parallelMaxActive, parallelActive);
                parallelOrder.push(`${name}:start`);
                await new Promise(function (resolve) { setTimeout(resolve, delay); });
                parallelOrder.push(`${name}:end`);
                parallelActive--;
                return response({ ok: true });
            } },
            run: async function (policyClient) {
                const transport = await policyClient.chat([{ role: "user", content: name }], { maxTokens: 10, reasoningEffort: "none" });
                return { ok: transport.ok, value: name, modelId: transport.modelId || null, usage: transport.usage || null, rawContent: transport.content || "" };
            }
        };
    }
    const parallelResults = await Promise.all([
        setup.AIRequestExecutor.executeCustomConcurrent(parallelSpec("parallel-a", 15)),
        setup.AIRequestExecutor.executeCustomConcurrent(parallelSpec("parallel-b", 15))
    ]);
    assert(parallelResults.every(function (result) { return result.ok; }) && parallelMaxActive === 2 &&
        parallelOrder[0].endsWith(":start") && parallelOrder[1].endsWith(":start"),
        `explicit concurrent executor path should overlap causally independent timelapse work: ${JSON.stringify(parallelOrder)}`);

    world = queueHooded();
    const oneStage = { chat: async function () { return response({ action: null, publicNarrative: "She nods.", spokenText: "Greetings.", continuation: "Learn why the traveller approached me.", memoryUpdates: {
        recentMemoriesToAdd: [{ summary: "The traveller greeted me.", importance: .5 }], beliefsToUpsert: [{ id: "belief_greeting", text: "The traveller is civil.", confidence: "medium" }], relationshipsToUpsert: [{ targetCharacterId: "player", summary: "A civil new acquaintance." }]
    } }, { total_tokens: 10 }); } };
    const oneResult = await setup.AIController.takeNextTurn(oneStage);
    assert(oneResult.ok && oneResult.stages === 1 && setup.AITurnQueue.peek() === null && world.entities.hoodedWoman.mind.recentMemories.some(function (m) { return m.summary.includes("greeted"); }) &&
        setup.AIWorkingState.getContinuation("hoodedWoman") === "Learn why the traveller approached me.",
        "one-stage turn should commit narrative/memory/continuation, consume observations, and remove queue head");

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
    const failedActionClient = { chat: async function () {
        stage++;
        world.entities.hoodedWoman.sublocationId = "commonRoomFloor";
        return response({
            action: { type: "move_within_location", destination_id: "commonRoomFloor" }, publicNarrative: "She starts to rise from the table.", spokenText: null, memoryUpdates: emptyUpdates()
        });
    } };
    const failedActionTurn = await setup.AIController.takeNextTurn(failedActionClient);
    assert(failedActionTurn.ok && failedActionTurn.actionResult.error.code === "ACTION_NO_LONGER_AVAILABLE" && failedActionTurn.narrativeSuppressed && failedActionTurn.memorySuppressed && stage === 1 &&
        setup.AITurnQueue.peek().characterId === "hoodedWoman",
        "an action that was available in the request but becomes stale before execution should become grounded failure feedback without committing success-dependent narrative or memory");

    world = queueHooded();
    const originalMoveWithinValidate = setup.Game.ActionRegistry.move_within_location.validate;
    setup.Game.ActionRegistry.move_within_location.validate = function () {
        return { ok: false, error: { code: "TEST_GROUNDED_FAILURE", message: "The attempted movement is blocked in-world." } };
    };
    const attemptedFailureTurn = await setup.AIController.takeNextTurn({ chat: async function () { return response({
        action: { type: "move_within_location", destination_id: "commonRoomFloor" },
        publicNarrative: "She starts to rise and tests her footing.",
        spokenText: "One moment.",
        continuation: "Get across the room despite the obstacle.",
        memoryUpdates: { recentMemoriesToAdd: [{ summary: "I successfully crossed the room.", importance: .5 }], beliefsToUpsert: [], relationshipsToUpsert: [] }
    }); } });
    setup.Game.ActionRegistry.move_within_location.validate = originalMoveWithinValidate;
    assert(attemptedFailureTurn.ok && attemptedFailureTurn.actionResult.error.code === "TEST_GROUNDED_FAILURE" &&
        attemptedFailureTurn.narrativeText.includes("tests her footing") && attemptedFailureTurn.intentResult.narrativeResult &&
        attemptedFailureTurn.memorySuppressed && !world.entities.hoodedWoman.mind.recentMemories.some(function (memory) { return memory.summary === "I successfully crossed the room."; }) &&
        setup.AIWorkingState.getContinuation("hoodedWoman") === "Get across the room despite the obstacle." &&
        world.entities.hoodedWoman.mind.pendingObservations.some(function (item) { return item.code === "TEST_GROUNDED_FAILURE"; }),
        "a valid in-world failed action should keep attempt-phase speech/narrative and continuation while suppressing success-dependent memory and preserving grounded failure feedback");

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
        liveNarrativeSnapshot.narrativeHistory[0].fragments.some(function (fragment) { return fragment.includes("The sphere permits the scheduled reaction."); }),
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
        messages: setup.AIProtocol.decisionMessages({
            schemaVersion: 1,
            view: { available_actions: {} },
            character: { aiDescription: "Timing test" },
            mind: { knownFacts: [], beliefs: [], relationships: [], recentMemories: [], longTermMemories: [] },
            pendingObservations: []
        }),
        stage: "decision",
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
