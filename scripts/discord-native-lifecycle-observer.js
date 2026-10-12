/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// DevTools observer: event names/times only, never payloads or media.
(() => {
    const kind = "DASS native lifecycle observer";
    const previous = globalThis.__dassNativeLifecycleProbe;
    if (previous !== undefined) {
        if (previous?.kind !== kind || typeof previous.stop !== "function")
            throw new Error("Diagnostic global already belongs to another tool.");
        previous.stop();
    }
    const webpack = globalThis.Vencord?.Webpack;
    const dispatcher = webpack?.Common?.FluxDispatcher;
    if (typeof dispatcher?.subscribe !== "function" || typeof dispatcher?.unsubscribe !== "function")
        throw new Error("Loaded FluxDispatcher unavailable; no modules were force-loaded.");
    const events = [];
    const subscriptions = [];
    const startedAt = performance.now();
    let droppedEvents = 0;
    let active = true;
    let timeout;
    const record = name => {
        if (!active) return;
        if (events.length >= 200) { droppedEvents++; return; }
        events.push({ name, elapsedMs: Math.round(performance.now() - startedAt) });
    };
    const snapshot = () => ({ kind, active, droppedEvents, events: events.map(event => ({ ...event })) });
    const stop = () => {
        if (active) {
            active = false;
            clearTimeout(timeout);
            for (const [name, callback] of subscriptions) dispatcher.unsubscribe(name, callback);
        }
        return snapshot();
    };
    try {
        for (const name of [
            "STREAM_START", "STREAM_CREATE", "STREAM_UPDATE", "STREAM_CLOSE", "STREAM_DELETE", "STREAM_WATCH",
            "STREAM_UPDATE_SELF_HIDDEN", "RTC_CONNECTION_VIDEO", "VIDEO_STREAM_READY_TIMEOUT",
            "CLEAR_VIDEO_STREAM_READY_TIMEOUT", "CHANNEL_RTC_SELECT_PARTICIPANT", "CHANNEL_RTC_UPDATE_LAYOUT",
            "CHANNEL_RTC_POPOUT_PARTICIPANT", "CHANNEL_RTC_RETURN_PARTICIPANT",
            "VOICE_CHANNEL_SELECT", "AUDIO_TOGGLE_LOCAL_MUTE", "AUDIO_SET_LOCAL_VOLUME"
        ]) {
            // Ignore callback arguments deliberately: no event object is retained.
            const callback = () => record(name);
            dispatcher.subscribe(name, callback);
            subscriptions.push([name, callback]);
        }
    } catch (error) {
        stop();
        throw error;
    }
    const allowedMarkers = new Set([
        "share-click", "picker-cancelled", "capture-accepted", "focused", "grid",
        "popout", "returned", "stop-click", "source-ended", "test-finished"
    ]);
    globalThis.__dassNativeLifecycleProbe = {
        kind,
        snapshot,
        stop,
        mark(name) {
            if (!allowedMarkers.has(name)) throw new Error("Use a documented phase marker, not free-form data.");
            record(`MARK:${name}`);
        },
        download() {
            const report = stop();
            const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "discord-native-lifecycle-events.json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            return { downloaded: link.download, eventCount: report.events.length, droppedEvents };
        }
    };
    record("MARK:observer-installed");
    timeout = setTimeout(stop, 300_000);
    return "Observer installed for five minutes. Sharing remains entirely user-initiated. Stop/download removes subscriptions.";
})();
