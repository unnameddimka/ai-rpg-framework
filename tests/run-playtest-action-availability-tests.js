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
function fresh() {
    setup.Game.resetWorld();
    setup.Game.acceptPlayerDisclaimer();
    setup.Game.acknowledgeAISetup();
    setup.Game.finalizePlayerSetup({ mode: "generic" });
    return setup.Game.getWorld();
}
function actions(actorId) { return setup.CharacterAPI.getAvailableActions(actorId); }
function addLooseItem(world, itemId, definitionId, inventoryId) {
    world.entities[itemId] = { id: itemId, type: "item", definitionId: definitionId, inventoryId: inventoryId, containerId: inventoryId };
    world.inventories[inventoryId].itemIds.push(itemId);
}
function clearInventory(world, inventoryId) {
    const inventory = world.inventories[inventoryId];
    for (const itemId of inventory.itemIds.slice()) {
        const item = world.entities[itemId];
        if (item) { item.inventoryId = null; item.containerId = null; }
    }
    inventory.itemIds = [];
}

[
    "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js",
    "src/09-passage-rules.js", "src/09-world-derived-state.js", "src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js",
    "src/10-trade-lifecycle.js","src/10-weekly-rhythm.js", "src/10-presence.js", "src/10-authored-effects.js",
    "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js",
    "src/13-verbatim-memory.js", "src/14-event-perception.js"
].forEach(load);

let world = fresh();
let current = actions("player");
assert(!current.move_within_location, "fresh Traveler entrance should not advertise move_within_location when no internal destination exists");
assert(!current.take_item, "fresh Traveler entrance should not advertise take_item when nothing is takeable");
assert(current.drop_item && current.drop_item.options.item_ids.includes("silverChain_01"), "drop_item should be present when an owned item exists");
assert(!current.give_item, "give_item should be absent when no reachable target exists");
assert(!current.give_money, "give_money should be absent when no reachable target exists");

addLooseItem(world, "playtestLoosePaper", "paperSheet", "inventory_tavernEntrance");
current = actions("player");
assert(current.take_item && current.take_item.options.item_ids.includes("playtestLoosePaper"), "take_item should appear when a valid takeable item exists");

world = fresh();
clearInventory(world, "inventory_player");
current = actions("player");
assert(!current.drop_item, "drop_item should be absent when the actor owns no loose item");

world = fresh();
world.entities.player.locationId = "commonRoom";
world.entities.player.sublocationId = "commonRoomFloor";
current = actions("player");
assert(current.move_within_location && current.move_within_location.options.destination_ids.length > 0, "move_within_location should appear when an internal destination exists");
assert(current.give_item && current.give_item.options.item_ids.length > 0 && current.give_item.options.target_ids.length > 0, "give_item should appear when both an owned item and reachable target exist");
assert(current.give_money && current.give_money.options.maximum_amount > 0 && current.give_money.options.target_ids.length > 0, "give_money should appear when a reachable target and positive transferable amount exist");

clearInventory(world, "inventory_player");
current = actions("player");
assert(!current.give_item, "give_item should be absent with reachable targets but no owned item");
world.entities.player.wallet = 0;
current = actions("player");
assert(!current.give_money, "give_money should be absent with reachable targets when maximum_amount is zero");
world.entities.player.wallet = 2;
current = actions("player");
assert(current.give_money && current.give_money.options.maximum_amount === 2, "give_money should return when a positive amount becomes transferable");

world = fresh();
world.entities.player.locationId = "commonRoom";
world.entities.player.sublocationId = "commonRoomTableThree";
clearInventory(world, "inventory_player");
current = actions("player");
assert(!current.place_item, "place_item should not be advertised from a surface capability when the actor has no item to place");
addLooseItem(world, "playtestPlacePaper", "paperSheet", "inventory_player");
current = actions("player");
assert(current.place_item && current.place_item.options.item_ids.includes("playtestPlacePaper") && current.place_item.options.target_inventory_ids.includes("inventory_commonRoomTableThree"),
    "place_item should appear once a valid item+surface invocation exists");

world = fresh();
world.entities.player.locationId = "commonRoom";
world.entities.player.sublocationId = "underStairsBed";
current = actions("player");
assert(current.sleep && Object.keys(current.sleep.options).length === 0, "valid zero-input sleep must remain available even with no option arrays");

world = fresh();
assert(setup.CharacterAPI.getRelevantMechanics("innkeeper").fill, "ale source should keep fill relevant even without a compatible mug");
assert(!actions("innkeeper").fill, "relevantMechanics must remain broader than available_actions for missing-prerequisite fill");

world = fresh();
world.entities.player.locationId = "commonRoom";
world.entities.player.sublocationId = "commonRoomFloor";
const baseTypes = ["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money"];
const humanBase = Object.fromEntries(baseTypes.map(function (type) { return [type, Boolean(actions("player")[type])]; }));
world.control.assignments.player = "ai";
world.control.assignments.innkeeper = "human";
const aiBase = Object.fromEntries(baseTypes.map(function (type) { return [type, Boolean(actions("player")[type])]; }));
assert(JSON.stringify(humanBase) === JSON.stringify(aiBase), "controller-neutral base affordances should not change merely because the same character switches Human/AI control");

world = fresh();
assert(!actions("player").use_ability, "Traveler must not gain character-specific abilities for controller parity");
assert(actions("hoodedWoman").use_ability && actions("hoodedWoman").use_ability.options.ability_ids.includes("readAura"), "Mara must retain her authored unique ability");

console.log("0.1.3-playtest executable-now action availability tests passed.");
