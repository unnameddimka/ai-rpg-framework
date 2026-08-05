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
        protectedItemDefinitionIds: [], protectedItemIds: [],
        locations: { room: { id: "room", type: "location", name: "Room", passage: "Room", description: ["A room."],
            defaultSublocationId: "roomFloor", inventoryId: "inventory_room", exits: {}, futureLocationField: "keep",
            sublocations: { roomFloor: { id: "roomFloor", type: "sublocation", locationId: "room", name: "Floor",
                enterLabel: "Stand", selfText: "You stand.", occupantTemplate: "{name} stands.", capacity: 4,
                reachableSublocationIds: ["roomFloor"], environmentCapabilities: ["water_source"], futureSublocationField: 42 } } } },
        characters: { hero: { id: "hero", name: "Hero", playerDescription: "A traveller.", interactionLabel: "Speak",
            aiDescription: "You are a traveller.", locationId: "room", sublocationId: "roomFloor", inventoryId: "inventory_hero",
            wallet: 1, initialControllerId: "human", defaultControllerId: "dummy", abilityIds: ["readAura"],
            engineFacts: { aura: "Bright." }, futureCharacterField: true,
            initialMind: { knownFacts: [{ id: "fact", text: "Known", futureFact: 1 }], beliefs: [], relationships: [],
                recentMemories: [], longTermMemories: [] } } },
        abilities: { readAura: { id: "readAura", name: "Read aura", actionType: "read_aura",
            playerDescription: "Sense aura.", aiDescription: "Request grounded aura data.", futureAbilityField: true } },
        itemDefinitions: {
            emptyCup: { id: "emptyCup", name: "Empty cup", description: "An empty cup.", familyId: "cup", tags: ["container"],
                consumable: null, equippable: null, fillable: { actionLabel: "Fill with water", requiredEnvironmentCapability: "water_source",
                    resultDefinitionId: "waterCup", publicText: "{actor} fills the cup.", feedbackText: "You fill the cup." }, futureItemTypeField: "keep" },
            waterCup: { id: "waterCup", name: "Cup of water", description: "A cup filled with water.", familyId: "cup", tags: ["drink"],
                consumable: { actionLabel: "Drink", resultType: "transform", resultDefinitionId: "emptyCup",
                    publicText: "{actor} drinks the water.", feedbackText: "You drink the water." }, equippable: null, fillable: null }
        },
        items: { cup1: { id: "cup1", definitionId: "emptyCup", containerId: "inventory_room", futureItemField: true } }
    };
}

assert((html.match(/<!doctype html>/gi) || []).length === 1 && !/<script[^>]+src=|<link[^>]+href=/i.test(html),
    "editor should remain one self-contained offline HTML file");
assert(html.includes("Characters") && html.includes("Abilities") && html.includes("Item types") && html.includes("Items") && html.includes("localStorage.setItem"),
    "editor should expose character, ability, and item workflows and save their document in the local draft");
assert(!/[А-Яа-яЁё]/.test(html), "visible editor source introduced by this task should remain English-only");
assert(core.SCHEMA_VERSION === 2 && core.KNOWN_ACTIONS.includes("read_aura") && core.KNOWN_ACTIONS.includes("consume") && core.KNOWN_ACTIONS.includes("fill"), "editor should embed schema 2 and known actions");
assert(core.validateWorldDocument(validDocument()).length === 0, "valid schema 2 document should validate");
const authoredWorld = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
assert(core.validateWorldDocument(authoredWorld).length === 0, "the authoritative data/world.json should validate in the editor core");
assert(core.createEmptyWorld().characters && core.createEmptyWorld().abilities && core.createEmptyWorld().itemDefinitions && core.createEmptyWorld().items,
    "new document should include character, ability, and item catalogs");

const edited = validDocument();
edited.characters.hero.playerDescription = "Edited public description.";
edited.abilities.readAura.aiDescription = "Edited private instructions.";
const roundTrip = JSON.parse(core.serializeWorldDocument(edited));
assert(roundTrip.characters.hero.playerDescription === "Edited public description.", "character edits should export");
assert(roundTrip.abilities.readAura.aiDescription === "Edited private instructions.", "ability edits should export");
assert(roundTrip.futureTopLevel.retained && roundTrip.locations.room.futureLocationField === "keep" &&
    roundTrip.locations.room.sublocations.roomFloor.futureSublocationField === 42 &&
    roundTrip.characters.hero.futureCharacterField && roundTrip.characters.hero.initialMind.knownFacts[0].futureFact === 1 &&
    roundTrip.abilities.readAura.futureAbilityField && roundTrip.itemDefinitions.emptyCup.futureItemTypeField === "keep" &&
    roundTrip.items.cup1.futureItemField, "unknown top-level and nested fields should survive export");

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
const badItemDefinition = validDocument(); badItemDefinition.items.cup1.definitionId = "missing";
assert(hasError(badItemDefinition, "missing item definition"), "invalid item-definition reference should block export");
const badItemContainer = validDocument(); badItemContainer.items.cup1.containerId = "inventory_missing";
assert(hasError(badItemContainer, "missing inventory"), "invalid starting item container should block export");
const badConsumeResult = validDocument(); badConsumeResult.itemDefinitions.waterCup.consumable.resultDefinitionId = "missing";
assert(hasError(badConsumeResult, "consumable result references missing"), "invalid consume transition should block export");
const badFillResult = validDocument(); badFillResult.itemDefinitions.emptyCup.fillable.resultDefinitionId = "missing";
assert(hasError(badFillResult, "fill result references missing"), "invalid fill transition should block export");


const referenced = validDocument();
assert(core.locationDeletionReferences(referenced, "room").some(function (x) { return x.includes("start"); }), "start location deletion should be blocked");
assert(core.sublocationDeletionReferences(referenced.locations.room, "roomFloor", referenced).some(function (x) { return x.includes("hero"); }), "character position should block sublocation deletion");
assert(core.abilityDeletionReferences(referenced, "readAura").some(function (x) { return x.includes("hero"); }), "assigned ability deletion should be blocked");
assert(core.itemDefinitionDeletionReferences(referenced, "emptyCup").some(function (x) { return x.includes("cup1") || x.includes("waterCup"); }),
    "item type deletion should be blocked by instances or transitions");
referenced.characters.other = clone(referenced.characters.hero); referenced.characters.other.id = "other";
referenced.characters.other.inventoryId = "inventory_other"; referenced.characters.other.initialControllerId = "dummy";
referenced.characters.other.initialMind.relationships = [{ targetCharacterId: "hero", summary: "Knows hero." }];
assert(core.characterDeletionReferences(referenced, "hero").some(function (x) { return x.includes("other"); }), "relationship target deletion should be blocked");

console.log("All world editor tests passed.");
