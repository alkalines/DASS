/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    if (!element?.isConnected || !fiberKey)
        return JSON.stringify({ error: "Keep a native participant tile selected." });
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    let flags = null;
    for (let fiber = element[fiberKey], visited = 0; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        for (let depth = 0; type && typeof type === "object" && depth < 3; depth++) type = type.render ?? type.type;
        if (typeof type !== "function" || !type.toString().includes("handleSelectParticipant=")) continue;
        const instance = fiber.stateNode;
        const props = instance?.props;
        const participants = Array.isArray(props?.participants) ? props.participants : null;
        const modes = cache?.["652215"]?.exports?._Of;
        flags = {
            inCall: props?.inCall === true,
            voiceMode: modes?.VOICE !== undefined ? props?.mode === modes.VOICE : null,
            participantCount: participants?.length ?? null,
            participantsWithStreamPayload: participants?.filter(item => item?.stream != null).length ?? null,
            participantsWithStreamId: participants?.filter(item => item?.streamId != null).length ?? null,
            activeStreamCount: Array.isArray(props?.allActiveStreams) ? props.allActiveStreams.length : null,
            activityCount: Array.isArray(props?.currentChannelActivities) ? props.currentChannelActivities.length : null,
            selectedParticipantPresent: props?.selectedParticipant != null,
            awaitingRemoteSessionPresent: props?.awaitingRemoteSessionInfo != null,
            guildRoomVisible: props?.guildRoomVisible === true,
            popoutOpen: instance?.popoutOpen === true,
            inPopout: instance?.inPopout === true,
            nativeTileExport: typeof cache?.["175203"]?.exports?.Ay,
            nativeGridExport: typeof cache?.["511205"]?.exports?.A,
            tileClassAvailable: typeof cache?.["886179"]?.exports?.V === "string"
        };
        break;
    }
    const factory = webpack?.wreq?.m?.["874739"];
    const source = typeof factory === "function" ? factory.toString() : "";
    return JSON.stringify({
        probe: "51-call-grid-adapter-preflight", mutatesNothing: true, flags,
        nativeRoot: { sourceLength: source.length, source: source.slice(0, 2000), truncated: source.length > 2000 }
    });
})();
