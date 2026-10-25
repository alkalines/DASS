import { memoryIdentityStore } from "./helpers/e2eeStore";
import { expect, spyOn, test } from "bun:test";
import { type E2eeIdentity, generateEpochKey, generateIdentity, wrapEpochKey } from "../../clients/spike/e2ee";
import { SpikePeer } from "../../clients/spike/peer";
import { BrowserSocket, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";
import { RECONNECT_DELAYS_MS, WatchController, type WatchStatus } from "../../plugins/dass/watching";

class Socket extends EventTarget implements BrowserSocket {
    protocol = "dass.v1";
    readyState = 1;
    bufferedAmount = 0;
    operations: any[] = [];
    directoryReply?: () => void;
    deny = false;
    delay = false;
    close() { this.readyState = 3; }
    send(json: string) {
        const { request_id, operation } = JSON.parse(json);
        this.operations.push(operation);
        const reply = (response: unknown) => this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ protocol_version: 1, request_id, operation: response })
        }));
        if (operation.type === "login") queueMicrotask(() => reply({ type: "authenticated", expires_at_unix_seconds: Math.floor(Date.now() / 1000) + 60 }));
        else if (operation.type === "directory") {
            this.directoryReply = () => reply(this.deny ? { type: "rejected", code: "unauthorized" }
                : { type: "directory", room_id: operation.room_id, publisher_ids: ["real_source"],
                    publishers: [{ publisher_id: "real_source", display_name: "Workstation" }] });
            if (!this.delay) queueMicrotask(this.directoryReply);
        }
    }
}

function fixture(options: { publisher?: E2eeIdentity; epoch?: number; epochKey?: Uint8Array; pinnedKey?: string; } = {}) {
    let context: string | undefined = "discord_voice_context";
    const socket = new Socket();
    const closed = new AbortController();
    const identityStore = memoryIdentityStore();
    if (options.pinnedKey) void identityStore.writePeer("publisher/publisher_account", { key: options.pinnedKey, fingerprint: "fingerprint", verified: false });
    const track = new EventTarget() as MediaStreamTrack;
    Object.assign(track, { kind: "video", readyState: "live", stop: () => { Object.assign(track, { readyState: "ended" }); } });
    const stream = new EventTarget() as MediaStream;
    let tracks: MediaStreamTrack[] = [];
    Object.assign(stream, { getTracks: () => tracks, getVideoTracks: () => tracks });
    let prepares = 0;
    let activations = 0;
    let signaling: SpikeSignaling | undefined;
    let deliverVideo = true;
    let receivedEpoch: { epoch: number; keyBytes: Uint8Array; } | undefined;
    const close = () => { if (!closed.signal.aborted) { closed.abort(); tracks.forEach(track => track.stop()); signaling?.close(); } };
    const tracksChanged = new EventTarget();
    const peer = { receivedStream: stream, tracksChanged, closed: closed.signal, candidates: ["candidate:1 1 UDP 1 192.168.1.2 50000 typ host"],
        closeMessage: "Media disconnected.", close,
        setReceiveEpoch: (epoch: number, keyBytes: Uint8Array) => { receivedEpoch = { epoch, keyBytes }; },
        retireEpochsBelow: () => {},
        activate: async (activation: any) => {
            activations++;
            expect(activation.credential).toBe("");
            expect(activation.e2ee?.identityPublicKey).toBeTruthy();
            expect(activation.signaling).toBe(signaling);
            if (options.publisher) {
                // The publisher decision carries its identity and account; the
                // relayed epoch key follows immediately.
                const trusted = await activation.e2ee.trustPublisher(options.publisher.publicKey, {
                    type: "view_decision", session_id: "viewer_session", request_id: "pending_1", decision: "approve",
                    approval_id: "approval_1", publisher_key: options.publisher.publicKey, publisher_account: "publisher_account"
                });
                if (!trusted) throw new Error("DASS E2EE trust refused.");
                const blob = await wrapEpochKey(options.publisher, activation.e2ee.identityPublicKey, "stream/real_source",
                    options.epoch ?? 3, options.epochKey ?? generateEpochKey());
                activation.e2ee.onEpochBlob?.(blob);
            }
            if (deliverVideo) tracks = [track];
            return "viewer_session";
        } } as unknown as SpikePeer;
    const controller = new WatchController(() => context, {
        connect: async options => {
            signaling = await SpikeSignaling.connect({ ...options, createSocket: () => socket });
            return signaling;
        },
        prepare: async options => {
            prepares++;
            options.signal.addEventListener("abort", close, { once: true });
            return peer;
        },
        identityStore: async () => identityStore
    });
    controller.start();
    return { controller, socket, peer, stream, closed, prepares: () => prepares, activations: () => activations,
        receivedEpoch: () => receivedEpoch,
        exit: () => { context = undefined; controller.reset(); },
        loseContext: () => { context = undefined; },
        delayVideo: () => { deliverVideo = false; },
        deliver: () => { tracks = [track]; tracksChanged.dispatchEvent(new Event("change")); } };
}

test("directory binds an independently authorized room, never using Discord claims", async () => {
    const f = fixture();
    try {
        await f.controller.bind("https://dass.example", "authorized_room", "separate_secret");
        expect(f.socket.operations).toEqual([{ type: "login", credential: "separate_secret" }, { type: "directory", room_id: "authorized_room" }]);
        expect(f.controller.getSnapshot().shares).toEqual([{ roomId: "authorized_room", shareId: "real_source", displayName: "Workstation" }]);
        expect(f.controller.getSnapshot().phase).toBe("ready");
    } finally { f.controller.stop(); }
});

test("unauthorized discovery is explicit and exposes no shares", async () => {
    const f = fixture();
    f.socket.deny = true;
    try {
        await f.controller.bind("https://dass.example", "unauthorized_room", "separate_secret");
        expect(f.controller.getSnapshot().phase).toBe("unauthorized");
        expect(f.controller.getSnapshot().shares).toEqual([]);
        expect(f.socket.readyState).toBe(3);
    } finally { f.controller.stop(); }
});

for (const code of ["socket", "timeout", "expired", "server:left", "server:expired", "server:transport_failed"] as const) {
    test(`viewer ${code} is a disconnect, not a credential rejection`, async () => {
        const controller = new WatchController(() => "voice_context", {
            connect: async () => { throw new SpikeSignalingError(code); },
            prepare: async () => { throw new Error("Unexpected preparation"); },
            identityStore: async () => memoryIdentityStore()
        });
        controller.start();
        try {
            await controller.bind("https://dass.example", "room", "secret");
            expect(controller.getSnapshot().phase).toBe("disconnected");
            expect(controller.getSnapshot().message).toContain("credentials were kept");
            expect(controller.getSnapshot().shares).toEqual([]);
        } finally { controller.stop(); }
    });
}

test("late directory response cannot restore a room after context exit", async () => {
    const f = fixture();
    f.socket.delay = true;
    const binding = f.controller.bind("https://dass.example", "room", "secret");
    while (!f.socket.directoryReply) await Promise.resolve();
    f.exit();
    f.socket.directoryReply();
    await binding;
    expect(f.controller.getSnapshot().phase).toBe("disconnected");
    expect(f.controller.getSnapshot().shares).toEqual([]);
    f.controller.stop();
});

test("one prepared decoder survives initial authentication; watch consumes DASS and waits for real tracks", async () => {
    const f = fixture();
    try {
        await f.controller.prepareViewer();
        await f.controller.prepareViewer();
        expect(f.prepares()).toBe(1);
        await f.controller.bind("https://dass.example", "room", "secret");
        f.delayVideo();
        const watch = f.controller.watch({ roomId: "room", shareId: "real_source" });
        await Promise.resolve();
        expect(f.controller.getSnapshot().phase).toBe("loading");
        expect((await f.controller.watch({ roomId: "room", shareId: "real_source" })).ok).toBe(false);
        f.deliver();
        expect(await watch).toEqual({ ok: true, value: f.stream });
        expect(f.controller.getSnapshot().stream).toBe(f.stream);
        expect(f.controller.getSnapshot().watchingShare?.displayName).toBe("Workstation");
        expect(f.activations()).toBe(1);
        expect(f.socket.operations.some(operation => "discord_channel_id" in operation)).toBe(false);
        f.exit();
        expect(f.closed.signal.aborted).toBe(true);
        expect(f.controller.getSnapshot().stream).toBeUndefined();
        expect(f.stream.getTracks()[0].readyState).toBe("ended");
    } finally { f.controller.stop(); }
});

test("cross-room watches cannot activate the viewer", async () => {
    const f = fixture();
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        expect((await f.controller.watch({ roomId: "other_room", shareId: "source" })).ok).toBe(false);
        expect(f.activations()).toBe(0);
    } finally { f.controller.stop(); }
});

test("unexpected media closure retains only watched share metadata until explicit close", async () => {
    const f = fixture();
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        expect(f.controller.getSnapshot().directoryRoomId).toBe("room");
        await f.controller.watch({ roomId: "room", shareId: "real_source" });
        f.peer.close();
        const status = f.controller.getSnapshot();
        expect(status.phase).toBe("disconnected");
        expect(status.closedShare).toEqual({ roomId: "room", shareId: "real_source", displayName: "Workstation" });
        expect(status.stream).toBeUndefined();
        expect(status.watchingShare).toBeUndefined();
        expect(status.directoryRoomId).toBeUndefined();
        expect(status.shares).toEqual([]);
        expect(status.candidates).toEqual([]);
        expect(f.stream.getVideoTracks()[0].readyState).toBe("ended");
        f.controller.reset();
        expect(f.controller.getSnapshot().closedShare).toBeUndefined();
    } finally { f.controller.stop(); }
});

test("preparation failure and revoked access do not retain an ended-stream card", async () => {
    const preparing = fixture();
    try {
        await preparing.controller.prepareViewer();
        preparing.peer.close();
        expect(preparing.controller.getSnapshot().closedShare).toBeUndefined();
    } finally { preparing.controller.stop(); }
    const f = fixture();
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        await f.controller.watch({ roomId: "room", shareId: "real_source" });
        f.socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ protocol_version: 1, request_id: "server_close",
            operation: { type: "closed", session_id: "viewer_session", reason: "revoked" } }) }));
        expect(f.controller.getSnapshot().phase).toBe("unauthorized");
        expect(f.controller.getSnapshot().closedShare).toBeUndefined();
    } finally { f.controller.stop(); }
});

test("failed selected publisher setup retains only metadata for the error screen, never a normal ended screen", async () => {
    const f = fixture();
    try {
        const result = await f.controller.watchListedShare("https://dass.example", { roomId: "room", shareId: "missing_source" }, "secret");
        expect(result.ok).toBe(false);
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.controller.getSnapshot().failedShare).toEqual({ roomId: "room", shareId: "missing_source", displayName: undefined });
        expect(f.controller.getSnapshot().closedShare).toBeUndefined();
        expect(f.controller.getSnapshot().stream).toBeUndefined();
        expect(f.controller.getSnapshot().watchingShare).toBeUndefined();
        f.controller.reset();
        expect(f.controller.getSnapshot().failedShare).toBeUndefined();
    } finally { f.controller.stop(); }
});

test("unannounced context loss clears retained stream metadata after the normal context check", async () => {
    const f = fixture();
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        await f.controller.watch({ roomId: "room", shareId: "real_source" });
        f.peer.close();
        expect(f.controller.getSnapshot().closedShare).toBeDefined();
        f.loseContext();
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(f.controller.getSnapshot().closedShare).toBeUndefined();
    } finally { f.controller.stop(); }
});

test("automatic viewer setup binds once without repeating credentials", async () => {
    const f = fixture();
    try {
        await f.controller.prepareAndBind("https://dass.example", "room", "secret");
        expect(f.prepares()).toBe(1);
        expect(f.controller.getSnapshot().shares[0].displayName).toBe("Workstation");
        expect(f.socket.operations.filter(operation => operation.type === "login").length).toBe(1);
    } finally { f.controller.stop(); }
});

test("cancelled automatic preparation cannot bind an old credential later", async () => {
    const f = fixture();
    const preparing = f.controller.prepareAndBind("https://dass.example", "room", "secret");
    f.controller.reset();
    await preparing;
    expect(f.socket.operations.length).toBe(0);
    expect(f.controller.getSnapshot().shares).toEqual([]);
    f.controller.stop();
});

test("grid watch retains its pending tile while preparing and revalidates the selected publisher", async () => {
    const f = fixture();
    try {
        const pending = f.controller.watchListedShare("https://dass.example", { roomId: "room", shareId: "real_source" }, "secret");
        expect(f.controller.getSnapshot().watchingShare?.shareId).toBe("real_source");
        expect(await pending).toEqual({ ok: true, value: f.stream });
        expect(f.prepares()).toBe(1);
        expect(f.activations()).toBe(1);
        expect(f.controller.getSnapshot().watchingShare?.displayName).toBe("Workstation");
        expect(f.socket.operations.filter(operation => operation.type === "login")).toHaveLength(1);
    } finally { f.controller.stop(); }
});

test("grid watch cannot activate an absent publisher or an unauthorized directory", async () => {
    const missing = fixture();
    try {
        expect((await missing.controller.watchListedShare("https://dass.example", { roomId: "room", shareId: "removed_source" }, "secret")).ok).toBe(false);
        expect(missing.activations()).toBe(0);
        expect(missing.closed.signal.aborted).toBe(true);
        expect(missing.controller.getSnapshot().phase).toBe("failed");
        expect(missing.controller.getSnapshot().watchingShare).toBeUndefined();
    } finally { missing.controller.stop(); }
    const denied = fixture();
    denied.socket.deny = true;
    try {
        expect((await denied.controller.watchListedShare("https://dass.example", { roomId: "room", shareId: "real_source" }, "secret")).ok).toBe(false);
        expect(denied.activations()).toBe(0);
        expect(denied.closed.signal.aborted).toBe(true);
        expect(denied.controller.getSnapshot().phase).toBe("unauthorized");
    } finally { denied.controller.stop(); }
});

test("cancelled grid directory setup cannot restore a pending tile or activate media", async () => {
    const f = fixture();
    f.socket.delay = true;
    try {
        const pending = f.controller.watchListedShare("https://dass.example", { roomId: "room", shareId: "real_source" }, "secret");
        while (!f.socket.directoryReply) await Promise.resolve();
        f.controller.reset();
        f.socket.directoryReply();
        expect((await pending).ok).toBe(false);
        expect(f.activations()).toBe(0);
        expect(f.controller.getSnapshot().watchingShare).toBeUndefined();
        expect(f.controller.getSnapshot().stream).toBeUndefined();
        expect(f.controller.getSnapshot().phase).toBe("disconnected");
    } finally { f.controller.stop(); }
});

test("a relayed epoch key is applied after the publisher identity is pinned", async () => {
    const publisher = await generateIdentity();
    const epochKey = generateEpochKey();
    const f = fixture({ publisher, epoch: 4, epochKey });
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        await f.controller.watch({ roomId: "room", shareId: "real_source" });
        // The blob arrives right after the decision: the viewer must still
        // unwrap it, which only works once the identity pin exists.
        for (let attempt = 0; attempt < 50 && !f.receivedEpoch(); attempt++) await Bun.sleep(1);
        expect(f.receivedEpoch()).toEqual({ epoch: 4, keyBytes: epochKey });
        expect(f.controller.getSnapshot().publisherTrust).toContain("unverified");
    } finally { f.controller.stop(); }
});

test("a changed publisher identity fails closed until it is explicitly accepted", async () => {
    const publisher = await generateIdentity();
    const previous = await generateIdentity();
    const f = fixture({ publisher, pinnedKey: previous.publicKey });
    try {
        await f.controller.prepareViewer();
        await f.controller.bind("https://dass.example", "room", "secret");
        const result = await f.controller.watch({ roomId: "room", shareId: "real_source" });
        expect(result.ok).toBe(false);
        expect(f.controller.getSnapshot().publisherIdentityChanged).toBe(true);
        expect(f.receivedEpoch()).toBeUndefined();
        // Accepting the presented identity clears the change for the next try.
        await f.controller.acceptPublisherIdentity();
        expect(f.controller.getSnapshot().publisherIdentityChanged).toBe(false);
    } finally { f.controller.stop(); }
});

/** Fresh fake peer per preparation, so a retry gets new media like the real client. */
function reconnectFixture() {
    const sockets: Socket[] = [];
    const peers: Array<{ drop(code: string): void; }> = [];
    const controller = new WatchController(() => "voice_context", {
        connect: async options => {
            const socket = new Socket();
            sockets.push(socket);
            return SpikeSignaling.connect({ ...options, createSocket: () => socket });
        },
        prepare: async options => {
            const closed = new AbortController();
            const track = new EventTarget() as MediaStreamTrack;
            Object.assign(track, { kind: "video", readyState: "live", stop: () => { Object.assign(track, { readyState: "ended" }); } });
            let tracks: MediaStreamTrack[] = [];
            const stream = new EventTarget() as MediaStream;
            Object.assign(stream, { getTracks: () => tracks, getVideoTracks: () => tracks });
            const peer = { receivedStream: stream, tracksChanged: new EventTarget(), closed: closed.signal, closeMessage: "Media stopped.", closeCode: "closed",
                candidates: ["candidate:1 1 UDP 1 192.168.1.2 50000 typ host"], setReceiveEpoch: () => {}, retireEpochsBelow: () => {},
                close: () => { if (!closed.signal.aborted) { closed.abort(); tracks.forEach(track => track.stop()); } },
                activate: async () => { tracks = [track]; return "viewer_session"; } };
            options.signal.addEventListener("abort", peer.close, { once: true });
            peers.push({ drop: code => { peer.closeCode = code; peer.close(); } });
            return peer as unknown as SpikePeer;
        },
        identityStore: async () => memoryIdentityStore()
    });
    controller.start();
    // Capture only the first reconnect backoff; every other timer runs normally.
    const backoffs: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;
    const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
        if (delay !== RECONNECT_DELAYS_MS[0]) return realSetTimeout(callback, delay);
        backoffs.push(callback);
        return backoffs.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    const share = { roomId: "room", shareId: "real_source", displayName: "Workstation" };
    const watch = () => controller.watchListedShare("https://dass.example", share, "secret");
    const watching = () => {
        const { promise, resolve } = Promise.withResolvers<WatchStatus>();
        const unsubscribe = controller.subscribeStatus(() => {
            if (controller.getSnapshot().phase !== "watching") return;
            unsubscribe();
            resolve(controller.getSnapshot());
        });
        return promise;
    };
    const stop = () => { controller.stop(); schedule.mockRestore(); };
    return { controller, sockets, peers, backoffs, watch, watching, stop };
}

test("a transient media drop re-watches the same share after a backoff", async () => {
    const f = reconnectFixture();
    try {
        expect((await f.watch()).ok).toBe(true);
        f.peers[0].drop("connection:failed");
        const reconnecting = f.controller.getSnapshot();
        expect(reconnecting.phase).toBe("loading");
        expect(reconnecting.watchingShare?.shareId).toBe("real_source");
        expect(reconnecting.closedShare).toBeUndefined();
        expect(reconnecting.message).toContain("[connection:failed]");
        expect(reconnecting.message).toContain("attempt 1 of 5");
        expect(f.backoffs).toHaveLength(1);
        const restored = f.watching();
        f.backoffs[0]();
        expect((await restored).stream).toBeDefined();
        expect(f.controller.getSnapshot().watchingShare?.shareId).toBe("real_source");
        expect(f.peers).toHaveLength(2);
        expect(f.sockets).toHaveLength(2);
    } finally { f.stop(); }
});

test("a stream that ended, or a viewer that stopped watching, is not reconnected", async () => {
    const ended = reconnectFixture();
    try {
        expect((await ended.watch()).ok).toBe(true);
        ended.sockets[0].dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ protocol_version: 1, request_id: "server_close",
            operation: { type: "closed", session_id: "viewer_session", reason: "left" } }) }));
        expect(ended.controller.getSnapshot().phase).toBe("disconnected");
        expect(ended.controller.getSnapshot().closedShare?.shareId).toBe("real_source");
        expect(ended.backoffs).toHaveLength(0);
    } finally { ended.stop(); }
    const stopped = reconnectFixture();
    try {
        expect((await stopped.watch()).ok).toBe(true);
        stopped.peers[0].drop("connection:failed");
        stopped.controller.reset();
        stopped.backoffs[0]();
        expect(stopped.peers).toHaveLength(1);
        expect(stopped.controller.getSnapshot().watchingShare).toBeUndefined();
    } finally { stopped.stop(); }
});
