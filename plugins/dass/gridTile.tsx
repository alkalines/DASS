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
import { Clickable, Slider, useEffect, useRef, useState } from "@webpack/common";
import type { ComponentType, CSSProperties, MouseEvent, ReactNode } from "react";

import { CallPresentation, type DassParticipant, participantTitle, projectParticipants, sliderPlaybackVolume } from "./callPresentation";
import { NATIVE_TILE_FRAME_SOURCE_SIGNATURE } from "./discordAdapter";
import { gridShares } from "./gridPresentation";
import type { PublishController } from "./publishing";
import type { DassShare } from "./routing";
import { usePublisherStatus } from "./shareButton";
import { shouldPauseLocalPreview, streamTrackQuality } from "./streamPresentation";
import { StreamLiveBadge, StreamOverlay, type StreamQuality } from "./streamUi";
import { attachTilePlayback } from "./tilePlayback";
import type { WatchController } from "./watching";

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
    watching: WatchController;
    currentCall(): string | undefined;
    localDisplayName(): string | undefined;
    isActive(): boolean;
    watch(share: DassShare): void;
    stopWatching(): void;
    stopPublishing(): void;
}

export type TileAction = (participant: DassParticipant, event: MouseEvent) => void;
export type GridTileRenderer = (width: number) => ReactNode;

export function useGridState(runtime: GridRuntime, channelId: string) {
    const publisher = usePublisherStatus(runtime.publisher);
    const [directory, setDirectory] = useState(runtime.directory.getSnapshot());
    const [watching, setWatching] = useState(runtime.watching.getSnapshot());
    const [, updatePresentation] = useState(0);
    useEffect(() => runtime.directory.subscribeStatus(() => setDirectory(runtime.directory.getSnapshot())), [runtime.directory]);
    useEffect(() => runtime.watching.subscribeStatus(() => setWatching(runtime.watching.getSnapshot())), [runtime.watching]);
    useEffect(() => callPresentation.subscribe(() => updatePresentation(version => version + 1)), []);
    return { publisher, watching, shares: gridShares(channelId, runtime.currentCall(), runtime.isActive(),
        !!runtime.publisher.getPreviewStream(), directory, watching) };
}

export function useHasGridShares(runtime: GridRuntime, channelId: string) {
    return useGridState(runtime, channelId).shares.length > 0;
}

export function useGridTiles(runtime: GridRuntime, channelId: string, nativeTiles: GridTileRenderer[], className: string,
    onClick?: TileAction, onDoubleClick?: TileAction) {
    const { shares } = useGridState(runtime, channelId);
    return [...nativeTiles, ...shares.map(tile => Object.assign(
        (width: number) => <NativeGridTile runtime={runtime} participant={projectParticipants([tile])[0]} channel={{ id: channelId }}
            width={width} className={className} onClick={onClick} onDoubleClick={onDoubleClick} />,
        { dassTileKey: tile.key }
    ))];
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
    const { publisher, watching } = useGridState(runtime, tile.kind === "local" ? runtime.currentCall() ?? "" : tile.share.roomId);
    const [playbackMessage, setPlaybackMessage] = useState("");
    const [quality, setQuality] = useState<StreamQuality>();
    const [windowFocused, setWindowFocused] = useState(true);
    const video = useRef<HTMLVideoElement>(null);
    const previewPreferences = callPresentation.getPreview();
    const local = tile.kind === "local";
    const previewPaused = local && shouldPauseLocalPreview(previewPreferences, windowFocused);
    const receiving = tile.kind === "remote" && watching.watchingShare?.roomId === tile.share.roomId
        && watching.watchingShare.shareId === tile.share.shareId;
    const stream = tile.kind === "local" ? runtime.publisher.getPreviewStream() : receiving ? watching.stream : undefined;
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
        <div className="vc-dass-grid-content" role="group" aria-label={title}>
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
                <Paragraph role="status">{tile.kind === "local" ? publisher.message : receiving ? watching.message : "Screen share available."}</Paragraph>
                {tile.kind === "remote" && !receiving && <Button disabled={watching.phase === "loading" || !!watching.stream}
                    onClick={event => { event.stopPropagation(); runtime.watch(tile.share); }}>Watch Stream</Button>}
            </div>}
            <StreamOverlay title={title} local={local} transportLabel="DASS" controlsBottom={controlsBottom == null ? undefined : controlsBottom + 12}
                stop={local ? runtime.stopPublishing : receiving ? runtime.stopWatching : undefined}
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
        </div>
    </TileFrame>;
}

export const NativeGridTile = ErrorBoundary.wrap(GridTile, { message: "DASS stream tile failed." });

function AudioControl() {
    const [, update] = useState(0);
    useEffect(() => callPresentation.subscribe(() => update(version => version + 1)), []);
    const { muted, sliderPercent } = callPresentation.getAudio();
    return <div className="vc-dass-audio-control">
        <Button size="small" aria-label={muted ? "Unmute stream" : "Mute stream"} aria-pressed={muted}
            onClick={() => callPresentation.setAudio(!muted)}>{muted ? "Unmute" : "Mute"}</Button>
        <div className="vc-dass-volume">
            <Paragraph>Stream volume</Paragraph>
            <Slider minValue={0} maxValue={100} initialValue={sliderPercent} keyboardStep={5} aria-label="Stream volume"
                onValueRender={value => `${Math.round(value)}%`}
                asValueChanges={value => callPresentation.setAudio(value > 0 ? false : muted, value)} />
        </div>
    </div>;
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

function CallView({ runtime, dassNativeComponent: NativeCall, dassVideoMode, dassPopoutContext, ...props }: CallViewProps & { runtime: GridRuntime; }) {
    const { shares, watching } = useGridState(runtime, props.channel.id);
    const selected = callPresentation.getSelected(props.channel.id, projectParticipants(shares));
    const audio = useRef<HTMLAudioElement>(null);
    const [blocked, setBlocked] = useState(false);
    const audioState = callPresentation.getAudio();
    const enabled = runtime.isActive() && props.inCall && props.channel.id === runtime.currentCall() && !props.channel.isGuildStageVoice();
    const audioStream = enabled && (!props.popoutWindow || props.popoutWindow.closed || props.appContext === dassPopoutContext) ? watching.stream : undefined;
    useEffect(() => {
        if (enabled) callPresentation.reconcile(props.channel.id, projectParticipants(shares));
    }, [enabled, props.channel.id, shares]);
    useEffect(() => {
        const element = audio.current;
        if (!element) return;
        setBlocked(false);
        return attachTilePlayback(element, audioStream, audioState.muted, () => setBlocked(true));
    }, [audioStream]);
    useEffect(() => {
        if (audio.current) {
            audio.current.muted = audioState.muted;
            audio.current.volume = sliderPlaybackVolume(audioState.sliderPercent);
        }
    }, [audioState, audioStream]);
    return <>
        <NativeCall {...props} mode={enabled && shares.length ? dassVideoMode : props.mode}
            selectedParticipant={enabled ? selected ?? props.selectedParticipant : props.selectedParticipant} />
        <audio ref={audio} />
        {blocked && <Button className="vc-dass-play-audio" onClick={() => {
            const element = audio.current;
            if (element) void element.play().then(() => setBlocked(false), () => setBlocked(true));
        }}>Play stream audio</Button>}
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
    return { ...props, participants: [...props.participants, ...participants], filteredParticipants: [...props.filteredParticipants, ...participants] };
}
