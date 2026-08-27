"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "editor/world-editor.html"), "utf8");
const validatorMatch = html.match(/<script id="world-authored-validator">([\s\S]*?)<\/script>/);
const match = html.match(/<script id="world-editor-core">([\s\S]*?)<\/script>/);
if (!validatorMatch || !match) throw new Error("Editor shared validator/core script was not found.");
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(validatorMatch[1], context, { filename: "world-authored-validator.js" });
vm.runInContext(match[1], context, { filename: "world-editor-core.js" });
const core = context.globalThis.WorldEditorCore;
function assert(condition, message) { if (!condition) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hasError(doc, text) { return core.validateWorldDocument(doc).some(function (item) { return item.message.includes(text); }); }

function validDocument() {
    return {
        schemaVersion: 2, startLocationId: "room", futureTopLevel: { retained: true },
        protectedLocationIds: [], protectedSublocationIds: [], protectedCharacterIds: [], protectedAbilityIds: [],
        dayActivities: {},
        locations: { room: { id: "room", type: "location", name: "Room", passage: "Room", description: ["A room."],
            defaultSublocationId: "roomFloor", inventoryId: "inventory_room", exits: {}, futureLocationField: "keep",
            sublocations: { roomFloor: { id: "roomFloor", type: "sublocation", locationId: "room", name: "Floor",
                enterLabel: "Stand", selfText: "You stand.", occupantTemplate: "{name} stands.", capacity: 4,
                reachableSublocationIds: ["roomFloor"], futureSublocationField: 42 } } } },
        characters: { hero: { id: "hero", name: "Hero", playerDescription: "A traveller.", interactionLabel: "Speak",
            aiDescription: "You are a traveller.", locationId: "room", sublocationId: "roomFloor", inventoryId: "inventory_hero",
            wallet: 1, initialControllerId: "human", defaultControllerId: "dummy", abilityIds: ["readAura"],
            engineFacts: { aura: "Bright." }, futureCharacterField: true,
            initialMind: { schemaVersion: 3, knownFacts: [{ id: "fact", text: "Known", futureFact: 1 }], beliefs: [], relationships: [],
                verbatimObservations: [], shortTermMemories: [], longTermMemories: [] } } },
        abilities: { readAura: { id: "readAura", name: "Read aura", actionType: "use_ability", effectType: "read_aura",
            playerDescription: "Sense aura.", aiDescription: "Request grounded aura data.", futureAbilityField: true } },
        itemDefinitions: {
            emptyMug: { id: "emptyMug", name: "Empty mug", familyId: "mug", tags: ["empty"],
                consumable: false, equippable: false, fillable: true,
                fillAction: { actionLabel: "Fill with ale", requiredEnvironmentCapability: "ale_source",
                    resultDefinitionId: "mugOfAle", feedbackText: "Filled." } },
            mugOfAle: { id: "mugOfAle", name: "Mug of ale", familyId: "mug", tags: ["filled"],
                consumable: true, equippable: false, fillable: false,
                consumeAction: { actionLabel: "Drink the ale", resultType: "transform",
                    resultDefinitionId: "emptyMug", feedbackText: "Drank." } }
        },
        items: {
            mug1: { id: "mug1", definitionId: "emptyMug", inventoryId: "inventory_hero" }
        }
    };
}

assert((html.match(/<!doctype html>/gi) || []).length === 1 && !/<script[^>]+src=|<link[^>]+href=/i.test(html),
    "editor should remain one self-contained offline HTML file");
assert(html.includes("Characters") && !html.includes("Traveler profiles") && html.includes("Abilities") && html.includes("Item types") &&
    html.includes("Items") && html.includes("Secrets") && html.includes("Random outcomes") && html.includes("Triggered events") && html.includes("Consumable") && html.includes("Fillable") &&
    html.includes("Location inventory") && html.includes("Items in this container") && html.includes("renderEmbeddedInventory") &&
    html.includes("Generic blocked transition") && html.includes("Lock ID") && html.includes("Key lock ID") &&
    html.includes("Generic use interaction") && html.includes("Phase-aware serving actions") && html.includes("Ability effect type") && html.includes("Engine effect") && html.includes("Public action text") &&
    html.includes("Locked failure text") && html.includes("Required key item") && html.includes("Requires discovery") && html.includes("Initially discovered secret locations") &&
    html.includes("Presence owner") && html.includes("Presence fallback location") && html.includes("Auto (single external exit)") && html.includes("Auto (parent default position)") && html.includes("localStorage.setItem"),
    "editor should expose character, ability, item-type, global item-instance, and embedded inventory workflows");
assert(!/[А-Яа-яЁё]/.test(html), "visible editor source introduced by this task should remain English-only");
assert(core.SCHEMA_VERSION === 2 && core.KNOWN_ACTIONS.includes("use_ability") && core.KNOWN_ACTIONS.includes("lock") && core.KNOWN_ACTIONS.includes("unlock") &&
    core.KNOWN_ITEM_EFFECTS.includes("report_memory_counts") && core.KNOWN_ITEM_EFFECTS.includes("abstract_study") && core.KNOWN_ITEM_EFFECTS.includes("utility_query"),
    "editor should embed schema 2, known actions, and the allowlisted generic item effects");
assert(html.includes("Short-term memories") && html.includes("Verbatim observations") && html.includes("Retrieval brief") && !html.includes("Recent memories"),
    "editor character mind UI should expose Mind v3 memory layers and retrieval briefs, not legacy recentMemories");
assert(core.validateWorldDocument(validDocument()).length === 0, "valid schema 2 document should validate");

const secretLocationDocument = validDocument();
secretLocationDocument.locations.glen = clone(secretLocationDocument.locations.room);
secretLocationDocument.locations.glen.id = "glen";
secretLocationDocument.locations.glen.name = "Hidden Glen";
secretLocationDocument.locations.glen.passage = "Hidden Glen";
secretLocationDocument.locations.glen.inventoryId = "inventory_glen";
secretLocationDocument.locations.glen.requiresDiscovery = true;
secretLocationDocument.locations.glen.defaultSublocationId = "glenFloor";
secretLocationDocument.locations.glen.exits = { room: "room" };
secretLocationDocument.locations.glen.sublocations = { glenFloor: Object.assign(clone(secretLocationDocument.locations.room.sublocations.roomFloor), { id: "glenFloor", locationId: "glen", reachableSublocationIds: ["glenFloor"] }) };
secretLocationDocument.locations.room.exits = { glen: "glen" };
secretLocationDocument.characters.hero.initialDiscoveredLocationIds = ["glen"];
secretLocationDocument.dayActivities.secretHunt = {
    id: "secretHunt", name: "Secret hunt", kind: "solo", entryLocationId: "room", workLocationId: "room",
    entryActionLabel: "Hunt", narrationInstructions: "Describe a quiet hunting day.", settlement: { type: "random_items", definitionId: "emptyMug", minTotal: 1, maxTotal: 1 },
    completionDiscovery: { locationId: "glen", chance: 0.1, observationText: "{actorName} notices a concealed way to {locationName}." }
};
const secretLocationErrors = core.validateWorldDocument(secretLocationDocument);
assert(secretLocationErrors.length === 0,
    "editor/shared validator should accept per-character initial discovery and generic daytime completion-discovery authoring: " + JSON.stringify(secretLocationErrors));
const badInitialDiscovery = clone(secretLocationDocument); badInitialDiscovery.characters.hero.initialDiscoveredLocationIds = ["room"];
assert(hasError(badInitialDiscovery, "requiresDiscovery") || hasError(badInitialDiscovery, "secret"),
    "initial discovered-location authoring must reference an actual discoverable location");
const badCompletionDiscovery = clone(secretLocationDocument); badCompletionDiscovery.dayActivities.secretHunt.completionDiscovery.chance = 1.5;
assert(hasError(badCompletionDiscovery, "chance"), "day-activity discovery chance must stay in the valid probability range");

const routineDocument = validDocument();
routineDocument.characters.hero.routineAnchors = { evening: { locationId: "room", sublocationId: "roomFloor" } };
assert(core.validateWorldDocument(routineDocument).length === 0, "editor should validate authored character routine anchors");
const badRoutine = clone(routineDocument); badRoutine.characters.hero.routineAnchors.evening.sublocationId = "missing";
assert(hasError(badRoutine, "routine anchor") || hasError(badRoutine, "sublocation"), "routine anchors must reference an authored position in the selected location");
const blockedExitDocument = validDocument();
blockedExitDocument.locations.other = clone(blockedExitDocument.locations.room);
blockedExitDocument.locations.other.id = "other";
blockedExitDocument.locations.other.name = "Other";
blockedExitDocument.locations.other.passage = "Other";
blockedExitDocument.locations.other.inventoryId = "inventory_other";
blockedExitDocument.locations.other.defaultSublocationId = "otherFloor";
blockedExitDocument.locations.other.exits = { room: "room" };
blockedExitDocument.locations.other.sublocations = { otherFloor: Object.assign(clone(blockedExitDocument.locations.room.sublocations.roomFloor), { id: "otherFloor", locationId: "other", reachableSublocationIds: ["otherFloor"] }) };
blockedExitDocument.locations.room.exits = { other: { destinationId: "other", blocked: true, blockedReason: "The door is locked." } };
assert(core.validateWorldDocument(blockedExitDocument).length === 0 &&
    core.exitTarget(blockedExitDocument.locations.room.exits.other) === "other" &&
    core.exitRecord(blockedExitDocument.locations.room.exits.other).blocked === true,
    "editor should validate and preserve blocked transition records alongside legacy string exits");
const lockDocument = clone(blockedExitDocument);
lockDocument.locations.room.exits.other = { destinationId: "other", lockId: "room_lock", locked: true, lockedReason: "Locked." };
lockDocument.locations.other.exits.room = { destinationId: "room", lockId: "room_lock", locked: true, lockedReason: "Locked." };
lockDocument.itemDefinitions.roomKey = { id: "roomKey", name: "Room key", familyId: "key", tags: ["key"],
    consumable: false, equippable: false, fillable: false, keyLockId: "room_lock" };
assert(core.validateWorldDocument(lockDocument).length === 0 &&
    core.exitRecord(lockDocument.locations.room.exits.other).lockId === "room_lock" &&
    core.exitRecord(lockDocument.locations.room.exits.other).locked === true,
    "editor should validate reciprocal passage locks and key-to-lock definitions");
const useActionDocument = validDocument();
useActionDocument.itemDefinitions.memoryStone = {
    id: "memoryStone", name: "Memory Stone", description: "A smooth dark stone.", familyId: "memory_stone", tags: ["magical"],
    consumable: false, equippable: false, fillable: false,
    useAction: { actionLabel: "Squeeze in hand", effectId: "report_memory_counts",
        publicText: "{actorName} squeezes the memory stone.",
        feedbackText: "Short-term memory: {shortTermCount} {shortTermEntryWord}. Long-term memory: {longTermCount} {longTermEntryWord}." }
};
useActionDocument.items.memoryStone_01 = { id: "memoryStone_01", definitionId: "memoryStone", inventoryId: "inventory_room" };
assert(core.validateWorldDocument(useActionDocument).length === 0,
    "editor should validate an authored generic item-use action using an allowlisted deterministic effect");

const abstractStudyDocument = clone(useActionDocument);
abstractStudyDocument.itemDefinitions.memoryStone.useAction = {
    actionLabel: "Study archive", effectId: "abstract_study", publicText: "{actorName} studies {itemName}.",
    feedbackText: "You survey material relevant to {inputText}.",
    focusedFeedbackText: "You study {inputText} in greater depth.",
    saturatedFeedbackText: "Further reading on {inputText} now has diminishing returns.",
    inputLabel: "Subject", inputPlaceholder: "Study", inputMaxLength: 500,
    aiInstructions: "Put the desired subject in action.input_text."
};
assert(core.validateWorldDocument(abstractStudyDocument).length === 0,
    "editor should validate deterministic abstract-study text-input authoring without a Utility prompt");
const badAbstractFocused = clone(abstractStudyDocument); badAbstractFocused.itemDefinitions.memoryStone.useAction.focusedFeedbackText = "";
assert(hasError(badAbstractFocused, "focusedFeedbackText"), "editor should reject blank focused-stage abstract-study feedback when authored");
const badAbstractSaturated = clone(abstractStudyDocument); badAbstractSaturated.itemDefinitions.memoryStone.useAction.saturatedFeedbackText = "";
assert(hasError(badAbstractSaturated, "saturatedFeedbackText"), "editor should reject blank saturated-stage abstract-study feedback when authored");
const utilityQueryDocument = clone(useActionDocument);
utilityQueryDocument.itemDefinitions.memoryStone.useAction = {
    actionLabel: "Consult archive", effectId: "utility_query", publicText: "{actorName} consults {itemName}.",
    feedbackText: "Archive entry for {inputText}: {result}", inputLabel: "Question", inputPlaceholder: "Ask", inputMaxLength: 500, utilityMaxTokens: 240,
    utilityPrompt: "Return non-character reference information.", aiInstructions: "Put the desired subject in action.input_text."
};
assert(core.validateWorldDocument(utilityQueryDocument).length === 0,
    "editor should validate model-backed Utility query item authoring");
const badUtilityQuery = clone(utilityQueryDocument); delete badUtilityQuery.itemDefinitions.memoryStone.useAction.utilityPrompt;
assert(hasError(badUtilityQuery, "utility_query useAction requires utilityPrompt"), "editor should reject utility-query authoring without a source prompt");
const badUtilityCap = clone(utilityQueryDocument); badUtilityCap.itemDefinitions.memoryStone.useAction.utilityMaxTokens = 12;
assert(hasError(badUtilityCap, "utilityMaxTokens"), "editor should reject invalid utility-query output token caps");
const badUseEffect = clone(useActionDocument); badUseEffect.itemDefinitions.memoryStone.useAction.effectId = "execute_code";
assert(hasError(badUseEffect, "invalid useAction"), "editor must reject unknown item effect IDs");
const mismatchedLock = clone(lockDocument); mismatchedLock.locations.other.exits.room.locked = false;
assert(hasError(mismatchedLock, "inconsistent reciprocal lock"), "reciprocal passage lock states must match");
const badKeyLock = clone(lockDocument); badKeyLock.itemDefinitions.roomKey.keyLockId = "missing_lock";
assert(hasError(badKeyLock, "invalid keyLockId"), "keys must reference an authored passage lock ID");
const keyedContainerDocument = validDocument();
keyedContainerDocument.locations.room.sublocations.roomFloor.inventoryId = "inventory_floor";
keyedContainerDocument.locations.room.sublocations.roomFloor.requiredKeyItemId = "floorKey";
keyedContainerDocument.itemDefinitions.floorKeyType = { id:"floorKeyType", name:"Floor key", familyId:"key", tags:["key"], consumable:false, equippable:false, fillable:false };
keyedContainerDocument.items.floorKey = { id:"floorKey", definitionId:"floorKeyType", inventoryId:"inventory_hero" };
assert(core.validateWorldDocument(keyedContainerDocument).length === 0, "editor should validate a position inventory gated by a specific ordinary key item instance");
const missingContainerKey = clone(keyedContainerDocument); delete missingContainerKey.items.floorKey;
assert(hasError(missingContainerKey, "references missing required key item"), "editor should reject a keyed container whose required key item instance does not exist");
const keyedWithoutInventory = clone(keyedContainerDocument); delete keyedWithoutInventory.locations.room.sublocations.roomFloor.inventoryId;
assert(hasError(keyedWithoutInventory, "cannot require a key without an inventory"), "editor should reject requiredKeyItemId when the position has no inventory");
assert(core.createEmptyWorld().characters && !Object.prototype.hasOwnProperty.call(core.createEmptyWorld(), "travelerProfiles") && core.createEmptyWorld().abilities &&
    core.createEmptyWorld().itemDefinitions && core.createEmptyWorld().items,
    "new document should include character, ability, item-definition, and item catalogs");
const inventoryHelpers = validDocument();
assert(core.itemsInInventory(inventoryHelpers, "inventory_hero").map(function (item) { return item.id; }).join(",") === "mug1",
    "embedded inventory views should read the same flat item instances used by the global Items catalog");
inventoryHelpers.items.emptyMug_1 = { id: "emptyMug_1", definitionId: "emptyMug", inventoryId: "inventory_room" };
assert(core.generateItemInstanceId(inventoryHelpers, "emptyMug") === "emptyMug_2",
    "adding through an embedded inventory should generate a unique flat item-instance ID");
assert(core.inventoryRemovalReferences(inventoryHelpers, "inventory_room").some(function (x) { return x.includes("emptyMug_1"); }),
    "nonempty inventories should report blocking item references before their container is removed");

const edited = validDocument();
edited.characters.hero.playerDescription = "Edited public description.";
edited.abilities.readAura.aiDescription = "Edited private instructions.";
edited.itemDefinitions.emptyMug.fillAction.actionLabel = "Fill this mug";
edited.itemDefinitions.emptyMug.description = "A plain wooden mug.";
edited.itemDefinitions.emptyMug.useAction = { actionLabel: "Inspect memory", effectId: "report_memory_counts",
    publicText: "{actorName} holds {itemName}.", feedbackText: "Short-term memory: {shortTermCount} {shortTermEntryWord}. Long-term memory: {longTermCount} {longTermEntryWord}." };
edited.items.mug1.inventoryId = "inventory_room";
edited.locations.room.sublocations.roomFloor.inventoryId = "inventory_floor";
edited.locations.room.sublocations.roomFloor.requiredKeyItemId = "floorKey";
edited.itemDefinitions.floorKeyType = { id:"floorKeyType", name:"Floor key", familyId:"key", tags:["key"], consumable:false, equippable:false, fillable:false };
edited.items.floorKey = { id:"floorKey", definitionId:"floorKeyType", inventoryId:"inventory_hero" };
const roundTrip = JSON.parse(core.serializeWorldDocument(edited));
assert(roundTrip.characters.hero.playerDescription === "Edited public description.", "character edits should export");
assert(roundTrip.abilities.readAura.aiDescription === "Edited private instructions.", "ability edits should export");
assert(roundTrip.itemDefinitions.emptyMug.fillAction.actionLabel === "Fill this mug" &&
    roundTrip.itemDefinitions.emptyMug.description === "A plain wooden mug." &&
    roundTrip.itemDefinitions.emptyMug.useAction.effectId === "report_memory_counts" &&
    roundTrip.items.mug1.inventoryId === "inventory_room" &&
    roundTrip.locations.room.sublocations.roomFloor.requiredKeyItemId === "floorKey" && roundTrip.items.floorKey.inventoryId === "inventory_hero", "item edits including generic use effects and keyed-container authoring should export");
assert(roundTrip.futureTopLevel.retained && roundTrip.locations.room.futureLocationField === "keep" &&
    roundTrip.locations.room.sublocations.roomFloor.futureSublocationField === 42 &&
    roundTrip.characters.hero.futureCharacterField && roundTrip.characters.hero.initialMind.knownFacts[0].futureFact === 1 &&
    roundTrip.abilities.readAura.futureAbilityField, "unknown top-level and nested fields should survive export");

const duplicatePassage = validDocument();
duplicatePassage.locations.other = clone(duplicatePassage.locations.room); duplicatePassage.locations.other.id = "other";
duplicatePassage.locations.other.name = "Other"; duplicatePassage.locations.other.inventoryId = "inventory_other";
duplicatePassage.locations.other.defaultSublocationId = "otherFloor";
duplicatePassage.locations.other.sublocations = { otherFloor: Object.assign(clone(duplicatePassage.locations.room.sublocations.roomFloor), { id: "otherFloor", locationId: "other", reachableSublocationIds: ["otherFloor"] }) };
assert(hasError(duplicatePassage, "Duplicate passage name"), "duplicate passage names should block export");
const duplicateInventory = validDocument(); duplicateInventory.characters.hero.inventoryId = "inventory_room";
assert(hasError(duplicateInventory, "Duplicate inventory ID"), "inventory collisions should block export");
const badStart = validDocument(); badStart.startLocationId = "missing";
assert(hasError(badStart, "startLocationId"), "invalid start location should block export");
const badBlockedExit = clone(blockedExitDocument); badBlockedExit.locations.room.exits.other.blocked = "yes";
assert(hasError(badBlockedExit, "blocked must be Boolean"), "blocked transition state must be Boolean");
const badBlockedTarget = clone(blockedExitDocument); badBlockedTarget.locations.room.exits.other.destinationId = "missing";
assert(hasError(badBlockedTarget, "missing location"), "blocked transitions must still reference a real destination");
const badPosition = validDocument(); badPosition.characters.hero.sublocationId = "missing";
assert(hasError(badPosition, "invalid sublocation"), "invalid character position should block export");
const zeroHuman = validDocument(); zeroHuman.characters.hero.initialControllerId = "dummy";
assert(hasError(zeroHuman, "Exactly one"), "zero initial humans should block export");
const twoHumans = validDocument(); twoHumans.characters.other = clone(twoHumans.characters.hero); twoHumans.characters.other.id = "other";
twoHumans.characters.other.inventoryId = "inventory_other";
assert(hasError(twoHumans, "Exactly one"), "multiple initial humans should block export");
const badAbility = validDocument(); badAbility.characters.hero.abilityIds = ["missing"];
assert(hasError(badAbility, "missing ability"), "invalid ability reference should block export");
const badAction = validDocument(); badAction.abilities.readAura.actionType = "execute_code";
assert(hasError(badAction, "canonical actionType") || hasError(badAction, "use_ability"), "non-canonical ability action type should block export");
const badItemDefinition = validDocument(); badItemDefinition.itemDefinitions.emptyMug.fillAction.resultDefinitionId = "missing";
assert(hasError(badItemDefinition, "missing result definition"), "missing item transformation target should block export");
const badItemInventory = validDocument(); badItemInventory.items.mug1.inventoryId = "missing_inventory";
assert(hasError(badItemInventory, "missing inventory"), "item instances must reference a real inventory");

const referenced = validDocument();
assert(core.locationDeletionReferences(referenced, "room").some(function (x) { return x.includes("start"); }), "start location deletion should be blocked");
assert(core.sublocationDeletionReferences(referenced.locations.room, "roomFloor", referenced).some(function (x) { return x.includes("hero"); }), "character position should block sublocation deletion");
assert(core.abilityDeletionReferences(referenced, "readAura").some(function (x) { return x.includes("hero"); }), "assigned ability deletion should be blocked");
assert(core.itemDefinitionDeletionReferences(referenced, "emptyMug").some(function (x) { return x.includes("mug1"); }),
    "item instances should block deletion of their item definition");
referenced.characters.other = clone(referenced.characters.hero); referenced.characters.other.id = "other";
referenced.characters.other.inventoryId = "inventory_other"; referenced.characters.other.initialControllerId = "dummy";
referenced.characters.other.initialMind.relationships = [{ targetCharacterId: "hero", summary: "Knows hero." }];
assert(core.characterDeletionReferences(referenced, "hero").some(function (x) { return x.includes("other"); }), "relationship target deletion should be blocked");
assert(core.characterDeletionReferences(referenced, "hero").some(function (x) { return x.includes("mug1"); }),
    "deleting a character with item instances in its inventory should be blocked");
const locationItems = validDocument();
locationItems.items.mug1.inventoryId = "inventory_room";
assert(core.locationDeletionReferences(locationItems, "room").some(function (x) { return x.includes("mug1"); }),
    "deleting a location with item instances in its inventory should be blocked");
const sublocationItems = validDocument();
sublocationItems.locations.room.sublocations.roomFloor.inventoryId = "inventory_floor";
sublocationItems.items.mug1.inventoryId = "inventory_floor";
assert(core.sublocationDeletionReferences(sublocationItems.locations.room, "roomFloor", sublocationItems).some(function (x) { return x.includes("mug1"); }),
    "deleting a position with a nonempty optional inventory should be blocked");

const committedWorldDocument = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
assert(core.validateWorldDocument(committedWorldDocument).length === 0,
    "the current committed data/world.json must validate through the same authored validator embedded in the editor");
const committedRoundTrip = JSON.parse(core.serializeWorldDocument(committedWorldDocument));
assert(committedRoundTrip.secrets.chugaister && committedRoundTrip.secrets.old_well &&
    committedRoundTrip.randomOutcomeTables.oldWellBucketDraw && committedRoundTrip.randomOutcomeTables.soloHuntingMystery &&
    committedRoundTrip.triggeredEvents.chuhaisterFoodAppearance && committedRoundTrip.triggeredEvents.chuhaisterHideAtTimelapse &&
    committedRoundTrip.characters.chugaister.deferredActivation === true && committedRoundTrip.characters.chugaister.movementConstraint.locationId === "trampledGlade" &&
    committedRoundTrip.abilities.playSopilka.actionType === "use_ability" && committedRoundTrip.abilities.playSopilka.effectType === "emit_location_observation" &&
    committedRoundTrip.itemDefinitions.bowlOfBanush.consumeAction.resultDefinitionId === "emptyBowl" &&
    committedRoundTrip.locations.bar.sublocations.barKitchen.servingActions.some(function (record) { return record.id === "serveBanush" && record.requiredDishDefinitionId === "emptyBowl"; }),
    "current secrets, random outcomes, triggered events, activation/mobility, abilities, food transforms, and serving authoring must survive editor round-trip");
assert(core.locationDeletionReferences(committedWorldDocument, "trampledGlade").some(function (x) { return x.includes("triggeredEvents") || x.includes("movementConstraint"); }),
    "editor reference graph should surface triggered/mobility references before deleting Trampled Glade");
assert(core.characterDeletionReferences(committedWorldDocument, "chugaister").some(function (x) { return x.includes("triggeredEvents"); }),
    "editor reference graph should surface triggered-event references before deleting Chuhaister");
assert(core.abilityDeletionReferences(committedWorldDocument, "playSopilka").some(function (x) { return x.includes("chugaister"); }),
    "editor should block deleting an ability still assigned to Chuhaister");
assert(core.itemDefinitionDeletionReferences(committedWorldDocument, "emptyBowl").some(function (x) { return x.includes("requiredDishDefinitionId") || x.includes("resultDefinitionId"); }),
    "editor reference graph should surface serving/consume references before deleting reusable bowl definition");
assert(core.referencePaths(committedWorldDocument, "secret", "chugaister").some(function (x) { return x.includes("triggeredEvents.chuhaisterFoodAppearance.secretId"); }),
    "editor secret deletion should understand triggered-event secret ownership");

console.log("All world editor tests passed.");
