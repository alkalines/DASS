# Discord hook investigation

Discord Alternative ScreenShare (DASS) must consume explicitly selected DASS
actions before native stream creation, capture or preview upload. Private hook
implementation belongs in `plugins/dass/discordAdapter.ts`.

## Renderer evidence

User-provided Equibop DevTools results recorded on 2026-10-11:

- Discord release channel: `stable`.
- Discord build number: `634304`.
- Version hash and Sentry build ID: `17e01cf978c3c10a5688429a38db59a4926e8982`.
- `Vencord.Webpack.search('type:"STREAM_START"')`: module `401843`.
- `Vencord.Webpack.search('type:"STREAM_WATCH"')`: module `401843`.
- `Vencord.Webpack.search('previewDisabled')`: modules `560595`, `616356`.
- `Vencord.Webpack.search('getPreviewURL')`: modules `384200`, `450149`.
- `Vencord.Webpack.search('getStreamsForChannel')`: no matches.

Module IDs and mangled exports are investigation references for this build, not
production lookup anchors. An absent
stream-list search result does not establish that the functionality is absent;
its name may differ or its chunk may not be loaded.

## Source trace from user-provided factory excerpts

| Concern | Observed code | Boundary implication |
| --- | --- | --- |
| Native share start | `401843.XI` (`L`) synchronously dispatches `STREAM_START` with guild/channel and supplied options. | This is a native action sink, not proof of the earliest safe capture boundary. |
| Source preparation | `560595` contains `startStreamWithSource`, selects preview/audio/quality options, conditionally awaits `y.ys(e, {audio, maxFrameRate})`, then calls `401843.Xd` and `401843.XI`. | DASS must be consumed before that source-acquisition branch, not merely before `STREAM_START`. The complete factory and UI caller are still needed. |
| Activity capture helper | `260643.K4` detects `activity-frame:` sources; `260643.ys` calls `DiscordNative.activityCapture.captureStream`, with a 15-second orphan-capture timeout. | The pre-dispatch capture branch in `560595` is specifically embedded-activity capture, not evidence of Equibop desktop `getDisplayMedia`. Do not use this helper for DASS desktop capture. |
| Native watch | `401843.A9` (`v`) can call `D` to join voice before dispatching `STREAM_WATCH`, changing channel UI and selecting a participant. `401843.Nl` (`M`) also calls `D`, then `v` and opens the call UI. | A DASS watch action must be intercepted before these native watch entry points, preserving ordinary voice independently. |
| Preview fetch | `401843.Tp` (`w`) performs a GET to `STREAM_PREVIEW` and dispatches preview-fetch events. | This is retrieval, not thumbnail upload. |
| Preview display | `384200` is `ApplicationStreamPreviewStore`; `450149` reads it and invokes `401843.Tp` from an effect. | Neither supplied excerpt identifies upload. |
| Preview upload | `157667` contains `ApplicationStreamPreviewUploadManager`: it draws a captured frame into a canvas, encodes JPEG, dispatches `STREAM_PREVIEW_FETCH_SUCCESS`, then POSTs `{thumbnail}` to `STREAM_PREVIEW` through either the embedded chunked-request path or REST. | DASS must never enter this producer. Do not access its token or reuse its native upload path. Its activation/cleanup conditions still need inspection. |
| Preview upload guards | In the supplied `157667` excerpt, `Y0` debounces `Y1` by 500 ms; `Y1` checks the current connection and preview-disabled settings. It obtains an embedded video-output frame or a web MediaStream frame. `YJ` stops the timer and clears the connection; retries use 60 seconds and normal uploads use 300 seconds. | These are existing Discord thumbnail controls, not a DASS privacy boundary. Calls activating `Y0` and `YJ` are still needed. |
| Stream directory | `616356` exposes `getAllActiveStreamsForChannel` (used by native watch), `getAllApplicationStreamsForChannel` and native Flux handlers. | This identifies native store access, not the stream-list renderer. DASS must not forge native store records. |
| Stream rendering | `487048` reads/sorts `getAllApplicationStreamsForChannel` and supplies `streams` to an imported renderer. `61230` renders a channel's first stream. `105225` renders a manage-streams popout using active streams. | These are distinct native UI surfaces, not a single universal stream list. Follow the imported renderer before inserting a separate DASS directory. |
| Watch UI | `35903` renders native watch buttons; its handler calls `selectVoiceChannel` before `401843.Nl`. | Intercept an explicit DASS watch selection before the UI handler, not just inside the native watch action creator. |
| Share callers | `46282`, `191701` and `568006` import `560595.A`. `46282` supports one-click game sharing and lazy-loads a modal; `568006` can directly start a game stream or load modal `266536`. | The full source-preparation export is `560595.A`; the modal's share-submit handler and explicit DASS selection are not yet identified. Do not reinterpret ordinary one-click/native actions as DASS. |
| Native stream lifecycle | `130553` registers `STREAM_START`/`STREAM_WATCH` handlers and delegates to platform handlers. | Observing or consuming a later event is not an early-action interception. |
| Desktop input | `113634` contains `DesktopInputPool`; `acquire` calls a desktop-input class's static `get`, which invokes the currently installed `navigator.mediaDevices.getDisplayMedia`, wraps the returned tracks and registers source-end handling. | This is the source-level desktop capture sink compatible with Equibop's installed wrapper. Do not globally patch it: it is shared media-engine infrastructure and cannot identify explicit DASS intent by itself. |
| Unrelated capture matches | `363630` uses display media for feedback screenshots; `528416` contains a WebRTC compatibility shim. | Exclude both from DASS interception; capture-function searches alone are not screenshare-specific. |
| Manage-streams constant | The `FXj` export in `652215` re-exports `tW.FX` from the constants module. | The `handleGoLive: ef.FXj` property in the manage-streams UI is not evidence of a callable share-start hook. Inspect the actual share-button callback rather than treating this constant as an action creator. |
| Center-tray share start | The full `105225` factory renders `onClick:null!=C?S:_`. `S` stops the current native share. `_` invokes `j` when sharing is available; `j` invokes `471993.A` with guild/channel and analytics locations. | Wrap only the start branch with a per-click transport chooser. An explicit DASS choice must not invoke `_` at all. Existing-share stop, camera, mute, disconnect and watch controls stay unchanged. |
| Platform lifecycle handler | The full `130553` factory has an empty `platformHandleStreamStart` override. | It is not the desktop capture implementation and must not be used as the interception boundary. |
| Native picker entry | `471993.A` opens Discord modal `266536` only on embedded platforms. Its non-embedded branch sets quality, awaits `getMediaEngine().getDesktopSource`, then calls `401843.XI`. | This explains why Equibop opens its OS/host picker instead of loading the Discord modal. Transport selection must precede this function's capture call. |
| Voice Connected share callback | In `157667`, `vQ` creates `f=useCallback(() => 471993.A(guildId, channel.id, analyticsLocations), dependencies)`, followed by a current-user-stream lookup. The share button selects this callback for start, a different callback for stop, or opens manage-streams UI. | Wrap `f` only. This also covers that panel's manage-streams Go Live action because it reuses `f`, without replacing stop or voice controls. |

These observations are static source evidence supplied from the live renderer.
They do not prove execution order across modules, successful patch matching or
absence of runtime media leakage. Preview upload and several native UI callers
are now source-identified; uploader activation, modal submission, capture-helper
callers and the concrete stream-tile renderer remain to be traced.

The user reported that factory `266536` is unavailable in the currently loaded
renderer. Do not invent a modal patch or force-load chunks to bypass this gap.
The complete `260643` factory confirms activity capture, but the Equibop desktop
capture call chain remains unverified.

## Actual Equibop picker path

The user reports that the share action opens an OS source picker, followed by a
custom quality/audio panel, with no Discord share-configuration modal. Factory
`266536` remains unavailable after using this flow; it is not an established
integration target for this host.

This matches the pinned Equibop host implementation:

- `src/renderer/patches/screenShareFixes.ts` wraps the installed
  `navigator.mediaDevices.getDisplayMedia` on Linux.
- `src/main/screenShare.ts` handles display-media requests, calls
  `desktopCapturer.getSources`, then requests `SCREEN_SHARE_PICKER`. On Wayland,
  it supplies the OS-selected source with `skipPicker: true`.
- `src/renderer/components/ScreenSharePicker.tsx` owns the quality/audio panel.
  Its submit callback can start venmic before resolving the source choice.

These paths are relative to `vendor/Equibop`. The quality/audio panel is host
renderer code, not Discord webpack module `266536`; a userplugin webpack patch
cannot rewrite it. Do not place the initial transport selection there without
first establishing whether Discord has already created a native stream. Trace
the live Discord share-button handler and desktop capture path instead. No
further OS-source selection is needed merely to search factory source.

## Pending verification

Inspect the complete source-preparation factory, its UI callers, preview-upload
producer and stream-list callers before choosing hooks. Trace their callers in
the actual loaded Sources, not extracted
copies (Equicord's `extract` creates an unused function whose breakpoints cannot
observe live execution). Establish the explicit DASS UI selection and intercept
before any native stream or preview side effect, not after a Flux event.

## Implemented share-button interception

**Current behavior:** these same two build-scoped interception points now open
DASS directly by default and run its session-owned publisher. The explicit
transport chooser remains an option; its DASS action no longer reports transport
unavailable. See [session-workflow.md](session-workflow.md). New publisher wiring
still needs GUI acceptance; the source trace and chooser evidence below are historical.

`plugins/dass/discordAdapter.ts` now declares a build-634304-only patch anchored
on the observed `renderNUXHighlight`, `buttonRef` and start/stop `onClick`
structure, using identifier placeholders. It changes only the supplied center-tray
button's start branch to call `chooseShareTransport` on the DASS plugin. No
module IDs or mangled export names are used as production lookup anchors.

A second patch now wraps the user-supplied Voice Connected panel's memoized
share-start callback, anchored on that callback and adjacent current-user-stream
lookup. It is also restricted to build 634304. The original native call and its
guild/channel/analytics arguments remain unchanged inside a deferred callback.
Both buttons use the same chooser; the shared `471993.A` implementation is not
globally patched, avoiding a second chooser on the center button.

The chooser offers DASS, Discord and Cancel. DASS synchronously consumes the
choice and reports exactly “DASS transport unavailable.” without calling the
native callback, routing transport, capture or preview producer. Discord closes
the chooser and invokes the original callback once. Closing/cancelling the
chooser never starts sharing. Pending selection is invalidated on replacement,
configuration change, disable, logout or voice-channel change, and checks the
current voice channel again before acting. No picker/venmic or shared
`getDisplayMedia` changes are made.

These are **two UI entry points**, not a global native-share replacement. Game
sharing, one-click sharing and other buttons are not intercepted. The left
panel's manage-streams Go Live action shares its patched callback; other
manage-streams entry points are not covered. Native watch and stream-list
insertion remain unimplemented. On
other Discord builds the patch is intentionally not applied. Patches require a
full client restart; disabling does not undo an already-patched module, though
its callback passes ordinary unselected share clicks through while inactive.

Validation on Bun 1.4.3: all 38 plugin tests (128 assertions), DASS lint, full
Equicord typecheck, and desktop/Equibop bundles pass. Tests use the user-supplied
button-source excerpt and simulated native callbacks; they do not establish
runtime interception or media isolation. The existing build adapter's Bun-version
guard was already commented out; this work does not change it or upstream pins.

## Historical chooser acceptance procedure

The first user runtime attempt went directly to the OS picker with no DASS
chooser. Acceptance has **not passed**. Bundle selection/plugin state, build
gating, applied-patch metadata and the clicked UI entry point must be checked
before changing the hook or attempting capture again.

Follow-up diagnostics confirm build/patcher build 634304, DASS enabled and
started, and the new chooser code loaded. The metadata diagnostic reported no
applied patch or injected chooser, but that diagnostic is inconclusive: the
pinned patcher only stores `SYM_PATCHED_SOURCE` and `SYM_PATCHED_BY` when
`IS_DEV` is true, and these bundles were not built with `--dev`. Inspect the
executed component from the already-loaded module cache instead. The original
`TRIAL_NUX_STREAM_COACH_MARK` find anchor
matches `105225`, `554146` and `958872`. The pinned patcher removes a non-`all`
patch after its first matching factory even when replacement has no effect.
This makes the broad anchor unsafe for discovery. It has been replaced with the
specific observed button structure; no `all` flag or module-ID lookup is added.
Regression tests include synthetic unrelated coach-mark factories, not claimed
copies of modules `554146`/`958872`. Runtime re-verification is still required.

The executed `105225.rP` component supplied by the user contains the injected
`chooseShareTransport` call. The user subsequently confirmed that the share
button inside the open call displays the transport selector and that selecting
DASS reports transport unavailable. The left-side **Voice Connected** share
button still opened the native OS picker before the second patch was added.
Center-button selection/refusal is user-observed; native event/network absence
and ordinary voice independence have not been independently verified. Extending
the chooser to the left button requires tracing its native callback first.
The chooser selects transport only: no separate capture pipeline is implemented
or planned. Future DASS capture must use Equibop's installed capture function,
existing OS picker and quality/audio panel, with the required host lifecycle
bridge; it must not run Discord's stream creation or thumbnail producer.

1. Select `build/Equicord/dist` in Equibop, fully quit/restart and enable DASS.
   Confirm stable build 634304 again. Patches need another full restart if the
   plugin was not enabled when Discord modules loaded.
2. While already in an ordinary voice call, test both the **center voice tray**
   and left **Voice Connected** share buttons. The transport chooser must appear
   before any OS source picker. The center button's chooser/refusal has been
   user-observed; the newly built left-button patch still needs verification. If
   it does not, stop: the hook has not been verified. Do not select an OS source
   to try to make the DASS chooser appear.
3. Choose DASS. Check for “DASS transport unavailable.”, no OS capture picker,
   no native live indicator, no `STREAM_START`/`STREAM_CREATE`, and no thumbnail
   POST. Observe event names only, not payloads. Check request method/path only;
   do not export HAR, request headers, bodies or sensitive stream identifiers.
4. Verify ordinary voice remains connected and both peers can still hear each
   other, with mute/deafen state unchanged. Repeat DASS selection and test
   Cancel, modal dismissal, disable and voice exit while the chooser is open.
5. Only with explicit consent to send media to Discord, test the Discord choice
   and existing-share stop. No Discord choice is required to test DASS refusal.

The runtime gates remain unverified:
visible “DASS transport unavailable.” feedback, no native stream creation or
thumbnail upload for DASS actions, no Discord fallback, and ordinary voice
remaining functional. Do not exercise native sharing merely to collect a trace
without explicit consent to send media through Discord. Do not collect tokens,
request bodies, full SDP, identifiers or captured images as diagnostics.
