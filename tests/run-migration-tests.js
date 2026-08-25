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
load("src/07-mind-v3.js"); load("src/08-mind-validators.js");
load("src/09-passage-rules.js"); load("src/09-world-derived-state.js"); load("src/10-game-api.js"); load("src/10-weekly-rhythm.js");
load("src/11-save-migration.js");
load("src/12-character-context.js");
load("src/13-character-memory.js"); load("src/13-verbatim-memory.js");
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

// Simulate a save created before keyed private chests and their key instances were authored.
for (const keyId of ["innkeeperChestKey", "blacksmithChestKey", "maraChestKey", "maraCottageKey"]) {
    removeFromAllInventories(legacy, keyId);
    delete legacy.entities[keyId];
}
for (const chestId of ["innkeeperRoomChest", "smithyLivingChest", "maraCottageChest"]) delete legacy.entities[chestId];
for (const inventoryId of ["inventory_innkeeperRoomChest", "inventory_smithyLivingChest", "inventory_maraCottageChest"]) delete legacy.inventories[inventoryId];
if (legacy.entities.innkeeperRoomFloor) legacy.entities.innkeeperRoomFloor.reachableSublocationIds = legacy.entities.innkeeperRoomFloor.reachableSublocationIds.filter(id=>id!=="innkeeperRoomChest");
if (legacy.entities.smithyLivingRoom) legacy.entities.smithyLivingRoom.reachableSublocationIds = legacy.entities.smithyLivingRoom.reachableSublocationIds.filter(id=>id!=="smithyLivingChest");

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
    blacksmith: { lastInput: "tempering farm tools", depth: 1 }
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

// A surviving authored NPC should retain runtime memory but receive current authored facts/descriptions.
legacy.entities.blacksmith.mind.knownFacts = [{ id: "runtime_wrong_partition", text: "This should be replaced by authored baseline." }];
legacy.entities.blacksmith.mind.recentMemories = [{ id: "harlan_memory", summary: "I sharpened a farmer's scythe before dusk.", importance: 0.5, protected: false }];
legacy.entities.blacksmith.aiDescription = "Old save says Harlan is permanently sitting in the tavern.";
legacy.entities.blacksmith.playerDescription = "Old save says Harlan is holding an ale mug at a table.";
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
    Object.keys(State.variables.world.entities.hoodedWoman.mindMaintenanceState).length === 0,
    "Mind v3 migration should discard the obsolete v2 contradiction-scan cursor state");
const world = State.variables.world;
assert(world.schemaVersion === setup.Game.WORLD_SCHEMA_VERSION && world.authoringRevision === setup.GeneratedWorldData.authoringRevision,
    "migration should commit the current schema and authoring revision");
assert(world.entities.villageEdge && world.entities.secludedCottage && world.entities.street.exits.villageEdge === "villageEdge",
    "fresh authored village edge and Mara cottage should appear in the migrated playthrough");
assert(world.entities.arcaneKnowledgeSlab_01 && world.entities.arcaneKnowledgeSlab_01.definitionId === "arcaneKnowledgeSlab" &&
    world.entities.arcaneKnowledgeSlab_01.containerId === "inventory_maraCottageChest" &&
    world.inventories.inventory_maraCottageChest.itemIds.includes("arcaneKnowledgeSlab_01"),
    "an orphaned legacy arcane slab should be reconciled into Mara's current authored keyed chest placement");
assert(world.entities.innkeeperRoomChest && world.entities.smithyLivingChest && world.entities.maraCottageChest &&
    world.inventories.inventory_innkeeperRoomChest.requiredKeyItemId === "innkeeperChestKey" &&
    world.inventories.inventory_smithyLivingChest.requiredKeyItemId === "blacksmithChestKey" &&
    world.inventories.inventory_maraCottageChest.requiredKeyItemId === "maraChestKey" &&
    world.inventories.inventory_innkeeper.itemIds.includes("innkeeperChestKey") &&
    world.inventories.inventory_blacksmith.itemIds.includes("blacksmithChestKey") &&
    world.inventories.inventory_hoodedWoman.itemIds.includes("maraChestKey") &&
    world.inventories.inventory_hoodedWoman.itemIds.includes("maraCottageKey"),
    "migration should introduce newly authored keyed private storage and ordinary owner-carried keys exactly once");
assert(world.entities.memoryStone_01 && world.entities.memoryStone_01.definitionId === "memoryStone" &&
    world.entities.memoryStone_01.containerId === "inventory_villageTemple" &&
    world.inventories.inventory_villageTemple.itemIds.filter(function (id) { return id === "memoryStone_01"; }).length === 1,
    "a newly authored stable Memory Stone ID absent from the old save should remain in its fresh authored temple placement");
assert(world.entities.hoodedWoman.mind.schemaVersion === 3 &&
    world.entities.hoodedWoman.mind.shortTermMemories.some(function (memory) { return memory.id === "memory_ai_41" && memory.summary === "Traveler offered me a secluded cottage and left to build it."; }) &&
    world.entities.hoodedWoman.mind.longTermMemories.some(function (memory) { return memory.id === "mara_old_memory"; }) &&
    world.entities.hoodedWoman.mind.verbatimObservations.length === 0,
    "legacy recent memories should survive one-for-one as STM, old LTM should survive, and migration must not fabricate verbatim history");
assert(world.entities.hoodedWoman.mind.beliefs.some(function (belief) { return belief.id === "traveler_keeps_word" && belief.text === "Traveler seems likely to keep promises." && belief.confidence === 0.6 && belief.activation === setup.MindV3.CONFIG.MIGRATED_BELIEF_ACTIVATION; }) &&
    world.entities.hoodedWoman.mind.relationships.some(function (relationship) { return relationship.targetCharacterId === "player"; }),
    "Mara's saved beliefs/relationships should survive deterministically with neutral migrated activation and no re-induction");
assert(!Object.prototype.hasOwnProperty.call(world.entities.hoodedWoman.mind, "abstractStudyProgress") &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman.lastInput === "magical energy in alchemy" &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.hoodedWoman.depth === 2 &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.blacksmith &&
    world.entities.arcaneKnowledgeSlab_01.abstractStudyProgressByCharacterId.blacksmith.lastInput === "tempering farm tools" &&
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
assert(world.entities.hoodedWoman.mind.pendingObservations.length === 0 && world.events.some(function (event) { return event.id === 99; }),
    "Human-controlled scheduler inbox backlog should be normalized away while compatible canonical event journal state survives migration");
assert(!world.ai.turnQueue.some(function (entry) { return entry.characterId === "hoodedWoman"; }),
    "a Human-controlled character must not be restored into the AI scheduler queue");
assert(world.nextObservationId >= 778 && world.nextEventId >= 100,
    "migration should preserve/reconstruct runtime observation and event counters beyond injected IDs");
assert(world.entities.blacksmith.mind.knownFacts.some(function (fact) { return fact.id === "harlan_role"; }) &&
    world.entities.blacksmith.mind.knownFacts.some(function (fact) { return fact.id === "village_name"; }) &&
    world.entities.blacksmith.mind.shortTermMemories.some(function (memory) { return memory.id === "harlan_memory"; }),
    "a surviving NPC should receive the current authored facts while keeping what he actually remembered");
assert(world.entities.blacksmith.aiDescription === setup.GeneratedWorldData.characters.blacksmith.aiDescription &&
    world.entities.blacksmith.playerDescription === setup.GeneratedWorldData.characters.blacksmith.playerDescription &&
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

// Stale item.containerId must not block save migration. Inventory/equipment membership is canonical
// and validation repairs the derived compatibility field deterministically.
const staleContainerWorld = clone(current);
staleContainerWorld.authoringRevision = "4343434343434343434343434343434343434343434343434343434343434343";
removeFromAllInventories(staleContainerWorld, "maraClothing_01");
staleContainerWorld.entities.hoodedWoman.equippedItems = staleContainerWorld.entities.hoodedWoman.equippedItems.filter(function (record) {
    return record.itemId !== "maraClothing_01";
});
staleContainerWorld.inventories.inventory_hoodedWoman.itemIds.push("maraClothing_01");
staleContainerWorld.entities.maraClothing_01.containerId = "hoodedWoman"; // stale legacy/cache value
State.variables.world = staleContainerWorld;
const migratedStaleContainer = setup.SaveMigration.migrate();
assert(migratedStaleContainer.ok && migratedStaleContainer.migrated,
    "stale item containerId should not make an otherwise canonical saved placement fail migration");
assert(State.variables.world.entities.maraClothing_01.containerId === "inventory_hoodedWoman" &&
    State.variables.world.inventories.inventory_hoodedWoman.itemIds.includes("maraClothing_01"),
    "migration/validation should derive containerId from canonical inventory membership");

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
snapshotMigrationWorld.entities.hoodedWoman.mindMaintenanceState = { reconciliationCursor: { afterBeliefId: "obsolete_v2_cursor" } };
const migrationLongStmSummary = "M".repeat(2800);
snapshotMigrationWorld.entities.hoodedWoman.mind.shortTermMemories.push({ id: "memory_ai_777", topic: "Migration sentinel", summary: migrationLongStmSummary, importance: 0.5, protected: false });
snapshotMigrationWorld.entities.hoodedWoman.mindMaintenanceSnapshots = [{
    createdAt: "2026-08-15T18:00:00.000Z",
    turn: 123,
    trigger: "manual",
    mind: clone(snapshotMigrationWorld.entities.hoodedWoman.mind)
}];
snapshotMigrationWorld.entities.hoodedWoman.mindRevision = 9;
snapshotMigrationWorld.entities.hoodedWoman.mindDiagnostics = { beliefHistoryById: { sentinel_belief: [{ atTurn: 122, source: "test", effect: "supports", deltaConfidence: 0.1 }] } };
snapshotMigrationWorld.entities.hoodedWoman.mind.maintenanceArchive = { obsoleteV2ArchiveSentinel: true };
snapshotMigrationWorld.nextMemoryId = 10;
State.variables.world = snapshotMigrationWorld;
const migratedSnapshotWorld = setup.SaveMigration.migrate();
assert(migratedSnapshotWorld.ok && migratedSnapshotWorld.migrated &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots.length === 1 &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots[0].turn === 123 &&
    State.variables.world.entities.hoodedWoman.mindMaintenanceSnapshots[0].trigger === "manual" &&
    State.variables.world.entities.hoodedWoman.mind.shortTermMemories.some(function (memory) { return memory.id === "memory_ai_777" && memory.summary === migrationLongStmSummary; }) &&
    !Object.prototype.hasOwnProperty.call(State.variables.world.entities.hoodedWoman.mind, "maintenanceArchive") &&
    Object.keys(State.variables.world.entities.hoodedWoman.mindMaintenanceState).length === 0 &&
    State.variables.world.entities.hoodedWoman.mindRevision === 9 &&
    State.variables.world.entities.hoodedWoman.mindDiagnostics.beliefHistoryById.sentinel_belief.length === 1 &&
    State.variables.world.nextMemoryId >= 778,
    "v3 maintenance snapshots/diagnostics/revision should survive compatible migration, v2 archive/cursor state should not, and active v3 IDs must advance nextMemoryId");

// Pre-feature saves without playerSetup are already-running games and must migrate straight to legacy-complete setup.
const prePlayerSetupWorld = clone(current);
delete prePlayerSetupWorld.playerSetup;
prePlayerSetupWorld.authoringRevision = "9999999999999999999999999999999999999999999999999999999999999999";
State.variables.world = prePlayerSetupWorld;
const migratedPrePlayerSetup = setup.SaveMigration.migrate();
assert(migratedPrePlayerSetup.ok && State.variables.world.playerSetup.disclaimerAccepted === true && State.variables.world.playerSetup.completed === true && State.variables.world.playerSetup.mode === "legacy",
    "saves created before Traveler initialization must not be interrupted by the new startup screens");

// Custom Traveler authoring belongs to the playthrough and survives authored-world migration while the shared aura stays canonical.
const customTravelerWorld = clone(current);
customTravelerWorld.authoringRevision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
customTravelerWorld.playerSetup = { disclaimerAccepted: true, completed: true, mode: "custom", profileId: null, customAuthoring: { name: "Saved Custom", playerDescription: "Saved visible identity.", aiDescription: "Saved private identity." } };
customTravelerWorld.entities.player.name = "Saved Custom";
customTravelerWorld.entities.player.playerDescription = "Saved visible identity.";
customTravelerWorld.entities.player.aiDescription = "Saved private identity.";
customTravelerWorld.entities.player.engineFacts.aura = "Stale saved aura that must not win.";
State.variables.world = customTravelerWorld;
const migratedCustomTraveler = setup.SaveMigration.migrate();
assert(migratedCustomTraveler.ok && State.variables.world.playerSetup.mode === "custom" && State.variables.world.entities.player.name === "Saved Custom" &&
    State.variables.world.entities.player.aiDescription === "Saved private identity." && State.variables.world.entities.player.engineFacts.aura === current.entities.player.engineFacts.aura,
    "Custom Traveler identity should survive migration but canonical current Traveler engineFacts/aura must win");

// Legacy authored Traveler saves materialize their already-selected saved identity as ordinary custom authoring.
const authoredTravelerWorld = clone(current);
authoredTravelerWorld.authoringRevision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
authoredTravelerWorld.playerSetup = { disclaimerAccepted: true, completed: true, mode: "authored", profileId: "testScholar", customAuthoring: null };
authoredTravelerWorld.entities.player.name = "Old Scholar";
authoredTravelerWorld.entities.player.playerDescription = "Old visible profile.";
authoredTravelerWorld.entities.player.aiDescription = "Old private profile.";
State.variables.world = authoredTravelerWorld;
const migratedAuthoredTraveler = setup.SaveMigration.migrate();
assert(migratedAuthoredTraveler.ok && State.variables.world.playerSetup.mode === "custom" && !Object.prototype.hasOwnProperty.call(State.variables.world.playerSetup, "profileId") && State.variables.world.entities.player.name === "Old Scholar" && State.variables.world.playerSetup.customAuthoring.name === "Old Scholar",
    "legacy authored Traveler saves should preserve their saved identity as ordinary custom authoring without profile dependencies");

// If an old authored profile no longer exists, the same materialization rule preserves the saved runtime identity.
const removedProfileWorld = clone(current);
removedProfileWorld.authoringRevision = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
removedProfileWorld.playerSetup = { disclaimerAccepted: true, completed: true, mode: "authored", profileId: "removedProfile", customAuthoring: null };
removedProfileWorld.entities.player.name = "Removed Profile Traveler";
removedProfileWorld.entities.player.playerDescription = "Saved fallback appearance.";
removedProfileWorld.entities.player.aiDescription = "Saved fallback personality.";
State.variables.world = removedProfileWorld;
const migratedRemovedProfile = setup.SaveMigration.migrate();
assert(migratedRemovedProfile.ok && State.variables.world.entities.player.name === "Removed Profile Traveler" && State.variables.world.playerSetup.mode === "custom" &&
    migratedRemovedProfile.report.warnings.some(function (warning) { return warning.includes("authored Traveler") && warning.includes("Custom"); }),
    "legacy authored Traveler profiles should preserve the saved runtime identity as custom authoring and emit a migration warning");

// Candidate-world validation during migration must never consult the restored source world implicitly.
// A pre-merchant save legitimately lacks the newly authored Market Square and wagon, while the
// fresh migration candidate already contains their conditional keyed passage. This is the real
// schema-14 -> schema-15 shape that exposed presence-aware lock validation leaking through State.
const preMerchantTopologyWorld = clone(current);
preMerchantTopologyWorld.schemaVersion = setup.Game.WORLD_SCHEMA_VERSION - 1;
preMerchantTopologyWorld.authoringRevision = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
delete preMerchantTopologyWorld.calendar;
delete preMerchantTopologyWorld.entities.marketSquare;
delete preMerchantTopologyWorld.entities.merchantWagon;
State.variables.world = preMerchantTopologyWorld;
const migratedPreMerchantTopology = setup.SaveMigration.migrate();
assert(migratedPreMerchantTopology.ok && State.variables.world.entities.marketSquare && State.variables.world.entities.merchantWagon,
    `pre-merchant saves must validate against the fresh migration candidate rather than the restored source world: ${JSON.stringify(migratedPreMerchantTopology)}`);


// Discoverable-location runtime state survives migration while authored initial discoveries are always restored.
const discoveryMigrationWorld = clone(current);
discoveryMigrationWorld.authoringRevision = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
discoveryMigrationWorld.entities.player.discoveredLocationIds = ["trampledGlade", "removed_secret_location"];
discoveryMigrationWorld.entities.hoodedWoman.discoveredLocationIds = [];
delete discoveryMigrationWorld.entities.nell.discoveredLocationIds;
State.variables.world = discoveryMigrationWorld;
const migratedDiscoveries = setup.SaveMigration.migrate();
assert(migratedDiscoveries.ok &&
    JSON.stringify(State.variables.world.entities.player.discoveredLocationIds) === JSON.stringify(["trampledGlade"]) &&
    State.variables.world.entities.hoodedWoman.discoveredLocationIds.includes("trampledGlade") &&
    Array.isArray(State.variables.world.entities.nell.discoveredLocationIds) && State.variables.world.entities.nell.discoveredLocationIds.length === 0,
    "migration should preserve valid saved discoveries, discard removed IDs, union authored initial discoveries, and initialize legacy characters without the field");

// A character restored physically inside a secret location must know it even if the old save lacked discovery state.
const insideSecretWorld = clone(current);
insideSecretWorld.authoringRevision = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
insideSecretWorld.entities.player.locationId = "trampledGlade";
insideSecretWorld.entities.player.sublocationId = "trampledGladeClearing";
insideSecretWorld.entities.player.discoveredLocationIds = [];
State.variables.world = insideSecretWorld;
const migratedInsideSecret = setup.SaveMigration.migrate();
assert(migratedInsideSecret.ok && State.variables.world.entities.player.locationId === "trampledGlade" &&
    State.variables.world.entities.player.discoveredLocationIds.includes("trampledGlade"),
    "migration must repair discovery when a character is restored inside a secret location");

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


// Awayable lifecycle migration: legacy fixed-weekly presence becomes canonical awayState without fake travel/restock/teleport.
function legacyMaksymWorld(dayNumber) {
    const source = clone(setup.Game.createInitialWorld());
    source.schemaVersion = 16;
    source.authoringRevision = "0".repeat(64);
    source.calendar.dayNumber = dayNumber;
    source.environment.timePhase = dayNumber === 0 ? "evening" : "morning";
    const maksym = source.entities.roadMerchant;
    delete maksym.awayable;
    delete maksym.awayState;
    maksym.weeklyPresence = {
        presentWeekdayIndexes: [1, 4],
        arrivalLocationId: "marketSquare",
        arrivalSublocationId: "marketSquareCenter",
        initialLocationId: "commonRoom",
        initialSublocationId: "commonRoomTableTwo"
    };
    return source;
}

let legacyMaksymPresent = legacyMaksymWorld(0);
legacyMaksymPresent.entities.roadMerchant.locationId = "commonRoom";
legacyMaksymPresent.entities.roadMerchant.sublocationId = "commonRoomTableTwo";
legacyMaksymPresent.entities.roadMerchant.wallet = 137;
legacyMaksymPresent.entities.roadMerchant.mind.continuation = undefined;
const presentStockIdsBefore = legacyMaksymPresent.inventories.inventory_merchantSaleChest.itemIds.slice();
State.variables.world = legacyMaksymPresent;
const presentAwayableMigration = setup.SaveMigration.migrate();
assert(presentAwayableMigration.ok && presentAwayableMigration.migrated, `legacy present Maksym should migrate to awayable lifecycle: ${JSON.stringify(presentAwayableMigration)}`);
let migratedMaksym = State.variables.world.entities.roadMerchant;
assert(migratedMaksym.awayState && migratedMaksym.awayState.present === true && migratedMaksym.awayState.travelPeriodsRemaining === 0,
    "legacy present Maksym should migrate as locally present with no travel countdown");
assert(migratedMaksym.awayState.plannedDeparture.dayNumber === 1 && migratedMaksym.awayState.plannedDeparture.phase === "Morning",
    "legacy present Maksym should receive the nearest authored following-Morning planned departure");
assert(migratedMaksym.locationId === "commonRoom" && migratedMaksym.sublocationId === "commonRoomTableTwo" && migratedMaksym.wallet === 137,
    "awayable migration must preserve saved position and wallet rather than teleporting or resetting Maksym");
assert(JSON.stringify(State.variables.world.inventories.inventory_merchantSaleChest.itemIds) === JSON.stringify(presentStockIdsBefore),
    "creating awayState during migration must not fire the arrival restock hook");

let legacyMaksymAbsent = legacyMaksymWorld(1); // Flamesday: not a legacy scheduled presence day.
legacyMaksymAbsent.entities.roadMerchant.locationId = "marketSquare";
legacyMaksymAbsent.entities.roadMerchant.sublocationId = "marketSquareCenter";
legacyMaksymAbsent.entities.roadMerchant.wallet = 91;
const absentStockIdsBefore = legacyMaksymAbsent.inventories.inventory_merchantSaleChest.itemIds.slice();
State.variables.world = legacyMaksymAbsent;
const absentAwayableMigration = setup.SaveMigration.migrate();
assert(absentAwayableMigration.ok && absentAwayableMigration.migrated, `legacy absent Maksym should migrate to awayable lifecycle: ${JSON.stringify(absentAwayableMigration)}`);
migratedMaksym = State.variables.world.entities.roadMerchant;
assert(migratedMaksym.awayState && migratedMaksym.awayState.present === false && migratedMaksym.awayState.travelPeriodsRemaining === 0 && migratedMaksym.awayState.plannedDeparture === null,
    "legacy absent Maksym should be treated as road-complete and remain away until a later authored opportunity");
assert(migratedMaksym.locationId === "marketSquare" && migratedMaksym.sublocationId === "marketSquareCenter" && migratedMaksym.wallet === 91,
    "legacy absent awayable migration must not force a position change or reset canonical runtime state");
assert(JSON.stringify(State.variables.world.inventories.inventory_merchantSaleChest.itemIds) === JSON.stringify(absentStockIdsBefore),
    "legacy absent migration must not synthesize an arrival/restock");
assert(!setup.WeeklyRhythm.isCharacterPresent("roadMerchant", State.variables.world),
    "travel-complete migration still waits away between authored arrival opportunities rather than spawning immediately");

console.log("All save-migration tests passed.");
