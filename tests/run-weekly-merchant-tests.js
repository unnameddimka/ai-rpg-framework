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
    "src/20-controllers.js"
]).forEach(load);

function setupFreshWorld() {
    ok(setup.Game.bootstrap(), "bootstrap");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "acknowledge AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}

function addLooseItem(world, inventoryId, itemId, definitionId) {
    const definition = world.itemDefinitions[definitionId];
    assert(definition, `missing test definition ${definitionId}`);
    const inventory = world.inventories[inventoryId];
    assert(inventory, `missing test inventory ${inventoryId}`);
    world.entities[itemId] = {
        id: itemId,
        type: "item",
        definitionId: definitionId,
        name: definition.name,
        containerId: inventoryId
    };
    if (definition.writable === true) world.entities[itemId].content = "";
    inventory.itemIds.push(itemId);
    return world.entities[itemId];
}

let world = setupFreshWorld();
const merchant = world.entities.roadMerchant;
assert(setup.WeeklyRhythm.currentWeekdayName(world) === "Monday", "fresh world should begin on Monday");
assert(setup.WeeklyRhythm.isCharacterPresent(merchant, world), "merchant should be present on Monday");
assert(setup.WeeklyRhythm.isLocationAvailable("merchantWagon", world), "wagon should be locally available during a visit");
assert(setup.WeeklyRhythm.isSublocationAvailable("merchantSaleChest", world), "sale chest position should exist during a visit");
assert(world.environment.timePhase === "evening", "fresh Mallowstead world should begin in Evening");
assert(merchant.locationId === "commonRoom" && merchant.sublocationId === "commonRoomTableTwo", "fresh-world Monday Evening should start Maksym seated at the second tavern table");
assert(world.inventories.inventory_roadMerchant.itemIds.includes("maksymAle_01") && world.entities.maksymAle_01.definitionId === "mugOfAle", "Maksym should start the first evening carrying one normal filled mug of ale");
assert(merchant.weeklyPresence.arrivalLocationId === "marketSquare" && merchant.weeklyPresence.arrivalSublocationId === "marketSquareCenter", "regular later merchant arrivals should remain on Market Square");
assert(world.inventories.inventory_roadMerchant.itemIds.includes("merchantWagonKey") && world.inventories.inventory_roadMerchant.itemIds.includes("merchantSaleChestKey"), "merchant should carry both wagon and sale-chest keys");
// Continue the existing merchant commerce fixture from his normal worksite; this direct test setup is not gameplay.
merchant.locationId = "marketSquare"; merchant.sublocationId = "marketSquareCenter";

const initialSaleIds = world.inventories.inventory_merchantSaleChest.itemIds.slice();
assert(initialSaleIds.length > 0, "Monday arrival should restock the locked sale chest");
assert(initialSaleIds.every(function (itemId) {
    const provenance = world.entities[itemId].tradeProvenance;
    return provenance && provenance.ownerCharacterId === merchant.id && provenance.role === "sale_stock";
}), "generated merchandise should be marked as merchant sale stock");

// The physical chest is visible while present, but its contents are hidden from an actor without the key.
world.entities.player.locationId = "marketSquare";
world.entities.player.sublocationId = "marketSquareCenter";
ok(setup.CharacterAPI.perform("player", { type: "move_within_location", destination_id: "merchantSaleChest" }), "Traveler should be able to stand beside the locked sales chest");
let playerView = setup.CharacterAPI.getView("player");
assert(!playerView.accessible_inventories.some(function (inventory) { return inventory.id === "inventory_merchantSaleChest"; }), "Traveler without the chest key must not see sale-stock contents");
assert(!JSON.stringify(playerView).includes(initialSaleIds[0]), "locked sale-stock item IDs must not leak into the Traveler view");

// Merchant can physically open the same existing keyed container and can reason about stock even away from it.
ok(setup.CharacterAPI.perform("roadMerchant", { type: "move_within_location", destination_id: "merchantSaleChest" }), "merchant should reach his sale chest");
let merchantView = setup.CharacterAPI.getView("roadMerchant");
assert(merchantView.accessible_inventories.some(function (inventory) { return inventory.id === "inventory_merchantSaleChest" && inventory.items.length > 0; }), "merchant key should expose sale-stock contents through the normal container-access contract");
const merchantPrivate = setup.CharacterContext.buildPrivateCharacter("roadMerchant");
assert(merchantPrivate.weeklySchedule && merchantPrivate.weeklySchedule.regularPresenceDays.join(",") === "Monday,Woodsday", "merchant model context should know the canonical visit schedule");
assert(merchantPrivate.tradeKnowledge && merchantPrivate.tradeKnowledge.currentSaleStock.length === initialSaleIds.length, "merchant model context should know current locked sale stock");
assert(merchantPrivate.tradeKnowledge.externalSaleValues.some(function (entry) { return entry.definitionId === "squirrelPelt" && entry.externalSaleValue === 2; }), "merchant should receive grounded external sale values for supported local goods");

// Taking his own merchandise from the sale chest must preserve sale-stock provenance rather than relabel it as acquired stock.
const carriedSaleItemId = initialSaleIds[0];
ok(setup.CharacterAPI.perform("roadMerchant", { type: "take_item", item_id: carriedSaleItemId }), "merchant should take one sale item from his keyed chest");
assert(world.entities[carriedSaleItemId].tradeProvenance && world.entities[carriedSaleItemId].tradeProvenance.role === "sale_stock", "merchant taking own merchandise must preserve sale-stock provenance");

// Handing that merchandise to a customer ends merchant provenance.
world.entities.player.sublocationId = "marketSquareCenter";
ok(setup.CharacterAPI.perform("roadMerchant", { type: "give_item", target_id: "player", item_id: carriedSaleItemId }), "merchant should hand sale merchandise to a nearby customer");
assert(!world.entities[carriedSaleItemId].tradeProvenance, "sold merchandise should no longer be merchant trade stock");

// Bulk transfer is atomic and marks direct customer->merchant goods as acquired stock.
const peltA = addLooseItem(world, "inventory_player", "test_pelt_a", "squirrelPelt");
const peltB = addLooseItem(world, "inventory_player", "test_pelt_b", "squirrelPelt");
const playerItemsBeforeFailedBundle = world.inventories.inventory_player.itemIds.slice();
const failedBundle = setup.CharacterAPI.perform("player", {
    type: "transfer_items",
    source_inventory_id: "inventory_player",
    target_inventory_id: "inventory_roadMerchant",
    item_ids: [peltA.id, "missing_test_item"]
});
assert(!failedBundle.ok, "bulk transfer with an invalid member should fail");
assert(JSON.stringify(world.inventories.inventory_player.itemIds) === JSON.stringify(playerItemsBeforeFailedBundle), "failed bulk transfer must move none of the bundle");
ok(setup.CharacterAPI.perform("player", {
    type: "transfer_items",
    source_inventory_id: "inventory_player",
    target_inventory_id: "inventory_roadMerchant",
    item_ids: [peltA.id, peltB.id]
}), "Traveler should bulk-transfer two pelts to merchant");
assert([peltA.id, peltB.id].every(function (itemId) {
    const item = world.entities[itemId];
    return item.containerId === "inventory_roadMerchant" && item.tradeProvenance && item.tradeProvenance.ownerCharacterId === "roadMerchant" && item.tradeProvenance.role === "acquired_stock";
}), "directly purchased local goods should be marked acquired stock in merchant inventory");

// Paper is one persistent content string; reusable Writing Set is capability-only and is not consumed.
const paper = addLooseItem(world, "inventory_player", "test_paper", "paperSheet");
const writingSet = addLooseItem(world, "inventory_player", "test_writing_set", "writingSet");
const paperContent = "Meet me after sunset.\n\n*a small house is drawn beneath the note*";
ok(setup.CharacterAPI.perform("player", { type: "write_paper", item_id: paper.id, content: paperContent }), "Writing Set should allow writing/drawing on paper");
assert(world.entities[paper.id].content === paperContent, "paper content should be stored verbatim on the item instance");
assert(world.inventories.inventory_player.itemIds.includes(writingSet.id), "Writing Set should not be consumed by writing");
const readResult = ok(setup.CharacterAPI.perform("player", { type: "read_paper", item_id: paper.id }), "paper should be readable without consuming anything");
assert(readResult.feedback.some(function (entry) { return entry.code === "PAPER_CONTENT" && entry.data && entry.data.content === paperContent; }), "read action should return the same canonical mixed text/drawing content");

// Monday -> Flamesday boundary settles only acquired valued goods and begins with merchant/wagon already away.
const walletBeforeDeparture = merchant.wallet;
const expectedSettlement = world.itemDefinitions.squirrelPelt.externalSaleValue * 2;
const departure = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance Monday to Flamesday");
assert(departure.weekday === "Flamesday", "day boundary should enter Flamesday");
assert(!setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "merchant should already be away on Flamesday morning");
assert(!setup.WeeklyRhythm.isLocationAvailable("merchantWagon", world), "wagon should already be absent on Flamesday morning");
assert(!setup.WeeklyRhythm.isSublocationAvailable("merchantSaleChest", world), "sale chest should already be absent on Flamesday morning");
assert(!world.entities[peltA.id] && !world.entities[peltB.id] && merchant.wallet === walletBeforeDeparture + expectedSettlement, "valued acquired goods should settle into merchant gold at departure");
assert(world.entities[paper.id] && world.entities[paper.id].content === paperContent, "unrelated paper content must survive weekly settlement");
playerView = setup.CharacterAPI.getView("player");
assert(!playerView.location.sublocations.some(function (entry) { return entry.id === "merchantSaleChest"; }), "away sale chest must disappear from local view topology");
assert(!playerView.location.exits.some(function (entry) { return entry.id === "merchantWagon"; }), "away wagon passage must disappear from local view topology");
assert(!setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "roadMerchant"; }), "away merchant must not remain AI-scheduler eligible");

// Flamesday -> Flowday -> Woodsday: no visit on Flowday, fresh visit and fresh chest stock on Woodsday.
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance Flamesday to Flowday");
assert(setup.WeeklyRhythm.currentWeekdayName(world) === "Flowday" && !setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "merchant should remain away on Flowday");
const arrival = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance Flowday to Woodsday");
assert(arrival.weekday === "Woodsday" && setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "merchant should return on Woodsday morning");
assert(merchant.locationId === "marketSquare" && merchant.sublocationId === "marketSquareCenter", "Woodsday arrival should place merchant back on Market Square");
assert(world.inventories.inventory_merchantSaleChest.itemIds.length > 0, "Woodsday arrival should generate a fresh sale-stock cycle");
assert(world.inventories.inventory_merchantSaleChest.itemIds.every(function (itemId) {
    const provenance = world.entities[itemId] && world.entities[itemId].tradeProvenance;
    return provenance && provenance.ownerCharacterId === "roadMerchant" && provenance.role === "sale_stock";
}), "fresh Woodsday chest stock should retain sale-stock provenance");

ok(setup.Game.validateWorld(), "weekly merchant mechanics should preserve world invariants");
console.log("All weekly rhythm, merchant, bulk-transfer, and paper tests passed.");
