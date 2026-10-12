/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const host = globalThis.Vencord;
    const webpack = host?.Webpack;
    const patcher = host?.WebpackPatcher;
    const require = webpack?.wreq;
    if (!require?.m) return JSON.stringify({ error: "Equicord factories unavailable." });

    const channelId = webpack.Common?.SelectedChannelStore?.getVoiceChannelId();
    const rtcStore = require.c?.["198052"]?.exports?.A;
    const appContext = require.c?.["652215"]?.exports?.BRT?.APP;
    const snapshot = {
        inVoiceCall: !!channelId,
        documentFullscreen: !!document.fullscreenElement,
        nativeMode: channelId && typeof rtcStore?.getMode === "function" ? rtcStore.getMode(channelId) : undefined,
        savedLayout: channelId && appContext !== undefined && typeof rtcStore?.getLayout === "function"
            ? rtcStore.getLayout(channelId, appContext) : undefined,
        nativeSidebarAdapterPresent: typeof host.Plugins?.plugins?.DASS?.useNativeSidebarProps === "function"
    };
    const modules = ["540462", "463481", "157667", "105225", "338771", "198052", "367513", "848362"].map(moduleId => {
        const factory = require.m[moduleId];
        if (typeof factory !== "function") return { moduleId, unavailable: true };
        const patchedSource = patcher?.getFactoryPatchedSource(moduleId);
        const patchedBy = patcher?.getFactoryPatchedBy(moduleId);
        const source = patchedSource ?? String(factory);
        const executedDassFunctions = [];
        const inspectFunctions = (value, path) => {
            if (value === null || !["object", "function"].includes(typeof value)) return;
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
                if (typeof descriptor.value !== "function") continue;
                const functionSource = Function.prototype.toString.call(descriptor.value);
                if (functionSource.includes("plugins.DASS") || functionSource.includes('plugins["DASS"]')) {
                    executedDassFunctions.push({ path: `${path}.${name}`, source: functionSource });
                }
            }
        };
        const exports = require.c?.[moduleId]?.exports;
        inspectFunctions(exports, "exports");
        if (exports !== null && ["object", "function"].includes(typeof exports)) {
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(exports))) {
                const value = descriptor.value;
                inspectFunctions(value, `exports.${name}`);
                if (typeof value === "function") inspectFunctions(value.prototype, `exports.${name}.prototype`);
            }
        }
        return {
            moduleId,
            loaded: !!require.c?.[moduleId],
            dassPatched: patchedBy === undefined ? null : patchedBy.has("DASS"),
            patchedSourceAvailable: typeof patchedSource === "string",
            sourceKind: typeof patchedSource === "string" ? "patched factory" : "original factory, not patch evidence",
            executedDassFunctions,
            sourceLength: source.length,
            source
        };
    });
    return JSON.stringify({ kind: "DASS UI patch evidence and native management menu", build: patcher?.getBuildNumber(),
        patchEvidenceNote: "This host records factory patch metadata only in development builds. Null means unknown. Exported function matches prove surviving DASS code, but no matches do not prove failure; internal functions and export getters are not inspected.",
        snapshot, modules }, null, 2);
})();
