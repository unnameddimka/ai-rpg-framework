(function () {
    "use strict";

    const RETAIN_RECENT_COUNT = 10;
    const AUTO_THRESHOLD = 30;
    const BELIEF_MAINTENANCE_THRESHOLD = 60;
    const LONG_TERM_MAINTENANCE_THRESHOLD = 30;
    const RECENT_BATCH_SIZE = 12;
    const MAX_RECENT_BATCHES_PER_RUN = 3;
    const MAX_LONG_TERM_MERGES_PER_RUN = 2;
    const RECENT_CORRECTION_CONTEXT_COUNT = 10;
    const RECONCILIATION_BELIEF_BATCH_SIZE = 5;
    const MAX_DISCOVERED_CONFLICTS = 8;
    const MAX_CONFLICTS_RESOLVED_PER_MAINTENANCE = 2;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }

    function recordTransientResult(result) {
        if (!setup.AITransientDebug) return;
        setup.AITransientDebug.lastUsage = result && result.usage ? clone(result.usage) : null;
        setup.AITransientDebug.lastSafeError = result && !result.ok && result.error ? result.error.message : "";
    }

    function activeMemoryById(candidateState, partition, id) {
        return candidateState[partition].find(function (memory) { return memory.id === id; }) || null;
    }

    function activeBeliefById(candidateState, id) {
        return candidateState.beliefs.find(function (belief) { return belief.id === id; }) || null;
    }

    async function runStage(characterId, stage, context, client, options) {
        const messages = setup.AIProtocol.memoryMaintenanceMessages(stage, context);
        const executeCustom = options.parallel === true && setup.AIRequestExecutor.executeCustomConcurrent
            ? setup.AIRequestExecutor.executeCustomConcurrent
            : setup.AIRequestExecutor.executeCustom;
        const result = await executeCustom({
            actorId: characterId,
            purpose: "memory-consolidation",
            stage: stage,
            messages: messages,
            requestOptions: setup.AIRequestProfiles.resolve("memory-consolidation", { actorId: characterId }),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                return setup.AIProtocol.requestValidated(clone(messages), stage, policyClient);
            }
        });
        recordTransientResult(result);
        return result;
    }

    function applyRecentResult(candidateState, batch, value, archivedAt) {
        const sourceById = new Map(batch.map(function (memory) { return [memory.id, memory]; }));
        const removeIds = new Set();
        const generatedMemoryIds = [];
        value.groups.forEach(function (group) {
            group.sourceRecentMemoryIds.forEach(function (id) {
                const source = sourceById.get(id);
                setup.AIMemory.archiveMemory(candidateState, source, "recentMemories", archivedAt);
                removeIds.add(id);
            });
            const memoryId = setup.AIMemory.nextMaintenanceMemoryId(candidateState);
            generatedMemoryIds.push(memoryId);
            candidateState.longTermMemories.push({
                id: memoryId,
                summary: group.replacement.summary.trim(),
                importance: group.replacement.importance,
                protected: false
            });
        });
        value.archiveOnlyRecentMemoryIds.forEach(function (id) {
            const source = sourceById.get(id);
            setup.AIMemory.archiveMemory(candidateState, source, "recentMemories", archivedAt);
            removeIds.add(id);
        });
        if (removeIds.size) {
            candidateState.recentMemories = candidateState.recentMemories.filter(function (memory) { return !removeIds.has(memory.id); });
        }
        return { removedCount: removeIds.size, generatedMemoryIds: generatedMemoryIds };
    }

    function beliefPayloadEqual(source, replacement) {
        return Boolean(source && replacement && source.text === replacement.text.trim() && source.confidence === replacement.confidence);
    }

    function memoryPayloadEqual(source, replacement) {
        return Boolean(source && replacement && source.summary === replacement.summary.trim() && source.importance === replacement.importance);
    }

    function applyReconciliationResolution(candidateState, selectedBeliefId, selectedMemoryId, value, archivedAt) {
        let beliefChanged = false;
        let memoryChanged = false;
        const sourceBelief = activeBeliefById(candidateState, selectedBeliefId);
        const sourceMemory = activeMemoryById(candidateState, "longTermMemories", selectedMemoryId);
        const reviseBelief = value.resolution === "revise_belief" || value.resolution === "revise_both";
        const reviseMemory = value.resolution === "revise_memory" || value.resolution === "revise_both";

        if (reviseBelief && sourceBelief && !beliefPayloadEqual(sourceBelief, value.beliefReplacement)) {
            setup.AIMemory.archiveBelief(candidateState, sourceBelief, archivedAt);
            const index = candidateState.beliefs.findIndex(function (belief) { return belief.id === selectedBeliefId; });
            candidateState.beliefs[index] = {
                id: sourceBelief.id,
                text: value.beliefReplacement.text.trim(),
                confidence: value.beliefReplacement.confidence
            };
            beliefChanged = true;
        }

        if (reviseMemory && sourceMemory && sourceMemory.protected !== true && !memoryPayloadEqual(sourceMemory, value.memoryReplacement)) {
            setup.AIMemory.archiveMemory(candidateState, sourceMemory, "longTermMemories", archivedAt);
            const index = candidateState.longTermMemories.findIndex(function (memory) { return memory.id === selectedMemoryId; });
            candidateState.longTermMemories[index] = Object.assign({}, sourceMemory, {
                summary: value.memoryReplacement.summary.trim(),
                importance: value.memoryReplacement.importance
            });
            memoryChanged = true;
        }

        return {
            beliefChanged: beliefChanged,
            memoryChanged: memoryChanged,
            noOp: !beliefChanged && !memoryChanged
        };
    }

    function applyLongTermMerge(candidateState, merge, archivedAt) {
        if (!merge) return { merged: false, sourceCount: 0, generatedMemoryId: null };
        const sourceIds = new Set(merge.sourceLongTermMemoryIds);
        const sources = merge.sourceLongTermMemoryIds.map(function (id) {
            return activeMemoryById(candidateState, "longTermMemories", id);
        }).filter(Boolean);
        sources.forEach(function (memory) { setup.AIMemory.archiveMemory(candidateState, memory, "longTermMemories", archivedAt); });
        candidateState.longTermMemories = candidateState.longTermMemories.filter(function (memory) { return !sourceIds.has(memory.id); });
        const memoryId = setup.AIMemory.nextMaintenanceMemoryId(candidateState);
        candidateState.longTermMemories.push({
            id: memoryId,
            summary: merge.replacement.summary.trim(),
            importance: merge.replacement.importance,
            protected: false
        });
        return { merged: true, sourceCount: sources.length, generatedMemoryId: memoryId };
    }

    function reconciliationBatch(candidateState) {
        const beliefs = candidateState.beliefs.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
        if (!beliefs.length) return [];
        const state = setup.AIMemory.sanitizeMindMaintenanceState(candidateState.mindMaintenanceState);
        const anchor = state.reconciliationCursor.afterBeliefId;
        let startIndex = 0;
        if (anchor !== null) {
            const exactIndex = beliefs.findIndex(function (belief) { return belief.id === anchor; });
            if (exactIndex >= 0) startIndex = (exactIndex + 1) % beliefs.length;
            else {
                const nextIndex = beliefs.findIndex(function (belief) { return belief.id.localeCompare(anchor) > 0; });
                startIndex = nextIndex >= 0 ? nextIndex : 0;
            }
        }
        const count = Math.min(RECONCILIATION_BELIEF_BATCH_SIZE, beliefs.length);
        const batch = [];
        for (let offset = 0; offset < count; offset++) batch.push(beliefs[(startIndex + offset) % beliefs.length]);
        return batch;
    }

    function advanceReconciliationCursor(candidateState, batch) {
        if (!batch.length) return false;
        const state = setup.AIMemory.sanitizeMindMaintenanceState(candidateState.mindMaintenanceState);
        const nextAnchor = batch[batch.length - 1].id;
        const changed = state.reconciliationCursor.afterBeliefId !== nextAnchor;
        state.reconciliationCursor.afterBeliefId = nextAnchor;
        candidateState.mindMaintenanceState = state;
        return changed;
    }

    function selectedConflicts(conflicts) {
        const strengthRank = { direct: 0, strong: 1, possible: 2 };
        return conflicts.slice().sort(function (a, b) {
            const strength = strengthRank[a.strength] - strengthRank[b.strength];
            if (strength !== 0) return strength;
            const belief = a.beliefId.localeCompare(b.beliefId);
            if (belief !== 0) return belief;
            return a.longTermMemoryId.localeCompare(b.longTermMemoryId);
        }).slice(0, MAX_CONFLICTS_RESOLVED_PER_MAINTENANCE);
    }

    async function compress(characterId, client, options) {
        options = options && typeof options === "object" ? options : {};
        const automatic = options.automatic === true;
        const executorStatus = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus
            ? setup.AIRequestExecutor.getStatus()
            : { busy: false };
        if (!automatic && executorStatus.busy) return failure("MEMORY_CONSOLIDATION_BUSY", "Another AI request is already in progress.");
        if (!automatic && setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight()) {
            return failure("MEMORY_CONSOLIDATION_BUSY", "An AI reaction wave is already in progress.");
        }
        if (setup.AIRuntimeSettings && !setup.AIRuntimeSettings.getStatus().hasKey) {
            return failure("AI_KEY_MISSING", "Enter an OpenRouter API key before maintaining character mind state.");
        }

        const captured = setup.AIMemory.captureMaintenanceState(characterId);
        if (!captured.ok) return captured;
        const sourceState = captured.sourceState;
        const candidateState = captured.candidateState;
        const readOnlyContext = captured.readOnlyContext;
        const originalNewestIds = new Set(sourceState.recentMemories.slice(-RETAIN_RECENT_COUNT).map(function (memory) { return memory.id; }));
        const processedRecentIds = new Set();
        const recentEligibleAtStart = sourceState.recentMemories.filter(function (memory) {
            return !originalNewestIds.has(memory.id) && memory.protected !== true;
        });
        const recentMaintenanceEligible = recentEligibleAtStart.length > 0;
        const reconciliationEligible = sourceState.beliefs.length > 0 && sourceState.longTermMemories.length > 0;
        const longTermMaintenanceEligible = sourceState.longTermMemories.length >= LONG_TERM_MAINTENANCE_THRESHOLD;
        if (!recentMaintenanceEligible && !reconciliationEligible && !longTermMaintenanceEligible) {
            return {
                ok: true,
                actorId: characterId,
                nothingToCompress: true,
                nothingToMaintain: true,
                consolidation: { committed: false, changed: false, retainedRecentCount: sourceState.recentMemories.length }
            };
        }

        const report = {
            committed: false,
            changed: false,
            cursorChanged: false,
            recentBatches: 0,
            recentSourcesRemoved: 0,
            recentSourcesKept: 0,
            generatedRecentConsolidationMemoryIds: [],
            reconciliationBeliefsExamined: 0,
            reconciliationCandidatesFound: 0,
            reconciliationConflictsSelected: 0,
            reconciliationBeliefsChanged: 0,
            reconciliationMemoriesChanged: 0,
            reconciliationKeptConflicts: 0,
            reconciliationNoOps: 0,
            longTermMerges: 0,
            longTermMergeSources: 0,
            generatedLongTermMergeMemoryIds: []
        };
        const stageResults = [];

        for (let batchIndex = 0; batchIndex < MAX_RECENT_BATCHES_PER_RUN; batchIndex++) {
            const batch = candidateState.recentMemories.filter(function (memory) {
                return !originalNewestIds.has(memory.id) && memory.protected !== true && !processedRecentIds.has(memory.id);
            }).slice(0, RECENT_BATCH_SIZE);
            if (!batch.length) break;
            batch.forEach(function (memory) { processedRecentIds.add(memory.id); });
            const newerReadOnlyRecentMemories = sourceState.recentMemories
                .slice(-RECENT_CORRECTION_CONTEXT_COUNT)
                .filter(function (memory) { return !batch.some(function (source) { return source.id === memory.id; }); });
            const result = await runStage(characterId, "memory-consolidation-recent", {
                character: readOnlyContext.character,
                knownFacts: readOnlyContext.knownFacts,
                relationships: readOnlyContext.relationships,
                sourceRecentMemories: clone(batch),
                newerReadOnlyRecentMemories: clone(newerReadOnlyRecentMemories)
            }, client, options);
            stageResults.push({ stage: "memory-consolidation-recent", result: result });
            if (!result.ok) {
                result.consolidation = Object.assign({}, report, { committed: false, failedStage: "memory-consolidation-recent" });
                return result;
            }
            const applied = applyRecentResult(candidateState, batch, result.value, new Date().toISOString());
            report.recentBatches++;
            report.recentSourcesRemoved += applied.removedCount;
            report.recentSourcesKept += result.value.keepActiveRecentMemoryIds.length;
            report.generatedRecentConsolidationMemoryIds.push.apply(report.generatedRecentConsolidationMemoryIds, applied.generatedMemoryIds);
        }

        const beliefBatch = candidateState.beliefs.length > 0 && candidateState.longTermMemories.length > 0
            ? reconciliationBatch(candidateState)
            : [];
        if (beliefBatch.length) {
            report.reconciliationBeliefsExamined = beliefBatch.length;
            const discovery = await runStage(characterId, "memory-consolidation-reconciliation-discovery", {
                character: readOnlyContext.character,
                knownFacts: readOnlyContext.knownFacts,
                currentBeliefs: clone(beliefBatch),
                activeLongTermMemories: clone(candidateState.longTermMemories)
            }, client, options);
            stageResults.push({ stage: "memory-consolidation-reconciliation-discovery", result: discovery });
            if (!discovery.ok) {
                discovery.consolidation = Object.assign({}, report, { committed: false, failedStage: "memory-consolidation-reconciliation-discovery" });
                return discovery;
            }
            report.reconciliationCandidatesFound = discovery.value.conflicts.length;
            const conflicts = selectedConflicts(discovery.value.conflicts);
            report.reconciliationConflictsSelected = conflicts.length;

            for (const conflict of conflicts) {
                const selectedBelief = activeBeliefById(candidateState, conflict.beliefId);
                const selectedMemory = activeMemoryById(candidateState, "longTermMemories", conflict.longTermMemoryId);
                if (!selectedBelief || !selectedMemory) {
                    return failure("MEMORY_CONSOLIDATION_STALE_CANDIDATE", "A selected reconciliation pair disappeared from the maintenance candidate.", conflict);
                }
                const resolution = await runStage(characterId, "memory-consolidation-reconciliation-resolution", {
                    character: readOnlyContext.character,
                    knownFacts: readOnlyContext.knownFacts,
                    relationships: readOnlyContext.relationships,
                    selectedConflict: clone(conflict),
                    selectedBelief: clone(selectedBelief),
                    selectedLongTermMemory: clone(selectedMemory),
                    activeBeliefs: clone(candidateState.beliefs),
                    activeRecentMemories: clone(candidateState.recentMemories),
                    activeLongTermMemories: clone(candidateState.longTermMemories)
                }, client, options);
                stageResults.push({ stage: "memory-consolidation-reconciliation-resolution", result: resolution });
                if (!resolution.ok) {
                    resolution.consolidation = Object.assign({}, report, { committed: false, failedStage: "memory-consolidation-reconciliation-resolution" });
                    return resolution;
                }
                if (resolution.value.resolution === "keep_conflict") {
                    report.reconciliationKeptConflicts++;
                    continue;
                }
                const applied = applyReconciliationResolution(
                    candidateState,
                    conflict.beliefId,
                    conflict.longTermMemoryId,
                    resolution.value,
                    new Date().toISOString()
                );
                if (applied.beliefChanged) report.reconciliationBeliefsChanged++;
                if (applied.memoryChanged) report.reconciliationMemoriesChanged++;
                if (applied.noOp) report.reconciliationNoOps++;
            }
            advanceReconciliationCursor(candidateState, beliefBatch);
        }

        if (candidateState.longTermMemories.length >= LONG_TERM_MAINTENANCE_THRESHOLD) {
            for (let mergeIndex = 0; mergeIndex < MAX_LONG_TERM_MERGES_PER_RUN; mergeIndex++) {
                if (candidateState.longTermMemories.length < LONG_TERM_MAINTENANCE_THRESHOLD) break;
                const result = await runStage(characterId, "memory-consolidation-longterm", {
                    character: readOnlyContext.character,
                    knownFacts: readOnlyContext.knownFacts,
                    relationships: readOnlyContext.relationships,
                    longTermMemories: clone(candidateState.longTermMemories)
                }, client, options);
                stageResults.push({ stage: "memory-consolidation-longterm", result: result });
                if (!result.ok) {
                    result.consolidation = Object.assign({}, report, { committed: false, failedStage: "memory-consolidation-longterm" });
                    return result;
                }
                if (!result.value.merge) break;
                const applied = applyLongTermMerge(candidateState, result.value.merge, new Date().toISOString());
                report.longTermMerges++;
                report.longTermMergeSources += applied.sourceCount;
                report.generatedLongTermMergeMemoryIds.push(applied.generatedMemoryId);
            }
        }

        const stageSummary = stageResults.map(function (entry) {
            const result = entry.result;
            return { stage: entry.stage, modelId: result.modelId || null, usage: clone(result.usage || null), repaired: Boolean(result.repaired) };
        });
        if (options.deferCommit === true) {
            return {
                ok: true,
                actorId: characterId,
                nothingToCompress: false,
                nothingToMaintain: false,
                consolidation: clone(report),
                stages: stageSummary,
                preparedMaintenance: {
                    actorId: characterId,
                    sourceState: clone(sourceState),
                    candidateState: clone(candidateState),
                    trigger: automatic ? "automatic" : "manual"
                }
            };
        }

        return commitPrepared({
            ok: true,
            actorId: characterId,
            nothingToCompress: false,
            nothingToMaintain: false,
            consolidation: clone(report),
            stages: stageSummary,
            preparedMaintenance: {
                actorId: characterId,
                sourceState: clone(sourceState),
                candidateState: clone(candidateState),
                trigger: automatic ? "automatic" : "manual"
            }
        });
    }

    function remapGeneratedIds(report, mapping) {
        const result = clone(report || {});
        const map = mapping || {};
        ["generatedRecentConsolidationMemoryIds", "generatedLongTermMergeMemoryIds"].forEach(function (key) {
            if (Array.isArray(result[key])) result[key] = result[key].map(function (id) { return map[id] || id; });
        });
        return result;
    }

    function commitPrepared(prepared) {
        if (!prepared || prepared.ok === false) return prepared || failure("MEMORY_CONSOLIDATION_INVALID", "Prepared maintenance result is invalid.");
        if (prepared.nothingToMaintain || prepared.nothingToCompress) {
            const untouched = clone(prepared);
            delete untouched.preparedMaintenance;
            return untouched;
        }
        const proposal = prepared.preparedMaintenance;
        if (!proposal || !proposal.actorId || !proposal.sourceState || !proposal.candidateState) {
            return failure("MEMORY_CONSOLIDATION_INVALID", "Prepared maintenance proposal is missing commit state.");
        }
        const commit = setup.AIMemory.commitMaintenanceCandidate(
            proposal.actorId,
            proposal.sourceState,
            proposal.candidateState,
            proposal.trigger
        );
        if (!commit.ok) {
            return {
                ok: false,
                actorId: proposal.actorId,
                error: clone(commit.error),
                consolidation: Object.assign({}, clone(prepared.consolidation || {}), { committed: false, failedStage: "commit" }),
                stages: clone(prepared.stages || [])
            };
        }
        const report = remapGeneratedIds(prepared.consolidation || {}, commit.memoryIdMap);
        report.committed = commit.committed === true;
        report.changed = commit.changed === true;
        report.cursorChanged = commit.cursorChanged === true;
        report.snapshotCount = commit.snapshotCount;
        report.retainedRecentCount = commit.recentMemories === undefined ? proposal.sourceState.recentMemories.length : commit.recentMemories;
        report.totalLongTermMemories = commit.longTermMemories === undefined ? proposal.sourceState.longTermMemories.length : commit.longTermMemories;
        report.totalBeliefs = commit.beliefs === undefined ? proposal.sourceState.beliefs.length : commit.beliefs;
        report.archivedMemories = commit.archivedMemories === undefined ? proposal.sourceState.maintenanceArchive.memories.length : commit.archivedMemories;
        report.archivedBeliefs = commit.archivedBeliefs === undefined ? proposal.sourceState.maintenanceArchive.beliefs.length : commit.archivedBeliefs;
        return {
            ok: true,
            actorId: proposal.actorId,
            nothingToCompress: false,
            nothingToMaintain: false,
            consolidation: report,
            stages: clone(prepared.stages || [])
        };
    }

    async function compressBatch(characterIds, client, options) {
        options = options && typeof options === "object" ? options : {};
        const ids = Array.from(new Set((Array.isArray(characterIds) ? characterIds : []).filter(function (id) { return typeof id === "string" && id; })));
        const preparedResults = await Promise.all(ids.map(async function (characterId) {
            return {
                characterId: characterId,
                result: await compress(characterId, client, Object.assign({}, options, { automatic: options.automatic === true, parallel: true, deferCommit: true }))
            };
        }));
        const failedPrepare = preparedResults.find(function (record) { return !record.result || record.result.ok === false; });
        if (failedPrepare) {
            return {
                ok: false,
                failedStage: "prepare",
                characterId: failedPrepare.characterId,
                error: clone(failedPrepare.result && failedPrepare.result.error || { code: "MEMORY_CONSOLIDATION_FAILED", message: "Mind maintenance preparation failed." }),
                results: preparedResults.map(function (record) { return { characterId: record.characterId, result: clone(record.result) }; })
            };
        }

        const committed = [];
        for (const record of preparedResults) {
            const result = commitPrepared(record.result);
            committed.push({ characterId: record.characterId, result: clone(result) });
            if (!result.ok) {
                return {
                    ok: false,
                    failedStage: "commit",
                    characterId: record.characterId,
                    error: clone(result.error),
                    results: committed
                };
            }
        }
        return { ok: true, results: committed };
    }

    setup.MemoryConsolidator = {
        RETAIN_RECENT_COUNT: RETAIN_RECENT_COUNT,
        AUTO_THRESHOLD: AUTO_THRESHOLD,
        BELIEF_MAINTENANCE_THRESHOLD: BELIEF_MAINTENANCE_THRESHOLD,
        LONG_TERM_MAINTENANCE_THRESHOLD: LONG_TERM_MAINTENANCE_THRESHOLD,
        RECENT_BATCH_SIZE: RECENT_BATCH_SIZE,
        MAX_RECENT_BATCHES_PER_RUN: MAX_RECENT_BATCHES_PER_RUN,
        MAX_LONG_TERM_MERGES_PER_RUN: MAX_LONG_TERM_MERGES_PER_RUN,
        RECENT_CORRECTION_CONTEXT_COUNT: RECENT_CORRECTION_CONTEXT_COUNT,
        RECONCILIATION_BELIEF_BATCH_SIZE: RECONCILIATION_BELIEF_BATCH_SIZE,
        MAX_DISCOVERED_CONFLICTS: MAX_DISCOVERED_CONFLICTS,
        MAX_CONFLICTS_RESOLVED_PER_MAINTENANCE: MAX_CONFLICTS_RESOLVED_PER_MAINTENANCE,
        compress: compress,
        compressBatch: compressBatch,
        commitPrepared: commitPrepared
    };
}());
