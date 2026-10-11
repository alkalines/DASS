/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease } from "../../plugins/dass/routing";
import { SpikeSignaling } from "./signaling";

const PREPARATION_MESSAGES = {
    offer_size: "The gathered offer exceeded the spike's 12 KiB limit.",
    candidate_count: "ICE gathering did not provide one to sixteen candidates.",
    candidate_mdns: "Chromium provided an mDNS (.local) candidate. The spike requires literal IPv4 addresses.",
    candidate_address: "Chromium provided an unsupported candidate address. The spike supports IPv4 only.",
    ipv4_missing: "Only IPv6 candidates were gathered. The spike needs a reachable literal IPv4 candidate.",
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

export function gatheredCandidates(sdp: string): readonly string[] {
    if (new TextEncoder().encode(sdp).byteLength > 12_288) throw new SpikePreparationError("offer_size");
    const candidates = [...new Set(sdp.split(/\r?\n/).filter(line => line.startsWith("a=candidate:")).map(line => line.slice(2)))];
    if (!candidates.length || candidates.length > 16) throw new SpikePreparationError("candidate_count");
    for (const candidate of candidates) {
        const fields = candidate.split(/\s+/);
        const octets = fields[4]?.split(".");
        const port = Number(fields[5]);
        if (fields[4]?.toLowerCase().endsWith(".local")) throw new SpikePreparationError("candidate_mdns");
        if (!octets || octets.length !== 4 || octets.some(octet => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) {
            throw new SpikePreparationError("candidate_address");
        }
        if (fields[1] !== "1" || fields[2]?.toLowerCase() !== "udp" || !Number.isInteger(port) || port < 1024 || port > 65535) {
            throw new SpikePreparationError("candidate_transport");
        }
    }
    return candidates;
}

/** Remove unsupported IPv6 routes only; never rewrite an address or port. */
export function ipv4Offer(sdp: string): string {
    if (new TextEncoder().encode(sdp).byteLength > 12_288) throw new SpikePreparationError("offer_size");
    const lines = sdp.split(/\r?\n/);
    let removedIpv6 = false;
    const supportedLines = lines.filter(line => {
        if (!line.startsWith("a=candidate:")) return true;
        const address = line.split(/\s+/)[4];
        if (!address?.includes(":")) return true;
        removedIpv6 = true;
        return false;
    });
    if (removedIpv6 && !supportedLines.some(line => line.startsWith("a=candidate:"))) {
        throw new SpikePreparationError("ipv4_missing");
    }
    const offer = supportedLines.join("\r\n");
    gatheredCandidates(offer);
    return offer;
}

/** Two-phase setup preserves actual candidate ports for the backend's exact allowlist. */
export class SpikePeer {
    readonly receivedStream = new MediaStream();
    private signaling?: SpikeSignaling;
    private active = true;
    private activated = false;
    private offer?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private gatheringFailure?: () => void;
    private readonly stopController = new AbortController();
    readonly closed = this.stopController.signal;

    private constructor(
        private readonly peer: RTCPeerConnection,
        private readonly signal: AbortSignal,
        private readonly capture?: CaptureLease
    ) {
        signal.addEventListener("abort", this.close, { once: true });
        peer.addEventListener("connectionstatechange", this.onState);
        peer.addEventListener("track", this.onTrack);
        capture?.stream.getTracks().forEach(track => track.addEventListener("ended", this.close, { once: true }));
        this.timer = setTimeout(this.close, 60_000);
    }

    static async prepare(options: { experimental: true; signal: AbortSignal; capture?: CaptureLease; }): Promise<SpikePeer> {
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
            if (options.capture) {
                const video = options.capture.stream.getVideoTracks();
                const audio = options.capture.stream.getAudioTracks();
                if (video.length !== 1 || audio.length > 1 || (!options.capture.audioSelected && audio.length !== 0)
                    || (options.capture.audioSelected && audio.length !== 1)
                    || options.capture.stream.getTracks().some(track => track.readyState !== "live")) {
                    throw new SpikePreparationError("capture_tracks");
                }
                for (const track of [...video, ...audio]) {
                    connection.configure(peer.addTransceiver(track, { direction: "sendonly", streams: [options.capture.stream] }), track.kind);
                }
            } else {
                connection.configure(peer.addTransceiver("video", { direction: "recvonly" }), "video");
                connection.configure(peer.addTransceiver("audio", { direction: "recvonly" }), "audio");
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
            connection.offer = ipv4Offer(sdp);
            return connection;
        } catch (error) {
            const cancelled = connection.closed.aborted || options.signal.aborted;
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

    async activate(options: { backendUrl: string; credential: string; roomId: string; publisherId?: string; }): Promise<string> {
        this.checkActive();
        if (this.activated || !this.offer || (Boolean(this.capture) === Boolean(options.publisherId))) {
            throw new Error("Select the matching DASS publisher or viewer role once.");
        }
        this.activated = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(this.close, 15_000);
        try {
            this.signaling = await SpikeSignaling.connect({ experimental: true, backendUrl: options.backendUrl,
                credential: options.credential, signal: this.closed });
            this.checkActive();
            this.signaling.closed.addEventListener("abort", this.close, { once: true });
            if (this.signaling.closed.aborted) throw new Error("DASS signaling closed.");
            const joined = await this.signaling.request({ type: "join", room_id: options.roomId, require_e2ee: false }, "joined");
            this.checkActive();
            if (joined.type !== "joined") throw new Error("DASS join failed.");
            const accepted = await this.signaling.request(options.publisherId
                ? { type: "subscribe", session_id: joined.session_id, publisher_id: options.publisherId }
                : { type: "publish", session_id: joined.session_id }, "accepted");
            this.checkActive();
            if (accepted.type !== "accepted" || accepted.session_id !== joined.session_id) throw new Error("DASS role does not match the session.");
            const answer = await this.signaling.request({ type: "offer", session_id: joined.session_id, sdp: this.offer }, "answer");
            this.checkActive();
            if (answer.type !== "answer" || answer.session_id !== joined.session_id) throw new Error("DASS answer does not match the session.");
            await this.peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
            this.checkActive();
            this.onState();
            return joined.session_id;
        } catch {
            this.close();
            throw new Error("DASS media setup failed or was cancelled. No Discord fallback.");
        }
    }

    private checkActive() { if (!this.active || this.signal.aborted) throw new Error("DASS peer is closed."); }

    private readonly onState = () => {
        if (this.peer.connectionState === "connected") clearTimeout(this.timer);
        else if (["failed", "closed", "disconnected"].includes(this.peer.connectionState)) this.close();
    };

    private readonly onTrack = (event: RTCTrackEvent) => {
        if (!this.active || this.capture || !["audio", "video"].includes(event.track.kind) || this.receivedStream.getTracks().length >= 2
            || this.receivedStream.getTracks().some(track => track.kind === event.track.kind)) { event.track.stop(); return; }
        this.receivedStream.addTrack(event.track);
        event.track.addEventListener("ended", this.close, { once: true });
    };

    readonly close = () => {
        if (!this.active) return;
        this.active = false;
        clearTimeout(this.timer);
        this.gatheringFailure?.();
        this.signal.removeEventListener("abort", this.close);
        this.peer.removeEventListener("connectionstatechange", this.onState);
        this.peer.removeEventListener("track", this.onTrack);
        this.signaling?.closed.removeEventListener("abort", this.close);
        this.stopController.abort();
        this.signaling?.close();
        this.peer.close();
        for (const track of [...this.receivedStream.getTracks(), ...(this.capture?.stream.getTracks() ?? [])]) {
            track.removeEventListener("ended", this.close);
            track.stop();
        }
        this.capture?.release();
        this.offer = undefined;
    };
}
