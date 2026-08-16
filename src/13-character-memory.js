(function () {
    "use strict";

    const I = setup.GameInternals;
    const V = setup.MindValidators;
    const MAINTENANCE_SNAPSHOT_LIMIT = 5;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function ok(extra) {
        return Object.assign({ ok: true }, extra || {});
    }

    function fail(code, message) {
        return { ok: false, error: { code: code, message: message } };
    }

    function worldAndActor(actorId) {
        const world = setup.Game.getWorld();
        const actor = I.getCharacter(actorId, world);
        return { world: world, actor: actor };
    }


    function sanitizeMaintenanceSnapshots(records) {
        const source = Array.isArray(records) ? records : [];
        return source.filter(function (snapshot) {
            return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) &&
                typeof snapshot.createdAt === "string" && snapshot.createdAt.trim() &&
                Number.isInteger(snapshot.turn) && snapshot.turn >= 1 &&
                ["manual", "automatic"].includes(snapshot.trigger) &&
                snapshot.mind && typeof snapshot.mind === "object" && !Array.isArray(snapshot.mind);
        }).slice(-MAINTENANCE_SNAPSHOT_LIMIT).map(function (snapshot) {
            return {
                createdAt: snapshot.createdAt,
                turn: snapshot.turn,
                trigger: snapshot.trigger,
                mind: clone(snapshot.mind)
            };
        });
    }

    function sanitizeMindMaintenanceState(state) {
        const source = state && typeof state === "object" && !Array.isArray(state) ? state : {};
        const cursor = source.reconciliationCursor && typeof source.reconciliationCursor === "object" && !Array.isArray(source.reconciliationCursor)
            ? source.reconciliationCursor
            : {};
        const afterBeliefId = typeof cursor.afterBeliefId === "string" && V.ID_PATTERN.test(cursor.afterBeliefId)
            ? cursor.afterBeliefId
            : null;
        return { reconciliationCursor: { afterBeliefId: afterBeliefId } };
    }

    function recordMaintenanceSnapshot(actorId, trigger) {
        const pair = worldAndActor(actorId);
        if (!pair.actor || !pair.actor.mind || typeof pair.actor.mind !== "object") {
            return fail("MEMORY_SNAPSHOT_INVALID", "Character mind state is unavailable for a maintenance snapshot.");
        }
        const normalizedTrigger = trigger === "automatic" ? "automatic" : "manual";
        const existing = sanitizeMaintenanceSnapshots(pair.actor.mindMaintenanceSnapshots);
        existing.push({
            createdAt: new Date().toISOString(),
            turn: Number.isInteger(pair.world.nextEventId) && pair.world.nextEventId > 0 ? pair.world.nextEventId : 1,
            trigger: normalizedTrigger,
            mind: clone(pair.actor.mind)
        });
        pair.actor.mindMaintenanceSnapshots = existing.slice(-MAINTENANCE_SNAPSHOT_LIMIT);
        return ok({ actorId: actorId, snapshotCount: pair.actor.mindMaintenanceSnapshots.length });
    }

    function setContinuation(actorId, continuation) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (continuation !== null && typeof continuation !== "string") {
            return fail("AI_CONTINUATION_INVALID", "AI continuation must be a string or null.");
        }
        if (typeof continuation === "string" && continuation.length > 2000) {
            return fail("AI_CONTINUATION_INVALID", "AI continuation must not exceed 2000 characters.");
        }
        if (!pair.world.ai || typeof pair.world.ai !== "object") pair.world.ai = { turnQueue: [], continuations: {} };
        if (!pair.world.ai.continuations || typeof pair.world.ai.continuations !== "object") pair.world.ai.continuations = {};
        if (continuation === null) delete pair.world.ai.continuations[actorId];
        else pair.world.ai.continuations[actorId] = continuation;
        return ok({ actorId: actorId, continuation: continuation });
    }

    function getContinuation(actorId) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const continuations = pair.world.ai && pair.world.ai.continuations || {};
        return Object.prototype.hasOwnProperty.call(continuations, actorId) ? continuations[actorId] : null;
    }

    function applyUpdates(actorId, updates) {
        const pair = worldAndActor(actorId);
        const world = pair.world;
        const actor = pair.actor;
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        updates = updates || {};
        const memories = updates.recentMemoriesToAdd || [];
        const beliefs = updates.beliefsToUpsert || [];
        const beliefRemovals = updates.beliefIdsToRemove || [];
        const relationships = updates.relationshipsToUpsert || [];
        if (!Array.isArray(memories) || !Array.isArray(beliefs) || !Array.isArray(beliefRemovals) || !Array.isArray(relationships) ||
            memories.length > 5 || beliefs.length > 5 || beliefRemovals.length > 5 || relationships.length > 5) {
            return fail("MEMORY_UPDATE_INVALID", "Memory updates exceed the allowed record limits.");
        }
        for (const memory of memories) {
            const validation = V.validateMemoryRecord(memory && {
                id: "memory_ai_validation",
                summary: memory.summary,
                importance: memory.importance,
                protected: false
            }, { maxSummaryLength: 500 });
            if (!validation.ok) return fail("MEMORY_UPDATE_INVALID", "A recent memory update is invalid.");
        }
        for (const belief of beliefs) {
            if (!V.validateBeliefRecord(belief, { maxTextLength: 500 }).ok) {
                return fail("MEMORY_UPDATE_INVALID", "A belief update is invalid.");
            }
        }
        const beliefUpsertIds = new Set(beliefs.map(function (belief) { return belief && belief.id; }));
        const seenBeliefRemovals = new Set();
        for (const beliefId of beliefRemovals) {
            if (typeof beliefId !== "string" || !V.ID_PATTERN.test(beliefId) || seenBeliefRemovals.has(beliefId) || beliefUpsertIds.has(beliefId) ||
                    !actor.mind.beliefs.some(function (belief) { return belief.id === beliefId; })) {
                return fail("MEMORY_UPDATE_INVALID", "A belief removal is invalid.");
            }
            seenBeliefRemovals.add(beliefId);
        }
        for (const relationship of relationships) {
            if (!V.validateRelationshipRecord(relationship, actorId, world, { requireTargetExists: true, maxSummaryLength: 500 }).ok) {
                return fail("MEMORY_UPDATE_INVALID", "A relationship update is invalid.");
            }
        }
        for (const memory of memories) {
            let memoryId;
            const existingMemoryIds = new Set(actor.mind.recentMemories.concat(actor.mind.longTermMemories).map(function (item) { return item.id; }));
            do { memoryId = `memory_ai_${world.nextMemoryId++}`; } while (existingMemoryIds.has(memoryId));
            actor.mind.recentMemories.push({ id: memoryId, summary: memory.summary.trim(), importance: memory.importance, protected: false });
        }
        if (beliefRemovals.length) {
            const removeIds = new Set(beliefRemovals);
            actor.mind.beliefs = actor.mind.beliefs.filter(function (belief) { return !removeIds.has(belief.id); });
        }
        for (const belief of beliefs) {
            const record = { id: belief.id, text: belief.text.trim(), confidence: belief.confidence };
            const index = actor.mind.beliefs.findIndex(function (item) { return item.id === belief.id; });
            if (index < 0) actor.mind.beliefs.push(record); else actor.mind.beliefs[index] = record;
        }
        for (const relationship of relationships) {
            const record = { targetCharacterId: relationship.targetCharacterId, summary: relationship.summary.trim() };
            const index = actor.mind.relationships.findIndex(function (item) { return item.targetCharacterId === relationship.targetCharacterId; });
            if (index < 0) actor.mind.relationships.push(record); else actor.mind.relationships[index] = record;
        }
        return ok();
    }

    function sanitizeMaintenanceArchive(archive) {
        const source = archive && typeof archive === "object" && !Array.isArray(archive) ? archive : {};
        const memories = Array.isArray(source.memories) ? source.memories : [];
        const beliefs = Array.isArray(source.beliefs) ? source.beliefs : [];
        return {
            memories: memories.filter(function (entry) {
                return entry && typeof entry === "object" && !Array.isArray(entry) &&
                    typeof entry.archivedAt === "string" && entry.archivedAt.trim() &&
                    ["recentMemories", "longTermMemories"].includes(entry.sourcePartition) &&
                    entry.record && V.validateMemoryRecord(entry.record, { maxSummaryLength: 2000 }).ok;
            }).map(function (entry) {
                return { archivedAt: entry.archivedAt, sourcePartition: entry.sourcePartition, record: clone(entry.record) };
            }),
            beliefs: beliefs.filter(function (entry) {
                return entry && typeof entry === "object" && !Array.isArray(entry) &&
                    typeof entry.archivedAt === "string" && entry.archivedAt.trim() &&
                    entry.record && V.validateBeliefRecord(entry.record, { maxTextLength: 2000 }).ok;
            }).map(function (entry) {
                return { archivedAt: entry.archivedAt, record: clone(entry.record) };
            })
        };
    }

    function captureMaintenanceState(actorId) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor || !actor.mind) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const archive = sanitizeMaintenanceArchive(actor.mind.maintenanceArchive);
        const sourceMind = clone(actor.mind);
        sourceMind.maintenanceArchive = clone(archive);
        return ok({
            actorId: actorId,
            sourceState: {
                recentMemories: clone(actor.mind.recentMemories || []),
                longTermMemories: clone(actor.mind.longTermMemories || []),
                beliefs: clone(actor.mind.beliefs || []),
                maintenanceArchive: clone(archive),
                mindMaintenanceState: sanitizeMindMaintenanceState(actor.mindMaintenanceState),
                nextMemoryId: pair.world.nextMemoryId,
                mindForSnapshot: sourceMind
            },
            candidateState: {
                recentMemories: clone(actor.mind.recentMemories || []),
                longTermMemories: clone(actor.mind.longTermMemories || []),
                beliefs: clone(actor.mind.beliefs || []),
                maintenanceArchive: clone(archive),
                mindMaintenanceState: sanitizeMindMaintenanceState(actor.mindMaintenanceState),
                nextMemoryId: pair.world.nextMemoryId
            },
            readOnlyContext: {
                character: { id: actor.id, name: actor.name, aiDescription: typeof actor.aiDescription === "string" ? actor.aiDescription : "" },
                knownFacts: clone(actor.mind.knownFacts || []),
                relationships: clone(actor.mind.relationships || [])
            }
        });
    }

    function archiveMemory(candidateState, memory, sourcePartition, archivedAt) {
        candidateState.maintenanceArchive = sanitizeMaintenanceArchive(candidateState.maintenanceArchive);
        candidateState.maintenanceArchive.memories.push({
            archivedAt: archivedAt || new Date().toISOString(),
            sourcePartition: sourcePartition,
            record: clone(memory)
        });
    }

    function archiveBelief(candidateState, belief, archivedAt) {
        candidateState.maintenanceArchive = sanitizeMaintenanceArchive(candidateState.maintenanceArchive);
        candidateState.maintenanceArchive.beliefs.push({ archivedAt: archivedAt || new Date().toISOString(), record: clone(belief) });
    }

    function nextMaintenanceMemoryId(candidateState) {
        const existing = new Set(candidateState.recentMemories.concat(candidateState.longTermMemories).map(function (memory) { return memory.id; }));
        let memoryId;
        do { memoryId = `memory_ai_${candidateState.nextMemoryId++}`; } while (existing.has(memoryId));
        return memoryId;
    }

    function maintenanceMindChanged(sourceState, candidateState) {
        return JSON.stringify(sourceState.recentMemories) !== JSON.stringify(candidateState.recentMemories) ||
            JSON.stringify(sourceState.longTermMemories) !== JSON.stringify(candidateState.longTermMemories) ||
            JSON.stringify(sourceState.beliefs) !== JSON.stringify(candidateState.beliefs) ||
            JSON.stringify(sourceState.maintenanceArchive) !== JSON.stringify(candidateState.maintenanceArchive) ||
            sourceState.nextMemoryId !== candidateState.nextMemoryId;
    }

    function maintenanceOperationalStateChanged(sourceState, candidateState) {
        return JSON.stringify(sanitizeMindMaintenanceState(sourceState.mindMaintenanceState)) !==
            JSON.stringify(sanitizeMindMaintenanceState(candidateState.mindMaintenanceState));
    }

    function commitMaintenanceCandidate(actorId, sourceState, candidateState, trigger) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (!sourceState || !candidateState) return fail("MEMORY_CONSOLIDATION_INVALID", "Mind maintenance state is invalid.");
        const currentArchive = sanitizeMaintenanceArchive(actor.mind.maintenanceArchive);
        const currentMaintenanceState = sanitizeMindMaintenanceState(actor.mindMaintenanceState);
        if (JSON.stringify(actor.mind.recentMemories) !== JSON.stringify(sourceState.recentMemories) ||
                JSON.stringify(actor.mind.longTermMemories) !== JSON.stringify(sourceState.longTermMemories) ||
                JSON.stringify(actor.mind.beliefs) !== JSON.stringify(sourceState.beliefs) ||
                JSON.stringify(currentArchive) !== JSON.stringify(sourceState.maintenanceArchive) ||
                JSON.stringify(currentMaintenanceState) !== JSON.stringify(sanitizeMindMaintenanceState(sourceState.mindMaintenanceState)) ||
                pair.world.nextMemoryId !== sourceState.nextMemoryId) {
            return fail("MEMORY_CONSOLIDATION_STALE", "Character mind changed while maintenance was in progress; the result was not applied.");
        }
        const mindChanged = maintenanceMindChanged(sourceState, candidateState);
        const operationalChanged = maintenanceOperationalStateChanged(sourceState, candidateState);
        if (!mindChanged && !operationalChanged) {
            return ok({ actorId: actorId, committed: false, changed: false, cursorChanged: false, snapshotCount: sanitizeMaintenanceSnapshots(actor.mindMaintenanceSnapshots).length });
        }

        const candidateWorld = clone(pair.world);
        const candidateActor = I.getCharacter(actorId, candidateWorld);
        candidateActor.mind.recentMemories = clone(candidateState.recentMemories);
        candidateActor.mind.longTermMemories = clone(candidateState.longTermMemories);
        candidateActor.mind.beliefs = clone(candidateState.beliefs);
        candidateActor.mind.maintenanceArchive = sanitizeMaintenanceArchive(candidateState.maintenanceArchive);
        candidateActor.mindMaintenanceState = sanitizeMindMaintenanceState(candidateState.mindMaintenanceState);
        candidateWorld.nextMemoryId = candidateState.nextMemoryId;

        const snapshots = sanitizeMaintenanceSnapshots(candidateActor.mindMaintenanceSnapshots);
        if (mindChanged) {
            snapshots.push({
                createdAt: new Date().toISOString(),
                turn: Number.isInteger(candidateWorld.nextEventId) && candidateWorld.nextEventId > 0 ? candidateWorld.nextEventId : 1,
                trigger: trigger === "automatic" ? "automatic" : "manual",
                mind: clone(sourceState.mindForSnapshot)
            });
        }
        candidateActor.mindMaintenanceSnapshots = snapshots.slice(-MAINTENANCE_SNAPSHOT_LIMIT);

        const validation = I.validateWorld(candidateWorld);
        if (!validation.ok) return validation;
        State.variables.world = candidateWorld;
        return ok({
            actorId: actorId,
            committed: true,
            changed: mindChanged,
            cursorChanged: operationalChanged,
            snapshotCount: candidateActor.mindMaintenanceSnapshots.length,
            recentMemories: candidateActor.mind.recentMemories.length,
            longTermMemories: candidateActor.mind.longTermMemories.length,
            beliefs: candidateActor.mind.beliefs.length,
            archivedMemories: candidateActor.mind.maintenanceArchive.memories.length,
            archivedBeliefs: candidateActor.mind.maintenanceArchive.beliefs.length
        });
    }

    function exactKeys(record, keys) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return false;
        const actual = Object.keys(record);
        return actual.length === keys.length && actual.every(function (key) { return keys.includes(key); });
    }

    const PORTABLE_MIND_SCHEMA = "ai-rpg.character-mind";
    const PORTABLE_MIND_VERSION = 2;
    const PORTABLE_MIND_PARTITIONS_V1 = ["beliefs", "relationships", "recentMemories", "longTermMemories"];
    const PORTABLE_MIND_PARTITIONS_V2 = ["beliefs", "relationships", "recentMemories", "longTermMemories", "maintenanceArchive"];

    function validPortableText(value, maximumLength) {
        return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
    }

    function validatePortableMindDocument(document, targetActorId) {
        if (!exactKeys(document, ["schema", "version", "exportedAt", "characterId", "characterName", "mind"])) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file has invalid top-level fields.");
        }
        if (document.schema !== PORTABLE_MIND_SCHEMA || ![1, PORTABLE_MIND_VERSION].includes(document.version)) {
            return fail("CHARACTER_MIND_IMPORT_UNSUPPORTED", "Character mind file uses an unsupported schema or version.");
        }
        if (typeof document.exportedAt !== "string" || !document.exportedAt.trim() ||
                typeof document.characterId !== "string" || !document.characterId.trim() ||
                typeof document.characterName !== "string" || !document.characterName.trim()) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file metadata is invalid.");
        }
        if (targetActorId && document.characterId !== targetActorId) {
            return fail("CHARACTER_MIND_ID_MISMATCH", `This mind belongs to ${document.characterName} (${document.characterId}), not the selected character (${targetActorId}).`);
        }
        const expected = document.version === 1 ? PORTABLE_MIND_PARTITIONS_V1 : PORTABLE_MIND_PARTITIONS_V2;
        if (!exactKeys(document.mind, expected)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file has invalid mind partitions.");
        for (const partition of PORTABLE_MIND_PARTITIONS_V1) {
            if (!Array.isArray(document.mind[partition]) || document.mind[partition].length > 5000) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", `Character mind ${partition} is invalid or too large.`);
            }
        }
        const beliefIds = new Set();
        for (const belief of document.mind.beliefs) {
            if (!exactKeys(belief, ["id", "text", "confidence"]) || beliefIds.has(belief.id) || !V.validateBeliefRecord(belief, { maxTextLength: 500 }).ok) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate belief.");
            }
            beliefIds.add(belief.id);
        }
        const relationshipTargets = new Set();
        for (const relationship of document.mind.relationships) {
            if (!exactKeys(relationship, ["targetCharacterId", "summary"]) || relationshipTargets.has(relationship.targetCharacterId) ||
                    !V.validateRelationshipRecord(relationship, document.characterId, null, { requireTargetExists: false, maxSummaryLength: 500 }).ok) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate relationship.");
            }
            relationshipTargets.add(relationship.targetCharacterId);
        }
        const memoryIds = new Set();
        for (const partition of ["recentMemories", "longTermMemories"]) {
            for (const memory of document.mind[partition]) {
                if (!exactKeys(memory, ["id", "summary", "importance", "protected"]) || memoryIds.has(memory.id) ||
                        !V.validateMemoryRecord(memory, { maxSummaryLength: 2000 }).ok) {
                    return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate memory.");
                }
                memoryIds.add(memory.id);
            }
        }
        if (document.version === 2) {
            const sanitized = sanitizeMaintenanceArchive(document.mind.maintenanceArchive);
            if (JSON.stringify(sanitized) !== JSON.stringify(document.mind.maintenanceArchive)) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid maintenance archive.");
            }
        }
        return ok();
    }

    function portableMindFilename(actor) {
        const id = String(actor && actor.id || "character").replace(/[^A-Za-z0-9_-]+/g, "-");
        return `${id}-character-mind.json`;
    }

    function exportPortableMind(actorId) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const document = {
            schema: PORTABLE_MIND_SCHEMA,
            version: PORTABLE_MIND_VERSION,
            exportedAt: new Date().toISOString(),
            characterId: pair.actor.id,
            characterName: pair.actor.name,
            mind: {
                beliefs: clone(pair.actor.mind.beliefs || []),
                relationships: clone(pair.actor.mind.relationships || []),
                recentMemories: clone(pair.actor.mind.recentMemories || []),
                longTermMemories: clone(pair.actor.mind.longTermMemories || []),
                maintenanceArchive: sanitizeMaintenanceArchive(pair.actor.mind.maintenanceArchive)
            }
        };
        const validation = validatePortableMindDocument(document, actorId);
        if (!validation.ok) return validation;
        return ok({
            actorId: actorId,
            document: document,
            text: JSON.stringify(document, null, 2),
            filename: portableMindFilename(pair.actor)
        });
    }

    function normalizeNextMemoryId(world) {
        let maximum = 0;
        I.getCharacters(world).forEach(function (character) {
            ["recentMemories", "longTermMemories"].forEach(function (partition) {
                (character.mind && character.mind[partition] || []).forEach(function (memory) {
                    const match = /^memory_ai_(\d+)$/.exec(memory && memory.id || "");
                    if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
                });
            });
            const archive = sanitizeMaintenanceArchive(character.mind && character.mind.maintenanceArchive);
            archive.memories.forEach(function (entry) {
                const match = /^memory_ai_(\d+)$/.exec(entry.record && entry.record.id || "");
                if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
            });
        });
        world.nextMemoryId = Math.max(Number.isInteger(world.nextMemoryId) ? world.nextMemoryId : 1, maximum + 1);
        return world.nextMemoryId;
    }

    function importPortableMind(actorId, source) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        let document = source;
        if (typeof source === "string") {
            try {
                document = JSON.parse(source);
            } catch (error) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file is not valid JSON.");
            }
        }
        const validation = validatePortableMindDocument(document, actorId);
        if (!validation.ok) return validation;

        const candidate = clone(pair.world);
        const candidateActor = I.getCharacter(actorId, candidate);
        candidateActor.mind.beliefs = clone(document.mind.beliefs);
        candidateActor.mind.relationships = clone(document.mind.relationships);
        candidateActor.mind.recentMemories = clone(document.mind.recentMemories);
        candidateActor.mind.longTermMemories = clone(document.mind.longTermMemories);
        candidateActor.mind.maintenanceArchive = document.version === 2 ? sanitizeMaintenanceArchive(document.mind.maintenanceArchive) : { memories: [], beliefs: [] };
        candidateActor.mindMaintenanceState = { reconciliationCursor: { afterBeliefId: null } };
        if (candidate.ai && candidate.ai.continuations) delete candidate.ai.continuations[actorId];
        normalizeNextMemoryId(candidate);
        const worldValidation = I.validateWorld(candidate);
        if (!worldValidation.ok) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", `Imported character mind would make the world invalid: ${worldValidation.error.message}`);
        }
        State.variables.world = candidate;
        return ok({
            actorId: actorId,
            characterId: document.characterId,
            characterName: document.characterName,
            beliefs: candidateActor.mind.beliefs.length,
            relationships: candidateActor.mind.relationships.length,
            recentMemories: candidateActor.mind.recentMemories.length,
            longTermMemories: candidateActor.mind.longTermMemories.length,
            archivedMemories: candidateActor.mind.maintenanceArchive.memories.length,
            archivedBeliefs: candidateActor.mind.maintenanceArchive.beliefs.length,
            nextMemoryId: candidate.nextMemoryId
        });
    }

    function consumeObservations(actorId, observationIds) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor || !Array.isArray(observationIds)) return fail("OBSERVATION_CONSUME_INVALID", "Observation consumption request is invalid.");
        const ids = new Set(observationIds.filter(Number.isInteger));
        const consumed = actor.mind.pendingObservations.filter(function (item) { return ids.has(item.id); });
        actor.mind.pendingObservations = actor.mind.pendingObservations.filter(function (item) { return !ids.has(item.id); });
        if (setup.EventPerception) setup.EventPerception.acknowledgeConsumedObservations(actorId, consumed, pair.world);
        I.repairAIQueue(pair.world);
        return ok();
    }

    setup.AIMemory = {
        MAINTENANCE_SNAPSHOT_LIMIT: MAINTENANCE_SNAPSHOT_LIMIT,
        applyUpdates: applyUpdates,
        consumeObservations: consumeObservations,
        sanitizeMaintenanceSnapshots: sanitizeMaintenanceSnapshots,
        sanitizeMaintenanceArchive: sanitizeMaintenanceArchive,
        sanitizeMindMaintenanceState: sanitizeMindMaintenanceState,
        recordMaintenanceSnapshot: recordMaintenanceSnapshot,
        captureMaintenanceState: captureMaintenanceState,
        archiveMemory: archiveMemory,
        archiveBelief: archiveBelief,
        nextMaintenanceMemoryId: nextMaintenanceMemoryId,
        commitMaintenanceCandidate: commitMaintenanceCandidate
    };

    setup.CharacterMindTransfer = {
        SCHEMA: PORTABLE_MIND_SCHEMA,
        VERSION: PORTABLE_MIND_VERSION,
        exportMind: exportPortableMind,
        importMind: importPortableMind,
        validateDocument: validatePortableMindDocument
    };

    setup.AIWorkingState = {
        getContinuation: getContinuation,
        setContinuation: setContinuation
    };
}());
