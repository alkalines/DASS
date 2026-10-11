import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const revision = "27219be3566589280c0c933b04753805381d3bc8";
const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = join(root, "vendor/Equibop");
const checkout = join(root, "build/Equibop");
function git(args, cwd = checkout) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Git failed.");
    return result.stdout.trimEnd();
}
function hash(contents) {
    return createHash("sha256").update(contents).digest("hex");
}
function replaceOnce(contents, from, to) {
    if (contents.split(from).length !== 2) throw new Error("Pinned host hook did not match exactly once.");
    return contents.replace(from, to);
}

if (git(["rev-parse", "HEAD"], vendor) !== revision) throw new Error("Unexpected Equibop pin.");
if (!existsSync(checkout)) {
    mkdirSync(join(root, "build"), { recursive: true });
    git(["clone", "--no-hardlinks", "--no-checkout", vendor, checkout], root);
    git(["switch", "--detach", revision]);
}
if (git(["rev-parse", "HEAD"]) !== revision) throw new Error("Unexpected build/Equibop revision.");
const marker = join(checkout, ".dass-capture-staged.json");
const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : {};
const files = new Map();
const pickerPath = "src/renderer/components/ScreenSharePicker.tsx";
let picker = git(["show", `${revision}:${pickerPath}`]) + "\n";
picker = replaceOnce(picker, 'import { State, useSettings, useVesktopState }', 'import { DassCapture } from "renderer/dassCapture";\nimport { State, useSettings, useVesktopState }');
// Only suppress Discord's audio lifecycle for the duration of a DASS lease.
// Picker UI, selection and capture remain upstream code.
if (picker.split("if (!ownsStream(streamKey)) {").length !== 3) throw new Error("Unexpected audio lifecycle hooks.");
picker = picker.replaceAll("if (!ownsStream(streamKey)) {", "if (DassCapture.ownsAudio() || !ownsStream(streamKey)) {");
files.set(pickerPath, picker);
const indexPath = "src/renderer/index.ts";
files.set(indexPath, git(["show", `${revision}:${indexPath}`]) + '\n\nexport { DassCapture } from "./dassCapture";\n');
for (const name of ["dassCapture.ts", "dassCaptureLifecycle.ts"]) {
    files.set(`src/renderer/${name}`, readFileSync(join(root, "tooling/equibop", name), "utf8"));
}
for (const path of git(["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean)) {
    if (!files.has(path)) throw new Error(`Unrelated host changes: ${path}`);
}
// Check all destinations before writing any of them; never overwrite user work.
for (const [path, contents] of files) {
    const destination = join(checkout, path);
    if (!existsSync(destination)) continue;
    const current = readFileSync(destination, "utf8");
    const upstream = spawnSync("git", ["show", `${revision}:${path}`], { cwd: checkout, encoding: "utf8" });
    if (current !== contents && hash(current) !== previous[path] && (upstream.status !== 0 || current !== upstream.stdout)) {
        throw new Error(`Unfamiliar host changes: ${path}`);
    }
}
const hashes = {};
for (const [path, contents] of files) {
    writeFileSync(join(checkout, path), contents);
    hashes[path] = hash(contents);
}
writeFileSync(marker, JSON.stringify(hashes, null, 2) + "\n");
console.log("Staged capture bridge in build/Equibop; no install, build or launch performed.");
