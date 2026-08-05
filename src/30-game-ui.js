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
        State.variables.frameworkUI.turnBusy = Boolean(State.variables.frameworkUI.turnBusy);
        return State.variables.frameworkUI;
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

    function renderAbilitySection(root, actorId, view) {
        const abilities = discoverAvailableAbilities(view);
        if (abilities.length === 0) {
            return;
        }
        const section = document.createElement("section");
        section.className = "framework-ability-panel";
        appendTextElement(section, "h3", "Abilities");
        abilities.forEach(function (ability) {
            const abilityBlock = document.createElement("section");
            abilityBlock.className = "framework-ability-control";
            appendTextElement(abilityBlock, "h4", ability.name);
            appendTextElement(abilityBlock, "p", ability.playerDescription);
            const button = appendTextElement(abilityBlock, "button", ability.name);
            button.type = "button";
            button.addEventListener("click", function () {
                const currentActorId = setup.Game.getHumanCharacterId();
                if (currentActorId !== actorId) {
                    return;
                }
                const result = setup.CharacterAPI.perform(actorId, { type: ability.actionType });
                getUIState().abilityResultsByActor[actorId] = result;
                refreshCurrentPassage();
            });
            section.appendChild(abilityBlock);
        });
        const storedResult = getActorAbilityResult(getUIState(), actorId);
        if (storedResult) {
            const resultArea = document.createElement("div");
            resultArea.className = "framework-ability-result";
            resultArea.innerHTML = abilityResultMarkup(storedResult);
            section.appendChild(resultArea);
        }
        root.appendChild(section);
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

    function renderInteractionView(root, view) {
        const uiState = getUIState();
        if (!uiState.interactionTargetId) {
            return;
        }

        const target = view.location.characters.find(function (character) {
            return character.id === uiState.interactionTargetId;
        });

        if (!target) {
            uiState.interactionTargetId = "";
            const message = "That character is no longer nearby.";
            uiState.locationStatus = message;
            const status = document.getElementById("location-status");
            if (status) {
                status.textContent = message;
                uiState.locationStatus = "";
            }
            return;
        }

        const panel = document.createElement("section");
        panel.className = "framework-interaction-panel";
        appendTextElement(panel, "h3", target.name);
        appendTextElement(panel, "p", target.presence_text);
        appendTextElement(panel, "p", "Use the narrative or formal-action controls below to interact with this character.");

        const closeButton = appendTextElement(panel, "button", "Back to location");
        closeButton.type = "button";
        closeButton.addEventListener("click", function () {
            uiState.interactionTargetId = "";
            renderLocationView();
            renderActionPanel();
        });
        root.appendChild(panel);
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
                    <summary>Available formal actions used for validation</summary>
                    <pre>${promptLabJson(source && source.availableActions, "No request loaded")}</pre>
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
            showImmediateStatus(`The crystal sphere is dry-running the queued request for ${characterId}...`);
            await setup.PromptLab.testQueued(characterId);
            redraw();
        });

        $(".prompt-lab-process-live").on("click", async function () {
            showImmediateStatus("The crystal sphere is processing the next scheduler entry live...");
            await setup.PromptLab.processNextLive();
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
        if (!root) {
            return;
        }

        const actorId = setup.Game.getHumanCharacterId();
        const view = setup.CharacterAPI.getView(actorId);
        const uiState = getUIState();
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

        view.location.description.forEach(function (paragraph) {
            appendTextElement(root, "p", paragraph);
        });
        view.location.sublocations.forEach(function (sublocation) {
            if (sublocation.public_text) {
                appendTextElement(root, "p", sublocation.public_text, "framework-furniture-text");
            }
        });
        appendTextElement(root, "p", view.self.position_text, "framework-position-text");
        view.location.characters.forEach(function (character) {
            appendTextElement(root, "p", `${character.presence_text} ${character.position_text}`);
        });

        renderPromptLab(root, view);

        if (view.location.characters.length > 0) {
            const interactions = document.createElement("div");
            interactions.className = "framework-location-links";
            view.location.characters.forEach(function (character) {
                const button = appendTextElement(interactions, "button", character.interaction_label);
                button.type = "button";
                button.dataset.characterId = character.id;
                button.addEventListener("click", function () {
                    setup.GameUI.openInteraction(character.id);
                });
            });
            root.appendChild(interactions);
        }

        const movement = document.createElement("div");
        movement.className = "framework-location-links";
        view.location.exits.forEach(function (destination) {
            const button = appendTextElement(movement, "button", `Go to ${destination.name}`);
            button.type = "button";
            button.dataset.destinationId = destination.id;
            button.addEventListener("click", function () {
                setup.GameUI.moveHuman(destination.id);
            });
        });
        root.appendChild(movement);

        const internalMovement = document.createElement("div");
        internalMovement.className = "framework-location-links";
        const internalDestinationIds = view.available_actions.move_within_location.options.destination_ids;
        internalDestinationIds.forEach(function (destinationId) {
            const destination = view.location.sublocations.find(function (candidate) {
                return candidate.id === destinationId;
            });
            if (!destination) {
                return;
            }
            const button = appendTextElement(internalMovement, "button", destination.enter_label);
            button.type = "button";
            button.addEventListener("click", function () {
                runAction({ type: "move_within_location", destination_id: destination.id });
            });
        });
        root.appendChild(internalMovement);

        const itemActions = document.createElement("div");
        itemActions.className = "framework-location-links";
        const consumeOptions = view.available_actions.consume && view.available_actions.consume.options.items || [];
        consumeOptions.forEach(function (item) {
            const button = appendTextElement(itemActions, "button", item.action_label || `Consume ${item.name}`);
            button.type = "button";
            button.addEventListener("click", function () {
                runAction({ type: "consume", item_id: item.id });
            });
        });
        const fillOptions = view.available_actions.fill && view.available_actions.fill.options.items || [];
        fillOptions.forEach(function (item) {
            const button = appendTextElement(itemActions, "button", item.action_label || `Fill ${item.name}`);
            button.type = "button";
            button.addEventListener("click", function () {
                runAction({ type: "fill", item_id: item.id });
            });
        });
        if (itemActions.childNodes.length > 0) root.appendChild(itemActions);

        view.accessible_inventories.forEach(function (inventory) {
            if (inventory.items.length === 0) {
                return;
            }
            const surface = document.createElement("section");
            surface.className = "framework-surface-panel";
            appendTextElement(surface, "h3", inventory.name);
            inventory.items.forEach(function (item) {
                const button = appendTextElement(surface, "button", `Take ${item.name}`);
                button.type = "button";
                button.addEventListener("click", function () {
                    runAction({ type: "take_item", item_id: item.id });
                });
            });
            root.appendChild(surface);
        });

        const placementTargets = view.available_actions.place_item
            ? view.available_actions.place_item.options.target_inventory_ids
            : [];
        if (placementTargets.length > 0 && view.self.inventory.length > 0) {
            const placement = document.createElement("section");
            placement.className = "framework-surface-panel";
            const targetInventory = view.accessible_inventories.find(function (inventory) {
                return inventory.id === placementTargets[0];
            });
            appendTextElement(placement, "h3", `Place on ${targetInventory.name}`);
            view.self.inventory.forEach(function (item) {
                const button = appendTextElement(placement, "button", `Place ${item.name}`);
                button.type = "button";
                button.addEventListener("click", function () {
                    runAction({
                        type: "place_item",
                        item_id: item.id,
                        target_inventory_id: targetInventory.id
                    });
                });
            });
            root.appendChild(placement);
        }

        renderAbilitySection(root, actorId, view);
        renderInteractionView(root, view);
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
            $(this).prop("disabled", true);
            $("#ai-turn-status").text("Scheduler is processing the next AI event...");
            const result = await setup.AITurnScheduler.processNext();
            setup.AITransientDebug.lastSafeError = result.ok ? "" : result.error.message;
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        });
    }

    async function runHumanIntent(input, navigateOnMove) {
        const uiState = getUIState();
        if (uiState.turnBusy) {
            return { ok: false, error: { code: "TURN_IN_FLIGHT", message: "A turn is already being processed." } };
        }

        uiState.turnBusy = true;
        uiState.locationStatus = "Processing turn...";
        renderSidebar();
        renderActionPanel();

        let result;
        try {
            result = await setup.TurnFlow.submitHumanIntent(input);
        } finally {
            uiState.turnBusy = false;
        }

        if (!result.ok) {
            uiState.locationStatus = result.error.message;
            refreshCurrentPassage();
            return result;
        }

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
        if (uiState.turnBusy) {
            return { ok: false, error: { code: "TURN_IN_FLIGHT", message: "A turn is already being processed." } };
        }
        uiState.turnBusy = true;
        uiState.locationStatus = "Processing queued AI reactions...";
        renderSidebar();
        renderActionPanel();

        let result;
        try {
            result = await setup.TurnFlow.pass();
        } finally {
            uiState.turnBusy = false;
        }
        uiState.turnNarrative = result.narrativeFragments || [];
        uiState.locationStatus = result.ok
            ? `Pass complete. ${result.waveResult.processedCount} AI character(s) reacted.`
            : `AI processing stopped: ${result.error.message}`;
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
        const world = setup.Game.getWorld();
        const uiState = getUIState();
        const actionRoot = document.createElement("section");
        actionRoot.id = "framework-action-panel";
        actionRoot.className = "framework-panel";

        const moveOptions = view.location.exits || [];
        const takeOptions = view.accessible_inventories.flatMap(function (inventory) { return inventory.items; });
        const ownedItems = view.self.inventory || [];
        const consumeItems = view.available_actions.consume ? view.available_actions.consume.options.items || [] : [];
        const fillItems = view.available_actions.fill ? view.available_actions.fill.options.items || [] : [];
        const visibleTargets = view.location.characters || [];
        const giveItemAction = view.available_actions.give_item;
        const reachableTargetIds = giveItemAction ? giveItemAction.options.target_ids : [];
        const reachableTargets = visibleTargets.filter(function (target) { return reachableTargetIds.includes(target.id); });
        const recentEvents = world.events.slice(-12);
        const internalAction = view.available_actions.move_within_location;
        const internalDestinations = internalAction ? internalAction.options.destination_ids.map(function (id) {
            const position = view.location.sublocations.find(function (candidate) { return candidate.id === id; });
            return position ? { id: position.id, name: position.name } : null;
        }).filter(Boolean) : [];
        const placementInventoryIds = view.available_actions.place_item
            ? view.available_actions.place_item.options.target_inventory_ids
            : [];
        const placementInventories = view.accessible_inventories.filter(function (inventory) {
            return placementInventoryIds.includes(inventory.id);
        });
        const knownActionTypes = new Set(["move", "move_within_location", "take_item", "drop_item", "give_item", "give_money", "place_item", "consume", "fill"]);
        const zeroInputExtras = Object.entries(view.available_actions).filter(function (entry) {
            const actionType = entry[0];
            const record = entry[1];
            return !knownActionTypes.has(actionType) && isZeroInputAbilityAction(record);
        });
        const aiSettings = setup.AIRuntimeSettings.getStatus();
        const queue = setup.AITurnScheduler.getQueueView();
        const busy = uiState.turnBusy || setup.AIController.isInFlight() || setup.AITurnScheduler.isWaveInFlight();

        function radioField(actionType, legend, controls, disabled) {
            return `<fieldset class="framework-formal-action${disabled ? " framework-formal-action-disabled" : ""}">
                <legend><label><input type="radio" name="formal-action" value="${escapeHtml(actionType)}"${disabled ? " disabled" : ""}> ${escapeHtml(legend)}</label></legend>
                <div class="formal-action-parameters">${controls || ""}</div>
            </fieldset>`;
        }

        const formalMarkup = [
            radioField("move", "Move", `<select id="action-move-destination">${optionMarkup(moveOptions, "No connected locations")}</select>`, moveOptions.length === 0),
            radioField("move_within_location", "Move within location", `<select id="action-move-within-destination">${optionMarkup(internalDestinations, "No internal destination")}</select>`, internalDestinations.length === 0),
            radioField("take_item", "Take item", `<select id="action-take-item">${optionMarkup(takeOptions, "No items here")}</select>`, takeOptions.length === 0),
            radioField("drop_item", "Drop item", `<select id="action-drop-item">${optionMarkup(ownedItems, "Inventory is empty")}</select>`, ownedItems.length === 0),
            radioField("give_item", "Give item", `<select id="action-give-item">${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-give-item-target">${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, ownedItems.length === 0 || reachableTargets.length === 0),
            radioField("give_money", "Give money", `<input id="action-money-amount" type="number" min="1" step="1" value="1"><select id="action-money-target">${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, reachableTargets.length === 0),
            radioField("place_item", "Place item", `<select id="action-place-item">${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-place-inventory">${optionMarkup(placementInventories, "No accessible surface")}</select>`, ownedItems.length === 0 || placementInventories.length === 0),
            radioField("consume", "Consume item", `<select id="action-consume-item">${optionMarkup(consumeItems, "No consumable items")}</select>`, consumeItems.length === 0),
            radioField("fill", "Fill item", `<select id="action-fill-item">${optionMarkup(fillItems, "No fillable items here")}</select>`, fillItems.length === 0)
        ].concat(zeroInputExtras.map(function (entry) {
            return radioField(entry[0], entry[1].description || entry[0], "<p>No parameters.</p>", false);
        })).join("");

        actionRoot.innerHTML = `
            <h3>Framework controls &mdash; acting as ${escapeHtml(view.self.name)}</h3>
            <div id="framework-action-status" class="framework-status"></div>

            <fieldset class="framework-narrative-action">
                <legend>Narrative / speech</legend>
                <textarea id="action-narrative-text" rows="8" placeholder="Speech outside *asterisks*, actions inside them. Leave empty to act silently."></textarea>
                <div class="framework-narrative-controls">
                    <label>Addressee<select id="action-narrative-target">
                        <option value="">No addressee</option>
                        ${visibleTargets.map(function (target) { return `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`; }).join("")}
                    </select></label>
                    <label>Loudness<select id="action-narrative-noticeability">
                        <option value="noticeable">Normal</option>
                        <option value="hidden">Quiet / private</option>
                    </select></label>
                </div>
            </fieldset>

            <section class="framework-formal-action-section">
                <h4>Formal action &mdash; choose at most one</h4>
                <label class="framework-no-action"><input type="radio" name="formal-action" value="" checked> No formal action</label>
                <div class="framework-action-grid">${formalMarkup}</div>
            </section>

            <div class="framework-turn-controls">
                <button id="action-submit"${busy ? " disabled" : ""}>Submit</button>
                <button id="action-pass"${(busy || (queue.head && !aiSettings.hasKey)) ? " disabled" : ""}>Pass / Next turn</button>
            </div>

            <details class="framework-debug">
                <summary>Framework debug</summary>
                <h4>Character view</h4>
                <pre>${escapeHtml(JSON.stringify(view, null, 2))}</pre>
                <h4>Last action result</h4>
                <pre>${escapeHtml(formatResult(world.debug.lastActionResult))}</pre>
                <h4>Recent confirmed events</h4>
                <pre>${escapeHtml(JSON.stringify(recentEvents, null, 2))}</pre>
                <h4>Controller log</h4>
                <pre>${escapeHtml(JSON.stringify(world.debug.controllerLog.slice(-20), null, 2))}</pre>
            </details>
        `;

        passage.appendChild(actionRoot);

        const selectedTargetId = getUIState().interactionTargetId;
        if (visibleTargets.some(function (target) { return target.id === selectedTargetId; })) {
            $("#action-give-item-target").val(selectedTargetId);
            $("#action-money-target").val(selectedTargetId);
            $("#action-narrative-target").val(selectedTargetId);
        }

        function collectFormalAction() {
            const type = $("input[name='formal-action']:checked").val();
            if (!type) return null;
            if (type === "move") return { type: type, destination_id: $("#action-move-destination").val() };
            if (type === "move_within_location") return { type: type, destination_id: $("#action-move-within-destination").val() };
            if (type === "take_item") return { type: type, item_id: $("#action-take-item").val() };
            if (type === "drop_item") return { type: type, item_id: $("#action-drop-item").val() };
            if (type === "give_item") return { type: type, item_id: $("#action-give-item").val(), target_id: $("#action-give-item-target").val() };
            if (type === "give_money") return { type: type, target_id: $("#action-money-target").val(), amount: Number($("#action-money-amount").val()) };
            if (type === "place_item") return { type: type, item_id: $("#action-place-item").val(), target_inventory_id: $("#action-place-inventory").val() };
            if (type === "consume") return { type: type, item_id: $("#action-consume-item").val() };
            if (type === "fill") return { type: type, item_id: $("#action-fill-item").val() };
            return { type: type };
        }

        $("#action-submit").on("click", async function () {
            const text = $("#action-narrative-text").val();
            const action = collectFormalAction();
            if (!String(text || "").trim() && !action) {
                $("#framework-action-status").text("Enter narrative text, select one formal action, or press Pass.");
                return;
            }
            $(this).prop("disabled", true);
            await runHumanIntent({
                text: text,
                target_id: $("#action-narrative-target").val(),
                noticeability: $("#action-narrative-noticeability").val(),
                action: action
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

            uiState.interactionTargetId = target.id;
            renderLocationView();
            renderActionPanel();
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
