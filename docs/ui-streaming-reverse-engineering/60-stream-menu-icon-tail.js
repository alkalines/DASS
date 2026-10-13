/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const factories = webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories unavailable." });
    const cache = webpack.cache || webpack.wreq.c;
    const menu = factories["744960"]?.toString() || "";
    const popout = factories["810845"]?.toString() || "";
    return JSON.stringify({
        probe: "60-stream-menu-icon-tail", mutatesNothing: true,
        menuTail: { start: 3150, sourceLength: menu.length, source: menu.slice(3150, 4450) },
        popoutHelper: { sourceLength: popout.length, source: popout.slice(0, 1800), truncated: popout.length > 1800 },
        verifiedIconExports: {
            stop: typeof cache?.["959988"]?.exports?.G,
            change: typeof cache?.["183623"]?.exports?.F
        }
    });
})();
