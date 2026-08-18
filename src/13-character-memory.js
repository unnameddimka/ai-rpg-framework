(function () {
    "use strict";

    const I = setup.GameInternals;
    const V = setup.MindValidators;
    const M = setup.MindV3;
    const MAINTENANCE_SNAPSHOT_LIMIT = 5;
    const PORTABLE_MIND_SCHEMA = "ai-rpg.character-mind";
    const PORTABLE_MIND_VERSION = 3;
    const LEGACY_PORTABLE_V1_KEYS = ["beliefs", "relationships", "recentMemories", "longTermMemories"];
    const LEGACY_PORTABLE_V2_KEYS = ["beliefs", "relationships", "recentMemories", "longTermMemories", "maintenanceArchive"];
    const PORTABLE_V3_KEYS = ["schemaVersion", "beliefs", "relationships", "shortTermMemories", "longTermMemories", "verbatimObservations"];

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
    function worldAndActor(actorId) {
        const world = setup.Game.getWorld();
        return { world: world, actor: I.getCharacter(actorId, world) };
    }
    function exactKeys(value, expected) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const keys = Object.keys(value).sort();
        return keys.length === expected.length && expected.slice().sort().every(function (key, index) { return keys[index] === key; });
    }

    function sanitizeMaintenanceSnapshots(records) {
        const source = Array.isArray(records) ? records : [];
        return source.filter(function (snapshot) {
            return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) &&
                typeof snapshot.createdAt === "string" && snapshot.createdAt.trim() &&
                Number.isInteger(snapshot.turn) && snapshot.turn >= 1 &&
                ["manual", "automatic", "timelapse", "timelapse-boundary"].includes(snapshot.trigger) &&
                snapshot.mind && typeof snapshot.mind === "object" && !Array.isArray(snapshot.mind);
        }).slice(-MAINTENANCE_SNAPSHOT_LIMIT).map(function (snapshot) {
            return { createdAt: snapshot.createdAt, turn: snapshot.turn, trigger: snapshot.trigger, mind: clone(snapshot.mind) };
        });
    }

    function sanitizeMaintenanceArchive(archive) {
        const source = archive && typeof archive === "object" && !Array.isArray(archive) ? archive : {};
        return {
            memories: Array.isArray(source.memories) ? clone(source.memories) : [],
            beliefs: Array.isArray(source.beliefs) ? clone(source.beliefs) : []
        };
    }

    function sanitizeMindMaintenanceState() {
        // Mind v3 reconciliation selects evidence-driven candidates per run; the v2 rolling contradiction cursor is obsolete.
        return {};
    }

    function ensureRuntimeMindFields(actor) {
        if (!actor || !actor.mind) return;
        if (!Number.isInteger(actor.mindRevision) || actor.mindRevision < 0) actor.mindRevision = 0;
        if (!actor.mindDiagnostics || typeof actor.mindDiagnostics !== "object" || Array.isArray(actor.mindDiagnostics)) {
            actor.mindDiagnostics = { beliefHistoryById: {} };
        }
        if (!actor.mindDiagnostics.beliefHistoryById || typeof actor.mindDiagnostics.beliefHistoryById !== "object" || Array.isArray(actor.mindDiagnostics.beliefHistoryById)) {
            actor.mindDiagnostics.beliefHistoryById = {};
        }
    }

    function incrementMindRevision(actor) {
        ensureRuntimeMindFields(actor);
        actor.mindRevision += 1;
        return actor.mindRevision;
    }

    function addBeliefDiagnostic(actor, beliefId, entry) {
        ensureRuntimeMindFields(actor);
        if (typeof beliefId !== "string" || !V.ID_PATTERN.test(beliefId)) return;
        const history = Array.isArray(actor.mindDiagnostics.beliefHistoryById[beliefId]) ? actor.mindDiagnostics.beliefHistoryById[beliefId] : [];
        history.push(Object.assign({ atTurn: null, source: "mind-v3" }, clone(entry || {})));
        actor.mindDiagnostics.beliefHistoryById[beliefId] = history.slice(-M.CONFIG.BELIEF_DIAGNOSTIC_LIMIT);
    }

    function recordMaintenanceSnapshot(actorId, trigger) {
        const pair = worldAndActor(actorId);
        if (!pair.actor || !pair.actor.mind) return fail("MEMORY_SNAPSHOT_INVALID", "Character mind state is unavailable for a maintenance snapshot.");
        const normalizedTrigger = ["automatic", "timelapse"].includes(trigger) ? trigger : "manual";
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
        if (continuation !== null && typeof continuation !== "string") return fail("AI_CONTINUATION_INVALID", "AI continuation must be a string or null.");
        if (typeof continuation === "string" && continuation.length > 2000) return fail("AI_CONTINUATION_INVALID", "AI continuation must not exceed 2000 characters.");
        if (!pair.world.ai || typeof pair.world.ai !== "object") pair.world.ai = { turnQueue: [], continuations: {} };
        if (!pair.world.ai.continuations || typeof pair.world.ai.continuations !== "object") pair.world.ai.continuations = {};
        if (continuation === null) delete pair.world.ai.continuations[actorId]; else pair.world.ai.continuations[actorId] = continuation;
        return ok({ actorId: actorId, continuation: continuation });
    }

    function getContinuation(actorId) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const continuations = pair.world.ai && pair.world.ai.continuations || {};
        return Object.prototype.hasOwnProperty.call(continuations, actorId) ? continuations[actorId] : null;
    }

    function applyTurnUpdates(actorId, updates) {
        const pair = worldAndActor(actorId);
        const actor = pair.actor;
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        updates = updates && typeof updates === "object" && !Array.isArray(updates) ? updates : {};
        const relationships = Array.isArray(updates.relationshipsToUpsert) ? updates.relationshipsToUpsert : [];
        const activated = Array.isArray(updates.activatedBeliefIds) ? updates.activatedBeliefIds : [];
        if (relationships.length > 5 || activated.length > 12) return fail("MIND_UPDATE_INVALID", "Turn mind updates exceed the allowed record limits.");
        for (const relationship of relationships) {
            if (!V.validateRelationshipRecord(relationship, actorId, pair.world, { requireTargetExists: true, maxSummaryLength: 500 }).ok) {
                return fail("MIND_UPDATE_INVALID", "A relationship update is invalid.");
            }
        }
        const existingBeliefIds = new Set((actor.mind.beliefs || []).map(function (belief) { return belief.id; }));
        const activatedUnique = [];
        const seen = new Set();
        for (const beliefId of activated) {
            if (typeof beliefId !== "string" || !V.ID_PATTERN.test(beliefId) || !existingBeliefIds.has(beliefId) || seen.has(beliefId)) {
                return fail("MIND_UPDATE_INVALID", "An activated belief id is invalid.");
            }
            seen.add(beliefId);
            activatedUnique.push(beliefId);
        }
        let changed = false;
        for (const relationship of relationships) {
            const record = { targetCharacterId: relationship.targetCharacterId, summary: relationship.summary.trim() };
            const index = actor.mind.relationships.findIndex(function (item) { return item.targetCharacterId === relationship.targetCharacterId; });
            if (index < 0) { actor.mind.relationships.push(record); changed = true; }
            else if (JSON.stringify(actor.mind.relationships[index]) !== JSON.stringify(record)) { actor.mind.relationships[index] = record; changed = true; }
        }
        activatedUnique.forEach(function (beliefId) {
            const belief = actor.mind.beliefs.find(function (item) { return item.id === beliefId; });
            if (!belief) return;
            const before = belief.activation;
            const after = M.bumpActivation(before, 0.35, false);
            if (after !== before) {
                belief.activation = after;
                changed = true;
                addBeliefDiagnostic(actor, beliefId, {
                    atTurn: Number.isInteger(pair.world.nextEventId) ? pair.world.nextEventId : null,
                    source: "game-decision",
                    deltaActivation: after - before
                });
            }
        });
        if (changed) incrementMindRevision(actor);
        return ok({ changed: changed });
    }

    // Compatibility facade for callers while Mind v3 no longer accepts direct memory/belief writes from ordinary turns.
    function applyUpdates(actorId, updates) {
        updates = updates || {};
        if ((updates.recentMemoriesToAdd && updates.recentMemoriesToAdd.length) ||
            (updates.beliefsToUpsert && updates.beliefsToUpsert.length) ||
            (updates.beliefIdsToRemove && updates.beliefIdsToRemove.length)) {
            return fail("MIND_V3_DIRECT_MUTATION_FORBIDDEN", "Mind v3 ordinary turns cannot directly write autobiographical memories or belief confidence/text.");
        }
        return applyTurnUpdates(actorId, {
            relationshipsToUpsert: updates.relationshipsToUpsert || [],
            activatedBeliefIds: updates.activatedBeliefIds || []
        });
    }

    function allocateMemoryId(world, prefix) {
        const base = prefix || "memory_ai";
        let id;
        const allIds = new Set();
        I.getCharacters(world).forEach(function (character) {
            ["shortTermMemories", "longTermMemories"].forEach(function (partition) {
                (character.mind && character.mind[partition] || []).forEach(function (memory) { allIds.add(memory.id); });
            });
        });
        do { id = `${base}_${world.nextMemoryId++}`; } while (allIds.has(id));
        return id;
    }

    function normalizeNextMemoryId(world) {
        let maximum = 0;
        I.getCharacters(world).forEach(function (character) {
            ["shortTermMemories", "longTermMemories"].forEach(function (partition) {
                (character.mind && character.mind[partition] || []).forEach(function (memory) {
                    const match = /^memory_ai_(\d+)$/.exec(memory && memory.id || "");
                    if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
                });
            });
            (character.mind && character.mind.beliefs || []).forEach(function (belief) {
                const match = /^belief_ai_(\d+)$/.exec(belief && belief.id || "");
                if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
            });
        });
        world.nextMemoryId = Math.max(Number.isInteger(world.nextMemoryId) ? world.nextMemoryId : 1, maximum + 1);
        return world.nextMemoryId;
    }

    function migrateLegacyBelief(belief) {
        return {
            id: belief.id,
            text: String(belief.text || "").trim(),
            confidence: M.normalizeConfidence(belief.confidence),
            activation: M.CONFIG.MIGRATED_BELIEF_ACTIVATION
        };
    }

    function migrateLegacyMemory(memory, kind) {
        return {
            id: memory.id,
            topic: M.stableLegacyTopic(kind === "stm" ? "Legacy recent memory" : "Legacy long-term memory", memory.id),
            summary: String(memory.summary || "").trim(),
            importance: typeof memory.importance === "number" ? memory.importance : 0.5,
            protected: memory.protected === true
        };
    }

    function validateLegacyBelief(record) {
        return record && typeof record === "object" && !Array.isArray(record) &&
            typeof record.id === "string" && V.ID_PATTERN.test(record.id) && typeof record.text === "string" && record.text.trim() && record.text.trim().length <= 500 &&
            (["low", "medium", "high"].includes(record.confidence) || (typeof record.confidence === "number" && Number.isFinite(record.confidence) && record.confidence > 0 && record.confidence < 1));
    }

    function validateLegacyMemory(record) {
        return record && typeof record === "object" && !Array.isArray(record) && typeof record.id === "string" && record.id.trim() &&
            typeof record.summary === "string" && record.summary.trim() && record.summary.trim().length <= 2000 &&
            typeof record.importance === "number" && Number.isFinite(record.importance) && record.importance >= 0 && record.importance <= 1 &&
            typeof record.protected === "boolean";
    }

    function validatePortableMindDocument(document, expectedCharacterId) {
        if (!document || typeof document !== "object" || Array.isArray(document)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file must contain one JSON object.");
        if (document.schema !== PORTABLE_MIND_SCHEMA || ![1, 2, 3].includes(document.version)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Unsupported character mind schema or version.");
        if (typeof document.characterId !== "string" || !V.ID_PATTERN.test(document.characterId)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind characterId is invalid.");
        if (expectedCharacterId && document.characterId !== expectedCharacterId) return fail("CHARACTER_MIND_CHARACTER_MISMATCH", "Character mind belongs to a different character id.");
        if (typeof document.characterName !== "string" || !document.characterName.trim()) return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind characterName is invalid.");
        if (!document.mind || typeof document.mind !== "object" || Array.isArray(document.mind)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind payload is invalid.");

        if (document.version < 3) {
            const expected = document.version === 1 ? LEGACY_PORTABLE_V1_KEYS : LEGACY_PORTABLE_V2_KEYS;
            if (!exactKeys(document.mind, expected)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Legacy character mind contains unexpected fields.");
            for (const key of LEGACY_PORTABLE_V1_KEYS) if (!Array.isArray(document.mind[key]) || document.mind[key].length > 200) return fail("CHARACTER_MIND_IMPORT_INVALID", `Legacy character mind ${key} is invalid or too large.`);
            const beliefIds = new Set();
            for (const belief of document.mind.beliefs) {
                if (!validateLegacyBelief(belief) || beliefIds.has(belief.id)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Legacy character mind contains an invalid or duplicate belief.");
                beliefIds.add(belief.id);
            }
            const memoryIds = new Set();
            for (const key of ["recentMemories", "longTermMemories"]) for (const memory of document.mind[key]) {
                if (!validateLegacyMemory(memory) || memoryIds.has(memory.id)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Legacy character mind contains an invalid or duplicate memory.");
                memoryIds.add(memory.id);
            }
        } else {
            if (!exactKeys(document.mind, PORTABLE_V3_KEYS) || document.mind.schemaVersion !== M.CONFIG.SCHEMA_VERSION) return fail("CHARACTER_MIND_IMPORT_INVALID", "Mind v3 portable payload has an invalid shape.");
            for (const key of ["beliefs", "relationships", "shortTermMemories", "longTermMemories", "verbatimObservations"]) {
                if (!Array.isArray(document.mind[key]) || document.mind[key].length > 300) return fail("CHARACTER_MIND_IMPORT_INVALID", `Mind v3 ${key} is invalid or too large.`);
            }
            const beliefIds = new Set();
            for (const belief of document.mind.beliefs) {
                if (!V.validateBeliefRecord(belief, { maxTextLength: 500 }).ok || beliefIds.has(belief.id)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Mind v3 contains an invalid or duplicate belief.");
                beliefIds.add(belief.id);
            }
            const memoryIds = new Set();
            for (const key of ["shortTermMemories", "longTermMemories"]) for (const memory of document.mind[key]) {
                if (!V.validateMemoryRecord(memory, { maxSummaryLength: 2000 }).ok || memoryIds.has(memory.id)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Mind v3 contains an invalid or duplicate memory.");
                memoryIds.add(memory.id);
            }
            const verbatimIds = new Set();
            for (const observation of document.mind.verbatimObservations) {
                if (!V.validateVerbatimObservation(observation).ok || verbatimIds.has(observation.id)) return fail("CHARACTER_MIND_IMPORT_INVALID", "Mind v3 contains an invalid or duplicate verbatim observation.");
                verbatimIds.add(observation.id);
            }
        }
        const relationshipTargets = new Set();
        for (const relationship of document.mind.relationships || []) {
            if (!V.validateRelationshipRecord(relationship, document.characterId, null, { requireTargetExists: false, maxSummaryLength: 500 }).ok || relationshipTargets.has(relationship.targetCharacterId)) {
                return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind contains an invalid or duplicate relationship.");
            }
            relationshipTargets.add(relationship.targetCharacterId);
        }
        return ok();
    }

    function toV3PortableDocument(document) {
        if (document.version === 3) return clone(document);
        return {
            schema: PORTABLE_MIND_SCHEMA,
            version: PORTABLE_MIND_VERSION,
            exportedAt: typeof document.exportedAt === "string" ? document.exportedAt : new Date().toISOString(),
            characterId: document.characterId,
            characterName: document.characterName,
            mind: {
                schemaVersion: M.CONFIG.SCHEMA_VERSION,
                beliefs: (document.mind.beliefs || []).map(migrateLegacyBelief),
                relationships: clone(document.mind.relationships || []),
                shortTermMemories: (document.mind.recentMemories || []).map(function (memory) { return migrateLegacyMemory(memory, "stm"); }),
                longTermMemories: (document.mind.longTermMemories || []).map(function (memory) { return migrateLegacyMemory(memory, "ltm"); }),
                verbatimObservations: []
            }
        };
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
                schemaVersion: M.CONFIG.SCHEMA_VERSION,
                beliefs: clone(pair.actor.mind.beliefs || []),
                relationships: clone(pair.actor.mind.relationships || []),
                shortTermMemories: clone(pair.actor.mind.shortTermMemories || []),
                longTermMemories: clone(pair.actor.mind.longTermMemories || []),
                verbatimObservations: clone(pair.actor.mind.verbatimObservations || [])
            }
        };
        const validation = validatePortableMindDocument(document, actorId);
        if (!validation.ok) return validation;
        return ok({ actorId: actorId, document: document, text: JSON.stringify(document, null, 2), filename: portableMindFilename(pair.actor) });
    }

    function importPortableMind(actorId, source) {
        const pair = worldAndActor(actorId);
        if (!pair.actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        let document = source;
        if (typeof source === "string") {
            try { document = JSON.parse(source); } catch (error) { return fail("CHARACTER_MIND_IMPORT_INVALID", "Character mind file is not valid JSON."); }
        }
        const validation = validatePortableMindDocument(document, actorId);
        if (!validation.ok) return validation;
        const v3 = toV3PortableDocument(document);
        if (setup.MindAuxExecutor && typeof setup.MindAuxExecutor.invalidateForTimelapse === "function") setup.MindAuxExecutor.invalidateForTimelapse();
        const candidate = clone(pair.world);
        const actor = I.getCharacter(actorId, candidate);
        const pending = clone(actor.mind.pendingObservations || []);
        const knownFacts = clone(actor.mind.knownFacts || []);
        actor.mind = clone(v3.mind);
        actor.mind.pendingObservations = pending;
        actor.mind.knownFacts = knownFacts;
        actor.mindRevision = 0;
        actor.mindDiagnostics = { beliefHistoryById: {} };
        actor.mindMaintenanceState = sanitizeMindMaintenanceState();
        if (candidate.ai && candidate.ai.continuations) delete candidate.ai.continuations[actorId];
        normalizeNextMemoryId(candidate);
        const worldValidation = I.validateWorld(candidate);
        if (!worldValidation.ok) return fail("CHARACTER_MIND_IMPORT_INVALID", `Imported character mind would make the world invalid: ${worldValidation.error.message}`);
        State.variables.world = candidate;
        return ok({
            actorId: actorId,
            characterId: v3.characterId,
            characterName: v3.characterName,
            beliefs: actor.mind.beliefs.length,
            relationships: actor.mind.relationships.length,
            shortTermMemories: actor.mind.shortTermMemories.length,
            longTermMemories: actor.mind.longTermMemories.length,
            verbatimObservations: actor.mind.verbatimObservations.length,
            migratedFromVersion: document.version,
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
        applyTurnUpdates: applyTurnUpdates,
        consumeObservations: consumeObservations,
        sanitizeMaintenanceSnapshots: sanitizeMaintenanceSnapshots,
        sanitizeMaintenanceArchive: sanitizeMaintenanceArchive,
        sanitizeMindMaintenanceState: sanitizeMindMaintenanceState,
        recordMaintenanceSnapshot: recordMaintenanceSnapshot,
        ensureRuntimeMindFields: ensureRuntimeMindFields,
        incrementMindRevision: incrementMindRevision,
        addBeliefDiagnostic: addBeliefDiagnostic,
        allocateMemoryId: allocateMemoryId,
        normalizeNextMemoryId: normalizeNextMemoryId,
        migrateLegacyBelief: migrateLegacyBelief,
        migrateLegacyMemory: migrateLegacyMemory
    };

    setup.CharacterMindTransfer = {
        SCHEMA: PORTABLE_MIND_SCHEMA,
        VERSION: PORTABLE_MIND_VERSION,
        exportMind: exportPortableMind,
        importMind: importPortableMind,
        validateDocument: validatePortableMindDocument,
        toV3Document: toV3PortableDocument
    };

    setup.AIWorkingState = { getContinuation: getContinuation, setContinuation: setContinuation };
}());
