"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const runtimeFiles = require("./runtime-files");
const authoredValidator = require("../tools/world-authored-validator.js");

function assert(value, message) { if (!value) throw new Error(message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function load(file) { vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file }); }

global.setup = {};
global.State = { variables: {}, passage: "The Tavern" };
global.Engine = { play: function () {}, show: function () {} };

runtimeFiles.augment([
    "src/00-model-list.js", "src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js",
    "src/10-game-api.js", "src/11-save-migration.js", "src/12-character-context.js", "src/13-character-memory.js",
    "src/13-verbatim-memory.js", "src/14-event-perception.js", "src/17-runtime-diagnostics.js", "src/21-ai-settings.js",
    "src/21-ai-request-profiles.js", "src/23-ai-protocol.js"
]).forEach(load);

function fresh() {
    setup.Game.resetWorld();
    setup.Game.acceptPlayerDisclaimer();
    setup.Game.acknowledgeAISetup();
    setup.Game.finalizePlayerSetup({ mode: "generic" });
    return setup.Game.getWorld();
}

const product = JSON.parse(fs.readFileSync(path.join(root, "data/product.json"), "utf8"));
assert(product.version === "0.1.4f-playtest1", "playtest1 product version must be authored");

const publicWorld = JSON.parse(fs.readFileSync(path.join(root, "data/world.json"), "utf8"));
const privateWorld = JSON.parse(fs.readFileSync(path.join(root, "data/world.private.json"), "utf8"));
const policy = publicWorld.groundedItemPolicy;
assert(typeof policy === "string" && policy.trim().length > 0, "public world must author a non-empty groundedItemPolicy");
assert(privateWorld.groundedItemPolicy === policy, "public/private groundedItemPolicy must match exactly");
for (const required of ["keys", "clothing", "jewelry", "magical", "mugs", "bowls", "plates", "potions", "salves", "Maksym", "vegetables", "groats", "narrative props"]) {
    assert(policy.toLowerCase().includes(required.toLowerCase()), `groundedItemPolicy must cover ${required}`);
}
assert(/absent[\s\S]*cannot currently manipulate[\s\S]*does not become a narrative prop/i.test(policy),
    "world policy must state that unavailable grounded items do not become narrative props");
for (const hidden of ["harlanIronMedallion", "medallionDisplayKey", "ironMedallion", "Key to the glazed medallion frame"]) {
    assert(!policy.includes(hidden), `grounded policy must not enumerate hidden concrete item ${hidden}`);
}

const missing = clone(publicWorld); delete missing.groundedItemPolicy;
assert(authoredValidator.validateWorldDocument(missing).length === 0, "groundedItemPolicy must remain optional for old worlds");
const empty = clone(publicWorld); empty.groundedItemPolicy = "";
assert(authoredValidator.validateWorldDocument(empty).length === 0, "empty groundedItemPolicy must validate");
const bad = clone(publicWorld); bad.groundedItemPolicy = ["keys"];
assert(authoredValidator.validateWorldDocument(bad).some(function (error) { return /groundedItemPolicy/.test(error.message); }), "non-string groundedItemPolicy must fail authored validation");
assert(authoredValidator.createEmptyWorld().groundedItemPolicy === "", "new empty worlds must initialize groundedItemPolicy to empty text");
assert(setup.GeneratedWorldData.groundedItemPolicy === policy, "generated world data must preserve groundedItemPolicy exactly");

let world = fresh();
assert(world.groundedItemPolicy === policy, "fresh runtime world must install current authored groundedItemPolicy");
const context = setup.ContextBuilder.build("innkeeper", { pendingObservations: [] });
assert(context.worldAuthoredContext && context.worldAuthoredContext.groundedItemPolicy === policy,
    "ordinary Character context must expose authored groundedItemPolicy under worldAuthoredContext");
const messages = setup.AIProtocol.decisionMessages(context);
const requestPayload = JSON.parse(messages[1].content);
assert(requestPayload.context.worldAuthoredContext.groundedItemPolicy === policy,
    "game-decision request must carry groundedItemPolicy exactly once through its context");
assert((messages[1].content.match(/ITEM GROUNDING IN MALLOWSTEAD/g) || []).length === 1,
    "game-decision user context must not duplicate the authored policy");
assert(/absence NEVER downgrades it into a narrative prop/i.test(messages[0].content) &&
       /Never reinterpret an already-grounded object as a prop/i.test(messages[0].content),
    "Character protocol must forbid unavailable-grounded-to-prop downgrading");

const characterProfiles = ["game-decision", "intimate-anticipations", "daytime-job-narration", "daytime-job-settlement", "prompt-lab"];
characterProfiles.forEach(function (name) {
    assert(setup.AIRequestProfiles.resolve(name, { actorId: "innkeeper" }).providerSort === "throughput", `${name} must use throughput provider sorting`);
});
assert(setup.AIRequestProfiles.resolve("timelapse-plan", { actorId: "innkeeper" }).providerSort === "latency", "Utility role must stay latency-sorted");
assert(setup.AIRequestProfiles.resolve("weather-narration", { actorId: null }).providerSort === "latency", "Narrator role must stay latency-sorted");

// Migration rebuilds from current authoring; stale saved policy must not survive.
const stale = clone(world);
stale.authoringRevision = "0".repeat(64);
stale.groundedItemPolicy = "STALE SAVED POLICY";
State.variables.world = stale;
const migrated = setup.SaveMigration.migrate();
assert(migrated.ok && setup.Game.getWorld().groundedItemPolicy === policy,
    "save migration must restore current authored groundedItemPolicy rather than stale saved text");

const editorHtml = fs.readFileSync(path.join(root, "editor/world-editor.html"), "utf8");
assert(editorHtml.includes("World settings") && editorHtml.includes("Grounded item policy") && editorHtml.includes("tab-world"),
    "offline editor must expose groundedItemPolicy in world settings");
const validatorMatch = editorHtml.match(/<script id="world-authored-validator">([\s\S]*?)<\/script>/);
const coreMatch = editorHtml.match(/<script id="world-editor-core">([\s\S]*?)<\/script>/);
assert(validatorMatch && coreMatch, "editor must contain embedded authored validator and editor core");
const editorContext = { globalThis: {} }; vm.createContext(editorContext); vm.runInContext(validatorMatch[1], editorContext); vm.runInContext(coreMatch[1], editorContext);
assert(editorContext.globalThis.AIRPGAuthoredValidator.createEmptyWorld().groundedItemPolicy === "", "embedded editor validator must share groundedItemPolicy default");
const editorRoundTrip = clone(publicWorld); editorRoundTrip.groundedItemPolicy = "keys and room access objects";
const serialized = editorContext.globalThis.WorldEditorCore.serializeWorldDocument(editorRoundTrip);
assert(JSON.parse(serialized).groundedItemPolicy === editorRoundTrip.groundedItemPolicy, "editor import/export core must round-trip groundedItemPolicy exactly");

const storySource = fs.readFileSync(path.join(root, "src/story.twee"), "utf8");
const uiSource = fs.readFileSync(path.join(root, "src/30-game-ui.js"), "utf8");
assert(storySource.includes("Config.history.controls = false"), "SugarCube back/forward history controls must be disabled in StoryInit");
assert(uiSource.includes("framework-history"), "Mallowstead framework narrative-history UI must remain present");

const daytimeSource = fs.readFileSync(path.join(root, "src/24-daytime-timelapse.js"), "utf8");
assert(daytimeSource.includes("context.worldAuthoredContext.groundedItemPolicy") && daytimeSource.includes("Ordinary incidental props outside grounded categories remain narratively available"),
    "Character daytime narration must receive the same grounded-vs-prop discipline");

console.log("All 0.1.4f-playtest1 grounded-item/routing/UI tests passed.");
