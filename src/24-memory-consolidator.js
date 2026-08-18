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
    function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
    function exactKeys(value, keys) {
        if (!isObject(value)) return false;
        const actual = Object.keys(value).sort();
        const expected = keys.slice().sort();
        return actual.length === expected.length && actual.every(function (key, index) { return key === expected[index]; });
    }
    function validText(value, max) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max; }
    function validStrength(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
    function validImportance(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
    function normalizeImportance(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) return value;
        if (value > 1 && value <= 10) return value / 10;
        return value;
    }
    function normalizeMemoryProposal(record) {
        if (!isObject(record)) return record;
        const normalized = clone(record);
        normalized.importance = normalizeImportance(normalized.importance);
        return normalized;
    }
    function normalizeMemoryProposalArrays(value, keys) {
        if (!isObject(value)) return value;
        const normalized = clone(value);
        (keys || []).forEach(function (key) {
            if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(normalizeMemoryProposal);
        });
        return normalized;
    }
    function stableUniqueStrings(values) { return Array.from(new Set((values || []).filter(function (value) { return typeof value === "string" && value; }))); }
    function dedupeStringEntriesPreserveInvalid(values) {
        const seen = new Set();
        const output = [];
        (values || []).forEach(function (value) {
            if (typeof value !== "string") { output.push(value); return; }
            if (seen.has(value)) return;
            seen.add(value);
            output.push(value);
        });
        return output;
    }

    function structurallyValidBeliefEffect(effect) {
        return isObject(effect) && exactKeys(effect, ["beliefId", "effect", "strength"]) &&
            typeof effect.beliefId === "string" && ["supports", "contradicts", "ambiguous"].includes(effect.effect) && validStrength(effect.strength);
    }

    function normalizeStmBeliefReferences(value, snapshot) {
        if (!isObject(value)) return value;
        const normalized = clone(value);
        const allowedBeliefs = beliefIds(snapshot && snapshot.mind || {});
        if (Array.isArray(normalized.beliefEffects)) {
            const grouped = new Map();
            const passthrough = [];
            normalized.beliefEffects.forEach(function (effect) {
                if (!structurallyValidBeliefEffect(effect)) {
                    passthrough.push(effect);
                    return;
                }
                // A syntactically valid effect that references no supplied belief is safely separable.
                // Drop it rather than guessing an alias or rejecting otherwise valid autobiographical writes.
                if (!allowedBeliefs.has(effect.beliefId)) return;
                if (!grouped.has(effect.beliefId)) grouped.set(effect.beliefId, new Map());
                const directions = grouped.get(effect.beliefId);
                const previous = directions.get(effect.effect);
                if (!previous || effect.strength > previous.strength) directions.set(effect.effect, clone(effect));
            });
            const collapsed = [];
            grouped.forEach(function (directions, beliefId) {
                const records = Array.from(directions.values());
                if (records.length === 1) { collapsed.push(records[0]); return; }
                collapsed.push({
                    beliefId: beliefId,
                    effect: "ambiguous",
                    strength: Math.max.apply(null, records.map(function (record) { return record.strength; }))
                });
            });
            normalized.beliefEffects = collapsed.concat(passthrough);
        }
        if (Array.isArray(normalized.activatedBeliefIds)) {
            normalized.activatedBeliefIds = dedupeStringEntriesPreserveInvalid(normalized.activatedBeliefIds).filter(function (id) {
                return typeof id !== "string" || allowedBeliefs.has(id);
            });
        }
        return normalized;
    }

    function observedBeliefAddAdapter(record) {
        if (!isObject(record) || !exactKeys(record, ["topic", "summary", "confidence", "activation"])) return record;
        if (!validText(record.topic, 500) || !validText(record.summary, 2000)) return record;
        if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence <= 0 || record.confidence >= 1) return record;
        if (!(record.activation === null || (typeof record.activation === "number" && Number.isFinite(record.activation) && record.activation > 0 && record.activation < 1))) return record;
        return {
            text: record.topic.trim(),
            initialConfidence: record.confidence,
            initialActivation: record.activation
        };
    }

    function normalizeLtmResponseIngress(value, snapshot) {
        let normalized = normalizeMemoryProposalArrays(value, ["longTermMemoriesToUpsert", "longTermMemoriesToAdd"]);
        if (!isObject(normalized)) return normalized;
        const mind = snapshot && snapshot.mind || {};
        const ltmById = new Map((mind.longTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const stmById = new Map((mind.shortTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const promotedAdds = [];
        if (Array.isArray(normalized.longTermMemoriesToUpsert)) {
            normalized.longTermMemoriesToUpsert = normalized.longTermMemoriesToUpsert.map(function (record) {
                if (!isObject(record)) return record;
                let candidate = clone(record);
                const knownLtm = typeof candidate.id === "string" ? ltmById.get(candidate.id) : null;
                const knownStm = typeof candidate.id === "string" ? stmById.get(candidate.id) : null;
                if (!Object.prototype.hasOwnProperty.call(candidate, "topic") &&
                    (exactKeys(candidate, ["id", "summary", "importance"]) || exactKeys(candidate, ["id", "summary", "importance", "sourceStmIds", "sourceLtmIds"]))) {
                    const source = knownLtm || knownStm;
                    if (source && typeof source.topic === "string") candidate.topic = source.topic;
                }
                candidate = normalizeMemoryProposal(candidate);
                if (knownStm && !knownLtm && validateMemoryProposal({ id: candidate.id, topic: candidate.topic, summary: candidate.summary, importance: candidate.importance }, true)) {
                    promotedAdds.push({ topic: candidate.topic, summary: candidate.summary, importance: candidate.importance, sourceStmIds: [knownStm.id], sourceLtmIds: [] });
                    return null;
                }
                if (knownLtm &&
                    isObject(candidate) && validText(candidate.topic, 240) && validText(candidate.summary, 2000) && validImportance(candidate.importance) &&
                    candidate.topic.trim() === String(knownLtm.topic || "").trim() &&
                    candidate.summary.trim() === String(knownLtm.summary || "").trim() &&
                    candidate.importance === knownLtm.importance) return null;
                return candidate;
            }).filter(function (record) { return record !== null; });
        }
        if (Array.isArray(normalized.longTermMemoriesToAdd) && promotedAdds.length) normalized.longTermMemoriesToAdd = normalized.longTermMemoriesToAdd.concat(promotedAdds);
        if (Array.isArray(normalized.longTermMemoriesToAdd)) {
            const usedRefs = new Set((mind.longTermMemories || []).map(function (memory) { return memory.id; }));
            normalized.longTermMemoriesToAdd.forEach(function (record) { if (isObject(record) && typeof record.ref === "string") usedRefs.add(record.ref); });
            let nextRef = 1;
            normalized.longTermMemoriesToAdd = normalized.longTermMemoriesToAdd.map(function (record) {
                if (!isObject(record)) return record;
                const candidate = clone(record);
                if (!Object.prototype.hasOwnProperty.call(candidate, "ref") &&
                    (exactKeys(candidate, ["topic", "summary", "importance"]) || exactKeys(candidate, ["topic", "summary", "importance", "sourceStmIds", "sourceLtmIds"]))) {
                    let ref;
                    do { ref = `new_ltm_${nextRef++}`; } while (usedRefs.has(ref));
                    candidate.ref = ref;
                    usedRefs.add(ref);
                }
                return candidate;
            });
        }
        if (Array.isArray(normalized.beliefsToAdd)) normalized.beliefsToAdd = normalized.beliefsToAdd.map(observedBeliefAddAdapter);
        if (Array.isArray(normalized.activatedBeliefIds)) normalized.activatedBeliefIds = dedupeStringEntriesPreserveInvalid(normalized.activatedBeliefIds);
        return normalized;
    }

    function normalizeReconciliationIngress(value, candidateBeliefs) {
        if (!isObject(value)) return value;
        const normalized = clone(value);
        const allowed = new Set((candidateBeliefs || []).map(function (belief) { return belief.id; }));
        if (Array.isArray(normalized.resolutions)) {
            normalized.resolutions = normalized.resolutions.map(function (record) {
                if (!isObject(record) || Object.prototype.hasOwnProperty.call(record, "beliefIds")) return record;
                const aliases = [];
                if (typeof record.beliefId === "string") aliases.push({ key: "beliefId", id: record.beliefId });
                if (typeof record.candidateBeliefId === "string") aliases.push({ key: "candidateBeliefId", id: record.candidateBeliefId });
                if (aliases.length !== 1 || !allowed.has(aliases[0].id)) return record;
                const adapted = clone(record);
                adapted.beliefIds = [aliases[0].id];
                delete adapted[aliases[0].key];
                return adapted;
            });
        }
        if (Array.isArray(normalized.activatedBeliefIds)) normalized.activatedBeliefIds = dedupeStringEntriesPreserveInvalid(normalized.activatedBeliefIds);
        return normalized;
    }

    function recordTransientResult(result) {
        if (!setup.AITransientDebug) return;
        setup.AITransientDebug.lastUsage = result && result.usage ? clone(result.usage) : null;
        setup.AITransientDebug.lastSafeError = result && !result.ok && result.error ? result.error.message : "";
    }

    function characterSnapshot(characterId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character") return failure("ACTOR_NOT_FOUND", "Character does not exist.");
        return {
            ok: true,
            characterId: characterId,
            mindRevision: Number.isInteger(actor.mindRevision) ? actor.mindRevision : 0,
            mind: clone(actor.mind),
            character: setup.CharacterContext.buildPrivateCharacter(characterId),
            recentDialogue: clone(setup.MindValidators.sanitizeRecentDialogue(actor.recentDialogue, world))
        };
    }

    function beliefIds(mind) { return new Set((mind.beliefs || []).map(function (belief) { return belief.id; })); }
    function memoryIds(mind, partition) { return new Set((mind[partition] || []).map(function (memory) { return memory.id; })); }

    function validateMemoryProposal(record, requireId) {
        if (!isObject(record)) return false;
        const keys = requireId ? ["id", "topic", "summary", "importance"] : ["topic", "summary", "importance"];
        if (!exactKeys(record, keys)) return false;
        if (requireId && (typeof record.id !== "string" || !V.ID_PATTERN.test(record.id))) return false;
        return validText(record.topic, 240) && validText(record.summary, 2000) && validImportance(record.importance);
    }

    function validProvenanceIds(values) {
        return Array.isArray(values) && values.every(function (id) { return typeof id === "string" && V.ID_PATTERN.test(id); });
    }

    function validateLtmUpsertProposal(record) {
        return isObject(record) && exactKeys(record, ["id", "topic", "summary", "importance", "sourceStmIds", "sourceLtmIds"]) &&
            typeof record.id === "string" && V.ID_PATTERN.test(record.id) &&
            validText(record.topic, 240) && validText(record.summary, 2000) && validImportance(record.importance) &&
            validProvenanceIds(record.sourceStmIds) && validProvenanceIds(record.sourceLtmIds) &&
            (record.sourceStmIds.length > 0 || record.sourceLtmIds.length > 0);
    }

    function validateLtmAddProposal(record) {
        return isObject(record) && exactKeys(record, ["ref", "topic", "summary", "importance", "sourceStmIds", "sourceLtmIds"]) &&
            validText(record.ref, 80) && validText(record.topic, 240) && validText(record.summary, 2000) && validImportance(record.importance) &&
            validProvenanceIds(record.sourceStmIds) && validProvenanceIds(record.sourceLtmIds) &&
            (record.sourceStmIds.length > 0 || record.sourceLtmIds.length > 0);
    }

    function validateBeliefEffect(effect, allowedIds) {
        return isObject(effect) && exactKeys(effect, ["beliefId", "effect", "strength"]) &&
            allowedIds.has(effect.beliefId) && ["supports", "contradicts", "ambiguous"].includes(effect.effect) && validStrength(effect.strength);
    }

    function validateBeliefAdd(record) {
        return isObject(record) && exactKeys(record, ["text", "initialConfidence", "initialActivation"]) &&
            validText(record.text, 500) && typeof record.initialConfidence === "number" && Number.isFinite(record.initialConfidence) &&
            record.initialConfidence > 0 && record.initialConfidence < 1 &&
            (record.initialActivation === null || (typeof record.initialActivation === "number" && Number.isFinite(record.initialActivation) && record.initialActivation > 0 && record.initialActivation < 1));
    }

    function validateStmResponse(value, snapshot) {
        value = normalizeMemoryProposalArrays(value, ["shortTermMemoriesToUpsert", "shortTermMemoriesToAdd"]);
        value = normalizeStmBeliefReferences(value, snapshot);
        const errors = [];
        const keys = ["shortTermMemoriesToUpsert", "shortTermMemoriesToAdd", "beliefEffects", "beliefsToAdd", "activatedBeliefIds"];
        if (!exactKeys(value, keys)) errors.push("response must contain exactly the Mind v3 STM result keys.");
        if (!isObject(value)) return { ok: false, errors: errors };
        keys.forEach(function (key) { if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`); });
        if (errors.length) return { ok: false, errors: errors };
        const memoryWriteCount = value.shortTermMemoriesToUpsert.length + value.shortTermMemoriesToAdd.length;
        if (memoryWriteCount > M.CONFIG.STM_WRITE_SET_LIMIT ||
            value.beliefEffects.length > M.CONFIG.STM_BELIEF_EFFECT_LIMIT ||
            value.beliefsToAdd.length > M.CONFIG.STM_NEW_BELIEF_LIMIT ||
            value.activatedBeliefIds.length > M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT) errors.push("STM response exceeds delta write-set limits.");
        const stmIds = memoryIds(snapshot.mind, "shortTermMemories");
        const stmById = new Map((snapshot.mind.shortTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const protectedStm = new Set((snapshot.mind.shortTermMemories || []).filter(function (memory) { return memory.protected; }).map(function (memory) { return memory.id; }));
        const seenUpserts = new Set();
        value.shortTermMemoriesToUpsert.forEach(function (record) {
            if (!validateMemoryProposal(record, true) || !stmIds.has(record.id) || protectedStm.has(record.id) || seenUpserts.has(record.id)) errors.push("Invalid STM upsert.");
            const existing = record && stmById.get(record.id);
            if (existing && record.topic.trim() === String(existing.topic || "").trim() && record.summary.trim() === String(existing.summary || "").trim() && record.importance === existing.importance) errors.push("STM upsert must materially change the persisted memory; omit unchanged STM instead.");
            seenUpserts.add(record && record.id);
        });
        value.shortTermMemoriesToAdd.forEach(function (record) { if (!validateMemoryProposal(record, false)) errors.push("Invalid STM add."); });
        const allowedBeliefs = beliefIds(snapshot.mind);
        const seenEffects = new Set();
        value.beliefEffects.forEach(function (effect) {
            if (!validateBeliefEffect(effect, allowedBeliefs) || seenEffects.has(effect.beliefId)) errors.push("Invalid or duplicate belief effect.");
            seenEffects.add(effect && effect.beliefId);
        });
        value.beliefsToAdd.forEach(function (record) { if (!validateBeliefAdd(record)) errors.push("Invalid new belief proposal."); });
        const activated = stableUniqueStrings(value.activatedBeliefIds);
        if (activated.length !== value.activatedBeliefIds.length || activated.some(function (id) { return !allowedBeliefs.has(id); })) errors.push("activatedBeliefIds contains invalid or duplicate IDs.");
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function validateLtmResponse(value, snapshot) {
        value = normalizeLtmResponseIngress(value, snapshot);
        const errors = [];
        const keys = ["longTermMemoriesToUpsert", "longTermMemoriesToAdd", "retirementGroups", "higherOrderBeliefEffects", "beliefsToAdd", "activatedBeliefIds"];
        if (!exactKeys(value, keys)) errors.push("response must contain exactly the Mind v3 LTM result keys.");
        if (!isObject(value)) return { ok: false, errors: errors };
        keys.forEach(function (key) { if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`); });
        if (errors.length) return { ok: false, errors: errors };
        const ltmIds = memoryIds(snapshot.mind, "longTermMemories");
        const ltmById = new Map((snapshot.mind.longTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const protectedLtm = new Set((snapshot.mind.longTermMemories || []).filter(function (memory) { return memory.protected; }).map(function (memory) { return memory.id; }));
        const seen = new Set();
        const stmIds = memoryIds(snapshot.mind, "shortTermMemories");
        function validateProvenance(record) {
            const sourceStm = stableUniqueStrings(record.sourceStmIds);
            const sourceLtm = stableUniqueStrings(record.sourceLtmIds);
            if (sourceStm.length !== record.sourceStmIds.length || sourceLtm.length !== record.sourceLtmIds.length) return false;
            if (sourceStm.some(function (id) { return !stmIds.has(id); })) return false;
            if (sourceLtm.some(function (id) { return !ltmIds.has(id); })) return false;
            return sourceStm.length > 0 || sourceLtm.length > 0;
        }
        value.longTermMemoriesToUpsert.forEach(function (record) {
            const validProposal = validateLtmUpsertProposal(record);
            if (!validProposal || !validateProvenance(record) || !ltmIds.has(record && record.id) || protectedLtm.has(record && record.id) || seen.has(record && record.id)) errors.push("Invalid LTM upsert or provenance.");
            const existing = validProposal ? ltmById.get(record.id) : null;
            if (existing && record.topic.trim() === String(existing.topic || "").trim() && record.summary.trim() === String(existing.summary || "").trim() && record.importance === existing.importance) errors.push("LTM upsert must materially change the persisted memory; omit unchanged LTM instead.");
            seen.add(record && record.id);
        });
        const addRefs = new Set();
        value.longTermMemoriesToAdd.forEach(function (record) {
            if (!validateLtmAddProposal(record) || !validateProvenance(record) || ltmIds.has(record && record.ref) || addRefs.has(record && record.ref)) errors.push("Invalid LTM add or provenance.");
            addRefs.add(record && record.ref);
        });
        const stmById = new Map((snapshot.mind.shortTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const validLtmRefs = new Set(Array.from(ltmIds).concat(Array.from(addRefs)));
        const retiredStmIds = new Set();
        const forgettingReasons = new Set(["routine", "redundant", "transient"]);
        value.retirementGroups.forEach(function (group) {
            if (!isObject(group) || !["represented", "safe_to_forget"].includes(group.disposition)) { errors.push("Invalid STM retirement group shape."); return; }
            const represented = group.disposition === "represented";
            const expectedKeys = represented ? ["stmIds", "disposition", "representedByLtmRefs"] : ["stmIds", "disposition", "representedByLtmRefs", "reason"];
            if (!exactKeys(group, expectedKeys) || !Array.isArray(group.stmIds) || !Array.isArray(group.representedByLtmRefs)) { errors.push("Invalid STM retirement group shape."); return; }
            const groupStmIds = stableUniqueStrings(group.stmIds);
            const refs = stableUniqueStrings(group.representedByLtmRefs);
            if (groupStmIds.length === 0 || groupStmIds.length !== group.stmIds.length || refs.length !== group.representedByLtmRefs.length) { errors.push("Invalid STM retirement group IDs."); return; }
            if (groupStmIds.some(function (id) { const memory = stmById.get(id); return !memory || memory.protected || retiredStmIds.has(id); })) errors.push("STM retirement group references invalid, protected, or repeated STM IDs.");
            groupStmIds.forEach(function (id) { retiredStmIds.add(id); });
            if (represented) {
                if (refs.length === 0 || refs.some(function (ref) { return !validLtmRefs.has(ref); })) errors.push("represented retirement groups must reference existing or proposed LTM.");
            } else {
                if (refs.length !== 0 || !forgettingReasons.has(group.reason)) errors.push("safe_to_forget retirement groups require an allowed reason and no LTM representation refs.");
            }
        });
        const allowedBeliefs = beliefIds(snapshot.mind);
        const effectIds = new Set();
        value.higherOrderBeliefEffects.forEach(function (effect) {
            if (!validateBeliefEffect(effect, allowedBeliefs) || effectIds.has(effect.beliefId)) errors.push("Invalid higher-order belief effect.");
            effectIds.add(effect && effect.beliefId);
        });
        value.beliefsToAdd.forEach(function (record) { if (!validateBeliefAdd(record)) errors.push("Invalid higher-order belief add."); });
        const activated = stableUniqueStrings(value.activatedBeliefIds);
        if (activated.length !== value.activatedBeliefIds.length || activated.some(function (id) { return !allowedBeliefs.has(id); })) errors.push("Invalid LTM activatedBeliefIds.");
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function reconciliationCandidates(snapshot) {
        const diagnostics = snapshot.mindDiagnostics || {};
        const historyById = diagnostics.beliefHistoryById || {};
        return (snapshot.mind.beliefs || []).map(function (belief, index) {
            const history = Array.isArray(historyById[belief.id]) ? historyById[belief.id] : [];
            const recentTension = history.slice(-4).some(function (entry) { return entry.effect === "contradicts"; }) ? 1.5 : 0;
            return { belief: belief, score: belief.activation * 3 + recentTension + Math.min(1, history.length * 0.15), index: index };
        }).sort(function (a, b) { return b.score - a.score || b.index - a.index; }).slice(0, M.CONFIG.RECONCILIATION_CANDIDATE_LIMIT).map(function (entry) { return entry.belief; });
    }

    function validateReconciliationResponse(value, snapshot, candidateBeliefs) {
        value = normalizeReconciliationIngress(value, candidateBeliefs);
        const errors = [];
        if (!exactKeys(value, ["resolutions", "activatedBeliefIds"]) || !Array.isArray(value.resolutions) || !Array.isArray(value.activatedBeliefIds)) return { ok: false, errors: ["Invalid reconciliation response shape."] };
        if (value.resolutions.length > M.CONFIG.RECONCILIATION_RESOLUTION_LIMIT || value.activatedBeliefIds.length > M.CONFIG.RECONCILIATION_ACTIVATED_BELIEF_LIMIT) errors.push("Reconciliation response exceeds bounded limits.");
        const allowed = new Set(candidateBeliefs.map(function (belief) { return belief.id; }));
        const used = new Set();
        const outcomes = new Set(["revise", "merge", "weaken", "reinforce", "contextualize", "supersede", "remove", "leave_unresolved"]);
        value.resolutions.forEach(function (record) {
            if (!isObject(record) || !exactKeys(record, ["beliefIds", "outcome", "survivorBeliefId", "replacementText", "evidenceEffect", "strength"])) { errors.push("Invalid reconciliation resolution shape."); return; }
            if (!Array.isArray(record.beliefIds) || record.beliefIds.length < 1 || record.beliefIds.length > 4 || !outcomes.has(record.outcome)) { errors.push("Invalid reconciliation resolution selection."); return; }
            const ids = stableUniqueStrings(record.beliefIds);
            if (ids.length !== record.beliefIds.length || ids.some(function (id) { return !allowed.has(id) || used.has(id); })) errors.push("Reconciliation belief IDs are invalid or reused.");
            ids.forEach(function (id) { used.add(id); });
            if (record.survivorBeliefId !== null && !ids.includes(record.survivorBeliefId)) errors.push("survivorBeliefId must be one of beliefIds or null.");
            const needsText = ["revise", "merge", "contextualize", "supersede"].includes(record.outcome);
            if (needsText !== validText(record.replacementText, 500)) errors.push("replacementText presence does not match reconciliation outcome.");
            if (!["supports", "contradicts", "ambiguous", null].includes(record.evidenceEffect)) errors.push("Invalid reconciliation evidenceEffect.");
            if (record.evidenceEffect === null ? record.strength !== null : !validStrength(record.strength)) errors.push("Invalid reconciliation strength.");
            if (["weaken", "reinforce"].includes(record.outcome) && record.evidenceEffect === null) errors.push("weaken/reinforce require evidence effect.");
        });
        const activated = stableUniqueStrings(value.activatedBeliefIds);
        if (activated.length !== value.activatedBeliefIds.length || activated.some(function (id) { return !allowed.has(id); })) errors.push("Invalid reconciliation activatedBeliefIds.");
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: value };
    }

    function parseObject(content) {
        try { return setup.AIProtocol.extractObject(content); } catch (error) { throw error; }
    }

    async function runJsonRequest(characterId, stage, systemText, payload, validator, client, options) {
        options = options || {};
        const messages = [
            { role: "system", content: systemText },
            { role: "user", content: JSON.stringify(payload) }
        ];
        const execute = options.concurrent && setup.AIRequestExecutor.executeCustomConcurrent ? setup.AIRequestExecutor.executeCustomConcurrent : setup.AIRequestExecutor.executeCustom;
        const result = await execute({
            actorId: characterId,
            purpose: options.purpose || "memory-consolidation",
            stage: stage,
            messages: messages,
            requestOptions: setup.AIRequestProfiles.resolve(options.requestProfile || "memory-consolidation", { actorId: characterId }),
            client: client || setup.OpenRouterClient,
            run: async function (policyClient) {
                let current = clone(messages);
                const trace = { stage: stage, attempts: [] };
                for (let attempt = 0; attempt < 2; attempt++) {
                    const response = await policyClient.chat(current);
                    const entry = { attempt: attempt + 1, rawContent: response && response.content || "", errors: [] };
                    trace.attempts.push(entry);
                    if (!response || !response.ok) return { ok: false, error: clone(response && response.error || { code: "AI_REQUEST_FAILED", message: "Auxiliary mind request failed." }), modelId: response && response.modelId || null, usage: response && response.usage || null, trace: trace };
                    let parsed, validation;
                    try { parsed = parseObject(response.content); validation = validator(parsed); }
                    catch (error) { validation = { ok: false, errors: [error.message] }; }
                    if (validation.ok) return { ok: true, value: clone(validation.value), modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content, repaired: attempt === 1, trace: trace };
                    entry.errors = clone(validation.errors || ["Invalid mind response."]);
                    if (attempt === 1) return { ok: false, error: { code: "INVALID_MODEL_JSON", message: "The model returned invalid Mind v3 protocol data.", details: entry.errors }, modelId: response.modelId || null, usage: response.usage || null, rawContent: response.content, trace: trace };
                    current = messages.concat([
                        { role: "assistant", content: String(response.content || "").slice(0, 12000) },
                        { role: "user", content: `Your previous response failed validation: ${entry.errors.join("; ")}. Return the complete corrected JSON object only, using exactly the requested keys and supplied IDs.` }
                    ]);
                }
            }
        });
        recordTransientResult(result);
        return result;
    }

    function stmSystem() {
        return [
            "You perform auxiliary Mind v3 short-term autobiographical consolidation for exactly one character. You do not take a game turn and cannot mutate the world.",
            "Memory answers what happened to this character. STM is thematic, relatively detailed, and aims for minimal information loss. Prefer updating an existing matching topic over creating duplicates. Group related observations into a small number of thematic memories rather than creating one memory per observation; keep summaries concise while preserving meaningful detail.",
            `IMPORTANT DELTA-ONLY WRITE SET: existing STM is persistent context and is read-only by default. Omit every existing STM that does not require a material change because of the current eviction evidence. Never restate unchanged STM. Never retopic, beautify, normalize, merge, or rewrite migrated/legacy STM merely to improve organization. Upsert only when newly consumed eviction observations materially extend or correct that same thematic memory. Unmentioned STM remains unchanged automatically. Total shortTermMemoriesToUpsert + shortTermMemoriesToAdd MUST be <= ${M.CONFIG.STM_WRITE_SET_LIMIT}; prefer 1-4 thematic memory writes when possible. beliefEffects MUST be <= ${M.CONFIG.STM_BELIEF_EFFECT_LIMIT}, beliefsToAdd <= ${M.CONFIG.STM_NEW_BELIEF_LIMIT}, and activatedBeliefIds <= ${M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT}. If the eviction material spans more themes than fit in the write budget, combine related evidence into broader thematic memories rather than touching unrelated old STM.`,
            "The complete verbatim snapshot is supplied together with explicit evictionObservationIds and retainedObservationIds. Eviction observations will be deleted only after a validated commit, so preserve their meaningful information with priority. Retained observations remain verbatim and are interpretive context.",
            "For direct belief reinforcement or contradiction, ONLY evictionObservationIds are newly consumed evidence. Retained observations, existing STM/LTM, relationships, and beliefs are context, not fresh evidence. Never count a belief as evidence for itself. beliefEffects and activatedBeliefIds MUST use exact IDs from the supplied beliefs array; never rename an ID because a display name or personal name differs from the canonical belief ID. The same valid belief may appear in both beliefEffects and activatedBeliefIds.",
            M.BELIEF_SEMANTICS,
            "Return JSON only. shortTermMemoriesToUpsert entries use existing STM IDs and contain id,topic,summary,importance. shortTermMemoriesToAdd contain topic,summary,importance. Memory importance MUST be a numeric decimal in the inclusive range 0..1 (for example 0.2, 0.5, 0.8); do NOT use a 1..10 scale. beliefEffects contain beliefId,effect(supports|contradicts|ambiguous),strength 0..1. beliefsToAdd contain text,initialConfidence,initialActivation where initialActivation may be null. activatedBeliefIds contains existing IDs made salient by interpretation. Do not invent engine-owned IDs."
        ].join(" ");
    }

    function ltmSystem() {
        return [
            "You perform auxiliary Mind v3 long-term autobiographical consolidation for exactly one character. You do not take a game turn.",
            "LTM preserves what remains durably important and may be more lossy than STM: durable relationship history, discoveries, conflicts, promises, important changes, emotional episodes, recurring patterns, and identity-relevant experience.",
            "EVIDENCE-DRIVEN DELTA: existing LTM is persistent context and read-only by default. Omit every existing LTM that does not materially need to change. Never retopic, beautify, normalize, merge, or rewrite LTM merely for style. Prefer updating an existing matching durable topic over creating a duplicate. There are NO arbitrary numeric limits on LTM writes, higher-order belief effects, new beliefs, activations, or STM retirements: make as many changes as the material genuinely justifies, but no unnecessary changes. Be concise, but completeness and preservation of meaningful autobiographical information are more important than minimizing the number of changes.",
            "Every material LTM upsert/add MUST carry provenance: sourceStmIds and sourceLtmIds arrays naming supplied memories that justify the change. At least one source ID is required. sourceStmIds may contain only supplied shortTermMemories IDs; sourceLtmIds may contain only supplied existingLongTermMemories IDs. Provenance is engine/debug metadata for this operation and is not persisted as character consciousness.",
            "STM retirement is selective and evidence-backed. There is no goal to empty STM. Retire an unprotected STM only by placing it in exactly one retirementGroups entry. Use disposition represented when its meaningful durable autobiographical content is preserved by one or more LTM records that will exist after this commit. Use disposition safe_to_forget only when its unique durable value does not justify preservation. Allowed safe_to_forget reasons are routine, redundant, transient. Never use safe_to_forget for a unique promise, agreement, boundary, secret, important biography, relationship development, unresolved goal/conflict, important discovery, significant change in understanding, emotionally defining episode, or consequential causal fact likely to matter later. Protected STM can never be retired or safe_to_forget. If unsure, leave the STM unretired.",
            "Keep retirementGroups compact: group many thematically related STM IDs together. representedByLtmRefs may contain existingLongTermMemories IDs or model-local refs from longTermMemoriesToAdd. Every LTM add MUST include a unique temporary ref such as new_ltm_1; this ref is only for this response and is not persisted. safe_to_forget groups MUST use an empty representedByLtmRefs array and a reason code.",
            "Do not emit unchanged/no-op LTM upserts. ID SPACES ARE DISTINCT: longTermMemoriesToUpsert may use ONLY IDs from existingLongTermMemories. To promote STM content into new durable memory, create longTermMemoriesToAdd with a temporary ref; never use an STM ID as an LTM ID.",
            "Do NOT blindly count STM events as fresh direct belief evidence again. higherOrderBeliefEffects are allowed only when a genuinely new pattern-level inference arises from combining multiple memories. beliefsToAdd likewise must be higher-order durable interpretations, not a rereading of one old event.",
            M.BELIEF_SEMANTICS,
            'Return exactly one JSON object with keys longTermMemoriesToUpsert,longTermMemoriesToAdd,retirementGroups,higherOrderBeliefEffects,beliefsToAdd,activatedBeliefIds. LTM upserts contain exactly {"id":"existing_ltm_id","topic":"...","summary":"...","importance":0.8,"sourceStmIds":["stm_id"],"sourceLtmIds":["existing_ltm_id"]}. LTM adds contain exactly {"ref":"new_ltm_1","topic":"...","summary":"...","importance":0.8,"sourceStmIds":["stm_id"],"sourceLtmIds":[]}. At least one provenance source array must be non-empty. A represented retirement group contains exactly {"stmIds":["stm_id_1","stm_id_2"],"disposition":"represented","representedByLtmRefs":["existing_ltm_id","new_ltm_1"]}. A forgettable group contains exactly {"stmIds":["stm_id_3"],"disposition":"safe_to_forget","representedByLtmRefs":[],"reason":"routine"}. beliefsToAdd contain exactly text,initialConfidence,initialActivation. Memory importance MUST be a numeric decimal in the inclusive range 0..1; do NOT use a 1..10 scale.'
        ].join(" ");
    }

    function reconciliationSystem() {
        return [
            "You perform Mind v3 belief reconciliation for one character. This is reflective interpretation, not compulsory database consistency.",
            "Use supplied autobiographical STM/LTM evidence. Beliefs may be wrong, biased, redundant, outdated, or mutually contradictory, and cognitive dissonance may deliberately remain unresolved.",
            M.BELIEF_SEMANTICS,
            `Choose only supplied candidate belief IDs and return at most ${M.CONFIG.RECONCILIATION_RESOLUTION_LIMIT} resolutions. beliefIds is ALWAYS an array, including single-belief operations.`,
            "Allowed outcomes are revise, merge, weaken, reinforce, contextualize, supersede, remove, leave_unresolved. For revise/merge/contextualize/supersede provide replacementText; otherwise replacementText must be null. survivorBeliefId is null unless an outcome keeps one supplied belief as the rewritten survivor. evidenceEffect is supports, contradicts, ambiguous, or null; strength is 0..1 when evidenceEffect is non-null and otherwise null. Confidence is never directly authored: the engine applies evidence math. A belief may be activated even when its confidence falls. Do not change autobiographical memory in this stage.",
            'Return exactly one JSON object with this shape and no extra keys: {"resolutions":[{"beliefIds":["supplied_belief_id"],"outcome":"leave_unresolved","survivorBeliefId":null,"replacementText":null,"evidenceEffect":null,"strength":null}],"activatedBeliefIds":[]}. For multi-belief merge/contextualize/supersede, beliefIds must explicitly contain every participating supplied belief ID. Do not use singular beliefId or candidateBeliefId fields.'
        ].join(" ");
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

    function pushMaintenanceSnapshot(actor, world, trigger) {
        const records = setup.AIMemory.sanitizeMaintenanceSnapshots(actor.mindMaintenanceSnapshots);
        records.push({ createdAt: new Date().toISOString(), turn: diagnosticTurn(world), trigger: trigger, mind: clone(actor.mind) });
        actor.mindMaintenanceSnapshots = records.slice(-setup.AIMemory.MAINTENANCE_SNAPSHOT_LIMIT);
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

    function applyStmCommit(characterId, snapshot, evictionIds, value, trigger) {
        const current = setup.Game.getWorld();
        const actor = current.entities[characterId];
        if (!stmSnapshotCompatible(snapshot, actor)) return failure("MIND_V3_STALE", "Mind content changed incompatibly while STM consolidation was in flight.");
        const currentById = new Map((actor.mind.verbatimObservations || []).map(function (record) { return [record.id, record]; }));
        for (const record of snapshot.mind.verbatimObservations || []) {
            const currentRecord = currentById.get(record.id);
            if (!currentRecord || JSON.stringify(currentRecord) !== JSON.stringify(record)) return failure("MIND_V3_STALE", "Verbatim source snapshot changed while STM consolidation was in flight.");
        }
        const candidate = clone(current);
        const cActor = candidate.entities[characterId];
        pushMaintenanceSnapshot(cActor, candidate, trigger);
        let changed = false;
        value.shortTermMemoriesToUpsert.forEach(function (proposal) {
            const index = cActor.mind.shortTermMemories.findIndex(function (memory) { return memory.id === proposal.id; });
            if (index < 0 || cActor.mind.shortTermMemories[index].protected) return;
            const replacement = Object.assign({}, cActor.mind.shortTermMemories[index], { topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance });
            if (JSON.stringify(replacement) !== JSON.stringify(cActor.mind.shortTermMemories[index])) { cActor.mind.shortTermMemories[index] = replacement; changed = true; }
        });
        value.shortTermMemoriesToAdd.forEach(function (proposal) {
            cActor.mind.shortTermMemories.push({ id: setup.AIMemory.allocateMemoryId(candidate), topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, protected: false });
            changed = true;
        });
        changed = applyBeliefEffects(cActor, value.beliefEffects, value.activatedBeliefIds, "stm-consolidation", candidate) || changed;
        changed = applyBeliefAdds(candidate, cActor, value.beliefsToAdd, "stm-consolidation") || changed;
        const eviction = new Set(evictionIds);
        const before = cActor.mind.verbatimObservations.length;
        cActor.mind.verbatimObservations = cActor.mind.verbatimObservations.filter(function (record) { return !eviction.has(record.id); });
        if (cActor.mind.verbatimObservations.length !== before) changed = true;
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const validation = validateCandidateWorld(candidate);
        if (!validation.ok) return validation;
        State.variables.world = candidate;
        return { ok: true, actorId: characterId, committed: true, evictedObservationIds: evictionIds.slice(), retainedVerbatimCount: cActor.mind.verbatimObservations.length, shortTermMemoryCount: cActor.mind.shortTermMemories.length, beliefCount: cActor.mind.beliefs.length };
    }

    async function consolidateSTM(characterId, client, options) {
        options = options || {};
        const snapshot = characterSnapshot(characterId);
        if (!snapshot.ok) return snapshot;
        const all = snapshot.mind.verbatimObservations || [];
        const forceAll = options.forceAll === true;
        if (all.length === 0) return { ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: 0 };
        if (!forceAll && options.force !== true && all.length <= M.CONFIG.STM_TRIGGER_COUNT) return { ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: all.length };
        const retainCount = forceAll ? 0 : M.CONFIG.VERBATIM_RETAIN_COUNT;
        const eviction = all.slice(0, Math.max(0, all.length - retainCount));
        const retained = all.slice(eviction.length);
        if (eviction.length === 0) return { ok: true, actorId: characterId, nothingToConsolidate: true, verbatimCount: all.length };
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
            stmWritePolicy: {
                mode: "delta-only",
                maxMemoryWrites: M.CONFIG.STM_WRITE_SET_LIMIT,
                maxBeliefEffects: M.CONFIG.STM_BELIEF_EFFECT_LIMIT,
                maxBeliefsToAdd: M.CONFIG.STM_NEW_BELIEF_LIMIT,
                maxActivatedBeliefIds: M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT,
                unchangedExistingStm: "omit",
                legacyCleanup: "forbidden"
            },
            requiredResponseShape: {
                shortTermMemoriesToUpsert: [], shortTermMemoriesToAdd: [], beliefEffects: [], beliefsToAdd: [], activatedBeliefIds: []
            }
        };
        const result = await runJsonRequest(characterId, "mind-v3-stm", stmSystem(), payload, function (value) { return validateStmResponse(value, snapshot); }, client, {
            purpose: options.purpose || "memory-consolidation", concurrent: options.concurrent === true, requestProfile: "mind-v3-stm"
        });
        if (!result.ok) return result;
        if (typeof options.beforeCommit === "function" && options.beforeCommit() === false) return failure("MIND_V3_JOB_INVALIDATED", "Background mind job was invalidated before commit.");
        const commit = applyStmCommit(characterId, snapshot, payload.evictionObservationIds, result.value, options.trigger || (options.purpose === "mind-background" ? "automatic" : "manual"));
        if (!commit.ok) return commit;
        commit.modelId = result.modelId || null;
        commit.usage = clone(result.usage || null);
        commit.repaired = Boolean(result.repaired);
        return commit;
    }

    function applyLtmCommit(characterId, snapshot, value, trigger) {
        const current = setup.Game.getWorld();
        const actor = current.entities[characterId];
        if (staleBase(snapshot, actor)) return failure("MIND_V3_STALE", "Mind changed incompatibly while LTM consolidation was in flight.");
        const candidate = clone(current);
        const cActor = candidate.entities[characterId];
        pushMaintenanceSnapshot(cActor, candidate, trigger);
        let changed = false;
        value.longTermMemoriesToUpsert.forEach(function (proposal) {
            const index = cActor.mind.longTermMemories.findIndex(function (memory) { return memory.id === proposal.id; });
            if (index < 0 || cActor.mind.longTermMemories[index].protected) return;
            const replacement = Object.assign({}, cActor.mind.longTermMemories[index], { topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance });
            if (JSON.stringify(replacement) !== JSON.stringify(cActor.mind.longTermMemories[index])) { cActor.mind.longTermMemories[index] = replacement; changed = true; }
        });
        value.longTermMemoriesToAdd.forEach(function (proposal) {
            cActor.mind.longTermMemories.push({ id: setup.AIMemory.allocateMemoryId(candidate), topic: proposal.topic.trim(), summary: proposal.summary.trim(), importance: proposal.importance, protected: false }); changed = true;
        });
        const retire = new Set();
        value.retirementGroups.forEach(function (group) { group.stmIds.forEach(function (id) { retire.add(id); }); });
        const beforeStm = cActor.mind.shortTermMemories.length;
        cActor.mind.shortTermMemories = cActor.mind.shortTermMemories.filter(function (memory) { return memory.protected || !retire.has(memory.id); });
        changed = changed || beforeStm !== cActor.mind.shortTermMemories.length;
        changed = applyBeliefEffects(cActor, value.higherOrderBeliefEffects, value.activatedBeliefIds, "ltm-consolidation", candidate) || changed;
        changed = applyBeliefAdds(candidate, cActor, value.beliefsToAdd, "ltm-consolidation") || changed;
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
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
        const payload = {
            stage: "mind-v3-ltm", character: snapshot.character,
            shortTermMemories: clone(snapshot.mind.shortTermMemories || []), existingLongTermMemories: clone(snapshot.mind.longTermMemories || []),
            relationships: clone(snapshot.mind.relationships || []), beliefs: clone(snapshot.mind.beliefs || []), beliefSemantics: M.BELIEF_SEMANTICS,
            ltmWritePolicy: {
                mode: "evidence-driven-delta",
                operationCountLimits: "none",
                retirementMode: "coverage-groups-unbounded",
                retirementDispositions: ["represented", "safe_to_forget"],
                safeToForgetReasons: ["routine", "redundant", "transient"],
                provenanceRequired: true,
                provenanceFields: ["sourceStmIds", "sourceLtmIds"],
                unchangedExistingLtm: "omit",
                legacyCleanup: "forbidden"
            },
            requiredResponseShape: { longTermMemoriesToUpsert: [], longTermMemoriesToAdd: [], retirementGroups: [], higherOrderBeliefEffects: [], beliefsToAdd: [], activatedBeliefIds: [] }
        };
        const result = await runJsonRequest(characterId, "mind-v3-ltm", ltmSystem(), payload, function (value) { return validateLtmResponse(value, snapshot); }, client, { purpose: options.purpose || "memory-consolidation", concurrent: options.concurrent === true, requestProfile: "mind-v3-ltm" });
        if (!result.ok) return result;
        const commit = applyLtmCommit(characterId, snapshot, result.value, options.trigger || "manual");
        if (!commit.ok) return commit;
        commit.modelId = result.modelId || null; commit.usage = clone(result.usage || null); commit.repaired = Boolean(result.repaired); return commit;
    }

    function relevantEvidence(snapshot, candidates) {
        const terms = candidates.map(function (belief) { return String(belief.text || "").toLowerCase().split(/[^a-z0-9_'-]+/).filter(function (term) { return term.length > 4; }); }).flat();
        return (snapshot.mind.shortTermMemories || []).concat(snapshot.mind.longTermMemories || []).map(function (memory, index) {
            const text = `${memory.topic} ${memory.summary}`.toLowerCase();
            const match = terms.some(function (term) { return text.includes(term); }) ? 3 : 0;
            return { memory: memory, score: match + memory.importance + index / 1000 };
        }).sort(function (a, b) { return b.score - a.score; }).slice(0, 24).map(function (entry) { return entry.memory; });
    }

    function applyReconciliationCommit(characterId, snapshot, candidates, value, trigger) {
        const current = setup.Game.getWorld(); const actor = current.entities[characterId];
        if (staleBase(snapshot, actor)) return failure("MIND_V3_STALE", "Mind changed incompatibly while reconciliation was in flight.");
        const candidate = clone(current); const cActor = candidate.entities[characterId]; pushMaintenanceSnapshot(cActor, candidate, trigger);
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
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
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
        const commit = applyReconciliationCommit(characterId, snapshot, candidates, result.value, options.trigger || "manual");
        if (!commit.ok) return commit;
        commit.modelId = result.modelId || null; commit.usage = clone(result.usage || null); return commit;
    }

    function decayActivation(characterId, elapsedUnits, trigger) {
        const current = setup.Game.getWorld(); const actor = current.entities[characterId];
        if (!actor || actor.type !== "character") return failure("ACTOR_NOT_FOUND", "Character does not exist.");
        const candidate = clone(current); const cActor = candidate.entities[characterId]; pushMaintenanceSnapshot(cActor, candidate, trigger || "timelapse");
        let changed = false;
        (cActor.mind.beliefs || []).forEach(function (belief) {
            const before = belief.activation; const after = M.decayActivation(before, elapsedUnits === undefined ? 1 : elapsedUnits);
            if (after !== before) {
                belief.activation = after; changed = true;
                setup.AIMemory.addBeliefDiagnostic(cActor, belief.id, { atTurn: diagnosticTurn(candidate), source: "timelapse-decay", deltaActivation: after - before });
            }
        });
        if (changed) setup.AIMemory.incrementMindRevision(cActor);
        const validation = validateCandidateWorld(candidate); if (!validation.ok) return validation;
        State.variables.world = candidate;
        return { ok: true, actorId: characterId, committed: true, changed: changed };
    }

    async function maintainTimelapse(characterId, client, options) {
        options = options || {};
        const report = { actorId: characterId, stages: [], errors: [] };
        function recordSkipped(stage, reason) {
            const result = { ok: true, actorId: characterId, skipped: true, reason: reason };
            report.stages.push({ stage: stage, result: clone(result) });
            return result;
        }

        const stm = await consolidateSTM(characterId, client, { force: true, purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true });
        report.stages.push({ stage: "stm", result: clone(stm) });
        if (!stm.ok) report.errors.push({ stage: "stm", error: clone(stm.error) });

        let ltm = null;
        let reconciliation = null;
        if (!stm.ok) {
            ltm = recordSkipped("ltm", "skipped_due_to_stm_failure");
            reconciliation = recordSkipped("reconciliation", "skipped_due_to_stm_failure");
        } else {
            ltm = await consolidateLTM(characterId, client, { force: true, purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true });
            report.stages.push({ stage: "ltm", result: clone(ltm) });
            if (!ltm.ok) {
                report.errors.push({ stage: "ltm", error: clone(ltm.error) });
                reconciliation = recordSkipped("reconciliation", "skipped_due_to_ltm_failure");
            } else {
                reconciliation = await reconcileBeliefs(characterId, client, { purpose: "memory-consolidation", trigger: "timelapse", concurrent: options.concurrent === true });
                report.stages.push({ stage: "reconciliation", result: clone(reconciliation) });
                if (!reconciliation.ok) report.errors.push({ stage: "reconciliation", error: clone(reconciliation.error) });
            }
        }

        const decay = decayActivation(characterId, options.elapsedMaintenanceUnits || 1, "timelapse");
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
        const stm = await consolidateSTM(characterId, client, { force: options.automatic !== true, purpose: options.purpose || "memory-consolidation", trigger: options.automatic ? "automatic" : "manual" });
        results.push({ stage: "stm", result: clone(stm) });
        if (!stm.ok) return stm;
        if (options.stmOnly === true || options.automatic === true) return { ok: true, actorId: characterId, stages: results, consolidation: { committed: stm.committed === true, verbatimCount: setup.Game.getWorld().entities[characterId].mind.verbatimObservations.length } };
        const ltm = await consolidateLTM(characterId, client, { force: true, trigger: "manual" }); results.push({ stage: "ltm", result: clone(ltm) }); if (!ltm.ok) return ltm;
        const reconciliation = await reconcileBeliefs(characterId, client, { trigger: "manual" }); results.push({ stage: "reconciliation", result: clone(reconciliation) }); if (!reconciliation.ok) return reconciliation;
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
