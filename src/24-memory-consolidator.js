(function () {
    "use strict";

    const M = setup.MindV3;
    const V = setup.MindValidators;

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }
    function stableUniqueStrings(values) { return Array.from(new Set((values || []).filter(function (value) { return typeof value === "string" && value; }))); }

    const P = setup.MindConsolidationProtocols;
    const normalizeStmBeliefReferences = P.normalizeStmBeliefReferences;
    const normalizeLtmResponseIngress = P.normalizeLtmResponseIngress;
    const normalizeReconciliationIngress = P.normalizeReconciliationIngress;
    const validateStmResponse = P.validateStmResponse;
    const validateLtmPreflightResponse = P.validateLtmPreflightResponse;
    const validateLtmResponse = P.validateLtmResponse;
    const validateReconciliationResponse = P.validateReconciliationResponse;
    const reconciliationCandidates = P.reconciliationCandidates;
    const stmSystem = P.stmSystem;
    const ltmPreflightSystem = P.ltmPreflightSystem;
    const ltmSystem = P.ltmSystem;
    const reconciliationSystem = P.reconciliationSystem;

    function recordTransientResult(result) {
        if (!setup.AITransientDebug) return;
        setup.AITransientDebug.lastUsage = result && result.usage ? clone(result.usage) : null;
        setup.AITransientDebug.lastSafeError = result && !result.ok && result.error ? result.error.message : "";
    }

    function characterSnapshot(characterId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character") return failure("ACTOR_NOT_FOUND", "Character does not exist.");
        const mind = clone(actor.mind);
        if (setup.VerbatimMemory && typeof setup.VerbatimMemory.withWorldStateAuthority === "function") {
            mind.verbatimObservations = (mind.verbatimObservations || []).map(function (record) {
                return setup.VerbatimMemory.withWorldStateAuthority(record, world);
            });
        }
        return {
            ok: true,
            characterId: characterId,
            mindRevision: Number.isInteger(actor.mindRevision) ? actor.mindRevision : 0,
            mind: mind,
            character: setup.CharacterContext.buildPrivateCharacter(characterId),
            recentDialogue: clone(setup.MindValidators.sanitizeRecentDialogue(actor.recentDialogue, world))
        };
    }

    function beliefIds(mind) { return new Set((mind.beliefs || []).map(function (belief) { return belief.id; })); }
    function memoryIds(mind, partition) { return new Set((mind[partition] || []).map(function (memory) { return memory.id; })); }

    async function runJsonRequest(characterId, stage, systemText, payload, validator, client, options) {
        options = options || {};
        const messages = [
            { role: "system", content: systemText },
            { role: "user", content: JSON.stringify(payload) }
        ];
        const execute = options.concurrent && setup.AIRequestExecutor.executeCustomConcurrent ? setup.AIRequestExecutor.executeCustomConcurrent : setup.AIRequestExecutor.executeCustom;
        const requestOptions = setup.AIRequestProfiles.resolve(options.requestProfile || "memory-consolidation", { actorId: characterId });
        const result = await execute({
            actorId: characterId,
            purpose: options.purpose || "memory-consolidation",
            stage: stage,
            messages: messages,
            requestOptions: requestOptions,
            client: client || setup.OpenRouterClient,
            run: function (policyClient) {
                return setup.StructuredAIRequest.run(policyClient, {
                    stage: stage,
                    messages: messages,
                    requestOptions: requestOptions,
                    validate: validator,
                    maxRepairAttempts: 1,
                    validationErrorCode: "INVALID_MODEL_JSON",
                    validationErrorMessage: "The model returned invalid Mind v3 protocol data.",
                    parseErrorCode: "INVALID_MODEL_JSON",
                    parseErrorMessage: "The model returned malformed Mind v3 JSON.",
                    traceMessages: false,
                    buildRepairMessages: function (baseMessages, responseContent, errors) {
                        const repairInstruction = options.repairInstruction || "If an upsert has no material effect after normalization, omit that upsert entirely; do not invent a cosmetic wording change merely to make it different.";
                        return clone(baseMessages).concat([
                            { role: "assistant", content: String(responseContent || "").slice(0, 12000) },
                            { role: "user", content: `Your previous response failed validation: ${errors.join("; ")}. Return the complete corrected JSON object only, using exactly the requested keys and supplied IDs. ${repairInstruction}` }
                        ]);
                    }
                });
            }
        });
        recordTransientResult(result);
        return result;
    }

    function diagnosticTurn(world) { return Number.isInteger(world.nextEventId) ? Math.max(1, world.nextEventId) : 1; }

    function allocateBeliefId(world, actor) {
        const ids = new Set((actor.mind.beliefs || []).map(function (belief) { return belief.id; }));
        let id;
        do { id = `belief_ai_${world.nextMemoryId++}`; } while (ids.has(id));
        return id;
    }

    function applyBeliefEffects(actor, effects, activatedIds, source, world) {
        let changed = false;
        const activationSet = new Set(activatedIds || []);
        (effects || []).forEach(function (effect) {
            const belief = actor.mind.beliefs.find(function (entry) { return entry.id === effect.beliefId; });
            if (!belief) return;
            const beforeConfidence = belief.confidence;
            const beforeActivation = belief.activation;
            const afterConfidence = M.updateConfidence(beforeConfidence, effect.effect, effect.strength);
            const afterActivation = M.bumpActivation(beforeActivation, Math.max(0.2, effect.strength), effect.strength >= 0.7);
            belief.confidence = afterConfidence;
            belief.activation = afterActivation;
            changed = changed || afterConfidence !== beforeConfidence || afterActivation !== beforeActivation;
            setup.AIMemory.addBeliefDiagnostic(actor, belief.id, {
                atTurn: diagnosticTurn(world), source: source, effect: effect.effect, deltaConfidence: afterConfidence - beforeConfidence,
                deltaActivation: afterActivation - beforeActivation
            });
            activationSet.delete(belief.id);
        });
        activationSet.forEach(function (id) {
            const belief = actor.mind.beliefs.find(function (entry) { return entry.id === id; });
            if (!belief) return;
            const before = belief.activation;
            const after = M.bumpActivation(before, 0.35, false);
            belief.activation = after;
            changed = changed || after !== before;
            setup.AIMemory.addBeliefDiagnostic(actor, id, { atTurn: diagnosticTurn(world), source: source, deltaActivation: after - before });
        });
        return changed;
    }

    function applyBeliefAdds(world, actor, records, source) {
        let changed = false;
        (records || []).forEach(function (record) {
            const id = allocateBeliefId(world, actor);
            const belief = {
                id: id,
                text: record.text.trim(),
                confidence: M.normalizeConfidence(record.initialConfidence),
                activation: M.normalizeActivation(record.initialActivation, M.CONFIG.NEW_BELIEF_ACTIVATION)
            };
            actor.mind.beliefs.push(belief);
            setup.AIMemory.addBeliefDiagnostic(actor, id, { atTurn: diagnosticTurn(world), source: source, effect: "induced", deltaConfidence: null, deltaActivation: belief.activation });
            changed = true;
        });
        return changed;
    }

    function recoveryContextFromSnapshot(snapshot, trigger) {
        return {
            actorId: snapshot.characterId,
            trigger: trigger || "manual",
            preMind: clone(snapshot.mind),
            persisted: false
        };
    }

    function appendRecoverySnapshot(candidateActor, candidateWorld, recoveryContext, changed) {
        if (!changed || !recoveryContext || recoveryContext.persisted) return false;
        const records = setup.AIMemory.sanitizeMaintenanceSnapshots(candidateActor.mindMaintenanceSnapshots);
        records.push({
            createdAt: new Date().toISOString(),
            turn: diagnosticTurn(candidateWorld),
            trigger: recoveryContext.trigger || "manual",
            mind: clone(recoveryContext.preMind)
        });
        candidateActor.mindMaintenanceSnapshots = records.slice(-setup.AIMemory.MAINTENANCE_SNAPSHOT_LIMIT);
        return true;
    }

    function validateCandidateWorld(candidate) {
        const validation = setup.GameInternals.validateWorld(candidate);
        return validation.ok ? { ok: true } : failure("MIND_V3_CANDIDATE_INVALID", validation.error.message);
    }

    function staleBase(snapshot, actor) {
        return !actor || actor.type !== "character" || actor.mindRevision !== snapshot.mindRevision;
    }

    function stmCompatibilityProjection(mind) {
        mind = mind || {};
        return {
            schemaVersion: mind.schemaVersion,
            shortTermMemories: clone(mind.shortTermMemories || []),
            longTermMemories: clone(mind.longTermMemories || []),
            relationships: clone(mind.relationships || []),
            beliefs: (mind.beliefs || []).map(function (belief) {
                return { id: belief.id, text: belief.text, confidence: belief.confidence };
            })
        };
    }

    function stmSnapshotCompatible(snapshot, actor) {
        if (!actor || actor.type !== "character" || !actor.mind) return false;
        return JSON.stringify(stmCompatibilityProjection(actor.mind)) === JSON.stringify(stmCompatibilityProjection(snapshot.mind));
    }

    function applyStmCommit(characterId, snapshot, evictionIds, value, trigger, recoveryContext) {
        const current = setup.Game.getWorld();
        const actor = current.entities[characterId];
        if (!stmSnapshotCompatible(snapshot, actor)) return failure("MIND_V3_STALE", "Mind content changed incompatibly while STM consolidation was in flight.");
        const currentById = new Map((actor.mind.verbatimObservations || []).map(function (record) { return [record.id, record]; }));
        for (const record of snapshot.mind.verbatimObservations || []) {
            const currentRecord = currentById.get(record.id);
            const normalizedCurrent = currentRecord && setup.VerbatimMemory && typeof setup.VerbatimMemory.withWorldStateAuthority === "function"
                ? setup.VerbatimMemory.withWorldStateAuthority(currentRecord, current)
                : currentRecord;
            if (!currentRecord || JSON.stringify(normalizedCurrent) !== JSON.stringify(record)) return failure("MIND_V3_STALE", "Verbatim source snapshot changed while STM consolidation was in flight.");
        }
        const candidate = clone(current);
        const cActor = candidate.entities[characterId];
        let changed = false;
        value.shortTermMemoriesToUpsert.forEach(function (proposal) {
            const index = cActor.mind.shortTermMemories.findIndex(function (memory) { return memory.id === proposal.id; });
            if (index < 0 || cActor.mind.shortTermMemories[index].protected) return;
            const replacement = Object.assign({}, cActor.mind.shortTermMemories[index], { topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, retrievalBrief: String(proposal.retrievalBrief || "").trim() });
            if (JSON.stringify(replacement) !== JSON.stringify(cActor.mind.shortTermMemories[index])) { cActor.mind.shortTermMemories[index] = replacement; changed = true; }
        });
        value.shortTermMemoriesToAdd.forEach(function (proposal) {
            cActor.mind.shortTermMemories.push({ id: setup.AIMemory.allocateMemoryId(candidate), topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, protected: false, retrievalBrief: String(proposal.retrievalBrief || "").trim() });
            changed = true;
        });
        value.stmRepartitions.forEach(function (operation) {
            const sourceIds = new Set(operation.sourceStmIds);
            const original = cActor.mind.shortTermMemories;
            const firstSourceIndex = original.findIndex(function (memory) { return sourceIds.has(memory.id); });
            const insertionIndex = original.slice(0, Math.max(0, firstSourceIndex)).filter(function (memory) { return !sourceIds.has(memory.id); }).length;
            const sourceById = new Map(original.filter(function (memory) { return sourceIds.has(memory.id); }).map(function (memory) { return [memory.id, memory]; }));
            const replacements = operation.replacementRecords.map(function (proposal) {
                if (Object.prototype.hasOwnProperty.call(proposal, "id")) {
                    const source = sourceById.get(proposal.id);
                    return Object.assign({}, source, { topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, retrievalBrief: String(proposal.retrievalBrief || "").trim() });
                }
                return { id: setup.AIMemory.allocateMemoryId(candidate), topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, protected: false, retrievalBrief: String(proposal.retrievalBrief || "").trim() };
            });
            const survivors = original.filter(function (memory) { return !sourceIds.has(memory.id); });
            survivors.splice.apply(survivors, [insertionIndex, 0].concat(replacements));
            cActor.mind.shortTermMemories = survivors;
            changed = true;
        });
        changed = applyBeliefEffects(cActor, value.beliefEffects, value.activatedBeliefIds, "stm-consolidation", candidate) || changed;
        changed = applyBeliefAdds(candidate, cActor, value.beliefsToAdd, "stm-consolidation") || changed;
        const eviction = new Set(evictionIds);
        const before = cActor.mind.verbatimObservations.length;
        cActor.mind.verbatimObservations = cActor.mind.verbatimObservations.filter(function (record) { return !eviction.has(record.id); });
        if (cActor.mind.verbatimObservations.length !== before) changed = true;
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const snapshotAdded = appendRecoverySnapshot(cActor, candidate, recoveryContext, changed);
        const validation = validateCandidateWorld(candidate);
        if (!validation.ok) return validation;
        State.variables.world = candidate;
        if (snapshotAdded) recoveryContext.persisted = true;
        return { ok: true, actorId: characterId, committed: true, evictedObservationIds: evictionIds.slice(), retainedVerbatimCount: cActor.mind.verbatimObservations.length, shortTermMemoryCount: cActor.mind.shortTermMemories.length, beliefCount: cActor.mind.beliefs.length, stmRepartitionCount: value.stmRepartitions.length, stmRepartitionReplacementCount: value.stmRepartitions.reduce(function (total, operation) { return total + operation.replacementRecords.length; }, 0) };
    }

    async function consolidateSTM(characterId, client, options) {
        options = options || {};
        function finish(result) {
            if (setup.RetrievalBriefBackfill) setup.RetrievalBriefBackfill.schedule(characterId, client || setup.OpenRouterClient);
            return result;
        }
        const snapshot = characterSnapshot(characterId);
        if (!snapshot.ok) return finish(snapshot);
        const all = snapshot.mind.verbatimObservations || [];
        const forceAll = options.forceAll === true;
        if (all.length === 0) return finish({ ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: 0 });
        if (!forceAll && options.force !== true && all.length <= M.CONFIG.STM_TRIGGER_COUNT) return finish({ ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: all.length });
        const retainCount = forceAll ? 0 : M.CONFIG.VERBATIM_RETAIN_COUNT;
        const eviction = all.slice(0, Math.max(0, all.length - retainCount));
        const retained = all.slice(eviction.length);
        if (eviction.length === 0) return finish({ ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: all.length });
        const payload = {
            stage: "mind-v3-stm",
            character: snapshot.character,
            completeVerbatimSnapshot: clone(all),
            evictionObservationIds: eviction.map(function (record) { return record.id; }),
            retainedObservationIds: retained.map(function (record) { return record.id; }),
            existingShortTermMemories: clone(snapshot.mind.shortTermMemories || []),
            relevantLongTermMemories: clone(snapshot.mind.longTermMemories || []),
            relationships: clone(snapshot.mind.relationships || []),
            beliefs: clone(snapshot.mind.beliefs || []),
            beliefSemantics: M.BELIEF_SEMANTICS,
            modelOutputPolicy: {
                structuredMutationsMustHaveEffect: true,
                noOpUpserts: "omit-before-generation",
                relevanceDoesNotImplyMutation: true,
                cosmeticRewritesDoNotCountAsEffect: true
            },
            stmWritePolicy: {
                mode: "delta-only",
                maxMemoryWrites: M.CONFIG.STM_WRITE_SET_LIMIT,
                repartitionReplacementRecordsCountAsWrites: true,
                repartitionBoundary: "semantic-not-mechanical",
                repartitionAtomic: true,
                maxBeliefEffects: M.CONFIG.STM_BELIEF_EFFECT_LIMIT,
                maxBeliefsToAdd: M.CONFIG.STM_NEW_BELIEF_LIMIT,
                maxActivatedBeliefIds: M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT,
                unchangedExistingStm: "omit",
                legacyCleanup: "forbidden"
            },
            requiredResponseShape: {
                shortTermMemoriesToUpsert: [], shortTermMemoriesToAdd: [], stmRepartitions: [], beliefEffects: [], beliefsToAdd: [], activatedBeliefIds: []
            }
        };
        const result = await runJsonRequest(characterId, "mind-v3-stm", stmSystem(), payload, function (value) { return validateStmResponse(value, snapshot); }, client, {
            purpose: options.purpose || "memory-consolidation", concurrent: options.concurrent === true, requestProfile: "mind-v3-stm"
        });
        if (!result.ok) return finish(result);
        if (typeof options.beforeCommit === "function" && options.beforeCommit() === false) return finish(failure("MIND_V3_JOB_INVALIDATED", "Background mind job was invalidated before commit."));
        const trigger = options.trigger || (options.purpose === "mind-background" ? "automatic" : "manual");
        const recoveryContext = options.recoveryContext || recoveryContextFromSnapshot(snapshot, trigger);
        const commit = applyStmCommit(characterId, snapshot, payload.evictionObservationIds, result.value, trigger, recoveryContext);
        if (!commit.ok) return finish(commit);
        commit.modelId = result.modelId || null;
        commit.usage = clone(result.usage || null);
        commit.repaired = Boolean(result.repaired);
        return finish(commit);
    }

    function ltmPreflightCatalog(snapshot) {
        return (snapshot.mind.longTermMemories || []).map(function (memory) {
            return {
                id: memory.id,
                topic: String(memory.topic || ""),
                retrievalBrief: typeof memory.retrievalBrief === "string" ? memory.retrievalBrief : "",
                importance: memory.importance,
                protected: memory.protected === true
            };
        });
    }

    async function runLtmSemanticPreflight(characterId, snapshot, client, options) {
        options = options || {};
        const catalog = ltmPreflightCatalog(snapshot);
        if (catalog.length === 0) {
            return { ok: true, value: { relevantLtmIds: [] }, skipped: true, candidateLtmCount: 0, selectedLtmCount: 0, modelId: null, usage: null };
        }
        const payload = {
            stage: "mind-v3-ltm-preflight",
            character: snapshot.character,
            shortTermMemories: clone(snapshot.mind.shortTermMemories || []),
            existingLongTermMemoryCatalog: catalog,
            relationships: clone(snapshot.mind.relationships || []),
            beliefs: clone(snapshot.mind.beliefs || []),
            beliefSemantics: M.BELIEF_SEMANTICS,
            selectionPolicy: {
                mode: "high-recall-semantic",
                arbitraryCountCap: "none",
                uncertainButPlausiblyRelevant: "include",
                missingRelevantMemoryIsWorseThanExtraSelection: true,
                readOnly: true
            },
            requiredResponseShape: { relevantLtmIds: [] }
        };
        const result = await runJsonRequest(characterId, "mind-v3-ltm-preflight", ltmPreflightSystem(), payload, function (value) {
            return validateLtmPreflightResponse(value, snapshot);
        }, client, {
            purpose: options.purpose || "memory-consolidation",
            concurrent: options.concurrent === true,
            requestProfile: "mind-v3-ltm-preflight",
            repairInstruction: "Return only the complete relevantLtmIds array. Select only supplied existing LTM IDs, optimize for high recall, and include an uncertain LTM when it may plausibly matter. This stage is read-only and must not return any mutations or explanations."
        });
        if (!result.ok) return result;
        result.candidateLtmCount = catalog.length;
        result.selectedLtmCount = result.value.relevantLtmIds.length;
        return result;
    }

    function applyLtmCommit(characterId, snapshot, value, trigger, recoveryContext) {
        const current = setup.Game.getWorld();
        const actor = current.entities[characterId];
        if (staleBase(snapshot, actor)) return failure("MIND_V3_STALE", "Mind changed incompatibly while LTM consolidation was in flight.");
        const candidate = clone(current);
        const cActor = candidate.entities[characterId];
        let changed = false;
        value.longTermMemoriesToUpsert.forEach(function (proposal) {
            const index = cActor.mind.longTermMemories.findIndex(function (memory) { return memory.id === proposal.id; });
            if (index < 0 || cActor.mind.longTermMemories[index].protected) return;
            const replacement = Object.assign({}, cActor.mind.longTermMemories[index], { topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, retrievalBrief: String(proposal.retrievalBrief || "").trim() });
            if (JSON.stringify(replacement) !== JSON.stringify(cActor.mind.longTermMemories[index])) { cActor.mind.longTermMemories[index] = replacement; changed = true; }
        });
        value.longTermMemoriesToAdd.forEach(function (proposal) {
            cActor.mind.longTermMemories.push({ id: setup.AIMemory.allocateMemoryId(candidate), topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, protected: false, retrievalBrief: String(proposal.retrievalBrief || "").trim() }); changed = true;
        });
        const retire = new Set();
        value.retirementGroups.forEach(function (group) { group.stmIds.forEach(function (id) { retire.add(id); }); });
        const beforeStm = cActor.mind.shortTermMemories.length;
        cActor.mind.shortTermMemories = cActor.mind.shortTermMemories.filter(function (memory) { return memory.protected || !retire.has(memory.id); });
        changed = changed || beforeStm !== cActor.mind.shortTermMemories.length;
        changed = applyBeliefEffects(cActor, value.higherOrderBeliefEffects, value.activatedBeliefIds, "ltm-consolidation", candidate) || changed;
        changed = applyBeliefAdds(candidate, cActor, value.beliefsToAdd, "ltm-consolidation") || changed;
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const snapshotAdded = appendRecoverySnapshot(cActor, candidate, recoveryContext, changed);
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
        if (snapshotAdded) recoveryContext.persisted = true;
        const retirementStats = { represented: 0, safeToForget: 0, reasons: { routine: 0, redundant: 0, transient: 0 } };
        value.retirementGroups.forEach(function (group) {
            if (group.disposition === "represented") retirementStats.represented += group.stmIds.length;
            else {
                retirementStats.safeToForget += group.stmIds.length;
                if (Object.prototype.hasOwnProperty.call(retirementStats.reasons, group.reason)) retirementStats.reasons[group.reason] += group.stmIds.length;
            }
        });
        const provenanceSourceCount = value.longTermMemoriesToUpsert.concat(value.longTermMemoriesToAdd).reduce(function (total, proposal) {
            return total + proposal.sourceStmIds.length + proposal.sourceLtmIds.length;
        }, 0);
        return {
            ok: true, actorId: characterId, committed: true, changed: changed,
            shortTermMemoryCount: cActor.mind.shortTermMemories.length, longTermMemoryCount: cActor.mind.longTermMemories.length, beliefCount: cActor.mind.beliefs.length,
            ltmUpsertCount: value.longTermMemoriesToUpsert.length, ltmAddCount: value.longTermMemoriesToAdd.length,
            representedRetirementCount: retirementStats.represented, safeToForgetRetirementCount: retirementStats.safeToForget,
            safeToForgetReasonCounts: retirementStats.reasons, unretiredStmCount: cActor.mind.shortTermMemories.length, provenanceSourceCount: provenanceSourceCount
        };
    }

    async function consolidateLTM(characterId, client, options) {
        options = options || {};
        const snapshot = characterSnapshot(characterId); if (!snapshot.ok) return snapshot;
        if ((snapshot.mind.shortTermMemories || []).length === 0) return { ok: true, actorId: characterId, nothingToConsolidate: true };

        const preflight = await runLtmSemanticPreflight(characterId, snapshot, client, options);
        if (!preflight.ok) return preflight;
        const liveAfterPreflight = setup.Game.getWorld().entities[characterId];
        if (staleBase(snapshot, liveAfterPreflight)) return failure("MIND_V3_STALE", "Mind changed incompatibly after LTM semantic preflight and before consolidation.");

        const selectedLtmIds = stableUniqueStrings(preflight.value.relevantLtmIds);
        const selectedLtmSet = new Set(selectedLtmIds);
        const selectedExistingLtm = (snapshot.mind.longTermMemories || []).filter(function (memory) { return selectedLtmSet.has(memory.id); });
        const payload = {
            stage: "mind-v3-ltm", character: snapshot.character,
            shortTermMemories: clone(snapshot.mind.shortTermMemories || []), existingLongTermMemories: clone(selectedExistingLtm),
            ltmSemanticPreflight: {
                mode: "high-recall-semantic",
                totalExistingLtmCount: (snapshot.mind.longTermMemories || []).length,
                selectedLtmIds: selectedLtmIds.slice(),
                selectedLtmCount: selectedLtmIds.length,
                unselectedExistingLtmRemainCanonicalAndUnchanged: true
            },
            relationships: clone(snapshot.mind.relationships || []), beliefs: clone(snapshot.mind.beliefs || []), beliefSemantics: M.BELIEF_SEMANTICS,
            modelOutputPolicy: {
                structuredMutationsMustHaveEffect: true,
                noOpUpserts: "omit-before-generation",
                relevanceDoesNotImplyMutation: true,
                provenanceDoesNotCountAsEffect: true,
                cosmeticRewritesDoNotCountAsEffect: true
            },
            ltmWritePolicy: {
                mode: "evidence-driven-delta",
                operationCountLimits: "none",
                retirementMode: "coverage-groups-unbounded",
                retirementDispositions: ["represented", "safe_to_forget"],
                safeToForgetReasons: ["routine", "redundant", "transient"],
                provenanceRequired: true,
                provenanceFields: ["sourceStmIds", "sourceLtmIds"],
                unchangedExistingLtm: "omit",
                legacyCleanup: "forbidden",
                existingLtmUpsertScope: "preflight-selected-only"
            },
            higherOrderBeliefPolicy: {
                mode: "novel-cross-memory-inference-only",
                suppliedMemoriesAreContextNotFreshEvidence: true,
                suppliedBeliefsAreContextNotEvidence: true,
                consistencyDoesNotCountAsNewEvidence: true,
                directEvidenceMustNotBeCountedAgain: true,
                scanBeliefTableForCompatibleBeliefs: "forbidden",
                expectedShape: "sparse-usually-empty"
            },
            activatedBeliefPolicy: {
                mode: "materially-salient-only",
                inspectedOrCompatibleBeliefsDoNotQualify: true,
                expectedShape: "sparse-may-be-empty"
            },
            requiredResponseShape: { longTermMemoriesToUpsert: [], longTermMemoriesToAdd: [], retirementGroups: [], higherOrderBeliefEffects: [], beliefsToAdd: [], activatedBeliefIds: [] }
        };
        const result = await runJsonRequest(characterId, "mind-v3-ltm", ltmSystem(), payload, function (value) {
            return validateLtmResponse(value, snapshot, { allowedExistingLtmIds: selectedLtmSet });
        }, client, { purpose: options.purpose || "memory-consolidation", concurrent: options.concurrent === true, requestProfile: "mind-v3-ltm" });
        if (!result.ok) return result;
        const trigger = options.trigger || "manual";
        const recoveryContext = options.recoveryContext || recoveryContextFromSnapshot(snapshot, trigger);
        const commit = applyLtmCommit(characterId, snapshot, result.value, trigger, recoveryContext);
        if (!commit.ok) return commit;
        commit.modelId = result.modelId || null; commit.usage = clone(result.usage || null); commit.repaired = Boolean(result.repaired);
        commit.preflight = {
            candidateLtmCount: preflight.candidateLtmCount === undefined ? (snapshot.mind.longTermMemories || []).length : preflight.candidateLtmCount,
            selectedLtmCount: selectedLtmIds.length,
            selectedLtmIds: selectedLtmIds.slice(),
            skipped: preflight.skipped === true,
            modelId: preflight.modelId || null,
            usage: clone(preflight.usage || null)
        };
        return commit;
    }

    function relevantEvidence(snapshot, candidates) {
        const terms = candidates.map(function (belief) { return String(belief.text || "").toLowerCase().split(/[^a-z0-9_'-]+/).filter(function (term) { return term.length > 4; }); }).flat();
        return (snapshot.mind.shortTermMemories || []).concat(snapshot.mind.longTermMemories || []).map(function (memory, index) {
            const text = `${memory.topic} ${memory.summary}`.toLowerCase();
            const match = terms.some(function (term) { return text.includes(term); }) ? 3 : 0;
            return { memory: memory, score: match + memory.importance + index / 1000 };
        }).sort(function (a, b) { return b.score - a.score; }).slice(0, 24).map(function (entry) { return entry.memory; });
    }

    function applyReconciliationCommit(characterId, snapshot, candidates, value, trigger, recoveryContext) {
        const current = setup.Game.getWorld(); const actor = current.entities[characterId];
        if (staleBase(snapshot, actor)) return failure("MIND_V3_STALE", "Mind changed incompatibly while reconciliation was in flight.");
        const candidate = clone(current); const cActor = candidate.entities[characterId];
        let changed = false;
        value.resolutions.forEach(function (resolution) {
            const ids = resolution.beliefIds.slice();
            const currentBeliefs = ids.map(function (id) { return cActor.mind.beliefs.find(function (belief) { return belief.id === id; }); }).filter(Boolean);
            if (!currentBeliefs.length) return;
            let survivorId = resolution.survivorBeliefId || currentBeliefs[0].id;
            let survivor = cActor.mind.beliefs.find(function (belief) { return belief.id === survivorId; });
            if (!survivor) return;
            ids.forEach(function (id) {
                const belief = cActor.mind.beliefs.find(function (entry) { return entry.id === id; });
                if (belief) {
                    const before = belief.activation;
                    belief.activation = M.bumpActivation(before, 0.35, false);
                    changed = changed || belief.activation !== before;
                }
            });
            if (["revise", "merge", "contextualize", "supersede"].includes(resolution.outcome)) {
                const text = resolution.replacementText.trim();
                if (survivor.text !== text) { survivor.text = text; changed = true; }
            }
            if (resolution.evidenceEffect) {
                const before = survivor.confidence;
                survivor.confidence = M.updateConfidence(before, resolution.evidenceEffect, resolution.strength);
                changed = changed || survivor.confidence !== before;
                setup.AIMemory.addBeliefDiagnostic(cActor, survivor.id, { atTurn: diagnosticTurn(candidate), source: "belief-reconciliation", effect: resolution.evidenceEffect, deltaConfidence: survivor.confidence - before });
            }
            if (["merge", "contextualize", "supersede"].includes(resolution.outcome)) {
                const remove = new Set(ids.filter(function (id) { return id !== survivorId; }));
                if (remove.size) { cActor.mind.beliefs = cActor.mind.beliefs.filter(function (belief) { return !remove.has(belief.id); }); changed = true; }
            } else if (resolution.outcome === "remove") {
                const remove = new Set(ids); cActor.mind.beliefs = cActor.mind.beliefs.filter(function (belief) { return !remove.has(belief.id); }); changed = true;
            }
        });
        changed = applyBeliefEffects(cActor, [], value.activatedBeliefIds, "belief-reconciliation", candidate) || changed;
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const snapshotAdded = appendRecoverySnapshot(cActor, candidate, recoveryContext, changed);
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
        if (snapshotAdded) recoveryContext.persisted = true;
        return { ok: true, actorId: characterId, committed: true, changed: changed, beliefCount: cActor.mind.beliefs.length };
    }

    async function reconcileBeliefs(characterId, client, options) {
        options = options || {};
        const snapshot = characterSnapshot(characterId); if (!snapshot.ok) return snapshot;
        const worldActor = setup.Game.getWorld().entities[characterId]; snapshot.mindDiagnostics = clone(worldActor.mindDiagnostics || {});
        const candidates = reconciliationCandidates(snapshot);
        if (candidates.length < 1) return { ok: true, actorId: characterId, nothingToReconcile: true };
        const payload = {
            stage: "mind-v3-reconciliation",
            character: snapshot.character,
            candidateBeliefs: clone(candidates),
            relevantAutobiographicalMemory: clone(relevantEvidence(snapshot, candidates)),
            relationships: clone(snapshot.mind.relationships || []),
            beliefSemantics: M.BELIEF_SEMANTICS,
            reconciliationPolicy: {
                maxResolutions: M.CONFIG.RECONCILIATION_RESOLUTION_LIMIT,
                maxActivatedBeliefIds: M.CONFIG.RECONCILIATION_ACTIVATED_BELIEF_LIMIT,
                beliefIdsAlwaysArray: true,
                inferMissingMergeParticipants: false
            },
            requiredResponseShape: {
                resolutions: [{ beliefIds: ["supplied_belief_id"], outcome: "leave_unresolved", survivorBeliefId: null, replacementText: null, evidenceEffect: null, strength: null }],
                activatedBeliefIds: []
            }
        };
        const result = await runJsonRequest(characterId, "mind-v3-reconciliation", reconciliationSystem(), payload, function (value) { return validateReconciliationResponse(value, snapshot, candidates); }, client, { purpose: options.purpose || "memory-consolidation", concurrent: options.concurrent === true });
        if (!result.ok) return result;
        const trigger = options.trigger || "manual";
        const recoveryContext = options.recoveryContext || recoveryContextFromSnapshot(snapshot, trigger);
        const commit = applyReconciliationCommit(characterId, snapshot, candidates, result.value, trigger, recoveryContext);
        if (!commit.ok) return commit;
        commit.modelId = result.modelId || null; commit.usage = clone(result.usage || null); return commit;
    }

    function decayActivation(characterId, elapsedUnits, trigger, recoveryContext) {
        const current = setup.Game.getWorld(); const actor = current.entities[characterId];
        if (!actor || actor.type !== "character") return failure("ACTOR_NOT_FOUND", "Character does not exist.");
        const candidate = clone(current); const cActor = candidate.entities[characterId];
        let changed = false;
        (cActor.mind.beliefs || []).forEach(function (belief) {
            const before = belief.activation; const after = M.decayActivation(before, elapsedUnits === undefined ? 1 : elapsedUnits);
            if (after !== before) {
                belief.activation = after; changed = true;
                setup.AIMemory.addBeliefDiagnostic(cActor, belief.id, { atTurn: diagnosticTurn(candidate), source: "timelapse-decay", deltaActivation: after - before });
            }
        });
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const effectiveRecovery = recoveryContext || recoveryContextFromSnapshot(characterSnapshot(characterId), trigger || "timelapse");
        const snapshotAdded = appendRecoverySnapshot(cActor, candidate, effectiveRecovery, changed);
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
        if (snapshotAdded) effectiveRecovery.persisted = true;
        return { ok: true, actorId: characterId, committed: true, changed: changed };
    }

    async function maintainTimelapse(characterId, client, options) {
        options = options || {};
        const report = { actorId: characterId, stages: [], errors: [] };
        const runSnapshot = characterSnapshot(characterId);
        const recoveryContext = runSnapshot.ok ? recoveryContextFromSnapshot(runSnapshot, "timelapse") : null;
        function recordSkipped(stage, reason) {
            const result = { ok: true, actorId: characterId, skipped: true, reason: reason };
            report.stages.push({ stage: stage, result: clone(result) });
            return result;
        }

        const stm = await consolidateSTM(characterId, client, { force: true, purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true, recoveryContext: recoveryContext });
        report.stages.push({ stage: "stm", result: clone(stm) });
        if (!stm.ok) report.errors.push({ stage: "stm", error: clone(stm.error) });

        let ltm = null;
        let reconciliation = null;
        if (!stm.ok) {
            ltm = recordSkipped("ltm", "skipped_due_to_stm_failure");
            reconciliation = recordSkipped("reconciliation", "skipped_due_to_stm_failure");
        } else {
            ltm = await consolidateLTM(characterId, client, { force: true, purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true, recoveryContext: recoveryContext });
            report.stages.push({ stage: "ltm", result: clone(ltm) });
            if (!ltm.ok) {
                report.errors.push({ stage: "ltm", error: clone(ltm.error) });
                reconciliation = recordSkipped("reconciliation", "skipped_due_to_ltm_failure");
            } else {
                reconciliation = await reconcileBeliefs(characterId, client, { purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true, recoveryContext: recoveryContext });
                report.stages.push({ stage: "reconciliation", result: clone(reconciliation) });
                if (!reconciliation.ok) report.errors.push({ stage: "reconciliation", error: clone(reconciliation.error) });
            }
        }

        const decay = decayActivation(characterId, options.elapsedMaintenanceUnits || 1, "timelapse", recoveryContext);
        report.stages.push({ stage: "activation-decay", result: clone(decay) });
        if (!decay.ok) report.errors.push({ stage: "activation-decay", error: clone(decay.error) });
        // Preserve only newest retained timelapse observations after maintenance, without deleting source data that a failed STM stage still needs.
        if (stm.ok) {
            const world = setup.Game.getWorld(); const actor = world.entities[characterId];
            if (actor && actor.mind.verbatimObservations.length > M.CONFIG.VERBATIM_RETAIN_COUNT) {
                // A successful STM pass should normally have consumed the excess. Do not silently drop it if it did not.
                report.errors.push({ stage: "retention-check", error: { code: "MIND_V3_VERBATIM_BACKLOG", message: "Successful timelapse maintenance left more than the retained verbatim window; source observations were preserved." } });
            }
        }
        return { ok: report.errors.length === 0, actorId: characterId, report: report, error: report.errors.length ? { code: "MIND_V3_TIMELAPSE_MAINTENANCE_PARTIAL", message: "One or more timelapse mind-maintenance stages failed; source memory was preserved.", details: clone(report.errors) } : null };
    }

    async function compress(characterId, client, options) {
        options = options || {};
        const results = [];
        const runSnapshot = characterSnapshot(characterId);
        const trigger = options.automatic ? "automatic" : "manual";
        const recoveryContext = runSnapshot.ok ? recoveryContextFromSnapshot(runSnapshot, trigger) : null;
        const stm = await consolidateSTM(characterId, client, { force: options.automatic !== true, purpose: options.purpose || "memory-consolidation", trigger: trigger, recoveryContext: recoveryContext });
        results.push({ stage: "stm", result: clone(stm) });
        if (!stm.ok) return stm;
        if (options.stmOnly === true || options.automatic === true) return { ok: true, actorId: characterId, stages: results, consolidation: { committed: stm.committed === true, verbatimCount: setup.Game.getWorld().entities[characterId].mind.verbatimObservations.length } };
        const ltm = await consolidateLTM(characterId, client, { force: true, trigger: "manual", recoveryContext: recoveryContext }); results.push({ stage: "ltm", result: clone(ltm) }); if (!ltm.ok) return ltm;
        const reconciliation = await reconcileBeliefs(characterId, client, { trigger: "manual", recoveryContext: recoveryContext }); results.push({ stage: "reconciliation", result: clone(reconciliation) }); if (!reconciliation.ok) return reconciliation;
        return { ok: true, actorId: characterId, stages: results, consolidation: { committed: true, shortTermMemoryCount: setup.Game.getWorld().entities[characterId].mind.shortTermMemories.length, longTermMemoryCount: setup.Game.getWorld().entities[characterId].mind.longTermMemories.length, beliefCount: setup.Game.getWorld().entities[characterId].mind.beliefs.length } };
    }

    async function compressBatch(characterIds, client, options) {
        options = options || {};
        const ids = stableUniqueStrings(characterIds);
        const results = [];
        for (const id of ids) {
            const result = options.timelapse ? await maintainTimelapse(id, client, options) : await compress(id, client, options);
            results.push({ characterId: id, result: clone(result) });
        }
        const failed = results.find(function (record) { return !record.result || record.result.ok === false; });
        return failed ? { ok: false, characterId: failed.characterId, error: clone(failed.result.error), results: results } : { ok: true, results: results };
    }

    setup.MemoryConsolidator = {
        RETAIN_RECENT_COUNT: M.CONFIG.VERBATIM_RETAIN_COUNT,
        AUTO_THRESHOLD: M.CONFIG.STM_TRIGGER_COUNT,
        VERBATIM_RETAIN_COUNT: M.CONFIG.VERBATIM_RETAIN_COUNT,
        STM_TRIGGER_COUNT: M.CONFIG.STM_TRIGGER_COUNT,
        consolidateSTM: consolidateSTM,
        consolidateLTM: consolidateLTM,
        reconcileBeliefs: reconcileBeliefs,
        decayActivation: decayActivation,
        maintainTimelapse: maintainTimelapse,
        compress: compress,
        compressBatch: compressBatch
    };
}());
