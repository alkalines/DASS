/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { gridShares } from "../../plugins/dass/gridPresentation";
import type { WatchStatus } from "../../plugins/dass/watching";

test("failed setup stays an error even when the publisher disappears from the directory", () => {
    const share = { roomId: "call", shareId: "publisher", displayName: "Publisher" };
    const directory: WatchStatus = { phase: "ready", message: "", shares: [], candidates: [], directoryRoomId: "call" };
    const failed: WatchStatus = { ...directory, phase: "failed", failedShare: share };
    expect(gridShares("call", "call", true, false, directory, [failed])).toEqual([
        { key: "dass-remote:call:publisher", kind: "remote", share }
    ]);
    expect(gridShares("call", "call", true, false, directory, [{ ...failed, phase: "unauthorized" }])).toEqual([]);
    expect(gridShares("call", "other", true, false, directory, [failed])).toEqual([]);
    expect(gridShares("call", "call", false, false, directory, [failed])).toEqual([]);
});

test("stream error uses native-like typography and DASS-only help instead of fake Discord error codes", () => {
    const source = readFileSync(new URL("../../plugins/dass/streamError.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../plugins/dass/streamError.css", import.meta.url), "utf8");
    expect(source).toContain("Stream failed to start :(");
    expect(source).toContain("Stream disconnected :(");
    expect(source).toContain("Error: DASS");
    expect(source).toContain("Let us try to help.");
    expect(source).toContain("<p>{message}</p>");
    expect(source).toContain("Close Stream");
    expect(source).toContain("event.stopPropagation()");
    expect(css).toContain("font-size: 16px");
    expect(css).toContain("margin-top: 16px");
    for (const forbidden of ["2012", "support.discord.com", "c6e099", "dangerouslySetInnerHTML", "fetch(", "getDisplayMedia", "RTCPeerConnection"]) {
        expect(source).not.toContain(forbidden);
        expect(css).not.toContain(forbidden);
    }
});
