import { expect, test } from "bun:test";
import { SpikePeer } from "../../clients/spike/peer";
import { SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";
import { CaptureLease } from "../../plugins/dass/routing";
import { PublishController } from "../../plugins/dass/publishing";
import { DassSession } from "../../plugins/dass/session";
import { createShareSelection } from "../../plugins/dass/discordAdapter";

function fixture() {
    const session = new DassSession();
    session.configure("authorized_room", "separate_secret");
    let context: string | undefined = "discord_context";
    const events: string[] = [];
    let releases = 0;
    let deny = false;
    let failure: SpikeSignalingError | undefined;
    const signalingClosed = new AbortController();
    const signaling = { closed: signalingClosed.signal, close: () => signalingClosed.abort() } as unknown as SpikeSignaling;
    const peerClosed = new AbortController();
    const peer = { closed: peerClosed.signal, candidates: ["candidate:1 1 UDP 1 192.168.1.2 50000 typ host"],
        closeMessage: "Source ended.", close: () => peerClosed.abort(), activate: async (options: any) => {
            events.push("activate");
            expect(options.roomId).toBe("authorized_room");
            expect(options.credential).toBe("separate_secret");
            return "publisher_session";
        } } as unknown as SpikePeer;
    const lease = { stream: {} as MediaStream, audioSelected: false, release: () => { releases++; } } as CaptureLease;
    const bridge = { version: 1 as const, capture: async () => { events.push("capture"); return lease; } };
    const controller = new PublishController(session, () => context, {
        connect: async options => {
            events.push("authenticate");
            expect(options.credential).toBe("separate_secret");
            if (deny) throw new SpikeSignalingError("rejected:unauthorized");
            if (failure) throw failure;
            return signaling;
        },
        prepare: async () => { events.push("prepare"); return peer; }
    });
    controller.start();
    return { session, controller, bridge, events, peer, lease, signalingClosed, releases: () => releases,
        deny: () => { deny = true; }, failConnection: (error: SpikeSignalingError) => { failure = error; }, exit: () => { context = undefined; controller.reset(); } };
}

test("session snapshots never contain credentials; setup is reused and can be forgotten", () => {
    const session = new DassSession();
    session.configure("room", "secret");
    expect(session.getSnapshot()).toMatchObject({ roomId: "room", configured: true });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("secret");
    expect(session.getAccess().credential).toBe("secret");
    session.clear();
    expect(session.getSnapshot().configured).toBe(false);
    expect(() => session.getAccess()).toThrow();
    expect(() => session.configure("discord/channel", "secret")).toThrow();
    expect(() => session.configure("room", "x".repeat(513))).toThrow();
});

test("normal sharing authenticates, uses the installed picker, then activates automatically", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.events).toEqual(["authenticate", "capture", "prepare", "activate"]);
        expect(f.controller.getSnapshot().phase).toBe("publishing");
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.events.length).toBe(4);
        f.exit();
        expect(f.peer.closed.aborted).toBe(true);
        expect(f.session.getSnapshot().configured).toBe(true);
    } finally { f.controller.stop(); }
});

test("denied login prevents capture and invalidates session credentials", async () => {
    const f = fixture();
    f.deny();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.events).toEqual(["authenticate"]);
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.session.getSnapshot().configured).toBe(false);
    } finally { f.controller.stop(); }
});

for (const code of ["socket", "timeout", "expired", "server:expired", "server:transport_failed"] as const) {
    test(`publisher ${code} retains credentials and does not request capture`, async () => {
        const f = fixture();
        f.failConnection(new SpikeSignalingError(code));
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            expect(f.events).toEqual(["authenticate"]);
            expect(f.controller.getSnapshot().phase).toBe("failed");
            expect(f.controller.getSnapshot().message).toContain("credentials were kept");
            expect(f.session.getAccess().credential).toBe("separate_secret");
        } finally { f.controller.stop(); }
    });

    test(`active publisher ${code} releases capture without invalidating credentials`, async () => {
        const f = fixture();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            f.signalingClosed.abort(new SpikeSignalingError(code));
            expect(f.controller.getSnapshot().phase).toBe("failed");
            expect(f.releases()).toBeGreaterThan(0);
            expect(f.session.getAccess().credential).toBe("separate_secret");
        } finally { f.controller.stop(); }
    });
}

test("capture error text cannot invalidate credentials", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", { version: 1, capture: async () => { throw new Error("unauthorized expired revoked"); } });
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.session.getSnapshot().configured).toBe(true);
    } finally { f.controller.stop(); }
});

test("late picker results are released after stop and cannot start media", async () => {
    const f = fixture();
    let complete: ((lease: CaptureLease) => void) | undefined;
    try {
        const publishing = f.controller.publish("https://dass.example", { version: 1, capture: () => new Promise(resolve => { complete = resolve; }) });
        while (!complete) await Promise.resolve();
        f.controller.reset();
        complete(f.lease);
        await publishing;
        expect(f.releases()).toBe(1);
        expect(f.events).toEqual(["authenticate"]);
        expect(f.controller.getSnapshot().phase).toBe("idle");
    } finally { f.controller.stop(); }
});

test("late authentication cannot reopen the picker after disable", async () => {
    const session = new DassSession();
    session.configure("room", "secret");
    const closed = new AbortController();
    const signaling = { closed: closed.signal, close: () => closed.abort() } as unknown as SpikeSignaling;
    let resolveLogin: ((value: SpikeSignaling) => void) | undefined;
    let captures = 0;
    const controller = new PublishController(session, () => "voice", {
        connect: () => new Promise(resolve => { resolveLogin = resolve; }),
        prepare: async () => { throw new Error("Preparation must not run"); }
    });
    controller.start();
    const publishing = controller.publish("https://dass.example", { version: 1, capture: async () => {
        captures++;
        throw new Error("Capture must not run");
    } });
    controller.stop();
    resolveLogin!(signaling);
    await publishing;
    expect(closed.signal.aborted).toBe(true);
    expect(captures).toBe(0);
    expect(controller.getSnapshot().phase).toBe("idle");
});

test("exact-endpoint preparation remains local until explicit activation", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", f.bridge, true);
        expect(f.events).toEqual(["capture", "prepare"]);
        expect(f.controller.getSnapshot().candidates).toEqual(["192.168.1.2:50000"]);
        await f.controller.activate("https://dass.example");
        expect(f.events).toEqual(["capture", "prepare", "authenticate", "activate"]);
    } finally { f.controller.stop(); }
});

test("signaling loss during capture cancels late tracks without activating", async () => {
    const f = fixture();
    let complete: ((lease: CaptureLease) => void) | undefined;
    try {
        const publishing = f.controller.publish("https://dass.example", { version: 1, capture: () => new Promise(resolve => { complete = resolve; }) });
        while (!complete) await Promise.resolve();
        f.signalingClosed.abort(new SpikeSignalingError("server:revoked"));
        complete(f.lease);
        await publishing;
        expect(f.releases()).toBe(1);
        expect(f.events).toEqual(["authenticate"]);
        expect(f.session.getSnapshot().configured).toBe(false);
        expect(f.controller.getSnapshot().phase).toBe("failed");
    } finally { f.controller.stop(); }
});

test("source end releases publishing without clearing reusable session setup", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.peer.close();
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.releases()).toBeGreaterThan(0);
        expect(f.session.getSnapshot().configured).toBe(true);
    } finally { f.controller.stop(); }
});

test("DASS selection consumes native callback even when publishing fails", () => {
    const abort = new AbortController();
    let native = 0;
    let dass = 0;
    const select = createShareSelection(abort.signal, () => true, () => native++, () => dass++);
    select("dass");
    select("discord");
    expect(dass).toBe(1);
    expect(native).toBe(0);
});
