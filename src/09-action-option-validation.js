(function () {
    "use strict";

    const OPTION_ARRAY_KEYS = Object.freeze({
        destination_id: "destination_ids",
        item_id: "item_ids",
        target_id: "target_ids",
        target_inventory_id: "target_inventory_ids",
        activity_id: "activity_ids",
        location_id: "location_ids",
        interaction_id: "interaction_ids",
        ability_id: "ability_ids",
        serving_action_id: "serving_action_ids"
    });

    function isPlainObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function validate(action, actionDefinition) {
        if (!isPlainObject(action) || !isPlainObject(actionDefinition)) return [];
        const options = isPlainObject(actionDefinition.options) ? actionDefinition.options : {};
        const issues = [];

        Object.entries(OPTION_ARRAY_KEYS).forEach(function (entry) {
            const propertyKey = entry[0];
            const optionKey = entry[1];
            if (!Object.prototype.hasOwnProperty.call(action, propertyKey) || !Array.isArray(options[optionKey])) return;
            if (!options[optionKey].includes(action[propertyKey])) {
                issues.push({
                    code: "unavailable_option",
                    field: propertyKey,
                    optionKey: optionKey,
                    value: action[propertyKey],
                    allowedValues: options[optionKey].slice()
                });
            }
        });

        if (action.type === "transfer_items" && Array.isArray(options.routes) && Array.isArray(action.item_ids)) {
            const route = options.routes.find(function (candidate) {
                return candidate && candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
            });
            if (!route) {
                issues.push({
                    code: "bulk_transfer_route_unavailable",
                    sourceInventoryId: action.source_inventory_id,
                    targetInventoryId: action.target_inventory_id
                });
            } else {
                const allowedItemIds = Array.isArray(route.item_ids) ? route.item_ids : [];
                const unavailableItemIds = action.item_ids.filter(function (itemId) { return !allowedItemIds.includes(itemId); });
                if (unavailableItemIds.length > 0) {
                    issues.push({
                        code: "bulk_transfer_item_unavailable",
                        itemIds: unavailableItemIds.slice(),
                        allowedItemIds: allowedItemIds.slice(),
                        sourceInventoryId: action.source_inventory_id,
                        targetInventoryId: action.target_inventory_id
                    });
                }
            }
        }

        if (action.type === "show_hidden_location" && Array.isArray(options.locations)) {
            const locationOption = options.locations.find(function (candidate) { return candidate && candidate.id === action.location_id; });
            if (!locationOption || !Array.isArray(locationOption.target_ids) || !locationOption.target_ids.includes(action.target_id)) {
                issues.push({
                    code: "hidden_location_target_unavailable",
                    locationId: action.location_id,
                    targetId: action.target_id
                });
            }
        }

        if (Object.prototype.hasOwnProperty.call(action, "amount") && typeof options.maximum_amount === "number" &&
                typeof action.amount === "number" && action.amount > options.maximum_amount) {
            issues.push({ code: "amount_exceeds_maximum", amount: action.amount, maximumAmount: options.maximum_amount });
        }

        if (action.type === "equip" && typeof action.item_id === "string" && typeof action.slot === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate && candidate.id === action.item_id; });
            if (!itemOption || !Array.isArray(itemOption.slots) || !itemOption.slots.includes(action.slot)) {
                issues.push({
                    code: "equip_slot_unavailable",
                    itemId: action.item_id,
                    slot: action.slot,
                    allowedSlots: itemOption && Array.isArray(itemOption.slots) ? itemOption.slots.slice() : []
                });
            }
        }

        if (action.type === "use_item" && typeof action.item_id === "string" && Array.isArray(options.items)) {
            const itemOption = options.items.find(function (candidate) { return candidate && candidate.id === action.item_id; });
            if (itemOption && itemOption.input_required) {
                const inputText = typeof action.input_text === "string" ? action.input_text.trim() : "";
                const maxLength = Number.isInteger(itemOption.input_max_length) ? itemOption.input_max_length : 600;
                if (!inputText) {
                    issues.push({
                        code: "item_input_required",
                        itemId: action.item_id,
                        actionLabel: itemOption.action_label || action.item_id,
                        maximumLength: maxLength
                    });
                } else if (inputText.length > maxLength) {
                    issues.push({
                        code: "item_input_too_long",
                        itemId: action.item_id,
                        actionLabel: itemOption.action_label || action.item_id,
                        maximumLength: maxLength,
                        actualLength: inputText.length
                    });
                }
            }
        }

        return issues;
    }

    setup.ActionOptionValidation = {
        OPTION_ARRAY_KEYS: OPTION_ARRAY_KEYS,
        validate: validate
    };
}());
