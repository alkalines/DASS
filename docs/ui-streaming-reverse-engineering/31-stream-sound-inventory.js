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
    let opaqueFactories = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (source.includes("[native code]")) { opaqueFactories++; continue; }
        const matches = Array.from(source.matchAll(/\bstream_(?:started|ended|start|stop)\b|\bSTREAM_(?:STARTED|ENDED|START|STOP)\b/g));
        if (!matches.length) continue;
        candidateCount++;
        if (candidates.length >= 6) continue;
        candidates.push({
            moduleId,
            sourceLength: source.length,
            matchCount: matches.length,
            names: [...new Set(matches.map(match => match[0]))],
            excerpts: matches.slice(0, 2).map(match => ({
                offset: match.index,
                source: source.slice(Math.max(0, match.index - 140), match.index + 190)
            }))
        });
    }
    return JSON.stringify({ probe: "31-stream-sound-inventory", sourceView: "original", candidateCount, opaqueFactories, candidates });
})();
