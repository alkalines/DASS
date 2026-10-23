/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { collectDiagnostics, diagnosticClientId, logDiagnostic } from "./diagnostics";
import { type ClientOperation, type CloseReason, type DiagnosticEntry, type ErrorCode, LOGIN_DEADLINE_MS, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ServerOperation, SESSION_LIFETIME_SECONDS } from "../../crates/protocol/generated/signaling";
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

export type ViewerPresence = Extract<ServerOperation, { type: "viewer_presence"; }>;
export type ViewRequest = Extract<ServerOperation, { type: "view_request"; }>;
export type ViewDecision = Extract<ServerOperation, { type: "view_decision"; }>;
export type KeyRelay = Extract<ServerOperation, { type: "key_relay"; }>;

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

/** A revoked live session does not imply that its reusable password is invalid. */
export function isAuthenticationRejected(error: unknown): boolean {
    return error instanceof SpikeSignalingError && error.code === "rejected:unauthorized";
}

export function signalingFailureMessage(error: unknown): string {
    if (isAuthenticationRejected(error)) return "The DASS backend rejected your access. Check your DASS credentials and permissions. No Discord fallback.";
    if (error instanceof SpikeSignalingError && error.code === "server:revoked") return "The backend closed this DASS session. Your credentials were kept. Retry manually if access is still permitted.";
    if (error instanceof SpikeSignalingError && error.code === "rejected:replay") {
        return "The DASS backend rejected a duplicate login or request [rejected:replay]. This account may already have an active connection. Your credentials were kept; no Discord fallback.";
    }
    if (error instanceof SpikeSignalingError && error.code === "rejected:overloaded") {
        return "The DASS backend is at capacity or rate-limiting requests [rejected:overloaded]. Each publisher and viewer uses a separate media slot; ask the administrator to check DASS_MAX_MEDIA_SESSIONS, including saved database settings. Retry later; your credentials were kept. No Discord fallback.";
    }
    if (error instanceof SpikeSignalingError && (error.code === "expired" || error.code === "server:expired")) {
        return "DASS connection expired. Retry to authenticate again; your credentials were kept. No Discord fallback.";
    }
    const code = error instanceof SpikeSignalingError ? ` [${error.code}]` : "";
    return `Could not connect to the DASS backend or complete signaling${code}. Check backend availability, TLS and your network; your credentials were kept. No Discord fallback.`;
}

/** Experimental control transport, staged into the plugin's manual test panel. */
export class SpikeSignaling {
    private active = true;
    private failureCode: SignalingFailureCode = "closed";
    private sequence = 0;
    private requestInFlight = false;
    private requestWindowStartedMs = -Infinity;
    private requestsInWindow = 0;
    private openWait?: Pending<void>;
    private pending?: Pending<ServerOperation> & { requestId: string; requestType: ClientOperation["type"]; expectedType: ServerOperation["type"]; };
    private expiryTimer?: ReturnType<typeof setTimeout>;
    private diagnosticTimer?: ReturnType<typeof setInterval>;
    private stopDiagnostics?: () => void;
    private diagnosticEntries: DiagnosticEntry[] = [];
    private publisherPresence?: { sessionId: string; viewerCount: number; listener: (presence: ViewerPresence) => void; };
    private viewRequestListener?: { sessionId: string; listener: (request: ViewRequest) => void; };
    private viewRequestClosed = new Map<string, { sessionId: string; listener: () => void; }>();
    private viewDecisionListener?: { sessionId: string; requestId: string; listener: (decision: ViewDecision) => void; };
    private keyRelayListener?: { listener: (relay: KeyRelay) => void; };
    private earlyDecisions: ViewDecision[] = [];
    private earlyRelays: KeyRelay[] = [];
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
            // Honor earlier server expiry, with the shared session ceiling as a bound.
            connection.expiryTimer = setTimeout(() => connection.close("expired"), Math.min(expiryMs, SESSION_LIFETIME_SECONDS * 1000));
            connection.stopDiagnostics = collectDiagnostics(entry => {
                if (connection.diagnosticEntries.length >= 64) connection.diagnosticEntries.shift();
                connection.diagnosticEntries.push(entry);
            });
            connection.diagnosticTimer = setInterval(() => connection.flushDiagnostics(), 2_000);
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

    /** Best-effort only: never block signaling, retry, or grow an outbound queue. */
    private flushDiagnostics() {
        if (performance.now() - this.requestWindowStartedMs >= 1_000) {
            this.requestWindowStartedMs = performance.now();
            this.requestsInWindow = 0;
        }
        if (!this.active || this.requestInFlight || this.socket.readyState !== 1 || !this.diagnosticEntries.length
            || this.sequence >= Number.MAX_SAFE_INTEGER || this.requestsInWindow >= 16) return;
        const operation: ClientOperation = { type: "diagnostics", client_id: diagnosticClientId(), entries: this.diagnosticEntries.splice(0, 4) };
        const message = JSON.stringify({ protocol_version: PROTOCOL_VERSION, request_id: `client_${++this.sequence}`, operation });
        const size = new TextEncoder().encode(message).byteLength;
        if (size > MAX_MESSAGE_BYTES || this.socket.bufferedAmount + size > MAX_MESSAGE_BYTES * 2) return;
        this.requestsInWindow++;
        try { this.socket.send(message); } catch { /* Diagnostics must not interrupt media. */ }
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
            if (message.operation.type === "view_request") {
                const update = message.operation;
                const listener = this.viewRequestListener;
                if (!listener || message.request_id !== "server_view_request" || update.session_id !== listener.sessionId
                    || !update.request_id || !update.viewer_id) return this.close("protocol");
                listener.listener(update);
                return;
            }
            if (message.operation.type === "view_request_closed") {
                const update = message.operation;
                const closed = this.viewRequestClosed.get(update.request_id);
                if (closed && message.request_id === "server_view_request_closed" && update.session_id === closed.sessionId) {
                    this.viewRequestClosed.delete(update.request_id);
                    closed.listener();
                }
                // A closed prompt for another request is informational; ignore it.
                return;
            }
            if (message.operation.type === "view_decision") {
                const update = message.operation;
                const listener = this.viewDecisionListener;
                // Decisions for unknown/expired requests are ignored; a forged
                // matching decision still cannot create an approval server-side.
                if (!listener || message.request_id !== "server_view_decision") {
                    // A decision cannot create an approval client-side; buffer a
                    // bounded few in case it raced ahead of its pending response.
                    if (message.request_id === "server_view_decision" && this.earlyDecisions.length < 8) {
                        this.earlyDecisions.push(update);
                    }
                    return;
                }
                if (update.session_id !== listener.sessionId || update.request_id !== listener.requestId) return this.close("protocol");
                this.viewDecisionListener = undefined;
                listener.listener(update);
                return;
            }
            if (message.operation.type === "viewer_presence") {
                const presence = this.publisherPresence;
                const update = message.operation;
                if (!presence || message.request_id !== "server_viewer_presence" || update.session_id !== presence.sessionId
                    || update.viewer_count !== presence.viewerCount + (update.change === "joined" ? 1 : -1)) return this.close("protocol");
                presence.viewerCount = update.viewer_count;
                presence.listener(update);
                return;
            }
            if (message.operation.type === "key_relay") {
                const relay = message.operation;
                // Relays are opaque E2EE blobs bound to a publisher session; the
                // session_id names our own viewer session, publisher_id names
                // the stream. Unknown relays are ignored, never acted upon.
                if (message.request_id === "server_key_relay" && relay.publisher_id && relay.blob) {
                    if (this.keyRelayListener) this.keyRelayListener.listener(relay);
                    // A relay can arrive before the viewer finished its trust
                    // decision; keep a bounded few instead of dropping the key.
                    else if (this.earlyRelays.length < 8) this.earlyRelays.push(relay);
                }
                return;
            }
            if (message.operation.type === "closed") {
                const { pending } = this;
                if (pending?.requestId === message.request_id && pending.expectedType === "closed") {
                    this.pending = undefined;
                    clearTimeout(pending.timer);
                    pending.resolve(message.operation);
                }
                return this.close(`server:${message.operation.reason}`);
            }
            const { pending } = this;
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

    async enableViewerPresence(sessionId: string, listener: (presence: ViewerPresence) => void) {
        if (this.publisherPresence) throw new Error("DASS viewer presence is already enabled.");
        this.publisherPresence = { sessionId, viewerCount: 0, listener };
        const accepted = await this.request({ type: "enable_viewer_presence", session_id: sessionId }, "accepted");
        if (accepted.type !== "accepted" || accepted.session_id !== sessionId) {
            this.close("protocol");
            throw new SpikeSignalingError("protocol");
        }
    }

    /** Publisher opt-in: every pushed view request on this session reaches the listener. */
    onViewRequests(sessionId: string, listener: (request: ViewRequest) => void) {
        if (this.viewRequestListener) throw new Error("DASS view requests are already handled.");
        this.viewRequestListener = { sessionId, listener };
    }

    /** Observe a request being closed/expired after it has been pushed. */
    onViewRequestClosed(sessionId: string, requestId: string, listener: () => void) {
        this.viewRequestClosed.set(requestId, { sessionId, listener });
    }

    /** Publisher decision for a pending request ID from a `view_request` push. */
    async decideView(sessionId: string, requestId: string, decision: "approve" | "deny" | "block") {
        const accepted = await this.request({ type: "view_decision", session_id: sessionId, request_id: requestId, decision }, "accepted");
        if (accepted.type !== "accepted" || accepted.session_id !== sessionId) {
            this.close("protocol");
            throw new SpikeSignalingError("protocol");
        }
    }

    /** Relay one E2EE-wrapped epoch key to an approved viewer account. */
    async keyRelay(sessionId: string, viewerId: string, blob: string) {
        const accepted = await this.request({ type: "key_relay", session_id: sessionId, viewer_id: viewerId, blob }, "accepted");
        if (accepted.type !== "accepted" || accepted.session_id !== sessionId) {
            this.close("protocol");
            throw new SpikeSignalingError("protocol");
        }
    }

    /** Publisher withdrawal: removes every viewer session of one account. */
    async removeViewer(sessionId: string, viewerId: string) {
        const accepted = await this.request({ type: "remove_viewer", session_id: sessionId, viewer_id: viewerId }, "accepted");
        if (accepted.type !== "accepted" || accepted.session_id !== sessionId) {
            this.close("protocol");
            throw new SpikeSignalingError("protocol");
        }
    }

    /** Viewer opt-in: receive publisher-encrypted epoch key relays. */
    onKeyRelay(listener: (relay: KeyRelay) => void) {
        if (this.keyRelayListener) throw new Error("DASS key relays are already handled.");
        this.keyRelayListener = { listener };
        // Hand over relays that arrived before the viewer was ready for them.
        const buffered = this.earlyRelays.splice(0, this.earlyRelays.length);
        for (const relay of buffered) listener(relay);
    }

    /**
     * Viewer asks to watch one publisher's stream and waits for its decision.
     * `viewerKey` is this device's E2EE identity key, shown to the publisher
     * for its pinned-identity decision. Resolves with the pushed `view_decision`.
     */
    async requestView(sessionId: string, publisherId: string, viewerKey: string, signal?: AbortSignal): Promise<ViewDecision> {
        const accepted = await this.request({ type: "request_view", session_id: sessionId, publisher_id: publisherId, viewer_key: viewerKey }, "view_request_pending");
        const pendingId = (() => {
            if (accepted.type !== "view_request_pending" || accepted.session_id !== sessionId || !accepted.request_id) {
                this.close("protocol");
                throw new SpikeSignalingError("protocol");
            }
            return accepted.request_id;
        })();
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.viewDecisionListener = undefined;
                this.closed.removeEventListener("abort", onClosed);
                signal?.removeEventListener("abort", onClosed);
            };
            const onClosed = () => { cleanup(); reject(this.closed.reason ?? new SpikeSignalingError("cancelled")); };
            this.viewDecisionListener = { sessionId, requestId: pendingId, listener: decision => {
                cleanup();
                resolve(decision);
            } };
            this.closed.addEventListener("abort", onClosed, { once: true });
            signal?.addEventListener("abort", onClosed, { once: true });
            const early = this.earlyDecisions.findIndex(decision => decision.request_id === pendingId && decision.session_id === sessionId);
            if (early >= 0) {
                const [decision] = this.earlyDecisions.splice(early, 1);
                cleanup();
                resolve(decision);
            }
        });
    }

    async request(operation: ClientOperation, expectedType: ServerOperation["type"]): Promise<ServerOperation> {
        if (!this.active || this.signal.aborted || this.socket.readyState !== 1 || this.requestInFlight || this.sequence >= Number.MAX_SAFE_INTEGER) {
            return Promise.reject(new Error("DASS connection is unavailable or busy."));
        }
        this.requestInFlight = true;
        try {
            // Large E2EE rosters send one wrapped key per viewer. Pace bursts
            // below the backend's 32 messages/s instead of weakening its limit.
            while (this.requestsInWindow >= 16 && performance.now() - this.requestWindowStartedMs < 1_000) {
                await new Promise<void>((resolve, reject) => {
                    const cleanup = () => { clearTimeout(timer); this.closed.removeEventListener("abort", abort); };
                    const abort = () => { cleanup(); reject(new SpikeSignalingError(this.failureCode)); };
                    const timer = setTimeout(() => { cleanup(); resolve(); }, 1_000 - (performance.now() - this.requestWindowStartedMs));
                    this.closed.addEventListener("abort", abort, { once: true });
                    if (this.closed.aborted) abort();
                });
            }
            if (!this.active || this.signal.aborted) throw new SpikeSignalingError(this.failureCode);
            if (performance.now() - this.requestWindowStartedMs >= 1_000) {
                this.requestWindowStartedMs = performance.now();
                this.requestsInWindow = 0;
            }
            this.requestsInWindow++;
            const requestId = `client_${++this.sequence}`;
            const message = JSON.stringify({ protocol_version: PROTOCOL_VERSION, request_id: requestId, operation });
            try { parseClientMessage(message); } catch { return Promise.reject(new Error("Invalid DASS request.")); }
            if (this.socket.bufferedAmount + new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES * 2) {
                this.close("overloaded");
                return Promise.reject(new Error("DASS connection is overloaded."));
            }
            return await new Promise<ServerOperation>((resolve, reject) => {
                if (operation.type !== "directory") logDiagnostic("signaling request", { type: operation.type });
                this.pending = { requestId, requestType: operation.type, expectedType, resolve, reject, timer: setTimeout(() => this.close("timeout"), LOGIN_DEADLINE_MS) };
                try { this.socket.send(message); } catch { this.close("socket"); }
            });
        } finally {
            this.requestInFlight = false;
        }
    }

    close(code: SignalingFailureCode = "closed") {
        // Pending waits are rejected even if cancellation preceded wait registration.
        if (this.active) logDiagnostic("signaling closed", { code, pendingType: this.pending?.expectedType ?? "none", requestType: this.pending?.requestType ?? "none" }, !["closed", "cancelled"].includes(code));
        if (this.active) this.failureCode = code;
        const error = new SpikeSignalingError(this.failureCode);
        if (this.openWait) { clearTimeout(this.openWait.timer); this.openWait.reject(error); this.openWait = undefined; }
        if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
        if (!this.active) return;
        this.flushDiagnostics();
        this.stopDiagnostics?.();
        this.stopDiagnostics = undefined;
        clearInterval(this.diagnosticTimer);
        this.diagnosticEntries = [];
        this.active = false;
        this.publisherPresence = undefined;
        this.viewRequestListener = undefined;
        this.viewRequestClosed.clear();
        this.viewDecisionListener = undefined;
        this.keyRelayListener = undefined;
        clearTimeout(this.expiryTimer);
        this.socket.removeEventListener("open", this.onOpen);
        this.socket.removeEventListener("message", this.onMessage);
        this.socket.removeEventListener("error", this.onFailure);
        this.socket.removeEventListener("close", this.onFailure);
        this.signal.removeEventListener("abort", this.onFailure);
        try { this.socket.close(1000, "DASS session ended"); } finally { this.closedController.abort(error); }
    }
}
