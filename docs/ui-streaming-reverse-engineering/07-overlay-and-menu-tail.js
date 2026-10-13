/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    if (!fiberKey) return JSON.stringify({ error: "Select the call-overlay share button in Elements first." });
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["405916"];
    const source = typeof factory === "function" ? factory.toString() : "";
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 28 && rows.length < 10; fiber = fiber.return) {
        visited++;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const code = Function.prototype.toString.call(type);
        const row = {
            depth: visited - 1,
            name: String(type.displayName || type.name || "anonymous").slice(0, 80),
            props: Object.keys(fiber.memoizedProps || {}).slice(0, 28),
            sourceLength: code.length,
            prefix: code.slice(0, 200)
        };
        if (JSON.stringify([...rows, row]).length > 4500) {
            clipped = true;
            break;
        }
        rows.push(row);
    }
    return JSON.stringify({
        probe: "07-overlay-and-menu-tail",
        menuTail: {
            sourceView: "Equicord-exposed original factory source",
            sourceLength: source.length,
            offset: 4000,
            source: source.slice(4000, 5500),
            truncated: source.length > 5500,
            unavailable: !source,
            opaque: source.includes("[native code]")
        },
        overlay: { selectedTag: element.tagName, visited, clipped, rows }
    });
})();
