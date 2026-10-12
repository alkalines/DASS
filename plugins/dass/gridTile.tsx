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
import { NATIVE_LIVE_BADGE_SOURCE_SIGNATURE, NATIVE_TILE_FRAME_SOURCE_SIGNATURE } from "./discordAdapter";
import { gridShares } from "./gridPresentation";
import type { PublishController } from "./publishing";
import type { DassShare } from "./routing";
import { usePublisherStatus } from "./shareButton";
import { attachTilePlayback } from "./tilePlayback";
import type { WatchController } from "./watching";

interface NativeTileFrameProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    noBorder?: boolean;
}

const TileFrame = findComponentByCodeLazy<NativeTileFrameProps>(...NATIVE_TILE_FRAME_SOURCE_SIGNATURE);
const LiveBadge = findComponentByCodeLazy(...NATIVE_LIVE_BADGE_SOURCE_SIGNATURE);

export const callPresentation = new CallPresentation();

export interface GridRuntime {
    publisher: PublishController;
    directory: WatchController;
    watching: WatchController;
    currentCall(): string | undefined;
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

function GridTile({ runtime, participant, width, className, focused, selected, paused, controlsBottom, onClick, onDoubleClick, onVideoResize,
    style, noBorder }: CallTileProps & { runtime: GridRuntime; }) {
    const tile = participant.dassShare;
    const { publisher, watching } = useGridState(runtime, tile.kind === "local" ? runtime.currentCall() ?? "" : tile.share.roomId);
    const [playbackMessage, setPlaybackMessage] = useState("");
    const video = useRef<HTMLVideoElement>(null);
    const receiving = tile.kind === "remote" && watching.watchingShare?.roomId === tile.share.roomId
        && watching.watchingShare.shareId === tile.share.shareId;
    const stream = tile.kind === "local" ? runtime.publisher.getPreviewStream() : receiving ? watching.stream : undefined;
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        setPlaybackMessage("");
        return attachTilePlayback(element, paused ? undefined : stream, true, () => setPlaybackMessage("Playback was blocked."));
    }, [stream, paused]);
    useEffect(() => {
        const track = stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        if (settings?.width && settings.height) onVideoResize?.({ width: settings.width, height: settings.height });
    }, [stream, onVideoResize]);
    const title = participantTitle(participant);
    return <TileFrame className={classes(className, "vc-dass-grid-tile", focused && "vc-dass-grid-focused")}
        style={{ ...style, width: focused ? "100%" : width }} noBorder={noBorder}>
        <div className="vc-dass-grid-content" role="group" aria-label={title}>
            <Clickable className="vc-dass-grid-focus" aria-label={title} onClick={event => onClick?.(participant, event)}
                onDoubleClick={event => onDoubleClick?.(participant, event)}>
                <video ref={video} muted playsInline aria-label={title} onLoadedMetadata={event => {
                    const element = event.currentTarget;
                    if (element.videoWidth && element.videoHeight) onVideoResize?.({ width: element.videoWidth, height: element.videoHeight });
                }} />
            </Clickable>
            <div className="vc-dass-grid-live"><LiveBadge /></div>
            {!stream && <div className="vc-dass-grid-placeholder">
                <Paragraph role="status">{tile.kind === "local" ? publisher.message : receiving ? watching.message : "Screen share available."}</Paragraph>
                {tile.kind === "remote" && !receiving && <Button disabled={watching.phase === "loading" || !!watching.stream}
                    onClick={event => { event.stopPropagation(); runtime.watch(tile.share); }}>Watch Stream</Button>}
            </div>}
            {!selected && <div className="vc-dass-grid-controls" style={{ marginBottom: controlsBottom }}>
                <span>{title}</span>
                {tile.kind === "remote" && receiving && !focused && <CallAudioControl />}
                {tile.kind === "local" ? <Button size="small" onClick={() => runtime.stopPublishing()}>Stop Streaming</Button>
                    : receiving ? <Button size="small" onClick={() => runtime.stopWatching()}>Stop Watching</Button> : null}
                {stream && playbackMessage && <Button onClick={() => {
                    const element = video.current;
                    if (element) void element.play().then(() => setPlaybackMessage(""), () => setPlaybackMessage("Playback was blocked."));
                }}>Play</Button>}
            </div>}
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
