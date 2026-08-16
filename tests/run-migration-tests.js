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
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function removeFromAllInventories(world, itemId) {
    Object.values(world.inventories).forEach(function (inventory) {
        inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== itemId; });
    });
}
function place(world, itemId, inventoryId) {
    removeFromAllInventories(world, itemId);
    world.entities[itemId].containerId = inventoryId;
    world.inventories[inventoryId].itemIds.push(itemId);
}

load("src/generated/world-data.js");
load("src/08-mind-validators.js");
load("src/10-game-api.js");
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js");
load("src/14-event-perception.js");

assert(typeof setup.GeneratedWorldData.authoringRevision === "string" && setup.GeneratedWorldData.authoringRevision.length === 64,
    "generated world data should carry a deterministic authoring revision");

const current = setup.Game.createInitialWorld();
assert(current.schemaVersion === setup.Game.WORLD_SCHEMA_VERSION && !Object.prototype.hasOwnProperty.call(current, "version"),
    "fresh worlds should use the new schemaVersion field rather than the legacy version field");
assert(current.authoringRevision === setup.GeneratedWorldData.authoringRevision,
    "fresh worlds should record the current authored-world revision");

const legacy = clone(current);
delete legacy.schemaVersion;
delete legacy.authoringRevision;
legacy.version = 6;
delete legacy.entities.hoodedWoman.mindMaintenanceState;

// Simulate a pre-cottage authored world. Migration must rebuild structure from current authoring.
delete legacy.entities.villageEdge;
delete legacy.entities.villageEdgePath;
delete legacy.inventories.inventory_villageEdge;
delete legacy.entities.secludedCottage;
for (const id of ["maraCottageGarden", "maraCottageFloor", "maraCottageBed", "maraCottageTable", "maraCottageShelves"]) {
    delete legacy.entities[id];
}
delete legacy.inventories.inventory_secludedCottage;
delete legacy.inventories.inventory_maraCottageTable;
delete legacy.inventories.inventory_maraCottageShelves;
if (legacy.entities.street && legacy.entities.street.exits) delete legacy.entities.street.exits.villageEdge;

// Simulate a save created before the Memory Stone authored instance existed at all.
removeFromAllInventories(legacy, "memoryStone_01");
delete legacy.entities.memoryStone_01;

// Saved lives: authored knownFacts are stale, but memories/beliefs/relationships/continuation are valuable.
legacy.entities.hoodedWoman.mind.knownFacts = [{ id: "old_mara_fact", text: "Old authored fact that must not survive." }];
legacy.entities.hoodedWoman.mind.beliefs = [{ id: "traveler_keeps_word", text: "Traveler seems likely to keep promises.", confidence: "medium" }];
legacy.entities.hoodedWoman.mind.relationships = [{ targetCharacterId: "player", summary: "I cautiously trust the Traveler after our conversation." }];
legacy.entities.hoodedWoman.mind.recentMemories = [{ id: "memory_ai_41", summary: "Traveler offered me a secluded cottage and left to build it.", importance: 0.9, protected: false }];
legacy.entities.hoodedWoman.mind.longTermMemories = [{ id: "mara_old_memory", summary: "I have long made remedies for villagers who prefer discretion.", importance: 0.7, protected: true }];
legacy.entities.hoodedWoman.mind.abstractStudyProgress = {
    arcaneKnowledgeSlab_01: { lastInput: "magical energy in alchemy", depth: 2 }
};
legacy.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId = {
    captainPrice: { lastInput: "battlefield wards", depth: 1 }
};
legacy.entities.hoodedWoman.mind.pendingObservations = [{ id: 777, kind: "external_story", text: "A thin dark slab now rests on your work table.", data: { itemId: "arcaneKnowledgeSlab_01" } }];
legacy.ai.continuations.hoodedWoman = "Wait for the Traveler to show me where the promised cottage stands.";
legacy.entities.hoodedWoman.wallet = 19;
legacy.control.assignments.hoodedWoman = "human";
legacy.control.assignments.player = "ai";
legacy.ai.turnQueue = [{ characterId: "innkeeper", reason: "old transient queue" }];
legacy.events = [{ id: 99, type: "old_event", actorId: "player", recipients: ["hoodedWoman"], pendingFor: ["hoodedWoman"], processedBy: [] }];
legacy.nextEventId = 100;
legacy.nextObservationId = 778;

// Dynamic passage lock state is runtime state and must survive fresh-world migration.
legacy.entities.upstairsCorridor.exits.guestRoom2.locked = false;
legacy.entities.guestRoom2.exits.upstairsCorridor.locked = false;

// Price should retain only runtime memory, never receive new local authored Mara facts.
legacy.entities.captainPrice.mind.knownFacts = [{ id: "runtime_wrong_partition", text: "This should be replaced by authored baseline." }];
legacy.entities.captainPrice.mind.recentMemories = [{ id: "price_memory", summary: "I met a hooded woman called Mara in the tavern.", importance: 0.5, protected: false }];
legacy.entities.captainPrice.aiDescription = "Old save says Price is permanently sitting and drinking ale.";
legacy.entities.captainPrice.playerDescription = "Old save says Price is holding a mug at the table.";
legacy.entities.player.aiDescription = "Old save says the Traveler has just arrived at the tavern.";

// Saved runtime item placement and transformed state must win over fresh authored placement.
place(legacy, "guestRoom1Key", "inventory_hoodedWoman");
legacy.entities.emptyMug_1.definitionId = "mugOfAle";
legacy.entities.emptyMug_1.name = "Mug of ale";
place(legacy, "emptyMug_1", "inventory_player");
legacy.entities.runtimeMug_99 = {
    id: "runtimeMug_99", type: "item", definitionId: "emptyMug", name: "Empty mug", containerId: "inventory_player"
};
legacy.inventories.inventory_player.itemIds.push("runtimeMug_99");
legacy.entities.obsoleteItem = {
    id: "obsoleteItem", type: "item", definitionId: "removedType", name: "Obsolete item", containerId: "inventory_player"
};
legacy.inventories.inventory_player.itemIds.push("obsoleteItem");
legacy.inventories.inventory_removedTable = {
    id: "inventory_removedTable", ownerId: "commonRoomTableOne", name: "Old table inventory", itemIds: ["fallbackMug"]
};
legacy.entities.fallbackMug = {
    id: "fallbackMug", type: "item", definitionId: "emptyMug", name: "Empty mug", containerId: "inventory_removedTable"
};

// Position and removed-character fallbacks.
legacy.entities.nell.sublocationId = "removedNellPosition";
legacy.entities.retiredNpc = {
    id: "retiredNpc", type: "character", name: "Removed NPC", locationId: "commonRoom", sublocationId: "commonRoomFloor",
    inventoryId: "inventory_retiredNpc", wallet: 0, defaultControllerId: "ai",
    mind: { knownFacts: [], beliefs: [], relationships: [], recentMemories: [], longTermMemories: [], pendingObservations: [] }
};
legacy.inventories.inventory_retiredNpc = { id: "inventory_retiredNpc", ownerId: "retiredNpc", name: "Removed NPC", itemIds: [] };
legacy.control.assignments.retiredNpc = "ai";

State.variables.world = legacy;
const beforeBootstrap = JSON.stringify(State.variables.world);
const bootstrap = setup.Game.bootstrap();
assert(bootstrap.ok && bootstrap.migrationRequired, "legacy world should be detected without being reset during bootstrap");
assert(JSON.stringify(State.variables.world) === beforeBootstrap, "migration detection must not mutate the restored save");

const migrated = setup.SaveMigration.migrate();
assert(migrated.ok && migrated.migrated, `legacy save should migrate: ${JSON.stringify(migrated)}`);
assert(State.variables.world.entities.hoodedWoman.mindMaintenanceState &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId === null,
    "a save predating reconciliation cursor state should initialize a clean per-character cursor");
const world = State.variables.world;
assert(world.schemaVersion === setup.Game.WORLD_SCHEMA_VERSION && world.authoringRevision === setup.GeneratedWorldData.authoringRevision,
    "migration should commit the current schema and authoring revision");
assert(world.entities.villageEdge && world.entities.secludedCottage && world.entities.street.exits.villageEdge === "villageEdge",
    "fresh authored village edge and Mara cottage should appear in the migrated playthrough");
assert(world.entities.arcaneKnowledgeSlab_01 && world.entities.arcaneKnowledgeSlab_01.definitionId === "arcaneKnowledgeSlab" &&
    world.entities.arcaneKnowledgeSlab_01.containerId === "inventory_maraCottageTable",
    "a newly authored arcane slab absent from the old save should appear on Mara's current authored work table");
assert(world.entities.memoryStone_01 && world.entities.memoryStone_01.definitionId === "memoryStone" &&
    world.entities.memoryStone_01.containerId === "inventory_villageTemple" &&
    world.inventories.inventory_villageTemple.itemIds.filter(function (id) { return id === "memoryStone_01"; }).length === 1,
    "a newly authored stable Memory Stone ID absent from the old save should remain in its fresh authored temple placement");
assert(world.entities.hoodedWoman.mind.recentMemories.some(function (memory) { return memory.id === "memory_ai_41"; }) &&
    world.entities.hoodedWoman.mind.longTermMemories.some(function (memory) { return memory.id === "mara_old_memory"; }),
    "Mara's saved recent and long-term memories should survive");
assert(world.entities.hoodedWoman.mind.beliefs.some(function (belief) { return belief.id === "traveler_keeps_word"; }) &&
    world.entities.hoodedWoman.mind.relationships.some(function (relationship) { return relationship.targetCharacterId === "player"; }),
    "Mara's saved beliefs and relationships should survive");
assert(!Object.prototype.hasOwnProperty.call(world.entities.hoodedWoman.mind, "abstractStudyProgress") &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman.lastInput === "magical energy in alchemy" &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman.depth === 2 &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.captainPrice &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.captainPrice.lastInput === "battlefield wards" &&
    migrated.report.abstractStudyProgressPreserved === 2 && migrated.report.abstractStudyProgressMigratedFromCharacter === 1,
    "legacy character-owned study progress should move onto the item while existing item-owned per-reader progress survives");
assert(!world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "old_mara_fact"; }) &&
    world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "mara_home"; }) &&
    world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "mara_open_secret"; }),
    "knownFacts should come from current authoring rather than the saved authored baseline");
assert(world.ai.continuations.hoodedWoman === legacy.ai.continuations.hoodedWoman,
    "Mara's model-authored continuation should survive migration unchanged");
assert(world.entities.hoodedWoman.wallet === 19 && world.control.assignments.hoodedWoman === "human" && world.control.assignments.player === "ai",
    "valid saved wallet and HumanController assignment should survive");
assert(world.entities.hoodedWoman.mind.pendingObservations.some(function (observation) {
        return observation.id === 777 && observation.kind === "external_story" && observation.data.itemId === "arcaneKnowledgeSlab_01";
    }) && world.events.some(function (event) { return event.id === 99; }),
    "compatible runtime observations and event journal state should survive fresh-world migration");
assert(!world.ai.turnQueue.some(function (entry) { return entry.characterId === "hoodedWoman"; }),
    "a restored pending observation must not enqueue a character currently controlled by HumanController");
assert(world.nextObservationId >= 778 && world.nextEventId >= 100,
    "migration should preserve/reconstruct runtime observation and event counters beyond injected IDs");
assert(world.entities.captainPrice.mind.knownFacts.some(function (fact) { return fact.id === "price_lodging"; }) &&
    world.entities.captainPrice.mind.recentMemories.some(function (memory) { return memory.id === "price_memory"; }),
    "Price should receive the current authored lodging fact while keeping what he actually remembered");
assert(world.entities.captainPrice.aiDescription.includes("Do not assume that you are currently drinking") &&
    !world.entities.captainPrice.playerDescription.includes("holding a mug") &&
    world.entities.player.aiDescription.includes("Do not assume a particular current location or activity"),
    "save migration should keep current authored character descriptions instead of restoring stale scene-specific descriptions from the save");
assert(world.entities.upstairsCorridor.exits.guestRoom2.locked === false &&
    world.entities.guestRoom2.exits.upstairsCorridor.locked === false &&
    migrated.report.passageLocksPreserved >= 1,
    "save migration should preserve compatible reciprocal runtime lock state instead of resetting to authored defaults");
assert(world.entities.guestRoom1Key.containerId === "inventory_hoodedWoman" &&
    world.inventories.inventory_hoodedWoman.itemIds.includes("guestRoom1Key"),
    "saved key placement should override its fresh authored starting placement");
assert(world.entities.emptyMug_1.definitionId === "mugOfAle" && world.entities.emptyMug_1.containerId === "inventory_player",
    "saved transformed mug state and placement should survive against current item definitions");
assert(world.entities.runtimeMug_99 && world.entities.runtimeMug_99.containerId === "inventory_player",
    "runtime-created valid item instances should survive");
assert(!world.entities.obsoleteItem,
    "saved item instances whose definitions disappeared should be removed");
assert(world.entities.fallbackMug && world.entities.fallbackMug.containerId === "inventory_commonRoomTableOne",
    "an item from a removed inventory should fall back to the surviving owner's current inventory");
assert(world.entities.nell.locationId === "commonRoom" && world.entities.nell.sublocationId === "commonRoomFloor",
    "a removed saved sublocation should fall back to the current location default");
assert(!world.entities.retiredNpc && !world.inventories.inventory_retiredNpc,
    "characters removed from current authoring should not be recreated from old saves");
assert(world.nextMemoryId >= 42,
    "memory ID counter should be reconstructed beyond preserved generated memory IDs");
assert(setup.Game.validateWorld().ok, "migrated candidate should pass normal world validation after commit");
assert(migrated.report.status === "success_with_warnings" && migrated.report.charactersRemoved === 1 &&
    migrated.report.itemInstancesRemoved >= 1 && migrated.report.itemInstancesRepositioned >= 1 &&
    migrated.report.characterPositionFallbacks >= 1,
    "migration report should expose recoverable fallbacks and removals");

// If the stable authored ID already exists in a compatible save, saved runtime placement wins.
const savedStoneWorld = clone(current);
savedStoneWorld.authoringRevision = "0000000000000000000000000000000000000000000000000000000000000000";
place(savedStoneWorld, "memoryStone_01", "inventory_player");
State.variables.world = savedStoneWorld;
const migratedExistingStone = setup.SaveMigration.migrate();
assert(migratedExistingStone.ok && migratedExistingStone.migrated,
    "an authored-revision change should reconcile a save that already contains the Memory Stone");
assert(State.variables.world.entities.memoryStone_01.containerId === "inventory_player" &&
    State.variables.world.inventories.inventory_player.itemIds.filter(function (id) { return id === "memoryStone_01"; }).length === 1 &&
    !State.variables.world.inventories.inventory_villageTemple.itemIds.includes("memoryStone_01"),
    "saved Memory Stone placement should replace the fresh authored starting placement without duplication");
const noSecondMigration = setup.SaveMigration.migrate();
assert(noSecondMigration.ok && !noSecondMigration.migrated &&
    Object.values(State.variables.world.entities).filter(function (entity) { return entity && entity.id === "memoryStone_01"; }).length === 1,
    "repeated migration checks must remain idempotent for the stable Memory Stone instance");

// The same externally patched observation must also become eligible when no authored migration is
// required (for example, editing a save produced by the current build and loading it again).
const currentRevisionInjectedWorld = clone(current);
currentRevisionInjectedWorld.entities.hoodedWoman.mind.pendingObservations = [{
    id: 4001,
    kind: "external_story",
    actorId: null,
    targetId: "hoodedWoman",
    text: "A thin dark slab now rests on your work table.",
    data: { itemId: "arcaneKnowledgeSlab_01" }
}];
currentRevisionInjectedWorld.ai.turnQueue = [];
currentRevisionInjectedWorld.nextObservationId = 4002;
State.variables.world = currentRevisionInjectedWorld;
const currentRevisionBootstrap = setup.Game.bootstrap();
assert(currentRevisionBootstrap.ok && !currentRevisionBootstrap.migrationRequired &&
    setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "hoodedWoman"; }),
    "bootstrap should restore missing AI queue eligibility from current-revision saved pending observations");
assert(State.variables.world.entities.hoodedWoman.mind.pendingObservations[0].id === 4001 &&
    State.variables.world.nextObservationId === 4002,
    "current-revision bootstrap should preserve externally injected observation content and counters unchanged");

// A well-formed externally patched runtime observation must survive authored revision migration and
// make an AI-controlled character eligible even when the save did not manually patch turnQueue.
const injectedObservationWorld = clone(current);
injectedObservationWorld.authoringRevision = "2222222222222222222222222222222222222222222222222222222222222222";
injectedObservationWorld.entities.hoodedWoman.mind.pendingObservations = [{
    id: 5001,
    kind: "external_story",
    actorId: null,
    targetId: "hoodedWoman",
    text: "A thin dark slab now rests on your work table.",
    data: { itemId: "arcaneKnowledgeSlab_01", locationId: "secludedCottage" }
}];
injectedObservationWorld.ai.turnQueue = [];
injectedObservationWorld.nextObservationId = 5002;
State.variables.world = injectedObservationWorld;
const migratedInjectedObservation = setup.SaveMigration.migrate();
assert(migratedInjectedObservation.ok && migratedInjectedObservation.migrated,
    "externally patched runtime observation save should migrate normally");
assert(State.variables.world.entities.hoodedWoman.mind.pendingObservations.some(function (observation) {
        return observation.id === 5001 && observation.kind === "external_story";
    }) && setup.AITurnQueue.getStatus().entries.some(function (entry) { return entry.characterId === "hoodedWoman"; }),
    "surviving injected observation should make the AI-controlled recipient normally scheduler-eligible");
assert(State.variables.world.nextObservationId >= 5002,
    "observation counter should remain beyond an externally injected observation ID");

// Saved locked state must also override a newer authored unlocked default for the same stable lock.
const authoredGuestRoom3Hall = setup.GeneratedWorldData.locations.upstairsCorridor.exits.guestRoom3;
const authoredGuestRoom3Room = setup.GeneratedWorldData.locations.guestRoom3.exits.upstairsCorridor;
const originalGuestRoom3HallLocked = authoredGuestRoom3Hall.locked;
const originalGuestRoom3RoomLocked = authoredGuestRoom3Room.locked;
authoredGuestRoom3Hall.locked = false;
authoredGuestRoom3Room.locked = false;
try {
    const savedLockedWorld = clone(current);
    savedLockedWorld.authoringRevision = "1111111111111111111111111111111111111111111111111111111111111111";
    savedLockedWorld.entities.upstairsCorridor.exits.guestRoom3.locked = true;
    savedLockedWorld.entities.guestRoom3.exits.upstairsCorridor.locked = true;
    State.variables.world = savedLockedWorld;
    const migratedLocked = setup.SaveMigration.migrate();
    assert(migratedLocked.ok && migratedLocked.migrated &&
        State.variables.world.entities.upstairsCorridor.exits.guestRoom3.locked === true &&
        State.variables.world.entities.guestRoom3.exits.upstairsCorridor.locked === true,
        "saved locked state should override a fresh authored unlocked default for the same stable lock");
} finally {
    authoredGuestRoom3Hall.locked = originalGuestRoom3HallLocked;
    authoredGuestRoom3Room.locked = originalGuestRoom3RoomLocked;
}

// Stable sublocation identity must survive authored reparenting without moving unrelated cottage occupants.
const reparentedSublocationWorld = clone(current);
reparentedSublocationWorld.authoringRevision = "3333333333333333333333333333333333333333333333333333333333333333";
reparentedSublocationWorld.entities.player.locationId = "secludedCottage";
reparentedSublocationWorld.entities.player.sublocationId = "maraCottageBed";
reparentedSublocationWorld.entities.hoodedWoman.locationId = "secludedCottage";
reparentedSublocationWorld.entities.hoodedWoman.sublocationId = "maraCottageGarden";
State.variables.world = reparentedSublocationWorld;
const migratedReparented = setup.SaveMigration.migrate();
assert(migratedReparented.ok && migratedReparented.migrated,
    "a save spanning the Mara garden reparenting should migrate normally");
assert(State.variables.world.entities.player.locationId === "secludedCottage" &&
    State.variables.world.entities.player.sublocationId === "maraCottageBed",
    "a character saved on Mara's bed must remain on the same stable interior sublocation");
assert(State.variables.world.entities.hoodedWoman.locationId === "maraCottageGardenLocation" &&
    State.variables.world.entities.hoodedWoman.sublocationId === "maraCottageGarden",
    "a character saved in the stable garden sublocation should follow that sublocation to its new authored parent location");

// Saved equipment placement must override fresh authored starting equipment.
const movedEquipmentWorld = clone(current);
movedEquipmentWorld.authoringRevision = "4444444444444444444444444444444444444444444444444444444444444444";
movedEquipmentWorld.entities.hoodedWoman.equippedItems = movedEquipmentWorld.entities.hoodedWoman.equippedItems.filter(function (record) {
    return record.itemId !== "maraHoodedCloak_01";
});
removeFromAllInventories(movedEquipmentWorld, "maraHoodedCloak_01");
movedEquipmentWorld.entities.maraHoodedCloak_01.containerId = "inventory_player";
movedEquipmentWorld.inventories.inventory_player.itemIds.push("maraHoodedCloak_01");
State.variables.world = movedEquipmentWorld;
const migratedMovedEquipment = setup.SaveMigration.migrate();
assert(migratedMovedEquipment.ok && migratedMovedEquipment.migrated &&
    State.variables.world.entities.maraHoodedCloak_01.containerId === "inventory_player" &&
    State.variables.world.inventories.inventory_player.itemIds.includes("maraHoodedCloak_01") &&
    !State.variables.world.entities.hoodedWoman.equippedItems.some(function (record) { return record.itemId === "maraHoodedCloak_01"; }),
    "saved runtime placement should win over the cloak's authored starting equipment");

// Invalid saved equipment should recover into the owner's inventory rather than disappearing or breaking migration.
const invalidEquipmentWorld = clone(current);
invalidEquipmentWorld.authoringRevision = "5555555555555555555555555555555555555555555555555555555555555555";
const invalidCloakRecord = invalidEquipmentWorld.entities.hoodedWoman.equippedItems.find(function (record) {
    return record.itemId === "maraHoodedCloak_01";
});
invalidCloakRecord.slot = "back";
invalidEquipmentWorld.entities.maraHoodedCloak_01.containerId = "hoodedWoman";
State.variables.world = invalidEquipmentWorld;
const migratedInvalidEquipment = setup.SaveMigration.migrate();
assert(migratedInvalidEquipment.ok && migratedInvalidEquipment.migrated &&
    State.variables.world.entities.maraHoodedCloak_01.containerId === "inventory_hoodedWoman" &&
    State.variables.world.inventories.inventory_hoodedWoman.itemIds.includes("maraHoodedCloak_01") &&
    !State.variables.world.entities.hoodedWoman.equippedItems.some(function (record) { return record.itemId === "maraHoodedCloak_01"; }) &&
    migratedInvalidEquipment.report.warnings.some(function (warning) { return warning.includes("maraHoodedCloak_01") && warning.includes("moved to inventory_hoodedWoman"); }),
    "invalid saved equipment should fall back to the owner's inventory with a migration warning");

// Saves from the schema immediately before equipment should gain newly authored clothing rather than erasing it.
const preEquipmentWorld = clone(current);
preEquipmentWorld.schemaVersion = 8;
preEquipmentWorld.authoringRevision = "6666666666666666666666666666666666666666666666666666666666666666";
const newEquipmentItemIds = [
    "travelerClothing_01", "maraClothing_01", "maraHoodedCloak_01", "garrickClothing_01",
    "priceTacticalClothing_01", "priceBoonieHat_01", "nellClothing_01", "silverChain_01"
];
newEquipmentItemIds.forEach(function (itemId) {
    removeFromAllInventories(preEquipmentWorld, itemId);
    Object.values(preEquipmentWorld.entities).filter(function (entity) { return entity && entity.type === "character"; }).forEach(function (character) {
        character.equippedItems = (character.equippedItems || []).filter(function (record) { return record.itemId !== itemId; });
    });
    delete preEquipmentWorld.entities[itemId];
});
Object.values(preEquipmentWorld.entities).filter(function (entity) { return entity && entity.type === "character"; }).forEach(function (character) {
    delete character.equippedItems;
});
State.variables.world = preEquipmentWorld;
const migratedPreEquipment = setup.SaveMigration.migrate();
assert(migratedPreEquipment.ok && migratedPreEquipment.migrated &&
    State.variables.world.entities.player.equippedItems.some(function (record) { return record.itemId === "travelerClothing_01" && record.slot === "clothing"; }) &&
    State.variables.world.entities.hoodedWoman.equippedItems.some(function (record) { return record.itemId === "maraHoodedCloak_01" && record.slot === "shoulders"; }) &&
    State.variables.world.inventories.inventory_player.itemIds.includes("silverChain_01"),
    "pre-equipment saves should receive the current authored starting clothing and silver-chain item");

// An older save that predates a newly authored character should gain both that character and relationship seeds toward them
// without overwriting saved relationships among characters that already existed.
const preBlacksmithWorld = clone(current);
preBlacksmithWorld.authoringRevision = "7777777777777777777777777777777777777777777777777777777777777777";
delete preBlacksmithWorld.entities.blacksmith;
delete preBlacksmithWorld.inventories.inventory_blacksmith;
delete preBlacksmithWorld.control.assignments.blacksmith;
["blacksmithClothing_01", "smithHammer_01"].forEach(function (itemId) {
    removeFromAllInventories(preBlacksmithWorld, itemId);
    delete preBlacksmithWorld.entities[itemId];
});
["innkeeper", "nell", "hoodedWoman"].forEach(function (characterId) {
    const character = preBlacksmithWorld.entities[characterId];
    character.mind.relationships = character.mind.relationships.filter(function (record) { return record.targetCharacterId !== "blacksmith"; });
});
preBlacksmithWorld.entities.innkeeper.mind.relationships.find(function (record) { return record.targetCharacterId === "nell"; }).summary = "Saved Garrick/Nell relationship sentinel.";
State.variables.world = preBlacksmithWorld;
const migratedPreBlacksmith = setup.SaveMigration.migrate();
assert(migratedPreBlacksmith.ok && migratedPreBlacksmith.migrated && State.variables.world.entities.blacksmith &&
    State.variables.world.entities.blacksmith.locationId === "villageSmithy" &&
    State.variables.world.entities.blacksmith.equippedItems.some(function (record) { return record.itemId === "smithHammer_01" && record.slot === "right_hand"; }),
    "a save predating Harlan should gain the current authored blacksmith and his starting equipment");
["innkeeper", "nell", "hoodedWoman"].forEach(function (characterId) {
    assert(State.variables.world.entities[characterId].mind.relationships.some(function (record) { return record.targetCharacterId === "blacksmith"; }),
        `${characterId} should gain the authored relationship seed toward a genuinely new character during migration`);
});
assert(State.variables.world.entities.innkeeper.mind.relationships.some(function (record) {
        return record.targetCharacterId === "nell" && record.summary === "Saved Garrick/Nell relationship sentinel.";
    }),
    "migration must still prefer saved runtime relationships between characters that already existed in the old save");

// Full pre-maintenance rollback snapshots are persistent world-local state and survive ordinary migration.
const snapshotMigrationWorld = clone(current);
snapshotMigrationWorld.authoringRevision = "8888888888888888888888888888888888888888888888888888888888888888";
snapshotMigrationWorld.entities.hoodedWoman.mindMaintenanceState = { reconciliationCursor: { afterBeliefId: "traveler_keeps_word" } };
snapshotMigrationWorld.entities.hoodedWoman.mindMaintenanceSnapshots = [{
    createdAt: "2026-08-15T18:00:00.000Z",
    turn: 123,
    trigger: "manual",
    mind: clone(snapshotMigrationWorld.entities.hoodedWoman.mind)
}];
snapshotMigrationWorld.entities.hoodedWoman.mind.maintenanceArchive = {
    memories: [{ archivedAt: "2026-08-15T18:01:00.000Z", sourcePartition: "longTermMemories", record: { id: "memory_ai_777", summary: "Archived migration sentinel.", importance: 0.5, protected: false } }],
    beliefs: [{ archivedAt: "2026-08-15T18:02:00.000Z", record: { id: "archived_migration_belief", text: "Old migrated understanding.", confidence: "low" } }]
};
snapshotMigrationWorld.nextMemoryId = 10;
State.variables.world = snapshotMigrationWorld;
const migratedSnapshotWorld = setup.SaveMigration.migrate();
assert(migratedSnapshotWorld.ok && migratedSnapshotWorld.migrated &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots.length === 1 &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots[0].turn === 123 &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots[0].trigger === "manual" &&
    State.variables.world.entities.hoodedWoman.mind.maintenanceArchive.memories[0].record.id === "memory_ai_777" &&
    State.variables.world.entities.hoodedWoman.mind.maintenanceArchive.beliefs[0].record.id === "archived_migration_belief" &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceState.reconciliationCursor.afterBeliefId === "traveler_keeps_word" &&
    State.variables.world.nextMemoryId >= 778,
    "maintenance snapshots/archive/cursor should survive compatible save migration and archived IDs must advance nextMemoryId");

// Migration must be transactional: corrupt persistent memory cannot partially replace the active restored save.
const broken = clone(current);
delete broken.schemaVersion;
delete broken.authoringRevision;
broken.version = 6;
broken.entities.hoodedWoman.mind.recentMemories = null;
State.variables.world = broken;
const brokenSnapshot = JSON.stringify(broken);
const failed = setup.SaveMigration.migrate();
assert(!failed.ok && failed.error.code === "SAVE_MIGRATION_FAILED",
    "invalid persistent character memory should fail migration explicitly");
assert(JSON.stringify(State.variables.world) === brokenSnapshot,
    "failed migration must leave the original restored world byte-for-byte unchanged as JSON");

console.log("All save-migration tests passed.");
