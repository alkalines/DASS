/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { createEquibopCapture } from "../../plugins/dass/capture";
import { createShareSelection, TRANSPORT_UNAVAILABLE_MESSAGE } from "../../plugins/dass/discordAdapter";
import { PublishController } from "../../plugins/dass/publishing";
import { type CaptureLease, type ScreenshareTransport, ScreenshareRouting } from "../../plugins/dass/routing";
import { DassSession } from "../../plugins/dass/session";
import { type SpikePeer } from "../../clients/spike/peer";
import { type SpikeSignaling } from "../../clients/spike/signaling";
import { memoryIdentityStore } from "./helpers/e2eeStore";

class Track extends EventTarget {
    readyState = "live";
    stops = 0;
    constructor(readonly kind: string) { super(); }
    stop() {
        this.stops++;
        this.readyState = "ended";
        this.dispatchEvent(new Event("ended"));
    }
}

function captureFixture() {
    const video = new Track("video");
    const audio = new Track("audio");
    const tracks = [video, audio];
    const stream = {
        getTracks: () => [...tracks],
        getVideoTracks: () => tracks.filter(track => track.kind === "video"),
        getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
        removeTrack: (track: Track) => { tracks.splice(tracks.indexOf(track), 1); }
    } as unknown as MediaStream;
    return { video, audio, stream };
}

function publisherFixture(options: { prepareFails?: boolean; } = {}) {
    const session = new DassSession();
    session.configure("authorized_room", "separate_secret");
    const captures = captureFixture();
    let context: string | undefined = "discord_context";
    let releases = 0;
    const signalingClosed = new AbortController();
    const signaling = {
        closed: signalingClosed.signal,
        close: () => signalingClosed.abort(),
        onViewRequests: () => {},
        decideView: async () => {},
        removeViewer: async () => {},
        keyRelay: async () => {}
    } as unknown as SpikeSignaling;
    const peerClosed = new AbortController();
    const peer = {
        closed: peerClosed.signal,
        candidates: [],
        closeMessage: "Source ended.",
        close: () => peerClosed.abort(),
        setSendEpoch: () => {},
        retireEpochsBelow: () => {},
        activate: async () => "publisher_session"
    } as unknown as SpikePeer;
    const lease: CaptureLease = {
        stream: captures.stream,
        audioSelected: true,
        release: () => { releases++; }
    };
    const bridge = { version: 1 as const, capture: async () => lease };
    const controller = new PublishController(session, () => context, {
        connect: async () => signaling,
        prepare: async () => {
            if (options.prepareFails) throw new Error("preparation failed");
            return peer;
        },
        identityStore: async () => memoryIdentityStore()
    });
    controller.start();
    return {
        controller,
        captures,
        bridge,
        signalingClosed,
        releases: () => releases,
        leaveContext: () => { context = undefined; }
    };
}

const pluginDirectory = new URL("../../plugins/dass/", import.meta.url);

function pluginSources() {
    return readdirSync(pluginDirectory)
        .filter(name => /\.tsx?$/.test(name))
        .map(name => ({ name, source: readFileSync(new URL(name, pluginDirectory), "utf8") }));
}

describe("capture consent stays on the host boundary", () => {
    test("only the host adapters can call capture APIs, with no microphone or Discord previews", () => {
        const forbidden = ["getUserMedia", "captureStream(", "DiscordNative", "thumbnail"];
        for (const { name, source } of pluginSources()) {
            if (name === "desktopCapture.tsx") continue;
            for (const token of forbidden) {
                expect(source.includes(token)).toBe(false);
            }
            if (name !== "captureHost.ts" && name !== "stockCapture.ts") expect(source.includes("getDisplayMedia")).toBe(false);
        }
    });

    test("an unavailable capture bridge fails closed and captures nothing", async () => {
        await expect(createEquibopCapture(undefined)(new AbortController().signal)).rejects.toThrow();
        await expect(createEquibopCapture({ version: 2 } as never)(new AbortController().signal)).rejects.toThrow();
    });

    test("a picker cancelled while the host starts releases the late lease", async () => {
        const controller = new AbortController();
        let releases = 0;
        const lease = { stream: {} as MediaStream, audioSelected: false, release: () => { releases++; } };
        const bridge = {
            version: 1 as const,
            capture: async () => {
                controller.abort();
                return lease;
            }
        };
        await expect(createEquibopCapture(bridge)(controller.signal)).rejects.toThrow();
        expect(releases).toBe(1);
    });
});

describe("every teardown path releases the capture", () => {
    test("stopping the publisher stops the captured tracks and releases the lease", async () => {
        const f = publisherFixture();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            expect(f.captures.video.stops).toBe(0);
            f.controller.reset();
            expect(f.captures.video.stops).toBe(1);
            expect(f.captures.audio.stops).toBe(1);
            expect(f.releases()).toBe(1);
        } finally { f.controller.stop(); }
    });

    test("repeated teardown is safe and never releases twice", async () => {
        const f = publisherFixture();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            f.controller.reset();
            f.controller.reset();
            f.controller.stop();
            expect(f.releases()).toBe(1);
            expect(f.captures.video.stops).toBe(1);
        } finally { f.controller.stop(); }
    });

    test("leaving the voice context stops sharing and releases the capture", async () => {
        const f = publisherFixture();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            f.leaveContext();
            for (let attempt = 0; attempt < 40 && f.releases() === 0; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            expect(f.releases()).toBe(1);
            expect(f.captures.video.stops).toBe(1);
            expect(f.controller.getSnapshot().phase).toBe("idle");
        } finally { f.controller.stop(); }
    });

    test("a server failure releases the capture and stops the tracks", async () => {
        const f = publisherFixture();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            f.signalingClosed.abort();
            for (let attempt = 0; attempt < 40 && f.releases() === 0; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            expect(f.releases()).toBe(1);
            expect(f.captures.video.stops).toBe(1);
            expect(f.controller.getSnapshot().phase).toBe("failed");
        } finally { f.controller.stop(); }
    });

    test("a partial setup failure releases the capture instead of keeping it alive", async () => {
        const f = publisherFixture({ prepareFails: true });
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            expect(f.releases()).toBe(1);
            expect(f.captures.video.stops).toBe(1);
            expect(f.controller.getSnapshot().phase).toBe("failed");
        } finally { f.controller.stop(); }
    });

    test("a source end stops the subscription tracks and closes the connection", async () => {
        const captures = captureFixture();
        let closed = 0;
        const transport = {
            preparePublish: async () => { throw new Error("Publishing is not owned by the viewer routing."); },
            listShares: async () => [],
            subscribe: async () => ({ stream: captures.stream, close: () => { closed++; } })
        } as unknown as ScreenshareTransport;
        const routing = new ScreenshareRouting(transport);
        routing.start();
        routing.setRoom("room");
        const result = await routing.watch({ roomId: "room", shareId: "share" });
        expect(result.ok).toBe(true);
        captures.video.stop();
        expect(closed).toBe(1);
        expect(captures.audio.stops).toBe(1);
        routing.stop();
    });
});

describe("no silent media leakage to Discord", () => {
    test("choosing DASS never starts the native Discord share", () => {
        let native = 0;
        let dass = 0;
        const select = createShareSelection(new AbortController().signal, () => true, () => { native++; }, () => { dass++; });
        select("dass");
        expect(native).toBe(0);
        expect(dass).toBe(1);
    });

    test("an unavailable DASS transport fails closed instead of sharing to Discord", () => {
        let native = 0;
        const select = createShareSelection(new AbortController().signal, () => true, () => { native++; });
        expect(select("dass")).toBe(TRANSPORT_UNAVAILABLE_MESSAGE);
        expect(native).toBe(0);
    });

    test("a cancelled or stale share selection never starts either transport", () => {
        let native = 0;
        let dass = 0;
        const aborted = new AbortController();
        aborted.abort();
        const select = createShareSelection(aborted.signal, () => true, () => { native++; }, () => { dass++; });
        select("dass");
        select("discord");
        const stale = createShareSelection(new AbortController().signal, () => false, () => { native++; }, () => { dass++; });
        stale("dass");
        expect(native).toBe(0);
        expect(dass).toBe(0);
    });
});
