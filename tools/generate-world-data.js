#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const defaults = {
    input: path.join(root, "data", "world.json"),
    output: path.join(root, "src", "generated", "world-data.js"),
    passages: path.join(root, "src", "generated", "world-passages.twee"),
    storyData: path.join(root, "src", "generated", "world-storydata.twee")
};

const knownActions = new Set([
    "move", "move_within_location", "take_item", "drop_item", "give_item",
    "give_money", "place_item", "fill", "consume", "equip", "unequip", "lock", "unlock", "read_aura", "sleep"
]);
const knownEnvironmentCapabilities = new Set(["ale_source"]);
const knownItemEffects = new Set(["report_memory_counts", "narrative_feedback", "abstract_study", "utility_query"]);
const knownTimelapseEffects = new Set(["collect_mugs_to_storage"]);
const controllers = new Set(["human", "dummy", "ai"]);

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

function exitRecord(exitValue) {
    if (typeof exitValue === "string") {
        return { destinationId: exitValue, blocked: false, blockedReason: "", lockId: "", locked: false, lockedReason: "" };
    }
    if (isObject(exitValue)) {
        return {
            destinationId: typeof exitValue.destinationId === "string" ? exitValue.destinationId : "",
            blocked: exitValue.blocked === true,
            blockedReason: typeof exitValue.blockedReason === "string" ? exitValue.blockedReason : "",
            lockId: typeof exitValue.lockId === "string" ? exitValue.lockId : "",
            locked: exitValue.locked === true,
            lockedReason: typeof exitValue.lockedReason === "string" ? exitValue.lockedReason : ""
        };
    }
    return { destinationId: "", blocked: false, blockedReason: "", lockId: "", locked: false, lockedReason: "" };
}

function exitTarget(exitValue) {
    return exitRecord(exitValue).destinationId;
}

function registerInventory(owners, id, owner) {
    requireCondition(nonBlank(id), `${owner} must define an inventory ID.`);
    if (owners.has(id)) {
        throw new Error(`Duplicate inventory ID '${id}' is owned by both ${owners.get(id)} and ${owner}.`);
    }
    owners.set(id, owner);
}

function registerTechnicalId(owners, id, owner) {
    requireCondition(nonBlank(id), `${owner} must define a technical ID.`);
    if (owners.has(id)) {
        throw new Error(`Duplicate technical ID '${id}' is used by both ${owners.get(id)} and ${owner}.`);
    }
    owners.set(id, owner);
}

function validateMind(mind, characterId) {
    requireCondition(isObject(mind), `Character ${characterId} must define initialMind.`);
    requireCondition(mind.schemaVersion === 3, `Character ${characterId} initialMind.schemaVersion must be 3.`);
    for (const listName of ["knownFacts", "beliefs", "relationships", "verbatimObservations", "shortTermMemories", "longTermMemories"]) {
        requireCondition(Array.isArray(mind[listName]), `Character ${characterId} initialMind.${listName} must be an array.`);
    }

    for (const listName of ["knownFacts", "beliefs", "shortTermMemories", "longTermMemories"]) {
        const seen = new Set();
        for (const record of mind[listName]) {
            const id = record && String(record.id || "");
            requireCondition(nonBlank(id), `Character ${characterId} ${listName} record needs an ID.`);
            requireCondition(!seen.has(id), `Character ${characterId} has duplicate ${listName} ID '${id}'.`);
            seen.add(id);
        }
    }

    for (const belief of mind.beliefs) {
        requireCondition(typeof belief.confidence === "number" && Number.isFinite(belief.confidence) && belief.confidence > 0 && belief.confidence < 1,
            `Character ${characterId} belief '${belief.id}' has invalid confidence.`);
        requireCondition(typeof belief.activation === "number" && Number.isFinite(belief.activation) && belief.activation > 0 && belief.activation < 1,
            `Character ${characterId} belief '${belief.id}' has invalid activation.`);
    }

    for (const listName of ["shortTermMemories", "longTermMemories"]) {
        for (const memory of mind[listName]) {
            requireCondition(nonBlank(memory.topic), `Character ${characterId} memory '${memory.id}' needs a topic.`);
            requireCondition(typeof memory.importance === "number" && Number.isFinite(memory.importance) && memory.importance >= 0 && memory.importance <= 1,
                `Character ${characterId} memory '${memory.id}' has invalid importance.`);
            requireCondition(typeof memory.protected === "boolean", `Character ${characterId} memory '${memory.id}' protected must be Boolean.`);
        }
    }
}

function validateWorld(document) {
    requireCondition(isObject(document), "world.json must contain a JSON object.");
    requireCondition(document.schemaVersion === 2, "Unsupported world schemaVersion. Expected 2.");
    requireCondition(isObject(document.locations) && isObject(document.characters) && isObject(document.abilities) &&
        isObject(document.itemDefinitions) && isObject(document.items) && isObject(document.dayActivities) && isObject(document.travelerProfiles),
        "world.json must contain locations, characters, abilities, itemDefinitions, items, dayActivities, and travelerProfiles objects.");
    requireCondition(nonBlank(document.startLocationId) && own(document.locations, document.startLocationId),
        "startLocationId must reference an existing location.");

    const passageOwners = new Map();
    const inventoryOwners = new Map();
    const technicalIdOwners = new Map();
    const lockIds = new Set();
    const keyedContainerRefs = [];

    for (const [id, location] of entries(document.locations)) {
        requireCondition(isObject(location) && location.id === id, `Location key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `location ${id}`);
        const passage = String(location.passage || "");
        requireCondition(nonBlank(passage) && !/[\r\n\[\]]/.test(passage),
            `Location ${id} has an invalid Twine passage name.`);
        if (passageOwners.has(passage)) {
            throw new Error(`Duplicate passage name '${passage}' is used by both ${passageOwners.get(passage)} and ${id}.`);
        }
        passageOwners.set(passage, id);
        registerInventory(inventoryOwners, String(location.inventoryId || ""), `location ${id}`);

        requireCondition(isObject(location.exits), `Location ${id} exits must be an object.`);
        const exitTargets = new Set();
        for (const [exitKey, exitValue] of entries(location.exits)) {
            const exit = exitRecord(exitValue);
            const destinationId = exit.destinationId;
            requireCondition(nonBlank(destinationId) && own(document.locations, destinationId),
                `Location ${id} exit '${exitKey}' references missing location '${destinationId || String(exitValue)}'.`);
            requireCondition(destinationId !== id, `Location ${id} cannot exit to itself.`);
            requireCondition(!exitTargets.has(destinationId), `Location ${id} contains duplicate exit to '${destinationId}'.`);
            exitTargets.add(destinationId);
            if (isObject(exitValue)) {
                if (own(exitValue, "blocked")) {
                    requireCondition(typeof exitValue.blocked === "boolean",
                        `Location ${id} exit '${exitKey}' blocked must be Boolean.`);
                }
                if (own(exitValue, "blockedReason")) {
                    requireCondition(typeof exitValue.blockedReason === "string",
                        `Location ${id} exit '${exitKey}' blockedReason must be text.`);
                }
                if (own(exitValue, "lockId")) {
                    requireCondition(/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(exitValue.lockId || "")),
                        `Location ${id} exit '${exitKey}' lockId is invalid.`);
                }
                if (own(exitValue, "locked")) {
                    requireCondition(typeof exitValue.locked === "boolean",
                        `Location ${id} exit '${exitKey}' locked must be Boolean.`);
                }
                if (own(exitValue, "lockedReason")) {
                    requireCondition(typeof exitValue.lockedReason === "string",
                        `Location ${id} exit '${exitKey}' lockedReason must be text.`);
                }
                requireCondition(Boolean(exit.lockId) || (!own(exitValue, "locked") && !own(exitValue, "lockedReason")),
                    `Location ${id} exit '${exitKey}' cannot define lock state without lockId.`);
            }
            if (exit.lockId) {
                lockIds.add(exit.lockId);
                const destination = document.locations[destinationId];
                const reciprocalValue = entries(destination.exits).map((pair) => pair[1])
                    .find((value) => exitTarget(value) === id);
                const reciprocal = exitRecord(reciprocalValue);
                requireCondition(Boolean(reciprocalValue) && reciprocal.lockId === exit.lockId && reciprocal.locked === exit.locked,
                    `Location ${id} exit '${exitKey}' has an inconsistent reciprocal lock.`);
            }
        }

        const timelapseActions = location.timelapseActions === undefined ? [] : location.timelapseActions;
        requireCondition(Array.isArray(timelapseActions), `Location ${id} timelapseActions must be an array.`);
        const timelapseActionIds = new Set();
        for (const action of timelapseActions) {
            requireCondition(isObject(action) && nonBlank(action.id) && nonBlank(action.label) &&
                nonBlank(action.description) && nonBlank(action.effectId) && isObject(action.effectParams),
            `Location ${id} has an invalid timelapseAction.`);
            requireCondition(!timelapseActionIds.has(action.id),
                `Location ${id} has duplicate timelapseAction ID '${action.id}'.`);
            timelapseActionIds.add(action.id);
            requireCondition(knownTimelapseEffects.has(action.effectId),
                `Location ${id} timelapseAction '${action.id}' references unknown effect '${action.effectId}'.`);
        }

        requireCondition(isObject(location.sublocations) && own(location.sublocations, String(location.defaultSublocationId || "")),
            `Location ${id} has an invalid default sublocation.`);
        for (const [sublocationId, sublocation] of entries(location.sublocations)) {
            requireCondition(isObject(sublocation) && sublocation.id === sublocationId && sublocation.locationId === id,
                `Sublocation ${sublocationId} has invalid identity or parent.`);
            registerTechnicalId(technicalIdOwners, sublocationId, `sublocation ${sublocationId}`);
            if (nonBlank(String(sublocation.inventoryId || ""))) {
                registerInventory(inventoryOwners, String(sublocation.inventoryId), `sublocation ${sublocationId}`);
            }
            if (own(sublocation, "requiredKeyItemId")) {
                requireCondition(nonBlank(String(sublocation.inventoryId || "")),
                    `Sublocation ${sublocationId} cannot require a key without an inventory.`);
                requireCondition(/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(sublocation.requiredKeyItemId || "")),
                    `Sublocation ${sublocationId} has invalid requiredKeyItemId '${String(sublocation.requiredKeyItemId)}'.`);
                keyedContainerRefs.push({ sublocationId: sublocationId, itemId: String(sublocation.requiredKeyItemId) });
            }
            const capabilities = Array.isArray(sublocation.capabilities) ? sublocation.capabilities : [];
            for (const capability of capabilities) {
                const action = String(capability || "");
                if (nonBlank(action)) {
                    requireCondition(knownActions.has(action) || knownEnvironmentCapabilities.has(action),
                        `Sublocation ${sublocationId} grants unknown action '${action}'.`);
                }
            }
        }
    }

    for (const [id, definition] of entries(document.itemDefinitions)) {
        requireCondition(isObject(definition) && definition.id === id,
            `Item definition key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `item definition ${id}`);
        requireCondition(nonBlank(definition.name) && nonBlank(definition.familyId),
            `Item definition ${id} needs a name and familyId.`);
        requireCondition(Array.isArray(definition.tags), `Item definition ${id} tags must be an array.`);
        if (own(definition, "keyLockId")) {
            requireCondition(/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(definition.keyLockId || "")) &&
                lockIds.has(definition.keyLockId),
            `Item definition ${id} references invalid keyLockId '${definition.keyLockId}'.`);
        }
        for (const flag of ["consumable", "fillable"]) {
            requireCondition(typeof definition[flag] === "boolean",
                `Item definition ${id} ${flag} must be Boolean.`);
        }
        const equipSlots = definition.equipSlots === undefined ? [] : definition.equipSlots;
        requireCondition(Array.isArray(equipSlots) && equipSlots.every(nonBlank) && new Set(equipSlots).size === equipSlots.length,
            `Item definition ${id} equipSlots must be a unique list of non-empty strings.`);
        if (equipSlots.length > 0) {
            requireCondition(nonBlank(definition.equippedDescription),
                `Item definition ${id} with equipSlots requires equippedDescription.`);
        } else if (definition.equippedDescription !== undefined) {
            requireCondition(typeof definition.equippedDescription === "string",
                `Item definition ${id} equippedDescription must be text.`);
        }
        if (definition.fillAction) {
            requireCondition(nonBlank(definition.fillAction.actionLabel) &&
                nonBlank(definition.fillAction.requiredEnvironmentCapability) &&
                nonBlank(definition.fillAction.resultDefinitionId),
            `Item definition ${id} has an invalid fillAction.`);
        }
        if (definition.consumeAction) {
            requireCondition(nonBlank(definition.consumeAction.actionLabel) &&
                definition.consumeAction.resultType === "transform" &&
                nonBlank(definition.consumeAction.resultDefinitionId),
            `Item definition ${id} has an invalid consumeAction.`);
        }
        if (definition.description !== undefined) {
            requireCondition(typeof definition.description === "string",
                `Item definition ${id} description must be text.`);
        }
        if (definition.useAction) {
            requireCondition(nonBlank(definition.useAction.actionLabel) &&
                nonBlank(definition.useAction.effectId) &&
                knownItemEffects.has(definition.useAction.effectId) &&
                nonBlank(definition.useAction.publicText) &&
                nonBlank(definition.useAction.feedbackText),
            `Item definition ${id} has an invalid useAction.`);
            if (definition.useAction.aiInstructions !== undefined) {
                requireCondition(typeof definition.useAction.aiInstructions === "string" && nonBlank(definition.useAction.aiInstructions),
                    `Item definition ${id} useAction.aiInstructions must be non-empty text when present.`);
            }
            if (definition.useAction.effectId === "utility_query" || definition.useAction.effectId === "abstract_study") {
                requireCondition(nonBlank(definition.useAction.inputLabel),
                    `Item definition ${id} ${definition.useAction.effectId} useAction requires inputLabel.`);
                if (definition.useAction.inputPlaceholder !== undefined) {
                    requireCondition(typeof definition.useAction.inputPlaceholder === "string",
                        `Item definition ${id} useAction.inputPlaceholder must be text when present.`);
                }
                if (definition.useAction.inputMaxLength !== undefined) {
                    requireCondition(Number.isInteger(definition.useAction.inputMaxLength) &&
                        definition.useAction.inputMaxLength >= 1 && definition.useAction.inputMaxLength <= 2000,
                        `Item definition ${id} useAction.inputMaxLength must be an integer from 1 to 2000.`);
                }
            }
            if (definition.useAction.effectId === "abstract_study") {
                for (const field of ["focusedFeedbackText", "saturatedFeedbackText"]) {
                    if (definition.useAction[field] !== undefined) {
                        requireCondition(typeof definition.useAction[field] === "string" && nonBlank(definition.useAction[field]),
                            `Item definition ${id} useAction.${field} must be non-empty text when present.`);
                    }
                }
            }
            if (definition.useAction.effectId === "utility_query") {
                requireCondition(nonBlank(definition.useAction.utilityPrompt),
                    `Item definition ${id} utility_query useAction requires utilityPrompt.`);
                if (definition.useAction.utilityMaxTokens !== undefined) {
                    requireCondition(Number.isInteger(definition.useAction.utilityMaxTokens) &&
                        definition.useAction.utilityMaxTokens >= 64 && definition.useAction.utilityMaxTokens <= 4000,
                        `Item definition ${id} useAction.utilityMaxTokens must be an integer from 64 to 4000.`);
                }
            }
        }
    }

    for (const [id, definition] of entries(document.itemDefinitions)) {
        for (const actionField of ["fillAction", "consumeAction"]) {
            const action = definition[actionField];
            if (action) {
                requireCondition(own(document.itemDefinitions, action.resultDefinitionId),
                    `Item definition ${id} references missing result definition '${action.resultDefinitionId}'.`);
            }
        }
    }

    for (const [id, ability] of entries(document.abilities)) {
        requireCondition(isObject(ability) && ability.id === id, `Ability key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `ability ${id}`);
        requireCondition(knownActions.has(String(ability.actionType)),
            `Ability ${id} references unknown action '${ability.actionType}'.`);
    }

    for (const [id, profile] of entries(document.travelerProfiles)) {
        requireCondition(isObject(profile) && profile.id === id, `Traveler profile key ${id} must match its id.`);
        requireCondition(/^[A-Za-z][A-Za-z0-9_-]*$/.test(id), `Traveler profile ${id} has an invalid technical ID.`);
        requireCondition(nonBlank(profile.name) && profile.name.trim().length <= 120, `Traveler profile ${id} needs a name up to 120 characters.`);
        requireCondition(nonBlank(profile.playerDescription) && profile.playerDescription.trim().length <= 2000, `Traveler profile ${id} needs a visible description up to 2000 characters.`);
        requireCondition(nonBlank(profile.aiDescription) && profile.aiDescription.trim().length <= 4000, `Traveler profile ${id} needs AI-facing authoring up to 4000 characters.`);
        requireCondition(Object.keys(profile).every((key) => ["id", "name", "playerDescription", "aiDescription"].includes(key)),
            `Traveler profile ${id} may contain only id, name, playerDescription, and aiDescription.`);
    }

    let humanCount = 0;
    for (const [id, character] of entries(document.characters)) {
        requireCondition(isObject(character) && character.id === id, `Character key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `character ${id}`);
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

    for (const [locationId, location] of entries(document.locations)) {
        for (const action of (location.timelapseActions || [])) {
            if (action.effectId === "collect_mugs_to_storage") {
                const params = action.effectParams || {};
                requireCondition(nonBlank(params.itemFamilyId) && nonBlank(params.emptyDefinitionId) &&
                    nonBlank(params.destinationInventoryId),
                `Location ${locationId} timelapseAction '${action.id}' has invalid collect_mugs_to_storage parameters.`);
                requireCondition(own(document.itemDefinitions, params.emptyDefinitionId),
                    `Location ${locationId} timelapseAction '${action.id}' references missing empty definition '${params.emptyDefinitionId}'.`);
                requireCondition(inventoryOwners.has(params.destinationInventoryId),
                    `Location ${locationId} timelapseAction '${action.id}' references missing destination inventory '${params.destinationInventoryId}'.`);
            }
        }
    }


    for (const [id, activity] of entries(document.dayActivities)) {
        requireCondition(isObject(activity) && activity.id === id, `Day activity key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `day activity ${id}`);
        requireCondition(activity.kind === "sponsored_job" || activity.kind === "solo",
            `Day activity ${id} has invalid kind.`);
        requireCondition(nonBlank(activity.name) && own(document.locations, String(activity.workLocationId || "")),
            `Day activity ${id} needs a name and valid workLocationId.`);
        requireCondition(nonBlank(activity.narrationInstructions),
            `Day activity ${id} needs narrationInstructions.`);
        if (activity.kind === "sponsored_job") {
            requireCondition(own(document.characters, String(activity.sponsorCharacterId || "")),
                `Day activity ${id} references missing sponsorCharacterId '${activity.sponsorCharacterId}'.`);
            requireCondition(nonBlank(activity.offerDescription),
                `Day activity ${id} needs offerDescription.`);
        } else {
            requireCondition(!activity.sponsorCharacterId && own(document.locations, String(activity.entryLocationId || "")) && nonBlank(activity.entryActionLabel),
                `Solo day activity ${id} needs a valid entryLocationId and entryActionLabel.`);
        }
        const settlement = activity.settlement;
        requireCondition(isObject(settlement) && ["sponsor_items", "sponsor_gold", "random_items"].includes(settlement.type),
            `Day activity ${id} has invalid settlement.`);
        if (settlement.type === "sponsor_items") {
            requireCondition(Number.isInteger(settlement.minTotal) && Number.isInteger(settlement.maxTotal) &&
                settlement.minTotal >= 1 && settlement.maxTotal >= settlement.minTotal && Array.isArray(settlement.definitionIds) && settlement.definitionIds.length > 0,
                `Day activity ${id} has invalid sponsor_items settlement bounds.`);
            settlement.definitionIds.forEach((definitionId) => requireCondition(own(document.itemDefinitions, String(definitionId || "")),
                `Day activity ${id} settlement references missing item definition '${definitionId}'.`));
        } else if (settlement.type === "sponsor_gold") {
            requireCondition(Number.isInteger(settlement.min) && Number.isInteger(settlement.max) && settlement.min >= 0 && settlement.max >= settlement.min,
                `Day activity ${id} has invalid sponsor_gold settlement bounds.`);
        } else if (settlement.type === "random_items") {
            requireCondition(Number.isInteger(settlement.minTotal) && Number.isInteger(settlement.maxTotal) && settlement.minTotal >= 1 &&
                settlement.maxTotal >= settlement.minTotal && own(document.itemDefinitions, String(settlement.definitionId || "")),
                `Day activity ${id} has invalid random_items settlement.`);
        }
    }

    const authoredEquipmentSlots = new Set();
    for (const [id, item] of entries(document.items)) {
        requireCondition(isObject(item) && item.id === id, `Item key ${id} must match its id.`);
        registerTechnicalId(technicalIdOwners, id, `item ${id}`);
        requireCondition(own(document.itemDefinitions, String(item.definitionId || "")),
            `Item ${id} references missing definition '${item.definitionId}'.`);
        const hasInventory = nonBlank(String(item.inventoryId || ""));
        const hasEquippedOwner = nonBlank(String(item.equippedByCharacterId || ""));
        const hasEquippedSlot = nonBlank(String(item.equippedSlot || ""));
        requireCondition(hasInventory !== hasEquippedOwner,
            `Item ${id} must start in exactly one inventory or equipped on one character.`);
        if (hasInventory) {
            requireCondition(!hasEquippedSlot && inventoryOwners.has(String(item.inventoryId)),
                `Item ${id} references missing inventory '${item.inventoryId}' or also defines equippedSlot.`);
        } else {
            requireCondition(hasEquippedSlot && own(document.characters, String(item.equippedByCharacterId)),
                `Item ${id} has invalid equipped starting placement.`);
            const definition = document.itemDefinitions[item.definitionId];
            requireCondition(Array.isArray(definition.equipSlots) && definition.equipSlots.includes(item.equippedSlot),
                `Item ${id} equippedSlot '${item.equippedSlot}' is not allowed by its definition.`);
            const occupancyKey = `${item.equippedByCharacterId}:${item.equippedSlot}`;
            requireCondition(!authoredEquipmentSlots.has(occupancyKey),
                `Item ${id} conflicts with another authored item in ${occupancyKey}.`);
            authoredEquipmentSlots.add(occupancyKey);
        }
    }

    keyedContainerRefs.forEach(function (record) {
        requireCondition(own(document.items, record.itemId),
            `Sublocation ${record.sublocationId} references missing required key item '${record.itemId}'.`);
    });

    requireCondition(humanCount === 1,
        `Exactly one initial human-controlled character is required; found ${humanCount}.`);
}

function canonicalizeForRevision(value) {
    if (Array.isArray(value)) return value.map(canonicalizeForRevision);
    if (!isObject(value)) return value;
    const result = {};
    Object.keys(value).sort().forEach((key) => {
        result[key] = canonicalizeForRevision(value[key]);
    });
    return result;
}

function authoringRevision(document) {
    return crypto.createHash("sha256")
        .update(JSON.stringify(canonicalizeForRevision(document)), "utf8")
        .digest("hex");
}

function generateArtifacts(document) {
    const crlf = "\r\n";
    const generatedDocument = Object.assign({}, document, { authoringRevision: authoringRevision(document) });
    const json = JSON.stringify(generatedDocument, null, 2).replace(/<\//g, "<\\/");
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
