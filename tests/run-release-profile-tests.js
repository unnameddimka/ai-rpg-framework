"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const BuildProfile = require(path.join(root, "tools/build-profile.js"));
const BuildInfo = require(path.join(root, "tools/generate-build-info.js"));
const PrepareBuild = require(path.join(root, "tools/prepare-build.js"));
const CleanupBuild = require(path.join(root, "tools/cleanup-build.js"));
const Packager = require(path.join(root, "tools/package-public-release.js"));

function assert(value, message) { if (!value) throw new Error(message); }
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function zipEntryNames(buffer) {
    const names = [];
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const nameStart = offset + 30;
        names.push(buffer.slice(nameStart, nameStart + nameLength).toString("utf8"));
        offset = nameStart + nameLength + extraLength + compressedSize;
    }
    return names;
}

assert(BuildProfile.resolveProfile().id === "public" && BuildProfile.resolveProfile("").id === "public",
    "omitting the build profile should resolve to public");
assert(BuildProfile.resolveProfile("private").id === "private", "explicit private profile should resolve to private");
let unknownRejected = false;
try { BuildProfile.resolveProfile("staging"); } catch (error) { unknownRejected = /Expected 'public' or 'private'/.test(error.message); }
assert(unknownRejected, "unknown build profiles should fail explicitly");
assert(BuildProfile.assertProfileReady("public").worldPath === path.join(root, "data", "world.json"),
    "public profile should build from committed data/world.json");
let missingPrivateRejected = false;
try { BuildProfile.assertProfileReady({ id: "private", worldPath: path.join(os.tmpdir(), "definitely-missing-mallowstead-private-world.json") }); }
catch (error) { missingPrivateRejected = /Private build requires local data\/world\.private\.json/.test(error.message); }
assert(missingPrivateRejected, "a missing private world should fail with an actionable private-build error");

const product = json(path.join(root, "data", "product.json"));
assert(product.productName === "Mallowstead" && product.version === "0.1.3-playtest" && product.author === "Dmytro Turovskiy" &&
    product.currentSaveId === "mallowstead" && product.legacySaveIds.includes("ai-rpg-framework-mvp") && product.legacySaveIds.includes("ai-rpg-framework-poc"),
    "shared product metadata should define Mallowstead identity, author, version, and legacy save aliases");
const models = json(path.join(root, "data", "model_list.json"));
assert(models.defaultModelId === "deepseek/deepseek-v4-flash" && models.defaultUtilityModelId === "deepseek/deepseek-v4-flash",
    "Character and Utility defaults should both be DeepSeek V4 Flash");

const publicWorld = json(path.join(root, "data", "world.json"));
Object.entries(publicWorld.characters).forEach(function ([id, character]) {
    const facts = character.initialMind && character.initialMind.knownFacts || [];
    assert(facts.some(function (fact) { return fact.id === "village_name" && fact.text === "The village is called Mallowstead."; }),
        `${id} should receive the authored Mallowstead village-name fact`);
});
const privateWorldPath = path.join(root, "data", "world.private.json");
if (fs.existsSync(privateWorldPath)) {
    const privateWorld = json(privateWorldPath);
    Object.entries(privateWorld.characters).forEach(function ([id, character]) {
        const facts = character.initialMind && character.initialMind.knownFacts || [];
        assert(facts.some(function (fact) { return fact.id === "village_name"; }), `${id} in private world should also know Mallowstead`);
    });
}

const fixedBuildInfo = BuildInfo.buildInfo("private", "2026-08-21T00:00:00.000Z");
assert(fixedBuildInfo.productName === "Mallowstead" && fixedBuildInfo.version === "0.1.3-playtest" && fixedBuildInfo.author === "Dmytro Turovskiy" &&
    fixedBuildInfo.profile === "private" && typeof fixedBuildInfo.commit === "string" && fixedBuildInfo.builtAt === "2026-08-21T00:00:00.000Z",
    "build metadata should expose product/version/author/profile/commit/builtAt");

function loadGame(profile) {
    const context = vm.createContext({
        setup: { BuildInfo: { profile: profile, productName: "Mallowstead", version: "0.1.3-playtest", publicDisclosureVersion: 1 } },
        State: { variables: {}, passage: "The Tavern" },
        Engine: { play: function () {}, show: function () {} },
        console: console
    });
    ["src/generated/world-data.js", "src/07-mind-v3.js", "src/08-mind-validators.js", "src/09-passage-rules.js", "src/09-world-derived-state.js", "src/10-game-api.js", "src/11-save-migration.js"]
        .forEach(function (file) { vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file }); });
    context.setup.Game.resetWorld();
    return context;
}
const publicRuntime = loadGame("public");
assert(publicRuntime.setup.Game.isPublicDisclosureRequired() === true && publicRuntime.setup.Game.getRequiredDisclosureVersion() === 1,
    "public fresh world should require the current disclosure");
const blockedPublicAI = publicRuntime.setup.Game.acknowledgeAISetup();
assert(!blockedPublicAI.ok && blockedPublicAI.error.code === "PLAYER_DISCLAIMER_REQUIRED",
    "public startup should not advance past AI setup before disclosure acceptance");
assert(publicRuntime.setup.Game.acceptPlayerDisclaimer().ok && publicRuntime.setup.Game.acknowledgeAISetup().ok &&
    publicRuntime.setup.Game.finalizePlayerSetup({ mode: "generic" }).ok && publicRuntime.setup.Game.isPlayerSetupComplete(),
    "public startup should complete after disclosure -> AI setup -> Traveler selection");

const privateRuntime = loadGame("private");
assert(privateRuntime.setup.Game.isPublicDisclosureRequired() === false && privateRuntime.setup.Game.getRequiredDisclosureVersion() === 0,
    "private fresh world should bypass public disclosure requirements");
assert(privateRuntime.setup.Game.acknowledgeAISetup().ok && privateRuntime.setup.Game.finalizePlayerSetup({ mode: "generic" }).ok &&
    privateRuntime.setup.Game.isPlayerSetupComplete() && privateRuntime.setup.Game.getPlayerSetup().disclaimerAccepted === false,
    "private startup should complete through practical AI-key status and Traveler setup without accepting public disclosures");

const trackedWorldData = path.join(root, "src", "generated", "world-data.js");
const trackedBuildInfo = path.join(root, "src", "00-build-info.js");
const worldHashBefore = hash(trackedWorldData);
const infoHashBefore = hash(trackedBuildInfo);
const preparedPublic = PrepareBuild.prepare("public");
try {
    const stagedPublicWorld = fs.readFileSync(path.join(preparedPublic.source, "generated", "world-data.js"), "utf8");
    const stagedPublicInfo = fs.readFileSync(path.join(preparedPublic.source, "00-build-info.js"), "utf8");
    assert(stagedPublicInfo.includes('"profile": "public"'),
        "public staging should contain public build metadata");
    assert(hash(trackedWorldData) === worldHashBefore && hash(trackedBuildInfo) === infoHashBefore,
        "public staging should not mutate tracked generated artifacts");
} finally { CleanupBuild.cleanup("public"); }
if (fs.existsSync(privateWorldPath)) {
    const preparedPrivate = PrepareBuild.prepare("private");
    try {
        const stagedPrivateWorld = fs.readFileSync(path.join(preparedPrivate.source, "generated", "world-data.js"), "utf8");
        const stagedPrivateInfo = fs.readFileSync(path.join(preparedPrivate.source, "00-build-info.js"), "utf8");
        assert(stagedPrivateInfo.includes('"profile": "private"') && stagedPrivateWorld !== fs.readFileSync(trackedWorldData, "utf8"),
            "private staging should use the distinct local private world and private build metadata");
        assert(hash(trackedWorldData) === worldHashBefore && hash(trackedBuildInfo) === infoHashBefore,
            "private staging must not leak private generated data back into tracked source files");
    } finally { CleanupBuild.cleanup("private"); }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mallowstead-release-test-"));
try {
    const html = path.join(temp, "game.html");
    const readme = path.join(temp, "README.md");
    const license = path.join(temp, "LICENSE");
    const output = path.join(temp, "release.zip");
    fs.writeFileSync(html, "<html>Mallowstead</html>");
    fs.writeFileSync(readme, "player readme");
    fs.writeFileSync(license, "MIT License");
    const packaged = Packager.packagePublic({ htmlPath: html, readmePath: readme, licensePath: license, outputPath: output });
    assert(packaged.entries.join(",") === "mallowstead.html,README.md,LICENSE" &&
        zipEntryNames(fs.readFileSync(output)).join(",") === "mallowstead.html,README.md,LICENSE",
        "public release ZIP should contain exactly mallowstead.html, README.md, and LICENSE");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const licenseText = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
const playerReadme = fs.readFileSync(path.join(root, "PLAYER-README.md"), "utf8");
assert(licenseText.includes("MIT License") && licenseText.includes("Copyright (c) 2026 Dmytro Turovskiy"),
    "root LICENSE should be MIT under Dmytro Turovskiy's public author spelling");
assert(playerReadme.includes("OpenRouter") && playerReadme.includes("DeepSeek V4 Flash") && playerReadme.includes("sleep in any bed") &&
    playerReadme.includes("Mara") && playerReadme.includes("Harlan") && /hunting squirrels/i.test(playerReadme) && playerReadme.includes("MVP") && playerReadme.includes("POC"),
    "player README should cover AI setup/cost defaults, day/night skipping, and old-save compatibility");

console.log("All Mallowstead release-profile tests passed.");
