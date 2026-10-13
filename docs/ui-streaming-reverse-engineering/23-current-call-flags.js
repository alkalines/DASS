/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    const webpack = globalThis.Vencord?.Webpack;
    if (!fiberKey || !webpack) return JSON.stringify({ error: "Keep the call tile frame selected." });
    const cache = webpack.cache ?? webpack.wreq?.c;
    const modes = cache?.["652215"]?.exports?._Of;
    const modeConstantsAvailable = modes?.VIDEO !== undefined && modes?.VOICE !== undefined;
    const flags = props => ({
        inCall: typeof props?.inCall === "boolean" ? props.inCall : null,
        selectedParticipantPresent: props?.selectedParticipant != null,
        videoMode: modeConstantsAvailable ? props?.mode === modes.VIDEO : null,
        voiceMode: modeConstantsAvailable ? props?.mode === modes.VOICE : null
    });
    let controller = null;
    let visited = 0;
    for (let fiber = element[fiberKey]; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        let wrappers = 0;
        while (type && typeof type === "object" && wrappers++ < 3) type = type.render ?? type.type;
        if (typeof type !== "function") continue;
        const source = Function.prototype.toString.call(type);
        if (!source.includes("handleSelectParticipant=")) continue;
        controller = {
            name: String(type.name || "anonymous").slice(0, 60),
            fiberProps: flags(fiber.memoizedProps),
            classInstanceProps: fiber.stateNode?.props ? flags(fiber.stateNode.props) : null
        };
        break;
    }
    return JSON.stringify({ probe: "23-current-call-flags", selectedElementConnected: element.isConnected === true, modeConstantsAvailable, controller });
})();
