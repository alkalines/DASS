/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease } from "../../plugins/dass/routing";
import { SpikeSignaling } from "./signaling";

export function gatheredCandidates(sdp: string): readonly string[] {
    if (new TextEncoder().encode(sdp).byteLength > 12_288) throw new Error("DASS offer exceeded the supported size.");
    const candidates = [...new Set(sdp.split(/\r?\n/).filter(line => line.startsWith("a=candidate:")).map(line => line.slice(2)))];
    if (!candidates.length || candidates.length > 16) throw new Error("DASS requires one to sixteen gathered IPv4 UDP candidates.");
    for (const candidate of candidates) {
        const fields = candidate.split(/\s+/);
        const octets = fields[4]?.split(".");
        const port = Number(fields[5]);
        if (fields[1] !== "1" || fields[2]?.toLowerCase() !== "udp" || !octets || octets.length !== 4
            || octets.some(octet => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
            || !Number.isInteger(port) || port < 1024 || port > 65535) {
            throw new Error("The spike requires literal IPv4 UDP candidates. Browser mDNS or other transports are unsupported.");
        }
    }
    return candidates;
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
            throw new Error("DASS peer setup was cancelled or not enabled.");
        }
        let peer: RTCPeerConnection;
        try { peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" }); }
        catch { options.capture?.release(); throw new Error("Chromium WebRTC is unavailable."); }
        const connection = new SpikePeer(peer, options.signal, options.capture);
        try {
            if (options.capture) {
                const video = options.capture.stream.getVideoTracks();
                const audio = options.capture.stream.getAudioTracks();
                if (video.length !== 1 || audio.length > 1 || (!options.capture.audioSelected && audio.length !== 0)
                    || (options.capture.audioSelected && audio.length !== 1)
                    || options.capture.stream.getTracks().some(track => track.readyState !== "live")) {
                    throw new Error("Capture does not match the explicitly selected audio/video tracks.");
                }
                for (const track of [...video, ...audio]) {
                    connection.configure(peer.addTransceiver(track, { direction: "sendonly", streams: [options.capture.stream] }), track.kind);
                }
            } else {
                connection.configure(peer.addTransceiver("video", { direction: "recvonly" }), "video");
                connection.configure(peer.addTransceiver("audio", { direction: "recvonly" }), "audio");
            }
            const offer = await peer.createOffer();
            connection.checkActive();
            await peer.setLocalDescription(offer);
            connection.checkActive();
            await connection.gather();
            connection.checkActive();
            const sdp = peer.localDescription?.sdp;
            if (!sdp) throw new Error("DASS offer is unavailable.");
            gatheredCandidates(sdp);
            connection.offer = sdp;
            return connection;
        } catch {
            connection.close();
            throw new Error("DASS peer preparation failed or was cancelled. No Discord fallback.");
        }
    }

    private configure(transceiver: RTCRtpTransceiver, kind: string) {
        const codecs = RTCRtpSender.getCapabilities(kind)?.codecs.filter(codec =>
            codec.mimeType.toLowerCase() === (kind === "video" ? "video/vp8" : "audio/opus"));
        if (!codecs?.length) throw new Error("The required VP8 or Opus codec is unavailable.");
        transceiver.setCodecPreferences(codecs);
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
                if (failed) reject(new Error("DASS gathering failed or was cancelled.")); else resolve();
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
