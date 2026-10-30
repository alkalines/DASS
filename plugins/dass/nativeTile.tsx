/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getIntlMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import { filters, findByPropsLazy, findComponentByCodeLazy, findCssClassesLazy, mapMangledModuleLazy } from "@webpack";
import type { ComponentType, MouseEvent, ReactNode } from "react";

import type { StreamQuality } from "./streamUi";

/*
 * Discord's own call-tile pieces, reused for DASS tiles. Only presentational
 * components are borrowed: DASS media, state and actions stay DASS-owned, and
 * no Discord stream records, stores or telemetry are touched.
 */

const tileClasses = findCssClassesLazy("tileChild", "indicators", "liveIndicator", "content", "streamPreview", "cta", "small", "videoWrapper", "streamUnavailableText");
const qualityClasses = findCssClassesLazy("streamQualityIndicator", "qualityIndicator", "qualityIndicatorFullQuality", "qualityIndicatorSmall", "qualityResolution", "premiumStreamIcon", "liveIndicator");
const videoClasses = findCssClassesLazy("wrapper", "video", "videoContain", "previewWrapper", "loading", "emptyPreviewWrapper", "emptyPreview", "spinner");

const LiveBadge = findComponentByCodeLazy<{ size?: string; shape?: string; look?: string; className?: string; }>(".BADGE_NOTIFICATION_BACKGROUND.css", '"GRAY"===', "count:");
const Badges: { TextBadge: ComponentType<{ text: ReactNode; color?: string; size?: string; shape?: string; className?: string; }>; BadgeShapes: Record<"ROUND" | "ROUND_LEFT" | "ROUND_RIGHT", string>; BadgeSizes: Record<"LARGE" | "SMALL", string>; }
    = mapMangledModuleLazy('LARGE:"large",SMALL:"small"', { TextBadge: filters.componentByCode("{text:"), BadgeShapes: filters.byProps("ROUND_LEFT"), BadgeSizes: filters.byProps("SMALL", "LARGE") });
const DiscordButton = findComponentByCodeLazy<{ variant?: string; size?: string; text: string; onClick?(event: MouseEvent): void; }>("iconOpticalOffsetMargin:", "loadingStartedLabel:");
const Spinner = findComponentByCodeLazy<{ className?: string; }>("spinningCircleInner", "SPINNER_LOADING_LABEL");
const NitroWheelIcon = findComponentByCodeLazy<{ size?: string; color?: string; className?: string; }>("M16.23 12c0 1.29-.95 2.25-2.22 2.25A2.18");
const Tokens: { unsafe_rawColors: Record<string, { css: string; }>; } = findByPropsLazy("unsafe_rawColors", "colors");
const ParticipantTypes: { STREAM: number; } = findByPropsLazy("STREAM", "HIDDEN_STREAM", "ACTIVITY");

/** Discord's widths for tile layouts (call tile breakpoints). */
const COMPACT_TILE_WIDTH = 220;
const SMALL_TILE_WIDTH = 195;
const SHORT_LABEL_WIDTH = 175;

export interface NativeTileOverlayProps {
    title: string;
    width: number;
    focused: boolean;
    participantId: string;
    channel: unknown;
    popoutType?: string;
    paused?: boolean;
    controlsBottom?: number;
    /** Local previews have no stream audio to mute. */
    local: boolean;
    muted: boolean;
    onToggleMute(): void;
    onOptions(event: MouseEvent): void;
}

let CallTileOverlay: ComponentType<Record<string, unknown>> | undefined;

/** Called from the CallTile module patch: Discord's own hover overlay (title, options and mute buttons). */
export function captureCallTileOverlay<T extends ComponentType<Record<string, unknown>>>(component: T) {
    CallTileOverlay = component;
    return component;
}

export function NativeTileOverlay({ title, width, focused, participantId, channel, popoutType, paused, controlsBottom, local, muted, onToggleMute, onOptions }: NativeTileOverlayProps) {
    if (!CallTileOverlay || !channel) return null;
    return <CallTileOverlay idle={false} title={title} width={width} focused={focused} participantId={participantId}
        participantType={ParticipantTypes.STREAM} channel={channel} secureFramesVerified={false} hasVideo={!local}
        hideAudioIcon={local} localMuted={muted} muted={false} deafened={false} serverMuted={false} serverDeafened={false}
        onToggleMute={onToggleMute} onContextMenu={(event: MouseEvent) => onOptions(event)} popoutType={popoutType}
        paused={paused} controlsBottom={controlsBottom} streamId={null} inCall={false} soundboardMuted={false} />;
}

/** Discord's LIVE badge with its quality pill. */
export function NativeLiveIndicator({ quality, width }: { quality?: StreamQuality; width: number; }) {
    const showQuality = !!quality && width > COMPACT_TILE_WIDTH;
    return <div className={classes(qualityClasses.streamQualityIndicator, tileClasses.liveIndicator)}>
        {showQuality && <Badges.TextBadge size={Badges.BadgeSizes.SMALL} shape={Badges.BadgeShapes.ROUND_LEFT}
            color={Tokens.unsafe_rawColors.PRIMARY_500?.css}
            className={classes(qualityClasses.qualityIndicator, qualityClasses.qualityIndicatorFullQuality, qualityClasses.qualityIndicatorSmall)}
            text={<>
                {quality.premium && <NitroWheelIcon size="md" color="currentColor" className={qualityClasses.premiumStreamIcon} />}
                <span className={qualityClasses.qualityResolution}>{quality.resolution}</span>
                <span>{quality.framesPerSecond}FPS</span>
            </>} />}
        <LiveBadge look="RED" size={Badges.BadgeSizes.SMALL} shape={showQuality ? Badges.BadgeShapes.ROUND_RIGHT : undefined} className={qualityClasses.liveIndicator} />
    </div>;
}

/** Discord's empty stream preview with its loading spinner; DASS never shows preview images. */
export function NativeStreamLoading({ message }: { message?: string; }) {
    return <div className={classes(videoClasses.previewWrapper, videoClasses.loading)}>
        <div className={videoClasses.emptyPreviewWrapper} style={{ aspectRatio: "16 / 9" }}><div className={videoClasses.emptyPreview} /></div>
        <Spinner className={videoClasses.spinner} />
        {message && <span className={classes(tileClasses.streamUnavailableText, "vc-dass-tile-status")}>{message}</span>}
    </div>;
}

/** Discord's "Watch Stream" call-to-action on a stream that is not being watched. */
export function NativeWatchPrompt({ width, message }: { width: number; message?: string; }) {
    return <div className={classes(tileClasses.content, tileClasses.streamPreview, width < SMALL_TILE_WIDTH && tileClasses.small)}>
        <div className={tileClasses.cta}>
            <DiscordButton variant="secondary" size={width < SMALL_TILE_WIDTH ? "sm" : "md"}
                text={getIntlMessage(width < SHORT_LABEL_WIDTH ? "WATCH" : "WATCH_STREAM")} />
        </div>
        {message && <span className={classes(tileClasses.streamUnavailableText, "vc-dass-tile-status")}>{message}</span>}
    </div>;
}

export const nativeVideoClasses = videoClasses;
export const nativeTileClasses = tileClasses;
