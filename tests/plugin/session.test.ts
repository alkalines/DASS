import { expect, test } from "bun:test";
import { SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";
import { AccountCredentials, DassSession } from "../../plugins/dass/session";

const account: AccountCredentials = { backendUrl: "https://dass.example", roomId: "room", username: "alice", password: "separate_dass_password" };

function fakeConnection() {
    const closed = new AbortController();
    const connection = { closed: closed.signal, close: () => closed.abort(new SpikeSignalingError("closed")) } as unknown as SpikeSignaling;
    return { connection, closed };
}

test("remembered account logs in on startup and transfers authentication without replay", async () => {
    const f = fakeConnection();
    const attempts: unknown[] = [];
    const session = new DassSession({ read: async () => account, write: async () => {}, forget: async () => {} }, async options => {
        attempts.push(options);
        return f.connection;
    });
    try {
        await session.start("https://dass.example/");
        expect(session.getSnapshot()).toMatchObject({ configured: true, username: "alice", phase: "ready" });
        expect(JSON.stringify(session.getSnapshot())).not.toContain(account.password);
        const abort = new AbortController();
        expect(await session.connect({ experimental: true, backendUrl: "https://dass.example/", username: account.username, password: account.password, signal: abort.signal })).toBe(f.connection);
        expect(attempts.length).toBe(1);
        abort.abort();
        expect(f.closed.signal.aborted).toBe(true);
    } finally { session.stop(); }
});

test("remembered credentials are never sent to a different configured backend", async () => {
    let attempts = 0;
    const session = new DassSession({ read: async () => account, write: async () => {}, forget: async () => {} }, async () => {
        attempts++;
        return fakeConnection().connection;
    });
    await session.start("https://different.example");
    expect(attempts).toBe(0);
    expect(session.getSnapshot().configured).toBe(false);
    session.stop();
});

test("disable during secure loading prevents late startup authentication", async () => {
    let resolveRead: ((value: AccountCredentials) => void) | undefined;
    let attempts = 0;
    const session = new DassSession({ read: () => new Promise(resolve => { resolveRead = resolve; }), write: async () => {}, forget: async () => {} }, async () => {
        attempts++;
        return fakeConnection().connection;
    });
    const startup = session.start(account.backendUrl);
    session.stop();
    resolveRead!(account);
    await startup;
    expect(attempts).toBe(0);
    expect(session.getSnapshot().configured).toBe(false);
});

test("late login results cannot restore credentials after logout", async () => {
    let resolveLogin: ((value: SpikeSignaling) => void) | undefined;
    const f = fakeConnection();
    const session = new DassSession(undefined, () => new Promise(resolve => { resolveLogin = resolve; }));
    await session.start(account.backendUrl);
    const login = session.login(account, false);
    while (!resolveLogin) await Promise.resolve();
    session.stop();
    resolveLogin(f.connection);
    await login;
    expect(f.closed.signal.aborted).toBe(true);
    expect(session.getSnapshot().configured).toBe(false);
});

test("secure remembering failure retains only the in-memory authenticated session", async () => {
    const f = fakeConnection();
    const session = new DassSession({ read: async () => undefined, write: async () => { throw new Error("keyring unavailable"); }, forget: async () => {} }, async () => f.connection);
    try {
        await session.start(account.backendUrl);
        await session.login({ ...account, backendUrl: "https://dass.example/" }, true);
        expect(session.getSnapshot().configured).toBe(true);
        expect(session.getSnapshot().message).toContain("No password was stored as plaintext");
        expect(session.getAccess().password).toBe(account.password);
    } finally { session.stop(); }
});

test("denied account login clears access and deletes stale remembered credentials", async () => {
    let forgotten = 0;
    const session = new DassSession({ read: async () => account, write: async () => {}, forget: async () => { forgotten++; } }, async () => {
        throw new SpikeSignalingError("rejected:unauthorized");
    });
    await session.start(account.backendUrl);
    expect(session.getSnapshot().phase).toBe("failed");
    expect(session.getSnapshot().configured).toBe(false);
    expect(forgotten).toBe(1);
    session.stop();
});

test("invalid backend origins fail before sending account credentials", async () => {
    let attempts = 0;
    const session = new DassSession(undefined, async () => { attempts++; return fakeConnection().connection; });
    await session.start(account.backendUrl);
    for (const backendUrl of ["http://192.168.1.2", "https://name:password@dass.example", "https://dass.example/path", "https://dass.example/?token=secret"]) {
        await session.login({ ...account, backendUrl }, false);
        expect(session.getSnapshot().configured).toBe(false);
    }
    expect(attempts).toBe(0);
    session.stop();
});

test("idle connection expiry is reauthenticated automatically at the next media operation", async () => {
    let attempts = 0;
    const first = fakeConnection();
    const next = fakeConnection();
    const session = new DassSession(undefined, async () => (++attempts === 1 ? first.connection : next.connection));
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        first.closed.abort(new SpikeSignalingError("expired"));
        expect(session.getSnapshot().configured).toBe(true);
        expect(await session.connect({ experimental: true, backendUrl: account.backendUrl, username: account.username, password: account.password, signal: new AbortController().signal })).toBe(next.connection);
        expect(attempts).toBe(2);
    } finally { session.stop(); next.connection.close(); }
});
