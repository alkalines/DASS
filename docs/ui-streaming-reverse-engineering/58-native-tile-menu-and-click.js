/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    if (!cache) return JSON.stringify({ error: "Loaded webpack modules unavailable." });
    const common = webpack.Common;
    let clickable = cache["890856"]?.exports?.s;
    for (let depth = 0; clickable && typeof clickable === "object" && depth < 4; depth++) clickable = clickable.render ?? clickable.type;
    const clickableSource = typeof clickable === "function" ? clickable.toString() : "";
    const controllerFactory = webpack.wreq?.m?.["540462"];
    const controllerSource = typeof controllerFactory === "function" ? controllerFactory.toString() : "";
    const anchors = ["handleContextMenu=", "handleFullscreenParticipant="];
    return JSON.stringify({
        probe: "58-native-tile-menu-and-click", mutatesNothing: true,
        menu: Object.fromEntries(["Menu","MenuItem","MenuGroup","MenuCheckboxItem","MenuSeparator"].map(name => [name, typeof common?.Menu?.[name]])),
        contextMenuApi: { open: typeof common?.ContextMenuApi?.openContextMenu, close: typeof common?.ContextMenuApi?.closeContextMenu },
        clickable: { sourceLength: clickableSource.length, source: clickableSource.slice(0, 2100), truncated: clickableSource.length > 2100 },
        controller: anchors.map(anchor => {
            const offset = controllerSource.indexOf(anchor);
            return { anchor, offset, source: offset >= 0 ? controllerSource.slice(offset, offset + 1400) : null };
        })
    });
})();
