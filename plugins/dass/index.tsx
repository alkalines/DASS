/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { closeModal, Modal, openModal, SelectedChannelStore, showToast, useEffect, useState } from "@webpack/common";

import { EquibopCaptureBridge, LocalCaptureCheck } from "./capture";
import { DiscoveryController } from "./controller";
import { createShareSelection, DISCORD_SHARE_PATCHES, PublishIntent, routePublish, routeWatch, WatchIntent } from "./discordAdapter";
import { SpikeTestPanel, stopSpikeTest } from "./spikeTest";
import { WatchController } from "./watching";
import { WatchPanel } from "./watchPanel";

const discovery = new DiscoveryController();
const watching = new WatchController(() => SelectedChannelStore.getVoiceChannelId());
const screenshare = watching.routing;
const localCapture = new LocalCaptureCheck();
let pluginActive = false;
let shareChooser: { key: string; abort: AbortController; } | undefined;

function closeShareChooser() {
    const chooser = shareChooser;
    shareChooser = undefined;
    if (!chooser) return;
    chooser.abort.abort();
    closeModal(chooser.key);
}

function resetConfiguration() {
    watching.reset();
    stopSpikeTest();
    localCapture.stop();
    closeShareChooser();
    discovery.reset();
    screenshare.reset();
}

const settings = definePluginSettings({
    backendUrl: {
        type: OptionType.STRING,
        description: "Trusted DASS backend base URL. No credentials, query parameters or fragments.",
        default: "https://localhost:8080",
        onChange: resetConfiguration
    },
    allowInsecureLocalDevelopment: {
        type: OptionType.BOOLEAN,
        description: "Allow HTTP on loopback and a development backend. Never use for production.",
        default: false,
        onChange: resetConfiguration
    }
});

function DiscoveryPanel() {
    const [status, setStatus] = useState(discovery.getSnapshot());
    const [captureStatus, setCaptureStatus] = useState("Local capture has not been tested. No transport is available.");
    useEffect(() => {
        const unsubscribe = discovery.subscribe(() => setStatus(discovery.getSnapshot()));
        setStatus(discovery.getSnapshot());
        return unsubscribe;
    }, []);
    return (
        <div>
            <Paragraph>Discord Alternative ScreenShare provides an experimental DASS directory and one-viewer transport. E2EE and production readiness remain unavailable.</Paragraph>
            <Paragraph>On Discord build 634304, the center call and Voice Connected panel share buttons offer Discord or DASS before native sharing. Other share entry points still use Discord.</Paragraph>
            <Paragraph>Native share-button DASS selection still reports transport unavailable. Use the separate test publisher and DASS directory below; no synthetic Discord streams are created.</Paragraph>
            <Paragraph role="status" aria-live="polite">{status.message}</Paragraph>
            <Button
                disabled={status.phase === "stopped" || status.phase === "checking"}
                onClick={() => void discovery.check(settings.store)}
            >
                Check backend capabilities
            </Button>
            <Paragraph role="status" aria-live="polite">{captureStatus}</Paragraph>
            <WatchPanel controller={watching} backendUrl={settings.store.backendUrl} beforePrepare={stopSpikeTest} />
            <SpikeTestPanel backendUrl={settings.store.backendUrl} isActive={() => pluginActive} beforePrepare={() => watching.reset()} />
            <Button disabled={status.phase === "stopped"} onClick={() => {
                const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
                setCaptureStatus("Opening the installed host picker for local capture only. Nothing will be transmitted.");
                void localCapture.capture(host.Equibop?.DassCapture).then(setCaptureStatus);
            }}>Test local capture (no transport)</Button>
            <Button onClick={() => {
                localCapture.stop();
                setCaptureStatus("Local capture stopped. Pending capture is cancelled; any late tracks will be stopped.");
            }}>Stop local capture</Button>
        </div>
    );
}

export default definePlugin({
    name: "DASS",
    description: "Discord Alternative ScreenShare: experimental authenticated directory and viewer. No E2EE.",
    // Add the maintainer's confirmed Discord ID before distribution; never invent one.
    authors: [],
    settings,
    patches: DISCORD_SHARE_PATCHES,
    settingsAboutComponent: DiscoveryPanel,
    chooseShareTransport(nativeStart: () => void) {
        if (!pluginActive) return nativeStart();
        closeShareChooser();
        const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
        if (!voiceChannelId) return;
        const abort = new AbortController();
        const select = createShareSelection(abort.signal,
            () => pluginActive && SelectedChannelStore.getVoiceChannelId() === voiceChannelId,
            () => { closeShareChooser(); nativeStart(); });
        const key = openModal(props => (
            <ErrorBoundary>
                <Modal
                    {...props}
                    title="Choose screenshare transport"
                    actions={[
                        { text: "DASS", variant: "primary", onClick: () => {
                            const message = select("dass");
                            closeShareChooser();
                            if (message) showToast(message);
                        } },
                        { text: "Discord", variant: "secondary", onClick: () => select("discord") },
                        { text: "Cancel", variant: "secondary", onClick: closeShareChooser }
                    ]}
                >
                    <Paragraph>DASS transport is unavailable. Selecting DASS will not open capture or start a Discord share. Selecting Discord uses native sharing.</Paragraph>
                </Modal>
            </ErrorBoundary>
        ), { onCloseCallback: () => {
            abort.abort();
            if (shareChooser?.abort === abort) shareChooser = undefined;
        } });
        shareChooser = { key, abort };
    },
    setDassRoom(roomId?: string) {
        watching.reset();
        stopSpikeTest();
        localCapture.stop();
        if (roomId) showToast("Bind this DASS room with a separate credential in the DASS directory panel.");
    },
    stopPublishing() {
        stopSpikeTest();
        localCapture.stop();
        screenshare.stopPublishing();
    },
    stopWatching() {
        stopSpikeTest();
        watching.reset();
    },
    routePublish(intent: PublishIntent) {
        return routePublish(screenshare, intent);
    },
    routeWatch(intent: WatchIntent) {
        if (intent.transport === "discord") return routeWatch(screenshare, intent);
        return { handled: true, completion: watching.watch(intent.share) };
    },
    detectShares(roomId: string) {
        return screenshare.detect(roomId);
    },
    start() {
        pluginActive = true;
        discovery.start();
        watching.start();
    },
    stop() {
        stopSpikeTest();
        localCapture.stop();
        pluginActive = false;
        closeShareChooser();
        discovery.stop();
        watching.stop();
    },
    flux: {
        VOICE_CHANNEL_SELECT() {
            watching.reset();
            stopSpikeTest();
            localCapture.stop();
            closeShareChooser();
            screenshare.setRoom(undefined);
        },
        LOGOUT() {
            watching.stop();
            stopSpikeTest();
            localCapture.stop();
            pluginActive = false;
            closeShareChooser();
            discovery.stop();
            screenshare.stop();
        }
    }
});
