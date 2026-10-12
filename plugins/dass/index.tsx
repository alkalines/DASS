/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { SelectedChannelStore, showToast, UserStore } from "@webpack/common";

import { forgetRememberedAccount, readRememberedAccount, writeRememberedAccount } from "./accountStorage";
import { createCallDiscovery } from "./callDiscovery";
import { type EquibopCaptureBridge, LocalCaptureCheck } from "./capture";
import { DiscoveryController } from "./controller";
import { logDiagnostic } from "../../clients/spike/diagnostics";
import { DISCORD_SHARE_PATCHES, isLocalPublisherLive, type PublishIntent, routePublish, routeWatch, type WatchIntent } from "./discordAdapter";
import { gridTileKeyExtractor } from "./gridPresentation";
import { type GridRuntime, type GridTileRenderer, useGridTiles, useHasGridShares } from "./gridTile";
import { PublishController } from "./publishing";
import type { DassShare } from "./routing";
import { DassSession } from "./session";
import { SettingsPanel } from "./settingsPanel";
import { NativeShareButton, type ShareButtonProps, usePublisherStatus, usePublishingState } from "./shareButton";
import { SpikePeer } from "../../clients/spike/peer";
import { stopSpikeTest } from "./spikeTest";
import { WatchController } from "./watching";

const currentCall = () => SelectedChannelStore.getVoiceChannelId();
const discovery = new DiscoveryController();
const session = new DassSession({ read: readRememberedAccount, write: writeRememberedAccount, forget: forgetRememberedAccount }, undefined, currentCall);
const watching = new WatchController(currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare });
const directory = new WatchController(currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare });
const publisher = new PublishController(session, currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare });
const callDiscovery = createCallDiscovery(session, directory, () => settings.store.backendUrl,
    () => !["idle", "failed"].includes(publisher.getSnapshot().phase) || ["loading", "ready", "watching"].includes(watching.getSnapshot().phase));
const localCapture = new LocalCaptureCheck();
let pluginActive = false;
let unsubscribeWatchStatus: (() => void) | undefined;
let unsubscribePublishStatus: (() => void) | undefined;
let unsubscribeAccountStatus: (() => void) | undefined;
let gridWatchEpoch = 0;

function stopGridWatching() {
    ++gridWatchEpoch;
    watching.reset();
}

async function watchGridShare(share: DassShare) {
    if (!pluginActive || currentCall() !== share.roomId || !directory.getSnapshot().shares.some(listed => listed.roomId === share.roomId && listed.shareId === share.shareId)) return;
    const epoch = ++gridWatchEpoch;
    try {
        const access = session.getAccess();
        if (access.roomId !== share.roomId) return;
        const result = await watching.watchListedShare(settings.store.backendUrl, share, access);
        if (!result.ok && pluginActive && epoch === gridWatchEpoch && currentCall() === share.roomId) showToast(result.message);
    } catch {
        if (pluginActive && epoch === gridWatchEpoch && currentCall() === share.roomId) {
            watching.reset("failed", "DASS watching failed. No Discord fallback.");
            showToast(watching.getSnapshot().message);
        }
    }
}

const gridRuntime: GridRuntime = { publisher, directory, watching, currentCall, isActive: () => pluginActive,
    watch: share => { void watchGridShare(share); }, stopWatching: stopGridWatching };

function stopMedia() {
    publisher.reset();
    stopGridWatching();
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
    callDiscovery.start();
    unsubscribeAccountStatus = session.subscribe(() => {
        if (!session.getSnapshot().configured) stopMedia();
    });
    void session.start(settings.store.backendUrl);
    unsubscribeWatchStatus = watching.subscribeStatus(() => {
        if (watching.getSnapshot().phase === "unauthorized") {
            showToast(watching.getSnapshot().message);
            session.clear();
        }
        if (["loading", "ready", "watching"].includes(watching.getSnapshot().phase)) callDiscovery.sync();
        else queueMicrotask(() => callDiscovery.sync());
    });
    let previousPhase = publisher.getSnapshot().phase;
    unsubscribePublishStatus = publisher.subscribe(() => {
        const { phase, message } = publisher.getSnapshot();
        if (phase !== previousPhase && phase === "failed") showToast(message);
        previousPhase = phase;
        if (!["idle", "failed"].includes(phase)) callDiscovery.sync();
        else queueMicrotask(() => callDiscovery.sync());
    });
}

function stopRuntime() {
    logDiagnostic("plugin stopped");
    pluginActive = false;
    unsubscribeWatchStatus?.();
    unsubscribePublishStatus?.();
    unsubscribeAccountStatus?.();
    unsubscribeWatchStatus = unsubscribePublishStatus = undefined;
    unsubscribeAccountStatus = undefined;
    stopMedia();
    callDiscovery.stop();
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
    settingsAboutComponent: () => <Paragraph>Configure your account once, then use the call's Share button. Supported builds show your local LIVE badge and DASS preview/watch tiles in the ordinary grid. Runtime verification, remote voice-row badges and full native player integration remain incomplete. The temporary test viewer remains in Advanced options.</Paragraph>,
    ShareButton(props: ShareButtonProps) {
        return <NativeShareButton {...props} controller={publisher} />;
    },
    usePublishingState(channelId: string) {
        const active = usePublishingState(publisher);
        return pluginActive && channelId === currentCall() && active;
    },
    useLocalLiveState(discordUserId: string, discordChannelId?: string) {
        const status = usePublisherStatus(publisher);
        return isLocalPublisherLive({ pluginActive, publisherPhase: status.phase, discordUserId, discordChannelId,
            localDiscordUserId: UserStore.getCurrentUser()?.id, currentDiscordChannelId: currentCall() });
    },
    useGridTiles(channelId: string, nativeTiles: GridTileRenderer[], className: string) {
        return useGridTiles(gridRuntime, channelId, nativeTiles, className);
    },
    useHasGridShares(channelId: string) {
        return useHasGridShares(gridRuntime, channelId);
    },
    gridTileKeyExtractor,
    chooseShareTransport(nativeStart: () => void) {
        logDiagnostic("share action intercepted", { pluginActive, defaultDass: settings.store.defaultDass,
            inCall: !!currentCall(), configured: session.getSnapshot().configured });
        if (!pluginActive || !settings.store.defaultDass) return nativeStart();
        if (!["idle", "failed"].includes(publisher.getSnapshot().phase)) return publisher.reset();
        if (!currentCall()) return showToast("Join a Discord call before sharing.");
        if (!session.getSnapshot().configured) return showToast("Configure your DASS account in plugin settings before sharing.");
        stopGridWatching();
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
        stopGridWatching();
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
        VOICE_CHANNEL_SELECT() {
            stopMedia();
            queueMicrotask(() => callDiscovery.sync());
        },
        LOGOUT: stopRuntime
    }
});
