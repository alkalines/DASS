# Rust transport implementation gate

Discord Alternative ScreenShare (DASS) has a validated protocol/discovery
foundation and a Docker-tested optional invite-backed control plane.
Authentication, room authorization and HTTPS/WSS pass automated control-plane tests;
an opt-in receive-only WebRTC spike passed its first user-run Docker checkpoint
(checks, tests, locked builds and provider-feature review). The added combined
WSS-to-DTLS/revocation test also passed in Docker. Minimal one-publisher/one-viewer
forwarding passes user-run Docker formatting, Clippy and all 41 Rust tests;
the user also confirmed locked workspace/backend image builds completed. Real
Equibop delivery is unverified. Do not enable capture
based on unit tests.

## Current blocker

This session's `docker info` failed with permission denied on
`/var/run/docker.sock`. No host Cargo fallback, socket permission change or
host dependency/lockfile update was attempted. The user can run Docker validation
and supplied passing results for both the protocol foundation and new control
plane. The intentional Docker-only lockfile update, Clippy, all 33 Rust tests,
locked builds and runtime image build succeeded. See
[control-plane.md](control-plane.md) for evidence and remaining review/test limits.
Readiness and SDP/ICE/media/E2EE availability remain false.

The subsequent RTC dependency additions were resolved in Docker; Clippy and all
37 Rust tests, locked builds and provider-feature review passed. The added
combined WSS-to-DTLS/revocation test then passed with formatting, Clippy and all
38 Rust tests.
See [rtc-spike.md](rtc-spike.md); the previous 33-test result applied only to the
preceding control-plane increment.

## Protocol foundation (partial step 4.1)

The proposed v1 signaling contract now lives in `crates/protocol/src/signaling.rs`,
with a dependency-free TypeScript generator, client/server runtime validators and
tests. It defines DASS room/session identifiers, publish/subscribe negotiation,
lifecycle responses and resource/deadline constants. The new control-plane owner
adds session/room admission and login/reservation deadlines; the new receive-only
RTC owner adds bounded UDP output batches, candidate counts and setup/idle/lifetime
limits, covered by passing Docker tests (not real browser interoperability).
See [protocol.md](protocol.md) for semantics and validation commands.

On October 11, 2026, `bun test ./tests/plugin` passed 61 tests with Bun 1.4.3, and
`bun scripts/generate-protocol.mjs --check` passed. `docker info` again failed with
socket permission denied. The user subsequently ran Docker formatting, Clippy,
all 17 Rust tests, locked builds and image build successfully for the protocol
foundation, and confirmed the 61 client tests/generation check. No new dependency
was needed at that stage; the already locked
`serde_json` dependency is now also used by the protocol library at runtime.
The Compose HTTP host port is now explicitly loopback-only, matching backend
documentation; no container was recreated during this session.

## Authentication and secure control plane (steps 4.2–4.4 groundwork, Docker-tested)

`auth.rs`, `signaling.rs` and `listener.rs` add separate Argon2id credentials,
timed first-message login, exact Origin policy, bounded
admission/replay state, TLS 1.3 via explicit AWS-LC, and lease-owned cleanup.
The earlier room-grant/expiry/revocation model was replaced by service-wide
authentication plus publisher-controlled stream admission (pending requests,
single-use approvals, deny/block/remove); see [protocol.md](protocol.md).
Tests include network-level WSS with verified certificates. Manifest pins and an
API/release review are recorded in [control-plane.md](control-plane.md); this is
not an independent security audit. The user completed Docker dependency resolution,
formatting/check, Clippy, 33 Rust tests, locked builds and runtime image build
successfully after the missing Axum `original-uri` feature was enabled. The
Docker-updated `Cargo.lock` is present; keep it with the source changes after
review. The agent did not use host Cargo or hand-edit the lockfile.

Discovery distinguishes the optional authentication/control plane from operational
SDP/ICE signaling. By default publishing/subscribing still return
`transport_unavailable`, even for authorized roles. The explicitly enabled
spike can reserve a publisher transport and negotiate SDP/ICE. The newly added
forwarding source can reserve a room-scoped subscriber, covered by passing Docker tests.
No new client code enables capture or uses
Discord credentials.

The automated control-plane validation gate has passed. Dependency/advisory review,
admin file/SIGHUP operations and real browser compatibility remain outstanding;
operational SDP/ICE exchange belongs to the next RTC increment. Steps 4.5–4.6 and
the exit condition remain incomplete. Step 4.7 remains gated on real two-client
evidence, not protocol or control-plane tests.

## Receive-only RTC increment (partial step 4.5, first Docker checkpoint passed)

`rtc.rs` pins str0m 0.24.1, its AWS-LC provider 0.6.0 and dimpl 0.7.4. The
authenticated WebSocket task exclusively owns its RTC and UDP socket. Each
mutation is drained completely before another mutation/socket await, with a
bounded temporary output batch. Exact peer IP:port allowlisting applies to SDP,
trickle ICE, UDP receive and every outbound datagram. TLS-only explicit opt-in,
two peer slots, send-only audio/video offers and no data channels/renegotiation
keep this increment deliberately narrow. Incoming encoded RTP is discarded.

New tests exercise destination/offer policy, authorization before SDP processing,
actual UDP DTLS-SRTP with opaque test payloads and socket/admission cleanup. The
user supplied passing Docker formatting, Clippy and all 37 Rust tests after the
intentional dependency update. Formatting check, locked debug/release builds and
non-root runtime image `c768ed04d118` subsequently passed. Feature trees confirm
AWS-LC for TLS and DTLS with no active `ring` dependency on the tested target.
A new combined authenticated WSS/DTLS negotiation and RTC revocation-cleanup test
was then added; Docker formatting, Clippy and all 38 Rust tests passed. The
existing runtime image predates this test-only addition. Tests are not Chromium codec/capture
or two-client evidence. Next
after this checkpoint: minimal authorized publisher-to-viewer feasibility forwarding,
a minimal Equibop viewer/capture adapter, and the real two-client checklist below.

## Minimal forwarding increment (partial steps 4.5–4.6, automated tests passed)

`forwarding.rs` and the role-aware RTC/signaling owner now add one publisher and
one viewer, with exact room/source binding, a 32-packet in-process channel,
Opus/VP8 payload routing, negotiated outbound PT/SSRC/MID, local per-track sequence
counters and bounded PLI feedback. Viewer/source teardown removes the route;
overflow closes the slow viewer. No decoding, transcoding, JSON media or Electron
IPC is added. The new two-Rust-client UDP test covers opaque audio/video payloads
and PT translation, not real codec playback. The user supplied passing Docker
formatting, Clippy and all 41 Rust tests (37 backend, four protocol), then confirmed
the locked workspace/backend image builds completed. No new image ID or separate
formatting-check output was supplied. See [forwarding-spike.md](forwarding-spike.md)
for evidence, limits and commands.
This is feasibility forwarding only; no step 4.7 acceptance is implied.

## Public Internet transport increment (sections 4 and 5, code only)

The media transport gained an explicit deployment mode. `local` keeps the LAN
test environment; `public` is the Internet target and binds media admission to
the authenticated signaling session and its observed peer address, drops
unusable candidates, refuses plaintext and LAN allowlists, and never dials a
client-supplied destination. Section 5 adds an explicit resource budget, a
bounded metrics and event module for the administrator panel, and TLS
certificate expiry reporting. The design, the deployment requirements and the
open evidence gaps are in [public-transport.md](public-transport.md).

The Rust changes of this increment were **not** compiled, formatted, linted or
tested in Docker: the Docker socket was not accessible in the authoring
session. The canonical checks are blocked, not passed. The client-side
candidate change (IPv6 candidates are offered, the backend decides) passed
`bun test ./tests/plugin` with 274 tests.

No real client has exchanged media over the public mode, so the public
Internet acceptance gate of section 4 and the two-client checklist below stay
open.

## Browser client groundwork (partial step 4.6)

`clients/spike/signaling.ts` adds an explicitly experimental, HTTPS-only WSS
client with generated runtime validation, DASS first-message login, bounded
pending requests/write buffering and abort/close cleanup. It is not installed
in the plugin, connected to capture or a working viewer. Endpoint selection
supports a future one-host or two-machine test; final topology is undecided.
No Compose publication or host networking changes were made. See
[spike-client.md](spike-client.md) for limitations and client checks.

The user has now selected two CachyOS/Wayland clients on the same LAN, with the
current machine also hosting the Rust backend. The custom Equicord build now
includes a manual publisher/viewer panel and stages generated protocol/client
modules. Plugin lint, full typecheck, desktop/Equibop bundles and 69 client tests
passed. GUI/media lifecycle, client-trusted TLS, explicit LAN access and real
two-client evidence remain outstanding. See
[wayland-two-client-test.md](wayland-two-client-test.md). No LAN publication or
host network/security change was made by the agent.

## Required implementation order

1. Review and pin a maintained DASS credential-verification implementation and
   HTTPS/WSS crypto provider. Resolve intentional dependency additions in Docker,
   commit `Cargo.lock`, then use locked builds/tests. Keep one Rust executable;
   do not create a separate signaling service.
2. Add invite/account DASS identities and publisher-controlled stream admission
   for watching. Discord identity/channel claims confer no authority and rooms
   grant no access. Reauthorize each operation and disconnect expired/contained
   sessions. Bound credentials, room membership, sessions, pending approvals and
   unauthenticated connections.
3. Add TLS/WSS signaling with strict message validation, bounded queues, setup
   deadlines and an exact Origin policy. Browser connections use short-lived
   single-use tickets or a timed first-message login; never credentials in URLs.
   Require secure transport except explicit loopback development. Required E2EE
   must fail closed while it is unavailable. Never log credentials or full SDP.
4. Review and pin str0m and a single crypto provider. Implement a bounded,
   single-owner RTC/UDP loop for the minimal interoperability spike, including
   safe server-side ICE destination restrictions. Do not implement multi-viewer
   SFU routing yet.
5. Run two actual Equibop clients against this Rust transport before SFU work.
   Record exact Equibop/Equicord/Discord revisions, OS/display-server versions,
   server image/dependency lock, codec and scenario. Leave readiness at 503 and
   media capabilities unavailable until their advertised behavior is operational.

## Two-client evidence checklist

- Publisher uses the installed picker/capture function and viewer receives video
  plus explicitly selected share audio through the Rust WebRTC endpoint.
- Video-only, cancellation, source end, stop, logout, plugin disable and context
  exit leave no capture tracks, venmic link, sockets or listeners behind, including
  failures during audio acquisition and pending capture.
- Test Wayland and X11 separately; ordinary Discord voice continues independently.
  Scoped network tracing verifies no DASS frames/previews go to Discord.
- Verify DTLS-SRTP negotiation, supported codecs, secure signaling/worker policy,
  credential expiry/replay/revocation, unauthorized rooms/roles, malformed and
  oversized SDP/ICE, unsafe ICE destinations and E2EE downgrade rejection.
- Exercise disconnect/reconnect and backend restart. Do not claim node failover,
  TURN, E2EE or performance support without their separate evidence.

No checklist item above is marked passed. Only after the gate passes should SFU
packet mapping, feedback, pacing and bounded retransmission caches be implemented.
