"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { augment } = require("./runtime-files.js");
const { validateWorldDocument } = require("../tools/world-authored-validator.js");
const { materializeSecrets } = require("../tools/world-secret-materializer.js");
const root = path.resolve(__dirname, "..");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function ok(result, message) { assert(result && result.ok, `${message}: ${JSON.stringify(result)}`); return result; }
function fact(character, id) { return (character.initialMind.knownFacts || []).find(function (record) { return record.id === id; }); }

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(relativePath) { vm.runInThisContext(fs.readFileSync(path.join(root, relativePath), "utf8"), { filename: relativePath }); }
augment([
    "src/generated/world-data.js",
    "src/07-mind-v3.js",
    "src/08-mind-validators.js",
    "src/10-game-api.js",
    "src/10-weekly-rhythm.js",
    "src/11-save-migration.js",
    "src/12-character-context.js",
    "src/13-character-memory.js",
    "src/13-verbatim-memory.js",
    "src/14-event-perception.js",
    "src/20-controllers.js"
]).forEach(load);

function fresh() {
    State.variables = {};
    ok(setup.Game.bootstrap(), "bootstrap");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "acknowledge AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}

function place(character, locationId, sublocationId) {
    character.locationId = locationId;
    character.sublocationId = sublocationId;
    character.sleeping = false;
}

// Complete authoring validates before filtering, and enabled secret membership does not imply hidden visibility.
const source = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
assert(validateWorldDocument(source).length === 0, "current authored world with secrets should validate before materialization");
assert(source.secrets.chugaister.enabled === true && source.secrets.old_well.enabled === true, "both first mystery modules should be enabled by default");
assert(source.locations.trampledGlade.secretId === "chugaister" && source.locations.trampledGlade.requiresDiscovery === true,
    "Trampled Glade should be secret-owned and independently discovery-gated");
assert(source.locations.villageEdge.sublocations.oldWell.secretId === "old_well" && source.locations.villageEdge.sublocations.oldWell.requiresDiscovery !== true,
    "Old Well should prove that secret membership does not imply hidden discovery");
assert(source.characters.chugaister.secretId === "chugaister" && source.characters.chugaister.requiresDiscovery === true &&
    source.characters.chugaister.playerControllable === false && source.characters.chugaister.deferredActivation === true,
    "concrete Chugaister identity should be reserved as hidden/non-controllable but not activated by this patch");

// Disabled content is filtered at materialization, while unrelated authored systems survive.
let disabled = clone(source);
disabled.secrets.chugaister.enabled = false;
let active = materializeSecrets(disabled);
assert(validateWorldDocument(active).length === 0, "world should remain valid after disabling Chugaister and materializing");
assert(!active.locations.trampledGlade && !active.characters.chugaister, "disabled Chugaister module should remove its location and reserved character");
assert(!active.locations.villageEdge.exits.trampledGlade && !active.locations.forestMountainStream.exits.trampledGlade,
    "materializer should prune mechanically derived exits to removed secret locations");
assert(!fact(active.characters.hoodedWoman, "mara_trampled_glade") && !active.characters.hoodedWoman.initialDiscoveredLocationIds.includes("trampledGlade"),
    "disabled Chugaister should remove Mara's secret-owned glade seed and discovery");
assert(!active.itemDefinitions.arcaneKnowledgeSlab.useAction.knowledgeEntries.some(function (entry) { return entry.id === "chugaister"; }),
    "disabled Chugaister should remove its authored slab article");
assert(active.dayActivities.soloHunting && active.dayActivities.soloHunting.settlement.definitionId === "squirrelPelt" &&
    active.randomOutcomeTables.soloHuntingMystery && active.randomOutcomeTables.soloHuntingMystery.outcomes.length === 0,
    "disabling Chugaister should leave ordinary hunting/pelt settlement and only remove the secret-owned mystery outcome");

disabled = clone(source);
disabled.secrets.old_well.enabled = false;
active = materializeSecrets(disabled);
assert(validateWorldDocument(active).length === 0, "world should remain valid after disabling Old Well and materializing");
assert(!active.locations.villageEdge.sublocations.oldWell && !active.locations.villageEdge.sublocations.villageEdgePath.reachableSublocationIds.includes("oldWell"),
    "disabled Old Well should disappear and be pruned from local reachability");
assert(!active.itemDefinitions.bucketOfWine && !active.itemDefinitions.emptyBucket && !active.randomOutcomeTables.oldWellBucketDraw,
    "secret-owned well result definitions/table should be absent when the module is disabled");
for (const id of ["hoodedWoman", "innkeeper", "nell", "blacksmith"]) {
    assert(!fact(active.characters[id], "old_well_warning"), `disabled Old Well should remove ${id}'s secret-owned warning`);
}

// Disabled content is still validated before filtering; it cannot hide broken authoring.
const brokenDisabled = clone(source);
brokenDisabled.secrets.chugaister.enabled = false;
brokenDisabled.randomOutcomeTables.soloHuntingMystery.outcomes[0].effects[0].locationId = "missingSecretLocation";
assert(validateWorldDocument(brokenDisabled).some(function (error) { return /reveal_location|requiresDiscovery|missing/i.test(error.message); }),
    "a disabled secret must still fail full-source validation when its authored references are broken");

// Fresh world knowledge mapping is explicit authoring, not a runtime notion of locals.
let world = fresh();
assert(world.entities.chugaister && world.entities.chugaister.activationState === "inactive" && world.entities.chugaister.locationId === null && world.entities.chugaister.sublocationId === null, "enabled secret NPC should be fully materialized but inactive/off-map before grounded appearance");
assert(world.entities.oldWell && world.entities.oldWell.type === "sublocation", "Old Well should be openly instantiated in the active runtime world");
const warningText = "The old well at the edge of Mallowstead is cursed. It is better to leave it alone and not go near it without a reason.";
for (const id of ["hoodedWoman", "innkeeper", "nell", "blacksmith"]) {
    const known = world.entities[id].mind.knownFacts.find(function (record) { return record.id === "old_well_warning"; });
    assert(known && known.text === warningText, `${id} should receive the explicitly authored basic Old Well warning`);
}
assert(world.entities.hoodedWoman.mind.knownFacts.some(function (record) { return record.id === "mara_old_well_unexpected" && /Unexpected things/.test(record.text); }),
    "Mara should additionally know that the well may return unexpected things");
assert(!world.entities.roadMerchant.mind.knownFacts.some(function (record) { return /^old_well|^mara_old_well/.test(record.id); }) &&
    !world.entities.player.mind.knownFacts.some(function (record) { return /^old_well|^mara_old_well/.test(record.id); }),
    "Maksym and Traveler should not receive authored starting Old Well knowledge");

// Environment action is controller-agnostic and available only at the exact authored sublocation.
place(world.entities.player, "villageEdge", "villageEdgePath");
assert(!setup.CharacterAPI.getView("player").available_actions.authored_interaction,
    "Raise the bucket must not leak while the actor is elsewhere at Village Edge");
place(world.entities.player, "villageEdge", "oldWell");
let available = setup.CharacterAPI.getView("player").available_actions.authored_interaction;
assert(available && available.options.interaction_ids.includes("raiseOldWellBucket"), "HumanController should receive Raise the bucket through ordinary available_actions");
place(world.entities.nell, "villageEdge", "oldWell");
available = setup.CharacterAPI.getView("nell").available_actions.authored_interaction;
assert(world.control.assignments.nell === "ai" && available && available.options.interaction_ids.includes("raiseOldWellBucket"),
    "AIController should receive the same authored environment interaction contract");

function performWell(roll) {
    const originalRandom = Math.random;
    Math.random = function () { return roll; };
    try { return ok(setup.CharacterAPI.perform("player", { type: "authored_interaction", interaction_id: "raiseOldWellBucket" }), `well roll ${roll}`); }
    finally { Math.random = originalRandom; }
}
function playerItems() { return world.inventories[world.entities.player.inventoryId].itemIds.map(function (id) { return world.entities[id]; }); }

// 90/9/1 exact boundaries and repeatability.
let beforeWallet = world.entities.player.wallet;
let beforeItemCount = playerItems().length;
let result = performWell(0);
assert(result.events.length === 1 && /cold, clear water/.test(result.events[0].text) && world.entities.player.wallet === beforeWallet && playerItems().length === beforeItemCount,
    "water result should be grounded text only with no wallet/item mutation");
result = performWell(0.899999);
assert(/cold, clear water/.test(result.events[0].text), "the first 90 weight units should remain ordinary water");
result = performWell(0.9);
assert(/gold coin/.test(result.events[0].text) && world.entities.player.wallet === beforeWallet + 1 && playerItems().length === beforeItemCount,
    "the exact 90% boundary should enter the 9-weight gold outcome and add one canonical wallet gold only");
result = performWell(0.989999);
assert(/gold coin/.test(result.events[0].text) && world.entities.player.wallet === beforeWallet + 2,
    "the gold outcome should occupy the next nine weight units and remain repeatable");
result = performWell(0.99);
let wineItems = playerItems().filter(function (item) { return item && item.definitionId === "bucketOfWine"; });
assert(/dark red wine/.test(result.events[0].text) && wineItems.length === 1, "the final one weight unit should create exactly one Bucket of wine");
const wineId = wineItems[0].id;
ok(setup.CharacterAPI.perform("player", { type: "consume", item_id: wineId }), "drink generated Bucket of wine");
assert(world.entities[wineId] && world.entities[wineId].definitionId === "emptyBucket",
    "generated Bucket of wine should immediately become ordinary item mechanics and transform to Empty bucket when consumed");
assert(!playerItems().some(function (item) { return item && /water/i.test(item.definitionId || ""); }), "Old Well must never generate a Bucket of Water item");

// Physical result follows ordinary perception: a co-located NPC observes it, a remote one does not.
world.entities.nell.mind.pendingObservations = [];
world.entities.innkeeper.mind.pendingObservations = [];
performWell(0);
assert(world.entities.nell.mind.pendingObservations.some(function (observation) { return /cold, clear water/.test(observation.text); }),
    "nearby Nell should receive the physical bucket result through normal event perception");
assert(!world.entities.innkeeper.mind.pendingObservations.some(function (observation) { return /cold, clear water/.test(observation.text); }),
    "remote Garrick must not learn the bucket result automatically");

// Hidden-character discovery is per observer, does not arise from lore/location knowledge, and is independent from player controllability.
const hidden = world.entities.blacksmith;
place(hidden, "villageEdge", "oldWell");
hidden.requiresDiscovery = true;
hidden.playerControllable = false;
world.entities.player.discoveredCharacterIds = world.entities.player.discoveredCharacterIds.filter(function (id) { return id !== hidden.id; });
world.entities.nell.discoveredCharacterIds = world.entities.nell.discoveredCharacterIds.filter(function (id) { return id !== hidden.id; });
world.entities.player.mind.pendingObservations = [];
setup.EventPerception.emitEvent({ type: "narrative_input", actorId: hidden.id, locationId: hidden.locationId, text: "The hidden fixture shifts nearby." }, world);
assert(!world.entities.player.mind.pendingObservations.some(function (observation) { return /hidden fixture/.test(observation.text); }),
    "an undiscovered hidden character must not leak through ordinary event perception");
assert(!setup.CharacterAPI.getView("player").location.characters.some(function (entry) { return entry.id === hidden.id; }),
    "undiscovered hidden character must not appear in the observer's structured location view");
let controlAttempt = setup.Game.takeHumanControl(hidden.id);
assert(!controlAttempt.ok && controlAttempt.error.code === "CHARACTER_NOT_PLAYER_CONTROLLABLE",
    "playerControllable=false must independently reject HumanController assignment");
world.randomOutcomeTables.hiddenFixtureEncounter = {
    id: "hiddenFixtureEncounter", noOutcomeWeight: 0,
    outcomes: [{ id: "discoverHiddenFixture", weight: 1, once: true, effects: [{ type: "encounter_character", characterId: hidden.id, observationText: "{actorName} directly encounters {characterName}." }] }]
};
result = ok(setup.GameInternals.runAuthoredOutcomeTable("player", "hiddenFixtureEncounter", world, { random: function () { return 0; } }), "grounded hidden-character encounter");
assert(setup.GameInternals.characterHasDiscoveredCharacter("player", hidden.id, world) && result.selectedOutcomeId === "discoverHiddenFixture",
    "encounter_character should grant discovery only to the grounded perceiving actor");
assert(!setup.GameInternals.characterHasDiscoveredCharacter("nell", hidden.id, world), "hidden-character discovery must remain per-character");
assert(setup.CharacterAPI.getView("player").location.characters.some(function (entry) { return entry.id === hidden.id; }),
    "after grounded encounter the hidden character may appear in that observer's ordinary view");
assert(world.consumedAuthoredOutcomeIds.includes("discoverHiddenFixture"), "successful once outcome should persist canonical consumption state");
assert(!setup.GameInternals.runAuthoredOutcomeTable("player", "hiddenFixtureEncounter", world, { random: function () { return 0; } }).ok,
    "a consumed one-shot with no no-outcome bucket should not be executable again");
controlAttempt = setup.Game.takeHumanControl(hidden.id);
assert(!controlAttempt.ok && controlAttempt.error.code === "CHARACTER_NOT_PLAYER_CONTROLLABLE",
    "discovery must not override the independent non-controllable flag");

// Runtime validator catches malformed discovery/consumption state.
let snapshot = clone(world.entities.player.discoveredCharacterIds);
world.entities.player.discoveredCharacterIds.push(hidden.id);
assert(!setup.GameInternals.validateWorld(world).ok, "duplicate discovered-character IDs must fail canonical runtime validation");
world.entities.player.discoveredCharacterIds = snapshot;
snapshot = clone(world.consumedAuthoredOutcomeIds);
world.consumedAuthoredOutcomeIds.push("not_a_current_once_outcome");
assert(!setup.GameInternals.validateWorld(world).ok, "consumed outcome IDs must reference current once=true authored outcomes");
world.consumedAuthoredOutcomeIds = snapshot;

console.log("All authored secrets, hidden-character discovery, and random outcome tests passed.");
