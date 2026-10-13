/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const rootSource = factories["874739"]?.toString() || "";
    const imports = Array.from(rootSource.matchAll(/\bA\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const focusedModuleId = imports.length === 1 ? imports[0][1] : null;
    const targets = [
        { moduleId: "20504", role: "callback-driven speaker widget", limit: 3500 },
        { moduleId: "824744", role: "volume conversion", limit: 650 }
    ];
    if (focusedModuleId) targets.push({ moduleId: focusedModuleId, role: "focused layout header", limit: 1100 });
    return JSON.stringify({
        probe: "28-speaker-and-focused-imports",
        sourceView: "original",
        focusedImportCount: imports.length,
        modules: targets.map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, opaque: source.includes("[native code]") };
        })
    });
})();
