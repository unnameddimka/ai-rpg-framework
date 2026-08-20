(function () {
    "use strict";

    const CURRENT_SAVE_STORAGE_ID = "ai-rpg-framework-mvp";
    const LEGACY_SAVE_STORAGE_IDS = ["ai-rpg-framework-poc"];
    const BROWSER_SAVE_SUBKEY_RE = /^save\.(?:auto|slot)\.(?:data|info):\d+$/;

    function migrateLegacyBrowserSaveNamespace(engine, currentStorageId) {
        if (!engine || typeof engine.length !== "number" || typeof engine.key !== "function" ||
            typeof engine.getItem !== "function" || typeof engine.setItem !== "function") {
            return { copied: 0, skipped: 0 };
        }
        const targetId = String(currentStorageId || "");
        if (targetId !== CURRENT_SAVE_STORAGE_ID) return { copied: 0, skipped: 0 };

        const keys = [];
        for (let index = 0; index < engine.length; index += 1) {
            const key = engine.key(index);
            if (typeof key === "string") keys.push(key);
        }

        let copied = 0;
        let skipped = 0;
        LEGACY_SAVE_STORAGE_IDS.forEach(function (legacyId) {
            const prefix = `${legacyId}.`;
            keys.forEach(function (sourceKey) {
                if (!sourceKey.startsWith(prefix)) return;
                const subkey = sourceKey.slice(prefix.length);
                if (!BROWSER_SAVE_SUBKEY_RE.test(subkey)) return;
                const targetKey = `${CURRENT_SAVE_STORAGE_ID}.${subkey}`;
                if (engine.getItem(targetKey) !== null) {
                    skipped += 1;
                    return;
                }
                const raw = engine.getItem(sourceKey);
                if (raw === null) return;
                engine.setItem(targetKey, raw);
                copied += 1;
            });
        });
        return { copied: copied, skipped: skipped };
    }

    function migrateLegacyBrowserSavesAtStartup() {
        if (typeof storage === "undefined" || !storage || storage.name !== "localStorage" ||
            typeof window === "undefined" || !window.localStorage) {
            return { copied: 0, skipped: 0 };
        }
        return migrateLegacyBrowserSaveNamespace(window.localStorage, storage.id);
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
