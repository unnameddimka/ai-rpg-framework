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
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }
function memory(id, summary, importance) {
    return { id: id, summary: summary || id, importance: importance === undefined ? 0.5 : importance, protected: false };
}
function fillRecent(character, count, prefix) {
    character.mind.recentMemories = [];
    for (let index = 1; index <= count; index++) {
        character.mind.recentMemories.push(memory(`${prefix}_${index}`, `${prefix} memory ${index}`, 0.5));
    }
}
function successfulClient(value, seenMessages) {
    return {
        enforceRequestTiming: false,
        chat: async function (messages) {
            if (seenMessages) seenMessages.push(clone(messages));
            return { ok: true, modelId: "test-character-model", content: JSON.stringify(value), usage: { prompt_tokens: 100, completion_tokens: 20 } };
        }
    };
}

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

async function main() {
    setup.AIRuntimeSettings.save("sk-or-v1-test-memory-consolidation-key-1234567890", false, storage, Date.now());
    setup.Game.resetWorld();
    let world = setup.Game.getWorld();

    const mara = world.entities.hoodedWoman;
    fillRecent(mara, 15, "mara_recent");
    mara.mind.longTermMemories = [{
        id: "mara_existing_ltm",
        summary: "Traveler is strange but important to me.",
        importance: 0.7,
        protected: true,
        customFrameworkMetadata: "preserve-me"
    }];
    world.nextMemoryId = 200;
    const priceBefore = clone(world.entities.captainPrice.mind);
    const continuationBefore = clone(world.ai.continuations);
    const eventsBefore = clone(world.events);
    const observationsBefore = clone(mara.mind.pendingObservations);
    const retainedBefore = clone(mara.mind.recentMemories.slice(-10));

    const plan = ok(setup.AIMemory.prepareConsolidation("hoodedWoman", 10), "prepare manual consolidation");
    assert(plan.summary.consolidatedRecentCount === 5 && plan.summary.retainedRecentCount === 10,
        "manual plan should consolidate only the prefix before the newest ten memories");
    assert(plan.context.memoriesToConsolidate.length === 5 && !Object.prototype.hasOwnProperty.call(plan.context, "recentMemories"),
        "model context should contain only selected consolidation memories, not a writable recent-memory partition");

    const seenMessages = [];
    const manualResult = await setup.MemoryConsolidator.compress("hoodedWoman", successfulClient({
        longTermMemoriesToUpsert: [{
            id: "mara_existing_ltm",
            summary: "Traveler is strange, disruptive, and important to my understanding of the world.",
            importance: 0.9
        }],
        longTermMemoriesToAdd: [{
            summary: "Several early encounters with Traveler formed one durable episode in my life.",
            importance: 0.8
        }]
    }, seenMessages));
    ok(manualResult, "manual consolidation should succeed");
    assert(manualResult.consolidation.committed === true && manualResult.consolidation.consolidatedRecentCount === 5,
        "manual result should expose a committed consolidation report");

    world = setup.Game.getWorld();
    assert(JSON.stringify(world.entities.hoodedWoman.mind.recentMemories) === JSON.stringify(retainedBefore),
        "the newest ten recent memories must remain exactly unchanged");
    assert(world.entities.hoodedWoman.mind.longTermMemories.length === 2,
        "manual consolidation should update one long-term memory and add one new long-term memory");
    const updatedExisting = world.entities.hoodedWoman.mind.longTermMemories.find(function (item) { return item.id === "mara_existing_ltm"; });
    assert(updatedExisting && updatedExisting.protected === true && updatedExisting.customFrameworkMetadata === "preserve-me" && updatedExisting.importance === 0.9,
        "upsert should preserve framework-owned long-term-memory metadata");
    const generated = world.entities.hoodedWoman.mind.longTermMemories.find(function (item) { return item.id !== "mara_existing_ltm"; });
    assert(generated && generated.id === "memory_ai_200" && generated.protected === false,
        "new long-term-memory IDs must be assigned by the framework");
    assert(JSON.stringify(world.entities.captainPrice.mind) === JSON.stringify(priceBefore),
        "manual Mara compression must not change Price's mind");
    assert(JSON.stringify(world.ai.continuations) === JSON.stringify(continuationBefore) && JSON.stringify(world.events) === JSON.stringify(eventsBefore) &&
        JSON.stringify(world.entities.hoodedWoman.mind.pendingObservations) === JSON.stringify(observationsBefore),
        "memory consolidation must not create turns, events, observations, or continuation changes");

    const payload = JSON.parse(seenMessages[0][1].content);
    assert(payload.stage === "memory-consolidation" && payload.context.memoriesToConsolidate.length === 5 &&
        payload.context.existingLongTermMemories.length === 1,
        "consolidation request should carry structured memory context and existing long-term memory");
    assert(seenMessages[0][0].content.includes("subjective perspective") && seenMessages[0][0].content.includes("may not delete"),
        "consolidation system prompt should preserve subjective memory and forbid deletion");

    const exchange = setup.AIRequestExecutor.getExchangeHistory().entries.slice(-1)[0];
    assert(exchange.request.purpose === "memory-consolidation" && exchange.request.stage === "memory-consolidation" &&
        exchange.result.consolidation && exchange.result.consolidation.committed === true,
        "exchange log should identify memory consolidation and record commit status");

    const serializedSave = JSON.stringify(world);
    State.variables.world = JSON.parse(serializedSave);
    assert(State.variables.world.entities.hoodedWoman.mind.longTermMemories.some(function (item) { return item.id === "memory_ai_200"; }) &&
        State.variables.world.entities.hoodedWoman.mind.recentMemories.length === 10,
        "consolidated long-term and retained recent memories should survive normal JSON save/restore");

    // Stale-result protection: a memory change while a request is in flight invalidates the old plan.
    world = setup.Game.getWorld();
    fillRecent(world.entities.nell, 12, "nell_stale");
    const stalePlan = ok(setup.AIMemory.prepareConsolidation("nell", 10), "prepare stale fixture");
    world.entities.nell.mind.recentMemories.push(memory("nell_newer", "A newer memory arrived while consolidation was in flight.", 0.8));
    const staleBeforeCommit = clone(world.entities.nell.mind);
    const staleCommit = setup.AIMemory.commitConsolidation("nell", stalePlan.sourceState, {
        longTermMemoriesToUpsert: [],
        longTermMemoriesToAdd: [{ summary: "Should never commit.", importance: 0.5 }]
    });
    assert(!staleCommit.ok && staleCommit.error.code === "MEMORY_CONSOLIDATION_STALE" &&
        JSON.stringify(setup.Game.getWorld().entities.nell.mind) === JSON.stringify(staleBeforeCommit),
        "stale consolidation results must fail without changing current memory");

    const invalidProtocol = setup.AIProtocol.validateMemoryConsolidation({
        longTermMemoriesToUpsert: [{ id: "missing_ltm", summary: "Invalid", importance: 0.5 }],
        longTermMemoriesToAdd: []
    }, ["real_ltm"]);
    assert(!invalidProtocol.ok, "protocol must reject upserts for IDs not supplied as existing long-term memories");

    // Auto OFF by default / explicit off: no compression even above threshold.
    setup.Game.resetWorld();
    world = setup.Game.getWorld();
    fillRecent(world.entities.nell, 30, "nell_auto_off");
    setup.AITurnScheduler.setAutoMemoryCompressionEnabled(false);
    let autoCalls = 0;
    const noAutoClient = {
        enforceRequestTiming: false,
        chat: async function () { autoCalls++; return { ok: false, error: { code: "SHOULD_NOT_CALL", message: "should not be called" } }; }
    };
    const offResult = await setup.AITurnScheduler.processWave(noAutoClient);
    ok(offResult, "world tick with automatic compression off should complete");
    assert(autoCalls === 0 && setup.Game.getWorld().entities.nell.mind.recentMemories.length === 30,
        "auto-compression OFF must leave oversized memory completely untouched");

    // Auto ON: consolidation occurs at the start of the next world tick even with no AI queue.
    setup.AITurnScheduler.setAutoMemoryCompressionEnabled(true);
    const autoSeen = [];
    const onResult = await setup.AITurnScheduler.processWave(successfulClient({
        longTermMemoriesToUpsert: [],
        longTermMemoriesToAdd: [{ summary: "Nell remembers a long stretch of tavern work as one durable period.", importance: 0.6 }]
    }, autoSeen));
    ok(onResult, "automatic memory maintenance should not require a queued AI reaction");
    assert(setup.Game.getWorld().entities.nell.mind.recentMemories.length === 10 &&
        onResult.memoryConsolidation.compressedCharacterIds.includes("nell"),
        "auto ON should consolidate a character at 30 recent memories before reactions");
    const autoPayload = JSON.parse(autoSeen[0][1].content);
    assert(autoPayload.context.memoriesToConsolidate.length === 20,
        "automatic consolidation must use the same retain-ten algorithm as manual consolidation");

    // Global automatic-processing pause also suspends automatic compression, even for explicit processWave/Pass-style processing.
    world = setup.Game.getWorld();
    fillRecent(world.entities.captainPrice, 30, "price_paused");
    setup.AITurnScheduler.setAutoProcessingPaused(true);
    let pausedCalls = 0;
    const pausedResult = await setup.AITurnScheduler.processWave({
        enforceRequestTiming: false,
        chat: async function () { pausedCalls++; return { ok: false, error: { code: "SHOULD_NOT_CALL", message: "should not be called" } }; }
    });
    ok(pausedResult, "explicit wave while automatic processing is paused should still complete");
    assert(pausedCalls === 0 && setup.Game.getWorld().entities.captainPrice.mind.recentMemories.length === 30,
        "global automatic-processing pause must suspend automatic memory compression");

    // Automatic consolidation failure is non-fatal to the world tick and leaves memory unchanged.
    setup.AITurnScheduler.setAutoProcessingPaused(false);
    const beforeFailedAuto = clone(setup.Game.getWorld().entities.captainPrice.mind);
    const failedAuto = await setup.AITurnScheduler.processWave({
        enforceRequestTiming: false,
        chat: async function () { return { ok: false, modelId: "test", error: { code: "SYNTHETIC_FAILURE", message: "synthetic consolidation failure" } }; }
    });
    ok(failedAuto, "automatic consolidation failure should not abort an otherwise empty world tick");
    assert(failedAuto.warning && failedAuto.warning.includes("synthetic consolidation failure") &&
        JSON.stringify(setup.Game.getWorld().entities.captainPrice.mind) === JSON.stringify(beforeFailedAuto),
        "failed automatic consolidation must report a warning and leave memory untouched");

    // Loading/restoring state does not itself run consolidation even if auto mode is enabled.
    const loadedSnapshot = JSON.stringify(setup.Game.getWorld());
    State.variables.world = JSON.parse(loadedSnapshot);
    ok(setup.Game.bootstrap(), "bootstrap after restored save should succeed without memory maintenance");
    assert(setup.Game.getWorld().entities.captainPrice.mind.recentMemories.length === 30,
        "save load/bootstrap must not trigger automatic compression; only a later world tick may do so");

    console.log("All character memory consolidation tests passed.");
}

main().catch(function (error) {
    console.error(error && error.stack || error);
    process.exit(1);
});
