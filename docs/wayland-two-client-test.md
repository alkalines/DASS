# CachyOS Wayland two-client test preparation

Discord Alternative ScreenShare (DASS) is targeting two CachyOS/Wayland machines
on the same LAN. One machine is both a client and the Rust backend host. This is
a manual interoperability test, not a supported release or a passed step 4.6 gate.

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

## Manual panel flow once networking is ready

1. Set the same HTTPS backend origin in DASS settings on both clients. Use separate
   DASS credentials: publisher grants on one, subscribe grants on the other, with
   access to the same DASS room. Do not use Discord tokens or channel IDs as grants.
2. Prepare the viewer, then prepare publisher capture using the installed host
   picker. Explicitly select share audio there or choose video-only. Preparation
   holds capture locally and expires after 60 seconds; it does not prove consent
   or capture correctness on the target host until observed.
3. The panels show only gathered IP:UDP-port pairs, not full SDP. Configure those
   exact endpoints in the backend allowlist **before** activation. If Chromium
   produces mDNS/IPv6 candidates, preparation fails visibly. This limitation is
   not solved by disabling browser privacy/security settings.
4. Enter credentials after preparation (Stop/Prepare clears them). Activate the
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
