/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { StreamQuality } from "./streamUi";

export interface PreviewPreferences {
    showPreview: boolean;
    pauseWhenUnfocused: boolean;
}

export function shouldPauseLocalPreview(preferences: PreviewPreferences, windowFocused: boolean) {
    return !preferences.showPreview || preferences.pauseWhenUnfocused && !windowFocused;
}

export function streamTrackQuality(settings?: Pick<MediaTrackSettings, "height" | "frameRate">): StreamQuality | undefined {
    if (!settings?.height || !settings.frameRate || !Number.isFinite(settings.height) || !Number.isFinite(settings.frameRate)
        || settings.height < 1 || settings.frameRate < 1) return;
    const height = Math.round(settings.height);
    const framesPerSecond = Math.round(settings.frameRate);
    return { resolution: `${height}p`, framesPerSecond, premium: height > 720 || framesPerSecond > 30 };
}

export function streamQualityLabel(quality: StreamQuality | undefined) {
    return quality ? `${quality.resolution} ${quality.framesPerSecond}FPS` : undefined;
}
