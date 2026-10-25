/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CallPresentation, projectParticipants } from "../../plugins/dass/callPresentation";
import { gridShares } from "../../plugins/dass/gridPresentation";
import type { WatchStatus } from "../../plugins/dass/watching";

test("ended view preserves focused selection until Close Stream removes the retained tile", () => {
    const share = { roomId: "call", shareId: "publisher", displayName: "Publisher" };
    const empty: WatchStatus = { phase: "ready", message: "", shares: [], candidates: [], directoryRoomId: "call", directoryRequestedAtMs: 101 };
    const watching: WatchStatus = { ...empty, phase: "watching", watchingShare: share };
    const presentation = new CallPresentation();
    const live = projectParticipants(gridShares("call", "call", true, false, empty, [watching]));
    presentation.select("call", live[0], live);
    const ended = projectParticipants(gridShares("call", "call", true, false, empty, [{ ...empty, phase: "disconnected", closedShare: share, disconnectedAtMs: 100 }]));
    presentation.reconcile("call", ended);
    expect(presentation.getSelected("call", ended)?.id).toBe(live[0].id);
    expect(ended[0].dassShare).toHaveProperty("ended", true);
    presentation.reconcile("call", []);
    expect(presentation.getSelected("call", [])).toBeUndefined();
});

test("ended screen reuses host illustration styles and controls without media, asset URLs or hashed classes", () => {
    const source = readFileSync(new URL("../../plugins/dass/streamEnded.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../plugins/dass/streamEnded.css", import.meta.url), "utf8");
    expect(source).toContain("This stream has ended.");
    expect(source).toContain("Close Stream");
    expect(source).toContain("findCssClassesLazy(...NATIVE_STREAM_ENDED_ART_STYLE_KEYS)");
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('aria-live="polite"');
    expect(css).toContain("height: 185px");
    expect(css).toContain("height: 134px");
    expect(css).toContain("padding-bottom: 48px");
    for (const forbidden of ["discord.com", "/assets/", "__29209", "getDisplayMedia", "RTCPeerConnection", "fetch(", "<video"]) {
        expect(source).not.toContain(forbidden);
        expect(css).not.toContain(forbidden);
    }
});
