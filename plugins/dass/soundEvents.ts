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
    /** Live received shares as `room:share`. */
    watchingKeys: readonly string[];
    /** Shares whose watch closed unexpectedly and is retained as ended/failed. */
    closedKeys: readonly string[];
    viewerCount?: number;
}

const key = (share: { roomId: string; shareId: string; }) => `${share.roomId}:${share.shareId}`;

export function streamSoundState(contextId: string | undefined, publisher: PublishStatus, viewers: readonly WatchStatus[]): StreamSoundState {
    return { contextId, publishing: publisher.phase === "publishing", viewerCount: publisher.viewerCount,
        watchingKeys: viewers.flatMap(({ phase, stream, watchingShare }) => phase === "watching" && stream && watchingShare && watchingShare.roomId === contextId ? [key(watchingShare)] : []),
        closedKeys: viewers.flatMap(viewer => viewer.closedShare ? [key(viewer.closedShare)] : []) };
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
    for (const left of previous.watchingKeys.filter(watched => !next.watchingKeys.includes(watched))) {
        sounds.push(next.closedKeys.includes(left) ? "stream_ended" : "stream_user_left");
    }
    if (next.watchingKeys.some(watched => !previous.watchingKeys.includes(watched))) sounds.push("stream_user_joined");
    return [...new Set(sounds)];
}
