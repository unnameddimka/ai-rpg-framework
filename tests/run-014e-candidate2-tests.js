"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");

function memoryStorage() {
    const values = new Map();
    return { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
}
const storage = memoryStorage();
global.window = { localStorage: storage };
global.localStorage = storage;
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root,file),"utf8"), { filename:file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

runtimeFiles.augment([
    "src/00-model-list.js", "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js", "src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js",
    "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js", "src/13-verbatim-memory.js", "src/14-event-perception.js",
    "src/17-runtime-diagnostics.js", "src/21-ai-settings.js", "src/21-ai-request-profiles.js", "src/23-world-environment.js", "src/23-timelapse-protocol.js","src/24-timelapse-core.js",
    "src/24-daytime-timelapse.js", "src/24-night-timelapse.js"
]).forEach(load);

(function () {
    const product = JSON.parse(fs.readFileSync(path.join(root, "data/product.json"), "utf8"));
    assert(/^(?:0\.1\.4e-candidate[2-9][0-9]*|0\.1\.4f-playtest\d+)$/.test(product.version), "candidate2-or-later product version must be authored");

    // Confirmed orphan locals are gone from their owning modules.
    const deadByFile = {
        "src/23-ai-protocol.js": ["validateIntimateUpdates", "updatesEmpty"],
        "src/25-turn-flow.js": ["eventTexts"],
        "src/24-timelapse-core.js": ["parseObject"],
        "src/10-weekly-rhythm.js": ["arrivalPlacement"],
        "src/24-memory-consolidator.js": ["memoryIds"],
        "src/30-game-ui.js": ["renderAbilitySection", "formatResult", "renderLegacyLatestTurn"]
    };
    Object.entries(deadByFile).forEach(function (entry) {
        const source = fs.readFileSync(path.join(root, entry[0]), "utf8");
        entry[1].forEach(function (name) {
            assert(!new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(source), `${entry[0]} must not retain orphan function ${name}`);
        });
    });
    const daytimeSource = fs.readFileSync(path.join(root, "src/24-daytime-timelapse.js"), "utf8");
    assert(daytimeSource.includes("function rewardTextForItems(items)") && !daytimeSource.includes("function rewardTextForItems(actorName, items)"), "reward formatter must not retain the unused actorName parameter");

    // GameInternals is an explicit internal/testing surface; stale additions fail this regression.
    const expectedInternals = [
        "CONTROLLER_IDS", "LEGACY_WORLD_VERSION", "SUPPORTED_MIGRATION_SCHEMA_VERSIONS", "WORLD_SCHEMA_VERSION",
        "applyItemConsume", "applyTravelerIdentity", "characterHasDiscoveredCharacter", "characterHasDiscoveredLocation", "characterRequiresDiscovery",
        "clone", "createInitialWorld", "currentAuthoringRevision", "enqueueAITurn", "enqueueObservation", "ensureWorld", "eventTouchesUndiscoveredCharacter",
        "eventTouchesUndiscoveredLocation", "fail", "getCharacter", "getCharacters", "getLocation", "getSublocation", "getWorldTransactionDebug",
        "grantCharacterDiscovery", "grantLocationDiscovery", "instantiateDeferredCharacter", "inventoryItems", "itemInstanceDisplayName", "locationExitEntries", "locationRequiresDiscovery",
        "normalizeCharacterDiscoveries", "normalizeCharacterDiscoveriesByCharacter", "normalizePlayerSetup", "ok", "positionText", "pushDebugLog",
        "repairAIQueue", "repairControlInvariant", "resetWorldTransactionDebug", "restoreWorldInPlace", "runAuthoredOutcomeTable", "snapshotWorld",
        "synchronizeDerivedItemPlacement", "transferItem", "transformItem", "validCustomTravelerAuthoring", "validateControlAssignments", "validateWorld"
    ].sort();
    assert(JSON.stringify(Object.keys(setup.GameInternals).sort()) === JSON.stringify(expectedInternals), `GameInternals surface drifted: ${JSON.stringify(Object.keys(setup.GameInternals).sort())}`);
    [
        "eligibleAuthoredOutcomeRecords", "authoredOutcomeTableCanAffect", "locationExitEntriesForActor", "eventLocationIds", "canAccessInventory",
        "actorDirectlyCarriesItem", "itemConsumePlan", "renderItemActionText", "observedMoveDestinationTargets", "hydrateAIQueueFromPendingObservations",
        "createInferenceSessionId", "buildProfile", "requiredDisclosureVersion", "disclosureSatisfied", "playerSetupComplete"
    ].forEach(function (key) { assert(!(key in setup.GameInternals), `stale internal export ${key} must stay removed`); });

    // ActionRegistry and AI metadata remain one-to-one and attached deterministically.
    const actionTypes = Object.keys(setup.Game.ActionRegistry);
    assert(actionTypes.length === 25, `expected 25 current formal action types, got ${actionTypes.length}`);
    actionTypes.forEach(function (type) {
        const definition = setup.Game.ActionRegistry[type];
        assert(typeof definition.aiDescription === "string" && definition.aiDescription.length > 0, `${type} must have attached AI description`);
        assert(Array.isArray(definition.aiPrerequisites), `${type} must have attached AI prerequisites`);
    });
    const actionCatalogSource = fs.readFileSync(path.join(root, "src/10-game-02-actions.js"), "utf8");
    assert(actionCatalogSource.includes("ActionRegistry/AI metadata mismatch") && actionCatalogSource.includes("attachActionAIMetadata();"), "registry/metadata drift must be guarded at runtime initialization");

    // Structured world-state authority is centralized without changing mapping semantics.
    const A = setup.WorldStateAuthority;
    assert(A && A.normalize("narrative_only") === "narrative_only" && A.normalize("bogus") === null, "authority normalizer must accept only canonical values");
    assert(A.forObservation({ kind:"action_result" }) === "grounded_result" && A.forObservation({ kind:"action_feedback" }) === "grounded_result", "formal feedback/results must remain grounded_result");
    assert(A.forObservation({ kind:"event", eventType:"narrative_input" }) === "narrative_only" && A.forObservation({ kind:"event", eventType:"character_moved" }) === "grounded_event", "event defaults must preserve narrative/formal authority split");
    assert(A.forObservation({ kind:"event", eventType:"narrative_input", worldStateAuthority:"grounded_result" }) === "grounded_result", "valid explicit authority must win over defaults");
    assert(A.forEvent({ type:"narrative_input" }) === "narrative_only" && A.forEvent({ type:"item_transferred" }) === "grounded_event", "event authority mapping must remain unchanged");
    assert(A.forTimelapse("timelapse_narrate", {}) === "narrative_only" && A.forTimelapse("timelapse_study", {}) === "grounded_result", "timelapse authority mapping must remain unchanged");
    const authorityWorld = { events:[{ id:77, type:"narrative_input" }] };
    assert(A.withRecordAuthority({ kind:"legacy", sourceEventId:77, text:"Observed." }, authorityWorld).worldStateAuthority === "narrative_only", "legacy record source-event authority must still derive structurally");

    // Fresh/deferred materialization uses one initializer while preserving branch policy.
    let world = setup.Game.createInitialWorld();
    function assertCommonRuntimeShape(character, label) {
        assert(character && character.type === "character", `${label} must materialize as a character`);
        assert(character.mind && character.mind.schemaVersion === setup.MindV3.CONFIG.SCHEMA_VERSION, `${label} must use Mind v3 runtime shape`);
        assert(Array.isArray(character.mind.verbatimObservations) && Array.isArray(character.mind.shortTermMemories) && Array.isArray(character.mind.pendingObservations) && character.mind.pendingObservations.length === 0, `${label} must normalize runtime mind arrays`);
        assert(!Object.prototype.hasOwnProperty.call(character.mind, "recentMemories"), `${label} must remove legacy recentMemories`);
        assert(Array.isArray(character.recentDialogue) && character.recentDialogue.length === 0 && Array.isArray(character.discoveredCharacterIds) && character.discoveredCharacterIds.length === 0, `${label} must initialize dialogue/discovery runtime arrays`);
        assert(character.playerControllable === (setup.GeneratedWorldData.characters[character.id].playerControllable !== false), `${label} must preserve playerControllable defaulting`);
        assert(character.mindRevision === 0 && JSON.stringify(character.mindDiagnostics) === JSON.stringify({beliefHistoryById:{}}), `${label} must initialize mind diagnostics`);
        assert(Array.isArray(character.mindMaintenanceSnapshots) && character.mindMaintenanceSnapshots.length === 0 && character.mindMaintenanceState && typeof character.mindMaintenanceState === "object", `${label} must initialize mind maintenance state`);
        assert(Array.isArray(character.equippedItems) && typeof character.sleeping === "boolean", `${label} must initialize equipment/sleeping runtime fields`);
    }
    assertCommonRuntimeShape(world.entities.player, "active Traveler");
    assertCommonRuntimeShape(world.entities.chugaister, "inactive deferred Chuhaister");
    assert(world.entities.chugaister.activationState === "inactive" && world.entities.chugaister.locationId === null && world.entities.chugaister.sublocationId === null && world.entities.chugaister.sleeping === false, "fresh deferred character must remain inactive and unplaced");

    const source = setup.GeneratedWorldData.characters.chugaister;
    delete world.entities.chugaister;
    delete world.inventories[source.inventoryId];
    delete world.control.assignments.chugaister;
    Object.entries(setup.GeneratedWorldData.items || {}).forEach(function (entry) {
        const item = entry[1];
        if (item.inventoryId === source.inventoryId || item.equippedByCharacterId === "chugaister") delete world.entities[entry[0]];
    });
    const activated = setup.GameInternals.instantiateDeferredCharacter("chugaister", world, { locationId:"trampledGlade", sublocationId:"trampledGladeCenter" });
    assertCommonRuntimeShape(activated, "deferred activation");
    assert(activated.activationState === "active" && activated.locationId === "trampledGlade" && activated.sublocationId === "trampledGladeCenter" && activated.sleeping === false, "deferred materialization must preserve activation placement policy");
    assert(world.control.assignments.chugaister === (source.initialControllerId || source.defaultControllerId || "ai"), "deferred materialization must preserve controller fallback order");
    assert(world.inventories[source.inventoryId] && world.inventories[source.inventoryId].ownerId === "chugaister", "deferred materialization must create the same character inventory");
    assert(activated.discoveredLocationIds.includes("trampledGlade"), "deferred placement into a discovery-gated location must grant self-discovery");

    const duplicateWorld = setup.Game.createInitialWorld();
    delete duplicateWorld.entities.chugaister;
    delete duplicateWorld.control.assignments.chugaister;
    let duplicateThrew = false;
    try { setup.GameInternals.instantiateDeferredCharacter("chugaister", duplicateWorld, { locationId:"trampledGlade", sublocationId:"trampledGladeCenter" }); }
    catch (error) { duplicateThrew = /Duplicate inventory ID/.test(String(error && error.message)); }
    assert(duplicateThrew, "shared character inventory helper must preserve duplicate-inventory failure behavior");

    // Day/night wrappers share phase transition and final diagnostics mechanics.
    const dayWrapperSource = fs.readFileSync(path.join(root, "src/24-daytime-timelapse.js"), "utf8");
    const nightWrapperSource = fs.readFileSync(path.join(root, "src/24-night-timelapse.js"), "utf8");
    assert(!dayWrapperSource.includes("function setTimePhase(") && !nightWrapperSource.includes("function setTimePhase("), "day/night wrappers must not retain duplicate phase helpers");
    assert(!dayWrapperSource.includes("function recordFinalTimelapseResult(") && !nightWrapperSource.includes("function recordFinalTimelapseResult("), "day/night wrappers must not retain duplicate final diagnostic helpers");
    assert(typeof setup.TimelapseCore.setTimePhase === "function" && typeof setup.TimelapseCore.recordFinalResult === "function", "TimelapseCore must own shared wrapper mechanics");

    world = setup.Game.createInitialWorld();
    State.variables.world = world;
    State.variables.time = "Evening";
    const originalEnvironment = setup.WorldEnvironment;
    setup.WorldEnvironment = null;
    let phase = setup.TimelapseCore.setTimePhase("daytime_timelapse");
    assert(phase.ok && setup.Game.getWorld().environment.timePhase === "daytime_timelapse" && State.variables.time === "Day", "fallback phase transition must preserve legacy label behavior");
    const originalValidateWorld = setup.Game.validateWorld;
    setup.Game.validateWorld = function () { return { ok:false, error:{ code:"FORCED_PHASE_FAILURE", message:"forced" } }; };
    phase = setup.TimelapseCore.setTimePhase("morning");
    assert(!phase.ok && setup.Game.getWorld().environment.timePhase === "daytime_timelapse" && State.variables.time === "Day", "failed fallback phase transition must roll world and legacy time back exactly");
    setup.Game.validateWorld = originalValidateWorld;
    setup.WorldEnvironment = originalEnvironment;

    let diagnostic = null;
    setup.EmergencyDiagnostics = { recordTimelapseResult: function (value) { diagnostic = clone(value); } };
    const finalResult = { ok:true, marker:"same-object" };
    const returned = setup.TimelapseCore.recordFinalResult(finalResult, "complete");
    assert(returned === finalResult && diagnostic && diagnostic.wrapperStage === "complete" && diagnostic.finalTimePhase === setup.Game.getWorld().environment.timePhase, "shared final-result diagnostics must preserve return identity and wrapper metadata");
    setup.EmergencyDiagnostics = { recordTimelapseResult: function () { throw new Error("diagnostic failure"); } };
    assert(setup.TimelapseCore.recordFinalResult(finalResult, "complete") === finalResult, "diagnostic failure must remain non-authoritative");

    console.log("All 0.1.4e-candidate2 refactor-pass1 tests passed.");
}());
