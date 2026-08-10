# AI RPG patch for `6afbfdd`

This patch targets exactly:

`6afbfdd71d4156fb8d3d81568d344ec9a2ac2ee9` (`ai chain consistency grounded progress`)

It implements the agreed engine/editor/world changes:

- player-facing chronological History with visible/invisible filtering and a 100-entry save mirror;
- lockable reciprocal passages, ordinary matching key items, grounded `lock` / `unlock` actions, and editor support;
- 3000 completion / 1500 reasoning OpenRouter request budgets and `MODEL_OUTPUT_TRUNCATED` diagnostics;
- beds in all upstairs rooms using the existing multi-occupancy sublocation mechanics;
- a third common-room table;
- removal of the static travellers/merchants ghost-NPC prose;
- deterministic coverage for the new behavior;
- engine/world implementation specs under `docs/engine/` and `docs/world/`.

## Apply on Windows

From a **clean checkout at the exact commit above**, unpack this archive anywhere and run from the repository root:

```bat
py -3 C:\path\to\patch\apply_ai_rpg_patch.py
```

If `py` is unavailable but `python` is on PATH:

```bat
python C:\path\to\patch\apply_ai_rpg_patch.py
```

You can also run `apply_patch.bat` from this folder after setting the repository as the current directory.

## Apply on Linux / WSL

From the repository root:

```bash
python3 /path/to/patch/apply_ai_rpg_patch.py
```

or use `apply_patch.sh` while the repository is the current directory.

## Safety / verification

The installer:

1. refuses to run unless `HEAD` is exactly `6afbfdd71d4156fb8d3d81568d344ec9a2ac2ee9`;
2. refuses to overwrite a dirty working tree;
3. backs up every file it can modify in memory;
4. applies the deterministic patch directly to the checkout;
5. regenerates world/model data and runs all five Node test suites;
6. restores the original files automatically if patching or tests fail.

Git is used only for the two read-only base/cleanliness checks. The installer does **not** create a worktree, commit, push, create a branch/PR, or modify GitHub remotely.

After applying, inspect:

```bash
git diff --stat
git diff
```

Then build the standalone game normally:

```bat
build.bat
```

or:

```bash
./build.sh
```
