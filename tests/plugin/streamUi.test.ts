/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../plugins/dass/streamUi.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../../scripts/ui-preview/index.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../plugins/dass/streamUi.css", import.meta.url), "utf8");
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

test("stream presentation uses host primitives without module discovery or transport access", () => {
    expect(source).toContain('import { Button } from "@components/Button"');
    expect(source).toContain('import { Clickable, ContextMenuApi, Menu, React, Tooltip, useLayoutEffect, useRef, useState } from "@webpack/common"');
    for (const forbidden of ["findComponent", "findBy", "getDisplayMedia", "RTCPeerConnection", "fetch(", "UserStore", "document.", "<button", "<input"]) {
        expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("disabled={!changeSource}");
    expect(source).toContain("disabled={!popout}");
    expect(source).toContain("event.stopPropagation()");
});

test("quality reveal uses measured width and cleans up its size observer", () => {
    expect(source).toContain("observer.disconnect()");
    expect(source).toContain("element.getBoundingClientRect().width");
    expect(css).toContain("width: var(--vc-dass-stream-quality-width, 0px)");
    expect(css).toContain("transform: translateX(100%)");
    expect(css).not.toContain("grid-template-columns");
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

test("presentation CSS is scoped and offers keyboard and reduced-motion states", () => {
    expect(css).toContain(".vc-dass-stream-surface:focus-within");
    expect(css).toContain(".vc-dass-stream-media:focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("letter-spacing: 0.02em");
    expect(css).not.toMatch(/\[class[*^$~|]?=/);
    expect(css).not.toContain("!important");
});

test("publisher preview controls, filled icons and quality details stay presentation-only", () => {
    expect(source).toContain('label="Show My Screen Share" checked={showPreview}');
    expect(source).toContain('label="Pause Preview When Discord Isn’t Focused" checked={pauseWhenUnfocused}');
    expect(source).toContain('name="camera"');
    expect(source).toContain('name="nitro" premiumGradient');
    expect(source).toContain('StreamLiveBadge quality={quality}');
    expect(source).not.toContain('stroke="currentColor"');
    expect(source).toContain('<span className="vc-dass-stream-title"><StreamIcon name="screen" /><span>{props.title}</span></span>');
    expect(css).toContain(".vc-dass-stream-surface:hover .vc-dass-stream-quality-clip");
    expect(css).toContain("--premium-nitro-pink-text");
});
