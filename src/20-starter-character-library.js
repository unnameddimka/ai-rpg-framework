(function () {
    "use strict";

    const STORAGE_KEY = "aiRpg.starterCharacters.v1";
    const SCHEMA = "ai-rpg.starter-character-library";
    const VERSION = 1;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function storageOrDefault(storage) {
        if (storage) return storage;
        try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (error) { return null; }
    }

    function failure(code, message, details) {
        const error = { code: code, message: message };
        if (details !== undefined) error.details = clone(details);
        return { ok: false, error: error };
    }

    function normalizeAuthoring(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const name = typeof value.name === "string" ? value.name.trim() : "";
        const playerDescription = typeof value.playerDescription === "string" ? value.playerDescription.trim() : "";
        const aiDescription = typeof value.aiDescription === "string" ? value.aiDescription.trim() : "";
        if (!name || name.length > 120 || !playerDescription || playerDescription.length > 2000 || !aiDescription || aiDescription.length > 4000) return null;
        return { name: name, playerDescription: playerDescription, aiDescription: aiDescription };
    }

    function normalizeRecord(value) {
        const authoring = normalizeAuthoring(value);
        const id = value && typeof value.id === "string" ? value.id.trim() : "";
        if (!authoring || !/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(id)) return null;
        const createdAt = value && typeof value.createdAt === "string" && value.createdAt ? value.createdAt : new Date().toISOString();
        const updatedAt = value && typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt;
        return Object.assign({ id: id, createdAt: createdAt, updatedAt: updatedAt }, authoring);
    }

    function generateId(existing) {
        const used = existing || new Set();
        for (let attempt = 0; attempt < 20; attempt++) {
            let suffix = "";
            try {
                if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") suffix = crypto.randomUUID().replace(/-/g, "");
            } catch (error) { /* fallback below */ }
            if (!suffix) suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
            const id = `starter_${suffix.slice(0, 32)}`;
            if (!used.has(id)) return id;
        }
        return `starter_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function read(storage) {
        storage = storageOrDefault(storage);
        if (!storage) return { ok: true, characters: [], warning: "Browser storage is unavailable; starter characters will not persist." };
        let raw;
        try { raw = storage.getItem(STORAGE_KEY); }
        catch (error) { return { ok: true, characters: [], warning: "Browser storage is unavailable; starter characters will not persist." }; }
        if (!raw) return { ok: true, characters: [] };
        try {
            const document = JSON.parse(raw);
            const records = Array.isArray(document && document.characters) ? document.characters.map(normalizeRecord).filter(Boolean) : [];
            return { ok: true, characters: records };
        } catch (error) {
            return failure("STARTER_LIBRARY_CORRUPT", "The saved starter-character library could not be read.");
        }
    }

    function write(characters, storage) {
        const records = Array.isArray(characters) ? characters.map(normalizeRecord) : [];
        if (records.some(function (record) { return !record; })) return failure("STARTER_LIBRARY_INVALID", "Starter-character library contains invalid records.");
        storage = storageOrDefault(storage);
        if (!storage) return failure("STARTER_LIBRARY_STORAGE_UNAVAILABLE", "Browser storage is unavailable.");
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA, version: VERSION, characters: records }));
            return { ok: true, characters: clone(records) };
        } catch (error) {
            return failure("STARTER_LIBRARY_STORAGE_FAILED", "The browser could not save the starter-character library.");
        }
    }

    function list(storage) {
        const result = read(storage);
        if (!result.ok) return result;
        result.characters.sort(function (a, b) { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
        return result;
    }

    function saveNew(authoring, storage) {
        const normalized = normalizeAuthoring(authoring);
        if (!normalized) return failure("STARTER_CHARACTER_INVALID", "Name and both character descriptions are required and must fit their limits.");
        const current = read(storage);
        if (!current.ok) return current;
        const used = new Set(current.characters.map(function (record) { return record.id; }));
        const now = new Date().toISOString();
        const record = Object.assign({ id: generateId(used), createdAt: now, updatedAt: now }, normalized);
        const written = write(current.characters.concat([record]), storage);
        return written.ok ? { ok: true, character: clone(record), characters: written.characters } : written;
    }

    function update(id, authoring, storage) {
        const normalized = normalizeAuthoring(authoring);
        if (!normalized) return failure("STARTER_CHARACTER_INVALID", "Name and both character descriptions are required and must fit their limits.");
        const current = read(storage);
        if (!current.ok) return current;
        const index = current.characters.findIndex(function (record) { return record.id === id; });
        if (index < 0) return failure("STARTER_CHARACTER_NOT_FOUND", "The selected starter character no longer exists.");
        const previous = current.characters[index];
        const record = Object.assign({}, previous, normalized, { updatedAt: new Date().toISOString() });
        current.characters[index] = record;
        const written = write(current.characters, storage);
        return written.ok ? { ok: true, character: clone(record), characters: written.characters } : written;
    }

    function remove(id, storage) {
        const current = read(storage);
        if (!current.ok) return current;
        const next = current.characters.filter(function (record) { return record.id !== id; });
        if (next.length === current.characters.length) return failure("STARTER_CHARACTER_NOT_FOUND", "The selected starter character no longer exists.");
        const written = write(next, storage);
        return written.ok ? { ok: true, characters: written.characters } : written;
    }

    function timestampForFilename(date) {
        return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
    }

    function exportZip(storage) {
        const current = read(storage);
        if (!current.ok) return current;
        if (!setup.EmergencyDiagnostics || typeof setup.EmergencyDiagnostics.buildStoredZip !== "function") {
            return failure("STARTER_EXPORT_ZIP_UNAVAILABLE", "ZIP export is unavailable.");
        }
        const exportedAt = new Date().toISOString();
        const payload = { schema: SCHEMA, version: VERSION, exportedAt: exportedAt, characters: clone(current.characters) };
        const manifest = { schema: SCHEMA, version: VERSION, exportedAt: exportedAt, files: ["starter-characters.json"] };
        const files = {
            "manifest.json": JSON.stringify(manifest, null, 2),
            "starter-characters.json": JSON.stringify(payload, null, 2)
        };
        const bytes = setup.EmergencyDiagnostics.buildStoredZip(files);
        const filename = `ai-rpg-starter-characters-${timestampForFilename(new Date())}.zip`;
        if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
            return { ok: true, filename: filename, bytes: bytes, characters: clone(current.characters) };
        }
        try {
            const blob = new Blob([bytes], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 0);
            return { ok: true, filename: filename, characters: clone(current.characters) };
        } catch (error) {
            return failure("STARTER_EXPORT_FAILED", "The browser could not download the starter-character ZIP.");
        }
    }

    function decodeUtf8(bytes) {
        if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
        let binary = "";
        for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
        return decodeURIComponent(escape(binary));
    }

    function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
    function u32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

    function parseStoredZip(input) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
        const files = {};
        let offset = 0;
        while (offset + 4 <= bytes.length) {
            const signature = u32(bytes, offset);
            if (signature === 0x02014b50 || signature === 0x06054b50) break;
            if (signature !== 0x04034b50 || offset + 30 > bytes.length) return failure("STARTER_IMPORT_ZIP_INVALID", "The selected file is not a supported starter-character ZIP.");
            const flags = u16(bytes, offset + 6);
            const compression = u16(bytes, offset + 8);
            const compressedSize = u32(bytes, offset + 18);
            const uncompressedSize = u32(bytes, offset + 22);
            const nameLength = u16(bytes, offset + 26);
            const extraLength = u16(bytes, offset + 28);
            if ((flags & 0x0008) !== 0 || compression !== 0 || compressedSize !== uncompressedSize) {
                return failure("STARTER_IMPORT_ZIP_UNSUPPORTED", "The starter-character ZIP uses unsupported compression.");
            }
            const nameStart = offset + 30;
            const dataStart = nameStart + nameLength + extraLength;
            const dataEnd = dataStart + compressedSize;
            if (dataEnd > bytes.length) return failure("STARTER_IMPORT_ZIP_INVALID", "The starter-character ZIP is truncated.");
            const filename = decodeUtf8(bytes.slice(nameStart, nameStart + nameLength));
            if (!filename || filename.includes("..") || filename.startsWith("/") || filename.includes("\\")) return failure("STARTER_IMPORT_ZIP_INVALID", "The starter-character ZIP contains an unsafe filename.");
            files[filename] = decodeUtf8(bytes.slice(dataStart, dataEnd));
            offset = dataEnd;
        }
        return { ok: true, files: files };
    }

    function parseImportBytes(bytes) {
        const archive = parseStoredZip(bytes);
        if (!archive.ok) return archive;
        if (typeof archive.files["manifest.json"] !== "string" || typeof archive.files["starter-characters.json"] !== "string") {
            return failure("STARTER_IMPORT_STRUCTURE_INVALID", "The ZIP must contain manifest.json and starter-characters.json.");
        }
        let manifest, payload;
        try {
            manifest = JSON.parse(archive.files["manifest.json"]);
            payload = JSON.parse(archive.files["starter-characters.json"]);
        } catch (error) {
            return failure("STARTER_IMPORT_JSON_INVALID", "The starter-character ZIP contains invalid JSON.");
        }
        if (!manifest || manifest.schema !== SCHEMA || manifest.version !== VERSION || !payload || payload.schema !== SCHEMA || payload.version !== VERSION || !Array.isArray(payload.characters)) {
            return failure("STARTER_IMPORT_SCHEMA_INVALID", "The starter-character ZIP uses an unsupported format or version.");
        }
        const characters = [];
        const ids = new Set();
        for (let index = 0; index < payload.characters.length; index++) {
            const record = normalizeRecord(payload.characters[index]);
            if (!record) return failure("STARTER_IMPORT_CHARACTER_INVALID", `Starter character ${index + 1} is invalid.`);
            if (ids.has(record.id)) return failure("STARTER_IMPORT_DUPLICATE_ID", `Starter character ID ${record.id} appears more than once in the import.`);
            ids.add(record.id);
            characters.push(record);
        }
        return { ok: true, characters: characters };
    }

    function mergeImported(characters, resolutions, storage) {
        if (!Array.isArray(characters)) return failure("STARTER_IMPORT_INVALID", "No starter characters were supplied for import.");
        const normalized = characters.map(normalizeRecord);
        if (normalized.some(function (record) { return !record; })) return failure("STARTER_IMPORT_CHARACTER_INVALID", "The starter-character import contains an invalid record.");
        const current = read(storage);
        if (!current.ok) return current;
        const next = current.characters.map(clone);
        const indexById = new Map(next.map(function (record, index) { return [record.id, index]; }));
        const used = new Set(indexById.keys());
        const summary = { added: 0, replaced: 0, keptBoth: 0, skipped: 0 };
        for (const record of normalized) {
            const existingIndex = indexById.has(record.id) ? indexById.get(record.id) : -1;
            if (existingIndex < 0) {
                next.push(clone(record)); indexById.set(record.id, next.length - 1); used.add(record.id); summary.added++; continue;
            }
            const choice = resolutions && resolutions[record.id] || "skip";
            if (choice === "replace") {
                next[existingIndex] = clone(record); summary.replaced++; continue;
            }
            if (choice === "keep") {
                const copy = clone(record); copy.id = generateId(used); used.add(copy.id); copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt;
                next.push(copy); indexById.set(copy.id, next.length - 1); summary.keptBoth++; continue;
            }
            summary.skipped++;
        }
        const written = write(next, storage);
        return written.ok ? { ok: true, characters: written.characters, summary: summary } : written;
    }

    setup.StarterCharacterLibrary = {
        STORAGE_KEY: STORAGE_KEY,
        SCHEMA: SCHEMA,
        VERSION: VERSION,
        validateAuthoring: function (value) { const normalized = normalizeAuthoring(value); return normalized ? { ok: true, authoring: normalized } : failure("STARTER_CHARACTER_INVALID", "Name and both character descriptions are required and must fit their limits."); },
        list: list,
        saveNew: saveNew,
        update: update,
        remove: remove,
        exportZip: exportZip,
        parseStoredZip: parseStoredZip,
        parseImportBytes: parseImportBytes,
        mergeImported: mergeImported
    };
}());
