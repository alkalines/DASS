/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const tileSource = factories["175203"]?.toString() || "";
    const selectionSource = factories["367513"]?.toString() || "";
    const matches = Array.from(selectionSource.matchAll(/selectParticipant/g));
    const iconControlOffset = tileSource.indexOf("function eL(");
    return JSON.stringify({
        probe: "26-footer-render-and-selection",
        sourceView: "original",
        footer: { sourceLength: tileSource.length, start: 9200, source: tileSource.slice(9200, 12100), remainingAfterExcerpt: Math.max(0, tileSource.length - 12100) },
        iconControl: { offset: iconControlOffset, source: iconControlOffset >= 0 ? tileSource.slice(iconControlOffset, iconControlOffset + 600) : null },
        selection: {
            sourceLength: selectionSource.length,
            header: selectionSource.slice(0, 250),
            matchCount: matches.length,
            windows: matches.slice(0, 2).map(match => ({
                offset: match.index,
                source: selectionSource.slice(Math.max(0, match.index - 80), match.index + 1100)
            }))
        }
    });
})();
