#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BuildProfile = require("./build-profile");

let crcTable = null;
function crc32(buffer) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function localHeader(name, data, crc) {
    const n = Buffer.from(name, "utf8");
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    return Buffer.concat([h, n]);
}

function centralHeader(name, data, crc, offset) {
    const n = Buffer.from(name, "utf8");
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); h.writeUInt16LE(0, 14); h.writeUInt32LE(crc, 16);
    h.writeUInt32LE(data.length, 20); h.writeUInt32LE(data.length, 24); h.writeUInt16LE(n.length, 28); h.writeUInt16LE(0, 30);
    h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36); h.writeUInt32LE(0, 38); h.writeUInt32LE(offset, 42);
    return Buffer.concat([h, n]);
}

function buildStoredZip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    entries.forEach(function (entry) {
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const crc = crc32(data);
        const header = localHeader(entry.name, data, crc);
        local.push(header, data);
        central.push(centralHeader(entry.name, data, crc, offset));
        offset += header.length + data.length;
    });
    const centralData = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat(local.concat([centralData, end]));
}

function packagePublic(options) {
    options = options || {};
    const root = BuildProfile.root;
    const htmlPath = path.resolve(options.htmlPath || path.join(root, "dist", "mallowstead.html"));
    const readmePath = path.resolve(options.readmePath || path.join(root, "PLAYER-README.md"));
    const licensePath = path.resolve(options.licensePath || path.join(root, "LICENSE"));
    const outputPath = path.resolve(options.outputPath || path.join(root, "dist", BuildProfile.packageFilename()));
    const sources = [
        ["mallowstead.html", htmlPath],
        ["README.md", readmePath],
        ["LICENSE", licensePath]
    ];
    sources.forEach(function (entry) {
        if (!fs.existsSync(entry[1]) || !fs.statSync(entry[1]).isFile()) throw new Error(`Public package source is missing: ${entry[1]}`);
    });
    const zip = buildStoredZip(sources.map(function (entry) { return { name: entry[0], data: fs.readFileSync(entry[1]) }; }));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, zip);
    return { outputPath: outputPath, entries: sources.map(function (entry) { return entry[0]; }) };
}

if (require.main === module) {
    try {
        const result = packagePublic();
        console.log(`Packaged ${result.outputPath}: ${result.entries.join(", ")}`);
    } catch (error) {
        console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

module.exports = { crc32, buildStoredZip, packagePublic };
