/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const factories = webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable. Nothing changed." });
    const targets = [
        { role: "share entry awaiting desktop source", marker: "getDesktopSource(", radius: 1100 },
        { role: "desktop input pool", marker: "DesktopInputPool", radius: 1500 },
        { role: "browser capture callers, including unrelated uses", marker: "getDisplayMedia", radius: 1100 },
        { role: "native stream start dispatcher/consumers", marker: '"STREAM_START"', radius: 1000 },
        { role: "preview producer", marker: "ApplicationStreamPreviewUploadManager", radius: 1500 }
    ].map(target => ({ ...target, candidateCount: 0, candidates: [] }));
    let readableFactories = 0;
    let opaqueFactories = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        let source;
        try {
            source = factory.toString();
        } catch {
            opaqueFactories++;
            continue;
        }
        if (source.includes("[native code]")) {
            opaqueFactories++;
            continue;
        }
        readableFactories++;
        for (const target of targets) {
            const offset = source.indexOf(target.marker);
            if (offset < 0) continue;
            target.candidateCount++;
            if (target.candidates.length >= 3) continue;
            const start = Math.max(0, offset - target.radius);
            const end = Math.min(source.length, offset + target.marker.length + target.radius);
            target.candidates.push({
                moduleId, sourceLength: source.length, offset,
                header: source.slice(0, Math.min(650, start)),
                excerptStart: start, excerptEnd: end,
                excerpt: source.slice(start, end),
                completeFactory: start === 0 && end === source.length
            });
        }
    }
    return JSON.stringify({
        probe: "64-capture-start-boundaries", mutatesNothing: true,
        sourceView: "Equicord-exposed original factory source, not proof of effective patches or execution order",
        readableFactories, opaqueFactories,
        targets: targets.map(({ role, marker, candidateCount, candidates }) => ({
            role, marker, candidateCount, candidates,
            candidateListTruncated: candidateCount > candidates.length
        }))
    });
})();
