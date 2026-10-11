# Native capture bridge (development only)

Discord Alternative ScreenShare (DASS) has a tested host audio-lifecycle bridge
prototype. It is **not enabled in the share chooser**, and does not establish
working capture or transport interoperability.

## Host change versus plugin

The pinned Equibop renderer exposes no picker audio-selection getter. The plugin
cannot import its renderer internals or patch them with Discord webpack patches.
`tooling/equibop/dassCapture.ts` exports a version-1 host bridge using the current
picker selection and the currently installed `getDisplayMedia` function. No
source picker, capture function, venmic implementation or media IPC is replaced.
`plugins/dass/capture.ts` accepts that bridge explicitly; missing support refuses
capture without falling back to Discord. A future adapter can supply
`Equibop.DassCapture` from the rebuilt host renderer after checking host support.

The host bridge:

- Retains ownership during a pending picker, capture and audio IPC. Concurrent
  DASS capture requests are refused, including after abort until capture settles.
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

Staging clones the pinned `vendor/Equibop` into `build/Equibop`. It changes only
the renderer export, two audio-event guards and two new bridge modules there.
It refuses unfamiliar changes, does not advance or edit either submodule, and
does not install, launch or inject anything. Re-running staging is supported.

From `build/Equibop`, the following were validated with Bun 1.4.3:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run testTypes
bun run lint src/renderer/dassCapture.ts src/renderer/dassCaptureLifecycle.ts src/renderer/components/ScreenSharePicker.tsx src/renderer/index.ts
```

This script-free install intentionally does not run upstream arRPC or native
postinstall work. It is **not a complete client installation**. The custom
Equicord build still belongs at `build/Equicord/dist` in Equibop's custom Equicord
location; a plugin rebuild alone cannot add this host bridge to stock Equibop.

## Unresolved acceptance blockers

- The unchanged Linux capture wrapper can acquire video and subsequently reject
  during virtual-audio acquisition without returning that video stream. It also
  removes original audio tracks without stopping them. A bridge outside that
  function cannot reliably release those hidden tracks. A narrow upstream fix or
  explicit approval to change the wrapper is needed for full failure cleanup.
- That wrapper probes the virtual device regardless of the picker audio choice.
  Removing audio afterward prevents publishing it, but does **not** prove that no
  unwanted audio capture occurred. Preventing it requires a host-side capture fix.
- The existing venmic instance is process-global. Overlapping native Discord
  screen capture and DASS capture are not supported or proven safe. The guards
  prevent Discord lifecycle events from tearing down a DASS lease, but do not
  establish arbitration between simultaneous native and DASS pickers.
- Abort cannot dismiss the unchanged host picker. Late results are disposed;
  ownership remains held if the picker never settles.
- Real Wayland/X11 picker behavior, optional audio, native-action interception,
  capture indicators, voice independence and absence of Discord media/thumbnail
  leakage remain unverified. No credentials, peer connection or Rust transport
  are supplied by this slice.

These blockers keep the chooser fail-closed. Tests use injected hosts and fake
tracks; they are not a two-client interoperability result.
