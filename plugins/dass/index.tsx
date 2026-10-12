/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { SelectedChannelStore, showToast } from "@webpack/common";

import { forgetRememberedAccount, readRememberedAccount, writeRememberedAccount } from "./accountStorage";
import { type EquibopCaptureBridge, LocalCaptureCheck } from "./capture";
import { DiscoveryController } from "./controller";
import { logDiagnostic } from "../../clients/spike/diagnostics";
import { DISCORD_SHARE_PATCHES, type PublishIntent, routePublish, routeWatch, type WatchIntent } from "./discordAdapter";
import { PublishController } from "./publishing";
import { DassSession } from "./session";
import { SettingsPanel } from "./settingsPanel";
import { NativeShareButton, type ShareButtonProps } from "./shareButton";
import { SpikePeer } from "../../clients/spike/peer";
import { stopSpikeTest } from "./spikeTest";
import { WatchController } from "./watching";

const currentCall = () => SelectedChannelStore.getVoiceChannelId();
const discovery = new DiscoveryController();
const session = new DassSession({ read: readRememberedAccount, write: writeRememberedAccount, forget: forgetRememberedAccount }, undefined, currentCall);
const watching = new WatchController(currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare });
const publisher = new PublishController(session, currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare });
const localCapture = new LocalCaptureCheck();
let pluginActive = false;
let unsubscribeWatchStatus: (() => void) | undefined;
let unsubscribePublishStatus: (() => void) | undefined;

function stopMedia() {
    publisher.reset();
    watching.reset();
    stopSpikeTest();
    localCapture.stop();
}

function resetConfiguration() {
    stopMedia();
    session.clear();
    discovery.reset();
    if (pluginActive) void session.start(settings.store.backendUrl);
}

function AccountConfiguration() {
    return <SettingsPanel session={session} publisher={publisher} watching={watching} discovery={discovery} localCapture={localCapture}
        backendUrl={settings.store.backendUrl} beforeAction={stopMedia} allowInsecureLocalDevelopment={settings.store.allowInsecureLocalDevelopment} />;
}

const settings = definePluginSettings({
    defaultDass: {
        type: OptionType.BOOLEAN,
        description: "Use DASS instead of Discord for screen sharing in calls. No automatic Discord fallback.",
        default: true,
        onChange: stopMedia
    },
    backendUrl: {
        type: OptionType.STRING,
        description: "Trusted HTTPS DASS backend origin.",
        default: "https://localhost:8080",
        onChange: resetConfiguration
    },
    account: {
        type: OptionType.COMPONENT,
        description: "DASS account configuration. Passwords are saved with OS-backed encryption, not in ordinary plugin settings.",
        component: AccountConfiguration
    },
    allowInsecureLocalDevelopment: {
        type: OptionType.BOOLEAN,
        description: "Allow loopback HTTP for the advanced scaffold capability check only.",
        default: false,
        hidden: true,
        onChange: resetConfiguration
    }
});

function startRuntime() {
    if (pluginActive) return;
    pluginActive = true;
    logDiagnostic("plugin started", { defaultDass: settings.store.defaultDass });
    discovery.start();
    watching.start();
    publisher.start();
    void session.start(settings.store.backendUrl);
    unsubscribeWatchStatus = watching.subscribeStatus(() => {
        if (watching.getSnapshot().phase === "unauthorized") session.clear();
    });
    let previousPhase = publisher.getSnapshot().phase;
    unsubscribePublishStatus = publisher.subscribe(() => {
        const { phase, message } = publisher.getSnapshot();
        if (phase !== previousPhase && phase === "failed") showToast(message);
        previousPhase = phase;
    });
}

function stopRuntime() {
    logDiagnostic("plugin stopped");
    pluginActive = false;
    unsubscribeWatchStatus?.();
    unsubscribePublishStatus?.();
    unsubscribeWatchStatus = unsubscribePublishStatus = undefined;
    stopMedia();
    publisher.stop();
    watching.stop();
    session.stop();
    discovery.stop();
}

export default definePlugin({
    name: "DASS",
    description: "Discord Alternative ScreenShare: experimental authenticated directory and viewer. No E2EE.",
    // Add the maintainer's confirmed Discord ID before distribution; never invent one.
    authors: [],
    settings,
    patches: DISCORD_SHARE_PATCHES,
    settingsAboutComponent: () => <Paragraph>Configure your account once, then use the call's Share button. Native stream tiles and player integration are still incomplete; the temporary viewer is available only in Advanced options.</Paragraph>,
    ShareButton(props: ShareButtonProps) {
        return <NativeShareButton {...props} controller={publisher} />;
    },
    chooseShareTransport(nativeStart: () => void) {
        logDiagnostic("share action intercepted", { pluginActive, defaultDass: settings.store.defaultDass,
            inCall: !!currentCall(), configured: session.getSnapshot().configured });
        if (!pluginActive || !settings.store.defaultDass) return nativeStart();
        if (!["idle", "failed"].includes(publisher.getSnapshot().phase)) return publisher.reset();
        if (!currentCall()) return showToast("Join a Discord call before sharing.");
        if (!session.getSnapshot().configured) return showToast("Configure your DASS account in plugin settings before sharing.");
        watching.reset();
        stopSpikeTest();
        localCapture.stop();
        const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
        void publisher.publish(settings.store.backendUrl, host.Equibop?.DassCapture);
    },
    stopPublishing() {
        publisher.reset();
        stopSpikeTest();
        localCapture.stop();
    },
    stopWatching() {
        watching.reset();
    },
    routePublish(intent: PublishIntent) {
        return routePublish(watching.routing, intent);
    },
    routeWatch(intent: WatchIntent) {
        if (intent.transport === "discord") return routeWatch(watching.routing, intent);
        return { handled: true, completion: watching.watch(intent.share) };
    },
    detectShares(roomId: string) {
        return watching.routing.detect(roomId);
    },
    start: startRuntime,
    stop: stopRuntime,
    flux: {
        CONNECTION_OPEN: startRuntime,
        VOICE_CHANNEL_SELECT: stopMedia,
        LOGOUT: stopRuntime
    }
});
