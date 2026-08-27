(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.AIRPGAuthoredValidator = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
const knownActions = new Set([
    "move", "move_within_location", "take_item", "drop_item", "give_item",
    "give_money", "show_hidden_location", "transfer_items", "place_item", "fill", "consume", "equip", "unequip", "lock", "unlock", "read_paper", "write_paper", "sleep", "authored_interaction", "serve_food", "use_ability"
]);
const knownEnvironmentCapabilities = new Set(["ale_source"]);
const knownItemEffects = new Set(["report_memory_counts", "narrative_feedback", "abstract_study", "utility_query"]);
const knownTimelapseEffects = new Set(["collect_mugs_to_storage"]);
const knownAbilityEffects = new Set(["read_aura", "emit_location_observation"]);
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


function validateSecretReference(record, label, secretIds) {
    if (!isObject(record) || !own(record, "secretId")) return;
    requireCondition(nonBlank(record.secretId) && secretIds.has(record.secretId),
        `${label} secretId '${String(record.secretId || "")}' must reference an authored secret.`);
}

function validateRandomEffect(effect, label, document) {
    requireCondition(isObject(effect) && nonBlank(effect.type), `${label} must be an effect object with a type.`);
    const allowed = new Set(["emit_observation", "reveal_location", "encounter_character", "modify_wallet", "create_item"]);
    requireCondition(allowed.has(effect.type), `${label} has unsupported effect type '${String(effect.type)}'.`);
    if (effect.type === "emit_observation") {
        requireCondition(nonBlank(effect.text), `${label} emit_observation requires text.`);
    } else if (effect.type === "reveal_location") {
        const location = document.locations && document.locations[effect.locationId];
        requireCondition(location && location.requiresDiscovery === true,
            `${label} reveal_location must reference a requiresDiscovery location.`);
        if (own(effect, "observationText")) requireCondition(nonBlank(effect.observationText), `${label} observationText must be non-empty text.`);
    } else if (effect.type === "encounter_character") {
        const character = document.characters && document.characters[effect.characterId];
        requireCondition(character && character.requiresDiscovery === true,
            `${label} encounter_character must reference a requiresDiscovery character.`);
        if (own(effect, "observationText")) requireCondition(nonBlank(effect.observationText), `${label} observationText must be non-empty text.`);
    } else if (effect.type === "modify_wallet") {
        requireCondition(effect.target === "actor" && Number.isInteger(effect.amount) && effect.amount !== 0,
            `${label} modify_wallet currently requires target=actor and a non-zero integer amount.`);
    } else if (effect.type === "create_item") {
        requireCondition(own(document.itemDefinitions || {}, String(effect.itemDefinitionId || "")),
            `${label} create_item references missing item definition '${String(effect.itemDefinitionId || "")}'.`);
        requireCondition(effect.destination === "actor_inventory",
            `${label} create_item currently requires destination=actor_inventory.`);
        requireCondition(effect.quantity === undefined || (Number.isInteger(effect.quantity) && effect.quantity > 0 && effect.quantity <= 100),
            `${label} create_item quantity must be a positive integer up to 100.`);
    }
}


function validatePresenceFallback(record, label, document) {
    const ownerId = nonBlank(String(record && record.presenceOwnerCharacterId || "")) ? String(record.presenceOwnerCharacterId) : "";
    const fallback = record && record.presenceFallbackPlacement;
    if (!ownerId) {
        requireCondition(fallback === undefined, `${label} cannot define presenceFallbackPlacement without presenceOwnerCharacterId.`);
        return;
    }

    function validateExplicit(value) {
        requireCondition(isObject(value) && nonBlank(value.locationId) && nonBlank(value.sublocationId) &&
            Object.keys(value).every(function (key) { return key === "locationId" || key === "sublocationId"; }),
            `${label} presenceFallbackPlacement must contain locationId and sublocationId.`);
        const location = document.locations[value.locationId];
        const sublocation = location && location.sublocations && location.sublocations[value.sublocationId];
        requireCondition(location && sublocation, `${label} presenceFallbackPlacement references an invalid location/sublocation pair.`);
        requireCondition(location.presenceOwnerCharacterId !== ownerId && sublocation.presenceOwnerCharacterId !== ownerId,
            `${label} presenceFallbackPlacement cannot remain inside topology owned by the same presence owner.`);
    }

    if (fallback !== undefined) {
        validateExplicit(fallback);
        return;
    }

    if (record.type === "sublocation") {
        const parent = document.locations[record.locationId];
        const defaultSublocation = parent && parent.sublocations && parent.sublocations[parent.defaultSublocationId];
        requireCondition(parent && defaultSublocation && defaultSublocation.id !== record.id &&
            parent.presenceOwnerCharacterId !== ownerId && defaultSublocation.presenceOwnerCharacterId !== ownerId,
            `${label} has no safe implicit presence fallback; author presenceFallbackPlacement explicitly.`);
        return;
    }

    const destinationIds = Array.from(new Set(entries(record.exits).map(function (pair) { return exitTarget(pair[1]); }).filter(nonBlank)));
    requireCondition(destinationIds.length === 1, `${label} has ambiguous external exits and requires explicit presenceFallbackPlacement.`);
    const destination = document.locations[destinationIds[0]];
    const defaultSublocation = destination && destination.sublocations && destination.sublocations[destination.defaultSublocationId];
    requireCondition(destination && defaultSublocation && destination.presenceOwnerCharacterId !== ownerId && defaultSublocation.presenceOwnerCharacterId !== ownerId,
        `${label} has no safe implicit presence fallback; author presenceFallbackPlacement explicitly.`);
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
            if (Object.prototype.hasOwnProperty.call(memory, "retrievalBrief")) {
                requireCondition(typeof memory.retrievalBrief === "string" && memory.retrievalBrief.length <= 600,
                    `Character ${characterId} memory '${memory.id}' retrievalBrief must be a string up to 600 characters.`);
            }
        }
    }
}

function validateWorld(document) {
    requireCondition(isObject(document), "world.json must contain a JSON object.");
    requireCondition(document.schemaVersion === 2, "Unsupported world schemaVersion. Expected 2.");
    requireCondition(isObject(document.locations) && isObject(document.characters) && isObject(document.abilities) &&
        isObject(document.itemDefinitions) && isObject(document.items) && isObject(document.dayActivities),
        "world.json must contain locations, characters, abilities, itemDefinitions, items, and dayActivities objects.");
    requireCondition(document.secrets === undefined || isObject(document.secrets), "secrets must be an object when present.");
    requireCondition(document.randomOutcomeTables === undefined || isObject(document.randomOutcomeTables), "randomOutcomeTables must be an object when present.");
    requireCondition(document.triggeredEvents === undefined || isObject(document.triggeredEvents), "triggeredEvents must be an object when present.");
    const secretIds = new Set();
    for (const [secretKey, secret] of entries(document.secrets || {})) {
        requireCondition(isObject(secret) && secret.id === secretKey && nonBlank(secretKey), `Secret key ${secretKey} must match its non-empty id.`);
        requireCondition(!secretIds.has(secretKey), `Duplicate secret ID '${secretKey}'.`);
        secretIds.add(secretKey);
        requireCondition(typeof secret.enabled === "boolean", `Secret ${secretKey} enabled must be Boolean.`);
        requireCondition(nonBlank(secret.name), `Secret ${secretKey} needs an author-facing name.`);
    }
    if (document.calendar !== undefined) {
        requireCondition(isObject(document.calendar), "calendar must be an object when present.");
        requireCondition(Array.isArray(document.calendar.weekdayNames) && document.calendar.weekdayNames.length === 7 &&
            document.calendar.weekdayNames.every(nonBlank) && new Set(document.calendar.weekdayNames).size === 7,
            "calendar.weekdayNames must contain exactly seven unique non-empty weekday names.");
        requireCondition(Number.isInteger(document.calendar.initialWeekdayIndex) && document.calendar.initialWeekdayIndex >= 0 && document.calendar.initialWeekdayIndex < 7,
            "calendar.initialWeekdayIndex must be an integer from 0 to 6.");
    }
    requireCondition(nonBlank(document.startLocationId) && own(document.locations, document.startLocationId),
        "startLocationId must reference an existing location.");

    const passageOwners = new Map();
    const inventoryOwners = new Map();
    const technicalIdOwners = new Map();
    const lockIds = new Set();
    const keyedContainerRefs = [];
    const presenceOwnerRefs = [];

    for (const [id, location] of entries(document.locations)) {
        requireCondition(isObject(location) && location.id === id, `Location key ${id} must match its id.`);
        validateSecretReference(location, `Location ${id}`, secretIds);
        registerTechnicalId(technicalIdOwners, id, `location ${id}`);
        const passage = String(location.passage || "");
        requireCondition(nonBlank(passage) && !/[\r\n\[\]]/.test(passage),
            `Location ${id} has an invalid Twine passage name.`);
        if (passageOwners.has(passage)) {
            throw new Error(`Duplicate passage name '${passage}' is used by both ${passageOwners.get(passage)} and ${id}.`);
        }
        passageOwners.set(passage, id);
        registerInventory(inventoryOwners, String(location.inventoryId || ""), `location ${id}`);
        if (own(location, "presenceOwnerCharacterId")) {
            requireCondition(nonBlank(String(location.presenceOwnerCharacterId || "")), `Location ${id} presenceOwnerCharacterId must be a non-empty character ID.`);
            presenceOwnerRefs.push({ locationId: id, characterId: String(location.presenceOwnerCharacterId) });
        }
        validatePresenceFallback(location, `Location ${id}`, document);
        if (own(location, "requiresDiscovery")) {
            requireCondition(typeof location.requiresDiscovery === "boolean", `Location ${id} requiresDiscovery must be Boolean.`);
        }

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
            validateSecretReference(sublocation, `Sublocation ${sublocationId}`, secretIds);
            registerTechnicalId(technicalIdOwners, sublocationId, `sublocation ${sublocationId}`);
            if (nonBlank(String(sublocation.inventoryId || ""))) {
                registerInventory(inventoryOwners, String(sublocation.inventoryId), `sublocation ${sublocationId}`);
            }
            if (own(sublocation, "presenceOwnerCharacterId")) {
                requireCondition(nonBlank(String(sublocation.presenceOwnerCharacterId || "")), `Sublocation ${sublocationId} presenceOwnerCharacterId must be a non-empty character ID.`);
                presenceOwnerRefs.push({ locationId: id, sublocationId: sublocationId, characterId: String(sublocation.presenceOwnerCharacterId) });
            }
            validatePresenceFallback(sublocation, `Sublocation ${sublocationId}`, document);
            if (own(sublocation, "requiredKeyItemId")) {
                requireCondition(nonBlank(String(sublocation.inventoryId || "")),
                    `Sublocation ${sublocationId} cannot require a key without an inventory.`);
                requireCondition(/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(sublocation.requiredKeyItemId || "")),
                    `Sublocation ${sublocationId} has invalid requiredKeyItemId '${String(sublocation.requiredKeyItemId)}'.`);
                keyedContainerRefs.push({ sublocationId: sublocationId, itemId: String(sublocation.requiredKeyItemId) });
            }
            if (sublocation.phasePublicText !== undefined) {
                requireCondition(isObject(sublocation.phasePublicText), `Sublocation ${sublocationId} phasePublicText must be an object.`);
                for (const [phase, text] of entries(sublocation.phasePublicText)) {
                    requireCondition(["Morning", "Evening"].includes(phase) && nonBlank(text),
                        `Sublocation ${sublocationId} phasePublicText has invalid phase/text '${phase}'.`);
                }
            }
            const interactions = sublocation.interactions === undefined ? [] : sublocation.interactions;
            requireCondition(Array.isArray(interactions), `Sublocation ${sublocationId} interactions must be an array.`);
            const interactionIds = new Set();
            for (const interaction of interactions) {
                requireCondition(isObject(interaction) && nonBlank(interaction.id) && nonBlank(interaction.actionLabel) && interaction.effectId === "random_outcome" && nonBlank(interaction.outcomeTableId),
                    `Sublocation ${sublocationId} has an invalid authored interaction.`);
                validateSecretReference(interaction, `Sublocation ${sublocationId} interaction ${String(interaction.id)}`, secretIds);
                requireCondition(!interactionIds.has(interaction.id), `Sublocation ${sublocationId} has duplicate interaction ID '${interaction.id}'.`);
                interactionIds.add(interaction.id);
                registerTechnicalId(technicalIdOwners, interaction.id, `environment interaction ${interaction.id}`);
            }
            const servingActions = sublocation.servingActions === undefined ? [] : sublocation.servingActions;
            requireCondition(Array.isArray(servingActions), `Sublocation ${sublocationId} servingActions must be an array.`);
            const servingActionIds = new Set();
            servingActions.forEach(function (serving, servingIndex) {
                requireCondition(isObject(serving) && nonBlank(serving.id) && nonBlank(serving.actionLabel) &&
                    Array.isArray(serving.phases) && serving.phases.length > 0 &&
                    serving.phases.every(function (phase) { return ["Morning", "Evening"].includes(phase); }) &&
                    new Set(serving.phases).size === serving.phases.length &&
                    own(document.itemDefinitions, String(serving.requiredDishDefinitionId || "")) &&
                    own(document.itemDefinitions, String(serving.resultDefinitionId || "")) &&
                    nonBlank(serving.aiDescription) && Array.isArray(serving.aiPrerequisites) && serving.aiPrerequisites.every(nonBlank),
                    `Sublocation ${sublocationId} serving action ${servingIndex} is invalid.`);
                requireCondition(!servingActionIds.has(serving.id), `Sublocation ${sublocationId} has duplicate serving action ID '${serving.id}'.`);
                servingActionIds.add(serving.id);
                registerTechnicalId(technicalIdOwners, serving.id, `serving action ${serving.id}`);
                requireCondition(nonBlank(String(sublocation.inventoryId || "")), `Sublocation ${sublocationId} serving actions require a sublocation inventory.`);
                const dish = document.itemDefinitions[serving.requiredDishDefinitionId];
                const result = document.itemDefinitions[serving.resultDefinitionId];
                requireCondition(result && result.consumeAction && result.consumeAction.resultType === "transform" &&
                    result.consumeAction.resultDefinitionId === serving.requiredDishDefinitionId,
                    `Sublocation ${sublocationId} serving action ${serving.id} result must consume back to its required reusable dish.`);
                requireCondition(dish && Array.isArray(dish.tags) && dish.tags.includes("food_dish") && dish.tags.includes("empty"),
                    `Sublocation ${sublocationId} serving action ${serving.id} requires an invalid reusable dish definition.`);
            });

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
        validateSecretReference(definition, `Item definition ${id}`, secretIds);
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
        for (const flag of ["writable", "writingCapability"]) {
            if (own(definition, flag)) requireCondition(typeof definition[flag] === "boolean", `Item definition ${id} ${flag} must be Boolean when present.`);
        }
        if (own(definition, "externalSaleValue")) {
            requireCondition(Number.isInteger(definition.externalSaleValue) && definition.externalSaleValue >= 0,
                `Item definition ${id} externalSaleValue must be a non-negative integer when present.`);
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
            const consume = definition.consumeAction;
            requireCondition(nonBlank(consume.actionLabel) && ["transform", "remove"].includes(consume.resultType),
                `Item definition ${id} has an invalid consumeAction.`);
            if (consume.resultType === "transform") {
                requireCondition(nonBlank(consume.resultDefinitionId), `Item definition ${id} transform consumeAction requires resultDefinitionId.`);
            } else {
                requireCondition(!own(consume, "resultDefinitionId") || consume.resultDefinitionId === null || consume.resultDefinitionId === "",
                    `Item definition ${id} remove consumeAction must not define resultDefinitionId.`);
            }
            if (own(consume, "feedbackText")) requireCondition(nonBlank(consume.feedbackText), `Item definition ${id} consumeAction.feedbackText must be non-empty text.`);
            if (own(consume, "publicText")) requireCondition(nonBlank(consume.publicText), `Item definition ${id} consumeAction.publicText must be non-empty text.`);
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
                if (definition.useAction.knowledgeEntries !== undefined) {
                    const entries = definition.useAction.knowledgeEntries;
                    requireCondition(Array.isArray(entries) && entries.length <= 500,
                        `Item definition ${id} useAction.knowledgeEntries must be an array with at most 500 entries.`);
                    const entryIds = new Set();
                    for (const entry of Array.isArray(entries) ? entries : []) {
                        requireCondition(entry && typeof entry === "object" && !Array.isArray(entry),
                            `Item definition ${id} has an invalid knowledge entry.`);
                        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
                        validateSecretReference(entry, `Item definition ${id} knowledge entry ${entry.id || "?"}`, secretIds);
                        requireCondition(nonBlank(entry.id) && entry.id.length <= 120 && !entryIds.has(entry.id),
                            `Item definition ${id} has an invalid or duplicate knowledge entry ID.`);
                        if (nonBlank(entry.id)) entryIds.add(entry.id);
                        if (entry.title !== undefined) {
                            requireCondition(typeof entry.title === "string" && nonBlank(entry.title) && entry.title.length <= 240,
                                `Item definition ${id} knowledge entry ${entry.id || "?"} has an invalid title.`);
                        }
                        requireCondition(typeof entry.article === "string" && nonBlank(entry.article) && entry.article.length <= 8000,
                            `Item definition ${id} knowledge entry ${entry.id || "?"} must contain article text up to 8000 characters.`);
                        if (entry.priority !== undefined) {
                            requireCondition(Number.isInteger(entry.priority) && entry.priority >= -1000 && entry.priority <= 1000,
                                `Item definition ${id} knowledge entry ${entry.id || "?"} priority must be an integer from -1000 to 1000.`);
                        }
                        requireCondition(Array.isArray(entry.keywords) && entry.keywords.length >= 1 && entry.keywords.length <= 32,
                            `Item definition ${id} knowledge entry ${entry.id || "?"} requires 1 to 32 keywords.`);
                        const keywords = new Set();
                        for (const keyword of Array.isArray(entry.keywords) ? entry.keywords : []) {
                            requireCondition(typeof keyword === "string" && nonBlank(keyword) && keyword.length <= 120 && !keywords.has(keyword),
                                `Item definition ${id} knowledge entry ${entry.id || "?"} has an invalid or duplicate keyword.`);
                            if (typeof keyword !== "string") continue;
                            keywords.add(keyword);
                            const firstStar = keyword.indexOf("*");
                            requireCondition(firstStar < 0 || (firstStar === keyword.length - 1 && keyword.lastIndexOf("*") === firstStar),
                                `Item definition ${id} knowledge entry ${entry.id || "?"} keyword ${keyword} may use only one trailing wildcard.`);
                            const stem = keyword.endsWith("*") ? keyword.slice(0, -1).trim() : keyword.trim();
                            requireCondition(/^[\p{L}\p{N}].*/u.test(stem),
                                `Item definition ${id} knowledge entry ${entry.id || "?"} contains an unusable keyword.`);
                        }
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
        if (definition.fillAction) {
            requireCondition(own(document.itemDefinitions, definition.fillAction.resultDefinitionId),
                `Item definition ${id} references missing result definition '${definition.fillAction.resultDefinitionId}'.`);
        }
        if (definition.consumeAction && definition.consumeAction.resultType === "transform") {
            requireCondition(own(document.itemDefinitions, definition.consumeAction.resultDefinitionId),
                `Item definition ${id} references missing result definition '${definition.consumeAction.resultDefinitionId}'.`);
        }
    }

    for (const [id, ability] of entries(document.abilities)) {
        requireCondition(isObject(ability) && ability.id === id, `Ability key ${id} must match its id.`);
        validateSecretReference(ability, `Ability ${id}`, secretIds);
        registerTechnicalId(technicalIdOwners, id, `ability ${id}`);
        requireCondition(ability.actionType === "use_ability",
            `Ability ${id} must use canonical actionType 'use_ability'.`);
        requireCondition(knownAbilityEffects.has(String(ability.effectType || "")),
            `Ability ${id} references unknown effectType '${String(ability.effectType)}'.`);
        if (ability.effectType === "emit_location_observation") {
            requireCondition(nonBlank(ability.publicText) && nonBlank(ability.feedbackText),
                `Ability ${id} emit_location_observation effect requires publicText and feedbackText.`);
        }
    }

    function authoredInventoryExists(inventoryId) {
        if (!nonBlank(String(inventoryId || ""))) return false;
        if (inventoryOwners.has(String(inventoryId))) return true;
        return entries(document.characters).some(function (entry) { return String(entry[1] && entry[1].inventoryId || "") === String(inventoryId); });
    }

    function validateRestockEntries(ownerId, hook, label) {
        requireCondition(isObject(hook) && Array.isArray(hook.entries), `${label}.entries must be an array.`);
        requireCondition(authoredInventoryExists(hook.targetInventoryId), `${label} has an invalid targetInventoryId.`);
        hook.entries.forEach(function (entry, index) {
            requireCondition(isObject(entry) && own(document.itemDefinitions, String(entry.definitionId || "")),
                `${label} entry ${index} references an invalid item definition.`);
            for (const field of ["min", "max"]) requireCondition(Number.isInteger(entry[field]) && entry[field] >= 0,
                `${label} entry ${index} ${field} must be a non-negative integer.`);
            requireCondition(entry.max >= entry.min, `${label} entry ${index} max must be >= min.`);
            if (own(entry, "chance")) requireCondition(typeof entry.chance === "number" && Number.isFinite(entry.chance) && entry.chance >= 0 && entry.chance <= 1,
                `${label} entry ${index} chance must be from 0 to 1.`);
        });
    }

    let humanCount = 0;
    for (const [id, character] of entries(document.characters)) {
        requireCondition(isObject(character) && character.id === id, `Character key ${id} must match its id.`);
        validateSecretReference(character, `Character ${id}`, secretIds);
        registerTechnicalId(technicalIdOwners, id, `character ${id}`);
        requireCondition(nonBlank(character.name), `Character ${id} needs a name.`);
        requireCondition(nonBlank(character.playerDescription) && nonBlank(character.aiDescription),
            `Character ${id} needs public and AI descriptions.`);
        if (own(character, "requiresDiscovery")) requireCondition(typeof character.requiresDiscovery === "boolean", `Character ${id} requiresDiscovery must be Boolean.`);
        if (own(character, "playerControllable")) requireCondition(typeof character.playerControllable === "boolean", `Character ${id} playerControllable must be Boolean.`);
        if (own(character, "deferredActivation")) requireCondition(typeof character.deferredActivation === "boolean", `Character ${id} deferredActivation must be Boolean.`);
        if (character.deferredActivation === true) {
            requireCondition(character.initialControllerId !== "human", `Deferred character ${id} cannot begin under HumanController.`);
        }
        if (character.movementConstraint !== undefined) {
            requireCondition(isObject(character.movementConstraint) && character.movementConstraint.type === "location_locked" &&
                own(document.locations, String(character.movementConstraint.locationId || "")),
                `Character ${id} has an invalid movementConstraint.`);
        }
        if (character.deferredActivation !== true) {
            requireCondition(own(document.locations, String(character.locationId || "")),
                `Character ${id} has an invalid location.`);
            const location = document.locations[character.locationId];
            requireCondition(isObject(location.sublocations) && own(location.sublocations, String(character.sublocationId || "")),
                `Character ${id} has an invalid sublocation.`);
        }
        if (character.initialDiscoveredLocationIds !== undefined) {
            requireCondition(Array.isArray(character.initialDiscoveredLocationIds) && new Set(character.initialDiscoveredLocationIds).size === character.initialDiscoveredLocationIds.length,
                `Character ${id} initialDiscoveredLocationIds must be a unique array.`);
            character.initialDiscoveredLocationIds.forEach(function (locationId) {
                requireCondition(nonBlank(locationId) && own(document.locations, locationId) && document.locations[locationId].requiresDiscovery === true,
                    `Character ${id} initial discovery '${String(locationId)}' must reference a requiresDiscovery location.`);
            });
        }
        if (character.routineAnchors !== undefined) {
            requireCondition(isObject(character.routineAnchors), `Character ${id} routineAnchors must be an object.`);
            for (const [phase, anchor] of entries(character.routineAnchors)) {
                requireCondition(["morning", "evening"].includes(phase), `Character ${id} routine anchor phase '${phase}' is unsupported.`);
                requireCondition(isObject(anchor) && Object.keys(anchor).sort().join(",") === "locationId,sublocationId",
                    `Character ${id} routine anchor '${phase}' must contain exactly locationId and sublocationId.`);
                requireCondition(own(document.locations, String(anchor.locationId || "")),
                    `Character ${id} routine anchor '${phase}' references an invalid location.`);
                const anchorLocation = document.locations[anchor.locationId];
                requireCondition(isObject(anchorLocation.sublocations) && own(anchorLocation.sublocations, String(anchor.sublocationId || "")),
                    `Character ${id} routine anchor '${phase}' references an invalid sublocation.`);
            }
        }
        if (character.weeklyPresence !== undefined && character.awayable !== undefined) {
            throw new Error(`Character ${id} cannot define both weeklyPresence and awayable.`);
        }
        if (character.weeklyPresence !== undefined) {
            requireCondition(isObject(character.weeklyPresence), `Character ${id} weeklyPresence must be an object.`);
            const days = character.weeklyPresence.presentWeekdayIndexes;
            requireCondition(Array.isArray(days) && days.length > 0 && days.every(function (index) { return Number.isInteger(index) && index >= 0 && index < 7; }) && new Set(days).size === days.length,
                `Character ${id} weeklyPresence.presentWeekdayIndexes must be a unique non-empty list of weekday indexes 0..6.`);
            requireCondition(own(document.locations, String(character.weeklyPresence.arrivalLocationId || "")),
                `Character ${id} weeklyPresence has an invalid arrivalLocationId.`);
            const arrivalLocation = document.locations[character.weeklyPresence.arrivalLocationId];
            requireCondition(arrivalLocation && isObject(arrivalLocation.sublocations) && own(arrivalLocation.sublocations, String(character.weeklyPresence.arrivalSublocationId || "")),
                `Character ${id} weeklyPresence has an invalid arrivalSublocationId.`);
            if (character.weeklyPresence.initialLocationId !== undefined || character.weeklyPresence.initialSublocationId !== undefined) {
                requireCondition(own(document.locations, String(character.weeklyPresence.initialLocationId || "")),
                    `Character ${id} weeklyPresence has an invalid initialLocationId.`);
                const initialLocation = document.locations[character.weeklyPresence.initialLocationId];
                requireCondition(initialLocation && isObject(initialLocation.sublocations) && own(initialLocation.sublocations, String(character.weeklyPresence.initialSublocationId || "")),
                    `Character ${id} weeklyPresence has an invalid initialSublocationId.`);
            }
        }
        if (character.awayable !== undefined) {
            const config = character.awayable;
            requireCondition(isObject(config), `Character ${id} awayable must be an object.`);
            const weekdayNames = document.calendar && document.calendar.weekdayNames || ["Sunday", "Monday", "Flamesday", "Flowday", "Woodsday", "Goldsday", "Earthsday"];
            requireCondition(Array.isArray(config.arrivalSchedule) && config.arrivalSchedule.length > 0,
                `Character ${id} awayable.arrivalSchedule must be a non-empty array.`);
            const arrivalKeys = new Set();
            config.arrivalSchedule.forEach(function (entry, index) {
                requireCondition(isObject(entry) && weekdayNames.includes(entry.weekday) && ["Morning", "Evening"].includes(entry.phase),
                    `Character ${id} awayable arrival opportunity ${index} has an invalid weekday or phase.`);
                const key = `${entry.weekday}:${entry.phase}`;
                requireCondition(!arrivalKeys.has(key), `Character ${id} awayable has duplicate arrival opportunity ${key}.`);
                arrivalKeys.add(key);
            });
            requireCondition(isObject(config.defaultDeparture) && config.defaultDeparture.relativeToArrival === "next_morning",
                `Character ${id} awayable.defaultDeparture must currently use relativeToArrival=next_morning.`);
            requireCondition(Number.isInteger(config.travelPeriods) && config.travelPeriods > 0,
                `Character ${id} awayable.travelPeriods must be a positive integer.`);
            requireCondition(own(document.locations, String(config.arrivalLocationId || "")),
                `Character ${id} awayable has an invalid arrivalLocationId.`);
            const awayArrivalLocation = document.locations[config.arrivalLocationId];
            requireCondition(awayArrivalLocation && isObject(awayArrivalLocation.sublocations) && own(awayArrivalLocation.sublocations, String(config.arrivalSublocationId || "")),
                `Character ${id} awayable has an invalid arrivalSublocationId.`);
            if (config.aiDescription !== undefined) requireCondition(typeof config.aiDescription === "string" && nonBlank(config.aiDescription),
                `Character ${id} awayable.aiDescription must be non-empty text when present.`);
            if (config.initialState !== undefined) {
                requireCondition(isObject(config.initialState) && typeof config.initialState.present === "boolean",
                    `Character ${id} awayable.initialState must contain Boolean present.`);
                if (config.initialState.present) {
                    const plan = config.initialState.plannedDeparture;
                    requireCondition(isObject(plan) && Number.isInteger(plan.dayOffset) && plan.dayOffset >= 0 && ["Morning", "Evening"].includes(plan.phase),
                        `Character ${id} awayable.initialState.plannedDeparture is invalid.`);
                } else if (config.initialState.travelPeriodsRemaining !== undefined) {
                    requireCondition(Number.isInteger(config.initialState.travelPeriodsRemaining) && config.initialState.travelPeriodsRemaining >= 0,
                        `Character ${id} awayable.initialState.travelPeriodsRemaining must be non-negative.`);
                }
            }
            if (config.onArrival !== undefined) {
                requireCondition(Array.isArray(config.onArrival), `Character ${id} awayable.onArrival must be an array.`);
                config.onArrival.forEach(function (hook, index) {
                    requireCondition(isObject(hook) && hook.action === "restock",
                        `Character ${id} awayable.onArrival hook ${index} has an unsupported action.`);
                    validateRestockEntries(id, hook, `Character ${id} awayable.onArrival restock hook ${index}`);
                });
            }
        }
        if (character.tradeLifecycle !== undefined) {
            requireCondition(isObject(character.tradeLifecycle), `Character ${id} tradeLifecycle must be an object.`);
            if (own(character.tradeLifecycle, "settleAcquiredOnDeparture")) requireCondition(typeof character.tradeLifecycle.settleAcquiredOnDeparture === "boolean",
                `Character ${id} tradeLifecycle.settleAcquiredOnDeparture must be Boolean.`);
            if (character.tradeLifecycle.restock !== undefined) validateRestockEntries(id, character.tradeLifecycle.restock, `Character ${id} tradeLifecycle.restock`);
        }
        requireCondition(Number.isInteger(character.wallet) && character.wallet >= 0,
            `Character ${id} has an invalid wallet.`);
        requireCondition(controllers.has(String(character.initialControllerId)),
            `Character ${id} has an unknown initial controller.`);
        requireCondition(controllers.has(String(character.defaultControllerId)) && character.defaultControllerId !== "human",
            `Character ${id} has an invalid default controller.`);
        if (character.initialControllerId === "human") {
            requireCondition(character.playerControllable !== false,
                `Character ${id} cannot start under HumanController when playerControllable is false.`);
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
        ["knownFacts", "beliefs", "relationships", "verbatimObservations", "shortTermMemories", "longTermMemories"].forEach(function (listName) {
            (character.initialMind[listName] || []).forEach(function (record, index) {
                validateSecretReference(record, `Character ${id} initialMind.${listName}[${index}]`, secretIds);
            });
        });
        for (const relationship of character.initialMind.relationships) {
            const targetId = String((relationship && relationship.targetCharacterId) || "");
            requireCondition(own(document.characters, targetId) && targetId !== id,
                `Character ${id} has an invalid relationship target '${targetId}'.`);
        }
    }

    presenceOwnerRefs.forEach(function (record) {
        const ownerLabel = record.sublocationId ? `Sublocation ${record.sublocationId}` : `Location ${record.locationId}`;
        requireCondition(own(document.characters, record.characterId),
            `${ownerLabel} presenceOwnerCharacterId references missing character '${record.characterId}'.`);
        requireCondition(document.characters[record.characterId].weeklyPresence !== undefined || document.characters[record.characterId].awayable !== undefined,
            `${ownerLabel} presence owner '${record.characterId}' must define weeklyPresence or awayable.`);
    });

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
        validateSecretReference(activity, `Day activity ${id}`, secretIds);
        registerTechnicalId(technicalIdOwners, id, `day activity ${id}`);
        requireCondition(activity.kind === "sponsored_job" || activity.kind === "solo",
            `Day activity ${id} has invalid kind.`);
        requireCondition(nonBlank(activity.name) && own(document.locations, String(activity.workLocationId || "")),
            `Day activity ${id} needs a name and valid workLocationId.`);
        requireCondition(nonBlank(activity.narrationInstructions),
            `Day activity ${id} needs narrationInstructions.`);
        if (activity.completionDiscovery !== undefined) {
            const discovery = activity.completionDiscovery;
            requireCondition(isObject(discovery) && nonBlank(discovery.locationId) && own(document.locations, discovery.locationId) && document.locations[discovery.locationId].requiresDiscovery === true,
                `Day activity ${id} completionDiscovery must reference a requiresDiscovery location.`);
            requireCondition(typeof discovery.chance === "number" && Number.isFinite(discovery.chance) && discovery.chance > 0 && discovery.chance <= 1,
                `Day activity ${id} completionDiscovery.chance must be greater than 0 and at most 1.`);
            requireCondition(nonBlank(discovery.observationText), `Day activity ${id} completionDiscovery needs observationText.`);
        }
        if (activity.completionOutcomeTableId !== undefined) {
            requireCondition(nonBlank(activity.completionOutcomeTableId) && own(document.randomOutcomeTables || {}, activity.completionOutcomeTableId),
                `Day activity ${id} completionOutcomeTableId references a missing random outcome table.`);
        }
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

    for (const [eventId, event] of entries(document.triggeredEvents || {})) {
        requireCondition(isObject(event) && event.id === eventId, `Triggered event key ${eventId} must match its id.`);
        validateSecretReference(event, `Triggered event ${eventId}`, secretIds);
        registerTechnicalId(technicalIdOwners, eventId, `triggered event ${eventId}`);
        requireCondition(isObject(event.trigger) && ["ordinary_tick", "timelapse_start"].includes(event.trigger.type),
            `Triggered event ${eventId} has an invalid trigger.`);
        requireCondition(event.chance === undefined || (typeof event.chance === "number" && Number.isFinite(event.chance) && event.chance > 0 && event.chance <= 1),
            `Triggered event ${eventId} chance must be greater than 0 and at most 1.`);
        requireCondition([undefined, "normal", "none"].includes(event.narrationPolicy), `Triggered event ${eventId} has an invalid narrationPolicy.`);
        requireCondition(Array.isArray(event.prerequisites), `Triggered event ${eventId} prerequisites must be an array.`);
        event.prerequisites.forEach(function (prerequisite, index) {
            requireCondition(isObject(prerequisite) && nonBlank(prerequisite.type), `Triggered event ${eventId} prerequisite ${index} is invalid.`);
            if (prerequisite.type === "phase_is") {
                requireCondition(["Morning", "Evening"].includes(prerequisite.phase), `Triggered event ${eventId} prerequisite ${index} has invalid phase.`);
            } else if (prerequisite.type === "location_inventory_contains_tag") {
                requireCondition(own(document.locations, String(prerequisite.locationId || "")) && nonBlank(prerequisite.tag) &&
                    (prerequisite.minimum === undefined || prerequisite.minimum === 1),
                    `Triggered event ${eventId} prerequisite ${index} has invalid location/tag/minimum.`);
            } else if (prerequisite.type === "character_activation_is") {
                requireCondition(own(document.characters, String(prerequisite.characterId || "")) && ["active", "inactive"].includes(prerequisite.value),
                    `Triggered event ${eventId} prerequisite ${index} has invalid character activation requirement.`);
            } else if (prerequisite.type === "character_locally_present") {
                requireCondition(own(document.characters, String(prerequisite.characterId || "")) && typeof prerequisite.value === "boolean",
                    `Triggered event ${eventId} prerequisite ${index} has invalid character local-presence requirement.`);
            } else if (prerequisite.type === "character_active" || prerequisite.type === "character_inactive") {
                requireCondition(own(document.characters, String(prerequisite.characterId || "")), `Triggered event ${eventId} prerequisite ${index} references missing character.`);
            } else {
                throw new Error(`Triggered event ${eventId} prerequisite ${index} has unsupported type '${String(prerequisite.type)}'.`);
            }
        });
        requireCondition(Array.isArray(event.effects) && event.effects.length > 0, `Triggered event ${eventId} must define effects.`);
        event.effects.forEach(function (effect, index) {
            requireCondition(isObject(effect) && ["activate_character", "deactivate_character", "consume_matching_items", "emit_observation"].includes(effect.type),
                `Triggered event ${eventId} effect ${index} has unsupported type '${String(effect && effect.type)}'.`);
            if (effect.type === "activate_character") {
                const target = document.characters[effect.characterId];
                requireCondition(target && target.deferredActivation === true && own(document.locations, String(effect.locationId || "")),
                    `Triggered event ${eventId} effect ${index} has invalid activation target/destination.`);
                const location = document.locations[effect.locationId];
                requireCondition(!effect.sublocationId || (location && isObject(location.sublocations) && own(location.sublocations, effect.sublocationId)),
                    `Triggered event ${eventId} effect ${index} has invalid activation sublocation.`);
            } else if (effect.type === "deactivate_character") {
                requireCondition(own(document.characters, String(effect.characterId || "")), `Triggered event ${eventId} effect ${index} references missing character.`);
            } else if (effect.type === "consume_matching_items") {
                requireCondition(isObject(effect.source) && effect.source.type === "location_inventory" && own(document.locations, String(effect.source.locationId || "")) &&
                    nonBlank(effect.itemTag) && effect.mode === "all" && effect.preserveContainers === true,
                    `Triggered event ${eventId} effect ${index} has invalid consume_matching_items configuration.`);
            } else if (effect.type === "emit_observation") {
                requireCondition(own(document.locations, String(effect.locationId || "")) && nonBlank(effect.text),
                    `Triggered event ${eventId} effect ${index} has invalid emit_observation configuration.`);
                if (effect.actorCharacterId !== undefined) requireCondition(own(document.characters, String(effect.actorCharacterId || "")),
                    `Triggered event ${eventId} effect ${index} references missing observation actor.`);
            }
        });
    }

    for (const [tableId, table] of entries(document.randomOutcomeTables || {})) {
        requireCondition(isObject(table) && table.id === tableId, `Random outcome table key ${tableId} must match its id.`);
        validateSecretReference(table, `Random outcome table ${tableId}`, secretIds);
        registerTechnicalId(technicalIdOwners, tableId, `random outcome table ${tableId}`);
        requireCondition(table.noOutcomeWeight === undefined || (Number.isInteger(table.noOutcomeWeight) && table.noOutcomeWeight >= 0),
            `Random outcome table ${tableId} noOutcomeWeight must be a non-negative integer.`);
        requireCondition(Array.isArray(table.outcomes), `Random outcome table ${tableId} outcomes must be an array.`);
        requireCondition(table.outcomes.length > 0 || Number(table.noOutcomeWeight || 0) > 0,
            `Random outcome table ${tableId} must have outcomes or positive noOutcomeWeight.`);
        const outcomeIds = new Set();
        table.outcomes.forEach(function (outcome, index) {
            requireCondition(isObject(outcome) && nonBlank(outcome.id) && Number.isInteger(outcome.weight) && outcome.weight > 0 && typeof outcome.once === "boolean" && Array.isArray(outcome.effects) && outcome.effects.length > 0,
                `Random outcome table ${tableId} outcome ${index} is malformed.`);
            validateSecretReference(outcome, `Random outcome ${outcome.id}`, secretIds);
            requireCondition(!outcomeIds.has(outcome.id), `Random outcome table ${tableId} has duplicate outcome ID '${outcome.id}'.`);
            outcomeIds.add(outcome.id);
            registerTechnicalId(technicalIdOwners, outcome.id, `random outcome ${outcome.id}`);
            outcome.effects.forEach(function (effect, effectIndex) {
                validateSecretReference(effect, `Random outcome ${outcome.id} effect ${effectIndex}`, secretIds);
                validateRandomEffect(effect, `Random outcome ${outcome.id} effect ${effectIndex}`, document);
            });
        });
    }

    for (const [locationId, location] of entries(document.locations)) {
        for (const [sublocationId, sublocation] of entries(location.sublocations || {})) {
            (sublocation.interactions || []).forEach(function (interaction) {
                requireCondition(own(document.randomOutcomeTables || {}, interaction.outcomeTableId),
                    `Sublocation ${sublocationId} interaction ${interaction.id} references missing random outcome table '${interaction.outcomeTableId}'.`);
            });
        }
    }

    const authoredEquipmentSlots = new Set();
    for (const [id, item] of entries(document.items)) {
        requireCondition(isObject(item) && item.id === id, `Item key ${id} must match its id.`);
        validateSecretReference(item, `Item ${id}`, secretIds);
        registerTechnicalId(technicalIdOwners, id, `item ${id}`);
        requireCondition(own(document.itemDefinitions, String(item.definitionId || "")),
            `Item ${id} references missing definition '${item.definitionId}'.`);
        const definition = document.itemDefinitions[item.definitionId];
        if (definition && definition.writable === true && own(item, "content")) {
            requireCondition(typeof item.content === "string" && item.content.length <= 12000,
                `Writable item ${id} content must be text up to 12000 characters.`);
        }
        if (item.tradeProvenance !== undefined) {
            const provenance = item.tradeProvenance;
            requireCondition(isObject(provenance) && own(document.characters, String(provenance.ownerCharacterId || "")) &&
                ["sale_stock", "acquired_stock"].includes(provenance.role) && Number.isInteger(provenance.dayNumber) && provenance.dayNumber >= 0,
                `Item ${id} has invalid authored tradeProvenance.`);
        }
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


    function validateWorldDocument(document) {
        try { validateWorld(document); return []; }
        catch (error) { return [{ message: error && error.message || "World validation failed." }]; }
    }

    function createEmptyWorld() {
        return { schemaVersion: 2, calendar: { weekdayNames: ["Sunday", "Monday", "Flamesday", "Flowday", "Woodsday", "Goldsday", "Earthsday"], initialWeekdayIndex: 1 }, startLocationId: "", protectedLocationIds: [], protectedSublocationIds: [], protectedCharacterIds: [], protectedAbilityIds: [], locations: {}, characters: {}, abilities: {}, itemDefinitions: {}, items: {}, dayActivities: {}, secrets: {}, randomOutcomeTables: {}, triggeredEvents: {} };
    }

    return {
        ID_PATTERN: /^[A-Za-z][A-Za-z0-9_-]*$/,
        SCHEMA_VERSION: 2,
        KNOWN_ACTIONS: Array.from(knownActions),
        KNOWN_ITEM_EFFECTS: Array.from(knownItemEffects),
        validateWorld: validateWorld,
        validateWorldDocument: validateWorldDocument,
        requireCondition: requireCondition,
        createEmptyWorld: createEmptyWorld,
        isObject: isObject,
        nonBlank: nonBlank,
        own: own,
        entries: entries,
        exitRecord: exitRecord,
        exitTarget: exitTarget
    };
}));
