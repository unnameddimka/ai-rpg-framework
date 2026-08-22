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
        if (!Object.prototype.hasOwnProperty.call(normalized, "retrievalBrief")) normalized.retrievalBrief = "";
        return normalized;
    }
    function memoryWritableState(record) {
        if (!isObject(record)) return null;
        return {
            topic: typeof record.topic === "string" ? record.topic.trim() : record.topic,
            summary: typeof record.summary === "string" ? record.summary.trim() : record.summary,
            importance: normalizeImportance(record.importance),
            retrievalBrief: typeof record.retrievalBrief === "string" ? record.retrievalBrief.trim() : ""
        };
    }
    function memoryUpsertHasEffect(record, existing) {
        if (!isObject(record) || !isObject(existing)) return true;
        return JSON.stringify(memoryWritableState(record)) !== JSON.stringify(memoryWritableState(existing));
    }
    function normalizeMemoryProposalArrays(value, keys) {
        if (!isObject(value)) return value;
        const normalized = clone(value);
        (keys || []).forEach(function (key) {
            if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(normalizeMemoryProposal);
        });
        return normalized;
    }
    function normalizeStmMemoryProposal(record) {
        if (!isObject(record)) return record;
        const normalized = normalizeMemoryProposal(record);
        // `protected` is engine-owned persistence state. Models sometimes echo it from
        // supplied STM context; ignore the echo rather than turning a harmless copy into
        // a repair request. Unknown non-engine fields remain untouched so exact protocol
        // validation still rejects them.
        delete normalized.protected;
        return normalized;
    }
    function normalizeStmRepartitionProposal(record) {
        if (!isObject(record)) return record;
        const normalized = clone(record);
        if (Array.isArray(normalized.replacementRecords)) normalized.replacementRecords = normalized.replacementRecords.map(normalizeStmMemoryProposal);
        return normalized;
    }
    function normalizeStmMemoryProposalArrays(value) {
        if (!isObject(value)) return value;
        const normalized = clone(value);
        ["shortTermMemoriesToUpsert", "shortTermMemoriesToAdd"].forEach(function (key) {
            if (Array.isArray(normalized[key])) normalized[key] = normalized[key].map(normalizeStmMemoryProposal);
        });
        if (Array.isArray(normalized.stmRepartitions)) normalized.stmRepartitions = normalized.stmRepartitions.map(normalizeStmRepartitionProposal);
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
                    (exactKeys(candidate, ["id", "summary", "importance", "retrievalBrief"]) || exactKeys(candidate, ["id", "summary", "importance", "retrievalBrief", "sourceStmIds", "sourceLtmIds"]))) {
                    const source = knownLtm || knownStm;
                    if (source && typeof source.topic === "string") candidate.topic = source.topic;
                }
                candidate = normalizeMemoryProposal(candidate);
                if (knownStm && !knownLtm && validateMemoryProposal({ id: candidate.id, topic: candidate.topic, summary: candidate.summary, importance: candidate.importance, retrievalBrief: String(candidate.retrievalBrief || "") }, true, M.CONFIG.LTM_SUMMARY_MAX_CHARS)) {
                    promotedAdds.push({ topic: candidate.topic, summary: candidate.summary, importance: candidate.importance, retrievalBrief: String(candidate.retrievalBrief || ""), sourceStmIds: [knownStm.id], sourceLtmIds: [] });
                    return null;
                }
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
                    (exactKeys(candidate, ["topic", "summary", "importance", "retrievalBrief"]) || exactKeys(candidate, ["topic", "summary", "importance", "retrievalBrief", "sourceStmIds", "sourceLtmIds"]))) {
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

    function beliefIds(mind) { return new Set((mind.beliefs || []).map(function (belief) { return belief.id; })); }
    function memoryIds(mind, partition) { return new Set((mind[partition] || []).map(function (memory) { return memory.id; })); }

    function memoryRetrievalBriefGuidance() {
        return `retrievalBrief uses the same semantics for STM and LTM: it is compact semantic retrieval metadata, NOT a second summary. Describe what the memory is mainly about and when/why it may matter for future retrieval; do not retell the sequence of events; do not chronologically retell the events; and do not duplicate the full summary. HARD LIMIT: every retrievalBrief MUST be ${V.RETRIEVAL_BRIEF_MAX} characters or fewer and should normally be substantially shorter. Do not use retrievalBrief as evidence.`;
    }

    function validateMemoryProposal(record, requireId, maxSummaryLength) {
        if (!isObject(record)) return false;
        const keys = requireId ? ["id", "topic", "summary", "importance", "retrievalBrief"] : ["topic", "summary", "importance", "retrievalBrief"];
        if (!exactKeys(record, keys)) return false;
        if (requireId && (typeof record.id !== "string" || !V.ID_PATTERN.test(record.id))) return false;
        const summaryLimit = Number.isInteger(maxSummaryLength) ? maxSummaryLength : M.CONFIG.LTM_SUMMARY_MAX_CHARS;
        return validText(record.topic, 240) && validText(record.summary, summaryLimit) && V.retrievalBriefValid(record.retrievalBrief) && validImportance(record.importance);
    }

    function validateStmReplacementProposal(record) {
        if (!isObject(record)) return false;
        const hasId = Object.prototype.hasOwnProperty.call(record, "id");
        return validateMemoryProposal(record, hasId, M.CONFIG.STM_SUMMARY_MAX_CHARS);
    }

    function oversizedStmDiagnostic(record, label) {
        if (!isObject(record) || typeof record.summary !== "string" || record.summary.trim().length <= M.CONFIG.STM_SUMMARY_MAX_CHARS) return null;
        const id = typeof record.id === "string" ? ` ${record.id}` : "";
        return `${label}${id} proposed summary is ${record.summary.trim().length} characters. Hard maximum is ${M.CONFIG.STM_SUMMARY_MAX_CHARS} characters. Do not discard meaningful information merely to fit the existing record. You may semantically repartition the source STM into multiple coherent STM records, or produce another valid structure that preserves the relevant information.`;
    }

    function oversizedLtmDiagnostic(record, label) {
        if (!isObject(record) || typeof record.summary !== "string" || record.summary.trim().length <= M.CONFIG.LTM_SUMMARY_MAX_CHARS) return null;
        const identity = typeof record.id === "string" ? ` ${record.id}` : (typeof record.ref === "string" ? ` ${record.ref}` : "");
        return `${label}${identity} proposed summary is ${record.summary.trim().length} characters. Hard maximum is ${M.CONFIG.LTM_SUMMARY_MAX_CHARS} characters. LTM is subtractive durable memory: remove minor, repetitive, transient, or low-value detail when appropriate, but do not discard a significant durable fact merely to fit one record. If the material contains multiple distinct durable themes, create multiple semantically coherent LTM records rather than forcing them into one oversized record or mechanically splitting by size.`;
    }

    function validProvenanceIds(values) {
        return Array.isArray(values) && values.every(function (id) { return typeof id === "string" && V.ID_PATTERN.test(id); });
    }

    function validateLtmUpsertProposal(record) {
        return isObject(record) && exactKeys(record, ["id", "topic", "summary", "importance", "retrievalBrief", "sourceStmIds", "sourceLtmIds"]) &&
            typeof record.id === "string" && V.ID_PATTERN.test(record.id) &&
            validText(record.topic, 240) && validText(record.summary, M.CONFIG.LTM_SUMMARY_MAX_CHARS) && V.retrievalBriefValid(record.retrievalBrief) && validImportance(record.importance) &&
            validProvenanceIds(record.sourceStmIds) && validProvenanceIds(record.sourceLtmIds) &&
            (record.sourceStmIds.length > 0 || record.sourceLtmIds.length > 0);
    }

    function validateLtmAddProposal(record) {
        return isObject(record) && exactKeys(record, ["ref", "topic", "summary", "importance", "retrievalBrief", "sourceStmIds", "sourceLtmIds"]) &&
            validText(record.ref, 80) && validText(record.topic, 240) && validText(record.summary, M.CONFIG.LTM_SUMMARY_MAX_CHARS) && V.retrievalBriefValid(record.retrievalBrief) && validImportance(record.importance) &&
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
        value = normalizeStmMemoryProposalArrays(value);
        value = normalizeStmBeliefReferences(value, snapshot);
        const errors = [];
        const keys = ["shortTermMemoriesToUpsert", "shortTermMemoriesToAdd", "stmRepartitions", "beliefEffects", "beliefsToAdd", "activatedBeliefIds"];
        if (!exactKeys(value, keys)) errors.push("response must contain exactly the Mind v3 STM result keys.");
        if (!isObject(value)) return { ok: false, errors: errors };
        keys.forEach(function (key) { if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`); });
        if (errors.length) return { ok: false, errors: errors };
        const repartitionWriteCount = value.stmRepartitions.reduce(function (total, operation) {
            return total + (isObject(operation) && Array.isArray(operation.replacementRecords) ? operation.replacementRecords.length : 0);
        }, 0);
        const memoryWriteCount = value.shortTermMemoriesToUpsert.length + value.shortTermMemoriesToAdd.length + repartitionWriteCount;
        if (memoryWriteCount > M.CONFIG.STM_WRITE_SET_LIMIT ||
            value.beliefEffects.length > M.CONFIG.STM_BELIEF_EFFECT_LIMIT ||
            value.beliefsToAdd.length > M.CONFIG.STM_NEW_BELIEF_LIMIT ||
            value.activatedBeliefIds.length > M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT) errors.push("STM response exceeds delta write-set limits.");
        const stmIds = memoryIds(snapshot.mind, "shortTermMemories");
        const stmById = new Map((snapshot.mind.shortTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const protectedStm = new Set((snapshot.mind.shortTermMemories || []).filter(function (memory) { return memory.protected; }).map(function (memory) { return memory.id; }));
        const seenUpserts = new Set();
        value.shortTermMemoriesToUpsert.forEach(function (record) {
            const valid = validateMemoryProposal(record, true, M.CONFIG.STM_SUMMARY_MAX_CHARS);
            if (!valid || !stmIds.has(record && record.id) || protectedStm.has(record && record.id) || seenUpserts.has(record && record.id)) {
                errors.push(oversizedStmDiagnostic(record, "STM") || "Invalid STM upsert.");
            }
            const existing = valid ? stmById.get(record.id) : null;
            if (existing && !memoryUpsertHasEffect(record, existing)) errors.push(`STM ${record.id} upsert has no effect after normalization. Omit unchanged STM entirely; do not cosmetically rewrite it merely to preserve an unnecessary upsert.`);
            seenUpserts.add(record && record.id);
        });
        value.shortTermMemoriesToAdd.forEach(function (record) {
            if (!validateMemoryProposal(record, false, M.CONFIG.STM_SUMMARY_MAX_CHARS)) errors.push("Invalid STM add.");
        });

        const repartitionSources = new Set();
        value.stmRepartitions.forEach(function (operation) {
            if (!isObject(operation) || !exactKeys(operation, ["sourceStmIds", "replacementRecords"]) || !Array.isArray(operation.sourceStmIds) || !Array.isArray(operation.replacementRecords) || operation.sourceStmIds.length === 0 || operation.replacementRecords.length === 0) {
                errors.push("Invalid STM repartition shape; sourceStmIds and replacementRecords must be non-empty arrays.");
                return;
            }
            const sources = stableUniqueStrings(operation.sourceStmIds);
            if (sources.length !== operation.sourceStmIds.length || sources.some(function (id) { return !V.ID_PATTERN.test(id) || !stmIds.has(id); })) errors.push("STM repartition contains an unknown, invalid, or duplicate sourceStmId.");
            if (sources.some(function (id) { return protectedStm.has(id); })) errors.push("Protected STM cannot be a repartition source.");
            if (sources.some(function (id) { return seenUpserts.has(id); })) errors.push("An STM cannot be both a normal upsert target and a repartition source in the same proposal.");
            if (sources.some(function (id) { return repartitionSources.has(id); })) errors.push("Overlapping STM repartition source sets are invalid.");
            sources.forEach(function (id) { repartitionSources.add(id); });

            const retainedIds = new Set();
            operation.replacementRecords.forEach(function (record) {
                if (!validateStmReplacementProposal(record)) {
                    errors.push(oversizedStmDiagnostic(record, "STM repartition replacement") || "Invalid STM repartition replacement record.");
                    return;
                }
                if (Object.prototype.hasOwnProperty.call(record, "id")) {
                    if (!sources.includes(record.id)) errors.push("A repartition replacement may retain only an ID from its own sourceStmIds.");
                    if (retainedIds.has(record.id)) errors.push("A repartition source ID may be retained by at most one replacement record.");
                    const existingSource = stmById.get(record.id);
                    if (existingSource && !memoryUpsertHasEffect(record, existingSource)) errors.push(`STM repartition replacement ${record.id} has no effect after normalization. If the source record remains unchanged, omit that replacement and use an ordinary create for genuinely new material instead of echoing the source.`);
                    retainedIds.add(record.id);
                }
            });
            if (retainedIds.size > 1) errors.push("At most one replacement record may retain an existing source STM ID in a repartition.");
        });

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

    function validateLtmPreflightResponse(value, snapshot) {
        const errors = [];
        if (!isObject(value) || !exactKeys(value, ["relevantLtmIds"])) return { ok: false, errors: ["LTM preflight response must contain exactly relevantLtmIds."] };
        if (!Array.isArray(value.relevantLtmIds)) return { ok: false, errors: ["relevantLtmIds must be an array."] };
        const allowed = memoryIds(snapshot.mind, "longTermMemories");
        const seen = new Set();
        value.relevantLtmIds.forEach(function (id, index) {
            if (typeof id !== "string" || !id) errors.push(`relevantLtmIds[${index}] must be a non-empty LTM ID string.`);
            else if (!allowed.has(id)) errors.push(`relevantLtmIds[${index}] references unknown LTM ${id}.`);
            else if (seen.has(id)) errors.push(`relevantLtmIds[${index}] duplicates LTM ${id}.`);
            seen.add(id);
        });
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: { relevantLtmIds: value.relevantLtmIds.slice() } };
    }

    function validateLtmResponse(value, snapshot, options) {
        options = options || {};
        value = normalizeLtmResponseIngress(value, snapshot);
        const errors = [];
        const keys = ["longTermMemoriesToUpsert", "longTermMemoriesToAdd", "retirementGroups", "higherOrderBeliefEffects", "beliefsToAdd", "activatedBeliefIds"];
        if (!exactKeys(value, keys)) errors.push("response must contain exactly the Mind v3 LTM result keys.");
        if (!isObject(value)) return { ok: false, errors: errors };
        keys.forEach(function (key) { if (!Array.isArray(value[key])) errors.push(`${key} must be an array.`); });
        if (errors.length) return { ok: false, errors: errors };
        const ltmIds = memoryIds(snapshot.mind, "longTermMemories");
        const allowedExistingLtmIds = options.allowedExistingLtmIds === undefined || options.allowedExistingLtmIds === null
            ? new Set(Array.from(ltmIds))
            : new Set(Array.from(options.allowedExistingLtmIds));
        const ltmById = new Map((snapshot.mind.longTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const protectedLtm = new Set((snapshot.mind.longTermMemories || []).filter(function (memory) { return memory.protected; }).map(function (memory) { return memory.id; }));
        const seen = new Set();
        const stmIds = memoryIds(snapshot.mind, "shortTermMemories");
        function validateProvenance(record) {
            const sourceStm = stableUniqueStrings(record.sourceStmIds);
            const sourceLtm = stableUniqueStrings(record.sourceLtmIds);
            if (sourceStm.length !== record.sourceStmIds.length || sourceLtm.length !== record.sourceLtmIds.length) return false;
            if (sourceStm.some(function (id) { return !stmIds.has(id); })) return false;
            if (sourceLtm.some(function (id) { return !allowedExistingLtmIds.has(id); })) return false;
            if (record.id) return sourceStm.length > 0 || sourceLtm.some(function (id) { return id !== record.id; });
            return sourceStm.length > 0 || sourceLtm.length > 0;
        }
        value.longTermMemoriesToUpsert.forEach(function (record) {
            const validProposal = validateLtmUpsertProposal(record);
            if (record && ltmIds.has(record.id) && !allowedExistingLtmIds.has(record.id)) errors.push(`LTM ${record.id} was not selected by the LTM semantic preflight and cannot be upserted in this consolidation request.`);
            if (!validProposal || !validateProvenance(record) || !allowedExistingLtmIds.has(record && record.id) || protectedLtm.has(record && record.id) || seen.has(record && record.id)) errors.push(oversizedLtmDiagnostic(record, "LTM upsert") || "Invalid LTM upsert or provenance.");
            const existing = validProposal ? ltmById.get(record.id) : null;
            if (existing && !memoryUpsertHasEffect(record, existing)) errors.push(`LTM ${record.id} upsert has no effect after normalization. Relevance or provenance does not justify returning unchanged LTM. Omit this upsert entirely; do not cosmetically rewrite it.`);
            seen.add(record && record.id);
        });
        const addRefs = new Set();
        value.longTermMemoriesToAdd.forEach(function (record) {
            if (!validateLtmAddProposal(record) || !validateProvenance(record) || ltmIds.has(record && record.ref) || addRefs.has(record && record.ref)) errors.push(oversizedLtmDiagnostic(record, "LTM add") || "Invalid LTM add or provenance.");
            addRefs.add(record && record.ref);
        });
        const stmById = new Map((snapshot.mind.shortTermMemories || []).map(function (memory) { return [memory.id, memory]; }));
        const validLtmRefs = new Set(Array.from(allowedExistingLtmIds).concat(Array.from(addRefs)));
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

    function stmSystem() {
        return [
            "You perform auxiliary Mind v3 short-term autobiographical consolidation for exactly one character. You do not take a game turn and cannot mutate the world.",
            M.MODEL_OUTPUT_EFFECT_INVARIANT,
            `Memory answers what happened to this character. STM is thematic, relatively detailed, high-fidelity working memory and aims for minimal information loss. Group related observations into a small number of thematic memories rather than creating one memory per observation. Prefer updating an existing matching topic only while the old and new evidence still form one coherent bounded memory record. Do not force all evidence about a broad or continuing topic into one STM. Prefer STM summaries at or below ${M.CONFIG.STM_SUMMARY_PREFERRED_MAX_CHARS} characters when practical, but ${M.CONFIG.STM_SUMMARY_MAX_CHARS} characters is a HARD PER-RECORD boundary, not a request to delete useful detail. Semantic coherence and information preservation take priority over compactness within that hard limit.`,
            `SEMANTIC REPARTITION: if an existing STM has grown too broad, contains separable subthemes, or cannot incorporate relevant eviction evidence while preserving useful detail within ${M.CONFIG.STM_SUMMARY_MAX_CHARS} characters, use stmRepartitions to reorganize one or more source STM records into multiple coherent replacementRecords. Preserve as much meaningful information as reasonably possible from both the source STM and newly consumed eviction observations across the replacement set. Choose meaningful topical/subtopical boundaries yourself. Do NOT mechanically split by character count, midpoint, event count, or arbitrary chronological "part 1 / part 2" chunks unless chronology itself is the meaningful distinction. Do not aggressively compress or discard substantial detail merely to keep one old record alive. Do not split a coherent bounded memory merely to create smaller records; repartition only when semantic separation improves coherence/retrieval or is needed to preserve information within the hard record limit.`,
            `IMPORTANT DELTA-ONLY WRITE SET: existing STM is persistent context and is read-only by default. Omit every existing STM that does not require a material change because of the current eviction evidence. Relevance is not mutation: do not return an STM merely because it was useful context. Never restate unchanged STM, including inside a repartition. Never retopic, beautify, normalize, merge, paraphrase, or rewrite migrated/legacy STM merely to improve organization or manufacture a difference. Normal upsert is only for a coherent existing topic materially extended or corrected by current eviction evidence. Unmentioned STM remains unchanged automatically. Total normal STM upserts + normal STM adds + ALL repartition replacementRecords MUST be <= ${M.CONFIG.STM_WRITE_SET_LIMIT}; prefer 1-4 thematic memory writes when possible. beliefEffects MUST be <= ${M.CONFIG.STM_BELIEF_EFFECT_LIMIT}, beliefsToAdd <= ${M.CONFIG.STM_NEW_BELIEF_LIMIT}, and activatedBeliefIds <= ${M.CONFIG.STM_ACTIVATED_BELIEF_LIMIT}. If more themes exist than fit the write budget, combine only semantically related evidence; do not create an incoherent giant diary record simply to fit the budget.`,
            "A repartition is an explicit atomic semantic replacement/reorganization. sourceStmIds must contain existing supplied STM IDs and must not overlap another repartition or a normal upsert target in the same response. replacementRecords collectively represent the source content after reorganization. A replacement record may omit id, in which case the engine allocates a new canonical memory ID at commit. At most one replacement record in a repartition may retain one of that repartition's source STM IDs as a clear continuation of that source topic. Never invent a new canonical memory ID. Protected STM is read-only and must never be used as a repartition source.",
            "The complete verbatim snapshot is supplied together with explicit evictionObservationIds and retainedObservationIds. Eviction observations will be deleted only after a validated atomic commit, so preserve their meaningful information with priority. Retained observations remain verbatim and are interpretive context.",
            "For direct belief reinforcement or contradiction, ONLY evictionObservationIds are newly consumed evidence. Retained observations, existing STM/LTM, relationships, and beliefs are context, not fresh evidence. Never count a belief as evidence for itself. beliefEffects and activatedBeliefIds MUST use exact IDs from the supplied beliefs array; never rename an ID because a display name or personal name differs from the canonical belief ID. The same valid belief may appear in both beliefEffects and activatedBeliefIds.",
            M.BELIEF_SEMANTICS,
            `Return JSON only. shortTermMemoriesToUpsert entries use existing STM IDs and contain id,topic,summary,importance,retrievalBrief. shortTermMemoriesToAdd contain topic,summary,importance,retrievalBrief. stmRepartitions entries contain sourceStmIds and replacementRecords. Each replacement record contains topic,summary,importance,retrievalBrief and MAY also contain id only when retaining one supplied source STM ID; at most one replacement per repartition may contain id. Each resulting STM summary independently obeys the ${M.CONFIG.STM_SUMMARY_MAX_CHARS}-character hard limit. Memory importance MUST be a numeric decimal in the inclusive range 0..1 (for example 0.2, 0.5, 0.8); do NOT use a 1..10 scale. beliefEffects contain beliefId,effect(supports|contradicts|ambiguous),strength 0..1. beliefsToAdd contain text,initialConfidence,initialActivation where initialActivation may be null. activatedBeliefIds contains existing IDs made salient by interpretation. Do not invent engine-owned IDs. Do not return the engine-owned protected field; existing protected state is read-only context.`,
            memoryRetrievalBriefGuidance()
        ].join(" ");
    }

    function ltmPreflightSystem() {
        return [
            "You perform a read-only Mind v3 LTM semantic preflight for exactly one character. You do not take a game turn and you do not modify any mind state.",
            "The supplied shortTermMemories are the complete current material that will be consolidated into durable memory. The supplied existingLongTermMemoryCatalog is only a compact semantic index of the historical LTM archive: id, topic, retrievalBrief, importance, and minimal structural metadata. Full historical summaries are intentionally absent at this stage.",
            "Select EVERY existing LTM whose full contents may plausibly matter for the upcoming STM→LTM consolidation: continuation of an existing durable topic, material update, duplicate avoidance, semantic overlap, comparison with prior experience, durable autobiographical context, or deciding whether current STM is already adequately represented.",
            "OPTIMIZE FOR HIGH RECALL, NOT FOR THE SMALLEST SET. Missing a genuinely relevant LTM is worse than selecting an extra possibly relevant LTM. If uncertain whether an existing LTM may materially help the consolidation, include it. There is no arbitrary numeric selection cap and no target count.",
            "Use beliefs, relationships, and character context only as read-only significance/context lenses for relevance selection. Their presence is not fresh evidence and this stage cannot activate, reinforce, contradict, add, retire, rewrite, or otherwise mutate anything.",
            "Return only IDs that appear in existingLongTermMemoryCatalog. Do not invent IDs. Do not return explanations, scores, rewritten memories, summaries, belief effects, or retirement decisions.",
            'Return exactly one JSON object with exactly this shape and no extra keys: {"relevantLtmIds":["existing_ltm_id"]}. An empty array is valid when no historical LTM may be relevant.'
        ].join(" ");
    }

    function ltmSystem() {
        return [
            "You perform auxiliary Mind v3 long-term autobiographical consolidation for exactly one character. You do not take a game turn.",
            "HISTORICAL LTM CONTEXT IS PREFLIGHT-SELECTED. existingLongTermMemories contains only historical LTM whose full contents were selected by a prior high-recall semantic preflight. Unselected historical LTM remains canonical and unchanged but is intentionally not visible here. Never invent, infer the contents of, cite as provenance, or upsert an unselected LTM ID. New LTM creation is not restricted by the selected historical set.",
            M.MODEL_OUTPUT_EFFECT_INVARIANT,
            "LTM IS SUBTRACTIVE DURABLE MEMORY. STM aims to preserve recent experience with high fidelity; LTM keeps the most significant facts that the character should still know after the source STM records are permanently gone. Deliberately discard minor, repetitive, transient, low-value sequencing or conversational filler when losing it would not materially damage the character's future understanding of their past.",
            "PRIMARY RETENTION QUESTION: if the source STM were deleted forever immediately after this successful commit, which facts would be important for this character to still remember? Preserve those durable facts. There is NO fixed compression ratio or target percentage: a highly significant STM may retain most of its semantic content, while a routine or repetitive STM may retain very little.",
            `SEMANTIC PARTITIONING: each LTM summary has the same ${M.CONFIG.LTM_SUMMARY_MAX_CHARS}-character per-record hard boundary as STM, but record capacity does not define how much meaning should survive. If source material contains multiple distinct durable themes, prefer creating multiple semantically coherent LTM records over deleting significant durable facts merely to minimize record count or fit one record. Do not optimize for the fewest LTM records. Do not mechanically split by character count, midpoint, event count, or arbitrary "part 1 / part 2" chronology unless chronology itself is the meaningful durable distinction.`,
            "EVIDENCE-DRIVEN DELTA: existing LTM is persistent context and read-only by default. The model may inspect far more LTM than it returns. Relevance does NOT imply output: an existing LTM may be highly relevant to current STM evidence and still require no upsert. Return an LTM upsert only when new evidence materially changes that specific record's model-writable topic, summary, importance, or retrievalBrief after normalization. Omit every unchanged or substantively equivalent existing LTM entirely. Never retopic, beautify, normalize, merge, paraphrase, or rewrite LTM merely for style or to manufacture a difference. Unmentioned existing LTM remains intact automatically. Prefer updating an existing matching durable topic only when the new evidence still belongs to one coherent durable memory; create a new semantically distinct LTM when that preserves retrieval precision or avoids bloating an unrelated existing record. There are NO arbitrary numeric limits on genuinely required LTM writes or STM retirements: make as many durable-memory changes as the material genuinely justifies, but no unnecessary changes.",
            "Every material LTM upsert/add MUST carry provenance: sourceStmIds and sourceLtmIds arrays naming supplied memories that justify the actual change. At least one source ID is required. Provenance is NOT itself an effect and MUST NOT be attached merely to justify echoing an otherwise unchanged LTM. For an upsert, citing only the target LTM itself is NOT sufficient provenance; include at least one STM source or a different LTM source when the update is materially justified. sourceStmIds may contain only supplied shortTermMemories IDs; sourceLtmIds may contain only supplied existingLongTermMemories IDs. Provenance is engine/debug metadata for this operation and is not persisted as character consciousness.",
            "STM retirement is selective and evidence-backed. There is no goal to empty STM. Retire an unprotected STM only by placing it in exactly one retirementGroups entry. Use disposition represented when the significant durable autobiographical content that deserves to survive is preserved by one or more LTM records that will exist after this commit; retirement does NOT require preserving every minor STM detail because LTM is intentionally subtractive. Use disposition safe_to_forget only when its unique durable value does not justify preservation. Allowed safe_to_forget reasons are routine, redundant, transient. Never use safe_to_forget for a unique promise, agreement, boundary, secret, important biography, relationship development, unresolved goal/conflict, important discovery, significant change in understanding, emotionally defining episode, or consequential causal fact likely to matter later. Protected STM can never be retired or safe_to_forget. If unsure, leave the STM unretired.",
            "Keep retirementGroups compact: group many thematically related STM IDs together. representedByLtmRefs may contain existingLongTermMemories IDs or model-local refs from longTermMemoriesToAdd, and one STM may be represented by several resulting LTM records when several durable themes survive. Every LTM add MUST include a unique temporary ref such as new_ltm_1; this ref is only for this response and is not persisted. safe_to_forget groups MUST use an empty representedByLtmRefs array and a reason code.",
            "Do not emit unchanged/no-op LTM upserts. Before placing any record in longTermMemoriesToUpsert, compare the effective model-writable result to the supplied existing LTM: if nothing materially changes after normalization, OMIT the upsert. Do not make a cosmetic wording change just to evade this rule. ID SPACES ARE DISTINCT: longTermMemoriesToUpsert may use ONLY IDs from existingLongTermMemories. To promote STM content into new durable memory, create one or more longTermMemoriesToAdd records with temporary refs; never use an STM ID as an LTM ID.",
            "FRESH-EVIDENCE CONTRACT FOR BELIEFS: existing STM, existing LTM, relationships, and existing beliefs are supplied as context. Their mere presence, retrieval, consistency, or relevance is NOT fresh belief evidence. Do NOT iterate through supplied beliefs looking for beliefs that are compatible with the supplied memories. Consistency is NOT new evidence. Do NOT emit supports/contradicts/ambiguous merely because an old or newly durable memory agrees or disagrees with an existing belief; direct event evidence has already had its opportunity to affect beliefs during earlier processing and must not be counted again simply because the same autobiographical material is being consolidated into LTM.",
            "higherOrderBeliefEffects are a sparse semantic channel for a genuinely NEW cross-memory inference created by this LTM consolidation: use one only when combining multiple supplied memories reveals a pattern or implication that is not contained in any constituent memory alone and is not merely a restatement of an existing belief. The field should usually be empty. Do not scan the belief table and do not try to account for every belief. A belief's existence or current confidence is context, never evidence for itself. beliefsToAdd follows the same rule: add a belief only for a genuinely new durable higher-order interpretation, not for rereading, relabeling, or re-counting old evidence.",
            "activatedBeliefIds is also sparse. Include only supplied belief IDs whose salience materially shaped this specific consolidation/inference. Do not list beliefs merely because you inspected them, because they were compatible with a memory, or because they appeared in context. It is valid and often preferable for activatedBeliefIds to be empty.",
            M.BELIEF_SEMANTICS,
            `LTM RECORD BOUNDS: every LTM summary MUST be ${M.CONFIG.LTM_SUMMARY_MAX_CHARS} characters or fewer. This is a per-record hard boundary, not a target length and not a compression ratio. A shorter record is appropriate when little durable meaning survives; multiple records are appropriate when multiple distinct durable themes deserve to survive.`,
            memoryRetrievalBriefGuidance(),
            'Return exactly one JSON object with keys longTermMemoriesToUpsert,longTermMemoriesToAdd,retirementGroups,higherOrderBeliefEffects,beliefsToAdd,activatedBeliefIds. LTM upserts contain exactly {"id":"existing_ltm_id","topic":"...","summary":"...","importance":0.8,"retrievalBrief":"concise semantic index description","sourceStmIds":["stm_id"],"sourceLtmIds":["existing_ltm_id"]}. LTM adds contain exactly {"ref":"new_ltm_1","topic":"...","summary":"...","importance":0.8,"retrievalBrief":"concise semantic index description","sourceStmIds":["stm_id"],"sourceLtmIds":[]}. At least one provenance source array must be non-empty. A represented retirement group contains exactly {"stmIds":["stm_id_1","stm_id_2"],"disposition":"represented","representedByLtmRefs":["existing_ltm_id","new_ltm_1"]}. A forgettable group contains exactly {"stmIds":["stm_id_3"],"disposition":"safe_to_forget","representedByLtmRefs":[],"reason":"routine"}. beliefsToAdd contain exactly text,initialConfidence,initialActivation. Memory importance MUST be a numeric decimal in the inclusive range 0..1; do NOT use a 1..10 scale.',
            "higherOrderBeliefEffects entries for existing beliefs MUST contain exactly beliefId,effect,strength, where effect is supports|contradicts|ambiguous and strength is 0..1. Never return newConfidence, newActivation, replacementConfidence, or other direct numeric replacements for an existing belief; the engine owns confidence and activation math.",
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


    setup.MindConsolidationProtocols = {
        normalizeStmBeliefReferences: normalizeStmBeliefReferences,
        normalizeLtmResponseIngress: normalizeLtmResponseIngress,
        normalizeReconciliationIngress: normalizeReconciliationIngress,
        memoryUpsertHasEffect: memoryUpsertHasEffect,
        memoryRetrievalBriefGuidance: memoryRetrievalBriefGuidance,
        validateStmResponse: validateStmResponse,
        validateLtmPreflightResponse: validateLtmPreflightResponse,
        validateLtmResponse: validateLtmResponse,
        validateReconciliationResponse: validateReconciliationResponse,
        reconciliationCandidates: reconciliationCandidates,
        stmSystem: stmSystem,
        ltmPreflightSystem: ltmPreflightSystem,
        ltmSystem: ltmSystem,
        reconciliationSystem: reconciliationSystem
    };
}());
