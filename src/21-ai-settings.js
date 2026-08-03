(function () {
    "use strict";

    const STORAGE_KEY = "aiRpg.openRouterKey.v1";
    const TTL_MS = 24 * 60 * 60 * 1000;
    let apiKey = "";
    let warning = "";

    function storageOrDefault(storage) {
        if (storage) return storage;
        try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (error) { return null; }
    }

    function readSaved(storage, now) {
        storage = storageOrDefault(storage);
        warning = "";
        if (!storage) return { ok: true, restored: false };
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (!raw) return { ok: true, restored: false };
            let record;
            try { record = JSON.parse(raw); } catch (error) { storage.removeItem(STORAGE_KEY); return { ok: true, restored: false }; }
            if (!record || typeof record.apiKey !== "string" || !record.apiKey.trim() ||
                !Number.isFinite(record.expiresAt) || record.expiresAt <= (now === undefined ? Date.now() : now)) {
                storage.removeItem(STORAGE_KEY);
                return { ok: true, restored: false };
            }
            apiKey = record.apiKey.trim();
            return { ok: true, restored: true, expiresAt: record.expiresAt };
        } catch (error) {
            warning = "Saved-key storage is unavailable; the key will remain in memory only.";
            return { ok: true, restored: false, warning: warning };
        }
    }

    function save(key, remember, storage, now) {
        apiKey = typeof key === "string" ? key.trim() : "";
        warning = "";
        if (!apiKey) return { ok: false, error: { code: "API_KEY_MISSING", message: "Enter an OpenRouter API key." } };
        if (!remember) return { ok: true, remembered: false };
        storage = storageOrDefault(storage);
        const expiresAt = (now === undefined ? Date.now() : now) + TTL_MS;
        try {
            if (!storage) throw new Error("unavailable");
            storage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: apiKey, expiresAt: expiresAt }));
            return { ok: true, remembered: true, expiresAt: expiresAt };
        } catch (error) {
            warning = "Saved-key storage is unavailable; the key will remain in memory only.";
            return { ok: true, remembered: false, warning: warning };
        }
    }

    function forget(storage) {
        apiKey = "";
        warning = "";
        storage = storageOrDefault(storage);
        try { if (storage) storage.removeItem(STORAGE_KEY); }
        catch (error) { warning = "Saved-key storage is unavailable; the in-memory key was cleared."; }
        return { ok: true, warning: warning };
    }

    setup.AIRuntimeSettings = {
        STORAGE_KEY: STORAGE_KEY,
        TTL_MS: TTL_MS,
        getKey: function () { return apiKey; },
        hasKey: function () { return Boolean(apiKey); },
        getStatus: function () { return { hasKey: Boolean(apiKey), warning: warning }; },
        readSaved: readSaved,
        save: save,
        forget: forget
    };
}());
