# Mara's Forest Stream — Authoring Update

## Status

Implemented authoring update.

## 1. Scope

Add one new authored location connected directly to Mara's cottage: a quiet forest stream at the foot of the mountains.

This is a world-authoring/content change only. It adds no new engine mechanics, item behavior, AI rules, timelapse behavior, or special-case code.

The location should provide a peaceful nearby place that characters can visit together, including a dedicated place where exactly two characters can sit beside the stream.

## 2. New Location

Add a location with stable ID:

```text
forestMountainStream
```

Recommended authored fields:

```text
id: forestMountainStream
type: location
name: Forest stream
passage: Forest Stream
```

The location represents a secluded stream running through the woods near Mara's cottage, where the forest begins to rise toward the mountains.

### Description

Use concise authored facts along these lines:

- A clear forest stream runs over dark stones at the foot of the mountains, not far from Mara's cottage.
- Pines and old broadleaf trees crowd the banks, while the mountain slopes rise beyond them through the forest.
- The place is quiet and secluded enough to linger without the village close at hand.

Keep the description grounded. Do not author emotions, romance, weather, time of day, current lighting, sounds that require changing conditions, or the presence of any character.

## 3. Direct Connection to Mara's Cottage

Add a normal reciprocal unlocked exit between:

```text
secludedCottage
```

and:

```text
forestMountainStream
```

After the update, Mara's cottage should have at least:

```text
exits:
  villageEdge -> villageEdge
  forestMountainStream -> forestMountainStream
```

The new stream location should contain:

```text
exits:
  secludedCottage -> secludedCottage
```

Do not add a lock, key requirement, teleport, scripted transition, or special traversal rule. Movement uses the ordinary location-movement system.

The direct connection means the stream is treated as a nearby place reachable from Mara's cottage in one normal move.

## 4. Sublocations

The new location should contain at least two sublocations.

### 4.1 Stream Bank

Stable ID:

```text
forestStreamBank
```

Suggested fields:

```text
name: Stream bank
enterLabel: Stand by the forest stream
selfText: You are standing on the bank of the forest stream.
occupantTemplate: {name} stands on the bank of the forest stream.
capacity: 12
```

Suggested `publicText`:

> A narrow bank follows the clear water between roots, moss, and dark stream-worn stones.

This is the default sublocation for the location.

### 4.2 Sitting Place by the Stream

Stable ID:

```text
forestStreamSittingPlace
```

This is a deliberately small shared sitting place intended for two characters.

Suggested fields:

```text
name: Stones by the stream
enterLabel: Sit together by the stream
selfText: You are sitting beside the stream.
occupantTemplate: {name} sits beside the stream.
capacity: 2
```

Suggested `publicText`:

> A pair of broad, smooth stones beside the water make a comfortable place for two people to sit close to the stream.

Do not implement any special "date", couple, romance, companion, or paired-seating mechanic. Capacity `2` and ordinary co-location are sufficient.

## 5. Sublocation Reachability

Use ordinary within-location movement.

Recommended reachability:

```text
forestStreamBank
  -> forestStreamBank
  -> forestStreamSittingPlace

forestStreamSittingPlace
  -> forestStreamSittingPlace
  -> forestStreamBank
```

No special movement restrictions are required.

## 6. Inventory and Items

The location may use the normal location inventory required by the world schema, but starts with no authored loose items.

Do not add gifts, flowers, food, furniture, magical objects, fishing equipment, or other props as part of this task.

The sitting stones are scenery represented by the sublocation, not item instances.

## 7. Characters

Do not change any character's starting location.

In particular, Mara continues to start according to the existing authored world configuration. The new stream is simply somewhere she or another character may travel through ordinary actions.

Do not add memories, known facts, beliefs, relationships, observations, or scripted awareness of the stream to Mara or anyone else.

Characters can discover and use the location through the normal world/view/action flow.

## 8. Presentation Intent

The authored location should feel:

- secluded;
- naturally beautiful;
- close enough to Mara's cottage to be part of her nearby surroundings;
- suitable for a quiet private conversation between two characters;
- connected visually to the mountains without requiring a separate mountain location yet.

Keep this as environmental authoring rather than scripted mood. The presentation narrator may render the supplied static facts into prose using the existing narration system.

## 9. Files / Generation

Implement the authored change in the canonical world source:

```text
data/world.json
```

Then regenerate normal generated world data/passages using the existing project workflow.

Do not hand-maintain generated outputs as an alternative to updating `data/world.json`.

No engine source changes should be necessary unless an existing generic authoring/generation bug prevents the location from working.

## 10. Validation / Tests

Verify that:

1. `forestMountainStream` exists as a valid authored location.
2. `secludedCottage` has an exit to `forestMountainStream`.
3. `forestMountainStream` has a reciprocal exit to `secludedCottage`.
4. Both exits are ordinary unlocked movement.
5. `forestStreamBank` is the default sublocation.
6. `forestStreamSittingPlace` has capacity `2`.
7. Two characters can occupy `forestStreamSittingPlace` together.
8. A third character cannot occupy it when both places are already taken, using the existing generic capacity rules.
9. Characters can move between the bank and sitting place through normal `move_within_location` actions.
10. The new location requires no special-case engine code.
11. Existing Mara cottage and village-edge connectivity remains intact.
12. World generation and existing authoring/generator tests continue to pass.

## 11. Non-Goals

This task does not add:

- romance/date mechanics;
- special dialogue;
- scripted Mara behavior;
- new AI instructions;
- weather;
- fishing;
- swimming;
- mountain traversal;
- new items;
- new NPCs;
- timelapse actions;
- automatic memories or observations;
- special seating mechanics beyond the existing sublocation capacity system.
