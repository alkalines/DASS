/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    if (!cache) return JSON.stringify({ error: "Loaded webpack modules are unavailable." });
    const targets = [
        ["958449", "h", "Share"],
        ["204651", "l", "Split button"],
        ["272812", "A", "Tile frame"],
        ["402216", "Ay", "LIVE badge"],
        ["42473", "A", "Card action button"],
        ["821609", "$", "Secondary button"],
        ["461782", "k3", "Idle context"]
    ];
    const contextFactory = webpack.wreq?.m?.["461782"];
    const contextSource = typeof contextFactory === "function" ? contextFactory.toString() : "";
    const common = webpack.Common;
    return JSON.stringify({
        probe: "44-sandbox-preflight",
        mountsNothing: true,
        hostReact: {
            createElement: typeof common?.React?.createElement,
            useState: typeof common?.React?.useState,
            createRoot: typeof common?.createRoot
        },
        components: targets.map(([moduleId, exportName, role]) => {
            const exports = cache[moduleId]?.exports;
            const value = exports?.[exportName];
            return { moduleId, exportName, role, loaded: !!exports, exportType: typeof value };
        }),
        idleContextSource: {
            sourceLength: contextSource.length,
            source: contextSource.slice(0, 2000),
            truncated: contextSource.length > 2000
        }
    });
})();
