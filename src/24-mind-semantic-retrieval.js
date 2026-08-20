(function () {
    "use strict";

    const MAX_DIAGNOSTICS = 100;
    let diagnostics = [];

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }

    function memoryCatalog(records) {
        return (records || []).map(function (memory) {
            return {
                id: memory.id,
                topic: String(memory.topic || ""),
                retrievalBrief: typeof memory.retrievalBrief === "string" ? memory.retrievalBrief : ""
            };
        });
    }

    function beliefCatalog(records) {
        return (records || []).map(function (belief) {
            return {
                id: belief.id,
                text: String(belief.text || ""),
                confidence: belief.confidence,
                activation: belief.activation
            };
        });
    }

    function buildCatalog(actor) {
        const mind = actor && actor.mind || {};
        return {
            beliefs: beliefCatalog(mind.beliefs || []),
            shortTermMemories: memoryCatalog(mind.shortTermMemories || []),
            longTermMemories: memoryCatalog(mind.longTermMemories || [])
        };
    }

    function sanitizeSelection(value, catalog, limits) {
        if (!isObject(value)) return { ok: false, errors: ["response must be one JSON object"], diagnostics: null };
        const fields = [
            { key: "beliefIds", catalogKey: "beliefs", limit: limits.beliefs },
            { key: "stmIds", catalogKey: "shortTermMemories", limit: limits.stm },
            { key: "ltmIds", catalogKey: "longTermMemories", limit: limits.ltm }
        ];
        const errors = [];
        fields.forEach(function (field) { if (!Array.isArray(value[field.key])) errors.push(`${field.key} must be an array`); });
        if (errors.length) return { ok: false, errors: errors, diagnostics: null };

        const idsByCatalog = {
            beliefs: new Set(catalog.beliefs.map(function (entry) { return entry.id; })),
            shortTermMemories: new Set(catalog.shortTermMemories.map(function (entry) { return entry.id; })),
            longTermMemories: new Set(catalog.longTermMemories.map(function (entry) { return entry.id; }))
        };
        const allKnownIds = new Set();
        Object.keys(idsByCatalog).forEach(function (key) { idsByCatalog[key].forEach(function (id) { allKnownIds.add(id); }); });
        const diagnostics = {
            rawSelectedCounts: { beliefs: value.beliefIds.length, stm: value.stmIds.length, ltm: value.ltmIds.length },
            finalSelectedCounts: { beliefs: 0, stm: 0, ltm: 0 },
            droppedUnknownIds: [],
            droppedWrongTypeIds: [],
            droppedDuplicateIds: [],
            droppedInvalidValues: [],
            trimmedCounts: { beliefs: 0, stm: 0, ltm: 0 }
        };
        const normalized = { beliefIds: [], stmIds: [], ltmIds: [] };
        const countKeyByField = { beliefIds: "beliefs", stmIds: "stm", ltmIds: "ltm" };

        fields.forEach(function (field) {
            const seen = new Set();
            const valid = [];
            value[field.key].forEach(function (rawId) {
                if (typeof rawId !== "string" || !rawId) {
                    diagnostics.droppedInvalidValues.push({ category: field.key, value: clone(rawId) });
                    return;
                }
                if (seen.has(rawId)) {
                    diagnostics.droppedDuplicateIds.push({ category: field.key, id: rawId });
                    return;
                }
                seen.add(rawId);
                if (!idsByCatalog[field.catalogKey].has(rawId)) {
                    if (allKnownIds.has(rawId)) diagnostics.droppedWrongTypeIds.push({ category: field.key, id: rawId });
                    else diagnostics.droppedUnknownIds.push({ category: field.key, id: rawId });
                    return;
                }
                valid.push(rawId);
            });
            const countKey = countKeyByField[field.key];
            if (valid.length > field.limit) diagnostics.trimmedCounts[countKey] = valid.length - field.limit;
            normalized[field.key] = valid.slice(0, field.limit);
            diagnostics.finalSelectedCounts[countKey] = normalized[field.key].length;
        });

        return { ok: true, value: normalized, diagnostics: diagnostics };
    }

    function recordDiagnostic(entry) {
        diagnostics.push(clone(entry));
        diagnostics = diagnostics.slice(-MAX_DIAGNOSTICS);
    }

    function selectorSystem(limits) {
        return [
            "You are a semantic memory-retrieval preflight selector for one fictional character decision.",
            "You do not decide what the character does, do not roleplay, do not update memory, and do not infer new facts.",
            "Select only existing mind record IDs that may materially help the character interpret the current runtime situation or decide what to do next.",
            "Use semantic relevance, not lexical matching. A memory can be relevant even when the current wording uses different words.",
            "confidence, activation, and importance-like cues are secondary signals only; semantic relevance to the current situation is primary.",
            `Return ONLY IDs that appear in the supplied catalog. Maximum selections: beliefs ${limits.beliefs}, STM ${limits.stm}, LTM ${limits.ltm}. These are maximums, not targets.`,
            "Select the smallest sufficient set. Do not fill unused capacity merely because more records exist. Do not invent IDs.",
            "Return fewer than the maximum when additional records are clearly irrelevant. Empty retrievalBrief is normal; use topic alone when needed.",
            "Return one JSON object only with exactly: beliefIds, stmIds, ltmIds. No reasoning, scores, prose, or markdown."
        ].join(" ");
    }

    async function select(characterId, pendingObservations, client) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character") return { ok: false, fallbackRequired: true, error: { code: "ACTOR_NOT_FOUND", message: "Character does not exist." } };
        const fallback = setup.CharacterContext.selectMindDeterministically(characterId, pendingObservations || []);
        if (fallback && fallback.ok === false) return fallback;
        const catalog = buildCatalog(actor);
        const runtime = setup.CharacterContext.buildRetrievalRuntime(characterId, { pendingObservations: pendingObservations || [] });
        if (runtime && runtime.ok === false) return Object.assign({}, runtime, { fallbackRequired: true, selection: clone(fallback) });
        const cfg = setup.MindV3.CONFIG;
        const limits = { beliefs: cfg.NORMAL_CONTEXT_BELIEF_LIMIT, stm: cfg.NORMAL_CONTEXT_STM_LIMIT, ltm: cfg.NORMAL_CONTEXT_LTM_LIMIT };
        const payload = {
            stage: "mind-retrieval-preflight",
            runtime: runtime,
            limits: limits,
            catalog: catalog,
            requiredResponseShape: { beliefIds: [], stmIds: [], ltmIds: [] }
        };
        const messages = [
            { role: "system", content: selectorSystem(limits) },
            { role: "user", content: JSON.stringify(payload) }
        ];
        const startedAt = Date.now();
        let sanitation = null;
        const result = await setup.AIRequestExecutor.executeCustom({
            actorId: characterId,
            purpose: "mind-retrieval-preflight",
            stage: "mind-retrieval-preflight",
            messages: messages,
            requestOptions: setup.AIRequestProfiles.resolve("mind-retrieval-preflight", { actorId: characterId }),
            client: client || setup.OpenRouterClient,
            run: function (policyClient) {
                return setup.StructuredAIRequest.run(policyClient, {
                    stage: "mind-retrieval-preflight",
                    messages: messages,
                    requestOptions: setup.AIRequestProfiles.resolve("mind-retrieval-preflight", { actorId: characterId }),
                    validate: function (value) {
                        const sanitized = sanitizeSelection(value, catalog, limits);
                        sanitation = sanitized.diagnostics ? clone(sanitized.diagnostics) : null;
                        return sanitized.ok ? { ok: true, value: sanitized.value } : { ok: false, errors: sanitized.errors };
                    },
                    maxRepairAttempts: 0,
                    retryOnTruncation: false,
                    validationErrorCode: "MIND_RETRIEVAL_INVALID",
                    validationErrorMessage: "The semantic retrieval selector returned invalid IDs.",
                    parseErrorCode: "MIND_RETRIEVAL_INVALID",
                    parseErrorMessage: "The semantic retrieval selector returned malformed JSON."
                });
            }
        });
        const fallbackUsed = !result || !result.ok;
        const selection = fallbackUsed ? clone(fallback) : clone(result.value);
        recordDiagnostic({
            at: new Date().toISOString(),
            actorId: characterId,
            candidateCounts: { beliefs: catalog.beliefs.length, stm: catalog.shortTermMemories.length, ltm: catalog.longTermMemories.length },
            limits: clone(limits),
            selected: clone(selection),
            rawSelectedCounts: sanitation ? clone(sanitation.rawSelectedCounts) : null,
            finalSelectedCounts: sanitation ? clone(sanitation.finalSelectedCounts) : null,
            droppedUnknownIds: sanitation ? clone(sanitation.droppedUnknownIds) : [],
            droppedWrongTypeIds: sanitation ? clone(sanitation.droppedWrongTypeIds) : [],
            droppedDuplicateIds: sanitation ? clone(sanitation.droppedDuplicateIds) : [],
            droppedInvalidValues: sanitation ? clone(sanitation.droppedInvalidValues) : [],
            trimmedCounts: sanitation ? clone(sanitation.trimmedCounts) : null,
            semanticResultUsed: !fallbackUsed,
            durationMs: Math.max(0, Date.now() - startedAt),
            usage: result && result.usage ? clone(result.usage) : null,
            modelId: result && result.modelId || null,
            fallbackUsed: fallbackUsed,
            fallbackReason: fallbackUsed ? clone(result && result.error || { code: "MIND_RETRIEVAL_FAILED", message: "Semantic retrieval failed." }) : null
        });
        return {
            ok: true,
            actorId: characterId,
            selection: selection,
            semantic: !fallbackUsed,
            fallbackUsed: fallbackUsed,
            selectorResult: result && result.ok ? { modelId: result.modelId || null, usage: clone(result.usage || null) } : null,
            selectorError: fallbackUsed ? clone(result && result.error || null) : null
        };
    }

    setup.MindSemanticRetrieval = {
        select: select,
        buildCatalog: function (characterId) {
            const actor = setup.Game.getWorld().entities[characterId];
            return actor && actor.type === "character" ? clone(buildCatalog(actor)) : null;
        },
        sanitizeSelection: function (value, catalog, limits) { return clone(sanitizeSelection(value, catalog, limits)); },
        getDiagnostics: function () { return clone(diagnostics); },
        clearDiagnostics: function () { diagnostics = []; return { ok: true }; }
    };
}());
