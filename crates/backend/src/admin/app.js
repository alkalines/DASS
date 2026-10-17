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
    const users = await api("users");
    content.replaceChildren();
    content.append(button("Add user", () => editUser()));
    const body = table(["User", "Actions"]);
    users.sort((a, b) => a.username.localeCompare(b.username)).forEach(user => {
        const row = node("tr");
        row.append(node("td", user.display_name ? `${user.username} · ${user.display_name}` : user.username));
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
    content.append(node("p", "Rooms are a read-only grouping view of DASS membership; they are not Discord calls and grant no stream access. Publishers decide who may watch.", "hint"));
    const body = table(["Room", "Members"]);
    [...status.rooms].sort((a, b) => a.room_id.localeCompare(b.room_id)).forEach(room => {
        const row = node("tr");
        row.append(node("td", room.room_id), node("td", String(room.members || 0)));
        body.append(row);
    });
    if (!status.rooms.length) content.append(node("p", "No active rooms."));
    content.append(button("Disconnect all DASS sessions", async () => {
        if (!confirm("Disconnect all publishers, viewers and idle DASS connections?")) return;
        await api("disconnect", "POST", {});
        message.textContent = "Session disconnect requested. Refresh to see cleanup.";
    }));
}

async function loadStreams() {
    const status = await api("status");
    content.replaceChildren();
    content.append(node("p", "Browser watching is not available in this version. Viewer approval belongs to each publisher's client; administrator credentials do not grant media access.", "hint"));
    const body = table(["Publisher", "Room", "Viewers", "Pending", "Stream ID"]);
    status.streams.forEach(stream => {
        const row = node("tr");
        row.append(
            node("td", stream.username),
            node("td", stream.room_id),
            node("td", String(stream.viewer_count ?? (stream.viewers || []).length)),
            node("td", String(stream.pending_view_requests ?? 0)),
            node("td", stream.publisher_id)
        );
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
