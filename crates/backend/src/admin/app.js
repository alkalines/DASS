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

async function loadSettings() {
    const configuration = await api("settings");
    content.replaceChildren();
    content.append(node("p", configuration.restart_required
        ? "Saved settings differ from the running configuration. Restart the backend to apply them."
        : "Settings are stored in SQLite. Changes require a backend restart.", "hint"));
    content.append(node("p", "Anonymous access is disabled. Login handshakes are separately bounded. DASS_ADMIN_DATA_FILE records the legacy import source only; it no longer stores live policy.", "hint"));
    const form = node("form");
    const inputs = new Map();
    const readOnly = new Set(configuration.read_only);
    for (const [key, value] of Object.entries(configuration.saved)) {
        const input = field(form, key, value);
        input.maxLength = 4096;
        input.readOnly = readOnly.has(key);
        inputs.set(key, input);
        if (configuration.active[key] !== value) form.append(node("p", `Running value: ${configuration.active[key]}`, "hint"));
    }
    const save = node("button", "Save settings (restart required)");
    save.type = "submit";
    form.append(save);
    form.addEventListener("submit", event => {
        event.preventDefault();
        return run(async () => {
            await api("settings", "PUT", Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])));
            message.textContent = "Settings saved to SQLite. Restart the backend to apply changes.";
            await loadSettings();
        });
    });
    content.append(form);
}

function editAdministrator(administrator, currentUsername, required = false) {
    document.querySelector("#administrator-editor")?.remove();
    const form = node("form");
    form.id = "administrator-editor";
    form.noValidate = true;
    form.append(node("h2", required ? "Change the initial administrator password" : administrator ? `Reset password for ${administrator.username}` : "Add administrator"));
    const username = field(form, "Administrator username", administrator?.username);
    username.required = true;
    username.maxLength = 64;
    username.readOnly = Boolean(administrator);
    const password = field(form, "New password (12–512 UTF-8 bytes)", "", "password");
    password.autocomplete = "new-password";
    const confirmation = field(form, "Confirm new password", "", "password");
    confirmation.autocomplete = "new-password";
    const save = node("button", "Save administrator");
    save.type = "submit";
    form.append(save);
    if (!required) form.append(button("Cancel", () => form.remove()));
    form.addEventListener("submit", event => {
        event.preventDefault();
        return run(async () => {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(username.value)) invalidField(username, "Username must contain 1–64 ASCII letters, digits, underscores or hyphens.");
            const bytes = new TextEncoder().encode(password.value).length;
            if (bytes < 12 || bytes > 512) invalidField(password, "Password must contain 12–512 UTF-8 bytes.");
            if (/\p{Cc}/u.test(password.value)) invalidField(password, "Password must not contain control characters.");
            if (password.value !== confirmation.value) invalidField(confirmation, "Passwords do not match.");
            const value = password.value;
            password.value = confirmation.value = "";
            await api(`administrators/${encodeURIComponent(username.value)}`, "PUT", { password: value });
            form.remove();
            if (username.value === currentUsername) {
                content.replaceChildren(node("p", "Your password was changed. Refresh and sign in with the new password. The old password is no longer accepted."));
                message.textContent = "Administrator saved. Sign in again with your new password.";
            } else {
                await loadAdministrators();
                message.textContent = "Administrator saved to SQLite. Changes apply immediately.";
            }
        });
    });
    content.append(form);
    (administrator ? password : username).focus();
}

async function loadAdministrators() {
    const result = await api("administrators");
    content.replaceChildren();
    content.append(node("p", "Administrator credentials are stored in SQLite and are separate from DASS client accounts. All administrators have full panel access. Changes apply immediately; the last administrator cannot be removed.", "hint"));
    if (result.must_change_password) {
        content.append(node("p", "The default admin/admin login is for initial setup only. Choose a strong password before accessing any other panel function.", "hint"));
        editAdministrator({ username: result.current_username }, result.current_username, true);
        return;
    }
    if (result.administrators.length < 32) content.append(button("Add administrator", () => editAdministrator(null, result.current_username)));
    const body = table(["Administrator", "State", "Actions"]);
    for (const administrator of result.administrators) {
        const row = node("tr");
        row.append(node("td", administrator.username + (administrator.username === result.current_username ? " (you)" : "")));
        row.append(node("td", administrator.must_change_password ? "Initial password must be changed" : "Active"));
        const actions = node("td");
        actions.append(button("Reset password", () => editAdministrator(administrator, result.current_username)));
        if (result.administrators.length > 1) actions.append(button("Remove", async () => {
            if (!confirm(`Remove administrator ${administrator.username}? Their credentials will stop working immediately.`)) return;
            await api(`administrators/${encodeURIComponent(administrator.username)}`, "DELETE", {});
            if (administrator.username === result.current_username) {
                content.replaceChildren(node("p", "Your administrator account was removed. Sign in as another administrator to continue."));
                message.textContent = "Administrator removed.";
            } else {
                await loadAdministrators();
                message.textContent = "Administrator removed.";
            }
        }));
        row.append(actions);
        body.append(row);
    }
}

let logPoll;
let logsPaused = false;
let logText;
let logSource;
let logEntries = [];

function renderLogs() {
    const selected = logEntries.filter(entry => !logSource.value || (entry.source === "server" ? "server" : entry.client_id) === logSource.value);
    logText.value = selected.map(entry => JSON.stringify({
        ...entry,
        time: new Date(entry.at_unix_ms).toISOString(),
        received_time: new Date(entry.received_at_unix_ms).toISOString()
    })).join("\n");
}

async function loadLogs() {
    scheduleLogPoll();
    const result = await api("logs");
    if (!logText) {
        content.replaceChildren();
        content.append(node("p", "Recent DASS diagnostics, oldest first (512 entries, memory only; cleared on backend restart). Client labels are random per client runtime, not account names. Client events are self-reported; compare received_time when clocks differ. Pre-login and disconnected client logs remain local.", "hint"));
        logSource = node("select");
        logSource.setAttribute("aria-label", "Log source");
        logSource.addEventListener("change", renderLogs);
        const pause = button("Pause", () => {
            logsPaused = !logsPaused;
            pause.textContent = logsPaused ? "Resume" : "Pause";
            if (!logsPaused) return loadLogs();
        });
        content.append(logSource, pause, button("Copy JSON lines", async () => {
            try {
                await navigator.clipboard.writeText(logText.value);
                message.textContent = "Logs copied.";
            } catch {
                logText.focus();
                logText.select();
                message.textContent = "Clipboard unavailable. Logs selected; press Ctrl+C to copy.";
            }
        }));
        logText = node("textarea", undefined, "log-json");
        logText.readOnly = true;
        logText.setAttribute("aria-label", "Diagnostic JSON lines");
        logText.spellcheck = false;
        content.append(logText);
    }
    logEntries = result.entries;
    const selected = logSource.value;
    const sources = [...new Set(logEntries.map(entry => entry.source === "server" ? "server" : entry.client_id))];
    logSource.replaceChildren();
    for (const source of ["", ...sources]) {
        const option = node("option", source || "All sources");
        option.value = source;
        logSource.append(option);
    }
    logSource.value = sources.includes(selected) ? selected : "";
    renderLogs();
}

function scheduleLogPoll() {
    clearTimeout(logPoll);
    logPoll = setTimeout(() => {
        if (!logsPaused && !document.hidden && !busy) run(loadLogs);
        else scheduleLogPoll();
    }, 3_000);
}

document.querySelector("#title").textContent = { users: "Users", rooms: "Rooms", streams: "Streams", logs: "Logs", settings: "Settings", administrators: "Administrators" }[page];
document.querySelector(`a[href="/admin/${page}"]`)?.setAttribute("aria-current", "page");
const load = { users: loadUsers, rooms: loadRooms, streams: loadStreams, logs: loadLogs, settings: loadSettings, administrators: loadAdministrators }[page];
const refresh = button("Refresh", load);
document.querySelector("main").insertBefore(refresh, content);
run(load);
