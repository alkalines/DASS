/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { createEquibopCapture } from "../../plugins/dass/capture";
import { createCaptureBridge } from "../../tooling/equibop/dassCaptureLifecycle";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return { promise, resolve };
}

class Track extends EventTarget {
    readyState = "live";
    stops = 0;
    constructor(readonly kind: string) { super(); }
    stop() { this.stops++; this.readyState = "ended"; }
}

function fixture(audioSelected = true) {
    const video = new Track("video");
    const audio = new Track("audio");
    const tracks = [video, audio];
    const stream = {
        getTracks: () => [...tracks],
        getVideoTracks: () => tracks.filter(track => track.kind === "video"),
        getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
        removeTrack: (track: Track) => { tracks.splice(tracks.indexOf(track), 1); }
    } as MediaStream;
    let unmutes = 0;
    let stops = 0;
    const host = {
        capture: async () => stream,
        audioSelected: () => audioSelected,
        unmute: async () => { unmutes++; },
        stopAudio: async () => { stops++; }
    };
    return { host, stream, video, audio, unmutes: () => unmutes, stops: () => stops };
}

describe("explicit host capture lifecycle", () => {
    test("missing host bridge refuses without native fallback", async () => {
        await expect(createEquibopCapture()(new AbortController().signal)).rejects.toThrow("unavailable");
    });

    test("selected audio is unmuted and source end cleans up without Discord events", async () => {
        const f = fixture();
        const bridge = createCaptureBridge(f.host);
        const lease = await createEquibopCapture(bridge)(new AbortController().signal);
        expect(lease.audioSelected).toBe(true);
        expect(f.unmutes()).toBe(1);
        f.video.dispatchEvent(new Event("ended"));
        lease.release();
        await Promise.resolve();
        expect(f.video.stops).toBe(1);
        expect(f.audio.stops).toBe(1);
        expect(f.stops()).toBe(1);
        expect(bridge.ownsAudio()).toBe(false);
    });

    test("video-only strips unwanted host audio and never unmutes", async () => {
        const f = fixture(false);
        const lease = await createCaptureBridge(f.host).capture(new AbortController().signal);
        expect(lease.stream.getAudioTracks()).toHaveLength(0);
        expect(f.audio.stops).toBe(1);
        expect(f.unmutes()).toBe(0);
        lease.release();
    });

    test("aborted pending picker retains ownership and disposes late capture", async () => {
        const f = fixture();
        const pending = deferred<MediaStream>();
        const bridge = createCaptureBridge({ ...f.host, capture: () => pending.promise });
        const controller = new AbortController();
        const result = bridge.capture(controller.signal);
        controller.abort();
        expect(bridge.ownsAudio()).toBe(true);
        await expect(bridge.capture(new AbortController().signal)).rejects.toThrow();
        pending.resolve(f.stream);
        await expect(result).rejects.toThrow("cancelled");
        expect(f.video.stops).toBe(1);
        expect(f.audio.stops).toBe(1);
        expect(f.unmutes()).toBe(0);
        expect(f.stops()).toBe(1);
    });

    test("abort during unmute waits for IPC before stopping audio", async () => {
        const f = fixture();
        const entered = deferred<void>();
        const unmuted = deferred<void>();
        const controller = new AbortController();
        const bridge = createCaptureBridge({ ...f.host, unmute: () => { entered.resolve(); return unmuted.promise; } });
        const result = bridge.capture(controller.signal);
        await entered.promise;
        controller.abort();
        expect(f.stops()).toBe(0);
        expect(f.video.stops).toBe(1);
        unmuted.resolve();
        await expect(result).rejects.toThrow();
        expect(f.stops()).toBe(1);
    });

    test("picker failure sanitizes errors and releases audio", async () => {
        const f = fixture();
        const bridge = createCaptureBridge({ ...f.host, capture: async () => { throw new Error("sensitive details"); } });
        await expect(bridge.capture(new AbortController().signal)).rejects.toThrow("Capture failed or was cancelled.");
        expect(f.stops()).toBe(1);
    });

    test("failed audio stop keeps host fail-closed", async () => {
        const f = fixture();
        const bridge = createCaptureBridge({ ...f.host, stopAudio: async () => { throw new Error("IPC failure"); } });
        const lease = await bridge.capture(new AbortController().signal);
        lease.release();
        await Promise.resolve();
        expect(bridge.ownsAudio()).toBe(true);
        await expect(bridge.capture(new AbortController().signal)).rejects.toThrow();
    });
});
