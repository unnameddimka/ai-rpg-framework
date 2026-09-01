"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { augment } = require("./runtime-files.js");
const authoredValidator = require("../tools/world-authored-validator.js");
const root = path.resolve(__dirname, "..");
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function assert(c, m) { if (!c) throw new Error(m); }
function ok(v, m) { assert(v && v.ok, `${m}: ${JSON.stringify(v)}`); return v; }

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
augment([
    "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js","src/09-action-option-validation.js","src/09-world-state-authority.js", "src/10-game-00-item-mechanics.js","src/10-game-01-validation.js","src/10-game-02-actions.js","src/10-game-api.js",
    "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js", "src/13-verbatim-memory.js",
    "src/14-event-perception.js", "src/20-controllers.js"
]).forEach(load);

// Generic inactive authored fixture: prove this is not a Chuhaister special case.
const dormant = clone(setup.GeneratedWorldData.characters.chugaister);
dormant.id = "dormantFixture";
dormant.name = "Dormant Fixture";
dormant.inventoryId = "inventory_dormantFixture";
dormant.abilityIds = [];
dormant.secretId = undefined;
dormant.movementConstraint = undefined;
dormant.playerControllable = false;
dormant.initialMind.knownFacts = [{ id: "fixture_fact", text: "A dormant fixture remembers this." }];
setup.GeneratedWorldData.characters.dormantFixture = dormant;
setup.GeneratedWorldData.items.dormantFixtureMug = { id: "dormantFixtureMug", definitionId: "emptyMug", inventoryId: "inventory_dormantFixture" };

function fresh() {
    State.variables = {};
    ok(setup.Game.bootstrap(), "bootstrap");
    ok(setup.Game.acceptPlayerDisclaimer(), "accept disclaimer");
    ok(setup.Game.acknowledgeAISetup(), "ack AI setup");
    ok(setup.Game.finalizePlayerSetup({ mode: "generic" }), "finalize Traveler");
    return setup.Game.getWorld();
}
function nextTick(random) {
    const world = setup.Game.getWorld();
    world.ordinaryTickId += 1;
    return setup.TriggeredEvents.processOrdinaryTick({ tickId: world.ordinaryTickId, random: random });
}

let world = fresh();
const fixture = world.entities.dormantFixture;
assert(fixture && fixture.activationState === "inactive" && fixture.locationId === null && fixture.sublocationId === null,
    "generic deferred character must be fully materialized but inactive/off-map");
assert(fixture.mind && fixture.mind.knownFacts.some(f => f.id === "fixture_fact"), "inactive character mind must materialize immediately");
assert(world.inventories.inventory_dormantFixture.itemIds.join(",") === "dormantFixtureMug" && world.entities.dormantFixtureMug,
    "inactive character inventory and authored starting items must materialize immediately");
assert(!setup.Presence.isLocallyPresent(fixture, world), "inactive character must not be locally present");
assert(setup.CharacterAPI.getView("dormantFixture").error.code === "ACTOR_NOT_PRESENT", "inactive character view must fail cleanly");
assert(!setup.CharacterAPI.getView("player").location.characters.some(c => c.id === "dormantFixture"), "inactive character must not leak into local scene lists");

// Activation/local-presence are separate axes.
const maksym = world.entities.roadMerchant;
assert(maksym.activationState === "active" && setup.TriggeredEvents.characterActivationIs("roadMerchant", "active", world),
    "Maksym should be activation-active while present");
ok(setup.Presence.setLocalPresence(maksym, false, world), "mark travelling Maksym locally absent"); maksym.locationId = null; maksym.sublocationId = null;
assert(setup.TriggeredEvents.characterActivationIs("roadMerchant", "inactive", world) === false &&
    setup.TriggeredEvents.characterLocallyPresent("roadMerchant", false, world) === true,
    "travelling Maksym must stay activation-active while locally absent");
assert(setup.TriggeredEvents.characterActivationIs("chugaister", "inactive", world) === true &&
    setup.TriggeredEvents.characterLocallyPresent("chugaister", false, world) === true,
    "inactive Chuhaister must be separately inactive and locally absent");

// Fast path: failed prerequisite -> no RNG and no transaction clone; chance miss -> one RNG and no clone.
world = fresh();
world.environment.timePhase = "morning";
world.triggeredEvents.hardeningProbe = {
    id: "hardeningProbe", trigger: { type: "ordinary_tick" },
    prerequisites: [{ type: "phase_is", phase: "Evening" }], chance: 0.1,
    effects: [{ type: "deactivate_character", characterId: "chugaister" }], narrationPolicy: "none"
};
setup.TriggeredEvents.resetDebugStats();
let rngCalls = 0;
ok(nextTick(() => { rngCalls += 1; return 0; }), "failed prerequisite tick");
assert(rngCalls === 0 && setup.TriggeredEvents.getDebugStats().transactionSnapshots === 0,
    "failed prerequisites must not roll RNG or clone the world");
world = setup.Game.getWorld(); world.environment.timePhase = "evening";
setup.TriggeredEvents.resetDebugStats(); rngCalls = 0;
ok(nextTick(() => { rngCalls += 1; return 0.5; }), "chance miss tick");
assert(rngCalls === 1 && setup.TriggeredEvents.getDebugStats().transactionSnapshots === 0,
    "eligible chance miss must roll once and not clone the world");
world = setup.Game.getWorld();
setup.TriggeredEvents.resetDebugStats(); rngCalls = 0;
ok(nextTick(() => { rngCalls += 1; return 0; }), "chance hit tick");
assert(rngCalls === 1 && setup.TriggeredEvents.getDebugStats().transactionSnapshots === 1,
    "real proc must take exactly one transaction candidate snapshot");

// Same logical tick is processed once.
world = setup.Game.getWorld();
const sameTick = world.ordinaryTickId;
rngCalls = 0;
const duplicate = ok(setup.TriggeredEvents.processOrdinaryTick({ tickId: sameTick, random: () => { rngCalls += 1; return 0; } }), "duplicate tick");
assert(duplicate.duplicate === true && rngCalls === 0, "same tickId must never reroll triggered events");

// Generic dormant character activates without rebuilding identity/inventory, then survives deactivate/save/reactivate.
world = fresh();
const originalMind = world.entities.dormantFixture.mind;
const originalItem = world.entities.dormantFixtureMug;
world.triggeredEvents.activateDormantFixture = {
    id: "activateDormantFixture", trigger: { type: "ordinary_tick" },
    prerequisites: [{ type: "character_activation_is", characterId: "dormantFixture", value: "inactive" }],
    effects: [{ type: "activate_character", characterId: "dormantFixture", locationId: "commonRoom", sublocationId: "commonRoomFloor" }], narrationPolicy: "none"
};
ok(nextTick(() => 0), "activate dormant fixture");
world = setup.Game.getWorld();
assert(world.entities.dormantFixture.activationState === "active" && setup.Presence.isLocallyPresent("dormantFixture", world),
    "generic inactive character must become locally present through activation");
assert(world.entities.dormantFixtureMug.id === originalItem.id && world.inventories.inventory_dormantFixture.itemIds.includes(originalItem.id),
    "activation must preserve starting item identity rather than recreate inventory");
world.entities.dormantFixture.mind.knownFacts.push({ id: "developed_fact", text: "State developed after activation." });
world.triggeredEvents.deactivateDormantFixture = {
    id: "deactivateDormantFixture", trigger: { type: "timelapse_start" }, prerequisites: [],
    effects: [{ type: "deactivate_character", characterId: "dormantFixture" }], narrationPolicy: "none"
};
ok(setup.TriggeredEvents.processTimelapseStart(), "deactivate dormant fixture");
world = setup.Game.getWorld();
assert(world.entities.dormantFixture.activationState === "inactive" && world.entities.dormantFixture.mind.knownFacts.some(f => f.id === "developed_fact"),
    "deactivation must preserve developed mind state");
State.variables.world = clone(world);
world = setup.Game.getWorld();
assert(world.entities.dormantFixture.activationState === "inactive" && world.entities.dormantFixtureMug.id === originalItem.id,
    "save/load while inactive must preserve character and item identity");
world.environment.timePhase = "evening";
ok(nextTick(() => 0), "reactivate dormant fixture");
world = setup.Game.getWorld();
assert(world.entities.dormantFixture.mind.knownFacts.some(f => f.id === "developed_fact") && world.entities.dormantFixtureMug.id === originalItem.id,
    "reactivation must restore the same continuing character state");

// Deactivation of a presence owner must reconcile foreign occupants of owner-dependent sublocations.
world = fresh();
world.entities.player.locationId = "marketSquare";
world.entities.player.sublocationId = "merchantSaleChest";
assert(setup.Presence.isLocallyPresent("player", world), "merchant sale chest should be available while Maksym is locally present");
const relocationVerbatimBefore = world.entities.player.mind.verbatimObservations.length;
world.triggeredEvents.deactivateMerchantPresenceOwner = {
    id: "deactivateMerchantPresenceOwner", trigger: { type: "timelapse_start" }, prerequisites: [],
    effects: [{ type: "deactivate_character", characterId: "roadMerchant" }], narrationPolicy: "none"
};
ok(setup.TriggeredEvents.processTimelapseStart(), "deactivate owner with foreign sublocation occupant");
world = setup.Game.getWorld();
assert(world.entities.roadMerchant.activationState === "inactive" &&
    world.entities.player.locationId === "marketSquare" && world.entities.player.sublocationId === "marketSquareCenter" &&
    setup.Presence.isLocallyPresent("player", world) && world.entities.player.mind.verbatimObservations.length === relocationVerbatimBefore + 1,
    "owner deactivation must infer the parent default fallback and ground the forced relocation for a foreign occupant");

// Same-tick trigger eligibility is frozen at the ordinary-tick start snapshot.
world = fresh();
world.entities.dormantFixture.activationState = "active";
world.entities.dormantFixture.locationId = "commonRoom";
world.entities.dormantFixture.sublocationId = "commonRoomFloor";
world.triggeredEvents.snapshotCreatesPrerequisiteA = {
    id: "snapshotCreatesPrerequisiteA", trigger: { type: "ordinary_tick" }, prerequisites: [],
    effects: [{ type: "deactivate_character", characterId: "dormantFixture" }], narrationPolicy: "none"
};
world.triggeredEvents.snapshotCreatesPrerequisiteB = {
    id: "snapshotCreatesPrerequisiteB", trigger: { type: "ordinary_tick" },
    prerequisites: [{ type: "character_activation_is", characterId: "dormantFixture", value: "inactive" }],
    effects: [{ type: "emit_observation", locationId: "commonRoom", text: "Snapshot B fires." }], narrationPolicy: "normal"
};
let snapshotTick = ok(nextTick(() => 0), "trigger snapshot creation tick");
let snapshotA = snapshotTick.results.find(entry => entry.eventId === "snapshotCreatesPrerequisiteA");
let snapshotB = snapshotTick.results.find(entry => entry.eventId === "snapshotCreatesPrerequisiteB");
assert(snapshotA && snapshotA.triggered === true && snapshotB && snapshotB.eligible === false && snapshotB.rolled === false,
    "an earlier trigger effect must not create eligibility for a later event in the same tick");
snapshotTick = ok(nextTick(() => 0), "trigger snapshot next tick");
snapshotB = snapshotTick.results.find(entry => entry.eventId === "snapshotCreatesPrerequisiteB");
assert(snapshotB && snapshotB.eligible === true && snapshotB.triggered === true,
    "a prerequisite created by the previous tick may become eligible on the next tick");

world = fresh();
world.entities.dormantFixture.activationState = "active";
world.entities.dormantFixture.locationId = "commonRoom";
world.entities.dormantFixture.sublocationId = "commonRoomFloor";
world.triggeredEvents.snapshotDestroysPrerequisiteA = {
    id: "snapshotDestroysPrerequisiteA", trigger: { type: "ordinary_tick" }, prerequisites: [],
    effects: [{ type: "deactivate_character", characterId: "dormantFixture" }], narrationPolicy: "none"
};
world.triggeredEvents.snapshotDestroysPrerequisiteB = {
    id: "snapshotDestroysPrerequisiteB", trigger: { type: "ordinary_tick" },
    prerequisites: [{ type: "character_activation_is", characterId: "dormantFixture", value: "active" }],
    effects: [{ type: "emit_observation", locationId: "commonRoom", text: "Snapshot B remained eligible." }], narrationPolicy: "normal"
};
snapshotTick = ok(nextTick(() => 0), "trigger snapshot destruction tick");
snapshotB = snapshotTick.results.find(entry => entry.eventId === "snapshotDestroysPrerequisiteB");
assert(snapshotB && snapshotB.eligible === true && snapshotB.triggered === true,
    "an earlier trigger effect must not revoke eligibility that existed at tick start");

// Hidden explicit recipients still obey local Presence and never become delayed delivery.
world = fresh();
const awayDeparture = ok(setup.WeeklyRhythm.advanceDayBoundary(world), "real Maksym departure for hidden-recipient fixture");
assert(awayDeparture.transitions.some(entry => entry.type === "departure" && entry.characterId === "roadMerchant") &&
    !setup.Presence.isLocallyPresent("roadMerchant", world), "fixture must use the real awayable departure lifecycle");
const hiddenBefore = world.entities.roadMerchant.mind.pendingObservations.length;
const hiddenAwayEvent = setup.EventPerception.emitEvent({
    type: "hardening_hidden_probe", actorId: "player", targetId: "roadMerchant",
    locationId: "marketSquare", noticeability: "hidden", text: "Only a locally present target should receive this."
}, world);
assert(hiddenAwayEvent.recipients.length === 0 && world.entities.roadMerchant.mind.pendingObservations.length === hiddenBefore,
    "hidden targetId must not bypass Presence or enqueue an away recipient");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "away travel period one");
ok(setup.WeeklyRhythm.advanceDayBoundary(world), "away travel period two");
ok(setup.WeeklyRhythm.advanceEveningBoundary(world), "away travel period three");
const hiddenReturn = ok(setup.WeeklyRhythm.advanceDayBoundary(world, { random: () => 0 }), "Maksym return after hidden drop");
assert(hiddenReturn.transitions.some(entry => entry.type === "arrival" && entry.characterId === "roadMerchant") &&
    world.entities.roadMerchant.mind.pendingObservations.length === 0,
    "a dropped hidden observation must not replay when the target later returns");
const hiddenPresentEvent = setup.EventPerception.emitEvent({
    type: "hardening_hidden_probe_present", actorId: "player", targetId: "roadMerchant",
    locationId: "marketSquare", noticeability: "hidden", text: "A present hidden target receives this."
}, world);
assert(hiddenPresentEvent.recipients.includes("roadMerchant") && world.entities.roadMerchant.mind.pendingObservations.length === 1,
    "the same hidden routing mode should deliver normally to a locally present target");

// Runtime validation must enforce the same triggered-event semantics as authored validation.
function expectRuntimeInvalid(mutator, label) {
    const candidate = clone(world);
    mutator(candidate);
    const result = setup.GameInternals.validateWorld(candidate);
    assert(!result.ok, label + ": runtime validator unexpectedly accepted malformed data");
}
function expectAuthoredInvalid(mutator, label) {
    const authored = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
    mutator(authored);
    const errors = authoredValidator.validateWorldDocument(authored);
    assert(errors.length > 0, label + ": authored validator unexpectedly accepted malformed data");
}
expectRuntimeInvalid(candidate => { candidate.triggeredEvents.chuhaisterFoodAppearance.narrationPolicy = "garbage"; }, "invalid narrationPolicy");
expectAuthoredInvalid(candidate => { candidate.triggeredEvents.chuhaisterFoodAppearance.narrationPolicy = "garbage"; }, "invalid narrationPolicy authored parity");
expectRuntimeInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterConsumeGladeFoodAtTimelapse.effects.find(x => x.type === "consume_matching_items"); e.mode = "one"; }, "consume mode parity");
expectAuthoredInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterConsumeGladeFoodAtTimelapse.effects.find(x => x.type === "consume_matching_items"); e.mode = "one"; }, "consume mode authored parity");
expectRuntimeInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterConsumeGladeFoodAtTimelapse.effects.find(x => x.type === "consume_matching_items"); e.preserveContainers = false; }, "consume container parity");
expectRuntimeInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterFoodAppearance.effects.find(x => x.type === "activate_character"); e.characterId = "roadMerchant"; }, "non-deferred activation parity");
expectRuntimeInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterFoodAppearance.effects.find(x => x.type === "activate_character"); e.locationId = "commonRoom"; e.sublocationId = "tavernEntranceFloor"; }, "activation placement parity");
expectAuthoredInvalid(candidate => { const e = candidate.triggeredEvents.chuhaisterFoodAppearance.effects.find(x => x.type === "activate_character"); e.locationId = "commonRoom"; e.sublocationId = "tavernEntranceFloor"; }, "activation placement authored parity");
expectRuntimeInvalid(candidate => { candidate.entities.commonRoom.presenceOwnerCharacterId = "roadMerchant"; }, "ambiguous conditional-location fallback");
expectAuthoredInvalid(candidate => { candidate.locations.commonRoom.presenceOwnerCharacterId = "roadMerchant"; }, "ambiguous conditional-location fallback authored parity");

// Both documented platform entry points must delegate to the same canonical suite runner.
const testShSource = fs.readFileSync(path.join(root, "test.sh"), "utf8");
const testBatSource = fs.readFileSync(path.join(root, "test.bat"), "utf8");
const runAllSource = fs.readFileSync(path.join(root, "tests/run-all.js"), "utf8");
assert(testShSource.includes("tests/run-all.js") && testBatSource.includes("tests\\run-all.js"),
    "Unix and Windows test wrappers must use the same canonical test runner");
for (const suite of ["run-secrets-tests.js", "run-chuhaister-food-tests.js", "run-hardening-tests.js", "run-awayable-tests.js"]) {
    assert(runAllSource.includes(suite), `canonical test runner must include ${suite}`);
}

// Generic ability action owns dispatch; legacy names are normalization-only and not available actions.
world = fresh();
const mara = world.entities.hoodedWoman;
mara.locationId = "tavernEntrance"; mara.sublocationId = "tavernEntranceFloor";
const maraActions = setup.CharacterAPI.getAvailableActions("hoodedWoman");
assert(maraActions.use_ability && maraActions.use_ability.options.ability_ids.includes("readAura") && !maraActions.read_aura,
    "Read aura must be exposed only through canonical use_ability");
const legacyNormalized = ok(setup.CharacterAPI.validateActionRequest("hoodedWoman", { type: "read_aura" }), "legacy aura normalization");
assert(legacyNormalized.action.type === "use_ability" && legacyNormalized.action.ability_id === "readAura",
    "legacy read_aura spelling should normalize narrowly to one owned ability");
const invalidAbility = setup.CharacterAPI.perform("hoodedWoman", { type: "use_ability", ability_id: "playSopilka" });
assert(!invalidAbility.ok, "unowned ability ID must be rejected");

// Shared consumption primitive supports transform and remove semantics without emitting presentation itself.
world = setup.Game.getWorld();
const mugId = world.inventories[world.entities.player.inventoryId].itemIds.find(id => world.entities[id] && world.entities[id].definitionId === "emptyMug");
if (mugId) {
    setup.GameInternals.transformItem(world.entities[mugId], "mugOfAle", world);
    const beforeEvents = world.events.length;
    const consumed = ok(setup.GameInternals.applyItemConsume(mugId, world), "shared mug consumption primitive");
    assert(consumed.value.resultType === "transform" && world.entities[mugId].definitionId === "emptyMug" && world.events.length === beforeEvents,
        "applyItemConsume must mutate canonical item state without inherently narrating");
}

console.log("All hardening consistency tests passed.");
