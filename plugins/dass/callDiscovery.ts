/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassSession } from "./session";
import type { WatchController } from "./watching";

export function createCallDiscovery(session: Pick<DassSession, "getSnapshot" | "getAccess" | "subscribe">,
    directory: Pick<WatchController, "start" | "stop" | "reset" | "bind" | "refresh" | "getSnapshot" | "subscribeStatus">, backendUrl: () => string, mediaActive = () => false) {
    let active = false;
    let binding: string | undefined;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeDirectory: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 1_000;
    let lastManualRefreshAtMs = -Infinity;

    function cancelRetry() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
    }

    function directoryChanged() {
        const { phase } = directory.getSnapshot();
        if (phase === "ready") { retryDelayMs = 1_000; cancelRetry(); }
        else if (phase === "loading" || phase === "unauthorized") cancelRetry();
        else if (active && binding && (phase === "disconnected" || phase === "failed") && !retryTimer) {
            retryTimer = setTimeout(() => {
                retryTimer = undefined;
                retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
                binding = undefined;
                sync();
            }, retryDelayMs);
        }
    }

    function sync() {
        if (!active) return;
        const account = session.getSnapshot();
        // Account mode allows independent directory, publishing and watching.
        // The optional pause hook is retained for exclusive legacy-invite tests.
        const nextBinding = !mediaActive() && account.configured && (account.phase === "ready" || account.phase === "failed") && account.roomId
            ? JSON.stringify([backendUrl(), account.username, account.roomId]) : undefined;
        if (binding === nextBinding) return;
        cancelRetry();
        binding = nextBinding;
        directory.reset();
        if (!nextBinding) return;
        const access = session.getAccess();
        void directory.bind(backendUrl(), access.roomId, access);
    }

    return {
        sync,
        retry() {
            if (!active || directory.getSnapshot().phase === "loading") return;
            if (Date.now() - lastManualRefreshAtMs < 2_000) return;
            lastManualRefreshAtMs = Date.now();
            cancelRetry();
            if (binding && directory.getSnapshot().phase === "ready") {
                void directory.refresh();
                return;
            }
            binding = undefined;
            sync();
        },
        start() {
            if (active) return;
            active = true;
            directory.start();
            unsubscribe = session.subscribe(sync);
            unsubscribeDirectory = directory.subscribeStatus(directoryChanged);
            sync();
        },
        stop() {
            active = false;
            cancelRetry();
            unsubscribe?.();
            unsubscribeDirectory?.();
            unsubscribeDirectory = undefined;
            unsubscribe = undefined;
            binding = undefined;
            directory.stop();
        }
    };
}
