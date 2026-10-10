/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DISCOVERY_TIMEOUT_MS = 5_000;
export const MAX_DISCOVERY_BYTES = 16_384;

export function getCapabilitiesUrl(baseUrl: string, allowInsecureLocalDevelopment: boolean): URL {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash) {
        throw new Error("Use a backend URL without credentials, query parameters or fragments.");
    }
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback && allowInsecureLocalDevelopment)) {
        throw new Error("HTTPS is required, except for explicitly enabled loopback development.");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/capabilities`;
    return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The only supported contract is crates/protocol's version-1 scaffold. Do not
// infer permission to capture from discovery or accept future stages silently.
export function parseScaffoldCapabilities(value: unknown): { insecureLocalDevelopment: boolean; } {
    if (!isRecord(value) || value.protocol_version !== 1 || value.stage !== "scaffold") {
        throw new Error("Unsupported DASS discovery protocol or backend stage.");
    }
    for (const field of ["ready", "signaling_available", "media_available", "e2ee_available"]) {
        if (value[field] !== false) throw new Error("Unexpected scaffold capabilities; sharing remains disabled.");
    }
    if (typeof value.insecure_local_development !== "boolean" || !isRecord(value.limits)) {
        throw new Error("Invalid backend capabilities.");
    }
    for (const field of ["max_concurrent_requests", "max_control_message_bytes"]) {
        const limit = value.limits[field];
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0) {
            throw new Error("Invalid backend limits.");
        }
    }
    return { insecureLocalDevelopment: value.insecure_local_development };
}

export async function fetchScaffoldCapabilities(url: URL, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
    const response = await fetchImpl(url, {
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer"
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Backend discovery returned an unsuccessful HTTP status.");
    }
    const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json" || !response.body) {
        await response.body?.cancel();
        throw new Error("Backend discovery must return JSON.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytesRead = 0;
    let text = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            if (bytesRead > MAX_DISCOVERY_BYTES) throw new Error("Backend discovery exceeded the response limit.");
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return parseScaffoldCapabilities(JSON.parse(text));
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
