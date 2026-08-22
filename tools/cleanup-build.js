#!/usr/bin/env node
"use strict";
const fs = require("fs");
const BuildProfile = require("./build-profile");

function cleanup(profileRaw) {
    const profile = BuildProfile.resolveProfile(profileRaw);
    fs.rmSync(BuildProfile.stagingRoot(profile), { recursive: true, force: true });
    return profile;
}

if (require.main === module) {
    try {
        const profile = cleanup(process.argv[2]);
        console.log(`Cleaned ${profile.id} build staging.`);
    } catch (error) {
        console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { cleanup };
