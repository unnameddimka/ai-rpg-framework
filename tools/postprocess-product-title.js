#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "dist", "game.html");
const displayName = "AI RPG Framework MVP";
const legacySaveId = "ai-rpg-framework-poc";

function patchLegacySaveIdCompatibility(html) {
    const mismatchPattern = /if\s*\(save\.id\s*!==\s*Config\.saves\.id\)\s*throw new Error\(L10n\.get\("saveErrorIdMismatch"\)\);/;
    const patchedPattern = new RegExp(`if\\s*\\(save\\.id\\s*!==\\s*Config\\.saves\\.id\\s*&&\\s*save\\.id\\s*!==\\s*"${legacySaveId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)\\s*throw new Error\\(L10n\\.get\\("saveErrorIdMismatch"\\)\\);`);
    const rawMatches = html.match(new RegExp(mismatchPattern.source, "g")) || [];
    const patchedMatches = html.match(new RegExp(patchedPattern.source, "g")) || [];
    if (rawMatches.length === 0 && patchedMatches.length === 1) return html;
    if (rawMatches.length !== 1 || patchedMatches.length !== 0) {
        throw new Error(`Expected one unpatched or one already-patched SugarCube save-ID mismatch guard; found raw=${rawMatches.length}, patched=${patchedMatches.length}.`);
    }
    return html.replace(
        mismatchPattern,
        `if(save.id!==Config.saves.id&&save.id!=="${legacySaveId}")throw new Error(L10n.get("saveErrorIdMismatch"));`
    );
}

function postprocessHtml(html) {
    if (!/<title>[\s\S]*?<\/title>/i.test(html)) {
        throw new Error("dist/game.html has no <title> element to postprocess.");
    }
    let output = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${displayName}</title>`);
    output = patchLegacySaveIdCompatibility(output);
    return output;
}

function main() {
    const html = fs.readFileSync(outputPath, "utf8");
    fs.writeFileSync(outputPath, postprocessHtml(html), "utf8");
    console.log(`Applied display title: ${displayName}`);
    console.log(`Enabled legacy SugarCube save-ID compatibility: ${legacySaveId}`);
}

if (require.main === module) main();

module.exports = {
    displayName,
    legacySaveId,
    patchLegacySaveIdCompatibility,
    postprocessHtml
};
