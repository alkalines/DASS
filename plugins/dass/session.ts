/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type DassAuthentication, signalingUrl, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

export interface AccountCredentials {
    backendUrl: string;
    roomId: string;
    username: string;
    password: string;
}

export interface AccountStorage {
    read(): Promise<AccountCredentials | undefined>;
    write(account: AccountCredentials): Promise<void>;
    forget(): Promise<void>;
}

/** Only encrypted, explicitly remembered accounts may survive client restart. */
export class DassSession {
    private access?: DassAuthentication & { roomId: string; };
    private backendUrl?: string;
    private pending?: AbortController;
    private idleConnection?: SpikeSignaling;
    private epoch = 0;
    private active = false;
    private phase: "idle" | "loading" | "ready" | "failed" = "idle";
    private message = "Sign in with a separate DASS username and password.";
    private listeners = new Set<() => void>();

    constructor(private readonly storage?: AccountStorage, private readonly authenticate = SpikeSignaling.connect) {}

    getSnapshot = () => ({ roomId: this.access?.roomId ?? "", username: this.access?.username ?? "", configured: !!this.access,
        phase: this.phase, message: this.message });
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    async start(backendUrl: string) {
        this.active = true;
        const { epoch } = this;
        try {
            const account = await this.storage?.read();
            signalingUrl(backendUrl);
            if (!this.active || this.epoch !== epoch || !account || account.backendUrl !== new URL(backendUrl).origin) return;
            await this.login(account, false, true);
        } catch {
            if (this.active && this.epoch === epoch) {
                this.phase = "failed";
                this.message = "Remembered DASS login could not be unlocked. Sign in again; no plaintext storage fallback.";
                this.notify();
            }
        }
    }

    async login(account: AccountCredentials, remember: boolean, restored = false) {
        if (!this.active) return;
        this.clear();
        try {
            signalingUrl(account.backendUrl);
            account = { ...account, backendUrl: new URL(account.backendUrl).origin };
        } catch {
            this.phase = "failed";
            this.message = "Use a trusted HTTPS backend origin without credentials, paths or query parameters.";
            this.notify();
            return;
        }
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(account.roomId) || !/^[A-Za-z0-9_-]{1,64}$/.test(account.username)
            || !account.password || account.password.includes("\0") || new TextEncoder().encode(account.password).byteLength > 512) {
            this.phase = "failed";
            this.message = "Enter a valid DASS room, username and password.";
            this.notify();
            return;
        }
        const request = new AbortController();
        this.pending = request;
        const { epoch } = this;
        this.phase = "loading";
        this.message = "Signing in to DASS. The backend observes the connection IP; no capture is requested.";
        this.notify();
        try {
            if (!remember && !restored) await this.storage?.forget();
            if (!this.active || this.epoch !== epoch || request.signal.aborted) return;
            const connection = await this.authenticate({ experimental: true, backendUrl: account.backendUrl,
                username: account.username, password: account.password, signal: request.signal });
            if (!this.active || this.epoch !== epoch || request.signal.aborted) { connection.close(); return; }
            this.idleConnection = connection;
            this.backendUrl = account.backendUrl;
            this.access = { roomId: account.roomId, username: account.username, password: account.password };
            connection.closed.addEventListener("abort", () => {
                if (this.idleConnection !== connection) return;
                this.idleConnection = undefined;
                const { reason } = connection.closed;
                if (reason instanceof SpikeSignalingError && /unauthorized|revoked/.test(reason.code)) this.clear();
                else {
                    this.message = "DASS idle connection closed. Your account will authenticate again automatically when sharing or watching.";
                    this.notify();
                }
            }, { once: true });
            if (connection.closed.aborted) throw connection.closed.reason;
            this.phase = "ready";
            this.message = "DASS account signed in. Media endpoints will be admitted only for an authorized active LAN session.";
            this.notify();
            if (remember && this.storage) {
                try {
                    await this.storage.write(account);
                    if (this.epoch === epoch) { this.message = "DASS login remembered with OS-backed encryption. It will sign in when the plugin loads."; this.notify(); }
                } catch {
                    if (this.epoch === epoch) { this.message = "Signed in for this session, but secure remembering is unavailable. No password was stored as plaintext."; this.notify(); }
                }
            }
        } catch (error) {
            if (this.active && this.epoch === epoch) {
                this.clear();
                this.phase = "failed";
                this.message = "DASS login failed. Check your account, TLS and LAN connection. No Discord fallback.";
                if (error instanceof SpikeSignalingError && /unauthorized|expired|revoked/.test(error.code)) void this.storage?.forget().catch(() => {});
                this.notify();
            }
        }
    }

    /** Transfer startup authentication to the publisher/viewer rather than logging in twice. */
    async connect(options: Parameters<typeof SpikeSignaling.connect>[0]) {
        signalingUrl(options.backendUrl);
        const connection = this.idleConnection;
        if (!connection || connection.closed.aborted || new URL(options.backendUrl).origin !== this.backendUrl
            || options.username !== this.access?.username || options.password !== this.access?.password
            || options.credential !== this.access?.credential) return this.authenticate(options);
        if (options.signal.aborted) throw new Error("DASS connection was cancelled.");
        this.idleConnection = undefined;
        const abort = () => connection.close();
        const cleanup = () => options.signal.removeEventListener("abort", abort);
        options.signal.addEventListener("abort", abort, { once: true });
        connection.closed.addEventListener("abort", cleanup, { once: true });
        return connection;
    }

    /** Legacy invite setup remains available for manual tests. */
    configure(roomId: string, credential: string) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId) || !credential || credential.includes("\0") || new TextEncoder().encode(credential).byteLength > 512) {
            throw new Error("Enter a valid DASS room and separate DASS credential.");
        }
        this.clear();
        this.access = { roomId, credential };
        this.phase = "ready";
        this.message = "Legacy invite configured for this session.";
        this.notify();
    }

    getAccess() {
        if (!this.access) throw new Error("DASS session setup is required.");
        return { ...this.access };
    }

    clear() {
        ++this.epoch;
        this.pending?.abort();
        this.pending = undefined;
        this.idleConnection?.close();
        this.idleConnection = undefined;
        this.access = undefined;
        this.backendUrl = undefined;
        this.phase = "idle";
        this.message = "Sign in with a separate DASS username and password.";
        this.notify();
    }

    stop() { this.active = false; this.clear(); }
    async forget() { this.clear(); await this.storage?.forget(); }
    private notify() { for (const listener of this.listeners) listener(); }
}
