"use strict";

const content = document.querySelector("#content");
const message = document.querySelector("#message");
const page = location.pathname.split("/")[2] || "users";
let busy = false;

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function button(text, action) {
    const element = node("button", text);
    element.type = "button";
    element.addEventListener("click", () => run(action));
    return element;
}

async function api(path, method = "GET", body) {
    const response = await fetch(`/admin/api/${path}`, {
        method,
        credentials: "same-origin",
        headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-DASS-Admin": "1" },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
        const detail = [400, 422].includes(response.status) ? await response.text() : ({
            401: "Administrator login was rejected. Reload the page and sign in again.",
            403: "Request blocked. Open the panel directly on its backend origin; writes require same-origin JSON.",
            413: "The account configuration is too large.",
            429: "Too many requests. Wait a second and try again. Your changes have not been discarded.",
            503: "The backend is busy or policy is unavailable. Wait and try again; check volume permissions if it persists."
        }[response.status] || `Request failed (${response.status}).`);
        throw new Error(detail);
    }
    return response.status === 204 ? undefined : response.json();
}

async function run(action) {
    if (busy) return;
    busy = true;
    message.textContent = "";
    document.querySelectorAll("button").forEach(element => { element.disabled = true; });
    try { await action(); } catch (error) {
        message.textContent = error.message;
        message.scrollIntoView?.({ block: "nearest" });
    }
    finally {
        busy = false;
        document.querySelectorAll("button").forEach(element => { element.disabled = false; });
    }
}

function table(headings) {
    const wrapper = node("div", undefined, "table-wrap");
    const element = node("table");
    const head = node("thead");
    const row = node("tr");
    headings.forEach(heading => row.append(node("th", heading)));
    head.append(row);
    const body = node("tbody");
    element.append(head, body);
    wrapper.append(element);
    content.append(wrapper);
    return body;
}

function field(form, title, value, type = "text") {
    const label = node("label");
    label.append(node("span", title));
    const input = node(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    if (type === "checkbox") input.checked = value;
    else input.value = value ?? "";
    input.addEventListener("input", () => {
        input.removeAttribute?.("aria-invalid");
        input.setCustomValidity?.("");
    });
    label.append(input);
    form.append(label);
    return input;
}

function invalidField(input, text) {
    input.setAttribute("aria-invalid", "true");
    input.setCustomValidity?.(text);
    input.focus();
    throw new Error(text);
}

function parseRoomGrants(value) {
    if (!value.trim()) return [];
    const seen = new Set();
    const grants = value.trim().split(/\n/).map((line, index) => {
        const [room_id, role, extra] = line.trim().split(/\s+/);
        if (extra || !["both", "publisher", "viewer", "access", "none"].includes(role)) {
            throw new Error(`Room line ${index + 1}: use ROOM_ID ROLE (both, publisher, viewer, access or none).`);
        }
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(room_id) && room_id !== "*") throw new Error(`Room line ${index + 1}: invalid room ID.`);
        if (seen.has(room_id)) throw new Error("Room grants must not contain duplicate room IDs.");
        seen.add(room_id);
        return { room_id, access: role !== "none", publish: ["both", "publisher"].includes(role), subscribe: ["both", "viewer"].includes(role) };
    });
    if (grants.length > 16) throw new Error("Each user can have at most 16 room grants.");
    return grants;
}

function parseAllowedIps(value) {
    if (!value.trim()) return [];
    const seen = new Set();
    const ips = value.trim().split(/\s+/).map(ip => {
        let normalized;
        if (ip.includes(":")) {
            if (!/^[0-9a-fA-F:.]+$/.test(ip)) throw new Error("Allowed IPs must be exact IPv4 or IPv6 addresses, not CIDRs or hostnames.");
            try { normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
            catch { throw new Error("Invalid IPv6 address in allowed IPs."); }
            if (normalized === "::" || normalized.startsWith("ff")) throw new Error("Allowed IPs must not be unspecified or multicast addresses.");
        } else {
            const octets = ip.split(".");
            if (octets.length !== 4 || octets.some(octet => !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)) {
                throw new Error("Allowed IPs must be exact IPv4 or IPv6 addresses, not CIDRs or hostnames.");
            }
            normalized = octets.map(Number).join(".");
            if (normalized === "0.0.0.0" || (Number(octets[0]) >= 224 && Number(octets[0]) <= 239)) {
                throw new Error("Allowed IPs must not be unspecified or multicast addresses.");
            }
        }
        if (seen.has(normalized)) throw new Error("Allowed IPs must not contain duplicates.");
        seen.add(normalized);
        return normalized;
    });
    if (ips.length > 16) throw new Error("Each user can have at most 16 allowed IPs.");
    return ips;
}

function editUser(user = {}) {
    document.querySelector("#user-editor")?.remove();
    const form = node("form");
    // Always dispatch submit so validation errors reach the visible status area.
    form.noValidate = true;
    form.id = "user-editor";
    form.append(node("h2", user.username ? `Edit ${user.username}` : "Add user"));
    const username = field(form, "Username (letters, digits, underscore, hyphen)", user.username);
    username.required = true;
    username.maxLength = 64;
    username.readOnly = Boolean(user.username);
    const displayName = field(form, "Display name (optional)", user.display_name);
    const password = field(form, user.username ? "New password (blank keeps current password)" : "Password (12–512 bytes)", "", "password");
    password.autocomplete = "new-password";
    password.required = !user.username;
    const passwordHint = node("p", "Use 12–512 UTF-8 bytes; non-ASCII characters may use multiple bytes.", "hint");
    password.addEventListener("input", () => {
        passwordHint.textContent = `${new TextEncoder().encode(password.value).length} / 512 bytes (minimum 12 for a new password).`;
    });
    form.append(passwordHint);
    const expires = field(form, "Expires (your local time)", "", "datetime-local");
    const date = new Date((user.expires_at_unix_seconds || Math.floor(Date.now() / 1000) + 30 * 86400) * 1000);
    expires.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    expires.required = true;
    const revoked = field(form, "Revoked / disabled", user.revoked || false, "checkbox");
    const ips = field(form, "Allowed exact IPs (one per line; empty allows any TCP peer)", (user.allowed_ips || []).join("\n"), "textarea");
    form.append(node("p", "Checked against the accepted connection's IP, never forwarding headers. This does not edit firewall rules. Maximum 16 IPs.", "hint"));
    const grants = field(form, "Room permissions (one per line: ROOM_ID ROLE)", (user.rooms || []).map(grant => `${grant.room_id} ${grant.publish && grant.subscribe ? "both" : grant.publish ? "publisher" : grant.subscribe ? "viewer" : grant.access ? "access" : "none"}`).join("\n"), "textarea");
    form.append(node("p", "Roles: both, publisher, viewer, access, none. Maximum 16 rooms. The explicit * selector grants every room; exact 'none' entries cannot override it. Room IDs do not prove Discord membership.", "hint"));
    const grantRoom = field(form, "Add a room permission", "");
    grantRoom.placeholder = "Exact room ID, or * for all rooms";
    const roleLabel = node("label");
    roleLabel.append(node("span", "Role"));
    const role = node("select");
    for (const [value, text] of [["both", "Publish and watch"], ["publisher", "Publish only"], ["viewer", "Watch only"], ["access", "Access only"], ["none", "No permissions"]]) {
        const option = node("option", text);
        option.value = value;
        role.append(option);
    }
    role.value = "both";
    roleLabel.append(role);
    form.append(roleLabel, button("Add permission", () => {
        const roomId = grantRoom.value.trim();
        if (!roomId) invalidField(grantRoom, "Enter a room ID, or * for explicit all-rooms access.");
        const next = [grants.value.trim(), `${roomId} ${role.value}`].filter(Boolean).join("\n");
        parseRoomGrants(next);
        if (roomId === "*" && !confirm("Grant this user access to every DASS room? Discord call membership is not verified.")) return;
        grants.value = next;
        grantRoom.value = "";
    }));
    form.append(node("p", "Saving or removing a user disconnects all current DASS sessions. Streams do not restart automatically.", "hint"));
    const save = node("button", "Save user");
    save.type = "submit";
    form.append(save, button("Cancel", () => form.remove()));
    form.addEventListener("submit", event => {
        event.preventDefault();
        return run(async () => {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(username.value)) invalidField(username, "Username must contain 1–64 ASCII letters, digits, underscores or hyphens.");
            const passwordBytes = new TextEncoder().encode(password.value).length;
            if ((!user.username || password.value) && (passwordBytes < 12 || passwordBytes > 512)) invalidField(password, "Password must contain 12–512 UTF-8 bytes.");
            if (/\p{Cc}/u.test(password.value)) invalidField(password, "Password must not contain control characters.");
            if (displayName.value && (!displayName.value.trim() || new TextEncoder().encode(displayName.value).length > 128 || /\p{Cc}/u.test(displayName.value))) invalidField(displayName, "Display name must contain 1–128 UTF-8 bytes, non-whitespace text and no control characters.");
            const expiresSeconds = Math.floor(new Date(expires.value).getTime() / 1000);
            if (!Number.isInteger(expiresSeconds) || expiresSeconds <= 0 || expiresSeconds > 4294967295) invalidField(expires, "Choose a valid expiration date before February 2106.");
            let rooms, allowedIps;
            try { rooms = parseRoomGrants(grants.value); } catch (error) { invalidField(grants, error.message); }
            try { allowedIps = parseAllowedIps(ips.value); } catch (error) { invalidField(ips, error.message); }
            if (!rooms.some(grant => grant.access) && !confirm("This user has no room access and will not be able to publish or watch. Save anyway?")) return;
            const passwordValue = password.value;
            password.value = "";
            await api(`users/${encodeURIComponent(username.value)}`, "PUT", {
                password: passwordValue || null,
                display_name: displayName.value || null,
                expires_at_unix_seconds: expiresSeconds,
                revoked: revoked.checked,
                allowed_ips: allowedIps,
                rooms
            });
            message.textContent = "User saved. Existing sessions disconnected.";
            try { await loadUsers(); }
            catch { form.remove(); message.textContent += " The list could not refresh; use Refresh. Do not resubmit."; }
        });
    });
    content.append(form);
    username.focus();
}

async function loadUsers() {
    const users = await api("users");
    content.replaceChildren();
    content.append(button("Add user", () => editUser()));
    const body = table(["User", "Status", "Allowed IPs", "Actions"]);
    users.sort((a, b) => a.username.localeCompare(b.username)).forEach(user => {
        const row = node("tr");
        row.append(node("td", user.display_name ? `${user.username} · ${user.display_name}` : user.username));
        row.append(node("td", user.revoked ? "Revoked" : user.expires_at_unix_seconds <= Date.now() / 1000 ? "Expired" : "Enabled"));
        row.append(node("td", (user.allowed_ips || []).join(", ") || "Any observed IP"));
        const actions = node("td");
        actions.append(button("Edit", () => editUser(user)), button("Remove", async () => {
            if (!confirm(`Remove ${user.username}? This disconnects all DASS sessions.`)) return;
            await api(`users/${encodeURIComponent(user.username)}`, "DELETE");
            await loadUsers();
            message.textContent = "User removed. Existing sessions disconnected.";
        }));
        row.append(actions);
        body.append(row);
    });
    if (!users.length) content.append(node("p", "No users yet. Add one to grant DASS access."));
}

async function loadRooms() {
    const status = await api("status");
    content.replaceChildren();
    content.append(node("p", "Rooms are created by authorized client activity. Blocking denies access even for wildcard grants. Policy changes disconnect all DASS sessions; ordinary Discord voice is unaffected.", "hint"));
    const body = table(["Room", "Members", "Policy", "Action"]);
    const ids = new Set([...status.rooms.map(room => room.room_id), ...status.blocked_rooms, ...status.configured_rooms]);
    [...ids].sort().forEach(id => {
        const blocked = status.blocked_rooms.includes(id);
        const row = node("tr");
        row.append(node("td", id), node("td", String(status.rooms.find(room => room.room_id === id)?.members || 0)), node("td", blocked ? "Blocked" : "Allowed by user grants"));
        const action = node("td");
        action.append(button(blocked ? "Unblock" : "Block", async () => {
            if (!confirm("Apply room policy and disconnect all DASS sessions?")) return;
            await api(`rooms/${encodeURIComponent(id)}`, "PUT", { blocked: !blocked });
            await loadRooms();
        }));
        row.append(action);
        body.append(row);
    });
    const form = node("form");
    form.noValidate = true;
    const room = field(form, "Block a room ID", "");
    room.required = true;
    const submit = node("button", "Block room");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", event => {
        event.preventDefault();
        return run(async () => {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(room.value)) invalidField(room, "Room ID must contain 1–64 ASCII letters, digits, underscores or hyphens.");
            if (!confirm("Block this room and disconnect all DASS sessions?")) return;
            await api(`rooms/${encodeURIComponent(room.value)}`, "PUT", { blocked: true });
            await loadRooms();
        });
    });
    content.append(form, button("Disconnect all DASS sessions", async () => {
        if (!confirm("Disconnect all publishers, viewers and idle DASS connections?")) return;
        await api("disconnect", "POST", {});
        message.textContent = "Session disconnect requested. Refresh to see cleanup.";
    }));
}

async function loadStreams() {
    const status = await api("status");
    content.replaceChildren();
    content.append(node("p", "Browser watching is not available in this version. The experimental transport allows one publisher and one viewer backend-wide, and its signaling accepts the Discord client origin only. Watch with an authorized DASS client; administrator credentials do not grant media access.", "hint"));
    const body = table(["Publisher", "Room", "Stream ID"]);
    status.streams.forEach(stream => {
        const row = node("tr");
        row.append(node("td", stream.username), node("td", stream.room_id), node("td", stream.publisher_id));
        body.append(row);
    });
    if (!status.streams.length) content.append(node("p", "No connected publisher streams."));
}

document.querySelector("#title").textContent = { users: "Users", rooms: "Rooms", streams: "Streams" }[page];
document.querySelector(`a[href="/admin/${page}"]`)?.setAttribute("aria-current", "page");
const load = { users: loadUsers, rooms: loadRooms, streams: loadStreams }[page];
const refresh = button("Refresh", load);
document.querySelector("main").insertBefore(refresh, content);
run(load);
