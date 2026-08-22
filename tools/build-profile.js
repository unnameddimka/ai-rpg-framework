#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const product = JSON.parse(fs.readFileSync(path.join(root, "data", "product.json"), "utf8"));
const PROFILES = Object.freeze({
    public: Object.freeze({
        id: "public",
        worldPath: path.join(root, "data", "world.json"),
        htmlPath: path.join(root, "dist", "mallowstead.html"),
        packagePublic: true
    }),
    private: Object.freeze({
        id: "private",
        worldPath: path.join(root, "data", "world.private.json"),
        htmlPath: path.join(root, "dist", "mallowstead-private.html"),
        packagePublic: false
    })
});

function resolveProfile(raw) {
    const value = raw === undefined || raw === null || String(raw).trim() === "" ? "public" : String(raw).trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PROFILES, value)) {
        throw new Error(`Unknown build profile '${String(raw)}'. Expected 'public' or 'private'.`);
    }
    return PROFILES[value];
}

function assertProfileReady(profile) {
    const config = typeof profile === "string" || profile == null ? resolveProfile(profile) : profile;
    if (!fs.existsSync(config.worldPath) || !fs.statSync(config.worldPath).isFile()) {
        if (config.id === "private") {
            throw new Error("Private build requires local data/world.private.json. Restore or create that ignored private world before building with the private profile.");
        }
        throw new Error(`Public authored world was not found: ${config.worldPath}`);
    }
    return config;
}

function stagingRoot(profile) {
    const config = typeof profile === "string" || profile == null ? resolveProfile(profile) : profile;
    return path.join(root, ".build", config.id);
}

function packageFilename() {
    return `${product.productName}-${product.version}.zip`;
}

if (require.main === module) {
    try {
        const config = assertProfileReady(resolveProfile(process.argv[2]));
        process.stdout.write(JSON.stringify({
            profile: config.id,
            worldPath: config.worldPath,
            htmlPath: config.htmlPath,
            stagingRoot: stagingRoot(config),
            packagePublic: config.packagePublic,
            packageFilename: packageFilename()
        }));
    } catch (error) {
        console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { root, product, PROFILES, resolveProfile, assertProfileReady, stagingRoot, packageFilename };
