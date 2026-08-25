# Mallowstead World Update
## Maksym the Wagoner — Fresh-World Evening Placement

**Status:** Implementation specification  
**Scope:** Authored world-state change only  
**Target path:** `docs/world/`

---

This implementation also includes one small authored-world change for the fresh Mallowstead starting scene.

## 16.1 Fresh-world evening placement

On a newly created world, which starts on **Monday · Evening**:

- Maksym the Wagoner is present in the tavern;
- he is seated at the **second table**;
- he starts with **one filled mug of ale** as his current drink.

The starting state should be authored/canonical, not produced by a scripted first-turn action.

The filled mug must be a normal tracked item instance using the existing mug/ale mechanics and must not require any special-case runtime behavior.

## 16.2 Existing routine remains unchanged

This starting-scene change must not alter Maksym's existing schedule or behavior:

- he sleeps in his wagon/caravan;
- he works on the Market Square;
- existing daytime/nighttime timelapse behavior, workplace logic, sleep logic, AI controller behavior, and movement rules remain unchanged.

The tavern placement is only the authored initial state for the first evening of a fresh world.

## 16.3 Save/migration behavior

Existing saves must preserve their saved canonical state and must not be forcibly moved to the new starting placement.

The new authored starting placement applies to:

- fresh worlds;
- migrations only where the project's existing authored-world migration semantics would normally introduce/repair missing authored initial data without overwriting saved runtime position.

Do not teleport Maksym in an established save merely to match the new fresh-world scene.

## 16.4 Tests

Add coverage confirming:

- a fresh Monday-evening world starts with Maksym seated at the second tavern table;
- Maksym has one normal filled mug of ale in the expected canonical possession/location state;
- his authored sleep location remains the wagon/caravan;
- his authored workplace remains the Market Square;
- existing saves do not have Maksym's runtime location overwritten by this change.

---

## Acceptance Criteria

This world update is complete when:

1. A fresh **Monday · Evening** world starts with Maksym the Wagoner seated at the second tavern table.
2. Maksym starts with one normal tracked mug already filled with ale.
3. The mug uses existing item/ale mechanics and requires no runtime special case.
4. Maksym's normal routine is unchanged: he sleeps in his wagon/caravan and works on the Market Square.
5. Existing timelapse, workplace, sleep, movement, and AI-controller behavior remain unchanged.
6. Existing saves preserve Maksym's saved runtime location/state and are not teleported back to the tavern.
