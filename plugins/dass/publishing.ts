/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createEquibopCapture, type EquibopCaptureBridge } from "./capture";
import { browserFailureCode, logDiagnostic } from "../../clients/spike/diagnostics";
import { type CaptureLease } from "./routing";
import { type DassSession } from "./session";
import { preparationFailureMessage, SpikePeer } from "../../clients/spike/peer";
import { isAuthenticationRejected, signalingFailureMessage, SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";

export interface PendingViewer {
    requestId: string;
    viewerId: string;
    displayName: string;
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

/** Owns publishing independently of settings/modal mounting and Discord's native stream. */
export class PublishController {
    private active = false;
    private operation?: { abort: AbortController; contextId: string; peer?: SpikePeer; signaling?: SpikeSignaling; capture?: CaptureLease; sessionId?: string; };
    private contextCheck?: ReturnType<typeof setInterval>;
    private sourceChange?: AbortController;
    private listeners = new Set<() => void>();
    private status: PublishStatus = { phase: "idle", message: "No DASS share is running.", candidates: [], pendingViewers: [], approvedViewers: [] };

    constructor(private readonly session: DassSession, private readonly currentContext: () => string | undefined,
        private readonly dependencies = { connect: SpikeSignaling.connect, prepare: SpikePeer.prepare }) {}

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
            if (!request.signal.aborted) this.update({ phase: "failed", message: "Could not release the old capture. Restart the client before sharing again.", candidates: [] });
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
        catch { this.update({ phase: "failed", message: "Set up your DASS session first. No Discord fallback.", candidates: [] }); return; }
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
            this.update({ phase: "capturing", message: "Choose a source in the Equibop picker. Share audio is optional and explicit.", candidates: [], pendingViewers: [], approvedViewers: [] });
            const capture = await createEquibopCapture(bridge)(operation.abort.signal);
            if (!this.current(operation)) { capture.release(); return; }
            operation.capture = capture;
            this.update({ phase: "preparing", message: "Preparing Chromium's DASS connection…", candidates: [], pendingViewers: [], approvedViewers: [] });
            operation.peer = await this.dependencies.prepare({ experimental: true, signal: operation.abort.signal, capture });
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
            operation.sessionId = await operation.peer.activate({ backendUrl, ...access, signaling: operation.signaling, onViewerPresence: presence => {
                if (this.current(operation)) this.update({ ...this.status, viewerCount: presence.viewer_count });
            } });
            // Publisher-controlled admission: every pushed view request is a
            // manual decision. Approvals grant one subscribe for this stream
            // session only; deny and block refuse the prompt.
            if (operation.sessionId && this.current(operation) && typeof operation.signaling.onViewRequests === "function") {
                operation.signaling.onViewRequests(operation.sessionId, viewRequest => {
                    if (!this.current(operation)) return;
                    const pending = [...this.status.pendingViewers.filter(existing => existing.requestId !== viewRequest.request_id),
                        { requestId: viewRequest.request_id, viewerId: viewRequest.viewer_id, displayName: viewRequest.viewer_display_name }];
                    this.update({ ...this.status, pendingViewers: pending });
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

    /** Publisher decision for one pending view request. */
    async decideView(requestId: string, decision: "approve" | "deny" | "block") {
        const { operation } = this;
        if (!operation?.signaling || !operation.sessionId || !this.current(operation)) return;
        const request = this.status.pendingViewers.find(pending => pending.requestId === requestId);
        try {
            await operation.signaling.decideView(operation.sessionId, requestId, decision);
        } catch (error) {
            logDiagnostic("publisher decision failed", { code: error instanceof SpikeSignalingError ? error.code : "unknown" }, true);
            if (this.current(operation)) this.update({ ...this.status, message: "The DASS decision could not be sent; the request expired unapproved." });
            return;
        }
        if (!this.current(operation)) return;
        const pendingViewers = this.status.pendingViewers.filter(pending => pending.requestId !== requestId);
        const approvedViewers = decision === "approve" && request
            ? [...this.status.approvedViewers.filter(viewer => viewer.viewerId !== request.viewerId), { viewerId: request.viewerId }]
            : this.status.approvedViewers;
        this.update({ ...this.status, pendingViewers, approvedViewers });
    }

    /** Withdraw an approved or watching viewer account entirely. */
    async removeViewer(viewerId: string) {
        const { operation } = this;
        if (!operation?.signaling || !operation.sessionId || !this.current(operation)) return;
        try {
            await operation.signaling.removeViewer(operation.sessionId, viewerId);
        } catch (error) {
            logDiagnostic("viewer removal failed", { code: error instanceof SpikeSignalingError ? error.code : "unknown" }, true);
            return;
        }
        if (!this.current(operation)) return;
        this.update({
            ...this.status,
            pendingViewers: this.status.pendingViewers.filter(pending => pending.viewerId !== viewerId),
            approvedViewers: this.status.approvedViewers.filter(viewer => viewer.viewerId !== viewerId),
        });
    }

    private fail(operation: NonNullable<PublishController["operation"]>, message: string) {
        if (this.operation !== operation) return;
        this.reset();
        this.update({ phase: "failed", message, candidates: [], pendingViewers: [], approvedViewers: [] });
    }
}
