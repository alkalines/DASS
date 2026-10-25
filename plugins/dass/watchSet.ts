/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassShare, RoutingResult } from "./routing";
import type { DassAuthentication } from "../../clients/spike/signaling";
import type { WatchController, WatchStatus } from "./watching";

/** Streams one client may watch at once. Each uses its own signaling connection
 * and backend media session; the backend's per-account connection cap is this
 * plus the directory and publisher connections and reconnect slack. */
export const MAX_WATCHED_STREAMS = 16;

const shareKey = (share: DassShare) => `${share.roomId}:${share.shareId}`;

/** Owns one independent viewer per watched share. A share whose viewer has
 * nothing left to show (no pending, live, ended or failed stream) is released. */
export class WatchSet {
    private readonly watches = new Map<string, { controller: WatchController; unsubscribe(): void; }>();
    private readonly listeners = new Set<() => void>();
    private snapshot: readonly WatchStatus[] = [];
    private active = false;

    constructor(private readonly create: () => WatchController, private readonly onUnauthorized: (message: string) => void = () => {}) {}

    getSnapshot = () => this.snapshot;
    subscribeStatus = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** Status of the viewer that shows `share`, live, pending or retained after it ended. */
    statusFor(share: DassShare): WatchStatus | undefined {
        return this.watches.get(shareKey(share))?.controller.getSnapshot();
    }

    start() { this.active = true; }

    stop() {
        this.active = false;
        this.stopAll();
    }

    async watch(backendUrl: string, share: DassShare, credential: string | DassAuthentication): Promise<RoutingResult<MediaStream>> {
        if (!this.active) return { ok: false, message: "DASS watching is not active." };
        const key = shareKey(share);
        const existing = this.watches.get(key);
        const status = existing?.controller.getSnapshot();
        if (status?.stream) return { ok: true, value: status.stream };
        if (status?.phase === "loading") return { ok: false, message: "This stream is already connecting." };
        if (!existing && this.watches.size >= MAX_WATCHED_STREAMS) {
            return { ok: false, message: `You are already watching ${MAX_WATCHED_STREAMS} streams. Close one to watch another.` };
        }
        let entry = existing;
        if (!entry) {
            const controller = this.create();
            controller.start();
            entry = { controller, unsubscribe: controller.subscribeStatus(() => this.changed(key, controller)) };
            this.watches.set(key, entry);
        }
        return entry.controller.watchListedShare(backendUrl, share, credential);
    }

    /** Explicitly trust the changed identity a share's publisher presented; the next watch pins it. */
    async acceptPublisherIdentity(share: DassShare) {
        await this.watches.get(shareKey(share))?.controller.acceptPublisherIdentity();
    }

    /** Stops one share's viewer and forgets its retained ended/error state. */
    stopWatching(share: DassShare) {
        this.release(shareKey(share));
    }

    stopAll() {
        for (const key of [...this.watches.keys()]) this.release(key, false);
        this.publish();
    }

    private release(key: string, publish = true) {
        const entry = this.watches.get(key);
        if (!entry) return;
        // Unsubscribe first: stopping emits a status the set must not re-handle.
        this.watches.delete(key);
        entry.unsubscribe();
        entry.controller.stop();
        if (publish) this.publish();
    }

    private changed(key: string, controller: WatchController) {
        if (this.watches.get(key)?.controller !== controller) return;
        const status = controller.getSnapshot();
        if (status.phase === "unauthorized") this.onUnauthorized(status.message);
        if (!status.stream && !status.watchingShare && !status.closedShare && !status.failedShare) this.release(key);
        else this.publish();
    }

    private publish() {
        this.snapshot = [...this.watches.values()].map(entry => entry.controller.getSnapshot());
        for (const listener of this.listeners) listener();
    }
}
