(function () {
    "use strict";

    const STORAGE_KEY = "aiRpg.openRouterKey.v1";
    const MODEL_STORAGE_KEY = "aiRpg.openRouterModel.v1";
    const TTL_MS = 24 * 60 * 60 * 1000;
    const catalog = setup.GeneratedModelList;
    if (!catalog || !Array.isArray(catalog.models) || !catalog.models.length) {
        throw new Error("Generated model list is missing or empty.");
    }

    const models = catalog.models.map(function (model) {
        return { id: String(model.id), name: String(model.name) };
    });
    const modelById = {};
    models.forEach(function (model) { modelById[model.id] = model; });
    const defaultModelId = String(catalog.defaultModelId || "");
    if (!modelById[defaultModelId]) {
        throw new Error("Generated model list defaultModelId does not exist in models.");
    }

    let apiKey = "";
    let selectedModelId = defaultModelId;
    let warning = "";

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function storageOrDefault(storage) {
        if (storage) return storage;
        try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (error) { return null; }
    }

    function setWarning(message) {
        warning = message || "";
    }

    function readSaved(storage, now) {
        storage = storageOrDefault(storage);
        warning = "";
        let restoredKey = false;
        let restoredModel = false;
        if (!storage) return { ok: true, restored: false, restoredKey: false, restoredModel: false, selectedModelId: selectedModelId };
        try {
            const savedModelId = storage.getItem(MODEL_STORAGE_KEY);
            if (savedModelId && modelById[savedModelId]) {
                selectedModelId = savedModelId;
                restoredModel = true;
            } else if (savedModelId) {
                storage.removeItem(MODEL_STORAGE_KEY);
                selectedModelId = defaultModelId;
            }

            const raw = storage.getItem(STORAGE_KEY);
            if (raw) {
                let record;
                try { record = JSON.parse(raw); }
                catch (error) {
                    storage.removeItem(STORAGE_KEY);
                    record = null;
                }
                if (record && typeof record.apiKey === "string" && record.apiKey.trim() &&
                    Number.isFinite(record.expiresAt) && record.expiresAt > (now === undefined ? Date.now() : now)) {
                    apiKey = record.apiKey.trim();
                    restoredKey = true;
                } else if (record) {
                    storage.removeItem(STORAGE_KEY);
                }
            }
            return {
                ok: true,
                restored: restoredKey || restoredModel,
                restoredKey: restoredKey,
                restoredModel: restoredModel,
                selectedModelId: selectedModelId
            };
        } catch (error) {
            setWarning("Saved AI settings storage is unavailable; settings will remain in memory only.");
            return {
                ok: true,
                restored: false,
                restoredKey: false,
                restoredModel: false,
                selectedModelId: selectedModelId,
                warning: warning
            };
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
            setWarning("Saved AI settings storage is unavailable; settings will remain in memory only.");
            return { ok: true, remembered: false, warning: warning };
        }
    }

    function selectModel(modelId, storage) {
        const normalized = typeof modelId === "string" ? modelId.trim() : "";
        if (!modelById[normalized]) {
            return { ok: false, error: { code: "UNKNOWN_MODEL", message: "Choose a model from model_list.json." } };
        }
        selectedModelId = normalized;
        warning = "";
        storage = storageOrDefault(storage);
        try {
            if (!storage) throw new Error("unavailable");
            storage.setItem(MODEL_STORAGE_KEY, selectedModelId);
            return { ok: true, persisted: true, model: clone(modelById[selectedModelId]) };
        } catch (error) {
            setWarning("Saved AI settings storage is unavailable; the selected model will remain in memory only.");
            return { ok: true, persisted: false, model: clone(modelById[selectedModelId]), warning: warning };
        }
    }

    function forget(storage) {
        apiKey = "";
        warning = "";
        storage = storageOrDefault(storage);
        try { if (storage) storage.removeItem(STORAGE_KEY); }
        catch (error) { setWarning("Saved AI settings storage is unavailable; the in-memory key was cleared."); }
        return { ok: true, warning: warning };
    }

    function getSelectedModel() {
        return clone(modelById[selectedModelId] || modelById[defaultModelId]);
    }

    setup.AIRuntimeSettings = {
        STORAGE_KEY: STORAGE_KEY,
        MODEL_STORAGE_KEY: MODEL_STORAGE_KEY,
        TTL_MS: TTL_MS,
        getKey: function () { return apiKey; },
        hasKey: function () { return Boolean(apiKey); },
        getModels: function () { return clone(models); },
        getDefaultModelId: function () { return defaultModelId; },
        getSelectedModelId: function () { return selectedModelId; },
        getSelectedModel: getSelectedModel,
        getStatus: function () {
            const model = getSelectedModel();
            return {
                hasKey: Boolean(apiKey),
                warning: warning,
                selectedModelId: model.id,
                selectedModelName: model.name,
                defaultModelId: defaultModelId,
                models: clone(models)
            };
        },
        readSaved: readSaved,
        save: save,
        selectModel: selectModel,
        forget: forget
    };
}());
