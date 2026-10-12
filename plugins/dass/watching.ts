/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { routeWatch } from "./discordAdapter";
import { type DassShare, ScreenshareRouting, type ScreenshareTransport } from "./routing";
import { SpikePeer } from "../../clients/spike/peer";
import { type DassAuthentication, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

export interface WatchStatus {
    phase: "idle" | "loading" | "ready" | "watching" | "disconnected" | "unauthorized" | "failed";
    message: string;
    shares: readonly DassShare[];
    candidates: readonly string[];
    stream?: MediaStream;
    watchingShare?: DassShare;
}

/** One independently authorized room, one prepared/active decoder, no native streams. */
export class WatchController implements ScreenshareTransport {
    readonly routing = new ScreenshareRouting(this);
    private active = false;
    private epoch = 0;
    private roomId?: string;
    private contextId?: string;
    private backendUrl = "";
    private abort?: AbortController;
    private signaling?: SpikeSignaling;
    private peer?: SpikePeer;
    private poll?: ReturnType<typeof setTimeout>;
    private contextCheck?: ReturnType<typeof setInterval>;
    private busy = false;
    private status: WatchStatus = { phase: "idle", message: "Bind a DASS room using a separate credential. Discord context is not authorization.", shares: [], candidates: [] };
    private listeners = new Set<() => void>();

    constructor(private readonly currentContext: () => string | undefined, private readonly dependencies = {
        connect: SpikeSignaling.connect,
        prepare: SpikePeer.prepare
    }) {}

    getSnapshot = () => this.status;
    subscribeStatus = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private update(status: WatchStatus) {
        this.status = status;
        for (const listener of this.listeners) listener();
    }

    start() {
        this.active = true;
        this.routing.start();
        clearInterval(this.contextCheck);
        // Also catch context loss not represented by a known Discord flux action.
        this.contextCheck = setInterval(() => {
            if (this.contextId && this.currentContext() !== this.contextId) this.reset();
        }, 250);
    }

    reset(phase: WatchStatus["phase"] = "disconnected", message = "DASS viewer closed. Room binding and media were cleared.") {
        ++this.epoch;
        clearTimeout(this.poll);
        this.routing.setRoom(undefined);
        this.routing.reset();
        this.abort?.abort();
        this.peer?.close();
        this.signaling?.close();
        this.abort = undefined;
        this.peer = undefined;
        this.signaling = undefined;
        this.contextId = this.roomId = undefined;
        this.busy = false;
        this.update({ phase, message, shares: [], candidates: [] });
    }

    stop() {
        this.active = false;
        clearInterval(this.contextCheck);
        this.contextCheck = undefined;
        this.reset();
        this.routing.stop();
    }

    private current(epoch: number) {
        return this.active && this.epoch === epoch && !!this.contextId && this.currentContext() === this.contextId;
    }

    private failure(error: unknown) {
        const code = error instanceof SpikeSignalingError ? error.code : "";
        const unauthorized = code === "rejected:unauthorized" || code === "expired" || code === "server:expired" || code === "server:revoked";
        const disconnected = code === "socket" || code === "closed" || code === "server:transport_failed";
        this.reset(unauthorized ? "unauthorized" : disconnected ? "disconnected" : "failed", unauthorized
            ? "DASS access denied, expired or revoked. Supply an authorized room credential."
            : disconnected ? "DASS connection disconnected. Prepare and authenticate again; no Discord fallback."
                : "DASS setup failed. Check TLS, room access, LAN IP matching and the UDP path. No Discord fallback.");
    }

    async bind(backendUrl: string, roomId: string, credential: string | DassAuthentication) {
        if (this.busy || this.signaling || this.contextId !== this.currentContext()) this.reset();
        this.update({ ...this.status, phase: "loading", message: "Authenticating the DASS room directory…", shares: [] });
        this.contextId = this.currentContext();
        if (!this.active || !this.contextId || !/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) {
            this.reset("failed", "Select a voice context and enter an opaque DASS room ID.");
            return;
        }
        const { epoch } = this;
        this.busy = true;
        this.abort ??= new AbortController();
        this.backendUrl = backendUrl;
        this.roomId = roomId;
        this.routing.setRoom(roomId);
        try {
            const authentication = typeof credential === "string" ? { credential } : credential;
            const signaling = await this.dependencies.connect({ experimental: true, backendUrl, ...authentication, signal: this.abort.signal });
            if (!this.current(epoch)) { signaling.close(); return; }
            this.signaling = signaling;
            signaling.closed.addEventListener("abort", () => {
                if (this.current(epoch)) this.failure(signaling.closed.reason);
            }, { once: true });
            if (signaling.closed.aborted) throw signaling.closed.reason;
            this.busy = false;
            await this.refresh();
        } catch (error) { if (this.current(epoch)) this.failure(error); }
    }

    async refresh() {
        const { epoch } = this;
        if (!this.current(epoch) || !this.roomId || !this.signaling || this.busy || this.status.stream) return;
        clearTimeout(this.poll);
        this.busy = true;
        const result = await this.routing.detect(this.roomId);
        if (!this.current(epoch)) return;
        this.busy = false;
        if (!result.ok) { this.reset("failed", result.message); return; }
        this.update({ ...this.status, phase: "ready", message: "Authorized DASS shares only. Media follows the backend's LAN admission policy; no Discord fallback.", shares: result.value });
        // At most 120 directory requests in the transport's ten-minute lifetime.
        this.poll = setTimeout(() => void this.refresh(), 5_000);
    }

    async prepareViewer() {
        if (!this.contextId && this.active && this.currentContext()) {
            this.contextId = this.currentContext();
            this.abort = new AbortController();
        }
        const { epoch } = this;
        if (!this.current(epoch) || !this.abort || this.busy || this.peer) return;
        this.busy = true;
        this.update({ ...this.status, phase: "loading", message: "Preparing one viewer. No capture or Discord subscription is requested." });
        try {
            const peer = await this.dependencies.prepare({ experimental: true, signal: this.abort.signal });
            if (!this.current(epoch)) { peer.close(); return; }
            this.peer = peer;
            peer.closed.addEventListener("abort", () => {
                if (this.current(epoch)) this.reset("disconnected", peer.closeMessage);
            }, { once: true });
            if (peer.closed.aborted) throw new Error("Viewer closed.");
            this.update({ ...this.status, phase: "ready", message: "Viewer prepared for 180 seconds. Automatic LAN admission needs no port updates; static policies require allowlisting. No capture is requested.",
                candidates: peer.candidates.map(candidate => { const fields = candidate.split(/\s+/); return `${fields[4]}:${fields[5]}`; }) });
        } catch (error) { if (this.current(epoch)) this.failure(error); }
        finally { if (this.current(epoch)) { this.busy = false; void this.refresh(); } }
    }

    async prepareAndBind(backendUrl: string, roomId: string, credential: string | DassAuthentication) {
        this.reset();
        const { epoch } = this;
        await this.prepareViewer();
        if (this.current(epoch) && this.peer && !this.peer.closed.aborted) await this.bind(backendUrl, roomId, credential);
    }

    async watch(share: DassShare) {
        const { epoch } = this;
        if (!this.current(epoch) || this.busy || !this.peer || this.status.stream) {
            return { ok: false as const, message: "Prepare one viewer in the bound context before watching." };
        }
        clearTimeout(this.poll);
        this.busy = true;
        this.update({ ...this.status, phase: "loading", message: "Subscribing through DASS; waiting for a received video track…" });
        const intercepted = routeWatch(this.routing, { transport: "dass", share });
        if (!intercepted.handled) throw new Error("DASS watch was not consumed.");
        const result = await intercepted.completion;
        if (this.current(epoch)) {
            this.busy = false;
            if (result.ok) this.update({ ...this.status, phase: "watching", message: "DASS tracks attached. Use Enable audio to permit sound playback.", stream: result.value,
                watchingShare: this.status.shares.find(listed => listed.shareId === share.shareId) ?? { roomId: share.roomId, shareId: share.shareId } });
            else this.reset("failed", result.message);
        }
        return result;
    }

    async listShares(roomId: string, signal: AbortSignal): Promise<readonly DassShare[]> {
        const { epoch } = this;
        if (!this.current(epoch) || roomId !== this.roomId || !this.signaling || signal.aborted) throw new Error("Unbound room.");
        const response = await this.signaling.request({ type: "directory", room_id: roomId }, "directory");
        if (!this.current(epoch) || signal.aborted || response.type !== "directory" || response.room_id !== roomId) throw new Error("Stale directory.");
        return response.publishers.map(publisher => ({
            roomId,
            shareId: publisher.publisher_id,
            displayName: publisher.display_name
        }));
    }

    async subscribe(share: DassShare, signal: AbortSignal) {
        const { epoch } = this;
        const { peer, signaling } = this;
        if (!this.current(epoch) || share.roomId !== this.roomId || !peer || !signaling || signal.aborted) throw new Error("Unbound viewer.");
        signal.addEventListener("abort", peer.close, { once: true });
        try {
            await peer.activate({ backendUrl: this.backendUrl, credential: "", roomId: share.roomId, publisherId: share.shareId, signaling });
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    if (peer.closed.aborted || signal.aborted || !this.current(epoch)) { cleanup(); reject(new Error("Viewer disconnected.")); }
                    else if (peer.receivedStream.getVideoTracks().some(track => track.readyState === "live")) { cleanup(); resolve(); }
                };
                const cleanup = () => {
                    peer.tracksChanged.removeEventListener("change", finish);
                    peer.closed.removeEventListener("abort", finish);
                    signal.removeEventListener("abort", finish);
                };
                peer.tracksChanged.addEventListener("change", finish);
                peer.closed.addEventListener("abort", finish, { once: true });
                signal.addEventListener("abort", finish, { once: true });
                finish();
            });
            return { stream: peer.receivedStream, close: () => { signal.removeEventListener("abort", peer.close); peer.close(); } };
        } catch (error) {
            signal.removeEventListener("abort", peer.close);
            peer.close();
            throw error;
        }
    }

    async preparePublish(): Promise<never> { throw new Error("Publishing is owned by the DASS session publisher, not the viewer routing instance."); }
}
