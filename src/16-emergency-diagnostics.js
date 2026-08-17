(function () {
    "use strict";

    const ERROR_LIMIT = 50;
    const SECRET_KEYS = new Set([
        "apikey", "api_key", "authorization", "proxy-authorization", "password", "secret",
        "access_token", "refresh_token", "bearer"
    ]);
    const recentErrors = [];
    let lastTimelapseResult = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function secretKey(key) {
        const normalized = String(key || "").toLowerCase().replace(/\s+/g, "");
        return SECRET_KEYS.has(normalized) || normalized === "openrouterapikey";
    }

    function safeSanitize(value, seen, depth) {
        if (depth === undefined) depth = 0;
        if (depth > 60) return "[MaxDepth]";
        if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return value === undefined ? null : value;
        }
        if (typeof value === "bigint") return String(value);
        if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
        if (typeof value !== "object") return String(value);
        seen = seen || new WeakSet();
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        if (Array.isArray(value)) {
            const array = [];
            for (let index = 0; index < value.length; index++) {
                try { array.push(safeSanitize(value[index], seen, depth + 1)); }
                catch (error) { array.push(`[CaptureError: ${error && error.message || "unknown"}]`); }
            }
            return array;
        }
        const output = {};
        let keys = [];
        try { keys = Object.keys(value); }
        catch (error) { return { captureError: error && error.message || "Unable to enumerate object." }; }
        keys.forEach(function (key) {
            if (secretKey(key)) {
                output[key] = "[REDACTED]";
                return;
            }
            try { output[key] = safeSanitize(value[key], seen, depth + 1); }
            catch (error) { output[key] = `[CaptureError: ${error && error.message || "unknown"}]`; }
        });
        return output;
    }

    function recordTimelapseResult(result) {
        try {
            lastTimelapseResult = safeSanitize(result, new WeakSet(), 0);
        } catch (error) {
            lastTimelapseResult = { ok: false, captureError: error && error.message || String(error) };
        }
        return clone(lastTimelapseResult);
    }

    function getLastTimelapseResult() {
        return clone(lastTimelapseResult);
    }

    function recordError(kind, errorLike) {
        try {
            const error = errorLike && errorLike.error || errorLike && errorLike.reason || errorLike;
            recentErrors.push({
                at: new Date().toISOString(),
                kind: kind,
                message: error && error.message ? String(error.message) : String(error || "Unknown error"),
                stack: error && error.stack ? String(error.stack) : ""
            });
            if (recentErrors.length > ERROR_LIMIT) recentErrors.splice(0, recentErrors.length - ERROR_LIMIT);
        } catch (ignored) { /* Diagnostics must never break gameplay. */ }
    }

    try {
        if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
            window.addEventListener("error", function (event) { recordError("window.error", event); });
            window.addEventListener("unhandledrejection", function (event) { recordError("unhandledrejection", event); });
        }
    } catch (ignored) { /* Browser error hooks are optional. */ }

    function captureFiles() {
        const exportedAt = new Date().toISOString();
        const files = {};
        const manifest = {
            schema: "ai-rpg.emergency-dump",
            version: 3,
            exportedAt: exportedAt,
            application: "AI RPG Framework",
            documentTitle: typeof document !== "undefined" ? document.title : "",
            locationProtocol: typeof window !== "undefined" && window.location ? window.location.protocol : "",
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            worldSchemaVersion: null,
            worldAuthoringRevision: null,
            currentAuthoringRevision: setup.GeneratedWorldData && setup.GeneratedWorldData.authoringRevision || null,
            sections: {}
        };

        try {
            const world = typeof State !== "undefined" && State.variables && State.variables.world;
            manifest.worldSchemaVersion = world && world.schemaVersion || null;
            manifest.worldAuthoringRevision = world && world.authoringRevision || null;
        } catch (error) {
            manifest.worldMetadataError = error && error.message || String(error);
        }

        function section(filename, producer) {
            try {
                files[filename] = safeSanitize(producer(), new WeakSet(), 0);
                manifest.sections[filename] = { ok: true };
            } catch (error) {
                files[filename] = { captureError: error && error.message || String(error) };
                manifest.sections[filename] = { ok: false, error: error && error.message || String(error) };
            }
        }

        section("game-state.json", function () {
            return typeof State !== "undefined" && State.variables ? State.variables : null;
        });
        section("sugarcube.json", function () {
            return {
                passage: typeof State !== "undefined" ? State.passage : null,
                activeIndex: typeof State !== "undefined" ? State.activeIndex : null,
                history: typeof State !== "undefined" ? State.history : null
            };
        });
        section("minds.json", function () {
            const world = typeof State !== "undefined" && State.variables && State.variables.world;
            const entities = world && world.entities || {};
            const characters = {};
            Object.keys(entities).forEach(function (id) {
                const entity = entities[id];
                if (!entity || entity.type !== "character") return;
                characters[id] = {
                    name: entity.name || id,
                    mind: entity.mind || null,
                    recentDialogue: entity.recentDialogue || [],
                    mindMaintenanceSnapshots: entity.mindMaintenanceSnapshots || [],
                    mindMaintenanceState: entity.mindMaintenanceState || { reconciliationCursor: { afterBeliefId: null } }
                };
            });
            return { characters: characters };
        });
        section("scheduler-state.json", function () {
            const world = typeof State !== "undefined" && State.variables && State.variables.world;
            const pendingObservations = {};
            Object.keys(world && world.entities || {}).forEach(function (id) {
                const entity = world.entities[id];
                if (entity && entity.type === "character" && entity.mind && Array.isArray(entity.mind.pendingObservations)) {
                    pendingObservations[id] = entity.mind.pendingObservations;
                }
            });
            return {
                worldAI: world && world.ai || null,
                pendingObservations: pendingObservations,
                executor: setup.AIRequestExecutor && setup.AIRequestExecutor.getStatus ? setup.AIRequestExecutor.getStatus() : null,
                scheduler: setup.AITurnScheduler && setup.AITurnScheduler.getStatus ? setup.AITurnScheduler.getStatus() : null,
                controllerInFlight: setup.AIController && setup.AIController.isInFlight ? setup.AIController.isInFlight() : null
            };
        });
        section("ai-exchanges.json", function () {
            return setup.AIRequestExecutor && setup.AIRequestExecutor.getExchangeHistory
                ? setup.AIRequestExecutor.getExchangeHistory()
                : null;
        });
        section("ai-exchange-log.json", function () {
            if (!setup.PromptLab || typeof setup.PromptLab.buildExchangeLog !== "function") return null;
            const result = setup.PromptLab.buildExchangeLog();
            return result && result.ok ? result.data : { available: false, error: result && result.error || null };
        });
        section("ai-transport-log.json", function () {
            return setup.RuntimeDiagnostics && typeof setup.RuntimeDiagnostics.getAITransportLog === "function"
                ? setup.RuntimeDiagnostics.getAITransportLog()
                : null;
        });
        section("network-log.json", function () {
            return setup.RuntimeDiagnostics && typeof setup.RuntimeDiagnostics.getNetworkLog === "function"
                ? setup.RuntimeDiagnostics.getNetworkLog()
                : null;
        });
        section("weather-runtime.json", function () {
            return setup.WorldEnvironment && typeof setup.WorldEnvironment.getWeatherDiagnostics === "function"
                ? setup.WorldEnvironment.getWeatherDiagnostics()
                : null;
        });
        section("timelapse-runtime.json", function () {
            return { lastResult: getLastTimelapseResult() };
        });
        section("ui-runtime.json", function () {
            return {
                aiSettings: setup.AIRuntimeSettings && setup.AIRuntimeSettings.getStatus ? setup.AIRuntimeSettings.getStatus() : null,
                transientDebug: setup.AITransientDebug || null,
                narrator: setup.NarratorService && setup.NarratorService.getStatus ? setup.NarratorService.getStatus() : null,
                frameworkUI: typeof State !== "undefined" && State.variables ? State.variables.frameworkUI || null : null,
                currentPassage: typeof State !== "undefined" ? State.passage : null
            };
        });
        section("errors.json", function () { return recentErrors; });
        files["manifest.json"] = safeSanitize(manifest, new WeakSet(), 0);
        return { manifest: manifest, files: files };
    }

    // Aggregate compatibility view for tests/debug callers. Download packaging remains split-file ZIP.
    function capture() {
        const bundle = captureFiles();
        const captureErrors = Object.keys(bundle.manifest.sections).filter(function (filename) {
            return bundle.manifest.sections[filename].ok !== true;
        }).map(function (filename) {
            return { section: filename, message: bundle.manifest.sections[filename].error || "Capture failed." };
        });
        return {
            schema: bundle.manifest.schema,
            version: bundle.manifest.version,
            exportedAt: bundle.manifest.exportedAt,
            manifest: clone(bundle.manifest),
            sections: clone(bundle.files),
            captureErrors: captureErrors
        };
    }

    function timestampForFilename(date) {
        return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
    }

    function utf8(text) {
        if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
        const encoded = unescape(encodeURIComponent(text));
        const bytes = new Uint8Array(encoded.length);
        for (let index = 0; index < encoded.length; index++) bytes[index] = encoded.charCodeAt(index);
        return bytes;
    }

    let crcTable = null;
    function crc32(bytes) {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                crcTable[n] = c >>> 0;
            }
        }
        let crc = 0xFFFFFFFF;
        for (let index = 0; index < bytes.length; index++) crc = crcTable[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function writer() {
        const bytes = [];
        return {
            u16: function (value) { bytes.push(value & 255, (value >>> 8) & 255); },
            u32: function (value) { bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); },
            data: function (value) { for (let index = 0; index < value.length; index++) bytes.push(value[index]); },
            length: function () { return bytes.length; },
            finish: function () { return new Uint8Array(bytes); }
        };
    }

    function buildStoredZip(textFiles) {
        const out = writer();
        const central = [];
        Object.keys(textFiles).sort().forEach(function (filename) {
            const name = utf8(filename);
            const data = utf8(textFiles[filename]);
            const crc = crc32(data);
            const offset = out.length();
            out.u32(0x04034b50); out.u16(20); out.u16(0x0800); out.u16(0); out.u16(0); out.u16(0);
            out.u32(crc); out.u32(data.length); out.u32(data.length); out.u16(name.length); out.u16(0);
            out.data(name); out.data(data);
            central.push({ name: name, crc: crc, size: data.length, offset: offset });
        });
        const centralOffset = out.length();
        central.forEach(function (entry) {
            out.u32(0x02014b50); out.u16(20); out.u16(20); out.u16(0x0800); out.u16(0); out.u16(0); out.u16(0);
            out.u32(entry.crc); out.u32(entry.size); out.u32(entry.size); out.u16(entry.name.length); out.u16(0); out.u16(0);
            out.u16(0); out.u16(0); out.u32(0); out.u32(entry.offset); out.data(entry.name);
        });
        const centralSize = out.length() - centralOffset;
        out.u32(0x06054b50); out.u16(0); out.u16(0); out.u16(central.length); out.u16(central.length);
        out.u32(centralSize); out.u32(centralOffset); out.u16(0);
        return out.finish();
    }

    function download() {
        const bundle = captureFiles();
        const textFiles = {};
        Object.keys(bundle.files).forEach(function (filename) {
            try {
                textFiles[filename] = JSON.stringify(bundle.files[filename], null, 2);
            } catch (error) {
                bundle.manifest.sections[filename] = { ok: false, error: error && error.message || String(error) };
                textFiles[filename] = JSON.stringify({ serializationError: error && error.message || String(error) }, null, 2);
            }
        });
        textFiles["manifest.json"] = JSON.stringify(bundle.manifest, null, 2);
        if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
            return { ok: false, error: { code: "EMERGENCY_DUMP_DOWNLOAD_UNAVAILABLE", message: "Browser download APIs are unavailable." }, manifest: bundle.manifest, files: textFiles };
        }
        try {
            const zipBytes = buildStoredZip(textFiles);
            const blob = new Blob([zipBytes], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `ai-rpg-emergency-dump-${timestampForFilename(new Date())}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 0);
            return { ok: true, filename: link.download, manifest: bundle.manifest };
        } catch (error) {
            recordError("emergency-dump-download", error);
            return { ok: false, error: { code: "EMERGENCY_DUMP_DOWNLOAD_FAILED", message: error && error.message || "Emergency dump download failed." }, manifest: bundle.manifest, files: textFiles };
        }
    }

    setup.EmergencyDiagnostics = {
        ERROR_LIMIT: ERROR_LIMIT,
        capture: capture,
        captureFiles: captureFiles,
        buildStoredZip: buildStoredZip,
        download: download,
        recordError: recordError,
        recordTimelapseResult: recordTimelapseResult,
        getLastTimelapseResult: getLastTimelapseResult,
        getRecentErrors: function () { return safeSanitize(recentErrors, new WeakSet(), 0); }
    };
}());
