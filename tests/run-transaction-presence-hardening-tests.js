"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { augment } = require("./runtime-files.js");
const root = path.resolve(__dirname, "..");

function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(value, message) { assert(value && value.ok, `${message}: ${JSON.stringify(value)}`); return value; }

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };

augment([
    "src/generated/world-data.js",
    "src/07-mind-v3.js",
    "src/08-mind-validators.js",
    "src/10-game-api.js",
    "src/11-save-migration.js",
    "src/12-character-context.js",
    "src/13-character-memory.js",
    "src/13-verbatim-memory.js",
    "src/14-event-perception.js",
    "src/20-controllers.js",
    "src/23-world-environment.js",
    "src/25-turn-flow.js"
]).forEach(load);

setup.AITurnScheduler = {
    processAfterSubmit: async function () { return { ok: true, processedCount: 0, reactedCharacterIds: [], results: [], remainingQueue: [] }; },
    processWave: async function () { return { ok: true, processedCount: 0, reactedCharacterIds: [], results: [], remainingQueue: [] }; },
    getQueueView: function () { return []; }
};

function fresh() {
    ok(setup.Game.resetWorld(), "reset world");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "acknowledge AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}

function installGuaranteedProbe(world, id, effect) {
    world.triggeredEvents[id] = {
        id: id,
        trigger: { type: "ordinary_tick" },
        prerequisites: [],
        effects: [effect || { type: "deactivate_character", characterId: "innkeeper" }],
        narrationPolicy: "none"
    };
}

async function assertNoTick(input, expectedCode, label) {
    const world = fresh();
    installGuaranteedProbe(world, `probe_${label.replace(/[^a-z0-9]/gi, "_")}`);
    const before = JSON.stringify(world);
    const tickBefore = world.ordinaryTickId;
    let presentationCalls = 0;
    const result = await setup.TurnFlow.submitHumanIntent(input, null, {
        onCommittedPresentation: function () { presentationCalls += 1; }
    });
    assert(!result.ok && result.error && result.error.code === expectedCode && result.turnConsumed === false,
        `${label} must fail in pure preflight without consuming a turn: ${JSON.stringify(result)}`);
    assert(setup.Game.getWorld().ordinaryTickId === tickBefore, `${label} must not increment ordinaryTickId`);
    assert(presentationCalls === 0, `${label} must not publish committed presentation`);
    assert(JSON.stringify(setup.Game.getWorld()) === before, `${label} must leave canonical world byte-for-byte unchanged`);
}

async function main() {
    await assertNoTick({}, "EMPTY_INTENT", "empty intent");
    await assertNoTick({ action: "move" }, "ACTION_CONTRACT_REJECTED", "malformed action structure");
    await assertNoTick({ action: { type: "move", destination_id: "villageTemple" } }, "ACTION_CONTRACT_REJECTED", "unavailable formal action");
    await assertNoTick({ text: "Hey!", spokenText: "Hey!", target_id: "innkeeper", noticeability: "shout" }, "SHOUT_TARGET_FORBIDDEN", "shout with addressee");
    await assertNoTick({ text: "Hey!", spokenText: "Hey!", noticeability: "shout", action: { type: "move", destination_id: "commonRoom" } }, "SHOUT_MOVE_FORBIDDEN", "shout with movement");
    await assertNoTick({ text: "*waves*", spokenText: "", noticeability: "shout" }, "SHOUT_SPEECH_REQUIRED", "shout without speech");
    await assertNoTick({ text: "Hello.", spokenText: "Hello.", target_id: "innkeeper" }, "TARGET_NOT_NEARBY", "already-ungrounded direct target");
    await assertNoTick({ text: "Coming with me?", spokenText: "Coming with me?", target_id: "blacksmith", action: { type: "move", destination_id: "commonRoom" } }, "SPEECH_TARGET_NOT_GROUNDED", "ungrounded move speech target");

    // A speech target can be valid at preflight and become invalid only after the committed tick-start trigger.
    let world = fresh();
    world.entities.player.locationId = "bar";
    world.entities.player.sublocationId = "barPublicSide";
    world.entities.innkeeper.locationId = "bar";
    world.entities.innkeeper.sublocationId = "barBehindCounter";
    if (!world.entities.player.discoveredCharacterIds.includes("innkeeper")) world.entities.player.discoveredCharacterIds.push("innkeeper");
    ok(setup.CharacterAPI.preflightIntent("player", { text: "Garrick?", spokenText: "Garrick?", target_id: "innkeeper" }), "speech is grounded before tick");
    const speechTickBefore = world.ordinaryTickId;
    const originalOrdinaryTickProcessor = setup.TriggeredEvents.processOrdinaryTick;
    setup.TriggeredEvents.processOrdinaryTick = function (options) {
        const result = originalOrdinaryTickProcessor(options);
        if (result.ok) {
            const current = setup.Game.getWorld();
            current.entities.innkeeper.locationId = "commonRoom";
            current.entities.innkeeper.sublocationId = "commonRoomFloor";
        }
        return result;
    };
    let speechResult;
    try {
        speechResult = await setup.TurnFlow.submitHumanIntent({ text: "Garrick?", spokenText: "Garrick?", target_id: "innkeeper" });
    } finally {
        setup.TriggeredEvents.processOrdinaryTick = originalOrdinaryTickProcessor;
    }
    assert(!speechResult.ok && speechResult.turnConsumed === true && speechResult.error.code === "TARGET_NOT_NEARBY",
        `post-start speech invalidation must be a grounded consumed-turn failure: ${JSON.stringify(speechResult)}`);
    world = setup.Game.getWorld();
    assert(world.ordinaryTickId === speechTickBefore + 1 && world.entities.innkeeper.locationId === "commonRoom",
        "TOCTOU speech failure must preserve the committed tick-start world change");

    // Structural invalidity is categorically different: the same trigger must not even get a chance to run.
    world = fresh();
    world.entities.player.locationId = "bar";
    world.entities.player.sublocationId = "barPublicSide";
    world.entities.innkeeper.locationId = "bar";
    world.entities.innkeeper.sublocationId = "barBehindCounter";
    if (!world.entities.player.discoveredCharacterIds.includes("innkeeper")) world.entities.player.discoveredCharacterIds.push("innkeeper");
    installGuaranteedProbe(world, "invalidShoutMustNotTick", { type: "deactivate_character", characterId: "innkeeper" });
    const structuralBefore = JSON.stringify(world);
    const structuralResult = await setup.TurnFlow.submitHumanIntent({ text: "HEY!", spokenText: "HEY!", target_id: "innkeeper", noticeability: "shout" });
    assert(!structuralResult.ok && structuralResult.error.code === "SHOUT_TARGET_FORBIDDEN" && structuralResult.turnConsumed === false,
        "structurally invalid shout must be rejected pre-tick");
    assert(JSON.stringify(setup.Game.getWorld()) === structuralBefore && setup.Game.getWorld().entities.innkeeper.activationState === "active",
        "structural shout failure must not proc the waiting trigger");

    // getWorld is a getter, not a repair surface.
    world = fresh();
    delete world.ai;
    const malformedGetterBefore = JSON.stringify(world);
    assert(setup.Game.getWorld() === world && setup.Game.getWorld() === world, "getWorld should return the canonical object directly");
    assert(JSON.stringify(world) === malformedGetterBefore && !Object.prototype.hasOwnProperty.call(world, "ai"),
        "repeated getWorld calls must not repair or otherwise mutate canonical state");

    // validateWorld is pure: reject malformed state without normalizing it.
    const malformedCandidate = clone(fresh());
    delete malformedCandidate.ai;
    const malformedValidationBefore = JSON.stringify(malformedCandidate);
    const malformedValidation = setup.Game.validateWorld(malformedCandidate);
    assert(!malformedValidation.ok && malformedValidation.error.code === "AI_STATE_INVALID",
        `missing AI state must fail validation instead of being recreated: ${JSON.stringify(malformedValidation)}`);
    assert(JSON.stringify(malformedCandidate) === malformedValidationBefore,
        "validateWorld must leave a rejected candidate byte-for-byte unchanged");

    const malformedContinuationCandidate = clone(fresh());
    malformedContinuationCandidate.ai.continuations.player = { nonsense: true };
    const malformedContinuationBefore = JSON.stringify(malformedContinuationCandidate);
    const malformedContinuationValidation = setup.Game.validateWorld(malformedContinuationCandidate);
    assert(!malformedContinuationValidation.ok, "malformed continuation must fail validation");
    assert(JSON.stringify(malformedContinuationCandidate) === malformedContinuationBefore,
        "continuation validation must not delete or normalize malformed data");

    // Presence must remain usable with the scheduling namespace completely unavailable.
    world = fresh();
    const savedWeeklyRhythm = setup.WeeklyRhythm;
    setup.WeeklyRhythm = undefined;
    try {
        assert(setup.Presence.isLocallyPresent("player", world), "neutral Presence read must not require WeeklyRhythm");
        assert(setup.Presence.isLocationAvailable("tavernEntrance", world), "topology availability must not require WeeklyRhythm");
        ok(setup.Presence.setLocalPresence("player", false, world), "neutral presence mutation without WeeklyRhythm");
        assert(!setup.Presence.isLocallyPresent("player", world), "neutral presence mutation should take effect without WeeklyRhythm");
        ok(setup.Presence.setLocalPresence("player", true, world), "restore neutral presence without WeeklyRhythm");
    } finally {
        setup.WeeklyRhythm = savedWeeklyRhythm;
    }

    // One logical combined Human intent owns one full-world transaction snapshot.
    world = fresh();
    setup.GameInternals.resetWorldTransactionDebug();
    const combinedInput = { text: "I head inside.", action: { type: "move", destination_id: "commonRoom" } };
    const combinedPreflight = ok(setup.CharacterAPI.preflightIntent("player", combinedInput), "combined action preflight");
    const combinedResult = setup.CharacterAPI.submitIntent("player", combinedInput, { actionWasPrevalidated: true, preflightPlan: combinedPreflight.plan });
    ok(combinedResult, "combined Human intent");
    assert(setup.GameInternals.getWorldTransactionDebug().snapshots === 1,
        `combined submitIntent+action must take one full-world transaction snapshot, got ${JSON.stringify(setup.GameInternals.getWorldTransactionDebug())}`);

    world = fresh();
    setup.GameInternals.resetWorldTransactionDebug();
    ok(setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" }), "standalone perform remains safe");
    assert(setup.GameInternals.getWorldTransactionDebug().snapshots === 1,
        "standalone CharacterAPI.perform must still own exactly one safety snapshot");

    // Rollback paths restore exactly the state they received, even when unrelated state is already invalid.
    world = fresh();
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    const rollbackBefore = JSON.stringify(world);
    const profileFailure = setup.Game.updateCharacterProfile("player", { name: "Changed Name", playerDescription: "Should roll back." });
    assert(!profileFailure.ok && JSON.stringify(setup.Game.getWorld()) === rollbackBefore,
        `profile mutation must roll back on final validation failure: ${JSON.stringify(profileFailure)}`);

    // Representative timelapse mutation families roll back exactly on post-mutation validation failure.
    world = fresh();
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    let mutationBefore = JSON.stringify(world);
    const moveFailure = setup.TimelapseAPI.moveToLocation("player", "commonRoom");
    assert(!moveFailure.ok && JSON.stringify(setup.Game.getWorld()) === mutationBefore,
        `timelapse movement must roll back on validation failure: ${JSON.stringify(moveFailure)}`);

    world = fresh();
    ok(setup.TimelapseAPI.moveToLocation("player", "commonRoom"), "sleep rollback fixture reaches common room");
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    mutationBefore = JSON.stringify(world);
    const sleepFailure = setup.TimelapseAPI.executeAction("player", "commonRoom", { type: "sleep", bedId: "underStairsBed" });
    assert(!sleepFailure.ok && JSON.stringify(setup.Game.getWorld()) === mutationBefore,
        `timelapse sleep must roll back on validation failure: ${JSON.stringify(sleepFailure)}`);

    world = fresh();
    ok(setup.TimelapseAPI.moveToLocation("player", "commonRoom"), "effect rollback fixture reaches common room");
    const looseMug = world.entities.emptyMug_1;
    Object.values(world.inventories).forEach(function (inventory) {
        if (inventory && Array.isArray(inventory.itemIds)) inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== looseMug.id; });
    });
    world.inventories.inventory_commonRoom.itemIds.push(looseMug.id);
    looseMug.inventoryId = "inventory_commonRoom";
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    mutationBefore = JSON.stringify(world);
    const effectFailure = setup.TimelapseAPI.executeAction("player", "commonRoom", { type: "timelapse_action", actionId: "clean_common_room" });
    assert(!effectFailure.ok && JSON.stringify(setup.Game.getWorld()) === mutationBefore,
        `authored timelapse effect must roll back item transformations/transfers on validation failure: ${JSON.stringify(effectFailure)}`);

    // Coarse boundary is one candidate/rollback unit, including lifecycle transitions and reconciliation.
    world = fresh();
    const coarseBefore = JSON.stringify(world);
    const coarseValidate = setup.GameInternals.validateWorld;
    setup.GameInternals.validateWorld = function () { return { ok: false, error: { code: "FORCED_BOUNDARY_VALIDATION", message: "forced" } }; };
    try {
        const coarseFailure = setup.WeeklyRhythm.advanceDayBoundary(world);
        assert(!coarseFailure.ok && JSON.stringify(world) === coarseBefore,
            `failed coarse boundary must restore calendar/lifecycle/topology state together: ${JSON.stringify(coarseFailure)}`);
    } finally {
        setup.GameInternals.validateWorld = coarseValidate;
    }

    // Combined ordinary intent owns rollback for its nested action mutation.
    world = fresh();
    const rollbackInput = { text: "Inside.", action: { type: "move", destination_id: "commonRoom" } };
    const rollbackPreflight = ok(setup.CharacterAPI.preflightIntent("player", rollbackInput), "rollback combined preflight");
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    const ordinaryBefore = JSON.stringify(world);
    const ordinaryFailure = setup.CharacterAPI.submitIntent("player", rollbackInput, { actionWasPrevalidated: true, preflightPlan: rollbackPreflight.plan });
    assert(!ordinaryFailure.ok && JSON.stringify(setup.Game.getWorld()) === ordinaryBefore,
        `combined intent must roll back its full mutation unit on final validation failure: ${JSON.stringify(ordinaryFailure)}`);

    // Environment status is read-only and phase writes are transactional.
    world = fresh();
    delete world.environment.weatherNarrative;
    const environmentReadBefore = JSON.stringify(world);
    const environmentStatus = setup.WorldEnvironment.getStatus();
    assert(environmentStatus.weatherNarrative && JSON.stringify(world) === environmentReadBefore,
        "WorldEnvironment.getStatus must normalize its returned projection without repairing canonical state");
    world.ai.turnQueue.push({ characterId: "missing-character", reason: "forced validator failure" });
    const phaseBefore = JSON.stringify(world);
    const legacyTimeBefore = State.variables.time;
    const phaseFailure = setup.WorldEnvironment.setTimePhase("morning");
    assert(!phaseFailure.ok && JSON.stringify(setup.Game.getWorld()) === phaseBefore && State.variables.time === legacyTimeBefore,
        "time-phase mutation and legacy time mirror must roll back together on validation failure");

    // Presence reconciliation itself is transactional.
    world = fresh();
    world.entities.player.locationId = "marketSquare";
    world.entities.player.sublocationId = "merchantSaleChest";
    const owner = world.entities.roadMerchant;
    const displaced = setup.Presence.collectOwnedTopologyOccupants(owner.id, world);
    assert(displaced.includes("player"), "presence rollback fixture must have a foreign occupant in owned topology");
    const originalValidateWorld = setup.GameInternals.validateWorld;
    const presenceBefore = JSON.stringify(world);
    setup.GameInternals.validateWorld = function () { return { ok: false, error: { code: "FORCED_VALIDATION_FAILURE", message: "forced" } }; };
    try {
        const reconciliation = setup.Presence.reconcileOwnedTopologyOccupants(owner.id, displaced, world);
        assert(!reconciliation.ok && JSON.stringify(world) === presenceBefore,
            "Presence reconciliation must roll back all relocations when final validation fails");
    } finally {
        setup.GameInternals.validateWorld = originalValidateWorld;
    }

    console.log("All candidate3 transaction, Presence, and validation hardening tests passed.");
}

main().catch(function (error) {
    console.error(error && error.stack || error);
    process.exit(1);
});
