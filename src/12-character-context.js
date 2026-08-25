(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function fail(code, message) {
        return { ok: false, error: { code: code, message: message } };
    }

    function privateCharacter(actor, world) {
        const abilityInstructions = {};
        (actor.abilityIds || []).forEach(function (abilityId) {
            const ability = world.abilities[abilityId];
            if (ability && typeof ability.aiDescription === "string" && ability.aiDescription.trim()) {
                abilityInstructions[abilityId] = ability.aiDescription.trim();
            }
        });
        const context = { aiDescription: typeof actor.aiDescription === "string" ? actor.aiDescription : "" };
        if (Object.keys(abilityInstructions).length > 0) context.abilityInstructions = abilityInstructions;
        if (setup.WeeklyRhythm) {
            const schedule = setup.WeeklyRhythm.scheduleSummary(actor, world);
            if (schedule) context.weeklySchedule = schedule;
            const awayable = typeof setup.WeeklyRhythm.awayableKnowledge === "function" ? setup.WeeklyRhythm.awayableKnowledge(actor, world) : null;
            if (awayable) context.awayableLifecycle = awayable;
            const trade = setup.WeeklyRhythm.tradeKnowledge(actor, world);
            if (trade) context.tradeKnowledge = trade;
        }
        return context;
    }

    function normalizeSearchText(value) {
        return String(value || "").toLowerCase();
    }

    function contextTerms(actor, world, preparedObservations, suppliedView) {
        const terms = new Set([String(actor.id || "").toLowerCase(), String(actor.name || "").toLowerCase()]);
        const view = suppliedView && suppliedView.location ? suppliedView : setup.CharacterAPI.getView(actor.id);
        const locationCharacters = view && view.location && view.location.characters || [];
        locationCharacters.forEach(function (entry) {
            if (entry && entry.id) terms.add(String(entry.id).toLowerCase());
            if (entry && entry.name) terms.add(String(entry.name).toLowerCase());
        });
        (preparedObservations || []).forEach(function (entry) {
            const text = normalizeSearchText(entry && (entry.text || JSON.stringify(entry)));
            Object.values(world.entities || {}).forEach(function (entity) {
                if (!entity || entity.type !== "character") return;
                const name = normalizeSearchText(entity.name);
                if ((name && text.includes(name)) || text.includes(normalizeSearchText(entity.id))) {
                    terms.add(normalizeSearchText(entity.id));
                    if (name) terms.add(name);
                }
            });
        });
        return Array.from(terms).filter(Boolean);
    }

    function mentionsAny(record, terms) {
        const text = normalizeSearchText(`${record && record.topic || ""} ${record && record.summary || ""} ${record && record.text || ""}`);
        return terms.some(function (term) { return term.length > 2 && text.includes(term); });
    }

    function selectBeliefs(beliefs, terms, limit) {
        return beliefs.map(function (belief, index) {
            const direct = mentionsAny(belief, terms) ? 4 : 0;
            return { belief: belief, index: index, score: direct + (Number(belief.activation) || 0) * 2 + (Number(belief.confidence) || 0) * 0.4 };
        }).sort(function (a, b) { return b.score - a.score || b.index - a.index; }).slice(0, limit).map(function (entry) { return entry.belief; });
    }

    function selectMemories(memories, terms, limit) {
        return memories.map(function (memory, index) {
            return { memory: memory, index: index, score: (mentionsAny(memory, terms) ? 3 : 0) + (Number(memory.importance) || 0) + index / Math.max(1, memories.length) * 0.3 };
        }).sort(function (a, b) { return b.score - a.score || b.index - a.index; }).slice(0, limit).map(function (entry) { return entry.memory; });
    }

    function byIds(records, ids, limit) {
        const source = Array.isArray(records) ? records : [];
        const requested = Array.isArray(ids) ? ids : [];
        const byId = new Map(source.map(function (record) { return [record.id, record]; }));
        const result = [];
        requested.slice(0, Math.max(0, limit || requested.length)).forEach(function (id) {
            const record = byId.get(id);
            if (record) result.push(record);
        });
        return result;
    }

    function deterministicSelection(actor, world, preparedObservations, suppliedView) {
        const mind = actor.mind || {};
        const terms = contextTerms(actor, world, preparedObservations, suppliedView);
        const cfg = setup.MindV3.CONFIG;
        return {
            beliefIds: selectBeliefs(mind.beliefs || [], terms, cfg.NORMAL_CONTEXT_BELIEF_LIMIT).map(function (record) { return record.id; }),
            stmIds: selectMemories(mind.shortTermMemories || [], terms, cfg.NORMAL_CONTEXT_STM_LIMIT).map(function (record) { return record.id; }),
            ltmIds: selectMemories(mind.longTermMemories || [], terms, cfg.NORMAL_CONTEXT_LTM_LIMIT).map(function (record) { return record.id; })
        };
    }

    function mindContext(actor, world, preparedObservations, options) {
        const mind = actor.mind || {};
        const opts = options || {};
        if (opts.full === true) {
            return {
                knownFacts: clone(mind.knownFacts || []),
                beliefs: clone(mind.beliefs || []),
                relationships: clone(mind.relationships || []),
                verbatimObservations: clone(mind.verbatimObservations || []),
                shortTermMemories: clone(mind.shortTermMemories || []),
                longTermMemories: clone(mind.longTermMemories || [])
            };
        }
        const cfg = setup.MindV3.CONFIG;
        const selection = opts.selection && typeof opts.selection === "object"
            ? opts.selection
            : deterministicSelection(actor, world, preparedObservations, opts.view);
        return {
            knownFacts: clone(mind.knownFacts || []),
            beliefs: clone(byIds(mind.beliefs || [], selection.beliefIds || [], cfg.NORMAL_CONTEXT_BELIEF_LIMIT)),
            relationships: clone(mind.relationships || []),
            verbatimObservations: clone((mind.verbatimObservations || []).slice(-cfg.NORMAL_CONTEXT_VERBATIM_LIMIT)),
            shortTermMemories: clone(byIds(mind.shortTermMemories || [], selection.stmIds || [], cfg.NORMAL_CONTEXT_STM_LIMIT)),
            longTermMemories: clone(byIds(mind.longTermMemories || [], selection.ltmIds || [], cfg.NORMAL_CONTEXT_LTM_LIMIT))
        };
    }



    function recentDialogueContext(actor, world) {
        const records = setup.MindValidators.sanitizeRecentDialogue(actor.recentDialogue, world);
        return records.map(function (record) {
            const speaker = world.entities[record.speakerId];
            return {
                speakerId: record.speakerId,
                speakerName: speaker && speaker.type === "character" ? speaker.name : record.speakerId || "Unknown speaker",
                text: record.text
            };
        });
    }

    function build(actorId, options) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        options = options && typeof options === "object" ? options : {};
        const preparedObservations = Array.isArray(options.pendingObservations) ? clone(options.pendingObservations) : [];
        const view = setup.CharacterAPI.getView(actorId);
        return clone({
            schemaVersion: 1,
            view: view,
            relevantMechanics: setup.CharacterAPI.getRelevantMechanics(actorId),
            character: privateCharacter(actor, world),
            mind: mindContext(actor, world, preparedObservations, { view: view, selection: options.mindSelection || null }),
            continuation: setup.AIWorkingState.getContinuation(actorId),
            recentDialogue: recentDialogueContext(actor, world),
            pendingObservations: preparedObservations
        });
    }

    function compactItem(item) {
        if (!item || typeof item !== "object") return null;
        return { id: item.id || null, name: item.name || item.id || "Unknown item" };
    }

    function buildRetrievalRuntime(actorId, options) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        options = options && typeof options === "object" ? options : {};
        const pending = Array.isArray(options.pendingObservations) ? clone(options.pendingObservations) : [];
        const view = setup.CharacterAPI.getView(actorId);
        return clone({
            actor: { id: actor.id, name: actor.name },
            location: view && view.location ? { id: view.location.id, name: view.location.name, sublocationId: actor.sublocationId || null, positionText: view.self && view.self.position_text || "" } : null,
            presentCharacters: (view && view.location && view.location.characters || []).map(function (entry) { return { id: entry.id, name: entry.name }; }),
            notableItems: (view && view.location && view.location.items || []).map(compactItem).filter(Boolean).concat((view && view.accessible_inventories || []).flatMap(function (inventory) { return (inventory.items || []).map(compactItem).filter(Boolean); })).slice(0, 40),
            pendingObservations: pending,
            recentDialogue: recentDialogueContext(actor, world),
            recentVerbatimObservations: clone((actor.mind && actor.mind.verbatimObservations || []).slice(-setup.MindV3.CONFIG.NORMAL_CONTEXT_VERBATIM_LIMIT)),
            continuation: setup.AIWorkingState.getContinuation(actorId)
        });
    }

    function buildMaintenance(actorId, options) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        options = options && typeof options === "object" ? options : {};
        const I = setup.GameInternals;
        const location = I.getLocation(actor.locationId, world);
        const selfInventory = I.inventoryItems(actor.inventoryId, world);
        const fullView = setup.CharacterAPI.getView(actorId);
        return clone({
            schemaVersion: 1,
            view: {
                world_conditions: fullView.world_conditions,
                self: {
                    id: actor.id,
                    name: actor.name,
                    playerDescription: actor.playerDescription || "",
                    location_id: actor.locationId,
                    sublocation_id: actor.sublocationId,
                    sleeping: actor.sleeping === true,
                    position_text: I.positionText(actor, world),
                    inventory: selfInventory.map(function (item) {
                        return {
                            id: item.id,
                            name: item.name,
                            definition_id: item.definition_id,
                            family_id: item.family_id,
                            description: item.description || "",
                            tags: clone(item.tags || [])
                        };
                    })
                },
                location: {
                    id: location.id,
                    name: location.name,
                    characters: clone(fullView.location && fullView.location.characters || [])
                }
            },
            character: privateCharacter(actor, world),
            mind: mindContext(actor, world, options.pendingObservations || [], { full: true }),
            recentDialogue: recentDialogueContext(actor, world),
            pendingObservations: Array.isArray(options.pendingObservations)
                ? setup.EventPerception.projectObservationsForModel(actorId, options.pendingObservations, world)
                : []
        });
    }

    setup.CharacterContext = {
        buildPrivateCharacter: function (actorId) {
            const world = setup.Game.getWorld();
            const actor = world.entities[actorId];
            return actor && actor.type === "character" ? clone(privateCharacter(actor, world)) : fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        },
        buildMind: function (actorId) {
            const actor = setup.Game.getWorld().entities[actorId];
            return actor && actor.type === "character" ? clone(mindContext(actor, setup.Game.getWorld(), [], { full: true })) : fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        },
        buildMaintenance: buildMaintenance,
        buildRetrievalRuntime: buildRetrievalRuntime,
        selectMindDeterministically: function (actorId, pendingObservations) {
            const world = setup.Game.getWorld();
            const actor = world.entities[actorId];
            if (!actor || actor.type !== "character") return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
            const view = setup.CharacterAPI.getView(actorId);
            return clone(deterministicSelection(actor, world, pendingObservations || [], view));
        }
    };
    setup.ContextBuilder = { build: build };
}());
