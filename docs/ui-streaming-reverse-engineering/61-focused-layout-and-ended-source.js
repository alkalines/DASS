/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    return JSON.stringify({
        probe: "61-focused-layout-and-ended-source", mutatesNothing: true,
        modules: [
            { moduleId: "699707", role: "native focused layout", limit: 3700 },
            { moduleId: "566331", role: "native ended artwork/presentation", limit: 1300 }
        ].map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            const source = typeof factory === "function" ? factory.toString() : "";
            return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, available: !!source };
        })
    });
})();
