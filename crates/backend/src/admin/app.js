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
            404: "That session or stream is already gone.",
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

function table(headings, parent = content) {
    const wrapper = node("div", undefined, "table-wrap");
    const element = node("table");
    const head = node("thead");
    const row = node("tr");
    headings.forEach(heading => row.append(node("th", heading)));
    head.append(row);
    const body = node("tbody");
    element.append(head, body);
    wrapper.append(element);
    parent.append(wrapper);
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

function formatTimestamp(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "unknown";
    return new Date(value * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatBitrate(bytesPerSecond) {
    const value = Number(bytesPerSecond) || 0;
    if (value <= 0) return "0 B/s";
    if (value < 1000) return `${value} B/s`;
    if (value < 1000000) return `${(value / 1000).toFixed(2)} kB/s`;
    return `${(value / 1000000).toFixed(2)} MB/s`;
}

function list(values, empty = "none") {
    const items = Array.isArray(values) ? values : [];
    return items.length ? items.join(", ") : empty;
}

/** One bounded operational log shared by every page. Fixed codes only. */
function recentEvents(metrics) {
    const events = Array.isArray(metrics?.events) ? metrics.events : [];
    const section = node("section", undefined, "events");
    section.append(node("h2", "Recent events"));
    if (!events.length) {
        section.append(node("p", "No operational events recorded yet.", "hint"));
        return section;
    }
    const body = table(["Time", "Severity", "Code"], section);
    events.forEach(event => {
        const row = node("tr");
        row.append(
            node("td", formatTimestamp(event.at_unix_seconds)),
            node("td", String(event.severity ?? "info")),
            node("td", String(event.code ?? "unknown"))
        );
        body.append(row);
    });
    return section;
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
    form.append(node("p", "Accounts authenticate service-wide. Stream admission is decided by each publisher inside the client, never here. Saving or removing a user disconnects all current DASS sessions.", "hint"));
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
            const passwordValue = password.value;
            password.value = "";
            await api(`users/${encodeURIComponent(username.value)}`, "PUT", {
                password: passwordValue || null,
                display_name: displayName.value || null
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
    const [accounts, status] = await Promise.all([api("users"), api("status")]);
    content.replaceChildren();
    content.append(button("Add user", () => editUser()));
    const live = new Map((Array.isArray(status?.users) ? status.users : []).map(user => [user.username, user]));
    const body = table(["User", "State", "Connections", "Rooms", "Activity", "Actions"]);
    accounts.sort((a, b) => a.username.localeCompare(b.username)).forEach(account => {
        const session = live.get(account.username);
        const row = node("tr");
        row.append(node("td", account.display_name ? `${account.username} · ${account.display_name}` : account.username));
        row.append(node("td", session ? "online" : "offline"));
        const connections = session?.connections ?? [];
        row.append(node("td", connections.length
            ? connections.map(connection => `${connection.source_ip ?? "unknown address"} · ${connection.room_id} · ${connection.role}`).join("; ")
            : "no live connections"));
        row.append(node("td", list(session?.rooms)));
        row.append(node("td", `publishing: ${list(session?.publishing)}; watching: ${list(session?.watching)}`));
        const actions = node("td");
        actions.append(button("Edit", () => editUser(account)), button("Remove", async () => {
            if (!confirm(`Remove ${account.username}? This disconnects all DASS sessions.`)) return;
            await api(`users/${encodeURIComponent(account.username)}`, "DELETE");
            await loadUsers();
            message.textContent = "User removed. Existing sessions disconnected.";
        }));
        row.append(actions);
        body.append(row);
    });
    if (!accounts.length) content.append(node("p", "No users yet. Add one to grant DASS access."));
    content.append(node("p", "Source addresses are the peer of each live DASS connection. They are visible to authenticated administrators only and are discarded when the connection ends. They are not a login filter and are never shown to other clients.", "hint"));
    content.append(recentEvents(status?.metrics));
}

async function loadRooms() {
    const status = await api("status");
    content.replaceChildren();
    content.append(node("p", "Rooms are a read-only grouping view of DASS membership; they are not Discord calls and grant no stream access. Publishers decide who may watch. Stop and disconnect actions live on the Streams page.", "hint"));
    const body = table(["Room", "Members", "Publishers", "Viewers", "Connected members", "Active streams"]);
    const rooms = Array.isArray(status?.rooms) ? status.rooms : [];
    [...rooms].sort((a, b) => String(a.room_id).localeCompare(String(b.room_id))).forEach(room => {
        const row = node("tr");
        row.append(
            node("td", String(room.room_id)),
            node("td", String(room.members ?? 0)),
            node("td", list(room.publishers)),
            node("td", list(room.viewers)),
            node("td", list(room.others)),
            node("td", list(room.streams))
        );
        body.append(row);
    });
    if (!rooms.length) content.append(node("p", "No active rooms."));
    content.append(recentEvents(status?.metrics));
}

async function loadStreams() {
    const status = await api("status");
    content.replaceChildren();
    content.append(node("p", "Browser watching is not available in this version. Viewer approval belongs to each publisher's client; administrator credentials do not grant media access. Stopping a stream ends its viewer routes; it never reveals the content.", "hint"));
    const body = table(["Publisher", "Room", "Started", "Viewers", "Pending", "State", "Ingress", "Egress", "Stream ID", "Actions"]);
    const streams = Array.isArray(status?.streams) ? status.streams : [];
    streams.forEach(stream => {
        const row = node("tr");
        const viewers = Array.isArray(stream.viewers) ? stream.viewers : [];
        row.append(
            node("td", String(stream.username ?? "unknown")),
            node("td", String(stream.room_id ?? "unknown")),
            node("td", formatTimestamp(stream.started_at_unix_seconds)),
            node("td", viewers.length
                ? viewers.map(viewer => `${viewer.username ?? "unknown"} (${viewer.session_id ?? "session"})`).join("; ")
                : "no viewers"),
            node("td", String(stream.pending_view_requests ?? 0)),
            node("td", String(stream.connection_state ?? "unknown")),
            node("td", formatBitrate(stream.ingress_bytes_per_second)),
            node("td", formatBitrate(stream.egress_bytes_per_second)),
            node("td", String(stream.publisher_id ?? "unknown"))
        );
        const actions = node("td");
        actions.append(button("Stop stream", async () => {
            if (!confirm(`Stop the stream published by ${stream.username ?? "this account"}?`)) return;
            await api(`streams/${encodeURIComponent(stream.publisher_id)}/stop`, "POST", {});
            message.textContent = "Stream stop requested. Refresh to see cleanup.";
            await loadStreams();
        }));
        viewers.forEach(viewer => actions.append(button(`Disconnect ${viewer.username ?? "viewer"}`, async () => {
            if (!confirm(`Disconnect ${viewer.username ?? "this viewer"}?`)) return;
            await api(`sessions/${encodeURIComponent(viewer.session_id ?? "")}/disconnect`, "POST", {});
            message.textContent = "Session disconnect requested. Refresh to see cleanup.";
            await loadStreams();
        })));
        row.append(actions);
        body.append(row);
    });
    if (!streams.length) content.append(node("p", "No connected publisher streams."));
    content.append(button("Disconnect all DASS sessions", async () => {
        if (!confirm("Disconnect all publishers, viewers and idle DASS connections?")) return;
        await api("disconnect", "POST", {});
        message.textContent = "Session disconnect requested. Refresh to see cleanup.";
    }));
    content.append(recentEvents(status?.metrics));
}

document.querySelector("#title").textContent = { users: "Users", rooms: "Rooms", streams: "Streams" }[page];
document.querySelector(`a[href="/admin/${page}"]`)?.setAttribute("aria-current", "page");
const load = { users: loadUsers, rooms: loadRooms, streams: loadStreams }[page];
const refresh = button("Refresh", load);
document.querySelector("main").insertBefore(refresh, content);
run(load);
