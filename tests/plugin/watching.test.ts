import { expect, test } from "bun:test";
import { SpikePeer } from "../../clients/spike/peer";
import { BrowserSocket, SpikeSignaling } from "../../clients/spike/signaling";
import { WatchController } from "../../plugins/dass/watching";

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

function fixture() {
    let context: string | undefined = "discord_voice_context";
    const socket = new Socket();
    const closed = new AbortController();
    const track = new EventTarget() as MediaStreamTrack;
    Object.assign(track, { kind: "video", readyState: "live", stop: () => { Object.assign(track, { readyState: "ended" }); } });
    const stream = new EventTarget() as MediaStream;
    let tracks: MediaStreamTrack[] = [];
    Object.assign(stream, { getTracks: () => tracks, getVideoTracks: () => tracks });
    let prepares = 0;
    let activations = 0;
    let signaling: SpikeSignaling | undefined;
    let deliverVideo = true;
    const close = () => { if (!closed.signal.aborted) { closed.abort(); tracks.forEach(track => track.stop()); signaling?.close(); } };
    const tracksChanged = new EventTarget();
    const peer = { receivedStream: stream, tracksChanged, closed: closed.signal, candidates: ["candidate:1 1 UDP 1 192.168.1.2 50000 typ host"],
        closeMessage: "Media disconnected.", close,
        activate: async (options: any) => {
            activations++;
            expect(options.credential).toBe("");
            expect(options.signaling).toBe(signaling);
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
        }
    });
    controller.start();
    return { controller, socket, peer, stream, closed, prepares: () => prepares, activations: () => activations,
        exit: () => { context = undefined; controller.reset(); },
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
