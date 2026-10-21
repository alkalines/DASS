/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface CaptureHost {
    claim?(): () => void;
    cancelPicker?(): void;
    capture(): Promise<MediaStream>;
    audioSelected(): boolean;
    unmute(): Promise<unknown>;
    stopAudio(): Promise<unknown>;
}

/** Singleton host ownership, including pending pickers and asynchronous audio IPC. */
export function createCaptureBridge(host: CaptureHost) {
    let busy = false;
    let cancelled = false;
    let captureSignal: AbortSignal | undefined;
    return {
        version: 1 as const,
        ownsAudio: () => busy,
        isCancelled: () => busy && cancelled,
        getSignal: () => busy ? captureSignal : undefined,
        async capture(signal: AbortSignal) {
            if (busy || signal.aborted) throw new Error("Capture unavailable.");
            const releaseOwnership = host.claim?.();
            busy = true;
            cancelled = false;
            captureSignal = signal;
            let stream: MediaStream | undefined;
            let released = false;
            let settled = false;
            let cleanup: Promise<void> | undefined;
            const onEnded = () => release();
            const stopTracks = () => {
                for (const track of stream?.getTracks() ?? []) {
                    track.removeEventListener("ended", onEnded);
                    if (track.readyState !== "ended") track.stop();
                }
            };
            const finish = () => {
                if (!settled || cleanup) return;
                cleanup = (async () => {
                    try {
                        await host.stopAudio();
                    } catch {
                        // Fail closed: an uncertain host audio state requires restart.
                        return;
                    }
                    busy = false;
                    captureSignal = undefined;
                    releaseOwnership?.();
                })();
            };
            const release = (): Promise<void> | undefined => {
                if (released) return cleanup;
                released = true;
                cancelled = true;
                if (!settled) host.cancelPicker?.();
                signal.removeEventListener("abort", release);
                stopTracks();
                finish();
                return cleanup;
            };
            signal.addEventListener("abort", release, { once: true });
            try {
                // Resolve the installed function at call time. Never save the original
                // Chromium function or duplicate the picker/venmic pipeline.
                stream = await host.capture();
                if (released || signal.aborted) throw new Error("Capture cancelled.");
                const audioSelected = host.audioSelected();
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
                for (const track of videoTracks) track.addEventListener("ended", onEnded);
                if (audioSelected && !stream.getAudioTracks().length) {
                    throw new Error("Selected share audio is unavailable.");
                }
                if (audioSelected && stream.getAudioTracks().length) await host.unmute();
                if (released || signal.aborted) throw new Error("Capture cancelled.");
                return { stream, audioSelected, release };
            } catch {
                release();
                // Also handles a stream returned after an earlier abort.
                stopTracks();
                throw new Error("Capture failed or was cancelled.");
            } finally {
                settled = true;
                if (released) finish();
            }
        }
    };
}
