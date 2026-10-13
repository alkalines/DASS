/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) return JSON.stringify({ error: "Webpack factories are unavailable." });
    const ownerFactory = factories["105225"];
    const ownerSource = typeof ownerFactory === "function" ? ownerFactory.toString() : "";
    const aliases = ["ee", "eh", "K", "F", "B", "et", "eg", "ex", "D", "b", "A", "ev", "el", "ej"];
    const imports = aliases.map(alias => {
        const matches = Array.from(ownerSource.matchAll(new RegExp("\\b" + alias + "\\s*=\\s*([\\w$]+)\\(\\s*(\\d+)\\s*\\)", "g")));
        return { alias, count: matches.length, moduleIds: matches.slice(0, 3).map(match => match[2]) };
    });
    const targets = [
        { moduleId: "204651", role: "button presentation variants", limit: 4200 },
        { moduleId: "416696", role: "animated share icon hook", limit: 1600 }
    ];
    return JSON.stringify({
        probe: "10-overlay-dependencies",
        sourceView: "Equicord-exposed original factory source",
        imports,
        modules: targets.map(({ moduleId, role, limit }) => {
            const factory = factories[moduleId];
            if (typeof factory !== "function") return { moduleId, role, unavailable: true };
            const source = factory.toString();
            return { moduleId, role, sourceLength: source.length, source: source.slice(0, limit), truncated: source.length > limit, opaque: source.includes("[native code]") };
        })
    });
})();
