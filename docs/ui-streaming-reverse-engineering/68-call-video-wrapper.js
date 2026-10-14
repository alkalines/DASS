/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const test = globalThis.__DASS_CALL_VIDEO_TEST__;
    if (test?.marker !== "dass-call-video-test-v1" || test.mounted) return "Prepare an unmounted idle call test first.";
    const webpack = Vencord.Webpack;
    const cache = webpack.cache || webpack.wreq.c;
    const source = webpack.wreq.m["51092"].toString();
    const signature = source.match(/^51092\(([\w$]+),([\w$]+),([\w$]+)\)\{/);
    if (!signature || source.length !== 2122 || !source.endsWith("}") ||
        !source.includes("videoComponent:") || !source.includes("trackSpinnerDuration") ||
        !source.includes("isIncomingVideoEnabled()")) return "Inspected video wrapper changed. Nothing installed.";
    const overrides = {
        684339: { M: class { onSpinnerStarted() {} trackSpinnerDuration() {} }, u: {} },
        276208: { X: { isIncomingVideoEnabled: () => false } },
        37965: { Z() {}, W() {} }
    };
    const requireLoaded = id => {
        const value = overrides[id] ?? cache?.[id]?.exports;
        if (!value) throw Error("Required cached video dependency unavailable.");
        return value;
    };
    requireLoaded.d = (target, getters) => {
        for (const [name, get] of Object.entries(getters)) Object.defineProperty(target, name, { get });
    };
    requireLoaded.n = value => () => value?.__esModule ? value.default : value;
    const exports = {};
    try {
        new Function(...signature.slice(1), source.slice(signature[0].length, -1))({ exports }, exports, requireLoaded);
        if (!exports.A) throw Error("Video wrapper export changed.");
    } catch {
        return "Isolated video preparation failed. Call unchanged.";
    }
    test.Video = exports.A;
    return "Original video wrapper ready for the call test. Call unchanged.";
})();
