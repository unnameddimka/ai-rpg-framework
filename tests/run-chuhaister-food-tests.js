"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { augment } = require("./runtime-files.js");
const { validateWorldDocument } = require("../tools/world-authored-validator.js");
const { materializeSecrets } = require("../tools/world-secret-materializer.js");
const root = path.resolve(__dirname, "..");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(relativePath) { vm.runInThisContext(fs.readFileSync(path.join(root, relativePath), "utf8"), { filename: relativePath }); }
augment([
    "src/generated/world-data.js",
    "src/07-mind-v3.js",
    "src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js",
    "src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js",
    "src/11-save-migration.js",
    "src/12-character-context.js",
    "src/13-character-memory.js",
    "src/13-verbatim-memory.js",
    "src/14-event-perception.js",
    "src/20-controllers.js"
]).forEach(load);

function fresh() {
    State.variables = {};
    ok(setup.Game.bootstrap(), "bootstrap");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "acknowledge AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}


function processOrdinary(options) {
    const world = setup.Game.getWorld();
    world.ordinaryTickId = (Number.isInteger(world.ordinaryTickId) ? world.ordinaryTickId : 0) + 1;
    return setup.TriggeredEvents.processOrdinaryTick(Object.assign({}, options || {}, { tickId: world.ordinaryTickId }));
}

function place(character, locationId, sublocationId) {
    character.locationId = locationId;
    character.sublocationId = sublocationId;
    character.sleeping = false;
}

function servingIds(actorId) {
    const action = setup.CharacterAPI.getView(actorId).available_actions.serve_food;
    return action && action.options && action.options.serving_action_ids || [];
}

function actorItems(actor, world) {
    return world.inventories[actor.inventoryId].itemIds.map(function (id) { return world.entities[id]; }).filter(Boolean);
}

function cabinetItems(world) {
    return world.inventories.inventory_barDishCabinet.itemIds.map(function (id) { return world.entities[id]; }).filter(Boolean);
}

function byDefinition(items, definitionId) {
    return items.filter(function (item) { return item.definitionId === definitionId; });
}

function moveItemDirect(item, fromInventory, toInventory, world) {
    setup.GameInternals.transferItem(item.id, fromInventory, toInventory, world);
}

function makeGroundFood(world, count) {
    const cabinet = world.inventories.inventory_barDishCabinet;
    let ground = world.inventories[world.entities.trampledGlade.inventoryId];
    const available = cabinet.itemIds.slice(0, count);
    assert(available.length === count, `need ${count} reusable dishes for fixture`);
    available.forEach(function (itemId, index) {
        const item = world.entities[itemId];
        const resultDefinitionId = item.definitionId === "emptyPlate" ? "plateOfSyrnyky" : (index % 2 ? "bowlOfKulish" : "bowlOfBanush");
        setup.GameInternals.transformItem(item, resultDefinitionId, world);
        moveItemDirect(item, cabinet, ground, world);
    });
    return available.slice();
}

// Authored source validates, and disabling the secret removes only its owned footprint.
const source = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
assert(validateWorldDocument(source).length === 0, "complete authored source should validate");
assert(source.characters.chugaister.name === "Chuhaister The Forest Man", "canonical display name should use official Chuhaister transliteration");
assert(/blue eyes/i.test(source.characters.chugaister.playerDescription) && /blue eyes/i.test(source.characters.chugaister.aiDescription), "Chuhaister must be authored with blue eyes in player- and Character-facing appearance");
assert(/glow brightly at will/i.test(source.characters.chugaister.aiDescription) && /voluntary/i.test(source.characters.chugaister.aiDescription) && /not constant/i.test(source.characters.chugaister.aiDescription), "Chuhaister's bright eye glow must be voluntary expressive behavior rather than a constant automatic effect");
assert(source.abilities.playSopilka && source.abilities.playSopilka.secretId === "chugaister", "Play sopilka must belong to the Chugaister secret");
assert(source.triggeredEvents.chuhaisterFoodAppearance.secretId === "chugaister" && source.triggeredEvents.chuhaisterHideAtTimelapse.secretId === "chugaister" && source.triggeredEvents.chuhaisterConsumeGladeFoodAtTimelapse.secretId === "chugaister",
    "all Chugaister proc/lifecycle events must be secret-owned authored content");
assert(!source.locations.bar.sublocations.barKitchen.secretId && !source.itemDefinitions.bowlOfBanush.secretId,
    "ordinary kitchen/food authoring must not be secret-owned");
let disabled = clone(source);
disabled.secrets.chugaister.enabled = false;
let active = materializeSecrets(disabled);
assert(validateWorldDocument(active).length === 0, "active world should validate with Chugaister secret disabled");
assert(!active.characters.chugaister && !active.locations.trampledGlade && !active.abilities.playSopilka,
    "disabled Chugaister secret should remove character, glade, and ability");
assert(!active.triggeredEvents.chuhaisterFoodAppearance && !active.triggeredEvents.chuhaisterHideAtTimelapse && !active.triggeredEvents.chuhaisterConsumeGladeFoodAtTimelapse,
    "disabled Chugaister secret should remove all owned triggered events");
assert(active.locations.bar.sublocations.barKitchen && active.itemDefinitions.bowlOfBanush,
    "disabling Chugaister must not remove ordinary tavern kitchen/food");

// Kitchen topology, finite reusable dishware, and phase-aware menus.
let world = fresh();
const kitchen = world.entities.barKitchen;
assert(kitchen && kitchen.locationId === "bar" && kitchen.inventoryId === "inventory_barDishCabinet", "Kitchen should exist in the tavern and own Dish Cabinet");
assert(kitchen.reachableSublocationIds.length === 2 && kitchen.reachableSublocationIds.includes("barBehindCounter") && kitchen.reachableSublocationIds.includes("barKitchen"),
    "Kitchen should connect only back through Behind the bar");
assert(byDefinition(cabinetItems(world), "emptyBowl").length === 6 && byDefinition(cabinetItems(world), "emptyPlate").length === 6,
    "fresh Dish Cabinet should contain six bowls and six plates");
assert(!cabinetItems(world).some(function (item) { return /dirty/i.test(item.name || "") || (world.itemDefinitions[item.definitionId].tags || []).includes("dirty"); }),
    "dishware should not carry dirty/clean simulation state");
const player = world.entities.player;
place(player, "bar", "barKitchen");
world.environment.timePhase = "morning";
assert(JSON.stringify(servingIds("player")) === JSON.stringify(["serveSyrnyky", "serveBuckwheatPorridge"]), "Morning should expose only breakfast menu");
let breakfastAction = setup.CharacterAPI.getView("player").available_actions.serve_food;
const syrnykyMeta = breakfastAction.options.actions.find(function (record) { return record.id === "serveSyrnyky"; });
const buckwheatMeta = breakfastAction.options.actions.find(function (record) { return record.id === "serveBuckwheatPorridge"; });
assert(syrnykyMeta.required_dish_definition_id === "emptyPlate" && /plate/i.test(syrnykyMeta.ai_description), "Syrnyky must mechanically and AI-facing use a plate");
assert(buckwheatMeta.required_dish_definition_id === "emptyBowl" && /bowl/i.test(buckwheatMeta.ai_description), "Buckwheat porridge must mechanically and AI-facing use a bowl");
world.environment.timePhase = "evening";
assert(JSON.stringify(servingIds("player")) === JSON.stringify(["serveBanush", "serveBorshch", "serveKulish"]), "Evening should expose only banush/borshch/kulish");
for (const record of setup.CharacterAPI.getView("player").available_actions.serve_food.options.actions) {
    assert(record.required_dish_definition_id === "emptyBowl" && /bowl/i.test(record.ai_description), `${record.id} must mechanically and AI-facing use a bowl`);
}

// Serving reuses the same canonical dish; eating returns it to empty state; no duplication.
const dishEntityCountBefore = Object.values(world.entities).filter(function (entity) {
    return entity && entity.type === "item" && ["food_bowl", "food_plate"].includes((world.itemDefinitions[entity.definitionId] || {}).familyId);
}).length;
const bowlCountBefore = byDefinition(cabinetItems(world), "emptyBowl").length;
const servedBanush = ok(setup.CharacterAPI.perform("player", { type: "serve_food", serving_action_id: "serveBanush" }), "serve banush");
const banushItemId = servedBanush.events[0].itemId;
assert(world.entities[banushItemId].definitionId === "bowlOfBanush" && actorItems(player, world).some(function (item) { return item.id === banushItemId; }),
    "serving Banush should transform one cabinet bowl and move the same item to actor inventory");
assert(byDefinition(cabinetItems(world), "emptyBowl").length === bowlCountBefore - 1, "serving should reduce available bowl stock by one");
const eaten = ok(setup.CharacterAPI.perform("player", { type: "consume", item_id: banushItemId }), "eat banush");
assert(world.entities[banushItemId].definitionId === "emptyBowl" && /eats the banush/i.test(eaten.events[0].text), "eating Banush should transform to Empty bowl and use authored eat text");
assert(!/drink|ale/i.test(eaten.events[0].text), "generic food consume must not inherit ale/drinking narration");
moveItemDirect(world.entities[banushItemId], world.inventories[player.inventoryId], world.inventories.inventory_barDishCabinet, world);
assert(byDefinition(cabinetItems(world), "emptyBowl").length === bowlCountBefore && servingIds("player").includes("serveBanush"), "returning Empty bowl to cabinet should make it immediately reusable");
const dishEntityCountAfter = Object.values(world.entities).filter(function (entity) {
    return entity && entity.type === "item" && ["food_bowl", "food_plate"].includes((world.itemDefinitions[entity.definitionId] || {}).familyId);
}).length;
assert(dishEntityCountAfter === dishEntityCountBefore, "serving/eating must not create or duplicate dish entities");
world.environment.timePhase = "morning";
const servedSyrnyky = ok(setup.CharacterAPI.perform("player", { type: "serve_food", serving_action_id: "serveSyrnyky" }), "serve syrnyky");
const syrnykyId = servedSyrnyky.events[0].itemId;
assert(world.entities[syrnykyId].definitionId === "plateOfSyrnyky", "Syrnyky should use an existing plate");
ok(setup.CharacterAPI.perform("player", { type: "consume", item_id: syrnykyId }), "eat syrnyky");
assert(world.entities[syrnykyId].definitionId === "emptyPlate", "eating Syrnyky should return the same plate empty");
assert(world.entities[banushItemId].hunger === undefined && player.hunger === undefined, "edible food must not add hunger/satiety state");

// If no correct dish exists, serving disappears instead of generating one.
world.environment.timePhase = "evening";
const cabinet = world.inventories.inventory_barDishCabinet;
const playerInventory = world.inventories[player.inventoryId];
const movedBowls = cabinet.itemIds.map(function (id) { return world.entities[id]; }).filter(function (item) { return item.definitionId === "emptyBowl"; });
movedBowls.forEach(function (item) { moveItemDirect(item, cabinet, playerInventory, world); });
assert(!setup.CharacterAPI.getView("player").available_actions.serve_food,
    "with no phase-correct dish available, serving should disappear rather than generate dishware");

// Restore a fresh fixture for proc/discovery/lifecycle tests.
world = fresh();
const human = world.entities.player;
world.environment.timePhase = "evening";
setup.GameInternals.grantLocationDiscovery(human.id, "trampledGlade", world);
place(human, "trampledGlade", "trampledGladeClearing");
assert(world.entities.chugaister.activationState === "inactive", "Chuhaister should begin deferred/inactive and off-map");
assert(!setup.GameInternals.characterHasDiscoveredCharacter(human, "chugaister", world), "discovering the glade alone must not discover concrete Chuhaister");
assert(!setup.CharacterAPI.getView("player").location.characters.some(function (record) { return record.id === "chugaister"; }), "slab/glade knowledge must not leak hidden Chuhaister into local selectors");

// No food -> no RNG call; Morning food -> no RNG call.
let calls = 0;
let proc = ok(processOrdinary({ random: function () { calls += 1; return 0; } }), "no-food proc tick");
world = setup.Game.getWorld();
assert(calls === 0 && world.entities.chugaister.activationState === "inactive" && proc.results.find(function (r) { return r.eventId === "chuhaisterFoodAppearance"; }).eligible === false,
    "no ground food should make appearance proc ineligible without rolling");
makeGroundFood(world, 1);
world.environment.timePhase = "morning";
calls = 0;
proc = ok(processOrdinary({ random: function () { calls += 1; return 0; } }), "morning food proc tick");
world = setup.Game.getWorld();
assert(calls === 0 && world.entities.chugaister.activationState === "inactive", "Morning food should not roll appearance chance");

// Model tick-N drop semantics: a condition made true after tick processing waits until next ordinary tick.
world = fresh();
world.environment.timePhase = "evening";
setup.GameInternals.grantLocationDiscovery("player", "trampledGlade", world);
place(world.entities.player, "trampledGlade", "trampledGladeClearing");
calls = 0;
ok(processOrdinary({ random: function () { calls += 1; return 0; } }), "tick N begins before food exists");
world = setup.Game.getWorld();
assert(calls === 0, "tick N should not roll before food is present");
makeGroundFood(world, 1);
assert(world.entities.chugaister.activationState === "inactive", "placing food after tick processing must not retroactively activate Chuhaister");
calls = 0;
proc = ok(processOrdinary({ random: function () { calls += 1; return 0.5; } }), "tick N+1 failed appearance roll");
world = setup.Game.getWorld();
assert(calls === 1 && world.entities.chugaister.activationState === "inactive", "first eligible next tick should roll exactly once and failed roll should keep Chuhaister inactive");
let ground = world.inventories[world.entities.trampledGlade.inventoryId];
assert(ground.itemIds.length === 1 && world.itemDefinitions[world.entities[ground.itemIds[0]].definitionId].tags.includes("edible"), "failed roll must leave food unchanged for later retry");
calls = 0;
proc = ok(processOrdinary({ random: function () { calls += 1; return 0.099999; } }), "following tick successful appearance roll");
world = setup.Game.getWorld();
ground = world.inventories[world.entities.trampledGlade.inventoryId];
assert(calls === 1 && world.entities.chugaister && world.entities.chugaister.activationState === "active", "persistent 10% proc should be eligible again next tick and succeed below 0.10");
assert(setup.GameInternals.characterHasDiscoveredCharacter(world.entities.player, world.entities.chugaister, world), "local grounded perceiver should discover Chuhaister on appearance");
assert(proc.events.some(function (event) { return /sudden wind/i.test(event.text) && /enormous shaggy figure/i.test(event.text) && (event.recipients || []).includes("player"); }), "appearance should create grounded local wind/figure observation for the local perceiver");
assert(ground.itemIds.length === 1 && world.itemDefinitions[world.entities[ground.itemIds[0]].definitionId].tags.includes("edible"), "appearance must not automatically consume food");
calls = 0;
ok(processOrdinary({ random: function () { calls += 1; return 0; } }), "appearance proc while active");
world = setup.Game.getWorld();
assert(calls === 0, "appearance event must be ineligible while Chuhaister is already active");

// Remote characters do not discover him; playerControllable remains forbidden.
assert(!setup.GameInternals.characterHasDiscoveredCharacter(world.entities.nell, world.entities.chugaister, world), "remote Nell must not discover Chuhaister from the glade appearance");
const humanControlAttempt = setup.Game.takeHumanControl("chugaister");
assert(!humanControlAttempt.ok && humanControlAttempt.error.code === "CHARACTER_NOT_PLAYER_CONTROLLABLE", "Chuhaister must remain permanently non-controllable after discovery");

// Location lock blocks outbound movement but leaves local speech/item/ability action surface intact.
const ch = world.entities.chugaister;
const chView = setup.CharacterAPI.getView("chugaister");
const moveOptions = chView.available_actions.move && chView.available_actions.move.options || {};
assert(!(moveOptions.destination_ids || []).some(function (id) { return id !== "trampledGlade"; }), "location-locked Chuhaister should receive no outbound move destinations");
const forcedOutbound = setup.CharacterAPI.validateActionRequest("chugaister", { type: "move", destination_id: "villageEdge" });
assert(!forcedOutbound.ok, "manual outbound move execution must be rejected for location-locked character");
assert(chView.available_actions.use_ability && chView.available_actions.use_ability.sources.some(function (s) { return s.id === "playSopilka"; }), "Play sopilka should be available through ordinary ability action while active");
assert(chView.available_actions.use_ability || chView.available_actions.place_item || chView.available_actions.consume || chView.available_actions.move,
    "location lock must not disable the character's ordinary non-outbound action surface");

// Sopilka is audible/grounded, does not force dance state, and reaches only local perceivers.
const beforeNellObs = (world.entities.nell.mind.pendingObservations || []).length;
const sopilka = ok(setup.CharacterAPI.perform("chugaister", { type: "use_ability", ability_id: "playSopilka" }), "play sopilka");
assert(sopilka.events.some(function (event) { return /urge to dance/i.test(event.text); }), "sopilka event should explicitly ground the urge to dance");
assert(sopilka.events.some(function (event) { return (event.recipients || []).includes("player") && /urge to dance/i.test(event.text); }), "local player should receive sopilka observation");
assert((world.entities.nell.mind.pendingObservations || []).length === beforeNellObs, "remote Nell must not hear sopilka");
for (const character of Object.values(world.entities).filter(function (entity) { return entity && entity.type === "character"; })) {
    assert(character.mustDance === undefined && character.danceStatus === undefined, "sopilka must not create mechanical forced-dance state");
}

// Ten food items still mean one RNG call for the event, not ten.
world = fresh();
world.environment.timePhase = "evening";
makeGroundFood(world, 10);
calls = 0;
ok(processOrdinary({ random: function () { calls += 1; return 0.5; } }), "ten-food appearance tick");
world = setup.Game.getWorld();
assert(calls === 1 && world.entities.chugaister.activationState === "inactive", "ten edible ground items must still produce exactly one 10% roll");
// Removing all food makes the event ineligible again.
const gladeGround = world.inventories[world.entities.trampledGlade.inventoryId];
for (const itemId of gladeGround.itemIds.slice()) moveItemDirect(world.entities[itemId], gladeGround, world.inventories.inventory_barDishCabinet, world);
calls = 0;
ok(processOrdinary({ random: function () { calls += 1; return 0; } }), "empty-glade tick after removal");
world = setup.Game.getWorld();
assert(calls === 0, "removing all matching food must stop rolling");

// Save/load/view refresh preserves triggered-event bookkeeping and does not itself cause another roll.
world = fresh();
world.environment.timePhase = "evening";
makeGroundFood(world, 1);
calls = 0;
ok(processOrdinary({ random: function () { calls += 1; return 0.5; } }), "processed eligible tick before save");
world = setup.Game.getWorld();
assert(calls === 1, "eligible tick should roll once before save");
const savedTickId = world.ordinaryTickId;
const savedLast = world.triggeredEventRuntime.lastProcessedOrdinaryTickId;
State.variables.world = clone(world); // model a canonical save/load round trip.
world = setup.Game.getWorld();
setup.CharacterAPI.getView("player");
setup.CharacterAPI.getView("player");
assert(world.ordinaryTickId === savedTickId && world.triggeredEventRuntime.lastProcessedOrdinaryTickId === savedLast,
    "save/load plus view refresh must not reprocess or advance an already processed ordinary tick");

// Atomic rollback: a later invalid effect must undo an earlier activation in the same event.
world.environment.timePhase = "morning"; // keep the real Evening appearance event ineligible for this synthetic rollback fixture.
world.triggeredEvents.testAtomicRollback = {
    id: "testAtomicRollback", trigger: { type: "ordinary_tick" }, prerequisites: [{ type: "character_activation_is", characterId: "chugaister", value: "inactive" }],
    effects: [
        { type: "activate_character", characterId: "chugaister", locationId: "trampledGlade", sublocationId: "trampledGladeClearing" },
        { type: "definitely_not_supported" }
    ], narrationPolicy: "none"
};
const rolledBack = processOrdinary({ random: function () { return 0; } });
assert(!rolledBack.ok && setup.Game.getWorld().entities.chugaister.activationState === "inactive", "failed triggered-event candidate must rollback prior effects atomically");
world = setup.Game.getWorld();
delete world.triggeredEvents.testAtomicRollback;

// Timelapse-start lifecycle: hide active Chuhaister, consume all food silently/in-place, preserve non-food and mind/discovery.
world = fresh();
world.environment.timePhase = "evening";
setup.GameInternals.grantLocationDiscovery("player", "trampledGlade", world);
place(world.entities.player, "trampledGlade", "trampledGladeClearing");
makeGroundFood(world, 3);
ok(processOrdinary({ random: function () { return 0; } }), "activate Chuhaister for timelapse fixture");
world = setup.Game.getWorld();
const activeCh = world.entities.chugaister;
assert(activeCh && activeCh.activationState === "active", "fixture should have active Chuhaister");
activeCh.mind.knownFacts.push({ id: "test_persistent_fact", text: "Traveler once waited for me with food." });
activeCh.wallet = 7;
setup.GameInternals.grantCharacterDiscovery("player", activeCh.id, world);
// Put one non-edible ordinary item on the same ground to ensure cleanup is tag-scoped.
const playerInv = world.inventories[world.entities.player.inventoryId];
let nonFood = playerInv.itemIds.map(function (id) { return world.entities[id]; }).find(function (item) {
    const def = world.itemDefinitions[item.definitionId]; return def && !(def.tags || []).includes("edible");
});
assert(nonFood, "fixture requires one non-edible player item");
moveItemDirect(nonFood, playerInv, world.inventories[world.entities.trampledGlade.inventoryId], world);
const nonFoodId = nonFood.id;
const foodIdsBeforeCleanup = world.inventories[world.entities.trampledGlade.inventoryId].itemIds.filter(function (id) {
    const item = world.entities[id], def = item && world.itemDefinitions[item.definitionId]; return def && (def.tags || []).includes("edible");
});
assert(foodIdsBeforeCleanup.length === 3, "fixture should have three edible ground items before cleanup");
const timelapseBoundary = ok(setup.TriggeredEvents.processTimelapseStart(), "silent timelapse-start lifecycle");
world = setup.Game.getWorld();
const hiddenCh = world.entities.chugaister;
assert(hiddenCh.activationState === "inactive" && hiddenCh.locationId === null && hiddenCh.sublocationId === null && !setup.WeeklyRhythm.isCharacterPresent(hiddenCh, world),
    "timelapse_start should deactivate Chuhaister before local planner participation");
assert(hiddenCh.mind.knownFacts.some(function (f) { return f.id === "test_persistent_fact"; }) && hiddenCh.wallet === 7,
    "deactivation must preserve Chuhaister mind and wallet");
assert(setup.GameInternals.characterHasDiscoveredCharacter(world.entities.player, hiddenCh, world), "per-character discovery must survive deactivation");
assert(timelapseBoundary.events.length === 0, "narrationPolicy none lifecycle/cleanup should emit no public/narrator-visible event");
const gladeAfter = world.inventories[world.entities.trampledGlade.inventoryId];
for (const id of foodIdsBeforeCleanup) {
    assert(gladeAfter.itemIds.includes(id) && ["emptyBowl", "emptyPlate"].includes(world.entities[id].definitionId), "silent cleanup should transform every food dish in place to reusable empty dish");
}
assert(gladeAfter.itemIds.includes(nonFoodId) && world.entities[nonFoodId].id === nonFoodId, "silent cleanup must leave non-edible ground items untouched");
assert(!setup.CharacterAPI.getView("player").location.characters.some(function (record) { return record.id === "chugaister"; }), "inactive discovered Chuhaister must not leak as locally present");
assert(Object.keys(setup.CharacterAPI.getAvailableActions("chugaister")).length === 0 && setup.CharacterAPI.getView("chugaister").error.code === "ACTOR_NOT_PRESENT", "inactive Chuhaister must have no ordinary action surface and getView must fail cleanly");

// The same saved person can be summoned again on a later Evening.
world.environment.timePhase = "evening";
const emptyGroundDish = foodIdsBeforeCleanup.map(function (id) { return world.entities[id]; }).find(function (item) { return item.definitionId === "emptyBowl"; });
setup.GameInternals.transformItem(emptyGroundDish, "bowlOfBanush", world);
ok(processOrdinary({ random: function () { return 0; } }), "reactivate same Chuhaister");
world = setup.Game.getWorld();
world = setup.Game.getWorld();
assert(world.entities.chugaister.activationState === "active" && world.entities.chugaister.mind.knownFacts.some(function (f) { return f.id === "test_persistent_fact"; }) && world.entities.chugaister.wallet === 7,
    "later activation should restore the same continuing Chuhaister state, not rebuild his mind");
assert(setup.GameInternals.characterHasDiscoveredCharacter(world.entities.player, world.entities.chugaister, world), "discovery should remain after reappearance");

// Generic movement constraint can allow within-location movement while denying location exit.
world = fresh();
const lockedPlayer = world.entities.player;
place(lockedPlayer, "bar", "barPublicSide");
lockedPlayer.movementConstraint = { type: "location_locked", locationId: "bar" };
const lockedView = setup.CharacterAPI.getView("player");
const lockedWithin = lockedView.available_actions.move_within_location;
const lockedOutbound = lockedView.available_actions.move;
assert(lockedWithin && (lockedWithin.options.destination_ids || []).length > 0, "location lock should still allow authored within-location sublocation movement");
assert(!lockedOutbound || (lockedOutbound.options.destination_ids || []).length === 0, "generic location lock should remove outbound location destinations");

console.log("All tavern food / Chuhaister triggered-event tests passed.");
