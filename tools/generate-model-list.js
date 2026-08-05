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
    if (document.schemaVersion !== 1) {
        fail("model_list.json schemaVersion must be 1.");
    }
    if (typeof document.defaultModelId !== "string" || !document.defaultModelId.trim()) {
        fail("model_list.json defaultModelId must be a non-empty string.");
    }
    if (!Array.isArray(document.models) || document.models.length === 0) {
        fail("model_list.json models must be a non-empty array.");
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
        return { id: id, name: name };
    });

    const defaultModelId = document.defaultModelId.trim();
    if (!seen.has(defaultModelId)) {
        fail(`model_list.json defaultModelId '${defaultModelId}' is not present in models.`);
    }

    return {
        schemaVersion: 1,
        defaultModelId: defaultModelId,
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
