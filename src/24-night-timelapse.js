(function () {
    "use strict";

    const ROUND_COUNT = 5;
    let inFlight = false;

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

    async function requestStructured(spec) {
        const baseMessages = clone(spec.messages || []);
        return setup.AIRequestExecutor.executeCustom({
            actorId: spec.actorId || null,
            purpose: spec.purpose,
            stage: spec.stage,
            messages: baseMessages,
            client: spec.client || setup.OpenRouterClient,
            run: async function (policyClient) {
                let currentMessages = clone(baseMessages);
                const trace = { stage: spec.stage, originalMessages: clone(baseMessages), attempts: [], finalStatus: "pending" };
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await policyClient.chat(currentMessages);
                    const attemptTrace = {
                        attempt: attempt + 1,
                        kind: attempt === 0 ? "initial" : "repair",
                        messages: clone(currentMessages),
                        modelId: response && response.modelId || null,
                        rawContent: response && typeof response.content === "string" ? response.content : "",
                        usage: response && response.usage || null,
                        parsedValue: null,
                        validationErrors: []
                    };
                    trace.attempts.push(attemptTrace);
                    if (!response || !response.ok) {
                        trace.finalStatus = "request_failed";
                        return {
                            ok: false,
                            error: clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "AI request failed." }),
                            modelId: response && response.modelId || null,
                            trace: trace
                        };
                    }
                    let value;
                    let validation;
                    try {
                        value = parseObject(response.content);
                        attemptTrace.parsedValue = clone(value);
                        validation = spec.validate(value);
                    } catch (error) {
                        validation = { ok: false, errors: [error.message] };
                    }
                    if (validation && validation.ok) {
                        trace.finalStatus = "valid";
                        trace.repaired = attempt === 1;
                        return {
                            ok: true,
                            value: clone(validation.value),
                            modelId: response.modelId || null,
                            usage: response.usage || null,
                            rawContent: response.content,
                            repaired: attempt === 1,
                            trace: trace
                        };
                    }
                    const errors = validation && Array.isArray(validation.errors) && validation.errors.length
                        ? validation.errors
                        : ["The response did not match the required timelapse protocol."];
                    attemptTrace.validationErrors = errors.slice();
                    if (attempt === 1) {
                        trace.finalStatus = "invalid_after_repair";
                        return {
                            ok: false,
                            error: { code: "INVALID_MODEL_JSON", message: "The model returned invalid timelapse protocol data.", details: errors.slice() },
                            modelId: response.modelId || null,
                            usage: response.usage || null,
                            rawContent: response.content,
                            trace: trace
                        };
                    }
                    currentMessages = baseMessages.concat([
                        { role: "assistant", content: String(response.content || "").slice(0, 12000) },
                        { role: "user", content: `Your previous response failed validation:\n${errors.map(function (error) { return `- ${error}`; }).join("\n")}\nReturn the complete corrected JSON object only, with no markdown or extra prose.` }
                    ]);
                }
                return failure("INVALID_MODEL_JSON", "The model returned invalid timelapse protocol data.");
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
            errors.push("sleep must be the last supplied plan step.");
        }
        if (sleepIndex < 0 && value.steps.length !== remainingRounds) {
            errors.push(`a plan without sleep must provide exactly ${remainingRounds} steps.`);
        }
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function plannerSystem() {
        return [
            "You are planning coarse overnight activity for exactly one RPG character.",
            "This is not an ordinary world-tick turn. The night has a small fixed number of abstract rounds.",
            "For each remaining round choose one reachable room and one activity there. Travel to the chosen room is implicit and consumes no extra round.",
            "Allowed activity kinds are narrate, sleep, or a supplied authored timelapse action.",
            "narrate may describe arbitrary ordinary background activity, but cannot create canonical items, money, keys, ownership, deterministic mechanical results, or another autonomous character's decisions.",
            "sleep must choose a concrete supplied bed and ends the active plan.",
            "Use authored timelapse actions when a supplied deterministic macro exactly matches the intended activity.",
            "There is no null/pass. If the character waits or does little, narrate what they are doing and why they are there.",
            "Plans are intentions and may later be replaced after encounters or grounded failures.",
            "Return exactly one JSON object containing steps, with no markdown, commentary, or hidden reasoning."
        ].join(" ");
    }

    async function requestPlan(characterId, startRound, remainingRounds, facts, latestEncounter, latestFailure, client) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        const catalog = setup.TimelapseAPI.getReachableCatalog(characterId);
        if (!Array.isArray(catalog)) return catalog;
        const pending = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
            ? clone(actor.mind.pendingObservations)
            : [];
        const baseContext = setup.ContextBuilder.build(characterId, { pendingObservations: pending });
        if (!baseContext || baseContext.ok === false) return baseContext;
        const context = Object.assign({}, baseContext, {
            timelapse: {
                startRound: startRound,
                remainingRounds: remainingRounds,
                reachableLocations: clone(catalog),
                committedFacts: clone(facts || []),
                latestEncounterResume: latestEncounter || null,
                latestFailure: latestFailure || null
            }
        });
        const messages = [
            { role: "system", content: plannerSystem() },
            { role: "user", content: JSON.stringify({
                stage: startRound === 1 ? "timelapse-plan" : "timelapse-replan",
                context: context,
                requiredResponseShape: {
                    steps: [{ locationId: "reachable_location_id", action: { type: "narrate", text: "what the character does there" } }]
                }
            }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: startRound === 1 ? "timelapse-plan" : "timelapse-replan",
            stage: startRound === 1 ? "timelapse-plan" : "timelapse-replan",
            messages: messages,
            client: client,
            validate: function (value) { return validatePlan(value, catalog, remainingRounds); }
        });
    }

    function validateIntent(value) {
        if (!exactKeys(value, ["intent"]) || typeof value.intent !== "string" || !value.intent.trim() || value.intent.trim().length > 2000) {
            return { ok: false, errors: ["response must contain exactly one non-empty intent string up to 2000 characters."] };
        }
        return { ok: true, value: { intent: value.intent.trim() } };
    }

    async function requestInteractionIntent(characterId, round, locationId, ownActivity, otherActivities, facts, client) {
        const baseContext = setup.ContextBuilder.build(characterId, { pendingObservations: [] });
        if (!baseContext || baseContext.ok === false) return baseContext;
        const context = Object.assign({}, baseContext, {
            timelapseEncounter: {
                round: round,
                location: { id: locationId, name: locationName(locationId) },
                ownActivity: ownActivity,
                otherCharacters: clone(otherActivities),
                previousCommittedTimelapseFacts: clone(facts || [])
            }
        });
        const messages = [
            { role: "system", content: "You control exactly one character during a compressed overnight encounter. Decide only this character's social intent. Do not write dialogue or decide what other characters do. State whether you engage, what you want to discuss or ask, your tone, what you are willing to reveal or avoid, any notable statement you specifically want to make, and what you intend afterward. Return exactly {\"intent\":\"...\"} and nothing else." },
            { role: "user", content: JSON.stringify({ stage: "timelapse-interaction-intent", context: context, requiredResponseShape: { intent: "..." } }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: "timelapse-interaction-intent",
            stage: "timelapse-interaction-intent",
            messages: messages,
            client: client,
            validate: validateIntent
        });
    }

    function validateResume(value) {
        if (!exactKeys(value, ["resume"]) || typeof value.resume !== "string" || !value.resume.trim() || value.resume.trim().length > 4000) {
            return { ok: false, errors: ["response must contain exactly one non-empty resume string up to 4000 characters."] };
        }
        return { ok: true, value: { resume: value.resume.trim() } };
    }

    async function requestInteractionResume(round, locationId, participants, activities, intents, publicFacts, client) {
        const observerId = participants && participants[0] && participants[0].id;
        const observerView = observerId ? setup.CharacterAPI.getView(observerId) : null;
        const publicRoomContext = observerView && observerView.location && observerView.location.id === locationId
            ? clone(observerView.location)
            : { id: locationId, name: locationName(locationId) };
        const messages = [
            { role: "system", content: "Resolve one compressed group encounter in an RPG night timelapse. You receive only public/observable context and each participant's declared interaction intent. Reconcile those intents into a concise factual summary of what actually happened. You may establish who engaged, topics discussed, information actually revealed, questions asked or answered, notable statements, and how the encounter ended. Do not invent hidden motives, private knowledge not present in the intents, item/money transfers, formal mechanical actions, or other canonical physical state changes. Do not write a line-by-line transcript. Return exactly {\"resume\":\"...\"} and nothing else." },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-interaction-resolver",
                context: {
                    round: round,
                    location: publicRoomContext,
                    participants: clone(participants),
                    observableActivities: clone(activities),
                    interactionIntents: clone(intents),
                    previousPublicTimelapseFacts: clone(publicFacts || [])
                },
                requiredResponseShape: { resume: "..." }
            }) }
        ];
        return requestStructured({
            actorId: null,
            purpose: "timelapse-interaction-resolver",
            stage: "timelapse-interaction-resolver",
            messages: messages,
            client: client,
            validate: validateResume
        });
    }

    function validateMemoryUpdates(value) {
        if (!exactKeys(value, ["memoryUpdates"]) || !isObject(value.memoryUpdates)) {
            return { ok: false, errors: ["response must contain exactly memoryUpdates."] };
        }
        const updates = value.memoryUpdates;
        if (!exactKeys(updates, ["recentMemoriesToAdd", "beliefsToUpsert", "relationshipsToUpsert"])) {
            return { ok: false, errors: ["memoryUpdates must contain exactly recentMemoriesToAdd, beliefsToUpsert, and relationshipsToUpsert."] };
        }
        if (![updates.recentMemoriesToAdd, updates.beliefsToUpsert, updates.relationshipsToUpsert].every(Array.isArray)) {
            return { ok: false, errors: ["all memoryUpdates fields must be arrays."] };
        }
        if (updates.recentMemoriesToAdd.length > 5 || updates.beliefsToUpsert.length > 5 || updates.relationshipsToUpsert.length > 5) {
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

    async function requestReflection(characterId, facts, client) {
        const baseContext = setup.ContextBuilder.build(characterId, { pendingObservations: [] });
        if (!baseContext || baseContext.ok === false) return baseContext;
        const context = Object.assign({}, baseContext, { completedNightFacts: clone(facts || []) });
        const messages = [
            { role: "system", content: "You are giving exactly one RPG character a private end-of-day reflection after the night's actual events have completed. You cannot act in the world. Think about the supplied day/night experience and update only durable private memory, beliefs, or relationships when something meaningfully changed. Do not invent physical events or mechanical results. Routine detail need not be remembered. Return exactly one JSON object containing memoryUpdates with the standard three arrays, and nothing else." },
            { role: "user", content: JSON.stringify({
                stage: "timelapse-reflection",
                context: context,
                requiredResponseShape: {
                    memoryUpdates: { recentMemoriesToAdd: [], beliefsToUpsert: [], relationshipsToUpsert: [] }
                }
            }) }
        ];
        return requestStructured({
            actorId: characterId,
            purpose: "timelapse-reflection",
            stage: "timelapse-reflection",
            messages: messages,
            client: client,
            validate: validateMemoryUpdates
        });
    }

    function consumeCurrentObservations(characterId) {
        const actor = setup.Game.getWorld().entities[characterId];
        if (!actor || !actor.mind || !Array.isArray(actor.mind.pendingObservations)) return;
        const ids = actor.mind.pendingObservations.map(function (observation) { return observation.id; }).filter(Number.isInteger);
        if (ids.length) setup.AIMemory.consumeObservations(characterId, ids);
    }

    function addFact(records, factsByActor, text, actorIds, locationId, kind, round) {
        if (!text) return;
        const record = {
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
    }

    function hiddenEntries(records) {
        return records.map(function (record) {
            const firstActorId = record.actorIds && record.actorIds.length === 1 ? record.actorIds[0] : null;
            return {
                text: record.text,
                visibleToHuman: false,
                actorId: firstActorId,
                actorName: firstActorId ? characterName(firstActorId) : "",
                locationId: record.locationId,
                locationName: record.locationId ? locationName(record.locationId) : "",
                kind: record.kind
            };
        });
    }

    async function run(client) {
        if (inFlight) return failure("TIMELAPSE_IN_FLIGHT", "An overnight timelapse is already in progress.");
        if (setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight()) {
            return failure("TIMELAPSE_BUSY", "Another AI request is already in progress.");
        }
        const humanId = setup.Game.getHumanCharacterId();
        const world = setup.Game.getWorld();
        const human = world.entities[humanId];
        if (!human || human.sleeping !== true) return failure("HUMAN_NOT_SLEEPING", "The HumanController must be asleep before the overnight timelapse can begin.");
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            human.sleeping = false;
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before sleeping until morning.");
        }

        const snapshot = clone(world);
        inFlight = true;
        try {
            const aiIds = aiCharacterIds();
            const plans = {};
            const factsByActor = {};
            const publicRecords = [];
            aiIds.forEach(function (id) { factsByActor[id] = []; });

            for (const characterId of aiIds) {
                const actor = setup.Game.getWorld().entities[characterId];
                if (actor.sleeping === true) continue;
                const planResult = await requestPlan(characterId, 1, ROUND_COUNT, [], null, null, client);
                if (!planResult.ok) throw planResult.error;
                plans[characterId] = { startRound: 1, steps: clone(planResult.value.steps) };
                consumeCurrentObservations(characterId);
            }

            for (let round = 1; round <= ROUND_COUNT; round++) {
                const movementResults = {};
                const actionResults = {};
                const failures = {};
                const replanReasons = {};
                const activities = {};

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
                        continue;
                    }
                    const moveResult = setup.TimelapseAPI.moveToLocation(characterId, step.locationId);
                    movementResults[characterId] = clone(moveResult);
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
                    actionResults[characterId] = clone(actionResult);
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

                for (const [locationId, participants] of groups.entries()) {
                    if (participants.length < 2) continue;
                    const participantRecords = participants.map(function (characterId) {
                        return { id: characterId, name: characterName(characterId) };
                    });
                    const observableActivities = participants.map(function (characterId) {
                        return { characterId: characterId, name: characterName(characterId), activity: activities[characterId] || "remained here during this round" };
                    });
                    const intents = [];
                    for (const characterId of participants) {
                        const otherActivities = observableActivities.filter(function (record) { return record.characterId !== characterId; });
                        const intentResult = await requestInteractionIntent(
                            characterId,
                            round,
                            locationId,
                            activities[characterId] || "remained here during this round",
                            otherActivities,
                            factsByActor[characterId],
                            client
                        );
                        if (!intentResult.ok) throw intentResult.error;
                        intents.push({ characterId: characterId, name: characterName(characterId), intent: intentResult.value.intent });
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
                        client
                    );
                    if (!resumeResult.ok) throw resumeResult.error;
                    addFact(publicRecords, factsByActor, resumeResult.value.resume, participants, locationId, "timelapse_interaction", round);
                    participants.forEach(function (characterId) { replanReasons[characterId] = true; });
                }

                if (round < ROUND_COUNT) {
                    for (const characterId of aiIds) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true || !replanReasons[characterId]) continue;
                        const failureInfo = failures[characterId] || null;
                        const latestEncounter = publicRecords.slice().reverse().find(function (record) {
                            return record.kind === "timelapse_interaction" && record.actorIds.includes(characterId) && record.round === round;
                        });
                        const remaining = ROUND_COUNT - round;
                        const replanResult = await requestPlan(
                            characterId,
                            round + 1,
                            remaining,
                            factsByActor[characterId],
                            latestEncounter && latestEncounter.text || null,
                            failureInfo,
                            client
                        );
                        if (!replanResult.ok) throw replanResult.error;
                        plans[characterId] = { startRound: round + 1, steps: clone(replanResult.value.steps) };
                    }
                }
            }

            const reflections = [];
            for (const characterId of aiIds) {
                const reflection = await requestReflection(characterId, factsByActor[characterId], client);
                if (!reflection.ok) throw reflection.error;
                const commit = setup.AIMemory.applyUpdates(characterId, reflection.value.memoryUpdates);
                if (!commit.ok) throw commit.error;
                reflections.push({ characterId: characterId, result: clone(reflection.value) });
            }

            const consolidations = [];
            if (setup.MemoryConsolidator) {
                for (const characterId of aiIds) {
                    const result = await setup.MemoryConsolidator.compress(characterId, client || setup.OpenRouterClient, { automatic: true });
                    if (!result.ok) throw result.error;
                    consolidations.push({ characterId: characterId, result: clone(result) });
                }
            }

            const finalWorld = setup.Game.getWorld();
            finalWorld.entities[humanId].sleeping = false;
            const validation = setup.Game.validateWorld();
            if (!validation.ok) throw validation.error;

            return {
                ok: true,
                humanId: humanId,
                rounds: ROUND_COUNT,
                hiddenNarrativeEntries: hiddenEntries(publicRecords),
                committedFacts: publicRecords.map(function (record) { return record.text; }),
                reflections: reflections,
                consolidations: consolidations
            };
        } catch (error) {
            State.variables.world = snapshot;
            if (State.variables.world.entities && State.variables.world.entities[humanId]) {
                State.variables.world.entities[humanId].sleeping = false;
            }
            return failure(error && error.code || "TIMELAPSE_FAILED", error && error.message || "The overnight timelapse failed.", error && error.details);
        } finally {
            inFlight = false;
        }
    }

    setup.NightTimelapse = {
        ROUND_COUNT: ROUND_COUNT,
        run: run,
        isInFlight: function () { return inFlight; },
        validatePlan: validatePlan
    };
}());
