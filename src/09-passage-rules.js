(function () {
    "use strict";

    function locationExitEntries(location) {
        return Object.entries(location && location.exits || {}).map(function (entry) {
            const key = entry[0];
            const raw = entry[1];
            if (typeof raw === "string") return { key:key, destinationId:raw, blocked:false, blockedReason:"", lockId:"", locked:false, lockedReason:"" };
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                return {
                    key:key,
                    destinationId:typeof raw.destinationId === "string" ? raw.destinationId : "",
                    blocked:raw.blocked === true,
                    blockedReason:typeof raw.blockedReason === "string" ? raw.blockedReason : "",
                    lockId:typeof raw.lockId === "string" ? raw.lockId : "",
                    locked:raw.locked === true,
                    lockedReason:typeof raw.lockedReason === "string" ? raw.lockedReason : ""
                };
            }
            return { key:key, destinationId:"", blocked:false, blockedReason:"", lockId:"", locked:false, lockedReason:"" };
        });
    }

    function findLocationExit(location, destinationId) {
        return locationExitEntries(location).find(function (entry) { return entry.destinationId === destinationId; }) || null;
    }

    function matchingKeyItems(actor, lockId, world, getItemDefinition) {
        const inventory = actor && world.inventories[actor.inventoryId];
        if (!inventory || !lockId) return [];
        return inventory.itemIds.map(function (itemId) { return world.entities[itemId]; }).filter(function (item) {
            const definition = getItemDefinition(item, world);
            return Boolean(definition && definition.keyLockId === lockId);
        });
    }

    function reciprocalTransition(sourceLocationId, transition, world, getLocation) {
        const destination = transition && getLocation(transition.destinationId, world);
        return destination ? findLocationExit(destination, sourceLocationId) : null;
    }

    function lockActionOptions(actor, world, expectedLockedState, deps) {
        const location = deps.getLocation(actor.locationId, world);
        const passages = locationExitEntries(location).map(function (transition) {
            if (!transition.lockId || transition.locked !== expectedLockedState) return null;
            const keys = matchingKeyItems(actor, transition.lockId, world, deps.getItemDefinition);
            if (keys.length === 0) return null;
            const destination = deps.getLocation(transition.destinationId, world);
            return { id:transition.destinationId, name:destination ? destination.name : transition.destinationId, lock_id:transition.lockId, key_item_ids:keys.map(function (item) { return item.id; }) };
        }).filter(Boolean);
        return { destination_ids:passages.map(function (passage) { return passage.id; }), passages:passages };
    }

    function validateLockAction(actor, action, world, expectedLockedState, deps) {
        const location = deps.getLocation(actor.locationId, world);
        const destination = deps.getLocation(action.destination_id, world);
        if (!destination) return deps.fail("DESTINATION_NOT_FOUND", "Destination does not exist.");
        const transition = findLocationExit(location, destination.id);
        if (!transition) return deps.fail("DESTINATION_NOT_REACHABLE", "Destination is not connected to the current location.");
        if (!transition.lockId) return deps.fail("PASSAGE_NOT_LOCKABLE", "This passage has no lock.");
        if (transition.locked !== expectedLockedState) {
            return deps.fail(expectedLockedState ? "PASSAGE_ALREADY_UNLOCKED" : "PASSAGE_ALREADY_LOCKED", expectedLockedState ? "This passage is already unlocked." : "This passage is already locked.");
        }
        if (matchingKeyItems(actor, transition.lockId, world, deps.getItemDefinition).length === 0) return deps.fail("MATCHING_KEY_REQUIRED", "Actor does not possess a key for this lock.");
        const reciprocal = reciprocalTransition(location.id, transition, world, deps.getLocation);
        if (!reciprocal || reciprocal.lockId !== transition.lockId || reciprocal.locked !== transition.locked) return deps.fail("PASSAGE_LOCK_STATE_INVALID", "The reciprocal side of this lock is inconsistent.");
        return deps.ok({ transition:transition });
    }

    function setPassageLocked(sourceLocationId, destinationId, locked, world, deps) {
        const source = deps.getLocation(sourceLocationId, world);
        const transition = findLocationExit(source, destinationId);
        const destination = transition && deps.getLocation(transition.destinationId, world);
        const reciprocal = transition && reciprocalTransition(sourceLocationId, transition, world, deps.getLocation);
        if (!source || !transition || !destination || !reciprocal || !transition.lockId || reciprocal.lockId !== transition.lockId) throw new Error("Cannot update an inconsistent passage lock.");
        function update(location, entry) {
            const raw = location.exits[entry.key];
            const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { destinationId:entry.destinationId };
            record.destinationId=entry.destinationId; record.lockId=entry.lockId; record.locked=Boolean(locked);
            if (!Object.prototype.hasOwnProperty.call(record,"lockedReason")) record.lockedReason=entry.lockedReason || "The door is locked.";
            location.exits[entry.key]=record;
        }
        update(source,transition); update(destination,reciprocal); return transition;
    }

    setup.PassageRules = { locationExitEntries, findLocationExit, matchingKeyItems, reciprocalTransition, lockActionOptions, validateLockAction, setPassageLocked };
}());
