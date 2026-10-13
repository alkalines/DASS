/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["463481"];
    if (!fiberKey || typeof factory !== "function") return JSON.stringify({ error: "Select the LIVE badge on your call stream tile." });
    const source = factory.toString();
    const imports = ["tz", "ef", "tI", "tQ"].map(alias => {
        const matches = Array.from(source.matchAll(new RegExp("\\b" + alias + "\\s*=\\s*([\\w$]+)\\(\\s*(\\d+)\\s*\\)", "g")));
        return { alias, count: matches.length, moduleIds: matches.slice(0, 3).map(match => match[2]) };
    });
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 38 && rows.length < 12; fiber = fiber.return) {
        visited++;
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const code = Function.prototype.toString.call(type);
        const row = {
            depth: visited - 1,
            name: String(type.displayName || type.name || "anonymous").slice(0, 80),
            props: Object.keys(fiber.memoizedProps || {}).slice(0, 26),
            sourceLength: code.length,
            prefix: code.slice(0, 180)
        };
        if (JSON.stringify([...rows, row]).length > 3500) { clipped = true; break; }
        rows.push(row);
    }
    return JSON.stringify({
        probe: "16-call-tile-and-card-tail",
        cardActions: { sourceView: "original", start: 13600, end: Math.min(16600, source.length), source: source.slice(13600, 16600), imports },
        tile: { selectedTag: element.tagName, rows, visited, clipped }
    });
})();
