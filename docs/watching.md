# Authenticated DASS discovery and watching

Discord Alternative ScreenShare (DASS) now connects its experimental one-viewer
transport to an authenticated directory and a DASS-owned settings-panel viewer.
The user has confirmed discovery, audio playback, audio consent and backend checks;
this does not complete the transport gate. The earlier user-confirmed video stream
used manual publisher-ID entry, not this directory. E2EE is unavailable;
readiness remains 503.

For the current normal workflow, see [session-workflow.md](session-workflow.md):
sign in once (optionally remember securely), Share starts publishing, and **Find
DASS streams** prepares and binds the viewer without repeated credential input.
The [LAN account policy](lan-accounts.md) admits its candidate ports automatically
when they match the server-observed WSS IP. The supervised manual
procedure below records the previous exact-port flow, which remains available
under advanced controls.

## Recorded runtime evidence

On October 11, 2026, after the directory/viewer implementation, the user reported:
“Discovering is working. Audio is also working.” This is user-confirmed discovery
and audio playback, not an agent-observed test or a full authorization/security
acceptance result. Exact running revisions, audio source/selection, playback gesture
behavior and the topology of this follow-up were not separately recorded.
The user subsequently confirmed that backend checks and audio consent are working,
and deferred the remaining runtime checks. This records user-confirmed acceptance
of those categories; command outputs, test counts and detailed audio scenarios were
not provided. It is not agent-executed validation.
Unauthorized access rejection, publisher removal, viewer/context cleanup, decoder
bounds and absence of Discord media/preview leakage remain pending runtime checks.

## Directory ownership and authorization

After WSS `login`, clients may request:

```json
{"type":"directory","room_id":"lan_test"}
```

The operation lives inside the usual versioned request envelope. Its correlated
response has `type: "directory"`, `room_id`, `publisher_ids`, and a matching ordered
`publishers` array of `{ publisher_id, display_name }` records. Names come from
the authenticated publisher invite's optional admin-configured `display_name`,
falling back to its invite ID. They are DASS labels, not verified Discord account
identities. Rebuild backend and clients together; older strict directory parsers
do not accept the added metadata. Both room access
and subscribe permission are required on each request; unauthorized requests are
rejected, not answered with another room's entries. Publisher access/publish grants
and credential expiry are checked when producing a snapshot.

Only a server-owned, connected publisher RTC peer registers an entry. Login,
joining, publish acceptance and client identity claims do not create directory
entries. Session leave, disconnect, timeout, revocation or transport failure remove
the entry through owned cleanup. Close invalidates discovery before awaiting its
close send. Expired/revoked publishers are filtered even before teardown completes.
There is no client directory update operation; unknown update fields are rejected.
Registrations and results are capped at 64, with the existing media hub limiting
this experiment further to **one publisher and one viewer backend-wide**.

The plugin validates IDs, unique entries, room and size, matches response request
IDs, and rejects results from aborted requests or old binding epochs. It polls
every five seconds while bound and not watching. Removed entries may remain in
the UI until the next poll; subscription always reauthorizes and checks the live
publisher in the same room. No Discord stream stores or gateway events are used.

## Historical supervised LAN procedure (exact-port policy)

Use the TLS, separate scoped credentials, custom builds and firewall prerequisites
in [direct-lan-test.md](direct-lan-test.md). Build commands below run from the
**DASS repository root**:

```sh
bun scripts/build-plugin.mjs
```

Select `build/Equicord/dist` as Equibop's custom Equicord location and fully restart
both clients. Rebuild the backend in the user's Docker-enabled shell as described
in the LAN guide; old backends do not understand the new directory operation.

1. Both clients need a selected Discord voice context. This context is only a
   local lifecycle boundary, **not** DASS authorization or an automatic room map.
2. Publisher: use the existing manual test panel's **Prepare publisher capture**.
   Viewer: use **Prepare DASS viewer** in the new directory panel, not the manual
   panel's Prepare viewer. Preparation opens one receive-only peer, no capture.
3. Collect both clients' actual UDP endpoints and configure the existing exact
   allowlist. Recreate the test backend **before** authenticating either client.
   Neither prepared peer opens WSS, so recreation does not invalidate preparation.
   Complete this sequence within the 180-second preparation deadline.
4. Publisher: activate the prepared publisher with its publish-scoped credential.
   Wait for its real UDP/DTLS connection; merely getting a session ID is insufficient.
5. Viewer: enter the separately authorized DASS room (`lan_test` for the LAN guide)
   and its access/subscribe credential, then **Bind room and discover**. The input
   is cleared on submission; credentials are not persisted in plugin settings.
6. A connected publisher should appear within five seconds. Click **Watch DASS
   share**. No copied publisher ID, fabricated native record or native subscription
   is needed. The binding's authenticated WSS connection is reused for media setup,
   rather than replaying the exclusive credential on a second connection.
7. Video starts muted. Use **Enable audio** (or player controls) as an explicit
   user gesture for playback of publisher-selected share audio. Capture never
   implicitly includes a microphone. Loading, unauthorized, disconnected and failed
   states remain visible; browser playback rejection is also shown.
8. **Close DASS viewer and room**, panel unmount, context exit, logout, plugin
   disable or backend setting changes cancel requests, close peers/subscriptions,
   stop tracks, clear directory state and detach media elements. Watching again
   requires fresh preparation and authentication. No automatic reconnect or fallback.

The manual panel and directory viewer cancel each other before preparation,
bounding the plugin to one receive peer/decoder set (one video and at most one
audio track). Publisher capture remains in the separate test panel. Native share
buttons still refuse DASS transport; native Discord watching remains unchanged.
The DASS watch button consumes a DASS intent synchronously through `routeWatch`
before awaiting setup and has no native callback. No guessed private watch patch
has been added. Standard Discord desktop receiving and full Equibop lifecycle/
security behavior remain unverified; discovery and audio have the user-reported
evidence above.

## Validation and acceptance still needed

Client checks passed with Bun 1.4.3: 89 tests, generated-protocol freshness,
plugin lint, full Equicord typecheck, and desktop/Equibop bundle builds at the
existing pins. New tests cover authorization rejection, correlated/stale directory
results, room isolation, one prepared decoder, delayed received tracks and context
teardown. These use fake transport/media objects, not real network playback.

Docker socket access was denied in the agent session. New Rust tests include
directory grant/expiry/result bounds/lease cleanup and extend the authenticated
DTLS test to check discovery only after connection and cleanup on revocation.
They were **not run by the agent**. The user subsequently confirmed backend checks
are working; individual command outputs were not supplied. The check sequence,
from the repository root in a Docker-enabled shell, is:

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo clippy --workspace --all-targets --locked -- -D warnings
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
docker compose build backend
```

Discovery, audio playback, audio consent and backend checks are user-confirmed. Before claiming
the exit condition, record the running revisions and verify authorization with
access-only/wrong-room/expired credentials,
publisher stop/disconnect/expiry/revocation removal, late-result cancellation,
viewer close/context/logout cleanup, decoder bounds and
absence of Discord media/preview leakage. Keep the remaining acceptance checks in
[transport-gate.md](transport-gate.md). No deployment or trust/firewall changes
were performed by the agent.
