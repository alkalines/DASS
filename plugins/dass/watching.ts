/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { browserFailureCode, logDiagnostic } from "../../clients/spike/diagnostics";
import { routeWatch } from "./discordAdapter";
import {
    type E2eeIdentity,
    evaluateIdentity,
    identityFingerprint,
    type IdentityStore,
    trustLabel,
    unwrapEpochKey,
} from "../../clients/spike/e2ee";
import { defaultIdentityStore,deviceIdentity } from "./e2eeIdentity";
import { type DassShare, ScreenshareRouting, type ScreenshareTransport } from "./routing";
import { SpikePeer } from "../../clients/spike/peer";
import { type DassAuthentication, isAuthenticationRejected, signalingFailureMessage, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

export interface WatchStatus {
    phase: "idle" | "loading" | "ready" | "watching" | "disconnected" | "unauthorized" | "failed";
    message: string;
    shares: readonly DassShare[];
    candidates: readonly string[];
    stream?: MediaStream;
    watchingShare?: DassShare;
    closedShare?: DassShare;
    failedShare?: DassShare;
    directoryRoomId?: string;
}

/** One independently authorized room, one prepared/active decoder, no native streams. */
export class WatchController implements ScreenshareTransport {
    readonly routing = new ScreenshareRouting(this);
    private active = false;
    private epoch = 0;
    private roomId?: string;
    private contextId?: string;
    private closedContextId?: string;
    private backendUrl = "";
    private abort?: AbortController;
    private signaling?: SpikeSignaling;
    private peer?: SpikePeer;
    private poll?: ReturnType<typeof setTimeout>;
    private contextCheck?: ReturnType<typeof setInterval>;
    private busy = false;
    private identity?: E2eeIdentity;
    private identityStore?: IdentityStore;
    private publisherTrust?: string;
    private status: WatchStatus = { phase: "idle", message: "Bind a DASS room using a separate credential. Discord context is not authorization.", shares: [], candidates: [] };
    private listeners = new Set<() => void>();

    constructor(private readonly currentContext: () => string | undefined, private readonly dependencies = {
        connect: SpikeSignaling.connect,
        prepare: SpikePeer.prepare,
        identityStore: async () => defaultIdentityStore()
    }) {}

    getSnapshot = () => this.status;
    subscribeStatus = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private update(status: WatchStatus) {
        if (status.phase !== this.status.phase) logDiagnostic("viewer phase", { phase: status.phase }, status.phase === "failed" || status.phase === "unauthorized");
        this.status = status;
        for (const listener of this.listeners) listener();
    }

    start() {
        this.active = true;
        this.routing.start();
        clearInterval(this.contextCheck);
        // Also catch context loss not represented by a known Discord flux action.
        this.contextCheck = setInterval(() => {
            if (this.contextId && this.currentContext() !== this.contextId
                || this.closedContextId && this.currentContext() !== this.closedContextId) this.reset();
        }, 250);
    }

    reset(phase: WatchStatus["phase"] = "disconnected", message = "DASS viewer closed. Room binding and media were cleared.", closedShare?: DassShare, failedShare?: DassShare) {
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
        this.closedContextId = closedShare || failedShare ? this.contextId : undefined;
        this.contextId = this.roomId = undefined;
        this.busy = false;
        this.update({ phase, message, shares: [], candidates: [], closedShare, failedShare });
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
        logDiagnostic("viewer setup failed", { code: error instanceof SpikeSignalingError ? error.code : browserFailureCode(error) }, true);
        const code = error instanceof SpikeSignalingError ? error.code : "";
        const unauthorized = isAuthenticationRejected(error);
        const disconnected = ["socket", "closed", "timeout", "expired", "server:expired", "server:transport_failed"].includes(code);
        const message = error instanceof SpikeSignalingError
            ? signalingFailureMessage(error)
                : "DASS setup failed. Check TLS, room access, LAN IP matching and the UDP path. No Discord fallback.";
        if (unauthorized) this.reset("unauthorized", message);
        else this.unexpectedClose(disconnected ? "disconnected" : "failed", message);
    }

    private unexpectedClose(phase: "disconnected" | "failed", message: string) {
        const share = this.status.phase === "watching" && this.status.stream ? this.status.watchingShare : undefined;
        const failed = !share ? this.status.watchingShare : undefined;
        const metadata = (value: DassShare | undefined) => value ? { roomId: value.roomId, shareId: value.shareId, displayName: value.displayName } : undefined;
        this.reset(phase, message, metadata(share), metadata(failed));
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
        if (!result.ok) { this.unexpectedClose("failed", result.message); return; }
        this.update({ ...this.status, phase: "ready", message: "Authorized DASS shares only. Media follows the backend's LAN admission policy; no Discord fallback.",
            directoryRoomId: this.roomId, shares: result.value });
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
            const peer = await this.dependencies.prepare({ experimental: true, signal: this.abort.signal, e2ee: true });
            if (!this.current(epoch)) { peer.close(); return; }
            this.peer = peer;
            peer.closed.addEventListener("abort", () => {
                if (this.current(epoch)) this.unexpectedClose("disconnected", peer.closeMessage);
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
        this.update({ ...this.status, phase: "loading", message: "Subscribing through DASS; waiting for a received video track…",
            watchingShare: this.status.shares.find(listed => listed.roomId === share.roomId && listed.shareId === share.shareId) });
        const intercepted = routeWatch(this.routing, { transport: "dass", share });
        if (!intercepted.handled) throw new Error("DASS watch was not consumed.");
            const result = await intercepted.completion;
            if (this.current(epoch)) {
                this.busy = false;
                if (result.ok) this.update({ ...this.status, phase: "watching",
                    message: `DASS tracks attached (${this.publisherTrust ?? "E2EE — identity unverified (TOFU)"}). Use Enable audio to permit sound playback.`,
                    stream: result.value,
                    watchingShare: this.status.shares.find(listed => listed.shareId === share.shareId) ?? { roomId: share.roomId, shareId: share.shareId } });
            else this.unexpectedClose("failed", result.message);
        }
        return result;
    }

    async watchListedShare(backendUrl: string, share: DassShare, credential: string | DassAuthentication) {
        this.reset();
        const { epoch } = this;
        this.update({ ...this.status, watchingShare: { ...share } });
        await this.prepareViewer();
        if (!this.current(epoch) || !this.peer) return { ok: false as const, message: this.status.message };
        await this.bind(backendUrl, share.roomId, credential);
        if (!this.current(epoch)) return { ok: false as const, message: "DASS watching was cancelled." };
        if (this.status.phase !== "ready") return { ok: false as const, message: this.status.message };
        if (!this.status.shares.some(listed => listed.roomId === share.roomId && listed.shareId === share.shareId)) {
            this.unexpectedClose("failed", "This publisher is no longer in the authorized DASS directory.");
            return { ok: false as const, message: this.status.message };
        }
        return this.watch(share);
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
            this.identityStore ??= await this.dependencies.identityStore();
            this.identity ??= await deviceIdentity(this.identityStore);
            const { identity } = this;
            const publisherScope = `publisher/${share.roomId}/${share.shareId}`;
            const existingPin = await this.identityStore.readPeer(publisherScope).catch(() => undefined);
            await peer.activate({ backendUrl: this.backendUrl, credential: "", roomId: share.roomId, publisherId: share.shareId, signaling,
                e2ee: {
                    identityPublicKey: identity.publicKey,
                    // The approval decision carries the publisher's E2EE key.
                    // TOFU pin it on first contact; a changed key fails closed
                    // and must be explicitly re-trusted before watching.
                    trustPublisher: (publisherKey, _decision) => {
                        const fingerprintPromise = identityFingerprint(publisherKey);
                        const trust = evaluateIdentity(existingPin, publisherKey);
                        this.publisherTrust = trustLabel(trust);
                        if (trust.kind === "changed") return false;
                        if (!existingPin) {
                            void fingerprintPromise.then(fingerprint =>
                                this.identityStore?.writePeer(publisherScope, { key: publisherKey, fingerprint, verified: false })).catch(() => {});
                        }
                        return true;
                    },
                    onEpochBlob: blob => {
                        void (async () => {
                            const pin = await this.identityStore?.readPeer(publisherScope);
                            if (!pin) return;
                            const { epoch, keyBytes } = await unwrapEpochKey(identity, pin.key, `stream/${share.shareId}`, blob);
                            this.peer?.setReceiveEpoch(epoch, keyBytes);
                        })().catch(() => logDiagnostic("epoch key unwrap failed", {}, true));
                    },
                } });
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
