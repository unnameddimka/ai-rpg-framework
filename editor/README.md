# World Editor — Author Guide

1. Double-click `world-editor.html`.
2. Click **Open world.json**.
3. Select the JSON file supplied by the administrator.
4. Edit locations, characters, abilities, item types, and persistent item instances. Character, location, and optional position inventories can be edited directly inside their forms; the global **Items** list shows the same flat instances.
5. Click **Validate** and correct any reported errors.
6. Click **Download world.json**.
7. Send the downloaded file to the administrator.

Consumable and fillable item types may declare explicit state transitions; equippable slot metadata can be authored for later runtime support.
Text-input item use actions may use deterministic `abstract_study` progress or model-backed `utility_query`. For `abstract_study`, the normal private feedback is the survey-stage text; optional focused and saturated feedback fields can describe deeper study and diminishing returns without generating new lore.

The editor works offline. It never uploads data and never overwrites the original file.
No command line, server, account, or development software is required.
