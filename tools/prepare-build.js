#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const BuildProfile = require("./build-profile");

function runNode(script, args) {
    const result = childProcess.spawnSync(process.execPath, [script].concat(args || []), {
        cwd: BuildProfile.root,
        stdio: "inherit"
    });
    if (result.status !== 0) throw new Error(`${path.basename(script)} failed.`);
}

function prepare(profileRaw) {
    const profile = BuildProfile.assertProfileReady(BuildProfile.resolveProfile(profileRaw));
    const staging = BuildProfile.stagingRoot(profile);
    const stagedSrc = path.join(staging, "src");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.cpSync(path.join(BuildProfile.root, "src"), stagedSrc, { recursive: true });

    runNode(path.join(BuildProfile.root, "tools", "generate-model-list.js"), [
        "--input", path.join(BuildProfile.root, "data", "model_list.json"),
        "--output", path.join(stagedSrc, "00-model-list.js")
    ]);
    runNode(path.join(BuildProfile.root, "tools", "generate-build-info.js"), [
        "--profile", profile.id,
        "--output", path.join(stagedSrc, "00-build-info.js")
    ]);
    runNode(path.join(BuildProfile.root, "tools", "generate-world-data.js"), [
        "--input", profile.worldPath,
        "--output", path.join(stagedSrc, "generated", "world-data.js"),
        "--passages", path.join(stagedSrc, "generated", "world-passages.twee"),
        "--story-data", path.join(stagedSrc, "generated", "world-storydata.twee")
    ]);

    return { profile: profile, staging: staging, source: stagedSrc };
}

if (require.main === module) {
    try {
        const prepared = prepare(process.argv[2]);
        console.log(`Prepared ${prepared.profile.id} build source: ${prepared.source}`);
    } catch (error) {
        console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { prepare };
