/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Select the sidebar share button; webpack factories must be available." });
    const owners = [];
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 24 && owners.length < 2; fiber = fiber.return) {
        const keys = Object.keys(fiber.memoizedProps || {});
        if (!keys.includes("channel") || !keys.includes("canGoLive")) continue;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        owners.push({
            name: String(type.name || "anonymous").slice(0, 80),
            props: keys.slice(0, 24),
            sourceLength: source.length,
            source: source.slice(0, 2200),
            truncated: source.length > 2200,
            factoryMatches: [],
            matchCount: 0
        });
    }
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = Function.prototype.toString.call(factory);
        for (const owner of owners) {
            if (!source.includes(owner.source.slice(0, 180))) continue;
            owner.matchCount++;
            if (owner.factoryMatches.length < 4) owner.factoryMatches.push({
                moduleId,
                factoryLength: source.length,
                containsCompleteFunction: !owner.truncated && source.includes(owner.source)
            });
        }
    }
    return JSON.stringify({ probe: "02-sidebar-owners", owners });
})();
