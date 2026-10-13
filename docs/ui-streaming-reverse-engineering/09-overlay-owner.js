/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the overlay share button selected." });
    const shareFactory = factories["958449"];
    const shareSource = typeof shareFactory === "function" ? shareFactory.toString() : "";
    let owner = null;
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 36; fiber = fiber.return) {
        const props = Object.keys(fiber.memoizedProps || {});
        if (!props.includes("channel") || !props.includes("currentUser") || !props.includes("canGoLive")) continue;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        owner = {
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 24),
            sourceLength: source.length,
            source: source.slice(0, 2200),
            truncated: source.length > 2200,
            matchCount: 0,
            matches: []
        };
        break;
    }
    if (owner) for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (!source.includes(owner.source.slice(0, 180))) continue;
        owner.matchCount++;
        if (owner.matches.length < 3) owner.matches.push({
            moduleId,
            factoryLength: source.length,
            containsCompleteFunction: !owner.truncated && source.includes(owner.source)
        });
    }
    return JSON.stringify({
        probe: "09-overlay-owner",
        shareFactory: { sourceLength: shareSource.length, source: shareSource.slice(0, 1000), truncated: shareSource.length > 1000 },
        owner
    });
})();
