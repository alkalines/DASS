/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const factory = webpack?.wreq?.m?.["175203"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Native tile factory unavailable." });
    const source = factory.toString();
    const end = source.indexOf("function eR(");
    const start = end >= 0 ? source.lastIndexOf("return(0,i.", end) : -1;
    const overlayFactory = webpack.wreq.m["802867"];
    const overlaySource = typeof overlayFactory === "function" ? overlayFactory.toString() : "";
    const overlayStart = overlaySource.indexOf("function en(");
    return JSON.stringify({
        probe: "55-original-card-render", sourceView: "original", mutatesNothing: true,
        card: {
            start, end,
            scopeBefore: start >= 0 ? source.slice(Math.max(0, start - 650), start) : null,
            render: start >= 0 && end > start ? source.slice(start, Math.min(end, start + 3300)) : null,
            truncated: start >= 0 && end > start + 3300
        },
        overlay: {
            start: overlayStart,
            source: overlayStart >= 0 ? overlaySource.slice(overlayStart, overlayStart + 1400) : null
        },
        widthHelpers: ["Yb", "VE", "DO"].map(exportName => {
            const value = cache?.["345812"]?.exports?.[exportName];
            return { exportName, type: typeof value, source: typeof value === "function" ? value.toString().slice(0, 240) : null };
        })
    });
})();
