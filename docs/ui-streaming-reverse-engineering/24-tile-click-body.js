/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the call tile frame selected." });
    let tile = null;
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 40; fiber = fiber.return) {
        const props = fiber.memoizedProps || {};
        const keys = Object.keys(props);
        if (!keys.includes("participant") || !keys.includes("channel") || !keys.includes("onClick")) continue;
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        if (source.length < 4000) continue;
        const callbackSource = typeof props.onClick === "function" ? Function.prototype.toString.call(props.onClick) : "";
        tile = {
            sourceLength: source.length,
            source: source.slice(0, 5600),
            truncated: source.length > 5600,
            clickCallback: { sourceLength: callbackSource.length, source: callbackSource.slice(0, 800), truncated: callbackSource.length > 800 }
        };
        break;
    }
    const gridSource = factories["526369"]?.toString() || "";
    const imports = Array.from(gridSource.matchAll(/\bI\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const moduleId = imports.length === 1 ? imports[0][1] : null;
    const factory = moduleId && factories[moduleId];
    const originalSource = typeof factory === "function" ? factory.toString() : "";
    return JSON.stringify({
        probe: "24-tile-click-body",
        tile,
        originalTileImport: { importCount: imports.length, moduleId, factoryLength: originalSource.length, header: originalSource.slice(0, 180) }
    });
})();
