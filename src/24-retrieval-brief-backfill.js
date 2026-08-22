(function () {
    "use strict";

    const jobs = new Map();
    let diagnostics = [];
    const MAX_DIAGNOSTICS = 100;

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }

    function emptyRecords(actor) {
        const result = [];
        ["shortTermMemories", "longTermMemories"].forEach(function (partition) {
            (actor && actor.mind && actor.mind[partition] || []).forEach(function (memory) {
                if (typeof memory.retrievalBrief === "string" && memory.retrievalBrief.length > 0) return;
                result.push({ id: memory.id, partition: partition, topic: String(memory.topic || ""), summary: String(memory.summary || "") });
            });
        });
        return result;
    }

    function validate(value, snapshot) {
        const errors = [];
        if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.briefs)) return { ok: false, errors: ["response must contain exactly briefs array"] };
        const expected = new Map(snapshot.map(function (record) { return [record.id, record]; }));
        const seen = new Set();
        value.briefs.forEach(function (entry) {
            if (!isObject(entry) || Object.keys(entry).sort().join(",") !== "id,retrievalBrief" || typeof entry.id !== "string" || !expected.has(entry.id) || seen.has(entry.id) || !setup.MindValidators.retrievalBriefValid(entry.retrievalBrief, { requireNonEmpty: true })) {
                errors.push("invalid retrieval brief entry");
                return;
            }
            seen.add(entry.id);
        });
        if (seen.size !== expected.size) errors.push("brief response must cover every supplied empty-brief memory exactly once");
        return errors.length ? { ok: false, errors: errors } : { ok: true, value: { briefs: value.briefs.map(function (entry) { return { id: entry.id, retrievalBrief: entry.retrievalBrief.trim() }; }) } };
    }

    function stillMatches(actor, snapshotRecord) {
        const records = actor && actor.mind && actor.mind[snapshotRecord.partition] || [];
        const current = records.find(function (record) { return record.id === snapshotRecord.id; });
        return Boolean(current && String(current.topic || "") === snapshotRecord.topic && String(current.summary || "") === snapshotRecord.summary && (!current.retrievalBrief || current.retrievalBrief === ""));
    }

    async function run(characterId, client) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character") return { ok: false, error: { code: "ACTOR_NOT_FOUND", message: "Character does not exist." } };
        const snapshot = emptyRecords(actor);
        if (!snapshot.length) return { ok: true, actorId: characterId, nothingToBackfill: true, count: 0 };
        const payload = { stage: "mind-retrieval-brief-backfill", memories: clone(snapshot), requiredResponseShape: { briefs: snapshot.map(function (record) { return { id: record.id, retrievalBrief: "" }; }) } };
        const messages = [
            { role: "system", content: ["You create concise semantic retrieval index descriptions for existing fictional autobiographical memories. Do not rewrite, reinterpret, merge, delete, or add memories.", setup.MindConsolidationProtocols.memoryRetrievalBriefGuidance(), "For every supplied memory return exactly its id and one short retrievalBrief. Return JSON only with exactly one key: briefs."].join(" ") },
            { role: "user", content: JSON.stringify(payload) }
        ];
        const startedAt = Date.now();
        const result = await setup.AIRequestExecutor.executeCustomConcurrent({
            actorId: characterId,
            purpose: "mind-retrieval-brief-backfill",
            stage: "mind-retrieval-brief-backfill",
            messages: messages,
            requestOptions: setup.AIRequestProfiles.resolve("mind-retrieval-brief-backfill", { actorId: characterId }),
            client: client || setup.OpenRouterClient,
            run: function (policyClient) {
                return setup.StructuredAIRequest.run(policyClient, {
                    stage: "mind-retrieval-brief-backfill",
                    messages: messages,
                    requestOptions: setup.AIRequestProfiles.resolve("mind-retrieval-brief-backfill", { actorId: characterId }),
                    validate: function (value) { return validate(value, snapshot); },
                    maxRepairAttempts: 1,
                    validationErrorCode: "RETRIEVAL_BRIEF_BACKFILL_INVALID",
                    validationErrorMessage: "Retrieval brief backfill returned invalid data."
                });
            }
        });
        let committed = 0;
        if (result && result.ok) {
            const current = setup.Game.getWorld();
            const currentActor = current.entities[characterId];
            const candidate = clone(current);
            const candidateActor = candidate.entities[characterId];
            const snapshotById = new Map(snapshot.map(function (record) { return [record.id, record]; }));
            result.value.briefs.forEach(function (entry) {
                const snap = snapshotById.get(entry.id);
                if (!snap || !stillMatches(currentActor, snap)) return;
                const record = (candidateActor.mind[snap.partition] || []).find(function (memory) { return memory.id === entry.id; });
                if (!record || (record.retrievalBrief && record.retrievalBrief !== "")) return;
                record.retrievalBrief = entry.retrievalBrief;
                committed += 1;
            });
            if (committed > 0) {
                const worldValidation = setup.GameInternals.validateWorld(candidate);
                if (!worldValidation.ok) {
                    committed = 0;
                    result.ok = false;
                    result.error = { code: "RETRIEVAL_BRIEF_CANDIDATE_INVALID", message: worldValidation.error.message };
                } else {
                    State.variables.world = candidate;
                }
            }
        }
        diagnostics.push({ at: new Date().toISOString(), actorId: characterId, requestedCount: snapshot.length, committedCount: committed, durationMs: Math.max(0, Date.now() - startedAt), ok: Boolean(result && result.ok), error: result && !result.ok ? clone(result.error) : null, usage: result && result.usage ? clone(result.usage) : null });
        diagnostics = diagnostics.slice(-MAX_DIAGNOSTICS);
        return result && result.ok ? { ok: true, actorId: characterId, requestedCount: snapshot.length, committedCount: committed, usage: clone(result.usage || null) } : { ok: false, actorId: characterId, error: clone(result && result.error || { code: "RETRIEVAL_BRIEF_BACKFILL_FAILED", message: "Retrieval brief backfill failed." }) };
    }

    function schedule(characterId, client) {
        const world = setup.Game.getWorld();
        const actor = world.entities[characterId];
        if (!actor || actor.type !== "character") return { ok: false, scheduled: false, reason: "actor-not-found" };
        if (!emptyRecords(actor).length) return { ok: true, scheduled: false, reason: "nothing-to-backfill" };
        if (jobs.has(characterId)) return { ok: true, scheduled: false, reason: "already-active" };
        const promise = run(characterId, client).catch(function (error) {
            return { ok: false, actorId: characterId, error: { code: "RETRIEVAL_BRIEF_BACKFILL_EXCEPTION", message: error && error.message || "Retrieval brief backfill failed." } };
        }).finally(function () { jobs.delete(characterId); });
        jobs.set(characterId, promise);
        return { ok: true, scheduled: true };
    }

    setup.RetrievalBriefBackfill = {
        schedule: schedule,
        runNow: run,
        getStatus: function () { return { activeCharacterIds: Array.from(jobs.keys()), diagnostics: clone(diagnostics) }; }
    };
}());
