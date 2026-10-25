/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassShare } from "./routing";
import type { WatchStatus } from "./watching";

export type GridShare = { key: string; kind: "local"; } | { key: string; kind: "remote"; share: DassShare; ended?: boolean; };

export function gridShares(channelId: string, currentChannelId: string | undefined, active: boolean, localCapture: boolean,
    directory: WatchStatus, watches: readonly WatchStatus[]): GridShare[] {
    if (!active || channelId !== currentChannelId) return [];
    const result: GridShare[] = localCapture ? [{ key: `dass-local:${channelId}`, kind: "local" }] : [];
    const pending = watches.flatMap(watching => ["loading", "ready", "watching"].includes(watching.phase) && watching.watchingShare?.roomId === channelId
        ? [watching.watchingShare] : []);
    const closed = watches.flatMap(watching => {
        const retained = watching.closedShare ?? watching.failedShare;
        return ["disconnected", "failed"].includes(watching.phase) && retained?.roomId === channelId ? [{ share: retained, watching }] : [];
    });
    const shares = [...pending, ...closed.map(entry => entry.share), ...(directory.phase === "ready" ? directory.shares : [])];
    const seen = new Set<string>();
    for (const share of shares) {
        if (share.roomId !== channelId || seen.has(share.shareId) || seen.size === 64) continue;
        seen.add(share.shareId);
        const watching = closed.find(entry => entry.share.shareId === share.shareId)?.watching;
        const ended = watching?.closedShare?.roomId === channelId && watching.closedShare.shareId === share.shareId
            && directory.phase === "ready" && directory.directoryRoomId === channelId
            // A cached empty directory from before watching is not evidence
            // that the publisher ended when this viewer lost its connection.
            && directory.directoryRequestedAtMs !== undefined && watching.disconnectedAtMs !== undefined
            && directory.directoryRequestedAtMs > watching.disconnectedAtMs
            && !directory.shares.some(listed => listed.roomId === channelId && listed.shareId === share.shareId);
        result.push({ key: `dass-remote:${channelId}:${share.shareId}`, kind: "remote", share, ...(ended ? { ended: true } : {}) });
    }
    return result;
}

/** The viewer status that shows `share`: pending, live, or retained after it ended or failed. */
export function watchStatusFor(watches: readonly WatchStatus[], share: DassShare) {
    const matches = (candidate?: DassShare) => candidate?.roomId === share.roomId && candidate.shareId === share.shareId;
    return watches.find(watching => matches(watching.watchingShare) || matches(watching.closedShare) || matches(watching.failedShare));
}

export function gridTileKeyExtractor(nativeKey: (index: number) => string, tiles: readonly unknown[]) {
    let nativeIndex = 0;
    const keys = tiles.map(renderer => {
        return typeof renderer === "function" && "dassTileKey" in renderer && typeof renderer.dassTileKey === "string"
            ? renderer.dassTileKey : nativeKey(nativeIndex++);
    });
    return (index: number) => keys[index];
}
