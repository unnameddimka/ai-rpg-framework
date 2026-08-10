(function () {
    "use strict";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function actorName(actorId) {
        const world = setup.Game.getWorld();
        const actor = world.entities[actorId];
        return actor && actor.name || actorId || "Character";
    }

    function targetName(targetId) {
        if (!targetId) return "";
        const world = setup.Game.getWorld();
        const target = world.entities[targetId];
        return target && target.name || targetId;
    }

    function locationName(locationId) {
        if (!locationId) return "";
        const world = setup.Game.getWorld();
        const location = world.entities[locationId];
        return location && location.name || locationId;
    }

    function presentationEntry(text, visibleToHuman, actorId, locationId, kind) {
        return {
            text: String(text || ""),
            visibleToHuman: Boolean(visibleToHuman),
            actorId: actorId || null,
            actorName: actorName(actorId),
            locationId: locationId || null,
            locationName: locationName(locationId),
            kind: kind || "reaction"
        };
    }

    function splitPresentation(entries) {
        const visible = [];
        const hidden = [];
        (entries || []).forEach(function (entry) {
            if (!entry || !entry.text) return;
            if (entry.visibleToHuman) visible.push(entry.text);
            else hidden.push(clone(entry));
        });
        return { visible: visible, hidden: hidden, entries: clone(entries || []) };
    }

    function eventTexts(actionResult) {
        return actionResult && Array.isArray(actionResult.events)
            ? actionResult.events.map(function (event) { return event.text; }).filter(Boolean)
            : [];
    }

    function describeSubmittedIntent(actorId, input, intentResult) {
        const entries = [];
        const actionResult = intentResult && intentResult.actionResult;
        const text = input && typeof input.text === "string" ? input.text.trim() : "";
        const speaker = actorName(actorId);
        const addressee = input && input.target_id ? targetName(input.target_id) : "";
        const narrativeEvent = intentResult && intentResult.narrativeResult && intentResult.narrativeResult.event;

        if (text) {
            entries.push(presentationEntry(
                `${speaker}${addressee ? ` to ${addressee}` : ""}: ${text}`,
                true,
                actorId,
                narrativeEvent && narrativeEvent.locationId,
                "human_narrative"
            ));
        }

        (actionResult && Array.isArray(actionResult.events) ? actionResult.events : []).forEach(function (event) {
            if (!event || !event.text) return;
            entries.push(presentationEntry(
                event.text,
                true,
                actorId,
                event.locationId || event.toLocationId || event.fromLocationId,
                "human_action_event"
            ));
        });

        if (actionResult && !actionResult.ok && actionResult.error) {
            entries.push(presentationEntry(
                `${speaker}'s formal action failed: ${actionResult.error.message}`,
                true,
                actorId,
                setup.Game.getWorld().entities[actorId] && setup.Game.getWorld().entities[actorId].locationId,
                "human_action_failure"
            ));
        }
        return splitPresentation(entries);
    }

    function humanReceivesEvent(event, humanId) {
        return Boolean(event && Array.isArray(event.recipients) && event.recipients.includes(humanId));
    }

    function actorVisibleToHuman(actorId, humanId) {
        const view = setup.CharacterAPI.getView(humanId);
        return Boolean(view && view.location && Array.isArray(view.location.characters) &&
            view.location.characters.some(function (character) { return character.id === actorId; }));
    }

    function describeAIResult(result, humanId) {
        const entries = [];
        if (!result || !result.ok) return splitPresentation(entries);

        const actorId = result.actorId;
        const intentResult = result.intentResult || {};
        const narrativeEvent = intentResult.narrativeResult && intentResult.narrativeResult.event;
        if (result.narrativeText && result.narrativeText.trim()) {
            const text = result.narrativeText.trim();
            const visibleNarrative = narrativeEvent
                ? humanReceivesEvent(narrativeEvent, humanId)
                : actorVisibleToHuman(actorId, humanId);
            const actor = setup.Game.getWorld().entities[actorId];
            entries.push(presentationEntry(
                `${actorName(actorId)}: ${text}`,
                visibleNarrative,
                actorId,
                narrativeEvent && narrativeEvent.locationId || actor && actor.locationId,
                "narrative"
            ));
        }

        const actionResult = result.actionResult;
        (actionResult && Array.isArray(actionResult.events) ? actionResult.events : []).forEach(function (event) {
            if (!event || !event.text) return;
            entries.push(presentationEntry(
                event.text,
                humanReceivesEvent(event, humanId),
                actorId,
                event.locationId || event.toLocationId || event.fromLocationId,
                "action_event"
            ));
        });

        if (actionResult && !actionResult.ok && actionResult.error) {
            const actor = setup.Game.getWorld().entities[actorId];
            entries.push(presentationEntry(
                `${actorName(actorId)}'s formal action failed: ${actionResult.error.message}`,
                actorVisibleToHuman(actorId, humanId),
                actorId,
                actor && actor.locationId,
                "action_failure"
            ));
        }
        return splitPresentation(entries);
    }

    function describeWave(waveResult, humanId) {
        const entries = [];
        (waveResult && waveResult.results || []).forEach(function (result) {
            const described = describeAIResult(result, humanId);
            entries.push.apply(entries, described.entries);
        });
        return splitPresentation(entries);
    }

    async function submitHumanIntent(input, client) {
        const actorId = setup.Game.getHumanCharacterId();
        input = input && typeof input === "object" ? input : {};
        if (input.action) {
            const actionValidation = setup.CharacterAPI.validateActionRequest(actorId, input.action);
            if (!actionValidation.ok) {
                return {
                    ok: false,
                    error: clone(actionValidation.error),
                    actorId: actorId,
                    turnConsumed: false
                };
            }
        }

        const intentResult = setup.CharacterAPI.submitIntent(actorId, input);
        if (!intentResult.ok) return intentResult;

        const submittedPresentation = describeSubmittedIntent(actorId, input, intentResult);
        const waveResult = await setup.AITurnScheduler.processAfterSubmit(client || setup.OpenRouterClient);
        const wavePresentation = describeWave(waveResult, actorId);
        const entries = submittedPresentation.entries.concat(wavePresentation.entries);
        const presentation = splitPresentation(entries);

        return {
            ok: true,
            actorId: actorId,
            turnConsumed: true,
            intentResult: clone(intentResult),
            waveResult: clone(waveResult),
            narrativeFragments: presentation.visible,
            hiddenNarrativeEntries: presentation.hidden,
            historyEntries: presentation.entries,
            destinationId: intentResult.actionResult && intentResult.actionResult.ok && input.action && input.action.type === "move"
                ? input.action.destination_id
                : null
        };
    }

    async function pass(client) {
        const actorId = setup.Game.getHumanCharacterId();
        const waveResult = await setup.AITurnScheduler.processWave(client || setup.OpenRouterClient);
        const presentation = describeWave(waveResult, actorId);
        return {
            ok: waveResult.ok,
            error: waveResult.ok ? null : clone(waveResult.error),
            actorId: actorId,
            turnConsumed: true,
            waveResult: clone(waveResult),
            narrativeFragments: presentation.visible,
            hiddenNarrativeEntries: presentation.hidden,
            historyEntries: presentation.entries
        };
    }

    setup.TurnFlow = {
        submitHumanIntent: submitHumanIntent,
        pass: pass,
        describeWave: describeWave,
        describeAIResult: describeAIResult
    };
}());
