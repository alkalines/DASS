/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy } from "@webpack";
import { Clickable, useEffect, useRef, useState } from "@webpack/common";
import type { ComponentType, CSSProperties, MouseEvent, ReactNode } from "react";

import { CallPresentation, type DassParticipant, isFocusedDassWatch, participantTitle, projectParticipants, sliderPlaybackVolume } from "./callPresentation";
import { NATIVE_TILE_FRAME_SOURCE_SIGNATURE } from "./discordAdapter";
import { gridShares, watchStatusFor } from "./gridPresentation";
import type { PublishController } from "./publishing";
import type { DassShare } from "./routing";
import { usePublisherStatus } from "./shareButton";
import { StreamEndedScreen } from "./streamEnded";
import { StreamErrorScreen } from "./streamError";
import { shouldPauseLocalPreview, streamTrackQuality } from "./streamPresentation";
import { StreamLiveBadge, StreamOverlay, type StreamQuality } from "./streamUi";
import { attachTilePlayback } from "./tilePlayback";
import { StreamVolumeControl } from "./volumeControl";
import type { WatchController } from "./watching";
import type { WatchSet } from "./watchSet";

interface NativeTileFrameProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    noBorder?: boolean;
}

const TileFrame = findComponentByCodeLazy<NativeTileFrameProps>(...NATIVE_TILE_FRAME_SOURCE_SIGNATURE);

export const callPresentation = new CallPresentation();

export interface GridRuntime {
    publisher: PublishController;
    directory: WatchController;
    watches: WatchSet;
    currentCall(): string | undefined;
    localDisplayName(): string | undefined;
    isActive(): boolean;
    watch(share: DassShare): void;
    stopWatching(share: DassShare): void;
    /** Explicit user trust of a publisher's changed E2EE identity, then a fresh watch. */
    trustPublisherAndWatch(share: DassShare): void;
    stopPublishing(): void;
}

export type TileAction = (participant: DassParticipant, event: MouseEvent) => void;
export type GridTileRenderer = (width: number) => ReactNode;

export function useGridState(runtime: GridRuntime, channelId: string) {
    const publisher = usePublisherStatus(runtime.publisher);
    const [directory, setDirectory] = useState(runtime.directory.getSnapshot());
    const [watches, setWatches] = useState(runtime.watches.getSnapshot());
    const [, updatePresentation] = useState(0);
    useEffect(() => runtime.directory.subscribeStatus(() => setDirectory(runtime.directory.getSnapshot())), [runtime.directory]);
    useEffect(() => runtime.watches.subscribeStatus(() => setWatches(runtime.watches.getSnapshot())), [runtime.watches]);
    useEffect(() => callPresentation.subscribe(() => updatePresentation(version => version + 1)), []);
    return { publisher, watches, shares: gridShares(channelId, runtime.currentCall(), runtime.isActive(),
        !!runtime.publisher.getPreviewStream(), directory, watches) };
}

export function useHasGridShares(runtime: GridRuntime, channelId: string) {
    return useGridState(runtime, channelId).shares.length > 0;
}

export function useFocusedWatchingState(runtime: GridRuntime, channelId: string) {
    const { shares, watches } = useGridState(runtime, channelId);
    return runtime.isActive() && runtime.currentCall() === channelId
        && isFocusedDassWatch(callPresentation.getSelected(channelId, projectParticipants(shares)), watches, channelId);
}

export function useGridTiles(runtime: GridRuntime, channelId: string, nativeTiles: GridTileRenderer[], className: string,
    onClick?: TileAction, onDoubleClick?: TileAction) {
    const { shares } = useGridState(runtime, channelId);
    return [...shares.map(tile => Object.assign(
        (width: number) => <NativeGridTile runtime={runtime} participant={projectParticipants([tile])[0]} channel={{ id: channelId }}
            width={width} className={className} onClick={onClick} onDoubleClick={onDoubleClick} />,
        { dassTileKey: tile.key }
    )), ...nativeTiles];
}

export interface CallTileProps {
    participant: DassParticipant;
    channel: { id: string; };
    width: number;
    className?: string;
    style?: CSSProperties;
    noBorder?: boolean;
    focused?: boolean;
    selected?: boolean;
    paused?: boolean;
    controlsBottom?: number;
    onClick?: TileAction;
    onDoubleClick?: TileAction;
    onVideoResize?: (size: { width: number; height: number; }) => void;
}

function GridTile({ runtime, participant, width, className, focused, paused, controlsBottom, onClick, onDoubleClick, onVideoResize,
    style, noBorder }: CallTileProps & { runtime: GridRuntime; }) {
    const tile = participant.dassShare;
    const { publisher, watches } = useGridState(runtime, tile.kind === "local" ? runtime.currentCall() ?? "" : tile.share.roomId);
    const watching = tile.kind === "remote" ? watchStatusFor(watches, tile.share) : undefined;
    const [playbackMessage, setPlaybackMessage] = useState("");
    const [quality, setQuality] = useState<StreamQuality>();
    const [windowFocused, setWindowFocused] = useState(true);
    const video = useRef<HTMLVideoElement>(null);
    const previewPreferences = callPresentation.getPreview();
    const local = tile.kind === "local";
    const previewPaused = local && shouldPauseLocalPreview(previewPreferences, windowFocused);
    const receiving = tile.kind === "remote" && watching?.watchingShare?.roomId === tile.share.roomId
        && watching.watchingShare.shareId === tile.share.shareId;
    const retained = watching?.closedShare ?? watching?.failedShare;
    const closed = tile.kind === "remote" && retained?.roomId === tile.share.roomId && retained.shareId === tile.share.shareId;
    const ended = tile.kind === "remote" && tile.ended;
    const failed = closed && !!watching && ["disconnected", "failed"].includes(watching.phase) && !ended;
    const stream = tile.kind === "local" ? runtime.publisher.getPreviewStream() : receiving ? watching?.stream : undefined;
    const stopWatching = () => { if (tile.kind === "remote") runtime.stopWatching(tile.share); };
    useEffect(() => {
        if (!local) return;
        const ownerDocument = video.current?.ownerDocument;
        const ownerWindow = ownerDocument?.defaultView;
        if (!ownerDocument || !ownerWindow) return;
        const updateFocus = () => setWindowFocused(ownerDocument.hasFocus() && ownerDocument.visibilityState !== "hidden");
        updateFocus();
        ownerWindow.addEventListener("focus", updateFocus);
        ownerWindow.addEventListener("blur", updateFocus);
        ownerDocument.addEventListener("visibilitychange", updateFocus);
        return () => {
            ownerWindow.removeEventListener("focus", updateFocus);
            ownerWindow.removeEventListener("blur", updateFocus);
            ownerDocument.removeEventListener("visibilitychange", updateFocus);
        };
    }, [local]);
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        setPlaybackMessage("");
        return attachTilePlayback(element, paused || previewPaused ? undefined : stream, true, () => setPlaybackMessage("Playback was blocked."));
    }, [stream, paused, previewPaused]);
    useEffect(() => {
        setQuality(streamTrackQuality(stream?.getVideoTracks()[0]?.getSettings()));
    }, [stream]);
    useEffect(() => {
        const track = stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        if (settings?.width && settings.height) onVideoResize?.({ width: settings.width, height: settings.height });
    }, [stream, onVideoResize]);
    const title = participantTitle(participant, runtime.localDisplayName());
    return <TileFrame className={classes(className, "vc-dass-grid-tile", "vc-dass-stream-surface", focused && "vc-dass-grid-focused",
        focused && "vc-dass-stream-surface-focused")}
        style={{ ...style, width: focused ? "100%" : width }} noBorder={noBorder}>
        <div className="vc-dass-grid-content" role="group" aria-label={title}
            onClick={ended || failed ? event => onClick?.(participant, event) : undefined}
            onDoubleClick={ended || failed ? event => onDoubleClick?.(participant, event) : undefined}>
            {ended ? <StreamEndedScreen onClose={event => { event.stopPropagation(); stopWatching(); }} />
                : failed ? <StreamErrorScreen started={!!watching?.closedShare} message={watching?.message ?? ""}
                    action={watching?.publisherIdentityChanged && tile.kind === "remote" ? {
                        description: "This streamer's encryption identity changed since you last watched (new device, reinstall, or someone else using the account). Trust it only if you confirmed this with them.",
                        label: "Trust new identity and watch",
                        onClick: event => { event.stopPropagation(); runtime.trustPublisherAndWatch(tile.share); }
                    } : undefined}
                    onClose={event => { event.stopPropagation(); stopWatching(); }} /> : <>
            <Clickable className="vc-dass-grid-focus" aria-label={title} onClick={event => onClick?.(participant, event)}
                onDoubleClick={event => onDoubleClick?.(participant, event)}>
                <video ref={video} muted playsInline hidden={previewPaused} aria-label={title} onLoadedMetadata={event => {
                    const element = event.currentTarget;
                    setQuality(streamTrackQuality({ ...stream?.getVideoTracks()[0]?.getSettings(), height: element.videoHeight }));
                    if (element.videoWidth && element.videoHeight) onVideoResize?.({ width: element.videoWidth, height: element.videoHeight });
                }} />
            </Clickable>
            <div className="vc-dass-stream-indicators"><StreamLiveBadge quality={quality} /></div>
            {previewPaused && <div className={classes("vc-dass-grid-placeholder", "vc-dass-grid-preview-status")}><Paragraph role="status">
                {previewPreferences.showPreview ? "Your preview is paused while Discord is unfocused." : "Your screen share preview is hidden."}
            </Paragraph></div>}
            {!stream && <div className="vc-dass-grid-placeholder">
                <Paragraph role="status">{tile.kind === "local" ? publisher.message : receiving || closed ? watching?.message : "Screen share available."}</Paragraph>
                {tile.kind === "remote" && !receiving && <Button disabled={watching?.phase === "loading"}
                    onClick={event => { event.stopPropagation(); runtime.watch(tile.share); }}>Watch Stream</Button>}
                {closed && <Button variant="secondary" onClick={event => { event.stopPropagation(); stopWatching(); }}>Close Stream</Button>}
            </div>}
            <StreamOverlay title={title} local={local} transportLabel="DASS" controlsBottom={controlsBottom == null ? undefined : controlsBottom + 12}
                stop={local ? runtime.stopPublishing : receiving || closed ? stopWatching : undefined}
                previewOptions={local ? { ...previewPreferences,
                    setShowPreview: showPreview => callPresentation.setPreview({ ...callPresentation.getPreview(), showPreview }),
                    setPauseWhenUnfocused: pauseWhenUnfocused => callPresentation.setPreview({ ...callPresentation.getPreview(), pauseWhenUnfocused }) } : undefined}
                audioControl={<>
                    {tile.kind === "remote" && receiving && !focused && <CallAudioControl />}
                    {stream && playbackMessage && !previewPaused && !paused && <Button size="small" onClick={() => {
                        const element = video.current;
                        if (element) void element.play().then(() => setPlaybackMessage(""), () => setPlaybackMessage("Playback was blocked."));
                    }}>Play</Button>}
                </>} />
            </>}
        </div>
    </TileFrame>;
}

export const NativeGridTile = ErrorBoundary.wrap(GridTile, { message: "DASS stream tile failed." });

function AudioControl() {
    const [, update] = useState(0);
    useEffect(() => callPresentation.subscribe(() => update(version => version + 1)), []);
    const { muted, sliderPercent } = callPresentation.getAudio();
    return <StreamVolumeControl muted={muted} sliderPercent={sliderPercent}
        onToggleMute={() => callPresentation.setAudio(!muted)}
        onVolumeChange={value => callPresentation.setAudio(value > 0 ? false : muted, value)} />;
}

export const CallAudioControl = ErrorBoundary.wrap(AudioControl, { message: "DASS audio controls failed." });

interface NativeCallProps {
    channel: { id: string; isGuildStageVoice(): boolean; };
    inCall: boolean;
    mode: unknown;
    selectedParticipant: unknown;
    popoutWindow?: { closed: boolean; };
    appContext: unknown;
    [key: string]: unknown;
}

export interface CallViewProps extends NativeCallProps {
    dassNativeComponent: ComponentType<NativeCallProps>;
    dassVideoMode: unknown;
    dassPopoutContext: unknown;
}

/** One audio element per received stream; every stream follows the call's mute and volume. */
function StreamAudio({ stream, muted, sliderPercent, playRequest, onBlocked }: { stream: MediaStream; muted: boolean; sliderPercent: number;
    playRequest: number; onBlocked(stream: MediaStream, blocked: boolean): void; }) {
    const audio = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const element = audio.current;
        if (!element) return;
        onBlocked(stream, false);
        return attachTilePlayback(element, stream, muted, () => onBlocked(stream, true));
    }, [stream]);
    useEffect(() => {
        if (!audio.current) return;
        audio.current.muted = muted;
        audio.current.volume = sliderPlaybackVolume(sliderPercent);
    }, [muted, sliderPercent, stream]);
    useEffect(() => {
        if (playRequest && audio.current) void audio.current.play().then(() => onBlocked(stream, false), () => onBlocked(stream, true));
    }, [playRequest]);
    return <audio ref={audio} />;
}

function CallView({ runtime, dassNativeComponent: NativeCall, dassVideoMode, dassPopoutContext, ...props }: CallViewProps & { runtime: GridRuntime; }) {
    const { shares, watches } = useGridState(runtime, props.channel.id);
    const selected = callPresentation.getSelected(props.channel.id, projectParticipants(shares));
    const [blocked, setBlocked] = useState<ReadonlySet<MediaStream>>(new Set());
    const [playRequest, setPlayRequest] = useState(0);
    const audioState = callPresentation.getAudio();
    const enabled = runtime.isActive() && props.inCall && props.channel.id === runtime.currentCall() && !props.channel.isGuildStageVoice();
    const audioStreams = enabled && (!props.popoutWindow || props.popoutWindow.closed || props.appContext === dassPopoutContext)
        ? watches.flatMap(watching => watching.stream ? [watching.stream] : []) : [];
    const onBlocked = (stream: MediaStream, isBlocked: boolean) => setBlocked(previous => {
        if (previous.has(stream) === isBlocked) return previous;
        const next = new Set(previous);
        if (isBlocked) next.add(stream); else next.delete(stream);
        return next;
    });
    useEffect(() => {
        if (enabled) callPresentation.reconcile(props.channel.id, projectParticipants(shares));
    }, [enabled, props.channel.id, shares]);
    return <>
        <NativeCall {...props} mode={enabled && shares.length ? dassVideoMode : props.mode}
            selectedParticipant={enabled ? selected ?? props.selectedParticipant : props.selectedParticipant} />
        {audioStreams.map((stream, index) => <StreamAudio key={stream.id || index} stream={stream} muted={audioState.muted}
            sliderPercent={audioState.sliderPercent} playRequest={playRequest} onBlocked={onBlocked} />)}
        {audioStreams.some(stream => blocked.has(stream)) && <Button className="vc-dass-play-audio" onClick={() => setPlayRequest(request => request + 1)}>
            Play stream audio
        </Button>}
    </>;
}

export const NativeCallView = ErrorBoundary.wrap(CallView, { message: "DASS call presentation failed." });

export interface FocusedCallProps {
    channel: { id: string; };
    participants: unknown[];
    filteredParticipants: unknown[];
}

export function useFocusedCallProps(runtime: GridRuntime, props: FocusedCallProps) {
    const { shares } = useGridState(runtime, props.channel.id);
    const participants = projectParticipants(shares);
    return { ...props, participants: [...participants, ...props.participants], filteredParticipants: [...participants, ...props.filteredParticipants] };
}
