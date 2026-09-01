(function () {
    "use strict";

    function create(deps) {
        if (!deps || typeof deps !== "object") throw new Error("GameActions requires dependencies.");
        const { clone, ok, fail, getCharacter, getLocation, locationRequiresDiscovery, characterHasDiscoveredLocation, grantLocationDiscovery, locationExitEntriesForActor, locationExitEntries, findLocationExit, matchingKeyItems, lockActionOptions, validateLockAction, setPassageLocked, getSublocation, getItemDefinition, equippedRecords, canAccessInventory, actorOwnsItem, transformItem, itemConsumePlan, applyItemConsume, runAuthoredOutcomeTable, authoredInteractionRecords, sublocationOccupants, effectiveSleepCapacity, sleepingSublocationOccupants, accessibleInventories, canReachCharacter, bulkTransferRoutes, hasWritingCapability, writableItemEntries, positionText, ensureWorld, getHumanCharacterId, nearbyCharacters, transferItem, renderItemActionText, groundedMoveSpeechTargets, getCharacterView, ItemEffectRegistry, BASE_ACTION_TYPES } = deps;

    const AbilityEffectRegistry = {
        read_aura: {
            execute: function (actor, ability, world) {
                const visibleCharacters = getCharacterView(actor.id).location.characters;
                const results = visibleCharacters.map(function (visibleCharacter) {
                    const target = getCharacter(visibleCharacter.id, world);
                    const authoredAura = target && target.engineFacts && typeof target.engineFacts.aura === "string" ? target.engineFacts.aura.trim() : "";
                    return { characterId: visibleCharacter.id, name: visibleCharacter.name, aura: authoredAura || "You perceive nothing unusual." };
                });
                const feedbackText = results.length > 0
                    ? ["You read the nearby auras."].concat(results.map(function (result) { return `${result.name}: ${result.aura}`; })).join("\n")
                    : "You sense no other auras nearby.";
                return { events: [], feedback: [{ recipientId: actor.id, kind: "observation", code: "AURA_SCAN_RESULT", text: feedbackText, data: { abilityId: ability.id, results: results } }] };
            }
        },
        emit_location_observation: {
            execute: function (actor, ability) {
                const publicText = renderItemActionText(ability.publicText, { actorName: actor.name });
                return {
                    events: [{ type: "authored_ability_observation", actorId: actor.id, abilityId: ability.id, locationId: actor.locationId, sublocationId: actor.sublocationId, text: publicText }],
                    feedback: [{ recipientId: actor.id, kind: "observation", code: "ABILITY_USED", text: ability.feedbackText, data: { abilityId: ability.id } }]
                };
            }
        }
    };

    const ActionRegistry = {
        move: {
            description: "Leave the current location and enter another directly connected location. destination_id must be one of this action's listed location IDs.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "move" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                const location = getLocation(actor.locationId, world);
                const destinationIds = locationExitEntriesForActor(location, actor, world).map(function (entry) {
                    return entry.destinationId;
                }).filter(Boolean);
                const speechTargetsByDestination = {};
                destinationIds.forEach(function (destinationId) {
                    const targets = groundedMoveSpeechTargets(actor, destinationId, world);
                    if (targets.length > 0) speechTargetsByDestination[destinationId] = targets;
                });
                return {
                    destination_ids: destinationIds,
                    speech_targets_by_destination: speechTargetsByDestination
                };
            },
            validate: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                const destination = getLocation(action.destination_id, world);

                if (!destination || (setup.Presence && !setup.Presence.isLocationAvailable(destination, world))) {
                    return fail("DESTINATION_NOT_FOUND", "Destination does not exist or is not currently present in the local world.");
                }
                if (!characterHasDiscoveredLocation(actor, destination.id, world)) {
                    return fail("DESTINATION_UNDISCOVERED", "That destination has not been discovered by this character.");
                }

                const transition = findLocationExit(location, destination.id);
                if (!transition) {
                    return fail(
                        "DESTINATION_NOT_REACHABLE",
                        "Destination is not connected to the current location."
                    );
                }

                if (transition.blocked) {
                    return fail("TRANSITION_BLOCKED", transition.blockedReason.trim() || "The way is blocked.");
                }
                if (transition.lockId && transition.locked) {
                    return fail("PASSAGE_LOCKED", transition.lockedReason.trim() || "The door is locked.");
                }

                const defaultPosition = getSublocation(destination.defaultSublocationId, world);
                if (!defaultPosition) {
                    return fail("DESTINATION_SUBLOCATION_INVALID", "Destination has no valid default position.");
                }
                if (sublocationOccupants(defaultPosition.id, world, actor.id).length >= defaultPosition.capacity) {
                    return fail("SUBLOCATION_FULL", "The destination's default position is full.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const fromLocationId = actor.locationId;
                const fromSublocationId = actor.sublocationId;
                const destination = getLocation(action.destination_id, world);
                actor.locationId = action.destination_id;
                actor.sublocationId = destination.defaultSublocationId;
                return [{
                    type: "character_moved",
                    actorId: actor.id,
                    locationId: action.destination_id,
                    fromLocationId: fromLocationId,
                    toLocationId: action.destination_id,
                    fromSublocationId: fromSublocationId,
                    toSublocationId: actor.sublocationId,
                    text: `${actor.name} moved from ${getLocation(fromLocationId, world).name} to ${destination.name}.`
                }];
            }
        },

        unlock: {
            description: "Unlock a directly connected lockable passage using a matching key.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "unlock" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                return lockActionOptions(actor, world, true);
            },
            validate: function (actor, action, world) {
                return validateLockAction(actor, action, world, true);
            },
            execute: function (actor, action, world) {
                const destination = getLocation(action.destination_id, world);
                const transition = setPassageLocked(actor.locationId, action.destination_id, false, world);
                return [{
                    type: "passage_unlocked",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    destinationId: action.destination_id,
                    lockId: transition.lockId,
                    text: `${actor.name} unlocked the door to ${destination.name}.`
                }];
            }
        },

        lock: {
            description: "Lock a directly connected lockable passage using a matching key.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "lock" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                return lockActionOptions(actor, world, false);
            },
            validate: function (actor, action, world) {
                return validateLockAction(actor, action, world, false);
            },
            execute: function (actor, action, world) {
                const destination = getLocation(action.destination_id, world);
                const transition = setPassageLocked(actor.locationId, action.destination_id, true, world);
                return [{
                    type: "passage_locked",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    destinationId: action.destination_id,
                    lockId: transition.lockId,
                    text: `${actor.name} locked the door to ${destination.name}.`
                }];
            }
        },

        move_within_location: {
            description: "Stay in the current location and change only the current sublocation/position. destination_id must be one of this action's listed sublocation IDs, never a location ID.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "move_within_location" },
                    destination_id: { type: "string" }
                },
                required: ["type", "destination_id"]
            },
            getOptions: function (actor, world) {
                const current = getSublocation(actor.sublocationId, world);
                return {
                    destination_ids: (current.reachableSublocationIds || []).filter(function (id) {
                        const destination = getSublocation(id, world);
                        return id !== actor.sublocationId && destination &&
                            (!setup.Presence || setup.Presence.isSublocationAvailable(destination, world)) &&
                            sublocationOccupants(id, world, actor.id).length < destination.capacity;
                    })
                };
            },
            validate: function (actor, action, world) {
                const current = getSublocation(actor.sublocationId, world);
                const destination = getSublocation(action.destination_id, world);
                if (!destination) {
                    return fail("SUBLOCATION_NOT_FOUND", "Destination position does not exist.");
                }
                if (destination.locationId !== actor.locationId) {
                    return fail("SUBLOCATION_WRONG_LOCATION", "Destination position is in another major location.");
                }
                if (setup.Presence && !setup.Presence.isSublocationAvailable(destination, world)) {
                    return fail("SUBLOCATION_NOT_AVAILABLE", "Destination position is not currently available in the local world.");
                }
                if (destination.id === actor.sublocationId) {
                    return fail("ALREADY_AT_SUBLOCATION", "Actor is already at that position.");
                }
                if (!(current.reachableSublocationIds || []).includes(destination.id)) {
                    return fail("SUBLOCATION_NOT_REACHABLE", "Destination position is not reachable from here.");
                }
                if (sublocationOccupants(destination.id, world, actor.id).length >= destination.capacity) {
                    return fail("SUBLOCATION_FULL", "Destination position is full.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const fromSublocationId = actor.sublocationId;
                actor.sublocationId = action.destination_id;
                return [{
                    type: "character_changed_sublocation",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    fromSublocationId: fromSublocationId,
                    toSublocationId: action.destination_id,
                    text: positionText(actor, world)
                }];
            }
        },

        take_item: {
            description: "Take an item from the current location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "take_item" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    item_ids: accessibleInventories(actor, world).flatMap(function (inventory) {
                        return inventory.itemIds;
                    })
                };
            },
            validate: function (actor, action, world) {
                const item = world.entities[action.item_id];

                if (!item || item.type !== "item") {
                    return fail("ITEM_NOT_FOUND", "Item does not exist.");
                }

                if (!accessibleInventories(actor, world).some(function (inventory) {
                    return inventory.itemIds.includes(item.id);
                })) {
                    return fail(
                        "ITEM_NOT_ACCESSIBLE",
                        "Item is not in an inventory accessible from the current position."
                    );
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const sourceInventory = world.inventories[world.entities[action.item_id].containerId];
                transferItem(
                    action.item_id,
                    sourceInventory,
                    world.inventories[actor.inventoryId],
                    world
                );

                return [{
                    type: "item_taken",
                    actorId: actor.id,
                    itemId: action.item_id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} took ${world.entities[action.item_id].name}.`
                }];
            }
        },

        drop_item: {
            description: "Drop an owned item in the current location.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "drop_item" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice()
                };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const location = getLocation(actor.locationId, world);
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[location.inventoryId],
                    world
                );

                return [{
                    type: "item_dropped",
                    actorId: actor.id,
                    itemId: action.item_id,
                    locationId: location.id,
                    text: `${actor.name} dropped ${world.entities[action.item_id].name}.`
                }];
            }
        },

        give_item: {
            description: "Give an owned item to another character nearby.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "give_item" },
                    target_id: { type: "string" },
                    item_id: { type: "string" }
                },
                required: ["type", "target_id", "item_id"]
            },
            getOptions: function (actor, world) {
                return {
                    target_ids: nearbyCharacters(actor, world).filter(function (character) {
                        return canReachCharacter(actor, character, world);
                    }).map(function (character) {
                        return character.id;
                    }),
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice()
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);

                if (!target) {
                    return fail("TARGET_NOT_FOUND", "Target character does not exist.");
                }

                if (target.id === actor.id) {
                    return fail("INVALID_TARGET", "A character cannot give to itself.");
                }

                if (!canReachCharacter(actor, target, world)) {
                    return fail("TARGET_NOT_REACHABLE", "Target cannot be reached from the actor's current position.");
                }

                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[target.inventoryId],
                    world
                );

                return [{
                    type: "item_transferred",
                    actorId: actor.id,
                    targetId: target.id,
                    itemId: action.item_id,
                    locationId: actor.locationId,
                    text: `${actor.name} gave ${world.entities[action.item_id].name} to ${target.name}.`
                }];
            }
        },

        transfer_items: {
            description: "Transfer an explicit bundle of loose item instances between the actor, a nearby character, or an accessible local container. The whole bundle succeeds or fails atomically.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "transfer_items" },
                    source_inventory_id: { type: "string" },
                    target_inventory_id: { type: "string" },
                    item_ids: { type: "array", minItems: 1, items: { type: "string" } }
                },
                required: ["type", "source_inventory_id", "target_inventory_id", "item_ids"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { routes: bulkTransferRoutes(actor, world) };
            },
            validate: function (actor, action, world) {
                if (!Array.isArray(action.item_ids) || action.item_ids.length === 0) {
                    return fail("EMPTY_ITEM_BUNDLE", "Choose at least one item to transfer.");
                }
                if (new Set(action.item_ids).size !== action.item_ids.length) {
                    return fail("DUPLICATE_ITEM_ID", "A bulk transfer cannot contain the same item more than once.");
                }
                if (action.source_inventory_id === action.target_inventory_id) {
                    return fail("NO_OP_TRANSFER", "Source and target inventories must be different.");
                }
                const route = bulkTransferRoutes(actor, world).find(function (candidate) {
                    return candidate.source_inventory_id === action.source_inventory_id && candidate.target_inventory_id === action.target_inventory_id;
                });
                if (!route) return fail("TRANSFER_ROUTE_UNAVAILABLE", "That transfer route is not currently accessible.");
                const allowed = new Set(route.item_ids || []);
                for (const itemId of action.item_ids) {
                    const item = world.entities[itemId];
                    if (!item || item.type !== "item") return fail("ITEM_NOT_FOUND", `Item ${itemId} does not exist.`);
                    if (!allowed.has(itemId) || item.containerId !== action.source_inventory_id) {
                        return fail("ITEM_NOT_ACCESSIBLE", `${item.name || itemId} is not available from the selected source.`);
                    }
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const source = world.inventories[action.source_inventory_id];
                const target = world.inventories[action.target_inventory_id];
                const names = action.item_ids.map(function (itemId) { return world.entities[itemId].name; });
                action.item_ids.forEach(function (itemId) { transferItem(itemId, source, target, world); });
                const targetOwner = world.entities[target.ownerId];
                return [{
                    type: "items_transferred",
                    actorId: actor.id,
                    targetId: targetOwner && targetOwner.type === "character" ? targetOwner.id : null,
                    itemIds: action.item_ids.slice(),
                    sourceInventoryId: source.id,
                    targetInventoryId: target.id,
                    locationId: actor.locationId,
                    text: `${actor.name} transferred ${action.item_ids.length} item${action.item_ids.length === 1 ? "" : "s"}: ${names.join(", ")}.`
                }];
            }
        },

        read_paper: {
            description: "Read or view the persistent content of an accessible writable paper item.",
            schema: {
                type: "object",
                properties: { type: { const: "read_paper" }, item_id: { type: "string" } },
                required: ["type", "item_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { item_ids: writableItemEntries(actor, world).map(function (entry) { return entry.item.id; }) };
            },
            validate: function (actor, action, world) {
                const entry = writableItemEntries(actor, world).find(function (candidate) { return candidate.item.id === action.item_id; });
                return entry ? ok() : fail("PAPER_NOT_ACCESSIBLE", "That paper is not accessible to the actor.");
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const content = typeof item.content === "string" ? item.content : "";
                return { events: [{
                    type: "paper_read",
                    actorId: actor.id,
                    itemId: item.id,
                    locationId: actor.locationId,
                    text: `${actor.name} reads ${definition ? definition.name : item.name}.`
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "PAPER_CONTENT",
                    text: content || "The paper is blank.",
                    data: { itemId: item.id, content: content }
                }] };
            }
        },

        write_paper: {
            description: "Write or draw on an accessible paper item. Plain text is verbatim writing; *...* describes a drawing or other visual mark. Requires an accessible reusable Writing Set.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "write_paper" },
                    item_id: { type: "string" },
                    content: { type: "string", maxLength: 12000 }
                },
                required: ["type", "item_id", "content"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return { item_ids: hasWritingCapability(actor, world) ? writableItemEntries(actor, world).map(function (entry) { return entry.item.id; }) : [] };
            },
            validate: function (actor, action, world) {
                if (!hasWritingCapability(actor, world)) return fail("WRITING_SET_REQUIRED", "A Writing Set is required to write or draw on paper.");
                const entry = writableItemEntries(actor, world).find(function (candidate) { return candidate.item.id === action.item_id; });
                if (!entry) return fail("PAPER_NOT_ACCESSIBLE", "That paper is not accessible to the actor.");
                if (typeof action.content !== "string" || action.content.length > 12000) return fail("INVALID_PAPER_CONTENT", "Paper content must be text no longer than 12000 characters.");
                const normalized = action.content.replace(/\r\n/g, "\n");
                const current = (typeof entry.item.content === "string" ? entry.item.content : "").replace(/\r\n/g, "\n");
                if (normalized === current) return fail("NO_OP_PAPER_EDIT", "The paper already has exactly that content.");
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                item.content = action.content.replace(/\r\n/g, "\n");
                const definition = getItemDefinition(item, world);
                return [{
                    type: "paper_written",
                    actorId: actor.id,
                    itemId: item.id,
                    locationId: actor.locationId,
                    text: `${actor.name} writes or draws on ${definition ? definition.name : item.name}.`
                }];
            }
        },

        show_hidden_location: {
            description: "Show a nearby character the concealed entrance to a hidden location that you already know.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "show_hidden_location" },
                    target_id: { type: "string" },
                    location_id: { type: "string" }
                },
                required: ["type", "target_id", "location_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const source = getLocation(actor.locationId, world);
                const candidates = locationExitEntries(source, world).map(function (transition) {
                    const location = getLocation(transition.destinationId, world);
                    if (!location || !locationRequiresDiscovery(location, world) || !characterHasDiscoveredLocation(actor, location.id, world)) return null;
                    const targets = nearbyCharacters(actor, world).filter(function (target) {
                        return canReachCharacter(actor, target, world) && !characterHasDiscoveredLocation(target, location.id, world);
                    }).map(function (target) { return { id: target.id, name: target.name }; });
                    return targets.length > 0 ? { id: location.id, name: location.name, target_ids: targets.map(function (target) { return target.id; }), targets: targets } : null;
                }).filter(Boolean);
                return {
                    location_ids: candidates.map(function (candidate) { return candidate.id; }),
                    target_ids: Array.from(new Set(candidates.flatMap(function (candidate) { return candidate.target_ids; }))),
                    locations: candidates
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                const destination = getLocation(action.location_id, world);
                const source = getLocation(actor.locationId, world);
                if (!target || target.id === actor.id) return fail("TARGET_NOT_FOUND", "A valid other character is required.");
                if (!canReachCharacter(actor, target, world)) return fail("TARGET_NOT_REACHABLE", "Target cannot currently perceive the actor nearby.");
                if (!destination || !locationRequiresDiscovery(destination, world)) return fail("HIDDEN_LOCATION_INVALID", "The selected hidden location is invalid.");
                if (!findLocationExit(source, destination.id)) return fail("HIDDEN_LOCATION_NOT_ADJACENT", "The concealed entrance is not at the current location.");
                if (!characterHasDiscoveredLocation(actor, destination.id, world)) return fail("HIDDEN_LOCATION_UNKNOWN", "The actor does not know that hidden location.");
                if (characterHasDiscoveredLocation(target, destination.id, world)) return fail("HIDDEN_LOCATION_ALREADY_KNOWN", "The target already knows that hidden location.");
                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                const destination = getLocation(action.location_id, world);
                grantLocationDiscovery(target, destination.id, world);
                return [{
                    type: "hidden_location_shown",
                    actorId: actor.id,
                    targetId: target.id,
                    locationId: actor.locationId,
                    revealedLocationId: destination.id,
                    noticeability: "hidden",
                    text: `${actor.name} showed ${target.name} the concealed way to ${destination.name}.`
                }];
            }
        },

        give_money: {
            description: "Give money to another character nearby.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "give_money" },
                    target_id: { type: "string" },
                    amount: { type: "integer", minimum: 1 }
                },
                required: ["type", "target_id", "amount"]
            },
            getOptions: function (actor, world) {
                return {
                    target_ids: nearbyCharacters(actor, world).filter(function (character) {
                        return canReachCharacter(actor, character, world);
                    }).map(function (character) {
                        return character.id;
                    }),
                    maximum_amount: actor.wallet
                };
            },
            validate: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);

                if (!target) {
                    return fail("TARGET_NOT_FOUND", "Target character does not exist.");
                }

                if (target.id === actor.id) {
                    return fail("INVALID_TARGET", "A character cannot give to itself.");
                }

                if (!canReachCharacter(actor, target, world)) {
                    return fail("TARGET_NOT_REACHABLE", "Target cannot be reached from the actor's current position.");
                }

                if (!Number.isInteger(action.amount) || action.amount <= 0) {
                    return fail("INVALID_AMOUNT", "Amount must be a positive integer.");
                }

                if (actor.wallet < action.amount) {
                    return fail("INSUFFICIENT_FUNDS", "Actor does not have enough money.");
                }

                return ok();
            },
            execute: function (actor, action, world) {
                const target = getCharacter(action.target_id, world);
                actor.wallet -= action.amount;
                target.wallet += action.amount;

                return [{
                    type: "money_transferred",
                    actorId: actor.id,
                    targetId: target.id,
                    amount: action.amount,
                    locationId: actor.locationId,
                    text: `${actor.name} gave ${action.amount} gold to ${target.name}.`
                }];
            }
        },

        place_item: {
            description: "Place an owned item on an accessible surface.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "place_item" },
                    item_id: { type: "string" },
                    target_inventory_id: { type: "string" }
                },
                required: ["type", "item_id", "target_inventory_id"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                const target = sublocation.inventoryId ? world.inventories[sublocation.inventoryId] : null;
                return {
                    item_ids: world.inventories[actor.inventoryId].itemIds.slice(),
                    target_inventory_ids: target && canAccessInventory(actor, target, world) ? [target.id] : []
                };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!sublocation.inventoryId || action.target_inventory_id !== sublocation.inventoryId) {
                    return fail("INVENTORY_NOT_ACCESSIBLE", "Target surface is not accessible from the current position.");
                }
                const targetInventory = world.inventories[action.target_inventory_id];
                if (!targetInventory) {
                    return fail("INVENTORY_NOT_FOUND", "Target inventory does not exist.");
                }
                if (!canAccessInventory(actor, targetInventory, world)) {
                    return fail("INVENTORY_KEY_REQUIRED", "Actor does not possess the key required to access this container.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                transferItem(
                    action.item_id,
                    world.inventories[actor.inventoryId],
                    world.inventories[action.target_inventory_id],
                    world
                );
                return [{
                    type: "item_placed",
                    actorId: actor.id,
                    itemId: action.item_id,
                    targetInventoryId: action.target_inventory_id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} placed ${world.entities[action.item_id].name} on ${getSublocation(actor.sublocationId, world).name}.`
                }];
            }
        },

        fill: {
            description: "Fill an owned item when its current definition and the environment allow it.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "fill" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                const capabilities = new Set(sublocation.capabilities || []);
                const items = world.inventories[actor.inventoryId].itemIds.map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const action = definition && definition.fillAction;
                    if (!action || !capabilities.has(action.requiredEnvironmentCapability)) return null;
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: action.actionLabel,
                        required_environment_capability: action.requiredEnvironmentCapability,
                        result_definition_id: action.resultDefinitionId
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const fillAction = definition && definition.fillAction;
                if (!fillAction) {
                    return fail("ITEM_NOT_FILLABLE", "This item cannot be filled in its current state.");
                }
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!(sublocation.capabilities || []).includes(fillAction.requiredEnvironmentCapability)) {
                    return fail("CAPABILITY_REQUIRED", "This item cannot be filled in the current environment.");
                }
                if (!getItemDefinition(fillAction.resultDefinitionId, world)) {
                    return fail("RESULT_DEFINITION_MISSING", "The configured filled item definition does not exist.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const fromDefinition = getItemDefinition(item, world);
                const fillAction = fromDefinition.fillAction;
                const fromDefinitionId = fromDefinition.id;
                transformItem(item, fillAction.resultDefinitionId, world);
                return { events: [{
                    type: "item_transformed",
                    actorId: actor.id,
                    itemId: item.id,
                    actionType: "fill",
                    fromDefinitionId: fromDefinitionId,
                    toDefinitionId: item.definitionId,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} fills ${fromDefinition.name} with ale.`
                }], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "ITEM_FILLED",
                    text: fillAction.feedbackText || `You fill ${fromDefinition.name}.`,
                    data: {
                        itemId: item.id,
                        fromDefinitionId: fromDefinitionId,
                        toDefinitionId: item.definitionId
                    }
                }] };
            }
        },

        consume: {
            description: "Consume an owned item that supports consumption.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "consume" },
                    item_id: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const items = world.inventories[actor.inventoryId].itemIds.map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const consumeAction = definition && definition.consumeAction;
                    if (!consumeAction) return null;
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: consumeAction.actionLabel,
                        result_type: consumeAction.resultType,
                        result_definition_id: consumeAction.resultDefinitionId
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!world.inventories[actor.inventoryId].itemIds.includes(action.item_id)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                return itemConsumePlan(item, world).ok ? ok() : itemConsumePlan(item, world);
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const fromDefinition = getItemDefinition(item, world);
                const consumeAction = fromDefinition.consumeAction;
                const changed = applyItemConsume(item, world);
                if (!changed.ok) throw new Error(changed.error.message);
                const value = changed.value;
                return { events: [{
                    type: value.removed ? "item_consumed" : "item_transformed",
                    actorId: actor.id,
                    itemId: value.itemId,
                    actionType: "consume",
                    fromDefinitionId: value.fromDefinitionId,
                    toDefinitionId: value.toDefinitionId,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: renderItemActionText(consumeAction.publicText || "{actorName} consumes {itemName}.", { actorName: actor.name, itemName: fromDefinition.name })
                }], feedback: [{
                    recipientId: actor.id, kind: "observation", code: "ITEM_CONSUMED",
                    text: consumeAction.feedbackText || `You consume ${fromDefinition.name}.`,
                    data: clone(value)
                }] };
            }
        },

        equip: {
            description: "Equip an owned item into one of that item's currently available slots.",
            schema: {
                type: "object",
                properties: { type: { const: "equip" }, item_id: { type: "string" }, slot: { type: "string" } },
                required: ["type", "item_id", "slot"]
            },
            getOptions: function (actor, world) {
                const occupied = new Set(equippedRecords(actor).map(function (record) { return record.slot; }));
                const inventory = world.inventories[actor.inventoryId];
                const items = (inventory ? inventory.itemIds : []).map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const slots = definition && Array.isArray(definition.equipSlots)
                        ? definition.equipSlots.filter(function (slot) { return !occupied.has(slot); }) : [];
                    if (!slots.length) return null;
                    return { id: item.id, name: definition.name, slots: slots.slice() };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                const inventory = world.inventories[actor.inventoryId];
                if (!inventory || !inventory.itemIds.includes(action.item_id)) return fail("ITEM_NOT_OWNED", "Actor does not possess this item in inventory.");
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                if (!definition || !Array.isArray(definition.equipSlots) || !definition.equipSlots.includes(action.slot)) return fail("EQUIP_SLOT_INVALID", "This item cannot be equipped in that slot.");
                if (equippedRecords(actor).some(function (record) { return record.slot === action.slot; })) return fail("EQUIP_SLOT_OCCUPIED", "That equipment slot is already occupied.");
                return ok();
            },
            execute: function (actor, action, world) {
                const inventory = world.inventories[actor.inventoryId];
                inventory.itemIds = inventory.itemIds.filter(function (id) { return id !== action.item_id; });
                const item = world.entities[action.item_id];
                item.containerId = actor.id;
                actor.equippedItems.push({ itemId: item.id, slot: action.slot, visible: true });
                return [{ type: "item_equipped", actorId: actor.id, itemId: item.id, slot: action.slot,
                    locationId: actor.locationId, sublocationId: actor.sublocationId, text: `${actor.name} puts on ${item.name}.` }];
            }
        },

        unequip: {
            description: "Remove one currently equipped item and return it to inventory.",
            schema: {
                type: "object",
                properties: { type: { const: "unequip" }, item_id: { type: "string" } },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const items = equippedRecords(actor).map(function (record) {
                    const item = world.entities[record.itemId];
                    const definition = getItemDefinition(item, world);
                    return item && definition ? { id: item.id, name: definition.name, slot: record.slot } : null;
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action) {
                if (!equippedRecords(actor).some(function (record) { return record.itemId === action.item_id; })) return fail("ITEM_NOT_EQUIPPED", "Actor is not wearing this item.");
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                actor.equippedItems = actor.equippedItems.filter(function (record) { return record.itemId !== action.item_id; });
                world.inventories[actor.inventoryId].itemIds.push(item.id);
                item.containerId = actor.inventoryId;
                return [{ type: "item_unequipped", actorId: actor.id, itemId: item.id,
                    locationId: actor.locationId, sublocationId: actor.sublocationId, text: `${actor.name} takes off ${item.name}.` }];
            }
        },

        use_item: {
            description: "Use an owned item through its authored interaction. item_id must be one of this action's listed item IDs.",
            schema: {
                type: "object",
                properties: {
                    type: { const: "use_item" },
                    item_id: { type: "string" },
                    input_text: { type: "string" }
                },
                required: ["type", "item_id"]
            },
            getOptions: function (actor, world) {
                const inventory = world.inventories[actor.inventoryId];
                const ownedIds = (inventory ? inventory.itemIds.slice() : []).concat(equippedRecords(actor).map(function (record) { return record.itemId; }));
                const items = Array.from(new Set(ownedIds)).map(function (itemId) {
                    const item = world.entities[itemId];
                    const definition = getItemDefinition(item, world);
                    const useAction = definition && definition.useAction;
                    if (!useAction || !ItemEffectRegistry[useAction.effectId]) return null;
                    const queryInput = useAction.effectId === "utility_query" || useAction.effectId === "abstract_study";
                    return {
                        id: item.id,
                        name: definition.name,
                        action_label: useAction.actionLabel,
                        effect_id: useAction.effectId,
                        instructions: typeof useAction.aiInstructions === "string" ? useAction.aiInstructions : "",
                        input_required: queryInput,
                        input_label: queryInput ? useAction.inputLabel : "",
                        input_placeholder: queryInput && typeof useAction.inputPlaceholder === "string" ? useAction.inputPlaceholder : "",
                        input_max_length: queryInput && Number.isInteger(useAction.inputMaxLength) ? useAction.inputMaxLength : (queryInput ? 600 : 0)
                    };
                }).filter(Boolean);
                return { item_ids: items.map(function (item) { return item.id; }), items: items };
            },
            validate: function (actor, action, world) {
                if (!actorOwnsItem(actor, action.item_id, world)) {
                    return fail("ITEM_NOT_OWNED", "Actor does not possess this item.");
                }
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const useAction = definition && definition.useAction;
                if (!useAction) {
                    return fail("ITEM_NOT_USABLE", "This item has no authored use interaction.");
                }
                if (!ItemEffectRegistry[useAction.effectId]) {
                    return fail("ITEM_EFFECT_UNKNOWN", "The configured item effect is not supported by the engine.");
                }
                if (useAction.effectId === "utility_query" || useAction.effectId === "abstract_study") {
                    const inputText = typeof action.input_text === "string" ? action.input_text.trim() : "";
                    const maxLength = Number.isInteger(useAction.inputMaxLength) ? useAction.inputMaxLength : 600;
                    if (!inputText) return fail("ITEM_INPUT_REQUIRED", `${useAction.inputLabel || "Input"} is required.`);
                    if (inputText.length > maxLength) return fail("ITEM_INPUT_TOO_LONG", `${useAction.inputLabel || "Input"} must not exceed ${maxLength} characters.`);
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const item = world.entities[action.item_id];
                const definition = getItemDefinition(item, world);
                const useAction = definition.useAction;
                const effect = ItemEffectRegistry[useAction.effectId];
                const effectResult = effect.execute(actor, item, definition, useAction, world, action) || {};
                return {
                    events: [{
                        type: "item_used",
                        actorId: actor.id,
                        itemId: item.id,
                        actionType: "use_item",
                        effectId: useAction.effectId,
                        locationId: actor.locationId,
                        sublocationId: actor.sublocationId,
                        text: renderItemActionText(useAction.publicText, {
                            actorName: actor.name,
                            itemName: definition.name
                        })
                    }],
                    feedback: clone(effectResult.feedback || []),
                    modelRequests: clone(effectResult.modelRequests || [])
                };
            }
        },

        serve_food: {
            description: "Serve authored food from the current sublocation using one existing reusable dish.",
            schema: {
                type: "object",
                properties: { type: { const: "serve_food" }, serving_action_id: { type: "string" } },
                required: ["type", "serving_action_id"]
            },
            getOptions: function (actor, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                const inventory = sublocation && sublocation.inventoryId ? world.inventories[sublocation.inventoryId] : null;
                const phase = world.environment.timePhase === "morning" ? "Morning" : world.environment.timePhase === "evening" ? "Evening" : "";
                const actions = (sublocation && Array.isArray(sublocation.servingActions) ? sublocation.servingActions : []).map(function (serving) {
                    if (!phase || !Array.isArray(serving.phases) || !serving.phases.includes(phase) || !inventory) return null;
                    const dishItem = inventory.itemIds.map(function (itemId) { return world.entities[itemId]; }).find(function (item) {
                        return item && item.definitionId === serving.requiredDishDefinitionId;
                    });
                    if (!dishItem) return null;
                    const dishDefinition = world.itemDefinitions[serving.requiredDishDefinitionId];
                    const resultDefinition = world.itemDefinitions[serving.resultDefinitionId];
                    return {
                        id: serving.id,
                        action_label: serving.actionLabel,
                        required_dish_definition_id: serving.requiredDishDefinitionId,
                        required_dish_name: dishDefinition && dishDefinition.name || serving.requiredDishDefinitionId,
                        result_definition_id: serving.resultDefinitionId,
                        result_name: resultDefinition && resultDefinition.name || serving.resultDefinitionId,
                        ai_description: serving.aiDescription || "",
                        ai_prerequisites: clone(serving.aiPrerequisites || [])
                    };
                }).filter(Boolean);
                return { serving_action_ids: actions.map(function (record) { return record.id; }), actions: actions };
            },
            validate: function (actor, action, world) {
                const options = this.getOptions(actor, world);
                if (!options.serving_action_ids.includes(action.serving_action_id)) return fail("SERVING_ACTION_UNAVAILABLE", "That food cannot currently be served here.");
                return ok();
            },
            execute: function (actor, action, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                const serving = (sublocation.servingActions || []).find(function (record) { return record.id === action.serving_action_id; });
                const cabinet = world.inventories[sublocation.inventoryId];
                const dishId = cabinet.itemIds.find(function (itemId) {
                    const item = world.entities[itemId];
                    return item && item.definitionId === serving.requiredDishDefinitionId;
                });
                const dish = world.entities[dishId];
                const fromDefinition = getItemDefinition(dish, world);
                transformItem(dish, serving.resultDefinitionId, world);
                transferItem(dish.id, cabinet, world.inventories[actor.inventoryId], world);
                const resultDefinition = getItemDefinition(dish, world);
                return { events: [{
                    type: "food_served", actorId: actor.id, itemId: dish.id, actionType: "serve_food",
                    fromDefinitionId: fromDefinition.id, toDefinitionId: resultDefinition.id,
                    locationId: actor.locationId, sublocationId: actor.sublocationId,
                    text: `${actor.name} serves ${resultDefinition.name}.`
                }], feedback: [{ recipientId: actor.id, kind: "observation", code: "FOOD_SERVED", text: `You serve ${resultDefinition.name}.`, data: { itemId: dish.id, servingActionId: serving.id } }] };
            }
        },

        use_ability: {
            description: "Use one currently available authored ability by ability ID.",
            schema: {
                type: "object",
                properties: { type: { const: "use_ability" }, ability_id: { type: "string" } },
                required: ["type", "ability_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const abilities = (actor.abilityIds || []).map(function (abilityId) { return world.abilities[abilityId]; }).filter(function (ability) {
                    return ability && ability.actionType === "use_ability" && AbilityEffectRegistry[ability.effectType];
                }).map(function (ability) {
                    return { id: ability.id, name: ability.name, label: ability.name, player_description: ability.playerDescription || "", ai_description: ability.aiDescription || "", effect_type: ability.effectType };
                });
                return { ability_ids: abilities.map(function (ability) { return ability.id; }), abilities: abilities };
            },
            validate: function (actor, action, world) {
                if (Object.keys(action || {}).some(function (key) { return key !== "type" && key !== "ability_id"; })) {
                    return fail("INVALID_ACTION_INPUT", "use_ability accepts only ability_id.");
                }
                const options = this.getOptions(actor, world);
                if (!options.ability_ids.includes(action.ability_id)) return fail("ABILITY_NOT_AVAILABLE", "That ability is not owned or currently available to this actor.");
                return ok();
            },
            execute: function (actor, action, world) {
                const ability = world.abilities[action.ability_id];
                const effect = ability && AbilityEffectRegistry[ability.effectType];
                if (!effect) throw new Error("The configured ability effect is not supported by the engine.");
                return effect.execute(actor, ability, world) || { events: [], feedback: [] };
            }
        },


        authored_interaction: {
            description: "Perform one authored physical interaction available at the actor's current position. interaction_id must be one of this action's listed interaction IDs.",
            schema: {
                type: "object",
                properties: { type: { const: "authored_interaction" }, interaction_id: { type: "string" } },
                required: ["type", "interaction_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const interactions = authoredInteractionRecords(actor, world).map(function (interaction) {
                    return { id: interaction.id, action_label: interaction.actionLabel, outcome_table_id: interaction.outcomeTableId };
                });
                return { interaction_ids: interactions.map(function (entry) { return entry.id; }), interactions: interactions };
            },
            validate: function (actor, action, world) {
                const interaction = authoredInteractionRecords(actor, world).find(function (entry) { return entry.id === action.interaction_id; });
                if (!interaction) return fail("AUTHORED_INTERACTION_UNAVAILABLE", "That authored interaction is not available at the actor's current position.");
                return ok();
            },
            execute: function (actor, action, world) {
                const interaction = authoredInteractionRecords(actor, world).find(function (entry) { return entry.id === action.interaction_id; });
                if (!interaction) throw new Error("Authored interaction became unavailable before execution.");
                const result = runAuthoredOutcomeTable(actor, interaction.outcomeTableId, world, {
                    random: Math.random,
                    actionType: "authored_interaction",
                    authoredInteractionId: interaction.id
                });
                if (!result.ok) throw new Error(result.error.message);
                return { events: result.events || [], feedback: [] };
            }
        },

        offer_day_work: {
            description: "Formally offer the Human-controlled Traveler one of your available full-day jobs. Use this only when you have actually decided to offer work. A neutral stranger who asks reasonably for simple work should usually be acceptable, but your personality, memories, relationships, and recent context may justify refusal. You may offer proactively when there is a natural reason, but do not repeatedly offer work without context. The player will separately accept or decline.",
            schema: {
                type: "object",
                properties: { type: { const: "offer_day_work" }, activity_id: { type: "string" } },
                required: ["type", "activity_id"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                const activities = Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "sponsored_job" && activity.sponsorCharacterId === actor.id;
                }).map(function (activity) {
                    return { id: activity.id, name: activity.name, description: activity.offerDescription || "" };
                });
                return { activity_ids: activities.map(function (activity) { return activity.id; }), activities: activities };
            },
            validate: function (actor, action, world) {
                if (world.environment.timePhase !== "morning") return fail("DAY_WORK_NOT_MORNING", "Full-day work can only be offered during Morning.");
                if (world.daytime.pendingOffer || world.daytime.activeActivity) return fail("DAY_WORK_ALREADY_PENDING", "Another daytime activity is already pending or active.");
                const activity = world.dayActivities[action.activity_id];
                if (!activity || activity.kind !== "sponsored_job" || activity.sponsorCharacterId !== actor.id) return fail("DAY_WORK_ACTIVITY_INVALID", "That daytime job is not available to this sponsor.");
                const human = getCharacter(getHumanCharacterId(world), world);
                if (!human || !canReachCharacter(actor, human, world)) return fail("DAY_WORK_TRAVELER_NOT_REACHABLE", "The Traveler is not physically reachable for this work offer.");
                return ok({ activity: activity, human: human });
            },
            execute: function (actor, action, world) {
                const activity = world.dayActivities[action.activity_id];
                const humanId = getHumanCharacterId(world);
                world.daytime.pendingOffer = {
                    activityId: activity.id,
                    sponsorCharacterId: actor.id,
                    humanCharacterId: humanId,
                    reactedCharacterIds: []
                };
                return [{
                    type: "day_work_offered",
                    actorId: actor.id,
                    targetId: humanId,
                    locationId: actor.locationId,
                    activityId: activity.id,
                    text: `${actor.name} offered ${getCharacter(humanId, world).name} a day of work: ${activity.name}.`
                }];
            }
        },

        go_hunting: {
            description: "Spend the full day hunting small game alone. This begins the daytime timelapse and is available only at the authored hunting entry location during Morning.",
            schema: { type: "object", properties: { type: { const: "go_hunting" } }, required: ["type"], additionalProperties: false },
            getOptions: function (actor, world) {
                const activities = Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "solo" && activity.entryLocationId === actor.locationId;
                });
                return { activity_ids: activities.map(function (activity) { return activity.id; }) };
            },
            validate: function (actor, action, world) {
                if (world.control.assignments[actor.id] !== "human") return fail("DAY_ACTIVITY_HUMAN_ONLY", "This daytime activity entry is HumanController-only.");
                if (world.environment.timePhase !== "morning") return fail("DAY_ACTIVITY_NOT_MORNING", "Hunting for the day can only begin during Morning.");
                if (world.daytime.pendingOffer || world.daytime.activeActivity) return fail("DAY_ACTIVITY_ALREADY_PENDING", "Another daytime activity is already pending or active.");
                const activity = Object.values(world.dayActivities || {}).find(function (candidate) {
                    return candidate && candidate.kind === "solo" && candidate.entryLocationId === actor.locationId;
                });
                if (!activity) return fail("DAY_ACTIVITY_UNAVAILABLE", "No solo daytime activity is available here.");
                return ok({ activity: activity });
            },
            execute: function (actor, action, world) {
                const activity = Object.values(world.dayActivities || {}).find(function (candidate) {
                    return candidate && candidate.kind === "solo" && candidate.entryLocationId === actor.locationId;
                });
                world.daytime.activeActivity = { activityId: activity.id, sponsorCharacterId: null, humanCharacterId: actor.id };
                return [{
                    type: "day_activity_started",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    activityId: activity.id,
                    text: `${actor.name} set out to spend the day hunting.`
                }];
            }
        },

        sleep: {
            description: "Fall asleep while occupying a sleep-capable place.",
            schema: {
                type: "object",
                properties: { type: { const: "sleep" } },
                required: ["type"],
                additionalProperties: false
            },
            getOptions: function () { return {}; },
            validate: function (actor, action, world) {
                const sublocation = getSublocation(actor.sublocationId, world);
                if (!sublocation || !(sublocation.capabilities || []).includes("sleep")) {
                    return fail("BED_REQUIRED", "You must be on a sleep-capable place before sleeping.");
                }
                if (sleepingSublocationOccupants(sublocation.id, world, actor.id).length >= effectiveSleepCapacity(sublocation)) {
                    return fail("BED_SLEEP_CAPACITY_FULL", "This sleeping place already has its maximum number of sleeping occupants.");
                }
                return ok();
            },
            execute: function (actor) {
                actor.sleeping = true;
                return [{
                    type: "character_slept",
                    actorId: actor.id,
                    locationId: actor.locationId,
                    sublocationId: actor.sublocationId,
                    text: `${actor.name} went to sleep.`
                }];
            }
        },

        defer_departure: {
            description: "Delay this visit's imminent planned departure by exactly one timelapse period.",
            schema: {
                type: "object",
                properties: { type: { const: "defer_departure" } },
                required: ["type"],
                additionalProperties: false
            },
            getOptions: function (actor, world) {
                return setup.WeeklyRhythm && typeof setup.WeeklyRhythm.deferOptions === "function"
                    ? setup.WeeklyRhythm.deferOptions(actor, world)
                    : {};
            },
            validate: function (actor, action, world) {
                if (!setup.WeeklyRhythm || typeof setup.WeeklyRhythm.canDeferDeparture !== "function" ||
                        !setup.WeeklyRhythm.canDeferDeparture(actor, world)) {
                    return fail("DEPARTURE_DEFER_NOT_IMMINENT", "Departure can only be deferred when it is the boundary reached by the next timelapse.");
                }
                return ok();
            },
            execute: function (actor, action, world) {
                const result = setup.WeeklyRhythm.deferDeparture(actor, world);
                if (!result.ok) throw new Error(result.error.message);
                return { events: [], feedback: [{
                    recipientId: actor.id,
                    kind: "observation",
                    code: "DEPARTURE_DEFERRED",
                    text: result.text,
                    data: {
                        previousPlannedDeparture: clone(result.previousPlannedDeparture),
                        plannedDeparture: clone(result.plannedDeparture)
                    }
                }] };
            }
        },


    };

    const ACTION_AI_METADATA = Object.freeze({
        move: {
            aiDescription: "Move to a directly connected major location.",
            aiPrerequisites: ["The destination must be directly connected, discovered, available, unblocked, and unlocked.", "The destination's default position must have capacity."],
        },
        unlock: {
            aiDescription: "Unlock a directly connected lockable passage.",
            aiPrerequisites: ["A locked passage must be present here.", "The actor must directly carry a matching key."],
        },
        lock: {
            aiDescription: "Lock a directly connected lockable passage.",
            aiPrerequisites: ["An unlocked lockable passage must be present here.", "The actor must directly carry a matching key."],
        },
        move_within_location: {
            aiDescription: "Change tracked position within the current major location.",
            aiPrerequisites: ["The destination position must be reachable, available, and have capacity."],
        },
        take_item: {
            aiDescription: "Take an accessible item into the actor's inventory.",
            aiPrerequisites: ["The item must be in an inventory accessible from the actor's current position."],
        },
        drop_item: {
            aiDescription: "Drop an owned item into the current location inventory.",
            aiPrerequisites: ["The actor must directly carry the item in their inventory."],
        },
        give_item: {
            aiDescription: "Give an owned item to a nearby reachable character.",
            aiPrerequisites: ["The actor must directly carry the item in their inventory.", "The recipient must be nearby and reachable."],
        },
        transfer_items: {
            aiDescription: "Move one or more accessible items between the actor and an accessible inventory or container.",
            aiPrerequisites: ["The source and destination inventories must be accessible from the actor's current position.", "The selected items must be on the offered transfer route."],
        },
        read_paper: {
            aiDescription: "Read the tracked contents of an accessible writable paper item.",
            aiPrerequisites: ["A writable paper item must be accessible to the actor."],
        },
        write_paper: {
            aiDescription: "Write or draw tracked content on an accessible paper item.",
            aiPrerequisites: ["A writable paper item must be accessible.", "An appropriate reusable Writing Set must be accessible to the actor."],
        },
        show_hidden_location: {
            aiDescription: "Show a nearby character the concealed entrance to a hidden location the actor has already discovered.",
            aiPrerequisites: ["The actor must know the hidden location.", "The actor and target must be together at an authored entrance.", "The target must not already know the location."],
        },
        give_money: {
            aiDescription: "Transfer tracked gold from the actor to a nearby character.",
            aiPrerequisites: ["The actor must have enough gold.", "The recipient must be nearby and reachable."],
        },
        place_item: {
            aiDescription: "Place a directly carried inventory item into an accessible sublocation/container inventory.",
            aiPrerequisites: ["The actor must directly carry the item in their inventory.", "The target inventory must be accessible from the current position."],
        },
        fill: {
            aiDescription: "Fill a compatible vessel from a compatible environmental source.",
            aiPrerequisites: ["A compatible fill source must be present at the actor's current position.", "The actor must directly carry a compatible vessel in their inventory."],
        },
        consume: {
            aiDescription: "Fully consume an eligible tracked consumable item and apply its authored result.",
            aiPrerequisites: ["The actor must directly carry the consumable item in their inventory."],
        },
        equip: {
            aiDescription: "Equip an owned equippable item into its tracked equipment slot or slots.",
            aiPrerequisites: ["The actor must directly carry the equippable item in their inventory.", "All required equipment slots must be free."],
        },
        unequip: {
            aiDescription: "Remove a tracked equipped item and return it to the actor's inventory.",
            aiPrerequisites: ["The item must currently be equipped by the actor."],
        },
        use_item: {
            aiDescription: "Use a possessed item through its authored tracked item-specific effect.",
            aiPrerequisites: ["The relevant item must be directly carried in the actor's inventory or currently equipped by the actor.", "Any item-specific input requirements must be satisfied."],
        },
        serve_food: {
            aiDescription: "Serve one currently authored food portion from the current kitchen/fixture using an existing reusable dish.",
            aiPrerequisites: ["The actor must be at the owning serving sublocation.", "The current Morning/Evening phase must offer that dish.", "The required empty bowl or plate must exist in the local Dish Cabinet."]
        },
        use_ability: {
            aiDescription: "Use one specific owned authored ability by its listed ability_id. The engine returns the grounded result; never invent the result in advance.",
            aiPrerequisites: ["The selected ability_id must be listed in the current action options and owned by the actor."]
        },

        authored_interaction: {
            aiDescription: "Perform an authored physical interaction available at the actor's exact current position.",
            aiPrerequisites: ["The interaction must be authored at the actor's current sublocation and currently applicable."],
        },
        offer_day_work: {
            aiDescription: "Formally offer the Human-controlled Traveler an authored full-day sponsored job.",
            aiPrerequisites: ["It must be Morning.", "No other daytime activity may be pending or active.", "The Traveler must be reachable.", "The actor must sponsor the offered job."],
        },
        go_hunting: {
            aiDescription: "Begin the authored full-day solo squirrel-hunting activity.",
            aiPrerequisites: ["The actor must be the Human-controlled character.", "It must be Morning.", "The actor must be at the authored hunting entry location.", "No other daytime activity may be pending or active."],
        },
        sleep: {
            aiDescription: "Enter tracked sleeping state while occupying a sleep-capable sublocation.",
            aiPrerequisites: ["The actor must be at a sublocation with the sleep capability.", "For the Human-controlled character, overnight sleep is available in Evening."],
        },
        defer_departure: {
            aiDescription: "Privately defer the current visit's imminent planned departure by exactly one coarse timelapse period.",
            aiPrerequisites: ["The actor must be authored as awayable and currently present.", "The current planned departure must be exactly the boundary reached by the next timelapse transition.", "This action is available only during ordinary Morning or Evening gameplay, never inside timelapse planning."],
        },

    });

    function attachActionAIMetadata() {
        const actionTypes = Object.keys(ActionRegistry).sort();
        const metadataTypes = Object.keys(ACTION_AI_METADATA).sort();
        if (actionTypes.length !== metadataTypes.length || actionTypes.some(function (type, index) { return type !== metadataTypes[index]; })) {
            const missing = actionTypes.filter(function (type) { return !Object.prototype.hasOwnProperty.call(ACTION_AI_METADATA, type); });
            const extra = metadataTypes.filter(function (type) { return !Object.prototype.hasOwnProperty.call(ActionRegistry, type); });
            throw new Error(`ActionRegistry/AI metadata mismatch (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`);
        }
        metadataTypes.forEach(function (type) {
            const metadata = ACTION_AI_METADATA[type];
            ActionRegistry[type].aiDescription = metadata.aiDescription;
            ActionRegistry[type].aiPrerequisites = clone(metadata.aiPrerequisites || []);
        });
    }

    attachActionAIMetadata();

    function grantedActionSources(actor, world) {
        const grants = {};
        function grant(type, source) {
            if (!grants[type]) grants[type] = [];
            grants[type].push(source);
        }
        for (const type of BASE_ACTION_TYPES) grant(type, { kind: "base" });
        const sublocation = getSublocation(actor.sublocationId, world);
        for (const type of (sublocation.capabilities || [])) {
            if (type === "sleep" && world.control.assignments[actor.id] === "human" && world.environment.timePhase !== "evening") continue;
            grant(type, { kind: "sublocation", id: sublocation.id });
        }
        authoredInteractionRecords(actor, world).forEach(function (interaction) {
            grant("authored_interaction", { kind: "environment_interaction", id: interaction.id, label: interaction.actionLabel });
        });
        const servingOptions = ActionRegistry.serve_food.getOptions(actor, world);
        (servingOptions.actions || []).forEach(function (serving) {
            grant("serve_food", { kind: "serving_action", id: serving.id, label: serving.action_label, aiDescription: serving.ai_description, aiPrerequisites: clone(serving.ai_prerequisites || []) });
        });
        const environmentCapabilities = new Set(sublocation.capabilities || []);
        const actorInventory = world.inventories[actor.inventoryId];
        for (const itemId of actorInventory ? actorInventory.itemIds : []) {
            const item = world.entities[itemId];
            const definition = getItemDefinition(item, world);
            if (!definition) continue;
            if (Array.isArray(definition.equipSlots) && definition.equipSlots.some(function (slot) {
                    return !equippedRecords(actor).some(function (record) { return record.slot === slot; });
                })) {
                grant("equip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
            if (definition.fillAction && environmentCapabilities.has(definition.fillAction.requiredEnvironmentCapability)) {
                grant("fill", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name
                });
            }
            if (definition.consumeAction) {
                grant("consume", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name
                });
            }
            if (definition.useAction && ItemEffectRegistry[definition.useAction.effectId]) {
                grant("use_item", {
                    kind: "item",
                    id: item.id,
                    definitionId: definition.id,
                    name: definition.name,
                    effectId: definition.useAction.effectId
                });
            }
        }
        equippedRecords(actor).forEach(function (record) {
            const item = world.entities[record.itemId];
            const definition = getItemDefinition(item, world);
            if (!item || !definition) return;
            grant("unequip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name, slot: record.slot });
            if (definition.useAction && ItemEffectRegistry[definition.useAction.effectId]) {
                grant("use_item", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name, effectId: definition.useAction.effectId });
            }
        });

        const bulkRoutes = bulkTransferRoutes(actor, world);
        if (bulkRoutes.length > 0) grant("transfer_items", { kind: "bulk_transfer" });
        const writableEntries = writableItemEntries(actor, world);
        if (writableEntries.length > 0) grant("read_paper", { kind: "writable_item" });
        if (writableEntries.length > 0 && hasWritingCapability(actor, world)) grant("write_paper", { kind: "writing_set" });

        const location = getLocation(actor.locationId, world);
        if (ActionRegistry.show_hidden_location.getOptions(actor, world).locations.length > 0) {
            grant("show_hidden_location", { kind: "location_discovery" });
        }
        locationExitEntriesForActor(location, actor, world).forEach(function (transition) {
            if (!transition.lockId) return;
            matchingKeyItems(actor, transition.lockId, world).forEach(function (keyItem) {
                const definition = getItemDefinition(keyItem, world);
                grant(transition.locked ? "unlock" : "lock", {
                    kind: "item_key",
                    id: keyItem.id,
                    definitionId: definition && definition.id || keyItem.definitionId,
                    name: definition && definition.name || keyItem.name,
                    lockId: transition.lockId,
                    destinationId: transition.destinationId
                });
            });
        });

        if (setup.WeeklyRhythm && typeof setup.WeeklyRhythm.canDeferDeparture === "function" && setup.WeeklyRhythm.canDeferDeparture(actor, world)) {
            grant("defer_departure", { kind: "awayable_lifecycle" });
        }

        if (world.environment.timePhase === "morning" && world.daytime && !world.daytime.pendingOffer && !world.daytime.activeActivity) {
            const humanId = getHumanCharacterId(world);
            const human = getCharacter(humanId, world);
            if (world.control.assignments[actor.id] === "ai" && human && canReachCharacter(actor, human, world)) {
                Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "sponsored_job" && activity.sponsorCharacterId === actor.id;
                }).forEach(function (activity) {
                    grant("offer_day_work", { kind: "day_activity", id: activity.id, name: activity.name });
                });
            }
            if (world.control.assignments[actor.id] === "human") {
                Object.values(world.dayActivities || {}).filter(function (activity) {
                    return activity && activity.kind === "solo" && activity.entryLocationId === actor.locationId;
                }).forEach(function (activity) {
                    grant("go_hunting", { kind: "day_activity", id: activity.id, name: activity.name });
                });
            }
        }

        for (const abilityId of (actor.abilityIds || [])) {
            const ability = world.abilities[abilityId];
            if (ability && ability.actionType === "use_ability" && AbilityEffectRegistry[ability.effectType]) {
                grant("use_ability", { kind: "character_ability", id: ability.id, name: ability.name, label: ability.name, aiDescription: ability.aiDescription || "" });
            }
        }
        return grants;
    }

    function relevantActionSources(actor, world) {
        const relevant = {};
        function grant(type, source) {
            if (!ActionRegistry[type]) return;
            if (!relevant[type]) relevant[type] = [];
            const serialized = JSON.stringify(source || { kind: "relevant" });
            if (!relevant[type].some(function (existing) { return JSON.stringify(existing) === serialized; })) {
                relevant[type].push(source || { kind: "relevant" });
            }
        }

        const strict = grantedActionSources(actor, world);
        Object.entries(strict).forEach(function (entry) {
            const type = entry[0];
            if (BASE_ACTION_TYPES.includes(type)) return;
            (entry[1] || []).forEach(function (source) { grant(type, clone(source)); });
        });

        const baseOptions = {};
        BASE_ACTION_TYPES.forEach(function (type) { baseOptions[type] = ActionRegistry[type].getOptions(actor, world); });
        if ((baseOptions.move.destination_ids || []).length > 0) grant("move", { kind: "base" });
        if ((baseOptions.move_within_location.destination_ids || []).length > 0) grant("move_within_location", { kind: "base" });
        if ((baseOptions.take_item.item_ids || []).length > 0) grant("take_item", { kind: "base" });
        if ((baseOptions.drop_item.item_ids || []).length > 0) grant("drop_item", { kind: "base" });
        if ((baseOptions.give_item.target_ids || []).length > 0 && (baseOptions.give_item.item_ids || []).length > 0) grant("give_item", { kind: "base" });
        if ((baseOptions.give_money.target_ids || []).length > 0 && Number(baseOptions.give_money.maximum_amount || 0) > 0) grant("give_money", { kind: "base" });

        const sublocation = getSublocation(actor.sublocationId, world);
        const environmentCapabilities = new Set(sublocation && sublocation.capabilities || []);
        Object.values(world.itemDefinitions || {}).forEach(function (definition) {
            const fillAction = definition && definition.fillAction;
            if (!fillAction || !fillAction.requiredEnvironmentCapability || !environmentCapabilities.has(fillAction.requiredEnvironmentCapability)) return;
            grant("fill", { kind: "environment", sublocationId: sublocation.id, capability: fillAction.requiredEnvironmentCapability });
        });

        const writableEntries = writableItemEntries(actor, world);
        if (writableEntries.length > 0) grant("write_paper", { kind: "writable_item" });

        const actorInventory = world.inventories[actor.inventoryId];
        for (const itemId of actorInventory ? actorInventory.itemIds : []) {
            const item = world.entities[itemId];
            const definition = getItemDefinition(item, world);
            if (definition && Array.isArray(definition.equipSlots) && definition.equipSlots.length > 0) {
                grant("equip", { kind: "item", id: item.id, definitionId: definition.id, name: definition.name });
            }
        }

        const location = getLocation(actor.locationId, world);
        locationExitEntriesForActor(location, actor, world).forEach(function (transition) {
            if (!transition.lockId) return;
            grant(transition.locked ? "unlock" : "lock", {
                kind: "passage",
                lockId: transition.lockId,
                destinationId: transition.destinationId
            });
        });

        return relevant;
    }

    function itemSpecificMechanicVariants(type, sources, world) {
        const variants = [];
        (sources || []).forEach(function (source) {
            if (!source || source.kind !== "item" || !source.id) return;
            const item = world.entities[source.id];
            const definition = getItemDefinition(item, world);
            if (!definition) return;
            let action = null;
            if (type === "use_item") action = definition.useAction;
            else if (type === "fill") action = definition.fillAction;
            else if (type === "consume") action = definition.consumeAction;
            if (!action || typeof action !== "object") return;
            const record = {
                itemId: item.id,
                itemName: definition.name,
                actionLabel: typeof action.actionLabel === "string" ? action.actionLabel : null
            };
            if (typeof action.aiDescription === "string" && action.aiDescription.trim()) record.description = action.aiDescription.trim();
            if (Array.isArray(action.aiPrerequisites) && action.aiPrerequisites.length > 0) record.prerequisites = action.aiPrerequisites.map(String);
            variants.push(record);
        });
        return variants;
    }

    function getRelevantMechanics(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);
        if (!actor) return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        const sourcesByType = relevantActionSources(actor, world);
        const mechanics = {};
        Object.entries(sourcesByType).forEach(function (entry) {
            const type = entry[0];
            const definition = ActionRegistry[type];
            if (!definition) return;
            const record = {
                description: definition.aiDescription || definition.description,
                prerequisites: clone(definition.aiPrerequisites || []),
                sources: clone(entry[1] || [])
            };
            const variants = itemSpecificMechanicVariants(type, entry[1], world);
            if (variants.length > 0) record.itemSpecific = variants;
            mechanics[type] = record;
        });
        return mechanics;
    }

    function actionHasExecutableInvocation(type, options) {
        options = options || {};
        function hasValues(key) { return Array.isArray(options[key]) && options[key].length > 0; }
        switch (type) {
            case "move":
            case "unlock":
            case "lock":
            case "move_within_location":
                return hasValues("destination_ids");
            case "take_item":
            case "drop_item":
            case "read_paper":
            case "write_paper":
            case "fill":
            case "consume":
            case "unequip":
            case "use_item":
                return hasValues("item_ids");
            case "give_item":
                return hasValues("item_ids") && hasValues("target_ids");
            case "transfer_items":
                return hasValues("routes");
            case "show_hidden_location":
                return hasValues("location_ids");
            case "give_money":
                return hasValues("target_ids") && Number(options.maximum_amount || 0) > 0;
            case "place_item":
                return hasValues("item_ids") && hasValues("target_inventory_ids");
            case "equip":
                return Array.isArray(options.items) && options.items.some(function (item) {
                    return item && Array.isArray(item.slots) && item.slots.length > 0;
                });
            case "serve_food":
                return hasValues("serving_action_ids");
            case "use_ability":
                return hasValues("ability_ids");
            case "authored_interaction":
                return hasValues("interaction_ids");
            case "offer_day_work":
            case "go_hunting":
                return hasValues("activity_ids");
            default:
                // Source-gated zero-input actions (currently sleep/defer_departure) are executable
                // when granted even though they intentionally expose no option arrays.
                return true;
        }
    }

    function getAvailableActions(actorId) {
        const world = ensureWorld();
        const actor = getCharacter(actorId, world);

        if (!actor) {
            return fail("ACTOR_NOT_FOUND", "Actor character does not exist.");
        }
        if (setup.Presence && !setup.Presence.isLocallyPresent(actor, world)) {
            return {};
        }

        const actions = {};
        const grants = grantedActionSources(actor, world);

        for (const [type, sources] of Object.entries(grants)) {
            const definition = ActionRegistry[type];
            if (!definition) continue;
            const options = definition.getOptions(actor, world);
            if (!actionHasExecutableInvocation(type, options)) continue;
            actions[type] = {
                description: definition.description,
                schema: clone(definition.schema),
                options: options,
                sources: clone(sources)
            };
        }

        return actions;
    }


        return {
            AbilityEffectRegistry: AbilityEffectRegistry,
            ActionRegistry: ActionRegistry,
            attachActionAIMetadata: attachActionAIMetadata,
            grantedActionSources: grantedActionSources,
            relevantActionSources: relevantActionSources,
            itemSpecificMechanicVariants: itemSpecificMechanicVariants,
            getRelevantMechanics: getRelevantMechanics,
            actionHasExecutableInvocation: actionHasExecutableInvocation,
            getAvailableActions: getAvailableActions
        };
    }

    setup.GameActions = { create: create };
}());
