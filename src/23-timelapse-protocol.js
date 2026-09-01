(function () {
    "use strict";

    const DEFAULT_MODE = "timelapse";
    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }
    function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
    function exactKeys(value, allowed) {
        return isObject(value) && Object.keys(value).every(function (key) { return allowed.includes(key); }) &&
            allowed.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
    }
    function locationName(locationId) {
        const location = setup.Game.getWorld().entities[locationId];
        return location && location.name || locationId;
    }

    function structuralError(code, message, details) {
        const error = { code: code, message: message };
        if (details && details.length) error.details = clone(details);
        return error;
    }

    async function requestStructured(spec) {
        const baseMessages = clone(spec.messages || []);
        const execute = setup.AIRequestExecutor.executeCustomConcurrent || setup.AIRequestExecutor.executeCustom;
        const requestOptions = clone(spec.requestOptions || setup.AIRequestProfiles.resolve(spec.profile || "timelapse-plan", { actorId: spec.actorId || null }));
        return execute({
            actorId: spec.actorId || null,
            purpose: spec.purpose,
            stage: spec.stage,
            messages: baseMessages,
            requestOptions: requestOptions,
            client: spec.client || setup.OpenRouterClient,
            run: function (policyClient) {
                return setup.StructuredAIRequest.run(policyClient, {
                    stage: spec.stage,
                    messages: baseMessages,
                    requestOptions: requestOptions,
                    validate: spec.validate,
                    contract: String(spec.contract || "Return the exact JSON contract from the original request."),
                    maxRepairAttempts: 1,
                    retryOnTruncation: true,
                    maxTruncationRetries: 1,
                    onTruncationRetryOptions: function (current) {
                        return Object.assign({}, current || {}, { reasoningMaxTokens: 0, reasoningEffort: "none" });
                    },
                    parseErrorCode: "MODEL_JSON_PARSE_FAILED",
                    parseErrorMessage: "The model returned malformed JSON for the timelapse protocol.",
                    validationErrorCode: "MODEL_PROTOCOL_INVALID",
                    validationErrorMessage: "The model returned JSON that failed timelapse protocol validation.",
                    traceMessages: true,
                    buildRepairMessages: function (messages, responseContent, errors) {
                        const contract = String(spec.contract || "Return the exact JSON contract from the original request.");
                        return clone(messages).concat([
                            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
                            { role: "user", content: `Your previous response failed validation:
${errors.map(function (error) { return `- ${error}`; }).join("\n")}
Canonical response contract:
${contract}
Return the complete corrected JSON object only. Use exactly the documented field names. No markdown or extra prose.` }
                        ]);
                    }
                });
            }
        });
    }


    function catalogIndex(catalog) {
        const map = new Map();
        (catalog || []).forEach(function (location) { map.set(location.id, location); });
        return map;
    }

    function isDaytimeMode(mode) {
        return String(mode || DEFAULT_MODE) === "daytime";
    }

    function catalogForMode(catalog, mode) {
        const output = clone(catalog || []);
        if (!isDaytimeMode(mode)) return output;
        output.forEach(function (location) {
            location.beds = [];
        });
        return output;
    }

    function validateStep(step, locationMap, path, mode) {
        const errors = [];
        if (!exactKeys(step, ["locationId", "action"])) return [`${path} must contain exactly locationId and action.`];
        const location = locationMap.get(step.locationId);
        if (!location) return [`${path}.locationId must be one of the supplied reachable locations.`];
        const action = step.action;
        if (!isObject(action) || typeof action.type !== "string") return [`${path}.action must be one action object.`];
        if (action.type === "narrate") {
            if (!exactKeys(action, ["type", "text"])) errors.push(`${path}.action narrate must contain exactly type and text.`);
            if (typeof action.text !== "string" || !action.text.trim() || action.text.trim().length > 2000) {
                errors.push(`${path}.action.text must contain 1 to 2000 characters.`);
            }
        } else if (action.type === "sleep") {
            if (isDaytimeMode(mode)) {
                errors.push(`${path}.action.type sleep is not allowed during daytime timelapse.`);
            } else {
                if (!exactKeys(action, ["type", "bedId"])) errors.push(`${path}.action sleep must contain exactly type and bedId.`);
                if (!(location.beds || []).some(function (bed) { return bed.id === action.bedId; })) {
                    errors.push(`${path}.action.bedId must identify a supplied bed in the selected room.`);
                }
            }
        } else if (action.type === "timelapse_action") {
            if (!exactKeys(action, ["type", "actionId"])) errors.push(`${path}.action timelapse_action must contain exactly type and actionId.`);
            if (!(location.timelapseActions || []).some(function (candidate) { return candidate.id === action.actionId; })) {
                errors.push(`${path}.action.actionId must identify an authored action in the selected room.`);
            }
        } else if (action.type === "study_item") {
            if (!exactKeys(action, ["type", "itemId", "inputText"])) errors.push(`${path}.action study_item must contain exactly type, itemId, and inputText.`);
            const option = (location.studyItems || []).find(function (candidate) { return candidate.id === action.itemId; });
            if (!option) errors.push(`${path}.action.itemId must identify an accessible study item in the selected room.`);
            const text = typeof action.inputText === "string" ? action.inputText.trim() : "";
            const maxLength = option && Number.isInteger(option.inputMaxLength) ? option.inputMaxLength : 600;
            if (!text || text.length > maxLength) errors.push(`${path}.action.inputText must contain 1 to ${maxLength} characters.`);
        } else {
            errors.push(isDaytimeMode(mode)
                ? `${path}.action.type must be narrate, timelapse_action, or study_item during daytime timelapse.`
                : `${path}.action.type must be narrate, sleep, timelapse_action, or study_item.`);
        }
        return errors;
    }

    function validatePlan(value, catalog, remainingRounds, mode) {
        const errors = [];
        if (!exactKeys(value, ["steps"]) || !Array.isArray(value.steps)) {
            return { ok: false, errors: ["response must contain exactly a steps array."] };
        }
        if (value.steps.length < 1 || value.steps.length > remainingRounds) {
            errors.push(`response.steps must contain from 1 to ${remainingRounds} steps.`);
        }
        const locations = catalogIndex(catalog);
        value.steps.forEach(function (step, index) {
            errors.push.apply(errors, validateStep(step, locations, `response.steps[${index}]`, mode));
        });
        const sleepIndex = value.steps.findIndex(function (step) { return step && step.action && step.action.type === "sleep"; });
        if (isDaytimeMode(mode)) {
            if (value.steps.length !== remainingRounds) {
                errors.push(`a daytime plan must provide exactly ${remainingRounds} steps.`);
            }
        } else {
            if (sleepIndex >= 0 && sleepIndex !== value.steps.length - 1) {
                errors.push("sleep must be the last supplied plan step and no step may follow it.");
            }
            if (sleepIndex < 0 && value.steps.length !== remainingRounds) {
                errors.push(`a plan without sleep must provide exactly ${remainingRounds} steps.`);
            }
        }
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function planContract(mode) {
        const steps = [
            { locationId: "reachable_location_id", action: { type: "narrate", text: "third-person world narration of what the character does during this round" } },
            { locationId: "reachable_location_id", action: { type: "timelapse_action", actionId: "authored_timelapse_action_id" } },
            { locationId: "reachable_location_id", action: { type: "study_item", itemId: "accessible_study_item_id", inputText: "specific subject or question" } }
        ];
        if (!isDaytimeMode(mode)) {
            steps.splice(1, 0, { locationId: "reachable_location_id", action: { type: "sleep", bedId: "concrete_bed_id" } });
        }
        return JSON.stringify({ steps: steps });
    }

    function temporalDiscipline(mode) {
        const daytime = isDaytimeMode(mode);
        const currentPhase = daytime ? "Day" : "Night";
        const nextPhase = daytime ? "Evening" : "Morning";
        return {
            currentPhase: currentPhase,
            nextPhase: nextPhase,
            text: `AUTHORITATIVE TIME PHASE: ${currentPhase}. The deterministic engine will transition to ${nextPhase} only after all timelapse rounds and established boundary processing finish. You must not perform or narrate that phase transition yourself. Every planned or resolved event in these rounds still occurs during ${currentPhase}. You may anticipate or prepare for ${nextPhase} prospectively, but you must not describe it as already begun. Treat rounds as portions of one continuous abstract ${currentPhase.toLowerCase()} span, not independent mini-days: do not reset the implied clock between rounds, repeatedly wake up or start/end a workday, independently invent sunrise/sunset, or use a later round number as permission to enter ${nextPhase}.`
        };
    }

    function plannerSystem(mode) {
        const daytime = isDaytimeMode(mode);
        const temporal = temporalDiscipline(mode);
        const actionRule = daytime
            ? "Allowed action JSON variants are exactly: narrate = {\"type\":\"narrate\",\"text\":\"...\"}; authored macro = {\"type\":\"timelapse_action\",\"actionId\":\"supplied_action_id\"}; study = {\"type\":\"study_item\",\"itemId\":\"supplied_study_item_id\",\"inputText\":\"specific subject or question\"}. Sleep is not a valid daytime action."
            : "Allowed action JSON variants are exactly: narrate = {\"type\":\"narrate\",\"text\":\"...\"}; sleep = {\"type\":\"sleep\",\"bedId\":\"supplied_bed_id\"}; authored macro = {\"type\":\"timelapse_action\",\"actionId\":\"supplied_action_id\"}; study = {\"type\":\"study_item\",\"itemId\":\"supplied_study_item_id\",\"inputText\":\"specific subject or question\"}.";
        const lengthRule = daytime
            ? "Provide exactly one step for every remaining daytime round. Do not end the plan early by sleeping."
            : "A plan without sleep must contain exactly one step for every remaining round. A sleep step may end the plan early; if present it must be the final returned step and there are no steps after it.";
        return [
            `You are planning coarse activity for exactly one RPG character during a timelapse. The current mode is ${String(mode || DEFAULT_MODE)}.`,
            "This is not an ordinary world-tick turn. The timelapse has a small fixed number of abstract rounds.",
            temporal.text,
            "For each active planned round choose one supplied reachable location and one activity there. Canonical movement between named locations is owned by the engine and occurs outside narration. Travel to the selected location is implicit and consumes no extra round. narrate.text for a round describes activity only at that round's selected locationId: never narrate departing toward, walking/travelling to, entering, arriving at, or already moving into another canonical location. If the next round is elsewhere, leave that movement entirely to the engine.",
            actionRule,
            lengthRule,
            "There is no null, pass, ordinary move, or ordinary world-tick formal action in this protocol.",
            "narrate is committed public world narration, not a canonical state mutation channel. Write narrate.text in third person using the acting character's visible name from the supplied grounded context; do not use narratorial I, you, or we for the acting character. Quoted character dialogue may use ordinary first- or second-person pronouns. narrate must not move tracked items, money, keys, locks, doors, ownership, location, sublocation, sleeping state, item state, or deterministic world flags. Do not say a tracked item was put down, transferred, consumed, filled, locked, unlocked, or otherwise changed unless a supplied authored timelapse action performs that exact effect.",
            "Allowed narrate activity is local story texture that does not require an unsupplied tracked contract: thinking, praying, stretching, resting while awake, watching, conversation, tending untracked background details, or cosmetic cleaning/polishing without changing inventory state. If an intended activity requires a tracked mechanic and no supplied timelapse_action, study_item, sleep, or other formal contract can perform it here, choose a different narratable local activity instead of simulating the missing tracked action in prose. Tracked domains include item/container transfer or placement, locks/passage state, writable content/writing, filling/transforming/consuming tracked items, money, equipment, canonical location/sublocation movement, sleeping, and other supplied formal abilities/actions.",
            "Use an authored timelapse action when a supplied deterministic macro exactly matches the intended tracked-state activity.",
            "Use study_item when an accessible study item is supplied in the selected room and the character chooses to study it. Carried study items may appear in every reachable room; room study items appear only where physically accessible. The engine, not narration, advances study progress.",
            "Current canonical state in context.view is authoritative if any older compressed fact appears inconsistent with it.",
            "Plans are intentions and may later be replaced after an actual interaction or grounded failure.",
            `Return exactly one JSON object matching this union contract and nothing else: ${planContract(mode)}`,
            "The action examples demonstrate alternative union branches; do not include every branch unless the plan genuinely uses it. No markdown, commentary, or hidden reasoning."
        ].join(" ");
    }

    function compactFacts(facts) {
        const seen = new Set();
        const output = [];
        (facts || []).forEach(function (fact) {
            const text = String(fact || "").trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            output.push(text);
        });
        return output.slice(-24);
    }

    function compactPrivateContext(characterId, pendingObservations) {
        const context = setup.CharacterContext.buildMaintenance(characterId, { pendingObservations: pendingObservations || [] });
        if (context && context.ok !== false && setup.MindV3) context.beliefSemantics = setup.MindV3.BELIEF_SEMANTICS;
        return context;
    }

    async function requestPlan(characterId, startRound, remainingRounds, facts, latestEncounter, latestFailure, client, mode) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        const rawCatalog = setup.TimelapseAPI.getReachableCatalog(characterId);
        if (!Array.isArray(rawCatalog)) return rawCatalog;
        const catalog = catalogForMode(rawCatalog, mode);
        const pending = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
            ? clone(actor.mind.pendingObservations)
            : [];
        const context = compactPrivateContext(characterId, pending);
        if (!context || context.ok === false) return context;
        context.timelapse = {
            mode: mode || DEFAULT_MODE,
            authoritativeTimePhase: temporalDiscipline(mode).currentPhase,
            nextTimePhase: temporalDiscipline(mode).nextPhase,
            startRound: startRound,
            remainingRounds: remainingRounds,
            reachableLocations: clone(catalog),
            committedFacts: compactFacts(facts),
            latestEncounterResume: latestEncounter || null,
            latestFailure: latestFailure || null,
            endRoutineAnchor: isDaytimeMode(mode) && actor && actor.routineAnchors && actor.routineAnchors.evening
                ? clone(actor.routineAnchors.evening)
                : null
        };
        const stage = startRound === 1 ? "timelapse-plan" : "timelapse-replan";
        const messages = [
            { role: "system", content: plannerSystem(mode || DEFAULT_MODE) },
            { role: "user", content: JSON.stringify({
                stage: stage,
                context: context,
                requiredResponseContract: {
                    steps: isDaytimeMode(mode) ? [
                        { locationId: "reachable_location_id", action: { type: "narrate", text: "non-empty third-person world narration" } },
                        { locationId: "reachable_location_id", action: { type: "timelapse_action", actionId: "concrete supplied authored action id" } },
                        { locationId: "reachable_location_id", action: { type: "study_item", itemId: "concrete supplied study item id", inputText: "specific study subject" } }
                    ] : [
                        { locationId: "reachable_location_id", action: { type: "narrate", text: "non-empty third-person world narration" } },
                        { locationId: "reachable_location_id", action: { type: "sleep", bedId: "concrete supplied bed id" } },
                        { locationId: "reachable_location_id", action: { type: "timelapse_action", actionId: "concrete supplied authored action id" } },
                        { locationId: "reachable_location_id", action: { type: "study_item", itemId: "concrete supplied study item id", inputText: "specific study subject" } }
                    ],
                    rules: isDaytimeMode(mode)
                        ? ["action variants are a union", "sleep is forbidden during daytime", "steps.length must equal remainingRounds", "all rounds remain in the authoritative Day phase until the engine transition", "narrate text uses third-person world narration"]
                        : ["action variants are a union", "sleep may end the plan early and must be final", "without sleep steps.length must equal remainingRounds", "all rounds remain in the authoritative Night phase until the engine transition to Morning", "narrate text uses third-person world narration"]
                }
            }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: stage,
            stage: stage,
            messages: messages,
            contract: planContract(mode),
            profile: stage,
            requestOptions: setup.AIRequestProfiles.resolve(stage, { actorId: characterId }),
            client: client,
            validate: function (value) { return validatePlan(value, catalog, remainingRounds, mode); }
        });
    }

    function validateIntent(value) {
        const errors = [];
        if (!exactKeys(value, ["engage", "intent"])) {
            return { ok: false, errors: ["response must contain exactly engage and intent."] };
        }
        if (typeof value.engage !== "boolean") errors.push("response.engage must be Boolean.");
        if (typeof value.intent !== "string" || !value.intent.trim() || value.intent.trim().length > 1200) {
            errors.push("response.intent must contain 1 to 1200 characters.");
        }
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: { engage: value.engage, intent: value.intent.trim() } };
    }

    async function requestInteractionIntent(characterId, round, locationId, ownActivity, otherActivities, facts, client, mode) {
        const context = compactPrivateContext(characterId, []);
        if (!context || context.ok === false) return context;
        const temporal = temporalDiscipline(mode);
        context.timelapseEncounter = {
            mode: mode || DEFAULT_MODE,
            authoritativeTimePhase: temporal.currentPhase,
            nextTimePhase: temporal.nextPhase,
            round: round,
            location: { id: locationId, name: locationName(locationId) },
            ownActivity: ownActivity,
            otherCharacters: clone(otherActivities),
            previousCommittedTimelapseFacts: compactFacts(facts)
        };
        const contract = '{"engage":true|false,"intent":"brief private social intention"}';
        const messages = [
            { role: "system", content: `You control exactly one character during a compressed timelapse encounter. Decide only this character's private social intent. Return exactly ${contract}. ${temporal.text} Set engage=false when the character deliberately keeps to themself and simply continues their own activity. otherCharacters may include occupiedNonInteractive=true; such a person is visibly present but busy and will not answer or take interactive actions during this timelapse, so do not choose engagement solely to demand a response from them. If engage=true, intent may briefly state the topic, question, tone, information to reveal or avoid, notable statement, or desire to disengage. Do not write dialogue, do not decide what other characters do, and do not claim that any future movement, sleep, item transfer, money transfer, lock action, or other canonical action has happened. This intent is private planning input, not a committed fact. No markdown or extra fields.` },
            { role: "user", content: JSON.stringify({ stage: "timelapse-interaction-intent", context: context, requiredResponseContract: { engage: false, intent: "Keep to myself and continue my own activity." } }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: "timelapse-interaction-intent",
            stage: "timelapse-interaction-intent",
            messages: messages,
            contract: contract,
            profile: "timelapse-intent",
            requestOptions: setup.AIRequestProfiles.resolve("timelapse-intent", { actorId: characterId }),
            client: client,
            validate: validateIntent
        });
    }

    function validateResume(value) {
        const errors = [];
        if (!exactKeys(value, ["interactionOccurred", "interactionResume"])) {
            return { ok: false, errors: ["response must contain exactly interactionOccurred and interactionResume."] };
        }
        if (typeof value.interactionOccurred !== "boolean") errors.push("response.interactionOccurred must be Boolean.");
        if (typeof value.interactionResume !== "string" || value.interactionResume.length > 3000) {
            errors.push("response.interactionResume must be a string up to 3000 characters.");
        } else if (value.interactionOccurred && !value.interactionResume.trim()) {
            errors.push("interactionResume must be non-empty when interactionOccurred is true.");
        } else if (!value.interactionOccurred && value.interactionResume.trim()) {
            errors.push("interactionResume must be empty when interactionOccurred is false.");
        }
        return errors.length ? { ok: false, errors: errors } : {
            ok: true,
            value: { interactionOccurred: value.interactionOccurred, interactionResume: value.interactionResume.trim() }
        };
    }

    async function requestInteractionResume(round, locationId, participants, activities, intents, publicFacts, client, mode, passiveParticipants) {
        const observerId = participants && participants[0] && participants[0].id;
        const observerView = observerId ? setup.CharacterAPI.getView(observerId) : null;
        const publicRoomContext = observerView && observerView.location && observerView.location.id === locationId
            ? clone(observerView.location)
            : { id: locationId, name: locationName(locationId) };
        const contract = '{"interactionOccurred":true|false,"interactionResume":"compressed public summary, or empty string when false"}';
        const temporal = temporalDiscipline(mode);
        const messages = [
            { role: "system", content: `Resolve one compressed group encounter during a timelapse. You receive public/observable room context, each active participant's private declared interaction intent, and possibly passiveParticipants who are visibly present but occupied and non-interactive. Passive participants do not speak, answer, or take actions in this encounter. Return exactly ${contract}. ${temporal.text} Summarize only the social exchange that actually occurs now: who engages or declines, topics discussed, questions asked or answered, statements actually made, information actually revealed, public tone, and whether someone verbally ends the conversation. An intent about what somebody plans to do afterward is not a completed fact. Never turn 'I will go upstairs', 'I will sleep', 'I will clean', or similar future intent into movement, sleeping, cleaning, item/money transfer, lock/door change, or any other canonical world mutation. You cannot execute formal actions. If no actual social exchange occurs, set interactionOccurred=false and interactionResume to the empty string. Do not invent private motives or knowledge absent from supplied intents. Do not write a line-by-line transcript. No markdown or extra fields.` },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-interaction-resolver",
                context: {
                    mode: mode || DEFAULT_MODE,
                    authoritativeTimePhase: temporal.currentPhase,
                    nextTimePhase: temporal.nextPhase,
                    round: round,
                    location: publicRoomContext,
                    participants: clone(participants),
                    observableActivities: clone(activities),
                    interactionIntents: clone(intents),
                    passiveParticipants: clone(passiveParticipants || []),
                    previousPublicTimelapseFacts: compactFacts(publicFacts)
                },
                requiredResponseContract: { interactionOccurred: true, interactionResume: "what actually happened socially in this encounter" }
            }) }
        ];
        return requestStructured({
            actorId: null,
            purpose: "timelapse-interaction-resolver",
            stage: "timelapse-interaction-resolver",
            messages: messages,
            contract: contract,
            profile: "timelapse-resolver",
            requestOptions: setup.AIRequestProfiles.resolve("timelapse-resolver", { actorId: null }),
            client: client,
            validate: validateResume
        });
    }

    function validateMemoryUpdates(value, allowedRelationshipTargetIds, existingRelationships, existingBeliefIds) {
        if (!exactKeys(value, ["memoryUpdates"]) || !isObject(value.memoryUpdates)) {
            return { ok: false, errors: ["response must contain exactly memoryUpdates."] };
        }
        const updates = value.memoryUpdates;
        if (!exactKeys(updates, ["relationshipsToUpsert", "activatedBeliefIds"])) {
            return { ok: false, errors: ["memoryUpdates must contain exactly relationshipsToUpsert and activatedBeliefIds."] };
        }
        if (!Array.isArray(updates.relationshipsToUpsert) || !Array.isArray(updates.activatedBeliefIds)) {
            return { ok: false, errors: ["all memoryUpdates fields must be arrays."] };
        }
        if (updates.relationshipsToUpsert.length > 5 || updates.activatedBeliefIds.length > 10) {
            return { ok: false, errors: ["reflection update arrays exceed their bounded limits."] };
        }
        const standardValidation = setup.AIProtocol.validateResult({
            publicNarrative: null,
            spokenText: null,
            memoryUpdates: updates
        }, existingBeliefIds, existingRelationships);
        if (!standardValidation.ok) return { ok: false, errors: standardValidation.errors || [standardValidation.message] };
        if (allowedRelationshipTargetIds instanceof Set) {
            const invalidTargets = updates.relationshipsToUpsert.map(function (record) { return record && record.targetCharacterId; }).filter(function (id) {
                return typeof id !== "string" || !allowedRelationshipTargetIds.has(id);
            });
            if (invalidTargets.length) {
                return {
                    ok: false,
                    errors: [`relationship target IDs must use canonical IDs supplied in grounded context. Invalid: ${invalidTargets.map(String).join(", ")}. Allowed: ${Array.from(allowedRelationshipTargetIds).join(", ") || "none"}.`]
                };
            }
        }
        return { ok: true, value: value };
    }

    function reflectionAllowedRelationshipTargets(characterId, context) {
        const ids = new Set();
        const nearby = context && context.view && context.view.location && context.view.location.characters;
        (Array.isArray(nearby) ? nearby : []).forEach(function (character) {
            if (character && typeof character.id === "string" && character.id && character.id !== characterId) ids.add(character.id);
        });
        const relationships = context && context.mind && context.mind.relationships;
        (Array.isArray(relationships) ? relationships : []).forEach(function (record) {
            if (record && typeof record.targetCharacterId === "string" && record.targetCharacterId && record.targetCharacterId !== characterId) ids.add(record.targetCharacterId);
        });
        const dialogue = context && context.recentDialogue;
        (Array.isArray(dialogue) ? dialogue : []).forEach(function (record) {
            if (record && typeof record.speakerId === "string" && record.speakerId && record.speakerId !== characterId) ids.add(record.speakerId);
        });
        return ids;
    }

    function salvageReflectionAfterFailedRepair(result, allowedRelationshipTargetIds, existingRelationships, existingBeliefIds) {
        const attempts = result && result.trace && Array.isArray(result.trace.attempts) ? result.trace.attempts : [];
        const parsed = attempts.slice().reverse().map(function (attempt) { return attempt && attempt.parsedValue; }).find(function (value) { return isObject(value); });
        if (!parsed) return null;
        const relaxed = validateMemoryUpdates(parsed, null, existingRelationships, existingBeliefIds);
        if (!relaxed.ok) return null;
        const value = clone(relaxed.value);
        const relationships = value.memoryUpdates.relationshipsToUpsert;
        const kept = relationships.filter(function (record) {
            return record && typeof record.targetCharacterId === "string" && allowedRelationshipTargetIds.has(record.targetCharacterId);
        });
        if (kept.length === relationships.length) return null;
        const dropped = relationships.filter(function (record) {
            return !record || typeof record.targetCharacterId !== "string" || !allowedRelationshipTargetIds.has(record.targetCharacterId);
        }).map(function (record) { return record && record.targetCharacterId || null; });
        value.memoryUpdates.relationshipsToUpsert = kept;
        return {
            ok: true,
            value: value,
            repaired: false,
            partial: true,
            droppedRelationshipTargetIds: dropped,
            trace: result.trace || null
        };
    }

    function reflectionContract() {
        return JSON.stringify({ memoryUpdates: { relationshipsToUpsert: [], activatedBeliefIds: [] } });
    }

    async function requestReflection(characterId, facts, client, mode) {
        const context = compactPrivateContext(characterId, []);
        if (!context || context.ok === false) return context;
        context.completedTimelapse = { mode: mode || DEFAULT_MODE, committedFacts: compactFacts(facts) };
        const allowedRelationshipTargetIds = reflectionAllowedRelationshipTargets(characterId, context);
        const existingRelationships = context && context.mind && Array.isArray(context.mind.relationships) ? clone(context.mind.relationships) : [];
        const existingBeliefIds = context && context.mind && Array.isArray(context.mind.beliefs) ? context.mind.beliefs.map(function (belief) { return belief.id; }) : [];
        const messages = [
            { role: "system", content: `You are giving exactly one RPG character a private post-timelapse reflection after supplied actual events have completed. You cannot act in the world and you do not directly write autobiographical memory or belief text/confidence. Mind v3 derives those separately from committed experience. ${setup.MindV3 ? setup.MindV3.MODEL_OUTPUT_EFFECT_INVARIANT : ""} You may update only relationship summaries that meaningfully changed and report which existing beliefs became materially salient because of NEW events in this completed timelapse. FRESH-ACTIVATION CONTRACT: reading, recalling, or merely seeing an existing belief in the supplied belief table is NOT activation evidence. Compatibility between an existing belief and supplied context is NOT fresh salience. Do NOT iterate through the belief table looking for beliefs that fit the events. activatedBeliefIds must be sparse and event-driven: include only supplied belief IDs that the new timelapse events actually brought into focus or materially engaged during this reflection. It is valid and often preferable for activatedBeliefIds to be empty. relationshipsToUpsert is delta-only: if a supplied current relationship summary would remain materially unchanged after normalization, omit that relationship entirely. A relationship summary is a self-contained CURRENT summary of durable facts that materially define the relationship: current type/status, durable trust/fear/affection/resentment, standing arrangements such as living together or ongoing work, enduring obligations/invitations/promises, and important standing boundaries when relevant. Update it when either the relationship itself OR one of those durable standing facts materially changes. Do not turn it into a chronological event log. Do not echo a relationship merely because it remained important or relevant; unmentioned relationships remain unchanged automatically. Ground relationship targetCharacterId in supplied canonical IDs, never an invented display-name ID. Preserve epistemic provenance and do not invent physical events, permissions, statements, intentions, or mechanical results. Return exactly one object with the single key memoryUpdates. memoryUpdates must contain exactly relationshipsToUpsert and activatedBeliefIds. A relationship record is {"targetCharacterId":"character_id","summary":"..."}. activatedBeliefIds may contain only existing supplied belief IDs. Example empty response: ${reflectionContract()}. ${setup.MindV3 ? setup.MindV3.BELIEF_SEMANTICS : ""} No markdown, commentary, hidden reasoning, or extra fields.` },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-reflection",
                context: context,
                canonicalRelationshipTargetIds: Array.from(allowedRelationshipTargetIds),
                requiredResponseContract: { memoryUpdates: { relationshipsToUpsert: [], activatedBeliefIds: [] } }
            }) }
        ];
        const result = await requestStructured({
            actorId: characterId,
            purpose: "timelapse-reflection",
            stage: "timelapse-reflection",
            messages: messages,
            contract: reflectionContract(),
            profile: "reflection",
            requestOptions: setup.AIRequestProfiles.resolve("reflection", { actorId: characterId }),
            client: client,
            validate: function (value) { return validateMemoryUpdates(value, allowedRelationshipTargetIds, existingRelationships, existingBeliefIds); }
        });
        if (result && result.ok) return result;
        return salvageReflectionAfterFailedRepair(result, allowedRelationshipTargetIds, existingRelationships, existingBeliefIds) || result;
    }


    setup.TimelapseProtocol = {
        requestStructured: requestStructured,
        validateStep: validateStep,
        validatePlan: validatePlan,
        planContract: planContract,
        temporalDiscipline: temporalDiscipline,
        plannerSystem: plannerSystem,
        catalogForMode: catalogForMode,
        compactFacts: compactFacts,
        requestPlan: requestPlan,
        validateIntent: validateIntent,
        requestInteractionIntent: requestInteractionIntent,
        validateResume: validateResume,
        requestInteractionResume: requestInteractionResume,
        validateMemoryUpdates: validateMemoryUpdates,
        reflectionAllowedRelationshipTargets: reflectionAllowedRelationshipTargets,
        requestReflection: requestReflection
    };
}());
