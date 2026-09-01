(function () {
    "use strict";

    const DEFAULT_MODE = "timelapse";
    const DEFAULT_ROUND_COUNT = 1;
    const TimelapseProtocol = setup.TimelapseProtocol;
    if (!TimelapseProtocol) throw new Error("TimelapseProtocol must load before TimelapseCore.");
    function isDaytimeMode(mode) { return String(mode || DEFAULT_MODE) === "daytime"; }

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

    function setTimePhase(phase) {
        if (setup.WorldEnvironment && typeof setup.WorldEnvironment.setTimePhase === "function") {
            return setup.WorldEnvironment.setTimePhase(phase);
        }
        const world = setup.Game.getWorld();
        const snapshot = clone(world);
        const previousLegacyTime = typeof State !== "undefined" && State.variables ? State.variables.time : undefined;
        if (!world.environment) world.environment = {};
        world.environment.timePhase = phase;
        const labels = { evening: "Evening", nighttime_timelapse: "Night", morning: "Morning", daytime_timelapse: "Day" };
        if (typeof State !== "undefined" && State.variables) State.variables.time = labels[phase] || phase;
        const validation = setup.Game.validateWorld();
        if (!validation.ok) {
            State.variables.world = snapshot;
            if (typeof State !== "undefined" && State.variables) {
                if (previousLegacyTime === undefined) delete State.variables.time;
                else State.variables.time = previousLegacyTime;
            }
            return validation;
        }
        return { ok: true, value: { timePhase: phase, timeLabel: labels[phase] || phase } };
    }

    function recordFinalResult(result, finalStage) {
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

    function aiCharacterIds() {
        const world = setup.Game.getWorld();
        return Object.values(world.entities).filter(function (entity) {
            return entity && entity.type === "character" && world.control.assignments[entity.id] === "ai" &&
                (!setup.Presence || setup.Presence.isLocallyPresent(entity, world));
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

    function consumeCurrentObservations(characterId, observationIds) {
        const ids = Array.isArray(observationIds) ? observationIds.filter(Number.isInteger) : [];
        if (ids.length) setup.AIMemory.consumeObservations(characterId, ids);
    }

    function addFact(records, factsByActor, text, actorIds, locationId, kind, round, visibleToHuman) {
        if (!text) return null;
        const record = {
            id: `timelapse-${round || 0}-${records.length + 1}`,
            text: String(text),
            actorIds: clone(actorIds || []),
            locationId: locationId || null,
            kind: kind || "timelapse",
            round: round || null,
            visibleToHuman: visibleToHuman === true
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
                visibleToHuman: record.visibleToHuman === true,
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

    function emitProgress(options, stage, text, details) {
        if (!options || typeof options.onProgress !== "function") return;
        try {
            options.onProgress(Object.assign({ stage: stage, text: text }, clone(details || {})));
        } catch (error) {
            // Presentation callbacks never change canonical timelapse execution.
        }
    }

    async function resolveEncounterGroup(group, round, activities, factsByActor, publicRecords, client, mode, options) {
        const locationId = group.locationId;
        const participants = group.participants;
        const participantRecords = participants.map(function (characterId) {
            return { id: characterId, name: characterName(characterId) };
        });
        const observableActivities = participants.map(function (characterId) {
            return { characterId: characterId, name: characterName(characterId), activity: activities[characterId] || "remained here during this round" };
        });
        const passiveParticipants = (options && Array.isArray(options.passiveParticipants) ? options.passiveParticipants : []).filter(function (record) {
            const actor = record && setup.Game.getWorld().entities[record.characterId];
            return actor && actor.type === "character" && actor.locationId === locationId;
        }).map(function (record) {
            return { characterId: record.characterId, name: characterName(record.characterId), activity: record.activity || "is occupied", occupiedNonInteractive: true };
        });
        const observableWithPassive = observableActivities.concat(passiveParticipants);
        const intentResults = await Promise.all(participants.map(async function (characterId) {
            const otherActivities = observableWithPassive.filter(function (record) { return record.characterId !== characterId; });
            const result = await TimelapseProtocol.requestInteractionIntent(
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

        const resumeResult = await TimelapseProtocol.requestInteractionResume(
            round,
            locationId,
            participantRecords,
            observableWithPassive,
            intents,
            publicRecords.filter(function (record) {
                return record.kind === "timelapse_interaction" && record.locationId === locationId;
            }).map(function (record) { return record.text; }),
            client,
            mode,
            passiveParticipants
        );
        if (!resumeResult.ok) throw resumeResult.error;
        return {
            locationId: locationId,
            participants: participants,
            interactionOccurred: resumeResult.value.interactionOccurred,
            resume: resumeResult.value.interactionResume,
            skippedResolver: false,
            visibleToHuman: passiveParticipants.length > 0
        };
    }

    function appendCommittedTimelapseExperience(actorIds, sequenceId, text, kind, round) {
        if (!setup.VerbatimMemory || typeof setup.VerbatimMemory.appendTimelapseExperience !== "function") return;
        const world = setup.Game.getWorld();
        (actorIds || []).forEach(function (characterId) {
            const actor = world.entities[characterId];
            if (!actor || actor.type !== "character") return;
            setup.VerbatimMemory.appendTimelapseExperience(characterId, sequenceId, text, {
                kind: kind || "timelapse_experience",
                actorId: characterId,
                turn: Number.isInteger(round) && round > 0 ? round : Math.max(1, (world.nextEventId || 2) - 1)
            }, world);
        });
    }

    async function consolidatePreTimelapseBoundary(characterIds, client, errors) {
        if (setup.MindAuxExecutor && typeof setup.MindAuxExecutor.invalidateForTimelapse === "function") {
            setup.MindAuxExecutor.invalidateForTimelapse();
        }
        if (!setup.MemoryConsolidator || typeof setup.MemoryConsolidator.consolidateSTM !== "function") return;
        const results = await Promise.all((characterIds || []).map(async function (characterId) {
            const actor = setup.Game.getWorld().entities[characterId];
            const count = actor && actor.mind && Array.isArray(actor.mind.verbatimObservations) ? actor.mind.verbatimObservations.length : 0;
            if (count < 1) return { characterId: characterId, result: { ok: true, nothingToConsolidate: true } };
            const result = await setup.MemoryConsolidator.consolidateSTM(characterId, client || setup.OpenRouterClient, {
                forceAll: true,
                purpose: "memory-consolidation",
                trigger: "timelapse-boundary",
                concurrent: true
            });
            return { characterId: characterId, result: result };
        }));
        results.forEach(function (record) {
            if (!record.result || !record.result.ok) errors.push({
                stage: "pre-timelapse-stm",
                characterId: record.characterId,
                error: clone(record.result && record.result.error || { code: "MIND_V3_BOUNDARY_FAILED", message: "Pre-timelapse STM consolidation failed; verbatim source memory was preserved." })
            });
        });
    }

    function recordTimelapseResult(result) {
        if (setup.EmergencyDiagnostics && typeof setup.EmergencyDiagnostics.recordTimelapseResult === "function") {
            try { setup.EmergencyDiagnostics.recordTimelapseResult(result); } catch (error) { /* diagnostics never affect gameplay */ }
        }
        return result;
    }

    async function runTimelapseCore(client, options) {
        options = options && typeof options === "object" ? options : {};
        const mode = options.mode || DEFAULT_MODE;
        const roundCount = Number.isInteger(options.roundCount) && options.roundCount > 0 ? options.roundCount : DEFAULT_ROUND_COUNT;
        const humanId = setup.Game.getHumanCharacterId();
        const world = setup.Game.getWorld();
        if (setup.AIIntimacy && typeof setup.AIIntimacy.clearAll === "function") {
            const clearedIntimate = setup.AIIntimacy.clearAll(world);
            if (!clearedIntimate.ok) return recordTimelapseResult(clearedIntimate);
        } else if (world.ai && typeof world.ai === "object") {
            world.ai.intimateContexts = {};
        }
        const aiIds = aiCharacterIds();
        const allCharacterIds = Object.values(world.entities).filter(function (entity) {
            return entity && entity.type === "character" && (!setup.Presence || setup.Presence.isLocallyPresent(entity, world));
        }).map(function (entity) { return entity.id; });
        const fixedPlans = options.fixedPlans && typeof options.fixedPlans === "object" ? clone(options.fixedPlans) : {};
        const fixedActorIds = new Set(Object.keys(fixedPlans));
        aiIds.forEach(function (characterId) {
            setup.AIWorkingState.setContinuation(characterId, null);
        });
        let committedRounds = 0;
        let currentStage = "planning";
        let lastCommittedWorld = clone(world);
        const plans = {};
        const factsByActor = {};
        const publicRecords = [];
        const mindProcessingErrors = [];
        const initialObservationIds = {};
        aiIds.forEach(function (id) {
            factsByActor[id] = [];
            const actor = world.entities[id];
            initialObservationIds[id] = actor && actor.mind && Array.isArray(actor.mind.pendingObservations)
                ? actor.mind.pendingObservations.map(function (observation) { return observation.id; }).filter(Number.isInteger)
                : [];
        });

        try {
            currentStage = "pre-timelapse-stm";
            emitProgress(options, currentStage, "Preparing character memories…", { mode: mode });
            await consolidatePreTimelapseBoundary(allCharacterIds, client, mindProcessingErrors);
            lastCommittedWorld = clone(setup.Game.getWorld());
            currentStage = "planning";
            emitProgress(options, currentStage, isDaytimeMode(mode) ? "Planning daytime activity…" : "Planning the night…", { mode: mode });
            const initialPlanResults = await Promise.all(aiIds.map(async function (characterId) {
                const actor = setup.Game.getWorld().entities[characterId];
                if (!actor || actor.sleeping === true) return { characterId: characterId, skipped: true, result: null };
                if (fixedActorIds.has(characterId)) {
                    const steps = fixedPlans[characterId] && Array.isArray(fixedPlans[characterId].steps) ? clone(fixedPlans[characterId].steps) : [];
                    if (steps.length !== roundCount) return { characterId: characterId, skipped: false, result: failure("TIMELAPSE_FIXED_PLAN_INVALID", "A fixed timelapse plan must contain exactly one step per round.") };
                    return { characterId: characterId, skipped: false, fixed: true, result: { ok: true, value: { steps: steps } } };
                }
                const result = await TimelapseProtocol.requestPlan(characterId, 1, roundCount, [], null, null, client, mode);
                return { characterId: characterId, skipped: false, result: result };
            }));
            const failedPlan = initialPlanResults.find(function (record) { return !record.skipped && !record.result.ok; });
            if (failedPlan) throw failedPlan.result.error;
            initialPlanResults.forEach(function (record) {
                if (!record.skipped) plans[record.characterId] = { startRound: 1, steps: clone(record.result.value.steps) };
            });

            for (let round = 1; round <= roundCount; round++) {
                currentStage = `round-${round}`;
                emitProgress(options, currentStage, `Simulating ${mode === "daytime" ? "daytime" : "overnight"} activity — round ${round} of ${roundCount}…`, { mode: mode, round: round, totalRounds: roundCount });
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
                            appendCommittedTimelapseExperience([characterId], `r${round}-move-${characterId}`, moveResult.text, "timelapse_move", round);
                        }
                    }

                    for (const characterId of aiIds) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true || failures[characterId]) continue;
                        const plan = plans[characterId];
                        const step = plan && plan.steps[round - plan.startRound];
                        if (!step) continue;
                        const actionResult = isDaytimeMode(mode) && step.action && step.action.type === "sleep"
                            ? failure("TIMELAPSE_ACTION_NOT_ALLOWED_IN_MODE", "Sleep is not allowed during daytime timelapse.")
                            : (fixedActorIds.has(characterId) && typeof options.executeFixedAction === "function"
                                ? await options.executeFixedAction({ characterId: characterId, round: round, locationId: step.locationId, action: clone(step.action), committedFacts: TimelapseProtocol.compactFacts(factsByActor[characterId]) })
                                : setup.TimelapseAPI.executeAction(characterId, step.locationId, step.action));
                        if (!actionResult.ok) {
                            failures[characterId] = clone(actionResult.error);
                            replanReasons[characterId] = true;
                            activities[characterId] = `failed to complete the planned activity: ${actionResult.error.message}`;
                            addFact(publicRecords, factsByActor, `${characterName(characterId)} could not complete the planned activity: ${actionResult.error.message}`, [characterId], actor.locationId, "timelapse_failure", round);
                        } else {
                            activities[characterId] = actionResult.text;
                            addFact(publicRecords, factsByActor, actionResult.text, [characterId], actionResult.locationId, `timelapse_${actionResult.type}`, round, actionResult.visibleToHuman === true);
                            appendCommittedTimelapseExperience([characterId], `r${round}-action-${characterId}`, actionResult.privateExperienceText || actionResult.text, `timelapse_${actionResult.type}`, round);
                        }
                    }

                    if (typeof options.afterRoundActivities === "function") {
                        const extra = await options.afterRoundActivities({
                            mode: mode, round: round, roundCount: roundCount, humanId: humanId,
                            activities: clone(activities), committedFacts: publicRecords.map(function (record) { return record.text; })
                        });
                        if (!extra || extra.ok === false) throw extra && extra.error || structuralError("TIMELAPSE_ROUND_EXTENSION_FAILED", "Timelapse round extension failed.");
                        (extra.records || []).forEach(function (record, recordIndex) {
                            addFact(publicRecords, factsByActor, record.text, record.actorIds || [], record.locationId || null, record.kind || "timelapse", round, record.visibleToHuman === true);
                            appendCommittedTimelapseExperience(record.actorIds || [], `r${round}-extension-${recordIndex}`, record.text, record.kind || "timelapse", round);
                        });
                    }

                    const groups = new Map();
                    aiIds.forEach(function (characterId) {
                        const actor = setup.Game.getWorld().entities[characterId];
                        if (!actor || actor.sleeping === true) return;
                        if (!groups.has(actor.locationId)) groups.set(actor.locationId, []);
                        groups.get(actor.locationId).push(characterId);
                    });
                    const groupJobs = Array.from(groups.entries()).filter(function (entry) { return entry[1].length >= 2; }).map(function (entry) {
                        return resolveEncounterGroup({ locationId: entry[0], participants: entry[1] }, round, activities, factsByActor, publicRecords, client, mode, options);
                    });
                    const encounterResults = await Promise.all(groupJobs);
                    encounterResults.forEach(function (encounter) {
                        if (!encounter.interactionOccurred) return;
                        addFact(publicRecords, factsByActor, encounter.resume, encounter.participants, encounter.locationId, "timelapse_interaction", round, encounter.visibleToHuman === true);
                        appendCommittedTimelapseExperience(encounter.participants, `r${round}-interaction-${encounter.locationId || "group"}`, encounter.resume, "timelapse_interaction", round);
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
                            return actor && actor.sleeping !== true && replanReasons[characterId] && !fixedActorIds.has(characterId);
                        });
                        const replans = await Promise.all(replanCharacters.map(async function (characterId) {
                            const latestEncounter = publicRecords.slice().reverse().find(function (record) {
                                return record.kind === "timelapse_interaction" && record.actorIds.includes(characterId) && record.round === round;
                            });
                            const remaining = roundCount - round;
                            const result = await TimelapseProtocol.requestPlan(
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

            if (typeof options.beforeReflection === "function") {
                currentStage = mode === "daytime" ? "settlement" : "pre-reflection-finalization";
                const hookResult = await options.beforeReflection({
                    mode: mode,
                    humanId: humanId,
                    roundCount: roundCount,
                    committedRounds: committedRounds,
                    committedFacts: publicRecords.map(function (record) { return record.text; }),
                    factsByActor: clone(factsByActor)
                });
                if (!hookResult || hookResult.ok === false) throw hookResult && hookResult.error || structuralError("TIMELAPSE_FINALIZATION_FAILED", "Timelapse pre-reflection finalization failed.");
                (hookResult.records || []).forEach(function (record, recordIndex) {
                    addFact(publicRecords, factsByActor, record.text, record.actorIds || [], record.locationId || null, record.kind || "timelapse_settlement", null, record.visibleToHuman === true);
                    appendCommittedTimelapseExperience(record.actorIds || [], `settlement-${recordIndex}`, record.text, record.kind || "timelapse_settlement", Math.max(1, roundCount));
                });
                lastCommittedWorld = clone(setup.Game.getWorld());
            }

            currentStage = "reflection-prepare";
            emitProgress(options, currentStage, "Reflecting on the elapsed time…", { mode: mode });
            const reflectionResults = await Promise.all(aiIds.map(async function (characterId) {
                return { characterId: characterId, result: await TimelapseProtocol.requestReflection(characterId, factsByActor[characterId], client, mode) };
            }));

            currentStage = "reflection-commit";
            const reflections = [];
            reflectionResults.forEach(function (record) {
                if (!record.result || !record.result.ok) {
                    mindProcessingErrors.push({
                        stage: "reflection-prepare",
                        characterId: record.characterId,
                        error: clone(record.result && record.result.error || { code: "TIMELAPSE_REFLECTION_FAILED", message: "Post-timelapse reflection failed." })
                    });
                    return;
                }
                const commit = setup.AIMemory.applyTurnUpdates(record.characterId, record.result.value.memoryUpdates);
                if (!commit.ok) {
                    mindProcessingErrors.push({ stage: "reflection-commit", characterId: record.characterId, error: clone(commit.error) });
                    return;
                }
                reflections.push({
                    characterId: record.characterId,
                    result: clone(record.result.value),
                    partial: record.result.partial === true,
                    droppedRelationshipTargetIds: clone(record.result.droppedRelationshipTargetIds || [])
                });
            });

            const consolidations = [];
            if (setup.MemoryConsolidator && typeof setup.MemoryConsolidator.maintainTimelapse === "function") {
                currentStage = "maintenance-prepare";
                emitProgress(options, currentStage, "Consolidating memories…", { mode: mode });
                const maintenanceResults = await Promise.all(allCharacterIds.map(async function (characterId) {
                    const maintenance = await setup.MemoryConsolidator.maintainTimelapse(characterId, client || setup.OpenRouterClient, { elapsedMaintenanceUnits: 1, concurrent: true, mode: mode });
                    return { characterId: characterId, result: maintenance };
                }));
                maintenanceResults.forEach(function (record) {
                    consolidations.push({ characterId: record.characterId, result: clone(record.result) });
                    if (!record.result.ok) mindProcessingErrors.push({
                        stage: "maintenance",
                        characterId: record.characterId,
                        error: clone(record.result.error || { code: "MIND_V3_TIMELAPSE_MAINTENANCE_PARTIAL", message: "Timelapse mind maintenance was only partially completed; source memory was preserved." })
                    });
                });
            }

            currentStage = "final-validation";
            emitProgress(options, currentStage, "Finishing timelapse…", { mode: mode });
            const validation = setup.Game.validateWorld();
            if (!validation.ok) throw validation.error;

            return recordTimelapseResult({
                ok: true,
                mode: mode,
                humanId: humanId,
                rounds: roundCount,
                committedRounds: committedRounds,
                failedStage: null,
                hiddenNarrativeEntries: hiddenEntries(publicRecords),
                committedFacts: publicRecords.map(function (record) { return record.text; }),
                reflections: reflections,
                consolidations: consolidations,
                mindProcessingErrors: clone(mindProcessingErrors)
            });
        } catch (error) {
            State.variables.world = clone(lastCommittedWorld);
            return recordTimelapseResult({
                ok: false,
                mode: mode,
                humanId: humanId,
                rounds: roundCount,
                committedRounds: committedRounds,
                failedStage: currentStage,
                hiddenNarrativeEntries: hiddenEntries(publicRecords),
                committedFacts: publicRecords.map(function (record) { return record.text; }),
                mindProcessingErrors: clone(mindProcessingErrors),
                error: {
                    code: error && error.code || "TIMELAPSE_FAILED",
                    message: error && error.message || "The timelapse failed.",
                    details: error && error.details ? clone(error.details) : undefined,
                    providerResponse: error && error.providerResponse ? clone(error.providerResponse) : undefined
                }
            });
        }
    }

    setup.TimelapseCore = {
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_ROUND_COUNT: DEFAULT_ROUND_COUNT,
        run: runTimelapseCore,
        validatePlan: TimelapseProtocol.validatePlan,
        setTimePhase: setTimePhase,
        recordFinalResult: recordFinalResult
    };
}());
