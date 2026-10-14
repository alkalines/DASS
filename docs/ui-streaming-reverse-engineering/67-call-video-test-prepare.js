/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_CALL_VIDEO_TEST__";
    if (globalThis[key]) return "Call test name occupied. Remove the previous test first.";
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(name => name.startsWith("__reactFiber$"));
    if (!element?.isConnected || !fiberKey) return "Keep a connected participant element selected.";
    let controller;
    for (let fiber = element[fiberKey], depth = 0; fiber && depth < 70; fiber = fiber.return, depth++) {
        if (typeof fiber.stateNode?.renderContent === "function" &&
            typeof fiber.stateNode?.handleSelectParticipant === "function") {
            controller = fiber.stateNode;
            break;
        }
    }
    if (!controller) return "Mounted call controller unavailable.";
    const webpack = Vencord.Webpack;
    const cache = webpack.cache || webpack.wreq.c;
    const components = {
        Root: cache?.["874739"]?.exports?.A,
        Grid: cache?.["511205"]?.exports?.A,
        Tile: cache?.["175203"]?.exports?.Ay,
        Frame: cache?.["272812"]?.exports?.A,
        Flex: cache?.["235986"]?.exports?.A
    };
    const renderable = value => typeof value === "function" ||
        (value !== null && typeof value === "object" && value.$$typeof != null);
    if (!Object.values(components).every(renderable)) return "A required host component is unavailable.";
    const props = controller.props;
    if (!props?.inCall || props.selectedParticipant || controller.popoutOpen || controller.inPopout ||
        props.awaitingRemoteSessionInfo || props.guildRoomVisible || props.channel?.isGuildStageVoice?.() ||
        (props.currentChannelActivities?.length ?? 0) !== 0 ||
        !Array.isArray(props.allActiveStreams) || props.allActiveStreams.length !== 0 ||
        !Array.isArray(props.participants) || !Array.isArray(props.filteredParticipants) ||
        [...props.participants, ...props.filteredParticipants].some(item => !item || item.stream != null || item.streamId != null))
        return "Use an idle call without video, streams, selection, activities or popouts.";
    const css = cache?.["804273"]?.exports;
    const tileClass = cache?.["886179"]?.exports?.V;
    const modes = cache?.["652215"]?.exports?._Of;
    const descriptor = Object.getOwnPropertyDescriptor(controller, "renderContent");
    if (!webpack.Common?.React || typeof css?.HA !== "string" || typeof css?.g9 !== "string" ||
        typeof tileClass !== "string" || modes?.VOICE === undefined || props.mode !== modes.VOICE ||
        !Object.isExtensible(controller) || descriptor?.configurable === false ||
        typeof controller.forceUpdate !== "function")
        return "Required idle-call layout or restoration contract is unavailable.";
    const test = {
        marker: "dass-call-video-test-v1", controller, components, css, tileClass, modes,
        React: webpack.Common.React, original: controller.renderContent, descriptor,
        channel: props.channel, mounted: false,
        cleanup() { if (globalThis[key] === test) delete globalThis[key]; }
    };
    globalThis[key] = test;
    return "Idle call test prepared. Original rendering unchanged.";
})();
