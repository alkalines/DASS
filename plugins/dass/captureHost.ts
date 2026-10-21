/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MediaEngineStore, UserStore } from "@webpack/common";

import type { EquibopCaptureBridge } from "./capture";
import { createDesktopCaptureBridge } from "./desktopCapture";
import { createStockCaptureBridge, type PickerSettings } from "./stockCapture";

interface CaptureGlobals {
    Equibop?: { Components?: { ScreenShare?: { currentSettings: PickerSettings | null; }; }; };
    VesktopNative?: {
        app: { getPlatformSpoofInfo(): { originalPlatform: string; }; };
        virtmic: { unmute(): Promise<unknown>; stop(): Promise<unknown>; };
    };
}

let stockBridge: ReturnType<typeof createStockCaptureBridge> | undefined;
let desktopBridge: EquibopCaptureBridge | undefined;

function nativeSharing() {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return true;
    return [...MediaEngineStore.getMediaEngine().connections].some(connection => connection.streamUserId === userId);
}

/** Equibop's installed picker when present; otherwise official Discord desktop's capture sources. */
export function getCaptureBridge(): EquibopCaptureBridge | undefined {
    if (stockBridge) {
        stockBridge.start();
        return stockBridge;
    }
    const host = globalThis as typeof globalThis & CaptureGlobals;
    const picker = host.Equibop?.Components?.ScreenShare;
    const native = host.VesktopNative;
    if (!picker || !("currentSettings" in picker) || !native || typeof native.app?.getPlatformSpoofInfo !== "function" || !navigator.mediaDevices?.getDisplayMedia) {
        desktopBridge ??= createDesktopCaptureBridge(nativeSharing);
        return desktopBridge;
    }
    const platform = native.app.getPlatformSpoofInfo().originalPlatform;
    if (!["linux", "win32", "darwin"].includes(platform)) return;
    if (platform === "linux" && (typeof native.virtmic?.unmute !== "function" || typeof native.virtmic.stop !== "function")) return;
    stockBridge = createStockCaptureBridge({
        devices: navigator.mediaDevices,
        settings: () => picker.currentSettings,
        nativeSharing,
        linux: platform === "linux",
        unmute: () => native.virtmic.unmute(),
        stopAudio: () => native.virtmic.stop()
    });
    stockBridge.start();
    return stockBridge;
}

export function stopCaptureHost() {
    stockBridge?.stop();
}
