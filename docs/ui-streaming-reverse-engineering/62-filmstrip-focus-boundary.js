/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    return JSON.stringify({
        probe: "62-filmstrip-focus-boundary", mutatesNothing: true,
        modules: [
            { moduleId: "163432", role: "native filmstrip renderer/sizing", limit: 2800 },
            { moduleId: "80051", role: "focused participant-strip control", limit: 1100 }
        ].map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            const source = typeof factory === "function" ? factory.toString() : "";
            return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, available: !!source };
        })
    });
})();
