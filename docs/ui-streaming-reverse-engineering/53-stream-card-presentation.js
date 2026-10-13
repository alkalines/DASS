/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    let component = cache?.["175203"]?.exports?.Ay;
    for (let depth = 0; component && typeof component === "object" && depth < 4; depth++)
        component = component.render ?? component.type;
    if (typeof component !== "function")
        return JSON.stringify({ error: "Loaded native tile component is unavailable." });
    const source = component.toString();
    const factory = webpack?.wreq?.m?.["175203"];
    const factorySource = typeof factory === "function" ? factory.toString() : "";
    const tailStart = Math.max(0, source.length - 3200);
    return JSON.stringify({
        probe: "53-stream-card-presentation", mutatesNothing: true,
        nativeTile: {
            sourceLength: source.length,
            prefix: source.slice(0, 600),
            tailStart, renderTail: source.slice(tailStart)
        },
        dependencyHeader: {
            sourceView: "original", sourceLength: factorySource.length,
            source: factorySource.slice(0, 1600)
        }
    });
})();
