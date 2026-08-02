(function () {
    "use strict";

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
                locationStatus: ""
            };
        }
        return State.variables.frameworkUI;
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

        view.location.description.forEach(function (paragraph) {
            appendTextElement(root, "p", paragraph);
        });
        view.location.characters.forEach(function (character) {
            appendTextElement(root, "p", character.presence_text);
        });

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
                Gold: ${escapeHtml(actor.wallet)}<br>
                Inventory: ${setup.CharacterAPI.getView(humanId).self.inventory
                    .map(function (item) { return escapeHtml(item.name); }).join(", ") || "empty"}
            </div>
            <div class="framework-sidebar-block">
                <button id="validate-world-button">Validate world</button>
                <button id="reset-world-button">Reset world</button>
                <div id="sidebar-status" class="framework-status"></div>
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
    }

    function runAction(action, navigateOnMove) {
        const actorId = setup.Game.getHumanCharacterId();
        const result = setup.CharacterAPI.perform(actorId, action);

        if (!result.ok) {
            $("#framework-action-status").text(result.error.message);
            renderActionPanel();
            return result;
        }

        if (navigateOnMove && action.type === "move") {
            const world = setup.Game.getWorld();
            Engine.play(world.entities[action.destination_id].passage);
            return result;
        }

        refreshCurrentPassage();
        return result;
    }

    function renderActionPanel() {
        const oldRoot = document.getElementById("framework-action-panel");
        if (oldRoot) {
            oldRoot.remove();
        }

        const passage = document.querySelector("#passages .passage");
        if (!passage) {
            return;
        }

        const actorId = setup.Game.getHumanCharacterId();
        const view = setup.CharacterAPI.getView(actorId);
        const world = setup.Game.getWorld();
        const actionRoot = document.createElement("section");
        actionRoot.id = "framework-action-panel";
        actionRoot.className = "framework-panel";

        const moveOptions = view.location.exits;
        const takeOptions = view.location.items;
        const ownedItems = view.self.inventory;
        const targets = view.location.characters;
        const recentEvents = world.events.slice(-12);

        actionRoot.innerHTML = `
            <h3>Framework controls &mdash; acting as ${escapeHtml(view.self.name)}</h3>
            <div id="framework-action-status" class="framework-status"></div>

            <div class="framework-action-grid">
                <fieldset>
                    <legend>Move</legend>
                    <select id="action-move-destination">
                        ${optionMarkup(moveOptions, "No connected locations")}
                    </select>
                    <button id="action-move">Move</button>
                </fieldset>

                <fieldset>
                    <legend>Take item</legend>
                    <select id="action-take-item">
                        ${optionMarkup(takeOptions, "No items here")}
                    </select>
                    <button id="action-take">Take</button>
                </fieldset>

                <fieldset>
                    <legend>Drop item</legend>
                    <select id="action-drop-item">
                        ${optionMarkup(ownedItems, "Inventory is empty")}
                    </select>
                    <button id="action-drop">Drop</button>
                </fieldset>

                <fieldset>
                    <legend>Give item</legend>
                    <select id="action-give-item">
                        ${optionMarkup(ownedItems, "Inventory is empty")}
                    </select>
                    <select id="action-give-item-target">
                        ${optionMarkup(targets, "Nobody nearby")}
                    </select>
                    <button id="action-give-item-button">Give</button>
                </fieldset>

                <fieldset>
                    <legend>Give money</legend>
                    <input id="action-money-amount" type="number" min="1" step="1" value="1">
                    <select id="action-money-target">
                        ${optionMarkup(targets, "Nobody nearby")}
                    </select>
                    <button id="action-give-money">Give</button>
                </fieldset>

                <fieldset>
                    <legend>Speak / narrative action</legend>
                    <textarea id="action-narrative-text" rows="3" placeholder="Speech outside *asterisks*, actions inside them."></textarea>
                    <select id="action-narrative-target">
                        <option value="">No addressee</option>
                        ${targets.map(function (target) {
                            return `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`;
                        }).join("")}
                    </select>
                    <select id="action-narrative-noticeability">
                        <option value="noticeable">Noticeable</option>
                        <option value="hidden">Hidden</option>
                    </select>
                    <button id="action-narrate">Submit</button>
                </fieldset>
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
        if (targets.some(function (target) { return target.id === selectedTargetId; })) {
            $("#action-give-item-target").val(selectedTargetId);
            $("#action-money-target").val(selectedTargetId);
            $("#action-narrative-target").val(selectedTargetId);
        }

        $("#action-move").prop("disabled", moveOptions.length === 0).on("click", function () {
            runAction({
                type: "move",
                destination_id: $("#action-move-destination").val()
            }, true);
        });

        $("#action-take").prop("disabled", takeOptions.length === 0).on("click", function () {
            runAction({
                type: "take_item",
                item_id: $("#action-take-item").val()
            });
        });

        $("#action-drop").prop("disabled", ownedItems.length === 0).on("click", function () {
            runAction({
                type: "drop_item",
                item_id: $("#action-drop-item").val()
            });
        });

        $("#action-give-item-button")
            .prop("disabled", ownedItems.length === 0 || targets.length === 0)
            .on("click", function () {
                runAction({
                    type: "give_item",
                    item_id: $("#action-give-item").val(),
                    target_id: $("#action-give-item-target").val()
                });
            });

        $("#action-give-money").prop("disabled", targets.length === 0).on("click", function () {
            runAction({
                type: "give_money",
                target_id: $("#action-money-target").val(),
                amount: Number($("#action-money-amount").val())
            });
        });

        $("#action-narrate").on("click", function () {
            const result = setup.CharacterAPI.narrate(actorId, {
                text: $("#action-narrative-text").val(),
                target_id: $("#action-narrative-target").val(),
                noticeability: $("#action-narrative-noticeability").val()
            });

            if (!result.ok) {
                $("#framework-action-status").text(result.error.message);
                return;
            }

            refreshCurrentPassage();
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
