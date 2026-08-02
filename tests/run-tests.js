"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = {
    play: function () {},
    show: function () {}
};

function load(relativePath) {
    const absolutePath = path.join(root, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    vm.runInThisContext(source, { filename: absolutePath });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertOk(result, message) {
    assert(result && result.ok, `${message}: ${JSON.stringify(result)}`);
}

load("src/10-game-api.js");
load("src/20-controllers.js");

assertOk(setup.Game.bootstrap(), "bootstrap should produce a valid world");

let world = setup.Game.getWorld();
assert(setup.Game.getHumanCharacterId() === "player", "player should start human-controlled");
assertOk(setup.Game.validateHumanControllerInvariant(), "one human invariant should hold");

assertOk(setup.Game.takeHumanControl("hoodedWoman"), "takeover should succeed");
assert(setup.Game.getHumanCharacterId() === "hoodedWoman", "hooded woman should be human-controlled");
assert(world.control.assignments.player === "dummy", "previous human should return to dummy");
assertOk(setup.Game.validateHumanControllerInvariant(), "one human invariant should survive takeover");

const forbidden = setup.Game.assignNonHumanController("hoodedWoman", "dummy");
assert(!forbidden.ok, "generic assignment must not remove the only human controller");

assertOk(setup.Game.takeHumanControl("player"), "control should return to player");

assertOk(setup.CharacterAPI.perform("player", {
    type: "move",
    destination_id: "bar"
}), "player should move to bar");

world = setup.Game.getWorld();
assert(world.entities.player.locationId === "bar", "player location should be bar");

assertOk(setup.CharacterAPI.perform("player", {
    type: "take_item",
    item_id: "beerMug"
}), "player should take mug");

assert(world.inventories.inventory_player.itemIds.includes("beerMug"), "player inventory should contain mug");
assert(world.entities.beerMug.containerId === "inventory_player", "mug containerId should match");

assertOk(setup.CharacterAPI.perform("player", {
    type: "give_item",
    target_id: "innkeeper",
    item_id: "beerMug"
}), "player should give mug to innkeeper");

assert(world.inventories.inventory_innkeeper.itemIds.includes("beerMug"), "innkeeper should receive mug");

const playerBefore = world.entities.player.wallet;
const innkeeperBefore = world.entities.innkeeper.wallet;
assertOk(setup.CharacterAPI.perform("player", {
    type: "give_money",
    target_id: "innkeeper",
    amount: 3
}), "player should give money");
assert(world.entities.player.wallet === playerBefore - 3, "player wallet should decrease");
assert(world.entities.innkeeper.wallet === innkeeperBefore + 3, "innkeeper wallet should increase");

const failed = setup.CharacterAPI.perform("player", {
    type: "give_money",
    target_id: "innkeeper",
    amount: 9999
});
assert(!failed.ok, "insufficient-funds action should fail");
assert(world.entities.player.wallet === playerBefore - 3, "failed action must not alter player wallet");

world.control.assignments.innkeeper = "human";
const repairedHumanId = setup.Game.getHumanCharacterId();
assert(repairedHumanId === "player", "invalid multiple-human state should repair to player");
assertOk(setup.Game.validateWorld(), "world should validate after repair");

console.log("All framework tests passed.");
