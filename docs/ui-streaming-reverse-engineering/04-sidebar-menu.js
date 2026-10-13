/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "848362", role: "menu and stream-list helper", limit: 5200 },
        { moduleId: "338771", role: "native stop action", limit: 1200 },
        { moduleId: "471993", role: "native share-start entry", limit: 900 }
    ];
    return JSON.stringify({
        probe: "04-sidebar-menu",
        modules: targets.map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = Function.prototype.toString.call(factory);
            return {
                moduleId,
                role,
                sourceLength: source.length,
                source: source.slice(0, limit),
                truncated: source.length > limit
            };
        })
    });
})();
