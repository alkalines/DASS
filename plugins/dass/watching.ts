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
    type PinnedIdentity,
    safetyNumber,
    trustLabel,
    unwrapEpochKey,
} from "../../clients/spike/e2ee";
import { defaultIdentityStore,deviceIdentity } from "./e2eeIdentity";
import { type DassShare, ScreenshareRouting, type ScreenshareTransport } from "./routing";
import { SpikePeer } from "../../clients/spike/peer";
import { type DassAuthentication, isAuthenticationRejected, signalingFailureMessage, signalingFailureReason, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

/** Backoff before each automatic re-watch of the same share after an unexpected drop. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
/** A watch that stayed up this long gets a fresh retry budget after its next drop. */
const RECONNECT_STABLE_MS = 30_000;
/** Final outcomes: denial, removal, an ended stream, rejected identity/credentials or local cancellation. */
const FINAL_FAILURES = ["rejected:unauthorized", "rejected:denied", "rejected:e2ee_unavailable", "server:revoked", "server:left",
    "denied", "approval_timeout", "cancelled"];

function retryableFailure(code: string) {
    return !!code && !FINAL_FAILURES.some(final => code === final || code.endsWith(`:${final}`));
}

/** Plain-language cause of a dropped watch; peer codes carry a `stage:` prefix. */
function dropReason(cause: string) {
    if (cause.startsWith("connection:")) return "The media connection to the DASS backend was lost.";
    return signalingFailureReason(cause.replace(/^(?!rejected:|server:)[a-z_]+:/, ""));
}

interface ReconnectTarget {
    backendUrl: string;
    share: DassShare;
    credential: string | DassAuthentication;
    contextId?: string;
    /** Automatic retries used since the last stable watch. */
    attempt: number;
    watchingSinceMs?: number;
}

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
    /** Start of the successful directory query, not when its response arrived. */
    directoryRequestedAtMs?: number;
    disconnectedAtMs?: number;
    /** E2EE trust state of the publisher this viewer is watching. */
    publisherTrust?: string;
    /** Safety number both participants compare over an independent channel. */
    publisherSafetyNumber?: string;
    /** The publisher presented a different identity key than the pinned one. */
    publisherIdentityChanged?: boolean;
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
    private reconnect?: ReconnectTarget;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private identity?: E2eeIdentity;
    private identityStore?: IdentityStore;
    private publisherTrust?: string;
    private publisherScope?: string;
    private publisherPin?: PinnedIdentity;
    private publisherPresentedKey?: string;
    private publisherSafetyNumber?: string;
    private publisherIdentityChanged = false;
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
        this.status = { ...status, publisherTrust: this.publisherTrust, publisherSafetyNumber: this.publisherSafetyNumber, publisherIdentityChanged: this.publisherIdentityChanged };
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
        this.cancelReconnect();
        this.teardown(phase, message, { closedShare, failedShare });
    }

    private cancelReconnect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.reconnect = undefined;
    }

    /** Releases media and signaling; automatic reconnect state is owned by the callers. */
    private teardown(phase: WatchStatus["phase"], message: string, retained: Pick<WatchStatus, "closedShare" | "failedShare" | "watchingShare"> = {}) {
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
        this.closedContextId = retained.closedShare || retained.failedShare ? this.contextId : undefined;
        this.contextId = this.roomId = undefined;
        this.busy = false;
        // The pinned identity is a long-lived local anchor and survives the
        // stream; only the stream-scoped trust label is cleared.
        this.publisherTrust = undefined;
        this.update({ phase, message, shares: [], candidates: [], ...retained,
            disconnectedAtMs: retained.closedShare || retained.failedShare ? Date.now() : undefined });
    }

    stop() {
        this.active = false;
        clearInterval(this.contextCheck);
        this.contextCheck = undefined;
        this.reset();
        this.publisherScope = undefined;
        this.publisherPin = undefined;
        this.publisherPresentedKey = undefined;
        this.publisherSafetyNumber = undefined;
        this.publisherIdentityChanged = false;
        this.routing.stop();
    }

    private current(epoch: number) {
        return this.active && this.epoch === epoch && !!this.contextId && this.currentContext() === this.contextId;
    }

    private failure(error: unknown) {
        const code = error instanceof SpikeSignalingError ? error.code : "";
        logDiagnostic("viewer setup failed", { code: code || browserFailureCode(error) }, true);
        const unauthorized = isAuthenticationRejected(error) || code === "server:revoked";
        const disconnected = ["socket", "closed", "timeout", "expired", "server:left", "server:expired", "server:transport_failed"].includes(code);
        const message = error instanceof SpikeSignalingError
            ? signalingFailureMessage(error)
                : "DASS setup failed. Check TLS, room access, LAN IP matching and the UDP path. No Discord fallback.";
        if (unauthorized) this.reset("unauthorized", message);
        else this.unexpectedClose(disconnected ? "disconnected" : "failed", message, code);
    }

    /** `cause` is a signaling or `stage:code` peer failure; only transient causes re-watch the same share. */
    private unexpectedClose(phase: "disconnected" | "failed", message: string, cause = "") {
        const watched = this.status.phase === "watching" && this.status.stream ? this.status.watchingShare : undefined;
        const metadata = (value: DassShare | undefined) => value ? { roomId: value.roomId, shareId: value.shareId, displayName: value.displayName } : undefined;
        const target = this.reconnect;
        if (target && (watched || target.attempt > 0)) {
            if (target.watchingSinceMs !== undefined && Date.now() - target.watchingSinceMs >= RECONNECT_STABLE_MS) target.attempt = 0;
            target.watchingSinceMs = undefined;
            if (retryableFailure(cause) && target.attempt < RECONNECT_DELAYS_MS.length && this.active && this.currentContext() === target.contextId) {
                this.scheduleReconnect(target, cause);
                return;
            }
            if (target.attempt > 0) logDiagnostic("viewer reconnect stopped", { code: cause || "none", attempt: target.attempt }, true);
            const stopped = target.attempt > 0 ? ` Automatic reconnection stopped after ${target.attempt} attempt${target.attempt === 1 ? "" : "s"}.` : "";
            this.reset(phase, `${message}${stopped}`, metadata(watched ?? target.share));
            return;
        }
        const failed = !watched ? this.status.watchingShare : undefined;
        this.reset(phase, message, metadata(watched), metadata(failed));
    }

    private scheduleReconnect(target: ReconnectTarget, cause: string) {
        const delayMs = RECONNECT_DELAYS_MS[target.attempt];
        target.attempt++;
        logDiagnostic("viewer reconnect scheduled", { code: cause, attempt: target.attempt }, true);
        this.teardown("loading", `${dropReason(cause)} [${cause}] Reconnecting in ${Math.round(delayMs / 1000)} s (attempt ${target.attempt} of ${RECONNECT_DELAYS_MS.length})…`,
            { watchingShare: { ...target.share } });
        // A context change while waiting cancels the retry through the normal context check.
        this.closedContextId = target.contextId;
        this.reconnect = target;
        clearTimeout(this.reconnectTimer);
        const timer = setTimeout(() => {
            if (this.reconnectTimer !== timer) return;
            this.reconnectTimer = undefined;
            if (this.reconnect === target && this.active && this.currentContext() === target.contextId) void this.connectListedShare(target);
        }, delayMs);
        this.reconnectTimer = timer;
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
        const directoryRequestedAtMs = Date.now();
        const result = await this.routing.detect(this.roomId);
        if (!this.current(epoch)) return;
        this.busy = false;
        if (!result.ok) { this.unexpectedClose("failed", result.message); return; }
        this.update({ ...this.status, phase: "ready", message: "Authorized DASS shares only. Media follows the backend's LAN admission policy; no Discord fallback.",
            directoryRoomId: this.roomId, directoryRequestedAtMs, shares: result.value });
        // Pace directory requests independently of the session lifetime.
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
                if (this.current(epoch)) this.unexpectedClose("disconnected", peer.closeMessage, peer.closeCode ?? "");
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
        this.update({ ...this.status, phase: "loading", message: "Waiting for the streamer to approve your request, then connecting…",
            watchingShare: this.status.shares.find(listed => listed.roomId === share.roomId && listed.shareId === share.shareId) });
        const intercepted = routeWatch(this.routing, { transport: "dass", share });
        if (!intercepted.handled) throw new Error("DASS watch was not consumed.");
            const result = await intercepted.completion;
        if (this.current(epoch)) {
            this.busy = false;
            if (result.ok) {
                if (this.reconnect) this.reconnect.watchingSinceMs = Date.now();
                this.update({ ...this.status, phase: "watching",
                    message: `DASS tracks attached (${this.publisherTrust ?? "E2EE — identity unverified (TOFU)"}). Use Enable audio to permit sound playback.`,
                    stream: result.value,
                    watchingShare: this.status.shares.find(listed => listed.shareId === share.shareId) ?? { roomId: share.roomId, shareId: share.shareId } });
            } else this.unexpectedClose("failed", result.message);
        }
        return result;
    }

    async watchListedShare(backendUrl: string, share: DassShare, credential: string | DassAuthentication) {
        this.cancelReconnect();
        return this.connectListedShare({ backendUrl, share: { ...share }, credential, contextId: this.currentContext(), attempt: 0 });
    }

    /** One watch attempt for a directory share; also the automatic reconnect entry point. */
    private async connectListedShare(target: ReconnectTarget) {
        const { share } = target;
        this.teardown(target.attempt ? "loading" : "disconnected", target.attempt
            ? `Reconnecting to the stream (attempt ${target.attempt} of ${RECONNECT_DELAYS_MS.length})…`
            : "DASS viewer closed. Room binding and media were cleared.", { watchingShare: { ...share } });
        this.reconnect = target;
        const { epoch } = this;
        await this.prepareViewer();
        if (!this.current(epoch) || !this.peer) return { ok: false as const, message: this.status.message };
        await this.bind(target.backendUrl, share.roomId, target.credential);
        if (!this.current(epoch)) return { ok: false as const, message: "DASS watching was cancelled." };
        if (this.status.phase !== "ready") return { ok: false as const, message: this.status.message };
        if (!this.status.shares.some(listed => listed.roomId === share.roomId && listed.shareId === share.shareId)) {
            if (target.attempt) this.unexpectedClose("disconnected", "The stream ended while reconnecting.");
            else this.unexpectedClose("failed", "This publisher is no longer in the authorized DASS directory.");
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
            const { identity, identityStore } = this;
            // The pin scope is the publisher's account, not the stream instance:
            // a changed publisher key must be detected across streams instead
            // of looking like a first contact.
            let publisherPin: PinnedIdentity | undefined;
            let resolvePin: ((pin: PinnedIdentity) => void) | undefined;
            const pinReady = new Promise<PinnedIdentity>(resolve => { resolvePin = resolve; });
            await peer.activate({ backendUrl: this.backendUrl, credential: "", roomId: share.roomId, publisherId: share.shareId, signaling,
                e2ee: {
                    identityPublicKey: identity.publicKey,
                    // The approval decision carries the publisher's E2EE key and
                    // account. TOFU pin it on first contact; a changed key fails
                    // closed and must be explicitly re-trusted before watching.
                    trustPublisher: async (publisherKey, decision) => {
                        const scope = `publisher/${decision.publisher_account}`;
                        publisherPin = await identityStore.readPeer(scope).catch(() => undefined);
                        const trust = evaluateIdentity(publisherPin, publisherKey);
                        this.publisherTrust = trustLabel(trust);
                        this.publisherScope = scope;
                        this.publisherPin = publisherPin;
                        this.publisherPresentedKey = publisherKey;
                        this.publisherIdentityChanged = trust.kind === "changed";
                        if (trust.kind === "changed") {
                            if (publisherPin) resolvePin?.(publisherPin);
                            return false;
                        }
                        if (!publisherPin) {
                            // The pin is stored before subscribing, so a relayed
                            // epoch key can never arrive before its anchor.
                            publisherPin = { key: publisherKey, fingerprint: await identityFingerprint(publisherKey), verified: false };
                            await identityStore.writePeer(scope, publisherPin);
                        }
                        this.publisherPin = publisherPin;
                        this.publisherSafetyNumber = await safetyNumber(identity.publicKey, publisherPin.key);
                        resolvePin?.(publisherPin);
                        return true;
                    },
                    onEpochBlob: blob => {
                        void (async () => {
                            const pin = await pinReady;
                            const { epoch, keyBytes } = await unwrapEpochKey(identity, pin.key, `stream/${share.shareId}`, blob);
                            this.peer?.setReceiveEpoch(epoch, keyBytes);
                            // The publisher switches to a new epoch only after relaying
                            // it, so frames under the previous epoch may still arrive.
                            // Keep exactly one previous epoch; older keys are dropped.
                            this.peer?.retireEpochsBelow(epoch - 1);
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

    /**
     * Mark the publisher identity as independently verified after the
     * participants compared the safety number over an independent channel.
     */
    async verifyPublisherIdentity() {
        const scope = this.publisherScope;
        const pin = this.publisherPin;
        if (!scope || !pin) return;
        await this.identityStore?.writePeer(scope, { ...pin, verified: true });
        this.publisherPin = { ...pin, verified: true };
        this.publisherTrust = trustLabel({ kind: "verified" });
        this.update({ ...this.status });
    }

    /**
     * Explicitly accept a changed publisher identity after review. The next
     * watch attempt pins the presented key as an unverified TOFU anchor.
     */
    async acceptPublisherIdentity() {
        const scope = this.publisherScope;
        const key = this.publisherPresentedKey;
        if (!scope || !key) return;
        const pin = { key, fingerprint: await identityFingerprint(key), verified: false };
        await this.identityStore?.writePeer(scope, pin);
        this.publisherPin = pin;
        this.publisherIdentityChanged = false;
        this.publisherTrust = trustLabel({ kind: "tofu" });
        this.update({ ...this.status });
    }

    async preparePublish(): Promise<never> { throw new Error("Publishing is owned by the DASS session publisher, not the viewer routing instance."); }
}
