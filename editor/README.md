# World Editor — Author Guide

1. Double-click `world-editor.html`.
2. Click **Open world.json**.
3. Select the JSON file supplied by the administrator.
4. Edit locations, characters, abilities, item types, persistent item instances, and their starting containers.
5. Click **Validate** and correct any reported errors.
6. Click **Download world.json**.
7. Send the downloaded file to the administrator.

Consumable and fillable item types may declare explicit state transitions; equippable slot metadata can be authored for later runtime support.

The editor works offline. It never uploads data and never overwrites the original file.
No command line, server, account, or development software is required.
