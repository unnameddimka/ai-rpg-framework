"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
const saveHandlers = [];
global.Save = { onSave: { add: function (handler) { saveHandlers.push(handler); } } };

function load(relativePath) {
    const absolutePath = path.join(root, relativePath);
    vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function saveObjectFromVariables(variables) {
    return {
        state: {
            index: 1,
            history: [
                { title: "older", variables: clone(variables) },
                { title: "active", variables: clone(variables) }
            ]
        }
    };
}

load("src/generated/world-data.js");
load("src/07-mind-v3.js"); load("src/08-mind-validators.js");
load("src/09-passage-rules.js"); load("src/09-world-derived-state.js"); load("src/10-game-api.js");
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js"); load("src/13-verbatim-memory.js");
load("src/14-event-perception.js");
load("src/09-persistence.js");


function fakeStorageEngine(entries) {
    const map = new Map(Object.entries(entries || {}));
    return {
        get length() { return map.size; },
        key: function (index) { return Array.from(map.keys())[index] || null; },
        getItem: function (key) { return map.has(key) ? map.get(key) : null; },
        setItem: function (key, value) { map.set(key, value); },
        snapshot: function () { return Object.fromEntries(map.entries()); }
    };
}

const legacyBrowserStore = fakeStorageEngine({
    "ai-rpg-framework-poc.save.slot.info:0": "legacy-info-0",
    "ai-rpg-framework-poc.save.slot.data:0": "legacy-data-0",
    "ai-rpg-framework-poc.save.auto.info:1": "legacy-auto-info-1",
    "ai-rpg-framework-poc.save.auto.data:1": "legacy-auto-data-1",
    "ai-rpg-framework-poc.settings": "legacy-settings",
    "ai-rpg-framework-mvp.save.slot.info:0": "mvp-info-0"
});
const legacyMigration = setup.Persistence.migrateLegacyBrowserSaveNamespace(legacyBrowserStore, "ai-rpg-framework-mvp");
const migratedSnapshot = legacyBrowserStore.snapshot();
assert(legacyMigration.copied === 3 && legacyMigration.skipped === 1,
    "MVP startup migration should copy missing legacy POC browser-save payloads without overwriting existing MVP save entries");
assert(migratedSnapshot["ai-rpg-framework-mvp.save.slot.info:0"] === "mvp-info-0" &&
    migratedSnapshot["ai-rpg-framework-mvp.save.slot.data:0"] === "legacy-data-0" &&
    migratedSnapshot["ai-rpg-framework-mvp.save.auto.info:1"] === "legacy-auto-info-1" &&
    migratedSnapshot["ai-rpg-framework-mvp.save.auto.data:1"] === "legacy-auto-data-1",
    "legacy POC browser-save data should become visible in the MVP namespace while MVP entries win collisions");
assert(!Object.prototype.hasOwnProperty.call(migratedSnapshot, "ai-rpg-framework-mvp.settings"),
    "POC-to-MVP namespace migration must copy save payloads only, not unrelated settings or runtime storage");
assert(migratedSnapshot["ai-rpg-framework-poc.save.slot.data:0"] === "legacy-data-0",
    "legacy POC browser saves must remain intact after compatibility copying");

assert(saveHandlers.length === 1, "persistence layer should register exactly one SugarCube onSave synchronization hook");
const synchronize = saveHandlers[0];

State.variables = {
    health: 10,
    time: "Evening",
    frameworkUI: { turnBusy: false, history: [] },
    world: setup.Game.createInitialWorld()
};

// Reproduce the real stale-history failure: the marshalled active save moment is
// captured before an in-place canonical mutation, then onSave runs afterward.
const staleTickSave = saveObjectFromVariables(State.variables);
const originalOlderTickLocation = staleTickSave.state.history[0].variables.world.entities.player.locationId;
const moveResult = setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" });
assert(moveResult.ok && State.variables.world.entities.player.locationId === "commonRoom",
    "fixture should mutate the live canonical world without requiring SugarCube passage navigation");
State.variables.world.ai.continuations.hoodedWoman = "Current live continuation after the in-place tick.";
synchronize(staleTickSave);
assert(staleTickSave.state.history[1].variables.world.entities.player.locationId === "commonRoom" &&
    staleTickSave.state.history[1].variables.world.ai.continuations.hoodedWoman === "Current live continuation after the in-place tick.",
    "onSave synchronization should replace stale active-moment world state with current live canonical state");
assert(staleTickSave.state.history[0].variables.world.entities.player.locationId === originalOlderTickLocation,
    "save synchronization must not rewrite older SugarCube history moments");

// Simulate reloading the just-created save.
State.variables = clone(staleTickSave.state.history[1].variables);
assert(State.variables.world.entities.player.locationId === "commonRoom" &&
    State.variables.world.ai.continuations.hoodedWoman === "Current live continuation after the in-place tick.",
    "a save created immediately after an in-place tick should restore the actual live state");

// Character mind import is also an in-place canonical mutation and must be captured immediately by onSave.
State.variables.world = setup.Game.createInitialWorld();
State.variables.world.entities.hoodedWoman.mind.beliefs = [{ id: "portable_test", text: "A portable belief before export.", confidence: 0.85, activation: 0.6 }];
State.variables.world.entities.hoodedWoman.mind.shortTermMemories = [{ id: "memory_ai_77", topic: "Portable memory", summary: "A portable memory before export.", importance: 0.8, protected: false }];
const exportedMind = setup.CharacterMindTransfer.exportMind("hoodedWoman");
assert(exportedMind.ok, "portable mind fixture should export");
State.variables.world = setup.Game.createInitialWorld();
const staleMindSave = saveObjectFromVariables(State.variables);
const importedMind = setup.CharacterMindTransfer.importMind("hoodedWoman", exportedMind.document);
assert(importedMind.ok && State.variables.world.entities.hoodedWoman.mind.beliefs[0].id === "portable_test",
    "portable mind fixture should mutate the live world in place without passage navigation");
synchronize(staleMindSave);
State.variables = clone(staleMindSave.state.history[1].variables);
assert(State.variables.world.entities.hoodedWoman.mind.beliefs[0].id === "portable_test" &&
    State.variables.world.entities.hoodedWoman.mind.shortTermMemories[0].id === "memory_ai_77",
    "a save made immediately after mind import should restore the imported portable mind");

// Reproduce the overnight symptom with deterministic timelapse APIs: the stale
// active moment is captured before Price moves/sleeps, then the live world changes.
State.variables.world = setup.Game.createInitialWorld();
const staleTimelapseSave = saveObjectFromVariables(State.variables);
const priceMove = setup.TimelapseAPI.moveToLocation("captainPrice", "guestRoom1");
assert(priceMove.ok, "Price should reach Guest Room 1 through his keyed timelapse route");
const priceSleep = setup.TimelapseAPI.executeAction("captainPrice", "guestRoom1", { type: "sleep", bedId: "guestRoom1Bed" });
assert(priceSleep.ok && State.variables.world.entities.captainPrice.locationId === "guestRoom1" &&
    State.variables.world.entities.captainPrice.sleeping === true,
    "fixture should place Price asleep in Guest Room 1 in live canonical state");
synchronize(staleTimelapseSave);
State.variables = clone(staleTimelapseSave.state.history[1].variables);
assert(State.variables.world.entities.captainPrice.locationId === "guestRoom1" &&
    State.variables.world.entities.captainPrice.sublocationId === "guestRoom1Bed" &&
    State.variables.world.entities.captainPrice.sleeping === true,
    "a save made immediately after timelapse mutations should restore final canonical location and sleeping state");

// Fail closed rather than silently producing a stale save if synchronization has
// no active save moment to update.
let threw = false;
try {
    synchronize({ state: { index: 0, history: [] } });
} catch (error) {
    threw = /Save synchronization failed/.test(error.message);
}
assert(threw, "persistence synchronization should fail explicitly instead of silently writing a known-stale save");

console.log("All persistence synchronization tests passed.");
