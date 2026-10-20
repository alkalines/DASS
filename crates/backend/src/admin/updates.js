"use strict";

function backendVersionParts(value) {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return;
    const parts = value.split(".").map(Number);
    return parts.every(Number.isSafeInteger) ? parts : undefined;
}

function newerBackendVersion(candidate, current) {
    const next = backendVersionParts(candidate);
    const previous = backendVersionParts(current);
    if (!next || !previous) return false;
    for (let i = 0; i < 3; i++) if (next[i] !== previous[i]) return next[i] > previous[i];
    return false;
}

function availableBackendUpdate(releases, current) {
    if (!Array.isArray(releases) || releases.length > 100) return;
    let newest = current;
    let tag;
    for (const release of releases) {
        if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") continue;
        const match = /^(?:backend-)?v(\d+\.\d+\.\d+)$/.exec(release.tag_name);
        if (!match || !newerBackendVersion(match[1], newest) || !Array.isArray(release.assets)) continue;
        if (!release.assets.some(asset => asset && asset.name === "backend-image.json" && asset.state === "uploaded")) continue;
        newest = match[1];
        tag = release.tag_name;
    }
    return tag ? { version: newest, url: `https://github.com/alkalines/DASS/releases/tag/${tag}` } : undefined;
}

async function checkBackendUpdate() {
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 10_000);
    const stop = () => request.abort();
    window.addEventListener("pagehide", stop, { once: true });
    try {
        const local = await fetch("/admin/api/version", { signal: request.signal, credentials: "same-origin", redirect: "error" });
        if (!local.ok) return;
        const { version } = await local.json();
        if (!backendVersionParts(version)) return;
        const response = await fetch("https://api.github.com/repos/alkalines/DASS/releases?per_page=100", {
            signal: request.signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
            headers: { Accept: "application/vnd.github+json" }
        });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0;
        let text = "";
        let update;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 2_097_152) return;
                text += decoder.decode(value, { stream: true });
            }
            update = availableBackendUpdate(JSON.parse(text + decoder.decode()), version);
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
        if (!update || request.signal.aborted) return;
        const link = document.createElement("a");
        link.href = update.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Backend update available (${update.version}). Click here to download and view manual Docker update instructions.`;
        document.querySelector("#update-notice").replaceChildren(link);
    } catch {
        // Release checks must not interrupt administration when GitHub is unreachable.
    } finally {
        clearTimeout(timeout);
        window.removeEventListener("pagehide", stop);
    }
}

void checkBackendUpdate();
