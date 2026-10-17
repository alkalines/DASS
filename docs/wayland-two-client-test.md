# CachyOS Wayland two-client test preparation

For the chosen **direct LAN first-stream attempt**, use
[direct-lan-test.md](direct-lan-test.md). Cloudflare setup is deferred. The
historical tunnel planning below is not a prerequisite for this direct test.

Discord Alternative ScreenShare (DASS) is targeting two CachyOS/Wayland machines
on the same LAN. One machine is both a client and the Rust backend host. This is
a manual interoperability test, not a supported release or a passed step 4.6 gate.

## User-reported local capture preflight

The publisher/backend is `X.X.X.1`; the viewer is `X.X.X.2`.
After launching the custom Equibop host, the user reported that the local capture
check acquired video-only capture, Stop removed the OS capture indicator, picker
cancellation left no active capture, and Discord voice continued working in both
directions. This is user-observed CachyOS/Wayland evidence, not agent-observed GUI
validation. Exact running host/Discord versions were not supplied for this check.
Selected audio, network media playback and absence of Discord media/preview
leakage remain unverified; the two-client transport gate has not passed.

Subsequent publisher and viewer preparation both failed before activation. The
publisher opened the picker and released capture after failure. The original
generic status did not identify the cause; neither mDNS nor any other cause is
confirmed. The panel now exposes fixed preparation failure codes for codec
configuration, offer/local-description setup, gathering deadline, candidate
policy and capture tracks. It never displays raw browser exception messages,
SDP or candidate text in failures. Plugin lint/typecheck/bundles and 77 client
tests passed after this diagnostic change; real preparation needs to be retried.

The retry reported `[candidate_address]`. This does not identify the address
family conclusively, but the client previously refused a mixed IPv4/IPv6 offer
even when valid IPv4 candidates were available. The offer now omits IPv6 candidate
lines before validation/signaling. Addresses/ports and media negotiation lines
are not rewritten; no-IPv4, mDNS, malformed or unsupported-transport offers still
fail closed. The backend exact endpoint allowlist is unchanged. Client tests
cover filtered SDP and the actual mock signaling offer; real preparation must
be retried before claiming this resolves the user's failure.

After filtering IPv6, the user reported successful preparation on both machines,
with publisher endpoint `X.X.X.1:35578` and viewer endpoint
`X.X.X.2:55748`. These are diagnostic observations, not persistent
allowlist entries: prepared peers expire and new peers can select different ports.
The viewer's empty video player/spinner appeared before credentials or activation;
it is not evidence of a connection or received media.

The user has an existing Cloudflare Tunnel route at
`https://testbench.megarthur.dev`, currently targeting HTTP port 8080. Its root
returns 404, which is compatible with the backend's missing root route but does
not verify WSS authentication. The planned HTTP tunnel carries signaling only;
WebRTC UDP media must use the direct LAN path. Backend TLS with verified tunnel
origin trust, WSS compatibility and scoped UDP publication remain pending.

## Current client artifact

The plugin settings now contain a manual test panel. The build adapter stages the
shared generated validators and browser signaling/peer modules into the dedicated
Equicord checkout; it does not alter either upstream submodule. On October 11,
2026, Bun 1.4.3 passed plugin lint, full Equicord typecheck, desktop and Equibop
bundle builds, all 76 client unit tests, generated-protocol freshness, and
`git diff --check`. GUI loading,
Wayland capture, real WSS/DTLS and video/audio playback remain **unverified**.
Seven peer lifecycle tests use browser doubles to check selected audio/codecs,
receive-only viewers, abort during setup, late offers, track bounds/source end,
signaling loss and rejected negotiation. They do not exercise real Chromium or
the panel's React lifecycle.

The manual panel is separate from the ordinary Discord share chooser, whose
DASS option still refuses native sharing. There is no directory or watch hook.
Use only this explicit test panel for the feasibility test. It never calls the
native Discord stream-start callback or uploads preview thumbnails. Actual absence
of Discord leakage still needs scoped runtime verification, not source claims.

## Client installation and preflight

From the DASS root as the normal desktop user:

```sh
bun scripts/build-plugin.mjs
```

On each test machine, place the resulting complete `build/Equicord/dist` directory
at a stable local path. Select **that directory**, not its `equibop` child, in
Equibop Developer Options as the custom Equicord location. Fully quit/restart
Equibop, then enable DASS in Equicord Plugins. No Discord injection is required.
Copying loose plugin TypeScript files does not install this integration.

The publisher requires the custom Equibop host capture bridge. Stock installed
Equibop will visibly fail publisher preparation; the plugin bundle cannot add a
host renderer bridge by itself. The staging script preserves the pinned upstream
checkout and adapts a separate host checkout:

```sh
# DASS repository root
bun scripts/stage-equibop-capture.mjs
```

Follow the host prerequisites/build workflow in [plugin.md](plugin.md), using
**build/Equibop**, not vendor/Equibop, for this adapted host. Its existing Bun lock
and dependencies must be checked before installation/build; do not install system
packages automatically, switch package managers, disable the sandbox, or treat
missing venmic warnings as successful share-audio support. A current packaged
custom host for this increment is not claimed built or GUI-tested here.

First use the existing **Test local capture (no transport)** control on the
publisher to verify the installed Wayland picker, cancellation and optional audio.
This test requests capture but does not transmit it. Report any bridge, portal,
venmic or cleanup failure before attempting network media.

## Network setup is still pending

The backend host currently reports LAN interface `enp129s0` with
`X.X.X.1/24`. Confirm that it is reachable from the second machine and
stable for the test. Do not use its Docker bridges or Tailscale CGNAT address as
the spike peer destinations. The current Compose publication remains loopback
only; no LAN exposure or firewall changes have been made.

Before activating a connection, choose the backend URL and provide a TLS
certificate trusted by **both Equibop clients**, with the corresponding DNS name
or IP SAN. Do not bypass Chromium certificate verification or disable browser
security. DASS backend TLS/WSS and explicit, narrowly scoped LAN UDP publication
must be configured separately. Networking instructions will be finalized after
the address/certificate choice is confirmed; installing the client alone cannot
make the current loopback backend accessible to the other machine.

The single `compose.yaml` now replaces the old signaling/media overrides. Set
the LAN bind/advertised IPs, TLS and explicit media opt-in as described in
[direct-lan-test.md](direct-lan-test.md). Runtime hardening is retained. Static
invite-based tests require `DASS_RTC_ALLOWED_PEERS` containing fresh exact
endpoints from both client panels, with no guessed/wildcard destinations.
The old endpoints recorded above must not be used after peers stop or expire.
No firewall, tunnel or networking changes were applied by the agent.

Before any activation:

- Supply `.secrets/runtime/cert.pem`, `.secrets/runtime/key.pem` and
  `.secrets/runtime/invites.json`, plus `.secrets/backend.env`, as
  described in [control-plane.md](control-plane.md), readable by the non-root
  backend without making the private key/credentials world-readable.
- The public Cloudflare edge certificate is distinct from the backend PEM
  certificate/key. This spike requires TLS on the Rust listener. Configure the
  existing tunnel to use an HTTPS origin, with verified certificate trust and a
  matching origin server name; do not enable `noTLSVerify`.
- Confirm the two UDP ports are free and explicitly scope firewall access to
  the test clients. Docker publication is not a client source-IP firewall;
  backend exact peer validation remains required. Router port forwarding is not
  needed for a reachable same-LAN path.
- Build/start and smoke-test verified HTTPS/WSS before preparing fresh peers.
  Then update the exact endpoint allowlist and recreate the test backend within
  the 180-second preparation window. Do not start authenticated sessions before
  that recreation, which would disconnect them.

The endpoint-approval/recreation sequence is experimental and not yet proven
usable within that short deadline. Do not relax candidate restrictions, disable
TLS or claim a working transport to work around test-harness limitations.

## Manual panel flow once networking is ready

1. Set the same HTTPS backend origin in DASS settings on both clients. Use separate
   DASS accounts, one per person; credentials are service-wide and carry no room
   grants. Do not use Discord tokens or channel IDs as credentials.
2. Prepare the viewer, then prepare publisher capture using the installed host
   picker. Explicitly select share audio there or choose video-only. Preparation
   holds capture locally and expires after 180 seconds; it does not prove consent
   or capture correctness on the target host until observed.
3. The panels show only gathered IP:UDP-port pairs, not full SDP. Configure those
   exact endpoints in the backend allowlist **before** activation. If Chromium
   produces mDNS candidates or no usable IPv4 candidates, preparation fails visibly;
   IPv6 candidate lines are omitted from the transmitted offer. This limitation is
   not solved by disabling browser privacy/security settings.
4. Enter credentials before or after preparation (Prepare preserves them; Stop
   and teardown clear them). Activate the
   publisher; give its returned DASS session ID to the viewer, then activate the
   viewer. The ID is not a credential and is not authorization by itself.
5. An applied answer is not a connected/playback result. Verify the viewer's video
   and selected audio, use its Play control if autoplay is blocked, and record
   codec/connection details without dumping SDP, credentials or frames.
6. Stop, close settings, change voice context, disable the plugin, log out and end
   the source in separate tests. These paths are intended to stop the manual
   session, peer, tracks and host capture lease; GUI acceptance is outstanding.

The strict candidate allowlist and short preparation lifetime may require a more
usable test workflow after real candidate gathering is observed. Do not claim
the above sequence is proven until the two real clients complete it.

Record exact Equibop/Equicord/Discord revisions, CachyOS/portal/PipeWire versions,
video/audio codec, independent Discord voice and no media/preview leakage using
[transport-gate.md](transport-gate.md). Readiness remains 503. Full SFU work stays
blocked until that evidence passes.
