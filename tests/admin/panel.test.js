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

async function setup(page, response) {
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
        document,
        location: { pathname: `/admin/${page}` },
        confirm: () => true,
        fetch: async (url, options) => {
            requests.push({ url, ...options });
            return { ok: true, status: options.method === "GET" ? 200 : 204, json: async () => response };
        }
    };
    runInNewContext(source.replace(/run\(load\);\s*$/, "globalThis.pageReady = run(load);"), context);
    await context.pageReady;
    return { context, document, requests, title, content, message };
}

describe("DASS control panel", () => {
    test("users render as text, not HTML, and editing does not reveal a hash", async () => {
        const user = { username: "alice", display_name: "<img src=x>", expires_at_unix_seconds: 2000000000, revoked: false, allowed_ips: [], rooms: [] };
        const fixture = await setup("users", [user]);
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

    test("user writes use CSRF header and structured grants/IPs, then clear password input", async () => {
        const fixture = await setup("users", []);
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        const password = inputs.find(input => input.type === "password");
        password.value = "a long user password";
        const textareas = descendants(editor).filter(element => element.tag === "textarea");
        textareas[0].value = "192.168.1.20\n::1";
        textareas[1].value = "room_1 viewer\nroom_2 publisher";
        await editor.listeners.submit({ preventDefault() {} });
        const write = fixture.requests.find(request => request.method === "PUT");
        expect(write.url).toBe("/admin/api/users/alice");
        expect(write.headers["Content-Type"]).toBe("application/json");
        expect(write.headers["X-DASS-Admin"]).toBe("1");
        const body = JSON.parse(write.body);
        expect(body.allowed_ips).toEqual(["192.168.1.20", "::1"]);
        expect(body.rooms).toEqual([
            { room_id: "room_1", access: true, publish: false, subscribe: true },
            { room_id: "room_2", access: true, publish: true, subscribe: false }
        ]);
        expect(password.value).toBe("");
        expect(fixture.message.textContent).toContain("User saved");
    });

    test("room list combines configured, live and blocked IDs", async () => {
        const fixture = await setup("rooms", { rooms: [{ room_id: "live", members: 2 }], blocked_rooms: ["blocked"], configured_rooms: ["configured"] });
        expect(fixture.title.textContent).toBe("Rooms");
        const rows = descendants(fixture.content).filter(element => element.tag === "tr");
        expect(rows.length).toBe(4);
        expect(fixture.content.textContent).toContain("Blocked");
        expect(fixture.content.textContent).toContain("Disconnect all DASS sessions");
    });

    test("stream page explicitly reports browser playback unavailable", async () => {
        const fixture = await setup("streams", { streams: [{ username: "alice", room_id: "room_1", publisher_id: "stream_1" }], watch_available: false });
        expect(fixture.title.textContent).toBe("Streams");
        expect(fixture.content.textContent).toContain("Browser watching is not available");
        expect(fixture.content.textContent).toContain("alice");
        expect(fixture.content.textContent).toContain("stream_1");
        expect(descendants(fixture.content).some(element => element.tag === "video")).toBe(false);
    });

    test("API failures are shown without leaving buttons disabled", async () => {
        const fixture = await setup("users", []);
        fixture.context.fetch = async () => ({ ok: false, status: 401 });
        await fixture.context.run(fixture.context.loadUsers);
        expect(fixture.message.textContent).toContain("Administrator login was rejected");
        expect(fixture.document.querySelectorAll("button").every(button => !button.disabled)).toBe(true);
    });

    test("short passwords are rejected visibly before any write request", async () => {
        const fixture = await setup("users", []);
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
        const fixture = await setup("users", []);
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs[0].value = "alice";
        inputs.find(input => input.type === "password").value = "é".repeat(6);
        await editor.listeners.submit({ preventDefault() {} });
        expect(fixture.requests.some(request => request.method === "PUT")).toBe(true);
        expect(fixture.message.textContent).toContain("User saved");
    });

    test("room and IP validation explains invalid input without sending changes", async () => {
        const fixture = await setup("users", []);
        expect(fixture.context.parseRoomGrants("* both")[0]).toEqual({ room_id: "*", access: true, publish: true, subscribe: true });
        for (const input of ["room_1", "room_1 unknown", "room_1 both\nroom_1 viewer", "bad/id both"]) {
            expect(() => fixture.context.parseRoomGrants(input)).toThrow();
        }
        expect(fixture.context.parseAllowedIps("192.168.1.20\n0:0:0:0:0:0:0:1")).toEqual(["192.168.1.20", "::1"]);
        for (const input of ["example.org", "127.0.0.1/24", "256.1.1.1", "0.0.0.0", "::", "ff02::1", "::1 0:0:0:0:0:0:0:1"]) {
            expect(() => fixture.context.parseAllowedIps(input)).toThrow();
        }
    });

    test("permission helper adds an explicitly selected all-rooms role", async () => {
        const fixture = await setup("users", []);
        fixture.context.editUser();
        const editor = fixture.document.querySelector("#user-editor");
        const inputs = descendants(editor).filter(element => element.tag === "input");
        inputs.at(-1).value = "*";
        const role = descendants(editor).find(element => element.tag === "select");
        role.value = "viewer";
        const add = descendants(editor).find(element => element.tag === "button" && element.textContent === "Add permission");
        await add.listeners.click();
        const grants = descendants(editor).filter(element => element.tag === "textarea")[1];
        expect(grants.value).toBe("* viewer");
    });

    test("a successful save followed by a failed refresh is not reported as a failed save", async () => {
        const fixture = await setup("users", []);
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
