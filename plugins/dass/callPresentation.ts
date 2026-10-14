/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GridShare } from "./gridPresentation";
import type { PreviewPreferences } from "./streamPresentation";

export interface DassParticipant {
    id: string;
    type: "dass";
    dassShare: GridShare;
}

export function isDassParticipant(value: unknown): value is DassParticipant {
    return typeof value === "object" && value !== null && "type" in value && value.type === "dass"
        && "dassShare" in value && "id" in value && typeof value.id === "string";
}

export function projectParticipants(shares: readonly GridShare[]): DassParticipant[] {
    return shares.map(dassShare => ({ id: dassShare.key, type: "dass", dassShare }));
}

export function participantTitle(participant: DassParticipant, localDisplayName?: string) {
    return participant.dassShare.kind === "local" ? localDisplayName || "Your screen" : participant.dassShare.share.displayName ?? "Screen share";
}

export function sliderPlaybackVolume(sliderPercent: number) {
    return (Math.max(0, Math.min(100, sliderPercent)) / 100) ** 2.8;
}

export class CallPresentation {
    private channelId: string | undefined;
    private selectedId: string | undefined;
    private readonly listeners = new Set<() => void>();
    private audio = { muted: false, sliderPercent: 100 };
    private preview: PreviewPreferences = { showPreview: true, pauseWhenUnfocused: true };

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    getSelected(channelId: string, participants: readonly DassParticipant[]) {
        return channelId === this.channelId ? participants.find(participant => participant.id === this.selectedId) : undefined;
    }

    reconcile(channelId: string, participants: readonly DassParticipant[]) {
        if (channelId === this.channelId && this.selectedId && !participants.some(participant => participant.id === this.selectedId)) this.clearSelection();
    }

    select(channelId: string, participant: unknown, participants: readonly DassParticipant[]) {
        if (!isDassParticipant(participant)) {
            this.clearSelection();
            return false;
        }
        if (!participants.some(candidate => candidate.id === participant.id)) return true;
        this.selectedId = this.channelId === channelId && this.selectedId === participant.id ? undefined : participant.id;
        this.channelId = channelId;
        this.emit();
        return true;
    }

    clearSelection() {
        if (!this.selectedId && !this.channelId) return;
        this.selectedId = this.channelId = undefined;
        this.emit();
    }

    getAudio() { return this.audio; }

    getPreview() { return this.preview; }

    setPreview(preferences: PreviewPreferences) {
        this.preview = { ...preferences };
        this.emit();
    }

    setAudio(muted: boolean, sliderPercent = this.audio.sliderPercent) {
        this.audio = { muted, sliderPercent: Math.max(0, Math.min(100, sliderPercent)) };
        this.emit();
    }

    reset() {
        this.selectedId = this.channelId = undefined;
        this.audio = { muted: false, sliderPercent: 100 };
        this.preview = { showPreview: true, pauseWhenUnfocused: true };
        this.emit();
    }

    private emit() { for (const listener of this.listeners) listener(); }
}
