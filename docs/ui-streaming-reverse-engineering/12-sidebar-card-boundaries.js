/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the Go Live title selected." });
    const targets = [];
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 24 && targets.length < 2; fiber = fiber.return) {
        const props = Object.keys(fiber.memoizedProps || {});
        const role = props.includes("streamMetadata") && props.includes("streamQualityIndicator") ? "metadata body"
            : props.includes("guildId") && props.includes("analyticsContext") ? "connected owner" : null;
        if (!role) continue;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        targets.push({
            role,
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 24),
            sourceLength: source.length,
            head: source.slice(0, role === "metadata body" ? 900 : 1100),
            tail: role === "connected owner" ? source.slice(-1900) : null,
            tailOffset: role === "connected owner" ? Math.max(0, source.length - 1900) : null,
            complete: source.length <= (role === "metadata body" ? 900 : 1100),
            matchCount: 0,
            matches: []
        });
    }
    let opaqueFactories = 0;
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (source.includes("[native code]")) { opaqueFactories++; continue; }
        for (const target of targets) {
            if (!source.includes(target.head.slice(0, 180))) continue;
            target.matchCount++;
            if (target.matches.length < 3) target.matches.push({ moduleId, factoryLength: source.length });
        }
    }
    return JSON.stringify({ probe: "12-sidebar-card-boundaries", factorySourceView: "original", opaqueFactories, targets });
})();
