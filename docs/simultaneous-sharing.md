# Multi-client sharing and watching

Discord Alternative ScreenShare (DASS) has experimental multi-publisher,
multi-viewer packet forwarding. Publisher and viewer counts do not need to be
equal: one publisher can have several viewers, several publishers can coexist,
and a person can publish while watching someone else.

This removes the fixed two-person topology, not resource limits. The plugin
still plays **one remote stream per client**; displaying several remote streams
in a single client is a separate feature. This is not a production-readiness or
unlimited-capacity claim.

## Limits and security

- Each viewer has an independent bounded 32-packet queue. The router admits a
  configurable total number of publisher/subscriber endpoints, rather than a
  fixed number of either role. Routes remain scoped to the exact room, publisher
  and registration. Slow or closed queues remove only that viewer's route.
- The media data path uses a per-publisher lock, not the global publisher registry.
  Fan-out clones `Arc` payload handles rather than copying each encoded payload.
  Chromium still encodes once per publishing peer; the backend neither decodes
  nor transcodes. Outgoing RTP/SRTP work and bandwidth still scale with viewers.
- Account login permits up to three authenticated connections per account for
  directory discovery, publishing and watching. Each connection verifies the
  password and is subject to the existing global admission and login throttles.
  Slots are shared across devices, not three slots per device. Use separate
  accounts for the two people. Legacy invite credentials remain single-connection.
- Directory results exclude the caller's own published streams. Publishing does
  not stop watching, and discovery remains active while either media role runs.
- TLS/WSS, DTLS-SRTP, publisher approval, identity checks and the existing required
  client encryption path are unchanged. This is not new cryptographic assurance;
  the limitations in [security-release.md](security-release.md) still apply.
- Stream end or viewer withdrawal closes only that media session (`left`), not
  the account. Policy/account revocation still uses `revoked` and invalidates
  account access. This distinction prevents a friend's stream ending from
  stopping your independent share.
- The backend binds **exactly two shared UDP sockets** when media is enabled:
  `DASS_RTC_FIRST_PORT` and **`DASS_RTC_FIRST_PORT + 1`**, default 50000/50001.
  The first must be 1024–65534. Both must bind successfully at startup; there is
  no larger range, ephemeral-port fallback or partially available pair. Sessions
  are balanced across these sockets, not assigned separate listening ports.
  Increasing client or media-session counts never opens more UDP ports.
- `DASS_MAX_MEDIA_SESSIONS` defaults to four, in any role mix. Set it to at least
  **P + V**, where P is active
  publisher uploads and V is active viewer subscriptions, not unique accounts.
  For example, one publisher and nine viewers need ten; four people each sharing
  and watching one stream need eight. Idle directory sockets do not use a media
  slot but do consume signaling/TCP budgets.
- The UDP dispatcher uses the session's server-generated ICE username fragment
  and AWS-LC-backed STUN integrity verification before installing an endpoint
  route. The existing observed-WSS-peer/LAN policy must also admit the source.
  Non-request traffic needs that established `(listening port, source endpoint)`
  route. It is never broadcast to every RTC or routed by IP alone. A different
  session cannot overwrite an existing tuple; ambiguous tuple reuse fails closed.
  Each session has at most 16 observed endpoints and a 32-datagram ingress queue;
  a full queue drops input without blocking another owner. Each shared port also
  bounds aggregate input parsing work using the configured session/packet budget.
  This shedding limit is not per-source fairness or DDoS protection.
- Each RTC still has exactly one mutation owner. The dispatcher only routes
  bounded in-process datagrams; it does not own RTCs or send media through JSON
  or IPC. Session cleanup removes its ICE/endpoint routes and queue, not the
  listening pair. The transport owns both sockets and reader-task cancellation.
  ICE credentials terminate at the backend as before; they are not E2EE keys.
- The current supported configuration range is **1–64 total media sessions**.
  The protocol bounds each room to 64 media members and directories to 64 streams.
  These are deliberate safety ceilings, not measured hardware capacity. Raising
  them further needs protocol/control-plane and load testing, not just a larger
  setting. Global TCP/signaling admission, login/password-verification throttles,
  pending-approval limits, per-session byte/packet limits and the 600-second
  connection lifetime also remain in force. Admission may reject a burst before
  CPU or RAM is exhausted; stagger joins and retry explicitly.
- Updated clients send ordered `client_N` request IDs. The backend rejects any
  duplicate, backward, noncanonical or mixed-mode ID using a constant-memory
  high-water mark. Opaque-ID clients retain the old bounded 256-ID replay table
  without eviction. The updated client paces bursts to 16 requests per second
  rather than removing the server's 32-message/second limit; paced sends remain
  cancellable and permit only one outstanding request. Sequential rekeys wrap
  one fresh epoch for each approved member, so joining N viewers has quadratic
  total key-relay work across all intermediate rosters. This is not a scalable
  group-key protocol or a new security assurance.

## Upgrade an existing installation

1. Build and validate the updated backend. From the repository root:

   ```sh
   docker build --target tooling -t dass-rust-tools .
   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
   docker compose build backend
   ```

   The Compose build checks formatting, denies Clippy warnings, runs locked
   workspace tests, and builds the release image. Do not deploy a failed build.

2. In `/admin/settings`, set `DASS_MAX_MEDIA_SESSIONS` to the desired P + V budget
   (`4` suffices for two people sharing and watching each other). **Existing SQLite
   settings win over environment variables and new defaults**, so changing only
   `.env` will not upgrade an existing database. Save the setting, then recreate
   the backend using your existing deployment configuration. Do not remove the
   database volume or change working TLS/account settings.

   For the repository's Compose deployment, from the repository root:

   ```sh
   docker compose up -d --force-recreate backend
   ```

3. Publish/allow **only the configured UDP pair**, default **50000/50001**, for
   every media-session budget. `DASS_RTC_FIRST_PORT` is the only backend port
   setting; the second is derived as FIRST + 1. There is no `DASS_RTC_LAST_PORT`.
   For example, FIRST=51000 uses 51000/51001 even for 64 sessions.
   `compose.yaml` publishes the default pair. **Compose cannot evaluate port
   arithmetic:** if you change FIRST in `.env`, also change its two UDP mappings
   to that exact pair, retaining the configured bind address. For a custom
   container, firewall, NAT or Wings allocation, map the same two ports.
   Recreate the container after mapping changes. Keep the existing TLS TCP port.
   Do not expose insecure development HTTP.
   Account LAN admission does not edit host firewall rules.

4. Rebuild the plugin for **both** clients, from the repository root:

   ```sh
   bun test ./tests/plugin
   bun scripts/build-plugin.mjs
   ```

   The adapter uses Equicord revision
   `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`. For Equibop, select the absolute
   `build/Equicord/dist` directory as the custom Equicord location, not its
   `equibop` child. Fully quit and restart both clients. For official Discord
   desktop, install the custom build explicitly as described in [plugin.md](plugin.md).
   No additional client executable is required.

## Acceptance test

Start with two separate DASS accounts in the same Discord call:

1. A shares; B requests to watch and A approves.
2. While watching A, B shares. A's incoming playback must continue on B.
3. A requests to watch B and B approves. Confirm distinct video in both
   directions, optional share audio, and uninterrupted ordinary Discord voice.
4. Stop A's share. A should still watch B; only B's view of A should end.
5. Repeat in the reverse order: both publish first, then watch each other.
6. Repeat with source changes, picker cancellation, viewer denial/removal,
   account logout, plugin disable, call exit and backend restart. Verify capture
   tracks and only the affected routes close. No Discord media fallback or preview
   upload is allowed. After restart, authenticate and start fresh sessions.
7. Record Equibop/Equicord and Discord build numbers, OS/capture backend, and any
   sanitized fixed diagnostic codes. Never collect credentials, full SDP or keys.

Then exercise unequal role counts with separate accounts: one publisher/three
viewers; three publishers with viewer counts 0, 1 and 4; publishers in different
rooms; and accounts switching between publishing and watching. Confirm only
approved viewers receive media. Saturate one viewer's queue or disconnect it and
verify the other viewers and publishers continue. Stop a publisher and ensure all
of its viewers end, but no other stream ends. Verify N+1 admission fails at the
    configured budget and recovers only after owner cleanup.

Verify the server still listens only on FIRST and FIRST + 1 while increasing
the number of sessions. Exercise two clients behind the same NAT, simultaneous
publish/watch, candidate trickling, unknown usernames, bad STUN integrity,
non-observed public sources, endpoint reuse/collision, queue saturation, and
shutdown/startup with either configured port occupied. A released session must
not receive late input, and stopping one session must not close either shared
listener. Earlier user-confirmed hosting tests do not validate this new dispatcher.

For capacity measurements, record hardware, stream resolutions/FPS/bitrates,
P/V distribution, total ingress/egress, CPU, memory, drops, join/rekey latency and
slow-client behavior. Approximate egress is the sum of each stream's bitrate times
its viewer count; queue metadata is O(V × 32). No throughput or maximum-client
claim has been measured for this change.

## Validation status

Bun 1.4.3: all 319 plugin tests passed, covering publishing-first and watching-first controllers,
independent lease cleanup, late-login logout, three-viewer rekey/removal, extended
request sequences and cancellable pacing. Plugin lint, typecheck, and
desktop/Equibop bundles passed. Mocked controller/crypto tests are not media
interoperability evidence.

Rust regression tests were added for unequal multi-publisher/viewer mixes,
shared payloads, queue/teardown and lock isolation, stale handles, total route
admission, bounded account slots, authenticated connection revocation,
shared two-port admission (including 64 registrations), port-pair overflow,
occupied-second-port cleanup, authenticated STUN/endpoint routing, public-IP
binding, bounded ingress and cancellation, ordered replay rejection, and
DTLS-SRTP Opus/VP8 payload fan-out to three test receivers. **They have not been
run for this change:** Docker socket
access was denied in the implementation environment. Container formatting,
Clippy, locked Rust tests and a real two-client media test remain required.
No new runtime compatibility, capacity or security claims are established.
