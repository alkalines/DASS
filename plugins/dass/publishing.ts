/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createEquibopCapture, type EquibopCaptureBridge } from "./capture";
import { browserFailureCode, logDiagnostic } from "../../clients/spike/diagnostics";
import {
    type E2eeIdentity,
    evaluateIdentity,
    generateEpochKey,
    identityFingerprint,
    type IdentityStore,
    type IdentityTrust,
    safetyNumber,
    wrapEpochKey,
} from "../../clients/spike/e2ee";
import { defaultIdentityStore,deviceIdentity } from "./e2eeIdentity";
import { type CaptureLease } from "./routing";
import { type DassSession } from "./session";
import { preparationFailureMessage, SpikePeer } from "../../clients/spike/peer";
import { isAuthenticationRejected, signalingFailureMessage, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

export interface PendingViewer {
    requestId: string;
    viewerId: string;
    displayName: string;
    /** Pinned-identity trust for the key this viewer presented. */
    trust: IdentityTrust;
    /** Safety number both participants compare over an independent channel. */
    safetyNumber?: string;
}

export interface ApprovedViewer {
    viewerId: string;
}

export interface PublishStatus {
    phase: "idle" | "authenticating" | "capturing" | "preparing" | "prepared" | "activating" | "publishing" | "failed";
    message: string;
    candidates: readonly string[];
    viewerCount?: number;
    pendingViewers: readonly PendingViewer[];
    approvedViewers: readonly ApprovedViewer[];
}

/** The picker (including quality/audio consent) has returned an owned capture. */
export function hasAcceptedPublishCapture(phase: PublishStatus["phase"]): boolean {
    return ["preparing", "prepared", "activating", "publishing"].includes(phase);
}

export interface PublishDependencies {
    connect: typeof SpikeSignaling.connect;
    prepare: typeof SpikePeer.prepare;
    identityStore: () => Promise<IdentityStore>;
    /** Publisher policy: admit only independently verified viewers. */
    requireVerifiedViewers?: () => boolean;
    /** Publisher policy: approve eligible viewers without a prompt. */
    autoApproveViewers?: () => boolean;
    /** Override for deterministic async key-wrap race tests. */
    wrapEpochKey?: typeof wrapEpochKey;
}

/** Owns publishing independently of settings/modal mounting and Discord's native stream. */
export class PublishController {
    private active = false;
    private operation?: { abort: AbortController; contextId: string; peer?: SpikePeer; signaling?: SpikeSignaling; capture?: CaptureLease; sessionId?: string;
        identity?: E2eeIdentity; store?: IdentityStore; epoch?: number; epochKey?: Uint8Array;
        /** Only keys attached to a successfully approved request are eligible for delivery/rekey. */
        viewerKeys?: Map<string, string>; requestKeys?: Map<string, { viewerId: string; key: string; trust: IdentityTrust; deciding?: boolean }>;
        membershipVersions?: Map<string, number>; membershipTokens?: Map<string, object>; membershipQueue?: Promise<void>; };
    private contextCheck?: ReturnType<typeof setInterval>;
    private sourceChange?: AbortController;
    private listeners = new Set<() => void>();
    private status: PublishStatus = { phase: "idle", message: "No DASS share is running.", candidates: [], pendingViewers: [], approvedViewers: [] };

    constructor(private readonly session: DassSession, private readonly currentContext: () => string | undefined,
        private readonly dependencies: PublishDependencies = { connect: SpikeSignaling.connect, prepare: SpikePeer.prepare, identityStore: async () => defaultIdentityStore(), requireVerifiedViewers: () => false }) {}

    getSnapshot = () => this.status;
    getPreviewStream = () => this.operation && this.current(this.operation) ? this.operation.capture?.stream : undefined;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    private update(status: PublishStatus) {
        if (status.phase !== this.status.phase) logDiagnostic("publisher phase", { phase: status.phase }, status.phase === "failed");
        this.status = status;
        for (const listener of this.listeners) listener();
    }
    start() {
        this.active = true;
        clearInterval(this.contextCheck);
        this.contextCheck = setInterval(() => {
            if (this.operation && this.currentContext() !== this.operation.contextId) this.reset();
        }, 250);
    }
    reset(message = "DASS sharing stopped. Capture and connection resources were released.") {
        this.sourceChange?.abort();
        this.sourceChange = undefined;
        const { operation } = this;
        this.operation = undefined;
        operation?.abort.abort();
        operation?.peer?.close();
        operation?.signaling?.close();
        // Teardown stops the captured tracks even when the host release is
        // uncertain: a stopped track can never leak another frame.
        const stream = operation?.capture?.stream;
        if (stream && typeof stream.getTracks === "function") {
            for (const track of stream.getTracks()) track.stop();
        }
        operation?.capture?.release();
        this.update({ phase: "idle", message, candidates: [], pendingViewers: [], approvedViewers: [] });
    }
    stop() {
        this.active = false;
        clearInterval(this.contextCheck);
        this.contextCheck = undefined;
        this.reset();
    }
    private current(operation: NonNullable<PublishController["operation"]>) {
        return this.active && this.operation === operation && !operation.abort.signal.aborted && this.currentContext() === operation.contextId;
    }

    async changeSource(backendUrl: string, bridge?: EquibopCaptureBridge) {
        const { operation } = this;
        if (!operation || !this.current(operation) || !hasAcceptedPublishCapture(this.status.phase) || this.sourceChange) return;
        const released = operation.capture?.release();
        operation.capture = undefined;
        this.reset();
        const request = new AbortController();
        this.sourceChange = request;
        try {
            await released;
            if (request.signal.aborted || !this.active || this.currentContext() !== operation.contextId) return;
            this.sourceChange = undefined;
            await this.publish(backendUrl, bridge);
        } catch {
            if (!request.signal.aborted) this.update({ phase: "failed", message: "Could not release the old capture. Restart the client before sharing again.", candidates: [], pendingViewers: [], approvedViewers: [] });
        } finally {
            if (this.sourceChange === request) this.sourceChange = undefined;
        }
    }

    async publish(backendUrl: string, bridge?: EquibopCaptureBridge, prepareOnly = false) {
        if (!this.active || this.operation || this.sourceChange) return;
        const contextId = this.currentContext();
        if (!contextId) return;
        let access: ReturnType<DassSession["getAccess"]>;
        try { access = this.session.getAccess(); }
        catch { this.update({ phase: "failed", message: "Set up your DASS session first. No Discord fallback.", candidates: [], pendingViewers: [], approvedViewers: [] }); return; }
        const operation: NonNullable<PublishController["operation"]> = { abort: new AbortController(), contextId };
        this.operation = operation;
        this.update({ phase: "authenticating", message: "Authenticating DASS before opening capture…", candidates: [], pendingViewers: [], approvedViewers: [] });
        try {
            // Prepare-only retains the old exact-endpoint workflow: no WSS until the server has been recreated.
            if (!prepareOnly) {
                operation.signaling = await this.dependencies.connect({ experimental: true, backendUrl, ...access, signal: operation.abort.signal });
                if (!this.current(operation)) { operation.signaling.close(); return; }
                operation.signaling.closed.addEventListener("abort", () => {
                    if (this.current(operation)) {
                        const { reason } = operation.signaling!.closed;
                        logDiagnostic("publisher signaling closed", { code: reason instanceof SpikeSignalingError ? reason.code : "unknown" }, true);
                        if (isAuthenticationRejected(reason)) this.session.clear();
                        this.fail(operation, signalingFailureMessage(reason));
                    }
                }, { once: true });
                if (operation.signaling.closed.aborted) throw operation.signaling.closed.reason;
            }
            this.update({ phase: "capturing", message: "Choose a source in the screen picker. Share audio is optional and explicit.", candidates: [], pendingViewers: [], approvedViewers: [] });
            const capture = await createEquibopCapture(bridge)(operation.abort.signal);
            if (!this.current(operation)) { capture.release(); return; }
            operation.capture = capture;
            this.update({ phase: "preparing", message: "Preparing Chromium's DASS connection with mandatory E2EE…", candidates: [], pendingViewers: [], approvedViewers: [] });
            operation.store ??= await this.dependencies.identityStore();
            operation.identity ??= await deviceIdentity(operation.store);
            operation.peer = await this.dependencies.prepare({ experimental: true, signal: operation.abort.signal, capture, e2ee: true });
            if (!this.current(operation)) { operation.peer.close(); return; }
            operation.peer.closed.addEventListener("abort", () => {
                if (this.current(operation)) this.fail(operation, operation.peer!.closeMessage);
            }, { once: true });
            if (operation.peer.closed.aborted) throw new Error("Peer closed.");
            this.update({ phase: "prepared", message: "Capture is local. Allowlist these UDP endpoints, then start within 180 seconds.",
                candidates: operation.peer.candidates.map(candidate => { const fields = candidate.split(/\s+/); return `${fields[4]}:${fields[5]}`; }), pendingViewers: [], approvedViewers: [] });
            if (!prepareOnly) await this.activate(backendUrl);
        } catch (error) {
            if (this.current(operation)) {
                logDiagnostic("publisher setup failed", { phase: this.status.phase,
                    code: error instanceof SpikeSignalingError ? error.code : browserFailureCode(error),
                    preparation: this.status.phase === "preparing" ? preparationFailureMessage(error) : "not_preparing" }, true);
                if (isAuthenticationRejected(error)) this.session.clear();
                this.fail(operation, this.status.phase === "authenticating" ? signalingFailureMessage(error) : preparationFailureMessage(error));
            }
        }
    }

    async activate(backendUrl: string) {
        const { operation } = this;
        if (!operation?.peer || !this.current(operation) || this.status.phase !== "prepared") return;
        this.update({ ...this.status, phase: "activating", message: "Starting DASS media. No native Discord share or preview is created." });
        try {
            const access = this.session.getAccess();
            if (!operation.signaling) operation.signaling = await this.dependencies.connect({ experimental: true, backendUrl, ...access, signal: operation.abort.signal });
            if (!this.current(operation)) { operation.signaling.close(); return; }
            operation.store ??= await this.dependencies.identityStore();
            operation.identity ??= await deviceIdentity(operation.store);
            operation.sessionId = await operation.peer.activate({ backendUrl, ...access, signaling: operation.signaling,
                e2ee: { identityPublicKey: operation.identity.publicKey },
                onViewerPresence: presence => {
                if (this.current(operation)) this.update({ ...this.status, viewerCount: presence.viewer_count });
            } });
            // Publisher-controlled admission: policy may approve unchanged keys
            // automatically. Each approval grants one subscription for this stream.
            if (operation.sessionId && this.current(operation) && typeof operation.signaling.onViewRequests === "function") {
                operation.signaling.onViewRequests(operation.sessionId, viewRequest => {
                    if (!this.current(operation)) return;
                    // E2EE membership gate: the publisher pins the presented
                    // viewer identity. A changed key pauses admission until the
                    // publisher explicitly re-confirms — never silently trusted.
                    const { store } = operation;
                    if (!store) return;
                    const requestKeys = operation.requestKeys ??= new Map();
                    // A duplicate request id cannot replace the device/key of an
                    // already observed request while its asynchronous trust check runs.
                    if (requestKeys.has(viewRequest.request_id) || requestKeys.size >= 16) return;
                    const requestKey = { viewerId: viewRequest.viewer_id, key: viewRequest.viewer_key, trust: { kind: "first-contact" } as IdentityTrust };
                    requestKeys.set(viewRequest.request_id, requestKey);
                    operation.signaling?.onViewRequestClosed?.(operation.sessionId!, viewRequest.request_id, () => {
                        if (requestKeys.get(viewRequest.request_id) !== requestKey) return;
                        requestKeys.delete(viewRequest.request_id);
                        this.update({ ...this.status, pendingViewers: this.status.pendingViewers.filter(viewer => viewer.requestId !== viewRequest.request_id) });
                    });
                    void store.readPeer(viewRequest.viewer_id)
                        .then(pin => evaluateIdentity(pin, requestKey.key))
                        .then(trust => {
                            if (!this.current(operation) || requestKeys.get(viewRequest.request_id) !== requestKey) return;
                            requestKey.trust = trust;
                            const pending = [...this.status.pendingViewers.filter(existing => existing.requestId !== viewRequest.request_id),
                                { requestId: viewRequest.request_id, viewerId: viewRequest.viewer_id, displayName: viewRequest.viewer_display_name, trust }];
                            this.update({ ...this.status, pendingViewers: pending });
                            if (this.willAutoApprove(trust)) void this.decideView(viewRequest.request_id, "approve");
                            // The safety number needs a digest, so it fills in
                            // once it is computed.
                            const { identity } = operation;
                            if (!identity) return;
                            void safetyNumber(identity.publicKey, requestKey.key).then(safety => {
                                if (!this.current(operation) || requestKeys.get(viewRequest.request_id) !== requestKey
                                    || !this.status.pendingViewers.some(viewer => viewer.requestId === viewRequest.request_id)) return;
                                this.update({
                                    ...this.status,
                                    pendingViewers: this.status.pendingViewers.map(viewer =>
                                        viewer.requestId === viewRequest.request_id ? { ...viewer, safetyNumber: safety } : viewer),
                                });
                            });
                        })
                        .catch(() => {
                            if (requestKeys.get(viewRequest.request_id) === requestKey) requestKeys.delete(viewRequest.request_id);
                            logDiagnostic("view request trust evaluation failed", {}, true);
                        });
                });
            }
            if (this.current(operation)) this.update({ ...this.status, phase: "publishing", message: "DASS negotiation complete. The stream appears in the directory once media connects. Close this panel to keep sharing, or Stop sharing to end capture." });
        } catch (error) {
            logDiagnostic("publisher activation failed", { code: error instanceof SpikeSignalingError ? error.code : browserFailureCode(error),
                diagnostic: operation.peer.closeMessage }, true);
            if (this.current(operation)) {
                if (isAuthenticationRejected(error)) this.session.clear();
                this.fail(operation, error instanceof SpikeSignalingError ? signalingFailureMessage(error)
                    : operation.peer.closeMessage || "DASS activation failed. Check the server's UDP policy. No Discord fallback.");
            }
        }
    }

    /** Publisher decision for one pending view request. Approving pins the
     * viewer's presented E2EE identity and relays the current media epoch key
     * to them; a changed identity must be explicitly re-confirmed first. */
    async decideView(requestId: string, decision: "approve" | "deny" | "block") {
        const { operation } = this;
        if (!operation?.signaling || !operation.sessionId || !this.current(operation)) return;
        const prior = operation.membershipQueue ?? Promise.resolve();
        const next = prior.then(() => this.decideViewQueued(operation, requestId, decision));
        operation.membershipQueue = next.then(() => {}, () => {});
        await next;
    }

    /** Auto-approval never covers a changed identity or bypasses the verified-viewer policy. */
    willAutoApprove(trust: IdentityTrust) {
        if (!this.dependencies.autoApproveViewers?.() || trust.kind === "changed") return false;
        return !this.dependencies.requireVerifiedViewers?.() || trust.kind === "verified";
    }

    private async decideViewQueued(operation: NonNullable<PublishController["operation"]>, requestId: string, decision: "approve" | "deny" | "block") {
        if (!operation.signaling || !operation.sessionId || !this.current(operation)) return;
        const request = this.status.pendingViewers.find(pending => pending.requestId === requestId);
        const requestKey = operation.requestKeys?.get(requestId);
        if (!request || !requestKey || requestKey.viewerId !== request.viewerId || requestKey.deciding) return;
        if (decision === "approve" && requestKey.trust.kind === "changed") {
            this.update({ ...this.status, message: "This viewer's E2EE identity changed. Confirm the new identity before approving." });
            return;
        }
        if (decision === "approve" && this.dependencies.requireVerifiedViewers?.() && requestKey.trust.kind !== "verified") {
            this.update({ ...this.status, message: "This viewer's identity is not independently verified. Compare the safety number before approving." });
            return;
        }
        const admittedKey = operation.viewerKeys?.get(requestKey.viewerId);
        if (decision === "approve" && admittedKey && admittedKey !== requestKey.key) {
            this.update({ ...this.status, message: "This account already has an approved device. Remove it before approving another device key." });
            return;
        }
        const versions = operation.membershipVersions ??= new Map();
        const hadMembership = operation.viewerKeys?.has(requestKey.viewerId) ?? false;
        if (decision !== "approve") {
            versions.set(requestKey.viewerId, (versions.get(requestKey.viewerId) ?? 0) + 1);
            for (const [id, pending] of operation.requestKeys ?? []) {
                if (id !== requestId && pending.viewerId === requestKey.viewerId) operation.requestKeys!.delete(id);
            }
            operation.viewerKeys?.delete(requestKey.viewerId);
            operation.membershipTokens?.delete(requestKey.viewerId);
            this.update({ ...this.status,
                pendingViewers: this.status.pendingViewers.filter(pending => pending.viewerId !== requestKey.viewerId || pending.requestId === requestId),
                approvedViewers: this.status.approvedViewers.filter(viewer => viewer.viewerId !== requestKey.viewerId),
            });
        }
        const version = versions.get(requestKey.viewerId) ?? 0;
        try {
            requestKey.deciding = true;
            await operation.signaling.decideView(operation.sessionId, requestId, decision);
        } catch (error) {
            logDiagnostic("publisher decision failed", { code: error instanceof SpikeSignalingError ? error.code : "unknown" }, true);
            if (operation.requestKeys?.get(requestId) === requestKey) operation.requestKeys.delete(requestId);
            if (this.current(operation)) this.update({ ...this.status, pendingViewers: this.status.pendingViewers.filter(pending => pending.requestId !== requestId) });
            if (decision !== "approve" && hadMembership && this.current(operation)) {
                this.fail(operation, "Viewer denial/removal could not be confirmed. Publishing stopped fail-closed.");
                return;
            }
            if (this.current(operation)) this.update({ ...this.status, message: "The DASS decision could not be sent; the request expired unapproved." });
            return;
        }
        if (!this.current(operation) || operation.requestKeys?.get(requestId) !== requestKey
            || (versions.get(requestKey.viewerId) ?? 0) !== version) return;
        operation.requestKeys?.delete(requestId);
        const pendingViewers = this.status.pendingViewers.filter(pending => pending.requestId !== requestId);
        const approvedViewers = decision === "approve" && request
            ? [...this.status.approvedViewers.filter(viewer => viewer.viewerId !== request.viewerId), { viewerId: request.viewerId }]
            : this.status.approvedViewers;
        this.update({ ...this.status, pendingViewers, approvedViewers });
        if (decision === "approve" && request) {
            // Same-key reconnects are allowed, but a different device must
            // never silently replace an admitted key. Rotate on every admission.
            operation.viewerKeys ??= new Map();
            operation.viewerKeys.set(requestKey.viewerId, requestKey.key);
            const token = {};
            (operation.membershipTokens ??= new Map()).set(requestKey.viewerId, token);
            await this.deliverEpoch(operation, requestKey.viewerId, requestKey.key, token);
        } else if (decision !== "approve" && request) {
            for (const [id, pending] of operation.requestKeys ?? []) {
                if (pending.viewerId === requestKey.viewerId) operation.requestKeys!.delete(id);
            }
            operation.viewerKeys?.delete(requestKey.viewerId);
            operation.membershipTokens?.delete(requestKey.viewerId);
            this.update({ ...this.status,
                pendingViewers: this.status.pendingViewers.filter(pending => pending.viewerId !== requestKey.viewerId),
                approvedViewers: this.status.approvedViewers.filter(viewer => viewer.viewerId !== requestKey.viewerId),
            });
        }
        // Deny/block can also evict an already-approved session of the same
        // account; rotate so it cannot decrypt further frames.
        if (decision !== "approve" && operation.epoch !== undefined) await this.rotateEpoch(operation);
    }

    /** Rotate membership to a fresh epoch and persist the newly accepted identity pin. */
    private async deliverEpoch(operation: NonNullable<PublishController["operation"]>, viewerId: string, viewerKey: string, membershipToken: object) {
        // A newly admitted viewer must never receive an epoch that protected
        // frames before their approval. Rotate for the entire immutable roster.
        await this.rotateEpoch(operation);
        if (!this.current(operation) || operation.viewerKeys?.get(viewerId) !== viewerKey
            || operation.membershipTokens?.get(viewerId) !== membershipToken) return;
        try {
            const pin = await operation.store?.readPeer(viewerId);
            if (!pin && this.current(operation) && operation.viewerKeys?.get(viewerId) === viewerKey
                && operation.membershipTokens?.get(viewerId) === membershipToken) {
                const fingerprint = await identityFingerprint(viewerKey);
                if (this.current(operation) && operation.viewerKeys?.get(viewerId) === viewerKey
                    && operation.membershipTokens?.get(viewerId) === membershipToken)
                    await operation.store?.writePeer(viewerId, { key: viewerKey, fingerprint, verified: false });
            }
        } catch {
            logDiagnostic("viewer identity pin persistence failed", {}, true);
        }
    }

    /** Rekey after viewer removal so removed viewers keep only past epochs. */
    private async rotateEpoch(operation: NonNullable<PublishController["operation"]>) {
        if (!this.current(operation)) return;
        if (!operation.peer || !operation.signaling || !operation.identity || !operation.sessionId) {
            this.fail(operation, "A fresh approved-viewer epoch could not be prepared. Publishing stopped fail-closed.");
            return;
        }
        const members = [...(operation.viewerKeys ?? [])].map(([viewerId, viewerKey]) => ({
            viewerId, viewerKey, token: operation.membershipTokens?.get(viewerId),
        })).filter(member => member.token && this.status.approvedViewers.some(viewer => viewer.viewerId === member.viewerId));
        const epoch = (operation.epoch ?? 0) + 1;
        const epochKey = generateEpochKey();
        const current = () => this.current(operation) && members.every(member =>
            operation.viewerKeys?.get(member.viewerId) === member.viewerKey && operation.membershipTokens?.get(member.viewerId) === member.token
            && this.status.approvedViewers.some(viewer => viewer.viewerId === member.viewerId));
        try {
            // Prepare all wraps before committing send state. Membership must
            // remain unchanged across asynchronous crypto and each relay.
            const wrapped = await Promise.all(members.map(async member => ({ ...member,
                blob: await (this.dependencies.wrapEpochKey ?? wrapEpochKey)(operation.identity!, member.viewerKey, `stream/${operation.sessionId}`, epoch, epochKey),
            })));
            if (!current()) return;
            operation.peer.setSendEpoch(epoch, epochKey);
            operation.epoch = epoch;
            operation.epochKey = epochKey;
            try { operation.peer.retireEpochsBelow(epoch); } catch {}
            for (const member of wrapped) {
                if (!current()) throw new Error("Membership changed during epoch relay.");
                await operation.signaling.keyRelay(operation.sessionId, member.viewerId, member.blob);
                if (!current()) throw new Error("Membership changed during epoch relay.");
            }
        } catch (error) {
            logDiagnostic("epoch rekey failed; publishing stopped", { code: error instanceof SpikeSignalingError ? error.code : "unknown" }, true);
            this.fail(operation, "A fresh approved-viewer epoch could not be installed and distributed. Publishing stopped fail-closed.");
        }
    }

    /** Withdraw an approved or watching viewer account entirely. The media
     * epoch rotates so the removed viewer cannot decrypt further frames. */
    async removeViewer(viewerId: string) {
        const { operation } = this;
        if (!operation?.signaling || !operation.sessionId || !this.current(operation)) return;
        const versions = operation.membershipVersions ??= new Map();
        versions.set(viewerId, (versions.get(viewerId) ?? 0) + 1);
        for (const [requestId, pending] of operation.requestKeys ?? []) {
            if (pending.viewerId === viewerId) operation.requestKeys!.delete(requestId);
        }
        operation.membershipTokens?.delete(viewerId);
        // Revoke local delivery eligibility before awaiting the backend so a
        // queued wrap/rekey completion cannot relay to a removed account.
        operation.viewerKeys?.delete(viewerId);
        this.update({ ...this.status,
            pendingViewers: this.status.pendingViewers.filter(pending => pending.viewerId !== viewerId),
            approvedViewers: this.status.approvedViewers.filter(viewer => viewer.viewerId !== viewerId),
        });
        const prior = operation.membershipQueue ?? Promise.resolve();
        const next = prior.then(async () => {
            await operation.signaling!.removeViewer(operation.sessionId!, viewerId);
            if (this.current(operation)) await this.rotateEpoch(operation);
        });
        operation.membershipQueue = next.then(() => {}, () => {});
        try {
            await next;
        } catch (error) {
            logDiagnostic("viewer removal failed", { code: error instanceof SpikeSignalingError ? error.code : "unknown" }, true);
            this.fail(operation, "Viewer removal could not be confirmed. Publishing stopped fail-closed.");
            return;
        }
        if (!this.current(operation)) return;
    }

    /** Explicitly accept a viewer's changed E2EE identity after review. */
    async acceptViewerIdentity(requestId: string) {
        const { operation } = this;
        const pending = this.status.pendingViewers.find(viewer => viewer.requestId === requestId);
        const requestKey = pending && operation?.requestKeys?.get(requestId);
        const key = requestKey?.key;
        if (!operation?.store || !requestKey || !key) return;
        const fingerprint = await identityFingerprint(key);
        if (!this.current(operation) || operation.requestKeys?.get(requestId) !== requestKey) return;
        await operation.store.writePeer(pending!.viewerId, { key, fingerprint, verified: false });
        if (!this.current(operation) || operation.requestKeys?.get(requestId) !== requestKey) return;
        requestKey.trust = { kind: "tofu" };
        this.update({
            ...this.status,
            pendingViewers: this.status.pendingViewers.map(pending =>
                pending.requestId === requestId ? { ...pending, trust: { kind: "tofu" } } : pending),
        });
        if (this.willAutoApprove(requestKey.trust)) await this.decideView(requestId, "approve");
    }

    /** Mark a viewer's identity as independently verified after the
     * participants compared the safety number over an independent channel. */
    async verifyViewerIdentity(requestId: string) {
        const { operation } = this;
        const pending = this.status.pendingViewers.find(viewer => viewer.requestId === requestId);
        const requestKey = pending && operation?.requestKeys?.get(requestId);
        const key = requestKey?.key;
        if (!operation?.store || !requestKey || !key) return;
        const fingerprint = await identityFingerprint(key);
        if (!this.current(operation) || operation.requestKeys?.get(requestId) !== requestKey) return;
        await operation.store.writePeer(pending!.viewerId, { key, fingerprint, verified: true });
        if (!this.current(operation) || operation.requestKeys?.get(requestId) !== requestKey) return;
        requestKey.trust = { kind: "verified" };
        this.update({
            ...this.status,
            pendingViewers: this.status.pendingViewers.map(pending =>
                pending.requestId === requestId ? { ...pending, trust: { kind: "verified" } } : pending),
        });
        if (this.willAutoApprove(requestKey.trust)) await this.decideView(requestId, "approve");
    }

    private fail(operation: NonNullable<PublishController["operation"]>, message: string) {
        if (this.operation !== operation) return;
        this.reset();
        this.update({ phase: "failed", message, candidates: [], pendingViewers: [], approvedViewers: [] });
    }
}
