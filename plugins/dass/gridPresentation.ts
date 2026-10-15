/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassShare } from "./routing";
import type { WatchStatus } from "./watching";

export type GridShare = { key: string; kind: "local"; } | { key: string; kind: "remote"; share: DassShare; ended?: boolean; };

export function gridShares(channelId: string, currentChannelId: string | undefined, active: boolean, localCapture: boolean,
    directory: WatchStatus, watching: WatchStatus): GridShare[] {
    if (!active || channelId !== currentChannelId) return [];
    const result: GridShare[] = localCapture ? [{ key: `dass-local:${channelId}`, kind: "local" }] : [];
    const pending = ["loading", "ready", "watching"].includes(watching.phase) && watching.watchingShare?.roomId === channelId
        ? watching.watchingShare : undefined;
    const retained = watching.closedShare ?? watching.failedShare;
    const closed = ["disconnected", "failed"].includes(watching.phase) && retained?.roomId === channelId ? retained : undefined;
    const shares = [...(pending ? [pending] : []), ...(closed ? [closed] : []), ...(directory.phase === "ready" ? directory.shares : [])];
    const seen = new Set<string>();
    for (const share of shares) {
        if (share.roomId !== channelId || seen.has(share.shareId) || seen.size === 64) continue;
        seen.add(share.shareId);
        const ended = closed?.shareId === share.shareId && watching.closedShare?.roomId === channelId && watching.closedShare.shareId === share.shareId
            && directory.phase === "ready" && directory.directoryRoomId === channelId
            && !directory.shares.some(listed => listed.roomId === channelId && listed.shareId === share.shareId);
        result.push({ key: `dass-remote:${channelId}:${share.shareId}`, kind: "remote", share, ...(ended ? { ended: true } : {}) });
    }
    return result;
}

export function gridTileKeyExtractor(nativeKey: (index: number) => string, tiles: readonly unknown[]) {
    let nativeIndex = 0;
    const keys = tiles.map(renderer => {
        return typeof renderer === "function" && "dassTileKey" in renderer && typeof renderer.dassTileKey === "string"
            ? renderer.dassTileKey : nativeKey(nativeIndex++);
    });
    return (index: number) => keys[index];
}
