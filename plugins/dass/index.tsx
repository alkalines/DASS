/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, type UserAreaRenderProps } from "@api/UserArea";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { ScreenshareIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { closeModal, Modal, openModal, SelectedChannelStore, showToast, useEffect, useState } from "@webpack/common";

import { forgetRememberedAccount, readRememberedAccount, writeRememberedAccount } from "./accountStorage";
import { EquibopCaptureBridge, LocalCaptureCheck } from "./capture";
import { DiscoveryController } from "./controller";
import { createShareSelection, DISCORD_SHARE_PATCHES, PublishIntent, routePublish, routeWatch, WatchIntent } from "./discordAdapter";
import { PublishController } from "./publishing";
import { DassSession } from "./session";
import { SessionPanel } from "./sessionPanel";
import { SpikePeer } from "../../clients/spike/peer";
import { SpikeTestPanel, stopSpikeTest } from "./spikeTest";
import { WatchController } from "./watching";

const discovery = new DiscoveryController();
const session = new DassSession({ read: readRememberedAccount, write: writeRememberedAccount, forget: forgetRememberedAccount });
const watching = new WatchController(() => SelectedChannelStore.getVoiceChannelId(), {
    connect: options => session.connect(options), prepare: SpikePeer.prepare
});
const publisher = new PublishController(session, () => SelectedChannelStore.getVoiceChannelId(), {
    connect: options => session.connect(options), prepare: SpikePeer.prepare
});
const screenshare = watching.routing;
const localCapture = new LocalCaptureCheck();
let pluginActive = false;
let unsubscribeWatchStatus: (() => void) | undefined;
let shareChooser: { key: string; abort: AbortController; } | undefined;

function closeShareChooser() {
    const chooser = shareChooser;
    shareChooser = undefined;
    if (!chooser) return;
    chooser.abort.abort();
    closeModal(chooser.key);
}

function resetConfiguration() {
    publisher.reset();
    session.clear();
    watching.reset();
    stopSpikeTest();
    localCapture.stop();
    closeShareChooser();
    discovery.reset();
    screenshare.reset();
    if (pluginActive) void session.start(settings.store.backendUrl);
}

const settings = definePluginSettings({
    defaultDass: {
        type: OptionType.BOOLEAN,
        description: "Use DASS directly from supported Share buttons. Disable to choose Discord or DASS explicitly. Requires a client restart after enabling the plugin's patches.",
        default: true
    },
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

function beforePublish() {
    watching.reset();
    stopSpikeTest();
    localCapture.stop();
}

function beforeWatch() {
    publisher.reset();
    watching.reset();
    stopSpikeTest();
    localCapture.stop();
}

function forgetSession() {
    publisher.reset();
    watching.reset();
    void session.forget().catch(() => showToast("Saved DASS login could not be removed. Check local storage access."));
}

function startRuntime() {
    if (pluginActive) return;
    pluginActive = true;
    discovery.start();
    watching.start();
    publisher.start();
    void session.start(settings.store.backendUrl);
    unsubscribeWatchStatus?.();
    unsubscribeWatchStatus = watching.subscribeStatus(() => {
        if (watching.getSnapshot().phase === "unauthorized") session.clear();
    });
}

function DassSessionPanel() {
    return <SessionPanel session={session} publisher={publisher} watching={watching} backendUrl={settings.store.backendUrl}
        beforePublish={beforePublish} beforeWatch={beforeWatch} onForget={forgetSession} />;
}

function openDassShare(startPublishing = true) {
    closeShareChooser();
    const abort = new AbortController();
    const key = openModal(props => <ErrorBoundary><Modal {...props} title="DASS screenshare"
        actions={[{ text: "Close panel (keep sharing)", variant: "secondary", onClick: closeShareChooser }]}>
        <DassSessionPanel />
    </Modal></ErrorBoundary>, { onCloseCallback: () => {
        abort.abort();
        if (shareChooser?.abort === abort) shareChooser = undefined;
    } });
    shareChooser = { key, abort };
    if (startPublishing && session.getSnapshot().configured && ["idle", "failed"].includes(publisher.getSnapshot().phase)) {
        beforePublish();
        const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
        void publisher.publish(settings.store.backendUrl, host.Equibop?.DassCapture);
    }
}

function DassUserAreaButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const [status, setStatus] = useState(publisher.getSnapshot());
    useEffect(() => publisher.subscribe(() => setStatus(publisher.getSnapshot())), []);
    const capturing = ["preparing", "prepared", "activating", "publishing"].includes(status.phase);
    const label = capturing ? "DASS capture active. Open controls to stop sharing." : "Open DASS sharing and stream controls";
    return <UserAreaButton icon={<ScreenshareIcon className={iconForeground} />} aria-label={label}
        tooltipText={hideTooltips ? undefined : label} redGlow={capturing} plated={nameplate != null}
        onClick={() => openDassShare(false)} />;
}

const SafeDassUserAreaButton = ErrorBoundary.wrap(DassUserAreaButton, { noop: true });

function DiscoveryPanel() {
    const [status, setStatus] = useState(discovery.getSnapshot());
    const [captureStatus, setCaptureStatus] = useState("Local-only capture diagnostics have not been run.");
    useEffect(() => {
        const unsubscribe = discovery.subscribe(() => setStatus(discovery.getSnapshot()));
        setStatus(discovery.getSnapshot());
        return unsubscribe;
    }, []);
    return (
        <div>
            <Paragraph>Discord Alternative ScreenShare provides an experimental DASS directory and one-viewer transport. E2EE and production readiness remain unavailable.</Paragraph>
            <Paragraph>On Discord build 634304, the center call and Voice Connected Share buttons open DASS by default. Disable the default-DASS setting for an explicit transport chooser. Other entry points remain native Discord.</Paragraph>
            <Paragraph>Configure session access once below, then use Share → the installed Equibop picker → DASS. The server must allow your client's UDP endpoints. No synthetic Discord streams or previews are created.</Paragraph>
            <DassSessionPanel />
            <details><summary>Advanced diagnostics and legacy manual transport</summary>
                <Paragraph role="status" aria-live="polite">{status.message}</Paragraph>
                <Button disabled={status.phase === "stopped" || status.phase === "checking"}
                    onClick={() => void discovery.check(settings.store)}>Check backend capabilities</Button>
                <SpikeTestPanel backendUrl={settings.store.backendUrl} isActive={() => pluginActive} beforePrepare={() => { publisher.reset(); watching.reset(); }} />
                <Paragraph role="status" aria-live="polite">{captureStatus}</Paragraph>
                <Button disabled={status.phase === "stopped"} onClick={() => {
                    beforePublish();
                    publisher.reset();
                    const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
                    setCaptureStatus("Opening the installed host picker for local capture only. Nothing will be transmitted.");
                    void localCapture.capture(host.Equibop?.DassCapture).then(setCaptureStatus);
                }}>Test local capture (no transport)</Button>
                <Button onClick={() => {
                    localCapture.stop();
                    setCaptureStatus("Local capture stopped. Pending capture is cancelled; any late tracks will be stopped.");
                }}>Stop local capture</Button>
            </details>
        </div>
    );
}

export default definePlugin({
    name: "DASS",
    description: "Discord Alternative ScreenShare: experimental authenticated directory and viewer. No E2EE.",
    // Add the maintainer's confirmed Discord ID before distribution; never invent one.
    authors: [],
    dependencies: ["UserAreaAPI"],
    userAreaButton: { icon: ScreenshareIcon, render: props => <SafeDassUserAreaButton {...props} /> },
    settings,
    patches: DISCORD_SHARE_PATCHES,
    settingsAboutComponent: DiscoveryPanel,
    chooseShareTransport(nativeStart: () => void) {
        if (!pluginActive) return nativeStart();
        closeShareChooser();
        const voiceChannelId = SelectedChannelStore.getVoiceChannelId();
        if (!voiceChannelId) return;
        if (settings.store.defaultDass) return openDassShare();
        const abort = new AbortController();
        const select = createShareSelection(abort.signal,
            () => pluginActive && SelectedChannelStore.getVoiceChannelId() === voiceChannelId,
            () => { closeShareChooser(); publisher.reset(); nativeStart(); }, openDassShare);
        const key = openModal(props => (
            <ErrorBoundary>
                <Modal
                    {...props}
                    title="Choose screenshare transport"
                    actions={[
                        { text: "DASS", variant: "primary", onClick: () => {
                            const message = select("dass");
                            if (message) showToast(message);
                        } },
                        { text: "Discord", variant: "secondary", onClick: () => select("discord") },
                        { text: "Cancel", variant: "secondary", onClick: closeShareChooser }
                    ]}
                >
                    <Paragraph>DASS uses your session access and the installed Equibop picker. It never falls back to Discord on failure. Selecting Discord explicitly uses native sharing.</Paragraph>
                </Modal>
            </ErrorBoundary>
        ), { onCloseCallback: () => {
            abort.abort();
            if (shareChooser?.abort === abort) shareChooser = undefined;
        } });
        shareChooser = { key, abort };
    },
    setDassRoom(roomId?: string) {
        publisher.reset();
        watching.reset();
        stopSpikeTest();
        localCapture.stop();
        if (roomId) showToast("Configure this authorized DASS room in session setup.");
    },
    stopPublishing() {
        publisher.reset();
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
        startRuntime();
    },
    stop() {
        unsubscribeWatchStatus?.();
        unsubscribeWatchStatus = undefined;
        publisher.stop();
        session.stop();
        stopSpikeTest();
        localCapture.stop();
        pluginActive = false;
        closeShareChooser();
        discovery.stop();
        watching.stop();
    },
    flux: {
        CONNECTION_OPEN() {
            startRuntime();
        },
        VOICE_CHANNEL_SELECT() {
            publisher.reset();
            watching.reset();
            stopSpikeTest();
            localCapture.stop();
            closeShareChooser();
            screenshare.setRoom(undefined);
        },
        LOGOUT() {
            unsubscribeWatchStatus?.();
            unsubscribeWatchStatus = undefined;
            publisher.stop();
            session.stop();
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
