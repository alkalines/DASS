/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Static loaded-code investigation only. Does not invoke factories or capture.
(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) throw new Error("Equicord webpack factories unavailable.");
    const sources = new Map(Object.entries(factories)
        .filter(([, factory]) => typeof factory === "function")
        .map(([id, factory]) => [id, Function.prototype.toString.call(factory)]));
    const registryImports = /\b[\w$]+\((201327|782425)\)/g;
    const consumers = [];
    for (const [id, source] of sources) {
        const imports = [...new Set([...source.matchAll(registryImports)].map(match => match[1]))];
        if (imports.length) consumers.push({ id, imports, sourceLength: source.length });
    }
    const targets = [...new Set(["113634", "205693", ...consumers.slice(0, 20).map(consumer => consumer.id)])];
    let remainingCharacters = 5_000_000;
    const modules = targets.map(id => {
        const source = sources.get(id);
        if (source === undefined) return { id, unavailable: true };
        const excerpt = source.slice(0, Math.min(1_000_000, remainingCharacters));
        remainingCharacters -= excerpt.length;
        return { id, source: excerpt, sourceLength: source.length, truncated: excerpt.length < source.length };
    });
    const report = {
        kind: "Native web-media registry, input pool and mount-activity ownership",
        limitation: "Static numeric import candidates only; not execution evidence. No runtime values, media or credentials inspected.",
        consumers,
        omittedConsumerCount: Math.max(0, consumers.length - 20),
        modules
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "discord-native-media-lifecycle-probe.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { downloaded: link.download, consumerCount: consumers.length, omittedConsumerCount: report.omittedConsumerCount,
        modules: modules.map(({ id, truncated, unavailable }) => ({ id, truncated, unavailable })) };
})();
