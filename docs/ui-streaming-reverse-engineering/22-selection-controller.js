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
    const handlers = [];
    const candidates = [];
    const seen = new Set();
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function" || seen.has(type)) continue;
        seen.add(type);
        const props = Object.keys(fiber.memoizedProps || {});
        const source = Function.prototype.toString.call(type);
        const offsets = ["handleSelectParticipant=", "handleSelectParticipant(", "handleParticipantClick="].map(anchor => ({ anchor, offset: source.indexOf(anchor) })).filter(item => item.offset >= 0);
        if (offsets.length && handlers.length < 2) {
            const { anchor, offset } = offsets[0];
            handlers.push({
                name: String(type.name || "anonymous").slice(0, 60),
                props: props.slice(0, 24),
                sourceLength: source.length,
                head: source.slice(0, 200),
                anchor,
                offset,
                excerpt: source.slice(Math.max(0, offset - 80), offset + 1800),
                matchCount: 0,
                matches: []
            });
        } else if (props.includes("selectedParticipant") && candidates.length < 4) candidates.push({
            name: String(type.name || "anonymous").slice(0, 60),
            props: props.slice(0, 24),
            sourceLength: source.length,
            prefix: source.slice(0, 180)
        });
    }
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        for (const handler of handlers) {
            if (!source.includes(handler.head.slice(0, 160))) continue;
            handler.matchCount++;
            if (handler.matches.length < 3) handler.matches.push({ moduleId, factoryLength: source.length });
        }
    }
    return JSON.stringify({ probe: "22-selection-controller", handlers, candidates });
})();
