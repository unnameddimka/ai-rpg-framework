(function () {
    "use strict";

    const EMPTY_UPDATES = { recentMemoriesToAdd: [], beliefsToUpsert: [], beliefIdsToRemove: [], relationshipsToUpsert: [] };
    const DECISION_KEYS = ["action", "publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation", "memoryUpdates"];
    const RESULT_KEYS = ["publicNarrative", "spokenText", "memoryUpdates"];
    const UPDATE_KEYS = ["recentMemoriesToAdd", "beliefsToUpsert", "beliefIdsToRemove", "relationshipsToUpsert"];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function extractObject(content) {
        if (typeof content !== "string") throw new Error("Model response is not text.");
        let text = content.trim();
        const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        if (fence) text = fence[1].trim();
        if (!text.startsWith("{") || !text.endsWith("}")) throw new Error("Model response must contain one JSON object only.");
        return JSON.parse(text);
    }

    function isPlainObject(value) {
        return value && typeof value === "object" && !Array.isArray(value);
    }

    function exactKeyErrors(value, keys, path) {
        if (!isPlainObject(value)) return [`${path} must be an object.`];
        const errors = [];
        Object.keys(value).forEach(function (key) {
            if (!keys.includes(key)) errors.push(`${path}.${key} is not allowed.`);
        });
        keys.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required.`);
        });
        return errors;
    }

    function nullableTextErrors(value, path) {
        if (value === null) return [];
        if (typeof value !== "string") return [`${path} must be a string or null.`];
        if (value.length > 2000) return [`${path} must not exceed 2000 characters.`];
        return [];
    }

    function requiredTextErrors(value, path, maxLength) {
        if (typeof value !== "string" || !value.trim()) return [`${path} must be a non-empty string.`];
        if (value.trim().length > maxLength) return [`${path} must not exceed ${maxLength} characters.`];
        return [];
    }

    function validateUpdatesDetailed(updates, path, existingBeliefIds) {
        const errors = exactKeyErrors(updates, UPDATE_KEYS, path);
        if (!isPlainObject(updates)) return errors;

        UPDATE_KEYS.forEach(function (key) {
            if (!Array.isArray(updates[key])) errors.push(`${path}.${key} must be an array.`);
            else if (updates[key].length > 5) errors.push(`${path}.${key} may contain at most 5 records.`);
        });
        (Array.isArray(updates.recentMemoriesToAdd) ? updates.recentMemoriesToAdd : []).forEach(function (memory, index) {
            const recordPath = `${path}.recentMemoriesToAdd[${index}]`;
            errors.push.apply(errors, exactKeyErrors(memory, ["summary", "importance"], recordPath));
            if (!isPlainObject(memory)) return;
            errors.push.apply(errors, requiredTextErrors(memory.summary, `${recordPath}.summary`, 500));
            if (typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
                errors.push(`${recordPath}.importance must be a finite number from 0 to 1.`);
            }
        });

        const beliefUpsertIds = new Set();
        (Array.isArray(updates.beliefsToUpsert) ? updates.beliefsToUpsert : []).forEach(function (belief, index) {
            const recordPath = `${path}.beliefsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(belief, ["id", "text", "confidence"], recordPath));
            if (!isPlainObject(belief)) return;
            if (typeof belief.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id)) {
                errors.push(`${recordPath}.id must start with a letter and contain only letters, digits, underscores, or hyphens.`);
            } else if (beliefUpsertIds.has(belief.id)) {
                errors.push(`${recordPath}.id duplicates another belief upsert.`);
            } else {
                beliefUpsertIds.add(belief.id);
            }
            errors.push.apply(errors, requiredTextErrors(belief.text, `${recordPath}.text`, 500));
            if (!["low", "medium", "high"].includes(belief.confidence)) {
                errors.push(`${recordPath}.confidence must be low, medium, or high.`);
            }
        });

        const beliefRemovalIds = new Set();
        (Array.isArray(updates.beliefIdsToRemove) ? updates.beliefIdsToRemove : []).forEach(function (id, index) {
            const recordPath = `${path}.beliefIdsToRemove[${index}]`;
            if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
                errors.push(`${recordPath} must be a valid belief ID.`);
                return;
            }
            if (beliefRemovalIds.has(id)) errors.push(`${recordPath} duplicates another belief removal.`);
            beliefRemovalIds.add(id);
            if (beliefUpsertIds.has(id)) errors.push(`${recordPath} cannot remove a belief also upserted in the same update.`);
            if (Array.isArray(existingBeliefIds) && !existingBeliefIds.includes(id)) {
                errors.push(`${recordPath} selected nonexistent belief ${JSON.stringify(id)}.`);
            }
        });

        (Array.isArray(updates.relationshipsToUpsert) ? updates.relationshipsToUpsert : []).forEach(function (relationship, index) {
            const recordPath = `${path}.relationshipsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(relationship, ["targetCharacterId", "summary"], recordPath));
            if (!isPlainObject(relationship)) return;
            errors.push.apply(errors, requiredTextErrors(relationship.targetCharacterId, `${recordPath}.targetCharacterId`, 200));
            errors.push.apply(errors, requiredTextErrors(relationship.summary, `${recordPath}.summary`, 500));
        });
        return errors;
    }

    function updatesEmpty(updates) {
        return updates.recentMemoriesToAdd.length === 0 && updates.beliefsToUpsert.length === 0 && updates.beliefIdsToRemove.length === 0 && updates.relationshipsToUpsert.length === 0;
    }

    function validateActionProperties(action, actionDefinition, path) {
        const errors = [];
        const schema = actionDefinition.schema || {};
        const properties = schema.properties || {};
        const required = schema.required || ["type"];
        Object.keys(action).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed for action ${action.type}.`);
        });
        required.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) errors.push(`${path}.${key} is required for action ${action.type}.`);
        });
        Object.keys(properties).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(action, key)) return;
            const rule = properties[key] || {};
            const value = action[key];
            if (Object.prototype.hasOwnProperty.call(rule, "const") && value !== rule.const) {
                errors.push(`${path}.${key} must equal ${JSON.stringify(rule.const)}.`);
            }
            if (rule.type === "string" && typeof value !== "string") errors.push(`${path}.${key} must be a string.`);
            if (rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${path}.${key} must be a finite number.`);
            if (rule.type === "integer" && !Number.isInteger(value)) errors.push(`${path}.${key} must be an integer.`);
            if (typeof rule.minimum === "number" && typeof value === "number" && value < rule.minimum) errors.push(`${path}.${key} must be at least ${rule.minimum}.`);
            if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${path}.${key} must be one of ${rule.enum.join(", ")}.`);
        });
        return errors;
    }

    function validateActionOptions(action, actionDefinition, path) {
        const errors = [];
        const options = isPlainObject(actionDefinition && actionDefinition.options) ? actionDefinition.options : {};
        const optionKeys = {
            destination_id: "destination_ids",
            item_id: "item_ids",
            target_id: "target_ids",
            target_inventory_id: "target_inventory_ids"
        };

        Object.entries(optionKeys).forEach(function (entry) {
            const propertyKey = entry[0];
            const optionKey = entry[1];
            if (!Object.prototype.hasOwnProperty.call(action, propertyKey) || !Array.isArray(options[optionKey])) return;
            if (!options[optionKey].includes(action[propertyKey])) {
                errors.push(`${path}.${propertyKey} selected unavailable option ${JSON.stringify(action[propertyKey])}. Allowed values for action ${JSON.stringify(action.type)} are ${JSON.stringify(options[optionKey])}.`);
            }
        });

        if (Object.prototype.hasOwnProperty.call(action, "amount") && typeof options.maximum_amount === "number" &&
                typeof action.amount === "number" && action.amount > options.maximum_amount) {
            errors.push(`${path}.amount exceeds currently available maximum ${options.maximum_amount}.`);
        }
        if (action.type === "equip" && typeof action.item_id === "string" && typeof action.slot === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate.id === action.item_id; });
            if (!itemOption || !Array.isArray(itemOption.slots) || !itemOption.slots.includes(action.slot)) {
                errors.push(`${path}.slot selected unavailable option ${JSON.stringify(action.slot)} for item ${JSON.stringify(action.item_id)}.`);
            }
        }
        if (action.type === "use_item" && typeof action.item_id === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate.id === action.item_id; });
            if (itemOption && itemOption.input_required) {
                const inputText = typeof action.input_text === "string" ? action.input_text.trim() : "";
                const maxLength = Number.isInteger(itemOption.input_max_length) ? itemOption.input_max_length : 600;
                if (!inputText) errors.push(`${path}.input_text is required for ${JSON.stringify(itemOption.action_label || action.item_id)}.`);
                else if (inputText.length > maxLength) errors.push(`${path}.input_text must not exceed ${maxLength} characters.`);
            }
        }
        return errors;
    }

    function finishValidation(value, errors) {
        return errors.length === 0
            ? { ok: true, value: value, errors: [] }
            : { ok: false, message: errors[0], errors: errors };
    }

    function speechLoudnessValues() {
        if (setup.CharacterAPI && typeof setup.CharacterAPI.getSpeechLoudnessValues === "function") {
            return setup.CharacterAPI.getSpeechLoudnessValues();
        }
        return [];
    }

    function validateDecision(value, actionCatalog, spokenTargetIds, existingBeliefIds) {
        const errors = exactKeyErrors(value, DECISION_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, nullableTextErrors(value.continuation, "response.continuation"));
        if (value.spokenTargetId !== null && typeof value.spokenTargetId !== "string") {
            errors.push("response.spokenTargetId must be a visible character ID string or null.");
        }
        if (value.spokenTargetId !== null && value.spokenText === null) {
            errors.push("response.spokenTargetId must be null when spokenText is null.");
        }
        if (value.spokenTargetId !== null && Array.isArray(spokenTargetIds) && !spokenTargetIds.includes(value.spokenTargetId)) {
            errors.push(`response.spokenTargetId selected unavailable character ${JSON.stringify(value.spokenTargetId)}.`);
        }
        const loudnessValues = speechLoudnessValues();
        if (value.spokenText === null) {
            if (value.spokenLoudness !== null) errors.push("response.spokenLoudness must be null when spokenText is null.");
        } else if (!loudnessValues.includes(value.spokenLoudness)) {
            errors.push(`response.spokenLoudness must be one of ${loudnessValues.join(", ")} when spokenText is present.`);
        }
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates", existingBeliefIds));

        if (value.action !== null) {
            if (!isPlainObject(value.action) || typeof value.action.type !== "string") {
                errors.push("response.action must be null or one action object with a string type.");
            } else {
                const actionDefinition = actionCatalog && actionCatalog[value.action.type];
                if (!actionDefinition) errors.push(`response.action.type selected unavailable action ${JSON.stringify(value.action.type)}.`);
                else {
                    errors.push.apply(errors, validateActionProperties(value.action, actionDefinition, "response.action"));
                    errors.push.apply(errors, validateActionOptions(value.action, actionDefinition, "response.action"));
                }
            }
        }
        return finishValidation(value, errors);
    }

    function validateResult(value, existingBeliefIds) {
        const errors = exactKeyErrors(value, RESULT_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates", existingBeliefIds));
        return finishValidation(value, errors);
    }


    function validateRecentMaintenance(value, context) {
        const keys = ["groups", "archiveOnlyRecentMemoryIds", "keepActiveRecentMemoryIds"];
        const errors = exactKeyErrors(value, keys, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        keys.forEach(function (key) { if (!Array.isArray(value[key])) errors.push(`response.${key} must be an array.`); });
        const source = Array.isArray(context && context.sourceRecentMemories) ? context.sourceRecentMemories : [];
        const allowed = new Set(source.map(function (memory) { return memory && memory.id; }).filter(Boolean));
        const protectedIds = new Set(source.filter(function (memory) { return memory && memory.protected; }).map(function (memory) { return memory.id; }));
        const seen = new Set();
        if (Array.isArray(value.groups) && value.groups.length > 12) errors.push("response.groups may contain at most 12 groups.");
        (Array.isArray(value.groups) ? value.groups : []).forEach(function (group, index) {
            const path = `response.groups[${index}]`;
            errors.push.apply(errors, exactKeyErrors(group, ["sourceRecentMemoryIds", "replacement"], path));
            if (!isPlainObject(group)) return;
            if (!Array.isArray(group.sourceRecentMemoryIds) || group.sourceRecentMemoryIds.length < 1 || group.sourceRecentMemoryIds.length > 12) {
                errors.push(`${path}.sourceRecentMemoryIds must contain 1-12 source IDs.`);
            } else {
                group.sourceRecentMemoryIds.forEach(function (id, sourceIndex) {
                    if (!allowed.has(id)) errors.push(`${path}.sourceRecentMemoryIds[${sourceIndex}] is not in this batch.`);
                    else if (protectedIds.has(id)) errors.push(`${path}.sourceRecentMemoryIds[${sourceIndex}] cannot use a protected memory.`);
                    else if (seen.has(id)) errors.push(`${path}.sourceRecentMemoryIds[${sourceIndex}] is assigned more than once.`);
                    else seen.add(id);
                });
            }
            errors.push.apply(errors, exactKeyErrors(group.replacement, ["summary", "importance"], `${path}.replacement`));
            if (isPlainObject(group.replacement)) {
                errors.push.apply(errors, requiredTextErrors(group.replacement.summary, `${path}.replacement.summary`, 2000));
                if (typeof group.replacement.importance !== "number" || !Number.isFinite(group.replacement.importance) || group.replacement.importance < 0 || group.replacement.importance > 1) {
                    errors.push(`${path}.replacement.importance must be a finite number from 0 to 1.`);
                }
            }
        });
        ["archiveOnlyRecentMemoryIds", "keepActiveRecentMemoryIds"].forEach(function (key) {
            (Array.isArray(value[key]) ? value[key] : []).forEach(function (id, index) {
                if (!allowed.has(id)) errors.push(`response.${key}[${index}] is not in this batch.`);
                else if (protectedIds.has(id) && key !== "keepActiveRecentMemoryIds") errors.push(`response.${key}[${index}] cannot remove a protected memory.`);
                else if (seen.has(id)) errors.push(`response.${key}[${index}] is assigned more than once.`);
                else seen.add(id);
            });
        });
        allowed.forEach(function (id) { if (!seen.has(id)) errors.push(`source recent memory ${id} must be assigned exactly once.`); });
        return finishValidation(value, errors);
    }

    function validateReconciliationDiscovery(value, context) {
        const errors = exactKeyErrors(value, ["conflicts"], "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        if (!Array.isArray(value.conflicts)) errors.push("response.conflicts must be an array.");
        if (Array.isArray(value.conflicts) && value.conflicts.length > 8) errors.push("response.conflicts may contain at most 8 candidates.");
        const beliefs = new Set((context && context.currentBeliefs || []).map(function (belief) { return belief && belief.id; }).filter(Boolean));
        const memories = new Set((context && context.activeLongTermMemories || []).map(function (memory) { return memory && memory.id; }).filter(Boolean));
        const seenPairs = new Set();
        (Array.isArray(value.conflicts) ? value.conflicts : []).forEach(function (conflict, index) {
            const path = `response.conflicts[${index}]`;
            errors.push.apply(errors, exactKeyErrors(conflict, ["beliefId", "longTermMemoryId", "strength"], path));
            if (!isPlainObject(conflict)) return;
            if (!beliefs.has(conflict.beliefId)) errors.push(`${path}.beliefId is not in the current reconciliation belief batch.`);
            if (!memories.has(conflict.longTermMemoryId)) errors.push(`${path}.longTermMemoryId is not an active supplied long-term memory.`);
            if (!["direct", "strong", "possible"].includes(conflict.strength)) errors.push(`${path}.strength must be direct, strong, or possible.`);
            const pairKey = `${String(conflict.beliefId)}\u0000${String(conflict.longTermMemoryId)}`;
            if (seenPairs.has(pairKey)) errors.push(`${path} duplicates an earlier conflict pair.`);
            else seenPairs.add(pairKey);
        });
        return finishValidation(value, errors);
    }

    function validateReconciliationResolution(value, context) {
        const errors = exactKeyErrors(value, ["resolution", "beliefReplacement", "memoryReplacement"], "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        if (!["revise_belief", "revise_memory", "revise_both", "keep_conflict"].includes(value.resolution)) {
            errors.push("response.resolution must be revise_belief, revise_memory, revise_both, or keep_conflict.");
        }
        const selectedBelief = context && context.selectedBelief;
        const selectedMemory = context && context.selectedLongTermMemory;
        if (!selectedBelief || !selectedMemory) errors.push("reconciliation resolution context is missing the selected pair.");
        const wantsBelief = value.resolution === "revise_belief" || value.resolution === "revise_both";
        const wantsMemory = value.resolution === "revise_memory" || value.resolution === "revise_both";
        if (wantsBelief) {
            errors.push.apply(errors, exactKeyErrors(value.beliefReplacement, ["text", "confidence"], "response.beliefReplacement"));
            if (isPlainObject(value.beliefReplacement)) {
                errors.push.apply(errors, requiredTextErrors(value.beliefReplacement.text, "response.beliefReplacement.text", 500));
                if (!["low", "medium", "high"].includes(value.beliefReplacement.confidence)) errors.push("response.beliefReplacement.confidence must be low, medium, or high.");
            }
        } else if (value.beliefReplacement !== null) {
            errors.push("response.beliefReplacement must be null for this resolution.");
        }
        if (wantsMemory) {
            if (selectedMemory && selectedMemory.protected === true) errors.push("A protected long-term memory cannot be revised by reconciliation.");
            errors.push.apply(errors, exactKeyErrors(value.memoryReplacement, ["summary", "importance"], "response.memoryReplacement"));
            if (isPlainObject(value.memoryReplacement)) {
                errors.push.apply(errors, requiredTextErrors(value.memoryReplacement.summary, "response.memoryReplacement.summary", 2000));
                if (typeof value.memoryReplacement.importance !== "number" || !Number.isFinite(value.memoryReplacement.importance) || value.memoryReplacement.importance < 0 || value.memoryReplacement.importance > 1) {
                    errors.push("response.memoryReplacement.importance must be a finite number from 0 to 1.");
                }
            }
        } else if (value.memoryReplacement !== null) {
            errors.push("response.memoryReplacement must be null for this resolution.");
        }
        return finishValidation(value, errors);
    }

    function validateLongTermMaintenance(value, context) {
        const errors = exactKeyErrors(value, ["merge"], "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        if (value.merge === null) return finishValidation(value, errors);
        errors.push.apply(errors, exactKeyErrors(value.merge, ["sourceLongTermMemoryIds", "replacement"], "response.merge"));
        if (!isPlainObject(value.merge)) return finishValidation(value, errors);
        const memories = new Map((context && context.longTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const ids = value.merge.sourceLongTermMemoryIds;
        if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3) errors.push("response.merge.sourceLongTermMemoryIds must contain 2-3 IDs.");
        else {
            const seen = new Set();
            ids.forEach(function (id, index) {
                const memory = memories.get(id);
                if (!memory) errors.push(`response.merge.sourceLongTermMemoryIds[${index}] is not an active supplied long-term memory.`);
                else if (memory.protected) errors.push(`response.merge.sourceLongTermMemoryIds[${index}] cannot use a protected memory.`);
                else if (seen.has(id)) errors.push(`response.merge.sourceLongTermMemoryIds[${index}] is duplicated.`);
                else seen.add(id);
            });
        }
        errors.push.apply(errors, exactKeyErrors(value.merge.replacement, ["summary", "importance"], "response.merge.replacement"));
        if (isPlainObject(value.merge.replacement)) {
            errors.push.apply(errors, requiredTextErrors(value.merge.replacement.summary, "response.merge.replacement.summary", 2000));
            if (typeof value.merge.replacement.importance !== "number" || !Number.isFinite(value.merge.replacement.importance) || value.merge.replacement.importance < 0 || value.merge.replacement.importance > 1) {
                errors.push("response.merge.replacement.importance must be a finite number from 0 to 1.");
            }
        }
        return finishValidation(value, errors);
    }

    function baseSystem(stage) {
        if (stage !== "decision") {
            return "You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return exactly one JSON object and nothing else: no markdown fence, prose, chain-of-thought, hidden reasoning, patches, or extra fields. Return exactly the keys publicNarrative, spokenText, and memoryUpdates. Do not choose another action; react only to the supplied grounded action result. A formal result supplied here is authoritative. Keep role-play concise and characterful. memoryUpdates must always contain exactly recentMemoriesToAdd, beliefsToUpsert, beliefIdsToRemove, and relationshipsToUpsert, even when all are empty arrays. A recent memory record is {\"summary\":\"...\",\"importance\":0.0}; importance must be from 0 to 1. A belief record is {\"id\":\"letter_started_id\",\"text\":\"...\",\"confidence\":\"low|medium|high\"}. A relationship record is {\"targetCharacterId\":\"character_id\",\"summary\":\"...\"}.";
        }

        const loudness = speechLoudnessValues().map(function (value) { return JSON.stringify(value); }).join(" or ");
        const contract = `Return exactly the keys action, publicNarrative, spokenText, spokenTargetId, spokenLoudness, continuation, and memoryUpdates. action is null or exactly one action from context.view.available_actions using only currently offered option values. Available actions are capabilities, not recommendations: do not choose one merely because it exists. spokenTargetId is null or the id of one character currently listed in context.view.location.characters. spokenLoudness is per utterance, not persistent state: when spokenText is present it must be ${loudness}; when spokenText is null, spokenTargetId and spokenLoudness must both be null.`;
        const state = "First understand the current situation. context.view is authoritative for what is publicly and operationally true now. Pending observations have already passed deterministic perception and delivery rules; if one was delivered, treat it as perceived and do not second-guess audibility or visibility from distance, loudness, posture, or room layout. context.recentDialogue is a short-lived record of recently spoken dialogue actually available to this character, including the character's own prior speech; use it for conversational continuity, not as objective physical world state, and do not copy routine lines into persistent memory merely because they appear there. Character IDs are persistent identities: the same character id is the same person after leaving and returning, so location changes do not reset familiarity, prior interaction, memories, beliefs, or relationships. A character absent from context.view.location.characters is not currently visible here. context.view and grounded engine results override stale conversational claims about location, possession, posture, or other physical facts.";
        const decision = "Then decide whether there is a character-level reason to react or act. Directly addressed meaningful speech normally deserves an in-character response through dialogue, visible behavior, a formal action, or intentional silence; a completely empty no-op after direct address should be deliberate and character-driven, not accidental. Spontaneous initiative is valid: characters may work, prepare things, clean, watch people, investigate, move, joke, refuse, or otherwise act on their own. Keep initiative coherent with personality, duties, current observations, and existing intentions. Do not invent a task merely because an action is available. FORMAL ACTION PRECEDENCE: if an intended tracked world-state change can be represented by a currently offered action in context.view.available_actions, use that formal action; publicNarrative may accompany it but must not substitute for it. If the character has adopted a concrete purpose and a currently available formal action clearly advances it, normally choose that action rather than only narrating or promising progress, unless personality or circumstances justify postponing, refusing, revising, or abandoning the purpose. context.view.available_actions describes only what is possible right now; a later step may appear after a prerequisite grounded action changes the world. Work one atomic grounded step at a time. For multi-step grounded goals, perform one currently available formal action and keep the unfinished purpose in continuation so later reactions can perform later grounded steps. Choose the action type from its semantic description first, then choose every parameter only from that action's own current options. Never reuse an option value from a different action type. If no action is warranted, speech, a small visible reaction, or a genuine no-op may be natural.";
        const continuation = "continuation is your nullable, free-form, private working intention. It records an unfinished purpose, never an action queue or predetermined sequence, and the framework does not interpret it. continuation never overrides the current canonical view: before following it, re-check possession, item state, money, current location/position, visible characters, grounded results or failures, and any other mechanical facts it depends on. If those facts changed, adapt, recover, revise, abandon, or clear the purpose instead of narrating stale assumptions as true. If you choose an atomic action as one step toward a purpose that remains unfinished after this response, keep that purpose in continuation; do not start a purposive movement or task and immediately discard why you are doing it. A complete local action may leave continuation null. On every later reaction reevaluate the current view, available actions, new observations, engine-confirmed results or failures, priorities, and continuation. If a still-relevant continuation has an obvious available step and nothing more important overrides it, normally make progress rather than return an accidental no-op. After failure, use the grounded feedback and do not blindly repeat the same action.";
        const speech = `Use spokenText for dialogue in the character's own voice. Choose spokenLoudness structurally for this utterance using ${loudness}; writing *whispers*, *in a low voice*, or similar prose does not change mechanical loudness. The framework owns who receives the resulting observation. spokenTargetId and a formal-action target may differ. publicNarrative is brief visible behavior or atmosphere and is already narration. Scene text uses one RP convention: ordinary text is spoken dialogue, while text inside paired single asterisks is visible narration or behavior and is not spoken; spokenText may include short *inline narration* between spoken phrases. Small visible behavior that does not change canonical state may stay narrative, such as a glance, smile, sigh, gesture, wiping part of a counter, adjusting clothing, hesitation, or a small sip that does not mechanically consume the whole drink. Narrated behavior never mutates canonical state.`;
        const grounding = "A formal action in this response is only an attempt. The engine executes it after this response and later supplies a grounded result. Narrative is not an alternate execution channel for canonical state transitions. Do not use publicNarrative or spokenText to establish taking, dropping, transferring, placing, filling, transforming, fully consuming an item, transferring money, moving between canonical locations or sublocations, equipping or unequipping an item, or a formal ability result when the required state change has not been grounded by the engine. If an equip/unequip/take/drop/move/transfer or other tracked mechanic exists but its required action is not currently available because constraints are unmet, narrative must not bypass those constraints. Conversely, when the engine provides no grounded mechanic at all for an action class, that unsupported physical behavior may be described narratively as fiction; for example a character may narratively lie across an ordinary work table if no posture/position action models doing so. Before confirmation, publicNarrative, spokenText, beliefs, relationships, and memories may express intent, effort, preparation, or anticipation but must not claim that the formal action or a multi-step mechanical task successfully changed the world or is complete. A response performing one formal action must not narratively claim that a second available grounded action also completed. Do not record an unconfirmed mechanical completion in memory or belief. If narration and a later engine result disagree, the engine wins. Before output, silently verify the current view against continuation, verify that the chosen action type and every parameter come from the matching current action definition, and verify that narrative and memory updates do not jump ahead of grounded results. Do not output this verification or any hidden reasoning.";
        const memory = "memoryUpdates should normally remain empty unless something meaningfully worth retaining occurred. recentMemories are for events likely to matter beyond the immediate reaction, not routine movement, greetings, mechanical progress, or task scratchpad; use continuation for unfinished workflow state. beliefs are meaningful inferred, uncertain, subjective, or strategically relevant propositions, not copies of obvious current view state. If new grounded information directly contradicts an existing belief, correct that belief with the same ID when it is still the same subject, or explicitly remove an obsolete/redundant belief via beliefIdsToRemove; do not knowingly leave contradictory active beliefs. relationships describe durable or developing social state such as trust, hostility, gratitude, familiarity, suspicion, loyalty, fear, affection, or role expectations; do not use them to store momentary presence such as 'a new patron entered'.";
        const style = "Treat the response as a moment in an ongoing role-playing scene. Let character description, mind state, relationships, continuation, and current situation shape the voice. Prefer concise, concrete, characterful behavior over generic assistant-like NPC replies. Do not force speech or narration into every response and do not repeat information just to make the response longer.";
        const schema = 'memoryUpdates must always contain exactly recentMemoriesToAdd, beliefsToUpsert, beliefIdsToRemove, and relationshipsToUpsert, even when all are empty arrays. A recent memory record is {"summary":"...","importance":0.0}; use summary, never text, and importance must be from 0 to 1. A belief record is {"id":"letter_started_id","text":"...","confidence":"low|medium|high"}. beliefIdsToRemove contains only existing belief IDs that should no longer remain active; prefer same-ID belief upsert when correcting the same proposition. A relationship record is {"targetCharacterId":"character_id","summary":"..."}.';
        return `You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return exactly one JSON object and nothing else: no markdown fence, prose, chain-of-thought, hidden reasoning, patches, or extra fields. ${contract} ${state} ${decision} ${continuation} ${speech} ${grounding} ${memory} ${style} ${schema}`;
    }

    function requestPayloadFromMessages(messages) {
        for (let index = (messages || []).length - 1; index >= 0; index--) {
            const message = messages[index];
            if (!message || message.role !== "user" || typeof message.content !== "string") continue;
            try {
                const payload = JSON.parse(message.content);
                if (isPlainObject(payload) && isPlainObject(payload.context)) return payload;
            } catch (error) {
                // Repair instructions and other user prose are not request payloads.
            }
        }
        return null;
    }

    function actionCatalogFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const view = context && context.view;
        if (isPlainObject(view) && isPlainObject(view.available_actions)) {
            return clone(view.available_actions);
        }
        return {};
    }

    function spokenTargetIdsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const characters = context && context.view && context.view.location && context.view.location.characters;
        return Array.isArray(characters) ? characters.map(function (character) { return character.id; }).filter(Boolean) : [];
    }


    function existingLongTermIdsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const records = payload && payload.context && payload.context.existingLongTermMemories;
        return Array.isArray(records)
            ? records.map(function (memory) { return memory && memory.id; }).filter(function (id) { return typeof id === "string"; })
            : [];
    }

    function protectedLongTermIdsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const records = payload && payload.context && payload.context.existingLongTermMemories;
        return Array.isArray(records)
            ? records.filter(function (memory) { return memory && memory.protected === true; }).map(function (memory) { return memory.id; }).filter(Boolean)
            : [];
    }

    function existingBeliefIdsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const records = context && context.mindContext && context.mindContext.beliefs || context && context.mind && context.mind.beliefs;
        return Array.isArray(records)
            ? records.map(function (belief) { return belief && belief.id; }).filter(function (id) { return typeof id === "string"; })
            : [];
    }

    function decisionMessages(context) {
        return [{ role: "system", content: baseSystem("decision") }, { role: "user", content: JSON.stringify({
            stage: "decision",
            context: clone(context || {}),
            requiredResponseShape: { action: null, publicNarrative: null, spokenText: null, spokenTargetId: null, spokenLoudness: null, continuation: null, memoryUpdates: EMPTY_UPDATES }
        }) }];
    }


    function memoryMaintenanceContract(stage) {
        if (stage === "memory-consolidation-recent") {
            return {
                requiredResponseShape: {
                    groups: [{
                        sourceRecentMemoryIds: ["<sourceRecentMemoryId>"],
                        replacement: { summary: "<consolidated autobiographical memory>", importance: 0.7 }
                    }],
                    archiveOnlyRecentMemoryIds: ["<sourceRecentMemoryId>"],
                    keepActiveRecentMemoryIds: ["<sourceRecentMemoryId>"]
                },
                responseRules: [
                    "The angle-bracket values in requiredResponseShape are schema placeholders only. Never copy them literally. Use real supplied IDs/content. Individual arrays may be empty when their operation is not used.",
                    "Every ID from context.sourceRecentMemories must appear exactly once across groups, archiveOnlyRecentMemoryIds, or keepActiveRecentMemoryIds.",
                    "Only IDs from context.sourceRecentMemories are actionable. IDs from context.newerReadOnlyRecentMemories are evidence only and must never appear in any output ID array.",
                    "Each groups[].replacement may contain exactly summary and importance. Do not return id, protected, createdAt, source, type, metadata, or any other field.",
                    "Newer read-only memories may correct or supersede factual claims in older source memories. Reflect clear later corrections instead of perpetuating an older mistake.",
                    "Do not invent new autobiographical facts to reconcile records. Compress and reconcile only information supported by supplied source and read-only correction records."
                ]
            };
        }
        if (stage === "memory-consolidation-reconciliation-discovery") {
            return {
                requiredResponseShape: {
                    conflicts: [{ beliefId: "<currentBatchBeliefId>", longTermMemoryId: "<activeLongTermMemoryId>", strength: "direct" }]
                },
                responseRules: [
                    "Return zero or more genuine contradiction candidates, at most 8. Do not rewrite any record in this stage.",
                    "beliefId must come only from context.currentBeliefs. longTermMemoryId must come only from context.activeLongTermMemories.",
                    "strength must be direct, strong, or possible. direct means the claims cannot reasonably both be true in the same interpretation; strong means substantially incompatible but context may reconcile them; possible means tension worth noticing but not necessarily an error.",
                    "Do not call differences in tone, emotion, or incomplete perspective contradictions. Prefer returning no conflict over manufacturing one."
                ]
            };
        }
        if (stage === "memory-consolidation-reconciliation-resolution") {
            return {
                requiredResponseShape: {
                    resolution: "keep_conflict",
                    beliefReplacement: null,
                    memoryReplacement: null
                },
                responseRules: [
                    "resolution must be exactly one of revise_belief, revise_memory, revise_both, keep_conflict.",
                    "Always return exactly the three keys resolution, beliefReplacement, memoryReplacement.",
                    "For keep_conflict: both replacements must be null.",
                    "For revise_belief: beliefReplacement must be exactly {text, confidence}; memoryReplacement must be null.",
                    "For revise_memory: memoryReplacement must be exactly {summary, importance}; beliefReplacement must be null.",
                    "For revise_both: supply both exact replacement objects.",
                    "Do not return ids or protected flags. The engine retains the selected record IDs and controls protection state.",
                    "The selected belief and selected memory are equally fallible. Record type, recency, or confidence alone does not establish truth.",
                    "Use supplied evidence to produce the most justified internal state, not necessarily one definitive fact. If evidence is insufficient, use keep_conflict; a revised belief may explicitly express uncertainty, conflicting accounts, suspected deception, or unreliable recollection.",
                    "Do not invent new autobiographical facts and do not rewrite merely for style."
                ]
            };
        }
        if (stage === "memory-consolidation-longterm") {
            return {
                requiredResponseShape: {
                    merge: {
                        sourceLongTermMemoryIds: ["<existingLongTermMemoryIdA>", "<existingLongTermMemoryIdB>"],
                        replacement: { summary: "<faithful merged autobiographical memory>", importance: 0.8 }
                    }
                },
                responseRules: [
                    "The angle-bracket values in requiredResponseShape are schema placeholders only. Never copy them literally. Use real supplied IDs/content.",
                    "response.merge may be null. Prefer merge:null whenever no clearly safe merge exists.",
                    "When merge is non-null, sourceLongTermMemoryIds must contain exactly 2-3 supplied unprotected long-term IDs.",
                    "merge.replacement may contain exactly summary and importance. Do not return id, protected, or any other engine-owned field.",
                    "Do not invent new autobiographical facts; faithfully preserve meaningful information from the selected sources."
                ]
            };
        }
        throw new Error(`Unknown memory maintenance stage ${stage}.`);
    }

    function memoryMaintenanceSystem(stage) {
        const common = [
            "You are maintaining one character's autobiographical mind state, not taking a game turn.",
            "Character continuity and semantic preservation are more important than compactness or token savings.",
            "Maintenance reduces active context; it must not erase meaningful autobiographical information.",
            "Use only supplied records. Maintenance may compress and reconcile supplied information, but it must not infer novel autobiographical facts that are not supported by those records.",
            "Never invent or return engine-owned record fields. Return only fields explicitly present in requiredResponseShape. New memory IDs are assigned by the engine, and protection state is controlled exclusively by the engine.",
            "Return exactly the required JSON shape with no prose, markdown, or extra fields."
        ];
        if (stage === "memory-consolidation-recent") common.push(
            "Process only context.sourceRecentMemories as the actionable old recent-memory batch. Every actionable source must be assigned exactly once: consolidate into durable long-term meaning, archive-only if truly routine, or keep active if safe consolidation would lose meaning.",
            "context.newerReadOnlyRecentMemories is correction evidence only. You may use it to correct older mistaken claims, but you may not select, archive, keep, or otherwise operate on those read-only IDs.",
            "Never remove protected memories. A replacement must preserve all still-meaningful details from its source records. It is acceptable to keep material active."
        );
        if (stage === "memory-consolidation-reconciliation-discovery") common.push(
            "This is a read-only cognitive-dissonance discovery pass. Compare only context.currentBeliefs against context.activeLongTermMemories and identify genuine conflicting pairs.",
            "Beliefs and memories are both fallible. Do not assume either record type is authoritative. Rank only the contradiction strength; do not resolve or rewrite anything yet."
        );
        if (stage === "memory-consolidation-reconciliation-resolution") common.push(
            "Resolve only the single selected belief/long-term-memory pair. All other supplied mind records are read-only evidence.",
            "A belief is not automatically more authoritative than a memory, and a memory is not automatically more authoritative than a belief. Grounded known information, explicit later corrections, direct observations, and mutually supporting records may provide stronger evidence, but recency/confidence alone do not prove truth.",
            "The correct result may be revise_belief, revise_memory, revise_both, or keep_conflict. If certainty is not justified, preserve the conflict or express uncertainty rather than inventing a winner."
        );
        if (stage === "memory-consolidation-longterm") common.push(
            "Optionally merge only 2-3 clearly overlapping unprotected long-term memories when one replacement can faithfully preserve every meaningful detail. If uncertain, return merge:null."
        );
        return common.join(" ");
    }

    function memoryMaintenanceMessages(stage, context) {
        const contract = memoryMaintenanceContract(stage);
        return [
            { role: "system", content: memoryMaintenanceSystem(stage) },
            { role: "user", content: JSON.stringify({
                stage: stage,
                context: clone(context || {}),
                requiredResponseShape: clone(contract.requiredResponseShape),
                responseRules: clone(contract.responseRules)
            }) }
        ];
    }

    function resultMessages(context, action, actionResult) {
        return [{ role: "system", content: baseSystem("result") }, { role: "user", content: JSON.stringify({
            stage: "result",
            context: clone(context || {}),
            action: action,
            groundedActionResult: actionResult,
            requiredResponseShape: { publicNarrative: null, spokenText: null, memoryUpdates: EMPTY_UPDATES }
        }) }];
    }

    function actionCatalogRepairSummary(actionCatalog) {
        if (!isPlainObject(actionCatalog)) return "";
        return Object.entries(actionCatalog).map(function (entry) {
            const type = entry[0];
            const definition = isPlainObject(entry[1]) ? entry[1] : {};
            const options = isPlainObject(definition.options) ? definition.options : {};
            const optionText = Object.entries(options).map(function (optionEntry) {
                return `${optionEntry[0]}=${JSON.stringify(optionEntry[1])}`;
            }).join(", ");
            return `- ${type}: ${definition.description || ""}${optionText ? ` | ${optionText}` : ""}`;
        }).join("\n").slice(0, 6000);
    }

    function buildRepairMessages(messages, responseContent, stage, errors, actionCatalog) {
        const errorList = (errors && errors.length ? errors : ["The response did not match the protocol."])
            .map(function (error) { return `- ${error}`; }).join("\n");
        const actionGuidance = stage === "decision"
            ? `\nPreserve the character's underlying purpose while correcting the mechanical protocol error. Re-read the current action catalog, choose the action type from its semantic description first, then choose parameters only from that action's own options. Do not fall back to action:null solely because the previous action type or option was invalid; action:null is still valid when no useful valid action exists or the character deliberately decides not to act.\nCurrent action catalog:\n${actionCatalogRepairSummary(actionCatalog)}`
            : "";
        const maintenancePayload = requestPayloadFromMessages(messages);
        const maintenanceContract = stage.indexOf("memory-consolidation-") === 0 && maintenancePayload
            ? `\nExact response shape (illustrative placeholder values only; use supplied real IDs):\n${JSON.stringify(maintenancePayload.requiredResponseShape)}\nRules:\n${(maintenancePayload.responseRules || []).map(function (rule) { return `- ${rule}`; }).join("\n")}\nRepair syntax/shape only. Do not add semantic content, invent missing maintenance operations, or add fields outside this schema.`
            : "";
        return messages.concat([
            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
            { role: "user", content: `Your previous response failed validation:\n${errorList}${actionGuidance}${maintenanceContract}\nReturn the complete corrected ${stage} JSON object. Include every required field, no extra fields, no prose, and no markdown fence.` }
        ]);
    }

    async function requestValidated(messages, stage, client) {
        const actionCatalog = actionCatalogFromMessages(messages);
        const spokenTargetIds = spokenTargetIdsFromMessages(messages);
        const existingLongTermIds = existingLongTermIdsFromMessages(messages);
        const existingBeliefIds = existingBeliefIdsFromMessages(messages);
        const protectedLongTermIds = protectedLongTermIdsFromMessages(messages);
        const maintenancePayload = requestPayloadFromMessages(messages);
        const maintenanceContext = maintenancePayload && maintenancePayload.context || {};
        const trace = {
            stage: stage,
            originalMessages: clone(messages),
            attempts: [],
            finalStatus: "pending"
        };
        let currentMessages = clone(messages);
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await client.chat(currentMessages);
            const attemptTrace = {
                attempt: attempt + 1,
                kind: attempt === 0 ? "initial" : "repair",
                messages: clone(currentMessages),
                modelId: response && response.modelId || null,
                rawContent: response && typeof response.content === "string" ? response.content : "",
                usage: response && response.usage || null,
                providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                parsedValue: null,
                validationErrors: []
            };
            trace.attempts.push(attemptTrace);
            if (!response || !response.ok) {
                trace.finalStatus = "request_failed";
                trace.safeError = clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "AI request failed." });
                return { ok: false, error: trace.safeError, modelId: response && response.modelId || null, trace: trace };
            }

            let value;
            let validation;
            try {
                value = extractObject(response.content);
                attemptTrace.parsedValue = clone(value);
                validation = stage === "decision"
                    ? validateDecision(value, actionCatalog, spokenTargetIds, existingBeliefIds)
                    : stage === "memory-consolidation-recent"
                        ? validateRecentMaintenance(value, maintenanceContext)
                        : stage === "memory-consolidation-reconciliation-discovery"
                            ? validateReconciliationDiscovery(value, maintenanceContext)
                            : stage === "memory-consolidation-reconciliation-resolution"
                                ? validateReconciliationResolution(value, maintenanceContext)
                                : stage === "memory-consolidation-longterm"
                                    ? validateLongTermMaintenance(value, maintenanceContext)
                                    : validateResult(value, existingBeliefIds);
            } catch (error) {
                validation = { ok: false, message: error.message, errors: [error.message] };
            }

            if (validation.ok) {
                trace.finalStatus = "valid";
                trace.repaired = attempt === 1;
                return {
                    ok: true,
                    value: validation.value,
                    modelId: response.modelId || null,
                    usage: response.usage,
                    rawContent: response.content,
                    repaired: attempt === 1,
                    trace: trace
                };
            }

            attemptTrace.validationErrors = (validation.errors || [validation.message]).slice();
            if (attempt === 1) {
                trace.finalStatus = "invalid_after_repair";
                trace.safeError = {
                    code: "INVALID_MODEL_JSON",
                    message: "The model returned invalid JSON protocol data.",
                    details: attemptTrace.validationErrors.slice()
                };
                return { ok: false, error: trace.safeError, modelId: response && response.modelId || null, trace: trace };
            }
            currentMessages = buildRepairMessages(messages, response.content, stage, attemptTrace.validationErrors, actionCatalog);
        }
    }

    setup.AIProtocol = {
        EMPTY_UPDATES: EMPTY_UPDATES,
        extractObject: extractObject,
        validateDecision: validateDecision,
        validateResult: validateResult,
        validateRecentMaintenance: validateRecentMaintenance,
        validateReconciliationDiscovery: validateReconciliationDiscovery,
        validateReconciliationResolution: validateReconciliationResolution,
        validateLongTermMaintenance: validateLongTermMaintenance,
        actionCatalogFromMessages: actionCatalogFromMessages,
        spokenTargetIdsFromMessages: spokenTargetIdsFromMessages,
        existingLongTermIdsFromMessages: existingLongTermIdsFromMessages,
        existingBeliefIdsFromMessages: existingBeliefIdsFromMessages,
        protectedLongTermIdsFromMessages: protectedLongTermIdsFromMessages,
        decisionMessages: decisionMessages,
        memoryMaintenanceMessages: memoryMaintenanceMessages,
        resultMessages: resultMessages,
        buildRepairMessages: buildRepairMessages,
        requestValidated: requestValidated
    };
}());
