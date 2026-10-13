/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "792251", role: "actual volume conversion", start: 0, limit: 1200 },
        { moduleId: "122641", role: "speaker MediaBar drag lifecycle", start: 0, limit: 2700 },
        { moduleId: "699707", role: "focused layout continuation", start: 1000, limit: 2500 }
    ];
    return JSON.stringify({
        probe: "29-volume-drag-and-focus",
        sourceView: "original",
        modules: targets.map(({ moduleId, role, start, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, start, source: source.slice(start, start + limit), remainingAfterExcerpt: Math.max(0, source.length - start - limit), opaque: source.includes("[native code]") };
        })
    });
})();
