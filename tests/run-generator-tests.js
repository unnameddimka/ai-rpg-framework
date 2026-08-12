"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
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
rejects(function (doc) { doc.itemDefinitions.mugOfAle.consumeAction.resultDefinitionId = "missing"; }, "references missing result definition");
rejects(function (doc) { doc.itemDefinitions.emptyMug.fillAction.resultDefinitionId = "missing"; }, "references missing result definition");
rejects(function (doc) { doc.itemDefinitions.memoryStone.useAction.effectId = "execute_arbitrary_code"; }, "invalid useAction");
rejects(function (doc) { doc.itemDefinitions.memoryStone.useAction.feedbackText = ""; }, "invalid useAction");
rejects(function (doc) { doc.itemDefinitions.memoryStone.description = 42; }, "description must be text");
rejects(function (doc) { doc.locations.commonRoom.timelapseActions[0].effectId = "execute_arbitrary_code"; }, "references unknown effect");
rejects(function (doc) { doc.locations.commonRoom.timelapseActions[0].effectParams.destinationInventoryId = "inventory_missing"; }, "references missing destination inventory");
rejects(function (doc) {
    doc.itemDefinitions.cleaningRag = clone(doc.itemDefinitions.cleaningRagType);
    doc.itemDefinitions.cleaningRag.id = "cleaningRag";
    delete doc.itemDefinitions.cleaningRagType;
    doc.items.cleaningRag.definitionId = "cleaningRag";
}, "Duplicate technical ID");

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
rejectsModelList(function (doc) { doc.models.push(clone(doc.models[0])); }, "Duplicate model ID");
rejectsModelList(function (doc) { doc.models[0].name = ""; }, "name must be a non-empty string");
console.log("All world and model-list generator tests passed.");
