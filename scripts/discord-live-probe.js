/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Equicord webpack factories are unavailable." });
    const anchors = [
        "getAllApplicationStreamsForChannel",
        "getAllActiveStreamsForChannel",
        "ApplicationStreamPreviewStore",
        "STREAM_WATCH",
        "streamKey:",
        "videoStream:",
        "srcObject",
        "WATCH_STREAM",
        "LIVE_BADGE",
        "streamActive:",
        "ApplicationStreamStore"
    ];
    const results = [];
    const sidebar = [];
    const streamLists = [];
    // Do not retry at every character inside a long identifier on a failed match.
    const sidebarCallback = /(?<![\w$])[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.useCallback\(\(\)=>\{\(0,[A-Za-z_$][\w$]*\.A\)\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.id,[A-Za-z_$][\w$]*\)\},\[[^\]]{1,150}\]\),[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.find\([A-Za-z_$][\w$]*=>[A-Za-z_$][\w$]*\.ownerId===/;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = Function.prototype.toString.call(factory);
        const callback = sidebarCallback.exec(source);
        if (callback && sidebar.length < 2) {
            const offset = Math.max(0, callback.index - 150);
            sidebar.push({ moduleId, offset, source: source.slice(offset, offset + 8_000) });
        }
        if (source.includes("getAllApplicationStreamsForChannel") && !source.includes("ApplicationStreamStore") && streamLists.length < 3) {
            streamLists.push({ moduleId, source: source.slice(0, 12_000), truncated: source.length > 12_000 });
        }
        const matches = anchors.filter(anchor => source.includes(anchor));
        if (!matches.length) continue;
        if (results.length < 100) results.push({ moduleId, sourceLength: source.length, anchors: matches });
    }
    return JSON.stringify({ kind: "DASS read-only live UI source inventory", results, sidebar, streamLists, limit: 100 }, null, 2);
})();
