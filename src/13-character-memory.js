(function () {
    "use strict";

    const I = setup.GameInternals;

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
        const relationships = updates.relationshipsToUpsert || [];
        if (!Array.isArray(memories) || !Array.isArray(beliefs) || !Array.isArray(relationships) ||
            memories.length > 5 || beliefs.length > 5 || relationships.length > 5) {
            return fail("MEMORY_UPDATE_INVALID", "Memory updates exceed the allowed record limits.");
        }
        function validText(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 500; }
        for (const memory of memories) if (!memory || !validText(memory.summary) ||
            typeof memory.importance !== "number" || !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1) {
            return fail("MEMORY_UPDATE_INVALID", "A recent memory update is invalid.");
        }
        for (const belief of beliefs) if (!belief || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id || "") ||
            !validText(belief.text) || !["low", "medium", "high"].includes(belief.confidence)) {
            return fail("MEMORY_UPDATE_INVALID", "A belief update is invalid.");
        }
        for (const relationship of relationships) if (!relationship || relationship.targetCharacterId === actorId ||
            !I.getCharacter(relationship.targetCharacterId, world) || !validText(relationship.summary)) {
            return fail("MEMORY_UPDATE_INVALID", "A relationship update is invalid.");
        }
        for (const memory of memories) {
            let memoryId;
            const existingMemoryIds = new Set(actor.mind.recentMemories.concat(actor.mind.longTermMemories).map(function (item) { return item.id; }));
            do { memoryId = `memory_ai_${world.nextMemoryId++}`; } while (existingMemoryIds.has(memoryId));
            actor.mind.recentMemories.push({ id: memoryId, summary: memory.summary.trim(), importance: memory.importance, protected: false });
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

    function prepareConsolidation(actorId, retainRecentCount) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const retainCount = Number.isInteger(retainRecentCount) && retainRecentCount >= 0 ? retainRecentCount : 10;
        if (!actor.mind || !Array.isArray(actor.mind.recentMemories) || !Array.isArray(actor.mind.longTermMemories)) {
            return fail("MEMORY_CONSOLIDATION_INVALID", "Character memory state is invalid.");
        }
        const recentMemories = clone(actor.mind.recentMemories);
        const longTermMemories = clone(actor.mind.longTermMemories);
        const splitIndex = Math.max(0, recentMemories.length - retainCount);
        const memoriesToConsolidate = recentMemories.slice(0, splitIndex);
        const retainedRecentMemories = recentMemories.slice(splitIndex);
        const summary = {
            consolidatedRecentCount: memoriesToConsolidate.length,
            retainedRecentCount: retainedRecentMemories.length,
            existingLongTermCount: longTermMemories.length
        };
        if (memoriesToConsolidate.length === 0) return ok({ actorId: actorId, nothingToCompress: true, summary: summary });
        return ok({
            actorId: actorId,
            nothingToCompress: false,
            summary: summary,
            context: {
                character: { id: actor.id, name: actor.name, aiDescription: typeof actor.aiDescription === "string" ? actor.aiDescription : "" },
                mindContext: {
                    knownFacts: clone(actor.mind.knownFacts || []),
                    beliefs: clone(actor.mind.beliefs || []),
                    relationships: clone(actor.mind.relationships || [])
                },
                existingLongTermMemories: longTermMemories,
                memoriesToConsolidate: memoriesToConsolidate
            },
            sourceState: {
                recentMemories: recentMemories,
                longTermMemories: longTermMemories,
                memoriesToConsolidate: memoriesToConsolidate,
                retainedRecentMemories: retainedRecentMemories
            }
        });
    }

    function validateConsolidationChanges(actor, changes) {
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) return fail("MEMORY_CONSOLIDATION_INVALID", "Memory consolidation result must be an object.");
        const allowedTopKeys = ["longTermMemoriesToUpsert", "longTermMemoriesToAdd"];
        const topKeys = Object.keys(changes);
        if (topKeys.length !== allowedTopKeys.length || topKeys.some(function (key) { return !allowedTopKeys.includes(key); })) return fail("MEMORY_CONSOLIDATION_INVALID", "Memory consolidation result has invalid fields.");
        const upserts = changes.longTermMemoriesToUpsert;
        const additions = changes.longTermMemoriesToAdd;
        if (!Array.isArray(upserts) || !Array.isArray(additions)) return fail("MEMORY_CONSOLIDATION_INVALID", "Memory consolidation updates must be arrays.");
        function validSummary(value) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 2000; }
        function validImportance(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
        function exactKeys(record, keys) {
            if (!record || typeof record !== "object" || Array.isArray(record)) return false;
            const actual = Object.keys(record);
            return actual.length === keys.length && actual.every(function (key) { return keys.includes(key); });
        }
        const existingIds = new Set((actor.mind.longTermMemories || []).map(function (memory) { return memory.id; }));
        const seenUpsertIds = new Set();
        for (const record of upserts) {
            if (!exactKeys(record, ["id", "summary", "importance"]) || typeof record.id !== "string" || !existingIds.has(record.id) ||
                    seenUpsertIds.has(record.id) || !validSummary(record.summary) || !validImportance(record.importance)) {
                return fail("MEMORY_CONSOLIDATION_INVALID", "A long-term memory upsert is invalid.");
            }
            seenUpsertIds.add(record.id);
        }
        for (const record of additions) {
            if (!exactKeys(record, ["summary", "importance"]) || !validSummary(record.summary) || !validImportance(record.importance)) {
                return fail("MEMORY_CONSOLIDATION_INVALID", "A new long-term memory is invalid.");
            }
        }
        return ok();
    }

    function commitConsolidation(actorId, sourceState, changes) {
        const pair = worldAndActor(actorId);
        const world = pair.world;
        const actor = pair.actor;
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        if (!sourceState || typeof sourceState !== "object" || !Array.isArray(sourceState.recentMemories) ||
                !Array.isArray(sourceState.longTermMemories) || !Array.isArray(sourceState.memoriesToConsolidate) ||
                !Array.isArray(sourceState.retainedRecentMemories)) {
            return fail("MEMORY_CONSOLIDATION_INVALID", "Memory consolidation source snapshot is invalid.");
        }
        if (JSON.stringify(actor.mind.recentMemories) !== JSON.stringify(sourceState.recentMemories) ||
                JSON.stringify(actor.mind.longTermMemories) !== JSON.stringify(sourceState.longTermMemories)) {
            return fail("MEMORY_CONSOLIDATION_STALE", "Character memory changed while consolidation was in progress; the consolidation result was not applied.");
        }
        const changeValidation = validateConsolidationChanges(actor, changes);
        if (!changeValidation.ok) return changeValidation;
        const candidate = clone(world);
        const candidateActor = I.getCharacter(actorId, candidate);
        const existingMemoryIds = new Set(candidateActor.mind.recentMemories.concat(candidateActor.mind.longTermMemories).map(function (memory) { return memory.id; }));
        const longTermById = new Map();
        candidateActor.mind.longTermMemories.forEach(function (memory, index) { longTermById.set(memory.id, index); });
        changes.longTermMemoriesToUpsert.forEach(function (record) {
            const index = longTermById.get(record.id);
            candidateActor.mind.longTermMemories[index] = Object.assign({}, candidateActor.mind.longTermMemories[index], { summary: record.summary.trim(), importance: record.importance });
        });
        const generatedMemoryIds = [];
        changes.longTermMemoriesToAdd.forEach(function (record) {
            let memoryId;
            do { memoryId = `memory_ai_${candidate.nextMemoryId++}`; } while (existingMemoryIds.has(memoryId));
            existingMemoryIds.add(memoryId);
            generatedMemoryIds.push(memoryId);
            candidateActor.mind.longTermMemories.push({ id: memoryId, summary: record.summary.trim(), importance: record.importance, protected: false });
        });
        candidateActor.mind.recentMemories = clone(sourceState.retainedRecentMemories);
        const validation = I.validateWorld(candidate);
        if (!validation.ok) return validation;
        State.variables.world = candidate;
        return ok({
            actorId: actorId,
            consolidatedRecentCount: sourceState.memoriesToConsolidate.length,
            retainedRecentCount: sourceState.retainedRecentMemories.length,
            longTermMemoriesUpserted: changes.longTermMemoriesToUpsert.length,
            longTermMemoriesAdded: changes.longTermMemoriesToAdd.length,
            generatedMemoryIds: generatedMemoryIds,
            totalLongTermMemories: candidateActor.mind.longTermMemories.length
        });
    }

    const PORTABLE_MIND_SCHEMA = "ai-rpg.character-mind";
    const PORTABLE_MIND_VERSION = 1;
    const PORTABLE_MIND_PARTITIONS = ["beliefs", "relationships", "recentMemories", "longTermMemories"];

    function exactKeys(record, keys) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return false;
        const actual = Object.keys(record);
        return actual.length === keys.length && actual.every(function (key) { return keys.includes(key); });
    }

    function validPortableText(value, maximumLength) {
        return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
    }

    function validatePortableMindDocument(document, targetActorId) {
        if (!exactKeys(document, ["schema", "version", "exportedAt", "characterId", "characterName", "mind"])) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file has invalid top-level fields.");
        }
        if (document.schema !== PORTABLE_MIND_SCHEMA || document.version !== PORTABLE_MIND_VERSION) {
            return fail("CHARACTER_MIND_IMPORT_UNSUPPORTED", "Character mind file uses an unsupported schema or version.");
        }
        if (typeof document.exportedAt !== "string" || !document.exportedAt.trim() ||
                typeof document.characterId !== "string" || !document.characterId.trim() ||
                typeof document.characterName !== "string" || !document.characterName.trim()) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file metadata is invalid.");
        }
        if (targetActorId && document.characterId !== targetActorId) {
            return fail(
                "CHARACTER_MIND_ID_MISMATCH",
                `This mind belongs to ${document.characterName} (${document.characterId}), not the selected character (${targetActorId}).`
            );
        }
        if (!exactKeys(document.mind, PORTABLE_MIND_PARTITIONS)) {
            return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file has invalid mind partitions.");
        }
        for (const partition of PORTABLE_MIND_PARTITIONS) {
            if (!Array.isArray(document.mind[partition]) || document.mind[partition].length > 5000) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", `Character mind ${partition} is invalid or too large.`);
            }
        }

        const beliefIds = new Set();
        for (const belief of document.mind.beliefs) {
            if (!exactKeys(belief, ["id", "text", "confidence"]) ||
                    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(belief.id || "") || beliefIds.has(belief.id) ||
                    !validPortableText(belief.text, 500) || !["low", "medium", "high"].includes(belief.confidence)) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate belief.");
            }
            beliefIds.add(belief.id);
        }

        const relationshipTargets = new Set();
        for (const relationship of document.mind.relationships) {
            if (!exactKeys(relationship, ["targetCharacterId", "summary"]) ||
                    typeof relationship.targetCharacterId !== "string" || !relationship.targetCharacterId.trim() ||
                    relationship.targetCharacterId.length > 160 || relationship.targetCharacterId === document.characterId ||
                    relationshipTargets.has(relationship.targetCharacterId) || !validPortableText(relationship.summary, 500)) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate relationship.");
            }
            relationshipTargets.add(relationship.targetCharacterId);
        }

        const memoryIds = new Set();
        for (const partition of ["recentMemories", "longTermMemories"]) {
            for (const memory of document.mind[partition]) {
                if (!exactKeys(memory, ["id", "summary", "importance", "protected"]) ||
                        typeof memory.id !== "string" || !memory.id.trim() || memory.id.length > 160 || memoryIds.has(memory.id) ||
                        !validPortableText(memory.summary, 2000) || typeof memory.importance !== "number" ||
                        !Number.isFinite(memory.importance) || memory.importance < 0 || memory.importance > 1 ||
                        typeof memory.protected !== "boolean") {
                    return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate memory.");
                }
                memoryIds.add(memory.id);
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
                longTermMemories: clone(pair.actor.mind.longTermMemories || [])
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
            nextMemoryId: candidate.nextMemoryId
        });
    }

    function consumeObservations(actorId, observationIds) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor || !Array.isArray(observationIds)) return fail("OBSERVATION_CONSUME_INVALID", "Observation consumption request is invalid.");
        const ids = new Set(observationIds.filter(Number.isInteger));
        actor.mind.pendingObservations = actor.mind.pendingObservations.filter(function (item) { return !ids.has(item.id); });
        I.repairAIQueue(pair.world);
        return ok();
    }

    setup.AIMemory = {
        applyUpdates: applyUpdates,
        consumeObservations: consumeObservations,
        prepareConsolidation: prepareConsolidation,
        commitConsolidation: commitConsolidation
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
