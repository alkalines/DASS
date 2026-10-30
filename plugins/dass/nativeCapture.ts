/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { app, type DisplayMediaRequestHandlerHandlerRequest, type IpcMainInvokeEvent, type Session, webContents } from "electron";

/**
 * Main-process half of DASS capture on official Discord desktop.
 *
 * Share audio uses Windows process loopback, as Discord's own soundshare does:
 * an application source captures only that application's process tree, and a
 * screen captures everything except Discord. Chromium excludes the process tree
 * of its audio service ("loopbackWithoutChrome"); with the service inside the
 * browser process that tree is all of Discord, including call voices.
 */

const SOURCE_ID = /^(?:screen|window):\d+:-?\d+$/;
const MAX_PROCESS_ID = 2 ** 31 - 1;
const SELECTION_TIMEOUT_MS = 10_000;
const AUDIO_SERVICE_FEATURE = "AudioServiceOutOfProcess";

export type DesktopCaptureAudio = { kind: "application"; processId: number; } | { kind: "system"; };
export type DesktopCaptureResult = { ok: true; } | { ok: false; error: "invalid" | "own_audio" | "restart_required"; };

interface DisplayDevice {
    id: string;
    name: string;
}

const ownAudioExcludable = IS_DISCORD_DESKTOP && process.platform === "win32" && RendererSettings.store.plugins?.DASS?.enabled === true;

// Feature flags are read once at startup. Discord's main script, which runs
// after plugin natives, replaces --disable-features, so merge into every write.
if (ownAudioExcludable) {
    const { commandLine } = app;
    const withFeature = (value?: string) => [...new Set([...(value ?? "").split(",").filter(Boolean), AUDIO_SERVICE_FEATURE])].join(",");
    const appendSwitch = commandLine.appendSwitch.bind(commandLine);
    commandLine.appendSwitch = (name: string, value?: string) => appendSwitch(name, name === "disable-features" ? withFeature(value) : value);
    commandLine.appendSwitch("disable-features", withFeature(commandLine.getSwitchValue("disable-features")));
}

let pending: { webContentsId: number; video: DisplayDevice; audio?: DisplayDevice; expiresAt: number; } | undefined;
const handledSessions = new WeakSet<Session>();

function handleDisplayMediaRequest(request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: unknown) => void) {
    const selection = pending;
    pending = undefined;
    const requester = request.frame ? webContents.fromFrame(request.frame) : undefined;
    if (!selection || requester?.id !== selection.webContentsId || Date.now() > selection.expiresAt) return callback(null);
    // Electron accepts an explicit { id, name } audio device; the id selects
    // the Chromium loopback device.
    callback({ video: selection.video, ...(request.audioRequested && selection.audio ? { audio: selection.audio } : {}) });
}

/**
 * Grants the next getDisplayMedia call of this renderer exactly the source the
 * user chose in Discord's picker. Other display-media requests are refused, as
 * they are without a handler.
 */
export function prepareDesktopCapture(event: IpcMainInvokeEvent, sourceId: unknown, audio: unknown): DesktopCaptureResult {
    if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) return { ok: false, error: "invalid" };
    let audioDevice: DisplayDevice | undefined;
    if (audio !== undefined) {
        const { kind, processId } = (audio ?? {}) as { kind?: unknown; processId?: unknown; };
        if (kind === "application" && typeof processId === "number" && Number.isSafeInteger(processId) && processId > 1 && processId <= MAX_PROCESS_ID) {
            // Discord's windows belong to this process; its tree plays the call voices.
            if (processId === process.pid) return { ok: false, error: "own_audio" };
            audioDevice = { id: `applicationLoopback:${processId}`, name: "Application audio" };
        } else if (kind === "system") {
            // An out-of-process audio service would exclude only itself.
            if (!ownAudioExcludable || app.getAppMetrics().some(metric => metric.serviceName === "audio.mojom.AudioService")) {
                return { ok: false, error: "restart_required" };
            }
            audioDevice = { id: "loopbackWithoutChrome", name: "System audio" };
        } else {
            return { ok: false, error: "invalid" };
        }
    }
    const { session } = event.sender;
    if (!handledSessions.has(session)) {
        session.setDisplayMediaRequestHandler(handleDisplayMediaRequest as Parameters<Session["setDisplayMediaRequestHandler"]>[0]);
        handledSessions.add(session);
    }
    pending = { webContentsId: event.sender.id, video: { id: sourceId, name: "DASS source" }, audio: audioDevice, expiresAt: Date.now() + SELECTION_TIMEOUT_MS };
    return { ok: true };
}
