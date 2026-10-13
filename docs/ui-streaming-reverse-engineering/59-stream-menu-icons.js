/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    const factory = factories["744960"];
    const source = typeof factory === "function" ? factory.toString() : "";
    const actionFactory = factories["405916"];
    const actionSource = typeof actionFactory === "function" ? actionFactory.toString() : "";
    return JSON.stringify({
        probe: "59-stream-menu-icons", mutatesNothing: true,
        streamMenu: { available: !!source, sourceLength: source.length, source: source.slice(0, 3200), truncated: source.length > 3200 },
        selfActions: ["stop-streaming", "change-windows"].map(id => {
            const offset = actionSource.indexOf(`id:"${id}"`);
            return { id, offset, source: offset >= 0 ? actionSource.slice(Math.max(0, offset - 50), offset + 360) : null };
        }),
        selfActionImports: actionSource.slice(0, 800)
    });
})();
