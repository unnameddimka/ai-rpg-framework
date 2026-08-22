#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const BuildProfile = require("./build-profile");

const root = BuildProfile.root;

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function gitCommit() {
    try {
        return childProcess.execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim() || "unknown";
    } catch (error) {
        return "unknown";
    }
}

function buildInfo(profile, builtAt) {
    const resolved = BuildProfile.resolveProfile(profile);
    return {
        productName: BuildProfile.product.productName,
        version: BuildProfile.product.version,
        author: BuildProfile.product.author,
        publicDisclosureVersion: BuildProfile.product.publicDisclosureVersion,
        profile: resolved.id,
        commit: gitCommit(),
        builtAt: builtAt || new Date().toISOString()
    };
}

function sourceFor(info) {
    return `(function () {\n    "use strict";\n    setup.BuildInfo = Object.freeze(${JSON.stringify(info, null, 4)});\n}());\n`;
}

function main() {
    const profile = argument("--profile", "public");
    const outputPath = path.resolve(argument("--output", path.join(root, "src", "00-build-info.js")));
    const info = buildInfo(profile);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, sourceFor(info), "utf8");
    console.log(`Generated ${outputPath} (${info.productName} ${info.version}, ${info.profile}, ${info.builtAt})`);
}

if (require.main === module) {
    try { main(); }
    catch (error) {
        console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { buildInfo, sourceFor, gitCommit };
