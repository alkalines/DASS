/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    if (!element || element.nodeType !== 1 || !element.isConnected)
        return JSON.stringify({ error: "Select a connected call-area element in Elements first." });
    const candidates = [];
    let node = element;
    for (let ancestorIndex = 0; node && ancestorIndex < 6; ancestorIndex++, node = node.parentElement) {
        const bounds = node.getBoundingClientRect();
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        candidates.push({
            ancestorIndex, tag: node.tagName,
            widthPx: Math.round(bounds.width), heightPx: Math.round(bounds.height),
            position: style.position, display: style.display,
            overflowX: style.overflowX, overflowY: style.overflowY,
            connected: node.isConnected
        });
    }
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const factory = webpack?.wreq?.m?.["272812"];
    const source = typeof factory === "function" ? factory.toString() : "";
    return JSON.stringify({
        probe: "47-call-tile-slot", mountsNothing: true,
        candidates,
        frameLoaded: typeof cache?.["272812"]?.exports?.A === "function",
        liveLoaded: typeof cache?.["402216"]?.exports?.Ay === "function",
        frameSource: { sourceLength: source.length, source: source.slice(0, 1100), truncated: source.length > 1100 }
    });
})();
