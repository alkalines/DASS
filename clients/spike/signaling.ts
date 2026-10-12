/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { logDiagnostic } from "./diagnostics";
import { type ClientOperation, type CloseReason, type ErrorCode, LOGIN_DEADLINE_MS, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ServerOperation } from "../../crates/protocol/generated/signaling";
import { parseClientMessage, parseServerMessage } from "../../crates/protocol/generated/validate";

export interface BrowserSocket extends EventTarget {
    readonly protocol: string;
    readonly bufferedAmount: number;
    readonly readyState: number;
    send(message: string): void;
    close(code?: number, reason?: string): void;
}

export interface DassAuthentication {
    credential?: string;
    username?: string;
    password?: string;
}

export function signalingUrl(baseUrl: string): string {
    let url: URL;
    try { url = new URL(baseUrl); } catch { throw new Error("Invalid DASS backend URL."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("Use an HTTPS backend origin without credentials, paths or query parameters.");
    }
    url.protocol = "wss:";
    url.pathname = "/v1/ws";
    return url.href;
}

type Pending<T> = {
    resolve(value: T): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
};

type SignalingFailureCode = "closed" | "socket" | "protocol" | "timeout" | "expired" | "cancelled" | "overloaded"
    | `rejected:${ErrorCode}` | `server:${CloseReason}`;

export class SpikeSignalingError extends Error {
    constructor(readonly code: SignalingFailureCode) { super(`DASS signaling failed [${code}].`); }
}

/** Only an explicit backend denial/revocation invalidates reusable credentials. */
export function isAuthenticationRejected(error: unknown): boolean {
    return error instanceof SpikeSignalingError && (error.code === "rejected:unauthorized" || error.code === "server:revoked");
}

export function signalingFailureMessage(error: unknown): string {
    if (isAuthenticationRejected(error)) return "The DASS backend rejected or revoked your access. Check your DASS credentials and permissions. No Discord fallback.";
    if (error instanceof SpikeSignalingError && (error.code === "expired" || error.code === "server:expired")) {
        return "DASS connection expired. Retry to authenticate again; your credentials were kept. No Discord fallback.";
    }
    return "Could not connect to the DASS backend or complete signaling. Check backend availability, TLS and your network; your credentials were kept. No Discord fallback.";
}

/** Experimental control transport, staged into the plugin's manual test panel. */
export class SpikeSignaling {
    private active = true;
    private failureCode: SignalingFailureCode = "closed";
    private sequence = 0;
    private openWait?: Pending<void>;
    private pending?: Pending<ServerOperation> & { requestId: string; expectedType: ServerOperation["type"]; };
    private expiryTimer?: ReturnType<typeof setTimeout>;
    private readonly closedController = new AbortController();
    readonly closed = this.closedController.signal;

    private constructor(private readonly socket: BrowserSocket, private readonly signal: AbortSignal) {
        socket.addEventListener("open", this.onOpen);
        socket.addEventListener("message", this.onMessage);
        socket.addEventListener("error", this.onFailure);
        socket.addEventListener("close", this.onFailure);
        signal.addEventListener("abort", this.onFailure, { once: true });
    }

    static async connect(options: DassAuthentication & {
        experimental: true;
        backendUrl: string;
        signal: AbortSignal;
        createSocket?: (url: string, protocol: string) => BrowserSocket;
    }): Promise<SpikeSignaling> {
        if (options.experimental !== true || options.signal.aborted) throw new Error("DASS connection was cancelled or not explicitly enabled.");
        const url = signalingUrl(options.backendUrl);
        // Validate before opening a socket. Never put credentials in URL/protocol.
        const accountLogin = options.username !== undefined || options.password !== undefined;
        if (accountLogin && options.credential) throw new Error("Select one DASS authentication method.");
        const login = accountLogin ? { type: "account_login" as const, username: options.username, password: options.password }
            : { type: "login" as const, credential: options.credential };
        const validatedLogin = parseClientMessage(JSON.stringify({ protocol_version: PROTOCOL_VERSION, request_id: "login_validation", operation: login }));
        const createSocket = options.createSocket ?? ((endpoint, protocol) => new WebSocket(endpoint, protocol));
        let socket: BrowserSocket;
        try { socket = createSocket(url, "dass.v1"); } catch { throw new Error("DASS socket could not be opened."); }
        const connection = new SpikeSignaling(socket, options.signal);
        logDiagnostic("signaling connecting", { accountLogin });
        try {
            await connection.waitForOpen();
            const authenticated = await connection.request(validatedLogin.operation, "authenticated");
            if (authenticated.type !== "authenticated") throw new Error("DASS authentication failed.");
            const expiryMs = authenticated.expires_at_unix_seconds * 1000 - Date.now();
            if (expiryMs <= 0) throw new Error("DASS credential has expired.");
            // The backend also enforces expiry and the ten-minute connection ceiling.
            connection.expiryTimer = setTimeout(() => connection.close("expired"), Math.min(expiryMs, 600_000));
            logDiagnostic("signaling authenticated");
            return connection;
        } catch (error) {
            connection.close();
            throw error instanceof SpikeSignalingError ? error : new SpikeSignalingError(connection.failureCode);
        }
    }

    private waitForOpen(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.openWait = { resolve, reject, timer: setTimeout(() => this.close("timeout"), LOGIN_DEADLINE_MS) };
            if (!this.active || this.signal.aborted) this.close();
            else if (this.socket.readyState === 1) this.onOpen();
        });
    }

    private readonly onOpen = () => {
        if (this.socket.protocol !== "dass.v1" || this.socket.readyState !== 1) return this.close("protocol");
        const wait = this.openWait;
        this.openWait = undefined;
        if (wait) { clearTimeout(wait.timer); wait.resolve(); }
    };

    private readonly onFailure = () => this.close(this.signal.aborted ? "cancelled" : "socket");

    private readonly onMessage = (event: Event) => {
        if (!(event instanceof MessageEvent) || typeof event.data !== "string") return this.close("protocol");
        try {
            const message = parseServerMessage(event.data);
            const { pending } = this;
            if (message.operation.type === "closed") {
                if (pending?.requestId === message.request_id && pending.expectedType === "closed") {
                    this.pending = undefined;
                    clearTimeout(pending.timer);
                    pending.resolve(message.operation);
                }
                return this.close(`server:${message.operation.reason}`);
            }
            if (!pending || pending.requestId !== message.request_id) return this.close("protocol");
            if (message.operation.type === "rejected") return this.close(`rejected:${message.operation.code}`);
            if (message.operation.type !== pending.expectedType) return this.close("protocol");
            this.pending = undefined;
            clearTimeout(pending.timer);
            if (message.operation.type !== "directory") logDiagnostic("signaling response", { type: message.operation.type });
            pending.resolve(message.operation);
        } catch {
            this.close("protocol");
        }
    };

    request(operation: ClientOperation, expectedType: ServerOperation["type"]): Promise<ServerOperation> {
        if (!this.active || this.signal.aborted || this.socket.readyState !== 1 || this.pending || this.sequence >= 256) {
            return Promise.reject(new Error("DASS connection is unavailable or busy."));
        }
        const requestId = `client_${++this.sequence}`;
        const message = JSON.stringify({ protocol_version: PROTOCOL_VERSION, request_id: requestId, operation });
        try { parseClientMessage(message); } catch { return Promise.reject(new Error("Invalid DASS request.")); }
        if (this.socket.bufferedAmount + new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES * 2) {
            this.close("overloaded");
            return Promise.reject(new Error("DASS connection is overloaded."));
        }
        return new Promise((resolve, reject) => {
            if (operation.type !== "directory") logDiagnostic("signaling request", { type: operation.type });
            this.pending = { requestId, expectedType, resolve, reject, timer: setTimeout(() => this.close("timeout"), LOGIN_DEADLINE_MS) };
            try { this.socket.send(message); } catch { this.close("socket"); }
        });
    }

    close(code: SignalingFailureCode = "closed") {
        // Pending waits are rejected even if cancellation preceded wait registration.
        if (this.active) logDiagnostic("signaling closed", { code, pendingType: this.pending?.expectedType ?? "none" }, !["closed", "cancelled"].includes(code));
        if (this.active) this.failureCode = code;
        const error = new SpikeSignalingError(this.failureCode);
        if (this.openWait) { clearTimeout(this.openWait.timer); this.openWait.reject(error); this.openWait = undefined; }
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.expiryTimer);
        this.socket.removeEventListener("open", this.onOpen);
        this.socket.removeEventListener("message", this.onMessage);
        this.socket.removeEventListener("error", this.onFailure);
        this.socket.removeEventListener("close", this.onFailure);
        this.signal.removeEventListener("abort", this.onFailure);
        try { this.socket.close(1000, "DASS session ended"); } finally { this.closedController.abort(error); }
    }
}
