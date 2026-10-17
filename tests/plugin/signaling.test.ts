import { expect, test } from "bun:test";
import { BrowserSocket, isAuthenticationRejected, signalingFailureMessage, signalingUrl, SpikeSignaling, SpikeSignalingError, type ViewerPresence } from "../../clients/spike/signaling";

class Socket extends EventTarget implements BrowserSocket {
    protocol = "dass.v1";
    readyState = 0;
    bufferedAmount = 0;
    messages: string[] = [];
    closeCount = 0;
    send(message: string) { this.messages.push(message); }
    close() { this.closeCount++; this.readyState = 3; }
    reply(operation: unknown, requestId = `client_${this.messages.length}`) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ protocol_version: 1, request_id: requestId, operation }) }));
    }
    open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
}

async function connect(socket: Socket, signal = new AbortController().signal) {
    const pending = SpikeSignaling.connect({ experimental: true, backendUrl: "https://dass.example:8080", credential: "test-dass-only", signal,
        createSocket: (url, protocol) => { expect(url).toBe("wss://dass.example:8080/v1/ws"); expect(protocol).toBe("dass.v1"); return socket; } });
    socket.open();
    await Promise.resolve();
    socket.reply({ type: "authenticated", expires_at_unix_seconds: Math.floor(Date.now() / 1000) + 60 });
    return pending;
}

test("signaling origin supports separate machines without URL secrets or insecure transport", () => {
    expect(signalingUrl("https://192.168.1.5:8080")).toBe("wss://192.168.1.5:8080/v1/ws");
    for (const url of ["http://localhost:8080", "https://user:secret@example.com", "https://example.com/?credential=secret", "https://example.com/#key", "https://example.com/path"]) {
        expect(() => signalingUrl(url)).toThrow();
    }
});

test("replay reports duplicate access, not an offline backend or invalid credentials", () => {
    const error = new SpikeSignalingError("rejected:replay");
    expect(isAuthenticationRejected(error)).toBe(false);
    expect(signalingFailureMessage(error)).toContain("already have an active connection");
    expect(signalingFailureMessage(error)).toContain("rejected:replay");
    expect(signalingFailureMessage(error)).not.toContain("Could not connect");
    expect(signalingFailureMessage(new SpikeSignalingError("protocol"))).toContain("[protocol]");
});

test("login, validated response correlation, busy admission and abort cleanup", async () => {
    const socket = new Socket();
    const abort = new AbortController();
    const connection = await connect(socket, abort.signal);
    expect(JSON.parse(socket.messages[0]).operation).toEqual({ type: "login", credential: "test-dass-only" });
    const joined = connection.request({ type: "join", room_id: "room", require_e2ee: false }, "joined");
    await expect(connection.request({ type: "publish", session_id: "session" }, "accepted")).rejects.toThrow("busy");
    socket.reply({ type: "joined", session_id: "session" });
    expect(await joined).toEqual({ type: "joined", session_id: "session" });
    const publish = connection.request({ type: "publish", session_id: "session", publisher_key: "cHViLWtleQ" }, "accepted");
    abort.abort();
    await expect(publish).rejects.toThrow("cancelled");
    expect(connection.closed.aborted).toBe(true);
    connection.close();
    expect(socket.closeCount).toBe(1);
});

test("unexpected IDs, malformed messages and server closure fail closed", async () => {
    for (const kind of ["id", "malformed", "closed"]) {
        const socket = new Socket();
        const connection = await connect(socket);
        const pending = connection.request({ type: "join", room_id: "room", require_e2ee: false }, "joined");
        if (kind === "id") socket.reply({ type: "joined", session_id: "session" }, "wrong_request");
        else if (kind === "closed") socket.reply({ type: "closed", session_id: "session", reason: "revoked" }, "server_close");
        else socket.dispatchEvent(new MessageEvent("message", { data: "{" }));
        await expect(pending).rejects.toThrow(kind === "closed" ? "server:revoked" : "protocol");
        expect(connection.closed.aborted).toBe(true);
    }
});

test("validated backend rejection survives socket cleanup without exposing request data", async () => {
    const socket = new Socket();
    const connection = await connect(socket);
    const pending = connection.request({ type: "subscribe", session_id: "session", publisher_id: "private_source", approval_id: "private_approval" }, "accepted");
    socket.reply({ type: "rejected", code: "invalid_state" });
    await expect(pending).rejects.toThrow("rejected:invalid_state");
    expect(connection.closed.reason).toBeInstanceOf(SpikeSignalingError);
    expect(connection.closed.reason.code).toBe("rejected:invalid_state");
    expect(connection.closed.reason.message).not.toContain("private_source");
    connection.close();
    expect(connection.closed.reason.code).toBe("rejected:invalid_state");
});

test("aborted connect never opens a socket", async () => {
    const abort = new AbortController();
    abort.abort();
    let calls = 0;
    await expect(SpikeSignaling.connect({ experimental: true, backendUrl: "https://example.com", credential: "test", signal: abort.signal,
        createSocket: () => { calls++; return new Socket(); } })).rejects.toThrow("cancelled");
    expect(calls).toBe(0);
});

test("normal leave resolves its correlated closure and then tears down", async () => {
    const socket = new Socket();
    const connection = await connect(socket);
    const leave = connection.request({ type: "leave", session_id: "session" }, "closed");
    socket.reply({ type: "closed", session_id: "session", reason: "left" });
    expect(await leave).toEqual({ type: "closed", session_id: "session", reason: "left" });
    expect(connection.closed.aborted).toBe(true);
    expect(socket.closeCount).toBe(1);
});

test("buffer overload closes rather than queueing more control messages", async () => {
    const socket = new Socket();
    const connection = await connect(socket);
    socket.bufferedAmount = 32_768;
    await expect(connection.request({ type: "join", room_id: "room", require_e2ee: false }, "joined")).rejects.toThrow("overloaded");
    expect(connection.closed.aborted).toBe(true);
    expect(socket.messages.length).toBe(1);
});

test("directory snapshots are correlated and stale responses fail closed", async () => {
    const socket = new Socket();
    const connection = await connect(socket);
    const directory = connection.request({ type: "directory", room_id: "room" }, "directory");
    socket.reply({ type: "directory", room_id: "room", publisher_ids: ["source"], publishers: [{ publisher_id: "source", display_name: "Studio PC" }] });
    expect(await directory).toEqual({ type: "directory", room_id: "room", publisher_ids: ["source"],
        publishers: [{ publisher_id: "source", display_name: "Studio PC" }] });
    const newer = connection.request({ type: "directory", room_id: "room" }, "directory");
    socket.reply({ type: "directory", room_id: "room", publisher_ids: ["stale"], publishers: [{ publisher_id: "stale", display_name: "Studio PC" }] }, "client_2");
    await expect(newer).rejects.toThrow("protocol");
    expect(connection.closed.aborted).toBe(true);
});

async function enablePresence(connection: SpikeSignaling, socket: Socket, updates: ViewerPresence[]) {
    const enabling = connection.enableViewerPresence("publisher_session", update => updates.push(update));
    expect(JSON.parse(socket.messages[socket.messages.length - 1]).operation).toEqual({ type: "enable_viewer_presence", session_id: "publisher_session" });
    socket.reply({ type: "accepted", session_id: "publisher_session" });
    await enabling;
}

test("scoped viewer presence interleaves with pending responses without consuming them", async () => {
    const socket = new Socket();
    const connection = await connect(socket);
    const updates: ViewerPresence[] = [];
    await enablePresence(connection, socket, updates);
    const offer = connection.request({ type: "offer", session_id: "publisher_session", sdp: "v=0\r\n" }, "answer");
    socket.reply({ type: "viewer_presence", session_id: "publisher_session", change: "joined", viewer_count: 1 }, "server_viewer_presence");
    expect(connection.closed.aborted).toBe(false);
    socket.reply({ type: "answer", session_id: "publisher_session", sdp: "v=0\r\n" });
    expect((await offer).type).toBe("answer");
    socket.reply({ type: "viewer_presence", session_id: "publisher_session", change: "left", viewer_count: 0 }, "server_viewer_presence");
    expect(updates.map(update => update.change)).toEqual(["joined", "left"]);
    connection.close();
    socket.reply({ type: "viewer_presence", session_id: "publisher_session", change: "joined", viewer_count: 1 }, "server_viewer_presence");
    expect(updates).toHaveLength(2);
});

test("unexpected, cross-session, duplicate and inconsistent presence fails closed", async () => {
    for (const kind of ["not_enabled", "session", "request", "duplicate", "count", "underflow", "malformed"]) {
        const socket = new Socket();
        const connection = await connect(socket);
        const updates: ViewerPresence[] = [];
        if (kind !== "not_enabled") await enablePresence(connection, socket, updates);
        const joined = { type: "viewer_presence", session_id: "publisher_session", change: "joined", viewer_count: 1 };
        if (kind === "duplicate") socket.reply(joined, "server_viewer_presence");
        const update = { ...joined, ...(kind === "session" ? { session_id: "other" } : {}),
            ...(kind === "count" ? { viewer_count: 2 } : {}), ...(kind === "underflow" ? { change: "left", viewer_count: 0 } : {}),
            ...(kind === "malformed" ? { viewer_count: 0.5 } : {}) };
        socket.reply(update, kind === "request" ? "client_999" : "server_viewer_presence");
        expect(connection.closed.aborted).toBe(true);
        expect(connection.closed.reason.code).toBe("protocol");
        expect(updates).toHaveLength(kind === "duplicate" ? 1 : 0);
    }
});

test("presence opt-in validates its acknowledgement and rejects unsupported backends", async () => {
    for (const unsupported of [false, true]) {
        const socket = new Socket();
        const connection = await connect(socket);
        const enabling = connection.enableViewerPresence("publisher_session", () => {});
        socket.reply(unsupported ? { type: "rejected", code: "invalid_message" } : { type: "accepted", session_id: "other" });
        await expect(enabling).rejects.toThrow(unsupported ? "rejected:invalid_message" : "protocol");
        expect(connection.closed.aborted).toBe(true);
    }
});
