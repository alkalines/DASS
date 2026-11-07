/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { RendererSettings } from "@main/settings";

/**
 * Discord's connect-src lists only its own hosts, so without an entry the
 * renderer cannot reach the configured backend: the WebSocket fails at once
 * and DASS reports `socket`. Equicord rebuilds the policy from `CspPolicies`
 * on every main-frame load, so this keeps exactly the configured origin there.
 *
 * Sources carry explicit schemes: Equicord's consent dialog stores scheme-less
 * hosts, which Chromium does not match against `wss:` from an `https:` page.
 * A changed origin takes effect when Discord next reloads.
 */

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/;
let added: string[] = [];

export function backendCspSources(backendUrl: unknown): string[] {
    if (typeof backendUrl !== "string") return [];
    const url = URL.parse(backendUrl);
    if (url?.protocol !== "https:" || url.username || url.password || !HOST.test(url.host)) return [];
    return [`https://${url.host}`, `wss://${url.host}`];
}

export function syncBackendCsp(): void {
    const dass = RendererSettings.store.plugins?.DASS;
    const next = dass?.enabled ? backendCspSources(dass.backendUrl) : [];
    for (const source of added) delete CspPolicies[source];
    added = next.filter(source => !(source in CspPolicies));
    for (const source of added) CspPolicies[source] = ConnectSrc;
}

syncBackendCsp();
RendererSettings.addGlobalChangeListener(syncBackendCsp);
