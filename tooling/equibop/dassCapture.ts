/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { currentSettings } from "renderer/components/ScreenSharePicker";
import { isLinux } from "renderer/utils";

import { createCaptureBridge } from "./dassCaptureLifecycle";

// Exported from the host renderer, not installed via an Equicord webpack patch.
export const DassCapture = createCaptureBridge({
    capture: () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
    audioSelected: () =>
        isLinux
            ? !!currentSettings?.includeSources && currentSettings.includeSources !== "None"
            : currentSettings?.audio === true,
    unmute: () => (isLinux ? VesktopNative.virtmic.unmute() : Promise.resolve()),
    stopAudio: () => (isLinux ? VesktopNative.virtmic.stop() : Promise.resolve())
});
