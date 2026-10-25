import { expect, test } from "bun:test";
import { SpikePeer } from "../../clients/spike/peer";
import { SpikeSignaling, SpikeSignalingError, type ViewerPresence } from "../../clients/spike/signaling";
import { CaptureLease } from "../../plugins/dass/routing";
import { hasAcceptedPublishCapture, PublishController } from "../../plugins/dass/publishing";
import { DassSession } from "../../plugins/dass/session";
import { createShareSelection } from "../../plugins/dass/discordAdapter";
import { memoryIdentityStore } from "./helpers/e2eeStore";
import { generateIdentity, MediaFrameCipher, unwrapEpochKey, wrapEpochKey } from "../../clients/spike/e2ee";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture(options: { requireVerifiedViewers?: boolean; autoApproveViewers?: boolean; wrapEpochKey?: typeof wrapEpochKey; } = {}) {
    const session = new DassSession();
    session.configure("authorized_room", "separate_secret");
    let context: string | undefined = "discord_context";
    const events: string[] = [];
    let releases = 0;
    let deny = false;
    let failure: SpikeSignalingError | undefined;
    let presenceListener: ((presence: ViewerPresence) => void) | undefined;
    let viewRequestListener: ((request: { request_id: string; viewer_id: string; viewer_display_name: string; viewer_key: string; }) => void) | undefined;
    const requestClosedListeners = new Map<string, () => void>();
    let publisherPublicKey = "";
    let decisionGate: Promise<void> | undefined;
    let releaseDecision: (() => void) | undefined;
    let rejectRemoval = false;
    const decisions: Array<{ requestId: string; decision: string; }> = [];
    const keyRelays: Array<{ viewerId: string; blob: string; }> = [];
    const removals: string[] = [];
    const signalingClosed = new AbortController();
    const signaling = { closed: signalingClosed.signal, close: () => signalingClosed.abort(),
        onViewRequests: (_session: string, listener: typeof viewRequestListener) => { viewRequestListener = listener; },
        onViewRequestClosed: (_session: string, requestId: string, listener: () => void) => { requestClosedListeners.set(requestId, listener); },
        decideView: async (_session: string, requestId: string, decision: string) => { decisions.push({ requestId, decision }); await decisionGate; },
        removeViewer: async (_session: string, viewerId: string) => { removals.push(viewerId); if (rejectRemoval) throw new Error("remove failed"); },
        keyRelay: async (_session: string, viewerId: string, blob: string) => { keyRelays.push({ viewerId, blob }); }
    } as unknown as SpikeSignaling;
    const peerClosed = new AbortController();
    const sendEpochs: number[] = [];
    const peer = { closed: peerClosed.signal, candidates: ["candidate:1 1 UDP 1 192.168.1.2 50000 typ host"],
        closeMessage: "Source ended.", close: () => peerClosed.abort(),
        setSendEpoch: (epoch: number) => { sendEpochs.push(epoch); }, retireEpochsBelow: () => {},
        activate: async (options: any) => {
             events.push("activate");
              publisherPublicKey = options.e2ee.identityPublicKey;
             presenceListener = options.onViewerPresence;
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
            return signalingClosed.signal.aborted ? { ...signaling, closed: new AbortController().signal } : signaling;
        },
        prepare: async () => { events.push("prepare"); return peerClosed.signal.aborted ? { ...peer, closed: new AbortController().signal } : peer; },
        identityStore: async () => memoryIdentityStore(),
        requireVerifiedViewers: () => options.requireVerifiedViewers ?? false,
        autoApproveViewers: () => options.autoApproveViewers ?? false,
        wrapEpochKey: options.wrapEpochKey,
    });
    controller.start();
    return { session, controller, bridge, events, peer, lease, signalingClosed, releases: () => releases,
        presence: (change: ViewerPresence["change"], viewerCount: number) => presenceListener?.({ type: "viewer_presence", session_id: "publisher_session", change, viewer_count: viewerCount }),
        request: (request: { request_id: string; viewer_id: string; viewer_display_name: string; viewer_key: string; }) => viewRequestListener?.(request),
        closeRequest: (requestId: string) => requestClosedListeners.get(requestId)?.(),
        decisions, removals, keyRelays, sendEpochs, publisherPublicKey: () => publisherPublicKey,
        holdDecision: () => { decisionGate = new Promise<void>(resolve => { releaseDecision = resolve; }); },
        releaseDecision: () => { decisionGate = undefined; releaseDecision?.(); releaseDecision = undefined; },
        failRemoval: () => { rejectRemoval = true; },
        deny: () => { deny = true; }, failConnection: (error: SpikeSignalingError) => { failure = error; }, exit: () => { context = undefined; controller.reset(); } };
}

test("Change Stream releases the old source before opening the picker; cancellation leaves sharing stopped", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        await f.controller.changeSource("https://dass.example", { version: 1, capture: async () => { throw new Error("Cancelled"); } });
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.controller.getPreviewStream()).toBeUndefined();
        expect(f.releases()).toBe(1);
        expect(f.peer.closed.aborted).toBe(true);
    } finally { f.controller.stop(); }
});

test("stop during Change Stream aborts the picker and releases late results without restarting", async () => {
    const f = fixture();
    let complete: ((lease: CaptureLease) => void) | undefined;
    let signal: AbortSignal | undefined;
    let releases = 0;
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        const changing = f.controller.changeSource("https://dass.example", { version: 1, capture: abort => {
            signal = abort;
            return new Promise(resolve => { complete = resolve; });
        } });
        for (let i = 0; i < 10 && !signal; i++) await Promise.resolve();
        expect(signal).toBeDefined();
        await f.controller.changeSource("https://dass.example", f.bridge);
        expect(f.events.filter(event => event === "capture")).toHaveLength(1);
        f.controller.reset();
        expect(signal?.aborted).toBe(true);
        complete?.({ stream: {} as MediaStream, audioSelected: true, release: () => { releases++; } });
        await changing;
        expect(releases).toBe(1);
        expect(f.controller.getSnapshot().phase).toBe("idle");
        expect(f.events.filter(event => event === "authenticate")).toHaveLength(2);
    } finally { f.controller.stop(); }
});

test("source changes reauthenticate before acquiring a replacement", async () => {
    const f = fixture();
    let releases = 0;
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.deny();
        await f.controller.changeSource("https://dass.example", { version: 1, capture: async () => ({
            stream: {} as MediaStream, audioSelected: true, release: () => { releases++; }
        }) });
        expect(f.releases()).toBe(1);
        expect(releases).toBe(0);
        expect(f.controller.getSnapshot().phase).toBe("failed");
    } finally { f.controller.stop(); }
});

for (const stopWhileReleasing of [false, true]) {
    test(`Change Stream waits for host audio cleanup${stopWhileReleasing ? " and cannot restart after stop" : " before restarting DASS"}`, async () => {
        const f = fixture();
        let finish: (() => void) | undefined;
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            f.lease.release = () => new Promise<void>(resolve => { finish = resolve; });
            const changing = f.controller.changeSource("https://dass.example", f.bridge);
            expect(f.events.filter(event => event === "capture")).toHaveLength(1);
            if (stopWhileReleasing) f.controller.stop();
            finish?.();
            await changing;
            expect(f.events.filter(event => event === "capture")).toHaveLength(stopWhileReleasing ? 1 : 2);
            expect(f.controller.getSnapshot().phase).toBe(stopWhileReleasing ? "idle" : "publishing");
        } finally { f.controller.stop(); }
    });
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
        expect(f.controller.getPreviewStream()).toBeUndefined();
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.events).toEqual(["authenticate", "capture", "prepare", "activate"]);
        expect(f.controller.getSnapshot().phase).toBe("publishing");
        expect(f.controller.getPreviewStream()).toBe(f.lease.stream);
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.events.length).toBe(4);
        f.exit();
        expect(f.controller.getPreviewStream()).toBeUndefined();
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

test("publisher receives viewer presence only for its current publishing operation", async () => {
    const f = fixture();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.presence("joined", 1);
        expect(f.controller.getSnapshot().viewerCount).toBe(1);
        f.presence("left", 0);
        expect(f.controller.getSnapshot().viewerCount).toBe(0);
        f.exit();
        f.presence("joined", 1);
        expect(f.controller.getSnapshot().phase).toBe("idle");
        expect(f.controller.getSnapshot().viewerCount).toBeUndefined();
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

test("Stop Streaming state starts only after the complete picker returns capture", async () => {
    const f = fixture();
    let complete: ((lease: CaptureLease) => void) | undefined;
    const phases: Array<{ phase: string; streaming: boolean; }> = [];
    const unsubscribe = f.controller.subscribe(() => {
        const { phase } = f.controller.getSnapshot();
        phases.push({ phase, streaming: hasAcceptedPublishCapture(phase) });
    });
    try {
        const publishing = f.controller.publish("https://dass.example", { version: 1, capture: () => new Promise(resolve => { complete = resolve; }) });
        while (!complete) await Promise.resolve();
        // OS source selection and then quality/audio selection are one pending
        // host capture request; neither consent step alone is an owned lease.
        expect(phases).toEqual([{ phase: "authenticating", streaming: false }, { phase: "capturing", streaming: false }]);
        expect(f.controller.getPreviewStream()).toBeUndefined();
        complete(f.lease);
        await publishing;
        expect(phases.slice(2)).toEqual(["preparing", "prepared", "activating", "publishing"].map(phase => ({ phase, streaming: true })));
        f.controller.reset();
        expect(phases.at(-1)).toEqual({ phase: "idle", streaming: false });
        expect(hasAcceptedPublishCapture("failed")).toBe(false);
    } finally { unsubscribe(); f.controller.stop(); }
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
        prepare: async () => { throw new Error("Preparation must not run"); },
        identityStore: async () => memoryIdentityStore()
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
        expect(f.session.getSnapshot().configured).toBe(true);
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

test("publisher sees pending view requests and decides them manually", async () => {    const f = fixture();
    const alice = await generateIdentity();
    const otherDevice = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        expect(f.controller.getSnapshot().phase).toBe("publishing");
        expect(f.sendEpochs).toEqual([]);
        f.request({ request_id: "req_1", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        // Trust evaluation is async; flush microtasks before asserting.
        await Promise.resolve();
        await Promise.resolve();
        const pending = f.controller.getSnapshot().pendingViewers;
        expect(pending.map(viewer => ({ requestId: viewer.requestId, viewerId: viewer.viewerId, displayName: viewer.displayName }))).toEqual([
            { requestId: "req_1", viewerId: "alice", displayName: "Alice" }
        ]);
        expect(pending[0].trust.kind).toBe("first-contact");
        // A backend event reusing the request ID with a different device key
        // cannot mutate the key that the publisher is reviewing.
        f.request({ request_id: "req_1", viewer_id: "mallory", viewer_display_name: "Mallory", viewer_key: "bWFsbG9yeS1rZXk" });
        await Promise.resolve();
        await Promise.resolve();
        expect(f.controller.getSnapshot().pendingViewers[0]).toMatchObject({ requestId: "req_1", viewerId: "alice" });
        await f.controller.decideView("req_1", "approve");
        expect(f.decisions).toEqual([{ requestId: "req_1", decision: "approve" }]);
        expect(f.controller.getSnapshot().pendingViewers).toEqual([]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
        f.request({ request_id: "req_2", viewer_id: "alice", viewer_display_name: "Alice's other device", viewer_key: otherDevice.publicKey });
        await Promise.resolve();
        await Promise.resolve();
        await f.controller.decideView("req_2", "approve");
        expect(f.decisions).toEqual([{ requestId: "req_1", decision: "approve" }]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
        await f.controller.removeViewer("alice");
        expect(f.removals).toEqual(["alice"]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([]);
    } finally { f.controller.stop(); }
});

test("a publisher that requires verified identities refuses an unverified viewer", async () => {
    const f = fixture({ requireVerifiedViewers: true });
    const device = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "req_1", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: device.publicKey });
        await Promise.resolve();
        await Promise.resolve();
        await f.controller.decideView("req_1", "approve");
        expect(f.decisions).toEqual([]);
        expect(f.controller.getSnapshot().message).toContain("not independently verified");
        // A verified viewer is admitted.
        await f.controller.verifyViewerIdentity("req_1");
        await f.controller.decideView("req_1", "approve");
        expect(f.decisions).toEqual([{ requestId: "req_1", decision: "approve" }]);
    } finally { f.controller.stop(); }
});

for (const autoApproveViewers of [false, true]) {
    test(`same-device rejoining works repeatedly with automatic approval ${autoApproveViewers}`, async () => {
        const f = fixture({ autoApproveViewers });
        const alice = await generateIdentity();
        try {
            await f.controller.publish("https://dass.example", f.bridge);
            for (let attempt = 0; attempt < 3; attempt++) {
                const requestId = `rejoin_${attempt}`;
                f.request({ request_id: requestId, viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
                await Promise.resolve(); await Promise.resolve();
                await f.controller.decideView(requestId, "approve");
                expect(f.decisions).toHaveLength(attempt + 1);
                expect(f.controller.getSnapshot().pendingViewers).toEqual([]);
                expect(f.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
                expect(f.sendEpochs).toEqual(Array.from({ length: attempt + 1 }, (_, index) => index + 1));
                expect(f.keyRelays).toHaveLength(attempt + 1);
            }
        } finally { f.controller.stop(); }
    });
}

test("an approved device that reconnects is re-admitted without a prompt until it is removed", async () => {
    const f = fixture();
    const alice = await generateIdentity();
    const otherDevice = await generateIdentity();
    const settle = async (decisions: number) => { for (let i = 0; i < 50 && f.decisions.length < decisions; i++) await Promise.resolve(); };
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "first", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("first", "approve");
        f.request({ request_id: "reconnect", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await settle(2);
        expect(f.decisions).toEqual([{ requestId: "first", decision: "approve" }, { requestId: "reconnect", decision: "approve" }]);
        f.request({ request_id: "other_device", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: otherDevice.publicKey });
        await settle(3);
        expect(f.decisions).toHaveLength(2);
        await f.controller.removeViewer("alice");
        f.request({ request_id: "after_removal", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await settle(3);
        expect(f.decisions).toHaveLength(2);
        expect(f.controller.getSnapshot().pendingViewers.map(viewer => viewer.requestId)).toContain("after_removal");
    } finally { f.controller.stop(); }
});

test("repeated denials do not prevent a later same-device approval", async () => {
    const f = fixture();
    const alice = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        for (let attempt = 0; attempt < 3; attempt++) {
            const requestId = `retry_${attempt}`;
            f.request({ request_id: requestId, viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
            await Promise.resolve(); await Promise.resolve();
            await f.controller.decideView(requestId, attempt < 2 ? "deny" : "approve");
            expect(f.controller.getSnapshot().pendingViewers).toEqual([]);
        }
        expect(f.decisions.map(item => item.decision)).toEqual(["deny", "deny", "approve"]);
        expect(f.keyRelays).toHaveLength(1);
    } finally { f.controller.stop(); }
});

test("automatic approval retains pins after removal and requires explicit changed-key review", async () => {
    const f = fixture({ autoApproveViewers: true });
    const alice = await generateIdentity();
    const replacement = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "original", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("barrier", "deny");
        await f.controller.removeViewer("alice");
        f.request({ request_id: "replacement", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: replacement.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("replacement", "approve");
        expect(f.decisions).toHaveLength(1);
        expect(f.controller.getSnapshot().pendingViewers[0].trust.kind).toBe("changed");
        await f.controller.acceptViewerIdentity("replacement");
        expect(f.decisions).toHaveLength(2);
        expect(f.controller.getSnapshot().pendingViewers).toEqual([]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
    } finally { f.controller.stop(); }
});

test("automatic approval admits new viewers but pauses on changed identities and the verified-only policy", async () => {
    // Trust evaluation settles in microtasks; a no-op decision then waits for the
    // serialized membership queue, including epoch delivery and pin persistence.
    const settle = async (controller: PublishController) => {
        await Promise.resolve();
        await Promise.resolve();
        await controller.decideView("barrier", "deny");
    };
    const auto = fixture({ autoApproveViewers: true });
    const alice = await generateIdentity();
    const impostor = await generateIdentity();
    try {
        await auto.controller.publish("https://dass.example", auto.bridge);
        auto.request({ request_id: "first", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await settle(auto.controller);
        expect(auto.decisions).toEqual([{ requestId: "first", decision: "approve" }]);
        expect(auto.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
        auto.request({ request_id: "changed", viewer_id: "alice", viewer_display_name: "Alice?", viewer_key: impostor.publicKey });
        await settle(auto.controller);
        expect(auto.decisions).toEqual([{ requestId: "first", decision: "approve" }]);
        expect(auto.controller.getSnapshot().pendingViewers.map(viewer => viewer.trust.kind)).toEqual(["changed"]);
    } finally { auto.controller.stop(); }

    const verifiedOnly = fixture({ autoApproveViewers: true, requireVerifiedViewers: true });
    try {
        await verifiedOnly.controller.publish("https://dass.example", verifiedOnly.bridge);
        verifiedOnly.request({ request_id: "unverified", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await settle(verifiedOnly.controller);
        expect(verifiedOnly.decisions).toEqual([]);
        expect(verifiedOnly.controller.getSnapshot().pendingViewers).toHaveLength(1);
    } finally { verifiedOnly.controller.stop(); }
});

test("overlapping same-account approvals serialize and relay only the exact approved device key", async () => {
    const f = fixture();
    const firstDevice = await generateIdentity();
    const secondDevice = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "device_1", viewer_id: "alice", viewer_display_name: "Alice device 1", viewer_key: firstDevice.publicKey });
        f.request({ request_id: "device_2", viewer_id: "alice", viewer_display_name: "Alice device 2", viewer_key: secondDevice.publicKey });
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        f.holdDecision();
        const first = f.controller.decideView("device_1", "approve");
        const second = f.controller.decideView("device_2", "approve");
        while (f.decisions.length === 0) await Promise.resolve();
        expect(f.decisions).toEqual([{ requestId: "device_1", decision: "approve" }]);
        f.releaseDecision();
        await Promise.all([first, second]);
        expect(f.decisions).toEqual([{ requestId: "device_1", decision: "approve" }]);
        expect(f.keyRelays).toHaveLength(1);
        const { epoch, keyBytes } = await unwrapEpochKey(firstDevice, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[0].blob);
        expect(epoch).toBe(1);
        expect(keyBytes).toHaveLength(32);
        await expect(unwrapEpochKey(secondDevice, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[0].blob)).rejects.toThrow();
    } finally { f.controller.stop(); }
});

test("newly approved identity cannot decrypt recorded prior ciphertext while existing member gets fresh epoch", async () => {
    const f = fixture();
    const first = await generateIdentity();
    const newcomer = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "first", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: first.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("first", "approve");
        const oldEpoch = await unwrapEpochKey(first, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[0].blob);
        const oldCiphertext = await (await MediaFrameCipher.create(oldEpoch.keyBytes)).encrypt(1, 0n, new TextEncoder().encode("captured before admission").buffer);

        f.request({ request_id: "newcomer", viewer_id: "bob", viewer_display_name: "Bob", viewer_key: newcomer.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("newcomer", "approve");
        const newcomerRelay = f.keyRelays.find(relay => relay.viewerId === "bob")!;
        const currentFirstRelay = [...f.keyRelays].reverse().find(relay => relay.viewerId === "alice")!;
        const newcomerEpoch = await unwrapEpochKey(newcomer, f.publisherPublicKey(), "stream/publisher_session", newcomerRelay.blob);
        const currentFirstEpoch = await unwrapEpochKey(first, f.publisherPublicKey(), "stream/publisher_session", currentFirstRelay.blob);
        expect(newcomerEpoch.epoch).toBe(2);
        expect(currentFirstEpoch.epoch).toBe(2);
        await expect((await MediaFrameCipher.create(newcomerEpoch.keyBytes)).decrypt(oldCiphertext)).rejects.toThrow();
    } finally { f.controller.stop(); }
});

test("three approved viewers receive one shared epoch and removal rekeys only the remaining members", async () => {
    const f = fixture();
    const viewers = await Promise.all(["alice", "bob", "charlie"].map(async viewerId => ({ viewerId, identity: await generateIdentity() })));
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        for (const viewer of viewers) {
            f.request({ request_id: viewer.viewerId, viewer_id: viewer.viewerId, viewer_display_name: viewer.viewerId, viewer_key: viewer.identity.publicKey });
            await Promise.resolve(); await Promise.resolve();
            await f.controller.decideView(viewer.viewerId, "approve");
        }
        expect(f.controller.getSnapshot().approvedViewers).toHaveLength(3);
        const epochs = await Promise.all(viewers.map(viewer => {
            const relay = f.keyRelays.findLast(relay => relay.viewerId === viewer.viewerId)!;
            return unwrapEpochKey(viewer.identity, f.publisherPublicKey(), "stream/publisher_session", relay.blob);
        }));
        expect(epochs.map(epoch => epoch.epoch)).toEqual([3, 3, 3]);
        expect(epochs[0].keyBytes).toEqual(epochs[1].keyBytes);
        expect(epochs[1].keyBytes).toEqual(epochs[2].keyBytes);
        const beforeRemoval = f.keyRelays.length;
        await f.controller.removeViewer("bob");
        const relays = f.keyRelays.slice(beforeRemoval);
        expect(relays.map(relay => relay.viewerId).sort()).toEqual(["alice", "charlie"]);
        for (const viewer of [viewers[0], viewers[2]]) {
            const epoch = await unwrapEpochKey(viewer.identity, f.publisherPublicKey(), "stream/publisher_session", relays.find(relay => relay.viewerId === viewer.viewerId)!.blob);
            expect(epoch.epoch).toBe(4);
            expect(epoch.keyBytes).not.toEqual(epochs[0].keyBytes);
        }
    } finally { f.controller.stop(); }
});

test("deferred stale membership wrap cannot relay or roll send epoch back after removal", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const f = fixture({ wrapEpochKey: async (...args) => {
        if (args[3] === 2) { entered.resolve(); await release.promise; }
        return wrapEpochKey(...args);
    } });
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "alice", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: alice.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("alice", "approve");

        f.request({ request_id: "bob", viewer_id: "bob", viewer_display_name: "Bob", viewer_key: bob.publicKey });
        await Promise.resolve(); await Promise.resolve();
        const approving = f.controller.decideView("bob", "approve");
        await entered.promise;
        const removing = f.controller.removeViewer("bob");
        release.resolve();
        await Promise.all([approving, removing]);

        expect(f.keyRelays.map(relay => relay.viewerId)).toEqual(["alice", "alice"]);
        expect(f.sendEpochs).toEqual([1, 2]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([{ viewerId: "alice" }]);
        const fresh = await unwrapEpochKey(alice, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[1].blob);
        expect(fresh.epoch).toBe(2);
    } finally { release.resolve(); f.controller.stop(); }
});

test("failed fresh epoch wrapping stops publishing without distributing an old key", async () => {
    const f = fixture({ wrapEpochKey: async () => { throw new Error("wrap failed"); } });
    const viewer = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "broken_wrap", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: viewer.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.decideView("broken_wrap", "approve");
        expect(f.keyRelays).toEqual([]);
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.peer.closed.aborted).toBe(true);
    } finally { f.controller.stop(); }
});

test("withdrawal invalidates an approval awaiting its backend response before any key relay", async () => {
    const f = fixture();
    const device = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "withdraw_race", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: device.publicKey });
        await Promise.resolve(); await Promise.resolve();
        f.holdDecision();
        const approving = f.controller.decideView("withdraw_race", "approve");
        while (f.decisions.length === 0) await Promise.resolve();
        const removing = f.controller.removeViewer("alice");
        f.releaseDecision();
        await Promise.all([approving, removing]);
        expect(f.keyRelays).toEqual([]);
        expect(f.removals).toEqual(["alice"]);
        expect(f.controller.getSnapshot().approvedViewers).toEqual([]);
    } finally { f.controller.stop(); }
});

test("closed requests are removed and cannot be approved later", async () => {
    const f = fixture();
    const device = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "expired_request", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: device.publicKey });
        await Promise.resolve(); await Promise.resolve();
        f.closeRequest("expired_request");
        await f.controller.decideView("expired_request", "approve");
        expect(f.decisions).toEqual([]);
        expect(f.keyRelays).toEqual([]);
        expect(f.controller.getSnapshot().pendingViewers).toEqual([]);
    } finally { f.controller.stop(); }
});

test("unconfirmed viewer removal stops publishing fail-closed", async () => {
    const f = fixture();
    const device = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "remove_fail", viewer_id: "alice", viewer_display_name: "Alice", viewer_key: device.publicKey });
        await Promise.resolve(); await Promise.resolve(); await f.controller.decideView("remove_fail", "approve");
        f.failRemoval();
        await f.controller.removeViewer("alice");
        expect(f.controller.getSnapshot().phase).toBe("failed");
        expect(f.controller.getSnapshot().message).toContain("stopped fail-closed");
        expect(f.peer.closed.aborted).toBe(true);
    } finally { f.controller.stop(); }
});

test("remove and re-approve of an account binds the new epoch blob to the new device identity", async () => {
    const f = fixture();
    const oldDevice = await generateIdentity();
    const newDevice = await generateIdentity();
    try {
        await f.controller.publish("https://dass.example", f.bridge);
        f.request({ request_id: "old_device", viewer_id: "alice", viewer_display_name: "Alice old", viewer_key: oldDevice.publicKey });
        await Promise.resolve(); await Promise.resolve(); await f.controller.decideView("old_device", "approve");
        await f.controller.removeViewer("alice");
        f.request({ request_id: "new_device", viewer_id: "alice", viewer_display_name: "Alice new", viewer_key: newDevice.publicKey });
        await Promise.resolve(); await Promise.resolve();
        await f.controller.acceptViewerIdentity("new_device");
        await f.controller.decideView("new_device", "approve");
        expect(f.keyRelays).toHaveLength(2);
        await expect(unwrapEpochKey(oldDevice, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[1].blob)).rejects.toThrow();
        const unwrapped = await unwrapEpochKey(newDevice, f.publisherPublicKey(), "stream/publisher_session", f.keyRelays[1].blob);
        expect(unwrapped.epoch).toBe(3);
        expect(unwrapped.keyBytes).toHaveLength(32);
    } finally { f.controller.stop(); }
});
