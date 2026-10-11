/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease, DassShare, RoutingResult, ScreenshareRouting } from "./routing";

const VOICE_PANEL_SHARE_START_MATCH = /(\i=\i\.useCallback\(\(\)=>\{)(\(0,\i\.A\)\(\i,\i\.id,\i\))(?=\},\[\i,\i\.id,\i\]\),\i=\i\.find\(\i=>\i\.ownerId===\i\?\.id\))/;

export const DISCORD_SHARE_PATCHES = [{
    find: /renderNUXHighlight:\i,buttonRef:\i,onClick:null!=\i\?\i:\i(?=\}\))/,
    fromBuild: 634304,
    toBuild: 634304,
    replacement: {
        match: /onClick:null!=(\i)\?(\i):(\i)(?=\}\))/,
        replace: "onClick:null!=$1?$2:()=>$self.chooseShareTransport($3)"
    }
}, {
    find: VOICE_PANEL_SHARE_START_MATCH,
    fromBuild: 634304,
    toBuild: 634304,
    replacement: {
        match: VOICE_PANEL_SHARE_START_MATCH,
        replace: "$1$self.chooseShareTransport(()=>$2)"
    }
}];

export const TRANSPORT_UNAVAILABLE_MESSAGE = "DASS transport unavailable.";

export function createShareSelection(signal: AbortSignal, isContextCurrent: () => boolean, nativeStart: () => void) {
    let consumed = false;
    return (transport: "dass" | "discord" | "cancel") => {
        if (consumed || signal.aborted || !isContextCurrent()) return;
        consumed = true;
        if (transport === "dass") return TRANSPORT_UNAVAILABLE_MESSAGE;
        if (transport === "discord") nativeStart();
    };
}

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
