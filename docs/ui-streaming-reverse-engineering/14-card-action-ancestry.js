/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the sidebar card stop button selected, without clicking it." });
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 30 && rows.length < 10; fiber = fiber.return) {
        visited++;
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        const row = {
            depth: visited - 1,
            name: String(type.displayName || type.name || "anonymous").slice(0, 80),
            props: Object.keys(fiber.memoizedProps || {}).slice(0, 28),
            sourceLength: source.length,
            prefix: source.slice(0, 180)
        };
        if (JSON.stringify([...rows, row]).length > 3500) { clipped = true; break; }
        rows.push(row);
    }
    const targets = [
        { moduleId: "277680", role: "title helper", limit: 1200 },
        { moduleId: "118277", role: "title and icon", limit: 1800 },
        { moduleId: "485599", role: "title text", limit: 450 }
    ];
    const modules = targets.map(({ moduleId, role, limit }) => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, role, unavailable: true };
        const source = factory.toString();
        return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, opaque: source.includes("[native code]") };
    });
    return JSON.stringify({ probe: "14-card-action-ancestry", selectedTag: element.tagName, rows, visited, clipped, modules });
})();
