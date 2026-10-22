/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { memoryIdentityStore } from "./helpers/e2eeStore";
import { expect, test } from "bun:test";

import { createCallDiscovery } from "../../plugins/dass/callDiscovery";
import { DassSession } from "../../plugins/dass/session";
import { WatchController } from "../../plugins/dass/watching";
import { PublishController } from "../../plugins/dass/publishing";
import { SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";
import { SpikePeer } from "../../clients/spike/peer";

for (const first of ["publish", "watch"] as const) {
    test(`account can ${first} first, then publish and watch with directory discovery still active`, async () => {
        const connections: AbortController[] = [];
        const session = new DassSession(undefined, async () => {
            const closed = new AbortController();
            connections.push(closed);
            expect(connections.filter(connection => !connection.signal.aborted).length).toBeLessThanOrEqual(3);
            return { closed: closed.signal, close: () => closed.abort(),
                request: async () => ({ type: "directory", room_id: "call_a", publishers: [{ publisher_id: "remote", display_name: "Friend" }] })
            } as unknown as SpikeSignaling;
        }, () => "call_a");
        const prepare: typeof SpikePeer.prepare = async options => {
            const closed = new AbortController();
            const track = Object.assign(new EventTarget(), { readyState: "live", stop: () => {} });
            options.signal.addEventListener("abort", () => closed.abort(), { once: true });
            return { closed: closed.signal, close: () => closed.abort(), candidates: [],
                activate: async () => options.capture ? "local" : "viewer",
                receivedStream: { getVideoTracks: () => [track], getTracks: () => [track] }, tracksChanged: new EventTarget()
            } as unknown as SpikePeer;
        };
        const dependencies = { connect: (options: Parameters<typeof SpikeSignaling.connect>[0]) => session.connect(options),
            prepare, identityStore: async () => memoryIdentityStore() };
        const directory = new WatchController(() => "call_a", dependencies);
        const watching = new WatchController(() => "call_a", dependencies);
        const publisher = new PublishController(session, () => "call_a", dependencies);
        const discovery = createCallDiscovery(session, directory, () => "https://dass.example");
        const publish = () => publisher.publish("https://dass.example", { version: 1,
            capture: async () => ({ stream: {} as MediaStream, audioSelected: false, release: () => {} }) });
        const watch = () => watching.watchListedShare("https://dass.example", { roomId: "call_a", shareId: "remote" }, session.getAccess());
        publisher.start();
        watching.start();
        discovery.start();
        try {
            await session.start("https://dass.example");
            await session.login({ backendUrl: "https://dass.example", username: "alice", password: "separate_password" }, false);
            for (let i = 0; i < 10; i++) await Promise.resolve();
            if (first === "publish") { await publish(); await watch(); }
            else { await watch(); await publish(); }
            discovery.sync();
            expect(publisher.getSnapshot().phase).toBe("publishing");
            expect(watching.getSnapshot().phase).toBe("watching");
            expect(directory.getSnapshot().phase).toBe("ready");
            expect(connections).toHaveLength(3);
            if (first === "publish") {
                publisher.reset();
                expect(watching.getSnapshot().phase).toBe("watching");
            } else {
                // The peer's stream ended, but this account still publishes.
                connections[1].abort(new SpikeSignalingError("server:left"));
                expect(watching.getSnapshot().phase).toBe("disconnected");
                expect(session.getSnapshot().configured).toBe(true);
                expect(publisher.getSnapshot().phase).toBe("publishing");
            }
            expect(directory.getSnapshot().phase).toBe("ready");
            session.clear();
            expect(connections.every(connection => connection.signal.aborted)).toBe(true);
        } finally { discovery.stop(); publisher.stop(); watching.stop(); session.stop(); }
    });
}

function fixture() {
    let roomId = "call_a";
    let backendUrl = "https://dass.example";
    let configured = false;
    let mediaActive = false;
    let phase: "idle" | "ready" | "failed" = "idle";
    const listeners = new Set<() => void>();
    const bindings: Array<{ backendUrl: string; roomId: string; }> = [];
    let resets = 0;
    let starts = 0;
    let stops = 0;
    const session = {
        getSnapshot: () => ({ roomId, username: "separate_account", configured, phase, message: "" }),
        getAccess: () => ({ roomId, username: "separate_account", password: "separate_password" }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
    };
    const directory = {
        start: () => { starts++; }, stop: () => { stops++; }, reset: () => { resets++; },
        bind: async (backendUrl: string, roomId: string, authentication: unknown) => {
            expect(authentication).toEqual({ roomId, username: "separate_account", password: "separate_password" });
            bindings.push({ backendUrl, roomId });
        }
    };
    const discovery = createCallDiscovery(session, directory, () => backendUrl, () => mediaActive);
    return {
        discovery, bindings, resets: () => resets, starts: () => starts, stops: () => stops, listeners,
        login() { configured = true; phase = "ready"; for (const listener of listeners) listener(); },
        logout() { configured = false; phase = "idle"; for (const listener of listeners) listener(); },
        fail() { configured = true; phase = "failed"; for (const listener of listeners) listener(); },
        media(active: boolean) { mediaActive = active; discovery.sync(); },
        selectCall(next: string) { roomId = next; discovery.sync(); },
        changeBackend() { backendUrl = "https://other.example"; discovery.sync(); }
    };
}

test("call discovery authenticates only after login and never prepares capture or a decoder", () => {
    const f = fixture();
    f.discovery.start();
    f.discovery.start();
    expect(f.starts()).toBe(1);
    expect(f.bindings).toEqual([]);
    f.login();
    f.discovery.sync();
    f.login();
    expect(f.bindings).toEqual([{ backendUrl: "https://dass.example", roomId: "call_a" }]);
    expect(f.resets()).toBe(1);
    f.discovery.stop();
});

test("call changes, exit, logout and backend changes clear the old directory", () => {
    const f = fixture();
    f.discovery.start();
    f.login();
    f.selectCall("call_b");
    f.changeBackend();
    f.selectCall("");
    expect(f.bindings.map(binding => binding.roomId)).toEqual(["call_a", "call_b", "call_b"]);
    expect(f.resets()).toBe(4);
    f.selectCall("call_c");
    f.logout();
    expect(f.resets()).toBe(6);
    f.discovery.stop();
    expect(f.listeners.size).toBe(0);
    f.login();
    f.selectCall("call_d");
    expect(f.bindings).toHaveLength(4);
});

test("failed login is not authentication and retries are explicit, not an automatic loop", () => {
    const f = fixture();
    f.discovery.start();
    f.fail();
    expect(f.bindings).toEqual([]);
    f.login();
    for (let i = 0; i < 10; i++) f.discovery.sync();
    expect(f.bindings).toHaveLength(1);
    f.discovery.retry();
    expect(f.bindings).toHaveLength(2);
    f.discovery.stop();
    f.discovery.retry();
    expect(f.bindings).toHaveLength(2);
    f.discovery.start();
    expect(f.bindings).toHaveLength(3);
    f.discovery.stop();
});

test("directory relinquishes the account while media owns signaling, then resumes", () => {
    const f = fixture();
    f.discovery.start();
    f.login();
    expect(f.bindings).toHaveLength(1);
    f.media(true);
    expect(f.resets()).toBe(2);
    f.discovery.retry();
    f.login();
    f.selectCall("call_b");
    expect(f.bindings).toHaveLength(1);
    f.media(false);
    expect(f.bindings).toHaveLength(2);
    expect(f.bindings[1].roomId).toBe("call_b");
    f.discovery.stop();
    f.media(false);
    expect(f.bindings).toHaveLength(2);
});

test("directory and publisher share an exclusive backend account without parallel logins", async () => {
    let held = false;
    let authentications = 0;
    let closes = 0;
    const session = new DassSession(undefined, async () => {
        authentications++;
        if (held) throw new SpikeSignalingError("rejected:replay");
        held = true;
        const closed = new AbortController();
        return { closed: closed.signal,
            request: async () => ({ type: "directory", room_id: "call_a", publishers: [] }),
            close: () => { if (!closed.signal.aborted) { held = false; closes++; closed.abort(new SpikeSignalingError("closed")); } }
        } as unknown as SpikeSignaling;
    }, () => "call_a");
    const directory = new WatchController(() => "call_a", { connect: options => session.connect(options), prepare: SpikePeer.prepare, identityStore: async () => memoryIdentityStore() });
    const publisher = new PublishController(session, () => "call_a", {
        connect: options => session.connect(options),
        prepare: async () => {
            const closed = new AbortController();
            return { closed: closed.signal, close: () => closed.abort(), candidates: [], activate: async () => "publisher" } as unknown as SpikePeer;
        },
        identityStore: async () => memoryIdentityStore()
    });
    const discovery = createCallDiscovery(session, directory, () => "https://dass.example", () => !["idle", "failed"].includes(publisher.getSnapshot().phase));
    const unsubscribe = publisher.subscribe(() => {
        if (!["idle", "failed"].includes(publisher.getSnapshot().phase)) discovery.sync();
        else queueMicrotask(() => discovery.sync());
    });
    publisher.start();
    discovery.start();
    try {
        await session.start("https://dass.example");
        await session.login({ backendUrl: "https://dass.example", username: "alice", password: "separate_password" }, false);
        // Let the automatically bound directory finish its first response.
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(directory.getSnapshot().phase).toBe("ready");
        expect(authentications).toBe(1);
        await publisher.publish("https://dass.example", { version: 1, capture: async () => ({ stream: {} as MediaStream, audioSelected: false, release: () => {} }) });
        expect(closes).toBe(1);
        expect(authentications).toBe(2);
        expect(publisher.getSnapshot().phase).toBe("publishing");
        expect(directory.getSnapshot().phase).toBe("disconnected");
        publisher.reset();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(directory.getSnapshot().phase).toBe("ready");
        expect(authentications).toBe(3);
        expect(session.getSnapshot().configured).toBe(true);
    } finally { unsubscribe(); discovery.stop(); publisher.stop(); session.stop(); }
});
