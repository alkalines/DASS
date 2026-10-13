/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the call-tile LIVE badge selected." });
    const components = [];
    const seen = new Set();
    let visited = 0;
    let ownerCount = 0;
    let clipped = false;
    for (let fiber = element[fiberKey]; fiber && visited++ < 55; fiber = fiber.return) {
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function" || seen.has(type)) continue;
        seen.add(type);
        const props = Object.keys(fiber.memoizedProps || {});
        const source = Function.prototype.toString.call(type);
        const role = props.includes("showQuality") && props.includes("participant") ? "quality badge"
            : props.includes("idle") && props.includes("premiumIndicator") && props.includes("participant") ? "connected tile overlay"
            : props.includes("participantUserId") && props.includes("noBorder") ? "tile frame"
            : props.includes("participant") && source.length > 1500 && ownerCount < 2 ? "participant owner" : null;
        if (!role) continue;
        const isOwner = role === "participant owner";
        if (isOwner) ownerCount++;
        const component = {
            role,
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 26),
            sourceLength: source.length,
            head: source.slice(0, isOwner ? 500 : 1000),
            tail: isOwner ? source.slice(-500) : null,
            complete: source.length <= (isOwner ? 500 : 1000),
            matchCount: 0,
            matches: []
        };
        if (components.length >= 6 || JSON.stringify([...components, component]).length > 4600) { clipped = true; break; }
        components.push(component);
    }
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        for (const component of components) {
            if (!source.includes(component.head.slice(0, 160))) continue;
            component.matchCount++;
            if (component.matches.length < 3) component.matches.push({ moduleId, factoryLength: source.length });
        }
    }
    const cardSource = factories["463481"]?.toString() || "";
    const buttonImports = Array.from(cardSource.matchAll(/\btM\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const buttonModuleId = buttonImports.length === 1 ? buttonImports[0][1] : null;
    const buttonFactory = buttonModuleId && factories[buttonModuleId];
    const buttonSource = typeof buttonFactory === "function" ? buttonFactory.toString() : "";
    return JSON.stringify({
        probe: "17-tile-boundaries",
        factorySourceView: "original",
        clipped,
        components,
        cardButton: { importCount: buttonImports.length, moduleId: buttonModuleId, sourceLength: buttonSource.length, source: buttonSource.slice(0, 1200), truncated: buttonSource.length > 1200 }
    });
})();
