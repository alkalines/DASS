/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createCaptureBridge } from "./captureLifecycle";

export interface PickerSettings {
    audio: boolean;
    includeSources?: string | object[];
}

export interface StockCaptureHost {
    devices: MediaDevices;
    settings(): PickerSettings | null;
    nativeSharing(): boolean;
    linux: boolean;
    unmute(): Promise<unknown>;
    stopAudio(): Promise<unknown>;
}

export function createStockCaptureBridge(host: StockCaptureHost) {
    const audioSelected = () => {
        const settings = host.settings();
        return host.linux
            ? settings?.includeSources === "Entire System" || (Array.isArray(settings?.includeSources) && settings.includeSources.length > 0)
            : settings?.audio === true;
    };
    const { devices } = host;
    let installedCapture = devices.getDisplayMedia;
    let enabled = false;
    let nativePending = 0;
    const nativeStreams = new Map<MediaStream, () => void>();
    const guardedCapture: MediaDevices["getDisplayMedia"] = async options => {
        if (bridge.ownsAudio()) throw new Error("DASS is using screen capture. Stop it before starting another share.");
        nativePending++;
        try {
            const stream = await installedCapture.call(devices, options);
            if (enabled) {
                const tracks = stream.getVideoTracks();
                const cleanup = () => {
                    tracks.forEach(track => track.removeEventListener("ended", cleanup));
                    nativeStreams.delete(stream);
                };
                nativeStreams.set(stream, cleanup);
                tracks.forEach(track => track.addEventListener("ended", cleanup));
            }
            return stream;
        } finally {
            nativePending--;
        }
    };
    const restoreCapture = () => {
        if (!enabled && devices.getDisplayMedia === guardedCapture) devices.getDisplayMedia = installedCapture;
    };
    const bridge = createCaptureBridge({
        claim: () => {
            for (const [stream, cleanup] of nativeStreams) {
                if (stream.getVideoTracks().every(track => track.readyState === "ended")) cleanup();
            }
            if (!enabled || nativePending || nativeStreams.size || host.nativeSharing()) throw new Error("Stop your Discord screen share before starting DASS.");
            if (devices.getDisplayMedia !== guardedCapture) throw new Error("The screen capture hook changed. Restart Equibop before using DASS.");
            const { enumerateDevices } = devices;
            const enumerate: MediaDevices["enumerateDevices"] = async () => {
                const devices = await enumerateDevices.call(host.devices);
                return host.linux && (!audioSelected() || bridge.isCancelled())
                    ? devices.filter(device => device.label !== "vencord-screen-share") : devices;
            };
            devices.enumerateDevices = enumerate;
            return () => {
                if (devices.enumerateDevices === enumerate) devices.enumerateDevices = enumerateDevices;
                restoreCapture();
            };
        },
        capture: () => installedCapture.call(devices, { video: true, audio: true }),
        audioSelected,
        unmute: () => host.linux ? host.unmute() : Promise.resolve(),
        stopAudio: () => host.linux ? host.stopAudio() : Promise.resolve()
    });
    return {
        ...bridge,
        start() {
            if (enabled) return;
            enabled = true;
            if (devices.getDisplayMedia !== guardedCapture) {
                installedCapture = devices.getDisplayMedia;
                devices.getDisplayMedia = guardedCapture;
            }
        },
        stop() {
            enabled = false;
            for (const cleanup of nativeStreams.values()) cleanup();
            if (!bridge.ownsAudio()) restoreCapture();
        }
    };
}
