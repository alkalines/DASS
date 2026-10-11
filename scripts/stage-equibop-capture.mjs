import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const revision = "27219be3566589280c0c933b04753805381d3bc8";
const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = join(root, "vendor/Equibop");
const checkout = join(root, "build/Equibop");
// Formatting is optional on first staging (before the host dependencies exist).
// Once installed, use only the pinned host's formatter/config; never download one.
async function formatHostSources(files) {
    const require = createRequire(join(checkout, "package.json"));
    let prettier;
    try {
        prettier = require("prettier");
    } catch {
        return;
    }
    for (const [path, contents] of files) {
        const filepath = join(checkout, path);
        const config = await prettier.resolveConfig(filepath);
        files.set(path, await prettier.format(contents, { ...config, filepath }));
    }
}
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
picker = replaceOnce(picker, 'import { State, useSettings, useVesktopState }', 'import { captureOwnership } from "renderer/captureOwnership";\nimport { DassCapture } from "renderer/dassCapture";\nimport { State, useSettings, useVesktopState }');
// Only suppress Discord's audio lifecycle for the duration of a DASS lease.
// Picker UI, selection and capture remain upstream code.
if (picker.split("if (!ownsStream(streamKey)) {").length !== 3) throw new Error("Unexpected audio lifecycle hooks.");
picker = picker.replaceAll("if (!ownsStream(streamKey)) {", "if (DassCapture.ownsAudio() || !ownsStream(streamKey)) {");
// DASS quality is applied to its own capture track, never a Discord connection.
if (picker.split("const conn = [...MediaEngineStore").length !== 3) throw new Error("Unexpected native quality hooks.");
picker = picker.replaceAll("const conn = [...MediaEngineStore", "const conn = DassCapture.ownsAudio() ? undefined : [...MediaEngineStore");
picker = replaceOnce(picker, "            VesktopNative.virtmic.stop();", "            captureOwnership.stopNative();");
picker = replaceOnce(picker, "export function openScreenSharePicker(screens: Source[], skipPicker: boolean) {\n    let didSubmit = false;", `let cancelPendingPicker: (() => void) | undefined;

export function cancelScreenSharePicker() {
    cancelPendingPicker?.();
}

export function openScreenSharePicker(screens: Source[], skipPicker: boolean) {
    if (DassCapture.isCancelled()) return Promise.reject(new Error("Capture cancelled."));
    currentSettings = null;
    let didSubmit = false;
    let cancelled = false;
    let submitting = false;`);
picker = replaceOnce(picker, "                        didSubmit = true;\n\n                        if (v.includeSources && v.includeSources !== \"None\") {", `                        if (cancelled || submitting) return;
                        didSubmit = true;
                        submitting = true;
                        try {
                        if (isLinux && (v.includeSources === "Entire System" || (Array.isArray(v.includeSources) && v.includeSources.length > 0))) {`);
picker = replaceOnce(picker, "                        resolve(v);", `                        if (cancelled || DassCapture.isCancelled()) throw new Error("Capture cancelled.");
                        currentSettings = v;
                        resolve(v);
                        } catch {
                            reject(new Error("Share audio unavailable or capture cancelled. Choose no audio for video-only capture."));
                        } finally {
                            submitting = false;
                            cancelPendingPicker = undefined;
                        }`);
picker = replaceOnce(picker, '                    close={() => {\n                        props.onClose();\n                        if (!didSubmit) reject("Aborted");\n                    }}', `                    close={() => {
                        props.onClose();
                        if (!didSubmit) cancelPendingPicker?.();
                    }}`);
picker = replaceOnce(picker, '                    closeModal(key);\n                    reject("Aborted");', '                    cancelPendingPicker?.();');
picker = replaceOnce(picker, '                    if (!didSubmit) reject("Aborted");', '                    if (!didSubmit) cancelPendingPicker?.();');
picker = replaceOnce(picker, "        );\n    });\n}\n\nfunction ScreenPicker", `        );
        cancelPendingPicker = () => {
            if (cancelled) return;
            cancelled = true;
            closeModal(key);
            // Audio linking must settle before the capture owner releases venmic.
            if (!submitting) {
                cancelPendingPicker = undefined;
                reject(new Error("Capture cancelled."));
            }
        };
    });
}

function ScreenPicker`);
picker = replaceOnce(picker, '    if (!sources.ok && sources.isGlibCxxOutdated) {', `    if (!sources.ok && !sources.isGlibCxxOutdated) {
        return <Paragraph>Share audio is unavailable (venmic could not load). Select no audio for video-only capture.</Paragraph>;
    }

    if (!sources.ok && sources.isGlibCxxOutdated) {`);
files.set(pickerPath, picker);
const indexPath = "src/renderer/index.ts";
files.set(indexPath, git(["show", `${revision}:${indexPath}`]) + '\n\nexport { DassCapture } from "./dassCapture";\n');
for (const name of ["dassCapture.ts", "dassCaptureLifecycle.ts", "captureOwnership.ts", "installedCapture.ts"]) {
    files.set(`src/renderer/${name}`, readFileSync(join(root, "tooling/equibop", name), "utf8"));
}
files.set("src/renderer/patches/screenShareFixes.ts", readFileSync(join(root, "tooling/equibop/screenShareFixes.ts"), "utf8"));
await formatHostSources(files);
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
