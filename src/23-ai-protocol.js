(function () {
    "use strict";

    const EMPTY_UPDATES = { relationshipsToUpsert: [], activatedBeliefIds: [] };
    const EMPTY_INTIMATE_UPDATES = { enablePartnerIds: [], disablePartnerIds: [], anticipationReplacements: [] };
    const DECISION_KEYS = ["action", "publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation", "memoryUpdates", "intimateUpdates"];
    const LEGACY_REQUIRED_DECISION_KEYS = ["action", "publicNarrative", "spokenText", "spokenTargetId", "spokenLoudness", "continuation", "memoryUpdates"];
    const RESULT_KEYS = ["publicNarrative", "spokenText", "memoryUpdates"];
    const UPDATE_KEYS = ["relationshipsToUpsert", "activatedBeliefIds"];
    const ANTICIPATION_REPLACEMENT_SHAPE = '[{"partnerId":"character_id","motivation":{"impulse":"...","imaginedMoments":["...","..."],"openAnticipations":["...","..."]}}]';
    const RELATIONSHIP_SUMMARY_GUIDANCE = "A relationship summary is a self-contained CURRENT summary of the durable facts that materially define this character's present relationship with the target. Include material current status/type, durable trust/fear/affection/resentment, standing arrangements such as living together or ongoing work, important enduring obligations/invitations/promises, and standing boundaries when they matter to future interaction. Update it when either the relationship itself OR one of those durable standing facts materially changes. Do not turn it into a chronological event log; memories own the event sequence.";

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

    function validateUpdatesDetailed(updates, path, existingBeliefIds, existingRelationships) {
        const errors = exactKeyErrors(updates, UPDATE_KEYS, path);
        if (!isPlainObject(updates)) return errors;
        if (!Array.isArray(updates.relationshipsToUpsert)) errors.push(`${path}.relationshipsToUpsert must be an array.`);
        else if (updates.relationshipsToUpsert.length > 5) errors.push(`${path}.relationshipsToUpsert may contain at most 5 records.`);
        if (!Array.isArray(updates.activatedBeliefIds)) errors.push(`${path}.activatedBeliefIds must be an array.`);
        else if (updates.activatedBeliefIds.length > 12) errors.push(`${path}.activatedBeliefIds may contain at most 12 IDs.`);
        const existingRelationshipByTarget = new Map((Array.isArray(existingRelationships) ? existingRelationships : []).filter(function (relationship) {
            return isPlainObject(relationship) && typeof relationship.targetCharacterId === "string";
        }).map(function (relationship) { return [relationship.targetCharacterId, relationship]; }));
        (Array.isArray(updates.relationshipsToUpsert) ? updates.relationshipsToUpsert : []).forEach(function (relationship, index) {
            const recordPath = `${path}.relationshipsToUpsert[${index}]`;
            errors.push.apply(errors, exactKeyErrors(relationship, ["targetCharacterId", "summary"], recordPath));
            if (!isPlainObject(relationship)) return;
            errors.push.apply(errors, requiredTextErrors(relationship.targetCharacterId, `${recordPath}.targetCharacterId`, 200));
            errors.push.apply(errors, requiredTextErrors(relationship.summary, `${recordPath}.summary`, 500));
            const existing = existingRelationshipByTarget.get(relationship.targetCharacterId);
            if (existing && typeof relationship.summary === "string" && relationship.summary.trim() === String(existing.summary || "").trim()) {
                errors.push(`${recordPath} has no effect after normalization. Omit an unchanged relationship upsert entirely; relevance or continued importance does not justify echoing it.`);
            }
        });
        const seen = new Set();
        (Array.isArray(updates.activatedBeliefIds) ? updates.activatedBeliefIds : []).forEach(function (id, index) {
            if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) errors.push(`${path}.activatedBeliefIds[${index}] must be a valid belief ID.`);
            else if (seen.has(id)) errors.push(`${path}.activatedBeliefIds[${index}] is duplicated.`);
            else if (Array.isArray(existingBeliefIds) && !existingBeliefIds.includes(id)) errors.push(`${path}.activatedBeliefIds[${index}] selected a belief not supplied in context.`);
            seen.add(id);
        });
        return errors;
    }


    function decisionKeyErrors(value) {
        if (!isPlainObject(value)) return ["response must be an object."];
        const errors = [];
        Object.keys(value).forEach(function (key) { if (!DECISION_KEYS.includes(key)) errors.push(`response.${key} is not allowed.`); });
        LEGACY_REQUIRED_DECISION_KEYS.forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`response.${key} is required.`); });
        return errors;
    }

    function intimateBaseValidation(updates, path, validationContext) {
        const errors = exactKeyErrors(updates, ["enablePartnerIds", "disablePartnerIds", "anticipationReplacements"], path);
        if (!isPlainObject(updates)) return { errors: errors, activeIds: new Set(), seenDisable: new Set() };
        const activeIds = new Set(validationContext && Array.isArray(validationContext.activePartnerIds) ? validationContext.activePartnerIds : []);
        const eligibleIds = new Set(validationContext && Array.isArray(validationContext.eligiblePartnerIds) ? validationContext.eligiblePartnerIds : []);
        const seenEnable = new Set(), seenDisable = new Set();
        if (!Array.isArray(updates.enablePartnerIds)) errors.push(`${path}.enablePartnerIds must be an array.`);
        else if (updates.enablePartnerIds.length > 5) errors.push(`${path}.enablePartnerIds may contain at most 5 IDs.`);
        if (!Array.isArray(updates.disablePartnerIds)) errors.push(`${path}.disablePartnerIds must be an array.`);
        else if (updates.disablePartnerIds.length > 5) errors.push(`${path}.disablePartnerIds may contain at most 5 IDs.`);
        (Array.isArray(updates.enablePartnerIds) ? updates.enablePartnerIds : []).forEach(function (id, index) {
            if (typeof id !== "string" || !id) errors.push(`${path}.enablePartnerIds[${index}] must be a character ID.`);
            else if (seenEnable.has(id)) errors.push(`${path}.enablePartnerIds[${index}] is duplicated.`);
            else if (activeIds.has(id)) errors.push(`${path}.enablePartnerIds[${index}] is already active.`);
            else if (!eligibleIds.has(id)) errors.push(`${path}.enablePartnerIds[${index}] is not an eligible currently grounded partner.`);
            seenEnable.add(id);
        });
        (Array.isArray(updates.disablePartnerIds) ? updates.disablePartnerIds : []).forEach(function (id, index) {
            if (typeof id !== "string" || !id) errors.push(`${path}.disablePartnerIds[${index}] must be a character ID.`);
            else if (seenDisable.has(id)) errors.push(`${path}.disablePartnerIds[${index}] is duplicated.`);
            else if (!activeIds.has(id)) errors.push(`${path}.disablePartnerIds[${index}] is not an active intimate partner.`);
            else if (seenEnable.has(id)) errors.push(`${path}.disablePartnerIds[${index}] cannot also be enabled.`);
            seenDisable.add(id);
        });
        return { errors: errors, activeIds: activeIds, seenDisable: seenDisable };
    }

    function intimateMotivationErrors(value, path) {
        const errors = exactKeyErrors(value, ["impulse", "imaginedMoments", "openAnticipations"], path);
        if (!isPlainObject(value)) return errors;
        errors.push.apply(errors, requiredTextErrors(value.impulse, `${path}.impulse`, 400));
        [["imaginedMoments", value.imaginedMoments], ["openAnticipations", value.openAnticipations]].forEach(function (entry) {
            const key = entry[0], list = entry[1];
            if (!Array.isArray(list) || list.length !== 2) {
                errors.push(`${path}.${key} must contain exactly two entries.`);
                return;
            }
            list.forEach(function (text, index) { errors.push.apply(errors, requiredTextErrors(text, `${path}.${key}[${index}]`, 400)); });
        });
        return errors;
    }

    function validateAnticipationReplacements(updates, path, validationContext) {
        const errors = [];
        if (!isPlainObject(updates)) return errors;
        const activeIds = new Set(validationContext && Array.isArray(validationContext.activePartnerIds) ? validationContext.activePartnerIds : []);
        const disabledIds = new Set(Array.isArray(updates.disablePartnerIds) ? updates.disablePartnerIds : []);
        const seenReplace = new Set();
        if (!Array.isArray(updates.anticipationReplacements)) {
            errors.push(`${path}.anticipationReplacements must be an array.`);
            return errors;
        }
        if (updates.anticipationReplacements.length > 5) errors.push(`${path}.anticipationReplacements may contain at most 5 records.`);
        updates.anticipationReplacements.forEach(function (record, index) {
            const recordPath = `${path}.anticipationReplacements[${index}]`;
            errors.push.apply(errors, exactKeyErrors(record, ["partnerId", "motivation"], recordPath));
            if (!isPlainObject(record)) return;
            const id = record.partnerId;
            if (typeof id !== "string" || !id) errors.push(`${recordPath}.partnerId must be a character ID.`);
            else if (seenReplace.has(id)) errors.push(`${recordPath}.partnerId is duplicated.`);
            else if (!activeIds.has(id)) errors.push(`${recordPath}.partnerId must reference an already-active intimate context.`);
            else if (disabledIds.has(id)) errors.push(`${recordPath}.partnerId cannot also be disabled.`);
            seenReplace.add(id);
            errors.push.apply(errors, intimateMotivationErrors(record.motivation, `${recordPath}.motivation`));
        });
        return errors;
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
        const issues = setup.ActionOptionValidation.validate(action, actionDefinition);
        issues.forEach(function (issue) {
            switch (issue.code) {
                case "unavailable_option":
                    errors.push(`${path}.${issue.field} selected unavailable option ${JSON.stringify(issue.value)}. Allowed values for action ${JSON.stringify(action.type)} are ${JSON.stringify(issue.allowedValues)}.`);
                    break;
                case "bulk_transfer_route_unavailable":
                    errors.push(`${path} selected unavailable bulk-transfer route ${JSON.stringify(issue.sourceInventoryId)} -> ${JSON.stringify(issue.targetInventoryId)}.`);
                    break;
                case "bulk_transfer_item_unavailable":
                    errors.push(`${path}.item_ids contains unavailable item(s) ${JSON.stringify(issue.itemIds)} for the selected bulk-transfer route.`);
                    break;
                case "hidden_location_target_unavailable":
                    errors.push(`${path}.target_id selected unavailable target ${JSON.stringify(issue.targetId)} for hidden location ${JSON.stringify(issue.locationId)}.`);
                    break;
                case "amount_exceeds_maximum":
                    errors.push(`${path}.amount exceeds currently available maximum ${issue.maximumAmount}.`);
                    break;
                case "equip_slot_unavailable":
                    errors.push(`${path}.slot selected unavailable option ${JSON.stringify(issue.slot)} for item ${JSON.stringify(issue.itemId)}.`);
                    break;
                case "item_input_required":
                    errors.push(`${path}.input_text is required for ${JSON.stringify(issue.actionLabel)}.`);
                    break;
                case "item_input_too_long":
                    errors.push(`${path}.input_text must not exceed ${issue.maximumLength} characters.`);
                    break;
                default:
                    throw new Error(`Unsupported action option issue ${String(issue.code)}.`);
            }
        });
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

    function validateDecisionDetailed(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext, validateAnticipationMaintenance) {
        const errors = decisionKeyErrors(value);
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
        const allowedSpokenTargetIds = Array.isArray(spokenTargetIds) ? spokenTargetIds.slice() : [];
        if (value.action && value.action.type === "move") {
            const moveDefinition = actionCatalog && actionCatalog.move;
            const moveOptions = moveDefinition && isPlainObject(moveDefinition.options) ? moveDefinition.options : {};
            const byDestination = isPlainObject(moveOptions.speech_targets_by_destination) ? moveOptions.speech_targets_by_destination : {};
            const destinationTargets = Array.isArray(byDestination[value.action.destination_id]) ? byDestination[value.action.destination_id] : [];
            destinationTargets.forEach(function (target) {
                if (target && typeof target.id === "string" && !allowedSpokenTargetIds.includes(target.id)) allowedSpokenTargetIds.push(target.id);
            });
        }
        if (value.spokenTargetId !== null && !allowedSpokenTargetIds.includes(value.spokenTargetId)) {
            errors.push(`response.spokenTargetId selected unavailable character ${JSON.stringify(value.spokenTargetId)}.`);
        }
        const loudnessValues = speechLoudnessValues();
        if (value.spokenText === null) {
            if (value.spokenLoudness !== null) errors.push("response.spokenLoudness must be null when spokenText is null.");
        } else if (!loudnessValues.includes(value.spokenLoudness)) {
            errors.push(`response.spokenLoudness must be one of ${loudnessValues.join(", ")} when spokenText is present.`);
        }
        if (value.spokenLoudness === "shout" && value.spokenTargetId !== null) {
            errors.push("response.spokenTargetId must be null when spokenLoudness is shout.");
        }
        if (value.spokenLoudness === "shout" && value.action && value.action.type === "move") {
            errors.push("response.spokenLoudness shout cannot be combined with move.");
        }
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates", existingBeliefIds, existingRelationships));
        if (value.intimateUpdates !== undefined) {
            const intimateBase = intimateBaseValidation(value.intimateUpdates, "response.intimateUpdates", intimateValidationContext);
            errors.push.apply(errors, intimateBase.errors);
            if (validateAnticipationMaintenance !== false) {
                errors.push.apply(errors, validateAnticipationReplacements(value.intimateUpdates, "response.intimateUpdates", intimateValidationContext));
            }
        }

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

    function validateDecision(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext) {
        return validateDecisionDetailed(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext, true);
    }

    function validateDecisionWithoutAnticipationMaintenance(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext) {
        return validateDecisionDetailed(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext, false);
    }

    function validateResult(value, existingBeliefIds, existingRelationships) {
        const errors = exactKeyErrors(value, RESULT_KEYS, "response");
        if (!isPlainObject(value)) return finishValidation(value, errors);
        errors.push.apply(errors, nullableTextErrors(value.publicNarrative, "response.publicNarrative"));
        errors.push.apply(errors, nullableTextErrors(value.spokenText, "response.spokenText"));
        errors.push.apply(errors, validateUpdatesDetailed(value.memoryUpdates, "response.memoryUpdates", existingBeliefIds, existingRelationships));
        return finishValidation(value, errors);
    }



    function baseSystem(stage) {
        const epistemic = "=== CANONICAL / FORMAL FACTS === Canonical state and validated formal engine events/results are mechanically authoritative. A supplied epistemic part marked formal_fact is grounded formal evidence. === EVENTS YOU DIRECTLY OBSERVED === A supplied direct_observation was actually visible/experienced by this character and may be remembered as witnessed story history for untracked details. It does not create or override tracked mechanical state; worldStateAuthority=\"narrative_only\" means no tracked world-state authority, not that the witnessed story event is automatically unreal. === SPEECH / TESTIMONY === A supplied heard_speech means the listed source character definitely uttered those words and this character heard them; own_speech means this character itself uttered them. The propositions inside speech are claims, not automatically objective facts. Preserve the actual source. Never silently turn testimony into firsthand memory, swap who told you, invent when or where an earlier conversation happened, or add absent episodic details merely to make the reply smooth. When asked whether you personally saw, heard, or were told something earlier, answer positively only when supplied context grounds that specific experience/source; otherwise preserve uncertainty or say you do not remember. A plausible reconstruction is still an inference and must be framed as such or omitted. Deliberate in-character deception remains allowed only when it is actually motivated; a lie does not become objective history merely because it was spoken.";
        const channelDiscipline = "OUTPUT CHANNEL DISCIPLINE: publicNarrative contains visible narration/behavior only. spokenText contains words actually spoken only. Never put *inline narration*, stage directions, gestures, or action descriptions inside spokenText; accompanying visible behavior belongs in publicNarrative. The framework does not infer state from prose.";
        const itemGrounding = "ITEM GROUNDING: context.worldAuthoredContext.groundedItemPolicy is binding authored world law defining semantic categories reserved to engine-owned item mechanics. Any concrete canonical item supplied by the engine is also grounded even when its broad category is not named there. Grounded items and categories are not narrative props: never invent an instance, assume possession, or narrate a mechanically meaningful creation, acquisition, transfer, placement, filling, consumption, equipment/trade/writing change, destruction, or other tracked mutation unless a supplied formal action/result actually grounds it. If a grounded item is absent from current inventory, accessible inventories, or available_actions, that means it is currently unavailable to manipulate; absence NEVER downgrades it into a narrative prop. Never reinterpret an already-grounded object as a prop merely to complete a continuation or natural multi-step workflow. Objects outside the authored grounded categories and not supplied as canonical items may be used as ordinary narrative props when they do not substitute for a grounded mechanic.";
        const antiEcho = "CONVERSATIONAL DISTINCTNESS: Do not merely restate, paraphrase, endorse, or revoice the immediately preceding speaker. When responding, contribute a distinct thought, question, disagreement, consequence, action, joke, concern, memory, or character-specific perspective. If there is nothing meaningful to add, prefer a genuine no-op/silence instead of filler. Repetition is appropriate only when it has a clear in-world function such as surprise, clarification, checking exact wording, quoting, deliberate emphasis, repeating an order, or misunderstanding.";
        if (stage !== "decision") {
            return "You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. " + epistemic + " " + channelDiscipline + " " + itemGrounding + " " + antiEcho + " Return exactly one JSON object and nothing else. Return exactly the keys publicNarrative, spokenText, and memoryUpdates. Do not choose another action; react only to the supplied grounded action result. memoryUpdates contains exactly relationshipsToUpsert and activatedBeliefIds. Relationships summarize durable current social state. " + RELATIONSHIP_SUMMARY_GUIDANCE + " Only include a relationship in relationshipsToUpsert when its summary materially changes; if the current relationship already says the same thing after normalization, omit that upsert. Unmentioned relationships remain unchanged automatically. activatedBeliefIds lists only supplied beliefs that were genuinely salient in this response; listing a belief raises activation but does not make it evidence or change confidence. Do not promote testimony to firsthand experience, invent its source/circumstances, or invent unsupported episodic details. " + setup.MindV3.MODEL_OUTPUT_EFFECT_INVARIANT + " " + setup.MindV3.BELIEF_SEMANTICS;
        }

        const loudness = speechLoudnessValues().map(function (value) { return JSON.stringify(value); }).join(" or ");
        const contract = `Return exactly the keys action, publicNarrative, spokenText, spokenTargetId, spokenLoudness, continuation, memoryUpdates, and intimateUpdates. action is null or exactly one action from context.view.available_actions using only currently offered option values. Available actions are capabilities, not recommendations: do not choose one merely because it exists. spokenTargetId is null or the id of one character currently listed in context.view.location.characters; when action.type is move it may also be one grounded character listed for that exact destination in context.view.available_actions.move.options.speech_targets_by_destination. spokenLoudness is per utterance, not persistent state: when spokenText is present it must be ${loudness}; when spokenText is null, spokenTargetId and spokenLoudness must both be null. A shout is stationary: spokenLoudness="shout" requires spokenTargetId=null and cannot be combined with action.type="move". memoryUpdates contains exactly relationshipsToUpsert and activatedBeliefIds. Do not author autobiographical memories, belief text, belief confidence, or belief deletion in an ordinary turn. activatedBeliefIds may contain only supplied belief IDs that actually influenced current interpretation/attention. intimateUpdates contains exactly enablePartnerIds, disablePartnerIds, and anticipationReplacements. Enable intimate mode only when this character judges the current relationship/scene explicitly romantic or otherwise intimate. Each active context is directional and target-specific. For already-active targets, anticipationReplacements may atomically replace the complete structured private motivation block; the engine does not parse narration to decide fulfillment. anticipationReplacements must be an array of objects in exactly this shape: ${ANTICIPATION_REPLACEMENT_SHAPE}. Never return a partner-keyed object, a bare array, or the legacy five-string anticipation shape. New enables list only partner IDs; their structured motivation is generated by a separate Character request after this decision.`;
        const state = "First understand the current situation. context.view is authoritative for what is publicly and operationally true now. Pending observations have already passed deterministic perception and delivery rules; if one was delivered, treat it as perceived and do not second-guess audibility or visibility from distance, loudness, posture, or room layout. context.recentDialogue is a short-lived record of recently spoken dialogue actually available to this character, including the character's own prior speech; use it for conversational continuity, not as objective physical world state, and do not copy routine lines into persistent memory merely because they appear there. Character IDs are persistent identities: the same character id is the same person after leaving and returning, so location changes do not reset familiarity, prior interaction, memories, beliefs, or relationships. A character absent from context.view.location.characters is not currently visible here. context.view and grounded engine results override stale conversational claims about location, possession, posture, or other physical facts. CANONICAL STATE PRECEDENCE: Do not treat your own or another character's speech, visible preparation, apparent intention, or prior narration as confirmation that a tracked action already happened; only the canonical view or grounded engine result confirms it. History records marked worldStateAuthority=\"narrative_only\" have no tracked world-state authority; when their epistemic source is direct_observation they may still represent true witnessed story history in an untracked domain. Never use narrative_only prose as proof that a tracked mechanic changed.";
        const decision = "Then decide whether there is a character-level reason to react or act. Directly addressed meaningful speech normally deserves an in-character response through dialogue, visible behavior, a formal action, or intentional silence; a completely empty no-op after direct address should be deliberate and character-driven, not accidental. Spontaneous initiative is valid: characters may work, prepare things, clean, watch people, investigate, move, joke, refuse, or otherwise act on their own. Keep initiative coherent with personality, duties, current observations, and existing intentions. Do not invent a task merely because an action is available. RELEVANT ENGINE MECHANICS: context.relevantMechanics describes mechanics grounded in the current scene or accessible items. A listed mechanic may still be unavailable right now because one or more prerequisites are missing. AVAILABLE ACTIONS RIGHT NOW: context.view.available_actions describes only what is possible right now and is the only executable-now formal-action contract. If an intended mechanic is relevant but absent from available_actions, look for a currently available prerequisite action that advances the same intention. FORMAL ACTION PRECEDENCE: if an intended tracked world-state change can be represented by a currently offered action in context.view.available_actions, use that formal action; publicNarrative may accompany it but must not substitute for it. If the character has adopted a concrete purpose and a currently available formal action clearly advances it, normally choose that action rather than only narrating or promising progress, unless personality or circumstances justify postponing, refusing, revising, or abandoning the purpose. Work one atomic grounded step at a time. For multi-step grounded goals, perform one currently available formal action and keep the unfinished purpose in continuation so later reactions can perform later grounded steps. EXTERNAL PREREQUISITE WAIT RULE: never assume another character has already completed their next tracked prerequisite. If your intended next step depends on another character first giving, moving, unlocking, placing, filling, transferring, or otherwise changing tracked state, and the current canonical view shows that prerequisite is not yet true, wait rather than narrating or acting as if it happened. Return action:null unless some other currently available action genuinely advances your goal. Choose the action type from its semantic description first, then choose every parameter only from that action's own current options. Never reuse an option value from a different action type. If no action is warranted, speech, a small visible reaction, or a genuine no-op may be natural.";
        const continuation = "continuation is your nullable, free-form, private working intention. It records an unfinished purpose, never an action queue or predetermined sequence, and the framework does not interpret it. continuation never overrides the current canonical view: before following it, re-check possession, item state, money, current location/position, visible characters, grounded results or failures, and any other mechanical facts it depends on. If those facts changed, adapt, recover, revise, abandon, or clear the purpose instead of narrating stale assumptions as true. If you choose an atomic action as one step toward a purpose that remains unfinished after this response, keep that purpose in continuation; do not start a purposive movement or task and immediately discard why you are doing it. A complete local action may leave continuation null. On every later reaction reevaluate the current view, available actions, new observations, engine-confirmed results or failures, priorities, and continuation. If a still-relevant continuation has an obvious available step and nothing more important overrides it, normally make progress rather than return an accidental no-op. Waiting for another character to satisfy a tracked prerequisite is a valid deliberate no-op: use action:null and keep the pending purpose in continuation, including what you are waiting for, until the canonical view confirms the prerequisite. For example, if another character has filled a mug and told you to take it but the mug is still in that character's possession, do not narrate taking it or leave to deliver it; wait until a formal give/transfer makes possession true. After failure, use the grounded feedback and do not blindly repeat the same action.";
        const speech = `Use spokenText for dialogue in the character's own voice. Choose spokenLoudness structurally for this utterance using ${loudness}; writing *whispers*, *in a low voice*, *shouts*, or similar prose does not change mechanical loudness. The framework owns who receives the resulting observation. "shout" has no addressee and is heard in the current location plus directly adjacent authored locations through the normal perception pipeline; it cannot accompany move. For ordinary move+speech, a destination addressee is allowed only when the move action's grounded speech_targets_by_destination lists that character for the selected destination. spokenTargetId and a formal-action target may differ. publicNarrative is brief visible behavior or atmosphere and is already narration. For AI output the channels are strict: spokenText contains spoken words only and MUST NOT contain paired-asterisk narration, gestures, stage directions, or other inline action prose; put accompanying visible behavior in publicNarrative. Human free-form RP may be normalized by a separate engine parser, but you must not imitate that mixed syntax in structured AI output. Small visible behavior that does not change canonical state may stay narrative, such as a glance, smile, sigh, gesture, wiping part of a counter, adjusting clothing, hesitation, or a small sip that does not mechanically consume the whole drink. Narrated behavior never mutates canonical state.`;
        const grounding = "A formal action in this response is only an attempt. The engine executes it after this response and later supplies a grounded result. EPISTEMIC GROUNDING: the character may lie deliberately, mislead, misunderstand, and draw wrong conclusions. But do not invent an unobserved event, statement, permission, intention, request, promise, belief, or other occurrence merely to make dialogue connect smoothly. Never convert another character's testimony into firsthand memory; never change \"Zlata told me\" into \"Dimka told me\" without supplied evidence; never invent when/where/from-whom an earlier conversation occurred; never add absent episodic details such as catching something, a struggle, a smell, a location, permission, a promise, or a prior conversation unless supplied evidence grounds them. If the character presents an unsupported claim as true, it must be a deliberate in-character deception with a concrete motivation; if it is an uncertain conclusion or plausible reconstruction, frame and remember it as an inference/uncertainty rather than an observed fact, or omit it. Narrative is never an alternate execution channel for canonical tracked state. Do not use publicNarrative or spokenText to establish taking, dropping, transferring, placing, filling, transforming, fully consuming an item, transferring money, moving between canonical locations or sublocations, equipping or unequipping an item, changing tracked passage state, sleeping state, or a formal ability/item result when the required state change has not been grounded by the engine. Never narrate a completed tracked state change merely because its formal action is currently unavailable. A relevant mechanic may require a prerequisite formal action first. Use one currently available prerequisite when it clearly advances the intention; otherwise do not claim the tracked result as completed. Cosmetic or untracked behavior may still be described narratively, such as a glance, smile, sigh, hesitation, scratching a beard, or other behavior that does not change canonical state. Before confirmation, publicNarrative, spokenText, beliefs, relationships, and memories may express intent, effort, preparation, or anticipation but must not claim that the formal action or a multi-step mechanical task successfully changed the world or is complete. A response performing one formal action must not narratively claim that a second grounded action also completed. Do not treat another character's speech, visible preparation, or apparent intention as confirmation that their next tracked action already happened; only the canonical view or grounded engine result confirms it. Do not record an unconfirmed mechanical completion in memory or belief. If narration and a later engine result disagree, the engine wins. Before output, silently verify the current view against continuation, verify that the chosen action type and every parameter come from the matching current action definition, and verify that narrative and memory updates do not jump ahead of grounded results. Do not output this verification or any hidden reasoning.";
        const memory = "Autobiographical memory and belief confidence are maintained by Mind v3 consolidation from committed experienced observations. Do not fabricate persistent memory updates inside an ordinary decision. Relationship updates may summarize genuinely changed social understanding. " + RELATIONSHIP_SUMMARY_GUIDANCE + " relationshipsToUpsert is delta-only: return a relationship only when its normalized summary actually changes. Do not echo an unchanged relationship merely because that person or relationship was relevant; unmentioned relationships remain unchanged automatically. activatedBeliefIds may mark beliefs that were actually salient.";
        const intimate = "context.intimateContexts contains only this character's private active adult-partner intimate contexts, keyed by partner. Each context has exactly one proactive impulse, two imaginedMoments, and two openAnticipations. impulse is character-owned near-term agency; imaginedMoments are desired possible scene-images, not guaranteed future facts or formal goals; openAnticipations are free-form hopes/curiosities/experiential possibilities. Use this private state as motivational context for initiative, not as a checklist and not as objective facts about the partner. You may semantically decide that parts were fulfilled, became irrelevant, or evolved and atomically replace that target's complete motivation block through intimateUpdates. When replacing it, do not merely generalize fulfilled concrete material into vaguer versions such as deepen trust/deepen connection/feel safe/ask what the partner wants; create concrete current possibilities that move the character's private initiative or imagination forward. Never infer or expose another character's private motivation. context.intimateEligiblePartnerIds lists the only partners that may be newly enabled this turn. Do not enable merely for ordinary friendship, friendliness, or casual conversation.";
        const style = "Treat the response as a moment in an ongoing role-playing scene. Let character description, mind state, relationships, continuation, and current situation shape the voice. Prefer concise, concrete, characterful behavior over generic assistant-like NPC replies. Do not force speech or narration into every response and do not repeat information just to make the response longer. Do not echo the immediately preceding speaker merely to signal agreement; add something character-specific and distinct, or remain intentionally silent when there is nothing meaningful to contribute.";
        const schema = 'memoryUpdates must always contain exactly relationshipsToUpsert and activatedBeliefIds, even when both are empty arrays. A relationship record is {"targetCharacterId":"character_id","summary":"..."}. activatedBeliefIds contains only IDs of beliefs supplied in context.mind.beliefs.';
        return `You control exactly the supplied character. Objective facts come only from supplied context and grounded engine results. Narrative cannot mutate the world. Return exactly one JSON object and nothing else: no markdown fence, prose, chain-of-thought, hidden reasoning, patches, or extra fields. ${contract} ${setup.MindV3.MODEL_OUTPUT_EFFECT_INVARIANT} ${epistemic} ${channelDiscipline} ${itemGrounding} ${antiEcho} ${state} ${decision} ${continuation} ${speech} ${grounding} ${memory} ${intimate} ${style} ${schema} ${setup.MindV3.BELIEF_SEMANTICS}`;
    }


    function requestPayloadFromMessages(messages) {
        if (!Array.isArray(messages)) return null;
        const user = messages.find(function (message) { return message && message.role === "user"; });
        if (!user || typeof user.content !== "string") return null;
        try {
            const parsed = JSON.parse(user.content);
            return isPlainObject(parsed) ? parsed : null;
        } catch (error) {
            return null;
        }
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



    function existingBeliefIdsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const records = context && context.mindContext && context.mindContext.beliefs || context && context.mind && context.mind.beliefs;
        return Array.isArray(records)
            ? records.map(function (belief) { return belief && belief.id; }).filter(function (id) { return typeof id === "string"; })
            : [];
    }

    function existingRelationshipsFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context;
        const records = context && context.mindContext && context.mindContext.relationships || context && context.mind && context.mind.relationships;
        return Array.isArray(records) ? clone(records) : [];
    }

    function intimateValidationContextFromMessages(messages) {
        const payload = requestPayloadFromMessages(messages);
        const context = payload && payload.context || {};
        const active = context.intimateContexts && typeof context.intimateContexts === "object" && !Array.isArray(context.intimateContexts)
            ? Object.keys(context.intimateContexts) : [];
        const eligible = Array.isArray(context.intimateEligiblePartnerIds) ? context.intimateEligiblePartnerIds.slice() : [];
        return { activePartnerIds: active, eligiblePartnerIds: eligible };
    }

    function decisionMessages(context) {
        return [{ role: "system", content: baseSystem("decision") }, { role: "user", content: JSON.stringify({
            stage: "decision",
            context: clone(context || {}),
            requiredResponseShape: { action: null, publicNarrative: null, spokenText: null, spokenTargetId: null, spokenLoudness: null, continuation: null, memoryUpdates: EMPTY_UPDATES, intimateUpdates: EMPTY_INTIMATE_UPDATES }
        }) }];
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
        const intimateGuidance = stage === "decision" && (errors || []).some(function (error) { return String(error).includes("response.intimateUpdates.anticipationReplacements"); })
            ? `\nINTIMATE MOTIVATION REPLACEMENT CONTRACT: anticipationReplacements must be an array of records in exactly this shape: ${ANTICIPATION_REPLACEMENT_SHAPE}. Each partnerId must reference an already-active intimate context. motivation must contain exactly one non-empty impulse, exactly two non-empty imaginedMoments, and exactly two non-empty openAnticipations. Do not return a partner-keyed object, a bare array, or the legacy five-string anticipation shape.`
            : "";
        return messages.concat([
            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
            { role: "user", content: `Your previous response failed validation:\n${errorList}${actionGuidance}${intimateGuidance}\nReturn the complete corrected ${stage} JSON object. If a relationship upsert has no material effect after normalization, remove it rather than inventing cosmetic wording. Include every required field, no extra fields, no prose, and no markdown fence.` }
        ]);
    }


    function parsedValueFromFailedStructuredResult(result) {
        const attempts = result && result.trace && Array.isArray(result.trace.attempts) ? result.trace.attempts : [];
        const last = attempts.length ? attempts[attempts.length - 1] : null;
        return last && isPlainObject(last.parsedValue) ? clone(last.parsedValue) : null;
    }

    function recoverableReplacementPartnerIds(updates) {
        if (!updates || typeof updates !== "object") return [];
        const value = updates.anticipationReplacements;
        if (Array.isArray(value)) {
            return Array.from(new Set(value.map(function (record) {
                return record && typeof record === "object" && !Array.isArray(record) && typeof record.partnerId === "string" ? record.partnerId : null;
            }).filter(Boolean)));
        }
        if (value && typeof value === "object") return Object.keys(value).filter(Boolean).slice(0, 5);
        return [];
    }

    function recoverDecisionAfterIntimateMaintenanceFailure(result, messages, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext) {
        if (!result || result.ok || !result.trace || result.trace.finalStatus !== "invalid_after_repair") return null;
        const candidate = parsedValueFromFailedStructuredResult(result);
        if (!candidate || !isPlainObject(candidate.intimateUpdates)) return null;
        const updates = candidate.intimateUpdates;
        // This hotfix is intentionally narrow: transitions remain strict. Only replacement of
        // an already-active intimate motivation block may degrade to a no-op after bounded repair fails.
        if (!Array.isArray(updates.enablePartnerIds) || updates.enablePartnerIds.length !== 0 ||
                !Array.isArray(updates.disablePartnerIds) || updates.disablePartnerIds.length !== 0) return null;
        const coreValidation = validateDecisionWithoutAnticipationMaintenance(candidate, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext);
        if (!coreValidation.ok) return null;
        const replacementErrors = validateAnticipationReplacements(updates, "response.intimateUpdates", intimateValidationContext);
        if (replacementErrors.length === 0) return null;
        const sanitized = clone(candidate);
        sanitized.intimateUpdates.anticipationReplacements = [];
        const finalValidation = validateDecision(sanitized, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext);
        if (!finalValidation.ok) return null;
        const payload = requestPayloadFromMessages(messages) || {};
        const context = payload.context || {};
        const fallback = {
            actorId: context.view && context.view.self && context.view.self.id || null,
            partnerIds: recoverableReplacementPartnerIds(updates),
            validationErrors: clone(replacementErrors),
            repairAttempted: Boolean(result.trace.attempts && result.trace.attempts.some(function (attempt) { return attempt && attempt.kind === "repair"; })),
            previousMotivationPreserved: true,
            ordinaryDecisionContinued: true
        };
        const trace = clone(result.trace);
        trace.originalFinalStatus = trace.finalStatus;
        trace.finalStatus = "valid_with_intimate_maintenance_fallback";
        trace.intimateMaintenanceFallback = clone(fallback);
        if (trace.safeError) {
            trace.originalSafeError = clone(trace.safeError);
            delete trace.safeError;
        }
        return {
            ok: true,
            value: sanitized,
            modelId: result.modelId || null,
            usage: result.usage || null,
            rawContent: result.rawContent || "",
            repaired: true,
            fallbackUsed: true,
            trace: trace,
            intimateMaintenanceFallback: fallback
        };
    }


    async function requestValidated(messages, stage, client) {
        const actionCatalog = actionCatalogFromMessages(messages);
        const spokenTargetIds = spokenTargetIdsFromMessages(messages);
        const existingBeliefIds = existingBeliefIdsFromMessages(messages);
        const existingRelationships = existingRelationshipsFromMessages(messages);
        const intimateValidationContext = intimateValidationContextFromMessages(messages);
        const validate = stage === "decision"
            ? function (value) { return validateDecision(value, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext); }
            : function (value) { return validateResult(value, existingBeliefIds, existingRelationships); };
        const result = await setup.StructuredAIRequest.run(client, {
            stage: stage,
            messages: clone(messages),
            validate: validate,
            maxRepairAttempts: 1,
            buildRepairMessages: function (baseMessages, responseContent, errors) {
                return buildRepairMessages(baseMessages, responseContent, stage, errors, actionCatalog);
            },
            validationErrorCode: "INVALID_MODEL_JSON",
            validationErrorMessage: "The model returned invalid JSON protocol data.",
            parseErrorCode: "INVALID_MODEL_JSON",
            parseErrorMessage: "The model returned invalid JSON protocol data.",
            traceMessages: true
        });
        if (stage !== "decision" || result.ok) return result;
        return recoverDecisionAfterIntimateMaintenanceFailure(result, messages, actionCatalog, spokenTargetIds, existingBeliefIds, existingRelationships, intimateValidationContext) || result;
    }

    setup.AIProtocol = {
        EMPTY_UPDATES: EMPTY_UPDATES,
        EMPTY_INTIMATE_UPDATES: EMPTY_INTIMATE_UPDATES,
        extractObject: extractObject,
        validateDecision: validateDecision,
        validateDecisionWithoutAnticipationMaintenance: validateDecisionWithoutAnticipationMaintenance,
        validateAnticipationReplacements: validateAnticipationReplacements,
        ANTICIPATION_REPLACEMENT_SHAPE: ANTICIPATION_REPLACEMENT_SHAPE,
        validateResult: validateResult,
        actionCatalogFromMessages: actionCatalogFromMessages,
        spokenTargetIdsFromMessages: spokenTargetIdsFromMessages,
        existingBeliefIdsFromMessages: existingBeliefIdsFromMessages,
        existingRelationshipsFromMessages: existingRelationshipsFromMessages,
        intimateValidationContextFromMessages: intimateValidationContextFromMessages,
        decisionMessages: decisionMessages,
        resultMessages: resultMessages,
        buildRepairMessages: buildRepairMessages,
        requestValidated: requestValidated
    };
}());
