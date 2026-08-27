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
    State.variables = {};
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
assert(world.entities.player.locationId === "tavernEntrance" && world.entities.player.sublocationId === "tavernEntranceFloor", "fresh-world Traveler should begin at the tavern entrance");
assert(world.entities.hoodedWoman.locationId === "commonRoom" && world.entities.hoodedWoman.sublocationId === "commonRoomTableOne", "fresh-world Monday Evening should start Mara at the first tavern table");
assert(merchant.locationId === "commonRoom" && merchant.sublocationId === "commonRoomTableTwo", "fresh-world Monday Evening should start Maksym seated at the second tavern table");
assert(world.entities.nell.locationId === "commonRoom" && world.entities.nell.sublocationId === "commonRoomFloor", "fresh-world Monday Evening should start Nell working on the common-room floor");
assert(world.entities.innkeeper.locationId === "bar" && world.entities.innkeeper.sublocationId === "barBehindCounter", "fresh-world Monday Evening should start Garrick behind the bar");
assert(world.inventories.inventory_roadMerchant.itemIds.includes("maksymAle_01") && world.entities.maksymAle_01.definitionId === "mugOfAle", "Maksym should start the first evening carrying one normal filled mug of ale");
const authoredPublicWorld = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
const authoredMaksym = authoredPublicWorld.characters.roadMerchant;
const roadMerchantLore = fs.readFileSync(path.join(root, "data/world-lore.md"), "utf8").split("## The Road Merchant")[1].split("## ")[0];
const maksymAgeText = `${authoredMaksym.playerDescription} ${authoredMaksym.aiDescription} ${roadMerchantLore}`;
assert(!/early thirties/i.test(maksymAgeText) && !/\b(?:1[89]|[2-5]\d)\b/.test(maksymAgeText), "public Maksym authoring should describe qualitative youth/experience without a narrow numeric adult age range");
assert(/\byoung\b/i.test(authoredMaksym.playerDescription) && /\byoung\b/i.test(authoredMaksym.aiDescription) && /violence|ambush|hardship|danger/i.test(maksymAgeText), "Maksym should remain clearly young while retaining grounded road experience and danger awareness");
assert(merchant.awayable && merchant.awayable.arrivalLocationId === "marketSquare" && merchant.awayable.arrivalSublocationId === "marketSquareCenter", "regular later merchant arrivals should remain on Market Square");
assert(merchant.awayState && setup.Presence.stateAllowsPresence(merchant) && !Object.prototype.hasOwnProperty.call(merchant.awayState, "present") && merchant.awayState.plannedDeparture.dayNumber === 1 && merchant.awayState.plannedDeparture.phase === "Morning", "fresh Monday Evening should initialize a Flamesday Morning planned departure");
assert(world.inventories.inventory_roadMerchant.itemIds.includes("merchantWagonKey") && world.inventories.inventory_roadMerchant.itemIds.includes("merchantSaleChestKey"), "merchant should carry both wagon and sale-chest keys");
const freshActionCatalog = setup.CharacterAPI.getView("roadMerchant").available_actions;
assert(freshActionCatalog.defer_departure, "Maksym should receive defer_departure on fresh Monday Evening because Flamesday Morning departure is imminent");
const firstDefer = ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "Maksym defers first departure one period");
assert(merchant.awayState.plannedDeparture.dayNumber === 1 && merchant.awayState.plannedDeparture.phase === "Evening", "Monday Evening defer should move planned departure to Flamesday Evening");
assert(!setup.CharacterAPI.getView("roadMerchant").available_actions.defer_departure, "a second immediate defer should not be exposed before the next ordinary period");
assert(Array.isArray(firstDefer.events) && firstDefer.events.length === 0, "Maksym defer should be private and create no automatic public announcement");
// Continue the existing merchant commerce fixture from his normal worksite; this direct test setup is not gameplay.
merchant.locationId = "marketSquare"; merchant.sublocationId = "marketSquareCenter";

const initialSaleIds = world.inventories.inventory_merchantSaleChest.itemIds.slice();
assert(initialSaleIds.length > 0, "fresh authored bootstrap should seed the locked sale chest without pretending a scheduled arrival occurred");
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

// Monday Evening defer keeps Maksym through Flamesday Morning; actual Flamesday Evening departure settles acquired valued goods.
const walletBeforeDeparture = merchant.wallet;
const expectedSettlement = world.itemDefinitions.squirrelPelt.externalSaleValue * 2;
const flamesdayMorning = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "advance Monday Evening to Flamesday Morning");
assert(flamesdayMorning.weekday === "Flamesday", "day boundary should enter Flamesday");
assert(setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "Monday-evening defer should keep Maksym present on Flamesday morning");
assert(merchant.awayState.travelPeriodsRemaining === 0, "present Maksym should have no road countdown before actual departure");
// A foreign locally-present occupant must not be stranded when owner topology disappears.
world.entities.player.locationId = "merchantWagon";
world.entities.player.sublocationId = "merchantWagonBunk";
world.entities.player.sleeping = true;
const wagonCargoMarker = addLooseItem(world, "inventory_merchantWagonCargo", "wagon_departure_marker", "paperSheet");
const verbatimBeforeForcedRelocation = world.entities.player.mind.verbatimObservations.length;
const departure = ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "advance Flamesday daytime to planned Evening departure");
assert(!setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "Maksym should actually leave at deferred Flamesday Evening boundary");
assert(merchant.awayState.travelPeriodsRemaining === 3, "actual departure should begin the authored three-period road without retroactive credit");
assert(!setup.WeeklyRhythm.isLocationAvailable("merchantWagon", world), "wagon should be absent after actual departure");
assert(!setup.WeeklyRhythm.isSublocationAvailable("merchantSaleChest", world), "sale chest should be absent after actual departure");
assert(world.entities.player.locationId === "marketSquare" && world.entities.player.sublocationId === "marketSquareCenter" &&
    world.entities.player.sleeping === false && setup.Presence.isLocallyPresent("player", world),
    "a sleeping Traveler left in the departing wagon must wake and be reconciled to the wagon's single-exit fallback on Market Square");
const merchantDepartureTransition = departure.transitions.find(function (entry) { return entry.type === "departure" && entry.characterId === "roadMerchant"; });
assert(merchantDepartureTransition && merchantDepartureTransition.forcedRelocations.some(function (entry) {
    return entry.characterId === "player" && entry.locationId === "marketSquare" && entry.sublocationId === "marketSquareCenter";
}), "Maksym departure should report the deterministic forced relocation in its canonical transition result");
assert(world.entities.player.mind.verbatimObservations.length === verbatimBeforeForcedRelocation + 1 &&
    world.entities.player.mind.verbatimObservations.at(-1).kind === "event",
    "forced relocation must create grounded committed experience for the displaced Human character");
assert(world.entities[wagonCargoMarker.id] && world.entities[wagonCargoMarker.id].containerId === "inventory_merchantWagonCargo",
    "items inside disappearing owner topology must travel with that topology rather than being evacuated");
assert(!world.entities[peltA.id] && !world.entities[peltB.id] && merchant.wallet === walletBeforeDeparture + expectedSettlement, "valued acquired goods should settle into merchant gold at actual departure");
assert(world.entities[paper.id] && world.entities[paper.id].content === paperContent, "unrelated paper content must survive weekly settlement");
playerView = setup.CharacterAPI.getView("player");
assert(!playerView.location.sublocations.some(function (entry) { return entry.id === "merchantSaleChest"; }), "away sale chest must disappear from local view topology");
assert(!playerView.location.exits.some(function (entry) { return entry.id === "merchantWagon"; }), "away wagon passage must disappear from local view topology");
assert(!setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "roadMerchant"; }), "away merchant must not remain AI-scheduler eligible");

// Authoritative road boundary: Night=1, Flowday Day=2, Flowday Night=3, then Woodsday Morning true arrival.
const roadOne = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "Flamesday Night completes road period 1");
assert(setup.WeeklyRhythm.currentWeekdayName(world) === "Flowday" && !setup.Presence.stateAllowsPresence(merchant) && merchant.awayState.travelPeriodsRemaining === 2, "Flowday Morning should reflect exactly one completed road period");
const roadTwo = ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "Flowday Day completes road period 2");
assert(!setup.Presence.stateAllowsPresence(merchant) && merchant.awayState.travelPeriodsRemaining === 1, "Flowday Evening should reflect exactly two completed road periods");
const arrival = ok(setup.WeeklyRhythm.advanceDayBoundary(world, { random: function () { return 0; } }), "Flowday Night completes road period 3 and reaches Woodsday Morning");
assert(arrival.weekday === "Woodsday" && setup.WeeklyRhythm.isCharacterPresent("roadMerchant", world), "exactly three completed periods after Flamesday Evening departure should allow Woodsday Morning return");
assert(merchant.locationId === "marketSquare" && merchant.sublocationId === "marketSquareCenter", "true Woodsday return should place Maksym on Market Square");
assert(merchant.awayState.plannedDeparture.dayNumber === 4 && merchant.awayState.plannedDeparture.phase === "Morning", "true Woodsday arrival should initialize the following Goldsday Morning departure");
assert(world.inventories.inventory_merchantSaleChest.itemIds.length > 0, "true Woodsday return should run the authored sale-chest restock hook");
assert(setup.WeeklyRhythm.isLocationAvailable("merchantWagon", world) && world.entities[wagonCargoMarker.id] &&
    world.entities[wagonCargoMarker.id].containerId === "inventory_merchantWagonCargo",
    "wagon contents must remain canonical while away and be accessible with the same topology when it returns");
assert(world.inventories.inventory_merchantSaleChest.itemIds.every(function (itemId) {
    const provenance = world.entities[itemId] && world.entities[itemId].tradeProvenance;
    return provenance && provenance.ownerCharacterId === "roadMerchant" && provenance.role === "sale_stock";
}), "true-return chest stock should retain sale-stock provenance");
assert(!world.inventories.inventory_merchantSaleChest.itemIds.some(function (id) { return initialSaleIds.includes(id); }), "true arrival restock should replace the prior visit's authored sale-stock instances");

// Personal inventory remains distinct from currentSaleStock even when it contains ordinary items.
const privateAfterReturn = setup.CharacterContext.buildPrivateCharacter("roadMerchant");
assert(privateAfterReturn.tradeKnowledge.currentWallet === merchant.wallet, "private trade grounding should expose current wallet");
assert(privateAfterReturn.tradeKnowledge.personalInventoryIsAutomaticallySaleStock === false, "private trade grounding should explicitly distinguish personal inventory from sale stock");
assert(privateAfterReturn.awayableLifecycle && /Market Square/.test(privateAfterReturn.awayableLifecycle.instructions), "private awayable grounding should explain that trade stock is kept at Market Square");
assert(privateAfterReturn.awayableLifecycle.scheduleText && /Current planned departure/.test(privateAfterReturn.awayableLifecycle.scheduleText), "private awayable grounding should communicate current schedule consequences");

// If Maksym continuously stays through a regular arrival opportunity, it is not a fake trip and does not restock.
world = setupFreshWorld();
const staying = world.entities.roadMerchant;
const stayingInitialStock = world.inventories.inventory_merchantSaleChest.itemIds.slice();
ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "stay Monday Evening -> Flamesday Evening");
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "reach Flamesday Morning while staying");
world.environment.timePhase = "morning";
ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "stay Flamesday Morning -> Flowday Morning");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "reach Flamesday Evening while staying");
world.environment.timePhase = "evening";
ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "stay Flamesday Evening -> Flowday Evening");
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "reach Flowday Morning while staying");
world.environment.timePhase = "morning";
ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "stay Flowday Morning -> Woodsday Morning");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "reach Flowday Evening while staying");
world.environment.timePhase = "evening";
ok(setup.CharacterAPI.perform("roadMerchant", { type: "defer_departure" }), "stay Flowday Evening -> Woodsday Evening");
const throughWoodsday = ok(setup.WeeklyRhythm.advanceDayBoundary(world, { random: function () { return 0; } }), "cross Woodsday Morning arrival opportunity while still present");
assert(setup.Presence.stateAllowsPresence(staying) && staying.awayState.plannedDeparture.dayNumber === 3 && staying.awayState.plannedDeparture.phase === "Evening", "continuous stay should preserve the actively deferred departure rather than reset it on Woodsday");
assert(!throughWoodsday.transitions.some(function (entry) { return entry.type === "arrival" && entry.characterId === "roadMerchant"; }), "already-present Woodsday must not generate a fake arrival transition");
assert(JSON.stringify(world.inventories.inventory_merchantSaleChest.itemIds) === JSON.stringify(stayingInitialStock), "already-present Woodsday must not restock or replace sale stock");

ok(setup.Game.validateWorld(), "weekly merchant mechanics should preserve world invariants");
console.log("All weekly rhythm, merchant, bulk-transfer, and paper tests passed.");
