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
        const result = childProcess.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            path.join(root, "tools/generate-world-data.ps1"), "-InputPath", input,
            "-OutputPath", path.join(directory, "data.js"), "-PassagesPath", path.join(directory, "passages.twee"),
            "-StoryDataPath", path.join(directory, "storydata.twee")], { encoding: "utf8" });
        const output = `${result.stdout}\n${result.stderr}`;
        assert(result.status !== 0 && output.includes(expected), `generator should reject fixture with ${expected}: ${output}`);
        assert(!fs.existsSync(path.join(directory, "data.js")), "failed validation must not partially write generated output");
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
rejects(function (doc) { doc.startLocationId = "missing"; }, "startLocationId");
rejects(function (doc) { doc.locations.bar.passage = doc.locations.tavernEntrance.passage; }, "Duplicate passage");
rejects(function (doc) { doc.characters.player.inventoryId = doc.locations.bar.inventoryId; }, "Duplicate inventory");
rejects(function (doc) { doc.characters.player.initialControllerId = "dummy"; }, "Exactly one");
rejects(function (doc) { doc.abilities.readAura.actionType = "execute_code"; }, "unknown action");
console.log("All world generator tests passed.");
