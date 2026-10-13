/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["157667"];
    if (typeof factory !== "function") return JSON.stringify({ error: "E02 owner factory is unavailable." });
    const source = Function.prototype.toString.call(factory);
    const aliases = ["vf", "vT", "vp", "D0", "DC", "DH", "Dj", "vh", "al", "rO", "si", "lx", "va", "tv"];
    const imports = aliases.map(alias => {
        const pattern = new RegExp("\\b" + alias + "\\s*=\\s*([\\w$]+)\\(\\s*(\\d+)\\s*\\)", "g");
        const matches = Array.from(source.matchAll(pattern));
        return {
            alias,
            count: matches.length,
            matches: matches.slice(0, 3).map(match => ({
                moduleId: match[2],
                requireName: match[1],
                declaration: match[0]
            }))
        };
    });
    const ownerReferences = ["vQ", "v5"].map(name => {
        const matches = Array.from(source.matchAll(new RegExp("\\b" + name + "\\b", "g")));
        return {
            name,
            count: matches.length,
            references: matches.slice(0, 4).map(match => ({
                offset: match.index,
                excerpt: source.slice(Math.max(0, match.index - 80), match.index + 100)
            }))
        };
    });
    return JSON.stringify({ probe: "03-sidebar-imports", imports, ownerReferences });
})();
