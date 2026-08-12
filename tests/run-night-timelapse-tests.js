"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");

function memoryStorage() {
    const values = new Map();
    return {
        getItem: function (key) { return values.has(key) ? values.get(key) : null; },
        setItem: function (key, value) { values.set(key, String(value)); },
        removeItem: function (key) { values.delete(key); }
    };
}

const storage = memoryStorage();
global.window = { localStorage: storage };
global.localStorage = storage;
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };

function load(file) {
    vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }
function known(character, factId) { return character.mind.knownFacts.some(function (fact) { return fact.id === factId; }); }
function emptyUpdates() { return { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] }; }

load("src/00-model-list.js");
load("src/generated/world-data.js");
load("src/10-game-api.js");
load("src/21-ai-settings.js");
load("src/22-openrouter-client.js");
load("src/23-ai-protocol.js");
load("src/24-ai-request-executor.js");
load("src/24-ai-turn-scheduler.js");
load("src/20-controllers.js");
load("src/24-memory-consolidator.js");
load("src/24-night-timelapse.js");
load("src/25-turn-flow.js");

function fresh() {
    setup.Game.resetWorld();
    setup.AITurnQueue.repair();
    setup.AIRequestExecutor.clearExchangeHistory();
    return setup.Game.getWorld();
}

function catalogFor(actorId) {
    const result = setup.TimelapseAPI.getReachableCatalog(actorId);
    assert(Array.isArray(result), `reachable catalog should be an array: ${JSON.stringify(result)}`);
    return result;
}

function room(catalog, locationId) {
    return catalog.find(function (candidate) { return candidate.id === locationId; });
}

function place(characterId, locationId, sublocationId) {
    const world = setup.Game.getWorld();
    world.entities[characterId].locationId = locationId;
    world.entities[characterId].sublocationId = sublocationId;
}

function plannerPayload(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].role !== "user") continue;
        try {
            const parsed = JSON.parse(messages[index].content);
            if (parsed && parsed.stage) return parsed;
        } catch (error) {}
    }
    return null;
}

function response(value) {
    return {
        ok: true,
        modelId: "test-night-model",
        content: JSON.stringify(value),
        usage: { prompt_tokens: 100, completion_tokens: 20 }
    };
}

function sleepingPlanFor(actorId) {
    if (actorId === "innkeeper") {
        return [{ locationId: "innkeeperRoom", action: { type: "sleep", bedId: "innkeeperRoomBed" } }];
    }
    if (actorId === "captainPrice") {
        return [{ locationId: "guestRoom1", action: { type: "sleep", bedId: "guestRoom1Bed" } }];
    }
    if (actorId === "nell") {
        return [{ locationId: "commonRoom", action: { type: "sleep", bedId: "underStairsBed" } }];
    }
    if (actorId === "hoodedWoman") {
        return [{ locationId: "secludedCottage", action: { type: "sleep", bedId: "maraCottageBed" } }];
    }
    throw new Error(`No sleeping plan fixture for ${actorId}`);
}

async function main() {
    setup.AIRuntimeSettings.save("sk-or-v1-test-night-timelapse-key-1234567890", false, storage, Date.now());

    // Authored content and generic route projection.
    let world = fresh();
    assert(world.entities.underStairsBed && world.entities.underStairsBed.locationId === "commonRoom" &&
        world.entities.underStairsBed.capabilities.includes("sleep"),
        "Nell should have a concrete canonical cot bed target beneath the stairs");
    assert(known(world.entities.captainPrice, "price_lodging") && known(world.entities.innkeeper, "price_lodging") &&
        known(world.entities.nell, "price_lodging") && known(world.entities.player, "price_lodging") &&
        !known(world.entities.hoodedWoman, "price_lodging"),
        "Price lodging should be known to Price, Garrick, Nell, and Traveler but not Mara");
    assert(known(world.entities.hoodedWoman, "mara_sleeping_place") && known(world.entities.innkeeper, "garrick_sleeping_place") &&
        known(world.entities.nell, "nell_sleeping_place") && known(world.entities.hoodedWoman, "garrick_home") &&
        known(world.entities.hoodedWoman, "nell_home") && known(world.entities.innkeeper, "mara_home") && known(world.entities.nell, "mara_home"),
        "agreed sleeping-place and cross-residence authored facts should exist");

    const priceCatalog = catalogFor("captainPrice");
    const garrickCatalog = catalogFor("innkeeper");
    const playerCatalog = catalogFor("player");
    assert(room(priceCatalog, "guestRoom1") && room(priceCatalog, "guestRoom1").beds.some(function (bed) { return bed.id === "guestRoom1Bed"; }),
        "Price should be able to route through his locked Guest Room 1 door because he owns its key");
    assert(!room(garrickCatalog, "guestRoom1") && room(garrickCatalog, "guestRoom2"),
        "Garrick should no longer route through locked Guest Room 1 but should route through rooms whose keys he still owns");
    assert(!room(playerCatalog, "guestRoom1"),
        "a character without the Guest Room 1 key should have that locked branch cut from the timelapse route catalog");
    const commonRoomCatalog = room(garrickCatalog, "commonRoom");
    assert(commonRoomCatalog && commonRoomCatalog.timelapseActions.some(function (action) { return action.id === "clean_common_room"; }),
        "common room should expose clean_common_room through the timelapse catalog");

    assert(world.entities.player.aiDescription.includes("Do not assume a particular current location or activity") &&
        !world.entities.player.aiDescription.includes("newly arrived") &&
        world.entities.captainPrice.aiDescription.includes("Do not assume that you are currently drinking") &&
        !world.entities.captainPrice.playerDescription.includes("holds a mug") &&
        world.entities.innkeeper.aiDescription.includes("When working the tavern you usually tend the bar") &&
        !world.entities.innkeeper.playerDescription.includes("stands behind the bar") &&
        !world.entities.nell.playerDescription.includes("stands ready to work"),
        "AI-facing and static character descriptions should be scene-agnostic while preserving character identity");

    // Exact planner protocol: the three action variants are a union with canonical camelCase fields.
    const validEarlySleep = setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "guestRoom1", action: { type: "sleep", bedId: "guestRoom1Bed" } }
    ] }, priceCatalog, 5);
    assert(validEarlySleep.ok, "sleep may terminate a remaining timelapse plan early when it is the final step");
    assert(!setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "guestRoom1", action: { type: "sleep", bed_id: "guestRoom1Bed" } }
    ] }, priceCatalog, 5).ok, "sleep must use the exact bedId field rather than bed_id");
    assert(setup.NightTimelapse.validatePlan({ steps: Array.from({ length: 5 }, function () {
        return { locationId: "commonRoom", action: { type: "narrate", text: "Wait quietly." } };
    }) }, priceCatalog, 5).ok, "a plan without sleep should provide exactly every remaining round");
    assert(!setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "commonRoom", action: { type: "narrate", text: "Wait quietly." } }
    ] }, priceCatalog, 5).ok, "a non-sleeping short plan should be rejected");
    assert(setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "commonRoom", action: { type: "timelapse_action", actionId: "clean_common_room" } },
        { locationId: "guestRoom1", action: { type: "sleep", bedId: "guestRoom1Bed" } }
    ] }, priceCatalog, 5).ok, "authored macros should use the exact timelapse_action/actionId branch");
    assert(!setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "commonRoom", action: { type: "clean_common_room" } },
        { locationId: "guestRoom1", action: { type: "sleep", bedId: "guestRoom1Bed" } }
    ] }, priceCatalog, 5).ok, "authored action IDs must not be used as action types");
    assert(!setup.NightTimelapse.validatePlan({ steps: [
        { locationId: "guestRoom1", action: { type: "sleep", bedId: "guestRoom1Bed" } },
        { locationId: "commonRoom", action: { type: "narrate", text: "This must not follow sleep." } }
    ] }, priceCatalog, 5).ok, "no plan step may follow sleep");

    // The reusable core must not own overnight-only HumanController postconditions.
    world = fresh();
    ["innkeeper", "captainPrice", "nell", "hoodedWoman"].forEach(function (id) {
        ok(setup.Game.assignNonHumanController(id, "dummy"), `generic core fixture disables ${id} AI`);
    });
    world.entities.player.sleeping = true;
    const coreOnly = await setup.TimelapseCore.run({ enforceRequestTiming: false }, { mode: "test-core", roundCount: 1 });
    ok(coreOnly, "generic timelapse core should execute independently of the overnight wrapper");
    assert(coreOnly.mode === "test-core" && coreOnly.rounds === 1 && setup.Game.getWorld().entities.player.sleeping === true,
        "generic timelapse core should not wake the HumanController; morning wake belongs to NightTimelapse wrapper");

    // Realtime sleep and wake semantics.
    world = fresh();
    place("hoodedWoman", "secludedCottage", "maraCottageBed");
    place("player", "secludedCottage", "maraCottageFloor");
    world.entities.hoodedWoman.mind.pendingObservations = [];
    assert(setup.CharacterAPI.getView("hoodedWoman").available_actions.sleep,
        "a character lying on a bed should receive the normal shared sleep action");
    const sleepResult = ok(setup.CharacterAPI.perform("hoodedWoman", { type: "sleep" }), "AI realtime sleep should succeed");
    assert(world.entities.hoodedWoman.sleeping === true && sleepResult.events.some(function (event) { return event.type === "character_slept"; }) &&
        !world.entities.hoodedWoman.mind.pendingObservations.some(function (item) { return item.kind === "action_result" && item.actionType === "sleep"; }),
        "AI realtime sleep should set sleeping without adding a self action-result continuation");
    ok(setup.CharacterAPI.narrate("player", { text: "The floorboards creak nearby." }), "nearby observation fixture");
    assert(world.entities.hoodedWoman.sleeping === true && world.entities.hoodedWoman.mind.pendingObservations.length > 0,
        "receiving an observation alone must not wake a sleeping character");
    ok(setup.CharacterAPI.perform("hoodedWoman", { type: "move_within_location", destination_id: "maraCottageFloor" }),
        "a sleeping character can choose a formal action");
    assert(world.entities.hoodedWoman.sleeping === false, "any chosen formal action should wake the actor before it executes");
    place("hoodedWoman", "secludedCottage", "maraCottageBed");
    ok(setup.CharacterAPI.perform("hoodedWoman", { type: "sleep" }), "AI sleeps again for narrative wake fixture");
    ok(setup.CharacterAPI.narrate("hoodedWoman", { text: "I'm awake." }), "sleeping AI speaks");
    assert(world.entities.hoodedWoman.sleeping === false, "any non-empty speech/narrative should wake the actor");
    place("hoodedWoman", "secludedCottage", "maraCottageBed");
    ok(setup.CharacterAPI.perform("hoodedWoman", { type: "sleep" }), "AI sleeps again for grounded-failure wake fixture");
    setup.CharacterAPI.recordGroundedActionFailure("hoodedWoman", { type: "move", destination_id: "street" },
        { code: "ACTION_NO_LONGER_AVAILABLE", message: "The planned action is no longer available." });
    assert(world.entities.hoodedWoman.sleeping === false, "a grounded formal-action attempt should also wake a sleeping actor");

    // Timelapse-only common-room cleanup macro.
    world = fresh();
    place("innkeeper", "commonRoom", "commonRoomFloor");
    const normalActions = setup.CharacterAPI.getView("innkeeper").available_actions;
    assert(!normalActions.clean_common_room && !normalActions.timelapse_action,
        "clean_common_room must never appear as a normal world-tick action");
    const cleanup = ok(setup.TimelapseAPI.executeAction("innkeeper", "commonRoom", {
        type: "timelapse_action", actionId: "clean_common_room"
    }), "timelapse cleanup should execute deterministically");
    assert(cleanup.affectedItemIds.length === 3 && ["priceAle_2", "priceAle_3", "priceAle_4"].every(function (id) {
        return world.entities[id].definitionId === "emptyMug" && world.entities[id].containerId === "inventory_barMugCabinet" &&
            world.inventories.inventory_barMugCabinet.itemIds.includes(id);
    }), "cleanup should empty and move all three unattended table mugs into Garrick's cabinet");
    assert(world.entities.priceAle_1.definitionId === "mugOfAle" && world.entities.priceAle_1.containerId === "inventory_captainPrice",
        "cleanup must not touch a mug held in a character inventory");
    const cleanupAgain = ok(setup.TimelapseAPI.executeAction("innkeeper", "commonRoom", {
        type: "timelapse_action", actionId: "clean_common_room"
    }), "cleanup should remain a valid no-op when no unattended mugs remain");
    assert(cleanupAgain.affectedItemIds.length === 0, "second cleanup should find no eligible mugs rather than fail");

    // A current-round execution failure spends that round and replans only future rounds.
    world = fresh();
    ["innkeeper", "captainPrice", "nell"].forEach(function (id) {
        ok(setup.Game.assignNonHumanController(id, "dummy"), `failure fixture disables ${id} AI`);
    });
    place("player", "guestRoom2", "guestRoom2Bed");
    world.entities.player.sleeping = true;
    place("hoodedWoman", "commonRoom", "commonRoomFloor");
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.ai.turnQueue = [];
    const originalTimelapseMove = setup.TimelapseAPI.moveToLocation;
    let injectedMoveFailure = true;
    setup.TimelapseAPI.moveToLocation = function (actorId, locationId) {
        if (actorId === "hoodedWoman" && injectedMoveFailure) {
            injectedMoveFailure = false;
            return { ok: false, error: { code: "TIMELAPSE_ROUTE_BLOCKED", message: "The planned route became blocked." } };
        }
        return originalTimelapseMove(actorId, locationId);
    };
    const failureCalls = [];
    const failureClient = {
        enforceRequestTiming: false,
        chat: async function (messages) {
            const payload = plannerPayload(messages);
            failureCalls.push(clone(payload));
            if (payload.stage === "timelapse-plan") {
                return response({ steps: [
                    { locationId: "secludedCottage", action: { type: "narrate", text: "I return home." } },
                    { locationId: "secludedCottage", action: { type: "narrate", text: "I sort herbs." } },
                    { locationId: "secludedCottage", action: { type: "narrate", text: "I work quietly." } },
                    { locationId: "secludedCottage", action: { type: "narrate", text: "I prepare for bed." } },
                    { locationId: "secludedCottage", action: { type: "sleep", bedId: "maraCottageBed" } }
                ] });
            }
            if (payload.stage === "timelapse-replan") {
                assert(payload.context.timelapse.startRound === 2 && payload.context.timelapse.remainingRounds === 4 &&
                    payload.context.timelapse.latestFailure && payload.context.timelapse.latestFailure.code === "TIMELAPSE_ROUTE_BLOCKED",
                    "failed round should be spent and replanning should begin at the next round with grounded failure context");
                return response({ steps: sleepingPlanFor("hoodedWoman") });
            }
            if (payload.stage === "timelapse-reflection") return response({ memoryUpdates: emptyUpdates() });
            throw new Error(`Unexpected failure-fixture stage ${payload.stage}`);
        }
    };
    const failedRoundNight = await setup.NightTimelapse.run(failureClient);
    setup.TimelapseAPI.moveToLocation = originalTimelapseMove;
    ok(failedRoundNight, "night should continue after a grounded current-round route failure");
    world = setup.Game.getWorld();
    assert(failedRoundNight.rounds === 5 && world.entities.hoodedWoman.sleeping === true &&
        world.entities.hoodedWoman.sublocationId === "maraCottageBed" &&
        failedRoundNight.committedFacts.some(function (text) { return text.includes("planned route became blocked"); }),
        "route failure should consume round one, be committed as a fact, and allow sleep from the replanned round two onward");
    assert(failureCalls.filter(function (call) { return call.stage === "timelapse-replan"; }).length === 1,
        "one grounded failure should cause exactly one remaining-plan request");

    // Pure co-location with every participant declining interaction should skip resolver and preserve original plans.
    world = fresh();
    place("player", "guestRoom2", "guestRoom2Bed");
    world.entities.player.sleeping = true;
    place("innkeeper", "commonRoom", "commonRoomFloor");
    place("captainPrice", "commonRoom", "commonRoomTableTwo");
    place("nell", "commonRoom", "underStairsNook");
    place("hoodedWoman", "secludedCottage", "maraCottageBed");
    world.entities.hoodedWoman.sleeping = true;
    ["innkeeper", "captainPrice", "nell", "hoodedWoman"].forEach(function (id) { world.entities[id].mind.pendingObservations = []; });
    world.ai.turnQueue = [];
    const noOpStages = [];
    const noOpClient = {
        enforceRequestTiming: false,
        chat: async function (messages) {
            const payload = plannerPayload(messages);
            noOpStages.push(payload.stage);
            if (payload.stage === "timelapse-plan") {
                const actorId = payload.context.view.self.id;
                return response({ steps: [
                    { locationId: "commonRoom", action: { type: "narrate", text: `${actorId} keeps to their own quiet activity.` } },
                    sleepingPlanFor(actorId)[0]
                ] });
            }
            if (payload.stage === "timelapse-interaction-intent") {
                return response({ engage: false, intent: "Keep to myself and continue my own activity." });
            }
            if (payload.stage === "timelapse-reflection") return response({ memoryUpdates: emptyUpdates() });
            throw new Error(`No-op encounter should not request ${payload.stage}`);
        }
    };
    const noOpNight = await setup.NightTimelapse.run(noOpClient);
    ok(noOpNight, "all-ignore co-location should finish without resolver or replan work");
    assert(!noOpStages.includes("timelapse-interaction-resolver") && !noOpStages.includes("timelapse-replan"),
        `all-engage=false should skip both resolver and replanning: ${JSON.stringify(noOpStages)}`);

    // A true completion-limit truncation is retried once with the structural low-reasoning policy and remains distinguishable.
    world = fresh();
    ["innkeeper", "captainPrice", "nell"].forEach(function (id) {
        ok(setup.Game.assignNonHumanController(id, "dummy"), `truncation fixture disables ${id} AI`);
    });
    place("player", "guestRoom2", "guestRoom2Bed");
    world.entities.player.sleeping = true;
    place("hoodedWoman", "secludedCottage", "maraCottageFloor");
    world.entities.hoodedWoman.mind.pendingObservations = [];
    world.ai.turnQueue = [];
    let truncationPlanCalls = 0;
    const truncationOptions = [];
    const truncationClient = {
        enforceRequestTiming: false,
        chat: async function (messages, requestOptions) {
            const payload = plannerPayload(messages);
            if (payload.stage === "timelapse-plan") {
                truncationPlanCalls++;
                truncationOptions.push(clone(requestOptions || {}));
                if (truncationPlanCalls === 1) {
                    return { ok: false, modelId: "test-night-model", content: "{", error: { code: "MODEL_OUTPUT_TRUNCATED", message: "completion limit" } };
                }
                return response({ steps: [{ locationId: "secludedCottage", action: { type: "sleep", bedId: "maraCottageBed" } }] });
            }
            if (payload.stage === "timelapse-reflection") return response({ memoryUpdates: emptyUpdates() });
            throw new Error(`Unexpected truncation-retry stage ${payload.stage}`);
        }
    };
    const retriedNight = await setup.NightTimelapse.run(truncationClient);
    ok(retriedNight, "one truncated structural response should be retried and recover cleanly");
    assert(truncationPlanCalls === 2 && truncationOptions.every(function (options) { return options.reasoningEffort === "none" && options.maxTokens === 1200; }),
        "truncation retry should retain the bounded structural budget with reasoning disabled");

    world = fresh();
    ["innkeeper", "captainPrice", "nell"].forEach(function (id) {
        ok(setup.Game.assignNonHumanController(id, "dummy"), `double-truncation fixture disables ${id} AI`);
    });
    place("player", "guestRoom2", "guestRoom2Bed");
    world.entities.player.sleeping = true;
    place("hoodedWoman", "secludedCottage", "maraCottageFloor");
    world.entities.hoodedWoman.mind.pendingObservations = [];
    const alwaysTruncatedClient = {
        enforceRequestTiming: false,
        chat: async function () {
            return { ok: false, modelId: "test-night-model", content: "{", error: { code: "MODEL_OUTPUT_TRUNCATED", message: "completion limit" } };
        }
    };
    const stillTruncated = await setup.NightTimelapse.run(alwaysTruncatedClient);
    assert(!stillTruncated.ok && stillTruncated.error.code === "MODEL_OUTPUT_TRUNCATED" && stillTruncated.committedRounds === 0 &&
        setup.Game.getWorld().entities.player.sleeping === false,
        `a second truncation should surface its specific error rather than generic invalid protocol: ${JSON.stringify(stillTruncated)}`);

    // Full five-round Human sleep timelapse with a three-character group encounter and one already-sleeping AI.
    world = fresh();
    place("player", "guestRoom2", "guestRoom2Bed");
    place("innkeeper", "commonRoom", "commonRoomFloor");
    place("captainPrice", "commonRoom", "commonRoomTableTwo");
    place("nell", "commonRoom", "underStairsNook");
    place("hoodedWoman", "secludedCottage", "maraCottageBed");
    world.entities.hoodedWoman.sleeping = true;
    ["innkeeper", "captainPrice", "nell", "hoodedWoman"].forEach(function (id) {
        world.entities[id].mind.pendingObservations = [];
    });
    world.ai.turnQueue = [];

    const calls = [];
    const activeByStage = {};
    const maxActiveByStage = {};
    const fakeClient = {
        enforceRequestTiming: false,
        chat: async function (messages, requestOptions) {
            const payload = plannerPayload(messages);
            assert(payload && payload.stage, `night model call should contain a stage payload: ${JSON.stringify(messages)}`);
            calls.push({ stage: payload.stage, payload: clone(payload), requestOptions: clone(requestOptions || {}) });
            activeByStage[payload.stage] = (activeByStage[payload.stage] || 0) + 1;
            maxActiveByStage[payload.stage] = Math.max(maxActiveByStage[payload.stage] || 0, activeByStage[payload.stage]);
            await new Promise(function (resolve) { setTimeout(resolve, 5); });
            activeByStage[payload.stage]--;
            if (payload.stage === "timelapse-plan") {
                const actorId = payload.context.view.self.id;
                assert(actorId !== "hoodedWoman", "already sleeping AI should skip initial activity planning");
                assert(!Object.prototype.hasOwnProperty.call(payload.context.view, "available_actions"),
                    "timelapse planning should omit the ordinary view.available_actions contract");
                return response({
                    steps: [
                        { locationId: "commonRoom", action: { type: "narrate", text: `${actorId} spends the first part of the night in the common room.` } },
                        sleepingPlanFor(actorId)[0]
                    ]
                });
            }
            if (payload.stage === "timelapse-interaction-intent") {
                const actorId = payload.context.view.self.id;
                return response({ engage: true, intent: `${actorId} exchanges a brief greeting and then intends to retire for the night.` });
            }
            if (payload.stage === "timelapse-interaction-resolver") {
                assert(payload.context.participants.length === 3,
                    "one three-character room collision should be resolved as one group encounter");
                assert(payload.context.location && payload.context.location.id === "commonRoom" && Array.isArray(payload.context.location.sublocations),
                    "group resolver should receive the canonical public room projection, not participant private context");
                const serialized = JSON.stringify(payload.context);
                assert(!serialized.includes("recentMemories") && !serialized.includes("longTermMemories") &&
                    !serialized.includes("beliefs") && !serialized.includes("relationships") && !serialized.includes("continuation"),
                    "shared encounter resolver must not receive participant private mind context");
                return response({ interactionOccurred: true, interactionResume: "Garrick, Price, and Nell exchanged a brief greeting in the common room and verbally ended the conversation." });
            }
            if (payload.stage === "timelapse-replan") {
                const actorId = payload.context.view.self.id;
                assert(payload.context.timelapse.startRound === 2 && payload.context.timelapse.remainingRounds === 4 &&
                    payload.context.timelapse.latestEncounterResume,
                    "encounter participants should replan beginning with the following round using the shared resume");
                return response({ steps: sleepingPlanFor(actorId) });
            }
            if (payload.stage === "timelapse-reflection") {
                return response({ memoryUpdates: emptyUpdates() });
            }
            throw new Error(`Unexpected night stage ${payload.stage}`);
        }
    };

    let fullNightResolved = false;
    const progressiveCommits = [];
    const fullNightPromise = setup.TurnFlow.submitHumanIntent({ action: { type: "sleep" } }, fakeClient, {
        onCommittedPresentation: function (batch) {
            assert(fullNightResolved === false, "progressive committed output must be published before the full timelapse promise resolves");
            progressiveCommits.push(clone(batch));
        }
    });
    const result = await fullNightPromise;
    fullNightResolved = true;
    ok(result, "Human bed sleep should execute the complete overnight timelapse");
    assert(result.turnConsumed === true && result.timelapseResult && result.timelapseResult.rounds === 5,
        "Human sleep should consume the turn and process exactly five coarse timelapse rounds");
    world = setup.Game.getWorld();
    assert(world.entities.player.sleeping === false, "HumanController should wake after the complete overnight transaction");
    assert(world.entities.innkeeper.sleeping === true && world.entities.innkeeper.sublocationId === "innkeeperRoomBed" &&
        world.entities.captainPrice.sleeping === true && world.entities.captainPrice.sublocationId === "guestRoom1Bed" &&
        world.entities.nell.sleeping === true && world.entities.nell.sublocationId === "underStairsBed" &&
        world.entities.hoodedWoman.sleeping === true && world.entities.hoodedWoman.sublocationId === "maraCottageBed",
        "AI final canonical sleeping places should reflect executed/replanned night steps without auto-waking at morning");

    const stageCounts = calls.reduce(function (map, call) {
        map[call.stage] = (map[call.stage] || 0) + 1;
        return map;
    }, {});
    assert(stageCounts["timelapse-plan"] === 3 && stageCounts["timelapse-interaction-intent"] === 3 &&
        stageCounts["timelapse-interaction-resolver"] === 1 && stageCounts["timelapse-replan"] === 3 &&
        stageCounts["timelapse-reflection"] === 4,
        `night call shape should be 3 plans + 3 intents + 1 group resolver + 3 replans + 4 reflections: ${JSON.stringify(stageCounts)}`);
    assert(maxActiveByStage["timelapse-plan"] >= 2 && maxActiveByStage["timelapse-interaction-intent"] >= 2 &&
        maxActiveByStage["timelapse-replan"] >= 2 && maxActiveByStage["timelapse-reflection"] >= 2,
        `causally independent timelapse waves should overlap model calls: ${JSON.stringify(maxActiveByStage)}`);
    calls.filter(function (call) { return ["timelapse-plan", "timelapse-replan", "timelapse-interaction-intent", "timelapse-interaction-resolver", "timelapse-reflection"].includes(call.stage); })
        .forEach(function (call) {
            assert(call.requestOptions.reasoningEffort === "none" && call.requestOptions.maxTokens <= 1800,
                `timelapse structural/reflection requests should use a bounded low-reasoning request policy: ${JSON.stringify(call)}`);
        });
    assert(calls.some(function (call) {
        return call.stage === "timelapse-reflection" && call.payload.context.view.self.id === "hoodedWoman";
    }), "an AI that slept through the whole night should still receive end-of-day reflection");

    const hidden = result.timelapseResult.hiddenNarrativeEntries || [];
    const hiddenText = hidden.map(function (entry) { return entry.text; }).join("\n");
    assert(hidden.length > 0 && hiddenText.includes("exchanged a brief greeting") &&
        !hiddenText.includes("interactionIntent") && !hiddenText.includes("timelapse-plan") && !hiddenText.includes("replan"),
        "invisible overnight narrative should contain only committed facts/resumes, never planning scaffolding");
    assert(result.hiddenNarrativeEntries && result.hiddenNarrativeEntries.some(function (entry) {
        return entry.text.includes("exchanged a brief greeting");
    }), "committed night facts should remain available through the existing invisible presentation channel after completion");
    const roundCommits = progressiveCommits.filter(function (batch) { return batch.meta && batch.meta.phase === "timelapse-round"; });
    assert(progressiveCommits[0] && progressiveCommits[0].meta.phase === "human" && roundCommits.length === 5 &&
        roundCommits.map(function (batch) { return batch.meta.round; }).join(",") === "1,2,3,4,5",
        "Human sleep should publish its committed action immediately and then publish each fully resolved timelapse round in order");
    assert(roundCommits.some(function (batch) { return batch.hidden.some(function (entry) { return entry.text.includes("exchanged a brief greeting"); }); }),
        "resolved encounter output should be emitted with the round that committed it");

    const history = setup.AIRequestExecutor.getExchangeHistory();
    assert(history.maxEntries === 100 && setup.AIRequestExecutor.MAX_EXCHANGE_HISTORY === 100,
        "AI interaction diagnostics should retain up to 100 entries");
    assert(history.entries.some(function (entry) { return entry.request.purpose === "timelapse-plan"; }) &&
        history.entries.some(function (entry) { return entry.request.purpose === "timelapse-interaction-resolver"; }) &&
        history.entries.some(function (entry) { return entry.request.purpose === "timelapse-reflection"; }),
        "timelapse internal model work should remain visible in AI interaction diagnostics");

    console.log("All night timelapse tests passed.");
}

main().catch(function (error) {
    console.error(error && error.stack || error);
    process.exit(1);
});
