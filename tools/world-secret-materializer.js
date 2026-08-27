"use strict";

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function own(object, key) { return isObject(object) && Object.prototype.hasOwnProperty.call(object, key); }

function disabledSecretIds(document) {
    const result = new Set();
    Object.entries(document && document.secrets || {}).forEach(function (entry) {
        const id = entry[0], record = entry[1];
        if (record && record.enabled === false) result.add(id);
    });
    return result;
}

function belongsToDisabled(record, disabled) {
    return Boolean(record && typeof record.secretId === "string" && disabled.has(record.secretId));
}

function stripSecretMetadata(value) {
    if (Array.isArray(value)) return value.map(stripSecretMetadata);
    if (!isObject(value)) return value;
    const output = {};
    Object.entries(value).forEach(function (entry) {
        const key = entry[0], child = entry[1];
        if (key === "secretId" || key === "secrets") return;
        output[key] = stripSecretMetadata(child);
    });
    return output;
}

function filterRecordArray(records, disabled) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
        return !belongsToDisabled(record, disabled);
    });
}

function materializeSecrets(source, options) {
    const document = clone(source || {});
    const disabled = disabledSecretIds(document);

    ["locations", "characters", "abilities", "itemDefinitions", "items", "dayActivities", "randomOutcomeTables", "triggeredEvents"].forEach(function (collectionName) {
        const collection = document[collectionName];
        if (!isObject(collection)) return;
        Object.keys(collection).forEach(function (id) {
            if (belongsToDisabled(collection[id], disabled)) delete collection[id];
        });
    });

    Object.values(document.locations || {}).forEach(function (location) {
        if (!location || !isObject(location)) return;
        if (isObject(location.sublocations)) {
            Object.keys(location.sublocations).forEach(function (sublocationId) {
                if (belongsToDisabled(location.sublocations[sublocationId], disabled)) delete location.sublocations[sublocationId];
            });
            Object.values(location.sublocations).forEach(function (sublocation) {
                if (!sublocation || !isObject(sublocation)) return;
                if (Array.isArray(sublocation.reachableSublocationIds)) {
                    sublocation.reachableSublocationIds = sublocation.reachableSublocationIds.filter(function (id) {
                        return own(location.sublocations, id);
                    });
                }
                if (Array.isArray(sublocation.interactions)) {
                    sublocation.interactions = filterRecordArray(sublocation.interactions, disabled);
                }
            });
        }
        if (isObject(location.exits)) {
            Object.keys(location.exits).forEach(function (key) {
                const value = location.exits[key];
                const destinationId = typeof value === "string" ? value : value && value.destinationId;
                if (typeof destinationId === "string" && !own(document.locations, destinationId)) delete location.exits[key];
            });
        }
        if (location.defaultSublocationId && !own(location.sublocations || {}, location.defaultSublocationId)) {
            // Leave this as a validation error; do not silently choose a new default.
        }
    });

    Object.values(document.characters || {}).forEach(function (character) {
        if (!character || !isObject(character)) return;
        if (Array.isArray(character.initialDiscoveredLocationIds)) {
            character.initialDiscoveredLocationIds = character.initialDiscoveredLocationIds.filter(function (id) { return own(document.locations, id); });
        }
        if (Array.isArray(character.abilityIds)) {
            character.abilityIds = character.abilityIds.filter(function (id) { return own(document.abilities || {}, id); });
        }
        const mind = character.initialMind;
        if (mind && isObject(mind)) {
            ["knownFacts", "beliefs", "relationships", "verbatimObservations", "shortTermMemories", "longTermMemories"].forEach(function (key) {
                if (Array.isArray(mind[key])) mind[key] = filterRecordArray(mind[key], disabled);
            });
        }
    });

    Object.values(document.itemDefinitions || {}).forEach(function (definition) {
        const entries = definition && definition.useAction && definition.useAction.knowledgeEntries;
        if (Array.isArray(entries)) definition.useAction.knowledgeEntries = filterRecordArray(entries, disabled);
    });

    Object.values(document.randomOutcomeTables || {}).forEach(function (table) {
        if (!table || !Array.isArray(table.outcomes)) return;
        table.outcomes = filterRecordArray(table.outcomes, disabled).map(function (outcome) {
            if (Array.isArray(outcome.effects)) outcome.effects = filterRecordArray(outcome.effects, disabled);
            return outcome;
        });
    });

    ["protectedLocationIds", "protectedSublocationIds", "protectedCharacterIds", "protectedAbilityIds"].forEach(function (key) {
        if (!Array.isArray(document[key])) return;
        const allowed = key === "protectedLocationIds" ? document.locations
            : key === "protectedCharacterIds" ? document.characters
            : key === "protectedAbilityIds" ? document.abilities : null;
        if (allowed) document[key] = document[key].filter(function (id) { return own(allowed, id); });
        else if (key === "protectedSublocationIds") {
            const subIds = new Set();
            Object.values(document.locations || {}).forEach(function (location) {
                Object.keys(location && location.sublocations || {}).forEach(function (id) { subIds.add(id); });
            });
            document[key] = document[key].filter(function (id) { return subIds.has(id); });
        }
    });

    if (options && options.keepSecretMetadata === true) return document;
    return stripSecretMetadata(document);
}

module.exports = { materializeSecrets, disabledSecretIds };
