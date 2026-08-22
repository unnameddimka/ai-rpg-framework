#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}
const sourceDirectory = argument("--source", path.join(root, "src"));
const outputPath = argument("--output", path.join(root, "dist", "mallowstead.html"));
const templatePath = argument("--template", fs.existsSync(outputPath) ? outputPath : path.join(root, "dist", "game.html"));

function fail(message) {
    throw new Error(message);
}

function walk(directory) {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...walk(absolute));
        } else if (entry.isFile()) {
            result.push(absolute);
        }
    }
    return result;
}

function relative(file) {
    return path.relative(sourceDirectory, file).split(path.sep).join("/");
}

function htmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseHeader(header, fileName) {
    let rest = header.slice(2).trim();
    let metadata = null;
    let tags = [];

    const metadataMatch = rest.match(/\s+(\{.*\})\s*$/);
    if (metadataMatch) {
        metadata = JSON.parse(metadataMatch[1]);
        rest = rest.slice(0, metadataMatch.index).trim();
    }

    const tagsMatch = rest.match(/\s+\[([^\]]*)\]\s*$/);
    if (tagsMatch) {
        tags = tagsMatch[1].trim() ? tagsMatch[1].trim().split(/\s+/) : [];
        rest = rest.slice(0, tagsMatch.index).trim();
    }

    if (!rest) {
        fail(`Empty Twee passage name in ${fileName}.`);
    }
    return { name: rest, tags, metadata };
}

function parseTwee(file) {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    const passages = [];
    let current = null;

    function finish() {
        if (!current) {
            return;
        }
        while (current.body.length > 0 && current.body[current.body.length - 1] === "") {
            current.body.pop();
        }
        passages.push({
            name: current.name,
            tags: current.tags,
            metadata: current.metadata,
            body: current.body.join("\n")
        });
    }

    for (const line of lines) {
        if (line.startsWith("::")) {
            finish();
            current = { ...parseHeader(line, relative(file)), body: [] };
        } else if (current) {
            current.body.push(line);
        } else if (line.trim()) {
            fail(`Text before the first Twee passage in ${relative(file)}.`);
        }
    }
    finish();
    return passages;
}

function readSource() {
    const files = walk(sourceDirectory).sort((a, b) => relative(a).localeCompare(relative(b), "en"));
    const cssFiles = files.filter((file) => file.endsWith(".css"));
    const jsFiles = files.filter((file) => file.endsWith(".js"));
    const tweeFiles = files.filter((file) => file.endsWith(".twee"));

    const passages = [];
    for (const file of tweeFiles) {
        passages.push(...parseTwee(file));
    }

    const byName = new Map();
    for (const passage of passages) {
        if (byName.has(passage.name)) {
            fail(`Duplicate Twee passage '${passage.name}'.`);
        }
        byName.set(passage.name, passage);
    }

    const storyTitle = byName.get("StoryTitle");
    const storyDataPassage = byName.get("StoryData");
    if (!storyTitle || !storyTitle.body.trim()) {
        fail("StoryTitle passage is missing or empty.");
    }
    if (!storyDataPassage) {
        fail("StoryData passage is missing.");
    }

    let storyData;
    try {
        storyData = JSON.parse(storyDataPassage.body);
    } catch (error) {
        fail(`StoryData is not valid JSON: ${error.message}`);
    }

    const compiledPassages = passages.filter((passage) => passage.name !== "StoryTitle" && passage.name !== "StoryData");
    if (!compiledPassages.some((passage) => passage.name === storyData.start)) {
        fail(`StoryData start passage '${storyData.start}' does not exist.`);
    }

    const styles = cssFiles.map((file, index) => {
        const content = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
        return `/* twine-user-stylesheet #${index + 1}: "${relative(file)}" */\n${content}`;
    }).join("\n\n");

    const scripts = jsFiles.map((file, index) => {
        const content = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
        return `/* twine-user-script #${index + 1}: "${relative(file)}" */\n${content}`;
    }).join("\n\n");

    return {
        title: storyTitle.body.trim(),
        storyData,
        passages: compiledPassages,
        styles,
        scripts
    };
}

function buildStoryData(source) {
    const startIndex = source.passages.findIndex((passage) => passage.name === source.storyData.start);
    const attributes = [
        ["name", source.title],
        ["startnode", String(startIndex + 1)],
        ["creator", "AI RPG fallback builder"],
        ["creator-version", "1"],
        ["ifid", source.storyData.ifid],
        ["zoom", source.storyData.zoom == null ? 1 : source.storyData.zoom],
        ["format", source.storyData.format],
        ["format-version", source.storyData["format-version"]],
        ["options", ""]
    ].map(([name, value]) => `${name}="${htmlEscape(value == null ? "" : value)}"`).join(" ");

    const passageHtml = source.passages.map((passage, index) => {
        const metadata = passage.metadata || {};
        const x = metadata.position && Number.isFinite(Number(String(metadata.position).split(",")[0]))
            ? String(metadata.position).split(",")[0]
            : String(100 + index * 125);
        const y = metadata.position && String(metadata.position).includes(",")
            ? String(metadata.position).split(",")[1]
            : "100";
        const size = metadata.size || "100,100";
        return `<tw-passagedata pid="${index + 1}" name="${htmlEscape(passage.name)}" tags="${htmlEscape(passage.tags.join(" "))}" position="${htmlEscape(`${x},${y}`)}" size="${htmlEscape(size)}">${htmlEscape(passage.body)}</tw-passagedata>`;
    }).join("");

    return `<tw-storydata ${attributes} hidden>` +
        `<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">${source.styles}</style>` +
        `<script role="script" id="twine-user-script" type="text/twine-javascript">${source.scripts}</script>` +
        passageHtml +
        `</tw-storydata>`;
}

function main() {
    if (!fs.existsSync(templatePath)) {
        fail(`Fallback build needs an existing SugarCube runtime template at ${templatePath}. Install Tweego for a clean build.`);
    }

    const template = fs.readFileSync(templatePath, "utf8");
    const start = template.indexOf("<tw-storydata ");
    const endMarker = "</tw-storydata>";
    const end = template.indexOf(endMarker, start);
    if (start < 0 || end < 0 || !template.includes('id="script-sugarcube"')) {
        fail("Existing dist/game.html is not a usable SugarCube runtime template.");
    }

    const source = readSource();
    let prefix = template.slice(0, start);
    let suffix = template.slice(end + endMarker.length);
    prefix = prefix.replace(/<title>[\s\S]*?<\/title>/i, `<title>${htmlEscape(source.title)}</title>`);

    // SugarCube's compiled Story.init() embeds the story name directly in the
    // runtime bootstrap. Reusing an existing runtime after a StoryTitle rename
    // must update that embedded name too; replacing <tw-storydata name> alone
    // leaves Story.id / Config.saves.id on the previous build identity.
    const embeddedStoryNamePattern = /_name=generateName\((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\)/;
    const prefixMatches = prefix.match(new RegExp(embeddedStoryNamePattern.source, "g")) || [];
    const suffixMatches = suffix.match(new RegExp(embeddedStoryNamePattern.source, "g")) || [];
    const embeddedStoryNameCount = prefixMatches.length + suffixMatches.length;
    if (embeddedStoryNameCount !== 1) {
        fail(`Fallback SugarCube runtime must contain exactly one embedded story-name bootstrap; found ${embeddedStoryNameCount}.`);
    }
    if (prefixMatches.length === 1) {
        prefix = prefix.replace(embeddedStoryNamePattern, `_name=generateName(${JSON.stringify(source.title)})`);
    } else {
        suffix = suffix.replace(embeddedStoryNamePattern, `_name=generateName(${JSON.stringify(source.title)})`);
    }

    const output = prefix + buildStoryData(source) + suffix;

    const temporary = `${outputPath}.tmp`;
    fs.writeFileSync(temporary, output, "utf8");
    fs.renameSync(temporary, outputPath);
    console.log(`Built ${outputPath} using the existing embedded SugarCube runtime.`);
}

try {
    main();
} catch (error) {
    console.error(`ERROR: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
}
