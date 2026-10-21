/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./desktopCapture.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Checkbox, closeModal, Modal, openModal, useEffect, useState } from "@webpack/common";

import { createCaptureBridge } from "./captureLifecycle";

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
}

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const MAX_FRAME_RATE = 30;
const PREVIEW_SIZE = { width: 320, height: 180 };

interface DesktopGlobals {
    DiscordNative?: { desktopCapture?: Partial<DesktopCaptureNative>; };
}

function desktopCaptureNative(): DesktopCaptureNative | undefined {
    const host: typeof globalThis & DesktopGlobals = globalThis;
    const native = host.DiscordNative?.desktopCapture;
    return typeof native?.getDesktopCaptureSources === "function" ? native as DesktopCaptureNative : undefined;
}

interface PickerProps extends RenderModalProps {
    native: DesktopCaptureNative;
    choose(selection: DesktopSelection | undefined): void;
}

function DesktopPicker({ native, choose, ...modalProps }: PickerProps) {
    const [sources, setSources] = useState<DesktopSource[] | "failed">();
    const [selected, setSelected] = useState<string>();
    const [audio, setAudio] = useState(false);
    useEffect(() => {
        let current = true;
        // Previews stay inside this modal; they are never uploaded anywhere.
        native.getDesktopCaptureSources({ types: ["screen", "window"], thumbnailSize: PREVIEW_SIZE })
            .then(list => { if (current) setSources(list); }, () => { if (current) setSources("failed"); });
        return () => { current = false; };
    }, [native]);
    return <Modal {...modalProps} size="md" title="Share your screen with DASS" subtitle="Choose a screen or window. Nothing is captured until you click Share."
        actions={[
            { text: "Cancel", variant: "secondary", onClick: () => choose(undefined) },
            { text: "Share", variant: "primary", disabled: !selected, onClick: () => selected && choose({ sourceId: selected, audio }) }
        ]}>
        {sources === undefined && <Paragraph>Loading screens and windows…</Paragraph>}
        {sources === "failed" && <Paragraph>Discord could not list your screens and windows. Close this dialog and try again.</Paragraph>}
        {Array.isArray(sources) && <div className="vc-dass-desktop-sources" role="listbox" aria-label="Screens and windows">
            {sources.map(source => <button key={source.id} type="button" role="option" aria-selected={source.id === selected}
                className={classes("vc-dass-desktop-source", source.id === selected && "vc-dass-desktop-source-selected")}
                onClick={() => setSelected(source.id)} onDoubleClick={() => choose({ sourceId: source.id, audio })}>
                <img src={source.url} alt="" />
                <span>{source.name}</span>
            </button>)}
        </div>}
        <div className="vc-dass-desktop-audio">
            <Checkbox value={audio} onChange={(_, value) => setAudio(value)}>
                <Paragraph>Include system audio. Windows shares everything you hear, including the voices in this call, so viewers hear them twice.</Paragraph>
            </Checkbox>
        </div>
    </Modal>;
}

const SafeDesktopPicker = ErrorBoundary.wrap(DesktopPicker, { message: "DASS screen picker failed. Nothing was captured." });

/** Opens the picker and returns a function that dismisses it without a selection. */
function openDesktopPicker(native: DesktopCaptureNative, resolve: (selection: DesktopSelection) => void, reject: (error: Error) => void) {
    let settled = false;
    const finish = (selection: DesktopSelection | undefined) => {
        if (settled) return;
        settled = true;
        closeModal(modalKey);
        if (selection) resolve(selection);
        else reject(new Error("Screen selection was cancelled."));
    };
    const modalKey = openModal(props => <SafeDesktopPicker {...props} native={native} choose={finish} />,
        { onCloseRequest: () => finish(undefined), onCloseCallback: () => finish(undefined) });
    return () => finish(undefined);
}

/**
 * Official Discord desktop has no Equibop picker or venmic. Capture uses
 * Chromium's desktop source inside this renderer; share audio is the Windows
 * system loopback and only when the user ticks the checkbox. No microphone
 * device is ever requested.
 */
export function createDesktopCaptureBridge(nativeSharing: () => boolean) {
    const native = desktopCaptureNative();
    const devices = navigator.mediaDevices;
    if (!native || typeof devices?.getUserMedia !== "function") return;
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
            const picked = Promise.withResolvers<DesktopSelection>();
            cancelPicker = openDesktopPicker(native, picked.resolve, picked.reject);
            let selection: DesktopSelection;
            try {
                selection = await picked.promise;
            } finally {
                cancelPicker = undefined;
            }
            audioSelected = selection.audio;
            // Chromium's legacy desktop constraints; `chromeMediaSource: "desktop"`
            // on audio selects system loopback, never an input device.
            return devices.getUserMedia({
                audio: selection.audio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
                video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: selection.sourceId,
                    maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT, maxFrameRate: MAX_FRAME_RATE } }
            } as unknown as MediaStreamConstraints);
        },
        audioSelected: () => audioSelected,
        unmute: () => Promise.resolve(),
        stopAudio: () => Promise.resolve()
    });
}
