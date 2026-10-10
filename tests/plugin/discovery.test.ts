import { describe, expect, test } from "bun:test";

import { DiscoveryController } from "../../plugins/dass/controller";
import { fetchScaffoldCapabilities, getCapabilitiesUrl, MAX_DISCOVERY_BYTES, parseScaffoldCapabilities } from "../../plugins/dass/discovery";
import scaffold from "./fixtures/scaffold-capabilities.json";

const configuration = { backendUrl: "http://127.0.0.1:8080", allowInsecureLocalDevelopment: true };

function mockFetch(callback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
    return callback as typeof fetch;
}

describe("backend URL policy", () => {
    test("preserves a deployment path", () => {
        expect(getCapabilitiesUrl("https://example.org/dass/", false).href).toBe("https://example.org/dass/v1/capabilities");
    });
    test("HTTP requires explicit loopback development", () => {
        for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
            expect(getCapabilitiesUrl(`http://${host}:8080`, true).protocol).toBe("http:");
            expect(() => getCapabilitiesUrl(`http://${host}:8080`, false)).toThrow();
        }
        expect(() => getCapabilitiesUrl("http://example.org", true)).toThrow();
    });
    test("rejects credentials and unsafe URL components", () => {
        for (const url of ["https://user:secret@example.org", "https://example.org/?secret=x", "https://example.org/#x", "file:///tmp/x", "not a URL"]) {
            expect(() => getCapabilitiesUrl(url, true)).toThrow();
        }
    });
});

describe("discovery contract", () => {
    test("accepts only the current scaffold", () => {
        expect(parseScaffoldCapabilities(scaffold)).toEqual({ insecureLocalDevelopment: true });
        for (const value of [null, [], {}, { ...scaffold, protocol_version: 2 }, { ...scaffold, stage: "live" }, { ...scaffold, ready: true }, { ...scaffold, limits: { max_concurrent_requests: -1 } }]) {
            expect(() => parseScaffoldCapabilities(value)).toThrow();
        }
        for (const field of ["ready", "signaling_available", "media_available", "e2ee_available"]) {
            expect(() => parseScaffoldCapabilities({ ...scaffold, [field]: true })).toThrow();
        }
    });
    test("sends no credentials and refuses redirects", async () => {
        const fetchImpl = mockFetch(async (_input, init) => {
            expect(init?.credentials).toBe("omit");
            expect(init?.redirect).toBe("error");
            expect(init?.referrerPolicy).toBe("no-referrer");
            return Response.json(scaffold);
        });
        await fetchScaffoldCapabilities(getCapabilitiesUrl(configuration.backendUrl, true), new AbortController().signal, fetchImpl);
    });
    test("bounds response bytes, even without content-length", async () => {
        const fetchImpl = mockFetch(async () => new Response(" ".repeat(MAX_DISCOVERY_BYTES + 1), { headers: { "content-type": "application/json" } }));
        await expect(fetchScaffoldCapabilities(new URL("https://example.org"), new AbortController().signal, fetchImpl)).rejects.toThrow();
    });
    test("rejects HTTP failures, non-JSON and malformed JSON", async () => {
        for (const response of [new Response(null, { status: 503 }), new Response("<html>"), new Response("{", { headers: { "content-type": "application/json" } })]) {
            await expect(fetchScaffoldCapabilities(new URL("https://example.org"), new AbortController().signal, mockFetch(async () => response))).rejects.toThrow();
        }
    });
});

describe("lifecycle", () => {
    test("aborts discovery after the deadline", async () => {
        const controller = new DiscoveryController(mockFetch(async (_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        })));
        controller.start();
        await controller.check(configuration);
        expect(controller.getSnapshot().phase).toBe("failed");
        expect(controller.getSnapshot().message).toContain("timed out");
        controller.stop();
    }, 10_000);
    test("stop aborts and late completion cannot revive the plugin", async () => {
        let finish!: (response: Response) => void;
        let signal: AbortSignal | undefined;
        const controller = new DiscoveryController(mockFetch(async (_input, init) => {
            signal = init?.signal as AbortSignal;
            return new Promise(resolve => { finish = resolve; });
        }));
        controller.start();
        const pending = controller.check(configuration);
        controller.stop();
        controller.stop();
        expect(signal?.aborted).toBe(true);
        finish(Response.json(scaffold));
        await pending;
        expect(controller.getSnapshot().phase).toBe("stopped");
    });
    test("changing settings invalidates pending discovery", async () => {
        let finish!: (response: Response) => void;
        const controller = new DiscoveryController(mockFetch(async () => new Promise(resolve => { finish = resolve; })));
        controller.start();
        const pending = controller.check(configuration);
        controller.reset();
        finish(Response.json(scaffold));
        await pending;
        expect(controller.getSnapshot().phase).toBe("idle");
    });
    test("an older check cannot overwrite a newer result", async () => {
        let finish!: (response: Response) => void;
        let calls = 0;
        const controller = new DiscoveryController(mockFetch(async () => {
            if (++calls === 1) return new Promise(resolve => { finish = resolve; });
            return new Response(null, { status: 503 });
        }));
        controller.start();
        const previous = controller.check(configuration);
        await controller.check(configuration);
        finish(Response.json(scaffold));
        await previous;
        expect(controller.getSnapshot().phase).toBe("failed");
    });
    test("reaches scaffold but never advertises sharing", async () => {
        const controller = new DiscoveryController(mockFetch(async () => Response.json(scaffold)));
        controller.start();
        await controller.check(configuration);
        expect(controller.getSnapshot().phase).toBe("scaffold");
        expect(controller.getSnapshot().message).toContain("Sharing is disabled");
    });
    test("rejects insecure server mode unless explicitly allowed", async () => {
        const controller = new DiscoveryController(mockFetch(async () => Response.json(scaffold)));
        controller.start();
        await controller.check({ backendUrl: "https://example.org", allowInsecureLocalDevelopment: false });
        expect(controller.getSnapshot().phase).toBe("failed");
    });
});
