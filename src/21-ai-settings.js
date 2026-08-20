(function () {
    "use strict";

    const STORAGE_KEY = "aiRpg.openRouterKey.v1";
    const MODEL_STORAGE_KEY = "aiRpg.openRouterModel.v1";
    const NARRATOR_MODEL_STORAGE_KEY = "aiRpg.openRouterNarratorModel.v1";
    const UTILITY_MODEL_STORAGE_KEY = "aiRpg.openRouterUtilityModel.v1";
    const TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
    const requestedNarratorDefault = String(catalog.defaultNarratorModelId || "").trim();
    const defaultNarratorModelId = requestedNarratorDefault && modelById[requestedNarratorDefault]
        ? requestedNarratorDefault
        : defaultModelId;
    const requestedUtilityDefault = String(catalog.defaultUtilityModelId || "").trim();
    const defaultUtilityModelId = requestedUtilityDefault && modelById[requestedUtilityDefault]
        ? requestedUtilityDefault
        : defaultModelId;

    let apiKey = "";
    let selectedModelId = defaultModelId;
    let selectedNarratorModelId = defaultNarratorModelId;
    let selectedUtilityModelId = defaultUtilityModelId;
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
        let restoredNarratorModel = false;
        let restoredUtilityModel = false;
        if (!storage) {
            return {
                ok: true,
                restored: false,
                restoredKey: false,
                restoredModel: false,
                restoredNarratorModel: false,
                restoredUtilityModel: false,
                selectedModelId: selectedModelId,
                selectedNarratorModelId: selectedNarratorModelId,
                selectedUtilityModelId: selectedUtilityModelId
            };
        }
        try {
            const savedModelId = storage.getItem(MODEL_STORAGE_KEY);
            if (savedModelId && modelById[savedModelId]) {
                selectedModelId = savedModelId;
                restoredModel = true;
            } else if (savedModelId) {
                storage.removeItem(MODEL_STORAGE_KEY);
                selectedModelId = defaultModelId;
            }

            const savedNarratorModelId = storage.getItem(NARRATOR_MODEL_STORAGE_KEY);
            if (savedNarratorModelId && modelById[savedNarratorModelId]) {
                selectedNarratorModelId = savedNarratorModelId;
                restoredNarratorModel = true;
            } else if (savedNarratorModelId) {
                storage.removeItem(NARRATOR_MODEL_STORAGE_KEY);
                selectedNarratorModelId = defaultNarratorModelId;
            }

            const savedUtilityModelId = storage.getItem(UTILITY_MODEL_STORAGE_KEY);
            if (savedUtilityModelId && modelById[savedUtilityModelId]) {
                selectedUtilityModelId = savedUtilityModelId;
                restoredUtilityModel = true;
            } else if (savedUtilityModelId) {
                storage.removeItem(UTILITY_MODEL_STORAGE_KEY);
                selectedUtilityModelId = defaultUtilityModelId;
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
                restored: restoredKey || restoredModel || restoredNarratorModel || restoredUtilityModel,
                restoredKey: restoredKey,
                restoredModel: restoredModel,
                restoredNarratorModel: restoredNarratorModel,
                restoredUtilityModel: restoredUtilityModel,
                selectedModelId: selectedModelId,
                selectedNarratorModelId: selectedNarratorModelId,
                selectedUtilityModelId: selectedUtilityModelId
            };
        } catch (error) {
            setWarning("Saved AI settings storage is unavailable; settings will remain in memory only.");
            return {
                ok: true,
                restored: false,
                restoredKey: false,
                restoredModel: false,
                restoredNarratorModel: false,
                restoredUtilityModel: false,
                selectedModelId: selectedModelId,
                selectedNarratorModelId: selectedNarratorModelId,
                selectedUtilityModelId: selectedUtilityModelId,
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

    function selectNarratorModel(modelId, storage) {
        const normalized = typeof modelId === "string" ? modelId.trim() : "";
        if (!modelById[normalized]) {
            return { ok: false, error: { code: "UNKNOWN_MODEL", message: "Choose a narrator model from model_list.json." } };
        }
        selectedNarratorModelId = normalized;
        warning = "";
        storage = storageOrDefault(storage);
        try {
            if (!storage) throw new Error("unavailable");
            storage.setItem(NARRATOR_MODEL_STORAGE_KEY, selectedNarratorModelId);
            return { ok: true, persisted: true, model: clone(modelById[selectedNarratorModelId]) };
        } catch (error) {
            setWarning("Saved AI settings storage is unavailable; the narrator model will remain in memory only.");
            return { ok: true, persisted: false, model: clone(modelById[selectedNarratorModelId]), warning: warning };
        }
    }

    function selectUtilityModel(modelId, storage) {
        const normalized = typeof modelId === "string" ? modelId.trim() : "";
        if (!modelById[normalized]) {
            return { ok: false, error: { code: "UNKNOWN_MODEL", message: "Choose a utility model from model_list.json." } };
        }
        selectedUtilityModelId = normalized;
        warning = "";
        storage = storageOrDefault(storage);
        try {
            if (!storage) throw new Error("unavailable");
            storage.setItem(UTILITY_MODEL_STORAGE_KEY, selectedUtilityModelId);
            return { ok: true, persisted: true, model: clone(modelById[selectedUtilityModelId]) };
        } catch (error) {
            setWarning("Saved AI settings storage is unavailable; the utility model will remain in memory only.");
            return { ok: true, persisted: false, model: clone(modelById[selectedUtilityModelId]), warning: warning };
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

    function getSelectedNarratorModel() {
        return clone(modelById[selectedNarratorModelId] || modelById[defaultNarratorModelId]);
    }

    function getSelectedUtilityModel() {
        return clone(modelById[selectedUtilityModelId] || modelById[defaultUtilityModelId] || modelById[selectedModelId] || modelById[defaultModelId]);
    }

    setup.AIRuntimeSettings = {
        STORAGE_KEY: STORAGE_KEY,
        MODEL_STORAGE_KEY: MODEL_STORAGE_KEY,
        NARRATOR_MODEL_STORAGE_KEY: NARRATOR_MODEL_STORAGE_KEY,
        UTILITY_MODEL_STORAGE_KEY: UTILITY_MODEL_STORAGE_KEY,
        TTL_MS: TTL_MS,
        getKey: function () { return apiKey; },
        hasKey: function () { return Boolean(apiKey); },
        getModels: function () { return clone(models); },
        getDefaultModelId: function () { return defaultModelId; },
        getDefaultNarratorModelId: function () { return defaultNarratorModelId; },
        getDefaultUtilityModelId: function () { return defaultUtilityModelId; },
        getSelectedModelId: function () { return selectedModelId; },
        getSelectedNarratorModelId: function () { return selectedNarratorModelId; },
        getSelectedUtilityModelId: function () { return selectedUtilityModelId; },
        getSelectedModel: getSelectedModel,
        getSelectedNarratorModel: getSelectedNarratorModel,
        getSelectedUtilityModel: getSelectedUtilityModel,
        getStatus: function () {
            const model = getSelectedModel();
            const narratorModel = getSelectedNarratorModel();
            const utilityModel = getSelectedUtilityModel();
            return {
                hasKey: Boolean(apiKey),
                warning: warning,
                selectedModelId: model.id,
                selectedModelName: model.name,
                defaultModelId: defaultModelId,
                selectedNarratorModelId: narratorModel.id,
                selectedNarratorModelName: narratorModel.name,
                defaultNarratorModelId: defaultNarratorModelId,
                selectedUtilityModelId: utilityModel.id,
                selectedUtilityModelName: utilityModel.name,
                defaultUtilityModelId: defaultUtilityModelId,
                models: clone(models)
            };
        },
        readSaved: readSaved,
        save: save,
        selectModel: selectModel,
        selectNarratorModel: selectNarratorModel,
        selectUtilityModel: selectUtilityModel,
        forget: forget
    };
}());
