"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };

function load(relativePath) {
    const absolutePath = path.join(root, relativePath);
    vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertOk(result, message) {
    assert(result && result.ok, `${message}: ${JSON.stringify(result)}`);
}

function assertFails(result, code, message) {
    assert(result && !result.ok, `${message}: expected failure`);
    assert(result.error.code === code, `${message}: ${JSON.stringify(result)}`);
}

function perform(actorId, action, message) {
    const result = setup.CharacterAPI.perform(actorId, action);
    assertOk(result, message);
    assertOk(setup.Game.validateWorld(), `${message} should preserve world invariants`);
    assertOk(setup.Game.validateHumanControllerInvariant(), `${message} should preserve one human`);
    return result;
}

load("src/generated/world-data.js");
load("src/10-game-api.js");
load("src/20-controllers.js");

assertOk(setup.Game.bootstrap(), "bootstrap should produce a valid world");
let world = setup.Game.getWorld();

assert(world.entities.player.sublocationId === "tavernEntranceFloor", "player should start on entrance floor");
assert(world.entities.innkeeper.sublocationId === "barBehindCounter", "innkeeper should start behind bar");
assert(world.entities.hoodedWoman.sublocationId === "commonRoomTableOne", "hooded woman should start at table one");
for (const characterId of ["player", "innkeeper", "hoodedWoman"]) {
    const character = world.entities[characterId];
    assert(world.entities[character.sublocationId].locationId === character.locationId,
        `${characterId} sublocation should belong to its major location`);
}

assert(setup.Game.getHumanCharacterId() === "player", "player should start human-controlled");
assertOk(setup.Game.takeHumanControl("hoodedWoman"), "takeover should succeed");
assert(setup.Game.getHumanCharacterId() === "hoodedWoman", "hooded woman should be human-controlled");
assertFails(setup.Game.assignNonHumanController("hoodedWoman", "dummy"), "CANNOT_REMOVE_ONLY_HUMAN",
    "generic assignment must not remove only human");
assertOk(setup.Game.takeHumanControl("player"), "control should return to player");

const innkeeperPour = perform("innkeeper", { type: "pour_ale" }, "innkeeper should pour from initial behind-bar position");
assert(world.inventories.inventory_innkeeper.itemIds.includes(innkeeperPour.events[0].itemId),
    "innkeeper's generated mug should enter innkeeper inventory");

perform("player", { type: "move", destination_id: "bar" }, "player should enter bar");
assert(world.entities.player.locationId === "bar", "major move should change location");
assert(world.entities.player.sublocationId === "barPublicSide", "major move should assign default sublocation");
perform("player", { type: "take_item", item_id: "beerMug" }, "player should take existing bar-floor item");
perform("player", { type: "drop_item", item_id: "beerMug" }, "drop should return item to major-location floor");
assert(world.inventories.inventory_bar.itemIds.includes("beerMug"), "dropped item should be in bar floor inventory");
assertFails(setup.CharacterAPI.perform("player", { type: "pour_ale" }), "ACTION_NOT_AVAILABLE",
    "pouring should fail on public side");

perform("player", { type: "move_within_location", destination_id: "barBehindCounter" },
    "player should step behind bar");
assert(world.entities.player.locationId === "bar", "internal move should preserve major location");
assert(world.entities.player.sublocationId === "barBehindCounter", "internal move should change sublocation");

const pourOne = perform("player", { type: "pour_ale" }, "player should pour first ale");
const pourTwo = perform("player", { type: "pour_ale" }, "player should pour second ale");
const mugOne = pourOne.events[0].itemId;
const mugTwo = pourTwo.events[0].itemId;
assert(mugOne !== mugTwo, "consecutive pours should generate unique IDs");
assert(world.entities[mugOne].templateId === "mugOfAle", "generated mug should retain template ID");
assert(world.inventories.inventory_player.itemIds.includes(mugOne), "first mug should enter player inventory");
assert(world.inventories.inventory_player.itemIds.includes(mugTwo), "second mug should enter player inventory");
assert(pourOne.events[0].recipients.includes("innkeeper"), "bar event should reach innkeeper across sublocations");
assert(!pourOne.events[0].recipients.includes("hoodedWoman"), "bar event must not reach common room");

perform("hoodedWoman", { type: "move", destination_id: "tavernEntrance" }, "hooded woman should leave common room");
perform("hoodedWoman", { type: "move", destination_id: "bar" }, "hooded woman should enter bar public side");
assertFails(setup.CharacterAPI.perform("hoodedWoman", {
    type: "move_within_location", destination_id: "barBehindCounter"
}), "SUBLOCATION_FULL", "behind-bar capacity should reject a third occupant");
assert(world.entities.hoodedWoman.sublocationId === "barPublicSide", "failed capacity move must roll back");

const playerMoney = world.entities.player.wallet;
perform("player", { type: "give_money", target_id: "hoodedWoman", amount: 1 },
    "money should transfer across explicitly reachable bar positions");
assert(world.entities.player.wallet === playerMoney - 1, "money transfer should debit actor");

perform("player", { type: "move", destination_id: "tavernEntrance" }, "player should leave bar");
perform("player", { type: "move", destination_id: "commonRoom" }, "player should enter common room floor");
assert(world.entities.player.sublocationId === "commonRoomFloor", "major movement should reset sublocation");
assertFails(setup.CharacterAPI.perform("player", { type: "pour_ale" }), "ACTION_NOT_AVAILABLE",
    "pouring should fail outside bar");

perform("hoodedWoman", { type: "move", destination_id: "tavernEntrance" }, "hooded woman should leave bar");
perform("hoodedWoman", { type: "move", destination_id: "commonRoom" }, "hooded woman should enter common room floor");
perform("hoodedWoman", { type: "move_within_location", destination_id: "commonRoomTableOne" },
    "hooded woman should sit at table one");
perform("player", { type: "move_within_location", destination_id: "commonRoomTableOne" },
    "player should sit at table one");

let view = setup.CharacterAPI.getView("player");
const hoodedView = view.location.characters.find(function (character) { return character.id === "hoodedWoman"; });
assert(hoodedView.position_text.includes("first table"), "presence should reflect table position");
assert(hoodedView.reachable, "characters at same table should be reachable");
assert(!view.location.characters.some(function (character) { return character.id === "player"; }),
    "restricted view must omit self from other occupants");
assert(view.self.position_text.includes("first table"), "self view should use first-person position text");

const placed = perform("player", {
    type: "place_item", item_id: mugOne, target_inventory_id: "inventory_commonRoomTableOne"
}, "player should place mug on table one");
assert(world.inventories.inventory_commonRoomTableOne.itemIds.includes(mugOne), "table one should contain placed mug");
assert(!world.inventories.inventory_commonRoomTableTwo.itemIds.includes(mugOne), "table two must remain distinct");
assert(placed.events[0].recipients.includes("hoodedWoman"), "table event should be public in common room");
assert(!placed.events[0].recipients.includes("innkeeper"), "table event must not reach bar");

perform("hoodedWoman", { type: "take_item", item_id: mugOne }, "table-one occupant should take tabletop mug");
perform("hoodedWoman", { type: "give_item", target_id: "player", item_id: mugOne },
    "characters at same table should give items");
perform("player", {
    type: "place_item", item_id: mugOne, target_inventory_id: "inventory_commonRoomTableOne"
}, "player should replace mug for accessibility rejection tests");

perform("innkeeper", { type: "move_within_location", destination_id: "barPublicSide" },
    "innkeeper should leave behind-bar position");
perform("innkeeper", { type: "move", destination_id: "tavernEntrance" }, "innkeeper should leave bar");
perform("innkeeper", { type: "move", destination_id: "commonRoom" }, "innkeeper should enter common room floor");
assertFails(setup.CharacterAPI.perform("innkeeper", { type: "take_item", item_id: mugOne }),
    "ITEM_NOT_ACCESSIBLE", "floor occupant cannot take table-one item");
perform("innkeeper", { type: "move_within_location", destination_id: "commonRoomTableTwo" },
    "innkeeper should sit at table two");
assertFails(setup.CharacterAPI.perform("innkeeper", { type: "take_item", item_id: mugOne }),
    "ITEM_NOT_ACCESSIBLE", "table-two occupant cannot take table-one item");
perform("innkeeper", { type: "move_within_location", destination_id: "commonRoomFloor" },
    "innkeeper should return to floor");
perform("innkeeper", { type: "move", destination_id: "tavernEntrance" },
    "innkeeper should enter another passage");
assertFails(setup.CharacterAPI.perform("innkeeper", { type: "take_item", item_id: mugOne }),
    "ITEM_NOT_ACCESSIBLE", "distant character cannot take table-one item");
assert(world.inventories.inventory_commonRoomTableOne.itemIds.includes(mugOne),
    "invalid direct API calls must not move tabletop item");

assertOk(setup.Game.takeHumanControl("hoodedWoman"), "take control of seated character");
view = setup.CharacterAPI.getView("hoodedWoman");
assert(view.self.position_text.includes("first table"), "takeover should show new actor's first-person position");
assert(!view.location.characters.some(function (character) { return character.id === "hoodedWoman"; }),
    "takeover should remove new actor's third-person presence");
assert(view.location.characters.some(function (character) {
    return character.id === "player" && character.position_text.includes("first table");
}), "old controlled character should appear with current position");

assertOk(setup.Game.takeHumanControl("player"), "control should return to player");
const serializedWorld = JSON.stringify(world);
State.variables.world = JSON.parse(serializedWorld);
assertOk(setup.Game.bootstrap(), "JSON save/load round trip should preserve a valid world");
world = setup.Game.getWorld();
assert(world.entities.player.sublocationId === "commonRoomTableOne",
    "save/load should preserve character sublocation");
assert(setup.Game.getHumanCharacterId() === "player", "save/load should preserve one human controller");
world.control.assignments.innkeeper = "human";
assert(setup.Game.getHumanCharacterId() === "player", "invalid multi-human state should repair to player");
assertOk(setup.Game.validateWorld(), "world should validate after controller repair");

assert(world.entities.player.playerDescription === setup.GeneratedWorldData.characters.player.playerDescription,
    "runtime characters should be loaded from generated world data");
assert(world.entities.player.mind && Array.isArray(world.entities.player.mind.pendingObservations),
    "runtime character should own a pending observation inbox");
const baseActions = setup.CharacterAPI.getAvailableActions("player");
assert(baseActions.move.sources.some(function (source) { return source.kind === "base"; }),
    "base action should identify its grant source");
assert(!baseActions.read_aura, "player should not receive read_aura");
assert(!baseActions.pour_ale, "player outside behind-bar position should not receive pour_ale");
assertFails(setup.CharacterAPI.perform("player", { type: "read_aura" }),
    "ACTION_NOT_AVAILABLE", "ungranted aura action should be rejected before hidden data is read");

assertOk(setup.Game.takeHumanControl("hoodedWoman"), "hooded woman takeover for aura test");
const auraActions = setup.CharacterAPI.getAvailableActions("hoodedWoman");
assert(auraActions.read_aura.sources.some(function (source) {
    return source.kind === "character_ability" && source.id === "readAura";
}), "read_aura should identify the individual ability source");
assert(auraActions.read_aura.schema.required.length === 1 && auraActions.read_aura.schema.required[0] === "type" &&
    !Object.prototype.hasOwnProperty.call(auraActions.read_aura.schema.properties, "target_id"),
    "read_aura schema should require no caller input beyond its type");
assertFails(setup.CharacterAPI.perform("hoodedWoman", { type: "read_aura", target_id: "player" }),
    "INVALID_ACTION_INPUT", "read_aura should reject caller-supplied targets");
perform("innkeeper", { type: "move", destination_id: "commonRoom" },
    "innkeeper should enter the aura actor's perceivable major location");
const playerInboxBeforeAura = world.entities.player.mind.pendingObservations.length;
const innkeeperInboxBeforeAura = world.entities.innkeeper.mind.pendingObservations.length;
const eventCountBeforeAura = world.events.length;
const positionsBeforeAura = [world.entities.player.locationId, world.entities.hoodedWoman.locationId, world.entities.innkeeper.locationId];
const aura = perform("hoodedWoman", { type: "read_aura" }, "hooded woman should scan all perceivable auras");
assert(aura.events.length === 0 && aura.feedback.length === 1 && aura.error === null,
    "read_aura should be a private feedback-only normalized success");
const auraResults = aura.feedback[0].data.results;
assert(aura.feedback[0].recipientId === "hoodedWoman" && aura.feedback[0].code === "AURA_SCAN_RESULT",
    "aura result should be structured private feedback addressed to the acting character");
assert(auraResults.length === 2 && auraResults.some(function (item) { return item.characterId === "player"; }) &&
    auraResults.some(function (item) { return item.characterId === "innkeeper"; }) &&
    !auraResults.some(function (item) { return item.characterId === "hoodedWoman"; }),
    "scan targets should come from current perception, include all visible others, and exclude self");
assert(auraResults.find(function (item) { return item.characterId === "player"; }).aura === world.entities.player.engineFacts.aura,
    "aura scan should use the visible target's grounded hidden aura only");
assert(auraResults.find(function (item) { return item.characterId === "innkeeper"; }).aura === "You perceive nothing unusual.",
    "an empty Hidden aura should produce the neutral grounded result");
assert(world.events.length === eventCountBeforeAura &&
    JSON.stringify(positionsBeforeAura) === JSON.stringify([world.entities.player.locationId, world.entities.hoodedWoman.locationId, world.entities.innkeeper.locationId]),
    "aura scan should not mutate physical state or create a public event");
assert(world.entities.hoodedWoman.mind.pendingObservations.some(function (item) {
    return item.kind === "action_feedback" && item.actionType === "read_aura" &&
        Array.isArray(item.data.results) && item.data.results.length === 2;
}), "aura feedback should enter only the actor's observation inbox");
assert(world.entities.player.mind.pendingObservations.length === playerInboxBeforeAura,
    "aura feedback must not enter the target inbox");
assert(world.entities.innkeeper.mind.pendingObservations.length === innkeeperInboxBeforeAura,
    "aura feedback must not enter a bystander inbox");
perform("innkeeper", { type: "move", destination_id: "tavernEntrance" },
    "innkeeper should leave the aura actor's perception for exclusion tests");
const secondAura = perform("hoodedWoman", { type: "read_aura" }, "second scan should use updated perception");
assert(!secondAura.feedback[0].data.results.some(function (item) { return item.characterId === "innkeeper"; }),
    "characters outside the actor's major location should be excluded from the scan");
perform("player", { type: "move", destination_id: "tavernEntrance" },
    "player should leave for empty aura scan test");
const emptyAura = perform("hoodedWoman", { type: "read_aura" }, "aura scan with no perceivable characters should succeed");
assert(emptyAura.feedback[0].data.results.length === 0 && emptyAura.feedback[0].text === "You sense no other auras nearby.",
    "empty aura scan should return a grounded private no-target observation");
perform("player", { type: "move", destination_id: "commonRoom" },
    "player should return for restricted-view tests");

const restricted = setup.CharacterAPI.getView("hoodedWoman");
const visiblePlayer = restricted.location.characters.find(function (item) { return item.id === "player"; });
assert(restricted.self.abilities.length === 1 && restricted.self.abilities[0].id === "readAura" &&
    !Object.prototype.hasOwnProperty.call(restricted.self.abilities[0], "aiDescription"),
    "restricted self view should expose only public ability metadata needed by the UI");
assert(visiblePlayer.playerDescription && !Object.prototype.hasOwnProperty.call(visiblePlayer, "aiDescription") &&
    !Object.prototype.hasOwnProperty.call(visiblePlayer, "engineFacts") && !Object.prototype.hasOwnProperty.call(visiblePlayer, "mind"),
    "restricted nearby character view should expose public prose but no private character data");
const context = setup.ContextBuilder.build("hoodedWoman");
assert(context.character.aiDescription === world.entities.hoodedWoman.aiDescription &&
    context.character.abilities[0].id === "readAura", "context should include the actor's own private identity and abilities");
assert(!JSON.stringify(context.view).includes(world.entities.player.engineFacts.aura),
    "context restricted view must not leak another character's engine facts");
const contextSnapshot = JSON.stringify(world);
setup.ContextBuilder.build("hoodedWoman");
assert(JSON.stringify(world) === contextSnapshot, "ContextBuilder must not mutate or acknowledge state");

const failedInboxBefore = world.entities.innkeeper.mind.pendingObservations.length;
const inaccessible = setup.CharacterAPI.perform("innkeeper", { type: "take_item", item_id: mugOne });
assertFails(inaccessible, "ITEM_NOT_ACCESSIBLE", "failed physical action should remain grounded");
assert(inaccessible.feedback.length === 1 && world.entities.innkeeper.mind.pendingObservations.length === failedInboxBefore + 1,
    "failed physical feedback should be normalized and routed to the actor inbox");
const mindsBeforeRoundTrip = cloneMinds(world);
assertOk(setup.Game.takeHumanControl("player"), "control return should preserve minds");
State.variables.world = JSON.parse(JSON.stringify(world));
assert(JSON.stringify(cloneMinds(setup.Game.getWorld())) === JSON.stringify(mindsBeforeRoundTrip),
    "JSON serialize/parse and controller switching should preserve every mind partition");

function cloneMinds(value) {
    const result = {};
    for (const character of Object.values(value.entities).filter(function (entity) { return entity.type === "character"; })) {
        result[character.id] = JSON.parse(JSON.stringify(character.mind));
    }
    return result;
}

const originalGenerated = setup.GeneratedWorldData;
function assertInitialDataRejected(mutator, expectedText) {
    const candidate = JSON.parse(JSON.stringify(originalGenerated));
    mutator(candidate);
    setup.GeneratedWorldData = candidate;
    let rejected = false;
    try { setup.Game.createInitialWorld(); } catch (error) { rejected = error.message.includes(expectedText); }
    setup.GeneratedWorldData = originalGenerated;
    assert(rejected, `invalid initial data should be rejected with ${expectedText}`);
}
assertInitialDataRejected(function (doc) { doc.characters.player.initialControllerId = "dummy"; }, "Exactly one");
assertInitialDataRejected(function (doc) { doc.characters.innkeeper.initialControllerId = "human"; }, "Exactly one");
assertInitialDataRejected(function (doc) { doc.characters.player.inventoryId = "inventory_bar"; }, "Duplicate inventory ID");

world = setup.Game.getWorld();
const originalPassage = world.entities.bar.passage;
world.entities.bar.passage = world.entities.tavernEntrance.passage;
assertFails(setup.Game.validateWorld(), "LOCATION_PASSAGE_INVALID", "runtime should reject duplicate passage names");
world.entities.bar.passage = originalPassage;
assertOk(setup.Game.validateWorld(), "restored world should remain valid");

const storySource = fs.readFileSync(path.join(root, "src/generated/world-passages.twee"), "utf8");
for (const passage of ["The Tavern", "The Bar", "The Common Room", "The Street"]) {
    assert(storySource.includes(`:: ${passage}`), `${passage} physical passage should exist`);
}
assert(!storySource.includes("->The Tavern"), "normal story should not contain raw physical navigation links");
assert(!storySource.includes("setup.GameUI.moveHuman"), "physical passage source should not hard-code exits");
const storyDataSource = fs.readFileSync(path.join(root, "src/generated/world-storydata.twee"), "utf8");
assert(storyDataSource.includes('"start": "The Tavern"'), "generated StoryData should resolve startLocationId passage");

console.log("All framework tests passed.");
