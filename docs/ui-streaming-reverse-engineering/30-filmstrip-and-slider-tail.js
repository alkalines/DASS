/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "122641", role: "MediaBar drag-end and render tail", start: 2500, limit: 1500 },
        { moduleId: "163432", role: "filmstrip and tile sizing", start: 0, limit: 3200 },
        { moduleId: "947580", role: "remaining-participant helper", start: 0, limit: 1200 }
    ];
    return JSON.stringify({
        probe: "30-filmstrip-and-slider-tail",
        sourceView: "original",
        modules: targets.map(({ moduleId, role, start, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, start, source: source.slice(start, start + limit), remainingAfterExcerpt: Math.max(0, source.length - start - limit), opaque: source.includes("[native code]") };
        })
    });
})();
