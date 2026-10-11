# Experimental browser signaling client

Discord Alternative ScreenShare (DASS) has experimental signaling and media client
modules in `clients/spike`. The build adapter stages these modules and generated
protocol validators into the custom plugin, with a manual publisher/viewer panel.
Plugin lint, full typecheck and desktop/Equibop bundles passed. GUI and
network limitations/install preflight are in
[wayland-two-client-test.md](wayland-two-client-test.md). Ordinary share routing
still refuses DASS, and real capture/playback is unverified. The manual panel adds
no client executable, helper process or dependency.

`clients/spike/peer.ts` now adds Chromium peer preparation and activation source:
send-only publishing from an existing capture lease, receive-only subscribing,
VP8/Opus-only preferences, gathered candidate bounds and peer/track/signaling
teardown. It never calls a capture API or requests a microphone; the panel acquires
an existing host capture lease via the installed Equibop picker bridge. Its actual Chromium media lifecycle
and interoperability have not been tested.

Preparation gathers host-only candidates before authenticated join so the exact
IP:port pairs can be allowlisted without reloading an authenticated session.
There are no external STUN/TURN servers. IPv6 candidate lines are omitted from the
transmitted offer without rewriting any supported address or port. At least one
literal IPv4 candidate must remain. mDNS, malformed addresses and non-UDP
candidates still fail visibly rather than weakening policy. Preparation expires after 180 seconds;
activation has a 15-second connection deadline. `activate` returns the DASS session
ID after applying the answer, not proof that video/audio has reached the viewer.
The manual panel shows candidate endpoints and negotiation status without dumping
SDP, and provides a video player. Applying an answer is not a connected/playback
result. Real capture consent, connection state and playback still need verification.

The module uses the generated protocol's runtime validators, a configurable
HTTPS origin, WSS `dass.v1`, timed first-message DASS login, one outstanding
request, bounded message/write buffering and unique request IDs. Credentials are
not put in URLs/subprotocols, logged or stored. Abort, malformed messages,
unexpected responses, rejection, expiry and server closure tear down the socket
and pending requests. Its `closed` signal drives peer/track cleanup; signaling
does not itself create or own media tracks.

Browser WebSockets cannot set a custom Origin: this module must run
inside Equibop's `https://discord.com` renderer to meet the server's exact Origin
policy. The default socket uses Chromium's certificate verification; no insecure
certificate bypass or native-network fallback is added. Browser cookies may be
sent by Chromium, and the backend rejects such requests; use a dedicated backend
origin with no browser cookies. CSP/permissions and real WSS connectivity remain
unverified. Mock WebSocket tests are not real-browser interoperability evidence.

## Test topology

The user selected two CachyOS/Wayland machines on the same LAN, with this machine
hosting both a client and the Rust backend. The observed backend LAN address is
`X.X.X.1`; its stability and client-trusted TLS setup still need confirmation.

For two machines, first verify the hostnames/IPs, OS/display-server versions,
client-trusted TLS certificate names, routable UDP ports and each client's exact
ICE candidate endpoints. The current Compose service publishes only loopback
TCP. Another machine cannot reach it as-is. No LAN/public publication, firewall,
TLS trust-store or host-group change has been performed or authorized by this
topology discussion. Keep existing loopback defaults unchanged until explicit
networking setup is agreed.

The exact IP:port ICE allowlist is intentionally strict. Browser mDNS candidates
and changing ephemeral ports must be handled by the manual harness
without logging full SDP or weakening server destination restrictions. Do not
claim TURN/NAT traversal or arbitrary remote-machine support yet.

## Local checks

On October 11, 2026, Bun 1.4.3 passed all **76 client tests**, generated-protocol
freshness, plugin lint, full Equicord typecheck, desktop/Equibop bundle builds and
`git diff --check`. Six signaling tests use mocked sockets. Two candidate-policy
tests and seven peer lifecycle tests use browser doubles, not real Chromium.
The lifecycle tests cover consent mismatches, abort/gathering/late offers,
receive-only tracks, source end, signaling loss and setup rejection. GUI loading,
React panel lifecycle and actual WSS/DTLS/capture/playback remain unverified.

Run from the DASS repository root, using Bun (not a root shell for client work):

```sh
bun test ./tests/plugin
bun scripts/generate-protocol.mjs --check
```

If the validated adapter checkout and its installed TypeScript dependency exist,
the standalone transport can be checked without installing a new package:

```sh
bun build/Equicord/node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --lib ES2022,DOM --target ES2022 --module ESNext --moduleResolution Bundler clients/spike/signaling.ts
```

Next: verify the custom host capture bridge, arrange client-trusted TLS and scoped
LAN networking, install the custom bundles, and test real consent,
explicit audio, cleanup, independent voice and no Discord media/preview leakage.
Step 4.6 and full SFU acceptance remain incomplete.
