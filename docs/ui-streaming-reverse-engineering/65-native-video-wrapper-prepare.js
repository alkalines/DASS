/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_VIDEO_WRAPPER_TEST__";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-video-wrapper-test-v1")
        return "Test name already occupied. Nothing changed.";
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const createRoot = webpack?.Common?.createRoot;
    const source = webpack?.wreq?.m?.["51092"]?.toString() || "";
    const signature = source.match(/^51092\(([\w$]+),([\w$]+),([\w$]+)\)\{/);
    if (!signature || !source.endsWith("}") || !React || typeof createRoot !== "function" ||
        !source.includes("videoComponent:") || !source.includes("trackSpinnerDuration") ||
        !source.includes("isIncomingVideoEnabled()") || !source.includes("{onReady:"))
        return "Inspected wrapper or React API changed. Nothing prepared.";
    const overrides = {
        684339: { M: class { onSpinnerStarted() {} trackSpinnerDuration() {} }, u: {} },
        276208: { X: { isIncomingVideoEnabled: () => false } },
        37965: { Z() {}, W() {} }
    };
    const missing = [...source.matchAll(/\b[\w$]+\((\d+)\)/g)]
        .map(match => match[1])
        .filter(id => !Object.hasOwn(overrides, id) && !cache?.[id]?.exports);
    if (missing.length) return JSON.stringify({ missingDependencies: [...new Set(missing)] });
    const exports = {};
    const requireLoaded = id => {
        if (Object.hasOwn(overrides, id)) return overrides[id];
        const value = cache?.[String(id)]?.exports;
        if (!value) throw Error("Required cached dependency disappeared.");
        return value;
    };
    requireLoaded.d = (target, getters) => {
        for (const [name, get] of Object.entries(getters))
            Object.defineProperty(target, name, { enumerable: true, get });
    };
    requireLoaded.n = value => () => value?.__esModule ? value.default : value;
    try {
        new Function(signature[1], signature[2], signature[3], source.slice(signature[0].length, -1))(
            { exports }, exports, requireLoaded
        );
        if (!exports.A || exports.$?.CONTAIN !== "contain") throw Error("Wrapper export changed.");
    } catch {
        return "Isolated wrapper preparation failed. Nothing installed.";
    }
    previous?.cleanup?.();
    const test = {
        marker: "dass-video-wrapper-test-v1", React, createRoot, Video: exports.A,
        cleanup() { if (globalThis[key] === test) delete globalThis[key]; }
    };
    globalThis[key] = test;
    return "Original video wrapper prepared in an isolated namespace. Nothing mounted or shared.";
})();
