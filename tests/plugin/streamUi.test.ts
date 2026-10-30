/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../plugins/dass/streamUi.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../../scripts/ui-preview/index.tsx", import.meta.url), "utf8");
const shareButton = readFileSync(new URL("../../plugins/dass/shareButton.tsx", import.meta.url), "utf8");

test("publishing control menus reuse the tile three-dot menu icons and action order", () => {
    expect(source).toContain("export function StreamIcon(");
    expect(shareButton).toContain('import { StreamIcon } from "./streamUi"');
    for (const name of ["stop", "change"]) {
        const accessory = `leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="${name}" /> }}`;
        expect(source).toContain(accessory);
        expect(shareButton).toContain(accessory);
    }
    expect(shareButton.indexOf('id="dass-stop-stream"')).toBeLessThan(shareButton.indexOf('id="dass-change-stream"'));
});

test("preview actions are mock-only and teardown removes owned UI resources", () => {
    expect(preview).toContain("window.dassUiPreview?.remove()");
    expect(preview).toContain("root.unmount()");
    expect(preview).toContain("mount.remove()");
    expect(preview).toContain("style.remove()");
    expect(preview).toContain('mockAction(local ? "Stop Streaming" : "Stop Watching")');
    for (const forbidden of ["getDisplayMedia", "getUserMedia", "captureStream", "srcObject", "PublishController", "WatchController", "fetch(", "WebSocket", "clone("]) {
        expect(preview).not.toContain(forbidden);
    }
});
