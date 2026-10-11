# DASS: implementation plan and research

Status: architecture proposal with an opt-in, authenticated one-publisher/one-viewer
experiment and user-reported LAN video evidence, not a production or benchmarked
screensharing system. The [directory and viewer](../watching.md) also have
user-reported discovery and audio playback evidence. Audio consent and backend
checks are user-confirmed; broader runtime acceptance remains pending.
E2EE is unavailable; the Phase 0
transport gate remains open. Target repository: <https://github.com/alkalines/DASS>.
See [backend development](../backend.md) and [plugin status](../plugin.md) for
commands and limitations. The architecture and future-work sections below are
proposals, not verification evidence.

## 1. Recommendation

Build an Equicord TypeScript plugin and a **single Rust backend executable**.
Use Chromium's existing screen capture, encoders and WebRTC implementation on
the client. Use `str0m` to implement a selective forwarding unit (SFU) on the
server: route encoded packets without decoding, transcoding or recording.

Use Rust for both signaling and media in one Docker container. Do not introduce
a Bun server or separate signaling service. Bun is only for the monorepo's future
TypeScript plugin tooling. Rust dependency resolution, compilation, formatting,
linting and automated tests run in Docker; no host Rust toolchain is required.
Bun/TypeScript and Equibop client tooling may run locally.

No DASS client daemon, FFmpeg process, GStreamer process, native encoder helper,
local proxy or sidecar. Web Workers inside Equibop are permitted for frame
encryption. Electron already uses multiple processes; this requirement is
interpreted as **no additional DASS helper executable**, not single-process Electron.
Linux's existing PipeWire and desktop portal services remain OS prerequisites.

## 2. The critical compatibility boundary

Discord screensharing is not an interchangeable HTTP upload endpoint. It includes
private signaling, stream state, permissions and media negotiation. Changing a URL
will not make Discord clients receive DASS media.

- Both broadcaster and viewers need DASS for the initial release.
- Normal Discord voice chat stays on Discord; only the DASS screen video and
  explicitly selected share audio use our backend.
- A DASS screen-share action will replace/intercept the selected native share
  action when DASS mode is enabled, before native stream creation occurs.
- A DASS viewer panel and local stream state replace the native receiving path.
  Native Go Live discovery/tiles are not guaranteed; deeper integration is later work.
- Non-plugin users cannot watch DASS in stock Discord. A browser viewer is an
  optional future backend-hosted feature, not a transparent compatibility fix.
- Do not emulate Discord's voice server or fabricate gateway stream events.
- When DASS fails, do not silently send captured media or preview thumbnails to
  Discord. Native sharing remains an explicit, separate user choice.

A separate DASS button is the integration spike's safe starting point. Release
requires verifying the requested native-action interception. If it cannot be made
reliable, present the separate-button limitation for approval, rather than claiming
transparent replacement.

## 3. Findings from Equibop and Equicord

Inspected Equibop commit: `27219be3566589280c0c933b04753805381d3bc8`.
The local package declares Electron `^43.7.1`, optional `@vencord/venmic`
`^7.2.3`, and Bun `>=1.3.0`; declarations are not proof of runtime capability.

| Location | Finding and consequence |
| --- | --- |
| `src/main/screenShare.ts` | Registers `setDisplayMediaRequestHandler`, uses `desktopCapturer`, and delegates to the existing source picker. Reuse this, preserve user consent. |
| `src/renderer/patches/screenShareFixes.ts` | Wraps `getDisplayMedia`, applies quality constraints and attaches the `vencord-screen-share` audio device. Call the installed capture function, not an unpatched copy. |
| `src/renderer/components/ScreenSharePicker.tsx` | Existing resolution/FPS, content hint and Linux audio selection UI. Verify behavior when capture is initiated by DASS instead of Discord. |
| `src/main/venmic.ts` | Loads an in-process `.node` module. Reusing the host's audio integration does not require a new client executable. Missing venmic must produce a clear video-only option. |
| `src/main/vencordDir.ts`, `src/main/ipc.ts` | Supports a custom built Equicord directory. Plugin deployment belongs in an Equicord build, not Equibop's renderer patch directory. |
| Equicord `scripts/build/common.mjs` | Discovers `src/userplugins`; renderer code uses host React via `@webpack/common`, not another React installation. |
| Equicord `instantScreenshare/index.tsx` | Demonstrates stream-start/stop discovery and voice context. These are candidate integration anchors, not a verified DASS interception hook. |
| Equicord `equibopStreamFixes.equibop/index.tsx` and `webScreenShareFixes.web/index.ts` | Patch Discord quality/SDP behavior, not alternate transport. Avoid conflicts with our independent peer connections. |

Upstream files were read from moving `main` branches. Pin exact Equicord commits
and record the Discord build used during the spike. This source inspection does
not prove which patches match the live Discord bundle.

## 4. Architecture and data flow

```text
Equibop broadcaster                    Equibop viewers
  Equicord DASS plugin                   Equicord DASS plugin
  existing picker + MediaStream          DASS viewer + video element
  Chromium encode                         Chromium decode
  optional/required E2EE transform         matching E2EE transform
          |                                      ^
          +---- WebRTC / DTLS-SRTP ---------------+
                         Rust DASS SFU
                    no decode / no transcode
                             |
                HTTPS/WSS authentication, rooms,
                SDP/ICE, discovery and control
```

1. Configure a trusted `https://` backend base URL. Fetch a versioned capability
   document containing signaling and media connection information.
2. Authenticate with a DASS credential; create or join an authorized room.
3. On an explicit user gesture, capture using the existing Equibop picker.
4. Own the resulting tracks inside a DASS session controller. Configure independent
   `RTCPeerConnection` transceivers, codec preferences and bitrate limits.
5. Exchange SDP and ICE messages over authenticated WSS. Negotiate the specific
   ICE behavior supported by the pinned server library; do not assume trickle ICE.
6. Publish once per selected encoding layer. The SFU forwards to authorized viewers.
7. Attach viewer tracks directly to `video.srcObject`; bound simultaneous active
   decodes and pause/unsubscribe hidden views.
8. Stop tracks, close peer connections, remove listeners/workers and revoke local
   session state on stop, source end, logout, plugin disable or voice-context exit.

Use a state machine: idle -> authenticating -> joining -> capturing -> negotiating
-> live -> reconnecting -> stopped/failed. Cancellation and repeated stop must be
safe. Switching backend ends the old session; it never reuses credentials/keys
across unrelated origins.

### Plugin settings

- Backend base URL; reject embedded credentials and insecure production URLs.
- DASS login/credential management, separate from Discord authentication.
- Transport encryption versus required end-to-end encryption, clearly labeled.
- Resolution, FPS, maximum bitrate, and content mode (text/detail or motion).
- Explicit share-audio toggle; never include the microphone implicitly.
- Privacy mode (`iceTransportPolicy: "relay"`), only when usable TURN is advertised.
- Native replacement toggle and visible backend/session connection status.

Use host UI APIs and small, guarded patch adapters. If a patch fails or is ambiguous,
disable native replacement and explain why. Do not monkey-patch every peer
connection or every screen-capture request globally.

## 5. Dependencies and alternatives

### Recommended baseline

| Area | Candidate | Why / caution |
| --- | --- | --- |
| Plugin runtime | Equicord settings, plugin, webpack and UI APIs | Host-provided; do not bundle a duplicate React or Electron. |
| Client media | Browser `MediaStream`, `RTCPeerConnection`, `getStats` | No native DASS media runtime or FFmpeg. |
| Client encryption | Encoded transforms + reviewed SFrame-compatible implementation | Implementation selection and review are a release gate, not a solved dependency. WebCrypto alone is not a complete secure frame protocol. |
| TS build/test | Bun, TypeScript, existing Equicord build, esbuild as needed | Build plugin as a userplugin; validate worker bundling and CSP. |
| Rust media | `str0m` | Sans-I/O WebRTC; we must write the actual SFU routing/scheduling logic. Not a turnkey conferencing server. |
| Rust networking | `tokio`, `axum` with WebSocket support, `tower` / `tower-http` | HTTP/WSS control and asynchronous socket I/O. |
| Protocol/config | `serde`, `serde_json`, generated JSON Schema and TS types | One versioned contract; runtime message validation and strict limits. |
| HTTPS/WSS | `rustls`, `tokio-rustls` or compatible Axum TLS integration | Explicitly select TLS crypto providers; avoid unintended duplicate providers. |
| Media crypto | One supported `str0m` crypto provider | Current upstream offers AWS-LC, RustCrypto and OpenSSL options. Prefer AWS-LC initially, compare build/operational cost with RustCrypto. |
| Auth | Maintained token-verification library, or opaque capability tokens | Short-lived scoped tokens. Pin and review the selected implementation before coding. |
| Observability | `tracing`, `tracing-subscriber`, Prometheus-compatible metrics | Redact identifiers, SDP, IPs, tokens and all keys. |
| Optional persistent state | SQLite adapter | Backend identities/revocations only; no media storage. Not needed for an invite-only spike. |
| Restricted-network support | Backend-managed coturn | STUN/TURN, including TCP/TLS fallback; extra backend service, never a client executable. |
| Quality/security checks | Containerized Rust tests, `cargo-audit`, `cargo-deny`, fuzzing; Bun tests for future TS packages | Development/CI tooling, not client runtime processes. Security tools are planned, not yet included. |

Do not add all dependencies on day one. Generate and commit `Cargo.lock` using
Docker before validating the scaffold, then require locked builds. Commit
`bun.lock` when TypeScript packages exist. Review transitive dependencies and licenses.
Current str0m upstream declares version `0.24.1`, Rust 2024 edition and MSRV
1.85.0; verify published packages and all selected dependencies' toolchain needs.
Its defaults include example-server dependencies: disable defaults and explicitly
select needed features to avoid unnecessary TLS/example packages. AWS-LC may
require a native build toolchain; RustCrypto reduces native-build friction but is
not automatically the fastest or safest choice.

### Other options

| Option | Assessment |
| --- | --- |
| Established server such as LiveKit | Comparison baseline/fallback if custom-SFU engineering cost is too high; not the proposed backend we write. |
| MediaRecorder over WebSocket | Reject for primary media: chunk delay and TCP head-of-line blocking; no native WebRTC congestion/recovery pipeline. |
| Custom RTP/crypto/codec stack | Reject: unnecessary security risk and maintenance. Reuse maintained implementations. |

## 6. Efficiency and concurrency

- Begin with one video encoding and optional Opus share audio. VP8/H.264 baseline
  interoperability tests; choose the default from measured Linux encoder support.
  VP9/AV1 and SVC are later negotiated capabilities, not assumed GPU acceleration.
- Preserve the captured aspect ratio. Existing Equibop patches assume 16:9 in places;
  validate ultrawide and window capture instead of forcing that ratio in DASS.
- No raw video or encoded frame copying through Electron IPC. Only control metadata
  crosses any narrow host bridge.
- SFU routing must handle destination SSRC/sequence mapping, payload types, RTP
  extensions, RTCP feedback, pacing, retransmission caches and keyframe requests.
  Library support does not eliminate these application responsibilities.
- Single owner per RTC state; shard rooms/peers across bounded media workers.
  Avoid a global per-packet lock; use bounded queues and capped buffer pools.
- Use congestion feedback and rate-limited keyframe requests. Bound NACK caches
  and retransmission age. Test stale-packet drops rather than building latency.
- Add simulcast only after measuring encode cost; layer switching must be keyframe
  safe and account for E2EE's opaque payloads and codec dependency metadata.
- Apply room/publisher/viewer/bitrate caps and admission control before overload.

Capacity is primarily a bandwidth budget, not a language claim. One 8 Mb/s stream
with 20 viewers requires about 160 Mb/s SFU egress before packet/crypto overhead.
Multiple layers increase publisher encode/upload cost. TURN can add substantial
traffic and cost. Benchmark p50/p95/p99 latency, CPU, allocations, memory, egress,
loss and retransmissions on named hardware before setting capacity promises.

## 7. Security and authorization

**Always:** TLS for control, WebRTC DTLS-SRTP for media, certificate verification,
unpredictable room identifiers and short-lived room/role-scoped capabilities.
No disabling TLS verification, no Discord user tokens sent to DASS, no public
unauthenticated publish or join endpoints. Authenticate early, cap unauthenticated
connections and validate every control message. A Discord channel ID is context,
not proof of identity or channel membership.

Start invite-only with backend-authorized publish/subscribe capabilities. Later,
optional Discord OAuth must be verified server-side and use narrowly scoped access;
Discord voice-channel membership/permission enforcement needs its own validated
design. Never trust a client's claimed user ID or permission-store result as server
authorization. Check roles on each operation and actively disconnect revoked peers.

Browser WebSockets cannot freely set authorization headers. Use a short-lived,
single-use connection ticket or an authenticated first message with a short timeout;
keep secrets out of URL/query logs. Origin checks complement authentication; CORS
is not authentication. Constrain backend-advertised endpoint origins and ICE policy.

**Important:** DTLS-SRTP terminates at the SFU, so it is not broadcaster-to-viewer
end-to-end encryption. For privacy from the backend, encrypt encoded audio/video
frames before packetization and decrypt at viewers using a reviewed SFrame-style
scheme. The SFU forwards encrypted payloads and cannot transcode or record plaintext.

For an initial E2EE design, evaluate a high-entropy out-of-band room secret, with
separate authenticated membership capabilities. The server must never receive that
secret. Define sender-specific key derivation, nonce/counter uniqueness across
reconnects, replay protection, key epochs and rotation on membership changes.
Authenticate key distribution so a malicious signaling server cannot insert a
decrypting participant. A backend-distributed plaintext group key is not this
threat model. Former members can retain previously received content; rekeying only
protects future media. Prefer an established key-management protocol over inventing one.

E2EE requires capability detection, worker/CSP testing, known test vectors and
independent security review. Required-E2EE rooms fail closed for unsupported clients;
never silently downgrade. A transport-encrypted prototype must be labeled as such
and cannot pass an E2EE production release gate. Even E2EE exposes traffic metadata,
IP addresses, timing and sizes to infrastructure; malicious signaling can deny service.

Server endpoints also need rate limits, size limits, timeouts and fuzz-tested SDP/ICE
handling. Restrict media candidate destinations to avoid turning the SFU into an
internal-network probing tool. TURN must use short-lived credentials, quotas and
denied private/loopback destinations; it must never be an open relay.

## 8. Redundancy and network deployment

Initial backend: one executable, explicit readiness/liveness endpoints, graceful
draining and clean restart recovery. Production HA: at least two SFU instances,
room placement with owner leases/epochs, and replicated authoritative authorization
and room metadata. Choose a coordinated datastore only when building this stage;
do not pretend separate local SQLite databases provide HA. Fence stale owners.

Live ICE/DTLS/SRTP state is not ordinary database state. A dead SFU generally means
renegotiating new peer connections on another node, requesting a keyframe and
resuming. Keep capture tracks alive for a bounded reconnect window, use exponential
backoff/jitter, and communicate interruption. Signaling disconnect need not stop
healthy media immediately, but must not bypass token expiry/revocation policy.

Set provisional recovery targets (not promises): recover within 5 seconds after
node-loss detection under a defined test network. Seamless failover requires warm
dual connections or duplicate publishing, increasing CPU/bandwidth; defer it until
explicitly needed. Never duplicate every media stream by default.

Expose HTTPS/WSS on TCP 443 and configured public UDP media ports. An HTTP reverse
proxy does not proxy UDP media. Advertise reachable addresses correctly, document
firewall/NAT requirements, IPv4/IPv6, and test restricted enterprise networks.
For reliable coverage, coturn instances live inside backend infrastructure with
independent failure domains and TCP/TLS listeners where needed. If the requirement
also means exactly one backend executable, TURN integration is an additional scope
decision; don't quietly introduce coturn under that interpretation.

No Kubernetes/Redis/metrics sidecars are required for the first release. Docker
and Compose are the backend build, test and deployment workflow; all operational
services stay server-side. Production servers need patched OS images, least privilege,
resource limits, secret injection and key/certificate rotation procedures.

## 9. Proposed DASS monorepo

```text
DASS/
  AGENTS.md
  README.md
  LICENSE
  package.json                 # Bun workspace/tooling
  bun.lock
  Cargo.toml                   # Rust workspace
  Cargo.lock
  Dockerfile                   # tooling, builder and non-root runtime stages
  compose.yaml                 # container-only checks and local backend
  apps/plugin/                 # Equicord userplugin source
    index.tsx
    settings.ts
    discordAdapter.ts          # private Discord patches isolated here
    session.ts
    capture.ts
    viewer.tsx
    crypto/                    # bundled encoded-transform worker
  crates/backend/              # one service entrypoint, HTTP/WSS + media I/O
  crates/sfu/                  # routing, feedback, bounded scheduling
  crates/protocol/             # contracts/schema generation
  packages/protocol/           # generated TS types + validation
  docs/research/               # this research and reproducible spike results
  docs/adr/                    # stack, E2EE, auth, ICE and HA decisions
  infra/                      # server-only deployment/config examples
  tests/interop/              # runtime, NAT, codec and E2EE matrices
  tests/load/                 # developer/server-side load tools
  scripts/                    # explicit Equicord userplugin installation/build
  .github/workflows/           # lint, tests, builds, security checks
```

Keep Equicord upstream as a pinned build input, not a copied fork inside DASS.
Installation stages the plugin at `src/userplugins/dass` in an explicit Equicord
checkout, builds the Equibop target, and uses Equibop's custom Equicord directory.
Validate that workflow against the pinned upstream scripts. Do not download and
execute arbitrary remote plugin code at runtime. Consider GPL-3.0-or-later for the
plugin, preserve upstream notices, and review backend/dependency licensing before
choosing a monorepo-wide license.

## 10. Implementation sequence and acceptance gates

### Phase 0 — feasibility, before committing to the media stack

- Run two real Equibop clients: DASS capture -> minimal str0m transport -> DASS view.
- Verify Wayland and X11 source selection, cancellations, audio inclusion/exclusion,
  full track cleanup and simultaneous ordinary Discord voice.
- Prove native screen-share interception before Discord stream creation. Confirm
  no DASS frames or thumbnails reach Discord, with scoped network tracing.
- Verify custom URL connectivity, WSS/worker CSP, codec compatibility, str0m ICE
  negotiation and host-plugin build/install on pinned versions.
- Prove encoded audio/video encryption/decryption and compatible SFU packetization;
  select/review an actual maintained frame-encryption dependency.
- Record whether hardware encoding is really used, not merely enabled in settings.

Deliverable: reproducible evidence validating the selected Rust stack, or an ADR
proposing an established SFU if the custom implementation is not justified. Rust
signaling and Docker-only tooling are selected; media-library feasibility remains
unverified. Do not proceed on an unsupported compatibility assumption.

### Phase 1 — bounded single-node vertical slice

Plugin settings, scoped authentication, one broadcaster, multiple viewers, video
plus optional share audio, independent DASS viewer, bounded queues, lifecycle
cleanup, structured redacted logs and explicit native-action replacement.
Implement encrypted WebRTC transport and enforce the chosen E2EE policy; label
any development-only non-E2EE build plainly. No auto-start/background capture.

### Phase 2 — hardening and measurable efficiency

Secure invite/revocation flow, required E2EE, security review, TURN deployment,
congestion/retransmission tests, codec negotiation, adaptive layers if justified,
privacy mode, fuzzing, dependency checks and repeatable load tests.

### Phase 3 — redundancy

Two nodes, coordinated room placement, lease fencing, capacity-aware scheduling,
bounded reconnect, graceful drain and certificate/token/key rotation drills.
Test node failure, signaling failure and TURN failure independently.

### Phase 4 — release and maintenance

Document server sizing from measurements, packaging/install instructions, supported
Equibop/Equicord/Discord builds, upgrade/rollback rules and private-patch smoke tests.
Keep a visible safe failure mode when Discord updates break an integration anchor.
Consider browser viewing and deeper native UI integration only afterward.

### Required test matrix

- Wayland/X11; supported desktop portals; x64/arm64; video-only and venmic audio.
- 720p/1080p at 30/60 FPS; text versus motion; ultrawide and window source resize.
- Codec negotiation, slow viewers, join/leave churn, simultaneous publishers.
- UDP allowed/blocked, TURN TCP/TLS, NAT variants, IPv6, IP changes and ICE restart.
- Loss/jitter/reordering, bandwidth throttling, retransmission/keyframe storms.
- Invalid/expired/replayed tokens, unauthorized join/publish, spoofed Discord IDs,
  oversized/malformed control/SDP/ICE, abusive candidate destinations and TURN quotas.
- E2EE vectors, missing transforms, downgrade attempts, nonce reuse after reconnect,
  replayed frames, member removal/rekey, malicious signaling and no key leakage.
- Stop/disable/logout/context-switch during every lifecycle phase; no residual
  capture indicator, worker, socket, event listener or unbounded queued data.
- Discord integration changes and other enabled screenshare-related plugins.

## 11. Decisions to confirm

1. Is plugin-required viewing acceptable? Stock-client viewing is not feasible by
   simply redirecting the transport.
2. Does encryption mean transport encryption or privacy even from the backend?
   Recommend E2EE for the production privacy requirement.
3. Is reconnect-on-failure acceptable, or is near-seamless dual-path redundancy needed?
4. Expected publishers/viewers, resolution/FPS, regions, hardware and uplink budget?
5. Are backend-only TURN/services allowed, or must even the backend be one executable?
6. Invite-only DASS rooms initially, or verified Discord membership from day one?

## 12. Sources

- [Equibop](https://github.com/Equicord/Equibop), local paths and commit above.
- [Equicord build/plugin discovery](https://github.com/Equicord/Equicord/blob/main/scripts/build/common.mjs).
- [InstantScreenshare](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/instantScreenshare/index.tsx).
- [EquibopStreamFixes](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/equibopStreamFixes.equibop/index.tsx).
- [WebScreenShareFixes](https://github.com/Equicord/Equicord/blob/main/src/plugins/webScreenShareFixes.web/index.ts).
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
  and [session](https://www.electronjs.org/docs/latest/api/session), queried through Context7.
- [str0m](https://github.com/algesten/str0m), README/API queried through Context7;
  [Cargo features/toolchain](https://github.com/algesten/str0m/blob/main/Cargo.toml) inspected directly.
- [MDN encoded transforms](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpScriptTransform).
- [SFrame specification, RFC 9605](https://www.rfc-editor.org/rfc/rfc9605).

Source/document inspection and an HTTP scaffold were completed. User-provided
Docker output confirms Clippy, all 12 unit tests, the locked release image build
and Compose container startup succeeded. HTTP smoke checks are pending. Runtime
capture, transport compatibility, E2EE, performance and failover remain untested.
