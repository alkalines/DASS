/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const candidates = [];
    let candidateCount = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        const matches = Array.from(source.matchAll(/\bstream_(?:started|ended)\b/g));
        if (!matches.length) continue;
        candidateCount++;
        if (candidates.length < 6) candidates.push({
            moduleId,
            sourceLength: source.length,
            matchCount: matches.length,
            excerpts: matches.slice(0, 2).map(match => ({
                offset: match.index,
                source: source.slice(Math.max(0, match.index - 90), match.index + 150)
            }))
        });
    }
    const source = factories["157667"]?.toString() || "";
    const offset = source.indexOf('"stream_started"');
    const start = Math.max(0, offset - 2000);
    return JSON.stringify({
        probe: "32-stream-cue-selector",
        sourceView: "original",
        candidateCount,
        candidates,
        selector: { offset, start, source: offset >= 0 ? source.slice(start, offset + 800) : null }
    });
})();
