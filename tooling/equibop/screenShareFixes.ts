/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@equicord/types/utils";
import { showToast } from "@equicord/types/webpack/common";
import { captureOwnership } from "renderer/captureOwnership";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { DassCapture } from "renderer/dassCapture";
import { createInstalledCapture } from "renderer/installedCapture";
import { State } from "renderer/settings";
import { isLinux } from "renderer/utils";

const logger = new Logger("EquibopStreamFixes");
const original = navigator.mediaDevices.getDisplayMedia;

const installedCapture = createInstalledCapture({
    signal: () => DassCapture.getSignal(),
    capture: options => original.call(navigator.mediaDevices, options),
    audioSelected: () => isLinux
        ? currentSettings?.includeSources === "Entire System" || (Array.isArray(currentSettings?.includeSources) && currentSettings.includeSources.length > 0)
        : currentSettings?.audio === true,
    configureVideo: track => {
        if (!isLinux) return;
        const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 30);
        const height = Number(State.store.screenshareQuality?.resolution ?? 720);
        const width = Math.round(height * (16 / 9));
        track.contentHint = currentSettings?.contentHint ?? "";
        const constraints = {
            ...track.getConstraints(),
            frameRate: { min: frameRate, ideal: frameRate },
            width: { min: 640, ideal: width, max: width },
            height: { min: 480, ideal: height, max: height },
            advanced: [{ width, height }],
            resizeMode: "none"
        };
        void track.applyConstraints(constraints).catch(() => logger.error("Failed to apply screenshare constraints."));
    },
    acquireAudio: isLinux ? async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const device = devices.find(({ label, kind, deviceId }) =>
            label === "vencord-screen-share" && kind === "audioinput" && deviceId.length > 0);
        if (!device) throw new Error("Selected share audio unavailable.");
        return navigator.mediaDevices.getUserMedia({
            video: false,
            audio: {
                deviceId: { exact: device.deviceId },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                channelCount: 2,
                sampleRate: 48000,
                sampleSize: 16
            }
        });
    } : undefined,
    stopAudio: () => isLinux ? VesktopNative.virtmic.stop() : Promise.resolve()
}, captureOwnership);

navigator.mediaDevices.getDisplayMedia = async options => {
    try {
        return await installedCapture(options);
    } catch {
        showToast("Screen capture failed, was cancelled, or overlaps another capture. If share audio is unavailable, select no audio for video-only capture.");
        throw new Error("Screen capture unavailable.");
    }
};
