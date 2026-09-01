#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

const inputPath = argument("--input", path.join(root, "data", "model_list.json"));
const outputPath = argument("--output", path.join(root, "src", "00-model-list.js"));

function fail(message) {
    throw new Error(message);
}

function validate(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
        fail("Model list must be a JSON object.");
    }
    if (document.schemaVersion !== 2) {
        fail("model_list.json schemaVersion must be 2.");
    }
    if (typeof document.defaultModelId !== "string" || !document.defaultModelId.trim()) {
        fail("model_list.json defaultModelId must be a non-empty string.");
    }
    if (document.defaultNarratorModelId !== undefined &&
        (typeof document.defaultNarratorModelId !== "string" || !document.defaultNarratorModelId.trim())) {
        fail("model_list.json defaultNarratorModelId must be a non-empty string when present.");
    }
    if (document.defaultUtilityModelId !== undefined &&
        (typeof document.defaultUtilityModelId !== "string" || !document.defaultUtilityModelId.trim())) {
        fail("model_list.json defaultUtilityModelId must be a non-empty string when present.");
    }
    if (!Array.isArray(document.models) || document.models.length === 0) {
        fail("model_list.json models must be a non-empty array.");
    }
    if (document.defaultFallbackModelIds !== undefined &&
        (!document.defaultFallbackModelIds || typeof document.defaultFallbackModelIds !== "object" || Array.isArray(document.defaultFallbackModelIds))) {
        fail("model_list.json defaultFallbackModelIds must be an object when present.");
    }

    const seen = new Set();
    const models = document.models.map(function (model, index) {
        if (!model || typeof model !== "object" || Array.isArray(model)) {
            fail(`model_list.json models[${index}] must be an object.`);
        }
        const id = typeof model.id === "string" ? model.id.trim() : "";
        const name = typeof model.name === "string" ? model.name.trim() : "";
        if (!id || !id.includes("/")) {
            fail(`model_list.json models[${index}].id must be a non-empty OpenRouter model ID.`);
        }
        if (!name) {
            fail(`model_list.json models[${index}].name must be a non-empty string.`);
        }
        if (seen.has(id)) {
            fail(`Duplicate model ID '${id}' in model_list.json.`);
        }
        seen.add(id);
        const roles = Array.isArray(model.roles) ? model.roles.map(function (role) { return String(role || "").trim(); }).filter(Boolean) : [];
        const allowedRoles = new Set(["character", "utility", "narrator"]);
        if (!roles.length || roles.some(function (role) { return !allowedRoles.has(role); }) || new Set(roles).size !== roles.length) {
            fail(`model_list.json models[${index}].roles must contain unique supported role IDs.`);
        }
        return { id: id, name: name, roles: roles };
    });

    const defaultModelId = document.defaultModelId.trim();
    if (!seen.has(defaultModelId)) {
        fail(`model_list.json defaultModelId '${defaultModelId}' is not present in models.`);
    }
    const defaultNarratorModelId = typeof document.defaultNarratorModelId === "string" && document.defaultNarratorModelId.trim()
        ? document.defaultNarratorModelId.trim()
        : defaultModelId;
    if (!seen.has(defaultNarratorModelId)) {
        fail(`model_list.json defaultNarratorModelId '${defaultNarratorModelId}' is not present in models.`);
    }
    const modelById = new Map(models.map(function (model) { return [model.id, model]; }));
    if (!modelById.get(defaultModelId).roles.includes("character")) fail("defaultModelId must be eligible for the character role.");
    if (!modelById.get(defaultNarratorModelId).roles.includes("narrator")) fail("defaultNarratorModelId must be eligible for the narrator role.");
    const defaultUtilityModelId = typeof document.defaultUtilityModelId === "string" && document.defaultUtilityModelId.trim()
        ? document.defaultUtilityModelId.trim()
        : defaultModelId;
    if (!seen.has(defaultUtilityModelId)) {
        fail(`model_list.json defaultUtilityModelId '${defaultUtilityModelId}' is not present in models.`);
    }
    if (!modelById.get(defaultUtilityModelId).roles.includes("utility")) fail("defaultUtilityModelId must be eligible for the utility role.");

    const fallbackSource = document.defaultFallbackModelIds || {};
    const defaultFallbackModelIds = {};
    ["character", "utility", "narrator"].forEach(function (role) {
        const values = fallbackSource[role] === undefined ? [] : fallbackSource[role];
        if (!Array.isArray(values)) fail(`defaultFallbackModelIds.${role} must be an array.`);
        const normalized = values.map(function (value) { return typeof value === "string" ? value.trim() : ""; });
        if (normalized.some(function (id) { return !id || !seen.has(id) || !modelById.get(id).roles.includes(role); })) {
            fail(`defaultFallbackModelIds.${role} must contain only model IDs eligible for ${role}.`);
        }
        if (new Set(normalized).size !== normalized.length) fail(`defaultFallbackModelIds.${role} must not contain duplicates.`);
        defaultFallbackModelIds[role] = normalized;
    });

    return {
        schemaVersion: 2,
        defaultModelId: defaultModelId,
        defaultNarratorModelId: defaultNarratorModelId,
        defaultUtilityModelId: defaultUtilityModelId,
        defaultFallbackModelIds: defaultFallbackModelIds,
        models: models
    };
}

function main() {
    let document;
    try {
        document = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    } catch (error) {
        fail(`Could not read valid JSON from ${inputPath}: ${error.message}`);
    }
    const validated = validate(document);
    const source = `(function () {\n    \"use strict\";\n    setup.GeneratedModelList = ${JSON.stringify(validated, null, 4)};\n}());\n`;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp`;
    fs.writeFileSync(temporary, source, "utf8");
    fs.renameSync(temporary, outputPath);
    console.log(`Generated ${outputPath} from ${inputPath}.`);
}

try {
    main();
} catch (error) {
    console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
}
