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

let view = setup.CharacterAPI.getView("player");
assert(view.location.id === "tavernEntrance", "initial view should show the tavern entrance");
assert(Array.isArray(view.location.description), "location description should be an array");
assert(view.location.description.length > 0, "location description should contain prose");
assert(view.location.exits.length === 3, "entrance exits should come from world state");
assert(view.location.characters.length === 0, "the controlled character must not see itself nearby");

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

view = setup.CharacterAPI.getView("player");
assert(view.location.id === "bar", "view should follow the actor's world location");
assert(view.location.characters.some(function (character) {
    return character.id === "innkeeper" && character.presence_text;
}), "bar view should expose the innkeeper's public presence");
assert(!view.location.characters.some(function (character) {
    return character.id === "player";
}), "nearby characters should never include self");

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

assertOk(setup.Game.takeHumanControl("innkeeper"), "innkeeper takeover should succeed");
view = setup.CharacterAPI.getView("innkeeper");
assert(!view.location.characters.some(function (character) {
    return character.id === "innkeeper";
}), "innkeeper should not see its own presence");
assert(view.location.characters.some(function (character) {
    return character.id === "player" && character.presence_text;
}), "innkeeper should see the player's public presence in the bar");

assertOk(setup.CharacterAPI.perform("hoodedWoman", {
    type: "move",
    destination_id: "tavernEntrance"
}), "hooded woman should move to the entrance");
assertOk(setup.CharacterAPI.perform("hoodedWoman", {
    type: "move",
    destination_id: "bar"
}), "hooded woman should move into the bar");
view = setup.CharacterAPI.getView("innkeeper");
assert(view.location.characters.some(function (character) {
    return character.id === "hoodedWoman";
}), "a character entering the room should appear dynamically");

assertOk(setup.CharacterAPI.perform("hoodedWoman", {
    type: "move",
    destination_id: "tavernEntrance"
}), "hooded woman should leave the bar");
view = setup.CharacterAPI.getView("innkeeper");
assert(!view.location.characters.some(function (character) {
    return character.id === "hoodedWoman";
}), "a character leaving the room should disappear dynamically");

assertOk(setup.Game.takeHumanControl("player"), "control should return to player before repair test");

world.control.assignments.innkeeper = "human";
const repairedHumanId = setup.Game.getHumanCharacterId();
assert(repairedHumanId === "player", "invalid multiple-human state should repair to player");
assertOk(setup.Game.validateWorld(), "world should validate after repair");

const storySource = fs.readFileSync(path.join(root, "src/story.twee"), "utf8");
assert(storySource.includes(":: Location"), "story should contain the generic Location passage");
assert(!storySource.includes(":: The Bar"), "story should not retain a physical bar passage");
assert(!storySource.includes("->The Tavern"), "story should not contain raw physical navigation links");

console.log("All framework tests passed.");
