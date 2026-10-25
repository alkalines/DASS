import { expect, test } from "bun:test";

import type { WatchController, WatchStatus } from "../../plugins/dass/watching";
import { MAX_WATCHED_STREAMS, WatchSet } from "../../plugins/dass/watchSet";

const idle: WatchStatus = { phase: "idle", message: "", shares: [], candidates: [] };

/** Viewer double: the set relies only on the controller's lifecycle and status contract. */
class FakeViewer {
    status = idle;
    stopped = false;
    private listeners = new Set<() => void>();
    start() {}
    stop() { this.stopped = true; this.set(idle); }
    getSnapshot = () => this.status;
    subscribeStatus = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    async watchListedShare(_backendUrl: string, share: { roomId: string; shareId: string; }) {
        const stream = { id: share.shareId } as MediaStream;
        this.set({ ...idle, phase: "watching", watchingShare: share, stream });
        return { ok: true as const, value: stream };
    }
    set(status: WatchStatus) { this.status = status; for (const listener of this.listeners) listener(); }
}

function fixture() {
    const viewers: FakeViewer[] = [];
    const notices: string[] = [];
    const set = new WatchSet(() => { const viewer = new FakeViewer(); viewers.push(viewer); return viewer as unknown as WatchController; },
        message => notices.push(message));
    set.start();
    const share = (shareId: string) => ({ roomId: "call", shareId });
    const watch = (shareId: string) => set.watch("https://dass.example", share(shareId), { username: "alice", password: "secret" });
    return { set, viewers, notices, share, watch };
}

test("several streams are watched by independent viewers; stopping one keeps the others", async () => {
    const f = fixture();
    expect((await f.watch("first")).ok).toBe(true);
    expect((await f.watch("second")).ok).toBe(true);
    expect(f.set.getSnapshot().map(status => status.watchingShare?.shareId)).toEqual(["first", "second"]);
    // Re-watching a live share reuses its viewer.
    expect((await f.watch("first")).ok).toBe(true);
    expect(f.viewers).toHaveLength(2);
    f.set.stopWatching(f.share("first"));
    expect(f.viewers[0].stopped).toBe(true);
    expect(f.viewers[1].stopped).toBe(false);
    expect(f.set.getSnapshot().map(status => status.watchingShare?.shareId)).toEqual(["second"]);
    expect(f.set.statusFor(f.share("second"))?.stream).toBeDefined();
});

test("the watch count is bounded and a released viewer frees its slot", async () => {
    const f = fixture();
    for (let index = 0; index < MAX_WATCHED_STREAMS; index++) expect((await f.watch(`share_${index}`)).ok).toBe(true);
    const over = await f.watch("one_more");
    expect(over.ok).toBe(false);
    expect(f.viewers).toHaveLength(MAX_WATCHED_STREAMS);
    // A context exit clears a viewer completely; the set releases it.
    f.viewers[0].set({ ...idle, phase: "disconnected" });
    expect(f.set.getSnapshot()).toHaveLength(MAX_WATCHED_STREAMS - 1);
    expect((await f.watch("one_more")).ok).toBe(true);
});

test("ended streams stay until closed, and revoked access is reported once and released", async () => {
    const f = fixture();
    await f.watch("ended");
    await f.watch("revoked");
    f.viewers[0].set({ ...idle, phase: "disconnected", closedShare: f.share("ended") });
    f.viewers[1].set({ ...idle, phase: "unauthorized", message: "access revoked" });
    expect(f.notices).toEqual(["access revoked"]);
    expect(f.set.getSnapshot().map(status => status.closedShare?.shareId)).toEqual(["ended"]);
    f.set.stop();
    expect(f.set.getSnapshot()).toEqual([]);
    expect((await f.watch("after_stop")).ok).toBe(false);
});
