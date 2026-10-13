/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const targets = [
        { moduleId: "405916", role: "self stream actions", limit: 4400 },
        { moduleId: "74329", role: "second stream option group", limit: 2400 }
    ];
    return JSON.stringify({
        probe: "06-menu-options",
        sourceView: "Equicord-exposed original factory source",
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
