/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["946261"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Host sound object factory is unavailable." });
    const source = factory.toString();
    return JSON.stringify({ probe: "36-sound-object-complete", sourceView: "original", sourceLength: source.length, source: source.slice(0, 3100), truncated: source.length > 3100, opaque: source.includes("[native code]") });
})();
