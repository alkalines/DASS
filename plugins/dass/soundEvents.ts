/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PublishStatus } from "./publishing";
import type { WatchStatus } from "./watching";

export type StreamSound = "stream_started" | "stream_ended" | "stream_user_joined" | "stream_user_left";

export interface StreamSoundState {
    contextId?: string;
    publishing: boolean;
    watchingKey?: string;
    closed: boolean;
    viewerCount?: number;
}

export function streamSoundState(contextId: string | undefined, publisher: PublishStatus, viewer: WatchStatus): StreamSoundState {
    const share = viewer.phase === "watching" && viewer.stream && viewer.watchingShare?.roomId === contextId ? viewer.watchingShare : undefined;
    return { contextId, publishing: publisher.phase === "publishing", viewerCount: publisher.viewerCount,
        watchingKey: share ? `${share.roomId}:${share.shareId}` : undefined, closed: !!viewer.closedShare };
}

export function streamSoundEvents(previous: StreamSoundState, next: StreamSoundState): StreamSound[] {
    if (!next.contextId || previous.contextId !== next.contextId) return [];
    const sounds: StreamSound[] = [];
    if (previous.publishing !== next.publishing) sounds.push(next.publishing ? "stream_started" : "stream_ended");
    if (next.publishing) {
        const previousCount = previous.viewerCount ?? 0;
        const nextCount = next.viewerCount ?? 0;
        if (nextCount > previousCount) sounds.push("stream_user_joined");
        else if (nextCount < previousCount) sounds.push("stream_user_left");
    }
    if (previous.watchingKey !== next.watchingKey) {
        if (previous.watchingKey) sounds.push(next.closed ? "stream_ended" : "stream_user_left");
        if (next.watchingKey) sounds.push("stream_user_joined");
    }
    return [...new Set(sounds)];
}
