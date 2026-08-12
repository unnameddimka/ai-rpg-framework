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
load("src/10-game-api.js");

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
legacy.entities.hoodedWoman.mind.pendingObservations = [{ id: 777, kind: "event", text: "Transient observation" }];
legacy.ai.continuations.hoodedWoman = "Wait for the Traveler to show me where the promised cottage stands.";
legacy.entities.hoodedWoman.wallet = 19;
legacy.control.assignments.hoodedWoman = "human";
legacy.control.assignments.player = "ai";
legacy.ai.turnQueue = [{ characterId: "innkeeper", reason: "old transient queue" }];
legacy.events = [{ id: 99, type: "old_event", recipients: [], pendingFor: [], processedBy: [] }];

// Price should retain only runtime memory, never receive new local authored Mara facts.
legacy.entities.captainPrice.mind.knownFacts = [{ id: "runtime_wrong_partition", text: "This should be replaced by authored baseline." }];
legacy.entities.captainPrice.mind.recentMemories = [{ id: "price_memory", summary: "I met a hooded woman called Mara in the tavern.", importance: 0.5, protected: false }];

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
const world = State.variables.world;
assert(world.schemaVersion === setup.Game.WORLD_SCHEMA_VERSION && world.authoringRevision === setup.GeneratedWorldData.authoringRevision,
    "migration should commit the current schema and authoring revision");
assert(world.entities.villageEdge && world.entities.secludedCottage && world.entities.street.exits.villageEdge === "villageEdge",
    "fresh authored village edge and Mara cottage should appear in the migrated playthrough");
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
assert(!world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "old_mara_fact"; }) &&
    world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "mara_home"; }) &&
    world.entities.hoodedWoman.mind.knownFacts.some(function (fact) { return fact.id === "mara_open_secret"; }),
    "knownFacts should come from current authoring rather than the saved authored baseline");
assert(world.ai.continuations.hoodedWoman === legacy.ai.continuations.hoodedWoman,
    "Mara's model-authored continuation should survive migration unchanged");
assert(world.entities.hoodedWoman.wallet === 19 && world.control.assignments.hoodedWoman === "human" && world.control.assignments.player === "ai",
    "valid saved wallet and HumanController assignment should survive");
assert(world.entities.hoodedWoman.mind.pendingObservations.length === 0 && world.ai.turnQueue.length === 0 && world.events.length === 0,
    "transient observations, scheduler queue, and event execution journal should be discarded");
assert(world.entities.captainPrice.mind.knownFacts.some(function (fact) { return fact.id === "price_lodging"; }) &&
    world.entities.captainPrice.mind.recentMemories.some(function (memory) { return memory.id === "price_memory"; }),
    "Price should receive the current authored lodging fact while keeping what he actually remembered");
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
