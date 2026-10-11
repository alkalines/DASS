/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface CaptureHost {
    capture(): Promise<MediaStream>;
    audioSelected(): boolean;
    unmute(): Promise<unknown>;
    stopAudio(): Promise<unknown>;
}

/** Singleton host ownership, including pending pickers and asynchronous audio IPC. */
export function createCaptureBridge(host: CaptureHost) {
    let busy = false;
    return {
        version: 1 as const,
        ownsAudio: () => busy,
        async capture(signal: AbortSignal) {
            if (busy || signal.aborted) throw new Error("Capture unavailable.");
            busy = true;
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
                })();
            };
            const release = () => {
                if (released) return;
                released = true;
                signal.removeEventListener("abort", release);
                stopTracks();
                finish();
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
