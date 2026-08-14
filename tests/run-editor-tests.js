"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "editor/world-editor.html"), "utf8");
const match = html.match(/<script id="world-editor-core">([\s\S]*?)<\/script>/);
if (!match) throw new Error("Editor core script was not found.");
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(match[1], context, { filename: "world-editor-core.js" });
const core = context.globalThis.WorldEditorCore;
function assert(condition, message) { if (!condition) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hasError(doc, text) { return core.validateWorldDocument(doc).some(function (item) { return item.message.includes(text); }); }

function validDocument() {
    return {
        schemaVersion: 2, startLocationId: "room", futureTopLevel: { retained: true },
        protectedLocationIds: [], protectedSublocationIds: [], protectedCharacterIds: [], protectedAbilityIds: [],
        locations: { room: { id: "room", type: "location", name: "Room", passage: "Room", description: ["A room."],
            defaultSublocationId: "roomFloor", inventoryId: "inventory_room", exits: {}, futureLocationField: "keep",
            sublocations: { roomFloor: { id: "roomFloor", type: "sublocation", locationId: "room", name: "Floor",
                enterLabel: "Stand", selfText: "You stand.", occupantTemplate: "{name} stands.", capacity: 4,
                reachableSublocationIds: ["roomFloor"], futureSublocationField: 42 } } } },
        characters: { hero: { id: "hero", name: "Hero", playerDescription: "A traveller.", interactionLabel: "Speak",
            aiDescription: "You are a traveller.", locationId: "room", sublocationId: "roomFloor", inventoryId: "inventory_hero",
            wallet: 1, initialControllerId: "human", defaultControllerId: "dummy", abilityIds: ["readAura"],
            engineFacts: { aura: "Bright." }, futureCharacterField: true,
            initialMind: { knownFacts: [{ id: "fact", text: "Known", futureFact: 1 }], beliefs: [], relationships: [],
                recentMemories: [], longTermMemories: [] } } },
        abilities: { readAura: { id: "readAura", name: "Read aura", actionType: "read_aura",
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
assert(html.includes("Characters") && html.includes("Abilities") && html.includes("Item types") &&
    html.includes("Items") && html.includes("Consumable") && html.includes("Fillable") &&
    html.includes("Location inventory") && html.includes("Items in this container") && html.includes("renderEmbeddedInventory") &&
    html.includes("Generic blocked transition") && html.includes("Lock ID") && html.includes("Key lock ID") &&
    html.includes("Generic use interaction") && html.includes("Engine effect") && html.includes("Public action text") &&
    html.includes("Locked failure text") && html.includes("localStorage.setItem"),
    "editor should expose character, ability, item-type, global item-instance, and embedded inventory workflows");
assert(!/[А-Яа-яЁё]/.test(html), "visible editor source introduced by this task should remain English-only");
assert(core.SCHEMA_VERSION === 2 && core.KNOWN_ACTIONS.includes("read_aura") && core.KNOWN_ACTIONS.includes("lock") && core.KNOWN_ACTIONS.includes("unlock") &&
    core.KNOWN_ITEM_EFFECTS.includes("report_memory_counts") && core.KNOWN_ITEM_EFFECTS.includes("abstract_study") && core.KNOWN_ITEM_EFFECTS.includes("utility_query"),
    "editor should embed schema 2, known actions, and the allowlisted generic item effects");
assert(core.validateWorldDocument(validDocument()).length === 0, "valid schema 2 document should validate");
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
assert(hasError(badUtilityQuery, "utility query requires"), "editor should reject utility-query authoring without a source prompt");
const badUtilityCap = clone(utilityQueryDocument); badUtilityCap.itemDefinitions.memoryStone.useAction.utilityMaxTokens = 12;
assert(hasError(badUtilityCap, "output token cap"), "editor should reject invalid utility-query output token caps");
const badUseEffect = clone(useActionDocument); badUseEffect.itemDefinitions.memoryStone.useAction.effectId = "execute_code";
assert(hasError(badUseEffect, "invalid use action"), "editor must reject unknown item effect IDs");
const mismatchedLock = clone(lockDocument); mismatchedLock.locations.other.exits.room.locked = false;
assert(hasError(mismatchedLock, "inconsistent reciprocal lock"), "reciprocal passage lock states must match");
const badKeyLock = clone(lockDocument); badKeyLock.itemDefinitions.roomKey.keyLockId = "missing_lock";
assert(hasError(badKeyLock, "invalid key lock ID"), "keys must reference an authored passage lock ID");
assert(core.createEmptyWorld().characters && core.createEmptyWorld().abilities &&
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
const roundTrip = JSON.parse(core.serializeWorldDocument(edited));
assert(roundTrip.characters.hero.playerDescription === "Edited public description.", "character edits should export");
assert(roundTrip.abilities.readAura.aiDescription === "Edited private instructions.", "ability edits should export");
assert(roundTrip.itemDefinitions.emptyMug.fillAction.actionLabel === "Fill this mug" &&
    roundTrip.itemDefinitions.emptyMug.description === "A plain wooden mug." &&
    roundTrip.itemDefinitions.emptyMug.useAction.effectId === "report_memory_counts" &&
    roundTrip.items.mug1.inventoryId === "inventory_room", "item edits including generic use effects should export");
assert(roundTrip.futureTopLevel.retained && roundTrip.locations.room.futureLocationField === "keep" &&
    roundTrip.locations.room.sublocations.roomFloor.futureSublocationField === 42 &&
    roundTrip.characters.hero.futureCharacterField && roundTrip.characters.hero.initialMind.knownFacts[0].futureFact === 1 &&
    roundTrip.abilities.readAura.futureAbilityField, "unknown top-level and nested fields should survive export");

const duplicatePassage = validDocument();
duplicatePassage.locations.other = clone(duplicatePassage.locations.room); duplicatePassage.locations.other.id = "other";
duplicatePassage.locations.other.name = "Other"; duplicatePassage.locations.other.inventoryId = "inventory_other";
duplicatePassage.locations.other.defaultSublocationId = "otherFloor";
duplicatePassage.locations.other.sublocations = { otherFloor: Object.assign(clone(duplicatePassage.locations.room.sublocations.roomFloor), { id: "otherFloor", locationId: "other", reachableSublocationIds: ["otherFloor"] }) };
assert(hasError(duplicatePassage, "passage name") && hasError(duplicatePassage, "used more than once"), "duplicate passage names should block export");
const duplicateInventory = validDocument(); duplicateInventory.characters.hero.inventoryId = "inventory_room";
assert(hasError(duplicateInventory, "Inventory ID"), "inventory collisions should block export");
const badStart = validDocument(); badStart.startLocationId = "missing";
assert(hasError(badStart, "startLocationId"), "invalid start location should block export");
const badBlockedExit = clone(blockedExitDocument); badBlockedExit.locations.room.exits.other.blocked = "yes";
assert(hasError(badBlockedExit, "blocked must be checked or unchecked"), "blocked transition state must be Boolean");
const badBlockedTarget = clone(blockedExitDocument); badBlockedTarget.locations.room.exits.other.destinationId = "missing";
assert(hasError(badBlockedTarget, "missing location"), "blocked transitions must still reference a real destination");
const badPosition = validDocument(); badPosition.characters.hero.sublocationId = "missing";
assert(hasError(badPosition, "missing position"), "invalid character position should block export");
const zeroHuman = validDocument(); zeroHuman.characters.hero.initialControllerId = "dummy";
assert(hasError(zeroHuman, "Exactly one"), "zero initial humans should block export");
const twoHumans = validDocument(); twoHumans.characters.other = clone(twoHumans.characters.hero); twoHumans.characters.other.id = "other";
twoHumans.characters.other.inventoryId = "inventory_other";
assert(hasError(twoHumans, "Exactly one"), "multiple initial humans should block export");
const badAbility = validDocument(); badAbility.characters.hero.abilityIds = ["missing"];
assert(hasError(badAbility, "missing ability"), "invalid ability reference should block export");
const badAction = validDocument(); badAction.abilities.readAura.actionType = "execute_code";
assert(hasError(badAction, "unknown action"), "unknown ability action type should block export");
const badItemDefinition = validDocument(); badItemDefinition.itemDefinitions.emptyMug.fillAction.resultDefinitionId = "missing";
assert(hasError(badItemDefinition, "invalid fill action"), "missing item transformation target should block export");
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

console.log("All world editor tests passed.");
