#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BuildProfile = require("./build-profile");

const root = BuildProfile.root;
const displayName = BuildProfile.product.productName;
const legacySaveIds = BuildProfile.product.legacySaveIds.slice();

function escaped(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedGuard() {
    return `if(save.id!==Config.saves.id${legacySaveIds.map(function (id) { return `&&save.id!==${JSON.stringify(id)}`; }).join("")})throw new Error(L10n.get("saveErrorIdMismatch"));`;
}

function patchLegacySaveIdCompatibility(html) {
    const rawPattern = /if\s*\(save\.id\s*!==\s*Config\.saves\.id\)\s*throw new Error\(L10n\.get\("saveErrorIdMismatch"\)\);/;
    const anyPatchedPattern = /if\s*\(save\.id\s*!==\s*Config\.saves\.id(?:\s*&&\s*save\.id\s*!==\s*"[^"]+")+\)\s*throw new Error\(L10n\.get\("saveErrorIdMismatch"\)\);/;
    const desired = expectedGuard();
    if (html.includes(desired)) return html;
    const rawMatches = html.match(new RegExp(rawPattern.source, "g")) || [];
    const patchedMatches = html.match(new RegExp(anyPatchedPattern.source, "g")) || [];
    if (rawMatches.length === 1 && patchedMatches.length === 0) return html.replace(rawPattern, desired);
    if (rawMatches.length === 0 && patchedMatches.length === 1) return html.replace(anyPatchedPattern, desired);
    throw new Error(`Expected one SugarCube save-ID mismatch guard; found raw=${rawMatches.length}, patched=${patchedMatches.length}.`);
}

function postprocessHtml(html) {
    if (!/<title>[\s\S]*?<\/title>/i.test(html)) throw new Error("Built HTML has no <title> element to postprocess.");
    let output = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${displayName}</title>`);
    output = patchLegacySaveIdCompatibility(output);
    return output;
}

function main() {
    const inputIndex = process.argv.indexOf("--input");
    const outputPath = path.resolve(inputIndex >= 0 && process.argv[inputIndex + 1] ? process.argv[inputIndex + 1] : path.join(root, "dist", "mallowstead.html"));
    const html = fs.readFileSync(outputPath, "utf8");
    fs.writeFileSync(outputPath, postprocessHtml(html), "utf8");
    console.log(`Applied display title: ${displayName}`);
    console.log(`Enabled legacy SugarCube save-ID compatibility: ${legacySaveIds.join(", ")}`);
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(`ERROR: ${error && error.message ? error.message : String(error)}`); process.exitCode = 1; }
}

module.exports = { displayName, legacySaveIds, patchLegacySaveIdCompatibility, postprocessHtml, expectedGuard };
