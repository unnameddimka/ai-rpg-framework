# World Editor — Author Guide

1. Double-click `world-editor.html`.
2. Click **Open world.json**.
3. Select the JSON file supplied by the administrator.
4. Edit world settings (including the grounded-item policy), locations, characters, abilities, item types, persistent item instances, day activities, secrets, random outcome tables, and triggered events. Character, location, and optional position inventories can be edited directly inside their forms; the global **Items** list shows the same flat instances. Some newer authored entity types intentionally use minimal/raw JSON controls, but every authored entity type is surfaced.
5. Click **Validate** and correct any reported errors.
6. Click **Download world.json**.
7. Send the downloaded file to the administrator.

Consumable and fillable item types may declare explicit state transitions. Equippable item types may author free-form equip slots and equipped descriptions; inventory/equipped starting placement is supported and runtime `equip`/`unequip` uses the same authored metadata. Sleep-capable sublocations may optionally declare `sleepCapacity` separately from ordinary occupancy `capacity`.
Text-input item use actions may use deterministic `abstract_study` progress or model-backed `utility_query`. For `abstract_study`, the normal private feedback is the survey-stage text; optional focused and saturated feedback fields can describe deeper study and diminishing returns without generating new lore.

The editor works offline. It never uploads data and never overwrites the original file.
No command line, server, account, or development software is required.

`groundedItemPolicy` is free-form authored Character-AI guidance defining semantic item categories reserved to formal mechanics. The editor preserves it but does not infer or validate semantic coverage against item definitions; broad categories may intentionally conceal secret instances.
