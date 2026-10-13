/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    if (!element?.isConnected || !fiberKey)
        return JSON.stringify({ error: "Keep the native participant tile selected." });
    let controller = null;
    for (let fiber = element[fiberKey], visited = 0; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        for (let depth = 0; type && typeof type === "object" && depth < 3; depth++) type = type.render ?? type.type;
        if (typeof type !== "function" || !type.toString().includes("handleSelectParticipant=")) continue;
        const instance = fiber.stateNode;
        const method = instance?.renderContent;
        const source = typeof method === "function" ? method.toString() : "";
        const modes = globalThis.Vencord?.Webpack?.cache?.["652215"]?.exports?._Of;
        controller = {
            renderContentLength: source.length, renderContent: source.slice(0, 2800), truncated: source.length > 2800,
            ownsRenderContent: !!instance && Object.hasOwn(instance, "renderContent"),
            inCall: typeof instance?.props?.inCall === "boolean" ? instance.props.inCall : null,
            videoMode: modes?.VIDEO !== undefined ? instance?.props?.mode === modes.VIDEO : null,
            selectedParticipantPresent: instance?.props?.selectedParticipant != null
        };
        break;
    }
    const factory = globalThis.Vencord?.Webpack?.wreq?.m?.["526369"];
    const source = typeof factory === "function" ? factory.toString() : "";
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const renderers = hook?.renderers instanceof Map ? Array.from(hook.renderers.entries()).slice(0, 4) : [];
    return JSON.stringify({
        probe: "50-call-content-and-renderer", mutatesNothing: true, controller,
        connectedGrid: { sourceLength: source.length, source: source.slice(0, 2300), truncated: source.length > 2300 },
        devtoolsHookAvailable: !!hook,
        renderers: renderers.map(([rendererId, renderer]) => ({
            rendererId, overrideProps: typeof renderer.overrideProps,
            scheduleUpdate: typeof renderer.scheduleUpdate
        }))
    });
})();
