(function () {
    "use strict";

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
        synchronizeSaveObject: synchronizeSaveObject,
        registerSaveSynchronizationHook: registerSaveSynchronizationHook
    };

    registerSaveSynchronizationHook();
}());
