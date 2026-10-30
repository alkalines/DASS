/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Staged verbatim into the custom Equibop host; keep this file self-contained.
interface CaptureLease {
    stream: MediaStream;
    audioSelected: boolean;
    release(): Promise<void>;
}

interface CaptureHost {
    claim?(): () => void;
    cancelPicker?(): void;
    capture(): Promise<MediaStream>;
    audioSelected(): boolean;
    unmute(): Promise<unknown>;
    stopAudio(): Promise<unknown>;
}

/**
 * Singleton host ownership, including pending pickers and asynchronous audio IPC.
 * A replacement capture (source change) runs while the current lease keeps
 * the host: ownership moves to the new lease, and the host is released only
 * when the owning lease is released and no picker is pending.
 */
export function createCaptureBridge(host: CaptureHost) {
    let busy = false;
    let cancelled = false;
    let pending = false;
    let captureSignal: AbortSignal | undefined;
    let releaseOwnership: (() => void) | undefined;
    let owner: CaptureLease | undefined;
    let cleanup: Promise<void> | undefined;

    const releaseHost = () => {
        if (pending || owner || cleanup) return cleanup;
        cleanup = (async () => {
            try {
                await host.stopAudio();
            } catch {
                // Fail closed: an uncertain host audio state requires restart.
                return;
            }
            busy = false;
            captureSignal = undefined;
            cleanup = undefined;
            const release = releaseOwnership;
            releaseOwnership = undefined;
            release?.();
        })();
        return cleanup;
    };

    const adopt = (stream: MediaStream, audioSelected: boolean, signal: AbortSignal) => {
        let releasing: Promise<void> | undefined;
        const release = () => {
            if (releasing) return releasing;
            signal.removeEventListener("abort", release);
            for (const track of stream.getTracks()) {
                track.removeEventListener("ended", release);
                if (track.readyState !== "ended") track.stop();
            }
            if (owner === lease) owner = undefined;
            releasing = releaseHost() ?? Promise.resolve();
            return releasing;
        };
        const lease: CaptureLease = { stream, audioSelected, release };
        signal.addEventListener("abort", release, { once: true });
        for (const track of stream.getVideoTracks()) track.addEventListener("ended", release);
        owner = lease;
        return lease;
    };

    return {
        version: 1 as const,
        ownsAudio: () => busy,
        isCancelled: () => busy && cancelled,
        getSignal: () => busy ? captureSignal : undefined,
        /** `replacing` must be the lease that currently owns the host (a source change). */
        async capture(signal: AbortSignal, replacing?: object): Promise<CaptureLease> {
            const replacement = replacing !== undefined;
            if (signal.aborted || pending || (replacement ? !owner || owner !== replacing || cleanup : busy)) {
                throw new Error("Capture unavailable.");
            }
            if (!replacement) {
                releaseOwnership = host.claim?.();
                busy = true;
                cancelled = false;
            }
            captureSignal = signal;
            pending = true;
            let stream: MediaStream | undefined;
            let abandoned = false;
            const stopTracks = () => {
                for (const track of stream?.getTracks() ?? []) {
                    if (track.readyState !== "ended") track.stop();
                }
            };
            const abandon = () => {
                if (abandoned) return;
                abandoned = true;
                if (!replacement) cancelled = true;
                host.cancelPicker?.();
                stopTracks();
            };
            signal.addEventListener("abort", abandon, { once: true });
            let audioSelected: boolean;
            try {
                // Resolve the installed function at call time. Never save the original
                // Chromium function or duplicate the picker/venmic pipeline.
                stream = await host.capture();
                if (abandoned || signal.aborted) throw new Error("Capture cancelled.");
                audioSelected = host.audioSelected();
                if (!audioSelected) {
                    for (const track of stream.getAudioTracks()) {
                        track.stop();
                        stream.removeTrack(track);
                    }
                }
                const videoTracks = stream.getVideoTracks();
                if (!videoTracks.length || videoTracks.some(track => track.readyState === "ended")) {
                    throw new Error("Capture unavailable.");
                }
                if (audioSelected && !stream.getAudioTracks().length) {
                    throw new Error("Selected share audio is unavailable.");
                }
                if (audioSelected) await host.unmute();
                if (abandoned || signal.aborted) throw new Error("Capture cancelled.");
            } catch {
                abandon();
                // Also handles a stream returned after an earlier abort.
                stopTracks();
                signal.removeEventListener("abort", abandon);
                pending = false;
                releaseHost();
                throw new Error("Capture failed or was cancelled.");
            }
            signal.removeEventListener("abort", abandon);
            pending = false;
            return adopt(stream, audioSelected, signal);
        }
    };
}
