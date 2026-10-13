/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["463481"];
    if (!fiberKey || typeof factory !== "function") return JSON.stringify({ error: "Select the active sidebar card stop button, without clicking it." });
    const original = factory.toString();
    const aliases = ["eq", "eQ", "th", "I", "eM", "nm", "e6"];
    const imports = aliases.map(alias => {
        const matches = Array.from(original.matchAll(new RegExp("\\b" + alias + "\\s*=\\s*([\\w$]+)\\(\\s*(\\d+)\\s*\\)", "g")));
        return { alias, count: matches.length, moduleIds: matches.slice(0, 3).map(match => match[2]) };
    });
    let actionOwner = null;
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 26; fiber = fiber.return) {
        const props = Object.keys(fiber.memoizedProps || {});
        if (!props.includes("stream") || !props.includes("canGoLive") || !props.includes("isStreaming")) continue;
        const wrapper = fiber.type;
        const type = typeof wrapper === "function" ? wrapper : wrapper?.render ?? wrapper?.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        actionOwner = {
            name: String(type.name || "anonymous").slice(0, 80),
            props: props.slice(0, 28),
            sourceLength: source.length,
            source: source.slice(0, 2600),
            truncated: source.length > 2600,
            originalFactoryContainsPrefix: original.includes(source.slice(0, 180))
        };
        break;
    }
    return JSON.stringify({ probe: "13-sidebar-card-actions", imports, actionOwner });
})();
