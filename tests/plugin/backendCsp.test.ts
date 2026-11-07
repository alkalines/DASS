import { expect, mock, test } from "bun:test";

// Discord's CSP blocks every connect-src origin it does not list. The plugin
// must allow exactly the configured backend, with an explicit wss: source.
const store: { plugins: Record<string, { enabled?: boolean; backendUrl?: unknown; }>; } = {
    plugins: { DASS: { enabled: true, backendUrl: "https://dass.example:30038" } }
};
const policies: Record<string, string[]> = { "ws://localhost:*": ["connect-src"] };
mock.module("@main/settings", () => ({ RendererSettings: { store, addGlobalChangeListener() {} } }));
mock.module("@main/csp", () => ({ ConnectSrc: ["connect-src"], CspPolicies: policies }));

// Imported after mock.module, as accountStorage.test.ts does; another file may
// have loaded the module first, so each test syncs explicitly.
const { backendCspSources, syncBackendCsp } = await import("../../plugins/dass/nativeCsp");

test("allows the configured backend over https and wss", () => {
    syncBackendCsp();
    expect(policies["https://dass.example:30038"]).toEqual(["connect-src"]);
    expect(policies["wss://dass.example:30038"]).toEqual(["connect-src"]);
});

test("replaces the previous origin and clears it when the plugin is disabled", () => {
    store.plugins.DASS.backendUrl = "https://other.example";
    syncBackendCsp();
    expect(Object.keys(policies).sort()).toEqual(["https://other.example", "ws://localhost:*", "wss://other.example"]);
    store.plugins.DASS.enabled = false;
    syncBackendCsp();
    expect(Object.keys(policies)).toEqual(["ws://localhost:*"]);
});

test("never adds non-HTTPS, credentialed or policy-breaking origins", () => {
    for (const value of [undefined, 42, "http://dass.example", "https://user:pass@dass.example", "https://[::1]:8080", "not a url", "https://dass.example;script-src*"]) {
        expect(backendCspSources(value)).toEqual([]);
    }
    expect(backendCspSources("https://DASS.Example:443/")).toEqual(["https://dass.example", "wss://dass.example"]);
});
