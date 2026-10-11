/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease, DassShare, RoutingResult, ScreenshareRouting } from "./routing";

export type PublishIntent = { transport: "discord"; } | {
    transport: "dass";
    roomId: string;
    capture(signal: AbortSignal): Promise<CaptureLease>;
};

export type WatchIntent = { transport: "discord"; } | { transport: "dass"; share: DassShare; };

export type Interception<T> = { handled: false; } | { handled: true; completion: Promise<RoutingResult<T>>; };

export function routePublish(routing: ScreenshareRouting, intent: PublishIntent): Interception<void> {
    if (intent.transport === "discord") return { handled: false };
    return { handled: true, completion: routing.publish(intent.roomId, intent.capture) };
}

export function routeWatch(routing: ScreenshareRouting, intent: WatchIntent): Interception<MediaStream> {
    if (intent.transport === "discord") return { handled: false };
    return { handled: true, completion: routing.watch(intent.share) };
}
