# Memory Stone Authoring Specification

## Goal

Add one authored world item, **Memory Stone**, configure its generic item interaction, and place it into the canonical world.

This specification covers authored world/content data only. Engine effect execution, private observation delivery, and save migration are defined separately.

## Item definition

Add an ordinary item definition named **Memory Stone** using the existing item-definition model. It is not a special engine entity type.

The definition must include a short grounded in-world description. The prose must not mention AI, controllers, JSON, tokens, context windows, save files, arrays, databases, or other implementation concepts.

The item may be described as an unusual smooth dark stone that fits comfortably in a closed hand and feels subtly warm or otherwise uncanny.

## Stable authored instance

Add exactly one concrete authored item instance with a stable globally unique ID:

`memoryStone_01`

Its definition ID is:

`memoryStone`

The stable instance ID is part of the authored identity of this particular stone and must not change between compatible builds.

## Initial placement

Place `memoryStone_01` in the **Village temple**, beside the crystal sphere.

Use the existing authored inventory/location placement model. Do not create or place it through startup code.

The current temple has one canonical standing position before the crystal sphere, so the temple's authored location inventory is the appropriate starting container.

## Generic use interaction

Configure the item through the generic authored item-use mechanism.

The player/model-facing action label is:

**Squeeze in hand**

The action references the deterministic allowlisted engine effect:

`report_memory_counts`

The authored public physical-action text should render naturally using the acting character, for example:

> Mara squeezes the memory stone in one hand.

The authored private feedback template should be natural in-world prose rather than debug/JSON output, for example:

> The stone grows faintly warm in your hand. Short-term memory: 17 entries. Long-term memory: 83 entries.

The private template may use the engine-provided memory-count and singular/plural word placeholders but contains no executable code.

## Availability

The interaction is usable through the ordinary item-action rules while the stone is in the acting character's inventory.

Do not add HumanController-specific or AIController-specific authoring rules.

## Acceptance criteria

- `data/world.json` contains one `memoryStone` item definition.
- The definition has grounded descriptive prose.
- The definition declares the generic **Squeeze in hand** interaction.
- The interaction references `report_memory_counts` rather than special Memory Stone engine code.
- `data/world.json` contains exactly one stable authored `memoryStone_01` instance.
- The instance starts in the Village temple beside the crystal sphere using normal authored inventory placement.
- No runtime or migration logic is embedded in world data.
