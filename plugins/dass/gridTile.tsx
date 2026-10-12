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
import { useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

import { NATIVE_LIVE_BADGE_SOURCE_SIGNATURE, NATIVE_TILE_FRAME_SOURCE_SIGNATURE } from "./discordAdapter";
import { type GridShare, gridShares } from "./gridPresentation";
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

export interface GridRuntime {
    publisher: PublishController;
    directory: WatchController;
    watching: WatchController;
    currentCall(): string | undefined;
    isActive(): boolean;
    watch(share: DassShare): void;
    stopWatching(): void;
}

export type GridTileRenderer = (width: number) => ReactNode;

function useGridState(runtime: GridRuntime, channelId: string) {
    const publisher = usePublisherStatus(runtime.publisher);
    const [directory, setDirectory] = useState(runtime.directory.getSnapshot());
    const [watching, setWatching] = useState(runtime.watching.getSnapshot());
    useEffect(() => runtime.directory.subscribeStatus(() => setDirectory(runtime.directory.getSnapshot())), [runtime.directory]);
    useEffect(() => runtime.watching.subscribeStatus(() => setWatching(runtime.watching.getSnapshot())), [runtime.watching]);
    return { publisher, watching, shares: gridShares(channelId, runtime.currentCall(), runtime.isActive(),
        !!runtime.publisher.getPreviewStream(), directory, watching) };
}

export function useHasGridShares(runtime: GridRuntime, channelId: string) {
    return useGridState(runtime, channelId).shares.length > 0;
}

export function useGridTiles(runtime: GridRuntime, channelId: string, nativeTiles: GridTileRenderer[], className: string) {
    const { shares } = useGridState(runtime, channelId);
    return [...nativeTiles, ...shares.map(tile => Object.assign(
        (width: number) => <NativeGridTile runtime={runtime} tile={tile} width={width} className={className} />,
        { dassTileKey: tile.key }
    ))];
}

function GridTile({ runtime, tile, width, className }: { runtime: GridRuntime; tile: GridShare; width: number; className: string; }) {
    const channelId = tile.kind === "local" ? runtime.currentCall() ?? "" : tile.share.roomId;
    const { publisher, watching } = useGridState(runtime, channelId);
    const [playbackMessage, setPlaybackMessage] = useState("");
    const video = useRef<HTMLVideoElement>(null);
    const selected = tile.kind === "remote" && watching.watchingShare?.roomId === tile.share.roomId
        && watching.watchingShare.shareId === tile.share.shareId;
    const stream = tile.kind === "local" ? runtime.publisher.getPreviewStream() : selected ? watching.stream : undefined;
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        // Local preview must never loop captured audio back to its publisher.
        // Choosing Watch Stream is the viewer's playback action, not another
        // capture permission request. Only ask again if autoplay is blocked.
        setPlaybackMessage("");
        return attachTilePlayback(element, stream, tile.kind === "local", () => setPlaybackMessage("Playback was blocked. Use Play to start the stream."));
    }, [stream, tile.kind]);
    const title = tile.kind === "local" ? "Your screen" : tile.share.displayName ?? "Screen share";
    return <TileFrame className={classes(className, "vc-dass-grid-tile")} style={{ width }}>
        <div className="vc-dass-grid-content" role="group" aria-label={title}>
            <div className="vc-dass-grid-heading"><Paragraph>{title}</Paragraph><LiveBadge /></div>
            <video ref={video} muted={tile.kind === "local"} controls={!!stream} playsInline aria-label={title} />
            {!stream && <div className="vc-dass-grid-placeholder">
                <Paragraph role="status">{tile.kind === "local" ? publisher.message : selected ? watching.message : "Screen share available."}</Paragraph>
                {tile.kind === "remote" && !selected && <Button disabled={watching.phase === "loading" || !!watching.stream}
                    onClick={event => { event.stopPropagation(); runtime.watch(tile.share); }}>Watch Stream</Button>}
            </div>}
            {tile.kind === "remote" && selected && <div className="vc-dass-grid-controls">
                {stream && playbackMessage && <Button onClick={event => {
                    event.stopPropagation();
                    const element = video.current;
                    if (!element) return;
                    element.muted = false;
                    void element.play().then(() => setPlaybackMessage(""), () => { setPlaybackMessage("Playback was blocked. Use Play to try again."); });
                }}>Play</Button>}
                <Button onClick={event => { event.stopPropagation(); runtime.stopWatching(); }}>Stop Watching</Button>
            </div>}
            {playbackMessage && <Paragraph role="status">{playbackMessage}</Paragraph>}
        </div>
    </TileFrame>;
}

const NativeGridTile = ErrorBoundary.wrap(GridTile, { message: "DASS stream tile failed." });
