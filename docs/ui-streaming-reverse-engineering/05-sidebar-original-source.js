/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "848362", role: "menu and stream-list helper", limit: 5000 },
        { moduleId: "471993", role: "complete native share-start entry", limit: 1500 }
    ];
    return JSON.stringify({
        probe: "05-sidebar-original-source",
        sourceView: "Equicord-exposed original factory source, not necessarily patched runtime source",
        modules: targets.map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return {
                moduleId,
                role,
                sourceLength: source.length,
                source: source.slice(0, limit),
                truncated: source.length > limit,
                opaque: source.includes("[native code]")
            };
        })
    });
})();
