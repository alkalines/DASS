/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RELEASE_REPOSITORY } from "./releaseInfo";

const MAX_RELEASE_BYTES = 2_097_152;

function stableVersion(value: string): number[] | undefined {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return;
    const parts = value.split(".").map(Number);
    return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function isNewerRelease(candidate: string, current: string): boolean {
    const next = stableVersion(candidate);
    const previous = stableVersion(current);
    if (!next || !previous) return false;
    for (let i = 0; i < 3; i++) if (next[i] !== previous[i]) return next[i] > previous[i];
    return false;
}

export function pluginReleaseUrl(version: string): string | undefined {
    if (stableVersion(version)) return `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function availablePluginUpdate(releases: unknown, current: string): string | undefined {
    if (!Array.isArray(releases) || releases.length > 100) return;
    let newest = current;
    for (const release of releases) {
        if (!isRecord(release) || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") continue;
        const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
        if (!isNewerRelease(version, newest) || !Array.isArray(release.assets)) continue;
        if (release.assets.some((asset: unknown) => isRecord(asset) && asset.name === `dass-equicord-${version}.zip` && asset.state === "uploaded")) newest = version;
    }
    return newest === current ? undefined : newest;
}

export async function fetchPluginUpdate(current: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
    if (!stableVersion(current)) return;
    const response = await fetchImpl(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=100`, {
        signal, redirect: "error", credentials: "omit", headers: { Accept: "application/vnd.github+json", "User-Agent": "DASS-update-check" }
    });
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RELEASE_BYTES) return;
            text += decoder.decode(value, { stream: true });
        }
        return availablePluginUpdate(JSON.parse(text + decoder.decode()), current);
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
