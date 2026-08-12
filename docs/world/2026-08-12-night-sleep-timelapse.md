# AI RPG Authored Content Specification — Night Sleep Timelapse

## 1. Scope

This document contains only authored world-content changes required by the Night Sleep Timelapse patch.

Engine/runtime behavior belongs in the separate implementation specification.

Aura content is explicitly out of scope. The relevant aura text has already been authored directly in `world.json` and must not be added or changed by this patch.

## 2. Existing Beds

Ensure every existing canonical bed participates in the shared bed/sleep system required by the implementation spec.

Relevant authored sleeping places include at least:

- Captain Price's rented tavern Guest Room 1 bed;
- Garrick's bed in the tavern owner/master room;
- Nell's bed in her tavern nook;
- Mara's bed in her cottage;
- other existing tavern guest-room beds.

Do not create narrative-only sleep objects.

Beds remain ordinary canonical sublocations/furniture integrated with the existing location/sublocation/posture model.

The runtime must be able to identify a concrete `bedId`, including future rooms with multiple beds.

## 3. Captain Price — Guest Room 1

### 3.1 Key placement

Move the existing Guest Room 1 key from Garrick's initial inventory to Captain Price's initial inventory.

The key continues to use the existing canonical lock/key mechanics.

### 3.2 Starting lodging

At game start, Captain Price is renting/staying in tavern Guest Room 1.

Do not force Price to start physically inside the room. He may begin in the common room while carrying the key and knowing where he is staying.

### 3.3 Known facts

Price knows that:

- he is renting/staying in Guest Room 1 at the tavern;
- it is his usual sleeping place while staying there;
- he has the key.

Garrick knows that:

- Price is renting/staying in Guest Room 1;
- Price has the room key.

Nell knows that:

- Price is staying in Guest Room 1 / the first tavern guest room.

The Human/Traveler should know that Price is staying in the first tavern guest room if the Human character participates in the authored `knownFacts` mechanism.

Mara must **not** receive the Price lodging fact merely from initial world data.

## 4. Usual Sleeping-Place Known Facts

Each relevant character gets an authored fact identifying their own ordinary sleeping place.

### Garrick

Garrick knows that he lives at the tavern and normally sleeps in his owner/master room bed.

### Nell

Nell knows that she lives at the tavern and normally sleeps in her nook bed.

### Mara

Mara knows that she lives in her cottage and normally sleeps in her cottage bed.

### Captain Price

Covered by the Guest Room 1 facts above.

These facts guide model planning. They are not schedules and must not force a character to sleep there.

## 5. Cross-Character Residence Knowledge

Add the agreed ordinary residence knowledge.

### Garrick knows

- Mara lives in her cottage.

### Nell knows

- Mara lives in her cottage.

### Mara knows

- Garrick lives at the tavern.
- Nell lives at the tavern.

Use ordinary in-world wording, not implementation IDs or timelapse terminology.

Do not infer extra secret/private residence facts beyond the agreed authored knowledge.

## 6. Tavern Common Room Timelapse Action

Add a location-specific authored timelapse action to the tavern common room.

Suggested stable ID:

`clean_common_room`

Suggested label:

`Clean the common room`

This action is **timelapse-only**.

It must never appear in ordinary world-tick `view.available_actions`.

In normal gameplay, mug handling remains atomic: characters take, carry, empty, and store individual mugs through ordinary actions.

## 7. `clean_common_room` Effect

Bind `clean_common_room` to a reusable allowlisted deterministic timelapse effect.

The effect must:

1. find every mug instance currently present in the tavern common room's public room/sublocation inventories or surfaces, including tables and equivalent canonical public storage positions;
2. exclude mugs held in any character inventory;
3. empty every collected mug;
4. move all collected mug instances into Garrick's existing mug cupboard/storage;
5. emit a grounded committed result suitable for the final invisible overnight narrative.

The action compresses many ordinary take/carry/empty/store operations into one timelapse round.

If no eligible mugs exist, the action remains valid and produces a grounded no-op result.

Do not create or destroy mug instances.

## 8. Authored Data Shape

Use the generic location `timelapseActions` mechanism from the implementation spec.

The common-room action should be world-authored data, not a tavern-specific code branch.

Conceptually it contains:

- stable action ID;
- display label/description;
- allowlisted deterministic `effectId`;
- effect parameters identifying the mug item category/type and Garrick's destination cupboard/storage.

Exact property naming should follow existing project action conventions where practical.

## 9. No Aura Changes

Do not add, remove, rewrite, normalize, or migrate aura text in this patch.

Aura content was authored separately in `world.json`.

## 10. Authored Content Tests / Fixtures

Verify:

- Guest Room 1 key starts with Price rather than Garrick;
- Price's key still opens the existing Guest Room 1 lock;
- agreed known facts exist on the correct characters and are absent from Mara where specified;
- each relevant character has the agreed usual sleeping-place fact;
- Garrick and Nell know Mara lives in her cottage;
- Mara knows Garrick and Nell live at the tavern;
- existing beds are valid concrete sleep targets;
- tavern common room exposes `clean_common_room` only through the timelapse-action projection;
- cleanup empties and moves eligible mugs to Garrick's cupboard;
- mugs held by characters are untouched;
- ordinary world-tick action lists do not expose the cleanup macro.
