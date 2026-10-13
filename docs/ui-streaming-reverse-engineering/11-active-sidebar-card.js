/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Select the Go live title in the active sidebar card." });
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 30 && rows.length < 10; fiber = fiber.return) {
        visited++;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        const row = {
            depth: visited - 1,
            name: String(type.displayName || type.name || "anonymous").slice(0, 80),
            props: Object.keys(fiber.memoizedProps || {}).slice(0, 28),
            sourceLength: source.length,
            prefix: source.slice(0, 220)
        };
        if (JSON.stringify([...rows, row]).length > 4000) { clipped = true; break; }
        rows.push(row);
    }
    const modules = ["447404", "246356"].map(moduleId => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, unavailable: true };
        const source = factory.toString();
        return { moduleId, sourceLength: source.length, source: source.slice(0, 1200), truncated: source.length > 1200, opaque: source.includes("[native code]") };
    });
    return JSON.stringify({ probe: "11-active-sidebar-card", rows, visited, clipped, modules });
})();
