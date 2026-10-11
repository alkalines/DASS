# Native capture bridge (development only)

Discord Alternative ScreenShare (DASS) has a local-only capture check using the
installed Equibop picker and capture function. It is **not enabled in the share
chooser** and establishes no transport readiness. No media or thumbnails are sent.

## Host change versus plugin

The pinned Equibop renderer exposes no picker audio-selection getter. The plugin
cannot import its renderer internals or patch them with Discord webpack patches.
`tooling/equibop/dassCapture.ts` exports a version-1 host bridge using the current
picker selection and the currently installed `getDisplayMedia` function. No
source picker, venmic implementation or media IPC is replaced. The installed
wrapper receives a narrow consent/cleanup fix in the separate build checkout.
`plugins/dass/capture.ts` accepts that bridge explicitly; missing support refuses
capture without falling back to Discord. A future adapter can supply
`Equibop.DassCapture` from the rebuilt host renderer after checking host support.

The host bridge:

- Retains ownership during a pending picker, capture and audio IPC. Concurrent
  native and DASS capture requests are refused, including after abort until capture settles.
- Reads audio consent from the picker rather than treating an audio track as
  consent. Unselected audio is stopped/removed and is never unmuted by DASS.
- Unmutes selected venmic audio directly, without synthetic Discord stream events.
- Stops returned tracks and venmic on release, abort and video source end.
  Release is idempotent. If stop IPC fails, ownership stays locked until restart.
- Suppresses only the host's Discord `STREAM_UPDATE`/`STREAM_CLOSE` audio actions
  while DASS owns the host audio lease. It does not intercept voice connections.
- Waits for pending capture/unmute to settle before final audio-stop IPC, avoiding
  an audio link being started or unmuted after teardown.

## Staging and checks

From the repository root:

```sh
bun scripts/stage-equibop-capture.mjs
bun test ./tests/plugin
bun scripts/build-plugin.mjs
```

Staging clones the pinned `vendor/Equibop` into `build/Equibop`. It changes the
renderer export, picker cancellation/audio lifecycle/quality guards, and capture
wrapper, and adds four bridge/ownership modules there.
It refuses unfamiliar changes, does not advance or edit either submodule, and
does not install, launch or inject anything. Re-running staging is supported.
When dependencies exist, the pinned host formatter formats generated sources.
On a first script-free install, rerun staging from the repository root afterward.

From `build/Equibop`, typecheck, targeted lint and `bun run build` passed with
Bun 1.4.3. Equicord lint/typecheck and desktop/Equibop bundles also passed.
`bun test ./tests/plugin` passed 58 tests (203 assertions). These checks do not
establish GUI compatibility. Tooling commands:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run testTypes
bun run lint src/renderer/dassCapture.ts src/renderer/dassCaptureLifecycle.ts src/renderer/captureOwnership.ts src/renderer/installedCapture.ts src/renderer/patches/screenShareFixes.ts src/renderer/components/ScreenSharePicker.tsx src/renderer/index.ts
```

This script-free install intentionally does not run upstream arRPC or native
postinstall work. It is **not a complete client installation**. The custom
Equicord build still belongs at `build/Equicord/dist` in Equibop's custom Equicord
location; a plugin rebuild alone cannot add this host bridge to stock Equibop.

## Implemented wrapper fix and local validation

- The staged wrapper stops partial video, removed/replaced audio and audio
  arriving after source end. Only explicit nonempty audio selection permits
  virtual-device enumeration/acquisition. It requires the exact, nonempty virtual
  audio-input ID, never a default microphone.
- Missing selected audio fails closed, not silently video-only. The picker/toast
  explains that users may explicitly select no audio when venmic is unavailable.
  Video-only capture does not depend on audio acquisition.
- A renderer singleton arbitrates the installed capture path and shared venmic.
  Native/DASS overlap is rejected before opening another picker. Native stream
  close releases native ownership; DASS release stops its own tracks/audio.
  This is not arbitration for arbitrary other IPC callers or simultaneous shares.
- Abort dismisses the Equibop picker. Pending source enumeration/OS portal or
  audio acquisition retains ownership until settlement. Audio linking settles
  before final stop IPC. OS portals may require manual dismissal; their UI is not
  guaranteed cancellable.
- DASS picker quality code skips Discord stream-connection mutation. Ordinary
  voice APIs, tracks and microphone acquisition are not patched.

In DASS settings, **Test local capture (no transport)** exercises capture without
a backend; **Stop local capture** cancels/releases it. Missing staged host support
fails visibly without fallback. Stop, source end, disable, logout, voice-context/
room changes and backend configuration changes release capture. Build and launch
the staged host intentionally using the prerequisites in [plugin.md](plugin.md),
from **build/Equibop**, and select `build/Equicord/dist` as the custom Equicord
location. Script-free tooling installation alone is not a complete GUI install.

## Outstanding GUI acceptance

Repeat separately in **Wayland** and **X11**; record OS/session, both pinned host
revisions and Discord build:

| Scenario | Required observation |
| --- | --- |
| Video-only, including unavailable venmic | No share audio or microphone acquisition |
| Selected application/system audio | Selected share audio unmuted without Discord events |
| Selected audio unavailable/acquisition failure | Visible refusal; partial video/audio stopped; video-only retry works |
| Cancel pending picker/portal or pending audio | No late capture resurrection; ownership held until settlement |
| Stop/source end/disable/logout/context/config change | Capture indicators disappear and audio releases |
| Native pending/active then DASS, and reverse | Second refused; first unaffected; retry works after cleanup |
| Ordinary Discord voice throughout | Connected/audible; microphone settings unchanged |
| DASS local check | No native Discord stream, preview upload or media transmission |

- Real Wayland/X11 picker behavior, optional audio, native-action interception,
  capture indicators, voice independence and absence of Discord media/thumbnail
  leakage remain unverified. No credentials, peer connection or Rust transport
  are supplied by this slice.

The chooser stays fail-closed. Tests use injected hosts and fake tracks; they are
not GUI acceptance or a two-client interoperability result. The capture exit
condition is not claimed met until the real-host checks pass.
