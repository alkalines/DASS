/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SidebarState {
    metadata: { sourceName?: string; qualityLabel?: string; premiumQuality?: boolean; };
    stop(): void;
}

export function sidebarActionProps<T extends Record<string, unknown>>(nativeProps: T, state: SidebarState | undefined) {
    if (!state) return nativeProps;
    return {
        ...nativeProps,
        stream: null,
        isStreaming: true,
        canGoLive: true,
        canGoLiveActivity: false,
        canStream: true,
        runningGame: null,
        embeddedActivity: null,
        frame: null,
        activity: null,
        application: null,
        canStartAuthorization: false,
        hasAlreadyLinked: false,
        connectionApp: null,
        dassStop: state.stop
    };
}

export function stopSidebarStream(dassStop: (() => void) | undefined, nativeStop: () => void) {
    if (dassStop) dassStop();
    else nativeStop();
}
