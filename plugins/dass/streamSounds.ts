/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { filters, findAll } from "@webpack";
import { NotificationSettingsStore, showToast } from "@webpack/common";

import { logDiagnostic } from "../../clients/spike/diagnostics";
import type { PublishController } from "./publishing";
import { type StreamSound, streamSoundEvents, streamSoundState } from "./soundEvents";
import type { WatchSet } from "./watchSet";

interface NativeSound { stop(): void; }
type PlaySound = (sound: StreamSound, volume: number) => NativeSound | undefined;

export function startStreamSounds(publisher: PublishController, watching: Pick<WatchSet, "getSnapshot" | "subscribeStatus">, currentContext: () => string | undefined) {
    const snapshot = () => {
        const state = streamSoundState(currentContext(), publisher.getSnapshot(), watching.getSnapshot());
        state.publishing &&= !!publisher.getPreviewStream();
        return state;
    };
    let previous = snapshot();
    let unavailable = false;
    const players = new Map<StreamSound, NativeSound>();
    const sync = () => {
        const next = snapshot();
        const sounds = streamSoundEvents(previous, next);
        previous = next;
        if (unavailable || !sounds.length) return;
        try {
            const matches = findAll(filters.byCode("Unable to find sound for pack name:")) as PlaySound[];
            if (matches.length !== 1) throw new Error("Native sound playback unavailable.");
            const [playSound] = matches;
            for (const sound of sounds) {
                if (NotificationSettingsStore.isSoundDisabled(sound)) continue;
                players.get(sound)?.stop();
                players.delete(sound);
                const player = playSound(sound, 0.4);
                if (player) players.set(sound, player);
            }
        } catch {
            unavailable = true;
            logDiagnostic("native stream sounds unavailable", undefined, true);
            showToast({ text: "DASS sound cues are unavailable on this Discord build. Sharing is unaffected." });
        }
    };
    const unsubscribePublisher = publisher.subscribe(sync);
    const unsubscribeWatching = watching.subscribeStatus(sync);
    return () => {
        unsubscribePublisher();
        unsubscribeWatching();
        for (const player of players.values()) player.stop();
        players.clear();
    };
}
