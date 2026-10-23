import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../crates/backend/src/admin/app.js", import.meta.url), "utf8");

// Small DOM fixture for UI logic only, not a browser/capture compatibility test.
class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.value = "";
        this.text = "";
    }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(" "); }
    append(...children) {
        children.forEach(child => { child.parent = this; this.children.push(child); });
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    insertBefore(child, before) {
        child.parent = this;
        this.children.splice(this.children.indexOf(before), 0, child);
    }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    setAttribute(name, value) { this.attributes[name] = value; }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
    focus() { this.focused = true; }
}

function descendants(element) {
    return [element, ...element.children.flatMap(descendants)];
}

async function setup(page, responses = {}) {
    const root = new Element("body");
    const main = new Element("main");
    const title = new Element("h1"); title.id = "title";
    const message = new Element("p"); message.id = "message";
    const content = new Element("div"); content.id = "content";
    main.append(title, message, content);
    root.append(main);
    const document = {
        createElement: tag => new Element(tag),
        querySelector: selector => selector.startsWith("#")
            ? descendants(root).find(element => element.id === selector.slice(1)) || null
            : descendants(root).find(element => element.tag === selector) || null,
        querySelectorAll: selector => descendants(root).filter(element => element.tag === selector)
    };
    const requests = [];
    const context = {
        TextEncoder,
        URL,
        setTimeout: () => 1,
        clearTimeout: () => {},
        navigator: { clipboard: { writeText: async () => {} } },
        document,
        location: { pathname: `/admin/${page}` },
        confirm: () => true,
        fetch: async (url, options) => {
            requests.push({ url, ...options });
            const key = url.split("/").pop();
            const payload = responses[key] ?? responses.default ?? {};
            return { ok: true, status: options.method === "GET" ? 200 : 204, json: async () => payload };
        }
    };
    runInNewContext(source.replace(/run\(load\);\s*$/, "globalThis.pageReady = run(load);"), context);
    await context.pageReady;
    return { context, document, requests, title, content, message };
}

const EMPTY_METRICS = { events: [] };

describe("DASS control panel", () => {
    test("logs render JSON lines, filter client/server and copy only the selected source", async () => {
        const entries = [
            { source: "server", event: "backend listening", at_unix_ms: 1700000000000, received_at_unix_ms: 1700000000001 },
            { source: "client", client_id: "client_a", event: "media stats", at_unix_ms: 1700000000002, received_at_unix_ms: 1700000000003 }
        ];
        const fixture = await setup("logs", { logs: { entries, capacity: 512 } });
        expect(fixture.title.textContent).toBe("Logs");
        expect(fixture.requests[0].url).toBe("/admin/api/logs");
        const text = descendants(fixture.content).find(element => element.tag === "textarea");
        expect(text.readOnly).toBe(true);
        expect(text.value.split("\n").map(JSON.parse)).toHaveLength(2);
        const source = descendants(fixture.content).find(element => element.tag === "select");
        source.value = "client_a";
        source.listeners.change();
        const selected = JSON.parse(text.value);
        expect(selected.client_id).toBe("client_a");
        expect(selected.time).toBe("2023-11-14T22:13:20.002Z");
        let copied;
        fixture.context.navigator.clipboard.writeText = async value => { copied = value; };
        const copy = descendants(fixture.content).find(element => element.textContent === "Copy JSON lines");
        await copy.listeners.click();
        expect(copied).toBe(text.value);
        expect(fixture.message.textContent).toBe("Logs copied.");
        const pause = descendants(fixture.content).find(element => element.textContent === "Pause");
        await pause.listeners.click();
        expect(pause.textContent).toBe("Resume");
    });
    test("default administrator is shown only the required password-change form", async () => {
        const fixture = await setup("administrators", { administrators: {
            current_username: "admin", must_change_password: true,
            administrators: [{ username: "admin", must_change_password: true }]
        } });
        expect(fixture.title.textContent).toBe("Administrators");
        expect(fixture.content.textContent).toContain("default admin/admin");
        expect(fixture.content.textContent).not.toContain("Add administrator");
        const form = fixture.document.querySelector("#administrator-editor");
        const inputs = descendants(form).filter(element => element.tag === "input");
        expect(inputs[0].readOnly).toBe(true);
        inputs[1].value = inputs[2].value = "a long changed password";
        await form.listeners.submit({ preventDefault() {} });
        const write = fixture.requests.find(request => request.method === "PUT");
        expect(write.url).toBe("/admin/api/administrators/admin");
        expect(write.headers["X-DASS-Admin"]).toBe("1");
        expect(JSON.parse(write.body)).toEqual({ password: "a long changed password" });
        expect(inputs[1].value).toBe("");
        expect(inputs[2].value).toBe("");
        expect(fixture.content.textContent).toContain("sign in");
        expect(fixture.requests.length).toBe(2); // no stale-password refresh after own reset
    });

    test("administrators can be added without exposing hashes and the last has no remove button", async () => {
        const fixture = await setup("administrators", { administrators: {
            current_username: "admin", must_change_password: false,
            administrators: [{ username: "admin", must_change_password: false }]
        } });
        expect(fixture.content.textContent).not.toContain("argon2");
        expect(descendants(fixture.content).some(element => element.tag === "button" && element.textContent === "Remove")).toBe(false);
        fixture.context.editAdministrator(null, "admin");
        const form = fixture.document.querySelector("#administrator-editor");
        const inputs = descendants(form).filter(element => element.tag === "input");
        inputs[0].value = "operator";
        inputs[1].value = "a long other password";
        inputs[2].value = "different";
        await form.listeners.submit({ preventDefault() {} });
        expect(fixture.requests.some(request => request.method === "PUT")).toBe(false);
        expect(fixture.message.textContent).toBe("Passwords do not match.");
        inputs[2].value = inputs[1].value;
        await form.listeners.submit({ preventDefault() {} });
        expect(fixture.requests.find(request => request.method === "PUT").url).toBe("/admin/api/administrators/operator");
        expect(fixture.message.textContent).toContain("Changes apply immediately");
    });

    test("settings distinguish saved and active values and keep anonymous access read-only", async () => {
        const fixture = await setup("settings", { settings: {
            saved: { DASS_MAX_SESSIONS: "64", DASS_MAX_UNAUTHENTICATED_SESSIONS: "0", DASS_ADMIN_DATA_FILE: "/var/lib/dass/policy.json" },
            active: { DASS_MAX_SESSIONS: "128", DASS_MAX_UNAUTHENTICATED_SESSIONS: "0", DASS_ADMIN_DATA_FILE: "/var/lib/dass/policy.json" },
            read_only: ["DASS_MAX_UNAUTHENTICATED_SESSIONS", "DASS_ADMIN_DATA_FILE"],
            restart_required: true
        } });
        expect(fixture.title.textContent).toBe("Settings");
        expect(fixture.content.textContent).toContain("Restart the backend");
        expect(fixture.content.textContent).toContain("Running value: 128");
        const inputs = descendants(fixture.content).filter(element => element.tag === "input");
        expect(inputs[1].readOnly).toBe(true);
        expect(inputs[2].readOnly).toBe(true);
        inputs[0].value = "32";
        const form = descendants(fixture.content).find(element => element.tag === "form");
        await form.listeners.submit({ preventDefault() {} });
        const write = fixture.requests.find(request => request.method === "PUT");
        expect(write.url).toBe("/admin/api/settings");
        expect(write.headers["X-DASS-Admin"]).toBe("1");
        expect(JSON.parse(write.body).DASS_MAX_SESSIONS).toBe("32");
        expect(fixture.message.textContent).toContain("Settings saved to SQLite");
    });

    test("users render as text, not HTML, and editing does not reveal a hash", async () => {
        const user = { username: "alice", display_name: "<img src=x>" };
        const fixture = await setup("users", { users: [user], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        expect(fixture.title.textContent).toBe("Users");
        expect(fixture.content.textContent).toContain("<img src=x>");
        expect(fixture.requests[0].url).toBe("/admin/api/users");
        expect(fixture.requests[0].credentials).toBe("same-origin");
        fixture.context.editUser(user);
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        expect(inputs[0].readOnly).toBe(true);
        expect(inputs.find(input => input.type === "password").value).toBe("");
        expect(editor.textContent).not.toContain("argon2");
    });

    test("user writes use the CSRF header and only password/display-name fields", async () => {
        const fixture = await setup("users", { users: [], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        const password = inputs.find(input => input.type === "password");
        password.value = "a long user password";
        // Version-2 editors contain no room grant, IP or role inputs at all.
        expect(descendants(editor).filter(element => element.tag === "textarea").length).toBe(0);
        expect(descendants(editor).filter(element => element.tag === "select").length).toBe(0);
        await editor.listeners.submit({ preventDefault() {} });
        const write = fixture.requests.find(request => request.method === "PUT");
        expect(write.url).toBe("/admin/api/users/alice");
        expect(write.headers["Content-Type"]).toBe("application/json");
        expect(write.headers["X-DASS-Admin"]).toBe("1");
        const body = JSON.parse(write.body);
        expect(body).toEqual({ password: "a long user password", display_name: null });
        expect(password.value).toBe("");
        expect(fixture.message.textContent).toContain("User saved");
    });

    test("users show online state, observed source addresses and activity", async () => {
        const fixture = await setup("users", {
            users: [{ username: "alice", display_name: "Alice" }, { username: "bob" }],
            status: {
                users: [{
                    username: "alice",
                    online: true,
                    connections: [{ session_id: "session_1", room_id: "live", role: "publisher", source_ip: "203.0.113.7", connected_at_unix_seconds: 1700000000 }],
                    rooms: ["live"],
                    publishing: ["stream_1"],
                    watching: []
                }],
                rooms: [], streams: [], metrics: EMPTY_METRICS
            }
        });
        expect(fixture.content.textContent).toContain("online");
        expect(fixture.content.textContent).toContain("offline");
        expect(fixture.content.textContent).toContain("203.0.113.7");
        expect(fixture.content.textContent).toContain("publisher");
        expect(fixture.content.textContent).toContain("stream_1");
        // The offline account has no live connection details.
        expect(fixture.content.textContent).toContain("no live connections");
    });

    test("rooms are a read-only grouping view without block controls", async () => {
        const fixture = await setup("rooms", {
            status: {
                rooms: [{ room_id: "live", members: 3, publishers: ["alice"], viewers: ["bob"], others: ["carol"], streams: ["stream_1"] }],
                streams: [], metrics: EMPTY_METRICS
            }
        });
        expect(fixture.title.textContent).toBe("Rooms");
        const rows = descendants(fixture.content).filter(element => element.tag === "tr");
        expect(rows.length).toBe(2);
        expect(fixture.content.textContent).toContain("read-only");
        expect(fixture.content.textContent).not.toContain("Blocked");
        // Publishers, viewers and plain members are distinguished.
        expect(fixture.content.textContent).toContain("alice");
        expect(fixture.content.textContent).toContain("bob");
        expect(fixture.content.textContent).toContain("carol");
        // Session actions belong to the Streams page, so the rooms page never writes.
        expect(fixture.requests.every(request => request.method === "GET")).toBe(true);
    });

    test("stream page reports browser playback unavailable and lists pending requests", async () => {
        const fixture = await setup("streams", {
            status: {
                streams: [{ username: "alice", room_id: "room_1", publisher_id: "stream_1", viewer_count: 1, pending_view_requests: 2, started_at_unix_seconds: 1700000000, connection_state: "connected", ingress_bytes_per_second: 2048, egress_bytes_per_second: 4096, viewers: [{ session_id: "viewer_1", username: "bob" }] }],
                watch_available: false, metrics: EMPTY_METRICS
            }
        });
        expect(fixture.title.textContent).toBe("Streams");
        expect(fixture.content.textContent).toContain("Browser watching is not available");
        expect(fixture.content.textContent).toContain("alice");
        expect(fixture.content.textContent).toContain("stream_1");
        expect(fixture.content.textContent).toContain("2");
        expect(descendants(fixture.content).some(element => element.tag === "video")).toBe(false);
    });

    test("streams show who watches whom, the start time and measured bitrates", async () => {
        const fixture = await setup("streams", {
            status: {
                streams: [{
                    username: "alice", room_id: "room_1", publisher_id: "stream_1", viewer_count: 1,
                    pending_view_requests: 0, started_at_unix_seconds: 1700000000, connection_state: "connected",
                    ingress_bytes_per_second: 2048, egress_bytes_per_second: 4096,
                    viewers: [{ session_id: "viewer_1", username: "bob" }]
                }],
                metrics: EMPTY_METRICS
            }
        });
        expect(fixture.content.textContent).toContain("bob (viewer_1)");
        expect(fixture.content.textContent).toContain("2023-11-14");
        expect(fixture.content.textContent).toContain("2.05 kB/s");
        expect(fixture.content.textContent).toContain("4.10 kB/s");
        expect(fixture.content.textContent).toContain("connected");
    });

    test("stopping a stream posts to the stream endpoint with the CSRF header", async () => {
        const fixture = await setup("streams", {
            status: {
                streams: [{ username: "alice", room_id: "room_1", publisher_id: "stream_1", viewer_count: 0, pending_view_requests: 0, started_at_unix_seconds: 1700000000, connection_state: "connected", viewers: [] }],
                metrics: EMPTY_METRICS
            }
        });
        const stop = descendants(fixture.content).find(element => element.tag === "button" && element.textContent === "Stop stream");
        expect(stop).toBeDefined();
        await stop.listeners.click();
        const write = fixture.requests.find(request => request.method === "POST");
        expect(write.url).toBe("/admin/api/streams/stream_1/stop");
        expect(write.headers["X-DASS-Admin"]).toBe("1");
        expect(write.headers["Content-Type"]).toBe("application/json");
    });

    test("every page shows the bounded operational log", async () => {
        const fixture = await setup("rooms", {
            status: {
                rooms: [], streams: [],
                metrics: { events: [{ at_unix_seconds: 1700000000, severity: "warning", code: "login_failed" }] }
            }
        });
        expect(fixture.content.textContent).toContain("Recent events");
        expect(fixture.content.textContent).toContain("login_failed");
        expect(fixture.content.textContent).toContain("warning");
        expect(fixture.content.textContent).toContain("2023-11-14");
    });

    test("API failures are shown without leaving buttons disabled", async () => {
        const fixture = await setup("users", { users: [], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        fixture.context.fetch = async () => ({ ok: false, status: 401 });
        await fixture.context.run(fixture.context.loadUsers);
        expect(fixture.message.textContent).toContain("Administrator login was rejected");
        expect(fixture.document.querySelectorAll("button").every(button => !button.disabled)).toBe(true);
    });

    test("short passwords are rejected visibly before any write request", async () => {
        const fixture = await setup("users", { users: [], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        const password = inputs.find(input => input.type === "password");
        password.value = "short-value";
        await editor.listeners.submit({ preventDefault() {} });
        expect(editor.noValidate).toBe(true);
        expect(fixture.message.textContent).toBe("Password must contain 12–512 UTF-8 bytes.");
        expect(password.attributes["aria-invalid"]).toBe("true");
        expect(password.focused).toBe(true);
        expect(fixture.requests.some(request => request.method === "PUT")).toBe(false);
        expect(password.value).toBe("short-value");
    });

    test("password length uses UTF-8 bytes rather than character count", async () => {
        const fixture = await setup("users", { users: [], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        inputs.find(input => input.type === "password").value = "é".repeat(6);
        await editor.listeners.submit({ preventDefault() {} });
        expect(fixture.requests.some(request => request.method === "PUT")).toBe(true);
        expect(fixture.message.textContent).toContain("User saved");
    });

    test("a successful save followed by a failed refresh is not reported as a failed save", async () => {
        const fixture = await setup("users", { users: [], status: { users: [], rooms: [], streams: [], metrics: EMPTY_METRICS } });
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        inputs.find(input => input.type === "password").value = "a long user password";
        fixture.context.fetch = async (_, options) => options.method === "PUT"
            ? { ok: true, status: 204 }
            : { ok: false, status: 503 };
        await editor.listeners.submit({ preventDefault() {} });
        expect(fixture.message.textContent).toContain("User saved");
        expect(fixture.message.textContent).toContain("Do not resubmit");
        expect(fixture.document.querySelector("#user-editor")).toBeNull();
    });
});
