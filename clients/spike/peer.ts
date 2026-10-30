/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { logDiagnostic, mediaDiagnostics } from "./diagnostics";
import { E2eeTransforms } from "./e2ee";
import type { CaptureLease } from "../../plugins/dass/routing";
import { type DassAuthentication, signalingFailureReason, SpikeSignaling, SpikeSignalingError, type ViewDecision } from "./signaling";

export const PREPARATION_TIMEOUT_MS = 180_000;
const APPROVAL_TIMEOUT_MESSAGE = "The streamer did not approve your request in time. Ask them to approve it, or to enable automatic approval.";
const ACTIVATION_STAGES: Record<string, string> = {
    signaling: "connecting to the DASS backend",
    join: "joining the DASS room",
    request_view: "requesting to watch",
    subscribe: "subscribing to the stream",
    publish: "starting the share",
    viewer_presence: "enabling viewer presence",
    offer: "negotiating media",
    answer: "applying the media answer",
    connection: "streaming media",
};

/** E2EE hooks for `SpikePeer.activate`. Identity keys are mandatory: the
 * backend refuses media setup without them (no transport-only mode). */
export interface PeerE2ee {
    /** This device's base64url ECDH P-256 identity public key. */
    identityPublicKey: string;
    /** Viewer trust gate on the publisher's pinned identity key from the
     * approval decision. Returning false aborts before subscribing. */
    trustPublisher?: (publisherKey: string, decision: ViewDecision) => boolean | Promise<boolean>;
    /** Viewer callback with an opaque relayed epoch blob for local unwrapping. */
    onEpochBlob?: (blob: string) => void;
}

const PREPARATION_MESSAGES = {
    offer_size: "The gathered offer exceeded the spike's 12 KiB limit.",
    candidate_count: "ICE gathering did not provide one to sixteen usable candidates.",
    candidate_transport: "Chromium provided an unsupported candidate transport or port. The spike requires UDP component 1 and non-privileged ports.",
    capture_tracks: "Capture tracks do not match the explicitly selected video/audio, or a source track has ended.",
    codecs: "Chromium could not configure the required VP8/Opus codec preferences.",
    offer: "Chromium could not create the WebRTC offer.",
    local_description: "Chromium could not apply the local WebRTC offer.",
    gathering: "ICE gathering did not finish within five seconds.",
    missing_offer: "Chromium did not provide a gathered local offer.",
    cancelled: "Peer preparation was stopped, expired or cancelled.",
    peer: "Chromium WebRTC peer creation failed."
} as const;

type PreparationFailure = keyof typeof PREPARATION_MESSAGES;

/** Fixed diagnostics only: never expose browser exception messages, SDP or addresses. */
class SpikePreparationError extends Error {
    constructor(readonly code: PreparationFailure) { super(PREPARATION_MESSAGES[code]); }
}

export function preparationFailureMessage(error: unknown): string {
    return error instanceof SpikePreparationError ? `Preparation failed [${error.code}]: ${PREPARATION_MESSAGES[error.code]} No Discord fallback.`
        : "Preparation failed [capture]: The installed Equibop capture bridge or picker failed or was cancelled. No Discord fallback.";
}

/** A literal IP address the backend can use. Names are never usable: the
 * backend resolves nothing and never asks a participant's network for one. */
function isLiteralAddress(address: string): boolean {
    if (address.includes(":")) {
        // A literal IPv6 address: hex groups separated by colons.
        return /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(address);
    }
    const octets = address.split(".");
    return octets.length === 4 && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/** A candidate the backend may use: a literal IP address, UDP, component 1 and
 * a non-privileged port. An mDNS name is dropped, never resolved. */
function isUsableCandidate(candidate: string): boolean {
    const fields = candidate.split(/\s+/);
    const address = fields[4];
    const port = Number(fields[5]);
    if (!address) return false;
    if (address.toLowerCase().endsWith(".local")) return false;
    if (fields[1] !== "1" || fields[2]?.toLowerCase() !== "udp") return false;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return false;
    return isLiteralAddress(address);
}

/** The usable candidates of a gathered offer, deduplicated and bounded. */
export function gatheredCandidates(sdp: string): readonly string[] {
    if (new TextEncoder().encode(sdp).byteLength > 12_288) throw new SpikePreparationError("offer_size");
    const candidates = [...new Set(sdp.split(/\r?\n/).filter(line => line.startsWith("a=candidate:")).map(line => line.slice(2)))];
    if (candidates.length > 16) throw new SpikePreparationError("candidate_count");
    const usable = candidates.filter(candidate => isUsableCandidate(candidate));
    if (!usable.length) throw new SpikePreparationError("candidate_count");
    return usable;
}

/** Keep the media lines and the usable candidates; drop the rest. IPv6
 * candidates are kept: a public deployment may be IPv6-only, and the backend
 * decides which candidates it may use. */
export function supportedOffer(sdp: string): string {
    if (new TextEncoder().encode(sdp).byteLength > 12_288) throw new SpikePreparationError("offer_size");
    const kept = sdp.split(/\r?\n/).filter(line => {
        if (!line.startsWith("a=candidate:")) return true;
        return isUsableCandidate(line.slice(2));
    });
    const offer = kept.join("\r\n");
    gatheredCandidates(offer);
    return offer;
}

/** Two-phase setup preserves actual candidate ports for the backend's exact allowlist. */
export class SpikePeer {
    readonly receivedStream = new MediaStream();
    readonly tracksChanged = new EventTarget();
    private signaling?: SpikeSignaling;
    private active = true;
    private activated = false;
    private activationStage = "signaling";
    private closeDiagnostic?: string;
    private closeReason?: string;
    private offer?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private statsTimer?: ReturnType<typeof setTimeout>;
    private disconnectTimer?: ReturnType<typeof setTimeout>;
    private gatheringFailure?: () => void;
    private readonly stopController = new AbortController();
    private e2eeTransforms?: E2eeTransforms;
    readonly closed = this.stopController.signal;

    private constructor(
        private readonly peer: RTCPeerConnection,
        private readonly signal: AbortSignal,
        private capture?: CaptureLease
    ) {
        signal.addEventListener("abort", this.close, { once: true });
        peer.addEventListener("connectionstatechange", this.onState);
        peer.addEventListener("track", this.onTrack);
        capture?.stream.getTracks().forEach(track => track.addEventListener("ended", this.close, { once: true }));
        this.timer = setTimeout(() => this.closeWithDiagnostic("Preparation expired after 180 seconds. Prepare fresh candidates.", "preparation:expired"), PREPARATION_TIMEOUT_MS);
    }

    static async prepare(options: { experimental: true; signal: AbortSignal; capture?: CaptureLease; e2ee?: boolean; }): Promise<SpikePeer> {
        if (options.experimental !== true || options.signal.aborted) {
            options.capture?.release();
            throw new SpikePreparationError("cancelled");
        }
        let peer: RTCPeerConnection;
        try { peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" }); }
        catch { options.capture?.release(); throw new SpikePreparationError("peer"); }
        const connection = new SpikePeer(peer, options.signal, options.capture);
        let stage: PreparationFailure = "capture_tracks";
        try {
            // E2EE is mandatory for DASS media: attach insertable-stream
            // transforms before negotiation and fail closed when the runtime
            // cannot encrypt frames. Frames are dropped until an epoch key
            // arrives, so no plaintext can leave this peer.
            if (options.e2ee) connection.e2eeTransforms = new E2eeTransforms();
            if (options.capture) {
                const video = options.capture.stream.getVideoTracks();
                const audio = options.capture.stream.getAudioTracks();
                if (video.length !== 1 || audio.length > 1 || (!options.capture.audioSelected && audio.length !== 0)
                    || (options.capture.audioSelected && audio.length !== 1)
                    || options.capture.stream.getTracks().some(track => track.readyState !== "live")) {
                    throw new SpikePreparationError("capture_tracks");
                }
                for (const track of [...video, ...audio]) {
                    const transceiver = peer.addTransceiver(track, { direction: "sendonly", streams: [options.capture.stream] });
                    connection.configure(transceiver, track.kind);
                    connection.e2eeTransforms?.attach(transceiver.sender, "encrypt", track.kind);
                }
            } else {
                for (const kind of ["video", "audio"]) {
                    const transceiver = peer.addTransceiver(kind, { direction: "recvonly" });
                    connection.configure(transceiver, kind);
                    connection.e2eeTransforms?.attach(transceiver.receiver, "decrypt", kind);
                }
            }
            stage = "offer";
            const offer = await peer.createOffer();
            connection.checkActive();
            stage = "local_description";
            await peer.setLocalDescription(offer);
            connection.checkActive();
            await connection.gather();
            connection.checkActive();
            const sdp = peer.localDescription?.sdp;
            if (!sdp) throw new SpikePreparationError("missing_offer");
            connection.offer = supportedOffer(sdp);
            logDiagnostic("peer prepared", { publisher: !!options.capture, candidateCount: connection.candidates.length });
            return connection;
        } catch (error) {
            const cancelled = connection.closed.aborted || options.signal.aborted;
            logDiagnostic("peer preparation failed", { code: error instanceof SpikePreparationError ? error.code : cancelled ? "cancelled" : stage }, true);
            connection.close();
            throw error instanceof SpikePreparationError ? error : new SpikePreparationError(cancelled ? "cancelled" : stage);
        }
    }

    private configure(transceiver: RTCRtpTransceiver, kind: string) {
        try {
            const codecs = RTCRtpSender.getCapabilities(kind)?.codecs.filter(codec =>
                codec.mimeType.toLowerCase() === (kind === "video" ? "video/vp8" : "audio/opus"));
            if (!codecs?.length) throw new SpikePreparationError("codecs");
            transceiver.setCodecPreferences(codecs);
        } catch { throw new SpikePreparationError("codecs"); }
    }

    get candidates(): readonly string[] {
        this.checkActive();
        if (!this.offer) throw new Error("DASS gathering is incomplete.");
        return gatheredCandidates(this.offer);
    }

    private gather(): Promise<void> {
        if (this.peer.iceGatheringState === "complete") return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = (failed: boolean) => {
                clearTimeout(timer);
                this.peer.removeEventListener("icegatheringstatechange", changed);
                this.gatheringFailure = undefined;
                if (failed) reject(new SpikePreparationError(this.active ? "gathering" : "cancelled")); else resolve();
            };
            const changed = () => { if (this.peer.iceGatheringState === "complete") finish(false); };
            const timer = setTimeout(() => finish(true), 5_000);
            this.gatheringFailure = () => finish(true);
            this.peer.addEventListener("icegatheringstatechange", changed);
            changed();
        });
    }

    /** Push a fresh media epoch key into the send transform (publisher). */
    setSendEpoch(epoch: number, keyBytes: Uint8Array) {
        this.e2eeTransforms?.setEpoch(epoch, keyBytes, true);
    }

    /** Install a received epoch key into the decrypt transform (viewer). */
    setReceiveEpoch(epoch: number, keyBytes: Uint8Array) {
        this.e2eeTransforms?.setEpoch(epoch, keyBytes, false);
    }

    /** Evict old epoch keys after a rekey has had time to drain. */
    retireEpochsBelow(epoch: number) {
        this.e2eeTransforms?.retireBelow(epoch);
    }

    async activate(options: DassAuthentication & { backendUrl: string; roomId: string; publisherId?: string; signaling?: SpikeSignaling;
        e2ee?: PeerE2ee;
        onViewerPresence?: Parameters<SpikeSignaling["enableViewerPresence"]>[1]; }): Promise<string> {
        this.checkActive();
        if (this.activated || !this.offer || (Boolean(this.capture) === Boolean(options.publisherId))
            || !options.e2ee || !options.e2ee.identityPublicKey) {
            throw new Error("Select the matching DASS publisher or viewer role once, with an E2EE identity.");
        }
        this.activated = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if (this.activationStage === "request_view") this.closeWithDiagnostic(APPROVAL_TIMEOUT_MESSAGE, "request_view:approval_timeout");
            else this.closeWithDiagnostic(`DASS could not finish ${ACTIVATION_STAGES[this.activationStage] ?? "media setup"} within 15 seconds [${this.activationStage}:timeout]. If the answer was applied, the backend's UDP media ports may be unreachable. No Discord fallback.`,
                `${this.activationStage}:timeout`);
        }, 15_000);
        try {
            this.signaling = options.signaling ?? await SpikeSignaling.connect({ experimental: true, backendUrl: options.backendUrl,
                credential: options.credential, username: options.username, password: options.password, signal: this.closed });
            this.checkActive();
            this.signaling.closed.addEventListener("abort", this.onSignalingClosed, { once: true });
            if (this.signaling.closed.aborted) throw new Error("DASS signaling closed.");
            this.activationStage = "join";
            const joined = await this.signaling.request({ type: "join", room_id: options.roomId, require_e2ee: true }, "joined");
            this.checkActive();
            if (joined.type !== "joined") throw new Error("DASS join failed.");
            this.activationStage = options.publisherId ? "request_view" : "publish";
            let approvalId = "";
            if (options.publisherId) {
                // Register the relay listener before the decision so an epoch
                // key relayed right after the approval is never dropped.
                if (options.e2ee.onEpochBlob) {
                    const handler = options.e2ee.onEpochBlob;
                    const { publisherId } = options;
                    this.signaling.onKeyRelay(relay => {
                        if (relay.publisher_id === publisherId) handler(relay.blob);
                    });
                }
                // Publisher-controlled admission: ask, then wait for the
                // publisher's pushed decision. Denial or a closed request
                // never proceeds to subscribe. The viewer's E2EE identity key
                // accompanies the request so the publisher can pin it.
                const decision = await this.signaling.requestView(joined.session_id, options.publisherId, options.e2ee.identityPublicKey, this.closed);
                this.checkActive();
                if (decision.decision !== "approve" || !decision.approval_id || !decision.publisher_key) {
                    throw new SpikeSignalingError("rejected:denied");
                }
                // Fail closed on an unpinned/changed publisher identity rather
                // than receiving media under a substituted key.
                if (options.e2ee.trustPublisher && !(await options.e2ee.trustPublisher(decision.publisher_key, decision))) {
                    throw new SpikeSignalingError("rejected:e2ee_unavailable");
                }
                approvalId = decision.approval_id;
            }
            this.activationStage = options.publisherId ? "subscribe" : "publish";
            const accepted = await this.signaling.request(options.publisherId
                ? { type: "subscribe", session_id: joined.session_id, publisher_id: options.publisherId, approval_id: approvalId }
                : { type: "publish", session_id: joined.session_id, publisher_key: options.e2ee.identityPublicKey }, "accepted");
            this.checkActive();
            if (accepted.type !== "accepted" || accepted.session_id !== joined.session_id) throw new Error("DASS role does not match the session.");
            if (!options.publisherId && options.onViewerPresence) {
                this.activationStage = "viewer_presence";
                await this.signaling.enableViewerPresence(joined.session_id, options.onViewerPresence);
                this.checkActive();
            }
            this.activationStage = "offer";
            const answer = await this.signaling.request({ type: "offer", session_id: joined.session_id, sdp: this.offer }, "answer");
            this.checkActive();
            if (answer.type !== "answer" || answer.session_id !== joined.session_id) throw new Error("DASS answer does not match the session.");
            this.activationStage = "answer";
            await this.peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
            this.checkActive();
            this.activationStage = "connection";
            void this.sampleMedia();
            this.onState();
            return joined.session_id;
        } catch (error) {
            const failure = this.activationFailure(error);
            this.closeWithDiagnostic(failure.message, failure.code);
            throw new Error("DASS media setup failed or was cancelled. No Discord fallback.");
        }
    }

    private checkActive() { if (!this.active || this.signal.aborted) throw new Error("DASS peer is closed."); }

    /**
     * Swap the published source on the live connection, as Discord's own source
     * change does: `replaceTrack` keeps the negotiated session, E2EE transforms
     * and approved viewers. Returns false when the track kinds differ (stream
     * audio toggled), which needs a new negotiation.
     */
    async replaceCapture(next: CaptureLease): Promise<boolean> {
        const current = this.capture;
        const kinds = (lease: CaptureLease) => lease.stream.getTracks().map(track => track.kind).sort().join();
        if (!this.active || !current || kinds(current) !== kinds(next) || next.stream.getTracks().some(track => track.readyState !== "live")) return false;
        const replacements = this.peer.getSenders().flatMap(sender => {
            const track = sender.track && next.stream.getTracks().find(candidate => candidate.kind === sender.track!.kind);
            return track ? [sender.replaceTrack(track)] : [];
        });
        try { await Promise.all(replacements); } catch { return false; }
        if (!this.active) return false;
        for (const track of current.stream.getTracks()) track.removeEventListener("ended", this.close);
        for (const track of next.stream.getTracks()) track.addEventListener("ended", this.close, { once: true });
        this.capture = next;
        return true;
    }

    private async sampleMedia() {
        try {
            this.e2eeTransforms?.sampleDiagnostics();
            const report = await this.peer.getStats();
            if (!this.active) return;
            const rows = mediaDiagnostics(report, !!this.capture);
            if (!rows.length) logDiagnostic("media stats pending", { role: this.capture ? "publisher" : "viewer" });
            for (const row of rows) logDiagnostic("media stats", row);
        } catch {
            if (this.active) logDiagnostic("media stats unavailable", { role: this.capture ? "publisher" : "viewer" });
        }
        // Schedule after completion, so slow getStats calls cannot overlap.
        if (this.active) this.statsTimer = setTimeout(() => void this.sampleMedia(), 5_000);
    }

    get closeMessage(): string {
        if (this.closeDiagnostic) return this.closeDiagnostic;
        return this.activationStage === "request_view" ? APPROVAL_TIMEOUT_MESSAGE : "Test stopped. Capture and connection resources were released.";
    }

    /** Stable `stage:code` failure code for retry decisions, e.g. `connection:failed` or `subscribe:rejected:invalid_state`. */
    get closeCode(): string {
        return this.closeReason ?? "closed";
    }

    private activationFailure(error: unknown): { code: string; message: string; } {
        const code = error instanceof SpikeSignalingError ? error.code : "";
        if (this.activationStage === "request_view") {
            if (code === "rejected:denied") return { code: "request_view:denied", message: "The streamer denied your request to watch." };
            if (["", "cancelled", "closed", "timeout", "server:setup_timeout"].includes(code)) return { code: "request_view:approval_timeout", message: APPROVAL_TIMEOUT_MESSAGE };
        }
        const stage = ACTIVATION_STAGES[this.activationStage] ?? "media setup";
        const failure = `${this.activationStage}${code && `:${code}`}`;
        return { code: failure, message: `DASS failed while ${stage} [${failure}].${code ? ` ${signalingFailureReason(code)}` : ""} No Discord fallback.` };
    }

    private closeWithDiagnostic(message: string, code: string) {
        if (this.active) {
            const [stage, ...detail] = code.split(":");
            logDiagnostic("peer failed", { stage, code: detail.join(":") || "none", diagnostic: message }, true);
            this.closeDiagnostic = message;
            this.closeReason = code;
        }
        this.close();
    }

    private readonly onSignalingClosed = () => {
        const failure = this.activationFailure(this.signaling?.closed.reason);
        this.closeWithDiagnostic(failure.message, failure.code);
    };

    private readonly onState = () => {
        if (!this.active) return;
        logDiagnostic("peer connection state", { connection: this.peer.connectionState, ice: this.peer.iceConnectionState, stage: this.activationStage });
        if (this.peer.connectionState === "connected") {
            clearTimeout(this.timer);
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = undefined;
        } else if (this.peer.connectionState === "disconnected") {
            // ICE can recover without renegotiation. Repeated state events must
            // not extend the grace period, and setup retains its own deadline.
            this.disconnectTimer ??= setTimeout(() => {
                if (this.active && this.peer.connectionState !== "connected") {
                    this.closeWithDiagnostic("Media stopped [connection:disconnected_timeout]. The UDP connection did not recover within 15 seconds.", "connection:disconnected_timeout");
                }
            }, 15_000);
        } else if (["failed", "closed"].includes(this.peer.connectionState)) {
            this.closeWithDiagnostic(`Media stopped [connection:${this.peer.connectionState}]. The UDP media connection to the DASS backend was lost.`, `connection:${this.peer.connectionState}`);
        }
    };

    private readonly onTrack = (event: RTCTrackEvent) => {
        if (!this.active || this.capture || !["audio", "video"].includes(event.track.kind) || this.receivedStream.getTracks().length >= 2
            || this.receivedStream.getTracks().some(track => track.kind === event.track.kind)) { event.track.stop(); return; }
        this.receivedStream.addTrack(event.track);
        logDiagnostic("viewer track received", { kind: event.track.kind });
        // Script-driven MediaStream.addTrack does not emit the UA addtrack event.
        this.tracksChanged.dispatchEvent(new Event("change"));
        event.track.addEventListener("ended", this.close, { once: true });
    };

    readonly close = () => {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.timer);
        clearTimeout(this.statsTimer);
        clearTimeout(this.disconnectTimer);
        this.gatheringFailure?.();
        this.signal.removeEventListener("abort", this.close);
        this.peer.removeEventListener("connectionstatechange", this.onState);
        this.peer.removeEventListener("track", this.onTrack);
        this.signaling?.closed.removeEventListener("abort", this.onSignalingClosed);
        this.stopController.abort();
        this.signaling?.close();
        this.e2eeTransforms?.close();
        this.e2eeTransforms = undefined;
        this.peer.close();
        for (const track of [...this.receivedStream.getTracks(), ...(this.capture?.stream.getTracks() ?? [])]) {
            track.removeEventListener("ended", this.close);
            track.stop();
        }
        this.capture?.release();
        this.offer = undefined;
    };
}
