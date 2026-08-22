(function () {
    "use strict";

    const CURRENT_SAVE_STORAGE_ID = "mallowstead";
    const LEGACY_SAVE_STORAGE_IDS = ["ai-rpg-framework-mvp", "ai-rpg-framework-poc"];
    const BROWSER_SAVE_SUBKEY_RE = /^save\.(?:auto|slot)\.(?:data|info):\d+$/;

    function migrateLegacyBrowserSaveNamespace(engine, currentStorageId) {
        if (!engine || typeof engine.length !== "number" || typeof engine.key !== "function" ||
            typeof engine.getItem !== "function" || typeof engine.setItem !== "function" ||
            typeof engine.removeItem !== "function") {
            return { moved: 0, deduplicated: 0, skipped: 0, failed: 0 };
        }
        const targetId = String(currentStorageId || "");
        if (targetId !== CURRENT_SAVE_STORAGE_ID) return { moved: 0, deduplicated: 0, skipped: 0, failed: 0 };

        // Snapshot keys before modifying localStorage. Browser saves can be several
        // megabytes, so migration must rename them rather than copy them: keeping the
        // legacy payload while writing the Mallowstead payload can exceed the per-origin
        // localStorage quota even though either save fits by itself.
        const keys = [];
        for (let index = 0; index < engine.length; index += 1) {
            const key = engine.key(index);
            if (typeof key === "string") keys.push(key);
        }

        let moved = 0;
        let deduplicated = 0;
        let skipped = 0;
        let failed = 0;
        LEGACY_SAVE_STORAGE_IDS.forEach(function (legacyId) {
            const prefix = `${legacyId}.`;
            keys.forEach(function (sourceKey) {
                if (!sourceKey.startsWith(prefix)) return;
                const subkey = sourceKey.slice(prefix.length);
                if (!BROWSER_SAVE_SUBKEY_RE.test(subkey)) return;
                const targetKey = `${CURRENT_SAVE_STORAGE_ID}.${subkey}`;
                const targetRaw = engine.getItem(targetKey);
                if (targetRaw !== null) {
                    const sourceRaw = engine.getItem(sourceKey);
                    // A previous copy-based migration may have written the target and
                    // then failed on a later large key. Remove only byte-identical
                    // legacy duplicates; differing legacy data is left untouched.
                    if (sourceRaw !== null && sourceRaw === targetRaw) {
                        engine.removeItem(sourceKey);
                        deduplicated += 1;
                    }
                    skipped += 1;
                    return;
                }
                const raw = engine.getItem(sourceKey);
                if (raw === null) return;

                // localStorage has no atomic rename. Keep the source payload in memory,
                // remove it to free quota, write the target, and restore the source if
                // the target write fails. This keeps migration storage-neutral.
                engine.removeItem(sourceKey);
                try {
                    engine.setItem(targetKey, raw);
                    moved += 1;
                } catch (error) {
                    failed += 1;
                    try {
                        engine.setItem(sourceKey, raw);
                    } catch (rollbackError) {
                        console.error("Legacy browser-save migration rollback failed.", rollbackError);
                    }
                    console.warn(`Could not migrate legacy browser-save key ${sourceKey}.`, error);
                }
            });
        });
        return { moved: moved, deduplicated: deduplicated, skipped: skipped, failed: failed };
    }

    function migrateLegacyBrowserSavesAtStartup() {
        if (typeof storage === "undefined" || !storage || storage.name !== "localStorage" ||
            typeof window === "undefined" || !window.localStorage) {
            return { moved: 0, deduplicated: 0, skipped: 0, failed: 0 };
        }
        try {
            return migrateLegacyBrowserSaveNamespace(window.localStorage, storage.id);
        } catch (error) {
            // Save compatibility must never prevent the game itself from starting.
            console.warn("Legacy browser-save migration failed; continuing without automatic migration.", error);
            return { moved: 0, deduplicated: 0, skipped: 0, failed: 1 };
        }
    }

    function cloneSerializable(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function activeSaveMoment(save) {
        const state = save && save.state;
        if (!state || !Array.isArray(state.history) || state.history.length === 0) return null;
        const index = Number.isInteger(state.index) ? state.index : state.history.length - 1;
        return state.history[index] || state.history[state.history.length - 1] || null;
    }

    function synchronizeSaveObject(save) {
        const moment = activeSaveMoment(save);
        if (!moment) {
            throw new Error("Save synchronization failed: the active SugarCube history moment is missing.");
        }
        if (typeof State === "undefined" || !State.variables || typeof State.variables !== "object") {
            throw new Error("Save synchronization failed: live SugarCube variables are unavailable.");
        }

        let liveVariables;
        try {
            liveVariables = cloneSerializable(State.variables);
        } catch (error) {
            throw new Error(`Save synchronization failed: ${error && error.message ? error.message : String(error)}`);
        }
        if (!liveVariables || typeof liveVariables !== "object") {
            throw new Error("Save synchronization failed: live SugarCube variables are not serializable.");
        }

        // Save.onSave receives the already-marshalled SugarCube save object. In-place
        // asynchronous turns can mutate State.variables without creating a new history
        // moment, so the marshalled active moment may be stale. Replace only that
        // moment's variables with the current canonical live variables; do not create
        // fake gameplay history or alter older moments.
        moment.variables = liveVariables;
        return moment;
    }

    function registerSaveSynchronizationHook() {
        if (typeof Save === "undefined" || !Save.onSave || typeof Save.onSave.add !== "function") return false;
        Save.onSave.add(synchronizeSaveObject);
        return true;
    }

    setup.Persistence = {
        CURRENT_SAVE_STORAGE_ID: CURRENT_SAVE_STORAGE_ID,
        LEGACY_SAVE_STORAGE_IDS: LEGACY_SAVE_STORAGE_IDS.slice(),
        synchronizeSaveObject: synchronizeSaveObject,
        registerSaveSynchronizationHook: registerSaveSynchronizationHook,
        migrateLegacyBrowserSaveNamespace: migrateLegacyBrowserSaveNamespace,
        migrateLegacyBrowserSavesAtStartup: migrateLegacyBrowserSavesAtStartup
    };

    migrateLegacyBrowserSavesAtStartup();
    registerSaveSynchronizationHook();
}());
