/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    if (!element) return JSON.stringify({ error: "Select the share button in Elements first." });
    const fiberKey = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    if (!fiberKey) return JSON.stringify({ error: "No React fiber on selection. Select the button or its SVG child." });
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 24 && rows.length < 10; fiber = fiber.return) {
        visited++;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        const row = {
            depth: visited - 1,
            name: String(type.displayName || type.name || "anonymous").slice(0, 80),
            props: Object.keys(fiber.memoizedProps || {}).slice(0, 32),
            sourceLength: source.length,
            prefix: source.slice(0, 220)
        };
        if (JSON.stringify([...rows, row]).length > 5400) {
            clipped = true;
            break;
        }
        rows.push(row);
    }
    return JSON.stringify({
        probe: "01-selected-component",
        selectedTag: element.tagName,
        webpackFactoriesAvailable: !!globalThis.Vencord?.Webpack?.wreq?.m,
        visited,
        clipped,
        rows
    });
})();
