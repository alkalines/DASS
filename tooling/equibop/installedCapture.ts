/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createCaptureOwnership } from "./captureOwnership";

interface InstalledCaptureHost {
    signal?(): AbortSignal | undefined;
    capture(options?: DisplayMediaStreamOptions): Promise<MediaStream>;
    audioSelected(): boolean;
    configureVideo(track: MediaStreamTrack): void;
    acquireAudio?(): Promise<MediaStream>;
    stopAudio(): Promise<unknown>;
}

/** Narrow wrapper fix: consent before virtual acquisition, ownership before picker. */
export function createInstalledCapture(host: InstalledCaptureHost, ownership: ReturnType<typeof createCaptureOwnership>) {
    return async (options?: DisplayMediaStreamOptions) => {
        const owner = ownership.enter();
        const tracks = new Set<MediaStreamTrack>();
        let released = false;
        let settled = false;
        let cleanup: Promise<void> | undefined;
        const finish = () => {
            if (!settled || !released || owner.dass || cleanup) return;
            cleanup = (async () => {
                try {
                    await host.stopAudio();
                    owner.release();
                } catch {
                    // Uncertain venmic state: retain the lock until host restart.
                }
            })();
        };
        const release = async () => {
            if (released) return;
            released = true;
            for (const track of tracks) {
                track.removeEventListener("ended", onEnded);
                if (track.readyState !== "ended") track.stop();
            }
            finish();
        };
        const onEnded = () => { void release(); };
        const signal = owner.dass ? host.signal?.() : undefined;
        signal?.addEventListener("abort", onEnded, { once: true });
        if (signal?.aborted) void release();
        if (!owner.dass) ownership.setNativeCleanup(onEnded);
        try {
            if (released) throw new Error("Capture cancelled.");
            const stream = await host.capture(options);
            stream.getTracks().forEach(track => tracks.add(track));
            if (released || signal?.aborted) throw new Error("Capture cancelled.");
            const video = stream.getVideoTracks();
            if (!video.length || video.some(track => track.readyState === "ended")) throw new Error("No live video source.");
            video.forEach(track => track.addEventListener("ended", onEnded));
            host.configureVideo(video[0]);
            if (released || signal?.aborted) throw new Error("Capture cancelled.");
            const selected = host.audioSelected();
            if (!selected || host.acquireAudio) {
                for (const track of stream.getAudioTracks()) {
                    track.stop();
                    stream.removeTrack(track);
                }
            }
            if (selected && host.acquireAudio) {
                const audio = await host.acquireAudio();
                audio.getTracks().forEach(track => tracks.add(track));
                // Never leave a track hidden outside the returned capture lease.
                for (const track of audio.getTracks()) {
                    if (track.kind !== "audio") track.stop();
                }
                const audioTracks = audio.getAudioTracks();
                if (!audioTracks.length || audioTracks.some(track => track.readyState === "ended")) throw new Error("Share audio unavailable.");
                if (!released) audioTracks.forEach(track => stream.addTrack(track));
            }
            if (released || video.some(track => track.readyState === "ended")) throw new Error("Capture ended.");
            if (selected && !stream.getAudioTracks().length) throw new Error("Share audio unavailable; choose no audio for video-only capture.");
            return stream;
        } catch {
            // Includes tracks acquired after source end while audio was pending.
            for (const track of tracks) if (track.readyState !== "ended") track.stop();
            await release();
            throw new Error("Capture failed. Selected share audio may be unavailable; choose no audio for video-only capture.");
        } finally {
            signal?.removeEventListener("abort", onEnded);
            settled = true;
            finish();
        }
    };
}
