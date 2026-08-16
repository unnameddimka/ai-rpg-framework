(function () {
    "use strict";

    const DEFAULT_MODE = "timelapse";
    const DEFAULT_ROUND_COUNT = 1;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }

    function isObject(value) {
        return value && typeof value === "object" && !Array.isArray(value);
    }

    function exactKeys(value, allowed) {
        return isObject(value) && Object.keys(value).every(function (key) { return allowed.includes(key); }) &&
            allowed.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
    }

    function parseObject(content) {
        return setup.AIProtocol.extractObject(content);
    }

    function structuralError(code, message, details) {
        const error = { code: code, message: message };
        if (details && details.length) error.details = clone(details);
        return error;
    }

    async function requestStructured(spec) {
        const baseMessages = clone(spec.messages || []);
        const execute = setup.AIRequestExecutor.executeCustomConcurrent || setup.AIRequestExecutor.executeCustom;
        return execute({
            actorId: spec.actorId || null,
            purpose: spec.purpose,
            stage: spec.stage,
            messages: baseMessages,
            requestOptions: clone(spec.requestOptions || setup.AIRequestProfiles.resolve(spec.profile || "timelapse-plan", { actorId: spec.actorId || null })),
            client: spec.client || setup.OpenRouterClient,
            run: async function (policyClient) {
                let currentMessages = clone(baseMessages);
                let requestOptions = clone(spec.requestOptions || setup.AIRequestProfiles.resolve(spec.profile || "timelapse-plan", { actorId: spec.actorId || null }));
                let truncationRetried = false;
                let repairAttempted = false;
                const trace = { stage: spec.stage, originalMessages: clone(baseMessages), attempts: [], finalStatus: "pending" };

                for (let attempt = 0; attempt < 3; attempt++) {
                    const kind = attempt === 0 ? "initial" : (truncationRetried && !repairAttempted && currentMessages.length === baseMessages.length ? "truncation-retry" : "repair");
                    const response = await policyClient.chat(currentMessages, requestOptions);
                    const attemptTrace = {
                        attempt: attempt + 1,
                        kind: kind,
                        messages: clone(currentMessages),
                        requestOptions: clone(requestOptions),
                        modelId: response && response.modelId || null,
                        rawContent: response && typeof response.content === "string" ? response.content : "",
                        usage: response && response.usage || null,
                        providerResponse: response && response.providerResponse ? clone(response.providerResponse) : null,
                        parsedValue: null,
                        validationErrors: []
                    };
                    trace.attempts.push(attemptTrace);

                    if (!response || !response.ok) {
                        const error = clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "AI request failed." });
                        if (error.code === "MODEL_OUTPUT_TRUNCATED" && !truncationRetried) {
                            truncationRetried = true;
                            currentMessages = clone(baseMessages);
                            requestOptions = Object.assign({}, requestOptions, {
                                reasoningMaxTokens: 0,
                                reasoningEffort: "none"
                            });
                            continue;
                        }
                        trace.finalStatus = error.code === "MODEL_OUTPUT_TRUNCATED" ? "truncated" : "request_failed";
                        return {
                            ok: false,
                            error: error,
                            modelId: response && response.modelId || null,
                            usage: response && response.usage || null,
                            rawContent: response && response.content || "",
                            trace: trace
                        };
                    }

                    let value;
                    let validation;
                    let parseFailed = false;
                    try {
                        value = parseObject(response.content);
                        attemptTrace.parsedValue = clone(value);
                        validation = spec.validate(value);
                    } catch (error) {
                        parseFailed = true;
                        validation = { ok: false, errors: [error && error.message || "The response was not valid JSON."] };
                    }

                    if (validation && validation.ok) {
                        trace.finalStatus = "valid";
                        trace.repaired = repairAttempted;
                        return {
                            ok: true,
                            value: clone(validation.value),
                            modelId: response.modelId || null,
                            usage: response.usage || null,
                            rawContent: response.content,
                            repaired: repairAttempted,
                            trace: trace
                        };
                    }

                    const errors = validation && Array.isArray(validation.errors) && validation.errors.length
                        ? validation.errors
                        : ["The response did not match the required timelapse protocol."];
                    attemptTrace.validationErrors = errors.slice();
                    if (repairAttempted) {
                        trace.finalStatus = parseFailed ? "parse_failed_after_repair" : "invalid_after_repair";
                        return {
                            ok: false,
                            error: parseFailed
                                ? structuralError("MODEL_JSON_PARSE_FAILED", "The model returned malformed JSON for the timelapse protocol.", errors)
                                : structuralError("MODEL_PROTOCOL_INVALID", "The model returned JSON that failed timelapse protocol validation.", errors),
                            modelId: response.modelId || null,
                            usage: response.usage || null,
                            rawContent: response.content,
                            trace: trace
                        };
                    }

                    repairAttempted = true;
                    const contract = String(spec.contract || "Return the exact JSON contract from the original request.");
                    currentMessages = baseMessages.concat([
                        { role: "assistant", content: String(response.content || "").slice(0, 12000) },
                        { role: "user", content: `Your previous response failed validation:\n${errors.map(function (error) { return `- ${error}`; }).join("\n")}\nCanonical response contract:\n${contract}\nReturn the complete corrected JSON object only. Use exactly the documented field names. No markdown or extra prose.` }
                    ]);
                }
                return failure("MODEL_PROTOCOL_INVALID", "The model returned invalid timelapse protocol data.");
            }
        });
    }

    function aiCharacterIds() {
        const world = setup.Game.getWorld();
        return Object.values(world.entities).filter(function (entity) {
            return entity && entity.type === "character" && world.control.assignments[entity.id] === "ai";
        }).map(function (character) { return character.id; });
    }

    function characterName(characterId) {
        const character = setup.Game.getWorld().entities[characterId];
        return character && character.name || characterId;
    }

    function locationName(locationId) {
        const location = setup.Game.getWorld().entities[locationId];
        return location && location.name || locationId;
    }

    function catalogIndex(catalog) {
        const map = new Map();
        (catalog || []).forEach(function (location) { map.set(location.id, location); });
        return map;
    }

    function validateStep(step, locationMap, path) {
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
            if (!exactKeys(action, ["type", "bedId"])) errors.push(`${path}.action sleep must contain exactly type and bedId.`);
            if (!(location.beds || []).some(function (bed) { return bed.id === action.bedId; })) {
                errors.push(`${path}.action.bedId must identify a supplied bed in the selected room.`);
            }
        } else if (action.type === "timelapse_action") {
            if (!exactKeys(action, ["type", "actionId"])) errors.push(`${path}.action timelapse_action must contain exactly type and actionId.`);
            if (!(location.timelapseActions || []).some(function (candidate) { return candidate.id === action.actionId; })) {
                errors.push(`${path}.action.actionId must identify an authored action in the selected room.`);
            }
        } else {
            errors.push(`${path}.action.type must be narrate, sleep, or timelapse_action.`);
        }
        return errors;
    }

    function validatePlan(value, catalog, remainingRounds) {
        const errors = [];
        if (!exactKeys(value, ["steps"]) || !Array.isArray(value.steps)) {
            return { ok: false, errors: ["response must contain exactly a steps array."] };
        }
        if (value.steps.length < 1 || value.steps.length > remainingRounds) {
            errors.push(`response.steps must contain from 1 to ${remainingRounds} steps.`);
        }
        const locations = catalogIndex(catalog);
        value.steps.forEach(function (step, index) {
            errors.push.apply(errors, validateStep(step, locations, `response.steps[${index}]`));
        });
        const sleepIndex = value.steps.findIndex(function (step) { return step && step.action && step.action.type === "sleep"; });
        if (sleepIndex >= 0 && sleepIndex !== value.steps.length - 1) {
            errors.push("sleep must be the last supplied plan step and no step may follow it.");
        }
        if (sleepIndex < 0 && value.steps.length !== remainingRounds) {
            errors.push(`a plan without sleep must provide exactly ${remainingRounds} steps.`);
        }
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function planContract() {
        return JSON.stringify({
            steps: [
                { locationId: "reachable_location_id", action: { type: "narrate", text: "what the character does during this round" } },
                { locationId: "reachable_location_id", action: { type: "sleep", bedId: "concrete_bed_id" } },
                { locationId: "reachable_location_id", action: { type: "timelapse_action", actionId: "authored_timelapse_action_id" } }
            ]
        });
    }

    function plannerSystem(mode) {
        return [
            `You are planning coarse activity for exactly one RPG character during a timelapse. The current mode is ${String(mode || DEFAULT_MODE)}.`,
            "This is not an ordinary world-tick turn. The timelapse has a small fixed number of abstract rounds.",
            "For each active planned round choose one supplied reachable room and one activity there. Travel to the chosen room is implicit and consumes no extra round.",
            "Allowed action JSON variants are exactly: narrate = {\"type\":\"narrate\",\"text\":\"...\"}; sleep = {\"type\":\"sleep\",\"bedId\":\"supplied_bed_id\"}; authored macro = {\"type\":\"timelapse_action\",\"actionId\":\"supplied_action_id\"}.",
            "A plan without sleep must contain exactly one step for every remaining round. A sleep step may end the plan early; if present it must be the final returned step and there are no steps after it.",
            "There is no null, pass, ordinary move, or ordinary world-tick formal action in this protocol.",
            "narrate is background prose, not a canonical state mutation channel. It must not move tracked items, money, keys, locks, doors, ownership, location, sublocation, sleeping state, item state, or deterministic world flags. Do not say a tracked item was put down, transferred, consumed, filled, locked, unlocked, or otherwise changed unless a supplied authored timelapse action performs that exact effect.",
            "Allowed narrate activity includes thinking, reading, studying, praying, stretching, resting while awake, watching, writing, tending untracked background details, or cleaning/polishing gear without changing tracked inventory state.",
            "Use an authored timelapse action when a supplied deterministic macro exactly matches the intended tracked-state activity.",
            "Current canonical state in context.view is authoritative if any older compressed fact appears inconsistent with it.",
            "Plans are intentions and may later be replaced after an actual interaction or grounded failure.",
            `Return exactly one JSON object matching this union contract and nothing else: ${planContract()}`,
            "The three action examples demonstrate alternative union branches; do not include all three unless the plan genuinely uses them. No markdown, commentary, or hidden reasoning."
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
        return setup.CharacterContext.buildMaintenance(characterId, { pendingObservations: pendingObservations || [] });
    }

    async function requestPlan(characterId, startRound, remainingRounds, facts, latestEncounter, latestFailure, client, mode) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        const catalog = setup.TimelapseAPI.getReachableCatalog(characterId);
        if (!Array.isArray(catalog)) return catalog;
        const pending = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
            ? clone(actor.mind.pendingObservations)
            : [];
        const context = compactPrivateContext(characterId, pending);
        if (!context || context.ok === false) return context;
        context.timelapse = {
            mode: mode || DEFAULT_MODE,
            startRound: startRound,
            remainingRounds: remainingRounds,
            reachableLocations: clone(catalog),
            committedFacts: compactFacts(facts),
            latestEncounterResume: latestEncounter || null,
            latestFailure: latestFailure || null
        };
        const stage = startRound === 1 ? "timelapse-plan" : "timelapse-replan";
        const messages = [
            { role: "system", content: plannerSystem(mode || DEFAULT_MODE) },
            { role: "user", content: JSON.stringify({
                stage: stage,
                context: context,
                requiredResponseContract: {
                    steps: [
                        { locationId: "reachable_location_id", action: { type: "narrate", text: "non-empty background activity" } },
                        { locationId: "reachable_location_id", action: { type: "sleep", bedId: "concrete supplied bed id" } },
                        { locationId: "reachable_location_id", action: { type: "timelapse_action", actionId: "concrete supplied authored action id" } }
                    ],
                    rules: ["action variants are a union", "sleep may end the plan early and must be final", "without sleep steps.length must equal remainingRounds"]
                }
            }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: stage,
            stage: stage,
            messages: messages,
            contract: planContract(),
            profile: stage,
            requestOptions: setup.AIRequestProfiles.resolve(stage, { actorId: characterId }),
            client: client,
            validate: function (value) { return validatePlan(value, catalog, remainingRounds); }
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
        context.timelapseEncounter = {
            mode: mode || DEFAULT_MODE,
            round: round,
            location: { id: locationId, name: locationName(locationId) },
            ownActivity: ownActivity,
            otherCharacters: clone(otherActivities),
            previousCommittedTimelapseFacts: compactFacts(facts)
        };
        const contract = '{"engage":true|false,"intent":"brief private social intention"}';
        const messages = [
            { role: "system", content: `You control exactly one character during a compressed timelapse encounter. Decide only this character's private social intent. Return exactly ${contract}. Set engage=false when the character deliberately keeps to themself and simply continues their own activity. If engage=true, intent may briefly state the topic, question, tone, information to reveal or avoid, notable statement, or desire to disengage. Do not write dialogue, do not decide what other characters do, and do not claim that any future movement, sleep, item transfer, money transfer, lock action, or other canonical action has happened. This intent is private planning input, not a committed fact. No markdown or extra fields.` },
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

    async function requestInteractionResume(round, locationId, participants, activities, intents, publicFacts, client, mode) {
        const observerId = participants && participants[0] && participants[0].id;
        const observerView = observerId ? setup.CharacterAPI.getView(observerId) : null;
        const publicRoomContext = observerView && observerView.location && observerView.location.id === locationId
            ? clone(observerView.location)
            : { id: locationId, name: locationName(locationId) };
        const contract = '{"interactionOccurred":true|false,"interactionResume":"compressed public summary, or empty string when false"}';
        const messages = [
            { role: "system", content: `Resolve one compressed group encounter during a timelapse. You receive public/observable room context and each participant's private declared interaction intent. Return exactly ${contract}. Summarize only the social exchange that actually occurs now: who engages or declines, topics discussed, questions asked or answered, statements actually made, information actually revealed, public tone, and whether someone verbally ends the conversation. An intent about what somebody plans to do afterward is not a completed fact. Never turn 'I will go upstairs', 'I will sleep', 'I will clean', or similar future intent into movement, sleeping, cleaning, item/money transfer, lock/door change, or any other canonical world mutation. You cannot execute formal actions. If no actual social exchange occurs, set interactionOccurred=false and interactionResume to the empty string. Do not invent private motives or knowledge absent from supplied intents. Do not write a line-by-line transcript. No markdown or extra fields.` },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-interaction-resolver",
                context: {
                    mode: mode || DEFAULT_MODE,
                    round: round,
                    location: publicRoomContext,
                    participants: clone(participants),
                    observableActivities: clone(activities),
                    interactionIntents: clone(intents),
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

    function validateMemoryUpdates(value) {
        if (!exactKeys(value, ["memoryUpdates"]) || !isObject(value.memoryUpdates)) {
            return { ok: false, errors: ["response must contain exactly memoryUpdates."] };
        }
        const updates = value.memoryUpdates;
        if (!exactKeys(updates, ["recentMemoriesToAdd", "beliefsToUpsert", "beliefIdsToRemove", "relationshipsToUpsert"])) {
            return { ok: false, errors: ["memoryUpdates must contain exactly recentMemoriesToAdd, beliefsToUpsert, beliefIdsToRemove, and relationshipsToUpsert."] };
        }
        if (![updates.recentMemoriesToAdd, updates.beliefsToUpsert, updates.beliefIdsToRemove, updates.relationshipsToUpsert].every(Array.isArray)) {
            return { ok: false, errors: ["all memoryUpdates fields must be arrays."] };
        }
        if (updates.recentMemoriesToAdd.length > 5 || updates.beliefsToUpsert.length > 5 || updates.beliefIdsToRemove.length > 5 || updates.relationshipsToUpsert.length > 5) {
            return { ok: false, errors: ["each memoryUpdates array may contain at most 5 records."] };
        }
        const standardValidation = setup.AIProtocol.validateResult({
            publicNarrative: null,
            spokenText: null,
            memoryUpdates: updates
        });
        if (!standardValidation.ok) return { ok: false, errors: standardValidation.errors || [standardValidation.message] };
        return { ok: true, value: value };
    }

    function reflectionContract() {
        return JSON.stringify({ memoryUpdates: { recentMemoriesToAdd: [], beliefsToUpsert: [], beliefIdsToRemove: [], relationshipsToUpsert: [] } });
    }

    async function requestReflection(characterId, facts, client, mode) {
        const context = compactPrivateContext(characterId, []);
        if (!context || context.ok === false) return context;
        context.completedTimelapse = { mode: mode || DEFAULT_MODE, committedFacts: compactFacts(facts) };
        const messages = [
            { role: "system", content: `You are giving exactly one RPG character a private post-timelapse reflection after the supplied actual events have completed. You cannot act in the world. Update only durable private memory, beliefs, or relationships when something meaningfully changed. Do not invent physical events or mechanical results. Routine detail need not be remembered. Return exactly one object with the single key memoryUpdates. memoryUpdates must contain exactly recentMemoriesToAdd, beliefsToUpsert, beliefIdsToRemove, and relationshipsToUpsert. A recent memory record is {"summary":"...","importance":0.0}, with importance from 0 to 1. A belief record is {"id":"letter_started_id","text":"...","confidence":"low|medium|high"}. beliefIdsToRemove may explicitly remove an existing belief that became obsolete or contradicted. A relationship record is {"targetCharacterId":"character_id","summary":"..."}. Each array may contain at most 5 records and may be empty. Example empty response: ${reflectionContract()}. No markdown, commentary, hidden reasoning, or extra fields.` },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-reflection",
                context: context,
                requiredResponseContract: { memoryUpdates: { recentMemoriesToAdd: [], beliefsToUpsert: [], beliefIdsToRemove: [], relationshipsToUpsert: [] } }
            }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: "timelapse-reflection",
            stage: "timelapse-reflection",
            messages: messages,
            contract: reflectionContract(),
            profile: "reflection",
            requestOptions: setup.AIRequestProfiles.resolve("reflection", { actorId: characterId }),
            client: client,
            validate: validateMemoryUpdates
        });
    }

    function consumeCurrentObservations(characterId, observationIds) {
        const ids = Array.isArray(observationIds) ? observationIds.filter(Number.isInteger) : [];
        if (ids.length) setup.AIMemory.consumeObservations(characterId, ids);
    }

    function addFact(records, factsByActor, text, actorIds, locationId, kind, round) {
        if (!text) return null;
        const record = {
            id: `timelapse-${round || 0}-${records.length + 1}`,
            text: String(text),
            actorIds: clone(actorIds || []),
            locationId: locationId || null,
            kind: kind || "timelapse",
            round: round || null
        };
        records.push(record);
        (actorIds || []).forEach(function (actorId) {
            if (!factsByActor[actorId]) factsByActor[actorId] = [];
            factsByActor[actorId].push(record.text);
        });
        return record;
    }

    function hiddenEntries(records) {
        return records.map(function (record) {
            const firstActorId = record.actorIds && record.actorIds.length === 1 ? record.actorIds[0] : null;
            return {
                commitId: record.id || null,
                text: record.text,
                visibleToHuman: false,
                actorId: firstActorId,
                actorName: firstActorId ? characterName(firstActorId) : "",
                locationId: record.locationId,
                locationName: record.locationId ? locationName(record.locationId) : "",
                kind: record.kind,
                round: record.round || null
            };
        });
    }

    function emitRoundCommitted(options, round, records, mode, totalRounds) {
        if (!options || typeof options.onRoundCommitted !== "function") return;
        try {
            options.onRoundCommitted({
                mode: mode || DEFAULT_MODE,
                round: round,
                totalRounds: totalRounds || ROUND_COUNT,
                entries: hiddenEntries(records || []),
                committedFacts: (records || []).map(function (record) { return record.text; })
            });
        } catch (error) {
            // Presentation callbacks never change canonical timelapse execution.
        }
    }

    async function resolveEncounterGroup(group, round, activities, factsByActor, publicRecords, client, mode) {
        const locationId = group.locationId;
        const participants = group.participants;
        const participantRecords = participants.map(function (characterId) {
            return { id: characterId, name: characterName(characterId) };
        });
        const observableActivities = participants.map(function (characterId) {
            return { characterId: characterId, name: characterName(characterId), activity: activities[characterId] || "remained here during this round" };
        });
        const intentResults = await Promise.all(participants.map(async function (characterId) {
            const otherActivities = observableActivities.filter(function (record) { return record.characterId !== characterId; });
            const result = await requestInteractionIntent(
                characterId,
                round,
                locationId,
                activities[characterId] || "remained here during this round",
                otherActivities,
                factsByActor[characterId],
                client,
                mode
            );
            return { characterId: characterId, result: result };
        }));
        const failedIntent = intentResults.find(function (record) { return !record.result.ok; });
        if (failedIntent) throw failedIntent.result.error;

        const intents = intentResults.map(function (record) {
            return {
                characterId: record.characterId,
                name: characterName(record.characterId),
                engage: record.result.value.engage,
                intent: record.result.value.intent
            };
        });
        if (intents.every(function (intent) { return intent.engage === false; })) {
            return { locationId: locationId, participants: participants, interactionOccurred: false, resume: "", skippedResolver: true };
        }

        const resumeResult = await requestInteractionResume(
            round,
            locationId,
            participantRecords,
            observableActivities,
            intents,
            publicRecords.filter(function (record) {
                return record.kind === "timelapse_interaction" && record.locationId === locationId;
            }).map(function (record) { return record.text; }),
            client,
            mode
        );
        if (!resumeResult.ok) throw resumeResult.error;
        return {
            locationId: locationId,
            participants: participants,
            interactionOccurred: resumeResult.value.interactionOccurred,
            resume: resumeResult.value.interactionResume,
            skippedResolver: false
        };
    }

    async function runTimelapseCore(client, options) {
        options = options && typeof options === "object" ? options : {};
        const mode = options.mode || DEFAULT_MODE;
        const roundCount = Number.isInteger(options.roundCount) && options.roundCount > 0 ? options.roundCount : DEFAULT_ROUND_COUNT;
        const humanId = setup.Game.getHumanCharacterId();
        const world = setup.Game.getWorld();
        const aiIds = aiCharacterIds();
        aiIds.forEach(function (characterId) {
            setup.AIWorkingState.setContinuation(characterId, null);
        });
        let committedRounds = 0;
        let lastCommittedWorld = clone(world);
        const plans = {};
        const factsByActor = {};
        const publicRecords = [];
        const initialObservationIds = {};
        aiIds.forEach(function (id) { factsByActor[id] = []; });

        try {
            const initialPlanResults = await Promise.all(aiIds.map(async function (characterId) {
                const actor = setup.Game.getWorld().entities[characterId];
                if (!actor || actor.sleeping === true) return { characterId: characterId, skipped: true, result: null };
                initialObservationIds[characterId] = actor.mind && Array.isArray(actor.mind.pendingObservations)
                    ? actor.mind.pendingObservations.map(function (observation) { return observation.id; }).filter(Number.isInteger)
                    : [];
                const result = await requestPlan(characterId, 1, roundCount, [], null, null, client, mode);
                return { characterId: characterId, skipped: false, result: result };
            }));
            const failedPlan = initialPlanResults.find(function (record) { return !record.skipped && !record.result.ok; });
            if (failedPlan) throw failedPlan.result.error;
            initialPlanResults.forEach(function (record) {
                if (!record.skipped) plans[record.characterId] = { startRound: 1, steps: clone(record.result.value.steps) };
            });

            for (let round = 1; round <= roundCount; round++) {
                const roundStartWorld = clone(lastCommittedWorld);
                const roundRecordStart = publicRecords.length;
                const failures = {};
                const replanReasons = {};
                const activities = {};

                try {
                    for (const characterId of aiIds) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true) continue;
                        const plan = plans[characterId];
                        const index = plan ? round - plan.startRound : -1;
                        const step = plan && index >= 0 ? plan.steps[index] : null;
                        if (!step) {
                            failures[characterId] = { code: "TIMELAPSE_PLAN_MISSING", message: "No valid plan step was available for this round." };
                            replanReasons[characterId] = true;
                            activities[characterId] = "had no executable plan for this round";
                            addFact(publicRecords, factsByActor, `${characterName(characterId)} had no executable plan for this round.`, [characterId], actor.locationId, "timelapse_failure", round);
                            continue;
                        }
                        const moveResult = setup.TimelapseAPI.moveToLocation(characterId, step.locationId);
                        if (!moveResult.ok) {
                            failures[characterId] = clone(moveResult.error);
                            replanReasons[characterId] = true;
                            activities[characterId] = `could not reach ${step.locationId}: ${moveResult.error.message}`;
                            addFact(publicRecords, factsByActor, `${characterName(characterId)} could not complete the planned travel: ${moveResult.error.message}`, [characterId], setup.Game.getWorld().entities[characterId].locationId, "timelapse_failure", round);
                        } else if (moveResult.text) {
                            addFact(publicRecords, factsByActor, moveResult.text, [characterId], step.locationId, "timelapse_move", round);
                        }
                    }

                    for (const characterId of aiIds) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true || failures[characterId]) continue;
                        const plan = plans[characterId];
                        const step = plan && plan.steps[round - plan.startRound];
                        if (!step) continue;
                        const actionResult = setup.TimelapseAPI.executeAction(characterId, step.locationId, step.action);
                        if (!actionResult.ok) {
                            failures[characterId] = clone(actionResult.error);
                            replanReasons[characterId] = true;
                            activities[characterId] = `failed to complete the planned activity: ${actionResult.error.message}`;
                            addFact(publicRecords, factsByActor, `${characterName(characterId)} could not complete the planned activity: ${actionResult.error.message}`, [characterId], actor.locationId, "timelapse_failure", round);
                        } else {
                            activities[characterId] = actionResult.text;
                            addFact(publicRecords, factsByActor, actionResult.text, [characterId], actionResult.locationId, `timelapse_${actionResult.type}`, round);
                        }
                    }

                    const groups = new Map();
                    aiIds.forEach(function (characterId) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true) return;
                        if (!groups.has(actor.locationId)) groups.set(actor.locationId, []);
                        groups.get(actor.locationId).push(characterId);
                    });
                    const groupJobs = Array.from(groups.entries()).filter(function (entry) { return entry[1].length >= 2; }).map(function (entry) {
                        return resolveEncounterGroup({ locationId: entry[0], participants: entry[1] }, round, activities, factsByActor, publicRecords, client, mode);
                    });
                    const encounterResults = await Promise.all(groupJobs);
                    encounterResults.forEach(function (encounter) {
                        if (!encounter.interactionOccurred) return;
                        addFact(publicRecords, factsByActor, encounter.resume, encounter.participants, encounter.locationId, "timelapse_interaction", round);
                        encounter.participants.forEach(function (characterId) { replanReasons[characterId] = true; });
                    });

                    if (round === 1) {
                        Object.keys(initialObservationIds).forEach(function (characterId) {
                            consumeCurrentObservations(characterId, initialObservationIds[characterId]);
                        });
                    }

                    committedRounds = round;
                    lastCommittedWorld = clone(setup.Game.getWorld());
                    const roundRecords = publicRecords.slice(roundRecordStart);
                    emitRoundCommitted(options, round, roundRecords, mode, roundCount);

                    if (round < roundCount) {
                        const replanCharacters = aiIds.filter(function (characterId) {
                            const actor = setup.Game.getWorld().entities[characterId];
                            return actor && actor.sleeping !== true && replanReasons[characterId];
                        });
                        const replans = await Promise.all(replanCharacters.map(async function (characterId) {
                            const latestEncounter = publicRecords.slice().reverse().find(function (record) {
                                return record.kind === "timelapse_interaction" && record.actorIds.includes(characterId) && record.round === round;
                            });
                            const remaining = roundCount - round;
                            const result = await requestPlan(
                                characterId,
                                round + 1,
                                remaining,
                                factsByActor[characterId],
                                latestEncounter && latestEncounter.text || null,
                                failures[characterId] || null,
                                client,
                                mode
                            );
                            return { characterId: characterId, result: result };
                        }));
                        const failedReplan = replans.find(function (record) { return !record.result.ok; });
                        if (failedReplan) throw failedReplan.result.error;
                        replans.forEach(function (record) {
                            plans[record.characterId] = { startRound: round + 1, steps: clone(record.result.value.steps) };
                        });
                    }
                } catch (roundError) {
                    if (committedRounds < round) {
                        State.variables.world = roundStartWorld;
                        publicRecords.splice(roundRecordStart);
                        Object.keys(factsByActor).forEach(function (characterId) {
                            factsByActor[characterId] = publicRecords.filter(function (record) {
                                return record.actorIds.includes(characterId);
                            }).map(function (record) { return record.text; });
                        });
                    }
                    throw roundError;
                }
            }

            const reflectionResults = await Promise.all(aiIds.map(async function (characterId) {
                return { characterId: characterId, result: await requestReflection(characterId, factsByActor[characterId], client, mode) };
            }));
            const failedReflection = reflectionResults.find(function (record) { return !record.result.ok; });
            if (failedReflection) throw failedReflection.result.error;

            const reflections = [];
            reflectionResults.forEach(function (record) {
                const commit = setup.AIMemory.applyUpdates(record.characterId, record.result.value.memoryUpdates);
                if (!commit.ok) throw commit.error;
                reflections.push({ characterId: record.characterId, result: clone(record.result.value) });
            });

            const consolidations = [];
            if (setup.MemoryConsolidator) {
                const consolidationResults = await Promise.all(aiIds.map(async function (characterId) {
                    return {
                        characterId: characterId,
                        result: await setup.MemoryConsolidator.compress(characterId, client || setup.OpenRouterClient, { automatic: true, parallel: true })
                    };
                }));
                const failedConsolidation = consolidationResults.find(function (record) { return !record.result.ok; });
                if (failedConsolidation) throw failedConsolidation.result.error;
                consolidationResults.forEach(function (record) {
                    consolidations.push({ characterId: record.characterId, result: clone(record.result) });
                });
            }

            const validation = setup.Game.validateWorld();
            if (!validation.ok) throw validation.error;

            return {
                ok: true,
                mode: mode,
                humanId: humanId,
                rounds: roundCount,
                committedRounds: committedRounds,
                hiddenNarrativeEntries: hiddenEntries(publicRecords),
                committedFacts: publicRecords.map(function (record) { return record.text; }),
                reflections: reflections,
                consolidations: consolidations
            };
        } catch (error) {
            State.variables.world = clone(lastCommittedWorld);
            return {
                ok: false,
                mode: mode,
                humanId: humanId,
                rounds: roundCount,
                committedRounds: committedRounds,
                hiddenNarrativeEntries: hiddenEntries(publicRecords),
                committedFacts: publicRecords.map(function (record) { return record.text; }),
                error: {
                    code: error && error.code || "TIMELAPSE_FAILED",
                    message: error && error.message || "The timelapse failed.",
                    details: error && error.details ? clone(error.details) : undefined,
                    providerResponse: error && error.providerResponse ? clone(error.providerResponse) : undefined
                }
            };
        }
    }

    setup.TimelapseCore = {
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_ROUND_COUNT: DEFAULT_ROUND_COUNT,
        run: runTimelapseCore,
        validatePlan: validatePlan
    };
}());
