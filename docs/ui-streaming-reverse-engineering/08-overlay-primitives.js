/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the overlay share button selected; webpack must be available." });
    const components = [];
    const parents = [];
    const seen = new Set();
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 36; fiber = fiber.return) {
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function" || seen.has(type)) continue;
        seen.add(type);
        const props = Object.keys(fiber.memoizedProps || {});
        const source = Function.prototype.toString.call(type);
        const role = props.includes("streamActive") && props.includes("hasPermission") ? "share control"
            : props.includes("iconComponent") && props.includes("label") ? "button primitive"
            : source.includes('"interact-hover"') && source.includes('"interact-focus"') ? "idle wrapper" : null;
        if (role && components.length < 4) components.push({
            role,
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 28),
            sourceLength: source.length,
            source: source.slice(0, 1200),
            truncated: source.length > 1200,
            matches: [],
            matchCount: 0
        });
        else if (parents.length < 2 && (props.includes("channel") || props.includes("onGoLive"))) parents.push({
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 24),
            sourceLength: source.length,
            prefix: source.slice(0, 180)
        });
    }
    let opaqueFactories = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (source.includes("[native code]")) { opaqueFactories++; continue; }
        for (const component of components) {
            if (!source.includes(component.source.slice(0, 180))) continue;
            component.matchCount++;
            if (component.matches.length < 3) component.matches.push({
                moduleId,
                factoryLength: source.length,
                containsCompleteFunction: !component.truncated && source.includes(component.source)
            });
        }
    }
    return JSON.stringify({ probe: "08-overlay-primitives", factorySourceView: "original", opaqueFactories, components, parents });
})();
