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

    function eventTexts(actionResult) {
        return actionResult && Array.isArray(actionResult.events)
            ? actionResult.events.map(function (event) { return event.text; }).filter(Boolean)
            : [];
    }

    function describeSubmittedIntent(actorId, input, intentResult) {
        const fragments = [];
        const actionResult = intentResult && intentResult.actionResult;
        const actionTexts = eventTexts(actionResult);
        const text = input && typeof input.text === "string" ? input.text.trim() : "";
        const speaker = actorName(actorId);
        const addressee = input && input.target_id ? targetName(input.target_id) : "";

        if (text) fragments.push(`${speaker}${addressee ? ` to ${addressee}` : ""}: ${text}`);
        actionTexts.forEach(function (item) { fragments.push(item); });

        if (actionResult && !actionResult.ok && actionResult.error) {
            fragments.push(`${speaker}'s formal action failed: ${actionResult.error.message}`);
        }
        return fragments;
    }

    function humanReceivesEvent(event, humanId) {
        return Boolean(event && Array.isArray(event.recipients) && event.recipients.includes(humanId));
    }

    function actorVisibleToHuman(actorId, humanId) {
        const view = setup.CharacterAPI.getView(humanId);
        return Boolean(view && view.location && Array.isArray(view.location.characters) &&
            view.location.characters.some(function (character) { return character.id === actorId; }));
    }

    function debugEntry(text, actorId, locationId, kind) {
        return {
            text: text,
            actorId: actorId || null,
            actorName: actorName(actorId),
            locationId: locationId || null,
            locationName: locationName(locationId),
            kind: kind || "reaction"
        };
    }

    function describeAIResult(result, humanId) {
        const visible = [];
        const hidden = [];
        if (!result || !result.ok) return { visible: visible, hidden: hidden };

        const actorId = result.actorId;
        const intentResult = result.intentResult || {};
        const narrativeEvent = intentResult.narrativeResult && intentResult.narrativeResult.event;
        if (result.narrativeText && result.narrativeText.trim()) {
            const text = result.narrativeText.trim();
            const visibleNarrative = narrativeEvent
                ? humanReceivesEvent(narrativeEvent, humanId)
                : actorVisibleToHuman(actorId, humanId);
            if (visibleNarrative) visible.push(text);
            else hidden.push(debugEntry(text, actorId, narrativeEvent && narrativeEvent.locationId, "narrative"));
        }

        const actionResult = result.actionResult;
        (actionResult && Array.isArray(actionResult.events) ? actionResult.events : []).forEach(function (event) {
            if (!event || !event.text) return;
            if (humanReceivesEvent(event, humanId)) visible.push(event.text);
            else hidden.push(debugEntry(event.text, actorId, event.locationId || event.toLocationId || event.fromLocationId, "action_event"));
        });

        if (actionResult && !actionResult.ok && actionResult.error) {
            const text = `${actorName(actorId)}'s formal action failed: ${actionResult.error.message}`;
            const actor = setup.Game.getWorld().entities[actorId];
            if (actorVisibleToHuman(actorId, humanId)) visible.push(text);
            else hidden.push(debugEntry(text, actorId, actor && actor.locationId, "action_failure"));
        }
        return { visible: visible, hidden: hidden };
    }

    function describeWave(waveResult, humanId) {
        const presentation = { visible: [], hidden: [] };
        (waveResult && waveResult.results || []).forEach(function (result) {
            const described = describeAIResult(result, humanId);
            presentation.visible.push.apply(presentation.visible, described.visible);
            presentation.hidden.push.apply(presentation.hidden, described.hidden);
        });
        return presentation;
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

        const fragments = describeSubmittedIntent(actorId, input, intentResult);
        const waveResult = await setup.AITurnScheduler.processAfterSubmit(client || setup.OpenRouterClient);
        const wavePresentation = describeWave(waveResult, actorId);
        fragments.push.apply(fragments, wavePresentation.visible);

        return {
            ok: true,
            actorId: actorId,
            turnConsumed: true,
            intentResult: clone(intentResult),
            waveResult: clone(waveResult),
            narrativeFragments: fragments,
            hiddenNarrativeEntries: clone(wavePresentation.hidden),
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
            hiddenNarrativeEntries: clone(presentation.hidden)
        };
    }

    setup.TurnFlow = {
        submitHumanIntent: submitHumanIntent,
        pass: pass,
        describeWave: describeWave,
        describeAIResult: describeAIResult
    };
}());
