/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Equicord webpack factories are unavailable." });
    const modules = ["526369", "699707"].map(moduleId => {
        const factory = factories[moduleId];
        if (typeof factory !== "function") return { moduleId, unavailable: true };
        const source = Function.prototype.toString.call(factory);
        return { moduleId, sourceLength: source.length, source: source.slice(0, 24_000), truncated: source.length > 24_000 };
    });
    return JSON.stringify({ kind: "DASS native grid placement boundaries, build 634304 references", modules }, null, 2);
})();
