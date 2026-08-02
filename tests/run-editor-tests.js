"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "editor/world-editor.html"), "utf8");
const match = html.match(/<script id="world-editor-core">([\s\S]*?)<\/script>/);
if (!match) {
    throw new Error("Editor core script was not found.");
}

const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(match[1], context, { filename: "world-editor-core.js" });
const core = context.globalThis.WorldEditorCore;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function validDocument() {
    return {
        schemaVersion: 1,
        futureTopLevel: { retained: true },
        locations: {
            room: {
                id: "room",
                type: "location",
                name: "Room",
                passage: "Room",
                description: ["A room."],
                defaultSublocationId: "roomFloor",
                inventoryId: "inventory_room",
                exits: {},
                futureLocationField: "keep",
                sublocations: {
                    roomFloor: {
                        id: "roomFloor",
                        type: "sublocation",
                        locationId: "room",
                        name: "Floor",
                        enterLabel: "Stand on floor",
                        selfText: "You stand on the floor.",
                        occupantTemplate: "{name} stands on the floor.",
                        capacity: 4,
                        reachableSublocationIds: ["roomFloor"],
                        futureSublocationField: 42
                    }
                }
            }
        }
    };
}

const parsed = core.parseWorldJson(JSON.stringify(validDocument()));
assert(parsed.locations.room.name === "Room", "valid JSON should parse");
let malformedRejected = false;
try { core.parseWorldJson("{"); } catch (error) { malformedRejected = true; }
assert(malformedRejected, "malformed JSON should be rejected");

const empty = core.createEmptyWorld();
assert(empty.schemaVersion === 1 && Object.keys(empty.locations).length === 0,
    "new document should use current schema and an empty locations object");
assert(core.validateWorldDocument(validDocument()).length === 0, "valid document should validate");

const duplicate = validDocument();
duplicate.locations.other = JSON.parse(JSON.stringify(duplicate.locations.room));
duplicate.locations.other.name = "Other";
assert(core.validateWorldDocument(duplicate).some(function (item) {
    return item.message.includes("used more than once");
}), "duplicate explicit IDs should be detected");

const missingExit = validDocument();
missingExit.locations.room.exits.missing = "missing";
assert(core.validateWorldDocument(missingExit).some(function (item) {
    return item.message.includes("missing location");
}), "missing exit target should be detected");

const invalidDefault = validDocument();
invalidDefault.locations.room.defaultSublocationId = "missingPosition";
assert(core.validateWorldDocument(invalidDefault).some(function (item) {
    return item.message.includes("default position");
}), "invalid default sublocation should be detected");

const invalidReach = validDocument();
invalidReach.locations.room.sublocations.roomFloor.reachableSublocationIds.push("missingPosition");
assert(core.validateWorldDocument(invalidReach).some(function (item) {
    return item.message.includes("references missing position");
}), "invalid reachability target should be detected");

const preserved = validDocument();
preserved.locations.room.description = ["Edited."];
const exported = core.serializeWorldDocument(preserved);
const reparsed = JSON.parse(exported);
assert(reparsed.futureTopLevel.retained, "unknown top-level data should survive export");
assert(reparsed.locations.room.futureLocationField === "keep", "unknown location data should survive export");
assert(reparsed.locations.room.sublocations.roomFloor.futureSublocationField === 42,
    "unknown sublocation data should survive export");

let exportBlocked = false;
try { core.serializeWorldDocument(missingExit); } catch (error) { exportBlocked = true; }
assert(exportBlocked, "export should be blocked when validation errors exist");

const withSecondLocation = validDocument();
withSecondLocation.locations.other = {
    id: "other", type: "location", name: "Other", passage: "Other", description: [],
    defaultSublocationId: "otherFloor", inventoryId: "inventory_other", exits: { room: "room" },
    sublocations: {
        otherFloor: {
            id: "otherFloor", type: "sublocation", locationId: "other", name: "Floor",
            enterLabel: "Stand", selfText: "You stand.", occupantTemplate: "{name} stands.",
            capacity: 2, reachableSublocationIds: ["otherFloor"]
        }
    }
};
assert(core.locationDeletionReferences(withSecondLocation, "room").length === 1,
    "deleting an exit target should be blocked by a reference");
assert(core.sublocationDeletionReferences(withSecondLocation.locations.room, "roomFloor").includes("Default position"),
    "deleting a default position should be blocked");

console.log("All world editor tests passed.");
