/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** One owner for the installed display capture path and process-global venmic. */
export function createCaptureOwnership() {
    let owner: "native" | "dass" | undefined;
    let enteringDass = false;
    let nativeCleanup: (() => void) | undefined;
    return {
        claim(kind: "native" | "dass") {
            if (owner) throw new Error("Another screen capture is active or pending.");
            owner = kind;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                owner = undefined;
                nativeCleanup = undefined;
            };
        },
        invokeDass<T>(capture: () => T): T {
            if (owner !== "dass" || enteringDass) throw new Error("Capture unavailable.");
            enteringDass = true;
            try {
                return capture();
            } finally {
                enteringDass = false;
            }
        },
        enter() {
            if (enteringDass) {
                enteringDass = false;
                return { dass: true, release: () => {} };
            }
            return { dass: false, release: this.claim("native") };
        },
        setNativeCleanup(cleanup: () => void) {
            nativeCleanup = cleanup;
        },
        stopNative() {
            nativeCleanup?.();
        }
    };
}

export const captureOwnership = createCaptureOwnership();
