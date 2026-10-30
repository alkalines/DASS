/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { closeModal, showToast, useEffect } from "@webpack/common";

import { createCaptureBridge } from "./captureLifecycle";
import { logDiagnostic } from "../../clients/spike/diagnostics";
import { type GoLiveCaptureQuality, goLiveCaptureQuality, type GoLiveStreamOptions } from "./discordAdapter";
import type { DesktopCaptureAudio } from "./nativeCapture";

const Native = VencordNative.pluginHelpers.DASS as PluginNative<typeof import("./native")>;

/** Discord's own native utilities; maps a window source to its process for soundshare. */
const DiscordNativeUtils: { getPidFromDesktopSource(sourceId: string): number | null; } = findByPropsLazy("getPidFromDesktopSource");

interface DesktopSource {
    id: string;
    name: string;
    url: string;
}

interface DesktopCaptureNative {
    getDesktopCaptureSources(options: { types: string[]; thumbnailSize: { width: number; height: number; }; }): Promise<DesktopSource[]>;
}

interface DesktopSelection {
    sourceId: string;
    audio: boolean;
    quality: GoLiveCaptureQuality;
}

/**
 * Passed as the `dassGoLive` prop of Discord's Go Live modal by
 * `DISCORD_GO_LIVE_PATCHES`. The modal's source list and stream start use it
 * instead of the native media engine.
 */
export interface DassGoLiveRequest {
    fetchSources(options: { width: number; height: number; types?: string[]; }): Promise<{ screenSources: DesktopSource[]; windowSources: DesktopSource[]; cameraSources: never[]; }>;
    start(source: unknown, options?: GoLiveStreamOptions): Promise<[boolean, string?]>;
    mount(): () => void;
}

type OpenGoLiveModal = (guildId: undefined, channelId: undefined, analyticsLocations: undefined, request: DassGoLiveRequest) => Promise<string> | undefined;

/** Discord's Go Live opener, as patched to forward `dassGoLive`. */
const openGoLiveModal: OpenGoLiveModal = findByCodeLazy("dassGoLive", ".getDesktopSource(");

const CHROMIUM_SOURCE_ID = /^(?:screen|window):\d+:\d+$/;

interface DesktopGlobals {
    DiscordNative?: { desktopCapture?: Partial<DesktopCaptureNative>; };
}

function desktopCaptureNative(): DesktopCaptureNative | undefined {
    const host: typeof globalThis & DesktopGlobals = globalThis;
    const native = host.DiscordNative?.desktopCapture;
    return typeof native?.getDesktopCaptureSources === "function" ? native as DesktopCaptureNative : undefined;
}

/** Called by the patched Go Live modal; ties the request to the modal's lifetime. */
export function useDassGoLive(request?: DassGoLiveRequest) {
    useEffect(() => request?.mount(), [request]);
}

/**
 * Opens Discord's Go Live picker in DASS mode. The picker lists Chromium's
 * desktop sources, so the chosen ID is directly capturable; source previews stay
 * inside the modal. Returns the pending selection and a dismissal function.
 */
function openGoLivePicker(native: DesktopCaptureNative) {
    const picked = Promise.withResolvers<DesktopSelection>();
    let settled = false;
    let modalKey: string | undefined;
    const settle = (selection?: DesktopSelection, error = new Error("Screen selection was cancelled.")) => {
        if (settled) return false;
        settled = true;
        if (selection) picked.resolve(selection);
        else picked.reject(error);
        return true;
    };
    const request: DassGoLiveRequest = {
        async fetchSources({ width, height, types = ["screen", "window"] }) {
            const wanted = types.filter(type => type === "screen" || type === "window");
            const sources = wanted.length ? await native.getDesktopCaptureSources({ types: wanted, thumbnailSize: { width, height } }) : [];
            return {
                screenSources: sources.filter(source => source.id.startsWith("screen:")),
                windowSources: sources.filter(source => source.id.startsWith("window:")),
                cameraSources: []
            };
        },
        async start(source, options) {
            const sourceId = typeof source === "object" && source && "id" in source && typeof source.id === "string" ? source.id : undefined;
            if (!sourceId || !CHROMIUM_SOURCE_ID.test(sourceId)) {
                logDiagnostic("go live source refused", { code: "unsupported_source" }, true);
                settle(undefined, new Error("This source cannot be shared with DASS."));
                return [false, "unsupported source"];
            }
            const accepted = settle({ sourceId, audio: options?.soundshareEnabled === true, quality: goLiveCaptureQuality(options) });
            return accepted ? [true, undefined] : [false, "cancelled"];
        },
        mount: () => () => { settle(); }
    };
    try {
        const opened = openGoLiveModal(undefined, undefined, undefined, request);
        if (!opened) throw new Error("Discord's Go Live picker did not open.");
        opened.then(key => {
            modalKey = key;
            if (settled) closeModal(key);
        }, error => settle(undefined, error));
    } catch (error) {
        logDiagnostic("go live picker unavailable", { code: "hook_missing" }, true);
        settle(undefined, error instanceof Error ? error : new Error("Discord's Go Live picker is unavailable."));
    }
    return {
        selection: picked.promise,
        cancel() {
            if (settle() && modalKey) closeModal(modalKey);
        }
    };
}

const CAPTURE_REFUSALS = {
    invalid: "DASS could not use this source. Choose another screen or window.",
    own_audio: "Discord's own audio can't be shared. Turn off stream audio to share this window.",
    restart_required: "Restart Discord once to share screen audio without the call's voices, or turn off stream audio."
} as const;

/** Windows soundshare targets: an application's process tree, or everything except Discord for a screen. */
function audioTarget(sourceId: string): DesktopCaptureAudio | undefined {
    if (sourceId.startsWith("screen:")) return { kind: "system" };
    const processId = DiscordNativeUtils.getPidFromDesktopSource(sourceId);
    return processId ? { kind: "application", processId } : undefined;
}

/**
 * Official Discord desktop has no Equibop picker or venmic. Source, quality and
 * audio come from Discord's own Go Live picker. The main process grants that
 * exact source to this renderer's getDisplayMedia call, with Windows process
 * loopback for stream audio: application audio for a window, everything except
 * Discord for a screen. No microphone device is ever requested.
 */
export function createDesktopCaptureBridge(nativeSharing: () => boolean) {
    const native = desktopCaptureNative();
    const devices = navigator.mediaDevices;
    if (!native || typeof devices?.getDisplayMedia !== "function") return;
    let audioSelected = false;
    let cancelPicker: (() => void) | undefined;
    return createCaptureBridge({
        claim: () => {
            if (nativeSharing()) throw new Error("Stop your Discord screen share before starting DASS.");
            return () => {};
        },
        cancelPicker: () => cancelPicker?.(),
        capture: async () => {
            audioSelected = false;
            const picker = openGoLivePicker(native);
            cancelPicker = picker.cancel;
            let selection: DesktopSelection;
            try {
                selection = await picker.selection;
            } finally {
                cancelPicker = undefined;
            }
            const audio = selection.audio ? audioTarget(selection.sourceId) : undefined;
            if (selection.audio && !audio) {
                showToast({ text: "DASS could not find this window's app for stream audio. Turn off stream audio to share it." });
                throw new Error("Share audio target unavailable.");
            }
            const prepared = await Native.prepareDesktopCapture(selection.sourceId, audio);
            if (!prepared.ok) {
                logDiagnostic("desktop capture refused", { code: prepared.error }, true);
                showToast({ text: CAPTURE_REFUSALS[prepared.error] });
                throw new Error("Desktop capture refused.");
            }
            audioSelected = selection.audio;
            const { maxWidth, maxHeight, maxFrameRate } = selection.quality;
            return devices.getDisplayMedia({
                video: { width: { max: maxWidth }, height: { max: maxHeight }, frameRate: { max: maxFrameRate } },
                audio: selection.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
            });
        },
        audioSelected: () => audioSelected,
        unmute: () => Promise.resolve(),
        stopAudio: () => Promise.resolve()
    });
}
