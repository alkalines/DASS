/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DassSession } from "./session";
import type { WatchController } from "./watching";

export function createCallDiscovery(session: Pick<DassSession, "getSnapshot" | "getAccess" | "subscribe">,
    directory: Pick<WatchController, "start" | "stop" | "reset" | "bind">, backendUrl: () => string, mediaActive = () => false) {
    let active = false;
    let binding: string | undefined;
    let unsubscribe: (() => void) | undefined;

    function sync() {
        if (!active) return;
        const account = session.getSnapshot();
        // Account mode allows independent directory, publishing and watching.
        // The optional pause hook is retained for exclusive legacy-invite tests.
        const nextBinding = !mediaActive() && account.configured && account.phase === "ready" && account.roomId
            ? JSON.stringify([backendUrl(), account.username, account.roomId]) : undefined;
        if (binding === nextBinding) return;
        binding = nextBinding;
        directory.reset();
        if (!nextBinding) return;
        const access = session.getAccess();
        void directory.bind(backendUrl(), access.roomId, access);
    }

    return {
        sync,
        retry() {
            binding = undefined;
            sync();
        },
        start() {
            if (active) return;
            active = true;
            directory.start();
            unsubscribe = session.subscribe(sync);
            sync();
        },
        stop() {
            active = false;
            unsubscribe?.();
            unsubscribe = undefined;
            binding = undefined;
            directory.stop();
        }
    };
}
