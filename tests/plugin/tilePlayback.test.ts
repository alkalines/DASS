/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { attachTilePlayback } from "../../plugins/dass/tilePlayback";

function fixture(play: () => Promise<void> = () => Promise.resolve()) {
    let stops = 0;
    const stream = { getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream;
    const element = { muted: true, srcObject: null as MediaStream | null, plays: 0, pauses: 0,
        play() { this.plays++; return play(); }, pause() { this.pauses++; } };
    return { stream, element, stops: () => stops };
}

test("Watch Stream plays remote audio without an extra mute gate; local preview stays muted", () => {
    for (const localPreview of [false, true]) {
        const f = fixture();
        const detach = attachTilePlayback(f.element as unknown as HTMLVideoElement, f.stream, localPreview, () => { throw new Error("Playback was not blocked"); });
        expect(f.element.muted).toBe(localPreview);
        expect(f.element.srcObject).toBe(f.stream);
        expect(f.element.plays).toBe(1);
        detach();
        expect(f.element.srcObject).toBeNull();
        expect(f.element.muted).toBe(true);
        expect(f.element.pauses).toBe(1);
        expect(f.stops()).toBe(0);
    }
});

test("blocked playback asks for user action, but late failure cannot update a detached tile", async () => {
    for (const detached of [false, true]) {
        let reject!: (error: Error) => void;
        const f = fixture(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
        let prompts = 0;
        const detach = attachTilePlayback(f.element as unknown as HTMLVideoElement, f.stream, false, () => { prompts++; });
        if (detached) detach();
        reject(new Error("Autoplay blocked"));
        await Promise.resolve();
        expect(prompts).toBe(detached ? 0 : 1);
        detach();
        expect(f.stops()).toBe(0);
    }
});

test("loading placeholders do not start playback", () => {
    const f = fixture();
    const detach = attachTilePlayback(f.element as unknown as HTMLVideoElement, undefined, false, () => {});
    expect(f.element.srcObject).toBeNull();
    expect(f.element.plays).toBe(0);
    detach();
});
