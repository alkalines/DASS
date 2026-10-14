/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_NORMAL_CARD_TEST__";
    if (globalThis[key]) return "Normal-card test already prepared. Remove it before repeating.";
    const webpack = Vencord.Webpack;
    const cache = webpack.cache || webpack.wreq.c;
    const source = webpack.wreq.m["175203"].toString();
    const requireName = source.match(/^175203\([\w$]+,[\w$]+,([\w$]+)\)\{/)?.[1];
    const bindings = [...source.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g)];
    const alias = id => {
        const matches = bindings.filter(match => match[2] === String(id));
        return matches.length === 1 ? matches[0][1] : null;
    };
    if (!requireName || alias(477900) !== "t" || alias(582128) !== "i" ||
        alias(806931) !== "eR" || alias(345812) !== "eS" || alias(17928) !== "r" || alias(141035) !== "ej")
        return "Current reviewed tile profile changed. Nothing prepared.";
    const importsStart = source.indexOf(`var t=${requireName}(`);
    const importsEnd = source.indexOf(";let ", importsStart);
    const helperStart = source.search(/function\s+[\w$]+\([\w$]+\)\{let\{participantType:/);
    const controlStart = source.search(/function\s+[\w$]+\([\w$]+\)\{let\{icon:/);
    const helpersEnd = source.indexOf("function ", controlStart + 10);
    const renderStart = source.lastIndexOf("return(0,t.", helperStart);
    const label = source.match(/\bew\.displayName=["']CallTileOverlay["']/);
    const footerStart = source.indexOf("ew=i.memo(");
    if (importsStart < 0 || importsEnd <= importsStart || helperStart < 0 || controlStart <= helperStart ||
        helpersEnd <= controlStart || renderStart < 0 || footerStart < 0 || !label || label.index <= footerStart)
        return "Reviewed render/footer/helper boundaries changed. Nothing prepared.";
    const render = source.slice(renderStart, helperStart).trim();
    if (!render.endsWith("});") || render.length > 2100) return "Reviewed render body changed.";
    const playerSource = webpack.wreq.m["802867"].toString();
    const overlayStart = playerSource.indexOf("function en(");
    const overlayEnd = playerSource.indexOf("function ei(", overlayStart);
    if (overlayStart < 0 || overlayEnd <= overlayStart || overlayEnd - overlayStart !== 453)
        return "Reviewed overlay changed. Nothing prepared.";
    const parts = {
        marker: "dass-normal-card-v1", React: webpack.Common.React, cache, requireName,
        imports: source.slice(importsStart, importsEnd + 1),
        helpers: source.slice(helperStart, helpersEnd),
        footer: source.slice(footerStart, label.index).trim(),
        render: render.slice(0, -3) + ";",
        overlay: playerSource.slice(overlayStart, overlayEnd), playerSource,
        cleanup() { if (globalThis[key] === parts) delete globalThis[key]; }
    };
    globalThis[key] = parts;
    return "Original card, footer/helpers and overlay prepared. Nothing mounted or captured.";
})();
