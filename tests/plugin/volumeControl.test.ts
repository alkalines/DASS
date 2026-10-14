/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CallPresentation, sliderPlaybackVolume } from "../../plugins/dass/callPresentation";

test("stream mute preserves the remembered volume and does not change its playback curve", () => {
    const presentation = new CallPresentation();
    presentation.setAudio(false, 35);
    presentation.setAudio(true);
    expect(presentation.getAudio()).toEqual({ muted: true, sliderPercent: 35 });
    presentation.setAudio(false);
    expect(presentation.getAudio()).toEqual({ muted: false, sliderPercent: 35 });
    expect(sliderPlaybackVolume(35)).toBeCloseTo(0.35 ** 2.8);
    presentation.setAudio(false, 150);
    expect(presentation.getAudio().sliderPercent).toBe(100);
    presentation.setAudio(false, -5);
    expect(presentation.getAudio().sliderPercent).toBe(0);
});

test("vertical volume control owns its input and timeout without native audio stores or window listeners", () => {
    const source = readFileSync(new URL("../../plugins/dass/volumeControl.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../plugins/dass/volumeControl.css", import.meta.url), "utf8");
    expect(source).toContain('type="range"');
    expect(source).toContain('aria-orientation="vertical"');
    expect(source).toContain('aria-label="DASS stream volume"');
    expect(source).toContain("hidden={!visible}");
    expect(source).toContain("useEffect(() => () => clearTimeout(hideTimeout.current), [])");
    expect(source).toContain("onPointerCancel");
    expect(source).toContain("onLostPointerCapture");
    expect(source).toContain('event.key === "Escape" && visible');
    expect(css).toContain("writing-mode: vertical-lr");
    expect(css).toContain("height: 72px");
    expect(css).toContain("width: 6px");
    for (const forbidden of ["addEventListener", "MediaEngineStore", "AudioStore", "findComponent", "getDisplayMedia", "RTCPeerConnection"]) {
        expect(source).not.toContain(forbidden);
    }
});
