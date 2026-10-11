import { expect, test } from "bun:test";
import { BrowserSocket, signalingUrl, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

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

test("login, validated response correlation, busy admission and abort cleanup", async () => {
    const socket = new Socket();
    const abort = new AbortController();
    const connection = await connect(socket, abort.signal);
    expect(JSON.parse(socket.messages[0]).operation).toEqual({ type: "login", credential: "test-dass-only" });
    const joined = connection.request({ type: "join", room_id: "room", require_e2ee: false }, "joined");
    await expect(connection.request({ type: "publish", session_id: "session" }, "accepted")).rejects.toThrow("busy");
    socket.reply({ type: "joined", session_id: "session" });
    expect(await joined).toEqual({ type: "joined", session_id: "session" });
    const publish = connection.request({ type: "publish", session_id: "session" }, "accepted");
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
    const pending = connection.request({ type: "subscribe", session_id: "session", publisher_id: "private_source" }, "accepted");
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
    socket.reply({ type: "directory", room_id: "room", publisher_ids: ["source"] });
    expect(await directory).toEqual({ type: "directory", room_id: "room", publisher_ids: ["source"] });
    const newer = connection.request({ type: "directory", room_id: "room" }, "directory");
    socket.reply({ type: "directory", room_id: "room", publisher_ids: ["stale"] }, "client_2");
    await expect(newer).rejects.toThrow("protocol");
    expect(connection.closed.aborted).toBe(true);
});
