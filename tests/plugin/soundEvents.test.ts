/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import type { PublishStatus } from "../../plugins/dass/publishing";
import { streamSoundEvents, streamSoundState, type StreamSoundState } from "../../plugins/dass/soundEvents";
import type { WatchStatus } from "../../plugins/dass/watching";

const idle: StreamSoundState = { contextId: "call", publishing: false, closed: false };
const publishing = { ...idle, publishing: true };
const watching = { ...idle, watchingKey: "call:publisher" };

test("publishing starts and ends once, with no repeated snapshot cues", () => {
    expect(streamSoundEvents(idle, publishing)).toEqual(["stream_started"]);
    expect(streamSoundEvents(publishing, publishing)).toEqual([]);
    expect(streamSoundEvents(publishing, idle)).toEqual(["stream_ended"]);
    expect(streamSoundEvents(idle, idle)).toEqual([]);
});

test("watch join, manual leave and unexpected closure use distinct cues", () => {
    expect(streamSoundEvents(idle, watching)).toEqual(["stream_user_joined"]);
    expect(streamSoundEvents(watching, watching)).toEqual([]);
    expect(streamSoundEvents(watching, idle)).toEqual(["stream_user_left"]);
    const closed = { ...idle, closed: true };
    expect(streamSoundEvents(watching, closed)).toEqual(["stream_ended"]);
    expect(streamSoundEvents(closed, idle)).toEqual([]);
    expect(streamSoundEvents(idle, closed)).toEqual([]);
});

test("context exit/switch is silent and combined closure does not double-play ended", () => {
    expect(streamSoundEvents(publishing, { ...idle, contextId: undefined })).toEqual([]);
    expect(streamSoundEvents(watching, { ...idle, contextId: "other" })).toEqual([]);
    expect(streamSoundEvents({ ...publishing, watchingKey: watching.watchingKey }, { ...idle, closed: true })).toEqual(["stream_ended"]);
});

test("switching received shares produces leave then join", () => {
    expect(streamSoundEvents(watching, { ...watching, watchingKey: "call:other" })).toEqual(["stream_user_left", "stream_user_joined"]);
});

test("broadcaster hears accepted viewer joins and leaves, not resets or repeated status", () => {
    const oneViewer = { ...publishing, viewerCount: 1 };
    expect(streamSoundEvents(publishing, oneViewer)).toEqual(["stream_user_joined"]);
    expect(streamSoundEvents(oneViewer, oneViewer)).toEqual([]);
    expect(streamSoundEvents(oneViewer, { ...publishing, viewerCount: 0 })).toEqual(["stream_user_left"]);
    expect(streamSoundEvents(oneViewer, idle)).toEqual(["stream_ended"]);
    expect(streamSoundEvents(oneViewer, { ...idle, contextId: "other" })).toEqual([]);
    expect(streamSoundEvents({ ...idle, viewerCount: 1 }, oneViewer)).toEqual(["stream_started"]);
});

test("picker, preparation, failures, and trackless subscriptions do not count as live", () => {
    const viewer: WatchStatus = { phase: "ready", message: "", shares: [], candidates: [] };
    for (const phase of ["idle", "authenticating", "capturing", "preparing", "prepared", "activating", "failed"] as const) {
        const publisher: PublishStatus = { phase, message: "", candidates: [] };
        expect(streamSoundEvents(idle, streamSoundState("call", publisher, viewer))).toEqual([]);
        const pending = { ...viewer, phase: "watching" as const, watchingShare: { roomId: "call", shareId: "publisher" } };
        expect(streamSoundState("call", publisher, pending).watchingKey).toBeUndefined();
        expect(streamSoundState("call", publisher, { ...pending, stream: {} as MediaStream }).watchingKey).toBe("call:publisher");
        expect(streamSoundState("other", publisher, { ...pending, stream: {} as MediaStream }).watchingKey).toBeUndefined();
    }
});
