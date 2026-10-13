/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    if (!element?.isConnected || !fiberKey)
        return JSON.stringify({ error: "Select a connected native participant tile first." });
    let controller = null;
    const owners = [];
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        for (let wrappers = 0; type && typeof type === "object" && wrappers < 3; wrappers++)
            type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const keys = Object.keys(fiber.memoizedProps || {});
        if (owners.length < 6 && (keys.includes("keyExtractor") || keys.includes("selectedParticipant") || keys.includes("renderItem")))
            owners.push({ name: String(type.name || "anonymous").slice(0, 60), propKeys: keys.slice(0, 28) });
        if (controller || !type.toString().includes("handleSelectParticipant=")) continue;
        const instance = fiber.stateNode;
        const render = instance?.render;
        const renderSource = typeof render === "function" ? render.toString() : "";
        const own = instance && Object.getOwnPropertyDescriptor(instance, "render");
        controller = {
            foundInstance: !!instance, extensible: instance ? Object.isExtensible(instance) : false,
            ownsRender: !!own, ownRenderConfigurable: own?.configurable ?? null,
            hasForceUpdate: typeof instance?.forceUpdate === "function",
            renderSourceLength: renderSource.length, renderSource: renderSource.slice(0, 3200),
            truncated: renderSource.length > 3200
        };
    }
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["511205"];
    const gridSource = typeof factory === "function" ? factory.toString() : "";
    return JSON.stringify({
        probe: "49-call-render-boundary", mutatesNothing: true, controller, owners,
        nativeGrid: { sourceLength: gridSource.length, source: gridSource.slice(0, 1600), truncated: gridSource.length > 1600 }
    });
})();
