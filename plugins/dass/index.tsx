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

const discovery = new DiscoveryController();

const settings = definePluginSettings({
    backendUrl: {
        type: OptionType.STRING,
        description: "Trusted DASS backend base URL. No credentials, query parameters or fragments.",
        default: "https://localhost:8080",
        onChange: () => discovery.reset()
    },
    allowInsecureLocalDevelopment: {
        type: OptionType.BOOLEAN,
        description: "Allow HTTP on loopback and a development backend. Never use for production.",
        default: false,
        onChange: () => discovery.reset()
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
    start() {
        discovery.start();
    },
    stop() {
        discovery.stop();
    },
    flux: {
        LOGOUT() {
            discovery.stop();
        }
    }
});
