# Grounding, Keyed Containers & Timelapse Access

## Status
Implementation specification for the next AI RPG engine patch.

## 1. Purpose

This patch strengthens epistemic grounding, improves post-timelapse reflection robustness, adds key-gated containers, and fixes the semantics of lockable-passage traversal during timelapse.

The implementation must remain generic. No engine behavior may be hard-coded specifically for Mara, Garrick, Harlan, Nell, the Slab, or a particular location.

## 2. Fabrication Requires In-Character Motivation

AI characters may lie, deliberately mislead, make incorrect inferences, misunderstand another character, and hold false beliefs.

These behaviors must remain possible.

However, an AI character must not invent an unobserved event, statement, permission, intention, request, promise, belief, or other occurrence merely to make dialogue flow naturally.

If an assertion is not supported by perceived events/dialogue or by an existing belief/inference of the character, then presenting it as true requires a deliberate in-character decision to deceive or misrepresent reality for a concrete character-level reason.

Valid examples include:

- Nell infers that the Traveler probably wanted to see Garrick because he helped her find him.
- Nell knows the Traveler never asked for Garrick but deliberately tells Garrick otherwise because she wants him to open the door.

Invalid example:

- Nell casually invents that the Traveler wanted to speak with Garrick solely because that connective detail makes the conversation easier to continue.

## 3. Reflection Must Preserve Epistemic Provenance

Post-event reflection must not retrospectively convert:

- a lie into an observed fact;
- an inference into an observed fact;
- uncertainty into certainty;
- something the character merely said into something that objectively happened.

For example, `I told Garrick that the Traveler wanted to see him` is distinct from `The Traveler wanted to see Garrick`.

Likewise, `I assumed Mara would not mind me using the Slab` is distinct from `Mara gave me permission to use the Slab`.

## 4. Reflection Character Context

Post-timelapse reflection must receive the same canonical AI-visible character representation already used by normal AI decision context rather than reconstructing character identity from prose.

The reflection request must therefore have grounded canonical mappings such as:

```json
{
  "id": "hoodedWoman",
  "name": "Mara the Hedge Witch"
}
```

Reuse the existing grounded character-view projection. Do not expose an omniscient global character roster merely to solve ID lookup.

## 5. Relationship Target IDs

Any relationship update returned by reflection must use a canonical character ID present in the supplied grounded context.

Unknown or invented target IDs remain invalid.

## 6. Reflection Repair and Partial Salvage

If reflection returns an otherwise usable result containing an invalid relationship target:

1. perform at most one bounded repair request;
2. explicitly require canonical target IDs available in that reflection context;
3. ask the model to correct the malformed result without inventing new targets.

If the repair still fails, discard only invalid relationship update entries when the remaining memory/belief updates are structurally and semantically valid enough to commit safely.

Do not fail the entire reflection solely because one relationship entry uses a malformed target ID.

## 7. Post-Timelapse Mind Processing Is Non-Fatal

Once every required timelapse round has successfully committed, the coarse-time period has happened.

Post-timelapse reflection, memory consolidation, reconciliation, or maintenance failure must not invalidate that already completed period.

For a successful Night:

```text
5 committed rounds
-> mind processing attempted
-> mind processing failures remain diagnostic
-> safe finalization continues
-> time becomes Morning
```

For a successful Day:

```text
5 committed rounds
-> required settlement successfully committed where applicable
-> mind processing attempted
-> mind processing failures remain diagnostic
-> safe finalization continues
-> time becomes Evening
```

World-state failures before completion retain existing failure semantics. Planning, traversal, committed-round execution, required settlement, and final canonical validation remain capable of failing the timelapse.

Mind failures must be included in diagnostics rather than silently discarded.

## 8. Key-Gated Container Property

A container may optionally require a specific ordinary key item instance.

The authored/runtime representation should use a stable reference equivalent to:

```json
{
  "requiredKeyItemId": "specific_key_instance_id"
}
```

The reference is to an item instance, not merely an item definition or family.

## 9. Keys Are Ordinary Transferable Items

Container keys are ordinary item instances. Existing item mechanics apply to them.

They may be given to another character, placed elsewhere, lost, or taken when otherwise legal. Giving the physical key transfers access.

No abstract ownership/permission flag is introduced.

## 10. Direct Inventory Requirement

A keyed container is accessible only when the required key item instance is directly present in the acting character's normal inventory.

A key on a table, in another container, in another character's inventory, or elsewhere in the room does not grant access.

Equipment does not implicitly count as direct inventory possession.

## 11. Container Visibility and Contents

A character without the required key may perceive the container itself but must not receive canonical disclosure of the protected contents through current-world view generation.

Existing memories may independently tell the character what they believe is inside; inaccessible container data must not confirm that belief.

A character carrying the required key receives normal canonical visibility of the contents when the container is otherwise physically accessible. This does not depend on memory: a character may have forgotten what is stored inside, inspect the container while carrying the key, and learn the current contents again.

## 12. Container Actions

Without the required key, protected contents must not generate or validate item interactions through that container.

This includes at minimum:

- `take_item`;
- `place_item`;
- `use_item` where such use would otherwise be possible;
- `study_item`;
- equivalent future actions targeted at protected contents.

A character cannot place an item into the keyed container without the required key.

Use one shared container-access predicate rather than duplicating key checks independently in UI, AI view generation, ordinary action validation, and timelapse code.

## 13. No Container Lock State

Key-gated containers deliberately do not introduce open/closed or locked/unlocked state and do not add `open_chest`, `close_chest`, `lock_chest`, or `unlock_chest` actions.

Access is determined directly by current possession of the required key.

This is intentionally simpler than passage locking.

## 14. Timelapse Container Access

Timelapse must use the same container-access rule as ordinary gameplay.

An item inside a keyed container is unavailable to a timelapse actor who lacks the required key. In particular, `study_item` must not expose an inaccessible study item merely because the actor is in the same room.

Possessing the required key makes the protected contents available normally for timelapse purposes.

## 15. Persistent Passage Lock State

Lockable passages retain their existing canonical persistent `locked` state.

Ordinary grounded `lock` and `unlock` actions modify that state. It persists across ordinary ticks, character movement, save/load, timelapse entry, and timelapse completion until another grounded action changes it.

Timelapse must never infer that a passage is locked merely because it is lockable.

## 16. Timelapse Traversability

Timelapse pathfinding uses the following rule:

```text
unlocked passage -> traversable by everyone
locked passage + actor directly carries a matching passage key -> traversable by that actor
locked passage + actor lacks a matching passage key -> not traversable by that actor
```

A passage already unlocked before timelapse therefore remains traversable by characters without keys.

## 17. No Synthetic Unlock/Relock During Timelapse

Timelapse traversal through a locked passage by a key holder does not need to mutate canonical lock state.

Do not synthesize `unlock -> move -> relock` merely to represent coarse-time traversal.

A character carrying the matching passage key may traverse a canonically locked passage during timelapse while the persistent `locked` state remains true.

Ordinary gameplay remains unchanged: if a character wants to change persistent door state for everyone, it must use the ordinary formal `lock` or `unlock` action.

## 18. Reciprocal Passage State

Both sides of one physical lockable passage must continue to resolve to one consistent canonical lock state.

## 19. Regression Coverage

Add regression coverage for at least:

- decision grounding explicitly permits deliberate lies but rejects motivation-free fabrication;
- reflection grounding preserves observation/inference/lie distinctions;
- reflection receives grounded canonical character IDs and descriptions;
- malformed relationship target triggers one repair attempt;
- failed relationship repair can drop only invalid relationship entries while preserving valid updates;
- reflection or maintenance failure after five committed rounds does not prevent successful Day -> Evening or Night -> Morning transition;
- unkeyed containers retain current behavior;
- keyed container contents are visible/actionable to a direct key holder and hidden/inaccessible without the key;
- transferring the key transfers access and dropping/transferring it away removes access;
- a key elsewhere in the room does not count;
- without the key, `place_item` into the container fails;
- timelapse `study_item` cannot target an item inside an inaccessible keyed container;
- an unlocked lockable passage is traversable by everyone during timelapse;
- a locked passage is traversable during timelapse by a matching key holder without changing persistent lock state;
- a locked passage blocks a timelapse actor without the key;
- passage state survives save/load and timelapse boundaries.

## 20. Non-Goals

This patch does not introduce lockpicking, breaking containers, trespassing law, generic ownership law, container open/close state, a deception skill/stat system, automatic truth verification of dialogue, new trading mechanics, or new professional schedules.
