"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { augment } = require("./runtime-files.js");
const root = path.resolve(__dirname, "..");

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };

function load(relativePath) {
    vm.runInThisContext(fs.readFileSync(path.join(root, relativePath), "utf8"), { filename: relativePath });
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }

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
    "src/24-timelapse-core.js"
]).forEach(load);

function setupFreshWorld() {
    State.variables = {};
    ok(setup.Game.bootstrap(), "bootstrap");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "acknowledge AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}

function installGenericAwayable(world, options) {
    options = options || {};
    const character = world.entities.blacksmith;
    character.awayable = {
        arrivalSchedule: options.arrivalSchedule || [{ weekday: "Flamesday", phase: "Evening" }],
        defaultDeparture: { relativeToArrival: "next_morning" },
        travelPeriods: options.travelPeriods === undefined ? 1 : options.travelPeriods,
        arrivalLocationId: "villageSmithy",
        arrivalSublocationId: "smithyForgeArea",
        onArrival: options.onArrival || []
    };
    delete character.weeklyPresence;
    character.awayState = {
        present: true,
        plannedDeparture: options.plannedDeparture || { dayNumber: 1, phase: "Morning" },
        travelPeriodsRemaining: 0,
        lifecycleRevision: setup.WeeklyRhythm.AWAY_STATE_REVISION
    };
    return character;
}

function actionTypes(characterId) {
    const view = setup.CharacterAPI.getView(characterId);
    assert(view && view.available_actions, `view/action catalog missing for ${characterId}`);
    return Object.keys(view.available_actions);
}

// Generic fixture: ordinary action availability is controller-agnostic and only imminent.
let world = setupFreshWorld();
let generic = installGenericAwayable(world, {});
assert(setup.WeeklyRhythm.isCharacterPresent(generic, world), "generic awayable should begin present");
assert(generic.awayState.plannedDeparture.dayNumber === 1 && generic.awayState.plannedDeparture.phase === "Morning", "generic fixture should own a canonical planned departure");
assert(actionTypes(generic.id).includes("defer_departure"), "AI-controlled awayable should receive defer_departure through ordinary available_actions");

ok(setup.Game.takeHumanControl(generic.id), "move HumanController to generic awayable");
assert(actionTypes(generic.id).includes("defer_departure"), "HumanController should receive the same generic defer_departure action");
const deferred = ok(setup.CharacterAPI.perform(generic.id, { type: "defer_departure" }), "human generic awayable defers departure");
assert(generic.awayState.plannedDeparture.dayNumber === 1 && generic.awayState.plannedDeparture.phase === "Evening", "one defer must move departure by exactly one coarse boundary");
assert(!actionTypes(generic.id).includes("defer_departure"), "defer_departure must disappear when a second immediate use would not affect the next timelapse boundary");
assert(Array.isArray(deferred.events) && deferred.events.length === 0, "defer_departure must not create a public event or announcement");
ok(setup.Game.takeHumanControl("player"), "restore HumanController to Traveler");

// Repeated ordinary-period defers can extend the same visit repeatedly.
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance to Flamesday Morning after first defer");
world.environment.timePhase = "morning";
assert(setup.WeeklyRhythm.isCharacterPresent(generic, world), "first defer should keep generic awayable present at Flamesday Morning");
assert(actionTypes(generic.id).includes("defer_departure"), "defer should become relevant again at the next ordinary period when departure is imminent");
ok(setup.CharacterAPI.perform(generic.id, { type: "defer_departure" }), "generic awayable defers a second time");
assert(generic.awayState.plannedDeparture.dayNumber === 2 && generic.awayState.plannedDeparture.phase === "Morning", "second defer should move Flamesday Evening departure to Flowday Morning");

// Without defer, departure is deterministic, away characters leave ordinary local scheduling, and new departure gets no retroactive travel credit.
world = setupFreshWorld();
generic = installGenericAwayable(world, { travelPeriods: 1 });
const departure = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "generic planned departure at Flamesday Morning");
assert(departure.transitions.some(function (entry) { return entry.type === "departure" && entry.characterId === generic.id; }), "planned boundary should deterministically depart generic awayable");
assert(!setup.WeeklyRhythm.isCharacterPresent(generic, world), "generic awayable should be away after departure");
assert(generic.awayState.travelPeriodsRemaining === 1, "newly departing character must not receive credit for the period that ended at departure");
assert(!setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === generic.id; }), "away generic character must not remain ordinary AI-scheduler eligible");

// Generic deterministic arrival hook: true away->present transition only, with injectable RNG.
generic.awayable.onArrival = [{
    action: "restock",
    targetInventoryId: "inventory_blacksmith",
    entries: [{ definitionId: "saltPouch", min: 1, max: 1, chance: 1 }]
}];
const oldSaltSaleIds = world.inventories.inventory_blacksmith.itemIds.filter(function (itemId) {
    const item = world.entities[itemId];
    return item && item.tradeProvenance && item.tradeProvenance.ownerCharacterId === generic.id && item.tradeProvenance.role === "sale_stock";
});
const arrival = ok(setup.WeeklyRhythm.advanceEveningBoundary(world, { random: function () { return 0; } }), "complete one road period and reach generic arrival opportunity");
assert(arrival.transitions.some(function (entry) { return entry.type === "arrival" && entry.characterId === generic.id; }), "travel-complete authored opportunity should perform true generic arrival");
assert(setup.WeeklyRhythm.isCharacterPresent(generic, world), "generic character should be present after arrival");
assert(generic.locationId === "villageSmithy" && generic.sublocationId === "smithyForgeArea", "generic true arrival should restore authored local placement");
assert(generic.awayState.plannedDeparture.dayNumber === 2 && generic.awayState.plannedDeparture.phase === "Morning", "true arrival should initialize a fresh following-Morning departure");
const genericSaleItems = world.inventories.inventory_blacksmith.itemIds.map(function (itemId) { return world.entities[itemId]; }).filter(function (item) {
    return item && item.tradeProvenance && item.tradeProvenance.ownerCharacterId === generic.id && item.tradeProvenance.role === "sale_stock";
});
assert(genericSaleItems.length === 1 && genericSaleItems[0].definitionId === "saltPouch", "generic restock hook should create only authored sale stock");
assert(oldSaltSaleIds.every(function (id) { return !world.entities[id]; }), "generic restock should replace prior owned sale-stock provenance rather than duplicate it");

// Already-present schedule opportunities are not fake arrivals and never run arrival hooks.
const keptStockId = genericSaleItems[0].id;
generic.awayState.plannedDeparture = { dayNumber: 3, phase: "Evening" };
// Move calendar to a synthetic opportunity while present; hook would replace keptStockId if incorrectly fired.
generic.awayable.arrivalSchedule = [{ weekday: "Flowday", phase: "Evening" }];
const presentOpportunity = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance present generic fixture to Flowday Morning");
world.environment.timePhase = "morning";
const presentOpportunityEvening = ok(setup.WeeklyRhythm.advanceEveningBoundary(world, { random: function () { return 0; } }), "cross an authored arrival opportunity while already present");
assert(!presentOpportunity.transitions.concat(presentOpportunityEvening.transitions).some(function (entry) { return entry.type === "arrival" && entry.characterId === generic.id; }), "already-present character must not receive a fake arrival transition");
assert(world.entities[keptStockId], "already-present arrival opportunity must not restock/replace canonical stock");

// Missed opportunities are lost; completing road later does not catch up between authored windows.
world = setupFreshWorld();
generic = installGenericAwayable(world, {
    travelPeriods: 2,
    plannedDeparture: { dayNumber: 1, phase: "Morning" },
    arrivalSchedule: [{ weekday: "Flamesday", phase: "Evening" }, { weekday: "Flowday", phase: "Evening" }]
});
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "depart before too-early Flamesday Evening opportunity");
assert(generic.awayState.travelPeriodsRemaining === 2, "two road periods should begin after actual departure");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "first travel period reaches too-early opportunity");
assert(!generic.awayState.present && generic.awayState.travelPeriodsRemaining === 1, "arrival opportunity with incomplete road must be missed");
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "road finishes after missed opportunity");
assert(!generic.awayState.present && generic.awayState.travelPeriodsRemaining === 0, "finishing road between opportunities must not create catch-up arrival");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "reach later authored opportunity");
assert(generic.awayState.present, "later authored opportunity should permit arrival after road is complete");

// Timelapse planner union rejects ordinary defer_departure outright.
const planCatalog = [{ id: "villageSmithy", beds: [], timelapseActions: [], studyItems: [] }];
const invalidDayPlan = setup.TimelapseCore.validatePlan({ steps: [{ locationId: "villageSmithy", action: { type: "defer_departure" } }] }, planCatalog, 1, "daytime");
const invalidNightPlan = setup.TimelapseCore.validatePlan({ steps: [{ locationId: "villageSmithy", action: { type: "defer_departure" } }] }, planCatalog, 1, "overnight");
assert(!invalidDayPlan.ok && !invalidNightPlan.ok, "timelapse planner contracts must never accept defer_departure");

// Generic migration helper works for a future awayable fixture without any character-id branch.
world = setupFreshWorld();
generic = installGenericAwayable(world, {});
const legacySaved = JSON.parse(JSON.stringify(generic));
delete legacySaved.awayable;
delete legacySaved.awayState;
legacySaved.weeklyPresence = { presentWeekdayIndexes: [1], arrivalLocationId: "villageSmithy", arrivalSublocationId: "smithyForgeArea" };
const migratedPresent = ok(setup.WeeklyRhythm.initializeMigratedAwayState(generic, legacySaved, world, world), "generic present legacy migration");
assert(migratedPresent.awayState.present && migratedPresent.awayState.travelPeriodsRemaining === 0, "generic legacy-present fixture should gain present lifecycle state");
world.calendar.dayNumber = 1; // Flamesday: old fixed weekly fixture is absent.
const migratedAbsent = ok(setup.WeeklyRhythm.initializeMigratedAwayState(generic, legacySaved, world, world), "generic absent legacy migration");
assert(!migratedAbsent.awayState.present && migratedAbsent.awayState.travelPeriodsRemaining === 0, "generic legacy-absent fixture should be treated road-complete and wait for a later opportunity");

console.log("All generic awayable lifecycle tests passed.");
