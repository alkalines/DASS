/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const uiSource = factories["157667"]?.toString() || "";
    const imports = Array.from(uiSource.matchAll(/\biW\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const preferenceModuleId = imports.length === 1 ? imports[0][1] : null;
    const targets = [{ moduleId: "400492", role: "host sound API", limit: 3300 }];
    if (preferenceModuleId) targets.push({ moduleId: preferenceModuleId, role: "sound preference header", limit: 1100 });
    return JSON.stringify({
        probe: "34-sound-api-and-preferences",
        sourceView: "original",
        preferenceImportCount: imports.length,
        preferenceModuleId,
        modules: targets.map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, opaque: source.includes("[native code]") };
        })
    });
})();
