# Capture consent, teardown and client privacy

Discord Alternative ScreenShare (DASS) captures the screen only through the
host application. This document records the intended and implemented behaviour
of the capture boundary (roadmap section 6), what a client can observe, and
what is **not** verified yet.

## 1. The host capture boundary

- Only the stock capture adapter calls Equibop's installed `getDisplayMedia`
  wrapper. The plugin never calls `getUserMedia`, `captureStream()`, Discord's
  native media engine capture APIs or any preview upload. A source scan in
  `tests/plugin/captureConsent.test.ts` enforces this boundary.
- Capture comes from the installed Equibop picker through plugin-owned
  `captureHost.ts`, `stockCapture.ts` and `captureLifecycle.ts`. The adapter
  retains the installed host wrapper, never an unpatched Chromium function.
  No custom host build, helper process, daemon, proxy, encoder or decoder is used.
- Share audio is explicit. The bridge reports `audioSelected` from the
  picker's own choice; when the user selects no audio, the captured audio
  tracks are stopped and removed before the lease is handed to DASS. The
  microphone is never captured implicitly.
- On Linux, the adapter temporarily hides only the host's virtual share-audio
  input during device enumeration when no audio was selected. It leaves the
  microphone and unrelated devices alone and restores enumeration on release.
  See [stock-host limitations](capture-bridge.md), especially pending picker
  dismissal and host-internal capture failures.
- The bridge owns a singleton capture: a second capture attempt while one is
  live is refused instead of replacing it.
- The DASS share path never creates a Discord media stream and never uploads a
  preview thumbnail. Discord's own voice call continues independently.

## 2. Teardown paths

Every teardown path ends in the same cleanup: the capture tracks stop, the
host audio link is released, the peer and its workers close, the signaling
connection closes and the server-side route is dropped.

| Path | What happens | Where |
| --- | --- | --- |
| Picker cancelled by the user | The picker closes, no lease is kept, sharing never starts | `plugins/dass/capture.ts` |
| Capture cancelled while the host starts | The late lease is released instead of kept | `plugins/dass/capture.ts` |
| Source ends (track `ended`) | The subscription is disposed, tracks stop, the connection closes | `plugins/dass/routing.ts` |
| Publisher stops | Tracks stop, lease released, peer and signaling closed | `plugins/dass/publishing.ts` |
| Voice context exit | The context check resets the publisher and the viewer | `plugins/dass/publishing.ts`, `plugins/dass/watching.ts` |
| Logout or plugin disable | `stopMedia()` runs before the session is cleared | `plugins/dass/index.tsx` |
| Server failure or expiry | The signaling close handler fails the operation and releases the capture | `plugins/dass/publishing.ts` |
| Partial setup (capture ok, peer failed) | The catch path resets the operation and releases the capture | `plugins/dass/publishing.ts` |
| Repeated teardown | `reset()`/`stop()` are idempotent; the lease is released once | `plugins/dass/publishing.ts` |

The teardown matrix is covered by `tests/plugin/captureConsent.test.ts` with
fake peers, signals and streams. These are logic tests: they do not open a
picker, capture a display or stop a real media engine.

## 3. What is not verified

- No real Equibop client has been driven through this matrix in this
  repository. The picker, the venmic audio link, source end and logout still
  need acceptance on every supported OS, display server and Discord build.
- The "no media leakage" claim of section 6.3 needs scoped network inspection
  on a supported client build: verify that a DASS share creates no Discord
  media stream and uploads no preview thumbnail, including after a failed
  patch and a reconnect. A build that merely compiles is not evidence.
- A patch that no longer matches the Discord build must fail visibly and fail
  closed. It must never silently switch the chosen DASS action to Discord
  sharing.

## 4. Metadata exposure

The backend is not anonymous and does not pretend to be.

**The server observes**

- The IP address of every TCP connection it accepts, and the same address on
  the UDP media path. The address is the peer of the accepted socket;
  `Forwarded`, `X-Forwarded-For` and client claims are ignored.
- The DASS account name, the room ID, the stream ID, the session IDs and the
  timing of joins, publishes, view requests, approvals and disconnects.
- Aggregate byte counters per media session. They contain no payload content.
- The TLS client certificate, if one is presented, and the negotiated
  protocol version.

**The server never sees**

- Media keys, key epochs or the wrapped epoch blobs in plaintext. Key
  material is exchanged between the clients and only the ciphertext is
  relayed.
- Captured frames, audio samples or preview images.
- Discord user tokens. DASS uses separate credentials.

**Participants never see each other**

- Another participant's IP address, port or ICE candidate. Media is routed
  through the backend; there is no peer-to-peer path, and the backend never
  relays a participant's address to another participant.
- A client's full connection history. Rooms group members for discovery only.

**Administrators see more, not more authority**

- The panel shows the current connections of each account with their
  server-observed source addresses, the DASS rooms they are in and their
  publishing/watching activity. This is a live view: the association between
  an address and an account is discarded when the connection ends, and the
  operational log keeps fixed event codes instead of addresses or names.
- An administrator can end a session or stop a stream. That action closes the
  route; it never reveals the content, never adds a recipient and never
  overrides a publisher's cryptographic membership decision.

**Transport**

- HTTPS/WSS and DTLS-SRTP protect the connection in transit, and the E2EE
  media layer protects the content from the server. Traffic metadata (who
  connected when, how much was transferred) remains visible to the server and
  to the network operator.
- The roadmap's transport-only mode, login IP allowlists and scheduled
  account expiration are not part of this design. Removing the login IP
  allowlist does not remove the safe RTC destination and admission checks
  described in `docs/public-transport.md`.
