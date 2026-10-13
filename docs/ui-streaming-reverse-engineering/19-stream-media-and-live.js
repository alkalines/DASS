/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "802867", role: "stream tile media and overlay tail", start: 4000, limit: 2800 },
        { moduleId: "650338", role: "quality derivation and formatting", start: 0, limit: 1800 },
        { moduleId: "402216", role: "LIVE presentation exports", start: 0, limit: 1200 }
    ];
    return JSON.stringify({
        probe: "19-stream-media-and-live",
        sourceView: "Equicord-exposed original factory source",
        modules: targets.map(({ moduleId, role, start, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, start, source: source.slice(start, start + limit), remainingAfterExcerpt: Math.max(0, source.length - start - limit), opaque: source.includes("[native code]") };
        })
    });
})();
