import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseVersion(value) {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error("Use a stable version such as 0.1.0.");
    const parts = value.split(".").map(Number);
    if (!parts.every(Number.isSafeInteger)) throw new Error("Version is too large.");
    return parts;
}

export function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
}

export function releasePlan({ event, branch, version, component, repository }) {
    if (event === "push") {
        const match = /^release\/(backend\/)?(.+)$/.exec(branch);
        if (!match) throw new Error("Expected release/VERSION or release/backend/VERSION.");
        component = match[1] ? "backend" : "all";
        version = match[2];
    }
    parseVersion(version);
    if (!["all", "backend"].includes(component)) throw new Error("Unknown release component.");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository.");
    return { version, component, tag: `${component === "backend" ? "backend-v" : "v"}${version}`, image: `ghcr.io/${repository.toLowerCase()}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const plan = releasePlan({ event: process.env.GITHUB_EVENT_NAME, branch: process.env.GITHUB_REF_NAME,
        version: process.env.RELEASE_VERSION, component: process.env.RELEASE_COMPONENT, repository: process.env.GITHUB_REPOSITORY });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(""));
    console.log(JSON.stringify(plan));
}
