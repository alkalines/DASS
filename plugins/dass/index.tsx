/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, SelectedChannelStore, showToast, UserStore } from "@webpack/common";
import type { ComponentType } from "react";

import { forgetRememberedAccount, readRememberedAccount, writeRememberedAccount } from "./accountStorage";
import { createCallDiscovery } from "./callDiscovery";
import { isDassParticipant, isFocusedDassWatch, participantTitle, projectParticipants } from "./callPresentation";
import { LocalCaptureCheck } from "./capture";
import { getCaptureBridge, stopCaptureHost } from "./captureHost";
import { DiscoveryController } from "./controller";
import { useDassGoLive } from "./desktopCapture";
import { logDiagnostic } from "../../clients/spike/diagnostics";
import { DISCORD_GO_LIVE_PATCHES, DISCORD_PRESENTATION_PATCHES, DISCORD_SHARE_PATCHES, getDiscordBuildWarning, isLocalPublisherLive, type PublishIntent, routePublish, routeWatch, type WatchIntent } from "./discordAdapter";
import { configureIdentityBackend, defaultIdentityStore } from "./e2eeIdentity";
import { gridShares, gridTileKeyExtractor } from "./gridPresentation";
import { CallAudioControl, callPresentation, type CallTileProps, type CallViewProps, type FocusedCallProps, type GridRuntime, type GridTileRenderer, NativeCallView, NativeGridTile, type TileAction, useFocusedCallProps, useFocusedWatchingState, useGridTiles, useHasGridShares } from "./gridTile";
import { hasAcceptedPublishCapture, PublishController } from "./publishing";
import type { DassShare } from "./routing";
import { DassSession } from "./session";
import { SettingsPanel } from "./settingsPanel";
import { NativeShareButton, NativeStreamMenu, type ShareButtonProps, type StreamMenuProps, usePublisherStatus, usePublishingState } from "./shareButton";
import { cancelShareTransportChooser, showShareTransportChooser } from "./shareTransport";
import { sidebarActionProps, type SidebarState, stopSidebarStream } from "./sidebarPresentation";
import { SpikePeer } from "../../clients/spike/peer";
import { stopSpikeTest } from "./spikeTest";
import { streamQualityLabel, streamTrackQuality } from "./streamPresentation";
import { startStreamSounds } from "./streamSounds";
import { StreamSidebarBody } from "./streamUi";
import { startUpdateNotifications } from "./updateNotifications";
import { startViewerApprovalPrompts } from "./viewerApproval";
import { WatchController } from "./watching";
import { WatchSet } from "./watchSet";

const currentCall = () => SelectedChannelStore.getVoiceChannelId();
const discovery = new DiscoveryController();
const session = new DassSession({ read: readRememberedAccount, write: writeRememberedAccount, forget: forgetRememberedAccount }, undefined, currentCall);
const viewer = () => new WatchController(currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare, identityStore: defaultIdentityStore });
/** One independent viewer per watched stream; any number of streams up to MAX_WATCHED_STREAMS. */
const watches = new WatchSet(viewer, message => showToast({ text: message }));
/** The advanced settings test viewer; separate from call watching. */
const testViewer = viewer();
const directory = viewer();
const publisher = new PublishController(session, currentCall, { connect: options => session.connect(options), prepare: SpikePeer.prepare, identityStore: defaultIdentityStore,
    requireVerifiedViewers: () => settings.store.requireVerifiedViewers, autoApproveViewers: () => settings.store.autoApproveViewers });
const callDiscovery = createCallDiscovery(session, directory, () => settings.store.backendUrl);
const localCapture = new LocalCaptureCheck();
let pluginActive = false;
let buildWarningShown = false;
let unsubscribeWatchStatus: (() => void) | undefined;
let unsubscribePublishStatus: (() => void) | undefined;
let unsubscribeAccountStatus: (() => void) | undefined;
let unsubscribeDirectoryStatus: (() => void) | undefined;
let stopStreamSounds: (() => void) | undefined;
let stopUpdateNotifications: (() => void) | undefined;
let stopViewerPrompts: (() => void) | undefined;
/** Per-share request generation, so a stopped or replaced watch cannot toast late. */
const watchRequests = new Map<string, number>();
let watchRequest = 0;
/** Last voice channel seen by VOICE_CHANNEL_SELECT; re-selecting it keeps media running. */
let selectedVoiceChannelId: string | undefined;

const shareKey = (share: DassShare) => `${share.roomId}:${share.shareId}`;

function stopGridWatching() {
    watchRequests.clear();
    watches.stopAll();
    callPresentation.reset();
}

function stopWatchingShare(share: DassShare) {
    watchRequests.delete(shareKey(share));
    watches.stopWatching(share);
    if (!watches.getSnapshot().length) callPresentation.reset();
    else if (callPresentation.getSelected(share.roomId, currentParticipants(share.roomId))?.id === `dass-remote:${share.roomId}:${share.shareId}`) {
        callPresentation.clearSelection();
    }
}

async function watchGridShare(share: DassShare) {
    if (!pluginActive || currentCall() !== share.roomId || !directory.getSnapshot().shares.some(listed => listed.roomId === share.roomId && listed.shareId === share.shareId)) return;
    const key = shareKey(share);
    const request = ++watchRequest;
    watchRequests.set(key, request);
    const current = () => pluginActive && watchRequests.get(key) === request && currentCall() === share.roomId;
    try {
        const access = session.getAccess();
        if (access.roomId !== share.roomId) return;
        const result = await watches.watch(settings.store.backendUrl, share, access);
        if (!result.ok && current()) showToast({ text: result.message });
    } catch {
        if (current()) showToast({ text: "DASS watching failed. No Discord fallback." });
    }
}

const gridRuntime: GridRuntime = { publisher, directory, watches, currentCall, isActive: () => pluginActive,
    localDisplayName: () => { const user = UserStore.getCurrentUser(); return user?.globalName ?? user?.username; },
    watch: share => { void watchGridShare(share); }, stopWatching: stopWatchingShare, stopPublishing: () => publisher.reset(),
    trustPublisherAndWatch: share => {
        void watches.acceptPublisherIdentity(share).then(() => watchGridShare(share),
            () => showToast({ text: "The new streamer identity could not be saved. Nothing was trusted." }));
    } };

function currentParticipants(channelId: string) {
    return projectParticipants(gridShares(channelId, currentCall(), pluginActive, !!publisher.getPreviewStream(), directory.getSnapshot(), watches.getSnapshot()));
}

const DassSidebarBody = ErrorBoundary.wrap(StreamSidebarBody, { message: "DASS stream card failed." });

function hasCallShares(discordChannelId: string) {
    return currentParticipants(discordChannelId).length > 0;
}

function releaseUnavailableFullscreen() {
    callPresentation.releaseUnavailableFullscreen(hasCallShares);
}

function stopMedia() {
    cancelShareTransportChooser();
    callPresentation.exitFullscreen();
    publisher.reset();
    stopGridWatching();
    testViewer.reset();
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
    return <SettingsPanel session={session} publisher={publisher} watching={testViewer} discovery={discovery} localCapture={localCapture}
        backendUrl={settings.store.backendUrl} beforeAction={stopMedia} allowInsecureLocalDevelopment={settings.store.allowInsecureLocalDevelopment} />;
}

const settings = definePluginSettings({
    checkUpdates: {
        type: OptionType.BOOLEAN,
        description: "Check this project's public GitHub Releases on startup and offer a manual download. No automatic installation.",
        default: true,
        onChange(enabled: boolean) {
            stopUpdateNotifications?.();
            stopUpdateNotifications = pluginActive && enabled ? startUpdateNotifications() : undefined;
        }
    },
    defaultDass: {
        type: OptionType.BOOLEAN,
        description: "Prefer DASS in the transport chooser. Sharing always requires an explicit Discord or DASS choice.",
        default: true,
        onChange: cancelShareTransportChooser
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
    },
    requireVerifiedViewers: {
        type: OptionType.BOOLEAN,
        description: "Only admit viewers whose E2EE identity was independently verified with a safety-number comparison.",
        default: false
    },
    autoApproveViewers: {
        type: OptionType.BOOLEAN,
        description: "Approve DASS viewers automatically. Turn off to require permission for each watch request. Changed fingerprints always require review; verified-only policy still applies.",
        default: true
    }
});

function startRuntime() {
    if (pluginActive) return;
    pluginActive = true;
    selectedVoiceChannelId = currentCall() ?? undefined;
    if (settings.store.checkUpdates) stopUpdateNotifications = startUpdateNotifications();
    const buildWarning = getDiscordBuildWarning(Number(window.GLOBAL_ENV.BUILD_NUMBER));
    if (buildWarning && !buildWarningShown) {
        buildWarningShown = true;
        void showNotification({ title: "DASS compatibility warning", body: buildWarning });
    }
    logDiagnostic("plugin started", { defaultDass: settings.store.defaultDass });
    configureIdentityBackend(DataStore);
    getCaptureBridge();
    discovery.start();
    watches.start();
    testViewer.start();
    publisher.start();
    stopStreamSounds = startStreamSounds(publisher, watches, currentCall);
    stopViewerPrompts = startViewerApprovalPrompts(publisher);
    callDiscovery.start();
    unsubscribeAccountStatus = session.subscribe(() => {
        if (!session.getSnapshot().configured) stopMedia();
    });
    void session.start(settings.store.backendUrl);
    unsubscribeWatchStatus = watches.subscribeStatus(() => {
        releaseUnavailableFullscreen();
        queueMicrotask(() => callDiscovery.sync());
    });
    unsubscribeDirectoryStatus = directory.subscribeStatus(releaseUnavailableFullscreen);
    let previousPhase = publisher.getSnapshot().phase;
    unsubscribePublishStatus = publisher.subscribe(() => {
        releaseUnavailableFullscreen();
        const { phase, message } = publisher.getSnapshot();
        if (phase !== previousPhase && phase === "failed") showToast({ text: message });
        previousPhase = phase;
        if (!["idle", "failed"].includes(phase)) callDiscovery.sync();
        else queueMicrotask(() => callDiscovery.sync());
    });
}

function stopRuntime() {
    logDiagnostic("plugin stopped");
    pluginActive = false;
    stopUpdateNotifications?.();
    stopUpdateNotifications = undefined;
    stopStreamSounds?.();
    stopStreamSounds = undefined;
    stopViewerPrompts?.();
    stopViewerPrompts = undefined;
    unsubscribeWatchStatus?.();
    unsubscribePublishStatus?.();
    unsubscribeAccountStatus?.();
    unsubscribeDirectoryStatus?.();
    unsubscribeWatchStatus = unsubscribePublishStatus = undefined;
    unsubscribeAccountStatus = undefined;
    unsubscribeDirectoryStatus = undefined;
    stopMedia();
    callDiscovery.stop();
    stopCaptureHost();
    publisher.stop();
    watches.stop();
    testViewer.stop();
    session.stop();
    discovery.stop();
}

export default definePlugin({
    name: "DASS",
    description: "Discord Alternative ScreenShare: experimental authenticated directory and viewer. No E2EE.",
    // Add the maintainer's confirmed Discord ID before distribution; never invent one.
    authors: [],
    settings,
    commands: [{
        name: "dass_refresh",
        description: "Refresh DASS streams in your current call without stopping media.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute() {
            if (!session.getSnapshot().configured) showToast({ text: "Sign in to DASS in plugin settings first." });
            else if (!currentCall()) showToast({ text: "Join a Discord call before refreshing DASS streams." });
            else {
                callDiscovery.retry();
                showToast({ text: "Refreshing DASS streams." });
            }
        }
    }],
    patches: [...DISCORD_SHARE_PATCHES, ...DISCORD_GO_LIVE_PATCHES, ...DISCORD_PRESENTATION_PATCHES],
    settingsAboutComponent: () => <Paragraph>Configure your account once, then use the call's Share button. On Discord desktop, choosing DASS opens Discord's own Go Live picker and captures the chosen source, quality and stream audio for DASS. Supported builds route DASS tiles through the call grid, focused layout and filmstrip, with independent share audio controls and a local sidebar card. Runtime verification, zoom, individual tile popouts and remote voice-row badges remain incomplete. The temporary test viewer remains in Advanced options.</Paragraph>,
    useDassGoLive,
    ShareButton(props: ShareButtonProps) {
        return <NativeShareButton {...props} controller={publisher} />;
    },
    StreamMenu(props: StreamMenuProps) {
        return <NativeStreamMenu {...props} controller={publisher} currentChannelId={pluginActive ? currentCall() : undefined} changeSource={() => {
            void publisher.changeSource(settings.store.backendUrl, getCaptureBridge());
        }} />;
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
    useGridTiles(channelId: string, nativeTiles: GridTileRenderer[], className: string, onClick?: TileAction, onDoubleClick?: TileAction) {
        return useGridTiles(gridRuntime, channelId, nativeTiles, className, onClick, onDoubleClick);
    },
    useHasGridShares(channelId: string) {
        return useHasGridShares(gridRuntime, channelId);
    },
    hasCallShares,
    ownCallFullscreen(discordChannelId: string, appContext: unknown, exit: () => void) {
        callPresentation.ownFullscreen(discordChannelId, appContext, () => {
            if (FluxDispatcher.isDispatching()) FluxDispatcher.wait(exit);
            else exit();
        });
    },
    releaseCallFullscreen(appContext: unknown) {
        callPresentation.releaseFullscreen(appContext);
    },
    gridTileKeyExtractor,
    isDassParticipant,
    dassParticipantTitle(participant: Parameters<typeof participantTitle>[0]) {
        return participantTitle(participant, gridRuntime.localDisplayName());
    },
    nativeParticipant(participant: unknown) {
        return isDassParticipant(participant) ? null : participant;
    },
    CallView(props: CallViewProps) {
        return <NativeCallView {...props} runtime={gridRuntime} />;
    },
    useFocusedCallProps(props: FocusedCallProps) {
        return useFocusedCallProps(gridRuntime, props);
    },
    selectCallParticipant(channelId: string, participant: unknown) {
        const handled = callPresentation.select(channelId, participant, currentParticipants(channelId));
        if (handled && isDassParticipant(participant) && participant.dassShare.kind === "remote") {
            const status = watches.statusFor(participant.dassShare.share);
            if (!status?.stream && status?.phase !== "loading") gridRuntime.watch(participant.dassShare.share);
        }
        return handled;
    },
    wrapCallTile(NativeTile: ComponentType<CallTileProps>) {
        return ErrorBoundary.wrap((props: CallTileProps) => isDassParticipant(props.participant)
            ? <NativeGridTile {...props} runtime={gridRuntime} /> : <NativeTile {...props} />, { message: "Call tile failed." });
    },
    renderCallAudio(participant: unknown) {
        return isDassParticipant(participant) && participant.dassShare.kind === "remote" ? <CallAudioControl /> : null;
    },
    useFocusedWatchingState(channelId: string) {
        return useFocusedWatchingState(gridRuntime, channelId);
    },
    stopFocusedWatching(channelId: string) {
        const selected = pluginActive && currentCall() === channelId ? callPresentation.getSelected(channelId, currentParticipants(channelId)) : undefined;
        if (selected?.dassShare.kind === "remote" && isFocusedDassWatch(selected, watches.getSnapshot(), channelId)) stopWatchingShare(selected.dassShare.share);
    },
    useNativeSidebarProps<T extends Record<string, unknown>>(props: T) {
        const status = usePublisherStatus(publisher);
        const preview = publisher.getPreviewStream();
        const track = preview?.getVideoTracks()[0];
        const quality = streamTrackQuality(track?.getSettings());
        const dassSidebar: SidebarState | undefined = pluginActive && hasAcceptedPublishCapture(status.phase) && preview
            ? { metadata: { sourceName: track?.label || undefined, qualityLabel: streamQualityLabel(quality), premiumQuality: quality?.premium },
                stop: gridRuntime.stopPublishing } : undefined;
        return { ...props, dassSidebar };
    },
    renderNativeSidebarBody(metadata: SidebarState["metadata"]) {
        return <DassSidebarBody {...metadata} />;
    },
    sidebarActionProps,
    stopSidebarStream,
    chooseShareTransport(nativeStart: () => void) {
        logDiagnostic("share action intercepted", { pluginActive, defaultDass: settings.store.defaultDass,
            inCall: !!currentCall(), configured: session.getSnapshot().configured });
        if (!pluginActive) return nativeStart();
        if (!["idle", "failed"].includes(publisher.getSnapshot().phase)) return publisher.reset();
        const discordChannelId = currentCall();
        if (!discordChannelId) return showToast({ text: "Join a Discord call before sharing." });
        showShareTransportChooser(settings.store.defaultDass, () => pluginActive && currentCall() === discordChannelId,
            () => { logDiagnostic("transport selected", { transport: "discord" }); getCaptureBridge(); nativeStart(); },
            () => {
                logDiagnostic("transport selected", { transport: "dass" });
                if (!session.getSnapshot().configured) return showToast({ text: "Configure your DASS account in plugin settings before sharing." });
                stopSpikeTest();
                localCapture.stop();
                const bridge = getCaptureBridge();
                if (!bridge) return showToast({ text: "DASS screen capture is unavailable in this client." });
                void publisher.publish(settings.store.backendUrl, bridge);
            });
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
        return routePublish(testViewer.routing, intent);
    },
    routeWatch(intent: WatchIntent) {
        if (intent.transport === "discord") return routeWatch(testViewer.routing, intent);
        return { handled: true, completion: (async () => {
            try { return await watches.watch(settings.store.backendUrl, intent.share, session.getAccess()); }
            catch { return { ok: false as const, message: "Sign in to DASS and join the call before watching. No Discord fallback." }; }
        })() };
    },
    detectShares(roomId: string) {
        return testViewer.routing.detect(roomId);
    },
    start: startRuntime,
    stop: stopRuntime,
    flux: {
        CONNECTION_OPEN: startRuntime,
        VOICE_CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            // Re-selecting the current call must not tear down sharing or
            // watching; controllers also reset on a real context change.
            const changed = (channelId ?? undefined) !== selectedVoiceChannelId;
            selectedVoiceChannelId = channelId ?? undefined;
            if (changed) stopMedia();
            queueMicrotask(() => callDiscovery.sync());
        },
        LOGOUT: stopRuntime
    }
});
