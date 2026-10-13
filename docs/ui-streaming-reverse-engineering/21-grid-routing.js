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
    const owners = [];
    const layoutFlags = [];
    const seen = new Set();
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 65; fiber = fiber.return) {
        const props = fiber.memoizedProps || {};
        const keys = Object.keys(props);
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function" || seen.has(type)) continue;
        seen.add(type);
        const flags = {};
        for (const key of ["selected", "focused", "idle", "inCall", "noVideoRender", "showParticipants", "forceIdle"]) {
            if (typeof props[key] === "boolean") flags[key] = props[key];
        }
        if (keys.includes("selectedParticipant")) flags.selectedParticipantPresent = props.selectedParticipant != null;
        if (Object.keys(flags).length && layoutFlags.length < 8) layoutFlags.push({ name: String(type.name || "anonymous").slice(0, 60), flags });
        const role = keys.includes("totalNumberOfParticipants") && keys.includes("participants") ? "grid renderer"
            : keys.includes("keyExtractor") && keys.includes("paddingTop") ? "grid layout" : null;
        if (!role || owners.length >= 2) continue;
        const source = Function.prototype.toString.call(type);
        owners.push({ role, sourceLength: source.length, source: source.slice(0, 2100), truncated: source.length > 2100, matchCount: 0, matches: [] });
    }
    for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        for (const owner of owners) {
            if (!source.includes(owner.source.slice(0, 160))) continue;
            owner.matchCount++;
            if (owner.matches.length < 3) owner.matches.push({ moduleId, factoryLength: source.length });
        }
    }
    const badgeSource = factories["812993"]?.toString() || "";
    return JSON.stringify({ probe: "21-grid-routing", layoutFlags, owners, textBadgeTail: { start: 800, sourceLength: badgeSource.length, source: badgeSource.slice(800, 1800), remainingAfterExcerpt: Math.max(0, badgeSource.length - 1800) } });
})();
