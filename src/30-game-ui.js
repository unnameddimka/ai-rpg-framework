(function () {
    "use strict";

    function optionMarkup(items, emptyLabel) {
        if (!items || items.length === 0) {
            return `<option value="">${emptyLabel}</option>`;
        }

        return items.map(function (item) {
            return `<option value="${item.id}">${item.name}</option>`;
        }).join("");
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
                        return `<option value="${character.id}"${selected}>${character.name}</option>`;
                    }).join("")}
                </select>
                <button id="take-control-button">Take control</button>
            </div>
            <div class="framework-sidebar-block">
                <strong>${actor.name}</strong><br>
                Controller: human<br>
                Location: ${location.name}<br>
                Gold: ${actor.wallet}<br>
                Inventory: ${setup.CharacterAPI.getView(humanId).self.inventory
                    .map(function (item) { return item.name; }).join(", ") || "empty"}
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
            <h3>Framework controls — acting as ${view.self.name}</h3>
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
                            return `<option value="${target.id}">${target.name}</option>`;
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
                <pre>${JSON.stringify(view, null, 2)}</pre>
                <h4>Last action result</h4>
                <pre>${formatResult(world.debug.lastActionResult)}</pre>
                <h4>Recent confirmed events</h4>
                <pre>${JSON.stringify(recentEvents, null, 2)}</pre>
                <h4>Controller log</h4>
                <pre>${JSON.stringify(world.debug.controllerLog.slice(-20), null, 2)}</pre>
            </details>
        `;

        passage.appendChild(actionRoot);

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
                Engine.play(currentPassageForHuman());
            }
            return result;
        },

        goToHumanLocation: function () {
            Engine.play(currentPassageForHuman());
        },

        render: function () {
            renderSidebar();
            renderActionPanel();
        }
    };

    $(document).on(":passagedisplay", function () {
        setup.Game.bootstrap();

        if (!checkPhysicalPassageConsistency()) {
            return;
        }

        renderSidebar();
        renderActionPanel();
    });
}());
