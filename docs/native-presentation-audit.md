# Native screenshare integration audit

Discord Alternative ScreenShare (DASS) should replace screenshare transport,
not replace the call experience with a second independent player. This audit
connects the native source and user-provided runtime evidence to the current
plugin implementation. It does not certify runtime compatibility.

Updated: 2026-10-12. Native module references originate from Discord build
634304; later artifacts did not independently record the running build. See
[native-screenshare-handoff.md](native-screenshare-handoff.md) for the evidence
history and [plugin.md](plugin.md) for current installation instructions.

## Established ownership boundaries

```text
Share intent
  -> installed Equibop capture/picker/quality/audio consent
  -> native web-engine desktop input pool
  -> native publisher connection owns input and track teardown

ApplicationStreamStore (616356)
  -> advertised/native stream existence and metadata
  -> activity-panel stream card (463481)

VideoStreamStore (803301)
  -> user + guild + media context -> native engine video ID

ChannelRTCStore (198052) + participant collection (568598)
  -> participants, filters, version, explicit/automatic selection, layout
  -> connected call wrapper/controller (540462)
     -> grid/selected routing (874739)
     -> enlarged layout and filmstrip (699707)
     -> guarded tile rendering (175203)
     -> call-level controls and shared idle state (156652 / 461782)

Native video (113634)
  -> media registry (201327)
  -> mounted-video reference count (782425)
  -> native connections' active-output-sink handling

Native audio controller (821747)
  -> saved context-specific audio settings and native connections (192820)
  -> independent received audio element (113634)
```

These are separate owners. A native-looking tile does not automatically join
the selected layout or acquire appropriate audio/capture ownership. A native
transport-only substitution also does not implement DASS discovery or identity.

## Current adapter coverage

The current checkout already includes `callPresentation.ts`,
`sidebarPresentation.ts` and connected-call/focused/filmstrip patches. They were
not introduced by this research. Older grid-only descriptions in the handoff
describe its original snapshot, not this newer implementation.

| Surface | Current boundary | Evidence and remaining gap |
| --- | --- | --- |
| Share/Stop and local LIVE | `shareButton.tsx`, `discordAdapter.ts`, publisher state | Capture-consent timing is implemented; native tests do not establish DASS interception or leakage prevention. |
| Sidebar card | `463481` projection, `sidebarPresentation.ts` | Reuses native metadata body/action group, not a fabricated native stream. Native title/icon dependency coverage and runtime mount/stop still require verification. |
| Grid | `useGridTiles` adds width-aware render callbacks | Grid has its own share projection rather than receiving one unified projected participant list from the connected call. |
| Selected call | `NativeCallView` substitutes the selected prop passed to the native controller | Early DASS selection/context-menu guards avoid native watch/user paths. Native selection remains separately stored underneath and can reappear when DASS selection clears. |
| Focus and filmstrip | `useFocusedCallProps` adds DASS participants only in the focused layout | Tile export routes DASS before native tile hooks. Sorting/partition and auxiliary helper guards exist, but complete live filmstrip-consumer coverage is not demonstrated by reduced test fixtures. |
| Speaker/volume | `CallAudioControl` and an independent received audio element | Uses separate DASS state and the nonlinear 0..100 curve. It remains a text button and host horizontal slider, not the native vertical speaker widget. |
| Idle/overlay | DASS CSS hover/focus rules | Native call idle state does not govern the custom tile overlay; holding/dragging the custom slider does not participate in native prevent-idle holders. |
| Fullscreen/popout | Existing call-controller callbacks | Whole-call routes remain native. Individual DASS tile popouts and zoom are missing; audio/video handoff between mounted call views is unverified. |
| Teardown | Owned publisher/viewer controllers, tile detachment, plugin lifecycle | Track ownership is kept separate, but the voice-selection event handler tears down media too broadly. |

## Concrete mismatches and implementation requirements

### 1. Voice selection is not voice-context exit

`plugins/dass/index.tsx`'s `VOICE_CHANNEL_SELECT()` unconditionally calls
`stopMedia()`. The native controller can emit this event immediately before
participant selection, and the supplied runtime trace contains two such pairs.
An offline execution of the current handler confirms that it invokes media
teardown without checking the actual context.

The trace omitted channel IDs intentionally, and DASS was disabled, so it does
not reproduce same-channel DASS teardown in the running client. The code path
is nevertheless too broad: a repeated selection must not be treated as context
loss. Compare the owned/current voice context after native state settles; stop
on a real switch/disconnect and protect pending capture on a genuine exit.
Do not suppress native voice selection or infer authorization from that context.

Required regression cases: same channel selected during publication/viewing;
native tile focused during DASS publication; actual channel switch; disconnect;
logout/disable while capture is pending; rapid exit/return without reviving old
capture or subscriptions. The current tests do not exercise this integration.

### 2. Projection is distributed across three surfaces

`useGridTiles`, `NativeCallView` and `useFocusedCallProps` independently derive
DASS shares/participants. Selection is one DASS singleton but participant lists
are appended at a later focused-layout boundary. The native connected wrapper
still computes participant counts/version and selected-stream metadata solely
from native stores.

Define one bounded call projection with stable keys, selection, visibility,
loading/failed/receiving state and a version, then use it for grid, focus and
filmstrip. Keep native and DASS records distinguishable. Do not populate native
stores or give DASS participants fake Discord user/stream data. Explicit guards
are still needed wherever native sorting, titles, watch, telemetry or media
consumers assume native shapes.

### 3. Remote selection and playback switching differ

`selectCallParticipant` requests watch only when no received stream exists and
the viewer is not loading. Selecting another remote DASS participant while one
is playing changes focus without switching the subscription. That other tile's
Watch button is disabled while any receiver stream exists.

Keep the one-viewer bound, but define explicit replacement/cancellation behavior
for a new authorized share. `watchListedShare` already has a reset, preparation,
authentication and fresh directory-check path; do not bypass those checks to
make selection appear instant. Availability is not received video readiness.

### 4. Audio presentation is safe from native stores but not equivalent

The current custom control avoids native audio actions/settings/telemetry, which
is correct. However, it does not reproduce the native speaker icon, vertical
slider, 150 ms hover grace or shared prevent-idle interaction. The native lower
widget is callback-driven, but its hover timeout and popout drag-listener cleanup
need adaptation before direct reuse.

Choose a lifecycle-safe presentation primitive, preserving mute separately from
volume and unmuting when volume rises above zero. Keep local preview silent,
remote audio independent of Discord voice, and exactly one audible playback owner
per receiver across main call and popout. The current view-based gate expresses
that intent but has no atomic ownership handoff; test transition overlap/gaps.
Do not add another audio runtime or helper executable.

### 5. Focus/loading/overlay must be one player contract

Native `focused` and `selected` are not synonymous. Enlarged playback uses
`focused`; native `selected` also controls placeholder/filmstrip behavior.
The DASS tile instead renders muted borrowed video, custom loading/watch content
and custom CSS overlays. This avoids engine effects but still leaves a visibly
different player and does not implement native zoom.

Keep actual video and errors DASS-owned while reusing safe layout/control layers.
Selection must survive legitimate phase updates and disappear when the owning
authorized share ends. Do not install the native video wrapper: it updates native
active sink counts. Do not reuse preview upload, timeout telemetry or native
stream-key parsing for DASS placeholders.

## Validation status and order

`bun test ./tests/plugin` passed with Bun 1.4.3: **199 tests, 0 failures, 1246
assertions**. This is current unit coverage, not GUI/native pipeline acceptance.
The reduced controller/filmstrip fixtures prove particular regex and routing
cases, not every loaded consumer. No backend change/build, injection or runtime
deployment was performed for this audit.

Prioritize implementation/verification in this order:

1. Correct real voice-context teardown; add focused regression coverage.
2. Unify presentation projection and explicit remote watch replacement.
3. Validate every participant consumer against full live source and the pinned
   build; preserve other plugins' existing patches and fail visibly on mismatch.
4. Finish lifecycle-safe native-style speaker/idle controls and single audio owner.
5. Verify grid -> focus -> filmstrip -> fullscreen/popout -> stop/source-end,
   including picker cancellation, call exit and failures. Remote audio tests
   require a separate authorized viewer; self-preview is insufficient.

These findings establish replacement boundaries and remaining work. They do not
claim that all native implementation details are reconstructed, that E2EE exists,
or that DASS is a drop-in/runtime-accepted replacement yet.
