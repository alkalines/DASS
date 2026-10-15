/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { streamSoundEvents, streamSoundState, type StreamSound } from "../../plugins/dass/soundEvents";

const source = readFileSync(new URL("../../plugins/dass/streamSounds.ts", import.meta.url), "utf8");
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(/^import .+;$/gm, "").replace("export function", "function"));

function harness(matches = 1) {
    let phase = "idle";
    let viewerCount = 0;
    const listeners = new Set<() => void>();
    const played: StreamSound[] = [];
    const stopped: StreamSound[] = [];
    const disabled = new Set<StreamSound>();
    const toasts: string[] = [];
    const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
    const player = (sound: StreamSound) => { played.push(sound); return { stop: () => stopped.push(sound) }; };
    const create = new Function("findAll", "filters", "NotificationSettingsStore", "showToast", "logDiagnostic", "streamSoundState", "streamSoundEvents",
        `${compiled}\nreturn startStreamSounds;`)(() => Array(matches).fill(player), { byCode: () => () => true },
        { isSoundDisabled: (sound: StreamSound) => disabled.has(sound) }, (text: string) => toasts.push(text), () => {}, streamSoundState, streamSoundEvents);
    const stop = create({ subscribe, getSnapshot: () => ({ phase, viewerCount }), getPreviewStream: () => phase === "publishing" ? {} : undefined },
        { subscribeStatus: subscribe, getSnapshot: () => ({ phase: "idle" }) }, () => "call");
    return { played, stopped, disabled, toasts, listeners, stop,
        update(next: string, count = 0) { phase = next; viewerCount = count; for (const listener of listeners) listener(); } };
}

test("native playback respects disabled sounds without replaying them later", () => {
    const runtime = harness();
    runtime.disabled.add("stream_started");
    runtime.update("publishing");
    expect(runtime.played).toEqual([]);
    runtime.disabled.clear();
    runtime.update("publishing");
    expect(runtime.played).toEqual([]);
    runtime.update("idle");
    expect(runtime.played).toEqual(["stream_ended"]);
    runtime.stop();
});

test("teardown unsubscribes and stops owned audio without another cue", () => {
    const runtime = harness();
    runtime.update("publishing");
    runtime.update("idle");
    runtime.update("publishing");
    expect(runtime.stopped).toEqual(["stream_started"]);
    runtime.stop();
    expect(runtime.listeners.size).toBe(0);
    expect(runtime.stopped).toEqual(["stream_started", "stream_ended", "stream_started"]);
    runtime.update("idle");
    expect(runtime.played).toEqual(["stream_started", "stream_ended", "stream_started"]);
});

test("missing or ambiguous native hooks disable cues visibly once, not sharing", () => {
    for (const matches of [0, 2]) {
        const runtime = harness(matches);
        runtime.update("publishing");
        runtime.update("idle");
        runtime.update("publishing");
        expect(runtime.played).toEqual([]);
        expect(runtime.toasts).toHaveLength(1);
        runtime.stop();
    }
});

test("broadcaster presence changes play native joined/left once and respect sound toggles", () => {
    const runtime = harness();
    runtime.update("publishing");
    runtime.update("publishing", 1);
    runtime.update("publishing", 1);
    runtime.update("publishing", 0);
    expect(runtime.played).toEqual(["stream_started", "stream_user_joined", "stream_user_left"]);
    runtime.disabled.add("stream_user_joined");
    runtime.update("publishing", 1);
    expect(runtime.played).toHaveLength(3);
    runtime.stop();
});
