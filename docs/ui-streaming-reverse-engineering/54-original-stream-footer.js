/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["175203"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Native tile factory unavailable." });
    const source = factory.toString();
    const bindings = Array.from(source.matchAll(/\bew\s*=\s*[\w$]+\.memo\s*\(/g));
    const start = bindings.length === 1 ? bindings[0].index : -1;
    const helpers = ["function eL(", "function eR("];
    return JSON.stringify({
        probe: "54-original-stream-footer", sourceView: "original", mutatesNothing: true,
        footerBindingCount: bindings.length,
        footer: {
            start, sourceLength: source.length,
            source: start >= 0 ? source.slice(start, start + 4800) : null,
            truncated: start >= 0 && source.length > start + 4800
        },
        helpers: helpers.map(anchor => {
            const offset = source.indexOf(anchor);
            return { anchor, offset, source: offset >= 0 ? source.slice(offset, offset + 700) : null };
        })
    });
})();
