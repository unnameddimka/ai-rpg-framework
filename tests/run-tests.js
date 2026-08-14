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
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js");
load("src/20-controllers.js");

assertOk(setup.Game.bootstrap(), "bootstrap should produce a valid world");
let world = setup.Game.getWorld();

assert(world.entities.player.name === "Traveler", "player display name should be Traveler without changing the player ID");
assert(world.entities.player.sublocationId === "tavernEntranceFloor", "player should start on entrance floor");
assert(world.entities.innkeeper.sublocationId === "barBehindCounter", "innkeeper should start behind bar");
assert(world.entities.hoodedWoman.sublocationId === "commonRoomTableOne", "hooded woman should start at table one");
assert(world.entities.captainPrice && world.entities.captainPrice.locationId === "commonRoom" &&
    world.entities.captainPrice.sublocationId === "commonRoomTableTwo" && world.control.assignments.captainPrice === "ai",
    "Captain Price should start AI-controlled at the second common-room table");
assert(world.entities.nell && world.entities.nell.locationId === "commonRoom" &&
    world.entities.nell.sublocationId === "commonRoomFloor" && world.control.assignments.nell === "ai",
    "Nell should start AI-controlled on the common-room floor");
assert(world.entities.villageEdge && world.entities.secludedCottage &&
    world.entities.street.exits.villageEdge === "villageEdge" &&
    world.entities.villageEdge.exits.street === "street" &&
    world.entities.villageEdge.exits.secludedCottage === "secludedCottage" &&
    world.entities.secludedCottage.exits.villageEdge === "villageEdge",
    "street, village edge, and Mara's cottage should form the authored bidirectional route");
assert(world.entities.maraCottageBed && world.entities.maraCottageTable && world.entities.maraCottageShelves &&
    world.inventories.inventory_maraCottageTable && world.inventories.inventory_maraCottageShelves,
    "Mara's cottage should contain authored bed, table, and alchemical shelf sublocations using existing inventory mechanics");
assert(world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "mara_home"; }) &&
    world.entities.innkeeper.mind.knownFacts.some(function (fact) { return fact.id === "mara_open_secret"; }) &&
    world.entities.nell.mind.knownFacts.some(function (fact) { return fact.id === "mara_open_secret"; }),
    "Mara, Garrick, and Nell should begin with authored local facts about Mara's home and social status");
assert(!world.entities.captainPrice.mind.knownFacts.some(function (fact) { return String(fact.id || "").startsWith("mara_"); }),
    "Captain Price should receive no authored local Mara knowledge");
const priceStartingItems = world.inventories.inventory_captainPrice.itemIds.map(function (id) { return world.entities[id]; });
assert(priceStartingItems.some(function (item) { return item.definitionId === "mugOfAle"; }) &&
    priceStartingItems.some(function (item) {
        const definition = world.itemDefinitions[item.definitionId];
        return definition && definition.keyLockId === "lock_guest_room_1";
    }),
    "Price should start with one concrete mug of ale and the key to Guest Room 1");
assert(["priceAle_2", "priceAle_3", "priceAle_4"].every(function (id) {
    return world.inventories.inventory_commonRoomTableTwo.itemIds.includes(id) && world.entities[id].definitionId === "mugOfAle";
}), "three concrete mugs of ale should start on Price's table");
assert(world.entities.underStairsNook && world.entities.underStairsNook.locationId === "commonRoom",
    "Nell's sleeping nook should be authored beneath the common-room stairs");
assert(world.entities.upstairsCorridor && ["innkeeperRoom", "guestRoom1", "guestRoom2", "guestRoom3", "guestRoom4"].every(function (id) {
    return world.entities[id] && world.entities[id].type === "location";
}), "the upstairs corridor and five rooms should exist as authored locations");

assert(world.itemDefinitions.arcaneKnowledgeSlab && world.entities.arcaneKnowledgeSlab_01 &&
    world.entities.arcaneKnowledgeSlab_01.definitionId === "arcaneKnowledgeSlab" &&
    world.entities.arcaneKnowledgeSlab_01.containerId === "inventory_maraCottageTable" &&
    world.inventories.inventory_maraCottageTable.itemIds.includes("arcaneKnowledgeSlab_01"),
    "one stable Slab of Full Arcane Knowledge should be authored on Mara's work table");
assert(world.itemDefinitions.arcaneKnowledgeSlab.useAction &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.effectId === "abstract_study" &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.actionLabel === "Consult slab" &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.inputLabel === "Question or topic" &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.feedbackText.includes("broad theoretical orientation") &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.focusedFeedbackText.includes("substantially clearer theoretical grasp") &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.saturatedFeedbackText.includes("diminishing returns") &&
    world.itemDefinitions.arcaneKnowledgeSlab.useAction.aiInstructions.includes("action.input_text") &&
    !Object.prototype.hasOwnProperty.call(world.itemDefinitions.arcaneKnowledgeSlab.useAction, "utilityPrompt") &&
    !Object.prototype.hasOwnProperty.call(world.itemDefinitions.arcaneKnowledgeSlab.useAction, "utilityMaxTokens") &&
    !Object.prototype.hasOwnProperty.call(world.entities.arcaneKnowledgeSlab_01, "migrationObservation"),
    "the slab should expose deterministic abstract study without model-generated lore or story-specific migration metadata");
perform("player", { type: "move", destination_id: "street" }, "arcane-slab fixture walks to the village street");
perform("player", { type: "move", destination_id: "villageEdge" }, "arcane-slab fixture walks to the village edge");
perform("player", { type: "move", destination_id: "secludedCottage" }, "arcane-slab fixture enters Mara's cottage garden");
perform("player", { type: "move_within_location", destination_id: "maraCottageFloor" }, "arcane-slab fixture steps inside Mara's cottage");
perform("player", { type: "move_within_location", destination_id: "maraCottageTable" }, "arcane-slab fixture sits at Mara's work table");
const slabTableView = setup.CharacterAPI.getView("player");
assert(slabTableView.accessible_inventories.some(function (inventory) {
    return inventory.id === "inventory_maraCottageTable" && inventory.items.some(function (item) {
        return item.id === "arcaneKnowledgeSlab_01" && item.description.includes("library too large");
    });
}), "the slab should be visible as a grounded item on Mara's accessible work table");
perform("player", { type: "take_item", item_id: "arcaneKnowledgeSlab_01" }, "arcane-slab fixture takes the slab");
const slabUseView = setup.CharacterAPI.getView("player").available_actions.use_item;
assert(slabUseView && slabUseView.options.items.some(function (item) {
    return item.id === "arcaneKnowledgeSlab_01" && item.action_label === "Consult slab" &&
        item.effect_id === "abstract_study" && item.instructions.includes("action.input_text") &&
        item.input_required === true && item.input_label === "Question or topic" && item.input_max_length === 600;
}), "owned slab should expose its authored query contract through canonical use_item options");
assert(!setup.CharacterAPI.validateActionRequest("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01" }).ok,
    "query-backed item use should be rejected by the canonical action contract when input_text is missing");
assert(setup.CharacterAPI.validateActionRequest("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01", input_text: "How are artificial worlds created?" }).ok,
    "query-backed item use should accept a bounded authored text query");
const slabUseResult = perform("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01", input_text: "How are artificial worlds created?" },
    "arcane-slab fixture submits a query through the ordinary item-use path");
assert(slabUseResult.events.length === 1 && slabUseResult.events[0].type === "item_used" &&
    slabUseResult.feedback.length === 1 && slabUseResult.modelRequests.length === 0 &&
    slabUseResult.feedback[0].code === "ITEM_ABSTRACT_STUDY_RESULT" &&
    slabUseResult.feedback[0].text.includes("How are artificial worlds created?") &&
    slabUseResult.feedback[0].text.includes("broad theoretical orientation") &&
    slabUseResult.feedback[0].data.studyStage === "survey" && slabUseResult.feedback[0].data.studyDepth === 1 &&
    !slabUseResult.feedback[0].text.includes("resonance") &&
    world.entities.arcaneKnowledgeSlab_01.definitionId === "arcaneKnowledgeSlab",
    "first consultation on a study thread should return deterministic survey feedback without invoking a model or transforming the item");
const slabFocusedResult = perform("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01", input_text: "magical methods used to create artificial worlds" },
    "arcane-slab fixture continues a related study thread");
assert(slabFocusedResult.feedback[0].data.studyStage === "focused" && slabFocusedResult.feedback[0].data.studyDepth === 2 &&
    slabFocusedResult.feedback[0].data.relatedToPrevious === true &&
    slabFocusedResult.feedback[0].text.includes("substantially clearer theoretical grasp"),
    "a related second consultation should advance the deterministic study thread to focused understanding");
const slabSaturatedResult = perform("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01", input_text: "practical exercises for creating artificial magical worlds" },
    "arcane-slab fixture pushes the related study thread to diminishing returns");
assert(slabSaturatedResult.feedback[0].data.studyStage === "saturated" && slabSaturatedResult.feedback[0].data.studyDepth === 3 &&
    slabSaturatedResult.feedback[0].text.includes("diminishing returns") && slabSaturatedResult.feedback[0].text.includes("practice"),
    "a third related consultation should report diminishing theoretical returns and point toward practice or a different question");
const slabNewThreadResult = perform("player", { type: "use_item", item_id: "arcaneKnowledgeSlab_01", input_text: "the history of enchanted forests" },
    "arcane-slab fixture switches to an unrelated study thread");
assert(slabNewThreadResult.feedback[0].data.studyStage === "survey" && slabNewThreadResult.feedback[0].data.studyDepth === 1 &&
    slabNewThreadResult.feedback[0].data.relatedToPrevious === false &&
    slabNewThreadResult.feedback[0].text.includes("broad theoretical orientation"),
    "a genuinely different question should reset abstract study to a new survey thread");
assert(setup.Game.getWorld().entities.player.mind.abstractStudyProgress.arcaneKnowledgeSlab_01.depth === 1,
    "abstract study depth should be stored as private runtime learning progress for this reader and source");

setup.Game.resetWorld();
world = setup.Game.getWorld();

assert(world.itemDefinitions.memoryStone && world.entities.memoryStone_01 &&
    world.entities.memoryStone_01.definitionId === "memoryStone" &&
    world.entities.memoryStone_01.containerId === "inventory_villageTemple" &&
    world.inventories.inventory_villageTemple.itemIds.includes("memoryStone_01"),
    "one stable authored Memory Stone instance should start in the Village temple beside the sphere");
assert(world.itemDefinitions.memoryStone.description && world.itemDefinitions.memoryStone.useAction &&
    world.itemDefinitions.memoryStone.useAction.effectId === "report_memory_counts" &&
    world.itemDefinitions.memoryStone.useAction.actionLabel === "Squeeze in hand",
    "Memory Stone authoring should use a grounded description and the generic memory-count effect");
assert(!setup.CharacterAPI.getView("player").available_actions.use_item,
    "Memory Stone use should not be available before the actor owns the stone");
perform("player", { type: "move", destination_id: "street" }, "memory-stone fixture walks to the village street");
perform("player", { type: "move", destination_id: "villageTemple" }, "memory-stone fixture enters the temple");
const templeViewBeforeStone = setup.CharacterAPI.getView("player");
assert(templeViewBeforeStone.accessible_inventories.some(function (inventory) {
    return inventory.id === "inventory_villageTemple" && inventory.items.some(function (item) {
        return item.id === "memoryStone_01" && item.description && item.description.includes("silvery threads");
    });
}), "the canonical view should expose the authored Memory Stone and its grounded description in the temple");
perform("player", { type: "take_item", item_id: "memoryStone_01" }, "player should take the Memory Stone");
let memoryStoneActions = setup.CharacterAPI.getView("player").available_actions.use_item;
assert(memoryStoneActions && memoryStoneActions.options.item_ids.includes("memoryStone_01") &&
    memoryStoneActions.options.items.some(function (item) {
        return item.id === "memoryStone_01" && item.action_label === "Squeeze in hand" && item.effect_id === "report_memory_counts";
    }), "an owned Memory Stone should grant the generic use_item action through the canonical view");
assertFails(setup.CharacterAPI.perform("innkeeper", { type: "use_item", item_id: "memoryStone_01" }),
    "ACTION_NOT_AVAILABLE", "a character who does not own the Memory Stone must not be able to use it");
world.entities.player.mind.recentMemories = [
    { id: "stone_recent_1", summary: "First recent memory.", importance: 0.4, protected: false },
    { id: "stone_recent_2", summary: "Second recent memory.", importance: 0.5, protected: false }
];
world.entities.player.mind.longTermMemories = [
    { id: "stone_long_1", summary: "One long-term memory.", importance: 0.8, protected: true }
];
perform("hoodedWoman", { type: "move", destination_id: "tavernEntrance" }, "Mara leaves the common room for the Memory Stone visibility fixture");
perform("hoodedWoman", { type: "move", destination_id: "street" }, "Mara walks to the village street for the Memory Stone visibility fixture");
perform("hoodedWoman", { type: "move", destination_id: "villageTemple" }, "Mara enters the temple for the Memory Stone visibility fixture");
const maraInboxBeforeStone = world.entities.hoodedWoman.mind.pendingObservations.length;
const playerPendingBeforeStone = world.entities.player.mind.pendingObservations.length;
const memoryReport = perform("player", { type: "use_item", item_id: "memoryStone_01" },
    "HumanController actor should squeeze the Memory Stone through the normal formal-action path");
assert(memoryReport.events.length === 1 && memoryReport.events[0].type === "item_used" &&
    memoryReport.events[0].text === "Traveler squeezes the memory stone in one hand." &&
    !memoryReport.events[0].text.includes("Short-term") && !memoryReport.events[0].text.includes("Long-term"),
    "Memory Stone use should publicly expose only the physical squeeze action");
assert(memoryReport.feedback.length === 1 && memoryReport.feedback[0].recipientId === "player" &&
    memoryReport.feedback[0].code === "MEMORY_COUNTS_REPORTED" &&
    memoryReport.feedback[0].text === "The stone grows faintly warm in your hand. Short-term memory: 2 entries. Long-term memory: 1 entry." &&
    !Object.prototype.hasOwnProperty.call(memoryReport.feedback[0].data, "shortTermCount") &&
    !Object.prototype.hasOwnProperty.call(memoryReport.feedback[0].data, "longTermCount"),
    "memory counts should be natural private prose without redundant debug-style count fields");
assert(world.entities.player.mind.recentMemories.length === 2 && world.entities.player.mind.longTermMemories.length === 1,
    "report_memory_counts must not mutate the actor's existing recent or long-term memories");
assert(world.entities.player.mind.pendingObservations.length === playerPendingBeforeStone + 1 &&
    world.entities.player.mind.pendingObservations.some(function (item) {
        return item.kind === "action_feedback" && item.code === "MEMORY_COUNTS_REPORTED" &&
            item.text.includes("Short-term memory: 2 entries") && item.text.includes("Long-term memory: 1 entry");
    }), "the Human-controlled actor should receive the same private grounded observation in its character inbox");
const maraStoneObservations = world.entities.hoodedWoman.mind.pendingObservations.slice(maraInboxBeforeStone);
assert(maraStoneObservations.some(function (item) {
    return item.kind === "event" && item.text === "Traveler squeezes the memory stone in one hand.";
}) && !maraStoneObservations.some(function (item) {
    return String(item.text || "").includes("Short-term memory") || String(item.text || "").includes("Long-term memory");
}), "a nearby bystander should perceive the physical squeeze but never receive the private memory counts");
perform("player", { type: "give_item", target_id: "hoodedWoman", item_id: "memoryStone_01" },
    "player should hand the Memory Stone to the AI-controlled Mara");
world.entities.hoodedWoman.mind.recentMemories = [
    { id: "mara_stone_recent", summary: "A recent memory.", importance: 0.5, protected: false }
];
world.entities.hoodedWoman.mind.longTermMemories = [
    { id: "mara_stone_long_1", summary: "Long memory one.", importance: 0.7, protected: false },
    { id: "mara_stone_long_2", summary: "Long memory two.", importance: 0.7, protected: false },
    { id: "mara_stone_long_3", summary: "Long memory three.", importance: 0.7, protected: false }
];
const maraMemoryReport = perform("hoodedWoman", { type: "use_item", item_id: "memoryStone_01" },
    "AIController actor should use the same Memory Stone action contract");
assert(maraMemoryReport.feedback[0].recipientId === "hoodedWoman" &&
    maraMemoryReport.feedback[0].text.includes("Short-term memory: 1 entry") &&
    maraMemoryReport.feedback[0].text.includes("Long-term memory: 3 entries"),
    "AIController should receive the same controller-agnostic private memory-count feedback");

setup.Game.resetWorld();
world = setup.Game.getWorld();

perform("player", { type: "move", destination_id: "commonRoom" }, "blocked-transition fixture enters common room");
perform("player", { type: "move", destination_id: "upstairsCorridor" }, "blocked-transition fixture climbs upstairs");
let upstairsView = setup.CharacterAPI.getView("player");
assert(upstairsView.available_actions.move.options.destination_ids.includes("guestRoom1") &&
    upstairsView.location.exits.some(function (exit) { return exit.id === "guestRoom1"; }),
    "blocked room transitions should remain visible and selectable through the canonical action contract");
const blockedEventCount = world.events.length;
const blockedMove = setup.CharacterAPI.perform("player", { type: "move", destination_id: "guestRoom1" });
assertFails(blockedMove, "TRANSITION_BLOCKED", "locked guest-room entry should resolve as an in-world movement failure");
assert(world.entities.player.locationId === "upstairsCorridor" && world.events.length === blockedEventCount &&
    !blockedMove.events.length, "blocked movement must not change location or emit character_moved");
perform("captainPrice", { type: "move", destination_id: "upstairsCorridor" }, "AI blocked-transition fixture climbs upstairs");
const priceUpstairsView = setup.CharacterAPI.getView("captainPrice");
assert(priceUpstairsView.available_actions.move.options.destination_ids.includes("guestRoom1"),
    "AIController should receive the same blocked destination as an available movement option");

const innkeeperKeyItems = world.inventories.inventory_innkeeper.itemIds.map(function (id) { return world.entities[id]; })
    .filter(function (item) { const definition = world.itemDefinitions[item.definitionId]; return definition && definition.keyLockId; });
assert(innkeeperKeyItems.length === 4 && innkeeperKeyItems.every(function (item) {
    const definition = world.itemDefinitions[item.definitionId];
    return definition.keyLockId !== "lock_guest_room_1" && !definition.consumeAction && !definition.fillAction;
}), "Garrick should start with four ordinary non-consumable room keys and no Guest Room 1 key");
assert(priceUpstairsView.available_actions.unlock &&
    priceUpstairsView.available_actions.unlock.options.destination_ids.includes("guestRoom1") &&
    !priceUpstairsView.available_actions.lock,
    "Price's matching key should directly grant unlock for his locked guest-room passage");
perform("captainPrice", { type: "unlock", destination_id: "guestRoom1" }, "Price unlocks Guest Room 1");
assert(world.entities.upstairsCorridor.exits.guestRoom1.locked === false &&
    world.entities.guestRoom1.exits.upstairsCorridor.locked === false,
    "unlock should synchronize only the two sides of the operated passage");
assert(world.entities.upstairsCorridor.exits.guestRoom2.locked === true,
    "unlocking one passage must not unlock another passage");
perform("captainPrice", { type: "move", destination_id: "guestRoom1" }, "Price enters his unlocked guest room");
let priceInsideView = setup.CharacterAPI.getView("captainPrice");
assert(priceInsideView.available_actions.lock &&
    priceInsideView.available_actions.lock.options.destination_ids.includes("upstairsCorridor"),
    "Price's matching key should grant lock from the room side");
perform("captainPrice", { type: "lock", destination_id: "upstairsCorridor" }, "Price locks his room from inside");
assertFails(setup.CharacterAPI.perform("captainPrice", { type: "move", destination_id: "upstairsCorridor" }),
    "TRANSITION_BLOCKED", "locked movement should still be a grounded in-world failure from inside the room");
perform("captainPrice", { type: "unlock", destination_id: "upstairsCorridor" }, "Price unlocks his room from inside");
perform("captainPrice", { type: "move", destination_id: "upstairsCorridor" }, "Price leaves after unlocking");
setup.Game.resetWorld();
world = setup.Game.getWorld();
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

const initialInnkeeperView = setup.CharacterAPI.getView("innkeeper");
const mugCabinet = initialInnkeeperView.accessible_inventories.find(function (inventory) {
    return inventory.id === "inventory_barMugCabinet";
});
assert(mugCabinet && mugCabinet.name === "Mug cabinet" && mugCabinet.items.length === 10,
    "innkeeper should start beside a cabinet containing ten empty mug instances");
assert(mugCabinet.items.every(function (item) {
    return item.definition_id === "emptyMug" && item.fillable && !item.consumable;
}), "cabinet contents should expose the empty-mug definition through the canonical view");
assert(!initialInnkeeperView.available_actions.fill,
    "fill should not be available until the innkeeper owns an empty mug");
assert(!initialInnkeeperView.available_actions.consume,
    "consume should not be available without a consumable owned item");

perform("player", { type: "move", destination_id: "bar" }, "player should enter bar");
assert(world.entities.player.locationId === "bar", "major move should change location");
assert(world.entities.player.sublocationId === "barPublicSide", "major move should assign default sublocation");
assertFails(setup.CharacterAPI.perform("player", { type: "take_item", item_id: "emptyMug_1" }),
    "ITEM_NOT_ACCESSIBLE", "public-side actor must not reach the mug cabinet");

perform("innkeeper", { type: "take_item", item_id: "emptyMug_1" },
    "innkeeper should take one concrete empty mug from the cabinet");
let innkeeperActions = setup.CharacterAPI.getAvailableActions("innkeeper");
assert(innkeeperActions.fill && innkeeperActions.fill.options.item_ids.includes("emptyMug_1"),
    "owned empty mug plus ale source should grant fill through the item definition");
const filledByInnkeeper = perform("innkeeper", { type: "fill", item_id: "emptyMug_1" },
    "innkeeper should fill the concrete empty mug");
assert(world.entities.emptyMug_1.definitionId === "mugOfAle" &&
    world.inventories.inventory_innkeeper.itemIds.includes("emptyMug_1"),
    "fill should transform the same item instance without moving or cloning it");
assert(filledByInnkeeper.events[0].fromDefinitionId === "emptyMug" &&
    filledByInnkeeper.events[0].toDefinitionId === "mugOfAle",
    "fill event should ground the item-definition transition");
perform("innkeeper", { type: "give_item", target_id: "player", item_id: "emptyMug_1" },
    "innkeeper should give the filled mug to the player");
let playerActions = setup.CharacterAPI.getAvailableActions("player");
assert(playerActions.consume && playerActions.consume.options.item_ids.includes("emptyMug_1"),
    "mug of ale should grant consume while it is owned");
const consumed = perform("player", { type: "consume", item_id: "emptyMug_1" },
    "player should drink the ale");
assert(world.entities.emptyMug_1.definitionId === "emptyMug" &&
    consumed.events[0].toDefinitionId === "emptyMug",
    "consume should turn the same mug instance back into an empty mug");
assertFails(setup.CharacterAPI.perform("player", { type: "fill", item_id: "emptyMug_1" }),
    "ACTION_NOT_AVAILABLE", "empty mug should not be fillable on the public side");

perform("player", { type: "move_within_location", destination_id: "barBehindCounter" },
    "player should step behind bar");
assert(world.entities.player.locationId === "bar", "internal move should preserve major location");
assert(world.entities.player.sublocationId === "barBehindCounter", "internal move should change sublocation");
const refill = perform("player", { type: "fill", item_id: "emptyMug_1" },
    "player should refill the same empty mug at the ale source");
const mugOne = "emptyMug_1";
assert(refill.events[0].itemId === mugOne && world.entities[mugOne].definitionId === "mugOfAle",
    "refill should preserve instance identity and select the filled definition");
perform("player", { type: "take_item", item_id: "emptyMug_2" },
    "player behind the bar should take a second empty mug from the cabinet");
perform("player", { type: "fill", item_id: "emptyMug_2" },
    "player should fill the second concrete mug");
const mugTwo = "emptyMug_2";
assert(mugOne !== mugTwo && world.entities[mugTwo].definitionId === "mugOfAle",
    "separate mug instances should remain distinct while sharing one definition");
assert(world.inventories.inventory_player.itemIds.includes(mugOne) &&
    world.inventories.inventory_player.itemIds.includes(mugTwo),
    "both filled mug instances should remain in player inventory");
assert(refill.events[0].recipients.includes("innkeeper"),
    "bar item transformation should reach the innkeeper across bar sublocations");
assert(!refill.events[0].recipients.includes("hoodedWoman"),
    "bar item transformation must not reach the common room");

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
assertFails(setup.CharacterAPI.perform("player", { type: "fill", item_id: mugOne }), "ACTION_NOT_AVAILABLE",
    "filled mug should not expose fill outside the bar and cannot be filled twice");

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
const profileEventCount = world.events.length;
const profileQueue = JSON.stringify(world.ai.turnQueue);
assertOk(setup.Game.updateCharacterProfile("player", {
    name: "Edited Traveler",
    playerDescription: "A traveler whose public description was edited in the in-game Character window."
}), "runtime character profile should be editable without a gameplay action");
assert(world.entities.player.name === "Edited Traveler" &&
    world.entities.player.playerDescription.includes("edited in the in-game Character window") &&
    setup.CharacterAPI.getView("player").self.playerDescription === world.entities.player.playerDescription &&
    world.events.length === profileEventCount && JSON.stringify(world.ai.turnQueue) === profileQueue,
    "runtime profile edits should update canonical public identity without events, observations, or scheduler work");
const serializedWorld = JSON.stringify(world);
State.variables.world = JSON.parse(serializedWorld);
assertOk(setup.Game.bootstrap(), "JSON save/load round trip should preserve a valid world");
world = setup.Game.getWorld();
assert(world.entities.player.sublocationId === "commonRoomTableOne",
    "save/load should preserve character sublocation");
assert(setup.Game.getHumanCharacterId() === "player", "save/load should preserve one human controller");
assert(world.entities.player.name === "Edited Traveler" && world.entities.player.playerDescription.includes("edited in the in-game Character window"),
    "save/load should preserve runtime Name and playerDescription edits");
const generatedBeforeSaveReconciliation = setup.GeneratedWorldData;
const savedForAuthoringReconciliation = JSON.parse(JSON.stringify(world));
savedForAuthoringReconciliation.entities.hoodedWoman.aiDescription = "Old saved Mara prompt.";
savedForAuthoringReconciliation.entities.hoodedWoman.mind.recentMemories.push({
    id: "memory_save_reconcile", summary: "A saved relationship-building moment.", importance: 0.8, protected: false
});
savedForAuthoringReconciliation.entities.hoodedWoman.mind.beliefs.push({
    id: "saved_belief", text: "The traveler is interesting.", confidence: "medium"
});
savedForAuthoringReconciliation.entities.hoodedWoman.mind.relationships.push({
    targetCharacterId: "player", summary: "A relationship preserved from the save."
});
const generatedWithEditedMara = JSON.parse(JSON.stringify(generatedBeforeSaveReconciliation));
generatedWithEditedMara.characters.hoodedWoman.aiDescription = "New editor-authored Mara prompt.";
generatedWithEditedMara.authoringRevision = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
setup.GeneratedWorldData = generatedWithEditedMara;
State.variables.world = savedForAuthoringReconciliation;
const reconcileBootstrap = setup.Game.bootstrap();
assert(reconcileBootstrap.ok && reconcileBootstrap.migrationRequired,
    "changed authored world should require transactional reconciliation rather than in-place prompt patching");
assertOk(setup.SaveMigration.migrate(), "changed authored world should migrate the compatible save");
world = setup.Game.getWorld();
assert(world.entities.hoodedWoman.aiDescription === "New editor-authored Mara prompt.",
    "current generated aiDescription should replace the saved authoring copy");
assert(world.entities.player.name === generatedWithEditedMara.characters.player.name &&
    world.entities.player.playerDescription === generatedWithEditedMara.characters.player.playerDescription,
    "authoring reconciliation should rebuild authored public profile fields from the current world");
assert(world.entities.hoodedWoman.mind.recentMemories.some(function (memory) { return memory.id === "memory_save_reconcile"; }) &&
    world.entities.hoodedWoman.mind.beliefs.some(function (belief) { return belief.id === "saved_belief"; }) &&
    world.entities.hoodedWoman.mind.relationships.some(function (relationship) { return relationship.summary === "A relationship preserved from the save."; }),
    "save reconciliation should preserve runtime memories, beliefs, and relationships");
setup.GeneratedWorldData = generatedBeforeSaveReconciliation;
const restoreAuthoringBootstrap = setup.Game.bootstrap();
assert(restoreAuthoringBootstrap.ok && restoreAuthoringBootstrap.migrationRequired,
    "restoring generated authoring data should be detected as another authoring revision change");
assertOk(setup.SaveMigration.migrate(), "restoring current authored data should migrate back cleanly");
world = setup.Game.getWorld();
world.control.assignments.innkeeper = "human";
assert(setup.Game.getHumanCharacterId() === "player", "invalid multi-human state should repair to player");
assertOk(setup.Game.validateWorld(), "world should validate after controller repair");

assert(world.entities.player.name === generatedBeforeSaveReconciliation.characters.player.name &&
    world.entities.player.playerDescription === generatedBeforeSaveReconciliation.characters.player.playerDescription,
    "authoring migration should restore current authored public profile fields while preserving durable character history");
assert(world.entities.player.mind && Array.isArray(world.entities.player.mind.pendingObservations),
    "runtime character should own a pending observation inbox");
const baseActions = setup.CharacterAPI.getAvailableActions("player");
assert(baseActions.move.sources.some(function (source) { return source.kind === "base"; }),
    "base action should identify its grant source");
assert(!baseActions.read_aura, "player should not receive read_aura");
assert(!baseActions.fill, "player outside an ale source should not receive fill");
assert(baseActions.consume && baseActions.consume.options.item_ids.includes(mugTwo),
    "owned mug of ale should still expose consume outside the bar");
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
const expectedAuraTargetIds = setup.CharacterAPI.getView("hoodedWoman").location.characters
    .map(function (character) { return character.id; }).sort();
const eventCountBeforeAura = world.events.length;
const positionsBeforeAura = [world.entities.player.locationId, world.entities.hoodedWoman.locationId, world.entities.innkeeper.locationId];
const aura = perform("hoodedWoman", { type: "read_aura" }, "hooded woman should scan all perceivable auras");
assert(aura.events.length === 0 && aura.feedback.length === 1 && aura.error === null,
    "read_aura should be a private feedback-only normalized success");
const auraResults = aura.feedback[0].data.results;
assert(aura.feedback[0].recipientId === "hoodedWoman" && aura.feedback[0].code === "AURA_SCAN_RESULT",
    "aura result should be structured private feedback addressed to the acting character");
assert(JSON.stringify(auraResults.map(function (item) { return item.characterId; }).sort()) === JSON.stringify(expectedAuraTargetIds) &&
    auraResults.some(function (item) { return item.characterId === "player"; }) &&
    auraResults.some(function (item) { return item.characterId === "innkeeper"; }) &&
    !auraResults.some(function (item) { return item.characterId === "hoodedWoman"; }),
    "scan targets should come from current perception, include all visible others, and exclude self");
assert(auraResults.find(function (item) { return item.characterId === "player"; }).aura === world.entities.player.engineFacts.aura,
    "aura scan should use the visible target's grounded hidden aura only");
assert(auraResults.find(function (item) { return item.characterId === "innkeeper"; }).aura === world.entities.innkeeper.engineFacts.aura,
    "aura scan should preserve the innkeeper's authored hidden aura");
assert(world.events.length === eventCountBeforeAura &&
    JSON.stringify(positionsBeforeAura) === JSON.stringify([world.entities.player.locationId, world.entities.hoodedWoman.locationId, world.entities.innkeeper.locationId]),
    "aura scan should not mutate physical state or create a public event");
assert(world.entities.hoodedWoman.mind.pendingObservations.some(function (item) {
    return item.kind === "action_feedback" && item.actionType === "read_aura" &&
        Array.isArray(item.data.results) && item.data.results.length === expectedAuraTargetIds.length;
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
perform("captainPrice", { type: "move", destination_id: "tavernEntrance" },
    "Price should leave for empty aura scan test");
perform("nell", { type: "move", destination_id: "tavernEntrance" },
    "Nell should leave for empty aura scan test");
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
assert(JSON.stringify(context.view) === JSON.stringify(restricted),
    "AI context must embed the exact canonical player-facing view unchanged");
assert(context.character.aiDescription === world.entities.hoodedWoman.aiDescription &&
    context.character.abilityInstructions.readAura === world.abilities.readAura.aiDescription &&
    !Object.prototype.hasOwnProperty.call(context.character, "id") &&
    !Object.prototype.hasOwnProperty.call(context.character, "name") &&
    !Object.prototype.hasOwnProperty.call(context.character, "abilities"),
    "AI context should add only private identity and ability instructions outside the canonical view");
assert(Array.isArray(context.pendingObservations) && context.pendingObservations.length === 0 &&
    !Object.prototype.hasOwnProperty.call(context.mind, "pendingObservations") &&
    !Object.prototype.hasOwnProperty.call(context, "availableActions"),
    "AI context should construct one prepared observation list and no duplicate action catalog");
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
for (const passage of ["The Tavern", "The Bar", "The Common Room", "The Street", "The Village Edge", "Mara's Cottage"]) {
    assert(storySource.includes(`:: ${passage}`), `${passage} physical passage should exist`);
}
assert(!storySource.includes("->The Tavern"), "normal story should not contain raw physical navigation links");
assert(!storySource.includes("setup.GameUI.moveHuman"), "physical passage source should not hard-code exits");
const storyDataSource = fs.readFileSync(path.join(root, "src/generated/world-storydata.twee"), "utf8");
assert(storyDataSource.includes('"start": "The Tavern"'), "generated StoryData should resolve startLocationId passage");

console.log("All framework tests passed.");
