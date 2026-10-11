/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { DiscoveryController } from "./controller";
import { PublishIntent, routePublish, routeWatch, WatchIntent } from "./discordAdapter";
import { ScreenshareRouting } from "./routing";

const discovery = new DiscoveryController();
const screenshare = new ScreenshareRouting();

function resetConfiguration() {
    discovery.reset();
    screenshare.reset();
}

const settings = definePluginSettings({
    backendUrl: {
        type: OptionType.STRING,
        description: "Trusted DASS backend base URL. No credentials, query parameters or fragments.",
        default: "https://localhost:8080",
        onChange: resetConfiguration
    },
    allowInsecureLocalDevelopment: {
        type: OptionType.BOOLEAN,
        description: "Allow HTTP on loopback and a development backend. Never use for production.",
        default: false,
        onChange: resetConfiguration
    }
});

function DiscoveryPanel() {
    const [status, setStatus] = useState(discovery.getSnapshot());
    useEffect(() => {
        const unsubscribe = discovery.subscribe(() => setStatus(discovery.getSnapshot()));
        setStatus(discovery.getSnapshot());
        return unsubscribe;
    }, []);
    return (
        <div>
            <Paragraph>Discord Alternative ScreenShare is an early development scaffold, not a working screensharing transport.</Paragraph>
            <Paragraph>Native Discord sharing is unchanged and still uses Discord. No DASS capture, thumbnails, authentication or media are sent.</Paragraph>
            <Paragraph>DASS publish, watch and stream detection routing is under development. Native action hooks and the server media transport are unavailable.</Paragraph>
            <Paragraph role="status" aria-live="polite">{status.message}</Paragraph>
            <Button
                disabled={status.phase === "stopped" || status.phase === "checking"}
                onClick={() => void discovery.check(settings.store)}
            >
                Check backend capabilities
            </Button>
        </div>
    );
}

export default definePlugin({
    name: "DASS",
    description: "Discord Alternative ScreenShare: backend discovery scaffold. Screensharing is not implemented.",
    // Add the maintainer's confirmed Discord ID before distribution; never invent one.
    authors: [],
    settings,
    settingsAboutComponent: DiscoveryPanel,
    setDassRoom(roomId?: string) {
        screenshare.setRoom(roomId);
    },
    stopPublishing() {
        screenshare.stopPublishing();
    },
    stopWatching() {
        screenshare.stopWatching();
    },
    routePublish(intent: PublishIntent) {
        return routePublish(screenshare, intent);
    },
    routeWatch(intent: WatchIntent) {
        return routeWatch(screenshare, intent);
    },
    detectShares(roomId: string) {
        return screenshare.detect(roomId);
    },
    start() {
        discovery.start();
        screenshare.start();
    },
    stop() {
        discovery.stop();
        screenshare.stop();
    },
    flux: {
        LOGOUT() {
            discovery.stop();
            screenshare.stop();
        }
    }
});
