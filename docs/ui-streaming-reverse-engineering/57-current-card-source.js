/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["175203"];
    if (typeof factory !== "function") return JSON.stringify({ error: "Native tile source unavailable." });
    const source = factory.toString();
    const imports = Array.from(source.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const alias = moduleId => {
        const matches = imports.filter(match => match[2] === moduleId);
        return matches.length === 1 ? matches[0][1] : null;
    };
    const react = alias("582128");
    const jsx = alias("477900");
    const memoBindings = react ? Array.from(source.matchAll(new RegExp("\\b([\\w$]+)=" + react.replace(/\$/g, "\\$") + "\\.memo\\(", "g"))) : [];
    const labels = Array.from(source.matchAll(/\b([\w$]+)\.displayName\s*=\s*["']CallTileOverlay["']/g));
    const footerName = labels.length === 1 ? labels[0][1] : null;
    const footerStart = footerName && react ? source.indexOf(`${footerName}=${react}.memo(`) : -1;
    const footerEnd = labels.length === 1 ? labels[0].index : -1;
    const platform = source.match(/function\s+([\w$]+)\([\w$]+\)\{let\{participantType:/);
    const control = source.match(/function\s+([\w$]+)\([\w$]+\)\{let\{icon:/);
    const platformStart = platform?.index ?? -1;
    const renderStart = jsx && platformStart >= 0 ? source.lastIndexOf(`return(0,${jsx}.`, platformStart) : -1;
    return JSON.stringify({
        probe: "57-current-card-source", mutatesNothing: true, sourceLength: source.length,
        aliases: Object.fromEntries(["477900","582128","17928","272812","806931","584841","820284","40056","551826","612258","141035","345812"].map(id => [id, alias(id)])),
        card: { start: renderStart, end: platformStart, prefix: memoBindings.length ? source.slice(memoBindings[0].index, memoBindings[0].index + 700) : null, source: renderStart >= 0 && platformStart > renderStart ? source.slice(renderStart, Math.min(platformStart, renderStart + 2100)) : null },
        footer: { name: footerName, start: footerStart, end: footerEnd, source: footerStart >= 0 && footerEnd > footerStart ? source.slice(footerStart, Math.min(footerEnd, footerStart + 4400)) : null, truncated: footerEnd > footerStart + 4400 },
        helpers: [platform, control].map(match => match ? { name: match[1], offset: match.index, source: source.slice(match.index, match.index + 600) } : null)
    });
})();
