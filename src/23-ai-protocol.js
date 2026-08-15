(function () {
    "use strict";

    const EMPTY_UPDATES = { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] };
    const DECISION_KEYS = ["action", "publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation", "memoryUpdates"];
    const RESULT_KEYS = ["publicNarrative", "spokenText", "memoryUpdates"];
    const UPDATE_KEYS = ["recentMemoriesToAdd", "beliefsToUpsert", "relationshipsToUpsert"];

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

    function validateUpdatesDetailed(updates, path) {
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

        (Array.isArray(updates.beliefsToUpsert) ? updates.beliefsToUpsert : []).forEach(function (belief, index) {
            const recordPath = `${path}.beliefsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(belief, ["id", "text", "confidence"], recordPath));
            if (!isPlainObject(belief)) return;
            if (typeof belief.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id)) {
                errors.push(`${recordPath}.id must start with a letter and contain only letters, digits, underscores, or hyphens.`);
            }
            errors.push.apply(errors, requiredTextErrors(belief.text, `${recordPath}.text`, 500));
            if (!["low", "medium", "high"].includes(belief.confidence)) {
                errors.push(`${recordPath}.confidence must be low, medium, or high.`);
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
        return updates.recentMemoriesToAdd.length === 0 && updates.beliefsToUpsert.length === 0 && updates.relationshipsToUpsert.length === 0;
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

    function validateDecision(value, actionCatalog, spokenTargetIds) {
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
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates"));

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

    function validateResult(value) {
        const errors = exactKeyErrors(value, RESULT_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates"));
        return finishValidation(value, errors);
    }


    function validateMemoryConsolidation(value, existingLongTermIds, existingBeliefIds, protectedLongTermIds) {
        const keys = ["longTermMemoriesToUpsert", "longTermMemoriesToAdd", "longTermMemoryIdsToRemove", "beliefsToUpsert", "beliefIdsToRemove"];
        const errors = exactKeyErrors(value, keys, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);

        keys.forEach(function (key) {
            if (!Array.isArray(value[key])) errors.push(`response.${key} must be an array.`);
        });

        const allowedMemoryIds = new Set(Array.isArray(existingLongTermIds) ? existingLongTermIds : []);
        const allowedBeliefIds = new Set(Array.isArray(existingBeliefIds) ? existingBeliefIds : []);
        const protectedIds = new Set(Array.isArray(protectedLongTermIds) ? protectedLongTermIds : []);
        const seenMemoryUpserts = new Set();
        const seenMemoryRemovals = new Set();
        const seenBeliefUpserts = new Set();
        const seenBeliefRemovals = new Set();

        (Array.isArray(value.longTermMemoriesToUpsert) ? value.longTermMemoriesToUpsert : []).forEach(function (memory, index) {
            const path = `response.longTermMemoriesToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(memory, ["id", "summary", "importance"], path));
            if (!isPlainObject(memory)) return;
            if (typeof memory.id !== "string" || !allowedMemoryIds.has(memory.id)) {
                errors.push(`${path}.id must match an existing long-term-memory ID supplied in the request.`);
            } else if (seenMemoryUpserts.has(memory.id)) {
                errors.push(`${path}.id may be upserted only once.`);
            } else {
                seenMemoryUpserts.add(memory.id);
            }
            errors.push.apply(errors, requiredTextErrors(memory.summary, `${path}.summary`, 2000));
            if (typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
                errors.push(`${path}.importance must be a finite number from 0 to 1.`);
            }
        });

        (Array.isArray(value.longTermMemoriesToAdd) ? value.longTermMemoriesToAdd : []).forEach(function (memory, index) {
            const path = `response.longTermMemoriesToAdd[${index}]`;
            errors.push.apply(errors, exactKeyErrors(memory, ["summary", "importance"], path));
            if (!isPlainObject(memory)) return;
            errors.push.apply(errors, requiredTextErrors(memory.summary, `${path}.summary`, 2000));
            if (typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
                errors.push(`${path}.importance must be a finite number from 0 to 1.`);
            }
        });

        (Array.isArray(value.longTermMemoryIdsToRemove) ? value.longTermMemoryIdsToRemove : []).forEach(function (id, index) {
            const path = `response.longTermMemoryIdsToRemove[${index}]`;
            if (typeof id !== "string" || !allowedMemoryIds.has(id)) errors.push(`${path} must match an existing long-term-memory ID supplied in the request.`);
            else if (seenMemoryRemovals.has(id)) errors.push(`${path} may be removed only once.`);
            else if (seenMemoryUpserts.has(id)) errors.push(`${path} cannot be both removed and upserted.`);
            else if (protectedIds.has(id)) errors.push(`${path} cannot remove a protected long-term memory.`);
            else seenMemoryRemovals.add(id);
        });

        (Array.isArray(value.beliefsToUpsert) ? value.beliefsToUpsert : []).forEach(function (belief, index) {
            const path = `response.beliefsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(belief, ["id", "text", "confidence"], path));
            if (!isPlainObject(belief)) return;
            if (typeof belief.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id)) {
                errors.push(`${path}.id must start with a letter and contain only letters, digits, underscores, or hyphens.`);
            } else if (seenBeliefUpserts.has(belief.id)) {
                errors.push(`${path}.id may be upserted only once.`);
            } else {
                seenBeliefUpserts.add(belief.id);
            }
            errors.push.apply(errors, requiredTextErrors(belief.text, `${path}.text`, 2000));
            if (!["low", "medium", "high"].includes(belief.confidence)) errors.push(`${path}.confidence must be low, medium, or high.`);
        });

        (Array.isArray(value.beliefIdsToRemove) ? value.beliefIdsToRemove : []).forEach(function (id, index) {
            const path = `response.beliefIdsToRemove[${index}]`;
            if (typeof id !== "string" || !allowedBeliefIds.has(id)) errors.push(`${path} must match an existing belief ID supplied in the request.`);
            else if (seenBeliefRemovals.has(id)) errors.push(`${path} may be removed only once.`);
            else if (seenBeliefUpserts.has(id)) errors.push(`${path} cannot be both removed and upserted.`);
            else seenBeliefRemovals.add(id);
        });

        return finishValidation(value, errors);
    }

    function memoryConsolidationSystem() {
        return [
            "You are maintaining one character's autobiographical mind state.",
            "You are not taking a game turn and cannot act in the world.",
            "Use only the supplied character context, existing beliefs, existing long-term memories, and recent memories selected for consolidation.",
            "Preserve identity, important commitments, relationships, discoveries, conflicts, uncertainties, and meaningful experiences. Prefer updating or merging redundant records over deleting unique important information.",
            "Long-term memory is thematic rather than chronological. Fold new material into an existing topic when appropriate. Add a new long-term memory only for genuinely distinct durable material.",
            "You may remove a redundant or superseded long-term memory only when the meaningful autobiographical content that should remain is preserved elsewhere in the resulting long-term memory set. Never remove protected memories.",
            "Beliefs are subjective propositions, not objective facts. You may update a belief, add a useful durable belief, or remove an obsolete, contradicted, redundant, or superseded belief. Preserve uncertainty instead of rewriting uncertain beliefs as facts.",
            "Do not modify knownFacts, relationships, continuation, controller state, world state, recent memories directly, or any other partition not named in the output contract.",
            "Do not invent events or conclusions merely to make the state cleaner, and do not mention memory maintenance, prompts, AI models, or the framework as an in-world experience.",
            "Return exactly one JSON object with the keys longTermMemoriesToUpsert, longTermMemoriesToAdd, longTermMemoryIdsToRemove, beliefsToUpsert, and beliefIdsToRemove, and nothing else.",
            "longTermMemoriesToUpsert records are exactly {\"id\":\"existing_id\",\"summary\":\"...\",\"importance\":0.0}; additions are exactly {\"summary\":\"...\",\"importance\":0.0}.",
            "beliefsToUpsert records are exactly {\"id\":\"letter_started_id\",\"text\":\"...\",\"confidence\":\"low|medium|high\"}. Removal arrays contain only existing IDs. All five arrays must always be present, even when empty."
        ].join(" ");
    }

    function baseSystem(stage) {
        if (stage !== "decision") {
            return "You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return exactly one JSON object and nothing else: no markdown fence, prose, chain-of-thought, hidden reasoning, patches, or extra fields. Return exactly the keys publicNarrative, spokenText, and memoryUpdates. Do not choose another action; react only to the supplied grounded action result. A formal result supplied here is authoritative. Keep role-play concise and characterful. memoryUpdates must always contain exactly recentMemoriesToAdd, beliefsToUpsert, and relationshipsToUpsert, even when all are empty arrays. A recent memory record is {\"summary\":\"...\",\"importance\":0.0}; importance must be from 0 to 1. A belief record is {\"id\":\"letter_started_id\",\"text\":\"...\",\"confidence\":\"low|medium|high\"}. A relationship record is {\"targetCharacterId\":\"character_id\",\"summary\":\"...\"}.";
        }

        const loudness = speechLoudnessValues().map(function (value) { return JSON.stringify(value); }).join(" or ");
        const contract = `Return exactly the keys action, publicNarrative, spokenText, spokenTargetId, spokenLoudness, continuation, and memoryUpdates. action is null or exactly one action from context.view.available_actions using only currently offered option values. Available actions are capabilities, not recommendations: do not choose one merely because it exists. spokenTargetId is null or the id of one character currently listed in context.view.location.characters. spokenLoudness is per utterance, not persistent state: when spokenText is present it must be ${loudness}; when spokenText is null, spokenTargetId and spokenLoudness must both be null.`;
        const state = "First understand the current situation. context.view is authoritative for what is publicly and operationally true now. Pending observations have already passed deterministic perception and delivery rules; if one was delivered, treat it as perceived and do not second-guess audibility or visibility from distance, loudness, posture, or room layout. context.recentDialogue is a short-lived record of recently spoken dialogue actually available to this character, including the character's own prior speech; use it for conversational continuity, not as objective physical world state, and do not copy routine lines into persistent memory merely because they appear there. Character IDs are persistent identities: the same character id is the same person after leaving and returning, so location changes do not reset familiarity, prior interaction, memories, beliefs, or relationships. A character absent from context.view.location.characters is not currently visible here. context.view and grounded engine results override stale conversational claims about location, possession, posture, or other physical facts.";
        const decision = "Then decide whether there is a character-level reason to react or act. Directly addressed meaningful speech normally deserves an in-character response through dialogue, visible behavior, a formal action, or intentional silence; a completely empty no-op after direct address should be deliberate and character-driven, not accidental. Spontaneous initiative is valid: characters may work, prepare things, clean, watch people, investigate, move, joke, refuse, or otherwise act on their own. Keep initiative coherent with personality, duties, current observations, and existing intentions. Do not invent a task merely because an action is available. If the character has adopted a concrete purpose and a currently available formal action clearly advances it, normally choose that action rather than only narrating or promising progress, unless personality or circumstances justify postponing, refusing, revising, or abandoning the purpose. context.view.available_actions describes only what is possible right now; a later step may appear after a prerequisite grounded action changes the world. Work one atomic grounded step at a time. Choose the action type from its semantic description first, then choose every parameter only from that action's own current options. Never reuse an option value from a different action type. If no action is warranted, speech, a small visible reaction, or a genuine no-op may be natural.";
        const continuation = "continuation is your nullable, free-form, private working intention. It records an unfinished purpose, never an action queue or predetermined sequence, and the framework does not interpret it. continuation never overrides the current canonical view: before following it, re-check possession, item state, money, current location/position, visible characters, grounded results or failures, and any other mechanical facts it depends on. If those facts changed, adapt, recover, revise, abandon, or clear the purpose instead of narrating stale assumptions as true. If you choose an atomic action as one step toward a purpose that remains unfinished after this response, keep that purpose in continuation; do not start a purposive movement or task and immediately discard why you are doing it. A complete local action may leave continuation null. On every later reaction reevaluate the current view, available actions, new observations, engine-confirmed results or failures, priorities, and continuation. If a still-relevant continuation has an obvious available step and nothing more important overrides it, normally make progress rather than return an accidental no-op. After failure, use the grounded feedback and do not blindly repeat the same action.";
        const speech = `Use spokenText for dialogue in the character's own voice. Choose spokenLoudness structurally for this utterance using ${loudness}; writing *whispers*, *in a low voice*, or similar prose does not change mechanical loudness. The framework owns who receives the resulting observation. spokenTargetId and a formal-action target may differ. publicNarrative is brief visible behavior or atmosphere and is already narration. Scene text uses one RP convention: ordinary text is spoken dialogue, while text inside paired single asterisks is visible narration or behavior and is not spoken; spokenText may include short *inline narration* between spoken phrases. Small visible behavior that does not change canonical state may stay narrative, such as a glance, smile, sigh, gesture, wiping part of a counter, adjusting clothing, hesitation, or a small sip that does not mechanically consume the whole drink. Narrated behavior never mutates canonical state.`;
        const grounding = "A formal action in this response is only an attempt. The engine executes it after this response and later supplies a grounded result. Narrative is not an alternate execution channel for canonical state transitions. Do not use publicNarrative or spokenText to establish taking, dropping, transferring, placing, filling, transforming, fully consuming an item, transferring money, moving between canonical locations or sublocations, or a formal ability result when the required state change has not been grounded by the engine. Before confirmation, publicNarrative, spokenText, beliefs, relationships, and memories may express intent, effort, preparation, or anticipation but must not claim that the formal action or a multi-step mechanical task successfully changed the world or is complete. Do not record an unconfirmed mechanical completion in memory or belief. If narration and a later engine result disagree, the engine wins. Before output, silently verify the current view against continuation, verify that the chosen action type and every parameter come from the matching current action definition, and verify that narrative and memory updates do not jump ahead of grounded results. Do not output this verification or any hidden reasoning.";
        const memory = "memoryUpdates should normally remain empty unless something meaningfully worth retaining occurred. recentMemories are for events likely to matter beyond the immediate reaction, not routine movement, greetings, mechanical progress, or task scratchpad; use continuation for unfinished workflow state. beliefs are meaningful inferred, uncertain, subjective, or strategically relevant propositions, not copies of obvious current view state. relationships describe durable or developing social state such as trust, hostility, gratitude, familiarity, suspicion, loyalty, fear, affection, or role expectations; do not use them to store momentary presence such as 'a new patron entered'.";
        const style = "Treat the response as a moment in an ongoing role-playing scene. Let character description, mind state, relationships, continuation, and current situation shape the voice. Prefer concise, concrete, characterful behavior over generic assistant-like NPC replies. Do not force speech or narration into every response and do not repeat information just to make the response longer.";
        const schema = 'memoryUpdates must always contain exactly recentMemoriesToAdd, beliefsToUpsert, and relationshipsToUpsert, even when all are empty arrays. A recent memory record is {"summary":"...","importance":0.0}; use summary, never text, and importance must be from 0 to 1. A belief record is {"id":"letter_started_id","text":"...","confidence":"low|medium|high"}. A relationship record is {"targetCharacterId":"character_id","summary":"..."}.';
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
        const records = payload && payload.context && payload.context.mindContext && payload.context.mindContext.beliefs;
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


    function memoryConsolidationMessages(context) {
        return [
            { role: "system", content: memoryConsolidationSystem() },
            { role: "user", content: JSON.stringify({
                stage: "memory-consolidation",
                context: clone(context || {}),
                requiredResponseShape: {
                    longTermMemoriesToUpsert: [],
                    longTermMemoriesToAdd: [],
                    longTermMemoryIdsToRemove: [],
                    beliefsToUpsert: [],
                    beliefIdsToRemove: []
                }
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
        return messages.concat([
            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
            { role: "user", content: `Your previous response failed validation:\n${errorList}${actionGuidance}\nReturn the complete corrected ${stage} JSON object. Include every required field, no extra fields, no prose, and no markdown fence.` }
        ]);
    }

    async function requestValidated(messages, stage, client) {
        const actionCatalog = actionCatalogFromMessages(messages);
        const spokenTargetIds = spokenTargetIdsFromMessages(messages);
        const existingLongTermIds = existingLongTermIdsFromMessages(messages);
        const existingBeliefIds = existingBeliefIdsFromMessages(messages);
        const protectedLongTermIds = protectedLongTermIdsFromMessages(messages);
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
                    ? validateDecision(value, actionCatalog, spokenTargetIds)
                    : stage === "memory-consolidation"
                        ? validateMemoryConsolidation(value, existingLongTermIds, existingBeliefIds, protectedLongTermIds)
                        : validateResult(value);
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
        validateMemoryConsolidation: validateMemoryConsolidation,
        actionCatalogFromMessages: actionCatalogFromMessages,
        spokenTargetIdsFromMessages: spokenTargetIdsFromMessages,
        existingLongTermIdsFromMessages: existingLongTermIdsFromMessages,
        existingBeliefIdsFromMessages: existingBeliefIdsFromMessages,
        protectedLongTermIdsFromMessages: protectedLongTermIdsFromMessages,
        decisionMessages: decisionMessages,
        memoryConsolidationMessages: memoryConsolidationMessages,
        resultMessages: resultMessages,
        buildRepairMessages: buildRepairMessages,
        requestValidated: requestValidated
    };
}());
