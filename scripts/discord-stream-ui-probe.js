/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Equicord webpack factories are unavailable." });
    const modules = ["321486", "711589"].map(moduleId => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, unavailable: true };
        const source = Function.prototype.toString.call(factory);
        return { moduleId, sourceLength: source.length, source: source.slice(0, 16_000), truncated: source.length > 16_000 };
    });
    const badgePlacements = [];
    const callRenderers = [];
    let remainingSourceCharacters = 64_000 - modules.reduce((total, module) => total + (module.source?.length ?? 0), 0);
    const sources = Object.entries(factories).filter(([, factory]) => typeof factory === "function")
        .map(([moduleId, factory]) => ({ moduleId, source: Function.prototype.toString.call(factory) }))
        .sort((a, b) => a.source.length - b.source.length);
    const badgeImports = /([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(["']?402216["']?\)/g;
    const streamAnchors = ["getAllActiveStreamsForChannel(", "getAllActiveStreams(", "getStreamForUser(", "getActiveStreamForUser(", "selfStream:", "STREAM_TILE", "streamTile"];
    for (const { moduleId, source } of sources) {
        if (badgePlacements.length < 10 && remainingSourceCharacters >= 1_000) {
            for (const imported of source.matchAll(badgeImports)) {
                const alias = imported[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const use = new RegExp(`\\(0,[A-Za-z_$][\\w$]*\\.(?:jsx|jsxs)\\)\\(${alias}\\.Ay,`).exec(source);
                if (!use) continue;
                const offset = source.length <= 6_000 ? 0 : Math.max(0, use.index - 1_200);
                const excerpt = source.slice(offset, offset + Math.min(6_000, remainingSourceCharacters));
                remainingSourceCharacters -= excerpt.length;
                badgePlacements.push({ moduleId, sourceLength: source.length, offset, source: excerpt, truncated: offset > 0 || excerpt.length < source.length });
                break;
            }
        }
        if (callRenderers.length === 10 || remainingSourceCharacters < 1_000 || !source.includes(".jsx") || ["130553", "616356", "401843", "35903", "487048"].includes(moduleId)) continue;
        const anchors = streamAnchors.filter(anchor => source.includes(anchor));
        if (!anchors.length) continue;
        const at = Math.min(...anchors.map(anchor => source.indexOf(anchor)));
        const offset = source.length <= 6_000 ? 0 : Math.max(0, at - 1_200);
        const excerpt = source.slice(offset, offset + Math.min(6_000, remainingSourceCharacters));
        remainingSourceCharacters -= excerpt.length;
        callRenderers.push({ moduleId, anchors, sourceLength: source.length, offset, source: excerpt, truncated: offset > 0 || excerpt.length < source.length });
    }
    return JSON.stringify({ kind: "DASS native stream presentation graph, build 634304 references", modules, badgePlacements, callRenderers,
        sourceCharacterLimit: 64_000, sourceLimitReached: remainingSourceCharacters < 1_000 }, null, 2);
})();
