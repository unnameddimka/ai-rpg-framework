(function () {
    "use strict";

    let aiSettingsInitialized = false;
    let currentTurnHiddenNarrative = [];
    let historyEntries = [];
    let historyInitialized = false;
    let historyOpen = false;
    let historyPinnedToLatest = true;
    let historyScrollTop = 0;
    let staticNarrationState = { key: "", status: "idle", fragments: [], error: null, requestSerial: 0 };
    let migrationUiInFlight = false;
    let runtimeTurnBusy = false;
    let pendingStarterImport = null;
    let startupWeatherPending = false;
    let startupWeatherRequestSerial = 0;

    const PRODUCT_DISPLAY_NAME = setup.BuildInfo && setup.BuildInfo.productName || "Mallowstead";

    if (typeof document !== "undefined") {
        document.title = PRODUCT_DISPLAY_NAME;
    }

    function isPublicBuild() {
        return !setup.BuildInfo || setup.BuildInfo.profile !== "private";
    }

    function appendPublicDisclosureContent(panel) {
        appendTextElement(panel, "h2", "AI Interaction Disclaimer");
        appendTextElement(panel, "p", "Mallowstead does not contain explicit adult content by default. Its characters are controlled by generative AI, however, and AI-generated responses can be unpredictable. Depending on the model and your interactions, generated content may be mature, offensive, violent, sexual, or otherwise unexpected.");
        appendTextElement(panel, "p", "If you decide to get kinky with the characters — or otherwise take things into adult territory — you should be 18 or older.");
        appendTextElement(panel, "h3", "AI, privacy, and network use");
        appendTextElement(panel, "p", "Mallowstead has no game server of its own. Character memory and game state are stored locally in your browser and can be included in saves, memory exports, and diagnostic exports.");
        appendTextElement(panel, "p", "To generate AI responses, some or all of a character's memory and relevant conversation or world context may be sent to OpenRouter and may be processed by the selected third-party model provider.");
        appendTextElement(panel, "p", "The weather system uses ipwho.is to obtain approximate IP-based location and Open-Meteo to obtain current weather for those approximate coordinates. Mallowstead does not send your save or character memory to those weather services.");
        appendTextElement(panel, "p", "If you share sensitive real-life information with AI characters, it may be included in requests to third-party AI services.");
        appendTextElement(panel, "h3", "Cost and exported data");
        appendTextElement(panel, "p", "Mallowstead itself is free. AI requests use your OpenRouter account and may consume paid credits. Cost depends on the models you select and how much you play; timelapse and memory maintenance can make multiple AI requests.");
        appendTextElement(panel, "p", "Game saves and diagnostic exports may contain character conversations, memories, generated content, and other game state. API keys and authorization headers are excluded from diagnostic exports. Review exported files before sharing them publicly.");
    }

    function publicPrivacySettingsMarkup() {
        if (!isPublicBuild()) return "";
        return `<section class="framework-settings-section"><h3>Privacy &amp; AI</h3>
            <p>Mallowstead has no game server or telemetry service. Game state and character memory are stored locally in your browser.</p>
            <p>AI requests go through OpenRouter and may be processed by the selected third-party model provider. Relevant conversation, memory, and world context may be included.</p>
            <p>Weather uses ipwho.is for approximate IP-based location and Open-Meteo for current weather. Saves and character memory are not sent to those weather services.</p>
            <p>AI requests may consume paid OpenRouter credits. Timelapse and memory maintenance can make multiple requests.</p>
            <p>Saves and diagnostic exports may contain conversations, memories, generated content, and other game state. API keys and authorization headers are excluded from diagnostic exports; review exports before sharing them.</p>
        </section>`;
    }

    function itemDisplayName(item) {
        return item && (item.display_name || item.name || item.id) || "";
    }

    function optionMarkup(items, emptyLabel) {
        if (!items || items.length === 0) {
            return `<option value="">${escapeHtml(emptyLabel)}</option>`;
        }

        return items.map(function (item) {
            return `<option value="${escapeHtml(item.id)}">${escapeHtml(itemDisplayName(item))}</option>`;
        }).join("");
    }

    function itemActionOptionMarkup(items, emptyLabel) {
        if (!items || items.length === 0) {
            return `<option value="">${escapeHtml(emptyLabel)}</option>`;
        }
        return items.map(function (item) {
            const label = item.action_label || itemDisplayName(item) || item.id;
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

    function cloneUIValue(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function normalizeHistoryEntry(entry) {
        if (!entry || typeof entry !== "object" || typeof entry.text !== "string" || !entry.text.trim()) return null;
        return {
            text: entry.text,
            visibleToHuman: entry.visibleToHuman !== false,
            actorId: entry.actorId || null,
            actorName: entry.actorName || "",
            locationId: entry.locationId || null,
            locationName: entry.locationName || "",
            kind: entry.kind || "event"
        };
    }

    function syncHistoryMirror(uiState) {
        if (!uiState) return;
        uiState.history = historyEntries.slice(-100).map(normalizeHistoryEntry).filter(Boolean);
    }

    function initializeHistory(uiState) {
        if (historyInitialized) return;
        historyEntries = (Array.isArray(uiState.history) ? uiState.history : [])
            .map(normalizeHistoryEntry)
            .filter(Boolean);
        historyInitialized = true;
        syncHistoryMirror(uiState);
    }

    function appendHistory(entries) {
        const uiState = getUIState();
        (Array.isArray(entries) ? entries : []).forEach(function (entry) {
            const normalized = normalizeHistoryEntry(entry);
            if (normalized) historyEntries.push(normalized);
        });
        syncHistoryMirror(uiState);
    }

    function resetHistory() {
        historyEntries = [];
        historyInitialized = true;
        if (State.variables.frameworkUI) State.variables.frameworkUI.history = [];
    }

    function savedHistoryEntries(save) {
        const state = save && save.state;
        if (!state || !Array.isArray(state.history) || state.history.length === 0) return [];
        const index = Number.isInteger(state.index) ? state.index : state.history.length - 1;
        const moment = state.history[index] || state.history[state.history.length - 1];
        const uiState = moment && moment.variables && moment.variables.frameworkUI;
        return (uiState && Array.isArray(uiState.history) ? uiState.history : [])
            .map(normalizeHistoryEntry)
            .filter(Boolean)
            .slice(-100);
    }

    function prepareHistorySave(save) {
        const state = save && save.state;
        if (!state || !Array.isArray(state.history) || state.history.length === 0) return;
        const activeIndex = Number.isInteger(state.index) ? state.index : state.history.length - 1;
        const mirror = historyEntries.slice(-100).map(normalizeHistoryEntry).filter(Boolean);
        state.history.forEach(function (moment, index) {
            if (!moment || !moment.variables) return;
            if (!moment.variables.frameworkUI) {
                if (index !== activeIndex) return;
                moment.variables.frameworkUI = {};
            }
            moment.variables.frameworkUI.history = index === activeIndex ? cloneUIValue(mirror) : [];
            delete moment.variables.frameworkUI.turnBusy;
        });
    }

    function restoreHistoryFromSave(save) {
        runtimeTurnBusy = false;
        historyEntries = savedHistoryEntries(save);
        historyInitialized = true;
        resetStaticNarration("");
        currentTurnHiddenNarrative = [];
        if (State.variables.frameworkUI) {
            delete State.variables.frameworkUI.turnBusy;
            State.variables.frameworkUI.narratedTurnNarrative = [];
            State.variables.frameworkUI.dynamicNarrationValid = false;
        }
    }

    function registerSaveHistoryHooks() {
        if (typeof Save === "undefined") return;
        if (Save.onSave && typeof Save.onSave.add === "function") Save.onSave.add(prepareHistorySave);
        if (Save.onLoad && typeof Save.onLoad.add === "function") Save.onLoad.add(restoreHistoryFromSave);
    }

    function getUIState() {
        if (!State.variables.frameworkUI) {
            State.variables.frameworkUI = {
                interactionTargetId: "",
                narrativeNoticeability: "noticeable",
                selectedAction: null,
                locationStatus: "",
                turnNarrative: [],
                rawTurnNarrative: [],
                narratedTurnNarrative: [],
                dynamicNarrationValid: false,
                abilityResultsByActor: {},
                history: []
            };
        }
        if (!State.variables.frameworkUI.abilityResultsByActor) {
            State.variables.frameworkUI.abilityResultsByActor = {};
        }
        if (!Array.isArray(State.variables.frameworkUI.turnNarrative)) {
            State.variables.frameworkUI.turnNarrative = [];
        }
        if (!Array.isArray(State.variables.frameworkUI.rawTurnNarrative)) {
            State.variables.frameworkUI.rawTurnNarrative = cloneUIValue(State.variables.frameworkUI.turnNarrative);
        }
        if (!Array.isArray(State.variables.frameworkUI.narratedTurnNarrative)) {
            State.variables.frameworkUI.narratedTurnNarrative = [];
        }
        State.variables.frameworkUI.dynamicNarrationValid = Boolean(State.variables.frameworkUI.dynamicNarrationValid);
        if (!Array.isArray(State.variables.frameworkUI.history)) {
            State.variables.frameworkUI.history = [];
        }
        initializeHistory(State.variables.frameworkUI);
        if (!State.variables.frameworkUI.selectedAction || typeof State.variables.frameworkUI.selectedAction !== "object") {
            State.variables.frameworkUI.selectedAction = null;
        }
        State.variables.frameworkUI.interactionTargetId = String(State.variables.frameworkUI.interactionTargetId || "");
        State.variables.frameworkUI.narrativeNoticeability = ["hidden", "shout"].includes(State.variables.frameworkUI.narrativeNoticeability)
            ? State.variables.frameworkUI.narrativeNoticeability
            : "noticeable";
        delete State.variables.frameworkUI.turnBusy;
        return State.variables.frameworkUI;
    }

    function getBusyState() {
        getUIState();
        const controllerBusy = Boolean(setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight());
        const executorStatus = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus
            ? setup.AIRequestExecutor.getStatus()
            : { busy: false, activePurpose: null };
        const executorBusy = Boolean(executorStatus && (executorStatus.blockingBusy !== undefined
            ? executorStatus.blockingBusy
            : executorStatus.busy));
        const waveBusy = Boolean(setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight());
        const migrationBusy = Boolean(setup.SaveMigration && setup.SaveMigration.isInFlight && setup.SaveMigration.isInFlight());
        const aiBusy = controllerBusy || executorBusy || waveBusy;
        const busy = runtimeTurnBusy || aiBusy || migrationBusy || migrationUiInFlight;
        return { busy: busy, aiBusy: aiBusy, text: busy ? "Thinking..." : "" };
    }

    function actionKey(action) {
        return action ? JSON.stringify(action) : "";
    }

    function findViewItem(view, itemId) {
        const owned = view && view.self && Array.isArray(view.self.inventory) ? view.self.inventory : [];
        const equipped = view && view.self && Array.isArray(view.self.equipped_items) ? view.self.equipped_items : [];
        const accessible = view && Array.isArray(view.accessible_inventories)
            ? view.accessible_inventories.flatMap(function (inventory) { return inventory.items || []; })
            : [];
        return owned.concat(equipped, accessible).find(function (item) { return item.id === itemId; }) || null;
    }

    function useItemOption(view, itemId) {
        const action = view && view.available_actions && view.available_actions.use_item;
        const items = action && action.options && Array.isArray(action.options.items) ? action.options.items : [];
        return items.find(function (candidate) { return candidate.id === itemId; }) || null;
    }

    function syncUseItemInputUI(view, selectedAction) {
        const wrapper = document.getElementById("action-use-item-input-wrap");
        const input = document.getElementById("action-use-item-input");
        const label = document.getElementById("action-use-item-input-label");
        if (!wrapper || !input || !label) return;
        const selectedItemId = selectedAction && selectedAction.type === "use_item"
            ? selectedAction.item_id
            : (document.getElementById("action-use-item") && document.getElementById("action-use-item").value || "");
        const option = useItemOption(view, selectedItemId);
        const required = Boolean(option && option.input_required);
        wrapper.hidden = !required;
        input.disabled = !required || getBusyState().busy;
        label.textContent = required ? (option.input_label || "Input") : "Input";
        input.placeholder = required ? (option.input_placeholder || "") : "";
        input.maxLength = required && Number.isInteger(option.input_max_length) ? option.input_max_length : 600;
        if (required && selectedAction && selectedAction.type === "use_item" && typeof selectedAction.input_text === "string") {
            input.value = selectedAction.input_text;
        } else if (!required) {
            input.value = "";
        }
    }

    function moveWithinActionLabel(destination, view) {
        if (!destination) return "Move within location";
        const currentId = view && view.self && view.self.sublocation_id;
        const current = currentId && view.location.sublocations.find(function (candidate) { return candidate.id === currentId; });
        const destinationEnter = String(destination.enter_label || "");
        const destinationName = String(destination.name || "");
        const returningToGenericInterior = /^(step|go|move)\s+(inside|into)\b/i.test(destinationEnter) || /\b(interior|room interior|floor)\b/i.test(destinationName);
        if (current && current.id !== destination.id && returningToGenericInterior) {
            const sourceText = `${current.name || ""} ${current.enter_label || ""} ${view.self.position_text || ""}`.toLowerCase();
            if (/\bbed\b|\blie\b|\blying\b/.test(sourceText)) return "Get up";
            if (/\btable\b|\bchair\b|\bbench\b|\bsit\b|\bsitting\b|\bseated\b/.test(sourceText)) return "Stand up";
            return "Return to the room";
        }
        return destination.enter_label || `Move to ${destination.name}`;
    }

    function doorActionLabel(verb, destination, destinationId) {
        return `${verb} the door to ${destination ? destination.name : destinationId}`;
    }

    function actionLabel(action, view) {
        if (!action || !action.type) return "None";
        const item = action.item_id ? findViewItem(view, action.item_id) : null;
        const target = action.target_id && view.location.characters.find(function (candidate) { return candidate.id === action.target_id; });
        const destination = action.destination_id && view.location.exits.find(function (candidate) { return candidate.id === action.destination_id; });
        const position = action.destination_id && view.location.sublocations.find(function (candidate) { return candidate.id === action.destination_id; });
        const inventory = action.target_inventory_id && view.accessible_inventories.find(function (candidate) { return candidate.id === action.target_inventory_id; });
        if (action.type === "move") return `Go to ${destination ? destination.name : action.destination_id}`;
        if (action.type === "unlock") return doorActionLabel("Unlock", destination, action.destination_id);
        if (action.type === "lock") return doorActionLabel("Lock", destination, action.destination_id);
        if (action.type === "move_within_location") return position ? moveWithinActionLabel(position, view) : `Move to ${action.destination_id}`;
        if (action.type === "take_item") return `Take ${item ? itemDisplayName(item) : action.item_id}`;
        if (action.type === "drop_item") return `Drop ${item ? itemDisplayName(item) : action.item_id}`;
        if (action.type === "give_item") return `Give ${item ? itemDisplayName(item) : action.item_id} to ${target ? target.name : action.target_id}`;
        if (action.type === "equip") return `Equip ${item ? itemDisplayName(item) : action.item_id} (${action.slot})`;
        if (action.type === "unequip") return `Unequip ${item ? itemDisplayName(item) : action.item_id}`;
        if (action.type === "give_money") return `Give ${action.amount} gold to ${target ? target.name : action.target_id}`;
        if (action.type === "show_hidden_location") {
            const location = (view.location.exits || []).find(function (candidate) { return candidate.id === action.location_id; });
            return `Show ${location ? location.name : action.location_id} to ${target ? target.name : action.target_id}`;
        }
        if (action.type === "transfer_items") {
            const route = view.available_actions.transfer_items && (view.available_actions.transfer_items.options.routes || []).find(function (candidate) {
                return candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
            });
            return `${route ? route.label : "Transfer items"} (${(action.item_ids || []).length})`;
        }
        if (action.type === "read_paper") return `Read ${item ? itemDisplayName(item) : action.item_id}`;
        if (action.type === "write_paper") return `Write / draw on ${item ? itemDisplayName(item) : action.item_id}`;
        if (action.type === "place_item") return `Place ${item ? itemDisplayName(item) : action.item_id} on ${inventory ? inventory.name : action.target_inventory_id}`;
        if (action.type === "fill" || action.type === "consume" || action.type === "use_item") {
            const options = view.available_actions[action.type] && view.available_actions[action.type].options && view.available_actions[action.type].options.items || [];
            const option = options.find(function (candidate) { return candidate.id === action.item_id; });
            const fallbackVerb = action.type === "fill" ? "Fill" : (action.type === "consume" ? "Consume" : "Use");
            return option && option.action_label || `${fallbackVerb} ${item ? itemDisplayName(item) : action.item_id}`;
        }
        const ability = view.self.abilities.find(function (candidate) { return candidate.actionType === action.type; });
        const record = view.available_actions[action.type];
        return ability && ability.name || record && record.description || action.type;
    }

    function actionAvailableInView(action, view) {
        if (!action || !action.type || !view.available_actions[action.type]) return false;
        const options = view.available_actions[action.type].options || {};
        if (action.type === "move") return (options.destination_ids || []).includes(action.destination_id);
        if (action.type === "unlock" || action.type === "lock") return (options.destination_ids || []).includes(action.destination_id);
        if (action.type === "move_within_location") return (options.destination_ids || []).includes(action.destination_id);
        if (action.type === "take_item") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "drop_item") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "give_item") return (options.item_ids || []).includes(action.item_id) && (options.target_ids || []).includes(action.target_id);
        if (action.type === "equip") {
            const itemOption = (options.items || []).find(function (candidate) { return candidate.id === action.item_id; });
            return Boolean(itemOption && (itemOption.slots || []).includes(action.slot));
        }
        if (action.type === "unequip") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "give_money") return (options.target_ids || []).includes(action.target_id) && Number.isFinite(Number(action.amount)) && Number(action.amount) > 0 && Number(action.amount) <= Number(options.maximum_amount || 0);
        if (action.type === "show_hidden_location") {
            const location = (options.locations || []).find(function (candidate) { return candidate.id === action.location_id; });
            return Boolean(location && (location.target_ids || []).includes(action.target_id));
        }
        if (action.type === "transfer_items") {
            if (!Array.isArray(action.item_ids) || action.item_ids.length === 0 || new Set(action.item_ids).size !== action.item_ids.length) return false;
            const route = (options.routes || []).find(function (candidate) {
                return candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
            });
            return Boolean(route && action.item_ids.every(function (itemId) { return (route.item_ids || []).includes(itemId); }));
        }
        if (action.type === "read_paper") return (options.item_ids || []).includes(action.item_id);
        if (action.type === "write_paper") return (options.item_ids || []).includes(action.item_id) && typeof action.content === "string" && action.content.length <= 12000;
        if (action.type === "place_item") return (options.item_ids || []).includes(action.item_id) && (options.target_inventory_ids || []).includes(action.target_inventory_id);
        if (action.type === "fill" || action.type === "consume" || action.type === "use_item") return (options.item_ids || []).includes(action.item_id);
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

    function speechTargetsForView(view, action) {
        const targets = [];
        const seen = new Set();
        (view.location.characters || []).forEach(function (target) {
            if (!seen.has(target.id)) { seen.add(target.id); targets.push(target); }
        });
        if (action && action.type === "move" && action.destination_id) {
            const move = view.available_actions && view.available_actions.move;
            const byDestination = move && move.options && move.options.speech_targets_by_destination || {};
            (byDestination[action.destination_id] || []).forEach(function (target) {
                if (!seen.has(target.id)) { seen.add(target.id); targets.push(target); }
            });
        }
        return targets;
    }

    function setInteractionTarget(targetId, view) {
        const uiState = getUIState();
        if (uiState.narrativeNoticeability === "shout") targetId = "";
        const target = speechTargetsForView(view, selectedActionForView(view)).find(function (candidate) { return candidate.id === targetId; });
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
        uiState.narrativeNoticeability = ["hidden", "shout"].includes(uiState.narrativeNoticeability) ? uiState.narrativeNoticeability : "noticeable";
        const action = uiState.selectedAction;
        if (action && action.type === "move" && uiState.narrativeNoticeability === "shout") uiState.narrativeNoticeability = "noticeable";
        const targets = speechTargetsForView(view, action);
        if (uiState.narrativeNoticeability === "shout" || !targets.some(function (target) { return target.id === uiState.interactionTargetId; })) {
            uiState.interactionTargetId = "";
        }
        return uiState;
    }

    function syncSpeechControlsUI(view, action) {
        const uiState = reconcileConversationState(view, getUIState());
        const targetSelect = document.getElementById("action-narrative-target");
        const loudnessSelect = document.getElementById("action-narrative-noticeability");
        const moveSelected = Boolean(action && action.type === "move");
        if (loudnessSelect) {
            const shoutOption = Array.from(loudnessSelect.options).find(function (option) { return option.value === "shout"; });
            if (shoutOption) shoutOption.disabled = moveSelected;
            loudnessSelect.value = uiState.narrativeNoticeability;
        }
        if (targetSelect) {
            targetSelect.replaceChildren();
            const none = document.createElement("option"); none.value = ""; none.textContent = "No addressee"; targetSelect.appendChild(none);
            speechTargetsForView(view, action).forEach(function (target) {
                const option = document.createElement("option"); option.value = target.id; option.textContent = target.name; targetSelect.appendChild(option);
            });
            targetSelect.value = uiState.interactionTargetId;
            targetSelect.disabled = getBusyState().busy || uiState.narrativeNoticeability === "shout";
        }
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
        syncUseItemInputUI(view, selected);
        syncSpeechControlsUI(view, selected);
        if (!selected) return;
        if (selected.type === "move") setControlValue("action-move-destination", selected.destination_id);
        if (selected.type === "unlock") setControlValue("action-unlock-destination", selected.destination_id);
        if (selected.type === "lock") setControlValue("action-lock-destination", selected.destination_id);
        if (selected.type === "move_within_location") setControlValue("action-move-within-destination", selected.destination_id);
        if (selected.type === "take_item") setControlValue("action-take-item", selected.item_id);
        if (selected.type === "drop_item") setControlValue("action-drop-item", selected.item_id);
        if (selected.type === "give_item") {
            setControlValue("action-give-item", selected.item_id);
            setControlValue("action-give-item-target", selected.target_id);
        }
        if (selected.type === "equip") {
            setControlValue("action-equip-item", selected.item_id);
            syncEquipSlotSelect(view, selected.item_id, selected.slot);
        }
        if (selected.type === "unequip") setControlValue("action-unequip-item", selected.item_id);
        if (selected.type === "give_money") {
            setControlValue("action-money-amount", selected.amount);
            setControlValue("action-money-target", selected.target_id);
        }
        if (selected.type === "read_paper") setControlValue("action-read-paper", selected.item_id);
        if (selected.type === "write_paper") {
            setControlValue("action-write-paper", selected.item_id);
            setControlValue("action-write-paper-content", selected.content || "");
        }
        if (selected.type === "place_item") {
            setControlValue("action-place-item", selected.item_id);
            setControlValue("action-place-inventory", selected.target_inventory_id);
        }
        if (selected.type === "fill") setControlValue("action-fill-item", selected.item_id);
        if (selected.type === "consume") setControlValue("action-consume-item", selected.item_id);
        if (selected.type === "use_item") {
            setControlValue("action-use-item", selected.item_id);
            syncUseItemInputUI(view, selected);
        }
    }

    function buildContextualActionGroups(view) {
        const groups = { characters: [], here: [], travel: [] };
        (view.location.characters || []).forEach(function (character) {
            groups.characters.push({ kind: "character", label: `Talk to ${character.name}`, characterId: character.id });
        });

        const internalAction = view.available_actions.move_within_location;
        (internalAction && internalAction.options.destination_ids || []).forEach(function (destinationId) {
            const destination = view.location.sublocations.find(function (candidate) { return candidate.id === destinationId; });
            if (destination) groups.here.push({ kind: "action", label: moveWithinActionLabel(destination, view), action: { type: "move_within_location", destination_id: destination.id } });
        });

        const takeAction = view.available_actions.take_item;
        const takeIds = takeAction && takeAction.options.item_ids || [];
        const seenTake = new Set();
        (view.accessible_inventories || []).forEach(function (inventory) {
            (inventory.items || []).forEach(function (item) {
                if (takeIds.includes(item.id) && !seenTake.has(item.id)) {
                    seenTake.add(item.id);
                    groups.here.push({ kind: "action", label: `Take ${itemDisplayName(item)}`, action: { type: "take_item", item_id: item.id } });
                }
            });
        });

        const dropAction = view.available_actions.drop_item;
        const dropIds = dropAction && dropAction.options.item_ids || [];
        const dropChildren = (view.self.inventory || []).filter(function (item) { return dropIds.includes(item.id); }).map(function (item) {
            return { kind: "action", label: itemDisplayName(item), action: { type: "drop_item", item_id: item.id } };
        });
        if (dropChildren.length) groups.here.push({ kind: "action-group", label: "Drop item ▸", title: "Drop item", children: dropChildren });

        const placeAction = view.available_actions.place_item;
        const placeIds = placeAction && placeAction.options.item_ids || [];
        const targetIds = placeAction && placeAction.options.target_inventory_ids || [];
        targetIds.forEach(function (inventoryId) {
            const inventory = view.accessible_inventories.find(function (candidate) { return candidate.id === inventoryId; });
            if (!inventory) return;
            const children = (view.self.inventory || []).filter(function (item) { return placeIds.includes(item.id); }).map(function (item) {
                return { kind: "action", label: itemDisplayName(item), action: { type: "place_item", item_id: item.id, target_inventory_id: inventory.id } };
            });
            if (children.length) groups.here.push({ kind: "action-group", label: `Put item on/in ${inventory.name} ▸`, title: `Put item on/in ${inventory.name}`, children: children });
        });

        const bulkAction = view.available_actions.transfer_items;
        if (bulkAction && (bulkAction.options.routes || []).length > 0) groups.here.push({ kind: "bulk-transfer", label: "Transfer items…" });

        const giveMoneyAction = view.available_actions.give_money;
        const giveGoldTargetIds = giveMoneyAction && giveMoneyAction.options && giveMoneyAction.options.target_ids || [];
        const giveGoldTargets = (view.location.characters || []).filter(function (character) { return giveGoldTargetIds.includes(character.id); });
        const giveGoldMaximum = Number(giveMoneyAction && giveMoneyAction.options && giveMoneyAction.options.maximum_amount || 0);
        if (giveGoldMaximum >= 1 && giveGoldTargets.length > 0) {
            groups.here.push({ kind: "give-gold", label: "Give gold", targets: giveGoldTargets, maximumAmount: giveGoldMaximum });
        }

        const useChildren = [];
        const readPaperAction = view.available_actions.read_paper;
        (readPaperAction && readPaperAction.options.item_ids || []).forEach(function (itemId) {
            const paper = findViewItem(view, itemId);
            useChildren.push({ kind: "action", label: `Read ${paper ? itemDisplayName(paper) : "paper"}`, action: { type: "read_paper", item_id: itemId } });
        });
        const writePaperAction = view.available_actions.write_paper;
        (writePaperAction && writePaperAction.options.item_ids || []).forEach(function (itemId) {
            const paper = findViewItem(view, itemId);
            useChildren.push({ kind: "write-paper", label: `Write / draw on ${paper ? itemDisplayName(paper) : "paper"}`, itemId: itemId });
        });
        ["fill", "consume", "use_item"].forEach(function (actionType) {
            const record = view.available_actions[actionType];
            (record && record.options.items || []).forEach(function (item) {
                const child = { kind: "action", label: item.action_label || record.description, action: { type: actionType, item_id: item.id } };
                if (actionType === "use_item" && item.input_required) child.kind = "use-item-input";
                useChildren.push(child);
            });
        });
        if (useChildren.length) groups.here.push({ kind: "action-group", label: "Use item ▸", title: "Use item", children: useChildren });

        if (view.available_actions.go_hunting) groups.here.push({ kind: "action", label: "Go hunting", action: { type: "go_hunting" } });
        if (view.available_actions.sleep) groups.here.push({ kind: "action", label: view.self.controller_id === "human" ? "Sleep till morning" : "Sleep", action: { type: "sleep" } });
        discoverAvailableAbilities(view).forEach(function (ability) { groups.here.push({ kind: "action", label: ability.name, action: { type: ability.actionType } }); });

        const moveAction = view.available_actions.move;
        const moveIds = moveAction && moveAction.options.destination_ids || [];
        const unlockAction = view.available_actions.unlock;
        const unlockIds = unlockAction && unlockAction.options.destination_ids || [];
        const lockAction = view.available_actions.lock;
        const lockIds = lockAction && lockAction.options.destination_ids || [];
        (view.location.exits || []).forEach(function (destination) {
            if (moveIds.includes(destination.id)) groups.travel.push({ kind: "action", label: `Go to ${destination.name}`, action: { type: "move", destination_id: destination.id } });
            if (unlockIds.includes(destination.id)) groups.travel.push({ kind: "action", label: doorActionLabel("Unlock", destination, destination.id), action: { type: "unlock", destination_id: destination.id } });
            if (lockIds.includes(destination.id)) groups.travel.push({ kind: "action", label: doorActionLabel("Lock", destination, destination.id), action: { type: "lock", destination_id: destination.id } });
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
                if (entry.code === "PAPER_CONTENT") return `<pre class="framework-paper-content-view">${escapeHtml(entry.text)}</pre>`;
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

    function inlineRPMarkup(value) {
        const source = String(value === undefined || value === null ? "" : value);
        const pattern = /\*([^*]+)\*/g;
        let output = "";
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            output += escapeHtml(source.slice(lastIndex, match.index));
            output += `<em class="framework-inline-narration">${escapeHtml(match[1])}</em>`;
            lastIndex = match.index + match[0].length;
        }
        output += escapeHtml(source.slice(lastIndex));
        return output;
    }

    function appendRPElement(parent, tagName, value, className) {
        const element = document.createElement(tagName);
        element.innerHTML = inlineRPMarkup(value);
        if (className) element.className = className;
        parent.appendChild(element);
        return element;
    }

    function isNarratorEnabled() {
        return Boolean(setup.NarratorService && setup.NarratorService.isEnabled && setup.NarratorService.isEnabled());
    }

    function staticNarrationKey(view) {
        return view && view.self && view.location ? `${view.self.id}|${view.location.id}` : "";
    }

    function resetStaticNarration(key) {
        staticNarrationState = {
            key: key || "",
            status: "idle",
            fragments: [],
            error: null,
            requestSerial: (staticNarrationState.requestSerial || 0) + 1
        };
    }

    function rawStaticFragments(view) {
        const fragments = [];
        (view && view.location && view.location.description || []).forEach(function (paragraph) {
            if (paragraph) fragments.push(String(paragraph));
        });
        (view && view.location && view.location.sublocations || []).forEach(function (sublocation) {
            if (sublocation && sublocation.public_text) fragments.push(String(sublocation.public_text));
        });
        return fragments;
    }

    function rawDynamicFragments(view) {
        const fragments = [];
        if (view && view.self && view.self.position_text) fragments.push(String(view.self.position_text));
        (view && view.location && view.location.characters || []).forEach(function (character) {
            const text = [character && character.presence_text, character && character.position_text].filter(Boolean).join(" ");
            if (text) fragments.push(text);
        });
        return fragments;
    }

    function currentTurnPresentation(uiState) {
        const narrationValid = isNarratorEnabled() && Boolean(uiState.dynamicNarrationValid);
        const narrated = narrationValid && Array.isArray(uiState.narratedTurnNarrative) ? uiState.narratedTurnNarrative : [];
        if (narrationValid) return { fragments: narrated, narrated: true };
        const raw = Array.isArray(uiState.rawTurnNarrative) && uiState.rawTurnNarrative.length ? uiState.rawTurnNarrative : uiState.turnNarrative || [];
        return { fragments: raw, narrated: false };
    }

    function ensureStaticNarration(view) {
        if (!view || !view.location || !view.self || !setup.NarratorService) return;
        getUIState();
        if (getBusyState().busy) return;
        const queueStatus = setup.AITurnQueue && setup.AITurnQueue.getStatus ? setup.AITurnQueue.getStatus() : null;
        if (queueStatus && queueStatus.count > 0) return;
        const key = staticNarrationKey(view);
        if (staticNarrationState.key !== key) resetStaticNarration(key);
        if (!isNarratorEnabled() || staticNarrationState.status !== "idle") return;
        const serial = staticNarrationState.requestSerial;
        staticNarrationState.status = "pending";
        setup.NarratorService.describeLocation(view).then(function (result) {
            if (staticNarrationState.key !== key || staticNarrationState.requestSerial !== serial) return;
            if (result && result.ok && result.value && Array.isArray(result.value.fragments) && result.value.fragments.length) {
                staticNarrationState.status = "ready";
                staticNarrationState.fragments = cloneUIValue(result.value.fragments);
                staticNarrationState.error = null;
            } else {
                staticNarrationState.status = "failed";
                staticNarrationState.fragments = [];
                staticNarrationState.error = cloneUIValue(result && result.error || null);
            }
            renderSidebar(); renderLocationView(); renderActionPanel();
        }).catch(function () {
            if (staticNarrationState.key !== key || staticNarrationState.requestSerial !== serial) return;
            staticNarrationState.status = "failed";
            staticNarrationState.fragments = [];
            staticNarrationState.error = { code: "NARRATOR_REQUEST_FAILED", message: "Narrator request failed." };
            renderSidebar(); renderLocationView(); renderActionPanel();
        });
    }

    function renderStaticScene(root, view) {
        const key = staticNarrationKey(view);
        ensureStaticNarration(view);
        const narrated = isNarratorEnabled() && staticNarrationState.key === key && staticNarrationState.status === "ready"
            ? staticNarrationState.fragments : [];
        const fragments = narrated.length ? narrated : rawStaticFragments(view);
        if (!fragments.length && !(view && view.self && view.self.position_text)) return;
        const section = document.createElement("section");
        section.className = narrated.length ? "framework-presentation-block framework-narrated-static"
            : "framework-presentation-block framework-raw-presentation framework-raw-static";
        fragments.forEach(function (fragment) { appendRPElement(section, "p", fragment); });
        if (view && view.self && view.self.position_text) appendTextElement(section, "p", view.self.position_text, "framework-position-text");
        root.appendChild(section);
    }

    function renderCharacterScene(root, view) {
        const characters = view && view.location && view.location.characters || [];
        if (!characters.length) return;
        const section = document.createElement("section");
        section.className = "framework-presentation-block framework-character-scene";
        characters.forEach(function (character) {
            const text = [character.presence_text, character.position_text].filter(Boolean).join(" ");
            if (text) appendTextElement(section, "p", text);
        });
        if (section.childNodes.length) root.appendChild(section);
    }

    function renderDynamicItems(root, view) {
        const seen = new Set();
        const rows = [];
        function add(item, inventoryName) {
            if (!item || seen.has(item.id)) return;
            seen.add(item.id);
            const description = String(item.description || "").trim();
            rows.push((inventoryName ? `${inventoryName}: ` : "") + itemDisplayName(item) + (description ? ` — ${description}` : ""));
        }
        (view && view.location && view.location.items || []).forEach(function (item) { add(item, ""); });
        (view && view.accessible_inventories || []).forEach(function (inventory) {
            if (!inventory || inventory.owner_id === view.location.id) return;
            (inventory.items || []).forEach(function (item) { add(item, inventory.name || ""); });
        });
        if (!rows.length) return;
        const section = document.createElement("section");
        section.className = "framework-presentation-block framework-dynamic-items";
        rows.forEach(function (row) { appendTextElement(section, "p", row); });
        root.appendChild(section);
    }

    function appendElsewhereEntry(parent, entry) {
        if (!entry || !entry.text) return;
        const row = document.createElement("div");
        row.className = "framework-elsewhere-event";
        const context = [entry.actorName, entry.locationName].filter(Boolean).join(" · ");
        appendTextElement(row, "strong", `Elsewhere${context ? ` — ${context}` : ""}`);
        appendRPElement(row, "p", entry.text);
        parent.appendChild(row);
    }

    function renderCurrentTurn(root, presentation) {
        const fragments = presentation && Array.isArray(presentation.fragments) ? presentation.fragments : [];
        if (!fragments.length && currentTurnHiddenNarrative.length === 0) return;
        const section = document.createElement("section");
        section.className = "framework-presentation-block framework-turn-narrative" + (presentation.narrated ? " framework-narrated-dynamic" : " framework-raw-presentation");
        fragments.forEach(function (fragment) { appendRPElement(section, "p", fragment); });
        currentTurnHiddenNarrative.forEach(function (entry) { appendElsewhereEntry(section, entry); });
        root.appendChild(section);
    }

    function renderBusyIndicator(root, busyState) {
        if (!busyState || !busyState.busy || document.getElementById("framework-timelapse-overlay")) return;
        const row = document.createElement("div");
        row.className = "framework-busy-row";
        row.setAttribute("aria-live", "polite");
        const spinner = document.createElement("span");
        spinner.className = "framework-spinner is-visible";
        spinner.setAttribute("aria-hidden", "true");
        row.appendChild(spinner);
        appendTextElement(row, "span", "Thinking...", "framework-busy-text");
        root.appendChild(row);
    }

    function renderLegacyLatestTurn(root, fragments) {
        const hasVisible = Array.isArray(fragments) && fragments.length > 0;
        if (!hasVisible && currentTurnHiddenNarrative.length === 0) return;
        const narrative = document.createElement("section");
        narrative.className = "framework-turn-narrative";
        appendTextElement(narrative, "h3", "Latest turn");
        (fragments || []).forEach(function (fragment) { appendRPElement(narrative, "p", fragment); });
        currentTurnHiddenNarrative.forEach(function (entry) { appendElsewhereEntry(narrative, entry); });
        root.appendChild(narrative);
    }

    function renderInteractionView() {
        // Character shortcuts select the turn-panel addressee without opening a second panel.
    }

    function promptLabJson(value, emptyText) { return setup.DebugUIFormatters.promptLabJson(value, emptyText); }
    function promptLabTraceMarkup(run) { return setup.DebugUIFormatters.promptLabTraceMarkup(run); }

    function promptLabNarrativeHistoryMarkup(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return `<p class="prompt-lab-narrative-empty">No live AI narrative has been recorded yet.</p>`;
        }
        return entries.map(function (entry, index) {
            const fragments = Array.isArray(entry.fragments) ? entry.fragments : [];
            const body = fragments.length
                ? fragments.map(function (fragment) { return `<p>${inlineRPMarkup(fragment)}</p>`; }).join("")
                : `<p class="prompt-lab-narrative-empty">No public narrative or formal-action event was produced.</p>`;
            return `<article class="prompt-lab-narrative-entry">
                <h5>${escapeHtml(index + 1)}. ${escapeHtml(entry.actorName || entry.actorId || "Unknown character")}</h5>
                ${body}
            </article>`;
        }).join("");
    }

    function promptLabQueueMarkup(snapshot, hasKey) { return setup.DebugUIFormatters.promptLabQueueMarkup(snapshot, hasKey); }

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
            runtimeTurnBusy = true;
            showImmediateStatus(`The crystal sphere is dry-running the queued request for ${characterId}...`);
            redraw();
            try {
                const pending = setup.PromptLab.testQueued(characterId);
                redraw();
                await pending;
            } finally {
                runtimeTurnBusy = false;
            }
            redraw();
        });

        $(".prompt-lab-process-live").on("click", async function () {
            const uiState = getUIState();
            if (getBusyState().busy) return;
            runtimeTurnBusy = true;
            showImmediateStatus("The crystal sphere is processing the next scheduler entry live...");
            redraw();
            try {
                const pending = setup.PromptLab.processNextLive();
                redraw();
                await pending;
            } finally {
                runtimeTurnBusy = false;
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

    function appendPresentationEntry(parent, entry) {
        if (!entry || !entry.text) return;
        if (entry.visibleToHuman) appendRPElement(parent, "p", entry.text);
        else appendElsewhereEntry(parent, entry);
    }

    function renderHistory(root) {
        if (historyEntries.length === 0) return;
        const anchor = document.createElement("div");
        anchor.className = "framework-history-anchor";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "framework-history-toggle";
        button.textContent = historyOpen ? "Close history" : "History";
        anchor.appendChild(button);
        const panel = document.createElement("section");
        panel.className = "framework-history-panel" + (historyOpen ? " is-open" : "");
        const scroll = document.createElement("div");
        scroll.className = "framework-history-scroll";
        historyEntries.forEach(function (entry) { appendPresentationEntry(scroll, entry); });
        panel.appendChild(scroll);
        anchor.appendChild(panel);
        button.addEventListener("click", function () {
            historyOpen = !historyOpen;
            historyPinnedToLatest = true;
            renderLocationView();
        });
        scroll.addEventListener("scroll", function () {
            historyScrollTop = scroll.scrollTop;
            const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
            historyPinnedToLatest = distance < 32;
        });
        root.appendChild(anchor);
        if (historyOpen) {
            const snap = function () {
                scroll.scrollTop = historyPinnedToLatest ? scroll.scrollHeight : Math.max(0, historyScrollTop);
            };
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(snap); else snap();
        }
    }

    function closeDayWorkOfferOverlay() {
        const existing = document.getElementById("framework-day-work-overlay");
        if (existing) existing.remove();
    }

    function runEmergencyDumpFromOverlay(statusNode) {
        const result = setup.EmergencyDiagnostics && setup.EmergencyDiagnostics.download
            ? setup.EmergencyDiagnostics.download()
            : { ok: false, error: { message: "Emergency diagnostics are unavailable." } };
        if (statusNode) statusNode.textContent = result.ok
            ? `Emergency dump downloaded: ${result.filename}`
            : (result.error && result.error.message || "Emergency dump failed.");
        return result;
    }

    function applyDayOfferResolutionResult(result) {
        const uiState = getUIState();
        appendHistory(result && result.historyEntries || []);
        uiState.selectedAction = null;
        uiState.rawTurnNarrative = cloneUIValue(result && (result.rawNarrativeFragments || result.narrativeFragments) || []);
        uiState.narratedTurnNarrative = cloneUIValue(result && result.narratedNarrativeFragments || []);
        uiState.dynamicNarrationValid = Boolean(result && result.narrator && result.narrator.used);
        uiState.turnNarrative = cloneUIValue(result && result.narrativeFragments || []);
        currentTurnHiddenNarrative = cloneUIValue(result && result.hiddenNarrativeEntries || []);
        if (result && result.timelapseResult) {
            uiState.locationStatus = result.ok
                ? "Evening. The daytime timelapse is complete."
                : `Daytime timelapse stopped after ${result.timelapseResult.committedRounds || 0} committed round(s): ${result.error && result.error.message || "Unknown error."}`;
        } else if (result && result.ok) {
            uiState.locationStatus = "Work declined. Morning continues.";
        } else {
            uiState.locationStatus = result && result.error ? result.error.message : "The work offer could not be resolved.";
        }
    }

    function renderDayWorkOfferOverlay() {
        closeDayWorkOfferOverlay();
        if (!setup.DaytimeTimelapse || !setup.DaytimeTimelapse.hasPendingOffer || !setup.DaytimeTimelapse.hasPendingOffer()) return;
        const offer = setup.DaytimeTimelapse.getPendingOffer();
        const world = setup.Game.getWorld();
        const activity = offer && world.dayActivities && world.dayActivities[offer.activityId];
        const sponsor = offer && world.entities[offer.sponsorCharacterId];
        if (!offer || !activity || !sponsor) return;
        const overlay = document.createElement("div");
        overlay.id = "framework-day-work-overlay";
        overlay.className = "framework-day-work-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.innerHTML = `
            <section class="framework-day-work-card">
                <h2>${escapeHtml(sponsor.name)} offers you a day&rsquo;s work</h2>
                <p>${escapeHtml(activity.name || "Day work")}</p>
                <p>Spend the day working with ${escapeHtml(sponsor.name)}?</p>
                <div id="framework-day-work-status" class="framework-status"></div>
                <div class="framework-day-work-actions">
                    <button id="framework-day-work-accept" type="button">Accept work</button>
                    <button id="framework-day-work-decline" type="button">Decline</button>
                </div>
                <div class="framework-day-work-emergency">
                    <button id="framework-day-work-emergency" type="button">Emergency dump</button>
                </div>
            </section>`;
        document.body.appendChild(overlay);
        const status = document.getElementById("framework-day-work-status");
        $("#framework-day-work-emergency").on("click", function () { runEmergencyDumpFromOverlay(status); });
        async function resolve(accept) {
            if (runtimeTurnBusy) return;
            runtimeTurnBusy = true;
            $("#framework-day-work-accept, #framework-day-work-decline").prop("disabled", true);
            if (status) status.textContent = accept ? "Starting the working day..." : "Declining the offer...";
            resetProgressiveTurnPresentation(getUIState());
            let result;
            try {
                result = await setup.TurnFlow.resolveDayWorkOffer(accept, null, {
                    onCommittedPresentation: function (batch) { appendCommittedPresentation(getUIState(), batch); },
                    onTimelapseProgress: appendTimelapseProgress
                });
            } finally {
                runtimeTurnBusy = false;
            }
            if (document.getElementById("framework-timelapse-overlay")) finishTimelapseModal(result);
            applyDayOfferResolutionResult(result);
            refreshCurrentPassage();
        }
        $("#framework-day-work-accept").on("click", function () { void resolve(true); });
        $("#framework-day-work-decline").on("click", function () { void resolve(false); });
    }

    function closeActionPickerOverlay() {
        const existing = document.getElementById("framework-action-picker-overlay");
        if (existing) existing.remove();
    }

    function renderActionPanelPreservingNarrativeDraft() {
        const current = document.getElementById("action-narrative-text");
        const draft = current ? current.value : null;
        renderActionPanel();
        if (draft === null) return;
        const replacement = document.getElementById("action-narrative-text");
        if (!replacement) return;
        replacement.value = draft;
        resizeNarrativeTextarea(replacement);
    }

    function renderBulkTransferPicker(view) {
        closeActionPickerOverlay();
        const action = view.available_actions.transfer_items;
        const routes = action && action.options && action.options.routes || [];
        if (!routes.length) return;
        const overlay = document.createElement("div");
        overlay.id = "framework-action-picker-overlay";
        overlay.className = "framework-character-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-character-window";
        panel.innerHTML = '<h2>Transfer items</h2><label>Destination / source<select id="framework-bulk-route"></select></label><div id="framework-bulk-items" class="framework-character-inventory"></div><div id="framework-bulk-status" class="framework-status"></div><div class="framework-character-actions"><button id="framework-bulk-apply" type="button">Select transfer</button><button id="framework-bulk-cancel" type="button">Cancel</button></div>';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        const routeSelect = document.getElementById("framework-bulk-route");
        routes.forEach(function (route, index) {
            const option = document.createElement("option");
            option.value = String(index); option.textContent = route.label || `Transfer route ${index + 1}`; routeSelect.appendChild(option);
        });
        function renderItems() {
            const route = routes[Number(routeSelect.value) || 0];
            const root = document.getElementById("framework-bulk-items");
            root.replaceChildren();
            appendTextElement(root, "p", "Choose one or more items. The bundle is transferred atomically.");
            (route.item_ids || []).forEach(function (itemId) {
                const item = findViewItem(view, itemId);
                const label = document.createElement("label");
                label.className = "framework-bulk-item";
                const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = itemId; checkbox.className = "framework-bulk-item-checkbox";
                label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${item ? itemDisplayName(item) : itemId}`)); root.appendChild(label);
            });
        }
        routeSelect.addEventListener("change", renderItems); renderItems();
        document.getElementById("framework-bulk-cancel").addEventListener("click", closeActionPickerOverlay);
        document.getElementById("framework-bulk-apply").addEventListener("click", function () {
            const route = routes[Number(routeSelect.value) || 0];
            const itemIds = Array.from(document.querySelectorAll(".framework-bulk-item-checkbox:checked")).map(function (checkbox) { return checkbox.value; });
            if (!itemIds.length) { document.getElementById("framework-bulk-status").textContent = "Choose at least one item."; return; }
            setSelectedAction({ type: "transfer_items", source_inventory_id: route.source_inventory_id, target_inventory_id: route.target_inventory_id, item_ids: itemIds }, view);
            closeActionPickerOverlay(); renderActionPanelPreservingNarrativeDraft();
        });
    }

    function renderGiveGoldPicker(view, entry) {
        closeActionPickerOverlay();
        if (!entry || !Array.isArray(entry.targets) || !entry.targets.length || Number(entry.maximumAmount || 0) < 1) return;
        const overlay = document.createElement("div");
        overlay.id = "framework-action-picker-overlay";
        overlay.className = "framework-character-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-character-window";
        panel.innerHTML = '<h2>Give gold</h2><label>Recipient<select id="framework-give-gold-target"></select></label><label>Amount<input id="framework-give-gold-amount" type="number" min="1" step="1" value="1"></label><div id="framework-give-gold-status" class="framework-status"></div><div class="framework-character-actions"><button id="framework-give-gold-apply" type="button">Select transfer</button><button id="framework-give-gold-cancel" type="button">Cancel</button></div>';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        const targetSelect = document.getElementById("framework-give-gold-target");
        entry.targets.forEach(function (target) {
            const option = document.createElement("option");
            option.value = target.id;
            option.textContent = target.name;
            targetSelect.appendChild(option);
        });
        const amountInput = document.getElementById("framework-give-gold-amount");
        amountInput.max = String(entry.maximumAmount);
        document.getElementById("framework-give-gold-cancel").addEventListener("click", closeActionPickerOverlay);
        document.getElementById("framework-give-gold-apply").addEventListener("click", function () {
            const amount = Number(amountInput.value);
            const targetId = targetSelect.value;
            const status = document.getElementById("framework-give-gold-status");
            if (!Number.isInteger(amount) || amount < 1 || amount > entry.maximumAmount) {
                status.textContent = `Enter a whole amount from 1 to ${entry.maximumAmount}.`;
                return;
            }
            if (!entry.targets.some(function (target) { return target.id === targetId; })) {
                status.textContent = "Choose a valid recipient.";
                return;
            }
            setSelectedAction({ type: "give_money", target_id: targetId, amount: amount }, view);
            closeActionPickerOverlay();
            renderActionPanelPreservingNarrativeDraft();
        });
    }

    function renderUseItemInputPicker(view, entry) {
        closeActionPickerOverlay();
        const option = useItemOption(view, entry.action.item_id);
        if (!option) return;
        const overlay = document.createElement("div");
        overlay.id = "framework-action-picker-overlay";
        overlay.className = "framework-character-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-character-window";
        const inputLabel = option.input_label || "Input";
        panel.innerHTML = `<h2>${escapeHtml(entry.label)}</h2><label>${escapeHtml(inputLabel)}<input id="framework-use-item-input" type="text" maxlength="600"></label><div id="framework-use-item-status" class="framework-status"></div><div class="framework-character-actions"><button id="framework-use-item-apply" type="button">Select action</button><button id="framework-use-item-cancel" type="button">Cancel</button></div>`;
        overlay.appendChild(panel); document.body.appendChild(overlay);
        document.getElementById("framework-use-item-cancel").addEventListener("click", closeActionPickerOverlay);
        document.getElementById("framework-use-item-apply").addEventListener("click", function () {
            const action = cloneUIValue(entry.action);
            action.input_text = String(document.getElementById("framework-use-item-input").value || "");
            setSelectedAction(action, view);
            closeActionPickerOverlay(); renderActionPanelPreservingNarrativeDraft();
        });
    }

    function renderActionGroupPicker(view, group) {
        closeActionPickerOverlay();
        const overlay = document.createElement("div");
        overlay.id = "framework-action-picker-overlay";
        overlay.className = "framework-character-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-character-window";
        appendTextElement(panel, "h2", group.title || group.label.replace(/\s*▸\s*$/, ""));
        const actions = document.createElement("div");
        actions.className = "framework-character-actions";
        (group.children || []).forEach(function (entry) {
            const button = appendTextElement(actions, "button", entry.label);
            button.type = "button";
            button.addEventListener("click", function () {
                if (entry.kind === "write-paper") { renderWritePaperPicker(view, entry.itemId); return; }
                if (entry.kind === "use-item-input") { renderUseItemInputPicker(view, entry); return; }
                setSelectedAction(entry.action, view);
                closeActionPickerOverlay(); renderActionPanelPreservingNarrativeDraft();
            });
        });
        const cancel = appendTextElement(actions, "button", "Cancel");
        cancel.type = "button"; cancel.addEventListener("click", closeActionPickerOverlay);
        panel.appendChild(actions); overlay.appendChild(panel); document.body.appendChild(overlay);
    }

    function renderWritePaperPicker(view, itemId) {
        closeActionPickerOverlay();
        const item = findViewItem(view, itemId);
        const overlay = document.createElement("div");
        overlay.id = "framework-action-picker-overlay";
        overlay.className = "framework-character-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-character-window";
        panel.innerHTML = `<h2>Write / draw on ${escapeHtml(item ? itemDisplayName(item) : "paper")}</h2><p>Plain text is literal writing. Put a description between single asterisks for a drawing or other visual mark, for example <code>*a small house is drawn here*</code>.</p><label>Paper content<textarea id="framework-paper-content" rows="10" maxlength="12000" placeholder="Write text and/or *describe drawings* here"></textarea></label><div id="framework-paper-status" class="framework-status"></div><div class="framework-character-actions"><button id="framework-paper-apply" type="button">Select write action</button><button id="framework-paper-cancel" type="button">Cancel</button></div>`;
        overlay.appendChild(panel); document.body.appendChild(overlay);
        document.getElementById("framework-paper-cancel").addEventListener("click", closeActionPickerOverlay);
        document.getElementById("framework-paper-apply").addEventListener("click", function () {
            const content = document.getElementById("framework-paper-content").value;
            setSelectedAction({ type: "write_paper", item_id: itemId, content: content }, view);
            closeActionPickerOverlay(); renderActionPanelPreservingNarrativeDraft();
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

        const conditions = view.world_conditions || {};
        const environment = document.createElement("section");
        environment.className = "framework-environment";
        appendTextElement(environment, "strong", conditions.display_time || conditions.time_label || "Evening", "framework-environment-time");
        const weatherStatus = setup.WorldEnvironment && setup.WorldEnvironment.getStatus ? setup.WorldEnvironment.getStatus() : null;
        const weatherText = startupWeatherPending && weatherStatus && weatherStatus.weatherInitialized !== true
            ? "Checking current weather…"
            : (conditions.weather || "The air is mild and still beneath an unremarkable sky.");
        appendRPElement(environment, "p", weatherText, "framework-environment-weather");
        root.appendChild(environment);

        appendTextElement(root, "h2", view.location.name);
        const status = appendTextElement(root, "div", uiState.locationStatus, "framework-status");
        status.id = "location-status";
        uiState.locationStatus = "";

        const turnPresentation = currentTurnPresentation(uiState);

        renderStaticScene(root, view);
        renderCharacterScene(root, view);
        renderDynamicItems(root, view);
        renderHistory(root);
        renderCurrentTurn(root, turnPresentation);

        renderPrivateFeedback(root, actorId, view);
        renderPromptLab(root, view);
        renderBusyIndicator(root, busyState);

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
                } else if (entry.kind === "action-group") {
                    button.className = "framework-context-action";
                    button.addEventListener("click", function () { renderActionGroupPicker(view, entry); });
                } else if (entry.kind === "bulk-transfer") {
                    button.className = "framework-context-action";
                    button.addEventListener("click", function () { renderBulkTransferPicker(view); });
                } else if (entry.kind === "give-gold") {
                    button.className = "framework-context-action";
                    button.addEventListener("click", function () { renderGiveGoldPicker(view, entry); });
                } else if (entry.kind === "write-paper") {
                    button.className = "framework-context-action";
                    button.addEventListener("click", function () { renderWritePaperPicker(view, entry.itemId); });
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
        renderDayWorkOfferOverlay();
    }

    function closeCharacterWindow() {
        const existing = document.getElementById("framework-character-overlay");
        if (existing) existing.remove();
    }

    function renderCharacterWindow() {
        closeCharacterWindow();
        const actorId = setup.Game.getHumanCharacterId();
        const view = setup.CharacterAPI.getView(actorId);
        if (!view || view.ok === false) return;
        const inventory = view.self.inventory || [];
        const equipment = view.self.equipped_items || [];
        const overlay = document.createElement("div");
        overlay.id = "framework-character-overlay";
        overlay.className = "framework-character-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "framework-character-title");
        overlay.innerHTML = `
            <section class="framework-character-window">
                <h2 id="framework-character-title">Character</h2>
                <label>Name
                    <input id="framework-character-name" type="text" maxlength="120" value="${escapeHtml(view.self.name || "")}">
                </label>
                <label>Description
                    <textarea id="framework-character-description" rows="6" maxlength="2000">${escapeHtml(view.self.playerDescription || "")}</textarea>
                </label>
                <section class="framework-character-inventory">
                    <h3>Equipment</h3>
                    ${equipment.length ? `<ul>${equipment.map(function (item) { return `<li><strong>${escapeHtml(itemDisplayName(item))}</strong> — ${escapeHtml(item.slot)}</li>`; }).join("")}</ul>` : `<p>Empty</p>`}
                    <h3>Inventory</h3>
                    ${inventory.length
                        ? `<ul>${inventory.map(function (item) {
                            const description = String(item.description || "").trim();
                            return `<li><strong>${escapeHtml(itemDisplayName(item))}</strong>${description ? ` — ${escapeHtml(description)}` : ""}</li>`;
                        }).join("")}</ul>`
                        : `<p>Empty</p>`}
                </section>
                <div id="framework-character-status" class="framework-status"></div>
                <div class="framework-character-actions">
                    <button id="framework-character-save-close" type="button">Save and close</button>
                    <button id="framework-character-close" type="button">Close without saving</button>
                </div>
            </section>
        `;
        document.body.appendChild(overlay);

        $("#framework-character-save-close").on("click", function () {
            const result = setup.Game.updateCharacterProfile(actorId, {
                name: $("#framework-character-name").val(),
                playerDescription: $("#framework-character-description").val()
            });
            if (!result.ok) {
                $("#framework-character-status").text(result.error.message);
                return;
            }
            closeCharacterWindow();
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        });
        $("#framework-character-close").on("click", closeCharacterWindow);
    }

    function ensureGlobalEmergencyDumpControl() {
        let button = document.getElementById("framework-global-emergency-dump");
        if (!button) {
            button = document.createElement("button");
            button.id = "framework-global-emergency-dump";
            button.type = "button";
            button.textContent = "Emergency dump";
            button.title = "Emergency dump — always available";
            button.addEventListener("click", function () {
                const result = setup.EmergencyDiagnostics && setup.EmergencyDiagnostics.download
                    ? setup.EmergencyDiagnostics.download()
                    : { ok: false, error: { message: "Emergency diagnostics are unavailable." } };
                const status = document.getElementById("sidebar-status") || document.getElementById("framework-day-work-status");
                if (status) status.textContent = result.ok ? `Emergency dump downloaded: ${result.filename}` : (result.error && result.error.message || "Emergency dump failed.");
            });
            document.body.appendChild(button);
        }
        return button;
    }

    function mindV3DebugHtml(character) { return setup.DebugUIFormatters.mindV3DebugHtml(character); }

    function refreshMindV3Debug(characterId) {
        const panel = document.getElementById("framework-mind-v3-debug");
        if (!panel) return;
        const world = setup.Game.getWorld();
        panel.innerHTML = mindV3DebugHtml(world.entities[characterId]);
    }

    function aiHealthState() {
        const executorStatus = setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus ? setup.AIRequestExecutor.getStatus() : {};
        const busy = setup.AIController && setup.AIController.isInFlight && setup.AIController.isInFlight() ||
            Boolean(executorStatus && (executorStatus.blockingBusy !== undefined ? executorStatus.blockingBusy : executorStatus.busy)) ||
            setup.AITurnScheduler && setup.AITurnScheduler.isWaveInFlight && setup.AITurnScheduler.isWaveInFlight();
        if (busy) return { state: "working", label: "AI working…" };
        const settings = setup.AIRuntimeSettings ? setup.AIRuntimeSettings.getStatus() : { keyStatus: "not_set" };
        if (settings.keyStatus === "rejected") return { state: "error", label: "AI key rejected" };
        const history = setup.AIRequestExecutor && setup.AIRequestExecutor.getExchangeHistory ? setup.AIRequestExecutor.getExchangeHistory() : null;
        const entries = history && Array.isArray(history.entries) ? history.entries : [];
        const last = entries.length ? entries[entries.length - 1] : null;
        if (last && last.result && last.result.attempted !== false && !last.result.ok) return { state: "error", label: "AI error" };
        if (settings.keyStatus !== "available") return { state: "offline", label: "AI not configured" };
        if (setup.AITurnScheduler && setup.AITurnScheduler.isAutoProcessingPaused && setup.AITurnScheduler.isAutoProcessingPaused()) {
            return { state: "paused", label: "AI paused" };
        }
        return { state: "ready", label: "AI ready" };
    }

    function latestAIError() {
        const history = setup.AIRequestExecutor && setup.AIRequestExecutor.getExchangeHistory ? setup.AIRequestExecutor.getExchangeHistory() : null;
        const entries = history && Array.isArray(history.entries) ? history.entries : [];
        for (let index = entries.length - 1; index >= 0; index--) {
            const result = entries[index] && entries[index].result;
            if (result && result.attempted !== false && !result.ok && result.error) return result.error;
            if (result && result.ok) break;
        }
        return null;
    }

    function keyStatusMarkup(aiSettings) {
        const state = aiSettings && aiSettings.keyStatus || (aiSettings && aiSettings.hasKey ? "available" : "not_set");
        const label = state === "available" ? "Available" : state === "rejected" ? "Rejected" : "Not set";
        return `<span class="framework-key-status is-${escapeHtml(state)}"><span class="framework-status-lamp"></span>${escapeHtml(label)}</span>`;
    }

    function modelOptionsMarkup(models, selectedId, defaultId, suffix) {
        return (models || []).map(function (model) {
            const selected = model.id === selectedId ? " selected" : "";
            const recommended = model.id === defaultId ? ` (${suffix || "recommended"})` : "";
            return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.name + recommended)}</option>`;
        }).join("");
    }

    function closeSettingsModal() {
        const existing = document.getElementById("framework-settings-overlay");
        if (existing) existing.remove();
        pendingStarterImport = null;
    }

    function starterImportConflictMarkup(imported) {
        const existing = new Map((setup.StarterCharacterLibrary && setup.StarterCharacterLibrary.list().characters || []).map(function (record) { return [record.id, record]; }));
        const conflicts = (imported && imported.characters || []).filter(function (record) { return existing.has(record.id); });
        if (!conflicts.length) return "";
        return `<div class="framework-import-conflicts"><strong>Import conflicts</strong><p class="framework-sidebar-note">Choose what to do with characters that already exist in this browser.</p>${conflicts.map(function (record) {
            return `<label>${escapeHtml(record.name)}<select class="framework-starter-conflict" data-starter-id="${escapeHtml(record.id)}"><option value="keep">Keep both</option><option value="replace">Replace existing</option><option value="skip">Skip imported</option></select></label>`;
        }).join("")}</div>`;
    }

    function renderSettingsModal(message) {
        closeSettingsModal();
        ensureGlobalEmergencyDumpControl();
        const world = setup.Game.getWorld();
        const characters = Object.values(world.entities).filter(function (entity) { return entity && entity.type === "character"; });
        const aiCharacters = characters.filter(function (character) { return world.control && world.control.assignments && world.control.assignments[character.id] === "ai"; });
        const selectedCharacterId = String((document.getElementById("human-character-select") || {}).value || setup.Game.getHumanCharacterId());
        const selectedCharacter = world.entities[selectedCharacterId] || world.entities[setup.Game.getHumanCharacterId()];
        if (!aiSettingsInitialized && setup.AIRuntimeSettings) { setup.AIRuntimeSettings.readSaved(); aiSettingsInitialized = true; }
        const aiSettings = setup.AIRuntimeSettings.getStatus();
        const executorStatus = setup.AIRequestExecutor.getStatus();
        const aiBusy = setup.AIController.isInFlight() || Boolean(executorStatus && (executorStatus.blockingBusy !== undefined ? executorStatus.blockingBusy : executorStatus.busy)) || setup.AITurnScheduler.isWaveInFlight();
        const queue = setup.AITurnScheduler.getQueueView();
        const health = aiHealthState();
        const latestError = latestAIError();
        const overlay = document.createElement("div");
        overlay.id = "framework-settings-overlay";
        overlay.className = "framework-settings-overlay";
        overlay.innerHTML = `<section class="framework-settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
            <header class="framework-settings-header"><h2>Settings</h2><button id="framework-settings-close" type="button" aria-label="Close settings">×</button></header>
            <section class="framework-settings-section"><h3>AI</h3>
                <div class="framework-ai-health is-${escapeHtml(health.state)}"><span class="framework-status-lamp"></span>${escapeHtml(health.label)}</div>
                <p>Provider: OpenRouter</p>
                <div class="framework-settings-grid">
                    <label>Character model<select id="openrouter-model-select"${aiBusy ? " disabled" : ""}>${modelOptionsMarkup(aiSettings.characterModels, aiSettings.selectedModelId, aiSettings.defaultModelId, "recommended")}</select><small>DeepSeek V4 Flash is the default Character model; other eligible models can be selected here.</small></label>
                    <label>Utility model<select id="openrouter-utility-model-select"${aiBusy ? " disabled" : ""}>${modelOptionsMarkup(aiSettings.utilityModels, aiSettings.selectedUtilityModelId, aiSettings.defaultUtilityModelId, "default")}</select><small>Used for utility/maintenance requests.</small></label>
                    <label>Narrator model<select id="openrouter-narrator-model-select"${aiBusy ? " disabled" : ""}>${modelOptionsMarkup(aiSettings.narratorModels, aiSettings.selectedNarratorModelId, aiSettings.defaultNarratorModelId, "default")}</select><small>Narrator quality is model-sensitive; switching models is experimental.</small></label>
                </div>
                <div class="framework-key-row"><strong>Key status:</strong> ${keyStatusMarkup(aiSettings)}</div>
                <label>OpenRouter API key <input id="openrouter-api-key" type="password" autocomplete="off" placeholder="Paste a new key"></label>
                <label><input id="remember-openrouter-key" type="checkbox"> Remember for 7 days</label>
                <div><button id="save-ai-settings" type="button">Save key</button> <button id="forget-ai-key" type="button">Forget key</button></div>
                <div id="ai-settings-status" class="framework-status">${escapeHtml(message || aiSettings.warning || "")}</div>
                ${latestError ? `<div class="framework-ai-error-summary">${friendlyErrorMarkup(latestError)}</div>` : ""}
                <label><input id="enable-narrator" type="checkbox"${isNarratorEnabled() ? " checked" : ""}${aiBusy ? " disabled" : ""}> Enable narrator</label><br>
                <label><input id="stop-auto-ai-processing" type="checkbox"${setup.AITurnScheduler.isAutoProcessingPaused() ? " checked" : ""}${aiBusy ? " disabled" : ""}> Pause automatic AI processing</label><br>
                <label><input id="auto-compress-character-memory" type="checkbox"${setup.AITurnScheduler.isAutoMemoryCompressionEnabled() ? " checked" : ""}${aiBusy ? " disabled" : ""}> Automatic mind maintenance</label>
            </section>
            <section class="framework-settings-section"><h3>Starter Characters</h3>
                <p class="framework-sidebar-note">Browser-only presets used before entering a new world. They are never referenced by world/save state.</p>
                <p>${setup.StarterCharacterLibrary ? (setup.StarterCharacterLibrary.list().characters || []).length : 0} saved character(s).</p>
                <button id="export-starter-characters" type="button">Export ZIP</button>
                <button id="import-starter-characters" type="button">Import ZIP</button>
                <input id="import-starter-characters-file" type="file" accept="application/zip,.zip" hidden>
                <div id="starter-import-area">${pendingStarterImport ? starterImportConflictMarkup(pendingStarterImport) + '<button id="apply-starter-import" type="button">Apply import</button>' : ""}</div>
                <div id="starter-settings-status" class="framework-status"></div>
            </section>
            ${publicPrivacySettingsMarkup()}
            <section class="framework-settings-section"><h3>Advanced</h3>
                <label>Character for maintenance/admin<select id="settings-character-select">${characters.map(function (character) { return `<option value="${escapeHtml(character.id)}"${character.id === selectedCharacterId ? " selected" : ""}>${escapeHtml(character.name)}</option>`; }).join("")}</select></label>
                <details><summary>Mind tools</summary>
                    <button id="compress-memory-button" type="button"${aiBusy ? " disabled" : ""}>Maintain mind</button>
                    <button id="export-character-mind" type="button"${aiBusy ? " disabled" : ""}>Export mind</button>
                    <button id="import-character-mind" type="button"${aiBusy ? " disabled" : ""}>Import mind</button>
                    <input id="import-character-mind-file" type="file" accept="application/json,.json" hidden>
                    <div id="framework-mind-v3-debug" class="framework-sidebar-note">${mindV3DebugHtml(selectedCharacter)}</div>
                </details>
                <details><summary>AI activity tools</summary>
                    <button id="dismiss-pending-reactions" type="button"${aiBusy ? " disabled" : ""}>Dismiss pending reactions</button>
                    <button id="clear-current-intention" type="button"${aiBusy ? " disabled" : ""}>Clear current intention</button>
                    <button id="clear-selected-ai-activity" type="button"${aiBusy ? " disabled" : ""}>Clear AI activity</button>
                    <p>Pending AI turns: ${escapeHtml(queue.count || 0)}</p>
                    <div>${aiCharacters.map(function (character) { return `<label><input class="framework-ai-admin-keep" type="checkbox" value="${escapeHtml(character.id)}"> Keep ${escapeHtml(character.name)} active</label><br>`; }).join("") || "No AI-controlled characters."}</div>
                    <button id="clear-global-ai-activity" type="button"${aiBusy || !aiCharacters.length ? " disabled" : ""}>Clear everyone else</button>
                </details>
                <div id="ai-turn-status" class="framework-status"></div>
            </section>
            <section class="framework-settings-section"><h3>World</h3>
                <button id="validate-world-button" type="button">Validate world</button>
                <button id="reset-world-button" type="button">Reset world</button>
                <button id="settings-emergency-dump" type="button">Emergency dump</button>
                <div id="sidebar-status" class="framework-status"></div>
            </section>
            <section class="framework-settings-section"><h3>About</h3>
                <p><strong>${escapeHtml(setup.BuildInfo && setup.BuildInfo.productName || "Mallowstead")}</strong><br>Created by ${escapeHtml(setup.BuildInfo && setup.BuildInfo.author || "Dmytro Turovskiy")}</p>
                <p><strong>Version:</strong> ${escapeHtml(setup.BuildInfo && setup.BuildInfo.version || "unknown")}<br><strong>Build profile:</strong> ${escapeHtml(setup.BuildInfo && setup.BuildInfo.profile || "unknown")}<br><strong>Commit:</strong> ${escapeHtml(setup.BuildInfo && setup.BuildInfo.commit || "unknown")}<br><strong>Built:</strong> ${escapeHtml(setup.BuildInfo && setup.BuildInfo.builtAt || "unknown")}</p>
            </section>
        </section>`;
        document.body.appendChild(overlay);
        const jq = window.jQuery || window.$;
        if (!jq) return;
        jq("#framework-settings-close").on("click", closeSettingsModal);
        jq(overlay).on("click", function (event) { if (event.target === overlay) closeSettingsModal(); });
        jq("#settings-character-select").on("change", function () { refreshMindV3Debug(String(jq(this).val() || "")); });

        function settingsTargetId() { return String(jq("#settings-character-select").val() || ""); }
        function setWorldStatus(text) { jq("#sidebar-status").text(text || ""); }
        function rerenderSettings(text) { renderSidebar(); renderSettingsModal(text); }
        function downloadBytes(bytes, filename, type) {
            const blob = new Blob([bytes], { type: type || "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        }

        jq("#openrouter-model-select").on("change", function () { const r = setup.AIRuntimeSettings.selectModel(jq(this).val()); rerenderSettings(r.ok ? (r.warning || `Character model: ${r.model.name}.`) : r.error.message); });
        jq("#openrouter-utility-model-select").on("change", function () { const r = setup.AIRuntimeSettings.selectUtilityModel(jq(this).val()); rerenderSettings(r.ok ? (r.warning || `Utility model: ${r.model.name}.`) : r.error.message); });
        jq("#openrouter-narrator-model-select").on("change", function () { const r = setup.AIRuntimeSettings.selectNarratorModel(jq(this).val()); rerenderSettings(r.ok ? (r.warning || `Narrator model: ${r.model.name}.`) : r.error.message); });
        jq("#save-ai-settings").on("click", function () {
            const r = setup.AIRuntimeSettings.save(jq("#openrouter-api-key").val(), jq("#remember-openrouter-key").prop("checked"));
            jq("#openrouter-api-key").val("");
            rerenderSettings(r.ok ? (r.warning || (r.remembered ? "Key saved for 7 days." : "Key retained for this page.")) : r.error.message);
            if (r.ok && setup.WorldEnvironment) void setup.WorldEnvironment.ensureWeatherInitialized().then(function () { renderLocationView(); renderActionPanel(); });
        });
        jq("#forget-ai-key").on("click", function () { const r = setup.AIRuntimeSettings.forget(); rerenderSettings(r.warning || "Key forgotten."); });
        jq("#enable-narrator").on("change", function () { if (!setup.NarratorService) return; setup.NarratorService.setEnabled(jq(this).prop("checked")); renderLocationView(); renderActionPanel(); rerenderSettings(); });
        jq("#stop-auto-ai-processing").on("change", function () { const r = setup.AITurnScheduler.setAutoProcessingPaused(jq(this).prop("checked")); jq("#ai-turn-status").text(r.paused ? "Automatic AI processing is paused." : "Automatic AI processing is enabled."); renderSidebar(); });
        jq("#auto-compress-character-memory").on("change", function () { const r = setup.AITurnScheduler.setAutoMemoryCompressionEnabled(jq(this).prop("checked")); jq("#ai-turn-status").text(r.enabled ? "Automatic mind maintenance is enabled." : "Automatic mind maintenance is disabled."); });

        function runSelectedAdminOperation(methodName, label) {
            const targetId = settingsTargetId();
            if (!targetId || !setup.AIAdmin || typeof setup.AIAdmin[methodName] !== "function") return setWorldStatus("AI admin tools are unavailable.");
            if (getBusyState().busy) return setWorldStatus("AI activity cannot be changed while AI or migration work is in progress.");
            const r = setup.AIAdmin[methodName](targetId);
            if (!r || !r.ok) return setWorldStatus(r && r.error && r.error.message || `${label} failed.`);
            renderLocationView(); renderActionPanel(); rerenderSettings(`${label} complete.`);
        }
        jq("#dismiss-pending-reactions").on("click", function () { runSelectedAdminOperation("dismissPendingReactions", "Pending reactions dismissed"); });
        jq("#clear-current-intention").on("click", function () { runSelectedAdminOperation("clearCurrentIntention", "Current intention cleared"); });
        jq("#clear-selected-ai-activity").on("click", function () { runSelectedAdminOperation("clearAIActivity", "AI activity cleared"); });
        jq("#clear-global-ai-activity").on("click", function () {
            if (!setup.AIAdmin || getBusyState().busy) return;
            const keepCharacterIds = Array.from(document.querySelectorAll(".framework-ai-admin-keep:checked")).map(function (input) { return input.value; });
            const affected = aiCharacters.filter(function (character) { return !keepCharacterIds.includes(character.id); }).length;
            if (!window.confirm(`Clear pending reactions and current intentions for ${affected} AI character(s)?`)) return;
            const r = setup.AIAdmin.clearAllAIActivity({ keepCharacterIds: keepCharacterIds });
            if (!r || !r.ok) return setWorldStatus(r && r.error && r.error.message || "AI activity cleanup failed.");
            renderLocationView(); renderActionPanel(); rerenderSettings(`Cleared AI activity for ${r.affectedCharacterIds.length} character(s).`);
        });
        jq("#export-character-mind").on("click", function () {
            if (getBusyState().busy) return setWorldStatus("Character mind export is unavailable while AI or migration work is in progress.");
            const r = setup.CharacterMindTransfer && setup.CharacterMindTransfer.exportMind(settingsTargetId());
            if (!r || !r.ok) return setWorldStatus(r && r.error && r.error.message || "Character mind export is unavailable.");
            downloadBytes(r.text, r.filename, "application/json;charset=utf-8"); setWorldStatus(`Exported ${r.document.characterName}'s mind.`);
        });
        jq("#import-character-mind").on("click", function () { const input = document.getElementById("import-character-mind-file"); if (input) input.click(); });
        jq("#import-character-mind-file").on("change", async function () {
            const file = this.files && this.files[0]; if (!file) return;
            const targetId = settingsTargetId();
            try {
                const documentValue = JSON.parse(await file.text());
                const validation = setup.CharacterMindTransfer && setup.CharacterMindTransfer.validateDocument(documentValue, targetId);
                if (!validation || !validation.ok) return setWorldStatus(validation && validation.error && validation.error.message || "The selected mind file is invalid.");
                if (!window.confirm(`Import ${documentValue.characterName}'s saved mind into ${world.entities[targetId] && world.entities[targetId].name || targetId}?`)) return;
                const r = setup.CharacterMindTransfer.importMind(targetId, documentValue);
                if (!r.ok) return setWorldStatus(r.error.message);
                rerenderSettings(`Imported ${documentValue.characterName}'s mind.`);
            } catch (error) { setWorldStatus("The selected character mind file could not be read."); }
            finally { this.value = ""; }
        });
        jq("#compress-memory-button").on("click", async function () {
            const targetId = settingsTargetId(); const target = world.entities[targetId];
            if (!targetId || !setup.MemoryConsolidator) return setWorldStatus("Memory consolidation is unavailable.");
            if (getBusyState().busy) return setWorldStatus("Another canonical AI request is already in progress.");
            if (setup.MindAuxExecutor && setup.MindAuxExecutor.invalidateForTimelapse) setup.MindAuxExecutor.invalidateForTimelapse();
            setWorldStatus(`Consolidating ${target && target.name || targetId}'s memory…`);
            const r = await setup.MemoryConsolidator.compress(targetId, setup.OpenRouterClient);
            if (!r.ok) return rerenderSettings(r.error && r.error.message || "Memory maintenance failed.");
            if (r.nothingToCompress) return rerenderSettings("Nothing to consolidate.");
            rerenderSettings("Mind maintenance complete.");
        });
        jq("#validate-world-button").on("click", function () { const r = setup.Game.validateWorld(); setWorldStatus(r.ok ? "World is valid." : r.error.message); });
        jq("#reset-world-button").on("click", function () {
            if (!window.confirm("Reset the entire framework world?")) return;
            closeSettingsModal(); setup.Game.resetWorld(); delete State.variables.frameworkUI; resetHistory(); currentTurnHiddenNarrative = []; resetStaticNarration(""); Engine.play(currentPassageForHuman());
        });
        jq("#settings-emergency-dump").on("click", function () { const r = setup.EmergencyDiagnostics.download(); setWorldStatus(r.ok ? `Emergency dump downloaded: ${r.filename}` : r.error.message); });

        jq("#export-starter-characters").on("click", function () {
            const r = setup.StarterCharacterLibrary && setup.StarterCharacterLibrary.exportZip();
            if (!r || !r.ok) return jq("#starter-settings-status").text(r && r.error && r.error.message || "Starter character export failed.");
            jq("#starter-settings-status").text(`Exported ${(r.characters || []).length} starter character(s).`);
        });
        jq("#import-starter-characters").on("click", function () { const input = document.getElementById("import-starter-characters-file"); if (input) input.click(); });
        jq("#import-starter-characters-file").on("change", async function () {
            const file = this.files && this.files[0]; if (!file) return;
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const r = setup.StarterCharacterLibrary.parseImportBytes(bytes);
                if (!r.ok) { jq("#starter-settings-status").text(r.error.message); return; }
                pendingStarterImport = { characters: r.characters };
                renderSettingsModal(`Ready to import ${r.characters.length} starter character(s).`);
            } catch (error) { jq("#starter-settings-status").text("The selected starter-character ZIP could not be read."); }
        });
        jq("#apply-starter-import").on("click", function () {
            if (!pendingStarterImport) return;
            const resolutions = {};
            document.querySelectorAll(".framework-starter-conflict").forEach(function (select) { resolutions[select.dataset.starterId] = select.value; });
            const r = setup.StarterCharacterLibrary.mergeImported(pendingStarterImport.characters, resolutions);
            pendingStarterImport = null;
            renderSettingsModal(r.ok ? `Imported ${r.summary.added} new character(s); replaced ${r.summary.replaced}, kept both ${r.summary.keptBoth}, skipped ${r.summary.skipped}.` : r.error.message);
        });
    }

    function renderSidebar() {
        ensureGlobalEmergencyDumpControl();
        const root = document.getElementById("framework-sidebar");
        if (!root) return;
        const world = setup.Game.getWorld();
        const humanId = setup.Game.getHumanCharacterId();
        const actor = world.entities[humanId];
        const location = world.entities[actor.locationId];
        const characters = Object.values(world.entities).filter(function (entity) { return entity && entity.type === "character"; });
        const view = setup.CharacterAPI.getView(humanId);
        const health = aiHealthState();
        root.innerHTML = `<div class="framework-sidebar-block">
            <strong>Character</strong><br>
            <select id="human-character-select">${characters.map(function (character) { return `<option value="${escapeHtml(character.id)}"${character.id === humanId ? " selected" : ""}>${escapeHtml(character.name)}</option>`; }).join("")}</select>
            <button id="take-control-button" type="button">Take control</button>
            <button id="open-character-window" type="button">Character</button>
        </div>
        <div class="framework-sidebar-block"><strong>${escapeHtml(actor.name)}</strong><br>Location: ${escapeHtml(location.name)}<br>Position: ${escapeHtml(view.self.position_text)}<br>Gold: ${escapeHtml(actor.wallet)}<br>Inventory: ${view.self.inventory.map(function (item) { return escapeHtml(itemDisplayName(item)); }).join(", ") || "empty"}</div>
        <div class="framework-sidebar-block"><button id="framework-ai-status" class="framework-ai-health is-${escapeHtml(health.state)}" type="button"><span class="framework-status-lamp"></span>${escapeHtml(health.label)}</button><br><button id="open-settings-button" type="button">⚙ Settings</button><div id="sidebar-status" class="framework-status"></div></div>`;
        $("#open-settings-button, #framework-ai-status").on("click", function () { renderSettingsModal(); });
        $("#open-character-window").on("click", renderCharacterWindow);
        $("#take-control-button").on("click", function () {
            const targetId = String($("#human-character-select").val() || "");
            const r = setup.Game.takeHumanControl(targetId);
            if (!r.ok) { $("#sidebar-status").text(r.error.message); return; }
            const uiState = getUIState(); uiState.interactionTargetId = ""; uiState.selectedAction = null; uiState.turnNarrative = []; uiState.rawTurnNarrative = []; uiState.narratedTurnNarrative = []; uiState.dynamicNarrationValid = false;
            currentTurnHiddenNarrative = []; resetStaticNarration(""); Engine.play(currentPassageForHuman());
        });
    }

    function friendlyAIError(error) {
        error = error && typeof error === "object" ? error : {};
        const code = String(error.code || "");
        let message = error.message || "The AI request could not be completed.";
        if (code === "AI_KEY_MISSING") message = "AI is not configured yet. Add an OpenRouter API key in Settings.";
        else if (code === "AUTHENTICATION_FAILED") message = "OpenRouter rejected the API key. Enter a valid key in Settings.";
        else if (code === "INSUFFICIENT_CREDITS" || code === "PAYMENT_REQUIRED") message = "Your OpenRouter account appears to be out of credits. Add credits and try again.";
        else if (code === "RATE_LIMITED") message = "OpenRouter is temporarily rate-limiting requests. Try again shortly.";
        else if (code === "NETWORK_ERROR" || code === "REQUEST_FAILED") message = "The AI provider could not be reached. Check your connection and try again.";
        return { message: message, technical: JSON.stringify({ code: error.code || null, status: error.status || null, providerMessage: error.message || null, details: error.details || null }, null, 2) };
    }

    function friendlyErrorMarkup(error) {
        const described = friendlyAIError(error);
        return `${escapeHtml(described.message)}<details class="framework-error-details"><summary>Technical details</summary><pre>${escapeHtml(described.technical)}</pre></details>`;
    }

    function ensureTimelapseModal(progress) {
        let overlay = document.getElementById("framework-timelapse-overlay");
        if (overlay) return overlay;
        ensureGlobalEmergencyDumpControl();
        overlay = document.createElement("div");
        overlay.id = "framework-timelapse-overlay";
        overlay.className = "framework-timelapse-overlay";
        overlay.innerHTML = `<section class="framework-timelapse-card" role="dialog" aria-modal="true"><header><h2 id="framework-timelapse-title">Advancing time…</h2><span class="framework-spinner is-visible" aria-hidden="true"></span></header><div id="framework-timelapse-log" class="framework-timelapse-log" aria-live="polite"></div><div id="framework-timelapse-result" class="framework-status"></div><button id="framework-timelapse-close" type="button" hidden>Close</button></section>`;
        document.body.appendChild(overlay);
        if (progress && progress.mode) document.getElementById("framework-timelapse-title").textContent = progress.mode === "daytime" ? "Advancing to evening…" : "Advancing to morning…";
        return overlay;
    }

    function appendTimelapseProgress(progress) {
        if (!progress) return;
        const overlay = ensureTimelapseModal(progress);
        const log = overlay.querySelector("#framework-timelapse-log");
        const line = document.createElement("div");
        line.className = "framework-timelapse-stage";
        line.textContent = progress.text || progress.stage || "Working…";
        log.appendChild(line); log.scrollTop = log.scrollHeight;
    }

    function appendTimelapsePresentation(batch) {
        const meta = batch && batch.meta || {};
        if (meta.phase !== "timelapse-round") return;
        const overlay = ensureTimelapseModal({ mode: meta.mode });
        const log = overlay.querySelector("#framework-timelapse-log");
        (batch.entries || []).forEach(function (entry) {
            const wrapper = document.createElement("div");
            wrapper.className = "framework-timelapse-event";
            appendPresentationEntry(wrapper, entry);
            log.appendChild(wrapper);
        });
        log.scrollTop = log.scrollHeight;
    }

    function finishTimelapseModal(result) {
        const overlay = document.getElementById("framework-timelapse-overlay");
        if (!overlay) return;
        const spinner = overlay.querySelector(".framework-spinner"); if (spinner) spinner.classList.remove("is-visible");
        const status = overlay.querySelector("#framework-timelapse-result");
        if (status) {
            if (result && result.ok) status.textContent = result.timelapseResult && result.timelapseResult.mode === "daytime" ? "Evening has begun." : "Morning has begun.";
            else status.innerHTML = friendlyErrorMarkup(result && result.error || { message: "The timelapse stopped before completion." });
        }
        const close = overlay.querySelector("#framework-timelapse-close");
        if (close) { close.hidden = false; close.addEventListener("click", function () { overlay.remove(); renderSidebar(); renderLocationView(); renderActionPanel(); }); }
    }

    function resetProgressiveTurnPresentation(uiState) {
        currentTurnHiddenNarrative = [];
        uiState.rawTurnNarrative = [];
        uiState.narratedTurnNarrative = [];
        uiState.dynamicNarrationValid = false;
        uiState.turnNarrative = [];
    }

    function appendCommittedPresentation(uiState, batch) {
        if (!batch || typeof batch !== "object") return;
        const visible = Array.isArray(batch.visible) ? batch.visible.filter(Boolean) : [];
        const hidden = Array.isArray(batch.hidden) ? batch.hidden : [];
        if (visible.length) {
            uiState.rawTurnNarrative.push.apply(uiState.rawTurnNarrative, cloneUIValue(visible));
            uiState.turnNarrative.push.apply(uiState.turnNarrative, cloneUIValue(visible));
        }
        if (hidden.length) currentTurnHiddenNarrative.push.apply(currentTurnHiddenNarrative, cloneUIValue(hidden));
        appendTimelapsePresentation(batch);
        const meta = batch.meta || {};
        if (meta.phase === "timelapse-round" && meta.round) {
            uiState.locationStatus = `Timelapse round ${meta.round}/${meta.totalRounds || "?"} committed...`;
        } else if (meta.phase === "ai-reaction") {
            uiState.locationStatus = "Processing AI reactions...";
        } else if (meta.phase === "human") {
            uiState.locationStatus = "Processing turn...";
        }
        // Keep controls locked, but refresh the already-committed presentation immediately.
        renderSidebar();
        renderLocationView();
        renderActionPanel();
    }

    async function runHumanIntent(input, navigateOnMove) {
        const uiState = getUIState();
        if (getBusyState().busy) {
            return { ok: false, error: { code: "TURN_IN_FLIGHT", message: "A turn is already being processed." } };
        }

        resetProgressiveTurnPresentation(uiState);
        runtimeTurnBusy = true;
        uiState.locationStatus = "Processing turn...";
        renderSidebar();
        renderLocationView();
        renderActionPanel();

        let result;
        try {
            const pending = setup.TurnFlow.submitHumanIntent(input, null, {
                onCommittedPresentation: function (batch) { appendCommittedPresentation(uiState, batch); },
                onTimelapseProgress: appendTimelapseProgress
            });
            result = await pending;
        } finally {
            runtimeTurnBusy = false;
        }
        if (document.getElementById("framework-timelapse-overlay")) finishTimelapseModal(result);

        if (!result || !result.ok) {
            if (result && result.turnConsumed) {
                const actionResult = result.intentResult && result.intentResult.actionResult;
                if (actionResult) {
                    const hasFeedback = Array.isArray(actionResult.feedback) && actionResult.feedback.length > 0;
                    if (!actionResult.ok || hasFeedback) uiState.abilityResultsByActor[result.actorId] = cloneUIValue(actionResult);
                    else delete uiState.abilityResultsByActor[result.actorId];
                }
                appendHistory(result.historyEntries || []);
                uiState.selectedAction = null;
                uiState.rawTurnNarrative = cloneUIValue(result.rawNarrativeFragments || result.narrativeFragments || []);
                uiState.narratedTurnNarrative = cloneUIValue(result.narratedNarrativeFragments || []);
                uiState.dynamicNarrationValid = Boolean(result.narrator && result.narrator.used);
                uiState.turnNarrative = cloneUIValue(result.narrativeFragments || []);
                currentTurnHiddenNarrative = cloneUIValue(result.hiddenNarrativeEntries || []);
                const committedRounds = result.timelapseResult && result.timelapseResult.committedRounds;
                uiState.locationStatus = committedRounds
                    ? `Timelapse stopped after ${committedRounds} committed round(s): ${friendlyAIError(result.error).message}`
                    : friendlyAIError(result.error).message;
            } else {
                uiState.locationStatus = result && result.error ? friendlyAIError(result.error).message : "The turn could not be completed.";
            }
            refreshCurrentPassage();
            return result;
        }

        const actionResult = result.intentResult && result.intentResult.actionResult;
        if (actionResult) {
            const hasFeedback = Array.isArray(actionResult.feedback) && actionResult.feedback.length > 0;
            if (!actionResult.ok || hasFeedback) uiState.abilityResultsByActor[result.actorId] = cloneUIValue(actionResult);
            else delete uiState.abilityResultsByActor[result.actorId];
        }
        appendHistory(result.historyEntries || []);
        uiState.selectedAction = null;
        uiState.rawTurnNarrative = cloneUIValue(result.rawNarrativeFragments || result.narrativeFragments || []);
        uiState.narratedTurnNarrative = cloneUIValue(result.narratedNarrativeFragments || []);
        uiState.dynamicNarrationValid = Boolean(result.narrator && result.narrator.used);
        uiState.turnNarrative = cloneUIValue(result.narrativeFragments || []);
        currentTurnHiddenNarrative = cloneUIValue(result.hiddenNarrativeEntries || []);
        if (result.waveResult && result.waveResult.paused) {
            uiState.locationStatus = `Intent submitted. Automatic AI processing is paused; ${result.waveResult.remainingQueue.count} turn(s) remain queued.`;
        } else if (result.waveResult && !result.waveResult.ok) {
            uiState.locationStatus = `Intent submitted, but AI processing stopped: ${friendlyAIError(result.waveResult.error).message}`;
        } else if (result.waveResult && result.waveResult.truncated) {
            uiState.locationStatus = result.waveResult.warning || "Turn complete, but the AI world tick hit its emergency limit.";
        } else if (result.timelapseResult && result.timelapseResult.ok) {
            uiState.locationStatus = result.timelapseResult.mode === "daytime"
                ? "Evening. The daytime timelapse is complete."
                : "Morning. The overnight timelapse is complete.";
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
        resetProgressiveTurnPresentation(uiState);
        runtimeTurnBusy = true;
        uiState.locationStatus = "Processing queued AI reactions...";
        renderSidebar();
        renderLocationView();
        renderActionPanel();

        let result;
        try {
            result = await setup.TurnFlow.pass(null, {
                onCommittedPresentation: function (batch) {
                    appendCommittedPresentation(uiState, batch);
                }
            });
        } finally {
            runtimeTurnBusy = false;
        }
        appendHistory(result && result.historyEntries || []);
        uiState.selectedAction = null;
        uiState.rawTurnNarrative = cloneUIValue(result && (result.rawNarrativeFragments || result.narrativeFragments) || []);
        uiState.narratedTurnNarrative = cloneUIValue(result && result.narratedNarrativeFragments || []);
        uiState.dynamicNarrationValid = Boolean(result && result.narrator && result.narrator.used);
        uiState.turnNarrative = cloneUIValue(result && result.narrativeFragments || []);
        currentTurnHiddenNarrative = cloneUIValue(result && result.hiddenNarrativeEntries || []);
        uiState.locationStatus = result && result.ok
            ? (result.waveResult && result.waveResult.truncated
                ? (result.waveResult.warning || "Pass completed, but the AI world tick hit its emergency limit.")
                : `Pass complete. ${result.waveResult.processedCount} AI character(s) reacted.`)
            : `AI processing stopped: ${result && result.error ? friendlyAIError(result.error).message : "Unknown error."}`;
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

    function syncEquipSlotSelect(view, itemId, preferredSlot) {
        const select = document.getElementById("action-equip-slot");
        if (!select) return;
        const options = view.available_actions.equip && view.available_actions.equip.options && view.available_actions.equip.options.items || [];
        const item = options.find(function (candidate) { return candidate.id === itemId; });
        select.replaceChildren();
        (item && item.slots || []).forEach(function (slot) {
            const option = document.createElement("option"); option.value = slot; option.textContent = slot; select.appendChild(option);
        });
        if (preferredSlot && item && item.slots.includes(preferredSlot)) select.value = preferredSlot;
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
        const usableItems = view.available_actions.use_item ? view.available_actions.use_item.options.items : [];
        const readableItems = view.available_actions.read_paper ? (view.available_actions.read_paper.options.item_ids || []).map(function (id) { return findViewItem(view, id); }).filter(Boolean) : [];
        const writableItems = view.available_actions.write_paper ? (view.available_actions.write_paper.options.item_ids || []).map(function (id) { return findViewItem(view, id); }).filter(Boolean) : [];
        const equipItems = view.available_actions.equip ? view.available_actions.equip.options.items : [];
        const unequipItems = view.available_actions.unequip ? view.available_actions.unequip.options.items : [];
        const unlockIds = view.available_actions.unlock ? view.available_actions.unlock.options.destination_ids : [];
        const lockIds = view.available_actions.lock ? view.available_actions.lock.options.destination_ids : [];
        const unlockDestinations = moveOptions.filter(function (destination) { return unlockIds.includes(destination.id); });
        const lockDestinations = moveOptions.filter(function (destination) { return lockIds.includes(destination.id); });
        const hiddenLocationOptions = view.available_actions.show_hidden_location && view.available_actions.show_hidden_location.options && view.available_actions.show_hidden_location.options.locations || [];
        const hiddenLocationTargets = hiddenLocationOptions.length ? hiddenLocationOptions[0].targets || [] : [];
        const knownActionTypes = new Set(["move", "unlock", "lock", "move_within_location", "take_item", "drop_item", "give_item", "give_money", "show_hidden_location", "read_paper", "write_paper", "place_item", "fill", "consume", "use_item", "equip", "unequip", "sleep", "go_hunting"]);
        const zeroInputExtras = Object.entries(view.available_actions).filter(function (entry) {
            return !knownActionTypes.has(entry[0]) && isZeroInputAbilityAction(entry[1]);
        });
        const aiSettings = setup.AIRuntimeSettings.getStatus();
        const queue = setup.AITurnScheduler.getQueueView();
        const busyState = getBusyState();
        const busy = busyState.busy;
        const selectedAction = selectedActionForView(view);
        const speechTargets = speechTargetsForView(view, selectedAction);
        const disabledAttribute = busy ? " disabled" : "";

        function radioField(actionType, legend, controls, unavailable) {
            const disabled = unavailable || busy;
            return `<fieldset class="framework-formal-action${unavailable ? " framework-formal-action-disabled" : ""}"${busy ? " disabled" : ""}>
                <legend><label><input type="radio" name="formal-action" value="${escapeHtml(actionType)}"${disabled ? " disabled" : ""}> ${escapeHtml(legend)}</label></legend>
                <div class="formal-action-parameters">${controls || ""}</div>
            </fieldset>`;
        }

        function equipSlotMarkup(itemId) {
            const item = equipItems.find(function (candidate) { return candidate.id === itemId; });
            return optionMarkup((item && item.slots || []).map(function (slot) { return { id: slot, name: slot }; }), "No free slot");
        }

        const formalMarkup = [
            radioField("move", "Move", `<select id="action-move-destination"${disabledAttribute}>${optionMarkup(moveOptions, "No connected locations")}</select>`, moveOptions.length === 0),
            radioField("unlock", "Unlock passage", `<select id="action-unlock-destination"${disabledAttribute}>${optionMarkup(unlockDestinations, "No lockable passage can be unlocked")}</select>`, unlockDestinations.length === 0),
            radioField("lock", "Lock passage", `<select id="action-lock-destination"${disabledAttribute}>${optionMarkup(lockDestinations, "No lockable passage can be locked")}</select>`, lockDestinations.length === 0),
            radioField("move_within_location", "Move within location", `<select id="action-move-within-destination"${disabledAttribute}>${optionMarkup(internalDestinations, "No internal destination")}</select>`, internalDestinations.length === 0),
            radioField("take_item", "Take item", `<select id="action-take-item"${disabledAttribute}>${optionMarkup(takeOptions, "No items here")}</select>`, takeOptions.length === 0),
            radioField("drop_item", "Drop item", `<select id="action-drop-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select>`, ownedItems.length === 0),
            radioField("give_item", "Give item", `<select id="action-give-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-give-item-target"${disabledAttribute}>${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, ownedItems.length === 0 || reachableTargets.length === 0),
            radioField("give_money", "Give money", `<input id="action-money-amount" type="number" min="1" step="1" value="1"${disabledAttribute}><select id="action-money-target"${disabledAttribute}>${optionMarkup(reachableTargets, "Nobody reachable")}</select>`, reachableTargets.length === 0),
            radioField("show_hidden_location", "Show hidden location", `<select id="action-show-hidden-location"${disabledAttribute}>${optionMarkup(hiddenLocationOptions, "No hidden location to show")}</select><select id="action-show-hidden-target"${disabledAttribute}>${optionMarkup(hiddenLocationTargets, "Nobody to show")}</select>`, hiddenLocationOptions.length === 0),
            radioField("read_paper", "Read paper", `<select id="action-read-paper"${disabledAttribute}>${optionMarkup(readableItems, "No readable paper")}</select>`, readableItems.length === 0),
            radioField("write_paper", "Write / draw on paper", `<select id="action-write-paper"${disabledAttribute}>${optionMarkup(writableItems, "No writable paper")}</select><textarea id="action-write-paper-content" rows="5" maxlength="12000" placeholder="Write text and/or *describe drawings* here"${disabledAttribute}></textarea>`, writableItems.length === 0),
            radioField("place_item", "Place item", `<select id="action-place-item"${disabledAttribute}>${optionMarkup(ownedItems, "Inventory is empty")}</select><select id="action-place-inventory"${disabledAttribute}>${optionMarkup(placementInventories, "No accessible surface")}</select>`, ownedItems.length === 0 || placementInventories.length === 0),
            radioField("fill", "Fill item", `<select id="action-fill-item"${disabledAttribute}>${itemActionOptionMarkup(fillItems, "No fillable item here")}</select>`, fillItems.length === 0),
            radioField("consume", "Consume item", `<select id="action-consume-item"${disabledAttribute}>${itemActionOptionMarkup(consumableItems, "No consumable item")}</select>`, consumableItems.length === 0),
            radioField("use_item", "Use item", `<select id="action-use-item"${disabledAttribute}>${itemActionOptionMarkup(usableItems, "No usable item")}</select><label id="action-use-item-input-wrap" hidden><span id="action-use-item-input-label">Input</span><input id="action-use-item-input" type="text" maxlength="600"${disabledAttribute}></label>`, usableItems.length === 0),
            radioField("equip", "Equip item", `<select id="action-equip-item"${disabledAttribute}>${optionMarkup(equipItems, "No wearable item")}</select><select id="action-equip-slot"${disabledAttribute}>${equipSlotMarkup(equipItems[0] && equipItems[0].id)}</select>`, equipItems.length === 0),
            radioField("unequip", "Unequip item", `<select id="action-unequip-item"${disabledAttribute}>${optionMarkup(unequipItems, "Nothing equipped")}</select>`, unequipItems.length === 0),
            radioField("sleep", "Sleep till morning", "<p>No parameters.</p>", !view.available_actions.sleep)
        ].concat(zeroInputExtras.map(function (entry) {
            return radioField(entry[0], entry[1].description || entry[0], "<p>No parameters.</p>", false);
        })).join("");

        actionRoot.innerHTML = `
            <div id="framework-action-status" class="framework-status"></div>

            <div class="framework-narrative-action">
                <textarea id="action-narrative-text" rows="1" placeholder="Say or do something..."${disabledAttribute}></textarea>
                <div class="framework-narrative-controls">
                    <label>Addressee<select id="action-narrative-target"${disabledAttribute}>
                        <option value="">No addressee</option>
                        ${speechTargets.map(function (target) { return `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`; }).join("")}
                    </select></label>
                    <label>Loudness<select id="action-narrative-noticeability"${disabledAttribute}>
                        <option value="noticeable">Normal</option>
                        <option value="hidden">Quiet / private</option>
                        <option value="shout"${selectedAction && selectedAction.type === "move" ? " disabled" : ""}>Shout</option>
                    </select></label>
                </div>
            </div>

            <section class="framework-selected-action">
                <div><strong>Selected action:</strong> <span id="selected-action-label">${escapeHtml(actionLabel(selectedAction, view))}</span></div>
                <button id="clear-selected-action" type="button"${(!selectedAction || busy) ? " disabled" : ""}>Clear</button>
            </section>

            <details class="framework-formal-action-section">
                <summary>Advanced actions <span class="framework-disclosure-arrow">▾</span></summary>
                <label class="framework-no-action"><input type="radio" name="formal-action" value=""${selectedAction ? "" : " checked"}${disabledAttribute}> No formal action</label>
                <div class="framework-action-grid">${formalMarkup}</div>
            </details>

            <div class="framework-turn-controls">
                <button id="action-submit"${busy ? " disabled" : ""}>Submit turn</button>
                <button id="action-pass"${busy ? " disabled" : ""}>Pass</button>
            </div>

        `;

        passage.appendChild(actionRoot);

        $("#action-narrative-target").val(uiState.interactionTargetId);
        $("#action-narrative-noticeability").val(uiState.narrativeNoticeability);
        syncSpeechControlsUI(view, selectedAction);
        const narrativeTextarea = document.getElementById("action-narrative-text");
        resizeNarrativeTextarea(narrativeTextarea);
        $("#action-narrative-text").on("input", function () {
            resizeNarrativeTextarea(this);
        });

        function collectFormalActionFromControls() {
            const type = $("input[name='formal-action']:checked").val();
            if (!type) return null;
            if (type === "move") return { type: type, destination_id: $("#action-move-destination").val() };
            if (type === "unlock") return { type: type, destination_id: $("#action-unlock-destination").val() };
            if (type === "lock") return { type: type, destination_id: $("#action-lock-destination").val() };
            if (type === "move_within_location") return { type: type, destination_id: $("#action-move-within-destination").val() };
            if (type === "take_item") return { type: type, item_id: $("#action-take-item").val() };
            if (type === "drop_item") return { type: type, item_id: $("#action-drop-item").val() };
            if (type === "give_item") return { type: type, item_id: $("#action-give-item").val(), target_id: $("#action-give-item-target").val() };
            if (type === "give_money") return { type: type, target_id: $("#action-money-target").val(), amount: Number($("#action-money-amount").val()) };
            if (type === "show_hidden_location") return { type: type, location_id: $("#action-show-hidden-location").val(), target_id: $("#action-show-hidden-target").val() };
            if (type === "read_paper") return { type: type, item_id: $("#action-read-paper").val() };
            if (type === "write_paper") return { type: type, item_id: $("#action-write-paper").val(), content: String($("#action-write-paper-content").val() || "") };
            if (type === "place_item") return { type: type, item_id: $("#action-place-item").val(), target_inventory_id: $("#action-place-inventory").val() };
            if (type === "equip") return { type: type, item_id: $("#action-equip-item").val(), slot: $("#action-equip-slot").val() };
            if (type === "unequip") return { type: type, item_id: $("#action-unequip-item").val() };
            if (type === "fill") return { type: type, item_id: $("#action-fill-item").val() };
            if (type === "consume") return { type: type, item_id: $("#action-consume-item").val() };
            if (type === "use_item") {
                const itemId = $("#action-use-item").val();
                const option = useItemOption(view, itemId);
                const result = { type: type, item_id: itemId };
                if (option && option.input_required) result.input_text = String($("#action-use-item-input").val() || "");
                return result;
            }
            return { type: type };
        }

        syncActionSelectionUI(view);
        syncUseItemInputUI(view, selectedActionForView(view));

        $("#action-use-item").on("change", function () {
            syncUseItemInputUI(view, { type: "use_item", item_id: $(this).val(), input_text: "" });
        });
        $("#action-equip-item").on("change", function () { syncEquipSlotSelect(view, $(this).val(), null); });
        $("#action-show-hidden-location").on("change", function () {
            const selected = hiddenLocationOptions.find(function (candidate) { return candidate.id === $("#action-show-hidden-location").val(); });
            const select = document.getElementById("action-show-hidden-target");
            if (!select) return;
            select.replaceChildren();
            (selected && selected.targets || []).forEach(function (target) { const option = document.createElement("option"); option.value = target.id; option.textContent = target.name; select.appendChild(option); });
        });

        $("#action-narrative-target").on("change", function () {
            uiState.interactionTargetId = uiState.narrativeNoticeability === "shout" ? "" : ($(this).val() || "");
            document.querySelectorAll(".framework-character-shortcut").forEach(function (button) {
                button.classList.toggle("is-selected", button.dataset.characterId === uiState.interactionTargetId);
            });
        });
        $("#action-narrative-noticeability").on("change", function () {
            const value = $(this).val();
            uiState.narrativeNoticeability = ["hidden", "shout"].includes(value) ? value : "noticeable";
            if (uiState.narrativeNoticeability === "shout") uiState.interactionTargetId = "";
            syncSpeechControlsUI(view, selectedActionForView(view));
        });

        $("input[name='formal-action']").on("change", function () {
            setSelectedAction($(this).val() ? collectFormalActionFromControls() : null, view);
        });
        $(".formal-action-parameters select, .formal-action-parameters input, .formal-action-parameters textarea").on("change input", function () {
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
            uiState.narrativeNoticeability = ["hidden", "shout"].includes($("#action-narrative-noticeability").val()) ? $("#action-narrative-noticeability").val() : "noticeable";
            uiState.interactionTargetId = uiState.narrativeNoticeability === "shout" ? "" : ($("#action-narrative-target").val() || "");
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

    function closeStartupOverlay() {
        const existing = document.getElementById("framework-startup-overlay");
        if (existing) existing.remove();
    }

    function clearGameplayForStartup() {
        const sidebar = document.getElementById("framework-sidebar");
        if (sidebar) sidebar.replaceChildren();
        const location = document.getElementById("location-view");
        if (location) location.replaceChildren();
        const actions = document.getElementById("framework-action-panel");
        if (actions) actions.remove();
    }

    function beginNonBlockingStartupWeather() {
        if (!setup.WorldEnvironment || typeof setup.WorldEnvironment.ensureWeatherInitialized !== "function") return;
        const status = setup.WorldEnvironment.getStatus ? setup.WorldEnvironment.getStatus() : null;
        if (status && status.weatherInitialized === true) { startupWeatherPending = false; return; }
        const capturedWorld = setup.Game.getWorld();
        const capturedIntentId = Number(capturedWorld && capturedWorld.nextIntentId || 0);
        const serial = ++startupWeatherRequestSerial;
        startupWeatherPending = true;
        Promise.resolve(setup.WorldEnvironment.ensureWeatherInitialized(null, {
            inFlightKey: "startup",
            shouldCommit: function () {
                return setup.Game.getWorld() === capturedWorld && Number(capturedWorld.nextIntentId || 0) === capturedIntentId;
            }
        })).catch(function () { return null; }).then(function () {
            if (serial !== startupWeatherRequestSerial) return;
            startupWeatherPending = false;
            if (setup.Game.getWorld() !== capturedWorld) return;
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        });
    }

    async function startGameplayAfterSetup() {
        closeStartupOverlay();
        if (!checkPhysicalPassageConsistency()) return;
        renderSidebar();
        renderLocationView();
        renderActionPanel();
        beginNonBlockingStartupWeather();
    }

    function renderStartupOverlayIfNeeded() {
        if (!setup.Game || !setup.Game.getPlayerSetup || setup.Game.isPlayerSetupComplete()) {
            closeStartupOverlay();
            return false;
        }
        ensureGlobalEmergencyDumpControl();
        clearGameplayForStartup();
        closeStartupOverlay();
        if (!aiSettingsInitialized && setup.AIRuntimeSettings) { setup.AIRuntimeSettings.readSaved(); aiSettingsInitialized = true; }
        const world = setup.Game.getWorld();
        const playerSetup = setup.Game.getPlayerSetup();
        const player = world.entities && world.entities.player;
        const overlay = document.createElement("div");
        overlay.id = "framework-startup-overlay";
        overlay.className = "framework-startup-overlay";
        const panel = document.createElement("section");
        panel.className = "framework-startup-panel";
        overlay.appendChild(panel);
        // Connect the blocking surface before wiring controls so document-level selectors
        // behave exactly as they do in normal gameplay UI.
        document.body.appendChild(overlay);

        if (setup.Game.isPublicDisclosureRequired && setup.Game.isPublicDisclosureRequired()) {
            appendPublicDisclosureContent(panel);
            const button = document.createElement("button");
            button.id = "framework-startup-disclaimer-ok";
            button.className = "framework-startup-primary";
            button.textContent = "Okay, fine";
            button.addEventListener("click", function () {
                const result = setup.Game.acceptPlayerDisclaimer();
                if (result.ok && !renderStartupOverlayIfNeeded()) void startGameplayAfterSetup();
            });
            panel.appendChild(button);
        } else if (!playerSetup.aiSetupAcknowledged) {
            const aiSettings = setup.AIRuntimeSettings.getStatus();
            appendTextElement(panel, "h2", "Connect AI");
            if (isPublicBuild()) {
                appendTextElement(panel, "p", "Mallowstead uses your own OpenRouter API key for AI requests. Requests may consume paid credits depending on the models you select and how much you play. You can add a key now, or continue and configure it later in Settings.");
                appendTextElement(panel, "p", "If you choose Remember for 7 days, the key is retained locally in this browser for up to seven days.");
                const links = document.createElement("p");
                links.className = "framework-startup-links";
                links.innerHTML = '<a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">Create an OpenRouter API key</a> · <a href="https://openrouter.ai/docs/quickstart" target="_blank" rel="noopener noreferrer">OpenRouter Quickstart</a>';
                panel.appendChild(links);
            }
            const keyRow = document.createElement("div");
            keyRow.className = "framework-startup-key-row";
            keyRow.innerHTML = `<label>OpenRouter API key <input id="framework-startup-api-key" type="password" autocomplete="off" placeholder="Paste a new key"></label><div><strong>Key status:</strong> ${keyStatusMarkup(aiSettings)}</div><label><input id="framework-startup-remember-key" type="checkbox"> Remember for 7 days</label><div><button id="framework-startup-save-key" type="button">Save key</button> <button id="framework-startup-forget-key" type="button">Forget key</button></div>`;
            panel.appendChild(keyRow);
            const status = document.createElement("p"); status.id = "framework-startup-status"; status.className = "framework-startup-status"; panel.appendChild(status);
            const continueButton = document.createElement("button");
            continueButton.className = "framework-startup-primary"; continueButton.textContent = "Continue";
            continueButton.addEventListener("click", function () { const result = setup.Game.acknowledgeAISetup(); if (!result.ok) status.textContent = result.error.message; else renderStartupOverlayIfNeeded(); });
            panel.appendChild(continueButton);
            $("#framework-startup-save-key").on("click", function () {
                const result = setup.AIRuntimeSettings.save($("#framework-startup-api-key").val(), $("#framework-startup-remember-key").prop("checked"));
                $("#framework-startup-api-key").val("");
                if (!result.ok) { status.textContent = result.error.message; return; }
                renderStartupOverlayIfNeeded();
            });
            $("#framework-startup-forget-key").on("click", function () { setup.AIRuntimeSettings.forget(); renderStartupOverlayIfNeeded(); });
        } else {
            appendTextElement(panel, "h2", "Choose your Traveler");
            appendTextElement(panel, "p", "The world provides the Traveler's starting place, inventory, equipment, and other world-bound state. Your choice here supplies only who that Traveler is.", "framework-startup-note");
            const libraryTools = document.createElement("div");
            libraryTools.className = "framework-startup-library-transfer";
            libraryTools.innerHTML = `<strong>My Characters</strong><div><button id="framework-startup-export-library" type="button">Export ZIP</button> <button id="framework-startup-import-library" type="button">Import ZIP</button><input id="framework-startup-import-library-file" type="file" accept="application/zip,.zip" hidden></div><div id="framework-startup-import-area">${pendingStarterImport ? starterImportConflictMarkup(pendingStarterImport) + '<button id="framework-startup-apply-import" type="button">Apply import</button>' : ""}</div>`;
            panel.appendChild(libraryTools);
            const libraryResult = setup.StarterCharacterLibrary ? setup.StarterCharacterLibrary.list() : { ok: true, characters: [] };
            const savedCharacters = libraryResult.ok ? libraryResult.characters : [];
            const choices = document.createElement("div"); choices.className = "framework-startup-choices";
            const generic = document.createElement("label"); generic.className = "framework-startup-choice";
            generic.innerHTML = `<input type="radio" name="framework-traveler-choice" value="generic" checked><strong>${escapeHtml(player && player.name || "Traveler")}</strong><span>${escapeHtml(player && player.playerDescription || "The generic Traveler.")}</span>`;
            choices.appendChild(generic);
            if (savedCharacters.length) {
                const heading = document.createElement("div"); heading.className = "framework-startup-choice-heading"; heading.textContent = "My Characters"; choices.appendChild(heading);
                savedCharacters.forEach(function (record) {
                    const label = document.createElement("label"); label.className = "framework-startup-choice";
                    label.innerHTML = `<input type="radio" name="framework-traveler-choice" value="saved:${escapeHtml(record.id)}"><strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.playerDescription)}</span>`;
                    choices.appendChild(label);
                });
            }
            const custom = document.createElement("label"); custom.className = "framework-startup-choice";
            custom.innerHTML = '<input type="radio" name="framework-traveler-choice" value="custom"><strong>New custom character</strong><span>Create a Traveler identity and optionally save it in this browser.</span>';
            choices.appendChild(custom); panel.appendChild(choices);

            const form = document.createElement("div"); form.id = "framework-startup-custom-form"; form.className = "framework-startup-custom is-hidden";
            form.innerHTML = `<label>Name<input id="framework-startup-custom-name" maxlength="120"></label><label>Visible description<textarea id="framework-startup-custom-visible" maxlength="2000"></textarea></label><label>Character authoring<textarea id="framework-startup-custom-ai" maxlength="4000"></textarea></label><div class="framework-startup-library-actions"><button id="framework-startup-save-preset" type="button">Save to My Characters</button><button id="framework-startup-duplicate-preset" type="button" class="is-hidden">Duplicate</button><button id="framework-startup-delete-preset" type="button" class="is-hidden">Delete</button></div>`;
            panel.appendChild(form);
            let editingPresetId = null;
            function authoringFromForm() { return { name: document.getElementById("framework-startup-custom-name").value, playerDescription: document.getElementById("framework-startup-custom-visible").value, aiDescription: document.getElementById("framework-startup-custom-ai").value }; }
            function fillForm(authoring, presetId) {
                editingPresetId = presetId || null;
                document.getElementById("framework-startup-custom-name").value = authoring && authoring.name || "";
                document.getElementById("framework-startup-custom-visible").value = authoring && authoring.playerDescription || "";
                document.getElementById("framework-startup-custom-ai").value = authoring && authoring.aiDescription || "";
                form.classList.remove("is-hidden");
                document.getElementById("framework-startup-save-preset").textContent = editingPresetId ? "Save changes" : "Save to My Characters";
                document.getElementById("framework-startup-duplicate-preset").classList.toggle("is-hidden", !editingPresetId);
                document.getElementById("framework-startup-delete-preset").classList.toggle("is-hidden", !editingPresetId);
            }
            function syncChoice() {
                const selected = panel.querySelector('input[name="framework-traveler-choice"]:checked');
                const value = selected && selected.value || "generic";
                if (value === "custom") return fillForm({ name: player && player.name || "Traveler", playerDescription: player && player.playerDescription || "", aiDescription: player && player.aiDescription || "" }, null);
                if (value.indexOf("saved:") === 0) {
                    const record = savedCharacters.find(function (candidate) { return candidate.id === value.slice(6); });
                    if (record) return fillForm(record, record.id);
                }
                editingPresetId = null; form.classList.add("is-hidden");
            }
            choices.addEventListener("change", syncChoice);
            const status = document.createElement("p"); status.id = "framework-startup-status"; status.className = "framework-startup-status"; panel.appendChild(status);
            document.getElementById("framework-startup-export-library").addEventListener("click", function () {
                const result = setup.StarterCharacterLibrary && setup.StarterCharacterLibrary.exportZip();
                status.textContent = result && result.ok ? `Exported ${(result.characters || []).length} starter character(s).` : (result && result.error && result.error.message || "Starter character export failed.");
            });
            document.getElementById("framework-startup-import-library").addEventListener("click", function () {
                const input = document.getElementById("framework-startup-import-library-file");
                if (input) input.click();
            });
            document.getElementById("framework-startup-import-library-file").addEventListener("change", async function () {
                const file = this.files && this.files[0];
                if (!file) return;
                try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const result = setup.StarterCharacterLibrary.parseImportBytes(bytes);
                    if (!result.ok) { status.textContent = result.error.message; return; }
                    pendingStarterImport = { characters: result.characters };
                    renderStartupOverlayIfNeeded();
                } catch (error) {
                    status.textContent = "The selected starter-character ZIP could not be read.";
                } finally {
                    this.value = "";
                }
            });
            const startupApplyImport = document.getElementById("framework-startup-apply-import");
            if (startupApplyImport) startupApplyImport.addEventListener("click", function () {
                if (!pendingStarterImport) return;
                const resolutions = {};
                panel.querySelectorAll(".framework-starter-conflict").forEach(function (select) { resolutions[select.dataset.starterId] = select.value; });
                const result = setup.StarterCharacterLibrary.mergeImported(pendingStarterImport.characters, resolutions);
                pendingStarterImport = null;
                if (!result.ok) { status.textContent = result.error.message; return; }
                renderStartupOverlayIfNeeded();
            });
            document.getElementById("framework-startup-save-preset").addEventListener("click", function () {
                const result = editingPresetId ? setup.StarterCharacterLibrary.update(editingPresetId, authoringFromForm()) : setup.StarterCharacterLibrary.saveNew(authoringFromForm());
                if (!result.ok) { status.textContent = result.error.message; return; }
                renderStartupOverlayIfNeeded();
            });
            document.getElementById("framework-startup-duplicate-preset").addEventListener("click", function () {
                const result = setup.StarterCharacterLibrary.saveNew(authoringFromForm());
                if (!result.ok) { status.textContent = result.error.message; return; }
                renderStartupOverlayIfNeeded();
            });
            document.getElementById("framework-startup-delete-preset").addEventListener("click", function () {
                if (!editingPresetId || !window.confirm("Delete this saved starter character from this browser?")) return;
                const result = setup.StarterCharacterLibrary.remove(editingPresetId);
                if (!result.ok) { status.textContent = result.error.message; return; }
                renderStartupOverlayIfNeeded();
            });
            const start = document.createElement("button"); start.id = "framework-startup-enter"; start.className = "framework-startup-primary"; start.textContent = "Enter world";
            start.addEventListener("click", function () {
                const selected = panel.querySelector('input[name="framework-traveler-choice"]:checked');
                const value = selected && selected.value || "generic";
                let input = { mode: "generic" };
                if (value === "custom" || value.indexOf("saved:") === 0) input = { mode: "custom", customAuthoring: authoringFromForm() };
                const result = setup.Game.finalizePlayerSetup(input);
                if (!result.ok) { status.textContent = result.error && result.error.message || "Traveler setup failed."; return; }
                void startGameplayAfterSetup();
            });
            panel.appendChild(start);
        }
        return true;
    }

    function closeMigrationOverlay() {
        const existing = document.getElementById("framework-migration-overlay");
        if (existing) existing.remove();
    }

    function renderMigrationOverlay(title, detail, failed) {
        ensureGlobalEmergencyDumpControl();
        closeMigrationOverlay();
        const overlay = document.createElement("div");
        overlay.id = "framework-migration-overlay";
        overlay.className = `framework-migration-overlay${failed ? " is-failed" : ""}`;
        overlay.setAttribute("role", failed ? "alert" : "status");
        overlay.setAttribute("aria-live", "assertive");
        const panel = document.createElement("section");
        panel.className = "framework-migration-panel";
        if (!failed) {
            const spinner = document.createElement("span");
            spinner.className = "framework-spinner is-visible";
            spinner.setAttribute("aria-hidden", "true");
            panel.appendChild(spinner);
        }
        appendTextElement(panel, "strong", title, "framework-migration-title");
        if (detail) appendTextElement(panel, "p", detail, "framework-migration-detail");
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    function yieldForMigrationPaint() {
        return new Promise(function (resolve) {
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(function () { setTimeout(resolve, 0); });
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    function resetPresentationAfterMigration() {
        currentTurnHiddenNarrative = [];
        resetStaticNarration("");
        const uiState = State.variables.frameworkUI;
        if (!uiState || typeof uiState !== "object") return;
        uiState.interactionTargetId = "";
        uiState.selectedAction = null;
        uiState.locationStatus = "";
        uiState.turnNarrative = [];
        uiState.rawTurnNarrative = [];
        uiState.narratedTurnNarrative = [];
        uiState.dynamicNarrationValid = false;
        runtimeTurnBusy = false;
        uiState.abilityResultsByActor = {};
    }

    async function migrateBeforeRender(bootstrapResult) {
        if (migrationUiInFlight) return;
        migrationUiInFlight = true;
        renderMigrationOverlay("Migrating save...", "Updating this playthrough to the current world version.", false);
        await yieldForMigrationPaint();

        const result = setup.SaveMigration.migrate();
        if (!result || !result.ok) {
            const message = result && result.error && result.error.message
                ? result.error.message
                : "Save migration failed. Your original save was not changed.";
            renderMigrationOverlay("Save migration failed.", message, true);
            migrationUiInFlight = false;
            return;
        }

        resetPresentationAfterMigration();
        const report = result.report || setup.SaveMigration.getLastReport();
        const withWarnings = Boolean(report && report.status === "success_with_warnings");
        renderMigrationOverlay(
            withWarnings ? "Save migrated with warnings." : "Save migrated successfully.",
            withWarnings ? "The playthrough was updated safely. Migration details are available in debug diagnostics." : "The playthrough is ready.",
            false
        );
        await new Promise(function (resolve) { setTimeout(resolve, 350); });
        closeMigrationOverlay();
        migrationUiInFlight = false;

        const postBootstrap = setup.Game.bootstrap();
        if (!postBootstrap.ok || postBootstrap.migrationRequired) {
            renderMigrationOverlay("Save migration failed.", "The migrated world did not enter a playable current state.", true);
            return;
        }
        if (renderStartupOverlayIfNeeded()) return;
        if (!checkPhysicalPassageConsistency()) return;
        renderSidebar();
        renderLocationView();
        renderActionPanel();
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

    registerSaveHistoryHooks();

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
        itemDisplayName: itemDisplayName,
        speechTargetsForView: speechTargetsForView,
        reconcileConversationState: reconcileConversationState,
        resizeNarrativeTextarea: resizeNarrativeTextarea,
        inlineRPMarkup: inlineRPMarkup,
        busyState: getBusyState,
        getInvisibleEventDebugState: function () {
            return { show: true, entries: cloneUIValue(currentTurnHiddenNarrative) };
        },
        getHistoryEntries: function () {
            getUIState();
            return cloneUIValue(historyEntries);
        },
        rawStaticFragments: rawStaticFragments,
        rawDynamicFragments: rawDynamicFragments,
        currentTurnPresentation: currentTurnPresentation,
        getStaticNarrationState: function () { return cloneUIValue(staticNarrationState); }
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
                const uiState = getUIState();
                uiState.interactionTargetId = "";
                uiState.selectedAction = null;
                uiState.turnNarrative = [];
                uiState.rawTurnNarrative = [];
                uiState.narratedTurnNarrative = [];
                uiState.dynamicNarrationValid = false;
                currentTurnHiddenNarrative = [];
                resetStaticNarration("");
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
            if (renderStartupOverlayIfNeeded()) return;
            renderSidebar();
            renderLocationView();
            renderActionPanel();
        }
    };

    $(document).on(":passageend", function () {
        const bootstrap = setup.Game.bootstrap();
        if (!bootstrap.ok) {
            const message = bootstrap.error && bootstrap.error.message || "The restored save cannot be opened.";
            renderMigrationOverlay("Save migration failed.", message, true);
            return;
        }
        if (bootstrap.migrationRequired) {
            void migrateBeforeRender(bootstrap);
            return;
        }
        if (renderStartupOverlayIfNeeded()) return;
        void startGameplayAfterSetup();
    });
}());
