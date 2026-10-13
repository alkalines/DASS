/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Select the enlarged tile frame with data-call-tile in Elements." });
    const rows = [];
    let visited = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited < 40 && rows.length < 12; fiber = fiber.return) {
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
        if (JSON.stringify([...rows, row]).length > 4000) { clipped = true; break; }
        rows.push(row);
    }
    const streamSource = factories["802867"]?.toString() || "";
    const nameImports = Array.from(streamSource.matchAll(/\bK\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const nameModuleId = nameImports.length === 1 ? nameImports[0][1] : null;
    const targets = [{ moduleId: "812993", role: "text badge primitive", limit: 900 }];
    if (nameModuleId) targets.push({ moduleId: nameModuleId, role: "participant name overlay", limit: 1500 });
    const modules = targets.map(({ moduleId, role, limit }) => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, role, unavailable: true };
        const source = factory.toString();
        return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, opaque: source.includes("[native code]") };
    });
    return JSON.stringify({ probe: "20-focused-layout", rows, visited, clipped, nameImportCount: nameImports.length, modules });
})();
