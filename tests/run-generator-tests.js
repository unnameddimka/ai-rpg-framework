"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
const activeReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const activeStory = fs.readFileSync(path.join(root, "src/story.twee"), "utf8");
const activeUi = fs.readFileSync(path.join(root, "src/30-game-ui.js"), "utf8");
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(activeReadme.includes("Mallowstead"),
    "active project documentation should identify the current Mallowstead product");
assert(/^:: StoryTitle\s*\nMallowstead\s*$/m.test(activeStory),
    "current SugarCube StoryTitle/save identity must be Mallowstead");
assert(activeUi.includes('setup.BuildInfo && setup.BuildInfo.productName || "Mallowstead"'),
    "runtime display identity should use build metadata with a Mallowstead fallback");
const productTitlePostprocess = fs.readFileSync(path.join(root, "tools/postprocess-product-title.js"), "utf8");
const windowsBuildSource = fs.readFileSync(path.join(root, "build.bat"), "utf8");
assert(/postprocess-product-title\.js/i.test(windowsBuildSource),
    "Windows build.bat must apply the same Mallowstead/save-compatibility postprocess as build.sh");
assert(productTitlePostprocess.includes('BuildProfile.product.productName') && productTitlePostprocess.includes('BuildProfile.product.legacySaveIds'),
    "build postprocessing must derive the current product title and legacy save IDs from shared product metadata");
const postprocessModule = require(path.join(root, "tools/postprocess-product-title.js"));
const sugarCubeFixture = '<title>Old</title>...if(save.id!==Config.saves.id)throw new Error(L10n.get("saveErrorIdMismatch"));...';
const patchedSugarCubeFixture = postprocessModule.postprocessHtml(sugarCubeFixture);
assert(patchedSugarCubeFixture.includes('<title>Mallowstead</title>') &&
    patchedSugarCubeFixture.includes('save.id!==Config.saves.id&&save.id!=="ai-rpg-framework-mvp"&&save.id!=="ai-rpg-framework-poc"'),
    "Mallowstead build postprocessing should accept both MVP and POC save payloads while preserving the current save-ID guard");
assert(activeUi.includes("Remember for 7 days") && activeUi.includes("Key saved for 7 days.") && !activeUi.includes("Remember for 24 hours"),
    "current UI must describe the seven-day persisted API-key retention period");
const fallbackBuilderSource = fs.readFileSync(path.join(root, "tools/build-from-existing-runtime.js"), "utf8");
assert(fallbackBuilderSource.includes("embedded story-name bootstrap") && fallbackBuilderSource.includes("generateName"),
    "fallback build must rewrite SugarCube's embedded story-name bootstrap when StoryTitle changes");
assert(postprocessModule.postprocessHtml(patchedSugarCubeFixture) === patchedSugarCubeFixture,
    "legacy save-ID postprocessing should be idempotent when fallback builds reuse an already-patched SugarCube runtime");

function rejects(mutator, expected) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-rpg-generator-"));
    try {
        const document = clone(source); mutator(document);
        const input = path.join(directory, "world.json");
        fs.writeFileSync(input, JSON.stringify(document), "utf8");
        const result = childProcess.spawnSync(process.execPath, [
            path.join(root, "tools/generate-world-data.js"), "--input", input,
            "--output", path.join(directory, "data.js"), "--passages", path.join(directory, "passages.twee"),
            "--story-data", path.join(directory, "storydata.twee")
        ], { encoding: "utf8" });
        const output = `${result.stdout}\n${result.stderr}`;
        assert(result.status !== 0 && output.includes(expected), `generator should reject fixture with ${expected}: ${output}`);
        assert(!fs.existsSync(path.join(directory, "data.js")), "failed validation must not partially write generated output");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
rejects(function (doc) { doc.startLocationId = "missing"; }, "startLocationId");
rejects(function (doc) { doc.locations.bar.passage = doc.locations.tavernEntrance.passage; }, "Duplicate passage");
rejects(function (doc) { doc.locations.upstairsCorridor.exits.guestRoom1.blocked = "yes"; }, "blocked must be Boolean");
rejects(function (doc) { doc.locations.upstairsCorridor.exits.guestRoom1.destinationId = "missing"; }, "references missing location");
rejects(function (doc) { doc.locations.guestRoom1.exits.upstairsCorridor.locked = false; }, "inconsistent reciprocal lock");
rejects(function (doc) { doc.itemDefinitions.guestRoom1KeyType.keyLockId = "missing_lock"; }, "invalid keyLockId");
rejects(function (doc) { doc.characters.player.inventoryId = doc.locations.bar.inventoryId; }, "Duplicate inventory");
rejects(function (doc) { doc.characters.player.initialControllerId = "dummy"; }, "Exactly one");
rejects(function (doc) { doc.abilities.readAura.actionType = "execute_code"; }, "unknown action");
rejects(function (doc) { doc.items.emptyMug_1.definitionId = "missing"; }, "references missing definition");
rejects(function (doc) { doc.items.emptyMug_1.inventoryId = "inventory_missing"; }, "missing inventory");
rejects(function (doc) { doc.locations.secludedCottage.sublocations.maraCottageChest.requiredKeyItemId = "missingChestKey"; }, "references missing required key item");
rejects(function (doc) { delete doc.locations.secludedCottage.sublocations.maraCottageChest.inventoryId; }, "cannot require a key without an inventory");
rejects(function (doc) { doc.itemDefinitions.mugOfAle.consumeAction.resultDefinitionId = "missing"; }, "references missing result definition");
rejects(function (doc) { doc.itemDefinitions.emptyMug.fillAction.resultDefinitionId = "missing"; }, "references missing result definition");
rejects(function (doc) { doc.itemDefinitions.memoryStone.useAction.effectId = "execute_arbitrary_code"; }, "invalid useAction");
rejects(function (doc) { doc.itemDefinitions.memoryStone.useAction.feedbackText = ""; }, "invalid useAction");
rejects(function (doc) { doc.itemDefinitions.arcaneKnowledgeSlab.useAction.aiInstructions = ""; }, "aiInstructions");
rejects(function (doc) { doc.itemDefinitions.arcaneKnowledgeSlab.useAction.inputLabel = ""; }, "requires inputLabel");
rejects(function (doc) { doc.itemDefinitions.arcaneKnowledgeSlab.useAction.inputMaxLength = 5000; }, "inputMaxLength");
rejects(function (doc) { doc.itemDefinitions.arcaneKnowledgeSlab.useAction.focusedFeedbackText = ""; }, "focusedFeedbackText");
rejects(function (doc) { doc.itemDefinitions.arcaneKnowledgeSlab.useAction.saturatedFeedbackText = ""; }, "saturatedFeedbackText");
rejects(function (doc) {
    doc.itemDefinitions.arcaneKnowledgeSlab.useAction.effectId = "utility_query";
    doc.itemDefinitions.arcaneKnowledgeSlab.useAction.utilityPrompt = "";
}, "requires utilityPrompt");
rejects(function (doc) {
    doc.itemDefinitions.arcaneKnowledgeSlab.useAction.effectId = "utility_query";
    doc.itemDefinitions.arcaneKnowledgeSlab.useAction.utilityPrompt = "Return concise reference information.";
    doc.itemDefinitions.arcaneKnowledgeSlab.useAction.utilityMaxTokens = 10;
}, "utilityMaxTokens");
rejects(function (doc) { doc.itemDefinitions.memoryStone.description = 42; }, "description must be text");
rejects(function (doc) { doc.locations.commonRoom.timelapseActions[0].effectId = "execute_arbitrary_code"; }, "references unknown effect");
rejects(function (doc) { doc.locations.commonRoom.timelapseActions[0].effectParams.destinationInventoryId = "inventory_missing"; }, "references missing destination inventory");
rejects(function (doc) {
    doc.itemDefinitions.cleaningRag = clone(doc.itemDefinitions.cleaningRagType);
    doc.itemDefinitions.cleaningRag.id = "cleaningRag";
    delete doc.itemDefinitions.cleaningRagType;
    doc.items.cleaningRag.definitionId = "cleaningRag";
}, "Duplicate technical ID");

// Positive authoring regression: the smithy is a normal authored extension of the village.
const smithy = source.locations.villageSmithy;
assert(smithy && smithy.exits.street === "street" && source.locations.street.exits.villageSmithy === "villageSmithy",
    "smithy should connect reciprocally to the village street");
assert(smithy.defaultSublocationId === "smithyForgeArea" && smithy.sublocations.smithyForgeArea &&
    smithy.sublocations.smithyLivingRoom && smithy.sublocations.smithyLivingBed &&
    (smithy.sublocations.smithyLivingBed.capabilities || []).includes("sleep"),
    "smithy should contain the forge floor, rear living room, and Harlan's actual sleeping place");
const blacksmith = source.characters.blacksmith;
assert(blacksmith && blacksmith.name === "Harlan the Blacksmith" && blacksmith.locationId === "villageSmithy" &&
    blacksmith.sublocationId === "smithyForgeArea" && blacksmith.initialControllerId === "ai",
    "Harlan should start as an AI blacksmith working in the forge");
assert(source.items.blacksmithClothing_01.equippedByCharacterId === "blacksmith" && source.items.blacksmithClothing_01.equippedSlot === "clothing" &&
    source.items.smithHammer_01.equippedByCharacterId === "blacksmith" && source.items.smithHammer_01.equippedSlot === "right_hand",
    "Harlan should start in work clothes with a smithing hammer equipped in hand");
assert(source.itemDefinitions.smithHammer.equipSlots.includes("right_hand") &&
    source.itemDefinitions.blacksmithClothing.equipSlots.includes("clothing"),
    "blacksmith clothing and hammer should use the ordinary equipment authoring model");
const harlanRelations = new Map(blacksmith.initialMind.relationships.map(function (record) { return [record.targetCharacterId, record.summary]; }));
assert(harlanRelations.has("innkeeper") && harlanRelations.has("nell") && harlanRelations.has("hoodedWoman") &&
    /not romantic or sexual/i.test(harlanRelations.get("nell")),
    "Harlan should seed the agreed Garrick/Nell/Mara relationships");
["innkeeper", "nell", "hoodedWoman"].forEach(function (characterId) {
    assert(source.characters[characterId].initialMind.relationships.some(function (record) { return record.targetCharacterId === "blacksmith"; }),
        `${characterId} should have an authored relationship seed toward the new blacksmith`);
});
assert(source.locations.innkeeperRoom.sublocations.innkeeperRoomChest.requiredKeyItemId === "innkeeperChestKey" &&
    source.locations.villageSmithy.sublocations.smithyLivingChest.requiredKeyItemId === "blacksmithChestKey" &&
    source.locations.secludedCottage.sublocations.maraCottageChest.requiredKeyItemId === "maraChestKey" &&
    source.items.arcaneKnowledgeSlab_01.inventoryId === "inventory_maraCottageChest",
    "private storage should use authored instance-key gating and the stable Slab should begin inside Mara's chest");
assert(source.items.innkeeperChestKey.inventoryId === "inventory_innkeeper" &&
    source.items.blacksmithChestKey.inventoryId === "inventory_blacksmith" &&
    source.items.maraChestKey.inventoryId === "inventory_hoodedWoman" &&
    source.items.maraCottageKey.inventoryId === "inventory_hoodedWoman",
    "each private chest key and Mara's separate cottage key should begin as ordinary transferable owner inventory items");
assert(source.locations.secludedCottage.exits.maraCottageGardenLocation.lockId === "lock_mara_cottage" &&
    source.locations.maraCottageGardenLocation.exits.secludedCottage.lockId === "lock_mara_cottage" &&
    source.locations.secludedCottage.exits.maraCottageGardenLocation.locked === false &&
    source.locations.maraCottageGardenLocation.exits.secludedCottage.locked === false,
    "Mara's cottage entrance should be an initially unlocked reciprocal ordinary lockable passage");

const modelSource = JSON.parse(fs.readFileSync(path.join(root, "data/model_list.json"), "utf8"));
function rejectsModelList(mutator, expected) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-rpg-model-list-generator-"));
    try {
        const document = clone(modelSource); mutator(document);
        const input = path.join(directory, "model_list.json");
        fs.writeFileSync(input, JSON.stringify(document), "utf8");
        const outputPath = path.join(directory, "model-list.js");
        const result = childProcess.spawnSync(process.execPath, [
            path.join(root, "tools/generate-model-list.js"), "--input", input, "--output", outputPath
        ], { encoding: "utf8" });
        const output = `${result.stdout}\n${result.stderr}`;
        assert(result.status !== 0 && output.includes(expected), `model-list generator should reject fixture with ${expected}: ${output}`);
        assert(!fs.existsSync(outputPath), "failed model-list validation must not partially write generated output");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
rejectsModelList(function (doc) { doc.defaultModelId = "missing/model"; }, "not present in models");
rejectsModelList(function (doc) { doc.defaultNarratorModelId = "missing/narrator"; }, "defaultNarratorModelId");
rejectsModelList(function (doc) { doc.defaultUtilityModelId = "missing/utility"; }, "defaultUtilityModelId");
rejectsModelList(function (doc) { doc.models.push(clone(doc.models[0])); }, "Duplicate model ID");
rejectsModelList(function (doc) { doc.models[0].name = ""; }, "name must be a non-empty string");
console.log("All world and model-list generator tests passed.");
