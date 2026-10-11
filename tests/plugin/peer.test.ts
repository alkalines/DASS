import { expect, spyOn, test } from "bun:test";
import { gatheredCandidates, ipv4Offer, preparationFailureMessage, PREPARATION_TIMEOUT_MS, SpikePeer } from "../../clients/spike/peer";

test("gathered candidate extraction is bounded and deduplicated", () => {
    const candidate = "a=candidate:1 1 udp 2130706431 192.168.1.2 50000 typ host";
    expect(gatheredCandidates(`v=0\r\n${candidate}\r\n${candidate}\r\n`)).toEqual([candidate.slice(2)]);
    expect(() => gatheredCandidates("x".repeat(12289))).toThrow();
    expect(() => gatheredCandidates("v=0\r\n")).toThrow();
});

test("preparation diagnostics identify candidate policy without exposing candidate text", () => {
    for (const [candidate, code] of [
        ["candidate:private 1 udp 123 private-source.local 50000 typ host", "candidate_mdns"],
        ["candidate:private 1 udp 123 ::1 50000 typ host", "candidate_address"],
        ["candidate:private 1 tcp 123 192.168.1.2 50000 typ host", "candidate_transport"]
    ]) {
        try { gatheredCandidates(`a=${candidate}\r\n`); throw new Error("Candidate unexpectedly accepted"); }
        catch (error) {
            const message = preparationFailureMessage(error);
            expect(message).toContain(`[${code}]`);
            expect(message).not.toContain("private-source");
            expect(message).not.toContain(candidate);
        }
    }
    expect(preparationFailureMessage(new Error("sensitive browser exception"))).not.toContain("sensitive");
});

test("IPv4 offer omits IPv6 candidates without changing supported endpoints or media lines", () => {
    const ipv4 = "a=candidate:1 1 udp 2130706431 192.0.2.1 50123 typ host";
    const ipv6 = "a=candidate:2 1 udp 2130706431 fd00::2 50124 typ host";
    const mediaLines = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=fingerprint:sha-256 placeholder\r\n";
    const filtered = ipv4Offer(`${mediaLines}${ipv6}\r\n${ipv4}\r\na=end-of-candidates\r\n`);
    expect(filtered).toBe(`${mediaLines}${ipv4}\r\na=end-of-candidates\r\n`);
    expect(gatheredCandidates(filtered)).toEqual([ipv4.slice(2)]);
    expect(() => ipv4Offer(`${mediaLines}${ipv6}\r\n`)).toThrow("Only IPv6");
    expect(() => ipv4Offer(`${mediaLines}${ipv4}\r\na=candidate:3 1 udp 123 capture.local 50125 typ host\r\n`)).toThrow("mDNS");
    expect(() => ipv4Offer(`${mediaLines}${ipv4}\r\na=candidate:4 1 tcp 123 192.0.2.1 50126 typ host\r\n`)).toThrow("transport");
    expect(() => ipv4Offer("x".repeat(12289))).toThrow("12 KiB");
});

// These doubles test ownership and cancellation, not Chromium or codec playback.
class Track extends EventTarget {
    readyState = "live";
    stops = 0;
    constructor(readonly kind: string) { super(); }
    stop() { this.stops++; this.readyState = "ended"; }
    end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
}

class Stream {
    constructor(private readonly tracks: Track[] = []) { }
    getTracks() { return [...this.tracks]; }
    getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
    addTrack(track: Track) { this.tracks.push(track); }
}

const offerSdp = "v=0\r\na=candidate:1 1 udp 2130706431 192.168.1.2 50000 typ host\r\n";

class Peer extends EventTarget {
    static instances: Peer[] = [];
    static gathering = "complete";
    static offer: (() => Promise<{ type: string; sdp: string; }>) | undefined;
    connectionState = "new";
    iceGatheringState = Peer.gathering;
    localDescription?: { type: string; sdp: string; };
    remoteDescription?: { type: string; sdp: string; };
    closes = 0;
    transceivers: Array<{ kind: string; direction: string; codecs: Array<{ mimeType: string; }>; }> = [];
    constructor(readonly configuration: unknown) { super(); Peer.instances.push(this); }
    addTransceiver(track: Track | string, options: { direction: string; }) {
        const transceiver = { kind: typeof track === "string" ? track : track.kind, direction: options.direction,
            codecs: [] as Array<{ mimeType: string; }> };
        this.transceivers.push(transceiver);
        return { setCodecPreferences: (codecs: Array<{ mimeType: string; }>) => { transceiver.codecs = codecs; } };
    }
    async createOffer() { return Peer.offer ? Peer.offer() : { type: "offer", sdp: offerSdp }; }
    async setLocalDescription(description: { type: string; sdp: string; }) { this.localDescription = description; }
    async setRemoteDescription(description: { type: string; sdp: string; }) { this.remoteDescription = description; }
    close() { this.closes++; this.connectionState = "closed"; }
    receive(track: Track) {
        const event = new Event("track");
        Object.defineProperty(event, "track", { value: track });
        this.dispatchEvent(event);
    }
}

class Socket extends EventTarget {
    static instances: Socket[] = [];
    static failOffer = false;
    static rejectSubscribe = false;
    protocol = "dass.v1";
    readyState = 1;
    bufferedAmount = 0;
    closes = 0;
    operations: Array<{ type: string; publisher_id?: string; sdp?: string; }> = [];
    constructor() { super(); Socket.instances.push(this); }
    send(message: string) {
        const request = JSON.parse(message);
        this.operations.push(request.operation);
        let operation: unknown;
        switch (request.operation.type) {
            case "login": operation = { type: "authenticated", expires_at_unix_seconds: Math.floor(Date.now() / 1000) + 60 }; break;
            case "join": operation = { type: "joined", session_id: "session" }; break;
            case "publish": operation = { type: "accepted", session_id: "session" }; break;
            case "subscribe": operation = Socket.rejectSubscribe ? { type: "rejected", code: "invalid_state" }
                : { type: "accepted", session_id: "session" }; break;
            case "offer": operation = Socket.failOffer
                ? { type: "closed", session_id: "session", reason: "transport_failed" }
                : { type: "answer", session_id: "session", sdp: "v=0\r\n" }; break;
            default: throw new Error("Unexpected operation");
        }
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
            protocol_version: 1, request_id: request.request_id, operation
        }) })));
    }
    close() { this.closes++; this.readyState = 3; }
}

async function withBrowserDoubles(run: () => Promise<void>) {
    const doubles = {
        MediaStream: Stream,
        RTCPeerConnection: Peer,
        RTCRtpSender: { getCapabilities: () => ({ codecs: [{ mimeType: "video/VP8" }, { mimeType: "video/H264" }, { mimeType: "audio/opus" }] }) },
        WebSocket: Socket
    };
    const originals = new Map(Object.keys(doubles).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    Peer.instances = [];
    Peer.gathering = "complete";
    Peer.offer = undefined;
    Socket.instances = [];
    Socket.failOffer = false;
    Socket.rejectSubscribe = false;
    for (const [name, value] of Object.entries(doubles)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    try { await run(); } finally {
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
}

function capture(audioSelected = false, audioPresent = audioSelected) {
    const tracks = [new Track("video"), ...(audioPresent ? [new Track("audio")] : [])];
    let releases = 0;
    return { tracks, get releases() { return releases; }, lease: {
        stream: new Stream(tracks) as unknown as MediaStream, audioSelected, release: () => { releases++; }
    } };
}

test("preparation has a 180-second deadline and expiry releases capture", async () => withBrowserDoubles(async () => {
    const schedule = spyOn(globalThis, "setTimeout");
    const source = capture();
    let connection: SpikePeer | undefined;
    try {
        connection = await SpikePeer.prepare({ experimental: true, signal: new AbortController().signal, capture: source.lease });
        expect(PREPARATION_TIMEOUT_MS).toBe(180_000);
        const scheduled = schedule.mock.calls.find(call => call[1] === PREPARATION_TIMEOUT_MS);
        expect(scheduled).toBeDefined();
        const callback = scheduled?.[0];
        if (typeof callback !== "function") throw new Error("Preparation timer not registered");
        callback();
        expect(connection.closed.aborted).toBe(true);
        expect(connection.closeMessage).toContain("Preparation expired");
        expect(source.releases).toBe(1);
        expect(source.tracks[0].stops).toBe(1);
    } finally {
        connection?.close();
        schedule.mockRestore();
    }
}));

test("publisher uses only selected tracks and codecs; abort and repeat teardown release once", async () => withBrowserDoubles(async () => {
    const abort = new AbortController();
    const source = capture(true);
    const connection = await SpikePeer.prepare({ experimental: true, signal: abort.signal, capture: source.lease });
    try {
        const peer = Peer.instances[0];
        expect(peer.configuration).toEqual({ iceServers: [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" });
        expect(peer.transceivers).toEqual([
            { kind: "video", direction: "sendonly", codecs: [{ mimeType: "video/VP8" }] },
            { kind: "audio", direction: "sendonly", codecs: [{ mimeType: "audio/opus" }] }
        ]);
        expect(connection.candidates).toHaveLength(1);
        abort.abort();
        connection.close();
        expect(connection.closed.aborted).toBe(true);
        expect(peer.closes).toBe(1);
        expect(source.releases).toBe(1);
        expect(source.tracks.map(track => track.stops)).toEqual([1, 1]);
    } finally { connection.close(); }
}));

test("audio consent mismatch fails closed before offering", async () => withBrowserDoubles(async () => {
    for (const [selected, present] of [[false, true], [true, false]]) {
        const source = capture(selected, present);
        await expect(SpikePeer.prepare({ experimental: true, signal: new AbortController().signal, capture: source.lease })).rejects.toThrow();
        expect(source.releases).toBe(1);
        expect(source.tracks.every(track => track.stops === 1)).toBe(true);
        expect(Peer.instances.at(-1)?.localDescription).toBeUndefined();
    }
}));

test("cancellation during gathering releases capture and rejects pending preparation", async () => withBrowserDoubles(async () => {
    Peer.gathering = "gathering";
    const abort = new AbortController();
    const source = capture();
    const preparation = SpikePeer.prepare({ experimental: true, signal: abort.signal, capture: source.lease });
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    await expect(preparation).rejects.toThrow("cancelled");
    expect(source.releases).toBe(1);
    expect(source.tracks[0].stops).toBe(1);
    expect(Peer.instances[0].closes).toBe(1);
}));

test("a late offer cannot resurrect aborted capture", async () => withBrowserDoubles(async () => {
    let resolveOffer!: (offer: { type: string; sdp: string; }) => void;
    Peer.offer = () => new Promise(resolve => { resolveOffer = resolve; });
    const abort = new AbortController();
    const source = capture();
    const preparation = SpikePeer.prepare({ experimental: true, signal: abort.signal, capture: source.lease });
    abort.abort();
    resolveOffer({ type: "offer", sdp: offerSdp });
    await expect(preparation).rejects.toThrow("cancelled");
    expect(source.releases).toBe(1);
    expect(Socket.instances).toHaveLength(0);
    expect(Peer.instances[0].localDescription).toBeUndefined();
}));

test("viewer is receive-only, bounds incoming tracks and closes on source end", async () => withBrowserDoubles(async () => {
    const connection = await SpikePeer.prepare({ experimental: true, signal: new AbortController().signal });
    try {
        const peer = Peer.instances[0];
        expect(peer.transceivers.map(item => item.direction)).toEqual(["recvonly", "recvonly"]);
        const video = new Track("video");
        const audio = new Track("audio");
        const duplicate = new Track("video");
        peer.receive(video);
        peer.receive(duplicate);
        peer.receive(audio);
        expect(connection.receivedStream.getTracks()).toHaveLength(2);
        expect(duplicate.stops).toBe(1);
        video.end();
        expect(connection.closed.aborted).toBe(true);
        expect(audio.stops).toBe(1);
    } finally { connection.close(); }
}));

test("publisher activation correlates WSS operations; signaling loss stops capture", async () => withBrowserDoubles(async () => {
    Peer.offer = async () => ({ type: "offer", sdp: `${offerSdp}a=candidate:2 1 udp 123 fd00::2 50001 typ host\r\n` });
    const source = capture();
    const connection = await SpikePeer.prepare({ experimental: true, signal: new AbortController().signal, capture: source.lease });
    try {
        expect(await connection.activate({ backendUrl: "https://dass.example", credential: "separate-dass-test", roomId: "room" })).toBe("session");
        const socket = Socket.instances[0];
        expect(socket.operations.map(operation => operation.type)).toEqual(["login", "join", "publish", "offer"]);
        expect(socket.operations[3].sdp).not.toContain("fd00::2");
        expect(socket.operations[3].sdp).toContain("192.168.1.2 50000");
        expect(Peer.instances[0].localDescription?.sdp).toContain("fd00::2");
        expect(Peer.instances[0].remoteDescription?.type).toBe("answer");
        await expect(connection.activate({ backendUrl: "https://dass.example", credential: "test", roomId: "room" })).rejects.toThrow("once");
        socket.dispatchEvent(new Event("close"));
        expect(connection.closed.aborted).toBe(true);
        expect(connection.closeMessage).toContain("connection:socket");
        expect(source.releases).toBe(1);
        expect(source.tracks[0].stops).toBe(1);
        expect(socket.closes).toBe(1);
    } finally { connection.close(); }
}));

test("viewer binds to the selected publisher and setup rejection tears down", async () => withBrowserDoubles(async () => {
    const connection = await SpikePeer.prepare({ experimental: true, signal: new AbortController().signal });
    try {
        Socket.failOffer = true;
        await expect(connection.activate({ backendUrl: "https://dass.example", credential: "separate-dass-test", roomId: "room", publisherId: "publisher" })).rejects.toThrow("failed");
        expect(Socket.instances[0].operations[2]).toEqual({ type: "subscribe", session_id: "session", publisher_id: "publisher" });
        expect(connection.closed.aborted).toBe(true);
        expect(connection.closeMessage).toContain("offer:server:transport_failed");
        expect(Peer.instances[0].closes).toBe(1);
        expect(Socket.instances[0].closes).toBe(1);
    } finally { connection.close(); }
}));

test("subscribe rejection is observable at closure before the activation catch runs", async () => withBrowserDoubles(async () => {
    const connection = await SpikePeer.prepare({ experimental: true, signal: new AbortController().signal });
    let statusAtClosure = "";
    connection.closed.addEventListener("abort", () => { statusAtClosure = connection.closeMessage; }, { once: true });
    try {
        Socket.rejectSubscribe = true;
        await expect(connection.activate({ backendUrl: "https://dass.example", credential: "separate-dass-test", roomId: "room", publisherId: "ocr_wrong" })).rejects.toThrow();
        expect(statusAtClosure).toContain("subscribe:rejected:invalid_state");
        expect(connection.closeMessage).toBe(statusAtClosure);
        expect(statusAtClosure).not.toContain("ocr_wrong");
        expect(statusAtClosure).not.toContain("separate-dass-test");
    } finally { connection.close(); }
}));

test("mDNS, IPv6, privileged ports and non-UDP candidates fail visibly", () => {
    for (const [protocol, address, port] of [
        ["udp", "capture.local", "50000"], ["udp", "::1", "50000"],
        ["tcp", "192.168.1.2", "50000"], ["udp", "192.168.1.2", "53"],
        ["udp", "999.1.2.3", "50000"], ["udp", "192.168.1.2", "65536"]
    ]) expect(() => gatheredCandidates(`a=candidate:1 1 ${protocol} 2130706431 ${address} ${port} typ host\r\n`)).toThrow();
});
