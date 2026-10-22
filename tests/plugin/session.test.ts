import { expect, test } from "bun:test";
import { SpikeSignaling, SpikeSignalingError } from "../../clients/spike/signaling";
import { AccountCredentials, DassSession } from "../../plugins/dass/session";

const account: AccountCredentials = { backendUrl: "https://dass.example", roomId: "room", username: "alice", password: "separate_dass_password" };

test("directory, publisher and viewer have independent leases and logout closes all of them", async () => {
    const connections: ReturnType<typeof fakeConnection>[] = [];
    const session = new DassSession(undefined, async () => {
        const next = fakeConnection();
        connections.push(next);
        return next.connection;
    });
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        const signals = Array.from({ length: 3 }, () => new AbortController());
        const leases = await Promise.all(signals.map(abort => session.connect({
            experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: abort.signal
        })));
        expect(new Set(leases).size).toBe(3);
        expect(connections).toHaveLength(3);
        signals[1].abort();
        expect(connections.map(value => value.closed.signal.aborted)).toEqual([false, true, false]);
        session.clear();
        expect(connections.every(value => value.closed.signal.aborted)).toBe(true);
    } finally { session.stop(); }
});

test("logout during a concurrent connection attempt closes the late result as well", async () => {
    const first = fakeConnection();
    const late = fakeConnection();
    let complete: ((connection: SpikeSignaling) => void) | undefined;
    let attempts = 0;
    const session = new DassSession(undefined, async () => ++attempts === 1 ? first.connection : new Promise(resolve => { complete = resolve; }));
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        const options = { experimental: true as const, backendUrl: account.backendUrl, ...session.getAccess(), signal: new AbortController().signal };
        await session.connect(options);
        const pending = session.connect(options);
        session.clear();
        complete!(late.connection);
        await expect(pending).rejects.toThrow("cancelled");
        expect(first.closed.signal.aborted).toBe(true);
        expect(late.closed.signal.aborted).toBe(true);
        expect(session.getSnapshot().configured).toBe(false);
    } finally { session.stop(); }
});

test("call context is derived live and saved credentials contain no room selection", async () => {
    let callId: string | undefined;
    let saved: AccountCredentials | undefined;
    const session = new DassSession({ read: async () => undefined, write: async value => { saved = value; }, forget: async () => {} },
        async () => fakeConnection().connection, () => callId);
    try {
        await session.start(account.backendUrl);
        await session.login({ backendUrl: account.backendUrl, username: account.username, password: account.password }, true);
        expect(session.getSnapshot().configured).toBe(true);
        expect(saved).toEqual({ backendUrl: account.backendUrl, username: account.username, password: account.password });
        expect(() => session.getAccess()).toThrow("Join a Discord call");
        callId = "123456789";
        expect(session.getAccess().roomId).toBe(callId);
        callId = "987654321";
        expect(session.getAccess().roomId).toBe(callId);
        callId = undefined;
        expect(() => session.getAccess()).toThrow("Join a Discord call");
    } finally { session.stop(); }
});

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

test("denied account login clears access without destroying saved configuration", async () => {
    let forgotten = 0;
    const session = new DassSession({ read: async () => account, write: async () => {}, forget: async () => { forgotten++; } }, async () => {
        throw new SpikeSignalingError("rejected:unauthorized");
    });
    await session.start(account.backendUrl);
    expect(session.getSnapshot().phase).toBe("failed");
    expect(session.getSnapshot().configured).toBe(false);
    expect(forgotten).toBe(0);
    expect(session.getSnapshot().message).toContain("backend rejected");
    session.stop();
});

for (const code of ["socket", "timeout", "protocol", "server:transport_failed", "expired", "server:expired", "rejected:overloaded"] as const) {
    test(`startup ${code} retains remembered credentials for an authenticated retry`, async () => {
        let forgotten = 0;
        let attempts = 0;
        const session = new DassSession({ read: async () => account, write: async () => {}, forget: async () => { forgotten++; } }, async options => {
            expect(options.password).toBe(account.password);
            if (++attempts === 1) throw new SpikeSignalingError(code);
            return fakeConnection().connection;
        });
        try {
            await session.start(account.backendUrl);
            expect(session.getSnapshot()).toMatchObject({ phase: "failed", configured: true, username: account.username });
            expect(session.getSnapshot().message).toContain("credentials were kept");
            expect(session.getSnapshot().message).not.toContain("backend rejected");
            expect(JSON.stringify(session.getSnapshot())).not.toContain(account.password);
            const connection = await session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: new AbortController().signal });
            expect(attempts).toBe(2);
            expect(forgotten).toBe(0);
            connection.close();
        } finally { session.stop(); }
    });
}

test("unsuccessful unremembered login does not erase a saved account", async () => {
    let forgotten = 0;
    const session = new DassSession({ read: async () => undefined, write: async () => {}, forget: async () => { forgotten++; } }, async () => {
        throw new SpikeSignalingError("socket");
    });
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        expect(session.getAccess().password).toBe(account.password);
        expect(forgotten).toBe(0);
    } finally { session.stop(); }
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

test("directory-to-media handoff retries only replay during local lease release", async () => {
    const first = fakeConnection();
    const next = fakeConnection();
    let attempts = 0;
    const session = new DassSession(undefined, async () => {
        if (++attempts === 1) return first.connection;
        if (attempts === 2) throw new SpikeSignalingError("rejected:replay");
        return next.connection;
    });
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        const directoryAbort = new AbortController();
        await session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: directoryAbort.signal });
        directoryAbort.abort();
        expect(first.closed.signal.aborted).toBe(true);
        const media = await session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: new AbortController().signal });
        expect(media).toBe(next.connection);
        expect(attempts).toBe(3);
        expect(session.getSnapshot().configured).toBe(true);
        session.clear();
        expect(next.closed.signal.aborted).toBe(true);
    } finally { session.stop(); }
});

test("replay without a local connection release is not automatically retried", async () => {
    let attempts = 0;
    const session = new DassSession(undefined, async () => { attempts++; throw new SpikeSignalingError("rejected:replay"); });
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        expect(attempts).toBe(1);
        expect(session.getSnapshot().configured).toBe(true);
        expect(session.getSnapshot().message).toContain("already have an active connection");
    } finally { session.stop(); }
});

test("local lease-release replay retries are bounded and cancellable", async () => {
    const first = fakeConnection();
    let attempts = 0;
    const session = new DassSession(undefined, async () => {
        if (++attempts === 1) return first.connection;
        throw new SpikeSignalingError("rejected:replay");
    });
    try {
        await session.start(account.backendUrl);
        await session.login(account, false);
        const directoryAbort = new AbortController();
        await session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: directoryAbort.signal });
        directoryAbort.abort();
        const abort = new AbortController();
        const pending = session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: abort.signal });
        await Promise.resolve();
        abort.abort();
        await expect(pending).rejects.toThrow("cancelled");
        expect(attempts).toBe(2);
        await expect(session.connect({ experimental: true, backendUrl: account.backendUrl, ...session.getAccess(), signal: new AbortController().signal })).rejects.toThrow("rejected:replay");
        expect(attempts).toBe(6);
    } finally { session.stop(); }
});
