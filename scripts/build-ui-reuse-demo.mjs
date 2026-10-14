/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fileURLToPath } from "node:url";

const directory = new URL("../docs/ui-streaming-reverse-engineering/", import.meta.url);
const steps = [
    ["source parts", "71-normal-card-parts.js", "globalThis.__DASS_NORMAL_CARD_TEST__?.marker === 'dass-normal-card-v1'"],
    ["card/footer", "72-normal-card-compile.js", "typeof globalThis.__DASS_NORMAL_CARD_TEST__?.renderCard === 'function'"],
    ["overlay/video", "73-normal-card-overlay-video.js", "!!globalThis.__DASS_NORMAL_CARD_TEST__?.Video"],
    ["idle call", "67-call-video-test-prepare.js", "globalThis.__DASS_CALL_VIDEO_TEST__?.marker === 'dass-call-video-test-v1'"],
    ["generated media", "74-normal-card-sample.js", "typeof globalThis.__DASS_CALL_VIDEO_TEST__?.Sample === 'function'"],
    ["installation", "70-call-video-install.js", "globalThis.__DASS_CALL_VIDEO_TEST__?.mounted === true"]
];
const stages = [];
for (const [name, file, check] of steps) {
    const source = await Bun.file(fileURLToPath(new URL(file, directory))).text();
    const opening = "(() => {";
    const start = source.indexOf(opening);
    const end = source.lastIndexOf("})();");
    if (start < 0 || end <= start || source.slice(end).trim() !== "})();")
        throw new Error(`Unexpected console snippet envelope: ${file}`);
    let body = source.slice(start + opening.length, end);
    if (file === "67-call-video-test-prepare.js") {
        const selectionStart = body.indexOf("    const element = ");
        const selectionEnd = body.indexOf("    const webpack = ");
        if (selectionStart < 0 || selectionEnd <= selectionStart) throw new Error("Call selection block changed.");
        body = body.slice(0, selectionStart) + `
    const controller = selectedController;
    if (!controller?._wrapperRef?.current?.isConnected) return "Selected call controller is no longer mounted.";
` + body.slice(selectionEnd);
    }
    stages.push(`{ name: ${JSON.stringify(name)}, run: () => {${body}}, check: () => ${check} }`);
}
const header = "// Generated DASS normal-card research demo. Rebuild with bun scripts/build-ui-reuse-demo.mjs.\n";
const output = header + `/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Research only. Generated local video; no capture/share/watch/backend requests.
 * Select an idle voice participant in Elements before running.
 * Non-focused card only; quality/health/zoom/popout/audio remain outside the test.
 */
(() => {
    const oldParts = globalThis.__DASS_NORMAL_CARD_TEST__;
    const oldCall = globalThis.__DASS_CALL_VIDEO_TEST__;
    if (oldParts && oldParts.marker !== "dass-normal-card-v1" ||
        oldCall && oldCall.marker !== "dass-call-video-test-v1")
        return "Research name occupied by another script. Nothing changed.";
    if (typeof $0 === "undefined" || !$0?.isConnected)
        return "Select a connected idle voice participant in Elements first.";
    const fiberKey = Object.keys($0).find(key => key.startsWith("__reactFiber$"));
    let selectedController;
    for (let fiber = $0[fiberKey], depth = 0; fiber && depth < 70; fiber = fiber.return, depth++) {
        if (typeof fiber.stateNode?.renderContent === "function" &&
            typeof fiber.stateNode?.handleSelectParticipant === "function") {
            selectedController = fiber.stateNode;
            break;
        }
    }
    if (!selectedController) return "Select an actual idle call participant first.";
    try {
        oldParts?.cleanup?.();
        oldCall?.cleanup?.();
    } catch {
        return "Previous test cleanup failed. No new test installed.";
    }
    const stages = [${stages.join(",\n")}];
    for (const stage of stages) {
        try {
            const result = stage.run();
            if (!stage.check()) {
                globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup?.();
                globalThis.__DASS_CALL_VIDEO_TEST__?.cleanup?.();
                return "Stopped at " + stage.name + ": " + result;
            }
        } catch {
            globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup?.();
            globalThis.__DASS_CALL_VIDEO_TEST__?.cleanup?.();
            return "Stopped at " + stage.name + ". Owned changes restored.";
        }
    }
    return "Original non-focused card demo installed. Generated video only. Cleanup: __DASS_NORMAL_CARD_TEST__.cleanup()";
})();
`;
new Function(output);
const target = fileURLToPath(new URL("76-normal-card-demo.js", directory));
if (await Bun.file(target).exists()) {
    const existing = await Bun.file(target).text();
    if (!existing.startsWith(header)) throw new Error("Refusing to overwrite an unfamiliar console demo.");
}
await Bun.write(target, output);
console.log("Generated docs/ui-streaming-reverse-engineering/76-normal-card-demo.js");
