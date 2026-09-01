(function () {
    "use strict";

    function create(deps) {
        if (!deps || typeof deps !== "object") throw new Error("GameItemMechanics requires dependencies.");
        const { clone, ok, fail, getCharacter, getLocation, locationRequiresDiscovery, characterHasDiscoveredLocation, grantLocationDiscovery, characterRequiresDiscovery, characterHasDiscoveredCharacter, grantCharacterDiscovery, getSublocation, getSublocations, validateWorld, ensureWorld, nearbyCharacters } = deps;

    function getItemDefinition(itemOrDefinitionId, world) {
        const definitionId = typeof itemOrDefinitionId === "string"
            ? itemOrDefinitionId
            : itemOrDefinitionId && itemOrDefinitionId.definitionId;
        return definitionId && world.itemDefinitions
            ? world.itemDefinitions[definitionId] || null
            : null;
    }

    function itemInstanceDisplayName(item, world) {
        const definition = getItemDefinition(item, world);
        const canonicalName = definition ? definition.name : item && item.name || "Item";
        if (!item || !definition || definition.writable !== true) return canonicalName;
        const normalized = String(item.content || "")
            .replace(/\*/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!normalized) return canonicalName;
        const words = normalized.split(" ").filter(Boolean);
        const preview = words.slice(0, 5).join(" ");
        return `${canonicalName} — ${preview}${words.length > 5 ? "…" : ""}`;
    }

    function itemView(item, world) {
        const definition = getItemDefinition(item, world);
        return {
            id: item.id,
            name: definition ? definition.name : item.name,
            display_name: itemInstanceDisplayName(item, world),
            definition_id: definition ? definition.id : item.definitionId,
            family_id: definition ? definition.familyId : "",
            description: definition && typeof definition.description === "string" ? definition.description : "",
            tags: definition ? clone(definition.tags || []) : [],
            consumable: Boolean(definition && definition.consumable),
            equippable: Boolean(definition && Array.isArray(definition.equipSlots) && definition.equipSlots.length),
            equip_slots: definition ? clone(definition.equipSlots || []) : [],
            equipped_description: definition && typeof definition.equippedDescription === "string" ? definition.equippedDescription : "",
            fillable: Boolean(definition && definition.fillable),
            writable: Boolean(definition && definition.writable === true),
            writing_capability: Boolean(definition && definition.writingCapability === true)
        };
    }

    function equippedRecords(character) {
        return character && Array.isArray(character.equippedItems) ? character.equippedItems : [];
    }

    function equippedItemView(record, world) {
        const item = record && world.entities[record.itemId];
        if (!item || item.type !== "item") return null;
        const view = itemView(item, world);
        view.slot = record.slot;
        view.visible = record.visible !== false;
        return view;
    }

    function characterAppearanceText(character, world) {
        const fragments = [];
        const base = String(character && character.playerDescription || "").trim();
        if (base) fragments.push(base);
        const records = equippedRecords(character);
        if (!records.some(function (record) { return record.slot === "clothing"; })) {
            fragments.push(`${character.name} is undressed.`);
        }
        records.filter(function (record) { return record.visible !== false; }).forEach(function (record) {
            const item = world.entities[record.itemId];
            const definition = getItemDefinition(item, world);
            const description = definition && typeof definition.equippedDescription === "string"
                ? definition.equippedDescription.trim() : "";
            if (description) fragments.push(description);
        });
        return fragments.join(" ");
    }

    function actorDirectlyCarriesItem(actor, itemId, world) {
        const inventory = actor && world.inventories[actor.inventoryId];
        return Boolean(inventory && inventory.itemIds.includes(itemId));
    }

    function canAccessInventory(actor, inventory, world) {
        if (!inventory) return false;
        if (!inventory.requiredKeyItemId) return true;
        return actorDirectlyCarriesItem(actor, inventory.requiredKeyItemId, world);
    }

    function actorOwnsItem(actor, itemId, world) {
        return actorDirectlyCarriesItem(actor, itemId, world) || equippedRecords(actor).some(function (record) { return record.itemId === itemId; });
    }

    function transformItem(item, resultDefinitionId, world) {
        const definition = getItemDefinition(resultDefinitionId, world);
        if (!definition) {
            throw new Error(`Missing result item definition ${resultDefinitionId}.`);
        }
        item.definitionId = definition.id;
        item.name = definition.name;
        return item;
    }

    function itemConsumePlan(item, world) {
        const fromDefinition = getItemDefinition(item, world);
        const consumeAction = fromDefinition && fromDefinition.consumeAction;
        if (!item || !fromDefinition || !consumeAction) return fail("ITEM_NOT_CONSUMABLE", "This item cannot be consumed in its current state.");
        if (consumeAction.resultType === "transform") {
            const resultDefinition = getItemDefinition(consumeAction.resultDefinitionId, world);
            if (!resultDefinition) return fail("CONSUME_RESULT_INVALID", "The configured consume transform target is invalid.");
            return ok({ value: { resultType: "transform", fromDefinition: fromDefinition, consumeAction: consumeAction, resultDefinition: resultDefinition } });
        }
        if (consumeAction.resultType === "remove") {
            return ok({ value: { resultType: "remove", fromDefinition: fromDefinition, consumeAction: consumeAction, resultDefinition: null } });
        }
        return fail("CONSUME_RESULT_INVALID", "The configured consume result is invalid.");
    }

    function applyItemConsume(itemOrId, world) {
        const item = typeof itemOrId === "string" ? world.entities[itemOrId] : itemOrId;
        const planned = itemConsumePlan(item, world);
        if (!planned.ok) return planned;
        const plan = planned.value;
        const itemId = item.id;
        const fromDefinitionId = plan.fromDefinition.id;
        if (plan.resultType === "transform") {
            transformItem(item, plan.resultDefinition.id, world);
            return ok({ value: { itemId: itemId, resultType: "transform", fromDefinitionId: fromDefinitionId, toDefinitionId: item.definitionId, removed: false } });
        }
        const containerId = item.containerId;
        const inventory = world.inventories[containerId];
        if (inventory && Array.isArray(inventory.itemIds)) inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== itemId; });
        const owner = getCharacter(containerId, world);
        if (owner && Array.isArray(owner.equippedItems)) owner.equippedItems = owner.equippedItems.filter(function (record) { return record.itemId !== itemId; });
        delete world.entities[itemId];
        return ok({ value: { itemId: itemId, resultType: "remove", fromDefinitionId: fromDefinitionId, toDefinitionId: null, removed: true } });
    }


    function createGeneratedItemInstance(definitionId, inventoryId, world) {
        const definition = world.itemDefinitions && world.itemDefinitions[definitionId];
        const inventory = world.inventories && world.inventories[inventoryId];
        if (!definition || !inventory) throw new Error("Generated item definition or destination inventory is missing.");
        if (!Number.isInteger(world.nextGeneratedItemId) || world.nextGeneratedItemId < 1) world.nextGeneratedItemId = 1;
        let id;
        do { id = `generated_${definition.id}_${world.nextGeneratedItemId++}`; } while (world.entities[id]);
        world.entities[id] = { id: id, type: "item", definitionId: definition.id, name: definition.name, containerId: inventory.id };
        inventory.itemIds.push(id);
        return id;
    }

    function renderAuthoredOutcomeText(template, actor, details) {
        const values = Object.assign({ actorName: actor && actor.name || "Someone" }, details || {});
        return String(template || "").replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (_, key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`;
        });
    }

    function authoredOutcomeEffectApplicable(effect, actor, world) {
        if (!effect || typeof effect !== "object") return false;
        if (effect.type === "emit_observation") return typeof effect.text === "string" && Boolean(effect.text.trim());
        if (effect.type === "reveal_location") {
            return Boolean(getLocation(effect.locationId, world) && locationRequiresDiscovery(effect.locationId, world) &&
                !characterHasDiscoveredLocation(actor, effect.locationId, world));
        }
        if (effect.type === "encounter_character") {
            const target = getCharacter(effect.characterId, world);
            return Boolean(target && characterRequiresDiscovery(target, world) && !characterHasDiscoveredCharacter(actor, target, world) &&
                target.locationId === actor.locationId && (!setup.Presence || setup.Presence.isLocallyPresent(target, world)));
        }
        if (effect.type === "modify_wallet") {
            return effect.target === "actor" && Number.isInteger(effect.amount) && effect.amount !== 0 &&
                Number.isInteger(actor.wallet) && actor.wallet + effect.amount >= 0;
        }
        if (effect.type === "create_item") {
            return effect.destination === "actor_inventory" && Boolean(world.itemDefinitions && world.itemDefinitions[effect.itemDefinitionId]) &&
                Number.isInteger(effect.quantity || 1) && (effect.quantity || 1) > 0 && Boolean(world.inventories[actor.inventoryId]);
        }
        return false;
    }

    function authoredOutcomeApplicable(outcome, actor, world) {
        return Boolean(outcome && Array.isArray(outcome.effects) && outcome.effects.length > 0 &&
            outcome.effects.every(function (effect) { return authoredOutcomeEffectApplicable(effect, actor, world); }));
    }

    function eligibleAuthoredOutcomeRecords(actor, table, world) {
        const consumed = new Set(Array.isArray(world.consumedAuthoredOutcomeIds) ? world.consumedAuthoredOutcomeIds : []);
        return (table && Array.isArray(table.outcomes) ? table.outcomes : []).filter(function (outcome) {
            return outcome && !(outcome.once === true && consumed.has(outcome.id)) && authoredOutcomeApplicable(outcome, actor, world);
        });
    }

    function authoredOutcomeTableCanAffect(actor, table, world) {
        return Boolean(table && eligibleAuthoredOutcomeRecords(actor, table, world).length > 0);
    }

    function executeAuthoredOutcomeEffects(actor, outcome, world, context) {
        const events = [];
        const createdItemIds = [];
        (outcome.effects || []).forEach(function (effect) {
            if (!authoredOutcomeEffectApplicable(effect, actor, world)) throw new Error(`Authored outcome effect '${String(effect.type)}' is not applicable.`);
            if (effect.type === "emit_observation") {
                const eventData = setup.AuthoredEffects && setup.AuthoredEffects.createObservationEventData
                    ? setup.AuthoredEffects.createObservationEventData(Object.assign({}, effect, { text: renderAuthoredOutcomeText(effect.text, actor, {}) }), {
                        eventType: "authored_outcome_observed", actorId: actor.id, locationId: actor.locationId, sublocationId: actor.sublocationId
                    })
                    : { type: "authored_outcome_observed", actorId: actor.id, locationId: actor.locationId, sublocationId: actor.sublocationId, text: renderAuthoredOutcomeText(effect.text, actor, {}), authoredEffectType: "emit_observation" };
                eventData.actionType = context && context.actionType || "authored_outcome";
                eventData.outcomeId = outcome.id;
                eventData.authoredInteractionId = context && context.authoredInteractionId || null;
                events.push(eventData);
            } else if (effect.type === "reveal_location") {
                const location = getLocation(effect.locationId, world);
                if (!grantLocationDiscovery(actor, location.id, world)) throw new Error(`Location '${location.id}' could not be discovered.`);
                events.push({
                    type: "location_discovered", actorId: actor.id, targetId: actor.id, locationId: actor.locationId,
                    revealedLocationId: location.id, actionType: context && context.actionType || "authored_outcome", outcomeId: outcome.id,
                    text: renderAuthoredOutcomeText(effect.observationText || `${actor.name} discovered ${location.name}.`, actor, { locationName: location.name })
                });
            } else if (effect.type === "encounter_character") {
                const target = getCharacter(effect.characterId, world);
                if (!grantCharacterDiscovery(actor, target, world)) throw new Error(`Character '${target.id}' could not be discovered.`);
                events.push({
                    type: "character_discovered", actorId: actor.id, targetId: target.id, locationId: actor.locationId,
                    discoveredCharacterId: target.id, actionType: context && context.actionType || "authored_outcome", outcomeId: outcome.id,
                    text: renderAuthoredOutcomeText(effect.observationText || `${actor.name} encounters ${target.name}.`, actor, { characterName: target.name })
                });
            } else if (effect.type === "modify_wallet") {
                actor.wallet += effect.amount;
            } else if (effect.type === "create_item") {
                const count = effect.quantity || 1;
                for (let index = 0; index < count; index++) createdItemIds.push(createGeneratedItemInstance(effect.itemDefinitionId, actor.inventoryId, world));
            }
        });
        return { events: events, createdItemIds: createdItemIds };
    }

    function restoreWorldObject(target, snapshot) {
        Object.keys(target).forEach(function (key) { delete target[key]; });
        Object.assign(target, clone(snapshot));
    }

    function runAuthoredOutcomeTable(actorOrId, tableId, world, options) {
        const w = world || ensureWorld();
        const actor = typeof actorOrId === "string" ? getCharacter(actorOrId, w) : actorOrId;
        const table = w.randomOutcomeTables && w.randomOutcomeTables[tableId];
        if (!actor) return fail("OUTCOME_ACTOR_INVALID", "Authored outcome actor does not exist.");
        if (!table) return fail("OUTCOME_TABLE_INVALID", `Random outcome table '${String(tableId)}' does not exist.`);
        const eligible = eligibleAuthoredOutcomeRecords(actor, table, w);
        const noOutcomeWeight = Number(table.noOutcomeWeight || 0);
        const total = noOutcomeWeight + eligible.reduce(function (sum, outcome) { return sum + Number(outcome.weight || 0); }, 0);
        if (!(total > 0)) return fail("OUTCOME_NONE_APPLICABLE", "No authored outcome is currently applicable.");
        const random = options && typeof options.random === "function" ? options.random : Math.random;
        let roll = Number(random());
        if (!Number.isFinite(roll)) roll = 0;
        roll = Math.max(0, Math.min(roll, 0.9999999999999999)) * total;
        if (roll < noOutcomeWeight) return ok({ selectedOutcomeId: null, noOutcome: true, events: [], createdItemIds: [] });
        roll -= noOutcomeWeight;
        let selected = null;
        for (const outcome of eligible) {
            if (roll < outcome.weight) { selected = outcome; break; }
            roll -= outcome.weight;
        }
        selected = selected || eligible[eligible.length - 1];
        if (!selected) return ok({ selectedOutcomeId: null, noOutcome: true, events: [], createdItemIds: [] });

        const snapshot = clone(w);
        try {
            const liveActor = getCharacter(actor.id, w);
            if (!liveActor) throw Object.assign(new Error("Authored outcome actor disappeared before execution."), { code: "OUTCOME_ACTOR_INVALID" });
            const executed = executeAuthoredOutcomeEffects(liveActor, selected, w, options || {});
            if (selected.once === true) {
                if (!Array.isArray(w.consumedAuthoredOutcomeIds)) w.consumedAuthoredOutcomeIds = [];
                if (!w.consumedAuthoredOutcomeIds.includes(selected.id)) w.consumedAuthoredOutcomeIds.push(selected.id);
            }
            const invariant = validateWorld(w);
            if (!invariant.ok) throw Object.assign(new Error(invariant.error.message), { code: invariant.error.code || "OUTCOME_WORLD_INVALID" });
            return ok({ selectedOutcomeId: selected.id, noOutcome: false, events: executed.events, createdItemIds: executed.createdItemIds });
        } catch (error) {
            restoreWorldObject(w, snapshot);
            return fail(error && error.code || "OUTCOME_EXECUTION_FAILED", error && error.message || "Authored outcome execution failed.");
        }
    }

    function authoredInteractionRecords(actor, world) {
        const sublocation = getSublocation(actor && actor.sublocationId, world);
        if (!sublocation || !Array.isArray(sublocation.interactions)) return [];
        return sublocation.interactions.filter(function (interaction) {
            const table = world.randomOutcomeTables && world.randomOutcomeTables[interaction.outcomeTableId];
            return interaction && interaction.effectId === "random_outcome" && table && authoredOutcomeTableCanAffect(actor, table, world);
        });
    }


    function accessibleInventories(actor, world) {
        const location = getLocation(actor.locationId, world);
        const sublocation = getSublocation(actor.sublocationId, world);
        const inventoryIds = [location.inventoryId];
        if (sublocation.inventoryId) {
            inventoryIds.push(sublocation.inventoryId);
        }
        return inventoryIds.map(function (inventoryId) {
            return world.inventories[inventoryId];
        }).filter(function (inventory) {
            return canAccessInventory(actor, inventory, world);
        });
    }

    function observableTransparentInventories(actor, world) {
        const location = getLocation(actor.locationId, world);
        const actorPosition = getSublocation(actor.sublocationId, world);
        if (!location || !actorPosition) return [];
        const candidateIds = new Set();
        if (location.inventoryId) candidateIds.add(location.inventoryId);
        getSublocations(location.id, world).forEach(function (sublocation) {
            if (!sublocation || !sublocation.inventoryId || sublocation.transparent !== true) return;
            if (sublocation.id === actor.sublocationId || (actorPosition.reachableSublocationIds || []).includes(sublocation.id)) {
                candidateIds.add(sublocation.inventoryId);
            }
        });
        return Array.from(candidateIds).map(function (inventoryId) { return world.inventories[inventoryId]; }).filter(function (inventory) {
            return inventory && inventory.transparent === true && !canAccessInventory(actor, inventory, world);
        });
    }

    function canReachCharacter(actor, target, world) {
        if (!actor || !target || actor.locationId !== target.locationId) {
            return false;
        }
        if (!characterHasDiscoveredCharacter(actor, target, world)) return false;
        if (setup.Presence && (!setup.Presence.isLocallyPresent(actor, world) || !setup.Presence.isLocallyPresent(target, world))) {
            return false;
        }
        const actorPosition = getSublocation(actor.sublocationId, world);
        return Boolean(actorPosition &&
            (actor.sublocationId === target.sublocationId ||
                (actorPosition.reachableSublocationIds || []).includes(target.sublocationId)));
    }

    function inventoryOwnerLabel(inventory, world) {
        if (!inventory) return "inventory";
        const owner = world.entities[inventory.ownerId];
        return inventory.name || (owner && owner.name) || inventory.id;
    }

    function bulkTransferRoutes(actor, world) {
        const actorInventory = world.inventories[actor.inventoryId];
        if (!actorInventory) return [];
        const routes = [];
        nearbyCharacters(actor, world).filter(function (character) {
            return canReachCharacter(actor, character, world);
        }).forEach(function (character) {
            const targetInventory = world.inventories[character.inventoryId];
            if (!targetInventory || actorInventory.itemIds.length === 0) return;
            routes.push({
                source_inventory_id: actorInventory.id,
                target_inventory_id: targetInventory.id,
                target_character_id: character.id,
                direction: "character_to_character",
                label: `Give items to ${character.name}`,
                item_ids: actorInventory.itemIds.slice()
            });
        });
        accessibleInventories(actor, world).forEach(function (inventory) {
            if (!inventory || inventory.id === actorInventory.id) return;
            if (actorInventory.itemIds.length > 0) {
                routes.push({
                    source_inventory_id: actorInventory.id,
                    target_inventory_id: inventory.id,
                    direction: "character_to_container",
                    label: `Put items in ${inventoryOwnerLabel(inventory, world)}`,
                    item_ids: actorInventory.itemIds.slice()
                });
            }
            if (inventory.itemIds.length > 0) {
                routes.push({
                    source_inventory_id: inventory.id,
                    target_inventory_id: actorInventory.id,
                    direction: "container_to_character",
                    label: `Take items from ${inventoryOwnerLabel(inventory, world)}`,
                    item_ids: inventory.itemIds.slice()
                });
            }
        });
        return routes;
    }

    function accessibleLooseItemEntries(actor, world) {
        const inventories = [world.inventories[actor.inventoryId]].concat(accessibleInventories(actor, world));
        const seen = new Set();
        const result = [];
        inventories.forEach(function (inventory) {
            if (!inventory || !canAccessInventory(actor, inventory, world)) return;
            inventory.itemIds.forEach(function (itemId) {
                if (seen.has(itemId)) return;
                const item = world.entities[itemId];
                if (!item || item.type !== "item") return;
                seen.add(itemId);
                result.push({ item: item, inventory: inventory, definition: getItemDefinition(item, world) });
            });
        });
        return result;
    }

    function hasWritingCapability(actor, world) {
        return accessibleLooseItemEntries(actor, world).some(function (entry) {
            return entry.definition && entry.definition.writingCapability === true;
        });
    }

    function writableItemEntries(actor, world) {
        return accessibleLooseItemEntries(actor, world).filter(function (entry) {
            return entry.definition && entry.definition.writable === true;
        });
    }

    function positionText(character, world) {
        const sublocation = getSublocation(character.sublocationId, world);
        return (sublocation.occupantTemplate || "{name} is here.")
            .replace("{name}", character.name);
    }


    function transferItem(itemId, sourceInventory, targetInventory, world) {
        sourceInventory.itemIds = sourceInventory.itemIds.filter(function (id) {
            return id !== itemId;
        });
        targetInventory.itemIds.push(itemId);
        world.entities[itemId].containerId = targetInventory.id;
        if (setup.TradeLifecycle && typeof setup.TradeLifecycle.noteItemTransfer === "function") {
            setup.TradeLifecycle.noteItemTransfer(world.entities[itemId], sourceInventory, targetInventory, world);
        }
    }


        return {
            getItemDefinition: getItemDefinition,
            itemInstanceDisplayName: itemInstanceDisplayName,
            itemView: itemView,
            equippedRecords: equippedRecords,
            equippedItemView: equippedItemView,
            characterAppearanceText: characterAppearanceText,
            actorDirectlyCarriesItem: actorDirectlyCarriesItem,
            canAccessInventory: canAccessInventory,
            actorOwnsItem: actorOwnsItem,
            transformItem: transformItem,
            itemConsumePlan: itemConsumePlan,
            applyItemConsume: applyItemConsume,
            createGeneratedItemInstance: createGeneratedItemInstance,
            renderAuthoredOutcomeText: renderAuthoredOutcomeText,
            authoredOutcomeEffectApplicable: authoredOutcomeEffectApplicable,
            authoredOutcomeApplicable: authoredOutcomeApplicable,
            eligibleAuthoredOutcomeRecords: eligibleAuthoredOutcomeRecords,
            authoredOutcomeTableCanAffect: authoredOutcomeTableCanAffect,
            executeAuthoredOutcomeEffects: executeAuthoredOutcomeEffects,
            restoreWorldObject: restoreWorldObject,
            runAuthoredOutcomeTable: runAuthoredOutcomeTable,
            authoredInteractionRecords: authoredInteractionRecords,
            accessibleInventories: accessibleInventories,
            observableTransparentInventories: observableTransparentInventories,
            canReachCharacter: canReachCharacter,
            inventoryOwnerLabel: inventoryOwnerLabel,
            bulkTransferRoutes: bulkTransferRoutes,
            accessibleLooseItemEntries: accessibleLooseItemEntries,
            hasWritingCapability: hasWritingCapability,
            writableItemEntries: writableItemEntries,
            positionText: positionText,
            transferItem: transferItem
        };
    }

    setup.GameItemMechanics = { create: create };
}());
