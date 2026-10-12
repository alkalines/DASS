/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Paste in client DevTools. Downloads static loaded source, never runs factories.
(() => {
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!factories) throw new Error("Equicord webpack factories unavailable.");
    const sourceOf = id => typeof factories[id] === "function"
        ? Function.prototype.toString.call(factories[id]) : undefined;
    const targets = [
        { id: "803301", role: "native user-stream media projection" },
        { id: "827343", role: "native audio actions" },
        { id: "192820", role: "native media-engine store" }
    ];
    const unresolved = [];
    for (const [parentId, alias, role] of [
        ["699707", "C", "focused-layout auxiliary participant filter"],
        ["113634", "q", "video stream lookup dependency"],
        ["113634", "O", "video mount/pause ownership dependency"]
    ]) {
        const pattern = new RegExp("\\b" + alias + "\\s*=\\s*[\\w$]+\\((\\d+)\\)");
        const id = sourceOf(parentId)?.match(pattern)?.[1];
        if (id) targets.push({ id, role, parentId, alias });
        else unresolved.push({ parentId, alias, role });
    }
    let remainingCharacters = 5_000_000;
    const modules = [...new Set(targets.map(target => target.id))].map(id => {
        const source = sourceOf(id);
        const references = targets.filter(target => target.id === id);
        if (source === undefined) return { id, references, unavailable: true };
        const excerpt = source.slice(0, Math.min(1_000_000, remainingCharacters));
        remainingCharacters -= excerpt.length;
        return { id, references, source: excerpt, sourceLength: source.length, truncated: excerpt.length < source.length };
    });
    const report = {
        kind: "Native participant filtering and media ownership source investigation",
        limitation: "Loaded factory source only; not proof of executed patched source or runtime call order.",
        unresolved,
        modules
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "discord-native-ownership-probe.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { downloaded: link.download, modules: modules.map(({ id, truncated, unavailable }) => ({ id, truncated, unavailable })), unresolved };
})();
