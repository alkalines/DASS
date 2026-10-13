/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const tileSource = factories["175203"]?.toString() || "";
    const controllerSource = factories["540462"]?.toString() || "";
    const matches = Array.from(tileSource.matchAll(/controlsBottom/g));
    const imports = ["x", "eF", "B", "j", "y", "k", "ez"].map(alias => {
        const matches = Array.from(controllerSource.matchAll(new RegExp("\\b" + alias + "\\s*=\\s*([\\w$]+)\\(\\s*(\\d+)\\s*\\)", "g")));
        return { alias, count: matches.length, moduleIds: matches.slice(0, 3).map(match => match[2]) };
    });
    return JSON.stringify({
        probe: "25-footer-and-selection-imports",
        sourceView: "original",
        footerMatchCount: matches.length,
        windows: matches.slice(0, 3).map(match => {
            const start = Math.max(0, match.index - 650);
            const end = Math.min(tileSource.length, match.index + 1000);
            return { anchorOffset: match.index, start, end, source: tileSource.slice(start, end) };
        }),
        controllerImports: imports
    });
})();
