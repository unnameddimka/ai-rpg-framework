# Codex Task — Standalone File-Based World Editor MVP

## Goal

Create a simple offline browser editor that a non-technical world author can use without installing or configuring anything.

The author must be able to:

1. open one HTML file by double-clicking it;
2. select an existing JSON world-data file through the normal browser file picker;
3. edit major locations, exits, and sublocations through forms;
4. see understandable validation errors;
5. download a replacement JSON file;
6. send that file to the project administrator.

The administrator will manually copy the exported JSON into the repository and run the existing tests/build.

The editor must not write directly into the repository, execute commands, start a server, invoke Tweego, or modify Twee files.

---

## 1. User and operating assumptions

The primary editor user may have no development environment.

Assume only:

- a modern desktop browser;
- access to `world-editor.html`;
- access to a JSON data file supplied by the administrator;
- ordinary ability to choose and download files.

Do not require:

- Node.js or npm;
- VS Code;
- Twine or Tweego;
- a terminal or command prompt;
- a local web server;
- a browser extension;
- an account or network connection.

The editor must continue to work when the computer is offline.

---

## 2. Deliverable

Create one distributable file:

```text
editor/world-editor.html
```

It must contain its own:

- HTML;
- CSS;
- JavaScript;
- validation logic;
- field descriptions and help text.

Do not use:

- CDN scripts;
- external CSS;
- remote fonts;
- runtime package imports;
- fetch requests to local or remote files.

Opening this file through a `file://` URL must be supported.

Developer tests may use separate files in `tests/`, but the editor delivered to the author must remain one HTML file.

---

## 3. Scope of editable data

This first iteration edits only spatial world structure:

- major locations;
- location names;
- location descriptions;
- default sublocation selection;
- exits to other major locations;
- sublocations inside each location;
- sublocation names;
- sublocation descriptions or position prose;
- capacity;
- legal internal transitions;
- reachability declarations;
- optional inventory/container declaration already understood by the engine;
- capability IDs already supported by the engine, such as `pour_ale`.

Do not add editors for:

- characters;
- character controllers;
- items or item templates;
- quests;
- dialogue;
- AI prompts, memories, or attitudes;
- prices, shops, or economy;
- combat;
- scripts or arbitrary JavaScript.

Do not allow the author to enter executable code.

---

## 4. Data authority and file format

Use one versioned JSON data file as the editor input and output.

Preferred filename:

```text
world.json
```

If the current repository already uses a more specific authoritative filename such as `locations.json`, keep that filename rather than creating a second competing source of truth. Document the choice in `README.md` and the task completion summary.

The JSON must contain a schema version, for example:

```json
{
  "schemaVersion": 1,
  "locations": {}
}
```

Use stable object IDs as keys or explicit `id` fields consistently with the existing engine data model.

The editor must not silently rename existing IDs.

Unknown data preservation requirement:

- preserve unknown top-level properties;
- preserve unknown properties on existing location and sublocation records whenever practical;
- editing known fields must not erase unrelated future data;
- if safe preservation is impossible, block export and explain exactly which unsupported structure would be lost.

The editor may normalize formatting and object ordering when exporting, but it must not change semantic data that the user did not edit.

Export JSON as UTF-8 with readable indentation.

---

## 5. Initial screen

When opened, the editor should show a short, plain-language workflow rather than an empty technical form.

Required controls:

```text
Open world.json
Create new empty world
Download world.json
```

Recommended Russian UI labels:

```text
Открыть файл мира
Создать новый мир
Скачать файл мира
```

The exact language may follow the repository's current UI decision, but all labels must be understandable to a non-programmer. Do not expose raw JSON by default.

Before a file is loaded or a new world is created:

- editing controls may be hidden or disabled;
- explain that the original file is never overwritten;
- explain that Download creates a new file for the administrator.

---

## 6. Main editor layout

Use a simple form/list layout, not a graphical node map.

Recommended structure:

```text
Left column
    list of major locations
    Add location

Main panel
    selected location fields
    exits
    sublocation list
    selected sublocation fields

Top or bottom action area
    Validate
    Download world.json
```

The UI must remain usable at common laptop resolutions.

Avoid dense debug tables, raw object dumps, and developer terminology in the normal author view.

A collapsible read-only JSON preview is allowed but not required.

---

## 7. Major location editing

For each major location expose at least:

- stable technical ID;
- display name;
- base/public description;
- default sublocation;
- exits;
- list of sublocations.

### Location ID rules

The technical ID must:

- be non-empty;
- be unique;
- use a conservative ASCII format such as `camelCase`, `snake_case`, or `[A-Za-z][A-Za-z0-9_-]*`;
- not contain spaces;
- not be silently derived again after creation.

When creating a new location, the editor may suggest an ID from the display name. The user must be able to review it before creation.

Changing an existing ID is destructive because exits and references may depend on it.

If ID renaming is supported, require an explicit confirmation and update all references atomically. Otherwise make existing IDs read-only in this MVP.

Prefer making existing IDs read-only for simplicity and reliability.

### Adding and deleting locations

Adding a location must create a valid minimal record or guide the user to complete required fields.

Deleting a location must be blocked while:

- another location exits to it;
- it contains sublocations required by other references;
- it is designated as the initial/start location, if that concept already exists in the data.

The error must explain what references need to be changed first.

---

## 8. Exit editing

Exits connect major locations.

The editor must display exits as selections from existing location IDs/names, not free-form target strings.

For each exit, expose only fields already supported by the current data model, for example:

- destination location;
- player-facing label, if labels are stored in data;
- arrival/default behavior, if already supported.

Do not invent locked-door, conditional, scripted, or one-way mechanics unless they already exist in the engine schema.

Validation must catch:

- destination does not exist;
- self-exit when disallowed by the current model;
- duplicate equivalent exits;
- missing required label or target fields.

Do not automatically create a reverse exit. The author must choose whether the connection is one-way or two-way. The UI may offer an explicit convenience checkbox or button such as:

```text
Also create return exit
```

but it must be an explicit author action.

---

## 9. Sublocation editing

For each sublocation expose the fields already supported by the sublocation architecture, including as applicable:

- stable technical ID;
- display name;
- description/self-position text;
- public occupant text/template;
- capacity;
- inventory/container enabled or inventory ID;
- legal destination sublocations for internal movement;
- reachable sublocations;
- capability IDs.

Use controls appropriate to the data:

- numbers for capacity;
- checkboxes or multi-select lists for transitions/reachability;
- known capability choices rather than unrestricted script input;
- text areas for descriptions.

Do not allow a sublocation to reference a sublocation belonging to another major location unless the engine explicitly supports that field.

The location's default sublocation must be selected from its own sublocations.

Deleting the default sublocation must be blocked until another default is selected.

Deleting a referenced sublocation must be blocked or require an explicit repair choice for all references.

---

## 10. Capability editing

The editor is not a capability-definition tool.

It may only assign capability IDs from a known allowlist provided by the project, initially including capabilities already implemented by the engine, for example:

```text
pour_ale
```

Keep the allowlist in a clearly marked constant inside `world-editor.html` for this MVP.

Unknown capability IDs loaded from JSON must be preserved and visibly marked as unknown rather than silently deleted.

Do not permit arbitrary JavaScript, prompt text, or code snippets as capabilities.

---

## 11. Validation

Provide a visible `Validate` / `Проверить мир` action.

Also validate automatically before export.

Export must be blocked when errors exist.

Warnings may permit export only when they do not break structural integrity.

Required checks include:

### Whole document

- JSON loaded successfully;
- supported schema version;
- locations collection exists;
- technical IDs are unique and valid;
- required fields are present.

### Locations

- every default sublocation exists;
- every exit target exists;
- no invalid duplicate exits;
- descriptions and names have valid value types.

### Sublocations

- every sublocation belongs to exactly one location in the authoring model;
- every transition target exists in the same location;
- every reachable target exists and is allowed by the current schema;
- capacity is a valid positive integer or the specific unlimited representation supported by the engine;
- inventory/container declarations are structurally valid;
- capability values are strings and known/unknown status is shown.

### Referential integrity

- deleting or renaming records cannot leave dangling references;
- the JSON exported by the editor can be parsed back without loss of required data.

Validation messages must be written for a person, for example:

```text
Локация «Общая комната»: выход «В подвал» ведёт в несуществующую локацию `cellar`.
```

Avoid exposing only paths such as:

```text
$.locations[2].exits[1].target invalid
```

A technical path may be shown secondarily for the administrator, but not as the only explanation.

Clicking an error should select or scroll to the relevant record when practical.

---

## 12. Import behavior

Use a standard file input and `FileReader` or equivalent browser APIs that work from `file://`.

On import:

1. read the selected file as text;
2. parse JSON;
3. validate the document shape;
4. preserve the original object as the basis for edits;
5. show errors without discarding the user's current unsaved document unless the new file was loaded successfully.

Never upload the file anywhere.

Show the loaded filename and schema version.

If the file is malformed, display a clear error and leave the editor usable.

---

## 13. Export behavior

Use `Blob`, `URL.createObjectURL`, and a temporary download link or an equivalent offline-compatible method.

The editor must download a new file; it must never claim to have overwritten the original.

Preferred filename:

```text
world.json
```

If practical, when exporting after importing another filename, retain the authoritative project filename rather than adding browser-style version suffixes in code. The browser may still add a suffix when a file already exists; this is acceptable.

Before download:

- run full validation;
- block on errors;
- show a concise success summary;
- serialize readable UTF-8 JSON with indentation.

Add a visible instruction after download:

```text
Отправьте скачанный файл администратору. Он заменит файл данных в проекте и соберёт игру.
```

---

## 14. Unsaved changes

Track whether the in-memory document changed after load/export.

At minimum:

- show an `Unsaved changes` / `Есть несохранённые изменения` indicator;
- warn before loading another file or creating a new world when unsaved edits exist;
- use `beforeunload` to warn before closing/reloading the page with unsaved edits.

Do not implement cloud sync.

LocalStorage autosave is optional and should not be added if it materially complicates or destabilizes the MVP.

The downloaded JSON remains the only official output.

---

## 15. New empty world

`Create new empty world` must create a minimal valid document with the current schema version.

It may either:

- contain no locations and show a validation prompt to add one; or
- create one clearly named starter location and sublocation.

Prefer the smallest valid document supported by the engine/build pipeline.

Do not silently copy tavern-specific sample content into every new world unless the repository deliberately defines a separate template button.

---

## 16. Administrator workflow documentation

Update the repository `README.md` with a concise section for administrators:

```text
1. Send editor/world-editor.html and the current world.json to the author.
2. Receive the edited downloaded JSON.
3. Review the diff.
4. Replace the authoritative JSON file in the repository.
5. Run tests and build.
```

Also add a short non-technical guide, preferably:

```text
editor/README-RU.md
```

It should explain only:

1. double-click `world-editor.html`;
2. click `Открыть файл мира`;
3. select the supplied JSON;
4. edit locations and sublocations;
5. click `Проверить мир`;
6. click `Скачать файл мира`;
7. send the downloaded file to the administrator.

No command-line instructions belong in the author guide.

The editor itself remains one HTML file; the guide is optional support material, not a runtime dependency.

---

## 17. Integration boundary

This task must establish or reuse a single authoritative repository JSON file.

However, keep the browser editor separate from the game runtime and build tools.

The browser editor:

```text
reads JSON → edits JSON → downloads JSON
```

The administrator/build system:

```text
accepts repository JSON → validates/generates as needed → Tweego build
```

If the repository currently hard-codes location data in JavaScript, do not silently perform a broad engine migration without documenting it.

Choose one of these approaches and report it clearly:

### Preferred when reasonably small

Externalize only the location/sublocation definitions needed by the editor into the authoritative JSON file, then adapt initialization/build generation to consume it.

### Allowed when migration is too large for this iteration

Implement the editor and a documented JSON schema/sample file first, plus a validation/conversion script stub, while leaving engine consumption for a separately documented next task.

Do not maintain two handwritten authoritative copies of the same location data.

If full game integration is deferred, state prominently that exported files are authoring drafts until the follow-up integration task is completed.

---

## 18. Tests

Add automated tests for pure editor data functions where practical.

At minimum test:

- parse valid JSON;
- reject malformed JSON;
- create a minimal new document;
- detect duplicate IDs;
- detect missing exit targets;
- detect invalid default sublocation;
- detect invalid sublocation transition/reachability targets;
- preserve unknown properties through load-edit-export;
- block export when validation errors exist;
- export JSON can be parsed again;
- deleting referenced records is blocked or repaired explicitly.

Do not require a large browser automation stack solely for this MVP.

Pure functions may be kept in a script block with a small Node-compatible test extraction strategy, or duplicated only when there is a clear single-source build step. Avoid creating a complicated editor toolchain.

Manually verify by opening `editor/world-editor.html` directly from disk in at least one Chromium-based browser.

---

## 19. Acceptance scenarios

### Scenario A — Non-technical open/edit/export

1. Double-click `world-editor.html`.
2. Open the supplied JSON file.
3. Select `commonRoom`.
4. Change its description.
5. Add a new sublocation called `Corner table` with a valid stable ID.
6. Set capacity and position prose.
7. Validate successfully.
8. Download JSON.
9. Confirm the downloaded JSON parses and contains the edit.

No terminal, server, installation, or network connection is used.

### Scenario B — Add a location and exits

1. Add `cellar` with a display name and description.
2. Add a default sublocation `cellarEntrance`.
3. Add an exit from `bar` to `cellar`.
4. Optionally add an explicit return exit.
5. Validate successfully.
6. Export and reload the exported file.
7. Confirm all records and references survive the round trip.

### Scenario C — Invalid reference

1. Load a valid file.
2. Create or simulate an exit targeting `missingLocation`.
3. Validation shows a human-readable error naming the source location and missing target.
4. Download is blocked.

### Scenario D — Protected deletion

1. Select a location referenced by an exit.
2. Attempt to delete it.
3. The editor blocks deletion and lists the referring location/exit.

### Scenario E — Unknown future fields

1. Load a record containing an unknown property.
2. Edit a known description field.
3. Export and reload.
4. Confirm the unknown property is still present and unchanged.

### Scenario F — Offline operation

1. Disconnect from the network.
2. Open the editor from disk.
3. Import, edit, validate, and export successfully.
4. Confirm no network errors or missing resources appear.

---

## 20. Explicit non-goals

Do not implement in this task:

- direct writing to project files;
- File System Access API as a required workflow;
- local server or backend;
- npm installation for the author;
- Electron or desktop packaging;
- Twine GUI integration;
- editing `.twee` files in the browser;
- running Tweego from the browser;
- graphical map/node editor;
- drag-and-drop room positioning;
- multiplayer collaboration;
- cloud storage;
- user accounts;
- character, item, quest, dialogue, AI, economy, or combat editors;
- arbitrary scripting.

---

## 21. Completion report

When complete, report:

- files added and changed;
- authoritative JSON filename and path;
- schema version and editable fields;
- whether game/build consumption of that JSON is complete or deferred;
- tests run and results;
- direct-from-disk browsers manually tested;
- known limitations;
- exact administrator steps for replacing the file and building;
- exact seven-step author workflow.
