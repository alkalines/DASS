/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Borrow controller-owned tracks; detaching a tile must not stop the share. */
export function attachTilePlayback(element: HTMLVideoElement, stream: MediaStream | undefined, localPreview: boolean,
    onBlocked: () => void) {
    let attached = true;
    element.muted = localPreview;
    element.srcObject = stream ?? null;
    if (stream) void element.play().catch(() => { if (attached) onBlocked(); });
    return () => {
        attached = false;
        element.pause();
        element.muted = true;
        element.srcObject = null;
    };
}
