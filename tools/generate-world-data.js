#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const defaults = {
    input: path.join(root, "data", "world.json"),
    output: path.join(root, "src", "generated", "world-data.js"),
    passages: path.join(root, "src", "generated", "world-passages.twee"),
    storyData: path.join(root, "src", "generated", "world-storydata.twee")
};

const knownActions = new Set([
    "move", "move_within_location", "take_item", "drop_item", "give_item",
    "give_money", "place_item", "pour_ale", "read_aura"
]);
const controllers = new Set(["human", "dummy", "ai"]);
const confidences = new Set(["low", "medium", "high"]);

function requireCondition(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonBlank(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function own(object, key) {
    return isObject(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function entries(object) {
    return isObject(object) ? Object.entries(object) : [];
}

function registerInventory(owners, id, owner) {
    requireCondition(nonBlank(id), `${owner} must define an inventory ID.`);
    if (owners.has(id)) {
        throw new Error(`Duplicate inventory ID '${id}' is owned by both ${owners.get(id)} and ${owner}.`);
    }
    owners.set(id, owner);
}

function validateMind(mind, characterId) {
    requireCondition(isObject(mind), `Character ${characterId} must define initialMind.`);
    for (const listName of ["knownFacts", "beliefs", "relationships", "recentMemories", "longTermMemories"]) {
        requireCondition(Array.isArray(mind[listName]), `Character ${characterId} initialMind.${listName} must be an array.`);
    }

    for (const listName of ["knownFacts", "beliefs", "recentMemories", "longTermMemories"]) {
        const seen = new Set();
        for (const record of mind[listName]) {
            const id = record && String(record.id || "");
            requireCondition(nonBlank(id), `Character ${characterId} ${listName} record needs an ID.`);
            requireCondition(!seen.has(id), `Character ${characterId} has duplicate ${listName} ID '${id}'.`);
            seen.add(id);
        }
    }

    for (const belief of mind.beliefs) {
        requireCondition(confidences.has(String(belief.confidence)),
            `Character ${characterId} belief '${belief.id}' has invalid confidence.`);
    }

    for (const listName of ["recentMemories", "longTermMemories"]) {
        for (const memory of mind[listName]) {
            requireCondition(typeof memory.importance === "number" && Number.isFinite(memory.importance) &&
                memory.importance >= 0 && memory.importance <= 1,
            `Character ${characterId} memory '${memory.id}' has invalid importance.`);
            requireCondition(typeof memory.protected === "boolean",
                `Character ${characterId} memory '${memory.id}' protected must be Boolean.`);
        }
    }
}

function validateWorld(document) {
    requireCondition(isObject(document), "world.json must contain a JSON object.");
    requireCondition(document.schemaVersion === 2, "Unsupported world schemaVersion. Expected 2.");
    requireCondition(isObject(document.locations) && isObject(document.characters) && isObject(document.abilities),
        "world.json must contain locations, characters, and abilities objects.");
    requireCondition(nonBlank(document.startLocationId) && own(document.locations, document.startLocationId),
        "startLocationId must reference an existing location.");

    const passageOwners = new Map();
    const inventoryOwners = new Map();

    for (const [id, location] of entries(document.locations)) {
        requireCondition(isObject(location) && location.id === id, `Location key ${id} must match its id.`);
        const passage = String(location.passage || "");
        requireCondition(nonBlank(passage) && !/[\r\n\[\]]/.test(passage),
            `Location ${id} has an invalid Twine passage name.`);
        if (passageOwners.has(passage)) {
            throw new Error(`Duplicate passage name '${passage}' is used by both ${passageOwners.get(passage)} and ${id}.`);
        }
        passageOwners.set(passage, id);
        registerInventory(inventoryOwners, String(location.inventoryId || ""), `location ${id}`);

        requireCondition(isObject(location.sublocations) && own(location.sublocations, String(location.defaultSublocationId || "")),
            `Location ${id} has an invalid default sublocation.`);
        for (const [sublocationId, sublocation] of entries(location.sublocations)) {
            requireCondition(isObject(sublocation) && sublocation.id === sublocationId && sublocation.locationId === id,
                `Sublocation ${sublocationId} has invalid identity or parent.`);
            if (nonBlank(String(sublocation.inventoryId || ""))) {
                registerInventory(inventoryOwners, String(sublocation.inventoryId), `sublocation ${sublocationId}`);
            }
            const capabilities = Array.isArray(sublocation.capabilities) ? sublocation.capabilities : [];
            for (const capability of capabilities) {
                const action = String(capability || "");
                if (nonBlank(action)) {
                    requireCondition(knownActions.has(action),
                        `Sublocation ${sublocationId} grants unknown action '${action}'.`);
                }
            }
        }
    }

    for (const [id, ability] of entries(document.abilities)) {
        requireCondition(isObject(ability) && ability.id === id, `Ability key ${id} must match its id.`);
        requireCondition(knownActions.has(String(ability.actionType)),
            `Ability ${id} references unknown action '${ability.actionType}'.`);
    }

    let humanCount = 0;
    for (const [id, character] of entries(document.characters)) {
        requireCondition(isObject(character) && character.id === id, `Character key ${id} must match its id.`);
        requireCondition(nonBlank(character.name), `Character ${id} needs a name.`);
        requireCondition(nonBlank(character.playerDescription) && nonBlank(character.aiDescription),
            `Character ${id} needs public and AI descriptions.`);
        requireCondition(own(document.locations, String(character.locationId || "")),
            `Character ${id} has an invalid location.`);
        const location = document.locations[character.locationId];
        requireCondition(isObject(location.sublocations) && own(location.sublocations, String(character.sublocationId || "")),
            `Character ${id} has an invalid sublocation.`);
        requireCondition(Number.isInteger(character.wallet) && character.wallet >= 0,
            `Character ${id} has an invalid wallet.`);
        requireCondition(controllers.has(String(character.initialControllerId)),
            `Character ${id} has an unknown initial controller.`);
        requireCondition(controllers.has(String(character.defaultControllerId)) && character.defaultControllerId !== "human",
            `Character ${id} has an invalid default controller.`);
        if (character.initialControllerId === "human") {
            humanCount += 1;
        }

        registerInventory(inventoryOwners, String(character.inventoryId || ""), `character ${id}`);
        const assigned = new Set();
        const abilityIds = Array.isArray(character.abilityIds) ? character.abilityIds : [];
        for (const rawAbilityId of abilityIds) {
            const abilityId = String(rawAbilityId || "");
            if (!nonBlank(abilityId)) {
                continue;
            }
            requireCondition(own(document.abilities, abilityId),
                `Character ${id} references missing ability '${abilityId}'.`);
            requireCondition(!assigned.has(abilityId),
                `Character ${id} assigns ability '${abilityId}' more than once.`);
            assigned.add(abilityId);
        }

        validateMind(character.initialMind, id);
        for (const relationship of character.initialMind.relationships) {
            const targetId = String((relationship && relationship.targetCharacterId) || "");
            requireCondition(own(document.characters, targetId) && targetId !== id,
                `Character ${id} has an invalid relationship target '${targetId}'.`);
        }
    }

    requireCondition(humanCount === 1,
        `Exactly one initial human-controlled character is required; found ${humanCount}.`);
}

function generateArtifacts(document) {
    const crlf = "\r\n";
    const json = JSON.stringify(document, null, 2).replace(/<\//g, "<\\/");
    const javascript = [
        "/* Generated from data/world.json. Do not edit this file directly. */",
        "(function () {",
        "    \"use strict\";",
        `    setup.GeneratedWorldData = ${json};`,
        "}());",
        ""
    ].join(crlf);

    const passages = Object.values(document.locations)
        .map((location) => `:: ${location.passage}${crlf}<div id=\"location-view\"></div>${crlf}`)
        .join(crlf);

    const startPassage = document.locations[document.startLocationId].passage;
    const storyData = [
        ":: StoryData",
        "{",
        "  \"ifid\": \"7A96C8DB-CDD6-4B5C-A486-4EF8A4DB12BB\",",
        "  \"format\": \"SugarCube\",",
        "  \"format-version\": \"2.37.3\",",
        `  \"start\": ${JSON.stringify(startPassage)},`,
        "  \"zoom\": 1",
        "}",
        ""
    ].join(crlf);

    return { javascript, passages, storyData };
}

function writeAtomically(targets) {
    const temporaryFiles = [];
    try {
        for (const [destination, content] of targets) {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            const temporary = `${destination}.tmp`;
            fs.writeFileSync(temporary, content, "utf8");
            temporaryFiles.push(temporary);
        }
        for (let index = 0; index < targets.length; index += 1) {
            fs.renameSync(temporaryFiles[index], targets[index][0]);
        }
    } finally {
        for (const temporary of temporaryFiles) {
            try {
                fs.rmSync(temporary, { force: true });
            } catch (_) {
                // Best-effort cleanup; preserve the original validation/write error.
            }
        }
    }
}

function parseArguments(argv) {
    const options = { ...defaults };
    const aliases = {
        "--input": "input", "-InputPath": "input",
        "--output": "output", "-OutputPath": "output",
        "--passages": "passages", "-PassagesPath": "passages",
        "--story-data": "storyData", "-StoryDataPath": "storyData"
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const key = aliases[argument];
        if (!key) {
            throw new Error(`Unknown argument: ${argument}`);
        }
        index += 1;
        if (index >= argv.length) {
            throw new Error(`Missing value for ${argument}.`);
        }
        options[key] = path.resolve(argv[index]);
    }
    return options;
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    requireCondition(fs.existsSync(options.input) && fs.statSync(options.input).isFile(),
        `Authoritative world data was not found: ${options.input}`);
    const document = JSON.parse(fs.readFileSync(options.input, "utf8"));
    validateWorld(document);
    const artifacts = generateArtifacts(document);
    writeAtomically([
        [options.output, artifacts.javascript],
        [options.passages, artifacts.passages],
        [options.storyData, artifacts.storyData]
    ]);
    console.log(`Generated ${options.output}`);
    console.log(`Generated ${options.passages}`);
    console.log(`Generated ${options.storyData}`);
}

try {
    main();
} catch (error) {
    console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
}
