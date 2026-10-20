/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import type { PluginNative } from "@utils/types";

import { isNewerRelease } from "./releaseUpdates";

const Native = VencordNative.pluginHelpers.DASS as PluginNative<typeof import("./native")>;
let notifiedVersion: string | undefined;

export function startUpdateNotifications(): () => void {
    let stopped = false;
    void Native.getPluginUpdate().then(version => {
        if (stopped || !version || (notifiedVersion && !isNewerRelease(version, notifiedVersion))) return;
        notifiedVersion = version;
        void showNotification({ title: "DASS update available", body: `Version ${version} is available. Click here to download. Installation is manual.`,
            noPersist: true, onClick: () => { void Native.openPluginRelease(version); } });
    }).catch(() => {});
    return () => {
        stopped = true;
        void Native.cancelPluginUpdate().catch(() => {});
    };
}
