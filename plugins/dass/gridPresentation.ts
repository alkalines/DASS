/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassShare } from "./routing";
import type { WatchStatus } from "./watching";

export type GridShare = { key: string; kind: "local"; } | { key: string; kind: "remote"; share: DassShare; };

export function gridShares(channelId: string, currentChannelId: string | undefined, active: boolean, localCapture: boolean,
    directory: WatchStatus, watching: WatchStatus): GridShare[] {
    if (!active || channelId !== currentChannelId) return [];
    const result: GridShare[] = localCapture ? [{ key: `dass-local:${channelId}`, kind: "local" }] : [];
    const pending = ["loading", "ready", "watching"].includes(watching.phase) && watching.watchingShare?.roomId === channelId
        ? watching.watchingShare : undefined;
    const shares = [...(pending ? [pending] : []), ...(directory.phase === "ready" ? directory.shares : [])];
    const seen = new Set<string>();
    for (const share of shares) {
        if (share.roomId !== channelId || seen.has(share.shareId) || seen.size === 64) continue;
        seen.add(share.shareId);
        result.push({ key: `dass-remote:${channelId}:${share.shareId}`, kind: "remote", share });
    }
    return result;
}

export function gridTileKeyExtractor(nativeKey: (index: number) => string, tiles: readonly unknown[]) {
    return (index: number) => {
        const renderer = tiles[index];
        return typeof renderer === "function" && "dassTileKey" in renderer && typeof renderer.dassTileKey === "string"
            ? renderer.dassTileKey : nativeKey(index);
    };
}
