/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { createCaptureOwnership } from "../../tooling/equibop/captureOwnership";
import { createCaptureBridge } from "../../tooling/equibop/dassCaptureLifecycle";
import { createInstalledCapture } from "../../tooling/equibop/installedCapture";

class Track extends EventTarget {
    readyState = "live";
    stops = 0;
    constructor(readonly kind: string) { super(); }
    stop() { this.readyState = "ended"; this.stops++; }
}

function stream(...tracks: Track[]) {
    return {
        getTracks: () => [...tracks],
        getVideoTracks: () => tracks.filter(track => track.kind === "video"),
        getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
        addTrack: (track: Track) => tracks.push(track),
        removeTrack: (track: Track) => { tracks.splice(tracks.indexOf(track), 1); }
    } as unknown as MediaStream;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture(selected = true) {
    const ownership = createCaptureOwnership();
    const video = new Track("video");
    const originalAudio = new Track("audio");
    const audio = new Track("audio");
    const captured = stream(video, originalAudio);
    let acquisitions = 0;
    let stops = 0;
    const host = {
        capture: async () => captured,
        audioSelected: () => selected,
        configureVideo: () => {},
        acquireAudio: async () => { acquisitions++; return stream(audio); },
        stopAudio: async () => { stops++; }
    };
    return { ownership, video, originalAudio, audio, captured, host, acquisitions: () => acquisitions, stops: () => stops };
}

test("no audio consent never acquires virtual audio", async () => {
    const f = fixture(false);
    const result = await createInstalledCapture(f.host, f.ownership)();
    expect(f.acquisitions()).toBe(0);
    expect(f.originalAudio.stops).toBe(1);
    expect(result.getAudioTracks()).toHaveLength(0);
    f.ownership.stopNative();
    expect(f.video.stops).toBe(1);
    await Promise.resolve();
    f.ownership.claim("dass")();
});

test("replaced audio is stopped; selected share audio survives until teardown", async () => {
    const f = fixture();
    const result = await createInstalledCapture(f.host, f.ownership)();
    expect(f.originalAudio.stops).toBe(1);
    expect(result.getAudioTracks()).toEqual([f.audio]);
    f.ownership.stopNative();
    f.ownership.stopNative();
    expect(f.audio.stops).toBe(1);
    expect(f.stops()).toBe(1);
});

test("audio acquisition failure stops already acquired video", async () => {
    const f = fixture();
    await expect(createInstalledCapture({ ...f.host, acquireAudio: async () => { throw new Error("private error"); } }, f.ownership)()).rejects.toThrow("choose no audio");
    expect(f.video.stops).toBe(1);
    expect(f.originalAudio.stops).toBe(1);
    expect(f.stops()).toBe(1);
    f.ownership.claim("dass")();
});

test("source end while audio is pending holds ownership and stops late audio", async () => {
    const f = fixture();
    const pending = deferred<MediaStream>();
    const entered = deferred<void>();
    const result = createInstalledCapture({ ...f.host, acquireAudio: () => { entered.resolve(); return pending.promise; } }, f.ownership)();
    await entered.promise;
    f.video.dispatchEvent(new Event("ended"));
    expect(() => f.ownership.claim("dass")).toThrow();
    expect(f.stops()).toBe(0);
    pending.resolve(stream(f.audio));
    await expect(result).rejects.toThrow();
    expect(f.audio.stops).toBe(1);
    expect(f.stops()).toBe(1);
});

test("native and DASS overlap is rejected in both directions before capture", async () => {
    const f = fixture(false);
    const installed = createInstalledCapture(f.host, f.ownership);
    const bridge = createCaptureBridge({
        ...f.host,
        claim: () => f.ownership.claim("dass"),
        capture: () => f.ownership.invokeDass(() => installed()),
        unmute: async () => {}
    });
    await installed();
    await expect(bridge.capture(new AbortController().signal)).rejects.toThrow();
    f.ownership.stopNative();
    await Promise.resolve();
    const second = fixture(false);
    const otherInstalled = createInstalledCapture(second.host, second.ownership);
    const otherBridge = createCaptureBridge({
        ...second.host,
        claim: () => second.ownership.claim("dass"),
        capture: () => second.ownership.invokeDass(() => otherInstalled()),
        unmute: async () => {}
    });
    const lease = await otherBridge.capture(new AbortController().signal);
    await expect(otherInstalled()).rejects.toThrow("Another screen capture");
    lease.release();
    expect(second.video.stops).toBe(1);
});

test("unavailable selected audio fails closed; video-only still works", async () => {
    const f = fixture();
    await expect(createInstalledCapture({ ...f.host, acquireAudio: async () => stream() }, f.ownership)()).rejects.toThrow();
    expect(f.video.stops).toBe(1);
    const videoOnly = fixture(false);
    await createInstalledCapture({ ...videoOnly.host, acquireAudio: async () => { throw new Error("venmic unavailable"); } }, videoOnly.ownership)();
    expect(videoOnly.video.readyState).toBe("live");
    videoOnly.ownership.stopNative();
});

test("wrapper stops unexpected tracks outside the returned audio lease", async () => {
    const f = fixture();
    const unexpectedVideo = new Track("video");
    const result = await createInstalledCapture({ ...f.host, acquireAudio: async () => stream(f.audio, unexpectedVideo) }, f.ownership)();
    expect(unexpectedVideo.stops).toBe(1);
    expect(result.getVideoTracks()).toEqual([f.video]);
    f.ownership.stopNative();
});

test("native audio cleanup failure keeps exclusive ownership locked", async () => {
    const f = fixture(false);
    await createInstalledCapture({ ...f.host, stopAudio: async () => { throw new Error("private IPC error"); } }, f.ownership)();
    f.ownership.stopNative();
    await Promise.resolve();
    expect(f.video.stops).toBe(1);
    expect(() => f.ownership.claim("dass")).toThrow();
});

test("DASS abort during wrapper audio acquisition stops video immediately and late audio on arrival", async () => {
    const f = fixture();
    const abort = new AbortController();
    const entered = deferred<void>();
    const pending = deferred<MediaStream>();
    const release = f.ownership.claim("dass");
    const installed = createInstalledCapture({
        ...f.host,
        signal: () => abort.signal,
        acquireAudio: () => { entered.resolve(); return pending.promise; }
    }, f.ownership);
    const result = f.ownership.invokeDass(() => installed());
    await entered.promise;
    abort.abort();
    expect(f.video.stops).toBe(1);
    expect(f.stops()).toBe(0); // The bridge, not the wrapper, owns DASS audio IPC.
    expect(() => f.ownership.claim("native")).toThrow();
    pending.resolve(stream(f.audio));
    await expect(result).rejects.toThrow();
    expect(f.audio.stops).toBe(1);
    release();
});

test("DASS abort before display completion prevents subsequent virtual acquisition", async () => {
    const f = fixture();
    const abort = new AbortController();
    const pending = deferred<MediaStream>();
    const release = f.ownership.claim("dass");
    const installed = createInstalledCapture({ ...f.host, signal: () => abort.signal, capture: () => pending.promise }, f.ownership);
    const result = f.ownership.invokeDass(() => installed());
    abort.abort();
    pending.resolve(f.captured);
    await expect(result).rejects.toThrow();
    expect(f.acquisitions()).toBe(0);
    expect(f.video.stops).toBe(1);
    expect(f.originalAudio.stops).toBe(1);
    release();
});
