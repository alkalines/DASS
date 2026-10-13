/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const source = factories["157667"]?.toString() || "";
    const imports = Array.from(source.matchAll(/\bb9\s*=\s*([\w$]+)\(\s*(\d+)\s*\)/g));
    const moduleId = imports.length === 1 ? imports[0][2] : null;
    const factory = moduleId && factories[moduleId];
    const helperSource = typeof factory === "function" ? factory.toString() : "";
    const locals = imports.length ? [] : Array.from(source.matchAll(/function\s+b9\s*\(|\bb9\s*=/g));
    return JSON.stringify({
        probe: "33-stream-cue-playback",
        sourceView: "original",
        importCount: imports.length,
        imports: imports.slice(0, 3).map(match => ({ moduleId: match[2], declaration: match[0] })),
        helper: { moduleId, sourceLength: helperSource.length, source: helperSource.slice(0, 3200), truncated: helperSource.length > 3200, unavailable: !helperSource },
        localBindingCount: locals.length,
        localBinding: locals.length ? { offset: locals[0].index, source: source.slice(Math.max(0, locals[0].index - 100), locals[0].index + 2700) } : null
    });
})();
