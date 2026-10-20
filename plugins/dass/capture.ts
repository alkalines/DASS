/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { browserFailureCode, logDiagnostic } from "../../clients/spike/diagnostics";
import type { CaptureLease } from "./routing";

export interface EquibopCaptureBridge {
    version: 1;
    capture(signal: AbortSignal): Promise<CaptureLease>;
}

/** No fallback: stock Equibop does not expose the required lifecycle bridge. */
export function createEquibopCapture(bridge?: EquibopCaptureBridge) {
    return async (signal: AbortSignal): Promise<CaptureLease> => {
        if (signal.aborted || bridge?.version !== 1 || typeof bridge.capture !== "function") {
            logDiagnostic("capture unavailable", { code: signal.aborted ? "cancelled" : "bridge_missing_or_incompatible" }, true);
            throw new Error("The Equibop DASS capture bridge is unavailable.");
        }
        logDiagnostic("capture picker requested");
        try {
            const lease = await bridge.capture(signal);
            // The picker may have been closed while the host was still starting.
            // A cancelled capture must never leave a live lease behind.
            if (signal.aborted) {
                await lease.release();
                throw new Error("The DASS capture was cancelled.");
            }
            logDiagnostic("capture acquired", { audioSelected: lease.audioSelected });
            return lease;
        } catch (error) {
            logDiagnostic("capture failed or cancelled", { code: signal.aborted ? "cancelled" : browserFailureCode(error) }, true);
            throw error;
        }
    };
}

/** Development-only capture check. No transport, previews, or Discord events. */
export class LocalCaptureCheck {
    private pending?: AbortController;
    private lease?: CaptureLease;

    stop() {
        this.pending?.abort();
        this.pending = undefined;
        this.lease?.release();
        this.lease = undefined;
    }

    async capture(bridge?: EquibopCaptureBridge): Promise<string> {
        this.stop();
        const request = new AbortController();
        this.pending = request;
        try {
            const lease = await createEquibopCapture(bridge)(request.signal);
            if (request.signal.aborted || this.pending !== request) {
                lease.release();
                return "Local capture was cancelled.";
            }
            this.lease = lease;
            return lease.audioSelected
                ? "Local capture acquired with selected share audio. No media is transmitted."
                : "Local video-only capture acquired. No media is transmitted.";
        } catch {
            if (this.pending === request) this.stop();
            return "Local capture unavailable, failed or cancelled. If share audio is unavailable, choose no audio for video-only capture. No Discord fallback.";
        }
    }
}
