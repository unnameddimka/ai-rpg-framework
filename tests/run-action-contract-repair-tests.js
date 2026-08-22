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
function moveItem(world, itemId, targetInventoryId) {
    const item = world.entities[itemId];
    assert(item && item.type === "item", `item ${itemId} must exist`);
    Object.values(world.inventories).forEach(function (inventory) {
        if (!inventory || !Array.isArray(inventory.itemIds)) return;
        inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== itemId; });
    });
    const target = world.inventories[targetInventoryId];
    assert(target, `target inventory ${targetInventoryId} must exist`);
    if (!target.itemIds.includes(itemId)) target.itemIds.push(itemId);
    item.inventoryId = targetInventoryId;
    delete item.equippedByCharacterId;
    delete item.equippedSlot;
}
function addItem(world, itemId, definitionId, inventoryId) {
    world.entities[itemId] = { id: itemId, type: "item", definitionId: definitionId, inventoryId: inventoryId };
    world.inventories[inventoryId].itemIds.push(itemId);
}
function hasRelevant(actorId, type) {
    const mechanics = setup.CharacterAPI.getRelevantMechanics(actorId);
    return Boolean(mechanics && mechanics[type]);
}
function hasAvailable(actorId, type) {
    const view = setup.CharacterAPI.getView(actorId);
    return Boolean(view && view.available_actions && view.available_actions[type]);
}

[
    "src/00-model-list.js", "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js",
    "src/09-passage-rules.js", "src/09-world-derived-state.js", "src/10-game-api.js", "src/10-weekly-rhythm.js",
    "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js", "src/13-verbatim-memory.js",
    "src/14-event-perception.js", "src/17-runtime-diagnostics.js", "src/21-ai-settings.js", "src/21-ai-request-profiles.js",
    "src/22-openrouter-client.js", "src/23-ai-protocol.js", "src/23-structured-ai-request.js", "src/24-ai-request-executor.js"
].forEach(load);

function main() {
    let world = fresh();

    // fill: source present is the relevance anchor; vessel is a strict prerequisite.
    assert(world.entities.innkeeper.sublocationId === "barBehindCounter", "Garrick fixture must start behind the bar");
    assert(hasRelevant("innkeeper", "fill"), "ale source present should make fill relevant without a mug");
    assert(!hasAvailable("innkeeper", "fill"), "fill must remain unavailable until Garrick has a compatible mug");
    moveItem(world, "emptyMug_1", "inventory_innkeeper");
    assert(hasRelevant("innkeeper", "fill") && hasAvailable("innkeeper", "fill"), "ale source + held mug should make fill relevant and available");
    world.entities.innkeeper.locationId = "commonRoom";
    world.entities.innkeeper.sublocationId = "commonRoomFloor";
    assert(!hasRelevant("innkeeper", "fill") && !hasAvailable("innkeeper", "fill"), "mug without ale source must not expose fill as relevant");

    // write: paper is the relevance anchor; writing set is a strict prerequisite.
    world = fresh();
    addItem(world, "guidanceTestPaper", "paperSheet", "inventory_player");
    assert(hasRelevant("player", "write_paper"), "paper present should make write_paper relevant without writing set");
    assert(!hasAvailable("player", "write_paper"), "write_paper must remain unavailable without writing set");
    addItem(world, "guidanceTestWritingSet", "writingSet", "inventory_player");
    assert(hasRelevant("player", "write_paper") && hasAvailable("player", "write_paper"), "paper + writing set should make write_paper relevant and available");
    moveItem(world, "guidanceTestPaper", "inventory_barMugCabinet");
    assert(!hasRelevant("player", "write_paper") && !hasAvailable("player", "write_paper"), "writing set without grounded paper must not expose write_paper");

    // unlock: locked passage is the relevance anchor; key is strict prerequisite.
    world = fresh();
    let moved = setup.CharacterAPI.perform("player", { type: "move", destination_id: "commonRoom" });
    assert(moved.ok, "player should enter common room for unlock relevance fixture");
    moved = setup.CharacterAPI.perform("player", { type: "move", destination_id: "upstairsCorridor" });
    assert(moved.ok, "player should reach upstairs corridor for unlock relevance fixture");
    assert(hasRelevant("player", "unlock"), "locked guest-room passage should make unlock relevant without a key");
    assert(!hasAvailable("player", "unlock"), "unlock must remain unavailable without matching key");
    moveItem(world, "guestRoom1Key", "inventory_player");
    assert(hasRelevant("player", "unlock") && hasAvailable("player", "unlock"), "locked passage + matching key should make unlock relevant and available");

    // Item-specific mechanics must not leak globally when the item is absent/ungrounded.
    world = fresh();
    const relevantAtStart = setup.CharacterAPI.getRelevantMechanics("player");
    assert(!relevantAtStart.use_item || !(relevantAtStart.use_item.itemSpecific || []).some(function (entry) { return entry.itemName === "Memory Stone"; }),
        "Memory Stone item-specific mechanic must not leak when the stone is not grounded for the player");

    // Decision prompt teaches relevant-vs-available semantics and the stronger narrative contract.
    world = fresh();
    const context = setup.ContextBuilder.build("innkeeper", { pendingObservations: [] });
    assert(context.relevantMechanics && context.relevantMechanics.fill, "Character context must contain relevant mechanics");
    const decisionMessages = setup.AIProtocol.decisionMessages(context);
    const systemPrompt = decisionMessages[0].content;
    assert(systemPrompt.includes("RELEVANT ENGINE MECHANICS") && systemPrompt.includes("AVAILABLE ACTIONS RIGHT NOW"),
        "decision prompt must distinguish relevant mechanics from executable-now actions");
    assert(systemPrompt.includes("Never narrate a completed tracked state change merely because its formal action is currently unavailable"),
        "decision prompt must forbid narrative completion of unavailable tracked mechanics");
    assert(!systemPrompt.includes("If the engine provides no grounded mechanic at all"), "old narrative-execution loophole must stay removed");

    // 0.1.2b intentionally has no detector/Utility repair request profile.
    assert(!setup.AIRequestProfiles.names().includes("action-contract-repair"),
        "0.1.2b must not expose an action-contract Utility repair request profile");

    console.log("Action-contract relevant-mechanics guidance tests passed.");
}

main();
