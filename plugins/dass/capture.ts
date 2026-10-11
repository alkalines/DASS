/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureLease } from "./routing";

export interface EquibopCaptureBridge {
    version: 1;
    capture(signal: AbortSignal): Promise<CaptureLease>;
}

/** No fallback: stock Equibop does not expose the required lifecycle bridge. */
export function createEquibopCapture(bridge?: EquibopCaptureBridge) {
    return async (signal: AbortSignal): Promise<CaptureLease> => {
        if (signal.aborted || bridge?.version !== 1 || typeof bridge.capture !== "function") {
            throw new Error("The Equibop DASS capture bridge is unavailable.");
        }
        return bridge.capture(signal);
    };
}
