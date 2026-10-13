/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const factories = globalThis.Vencord?.Webpack?.wreq?.m;
    if (!fiberKey || !factories) return JSON.stringify({ error: "Keep the call tile frame selected." });
    let root = null;
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 60; fiber = fiber.return) {
        const props = Object.keys(fiber.memoizedProps || {});
        if (!props.includes("onSelectParticipant") || !props.includes("participantsVersion") || !props.includes("selectedParticipant")) continue;
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        if (source.length < 800) continue;
        root = { sourceLength: source.length, source: source.slice(0, 1800), truncated: source.length > 1800, matchCount: 0, matches: [] };
        break;
    }
    if (root) for (const [moduleId, factory] of Object.entries(factories)) {
        if (typeof factory !== "function") continue;
        const source = factory.toString();
        if (!source.includes(root.source.slice(0, 160))) continue;
        root.matchCount++;
        if (root.matches.length < 3) root.matches.push({ moduleId, factoryLength: source.length });
    }
    const controllerSource = factories["540462"]?.toString() || "";
    const offset = controllerSource.indexOf("renderBottomLeft=");
    const audioImports = Array.from(controllerSource.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*821747\s*\)/g)).map(match => match[1]);
    const audioSource = factories["821747"]?.toString() || "";
    const buildId = globalThis.GLOBAL_ENV?.SENTRY_TAGS?.buildId;
    return JSON.stringify({
        probe: "27-call-route-and-speaker",
        runtimeBuildId: typeof buildId === "string" && buildId.length <= 80 ? buildId : null,
        root,
        controllerAudio: { offset, source: offset >= 0 ? controllerSource.slice(offset, offset + 2200) : null, historicalAudioImportAliases: audioImports },
        audioFactory: { moduleId: "821747", sourceLength: audioSource.length, source: audioSource.slice(0, 1500), truncated: audioSource.length > 1500, unavailable: !audioSource }
    });
})();
