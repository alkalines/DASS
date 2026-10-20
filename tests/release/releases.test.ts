import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { compareVersions, releasePlan } from "../../scripts/release-plan.mjs";
import { availablePluginUpdate, fetchPluginUpdate, isNewerRelease, pluginReleaseUrl } from "../../plugins/dass/releaseUpdates";

const release = (tag: string, names: string[], extra = {}) => ({ tag_name: tag, draft: false, prerelease: false,
    assets: names.map(name => ({ name, state: "uploaded" })), ...extra });
const full = (version: string) => release(`v${version}`, [`dass-equicord-${version}.zip`, "backend-image.json"]);
const backend = (version: string) => release(`backend-v${version}`, ["backend-image.json"]);
const backendSource = readFileSync(new URL("../../crates/backend/src/admin/updates.js", import.meta.url), "utf8");
const backendContext = { result: undefined, releases: [] as unknown[], current: "0.1.0" };
function backendUpdate(releases: unknown[], current = "0.1.0") {
    const context = { ...backendContext, releases, current };
    runInNewContext(backendSource.replace("void checkBackendUpdate();", "result = availableBackendUpdate(releases, current);"), context);
    return context.result as { version: string; url: string; } | undefined;
}

describe("release plans", () => {
    test("branch names select full or backend-only stable releases", () => {
        const env = { event: "push", repository: "alkalines/DASS" };
        expect(releasePlan({ ...env, branch: "release/0.1.0" })).toEqual({ version: "0.1.0", component: "all", tag: "v0.1.0", image: "ghcr.io/alkalines/dass" });
        expect(releasePlan({ ...env, branch: "release/backend/0.2.0" }).tag).toBe("backend-v0.2.0");
        expect(releasePlan({ ...env, event: "workflow_dispatch", version: "1.0.0", component: "backend" }).component).toBe("backend");
    });
    test("invalid, prerelease and shell-like branch versions are rejected", () => {
        for (const version of ["01.0.0", "1.0", "1.0.0-rc.1", "1.0.0;echo nope", "1.0.0/other", "9007199254740992.0.0"]) {
            expect(() => releasePlan({ event: "push", repository: "a/b", branch: `release/${version}` })).toThrow();
        }
        expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    });
});

test("backend-only releases do not hide or trigger plugin updates", () => {
    const releases = [backend("0.12.0"), full("0.10.0"), full("0.9.0")];
    expect(availablePluginUpdate(releases, "0.9.0")).toBe("0.10.0");
    expect(backendUpdate(releases)?.version).toBe("0.12.0");
    expect(availablePluginUpdate([backend("0.12.0")], "0.9.0")).toBeUndefined();
});

test("only stable, uploaded component assets qualify, never a downgrade", () => {
    const releases = [full("0.1.0"), full("0.0.9"), release("v9.0.0", ["dass-equicord-9.0.0.zip", "backend-image.json"], { draft: true }),
        release("v8.0.0", ["dass-equicord-8.0.0.zip", "backend-image.json"], { prerelease: true }),
        release("v7.0.0", []), release("v6.0.0-rc.1", ["backend-image.json"]), null];
    expect(availablePluginUpdate(releases, "0.1.0")).toBeUndefined();
    expect(backendUpdate(releases)).toBeUndefined();
    expect(isNewerRelease("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerRelease("1.0.0", "0.1.0-dev")).toBe(false);
    expect(backendUpdate([backend("1.0.0")], "0.1.0-dev")).toBeUndefined();
});

test("download destinations are reconstructed, never taken from remote URLs", () => {
    expect(pluginReleaseUrl("0.2.0")).toBe("https://github.com/alkalines/DASS/releases/tag/v0.2.0");
    expect(pluginReleaseUrl("../../evil")).toBeUndefined();
    expect(backendUpdate([backend("0.2.0")])?.url).toBe("https://github.com/alkalines/DASS/releases/tag/backend-v0.2.0");
});

test("native release fetch omits credentials, refuses redirects and bounds response size", async () => {
    let options: RequestInit | undefined;
    const mockFetch = (async (url, init) => {
        expect(String(url)).toBe("https://api.github.com/repos/alkalines/DASS/releases?per_page=100");
        options = init;
        return Response.json([full("0.2.0")]);
    }) as typeof fetch;
    expect(await fetchPluginUpdate("0.1.0", new AbortController().signal, mockFetch)).toBe("0.2.0");
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("error");
    const oversized = (async () => new Response(" ".repeat(2_097_153))) as typeof fetch;
    expect(await fetchPluginUpdate("0.1.0", new AbortController().signal, oversized)).toBeUndefined();
    const unavailable = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
    expect(await fetchPluginUpdate("0.1.0", new AbortController().signal, unavailable)).toBeUndefined();
});

test("workflow has no schedule, pins actions and keeps image publication behind client validation", () => {
    const workflow = Bun.YAML.parse(readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")) as any;
    expect(workflow.on.schedule).toBeUndefined();
    expect(workflow.on.push.branches).toEqual(["release/**"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish.needs).toEqual(["plan", "plugin"]);
    expect(workflow.jobs.publish.if).toContain("needs.plugin.result == 'success'");
    for (const job of Object.values(workflow.jobs) as any[]) {
        for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    }
    const image = workflow.jobs.publish.steps.find((step: any) => step.id === "image");
    expect(image.with.target).toBe("runtime");
    expect(image.with.platforms).toBe("linux/amd64");
    expect(image.with["build-args"]).toContain("DASS_RELEASE_VERSION=");
});

test("notification teardown suppresses late results and repeated versions", async () => {
    const notifications: { title: string; onClick: () => void; }[] = [];
    let resolveUpdate: (version: string) => void = () => {};
    let cancelled = 0;
    let opened: string | undefined;
    const native = {
        getPluginUpdate: () => new Promise<string>(resolve => { resolveUpdate = resolve; }),
        cancelPluginUpdate: async () => { cancelled++; },
        openPluginRelease: async (version: string) => { opened = version; }
    };
    const source = readFileSync(new URL("../../plugins/dass/updateNotifications.ts", import.meta.url), "utf8")
        .replace(/^import .*;\n/gm, "").replace("export function", "function");
    const context = { VencordNative: { pluginHelpers: { DASS: native } }, showNotification: (value: typeof notifications[number]) => { notifications.push(value); },
        isNewerRelease, start: undefined as unknown as () => () => void };
    runInNewContext(new Bun.Transpiler({ loader: "ts" }).transformSync(source) + "\nglobalThis.start = startUpdateNotifications;", context);
    const stopped = context.start();
    stopped();
    resolveUpdate("0.2.0");
    await Promise.resolve();
    expect(notifications).toHaveLength(0);
    expect(cancelled).toBe(1);
    const stop = context.start();
    resolveUpdate("0.2.0");
    await Promise.resolve();
    expect(notifications).toHaveLength(1);
    notifications[0].onClick();
    expect(opened).toBe("0.2.0");
    stop();
    context.start();
    resolveUpdate("0.2.0");
    await Promise.resolve();
    expect(notifications).toHaveLength(1);
});

test("admin update notice uses authenticated local version but credential-free GitHub requests", async () => {
    const calls: { url: string; options: RequestInit; }[] = [];
    let link: { href?: string; textContent?: string; } | undefined;
    const context = { AbortController, TextDecoder, setTimeout, clearTimeout,
        window: { addEventListener() {}, removeEventListener() {} },
        document: { createElement: () => ({}), querySelector: () => ({ replaceChildren(value: typeof link) { link = value; } }) },
        fetch: async (url: string, options: RequestInit) => {
            calls.push({ url, options });
            return Response.json(url.startsWith("/") ? { version: "0.1.0" } : [backend("0.2.0")]);
        }, finished: undefined as unknown as Promise<void> };
    runInNewContext(backendSource.replace("void checkBackendUpdate();", "globalThis.finished = checkBackendUpdate();"), context);
    await context.finished;
    expect(calls[0].url).toBe("/admin/api/version");
    expect(calls[0].options.credentials).toBe("same-origin");
    expect(calls[1].url).toBe("https://api.github.com/repos/alkalines/DASS/releases?per_page=100");
    expect(calls[1].options.credentials).toBe("omit");
    expect(calls[1].options.referrerPolicy).toBe("no-referrer");
    expect(link?.href).toBe("https://github.com/alkalines/DASS/releases/tag/backend-v0.2.0");
    expect(link?.textContent).toContain("Backend update available");
});
