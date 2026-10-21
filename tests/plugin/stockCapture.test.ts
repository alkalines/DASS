/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { createStockCaptureBridge, type PickerSettings } from "../../plugins/dass/stockCapture";

class Track extends EventTarget {
    readyState = "live";
    constructor(readonly kind: string) { super(); }
    stop() { this.readyState = "ended"; }
}

function fixture(hasVirtualAudio = true) {
    let settings: PickerSettings = { audio: true, includeSources: "None" };
    const video = new Track("video");
    const audio = new Track("audio");
    const tracks = [video];
    const stream = {
        getTracks: () => [...tracks],
        getVideoTracks: () => tracks.filter(track => track.kind === "video"),
        getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
        removeTrack: (track: Track) => tracks.splice(tracks.indexOf(track), 1)
    } as MediaStream;
    let acquisitions = 0;
    let unmutes = 0;
    let stops = 0;
    let nativeSharing = false;
    const devices = {
        enumerateDevices: async () => [...hasVirtualAudio ? [{ label: "vencord-screen-share", deviceId: "virtual" }] : [], { label: "Microphone", deviceId: "mic" }],
        getDisplayMedia: async () => {
            const listed = await devices.enumerateDevices();
            if (listed.some(device => device.label === "vencord-screen-share")) {
                acquisitions++;
                tracks.push(audio);
            }
            return stream;
        }
    } as MediaDevices;
    const installed = devices.getDisplayMedia;
    const enumerate = devices.enumerateDevices;
    const bridge = createStockCaptureBridge({ devices, settings: () => settings, nativeSharing: () => nativeSharing,
        linux: true, unmute: async () => { unmutes++; }, stopAudio: async () => { stops++; } });
    bridge.start();
    return { bridge, devices, installed, enumerate, stream, video, audio,
        select: (value: PickerSettings) => { settings = value; }, setNative: () => { nativeSharing = true; },
        acquisitions: () => acquisitions, unmutes: () => unmutes, stops: () => stops };
}

describe("stock Equibop plugin capture", () => {
    test("calls the installed wrapper without a custom host bridge and avoids unselected virtual audio", async () => {
        const f = fixture();
        const lease = await f.bridge.capture(new AbortController().signal);
        expect(lease.stream).toBe(f.stream);
        expect(lease.audioSelected).toBe(false);
        expect(f.acquisitions()).toBe(0);
        expect(f.unmutes()).toBe(0);
        expect(await f.devices.enumerateDevices()).toEqual([{ label: "Microphone", deviceId: "mic" }]);
        await lease.release();
        expect(f.devices.enumerateDevices).toBe(f.enumerate);
        expect(f.video.readyState).toBe("ended");
        expect(f.stops()).toBe(1);
        f.bridge.stop();
        expect(f.devices.getDisplayMedia).toBe(f.installed);
    });

    test("uses explicit current picker audio selection and releases selected audio", async () => {
        const f = fixture();
        f.select({ audio: true, includeSources: "Entire System" });
        const lease = await f.bridge.capture(new AbortController().signal);
        expect(lease.audioSelected).toBe(true);
        expect(f.acquisitions()).toBe(1);
        expect(f.unmutes()).toBe(1);
        await lease.release();
        expect(f.audio.readyState).toBe("ended");
        f.bridge.stop();
    });

    test("refuses native capture during DASS ownership", async () => {
        const f = fixture();
        const lease = await f.bridge.capture(new AbortController().signal);
        await expect(f.devices.getDisplayMedia()).rejects.toThrow("DASS is using");
        await lease.release();
        f.bridge.stop();
    });

    test("selected audio unavailable refuses and stops returned video without microphone fallback", async () => {
        const f = fixture(false);
        f.select({ audio: true, includeSources: "Entire System" });
        await expect(f.bridge.capture(new AbortController().signal)).rejects.toThrow("Capture failed");
        expect(f.video.readyState).toBe("ended");
        expect(f.acquisitions()).toBe(0);
        expect(f.unmutes()).toBe(0);
        expect(f.stops()).toBe(1);
        expect(f.devices.enumerateDevices).toBe(f.enumerate);
        f.bridge.stop();
    });

    test("refuses DASS when a native capture is pending or active", async () => {
        const f = fixture();
        const pending = f.devices.getDisplayMedia();
        await expect(f.bridge.capture(new AbortController().signal)).rejects.toThrow("Stop your Discord");
        await pending;
        await expect(f.bridge.capture(new AbortController().signal)).rejects.toThrow("Stop your Discord");
        f.video.stop();
        await expect(f.bridge.capture(new AbortController().signal)).rejects.toThrow("Capture failed");
        expect(f.stops()).toBe(1);
        f.bridge.stop();
    });

    test("refuses an existing Discord stream without opening capture", async () => {
        const f = fixture();
        f.setNative();
        await expect(f.bridge.capture(new AbortController().signal)).rejects.toThrow("Stop your Discord");
        expect(f.video.readyState).toBe("live");
        expect(f.stops()).toBe(0);
        f.bridge.stop();
    });

    test("disable keeps the capture guard until asynchronous DASS cleanup settles", async () => {
        const f = fixture();
        const abort = new AbortController();
        const result = f.bridge.capture(abort.signal);
        abort.abort();
        f.bridge.stop();
        expect(f.devices.getDisplayMedia).not.toBe(f.installed);
        await expect(result).rejects.toThrow();
        await Promise.resolve();
        expect(f.video.readyState).toBe("ended");
        expect(f.devices.getDisplayMedia).toBe(f.installed);
        expect(f.devices.enumerateDevices).toBe(f.enumerate);
    });

    test("source end releases tracks and audio", async () => {
        const f = fixture();
        f.select({ audio: true, includeSources: [{}] });
        await f.bridge.capture(new AbortController().signal);
        f.video.dispatchEvent(new Event("ended"));
        await Promise.resolve();
        expect(f.video.readyState).toBe("ended");
        expect(f.audio.readyState).toBe("ended");
        expect(f.stops()).toBe(1);
        f.bridge.stop();
    });
});
