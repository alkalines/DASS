/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { routePublish, routeWatch } from "../../plugins/dass/discordAdapter";
import { CaptureLease, PublishConnection, ScreenshareRouting, ScreenshareTransport, Subscription } from "../../plugins/dass/routing";

function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error("Promise was not initialized."); };
    const promise = new Promise<T>(finish => { resolve = finish; });
    return { promise, resolve };
}

class Track extends EventTarget {
    readyState = "live";
    stops = 0;
    constructor(readonly kind: string) { super(); }
    stop() { this.stops++; this.readyState = "ended"; }
}

function captureFixture(audioSelected = false) {
    const video = new Track("video");
    const audio = new Track("audio");
    const tracks = [video, audio];
    let releases = 0;
    const stream = {
        getTracks: () => [...tracks],
        getVideoTracks: () => tracks.filter(track => track.kind === "video"),
        getAudioTracks: () => tracks.filter(track => track.kind === "audio"),
        removeTrack: (track: Track) => { tracks.splice(tracks.indexOf(track), 1); }
    } as MediaStream;
    const lease: CaptureLease = { stream, audioSelected, release: () => { releases++; } };
    return { video, audio, lease, releases: () => releases };
}

function setup(overrides: Partial<ScreenshareTransport> = {}) {
    const published: MediaStream[] = [];
    let closes = 0;
    const connection: PublishConnection = {
        publish: async stream => { published.push(stream); },
        close: () => { closes++; }
    };
    const transport: ScreenshareTransport = {
        preparePublish: async () => connection,
        subscribe: async () => { throw new Error("Subscription unavailable."); },
        listShares: async roomId => [{ roomId, shareId: "share" }],
        ...overrides
    };
    const routing = new ScreenshareRouting(transport);
    routing.start();
    routing.setRoom("room");
    return { routing, connection, published, closes: () => closes };
}

describe("synchronous action interception", () => {
    test("explicit native actions remain untouched", () => {
        const routing = new ScreenshareRouting();
        expect(routePublish(routing, { transport: "discord" })).toEqual({ handled: false });
        expect(routeWatch(routing, { transport: "discord" })).toEqual({ handled: false });
    });

    test("DASS actions stay consumed even with no backend or disabled plugin", async () => {
        const routing = new ScreenshareRouting();
        let captures = 0;
        const publish = routePublish(routing, {
            transport: "dass", roomId: "room",
            capture: async () => { captures++; return captureFixture().lease; }
        });
        const watch = routeWatch(routing, { transport: "dass", share: { roomId: "room", shareId: "share" } });
        expect(publish.handled).toBe(true);
        expect(watch.handled).toBe(true);
        if (publish.handled) expect((await publish.completion).ok).toBe(false);
        if (watch.handled) expect((await watch.completion).ok).toBe(false);
        expect(captures).toBe(0);
    });
});

describe("publishing ownership", () => {
    test("prepares the DASS connection before invoking native capture", async () => {
        const order: string[] = [];
        const { routing, connection } = setup({ preparePublish: async () => { order.push("prepare"); return connection; } });
        const fixture = captureFixture();
        expect((await routing.publish("room", async () => { order.push("capture"); return fixture.lease; })).ok).toBe(true);
        expect(order).toEqual(["prepare", "capture"]);
        routing.stop();
    });

    test("authorization or E2EE failure never opens capture and hides raw errors", async () => {
        const { routing } = setup({ preparePublish: async () => { throw new Error("secret SDP credential"); } });
        let captures = 0;
        const result = await routing.publish("room", async () => { captures++; return captureFixture().lease; });
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain("secret");
        expect(captures).toBe(0);
        routing.stop();
    });

    test("rejects requests outside the current DASS room", async () => {
        const { routing } = setup();
        let captures = 0;
        expect((await routing.publish("other", async () => { captures++; return captureFixture().lease; })).ok).toBe(false);
        expect(captures).toBe(0);
        routing.stop();
    });

    test("unselected audio is stopped and removed before publishing", async () => {
        const { routing, published, closes } = setup();
        const fixture = captureFixture();
        await routing.publish("room", async () => fixture.lease);
        expect(published[0].getAudioTracks()).toHaveLength(0);
        expect(fixture.audio.stops).toBe(1);
        routing.stop();
        routing.stop();
        expect(fixture.video.stops).toBe(1);
        expect(fixture.releases()).toBe(1);
        expect(closes()).toBe(1);
    });

    test("explicit share audio is retained and source end tears everything down", async () => {
        const { routing, published, closes } = setup();
        const fixture = captureFixture(true);
        await routing.publish("room", async () => fixture.lease);
        expect(published[0].getAudioTracks()).toHaveLength(1);
        fixture.video.dispatchEvent(new Event("ended"));
        routing.stop();
        expect(fixture.audio.stops).toBe(1);
        expect(fixture.releases()).toBe(1);
        expect(closes()).toBe(1);
    });

    test("late preparation is closed without starting capture", async () => {
        const pending = deferred<PublishConnection>();
        const { routing, connection, closes } = setup({ preparePublish: () => pending.promise });
        let captures = 0;
        const result = routing.publish("room", async () => { captures++; return captureFixture().lease; });
        routing.stop();
        pending.resolve(connection);
        expect((await result).ok).toBe(false);
        expect(captures).toBe(0);
        expect(closes()).toBe(1);
    });

    test("late picker completion after context exit releases native capture", async () => {
        const pending = deferred<CaptureLease>();
        const captureStarted = deferred<void>();
        const { routing, published } = setup();
        const fixture = captureFixture(true);
        const result = routing.publish("room", () => { captureStarted.resolve(); return pending.promise; });
        await captureStarted.promise;
        routing.setRoom("other");
        pending.resolve(fixture.lease);
        expect((await result).ok).toBe(false);
        expect(published).toHaveLength(0);
        expect(fixture.video.stops).toBe(1);
        expect(fixture.audio.stops).toBe(1);
        expect(fixture.releases()).toBe(1);
        routing.stop();
    });

    test("capture cancellation closes the prepared connection", async () => {
        const { routing, closes } = setup();
        expect((await routing.publish("room", async () => { throw new Error("Picker cancelled."); })).ok).toBe(false);
        expect(closes()).toBe(1);
        routing.stop();
    });

    test("a new publisher replaces the old one, and reset stops the replacement", async () => {
        const { routing } = setup();
        const first = captureFixture();
        const second = captureFixture();
        await routing.publish("room", async () => first.lease);
        await routing.publish("room", async () => second.lease);
        expect(first.releases()).toBe(1);
        expect(second.releases()).toBe(0);
        routing.reset();
        expect(second.releases()).toBe(1);
        routing.stop();
    });

    test("publishing failure releases capture even if host cleanup throws", async () => {
        let closes = 0;
        const { routing } = setup({ preparePublish: async () => ({
            publish: async () => { throw new Error("Media setup failed."); },
            close: () => { closes++; }
        }) });
        const fixture = captureFixture(true);
        fixture.lease.release = () => { throw new Error("Host cleanup failed."); };
        expect((await routing.publish("room", async () => fixture.lease)).ok).toBe(false);
        expect(fixture.video.stops).toBe(1);
        expect(fixture.audio.stops).toBe(1);
        expect(closes).toBe(1);
        routing.stop();
    });
});

describe("watching and detection", () => {
    test("returns received media and independently closes it", async () => {
        const fixture = captureFixture(true);
        let closed = 0;
        const { routing } = setup({ subscribe: async () => ({ stream: fixture.lease.stream, close: () => { closed++; } }) });
        const result = await routing.watch({ roomId: "room", shareId: "share" });
        expect(result).toEqual({ ok: true, value: fixture.lease.stream });
        fixture.video.dispatchEvent(new Event("ended"));
        routing.stopWatching();
        routing.stop();
        expect(closed).toBe(1);
        expect(fixture.video.stops).toBe(1);
    });

    test("late subscription cannot revive a stopped session", async () => {
        const pending = deferred<Subscription>();
        const fixture = captureFixture();
        let closes = 0;
        const { routing } = setup({ subscribe: () => pending.promise });
        const result = routing.watch({ roomId: "room", shareId: "share" });
        routing.stop();
        pending.resolve({ stream: fixture.lease.stream, close: () => { closes++; } });
        expect((await result).ok).toBe(false);
        expect(closes).toBe(1);
        expect(fixture.video.stops).toBe(1);
    });

    test("detects DASS shares only through the transport directory", async () => {
        const { routing } = setup();
        expect(await routing.detect("room")).toEqual({ ok: true, value: [{ roomId: "room", shareId: "share" }] });
        expect((await routing.detect("other")).ok).toBe(false);
        routing.stop();
    });

    test("rejects excessive and cross-room directory results", async () => {
        for (const shares of [Array.from({ length: 65 }, () => ({ roomId: "room", shareId: "share" })), [{ roomId: "other", shareId: "share" }]]) {
            const { routing } = setup({ listShares: async () => shares });
            expect((await routing.detect("room")).ok).toBe(false);
            routing.stop();
        }
    });

    test("ignores late stream detection after leaving a room", async () => {
        const pending = deferred<readonly { roomId: string; shareId: string; }[]>();
        const { routing } = setup({ listShares: () => pending.promise });
        const result = routing.detect("room");
        routing.setRoom("other");
        pending.resolve([{ roomId: "room", shareId: "share" }]);
        expect((await result).ok).toBe(false);
        routing.stop();
    });
});
