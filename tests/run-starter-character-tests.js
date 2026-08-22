"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
global.setup = {};
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }
function assert(value, message) { if (!value) throw new Error(message); }
function memoryStorage() {
    const values = new Map();
    return { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
}
load("src/16-emergency-diagnostics.js");
load("src/20-starter-character-library.js");
const storage = memoryStorage();
const first = setup.StarterCharacterLibrary.saveNew({ name:"Alice", playerDescription:"A visible Alice.", aiDescription:"A private Alice." }, storage);
assert(first.ok && first.character.id.startsWith("starter_"), "starter library should create a browser-local stable preset ID");
const second = setup.StarterCharacterLibrary.saveNew({ name:"Bob", playerDescription:"A visible Bob.", aiDescription:"A private Bob." }, storage);
assert(second.ok && setup.StarterCharacterLibrary.list(storage).characters.length === 2, "starter library should persist multiple presets independently of world state");
const updated = setup.StarterCharacterLibrary.update(first.character.id, { name:"Alice II", playerDescription:"A changed visible Alice.", aiDescription:"A changed private Alice." }, storage);
assert(updated.ok && setup.StarterCharacterLibrary.list(storage).characters.some(c => c.name === "Alice II"), "starter presets should be editable");
const exported = setup.StarterCharacterLibrary.exportZip(storage);
assert(exported.ok && exported.bytes instanceof Uint8Array && exported.filename.endsWith(".zip"), "starter library should export a portable ZIP container outside browser download mode");
const parsed = setup.StarterCharacterLibrary.parseImportBytes(exported.bytes);
assert(parsed.ok && parsed.characters.length === 2 && parsed.characters.some(c => c.name === "Alice II"), "starter ZIP should round-trip through the library parser");
const target = memoryStorage();
const seeded = setup.StarterCharacterLibrary.saveNew({ name:"Existing", playerDescription:"Existing visible.", aiDescription:"Existing private." }, target);
const conflicting = parsed.characters.map(c => Object.assign({}, c));
conflicting[0].id = seeded.character.id;
const merged = setup.StarterCharacterLibrary.mergeImported(conflicting, { [seeded.character.id]: "keep" }, target);
assert(merged.ok && merged.summary.keptBoth === 1 && setup.StarterCharacterLibrary.list(target).characters.length === 3,
    "starter import should resolve ID conflicts with a keep-both copy rather than silently overwriting");
const removed = setup.StarterCharacterLibrary.remove(seeded.character.id, target);
assert(removed.ok && !setup.StarterCharacterLibrary.list(target).characters.some(c => c.id === seeded.character.id), "starter presets should be deletable");
console.log("All starter-character library tests passed.");
