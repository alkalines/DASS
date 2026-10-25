/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CallPresentation, participantTitle, projectParticipants } from "../../plugins/dass/callPresentation";
import { APPROVED_DISCORD_BUILDS, DISCORD_PRESENTATION_PATCHES, DISCORD_SHARE_PATCHES, getDiscordBuildWarning } from "../../plugins/dass/discordAdapter";
import { shouldPauseLocalPreview, streamQualityLabel, streamTrackQuality } from "../../plugins/dass/streamPresentation";

test("real quality labels require valid observed track settings", () => {
    expect(streamTrackQuality({ height: 1080, frameRate: 29.97 })).toEqual({ resolution: "1080p", framesPerSecond: 30, premium: true });
    expect(streamQualityLabel(streamTrackQuality({ height: 1440, frameRate: 60 }))).toBe("1440p 60FPS");
    expect(streamQualityLabel(undefined)).toBeUndefined();
    for (const settings of [undefined, {}, { height: 1080 }, { frameRate: 30 }, { height: NaN, frameRate: 30 },
        { height: 1080, frameRate: Infinity }, { height: -1, frameRate: 30 }, { height: 1080, frameRate: 0 }]) {
        expect(streamTrackQuality(settings)).toBeUndefined();
    }
});

test("quality styling is standard through 720p 30FPS and premium above either limit", () => {
    for (const [height, frameRate, premium] of [[480, 30, false], [720, 30, false], [720, 29.97, false],
        [720, 60, true], [720, 59.94, true], [1080, 30, true], [2160, 30, true], [2160, 120, true]] as const) {
        expect(streamTrackQuality({ height, frameRate })?.premium).toBe(premium);
    }
});

test("preview preferences are shared across tiles, independent of audio and reset safely", () => {
    const presentation = new CallPresentation();
    let updates = 0;
    const unsubscribe = presentation.subscribe(() => updates++);
    presentation.setAudio(false, 70);
    const preferences = { showPreview: false, pauseWhenUnfocused: false };
    presentation.setPreview(preferences);
    preferences.showPreview = true;
    expect(presentation.getPreview()).toEqual({ showPreview: false, pauseWhenUnfocused: false });
    expect(presentation.getAudio()).toEqual({ muted: false, sliderPercent: 70 });
    expect(updates).toBe(2);
    presentation.reset();
    expect(presentation.getPreview()).toEqual({ showPreview: true, pauseWhenUnfocused: true });
    unsubscribe();
});

test("hiding or unfocusing pauses local playback only when the selected preference requires it", () => {
    for (const showPreview of [false, true]) {
        for (const pauseWhenUnfocused of [false, true]) {
            for (const focused of [false, true]) {
                expect(shouldPauseLocalPreview({ showPreview, pauseWhenUnfocused }, focused)).toBe(!showPreview || pauseWhenUnfocused && !focused);
            }
        }
    }
    const source = readFileSync(new URL("../../plugins/dass/gridTile.tsx", import.meta.url), "utf8");
    expect(source).toContain('ownerWindow.removeEventListener("blur", updateFocus)');
    expect(source).toContain('ownerDocument.removeEventListener("visibilitychange", updateFocus)');
    expect(source).toContain("paused || previewPaused ? undefined : stream");
    expect(source).not.toContain("track.enabled");
    expect(source).not.toContain("track.stop()");
});

test("publisher name uses the current display name without changing remote DASS identities", () => {
    const [local, remote] = projectParticipants([{ key: "local", kind: "local" },
        { key: "remote", kind: "remote", share: { roomId: "call", shareId: "share", displayName: "DASS account" } }]);
    expect(participantTitle(local, "Publisher name")).toBe("Publisher name");
    expect(participantTitle(local)).toBe("Your screen");
    expect(participantTitle(remote, "Publisher name")).toBe("DASS account");
});

test("unapproved builds warn without gating or duplicating presentation and capture hooks", () => {
    expect(APPROVED_DISCORD_BUILDS).toEqual([634304, 637268, 638651]);
    for (const build of APPROVED_DISCORD_BUILDS) expect(getDiscordBuildWarning(build)).toBeUndefined();
    for (const build of [638652, 999999, 0, NaN]) {
        expect(getDiscordBuildWarning(build)).toBe("The current plugin version is not yet approved for this Discord build. This could cause the UI to break.");
    }
    expect(DISCORD_SHARE_PATCHES).toHaveLength(6);
    expect(DISCORD_PRESENTATION_PATCHES).toHaveLength(8);
    for (const patches of [DISCORD_SHARE_PATCHES, DISCORD_PRESENTATION_PATCHES]) {
        for (const patch of patches) {
            expect(patch).not.toHaveProperty("fromBuild");
            expect(patch).not.toHaveProperty("toBuild");
        }
    }
});
