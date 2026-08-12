# AI RPG Authored Content Specification — Scene-Agnostic Character Descriptions

## 1. Scope

This document contains the authored world-data changes that accompany the Timelapse Hardening and Progressive Committed Output patch.

The main authored-content goal is to remove persistent character-description text that assumes a particular current scene, pose, location, held object, or activity.

Static authored descriptions should describe identity, appearance, personality, biography, role, and durable tendencies. Current situation must come from canonical runtime state, `position_text`, observations, memory, inventory, and other live view data.

This is especially important because the shared controller view exposes public character descriptions to AI-controlled characters as well as to the HumanController.

## 2. Explicitly Out of Scope

Do not add or modify:

- aura text;
- daytime timelapse content or jobs;
- equippables;
- gifts for Nell or other characters;
- new items solely for this patch;
- new timelapse actions;
- narrator-authored prose;
- residence/lodging facts already added by the previous overnight timelapse patch unless a regression is found during implementation.

## 3. Description Authoring Rule

Persistent character descriptions must not assert transient facts such as:

- currently sitting or standing;
- currently behind the bar;
- currently holding or drinking ale;
- currently watching a particular room;
- newly arriving at the starting tavern;
- being in a specific room right now;
- currently resting, fighting, travelling, or pursuing a task unless that is a durable identity fact rather than a scene state.

Prefer durable wording such as:

- occupation/role;
- physical appearance;
- personality and habitual style;
- biography;
- ordinary responsibilities;
- long-term residence;
- broad tendencies that still leave the model free to act according to current canonical state.

Do not duplicate canonical `position_text` or current inventory state inside static descriptions.

## 4. Traveler — `aiDescription`

Replace the current start-scene-dependent AI description with:

> You are the Traveler, an itinerant wanderer accustomed to roads, unfamiliar places, and changing circumstances. Your deeper history, motives, and immediate goals are intentionally open-ended unless they have been established in play. Do not assume a particular current location or activity from this description; use the canonical view, observations, and memory to understand what is happening now.

This removes the assumption that the Traveler has just arrived at the roadside tavern.

## 5. Captain John Price — `aiDescription`

Replace the current scene-dependent AI description with:

> You are Captain John Price from Call of Duty, exactly as yourself rather than a fantasy adaptation. You are a seasoned British soldier and commander: calm under pressure, observant, pragmatic, decisive, dryly funny, direct, and capable of rough but genuine friendliness. You habitually assess people and situations without making a show of it. You are not automatically on a mission in this world; act according to the circumstances, commitments, and interests actually established in play. Do not assume that you are currently drinking, resting, fighting, travelling, or pursuing a task unless the canonical view, observations, or memory establish it. Do not invent an explanation for why you are in this fantasy world; treat your presence here as ordinary fact.

This specifically removes the persistent assumptions that Price is currently off duty at a table, resting, and drinking ale.

## 6. Garrick — `aiDescription`

Keep Garrick's existing biography/personality content, but replace the overly fixed bar-position sentence:

> You normally remain behind the bar unless you have a good reason to leave it.

with:

> When working the tavern you usually tend the bar, but you leave it whenever your work, personal needs, or circumstances give you a reason to do so.

The rest of Garrick's existing `aiDescription` remains unchanged unless implementation discovers another equally concrete transient-scene assertion.

## 7. Mara and Nell — `aiDescription`

Mara's and Nell's current AI descriptions are primarily biography, personality, role, residence, and durable behavioral context.

Do not rewrite them merely for stylistic consistency.

In particular:

- Mara living/working at her cottage is durable world knowledge, not a claim that she is physically there at every moment;
- Nell's ordinary tavern work and sleeping arrangement are durable role/residence facts, not a forced schedule.

Only remove wording if it actually asserts a transient current scene rather than a durable tendency.

## 8. Public `playerDescription` Cleanup

Public `playerDescription` is also persistent authored data and appears in the shared controller view. It must not contradict canonical runtime state by baking in a specific current pose, held object, or room.

Update the following descriptions to scene-agnostic appearance/identity text.

### 8.1 Traveler

Replace:

> A rain-soaked traveller takes in the surroundings.

with:

> A road-worn traveler carries the look of someone accustomed to unfamiliar places and long journeys.

Do not assert that the Traveler is currently wet, newly arrived, or looking around.

### 8.2 Mara / Hooded woman

Replace the action-like persistent wording with:

> A hooded young woman keeps much of her expression in shadow; what can be seen suggests a striking face and a guarded, self-contained manner.

Do not reveal hidden mechanics or information that the public identity system is intentionally withholding.

### 8.3 Garrick

Replace:

> Garrick the Innkeeper stands behind the bar with the solid, watchful bearing of a man who has spent years keeping both soldiers and drinkers in line.

with:

> Garrick the Innkeeper is a solid, watchful man with the disciplined bearing of someone who spent years among soldiers before taking up tavern work.

Do not assert his current sublocation or posture.

### 8.4 Captain John Price

Replace the current sitting/drinking description with:

> Captain John Price has a weathered face, unmistakable moustache and beard, a boonie hat, and modern tactical clothing and gear that look entirely out of place in this world. He carries himself with the easy alertness of a veteran soldier.

Do not assert that he is sitting, holding a mug, drinking ale, or currently inside the tavern.

### 8.5 Nell

Replace the current standing/work-ready description with:

> A young tavern waitress of about eighteen wears a cheap, repeatedly mended dress and apron, all kept clean and carefully neat. She has an open, cheerful face, with a trace of caution around unfamiliar people.

Do not assert that she is currently standing or actively working.

## 9. Preserve Dynamic State in Dynamic Fields

After this cleanup, transient state continues to be communicated through existing canonical/runtime mechanisms, including as applicable:

- `location_id`;
- `sublocation_id`;
- `position_text`;
- `sleeping`;
- inventory;
- visible items;
- current observations;
- recent memories;
- actual formal action results;
- timelapse committed facts.

Do not compensate for removing transient text from static descriptions by adding a second hard-coded scene description elsewhere.

## 10. Save/Load Expectations

These are authored world-data corrections.

Under the existing fresh-authored-world + saved-runtime-overlay model:

- loading an existing compatible save should use the corrected authored descriptions;
- runtime state such as position, inventory, memory, relationships, beliefs, money, and sleeping state should continue to come from the save overlay;
- the user should not need to restart the current playthrough merely to receive corrected static descriptions.

Do not introduce a migration that copies stale saved descriptions back over the corrected authored world data.

## 11. No Aura Changes

Do not add, remove, rewrite, normalize, or migrate any aura text in this patch.

Aura content was authored separately and is not part of these description corrections.

## 12. Authored Content Tests

Verify at least the following:

- Traveler `aiDescription` no longer says they just arrived at the tavern;
- Price `aiDescription` no longer assumes current drinking/resting/table activity;
- Garrick `aiDescription` treats tending the bar as an ordinary work tendency rather than a fixed current position;
- Mara and Nell durable biography/role content remains intact;
- Traveler public description does not require current rain/wetness;
- Garrick public description does not require current position behind the bar;
- Price public description does not require sitting, holding ale, or being in the tavern;
- Nell public description does not require standing/working at the current moment;
- public descriptions remain compatible with characters sleeping, travelling, visiting another location, or otherwise changing runtime state;
- loading the current compatible save does not restore old scene-coupled authored descriptions over the corrected world data;
- no aura content changes;
- no new item, equippable, gift, job, daytime timelapse, or narrator content is introduced by this authored-data patch.

## 13. Acceptance Criteria

The authored-content portion is complete when:

- static character descriptions remain sensible regardless of current location/pose/activity;
- current state is communicated only by canonical runtime fields and committed events rather than stale authored scene text;
- Price can leave the tavern, stop drinking, or sleep without his static description still saying he is sitting with ale;
- Garrick can leave the bar without his static description asserting that he is behind it;
- the Traveler can progress beyond the opening scene without still being described as newly arrived/rain-soaked;
- existing Mara/Nell biography and residence knowledge remains intact;
- current saves remain usable under the existing authored-world/runtime-overlay save model;
- aura content remains untouched.
