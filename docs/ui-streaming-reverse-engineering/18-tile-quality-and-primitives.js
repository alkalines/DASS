/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "872363", role: "quality and LIVE wrapper", start: 0, limit: 3300 },
        { moduleId: "42473", role: "card button tooltip tail", start: 1000, limit: 1100 },
        { moduleId: "802867", role: "stream tile imports", start: 0, limit: 1000 }
    ];
    const modules = targets.map(({ moduleId, role, start, limit }) => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, role, unavailable: true };
        const source = factory.toString();
        return { moduleId, role, sourceLength: source.length, start, source: source.slice(start, start + limit), remainingAfterExcerpt: Math.max(0, source.length - start - limit), opaque: source.includes("[native code]") };
    });
    const frameCandidates = [];
    let frameCandidateCount = 0;
    let opaqueFactories = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (source.includes("[native code]")) { opaqueFactories++; continue; }
        const offset = source.indexOf('"data-call-tile":""');
        if (offset < 0 || !source.includes('"data-selenium-video-tile":')) continue;
        frameCandidateCount++;
        if (frameCandidates.length < 2) frameCandidates.push({
            moduleId,
            sourceLength: source.length,
            header: source.slice(0, 120),
            offset,
            excerpt: source.slice(Math.max(0, offset - 260), offset + 80)
        });
    }
    return JSON.stringify({ probe: "18-tile-quality-and-primitives", sourceView: "original", modules, frameCandidateCount, opaqueFactories, frameCandidates });
})();
