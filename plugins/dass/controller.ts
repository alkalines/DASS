/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DISCOVERY_TIMEOUT_MS, fetchScaffoldCapabilities, getCapabilitiesUrl } from "./discovery";

export interface DiscoveryConfiguration {
    backendUrl: string;
    allowInsecureLocalDevelopment: boolean;
}

export interface DiscoveryStatus {
    phase: "stopped" | "idle" | "checking" | "scaffold" | "failed";
    message: string;
}

export class DiscoveryController {
    private active = false;
    private pending?: AbortController;
    private pendingTimeout?: ReturnType<typeof setTimeout>;
    private listeners = new Set<() => void>();
    private status: DiscoveryStatus = { phase: "stopped", message: "DASS is disabled." };

    constructor(private readonly fetchImpl: typeof fetch = fetch) {}

    getSnapshot = () => this.status;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private update(status: DiscoveryStatus) {
        this.status = status;
        for (const listener of this.listeners) listener();
    }

    private cancelPending() {
        this.pending?.abort();
        this.pending = undefined;
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = undefined;
    }

    start() {
        this.active = true;
        this.reset();
    }

    reset() {
        this.cancelPending();
        if (this.active) this.update({ phase: "idle", message: "Discovery not checked. DASS sharing is not implemented." });
    }

    stop() {
        this.active = false;
        this.cancelPending();
        this.update({ phase: "stopped", message: "DASS is disabled or logged out." });
    }

    async check(configuration: DiscoveryConfiguration) {
        if (!this.active) return;
        this.cancelPending();
        const request = new AbortController();
        this.pending = request;
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            request.abort();
        }, DISCOVERY_TIMEOUT_MS);
        this.pendingTimeout = timeout;
        this.update({ phase: "checking", message: "Checking backend capabilities; no capture is started." });
        try {
            const url = getCapabilitiesUrl(configuration.backendUrl, configuration.allowInsecureLocalDevelopment);
            const capabilities = await fetchScaffoldCapabilities(url, request.signal, this.fetchImpl);
            if (!this.active || this.pending !== request || request.signal.aborted) return;
            if (capabilities.insecureLocalDevelopment && !configuration.allowInsecureLocalDevelopment) {
                throw new Error("The backend advertises insecure development mode.");
            }
            this.update({
                phase: "scaffold",
                message: "Backend scaffold reached. Authentication, signaling, media and E2EE are unavailable. Sharing is disabled."
            });
        } catch {
            // Never surface raw exceptions: they may contain URLs or response data.
            if (this.active && this.pending === request) {
                this.update({
                    phase: "failed",
                    message: timedOut
                        ? "Backend discovery timed out. Sharing is disabled."
                        : "Discovery failed: check the URL, HTTPS/local-development setting, browser policy and backend protocol. Sharing is disabled."
                });
            }
        } finally {
            clearTimeout(timeout);
            if (this.pending === request) {
                this.pending = undefined;
                this.pendingTimeout = undefined;
            }
        }
    }
}
