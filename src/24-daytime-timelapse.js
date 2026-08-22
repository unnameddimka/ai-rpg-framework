(function () {
    "use strict";

    const MODE = "daytime";
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


    function setTimePhase(phase) {
        if (setup.WorldEnvironment && typeof setup.WorldEnvironment.setTimePhase === "function") {
            const result = setup.WorldEnvironment.setTimePhase(phase);
            if (result && result.ok) return result;
        }
        const world = setup.Game.getWorld();
        if (!world.environment) world.environment = {};
        world.environment.timePhase = phase;
        const labels = { evening: "Evening", nighttime_timelapse: "Night", morning: "Morning", daytime_timelapse: "Day" };
        if (typeof State !== "undefined" && State.variables) State.variables.time = labels[phase] || phase;
        return { ok: true, value: { timePhase: phase, timeLabel: labels[phase] || phase } };
    }

    function recordFinalTimelapseResult(result, finalStage) {
        if (setup.EmergencyDiagnostics && typeof setup.EmergencyDiagnostics.recordTimelapseResult === "function") {
            try {
                const world = setup.Game && setup.Game.getWorld ? setup.Game.getWorld() : null;
                setup.EmergencyDiagnostics.recordTimelapseResult(Object.assign({}, clone(result || {}), {
                    wrapperStage: finalStage || null,
                    finalTimePhase: world && world.environment && world.environment.timePhase || null
                }));
            } catch (error) { /* diagnostics never affect gameplay */ }
        }
        return result;
    }

    function currentWorld() {
        return setup.Game.getWorld();
    }

    function characterName(characterId) {
        const actor = currentWorld().entities[characterId];
        return actor && actor.name || characterId || "Unknown character";
    }

    function activeActivityRecord() {
        const world = currentWorld();
        const active = world.daytime && world.daytime.activeActivity;
        if (!active) return null;
        const definition = world.dayActivities && world.dayActivities[active.activityId];
        if (!definition) return null;
        return { active: active, definition: definition };
    }

    function getPendingOffer() {
        const world = currentWorld();
        return world.daytime && world.daytime.pendingOffer ? clone(world.daytime.pendingOffer) : null;
    }

    function notePausedReactionIds(ids) {
        const world = currentWorld();
        const offer = world.daytime && world.daytime.pendingOffer;
        if (!offer) return;
        const valid = (Array.isArray(ids) ? ids : []).filter(function (id) {
            const character = world.entities[id];
            return character && character.type === "character";
        });
        offer.reactedCharacterIds = Array.from(new Set((offer.reactedCharacterIds || []).concat(valid)));
    }

    function enqueueGroundedObservation(characterId, code, text, data) {
        const world = currentWorld();
        const character = world.entities[characterId];
        if (!character || character.type !== "character") return;
        setup.GameInternals.enqueueObservation(characterId, {
            kind: "action_feedback",
            code: code,
            actorId: data && data.actorId || null,
            targetId: data && data.targetId || characterId,
            text: text,
            data: clone(data || {})
        }, world);
        if (world.control.assignments[characterId] === "ai") {
            setup.AITurnQueue.enqueue(characterId, code.toLowerCase());
        }
    }

    function declinePendingOffer() {
        const world = currentWorld();
        const offer = world.daytime && world.daytime.pendingOffer;
        if (!offer) return failure("DAY_WORK_OFFER_MISSING", "There is no pending daytime work offer to decline.");
        const activity = world.dayActivities[offer.activityId];
        const sponsor = world.entities[offer.sponsorCharacterId];
        const human = world.entities[offer.humanCharacterId];
        const reactedCharacterIds = Array.isArray(offer.reactedCharacterIds) ? offer.reactedCharacterIds.slice() : [];
        world.daytime.pendingOffer = null;
        const text = `${human && human.name || "Traveler"} declined ${sponsor && sponsor.name || "the sponsor"}'s offer of day work${activity ? ` (${activity.name})` : ""}.`;
        enqueueGroundedObservation(offer.sponsorCharacterId, "DAY_WORK_DECLINED", text, {
            actorId: offer.humanCharacterId,
            targetId: offer.sponsorCharacterId,
            activityId: offer.activityId
        });
        return { ok: true, value: { activityId: offer.activityId, sponsorCharacterId: offer.sponsorCharacterId, humanCharacterId: offer.humanCharacterId, reactedCharacterIds: reactedCharacterIds, text: text } };
    }

    function acceptPendingOffer() {
        const world = currentWorld();
        const offer = world.daytime && world.daytime.pendingOffer;
        if (!offer) return failure("DAY_WORK_OFFER_MISSING", "There is no pending daytime work offer to accept.");
        if (!world.environment || world.environment.timePhase !== "morning") {
            return failure("DAY_WORK_NOT_MORNING", "Day work can only begin during Morning.");
        }
        const activity = world.dayActivities[offer.activityId];
        if (!activity || activity.kind !== "sponsored_job") return failure("DAY_WORK_ACTIVITY_INVALID", "The offered daytime job no longer exists.");
        world.daytime.pendingOffer = null;
        world.daytime.activeActivity = {
            activityId: activity.id,
            sponsorCharacterId: offer.sponsorCharacterId,
            humanCharacterId: offer.humanCharacterId
        };
        return { ok: true, value: clone(world.daytime.activeActivity) };
    }

    function reachable(characterId, locationId) {
        const catalog = setup.TimelapseAPI.getReachableCatalog(characterId);
        if (!Array.isArray(catalog)) return false;
        return catalog.some(function (location) { return location && location.id === locationId; });
    }

    function restoreWorld(snapshot) {
        State.variables.world = clone(snapshot);
    }

    function moveWorkingPair(record) {
        const world = currentWorld();
        const activity = record.definition;
        const active = record.active;
        const ids = activity.kind === "sponsored_job"
            ? [active.sponsorCharacterId, active.humanCharacterId]
            : [active.humanCharacterId];
        for (const id of ids) {
            if (!reachable(id, activity.workLocationId)) {
                return failure("DAY_WORKSITE_UNREACHABLE", `${characterName(id)} cannot reach ${activity.name}'s worksite.`);
            }
        }
        for (const id of ids) {
            const result = setup.TimelapseAPI.moveToLocation(id, activity.workLocationId);
            if (!result.ok) return result;
        }
        return { ok: true };
    }

    function textResult(content, code) {
        const text = String(content || "").trim().replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
        if (!text) return failure(code || "DAYTIME_NARRATION_EMPTY", "The daytime narration model returned empty text.");
        return { ok: true, text: text.length > 1800 ? text.slice(0, 1800).trim() : text };
    }

    async function requestWorkNarration(record, round, committedFacts, client) {
        const active = record.active;
        const activity = record.definition;
        const sponsorId = active.sponsorCharacterId;
        const context = setup.ContextBuilder.build(sponsorId, { pendingObservations: [] });
        if (!context || context.ok === false) return context;
        context.daytimeJob = {
            activity: clone(activity),
            round: round,
            totalRounds: ROUND_COUNT,
            sponsor: { id: sponsorId, name: characterName(sponsorId) },
            worker: { id: active.humanCharacterId, name: characterName(active.humanCharacterId) },
            committedFacts: (committedFacts || []).slice(-24)
        };
        const messages = [{
            role: "system",
            content: [
                "Generate public world narration for one already-committed coarse round of a full working day between the sponsoring character and the Human-controlled Traveler.",
                "AUTHORITATIVE TIME PHASE: Day. The engine transitions to Evening only after every daytime round and deterministic boundary processing finish. This narration must remain within Day: it may prepare for the coming evening, but must not narrate evening/night as already begun, going to bed for the night, sunset as a canonical transition, or the next morning.",
                "Write a concise grounded narrative description of what happened during this round of work, normally 1-3 sentences.",
                "Write the narrative voice strictly in third person. Refer to context.daytimeJob.sponsor.name as the sponsoring character and to the Human-controlled player as the Traveler. Do not narrate from the sponsor's first- or second-person perspective: no narratorial I, you, we, my, your, or our for the sponsor. Quoted dialogue may use normal first- or second-person pronouns.",
                "Use the sponsor's supplied personality, memories, relationships, recent context, and the authored job instructions.",
                "The Traveler is occupied with the job and does not take an interactive HumanController turn during the timelapse.",
                "Do not create or transfer tracked items or money, do not grant the final reward, and do not claim any additional formal world-state change.",
                "Do not claim travel to another named canonical location. Return plain prose only."
            ].join(" ")
        }, {
            role: "user",
            content: JSON.stringify({
                context: context,
                narrationInstructions: activity.narrationInstructions || "Describe ordinary shared work at the configured worksite.",
                round: round,
                totalRounds: ROUND_COUNT
            })
        }];
        const result = await setup.AIRequestExecutor.executeCustom({
            actorId: sponsorId,
            purpose: "daytime-job-narration",
            stage: "daytime-job-narration",
            messages: clone(messages),
            requestOptions: setup.AIRequestProfiles.resolve("daytime-job-narration", { actorId: sponsorId }),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                const response = await policyClient.chat(messages);
                if (!response || !response.ok) return failure("DAYTIME_JOB_NARRATION_FAILED", response && response.error && response.error.message || "Job narration request failed.");
                const parsed = textResult(response.content, "DAYTIME_JOB_NARRATION_EMPTY");
                if (!parsed.ok) return parsed;
                return { ok: true, value: { text: parsed.text }, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content || "", trace: null };
            }
        });
        if (!result || !result.ok || !result.value || !result.value.text) return failure("DAYTIME_JOB_NARRATION_FAILED", result && result.error && result.error.message || "Job narration request failed.");
        return { ok: true, text: result.value.text, locationId: activity.workLocationId, type: "day_job_work", visibleToHuman: true };
    }

    async function requestHuntingNarration(record, round, client) {
        const activity = record.definition;
        const world = currentWorld();
        const weather = world.environment && world.environment.weatherNarrative || "";
        const messages = [{
            role: "system",
            content: [
                "Narrate one coarse round of a solo hunting day in an RPG.",
                "AUTHORITATIVE TIME PHASE: Day. The engine transitions to Evening only after every daytime round and deterministic boundary processing finish. This narration must remain within Day: it may anticipate returning for evening, but must not narrate Evening/Night as already begun or advance to the next morning.",
                "Write 1-3 concise grounded sentences describing the Human-controlled Traveler hunting small game around the configured stream and nearby woods.",
                "The Traveler is committed to hunting for the day; do not ask for player input.",
                "Do not determine or mention the final number of pelts or any other reward. Do not create tracked items, money, injuries, movement to another named location, or other formal state changes.",
                "Return plain prose only."
            ].join(" ")
        }, {
            role: "user",
            content: JSON.stringify({ round: round, totalRounds: ROUND_COUNT, weather: weather, narrationInstructions: activity.narrationInstructions || "" })
        }];
        try {
            const result = await setup.AIRequestExecutor.executeCustom({
                actorId: null,
                purpose: "daytime-hunting-narration",
                stage: "daytime-hunting-narration",
                messages: clone(messages),
                requestOptions: setup.AIRequestProfiles.resolve("daytime-hunting-narration", { actorId: null }),
                client: client || setup.OpenRouterClient,
                run: async function (policyClient) {
                    const response = await policyClient.chat(messages);
                    if (!response || !response.ok) return failure("DAYTIME_HUNT_NARRATION_FAILED", response && response.error && response.error.message || "Hunting narration request failed.");
                    const parsed = textResult(response.content, "DAYTIME_HUNT_NARRATION_EMPTY");
                    if (!parsed.ok) return parsed;
                    return { ok: true, value: { text: parsed.text }, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content || "", trace: null };
                }
            });
            if (result && result.ok && result.value && result.value.text) return result.value.text;
        } catch (error) {
            // Optional presentation fallback below.
        }
        return "The Traveler spends this stretch of the day quietly stalking small game through the woods around the stream.";
    }

    function settlementMessages(record, committedFacts) {
        const active = record.active;
        const activity = record.definition;
        const sponsorId = active.sponsorCharacterId;
        const context = setup.ContextBuilder.build(sponsorId, { pendingObservations: [] });
        if (!context || context.ok === false) return context;
        const settlement = activity.settlement || {};
        context.daytimeSettlement = {
            activity: clone(activity),
            worker: { id: active.humanCharacterId, name: characterName(active.humanCharacterId) },
            committedFacts: (committedFacts || []).slice(-40),
            allowedReward: clone(settlement)
        };
        let contract;
        if (settlement.type === "sponsor_items") {
            contract = `Return exactly one JSON object {"items":[{"definitionId":"allowed_definition_id","count":positive_integer}, ...]}. The total count across all entries must be ${settlement.minTotal}-${settlement.maxTotal}. Only these definition IDs are allowed: ${(settlement.definitionIds || []).join(", ")}. Do not include duplicate definition IDs or any other keys.`;
        } else if (settlement.type === "sponsor_gold") {
            contract = `Return exactly one JSON object {"gold":integer}. gold must be from ${settlement.min} through ${settlement.max}, inclusive. Do not include any other keys.`;
        } else {
            return failure("DAYTIME_SETTLEMENT_POLICY_INVALID", "Unsupported sponsor settlement policy.");
        }
        return { ok: true, context: context, messages: [{
            role: "system",
            content: [
                "You are the sponsoring character choosing the reward after a completed full day of work by the Human-controlled Traveler.",
                "Use your complete supplied character context, including personality, memories and relationships, when choosing within the authored reward range.",
                "This request can only choose the reward. Do not speak, narrate, move, perform another action, or alter the world.",
                contract,
                "Return JSON only."
            ].join(" ")
        }, {
            role: "user",
            content: JSON.stringify({ context: context, requiredRewardContract: clone(settlement) })
        }] };
    }

    function parseJsonObject(text) {
        let raw = String(text || "").trim();
        if (raw.startsWith("```") && raw.endsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
        try {
            const value = JSON.parse(raw);
            return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value: value } : failure("DAYTIME_SETTLEMENT_INVALID", "Settlement response must be one JSON object.");
        } catch (error) {
            return failure("DAYTIME_SETTLEMENT_INVALID", "Settlement response was not valid JSON.");
        }
    }

    function validateSponsorReward(activity, value) {
        const settlement = activity.settlement || {};
        if (settlement.type === "sponsor_gold") {
            if (Object.keys(value).length !== 1 || !Number.isInteger(value.gold) || value.gold < settlement.min || value.gold > settlement.max) {
                return failure("DAYTIME_SETTLEMENT_INVALID", `Gold reward must be an integer from ${settlement.min} to ${settlement.max}.`);
            }
            return { ok: true, value: { gold: value.gold } };
        }
        if (settlement.type === "sponsor_items") {
            if (Object.keys(value).length !== 1 || !Array.isArray(value.items) || value.items.length < 1) return failure("DAYTIME_SETTLEMENT_INVALID", "Item reward must contain only a non-empty items array.");
            const allowed = new Set(settlement.definitionIds || []);
            const seen = new Set();
            let total = 0;
            const items = [];
            for (const record of value.items) {
                if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join(",") !== "count,definitionId" ||
                        typeof record.definitionId !== "string" || !allowed.has(record.definitionId) || seen.has(record.definitionId) ||
                        !Number.isInteger(record.count) || record.count < 1) {
                    return failure("DAYTIME_SETTLEMENT_INVALID", "Item reward contained an invalid or duplicate item entry.");
                }
                seen.add(record.definitionId);
                total += record.count;
                items.push({ definitionId: record.definitionId, count: record.count });
            }
            if (total < settlement.minTotal || total > settlement.maxTotal) return failure("DAYTIME_SETTLEMENT_INVALID", `Total item reward must be ${settlement.minTotal}-${settlement.maxTotal}.`);
            return { ok: true, value: { items: items } };
        }
        return failure("DAYTIME_SETTLEMENT_POLICY_INVALID", "Unsupported sponsor settlement policy.");
    }

    async function requestSponsorReward(record, committedFacts, client) {
        const built = settlementMessages(record, committedFacts);
        if (!built.ok) return built;
        const sponsorId = record.active.sponsorCharacterId;
        let messages = built.messages;
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await setup.AIRequestExecutor.executeCustom({
                actorId: sponsorId,
                purpose: "daytime-job-settlement",
                stage: "daytime-job-settlement",
                messages: clone(messages),
                requestOptions: setup.AIRequestProfiles.resolve("daytime-job-settlement", { actorId: sponsorId }),
                client: client || setup.OpenRouterClient,
                run: async function (policyClient) {
                    const response = await policyClient.chat(messages);
                    if (!response || !response.ok) return failure("DAYTIME_SETTLEMENT_REQUEST_FAILED", response && response.error && response.error.message || "Settlement request failed.");
                    return { ok: true, value: { raw: response.content || "" }, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content || "", trace: null };
                }
            });
            if (!result || !result.ok) return failure("DAYTIME_SETTLEMENT_REQUEST_FAILED", result && result.error && result.error.message || "Settlement request failed.");
            const parsed = parseJsonObject(result.value.raw);
            const validated = parsed.ok ? validateSponsorReward(record.definition, parsed.value) : parsed;
            if (validated.ok) return validated;
            if (attempt === 0) {
                messages = messages.concat([{ role: "assistant", content: String(result.value.raw || "") }, { role: "user", content: `Your reward response was invalid: ${validated.error.message} Return only a corrected JSON object matching the original contract.` }]);
            } else {
                return validated;
            }
        }
        return failure("DAYTIME_SETTLEMENT_INVALID", "Settlement could not be validated.");
    }

    function createItemInstance(definitionId, inventoryId) {
        const world = currentWorld();
        const definition = world.itemDefinitions[definitionId];
        const inventory = world.inventories[inventoryId];
        if (!definition || !inventory) throw Object.assign(new Error("Settlement item definition or inventory is missing."), { code: "DAYTIME_SETTLEMENT_ITEM_INVALID" });
        if (!Number.isInteger(world.nextGeneratedItemId) || world.nextGeneratedItemId < 1) world.nextGeneratedItemId = 1;
        let id;
        do {
            id = `generated_${definitionId}_${world.nextGeneratedItemId++}`;
        } while (world.entities[id]);
        world.entities[id] = { id: id, type: "item", definitionId: definition.id, name: definition.name, containerId: inventoryId };
        inventory.itemIds.push(id);
        return id;
    }

    function rewardTextForItems(actorName, items) {
        return items.map(function (record) {
            const definition = currentWorld().itemDefinitions[record.definitionId];
            return `${record.count} ${definition && definition.name || record.definitionId}${record.count === 1 ? "" : "s"}`;
        }).join(" and ");
    }

    function completionDiscoveryRecord(activity, human, randomFn) {
        const discovery = activity && activity.completionDiscovery;
        if (!discovery || typeof discovery !== "object" || !human) return null;
        const world = currentWorld();
        if (setup.GameInternals.characterHasDiscoveredLocation(human, discovery.locationId, world)) return null;
        const random = typeof randomFn === "function" ? randomFn : Math.random;
        if (random() >= Number(discovery.chance)) return null;
        if (!setup.GameInternals.grantLocationDiscovery(human, discovery.locationId, world)) return null;
        const location = world.entities[discovery.locationId];
        const text = String(discovery.observationText || "{actorName} discovered a concealed place.")
            .replace(/\{actorName\}/g, human.name)
            .replace(/\{locationName\}/g, location && location.name || discovery.locationId);
        enqueueGroundedObservation(human.id, "LOCATION_DISCOVERED", text, {
            actorId: human.id,
            targetId: human.id,
            locationId: discovery.locationId,
            activityId: activity.id
        });
        return { text: text, actorIds: [human.id], locationId: activity.workLocationId, kind: "location_discovered", visibleToHuman: true };
    }

    async function settleActivity(record, committedFacts, client, randomFn) {
        const world = currentWorld();
        const activity = record.definition;
        const active = record.active;
        const human = world.entities[active.humanCharacterId];
        if (!human) return failure("DAYTIME_SETTLEMENT_HUMAN_MISSING", "The working Traveler no longer exists.");
        const snapshot = clone(world);
        try {
            let text;
            const actorIds = [human.id];
            if (activity.kind === "sponsored_job") actorIds.unshift(active.sponsorCharacterId);
            if (activity.settlement.type === "random_items") {
                const random = typeof randomFn === "function" ? randomFn : Math.random;
                const count = activity.settlement.minTotal + Math.floor(random() * (activity.settlement.maxTotal - activity.settlement.minTotal + 1));
                for (let i = 0; i < count; i++) createItemInstance(activity.settlement.definitionId, human.inventoryId);
                const definition = world.itemDefinitions[activity.settlement.definitionId];
                text = `${human.name} finished the day of hunting with ${count} ${definition.name}${count === 1 ? "" : "s"}.`;
            } else {
                const chosen = await requestSponsorReward(record, committedFacts, client);
                if (!chosen.ok) return chosen;
                const sponsor = world.entities[active.sponsorCharacterId];
                if (activity.settlement.type === "sponsor_gold") {
                    human.wallet += chosen.value.gold;
                    text = `${sponsor.name} paid ${human.name} ${chosen.value.gold} gold for the completed day of work.`;
                } else if (activity.settlement.type === "sponsor_items") {
                    chosen.value.items.forEach(function (itemRecord) {
                        for (let i = 0; i < itemRecord.count; i++) createItemInstance(itemRecord.definitionId, human.inventoryId);
                    });
                    text = `${sponsor.name} gave ${human.name} ${rewardTextForItems(sponsor.name, chosen.value.items)} for the completed day of work.`;
                } else {
                    throw Object.assign(new Error("Unsupported daytime settlement policy."), { code: "DAYTIME_SETTLEMENT_POLICY_INVALID" });
                }
            }
            const records = [{ text: text, actorIds: actorIds, locationId: activity.workLocationId, kind: "day_activity_settlement", visibleToHuman: true }];
            const discoveryRecord = completionDiscoveryRecord(activity, human, randomFn);
            if (discoveryRecord) records.push(discoveryRecord);
            const validation = setup.Game.validateWorld();
            if (!validation.ok) throw validation.error;
            return { ok: true, records: records };
        } catch (error) {
            restoreWorld(snapshot);
            return failure(error && error.code || "DAYTIME_SETTLEMENT_FAILED", error && error.message || "Daytime settlement failed.");
        }
    }

    function activityFailureObservation(record, error) {
        const world = currentWorld();
        const active = record.active;
        const activity = record.definition;
        const human = world.entities[active.humanCharacterId];
        const sponsor = active.sponsorCharacterId && world.entities[active.sponsorCharacterId];
        const text = `${activity.name} could not begin because the worksite could not be reached: ${error.message}`;
        if (sponsor) enqueueGroundedObservation(sponsor.id, "DAY_WORKSITE_UNREACHABLE", text, { actorId: human && human.id || null, targetId: sponsor.id, activityId: activity.id });
        if (human) enqueueGroundedObservation(human.id, "DAY_WORKSITE_UNREACHABLE", text, { actorId: sponsor && sponsor.id || null, targetId: human.id, activityId: activity.id });
        return text;
    }

    async function runDaytime(client, options) {
        options = options && typeof options === "object" ? options : {};
        if (inFlight) return failure("TIMELAPSE_IN_FLIGHT", "A daytime timelapse is already in progress.");
        if (setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight()) return failure("TIMELAPSE_BUSY", "Another AI request is already in progress.");
        const record = activeActivityRecord();
        if (!record) return failure("DAY_ACTIVITY_MISSING", "No daytime activity is active.");
        const world = currentWorld();
        if (!world.environment || world.environment.timePhase !== "morning") return failure("DAY_ACTIVITY_NOT_MORNING", "A daytime timelapse can only begin during Morning.");
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before beginning a daytime activity.");

        const preflightSnapshot = clone(world);
        const movement = moveWorkingPair(record);
        if (!movement.ok) {
            restoreWorld(preflightSnapshot);
            const restored = currentWorld();
            const restoredRecord = { active: clone(restored.daytime.activeActivity), definition: restored.dayActivities[record.definition.id] };
            restored.daytime.activeActivity = null;
            const text = activityFailureObservation(restoredRecord, movement.error);
            return recordFinalTimelapseResult({ ok: false, mode: MODE, humanId: record.active.humanCharacterId, rounds: ROUND_COUNT, committedRounds: 0, failedStage: "worksite-preflight", hiddenNarrativeEntries: [], committedFacts: [text], error: clone(movement.error) }, "worksite-preflight");
        }

        Object.values(currentWorld().entities).forEach(function (entity) {
            if (entity && entity.type === "character") entity.sleeping = false;
        });
        setTimePhase("daytime_timelapse");
        const fixedPlans = {};
        const passiveParticipants = [];
        if (record.definition.kind === "sponsored_job") {
            fixedPlans[record.active.sponsorCharacterId] = {
                steps: Array.from({ length: ROUND_COUNT }, function () {
                    return { locationId: record.definition.workLocationId, action: { type: "day_job_work" } };
                })
            };
            passiveParticipants.push({
                characterId: record.active.humanCharacterId,
                activity: `${characterName(record.active.humanCharacterId)} is occupied working with ${characterName(record.active.sponsorCharacterId)} and will not respond or take interactive actions until the daytime timelapse ends.`
            });
        } else {
            passiveParticipants.push({
                characterId: record.active.humanCharacterId,
                activity: `${characterName(record.active.humanCharacterId)} is away hunting alone for the day and will not respond or take interactive actions until the daytime timelapse ends.`
            });
        }

        inFlight = true;
        try {
            const coreOptions = Object.assign({}, options, {
                mode: MODE,
                roundCount: ROUND_COUNT,
                fixedPlans: fixedPlans,
                passiveParticipants: passiveParticipants,
                executeFixedAction: record.definition.kind === "sponsored_job" ? async function (details) {
                    return requestWorkNarration(record, details.round, details.committedFacts, client);
                } : undefined,
                afterRoundActivities: record.definition.kind === "solo" ? async function (details) {
                    const text = await requestHuntingNarration(record, details.round, client);
                    return { ok: true, records: [{ text: text, actorIds: [record.active.humanCharacterId], locationId: record.definition.workLocationId, kind: "daytime_hunting", visibleToHuman: true }] };
                } : undefined,
                beforeReflection: async function (details) {
                    return settleActivity(record, details.committedFacts, client, options.random);
                }
            });
            const result = await setup.TimelapseCore.run(client, coreOptions);
            if (!result.ok && (result.committedRounds || 0) === 0) {
                restoreWorld(preflightSnapshot);
            }
            const current = currentWorld();
            Object.values(current.entities).forEach(function (entity) {
                if (entity && entity.type === "character") entity.sleeping = false;
            });
            current.daytime.activeActivity = null;
            if (!result.ok) {
                setTimePhase("morning");
                const validationFailed = setup.Game.validateWorld();
                if (!validationFailed.ok) return recordFinalTimelapseResult(Object.assign({}, result, { failedStage: "wrapper-validation", error: clone(validationFailed.error) }), "wrapper-validation");
                return recordFinalTimelapseResult(result, result.failedStage || "core-failed");
            }
            if (typeof options.onProgress === "function") {
                try { options.onProgress({ stage: "weather", text: "Updating weather…", mode: MODE }); } catch (error) { /* presentation-only */ }
            }
            if (setup.WorldEnvironment && typeof setup.WorldEnvironment.refreshWeather === "function") {
                try { await setup.WorldEnvironment.refreshWeather(client || setup.OpenRouterClient); } catch (error) { /* optional weather never blocks */ }
            }
            Object.values(currentWorld().entities).forEach(function (entity) {
                if (entity && entity.type === "character") entity.sleeping = false;
            });
            const routineAnchorWarnings = [];
            if (setup.TimelapseAPI && typeof setup.TimelapseAPI.applyRoutineAnchor === "function") {
                if (typeof options.onProgress === "function") {
                    try { options.onProgress({ stage: "routine-anchors", text: "Returning characters to their evening routines…", mode: MODE }); } catch (error) { /* presentation-only */ }
                }
                Object.values(currentWorld().entities).forEach(function (entity) {
                    if (!entity || entity.type !== "character" || (setup.WeeklyRhythm && !setup.WeeklyRhythm.isCharacterPresent(entity, currentWorld()))) return;
                    const anchored = setup.TimelapseAPI.applyRoutineAnchor(entity.id, "evening");
                    if (!anchored.ok) routineAnchorWarnings.push({ characterId: entity.id, error: clone(anchored.error) });
                });
            }
            if (routineAnchorWarnings.length) result.routineAnchorWarnings = routineAnchorWarnings;
            setTimePhase("evening");
            const validation = setup.Game.validateWorld();
            if (!validation.ok) return recordFinalTimelapseResult({ ok: false, mode: MODE, humanId: record.active.humanCharacterId, rounds: ROUND_COUNT, committedRounds: result.committedRounds || 0, failedStage: "wrapper-validation", hiddenNarrativeEntries: clone(result.hiddenNarrativeEntries || []), committedFacts: clone(result.committedFacts || []), error: clone(validation.error) }, "wrapper-validation");
            return recordFinalTimelapseResult(result, "complete");
        } finally {
            inFlight = false;
        }
    }

    setup.DaytimeTimelapse = {
        MODE: MODE,
        ROUND_COUNT: ROUND_COUNT,
        run: runDaytime,
        isInFlight: function () { return inFlight; },
        hasPendingOffer: function () { return Boolean(getPendingOffer()); },
        getPendingOffer: getPendingOffer,
        notePausedReactionIds: notePausedReactionIds,
        declinePendingOffer: declinePendingOffer,
        acceptPendingOffer: acceptPendingOffer
    };
}());
