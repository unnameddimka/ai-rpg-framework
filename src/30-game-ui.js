(function () {
    "use strict";

    let aiSettingsInitialized = false;

    function optionMarkup(items, emptyLabel) {
        if (!items || items.length === 0) {
            return `<option value="">${escapeHtml(emptyLabel)}</option>`;
        }

        return items.map(function (item) {
            return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`;
        }).join("");
    }

    function itemActionOptionMarkup(items, emptyLabel) {
        if (!items || items.length === 0) {
            return `<option value="">${escapeHtml(emptyLabel)}</option>`;
        }
        return items.map(function (item) {
            const label = item.action_label || item.name || item.id;
            return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
        }).join("");
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getUIState() {
        if (!State.variables.frameworkUI) {
            State.variables.frameworkUI = {
                interactionTargetId: "",
                narrativeNoticeability: "noticeable",
                selectedAction: null,
                locationStatus: "",
                turnNarrative: [],
                turnBusy: false,
                abilityResultsByActor: {}
            };
        }
        if (!State.variables.frameworkUI.abilityResultsByActor) {
            State.variables.frameworkUI.abilityResultsByActor = {};
        }
        if (!Array.isArray(State.variables.frameworkUI.turnNarrative)) {
            State.variables.frameworkUI.turnNarrative = [];
        }
        if (!State.variables.frameworkUI.selectedAction || typeof State.variables.frameworkUI.selectedAction !== "object") {
            State.variables.frameworkUI.selectedAction = null;
        }
        State.variables.frameworkUI.interactionTargetId = String(State.variables.frameworkUI.interactionTargetId || "");
        State.variables.frameworkUI.narrativeNoticeability = State.variables.frameworkUI.narrativeNoticeability === "hidden"
            ? "hidden"
            : "noticeable";
        State.variables.frameworkUI.turnBusy = Boolean(State.variables.frameworkUI.turnBusy);
        return State.variables.frameworkUI;
    }

    function cloneUIValue(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function getBusyState() {
        const uiState = getUIState();
        const controllerBusy = Boolean(setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight());
        const executorStatus = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus
            ? setup.AIRequestExecutor.getStatus()
            : { busy: false };
        const executorBusy = Boolean(executorStatus && executorStatus.busy);
        const waveBusy = Boolean(setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight());
        const aiBusy = controllerBusy || executorBusy || waveBusy;
        const busy = uiState.turnBusy || aiBusy;
        let text = "";
        if (busy) {
            if (aiBusy) {
                const queue = setup.AITurnScheduler && setup.AITurnScheduler.getQueueView
                    ? setup.AITurnScheduler.getQueueView()
                    : null;
                text = queue && queue.head && queue.head.recipientName
                    ? `${queue.head.recipientName} is thinking…`
                    : "AI is thinking…";
            } else {
                text = "Processing turn…";
            }
        }
        return { busy: busy, aiBusy: aiBusy, text: text };
    }

    function actionKey(action) {
        return action ? JSON.stringify(action) : "";
    }

    function findViewItem(view, itemId) {
        const owned = view && view.self && Array.isArray(view.self.inventory) ? view.self.inventory : [];
        const accessible = view && Array.isArray(view.accessible_inventories)
            ? view.accessible_inventories.flatMap(function (inventory) { return inventory.items || []; })
            : [];
        return owned.concat(accessible).find(function (item) { return item.id === itemId; }) || null;
    }

    function actionLabel(action, view) {
        if (!action || !action.type) return "None";
        const item = action.item_id ? findViewItem(view, action.item_id) : null;
        const target = action.target_id && view.location.characters.find(function (candidate) { return candidate.id === action.target_id; });
        const destination = action.destination_id && view.location.exits.find(function (candidate) { return candidate.id === action.destination_id; });
        const position = action.destination_id && view.location.sublocations.find(function (candidate) { return candidate.id === action.destination_id; });
        const inventory = action.target_inventory_id && view.accessible_inventories.find(function (candidate) { return candidate.id === action.target_inventory_id; });
        if (action.type === "move") return `Go to ${destination ? destination.name : action.destination_id}`;
        if (action.type === "move_within_location") return position ? (position.enter_label || `Move to ${position.name}`) : `Move to ${action.destination_id}`;
        if (action.type === "take_item") return `Take ${item ? item.name : action.item_id}`;
        if (action.type === "drop_item") return `Drop ${item ? item.name : action.item_id}`;
        if (action.type === "give_item") return `Give ${item ? item.name : action.item_id} to ${target ? target.name : action.target_id}`;
        if (action.type === "give_money") return `Give ${action.amount} gold to ${target ? target.name : action.target_id}`;
        if (action.type === "place_item") return `Place ${item ? item.name : action.item_id} on ${inventory ? inventory.name : action.target_inventory_id}`;
        if (action.type === "fill" || action.type === "consume") {
            const options = view.available_actions[action.type] && view.available_actions[action.type].options && view.available_actions[action.type].options.items || [];
            const option = options.find(function (candidate) { return candidate.id === action.item_id; });
            return option && option.action_label || `${action.type === "fill" ? "Fill" : "Consume"} ${item ? item.name : action.item_id}`;
        }
        const ability = view.self.abilities.find(function (candidate) { return candidate.actionType === action.type; });
        const record = view.available_actions[action.type];
        return ability && ability.name || record && record.description || action.type;
    }

    function actionAvailableInView(action, view) {
        if (!action || !action.type || !view.available_actions[action.type]) return false;
        const options = view.available_actions[action.type].options || {};
        if (action.type === "move") return (options.destination_ids || []).includes(action.destination_id);
        if (action.type === "move_within_location") return (options.destination_ids || []).includes(action.destination_id);
        if (action.type === "take_item") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "drop_item") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "give_item") return (options.item_ids || []).includes(action.item_id) && (options.target_ids || []).includes(action.target_id);
        if (action.type === "give_money") return (options.target_ids || []).includes(action.target_id) && Number.isFinite(Number(action.amount)) && Number(action.amount) > 0 && Number(action.amount) <= Number(options.maximum_amount || 0);
        if (action.type === "place_item") return (options.item_ids || []).includes(action.item_id) && (options.target_inventory_ids || []).includes(action.target_inventory_id);
        if (action.type === "fill" || action.type === "consume") return (options.item_ids || []).includes(action.item_id);
        return isZeroInputAbilityAction(view.available_actions[action.type]);
    }

    function selectedActionForView(view) {
        const uiState = getUIState();
        if (!actionAvailableInView(uiState.selectedAction, view)) {
            uiState.selectedAction = null;
        }
        return uiState.selectedAction;
    }

    function setSelectedAction(action, view) {
        getUIState().selectedAction = action ? cloneUIValue(action) : null;
        syncActionSelectionUI(view);
    }

    function toggleSelectedAction(action, view) {
        const current = selectedActionForView(view);
        setSelectedAction(current && actionKey(current) === actionKey(action) ? null : action, view);
    }

    function setInteractionTarget(targetId, view) {
        const uiState = getUIState();
        const target = view.location.characters.find(function (candidate) { return candidate.id === targetId; });
        uiState.interactionTargetId = target ? target.id : "";
        const select = document.getElementById("action-narrative-target");
        if (select) select.value = uiState.interactionTargetId;
        document.querySelectorAll(".framework-character-shortcut").forEach(function (button) {
            button.classList.toggle("is-selected", button.dataset.characterId === uiState.interactionTargetId);
        });
        const textarea = document.getElementById("action-narrative-text");
        if (textarea && !textarea.disabled) textarea.focus();
    }

    function setControlValue(id, value) {
        const control = document.getElementById(id);
        if (control && value !== undefined && value !== null) control.value = String(value);
    }

    function reconcileConversationState(view, state) {
        const uiState = state || getUIState();
        const visibleTargets = view && view.location && Array.isArray(view.location.characters)
            ? view.location.characters
            : [];
        if (!visibleTargets.some(function (target) { return target.id === uiState.interactionTargetId; })) {
            uiState.interactionTargetId = "";
        }
        uiState.narrativeNoticeability = uiState.narrativeNoticeability === "hidden" ? "hidden" : "noticeable";
        return uiState;
    }

    function resizeNarrativeTextarea(textarea) {
        if (!textarea || !textarea.style) return;
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight || 0}px`;
        textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? "auto" : "hidden";
    }

    function syncActionSelectionUI(view) {
        const selected = selectedActionForView(view);
        const key = actionKey(selected);
        document.querySelectorAll(".framework-context-action").forEach(function (button) {
            button.classList.toggle("is-selected", button.dataset.actionKey === key && Boolean(key));
            button.setAttribute("aria-pressed", button.dataset.actionKey === key && Boolean(key) ? "true" : "false");
        });
        const label = document.getElementById("selected-action-label");
        if (label) label.textContent = actionLabel(selected, view);
        const clear = document.getElementById("clear-selected-action");
        if (clear) clear.disabled = !selected || getBusyState().busy;

        const noAction = document.querySelector('input[name="formal-action"][value=""]');
        if (noAction) noAction.checked = !selected;
        document.querySelectorAll('input[name="formal-action"]').forEach(function (radio) {
            if (radio.value) radio.checked = Boolean(selected && radio.value === selected.type);
        });
        if (!selected) return;
        if (selected.type === "move") setControlValue("action-move-destination", selected.destination_id);
        if (selected.type === "move_within_location") setControlValue("action-move-within-destination", selected.destination_id);
        if (selected.type === "take_item") setControlValue("action-take-item", selected.item_id);
        if (selected.type === "drop_item") setControlValue("action-drop-item", selected.item_id);
        if (selected.type === "give_item") {
            setControlValue("action-give-item", selected.item_id);
            setControlValue("action-give-item-target", selected.target_id);
        }
        if (selected.type === "give_money") {
            setControlValue("action-money-amount", selected.amount);
            setControlValue("action-money-target", selected.target_id);
        }
        if (selected.type === "place_item") {
            setControlValue("action-place-item", selected.item_id);
            setControlValue("action-place-inventory", selected.target_inventory_id);
        }
        if (selected.type === "fill") setControlValue("action-fill-item", selected.item_id);
        if (selected.type === "consume") setControlValue("action-consume-item", selected.item_id);
    }

    function buildContextualActionGroups(view) {
        const groups = { characters: [], here: [], travel: [] };
        (view.location.characters || []).forEach(function (character) {
            groups.characters.push({ kind: "character", label: `Talk to ${character.name}`, characterId: character.id });
        });

        const internalAction = view.available_actions.move_within_location;
        (internalAction && internalAction.options.destination_ids || []).forEach(function (destinationId) {
            const destination = view.location.sublocations.find(function (candidate) { return candidate.id === destinationId; });
            if (destination) groups.here.push({ kind: "action", label: destination.enter_label || `Move to ${destination.name}`, action: { type: "move_within_location", destination_id: destination.id } });
        });

        const takeAction = view.available_actions.take_item;
        const takeIds = takeAction && takeAction.options.item_ids || [];
        const seenTake = new Set();
        (view.accessible_inventories || []).forEach(function (inventory) {
            (inventory.items || []).forEach(function (item) {
                if (takeIds.includes(item.id) && !seenTake.has(item.id)) {
                    seenTake.add(item.id);
                    groups.here.push({ kind: "action", label: `Take ${item.name}`, action: { type: "take_item", item_id: item.id } });
                }
            });
        });

        const dropAction = view.available_actions.drop_item;
        const dropIds = dropAction && dropAction.options.item_ids || [];
        (view.self.inventory || []).forEach(function (item) {
            if (dropIds.includes(item.id)) groups.here.push({ kind: "action", label: `Drop ${item.name}`, action: { type: "drop_item", item_id: item.id } });
        });

        const placeAction = view.available_actions.place_item;
        const placeIds = placeAction && placeAction.options.item_ids || [];
        const targetIds = placeAction && placeAction.options.target_inventory_ids || [];
        (view.self.inventory || []).forEach(function (item) {
            if (!placeIds.includes(item.id)) return;
            targetIds.forEach(function (inventoryId) {
                const inventory = view.accessible_inventories.find(function (candidate) { return candidate.id === inventoryId; });
                if (inventory) groups.here.push({ kind: "action", label: `Place ${item.name} on ${inventory.name}`, action: { type: "place_item", item_id: item.id, target_inventory_id: inventory.id } });
            });
        });

        ["fill", "consume"].forEach(function (actionType) {
            const record = view.available_actions[actionType];
            (record && record.options.items || []).forEach(function (item) {
                groups.here.push({ kind: "action", label: item.action_label || record.description, action: { type: actionType, item_id: item.id } });
            });
        });

        discoverAvailableAbilities(view).forEach(function (ability) {
            groups.here.push({ kind: "action", label: ability.name, action: { type: ability.actionType } });
        });

        const moveAction = view.available_actions.move;
        const moveIds = moveAction && moveAction.options.destination_ids || [];
        (view.location.exits || []).forEach(function (destination) {
            if (moveIds.includes(destination.id)) groups.travel.push({ kind: "action", label: `Go to ${destination.name}`, action: { type: "move", destination_id: destination.id } });
        });
        return groups;
    }

    function renderPrivateFeedback(root, actorId, view) {
        const storedResult = getActorAbilityResult(getUIState(), actorId);
        if (!storedResult) return;
        const hasFeedback = Array.isArray(storedResult.feedback) && storedResult.feedback.length > 0;
        if (storedResult.ok && !hasFeedback) return;
        const resultArea = document.createElement("section");
        resultArea.className = "framework-private-feedback";
        appendTextElement(resultArea, "h3", `What ${view.self.name} notices`);
        const content = document.createElement("div");
        content.className = "framework-ability-result";
        content.innerHTML = abilityResultMarkup(storedResult);
        resultArea.appendChild(content);
        root.appendChild(resultArea);
    }

    function isZeroInputAbilityAction(actionRecord) {
        if (!actionRecord || !actionRecord.schema || !actionRecord.schema.properties) {
            return false;
        }
        return Object.keys(actionRecord.schema.properties).every(function (key) {
            return key === "type";
        }) && (actionRecord.schema.required || []).every(function (key) {
            return key === "type";
        });
    }

    function discoverAvailableAbilities(view) {
        if (!view || !view.self || !Array.isArray(view.self.abilities)) {
            return [];
        }
        return view.self.abilities.filter(function (ability) {
            const actionRecord = view.available_actions && view.available_actions[ability.actionType];
            return isZeroInputAbilityAction(actionRecord) && actionRecord.sources.some(function (source) {
                return source.kind === "character_ability" && source.id === ability.id;
            });
        }).map(function (ability) {
            const actionRecord = view.available_actions[ability.actionType];
            return {
                id: ability.id,
                name: ability.name,
                playerDescription: ability.playerDescription,
                actionType: ability.actionType,
                sources: actionRecord.sources.map(function (source) {
                    return { kind: source.kind, id: source.id || "", name: source.name || "" };
                })
            };
        });
    }

    function abilityResultMarkup(result) {
        if (!result) {
            return "";
        }
        if (!result.ok) {
            return `<p class="framework-status">${escapeHtml(result.error && result.error.message || "Ability execution failed.")}</p>`;
        }
        const auraFeedback = (result.feedback || []).find(function (entry) {
            return entry.code === "AURA_SCAN_RESULT";
        });
        if (!auraFeedback) {
            return (result.feedback || []).map(function (entry) {
                return `<p>${escapeHtml(entry.text)}</p>`;
            }).join("");
        }
        const results = auraFeedback.data && Array.isArray(auraFeedback.data.results)
            ? auraFeedback.data.results
            : [];
        if (results.length === 0) {
            return `<h4>Aura reading</h4><p>${escapeHtml(auraFeedback.text)}</p>`;
        }
        return `<h4>Aura reading</h4>${results.map(function (entry) {
            return `<section class="framework-ability-result-entry"><strong>${escapeHtml(entry.name)}</strong><p>${escapeHtml(entry.aura)}</p></section>`;
        }).join("")}`;
    }

    function getActorAbilityResult(uiState, actorId) {
        return uiState && uiState.abilityResultsByActor
            ? uiState.abilityResultsByActor[actorId] || null
            : null;
    }

    function renderAbilitySection() {
        // Abilities are rendered as contextual formal-action shortcuts.
    }

    function formatResult(result) {
        if (!result) {
            return "No action has been attempted yet.";
        }

        return JSON.stringify(result, null, 2);
    }

    function currentPassageForHuman() {
        const world = setup.Game.getWorld();
        const actorId = setup.Game.getHumanCharacterId();
        const actor = world.entities[actorId];
        return world.entities[actor.locationId].passage;
    }

    function refreshCurrentPassage() {
        if (typeof Engine !== "undefined") {
            Engine.show();
        }
    }

    function appendTextElement(parent, tagName, value, className) {
        const element = document.createElement(tagName);
        element.textContent = value;
        if (className) {
            element.className = className;
        }
        parent.appendChild(element);
        return element;
    }

    function renderInteractionView() {
        // Character shortcuts select the turn-panel addressee without opening a second panel.
    }

    function promptLabJson(value, emptyText) {
        return value === null || value === undefined
            ? escapeHtml(emptyText || "None")
            : escapeHtml(JSON.stringify(value, null, 2));
    }

    function promptLabTraceMarkup(run) {
        if (!run || !run.trace) {
            return `<p>No prompt-lab response has been recorded.</p>`;
        }
        const attempts = Array.isArray(run.trace.attempts) ? run.trace.attempts : [];
        return attempts.map(function (attempt) {
            const errors = attempt.validationErrors && attempt.validationErrors.length
                ? `<ul>${attempt.validationErrors.map(function (error) {
                    return `<li>${escapeHtml(error)}</li>`;
                }).join("")}</ul>`
                : `<p>Protocol validation passed for this response.</p>`;
            const provider = attempt.providerResponse
                ? `<h5>OpenRouter HTTP response</h5>
                    <pre>${promptLabJson(attempt.providerResponse, "No provider diagnostics")}</pre>`
                : "";
            return `
                <details class="prompt-lab-attempt"${attempt.attempt === attempts.length ? " open" : ""}>
                    <summary>Attempt ${escapeHtml(attempt.attempt)} &mdash; ${escapeHtml(attempt.kind)}</summary>
                    <h5>Messages sent</h5>
                    <pre>${promptLabJson(attempt.messages, "No messages")}</pre>
                    ${provider}
                    <h5>Raw model content</h5>
                    <pre>${escapeHtml(attempt.rawContent || "(empty response)")}</pre>
                    <h5>Parsed JSON</h5>
                    <pre>${promptLabJson(attempt.parsedValue, "JSON parsing did not succeed.")}</pre>
                    <h5>Validation</h5>
                    ${errors}
                    <h5>Usage</h5>
                    <pre>${promptLabJson(attempt.usage, "No usage data")}</pre>
                </details>
            `;
        }).join("");
    }

    function promptLabNarrativeHistoryMarkup(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return `<p class="prompt-lab-narrative-empty">No live AI narrative has been recorded yet.</p>`;
        }
        return entries.map(function (entry, index) {
            const fragments = Array.isArray(entry.fragments) ? entry.fragments : [];
            const body = fragments.length
                ? fragments.map(function (fragment) { return `<p>${escapeHtml(fragment)}</p>`; }).join("")
                : `<p class="prompt-lab-narrative-empty">No public narrative or formal-action event was produced.</p>`;
            return `<article class="prompt-lab-narrative-entry">
                <h5>${escapeHtml(index + 1)}. ${escapeHtml(entry.actorName || entry.actorId || "Unknown character")}</h5>
                ${body}
            </article>`;
        }).join("");
    }

    function promptLabQueueMarkup(snapshot, hasKey) {
        const queue = snapshot.queue;
        if (!queue || !queue.entries || queue.entries.length === 0) {
            return `<div class="prompt-lab-queue-empty">
                <strong>The scheduler queue is empty.</strong>
                <p>Speak or act near an AI-controlled character to create an observation for it.</p>
            </div>`;
        }
        return queue.entries.map(function (entry) {
            const selected = snapshot.selectedQueueCharacterId === entry.characterId;
            const classes = ["prompt-lab-queue-entry"];
            if (entry.isNext) classes.push("is-next");
            if (selected) classes.push("is-selected");
            const observations = entry.observationPreview.length
                ? `<ol>${entry.observationPreview.map(function (observation) {
                    const turn = observation.turn === null ? "" : ` <span class="prompt-lab-observation-turn">turn ${escapeHtml(observation.turn)}</span>`;
                    return `<li><span class="prompt-lab-observation-type">${escapeHtml(observation.type)}</span>${turn}<br>${escapeHtml(observation.summary)}</li>`;
                }).join("")}</ol>`
                : `<p>No valid observation preview is available.</p>`;
            const hidden = entry.hiddenObservationCount > 0
                ? `<p class="prompt-lab-more">+ ${escapeHtml(entry.hiddenObservationCount)} more observations in this request batch</p>`
                : "";
            const liveButton = entry.isNext
                ? `<button class="prompt-lab-process-live"${(!hasKey || snapshot.busy) ? " disabled" : ""}>Process live</button>`
                : "";
            return `
                <article class="${classes.join(" ")}" data-character-id="${escapeHtml(entry.characterId)}">
                    <header>
                        <span class="prompt-lab-queue-number">#${escapeHtml(entry.position)}</span>
                        ${entry.isNext ? `<span class="prompt-lab-next-badge">NEXT REQUEST</span>` : ""}
                        ${selected ? `<span class="prompt-lab-loaded-badge">LOADED</span>` : ""}
                    </header>
                    <h5>${escapeHtml(entry.recipientName)}</h5>
                    <dl>
                        <dt>Recipient</dt><dd>${escapeHtml(entry.recipientName)} <code>${escapeHtml(entry.characterId)}</code></dd>
                        <dt>Location</dt><dd>${escapeHtml(entry.locationName)}</dd>
                        <dt>Queued because</dt><dd>${escapeHtml(entry.reason)}</dd>
                        <dt>Request</dt><dd>Decision stage; ${escapeHtml(entry.requestObservationCount)} observation(s); ${escapeHtml(entry.availableActionCount)} formal action type(s)</dd>
                    </dl>
                    <div class="prompt-lab-observation-list">
                        <strong>Observations that will be sent</strong>
                        ${observations}
                        ${hidden}
                    </div>
                    <div class="prompt-lab-button-row">
                        <button class="prompt-lab-inspect-queue"${snapshot.busy ? " disabled" : ""}>Inspect request</button>
                        <button class="prompt-lab-test-queue"${(!hasKey || snapshot.busy) ? " disabled" : ""}>Dry run</button>
                        ${liveButton}
                    </div>
                </article>`;
        }).join("");
    }

    function renderPromptLab(root, view) {
        if (!view || !view.location || view.location.id !== "villageTemple" || !setup.PromptLab) {
            return;
        }
        const snapshot = setup.PromptLab.getSnapshot();
        const source = snapshot.sourceRequest;
        const hasKey = setup.AIRuntimeSettings && setup.AIRuntimeSettings.getStatus().hasKey;
        const disabledForRequest = snapshot.busy || !hasKey;
        const sourceInfo = source
            ? `${escapeHtml(source.label)}<br>Actor: ${escapeHtml(source.actorName)}<br>Stage: ${escapeHtml(source.stage)}`
            : "No request is loaded.";
        const keyWarning = hasKey ? "" : "Enter and save an OpenRouter key in the sidebar before sending a request.";
        const lastRunSummary = snapshot.lastRun
            ? `<strong>Last recorded run:</strong> ${snapshot.lastRun.ok
                ? "valid"
                : `failed &mdash; ${escapeHtml(snapshot.lastRun.error && snapshot.lastRun.error.code || "UNKNOWN_ERROR")}: ${escapeHtml(snapshot.lastRun.error && snapshot.lastRun.error.message || "Unknown failure.")}`}`
            : "<strong>Last recorded run:</strong> none";
        const importedSummary = snapshot.hasImportedExchange
            ? `Imported file: ${escapeHtml(snapshot.importedFilename || "exchange log")}`
            : "No exchange log is imported.";
        const executorStatus = snapshot.executor && snapshot.executor.cooldownRemainingMs > 0
            ? `Shared request executor: next network call waits about ${Math.max(1, Math.ceil(snapshot.executor.cooldownRemainingMs / 1000))} second(s).`
            : `Shared request executor: ready; minimum interval ${escapeHtml(setup.AIRequestExecutor.MIN_INTERVAL_MS)} ms.`;

        const panel = document.createElement("section");
        panel.id = "prompt-lab-panel";
        panel.className = "prompt-lab-panel";
        panel.innerHTML = `
            <div class="prompt-lab-orb" aria-hidden="true">
                <div class="prompt-lab-orb-glow"></div>
            </div>
            <h3>The crystal sphere</h3>
            <p>The sphere shows the scheduler queue in its real execution order. The first card is the exact character request the scheduler will process next.</p>
            <p><strong>Inspect request</strong> and <strong>Dry run</strong> never change the world. <strong>Process live</strong> uses the same scheduler as the sidebar, applies the result, and advances the queue.</p>
            <div id="prompt-lab-status" class="framework-status">${escapeHtml(snapshot.status || "")}</div>
            <div class="framework-status">${escapeHtml(executorStatus)}</div>
            <div class="prompt-lab-warning">${escapeHtml(keyWarning)}</div>

            <section class="prompt-lab-narrative-history">
                <div class="prompt-lab-section-heading">
                    <h4>Narrative history</h4>
                    <button id="prompt-lab-clear-narrative"${(!snapshot.narrativeHistory.length || snapshot.busy) ? " disabled" : ""}>Clear</button>
                </div>
                <div class="prompt-lab-narrative-window">
                    ${promptLabNarrativeHistoryMarkup(snapshot.narrativeHistory)}
                </div>
            </section>

            <section class="prompt-lab-queue">
                <div class="prompt-lab-section-heading">
                    <h4>Scheduler queue</h4>
                    <span>${escapeHtml(snapshot.queue.count)} pending character turn(s)</span>
                </div>
                ${promptLabQueueMarkup(snapshot, hasKey)}
            </section>

            <div class="prompt-lab-button-row prompt-lab-secondary-controls">
                <button id="prompt-lab-load-last"${(!snapshot.hasLastGameRequest || snapshot.busy) ? " disabled" : ""}>Inspect last game request</button>
                <button id="prompt-lab-clear"${snapshot.busy ? " disabled" : ""}>Clear sphere</button>
            </div>

            <section class="prompt-lab-transfer">
                <h4>Portable AI exchange log</h4>
                <p>The file contains the loaded request, raw model replies, complete browser-visible OpenRouter HTTP error details, parser and validation results, usage data, queue snapshot, and up to ${escapeHtml(setup.AIRequestExecutor.MAX_EXCHANGE_HISTORY)} executor exchanges from this page. API keys and authorization headers are excluded.</p>
                <p><strong>${escapeHtml(snapshot.exchangeHistoryCount)}</strong> exchange(s) recorded. ${importedSummary}</p>
                <div class="prompt-lab-button-row">
                    <button id="prompt-lab-download-log"${(!snapshot.canExport || snapshot.busy) ? " disabled" : ""}>Download AI log</button>
                    <button id="prompt-lab-import-log"${snapshot.busy ? " disabled" : ""}>Import AI log</button>
                    <button id="prompt-lab-clear-log"${(!snapshot.exchangeHistoryCount || snapshot.busy) ? " disabled" : ""}>Clear exchange history</button>
                    <input id="prompt-lab-import-file" type="file" accept="application/json,.json" hidden>
                </div>
            </section>

            <section class="prompt-lab-source">
                <h4>Loaded request</h4>
                <p>${sourceInfo}</p>
                <label for="prompt-lab-system-prompt">Editable system prompt</label>
                <textarea id="prompt-lab-system-prompt" rows="12"${(!source || snapshot.busy) ? " disabled" : ""}>${escapeHtml(snapshot.editedSystemPrompt || "")}</textarea>
                <div class="prompt-lab-button-row">
                    <button id="prompt-lab-retry-exact"${(!source || disabledForRequest) ? " disabled" : ""}>Dry-run exact request</button>
                    <button id="prompt-lab-retry-edited"${(!source || disabledForRequest) ? " disabled" : ""}>Dry-run edited system prompt</button>
                </div>
                <details>
                    <summary>Exact messages that will be sent</summary>
                    <pre>${promptLabJson(source && source.messages, "No request loaded")}</pre>
                </details>
                <details>
                    <summary>Available formal actions from the canonical view</summary>
                    <pre>${promptLabJson(source && setup.AIProtocol.actionCatalogFromMessages(source.messages), "No request loaded")}</pre>
                </details>
            </section>

            <section class="prompt-lab-results">
                <h4>Protocol trace</h4>
                <p>${lastRunSummary}</p>
                <div class="prompt-lab-button-row">
                    <button id="prompt-lab-replay-imported"${(!snapshot.canReplayImported || snapshot.busy) ? " disabled" : ""}>Replay recorded exchange</button>
                </div>
                <p class="prompt-lab-more">Replay feeds the recorded raw model replies through the current parser and validator. It uses no network, needs no API key, and never changes the game world.</p>
                ${promptLabTraceMarkup(snapshot.lastRun)}
            </section>
        `;
        root.appendChild(panel);

        function redraw() {
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        }

        function showImmediateStatus(message) {
            const status = document.getElementById("prompt-lab-status");
            if (status) status.textContent = message;
        }

        $(".prompt-lab-inspect-queue").on("click", function () {
            const characterId = $(this).closest(".prompt-lab-queue-entry").attr("data-character-id");
            const result = setup.PromptLab.loadQueuedDecision(characterId);
            if (!result.ok) showImmediateStatus(result.error.message);
            redraw();
        });

        $(".prompt-lab-test-queue").on("click", async function () {
            const characterId = $(this).closest(".prompt-lab-queue-entry").attr("data-character-id");
            const uiState = getUIState();
            if (getBusyState().busy) return;
            uiState.turnBusy = true;
            showImmediateStatus(`The crystal sphere is dry-running the queued request for ${characterId}...`);
            redraw();
            try {
                const pending = setup.PromptLab.testQueued(characterId);
                redraw();
                await pending;
            } finally {
                uiState.turnBusy = false;
            }
            redraw();
        });

        $(".prompt-lab-process-live").on("click", async function () {
            const uiState = getUIState();
            if (getBusyState().busy) return;
            uiState.turnBusy = true;
            showImmediateStatus("The crystal sphere is processing the next scheduler entry live...");
            redraw();
            try {
                const pending = setup.PromptLab.processNextLive();
                redraw();
                await pending;
            } finally {
                uiState.turnBusy = false;
            }
            redraw();
        });

        $("#prompt-lab-load-last").on("click", function () {
            const result = setup.PromptLab.loadLastGameRequest();
            if (!result.ok) showImmediateStatus(result.error.message);
            redraw();
        });

        $("#prompt-lab-retry-exact").on("click", async function () {
            showImmediateStatus("The crystal sphere is dry-running the exact request...");
            await setup.PromptLab.retryExact();
            redraw();
        });

        $("#prompt-lab-retry-edited").on("click", async function () {
            const prompt = $("#prompt-lab-system-prompt").val();
            showImmediateStatus("The crystal sphere is dry-running the request with the edited system prompt...");
            await setup.PromptLab.retryEdited(prompt);
            redraw();
        });

        $("#prompt-lab-download-log").on("click", function () {
            const result = setup.PromptLab.exportExchangeLog();
            if (!result.ok) {
                showImmediateStatus(result.error.message);
                return;
            }
            try {
                const blob = new Blob([result.text], { type: "application/json;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = result.filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(function () { URL.revokeObjectURL(url); }, 0);
                showImmediateStatus(`Downloaded ${result.filename}.`);
            } catch (error) {
                showImmediateStatus("The browser could not download the AI exchange log.");
            }
        });

        $("#prompt-lab-import-log").on("click", function () {
            const input = document.getElementById("prompt-lab-import-file");
            if (input) input.click();
        });

        $("#prompt-lab-import-file").on("change", async function () {
            const file = this.files && this.files[0];
            if (!file) return;
            showImmediateStatus(`Importing ${file.name}...`);
            try {
                const text = await file.text();
                const result = setup.PromptLab.importExchangeLog(text, file.name);
                if (!result.ok) showImmediateStatus(result.error.message);
            } catch (error) {
                showImmediateStatus("The selected AI exchange log could not be read.");
            }
            this.value = "";
            redraw();
        });

        $("#prompt-lab-replay-imported").on("click", async function () {
            showImmediateStatus("Replaying the recorded model response through the current protocol validator...");
            await setup.PromptLab.replayImportedExchange();
            redraw();
        });

        $("#prompt-lab-clear-log").on("click", function () {
            setup.PromptLab.clearExchangeHistory();
            redraw();
        });

        $("#prompt-lab-clear-narrative").on("click", function () {
            setup.PromptLab.clearNarrativeHistory();
            redraw();
        });

        $("#prompt-lab-clear").on("click", function () {
            setup.PromptLab.clear();
            redraw();
        });
    }

    function renderLocationView() {
        const root = document.getElementById("location-view");
        if (!root) return;

        const actorId = setup.Game.getHumanCharacterId();
        const view = setup.CharacterAPI.getView(actorId);
        const uiState = getUIState();
        const busyState = getBusyState();
        root.replaceChildren();

        appendTextElement(root, "h2", view.location.name);
        const status = appendTextElement(root, "div", uiState.locationStatus, "framework-status");
        status.id = "location-status";
        uiState.locationStatus = "";

        if (uiState.turnNarrative.length > 0) {
            const narrative = document.createElement("section");
            narrative.className = "framework-turn-narrative";
            appendTextElement(narrative, "h3", "Latest turn");
            uiState.turnNarrative.forEach(function (fragment) {
                appendTextElement(narrative, "p", fragment);
            });
            root.appendChild(narrative);
        }

        renderPrivateFeedback(root, actorId, view);

        view.location.description.forEach(function (paragraph) {
            appendTextElement(root, "p", paragraph);
        });
        view.location.sublocations.forEach(function (sublocation) {
            if (sublocation.public_text) appendTextElement(root, "p", sublocation.public_text, "framework-furniture-text");
        });
        appendTextElement(root, "p", view.self.position_text, "framework-position-text");
        view.location.characters.forEach(function (character) {
            appendTextElement(root, "p", `${character.presence_text} ${character.position_text}`);
        });

        renderPromptLab(root, view);

        const groups = buildContextualActionGroups(view);
        const shortcuts = document.createElement("section");
        shortcuts.className = "framework-contextual-actions";
        const definitions = [
            { key: "characters", title: "Characters" },
            { key: "here", title: "Here" },
            { key: "travel", title: "Travel" }
        ];
        definitions.forEach(function (definition) {
            const entries = groups[definition.key];
            if (!entries.length) return;
            const group = document.createElement("section");
            group.className = "framework-contextual-group";
            appendTextElement(group, "h3", definition.title);
            const buttons = document.createElement("div");
            buttons.className = "framework-contextual-buttons";
            entries.forEach(function (entry) {
                const button = appendTextElement(buttons, "button", entry.label);
                button.type = "button";
                button.disabled = busyState.busy;
                if (entry.kind === "character") {
                    button.className = "framework-character-shortcut";
                    button.dataset.characterId = entry.characterId;
                    button.classList.toggle("is-selected", uiState.interactionTargetId === entry.characterId);
                    button.addEventListener("click", function () { setInteractionTarget(entry.characterId, view); });
                } else {
                    button.className = "framework-context-action";
                    button.dataset.actionKey = actionKey(entry.action);
                    button.setAttribute("aria-pressed", "false");
                    button.addEventListener("click", function () { toggleSelectedAction(entry.action, view); });
                }
                buttons.appendChild(button);
            });
            group.appendChild(buttons);
            shortcuts.appendChild(group);
        });
        if (shortcuts.childNodes.length > 0) root.appendChild(shortcuts);
        syncActionSelectionUI(view);
    }

    function renderSidebar() {
        const root = document.getElementById("framework-sidebar");
        if (!root) {
            return;
        }

        const world = setup.Game.getWorld();
        const humanId = setup.Game.getHumanCharacterId();
        const actor = world.entities[humanId];
        const location = world.entities[actor.locationId];
        const characters = Object.values(world.entities).filter(function (entity) {
            return entity.type === "character";
        });
        if (!aiSettingsInitialized && setup.AIRuntimeSettings) {
            setup.AIRuntimeSettings.readSaved();
            aiSettingsInitialized = true;
        }
        const aiQueue = setup.AITurnScheduler.getQueueView();
        const aiSettings = setup.AIRuntimeSettings.getStatus();
        const aiBusy = setup.AIController.isInFlight() || setup.AIRequestExecutor.getStatus().busy || setup.AITurnScheduler.isWaveInFlight();
        const autoProcessingPaused = setup.AITurnScheduler.isAutoProcessingPaused();
        const usage = setup.AITransientDebug.lastUsage;
        const usageText = usage ? `Usage: ${escapeHtml(JSON.stringify(usage))}` : "";
        const modelOptions = aiSettings.models.map(function (model) {
            const selected = model.id === aiSettings.selectedModelId ? " selected" : "";
            const defaultLabel = model.id === aiSettings.defaultModelId ? " (default)" : "";
            return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.name + defaultLabel)}</option>`;
        }).join("");
        const queueText = aiQueue.head
            ? `Next recipient: ${escapeHtml(aiQueue.head.recipientName)}<br>` +
                `Event: ${escapeHtml(aiQueue.head.primaryObservation && aiQueue.head.primaryObservation.summary || aiQueue.head.reason)}<br>` +
                `Pending character turns: ${aiQueue.count}`
            : "No pending AI turns";

        root.innerHTML = `
            <div class="framework-sidebar-block">
                <strong>Human controller</strong><br>
                <select id="human-character-select">
                    ${characters.map(function (character) {
                        const selected = character.id === humanId ? " selected" : "";
                        return `<option value="${escapeHtml(character.id)}"${selected}>${escapeHtml(character.name)}</option>`;
                    }).join("")}
                </select>
                <button id="take-control-button">Take control</button>
            </div>
            <div class="framework-sidebar-block">
                <strong>${escapeHtml(actor.name)}</strong><br>
                Controller: human<br>
                Location: ${escapeHtml(location.name)}<br>
                Position: ${escapeHtml(setup.CharacterAPI.getView(humanId).self.position_text)}<br>
                Gold: ${escapeHtml(actor.wallet)}<br>
                Inventory: ${setup.CharacterAPI.getView(humanId).self.inventory
                    .map(function (item) { return escapeHtml(item.name); }).join(", ") || "empty"}
            </div>
            <div class="framework-sidebar-block">
                <button id="validate-world-button">Validate world</button>
                <button id="reset-world-button">Reset world</button>
                <div id="sidebar-status" class="framework-status"></div>
            </div>
            <div class="framework-sidebar-block" id="ai-settings-panel">
                <strong>AI Settings</strong><br>
                Provider: OpenRouter<br>
                <label>Model
                    <select id="openrouter-model-select"${aiBusy ? " disabled" : ""}>${modelOptions}</select>
                </label><br>
                <span class="framework-model-id">${escapeHtml(aiSettings.selectedModelId)}</span><br>
                Key status: ${aiSettings.hasKey ? "available" : "not set"}<br>
                <label>API key <input id="openrouter-api-key" type="password" autocomplete="off"></label><br>
                <label><input id="remember-openrouter-key" type="checkbox"> Remember for 24 hours</label><br>
                <button id="save-ai-settings">Save key</button>
                <button id="forget-ai-key">Forget saved key</button>
                <div id="ai-settings-status" class="framework-status">${escapeHtml(aiSettings.warning || "")}</div>
            </div>
            <div class="framework-sidebar-block" id="ai-turn-panel">
                <strong>AI turn scheduler</strong><br>
                <label class="framework-auto-ai-toggle"><input id="stop-auto-ai-processing" type="checkbox"${autoProcessingPaused ? " checked" : ""}${aiBusy ? " disabled" : ""}> Stop automatic AI request processing</label><br>
                <span id="ai-queue-status">${queueText}</span><br>
                <button id="take-next-ai-turn"${(!aiQueue.head || !aiSettings.hasKey || aiBusy) ? " disabled" : ""}>Process next AI event</button>
                <div id="ai-turn-status" class="framework-status">${escapeHtml(setup.AITransientDebug.lastSafeError || "")}</div>
                <div id="ai-usage-status" class="framework-status">${usageText}</div>
            </div>
        `;

        $("#take-control-button").on("click", function () {
            const targetId = $("#human-character-select").val();
            const result = setup.Game.takeHumanControl(targetId);
            const status = document.getElementById("sidebar-status");

            if (!result.ok) {
                status.textContent = result.error.message;
                return;
            }

            getUIState().interactionTargetId = "";
            const passage = currentPassageForHuman();
            Engine.play(passage);
        });

        $("#validate-world-button").on("click", function () {
            const result = setup.Game.validateWorld();
            $("#sidebar-status").text(result.ok ? "World is valid." : result.error.message);
        });

        $("#reset-world-button").on("click", function () {
            if (!window.confirm("Reset the entire framework world?")) {
                return;
            }

            setup.Game.resetWorld();
            delete State.variables.frameworkUI;
            Engine.play(currentPassageForHuman());
        });

        $("#openrouter-model-select").on("change", function () {
            const result = setup.AIRuntimeSettings.selectModel($(this).val());
            if (!result.ok) {
                $("#ai-settings-status").text(result.error.message);
                $(this).val(setup.AIRuntimeSettings.getSelectedModelId());
                return;
            }
            $("#ai-settings-status").text(result.warning || `Model selected: ${result.model.name}.`);
            $(".framework-model-id").text(result.model.id);
        });

        $("#save-ai-settings").on("click", function () {
            const result = setup.AIRuntimeSettings.save(
                $("#openrouter-api-key").val(),
                $("#remember-openrouter-key").prop("checked")
            );
            $("#openrouter-api-key").val("");
            $("#ai-settings-status").text(result.ok
                ? (result.warning || (result.remembered ? "Key saved for 24 hours." : "Key retained in memory for this page."))
                : result.error.message);
            renderSidebar();
        });

        $("#forget-ai-key").on("click", function () {
            const result = setup.AIRuntimeSettings.forget();
            $("#ai-settings-status").text(result.warning || "Saved and in-memory key forgotten.");
            renderSidebar();
        });

        $("#stop-auto-ai-processing").on("change", function () {
            const result = setup.AITurnScheduler.setAutoProcessingPaused($(this).prop("checked"));
            $("#ai-turn-status").text(result.paused
                ? "Automatic processing after Submit is paused. Pass and sphere controls remain manual."
                : "Automatic processing after Submit is enabled.");
        });

        $("#take-next-ai-turn").on("click", async function () {
            const uiState = getUIState();
            if (getBusyState().busy) return;
            uiState.turnBusy = true;
            $(this).prop("disabled", true);
            $("#ai-turn-status").text("Scheduler is processing the next AI event...");
            renderSidebar();
            renderLocationView();
            renderActionPanel();
            let result;
            try {
                const pending = setup.AITurnScheduler.processNext();
                renderSidebar();
                renderLocationView();
                renderActionPanel();
                result = await pending;
            } finally {
                uiState.turnBusy = false;
            }
            setup.AITransientDebug.lastSafeError = result && result.ok ? "" : result && result.error ? result.error.message : "AI processing failed.";
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        });
    }

    async function runHumanIntent(input, navigateOnMove) {
        const uiState = getUIState();
        if (getBusyState().busy) {
            return { ok: false, error: { code: "TURN_IN_FLIGHT", message: "A turn is already being processed." } };
        }

        uiState.turnBusy = true;
        uiState.locationStatus = "Processing turn...";
        renderSidebar();
        renderLocationView();
        renderActionPanel();

        let result;
        try {
            const pending = setup.TurnFlow.submitHumanIntent(input);
            renderSidebar();
            renderLocationView();
            renderActionPanel();
            result = await pending;
        } finally {
            uiState.turnBusy = false;
        }

        if (!result || !result.ok) {
            uiState.locationStatus = result && result.error ? result.error.message : "The turn could not be completed.";
            refreshCurrentPassage();
            return result;
        }

        const actionResult = result.intentResult && result.intentResult.actionResult;
        if (actionResult) {
            const hasFeedback = Array.isArray(actionResult.feedback) && actionResult.feedback.length > 0;
            if (!actionResult.ok || hasFeedback) uiState.abilityResultsByActor[result.actorId] = cloneUIValue(actionResult);
            else delete uiState.abilityResultsByActor[result.actorId];
        }
        uiState.selectedAction = null;
        uiState.turnNarrative = result.narrativeFragments || [];
        if (result.waveResult && result.waveResult.paused) {
            uiState.locationStatus = `Intent submitted. Automatic AI processing is paused; ${result.waveResult.remainingQueue.count} turn(s) remain queued.`;
        } else if (result.waveResult && !result.waveResult.ok) {
            uiState.locationStatus = `Intent submitted, but AI processing stopped: ${result.waveResult.error.message}`;
        } else {
            const count = result.waveResult ? result.waveResult.processedCount : 0;
            uiState.locationStatus = `Turn complete. ${count} AI character(s) reacted.`;
        }

        if (navigateOnMove && result.destinationId) {
            Engine.play(setup.Game.getWorld().entities[result.destinationId].passage);
        } else {
            refreshCurrentPassage();
        }
        return result;
    }

    async function passHumanTurn() {
        const uiState = getUIState();
        if (getBusyState().busy) {
            return { ok: false, error: { code: "TURN_IN_FLIGHT", message: "A turn is already being processed." } };
        }
        uiState.turnBusy = true;
        uiState.locationStatus = "Processing queued AI reactions...";
        renderSidebar();
        renderLocationView();
        renderActionPanel();

        let result;
        try {
            const pending = setup.TurnFlow.pass();
            renderSidebar();
            renderLocationView();
            renderActionPanel();
            result = await pending;
        } finally {
            uiState.turnBusy = false;
        }
        uiState.selectedAction = null;
        uiState.turnNarrative = result && result.narrativeFragments || [];
        uiState.locationStatus = result && result.ok
            ? `Pass complete. ${result.waveResult.processedCount} AI character(s) reacted.`
            : `AI processing stopped: ${result && result.error ? result.error.message : "Unknown error."}`;
        refreshCurrentPassage();
        return result;
    }

    function runAction(action, navigateOnMove) {
        return runHumanIntent({
            text: "",
            target_id: "",
            noticeability: "noticeable",
            action: action
        }, navigateOnMove);
    }

    function renderActionPanel() {
        const oldRoot = document.getElementById("framework-action-panel");
        if (oldRoot) oldRoot.remove();

        const passage = document.querySelector("#passages .passage");
        if (!passage) return;

        const actorId = setup.Game.getHumanCharacterId();
        const view = setup.CharacterAPI.getView(actorId);
        const uiState = reconcileConversationState(view, getUIState());
        const actionRoot = document.createElement("section");
        actionRoot.id = "framework-action-panel";
        actionRoot.className = "framework-turn-panel";

        const moveOptions = view.location.exits || [];
        const takeOptions = view.accessible_inventories.flatMap(function (inventory) { return inventory.items; });
        const ownedItems = view.self.inventory || [];
        const visibleTargets = view.location.characters || [];
        const giveItemAction = view.available_actions.give_item;
        const reachableTargetIds = giveItemAction ? giveItemAction.options.target_ids : [];
        const reachableTargets = visibleTargets.filter(function (target) { return reachableTargetIds.includes(target.id); });
        const internalAction = view.available_actions.move_within_location;
        const internalDestinations = internalAction ? internalAction.options.destination_ids.map(function (id) {
            const position = view.location.sublocations.find(function (candidate) { return candidate.id === id; });
            return position ? { id: position.id, name: position.name } : null;
        }).filter(Boolean) : [];
        const placementInventoryIds = view.available_actions.place_item ? view.available_actions.place_item.options.target_inventory_ids : [];
        const placementInventories = view.accessible_inventories.filter(function (inventory) { return placementInventoryIds.includes(inventory.id); });
        const fillItems = view.available_actions.fill ? view.available_actions.fill.options.items : [];
        const consumableItems = view.available_actions.consume ? view.available_actions.consume.options.items : [];
        const knownActionTypes = new Set(["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money", "place_item", "fill", "consume"]);
        const zeroInputExtras = Object.entries(view.available_actions).filter(function (entry) {
            return !knownActionTypes.has(entry[0]) && isZeroInputAbilityAction(entry[1]);
        });
        const aiSettings = setup.AIRuntimeSettings.getStatus();
        const queue = setup.AITurnScheduler.getQueueView();
        const busyState = getBusyState();
        const busy = busyState.busy;
        const selectedAction = selectedActionForView(view);
        const disabledAttribute = busy ? " disabled" : "";

        function radioField(actionType, legend, controls, unavailable) {
            const disabled = unavailable || busy;
            return `<fieldset class="framework-formal-action${unavailable ? " framework-formal-action-disabled" : ""}"${busy ? " disabled" : ""}>
                <legend><label><input type="radio" name="formal-action" value="${escapeHtml(actionType)}"${disabled ? " disabled" : ""}> ${escapeHtml(legend)}</label></legend>
                <div class="formal-action-parameters">${controls || ""}</div>
            </fieldset>`;
        }

        const formalMarkup = [
            radioField("move", "Move", `<select id="action-move-destination"${disabledAttribute}>${optionMarkup(moveOptions, "No connected locations")}</select>`, moveOptions.length === 0),
            radioField("move_within_location", "Move within location", `<select id="action-move-within-destination"${disabledAttribute}>${optionMarkup(internalDestinations, "No internal destination")}</select>`, internalDestinations.length === 0),
            radioField("take_item", "Take item", `<select id="action-take-item"${disabledAttribute}>${optionMarkup(takeOptions, "No items here")}</select>`, takeOptions.length === 0),
            radioField("drop_item", "Drop item", `<select id="action-drop-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select>`, ownedItems.length === 0),
            radioField("give_item", "Give item", `<select id="action-give-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-give-item-target"${disabledAttribute}>${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, ownedItems.length === 0 || reachableTargets.length === 0),
            radioField("give_money", "Give money", `<input id="action-money-amount" type="number" min="1" step="1" value="1"${disabledAttribute}><select id="action-money-target"${disabledAttribute}>${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, reachableTargets.length === 0),
            radioField("place_item", "Place item", `<select id="action-place-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-place-inventory"${disabledAttribute}>${optionMarkup(placementInventories, "No accessible surface")}</select>`, ownedItems.length === 0 || placementInventories.length === 0),
            radioField("fill", "Fill item", `<select id="action-fill-item"${disabledAttribute}>${itemActionOptionMarkup(fillItems, "No fillable item here")}</select>`, fillItems.length === 0),
            radioField("consume", "Consume item", `<select id="action-consume-item"${disabledAttribute}>${itemActionOptionMarkup(consumableItems, "No consumable item")}</select>`, consumableItems.length === 0)
        ].concat(zeroInputExtras.map(function (entry) {
            return radioField(entry[0], entry[1].description || entry[0], "<p>No parameters.</p>", false);
        })).join("");

        actionRoot.innerHTML = `
            <div class="framework-busy-row" aria-live="polite">
                <span class="framework-spinner${busy ? " is-visible" : ""}" aria-hidden="true"></span>
                <span id="framework-busy-text">${escapeHtml(busyState.text)}</span>
            </div>
            <div id="framework-action-status" class="framework-status"></div>

            <div class="framework-narrative-action">
                <textarea id="action-narrative-text" rows="1" placeholder="Say or do something..."${disabledAttribute}></textarea>
                <div class="framework-narrative-controls">
                    <label>Addressee<select id="action-narrative-target"${disabledAttribute}>
                        <option value="">No addressee</option>
                        ${visibleTargets.map(function (target) { return `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`; }).join("")}
                    </select></label>
                    <label>Loudness<select id="action-narrative-noticeability"${disabledAttribute}>
                        <option value="noticeable">Normal</option>
                        <option value="hidden">Quiet / private</option>
                    </select></label>
                </div>
            </div>

            <section class="framework-selected-action">
                <div><strong>Selected action:</strong> <span id="selected-action-label">${escapeHtml(actionLabel(selectedAction, view))}</span></div>
                <button id="clear-selected-action" type="button"${(!selectedAction || busy) ? " disabled" : ""}>Clear</button>
            </section>

            <details class="framework-formal-action-section">
                <summary>Advanced formal actions</summary>
                <label class="framework-no-action"><input type="radio" name="formal-action" value=""${selectedAction ? "" : " checked"}${disabledAttribute}> No formal action</label>
                <div class="framework-action-grid">${formalMarkup}</div>
            </details>

            <div class="framework-turn-controls">
                <button id="action-submit"${busy ? " disabled" : ""}>Submit turn</button>
                <button id="action-pass"${(busy || (queue.head && !aiSettings.hasKey)) ? " disabled" : ""}>Pass</button>
            </div>

        `;

        passage.appendChild(actionRoot);

        $("#action-narrative-target").val(uiState.interactionTargetId);
        $("#action-narrative-noticeability").val(uiState.narrativeNoticeability);
        const narrativeTextarea = document.getElementById("action-narrative-text");
        resizeNarrativeTextarea(narrativeTextarea);
        $("#action-narrative-text").on("input", function () {
            resizeNarrativeTextarea(this);
        });

        function collectFormalActionFromControls() {
            const type = $("input[name='formal-action']:checked").val();
            if (!type) return null;
            if (type === "move") return { type: type, destination_id: $("#action-move-destination").val() };
            if (type === "move_within_location") return { type: type, destination_id: $("#action-move-within-destination").val() };
            if (type === "take_item") return { type: type, item_id: $("#action-take-item").val() };
            if (type === "drop_item") return { type: type, item_id: $("#action-drop-item").val() };
            if (type === "give_item") return { type: type, item_id: $("#action-give-item").val(), target_id: $("#action-give-item-target").val() };
            if (type === "give_money") return { type: type, target_id: $("#action-money-target").val(), amount: Number($("#action-money-amount").val()) };
            if (type === "place_item") return { type: type, item_id: $("#action-place-item").val(), target_inventory_id: $("#action-place-inventory").val() };
            if (type === "fill") return { type: type, item_id: $("#action-fill-item").val() };
            if (type === "consume") return { type: type, item_id: $("#action-consume-item").val() };
            return { type: type };
        }

        syncActionSelectionUI(view);

        $("#action-narrative-target").on("change", function () {
            uiState.interactionTargetId = $(this).val() || "";
            document.querySelectorAll(".framework-character-shortcut").forEach(function (button) {
                button.classList.toggle("is-selected", button.dataset.characterId === uiState.interactionTargetId);
            });
        });
        $("#action-narrative-noticeability").on("change", function () {
            uiState.narrativeNoticeability = $(this).val() === "hidden" ? "hidden" : "noticeable";
        });

        $("input[name='formal-action']").on("change", function () {
            setSelectedAction($(this).val() ? collectFormalActionFromControls() : null, view);
        });
        $(".formal-action-parameters select, .formal-action-parameters input").on("change input", function () {
            const selectedType = $("input[name='formal-action']:checked").val();
            if (selectedType) setSelectedAction(collectFormalActionFromControls(), view);
        });
        $("#clear-selected-action").on("click", function () { setSelectedAction(null, view); });

        $("#action-submit").on("click", async function () {
            const text = $("#action-narrative-text").val();
            const action = selectedActionForView(view);
            if (!String(text || "").trim() && !action) {
                $("#framework-action-status").text("Enter narrative text, select one formal action, or press Pass.");
                return;
            }
            $(this).prop("disabled", true);
            uiState.interactionTargetId = $("#action-narrative-target").val() || "";
            uiState.narrativeNoticeability = $("#action-narrative-noticeability").val() === "hidden" ? "hidden" : "noticeable";
            await runHumanIntent({
                text: text,
                target_id: uiState.interactionTargetId,
                noticeability: uiState.narrativeNoticeability,
                action: cloneUIValue(action)
            }, Boolean(action && action.type === "move"));
        });

        $("#action-pass").on("click", async function () {
            $(this).prop("disabled", true);
            await passHumanTurn();
        });
    }

    function checkPhysicalPassageConsistency() {
        const world = setup.Game.getWorld();
        const actor = world.entities[setup.Game.getHumanCharacterId()];
        const expectedPassage = world.entities[actor.locationId].passage;
        const currentPassage = State.passage;
        const physicalPassages = Object.values(world.entities)
            .filter(function (entity) { return entity.type === "location"; })
            .map(function (entity) { return entity.passage; });

        if (physicalPassages.includes(currentPassage) && currentPassage !== expectedPassage) {
            Engine.play(expectedPassage);
            return false;
        }

        return true;
    }

    setup.PromptLabUIModel = {
        traceMarkup: promptLabTraceMarkup,
        narrativeHistoryMarkup: promptLabNarrativeHistoryMarkup,
        queueMarkup: promptLabQueueMarkup
    };

    setup.AbilityUIModel = {
        discoverAvailableAbilities: discoverAvailableAbilities,
        isZeroInputAbilityAction: isZeroInputAbilityAction,
        abilityResultMarkup: abilityResultMarkup,
        getActorAbilityResult: getActorAbilityResult
    };

    setup.GameUIModel = {
        buildContextualActionGroups: buildContextualActionGroups,
        actionAvailableInView: actionAvailableInView,
        actionLabel: actionLabel,
        reconcileConversationState: reconcileConversationState,
        resizeNarrativeTextarea: resizeNarrativeTextarea,
        busyState: getBusyState
    };

    setup.GameUI = {
        moveHuman: function (destinationId) {
            return runAction({
                type: "move",
                destination_id: destinationId
            }, true);
        },

        takeControl: function (characterId) {
            const result = setup.Game.takeHumanControl(characterId);
            if (result.ok) {
                getUIState().interactionTargetId = "";
                getUIState().selectedAction = null;
                Engine.play(currentPassageForHuman());
            }
            return result;
        },

        openInteraction: function (targetId) {
            const view = setup.CharacterAPI.getView(setup.Game.getHumanCharacterId());
            const target = view.location.characters.find(function (character) {
                return character.id === targetId;
            });
            const uiState = getUIState();

            if (!target) {
                uiState.interactionTargetId = "";
                uiState.locationStatus = "That character is no longer nearby.";
                renderLocationView();
                return {
                    ok: false,
                    error: { code: "TARGET_NOT_NEARBY", message: "That character is no longer nearby." }
                };
            }

            setInteractionTarget(target.id, view);
            return { ok: true, targetId: target.id };
        },

        renderLocationView: renderLocationView,
        renderInteractionView: function () {
            renderLocationView();
        },

        goToHumanLocation: function () {
            Engine.play(currentPassageForHuman());
        },

        render: function () {
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        }
    };

    $(document).on(":passageend", function () {
        setup.Game.bootstrap();

        if (!checkPhysicalPassageConsistency()) {
            return;
        }

        renderSidebar();
        renderLocationView();
        renderActionPanel();
    });
}());
