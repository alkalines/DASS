/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const preferenceSource = factories["803224"]?.toString() || "";
    const gateSource = factories["351906"]?.toString() || "";
    const soundSource = factories["946261"]?.toString() || "";
    const lifecycle = ["stop(", "destroy(", "dispose(", "playWithListener("];
    return JSON.stringify({
        probe: "35-sound-guards-and-lifecycle",
        sourceView: "original",
        preferences: { sourceLength: preferenceSource.length, start: 1000, source: preferenceSource.slice(1000, 2300), remainingAfterExcerpt: Math.max(0, preferenceSource.length - 2300) },
        globalGate: { sourceLength: gateSource.length, source: gateSource.slice(0, 1100), truncated: gateSource.length > 1100 },
        soundObject: {
            sourceLength: soundSource.length,
            header: soundSource.slice(0, 300),
            lifecycle: lifecycle.map(anchor => {
                const offset = soundSource.indexOf(anchor);
                return { anchor, offset, source: offset >= 0 ? soundSource.slice(Math.max(0, offset - 70), offset + 500) : null };
            })
        }
    });
})();
