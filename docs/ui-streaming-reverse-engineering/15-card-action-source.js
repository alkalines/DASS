/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["463481"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Sidebar card factory is unavailable." });
    const source = factory.toString();
    const matches = Array.from(source.matchAll(/canGoLiveActivity:/g));
    return JSON.stringify({
        probe: "15-card-action-source",
        sourceView: "Equicord-exposed original factory source",
        sourceLength: source.length,
        opaque: source.includes("[native code]"),
        matchCount: matches.length,
        windows: matches.slice(0, 3).map(match => {
            const start = Math.max(0, match.index - 220);
            const end = Math.min(source.length, match.index + 1800);
            return { anchorOffset: match.index, start, end, source: source.slice(start, end) };
        })
    });
})();
