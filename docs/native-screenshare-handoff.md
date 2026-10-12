# Native screenshare pipeline and agent handoff

Updated: 2026-10-12. Discord source references: build **634304**.

## Start here

Discord Alternative ScreenShare (DASS) should replace screenshare transport
without replacing the normal Discord screenshare experience. The current client
demonstrates local capture, LIVE presentation and tiles in the ordinary grid,
but it is **not a drop-in native-player integration**.

The user wants the next agent to reverse engineer the sharing pipeline and its
state ownership, rather than keep adding disconnected UI patches. This document
is that starting map. It is not a claim that the complete native pipeline has
been reconstructed or runtime-verified.

At handoff the user has disabled DASS and is using ordinary Discord sharing to
provide a UI baseline. They explicitly asked not to investigate current Discord
server/connection bugs. Focus on client capture, lifecycle and presentation.

Read root `AGENTS.md`, load the `equicord-plugin` skill, then read this document.
`docs/discord-hooks.md` contains the detailed investigation and older milestones;
some of its later sections describe historical chooser behavior, not current
plugin behavior. Do not mistake those historical sections for the current design.

## Required experience

- Existing Share and Stop Streaming controls in the full call and sidebar.
- Stop Streaming appears **only after** the OS source picker and subsequent
  quality/audio selector finish and capture is acquired. Not during login or
  an open picker. Cancellation must not leave streaming presentation behind.
- Explicit optional share audio, using Equibop's existing selection and venmic.
  Selected audio must reach the viewer. Never implicitly capture a microphone.
- Local screen preview without audio echo.
- Existing voice-row LIVE badge and stream tile, including loading states.
- Native-feeling selection/enlargement, filmstrip, hover controls, watching,
  stop, volume/mute and appropriate popout behavior.
- **The small stream card immediately above “Voice Connected”.** The user
  specifically identified this additional surface at handoff. Its renderer,
  state inputs, preview source and actions have **not been identified**.
  It is not the sidebar Share/Stop button and is not covered by that patch.
- No separate normal-workflow DASS Streams button, watch panel or room picker.
  The user already rejected that design. Advanced test UI is diagnostic only.

## Evidence and present limitations

User feedback confirms that the implementation uses the intended grid space and
provides local preview and LIVE behavior. The user nevertheless says it does not
behave like the real stream UI. Do not mark native integration accepted.

The latest Stop-state timing, remote audible playback and actual native frame
revision were built but have not received explicit runtime acceptance. Remote
audio interoperability, native focus/popout and absence of Discord media leakage
are not established by builds or the supplied DOM snapshot.

### Native DOM baseline supplied by the user

The sanitized snapshot was captured with DASS disabled:

- Viewport: 1666 × 1046. Three grid entries measured approximately 632 × 355:
  a stream tile, a voice participant tile and an auxiliary card.
- Native stream frame: flex, relative positioning, hidden overflow, 8px radius.
- Inside it: a tile-child layer with a focus target having `role="button"`,
  a media/zoom wrapper, separate indicators, an overlay container and a border.
- Video: `object-fit: contain`, **no browser controls**, 2560 × 1080 intrinsic
  dimensions. That sample was muted, paused and `readyState: 4`.
- LIVE was in a separate indicator layer, not beside a persistent heading.
- Controls were in a bottom overlay, with idle opacity 0 and hidden buttons.
- The apparent idle state means this does not establish active hover behavior.
  Moving into DevTools can let the call become idle.
- The sample's muted/paused video does not establish a remote-audio defect or
  explain a Discord server problem. Do not draw those conclusions.
- The snapshot did **not** capture the card above Voice Connected.
- There is not yet a matching DASS DOM snapshot or selected/enlarged snapshot.

Hashed CSS class strings in that JSON are evidence, not stable implementation
anchors. Do not hardcode them or copy the DOM wholesale into a new player.

## Reverse-engineered pipeline map

### 1. Native share intent

```text
center-tray Share                    Voice Connected Share
  105225 start branch                 callback in 157667
             \                       /
                     471993.A
                        |
          +-------------+-------------------+
          |                                 |
   embedded-platform branch          non-embedded branch
   opens modal 266536                sets quality; awaits
                                     mediaEngine.getDesktopSource
                                             |
                                        401843.XI
                                        STREAM_START
```

This map follows supplied static factory excerpts. Actual cross-module execution
order and the complete desktop-source/track acquisition chain still need tracing.
The non-embedded branch explains the user's Equibop picker flow; modal `266536`
was unavailable even after sharing and must not be assumed to be its selector.

Additional source preparation in `560595.A` (`startStreamWithSource`) handles
source/preview/audio/quality choices and calls native stream actions. Its
conditional `260643.ys` branch is **embedded-activity capture**, not the Equibop
desktop picker. Game/one-click entry points (`46282`, `191701`, `568006`) are
separate callers and not all covered by DASS's two supported start interceptions.

`130553` handles native stream actions and delegates to platform handlers; its
observed `platformHandleStreamStart` override was empty. It is not proof of the
actual desktop media implementation. `113634` (`DesktopInputPool`) contains a
capture sink calling the installed `getDisplayMedia`. Establish its real caller
chain; do not globally intercept this shared input pool.

### 2. Equibop capture, quality and audio

Pinned host sources are available locally:

```text
installed navigator.mediaDevices.getDisplayMedia
  -> Electron display-media handler (src/main/screenShare.ts)
  -> desktopCapturer.getSources
     -> OS source selection on the user's Wayland flow
  -> SCREEN_SHARE_PICKER renderer command
  -> ScreenSharePicker.tsx quality/audio consent
     -> selected venmic source linking on Linux
  -> Electron display-media callback
  -> installed renderer wrapper applies quality constraints / attaches audio
  -> completed capture stream
```

Host implementation: `vendor/Equibop/src/main/screenShare.ts`,
`src/renderer/components/ScreenSharePicker.tsx`,
`src/renderer/patches/screenShareFixes.ts`, and `src/main/venmic.ts`.
On Wayland the main handler passes the selected source with `skipPicker: true`;
the quality/audio panel still runs. Windows optionally uses Electron loopback.

**Distinguish pinned upstream from the DASS build overlays.**
`tooling/equibop/dassCapture.ts`, `dassCaptureLifecycle.ts`,
`installedCapture.ts`, `screenShareFixes.ts` and `captureOwnership.ts` implement
DASS's narrow host bridge/ownership changes in the adapted build. The bridge
calls the installed capture function at call time, waits for the complete flow,
validates selected audio, unmutes venmic and returns a capture lease. It handles
abort, late tracks, source end and asynchronous audio cleanup. The installed
wrapper only acquires the exact virtual share-audio device after selection.

The quality constraint application is asynchronous and logs failure; a returned
lease is not proof the requested resolution/FPS was honored. Measure or inspect
actual track settings separately without recording captured frames.

`scripts/stage-equibop-capture.mjs` is the host overlay staging implementation.
It also adapts `ScreenSharePicker.tsx`: resets stale selection, records accepted
settings, cancels pending submission safely, suppresses native STREAM_CLOSE/
STREAM_UPDATE venmic ownership while a DASS lease owns audio, and skips native
MediaEngineStore quality-connection lookups during that lease. These changes
explain why pinned upstream alone does not describe the running DASS capture
workflow. Preserve the ownership guards when researching native lifecycle reuse.

No extra helper executable, encoder, proxy or microphone fallback is allowed.
Do not bypass the picker or call a saved unpatched capture function from DASS.

### 3. Native state and media lifecycle

`401843.XI` dispatches `STREAM_START`; native lifecycle infrastructure and
`616356` (`ApplicationStreamStore`) supply active stream state. Stream records,
RTC/media-engine ownership and UI state are related but **not interchangeable**.
The supplied excerpts do not establish every store transition or engine callback.

Native stream metadata reaches several separate consumers:

```text
native stream state
  -> center/sidebar active/stop controls
  -> ConnectedVoiceUser -> voice-row streaming state / LIVE
  -> call participants -> grid / selected layout / filmstrip
  -> native preview consumers and watch eligibility
  -> sidebar stream card above Voice Connected [untraced]
```

This shared state is the likely reason native UI stays coherent. Treat that as
an architectural inference to test, not a proven single universal store contract.
The next agent should map consumers and lifecycle together before choosing a
replacement boundary. Dispatching fake native events is not a shortcut.

### 4. Watch, preview and rendering boundaries

| Source reference | Observed responsibility | Important constraint |
| --- | --- | --- |
| `401843.Nl`, `401843.A9` | Watch actions can join/select voice and dispatch `STREAM_WATCH`. | Consume DASS intent before those voice/native-stream effects. |
| `35903`, `711589.K` | Watch button and native eligibility; button can select voice before the action creator. | Intercept at the UI intent, not only the final action. |
| `384200`, `450149`, `607407` | Native preview store, effectful preview lookup and preview component. | Do not use for DASS placeholders. |
| `157667` | Includes `ApplicationStreamPreviewUploadManager`; canvas/JPEG production and thumbnail POST. | Never upload DASS previews to Discord. Uploader activation/cleanup callers remain untraced. |
| `588224` → `340851` → `936520` | Voice-user props, hover/double-click watch, icons/LIVE. | Setting `isStreaming` also enables native watch/preview paths. Existing DASS patch only changes badge presentation. |
| `874739` | Chooses voice, ordinary grid or selected-participant layout. | Selected-native layout is distinct from idle voice/grid. |
| `526369` | Builds width-aware tile callbacks and passes them to the existing grid. | Current DASS insertion point, not the full native participant model. |
| `699707` | Focused/selected view, transitions, sizing and filmstrip. | Current DASS does not participate in it. |
| `163432` | Sorts/limits filmstrip participants and renders `175203`. | Assumes native user/activity participant shapes. |
| `175203` | `CallTile` and `CallTileOverlay`; identity/voice/video reads, selection, focus, controls. | Not a pure frame. Needs a DASS-owned branch before native assumptions/effects. |
| `802867` | Native `StreamTile`, preview/watch placeholders and media-engine rendering. | Do not feed it fabricated DASS stream records. |
| `51092` | Video wrapper, loading telemetry and twenty-second native incoming-video error timer. | Reusing it unchanged can invoke native side effects even with a replacement video component. |
| `272812` | Pure frame div, native border classes, children/style/ref and optional user test attribute. | Now safely reused without a Discord user ID. Does not supply player behavior. |
| `402216` | Pure LIVE badge. | Now reused in grid; local voice-row badge uses the existing native component too. |
| `40056` | Zoom context plus debounced Discord analytics and native stream-key parsing. | Not purely local presentation. Currently unused by DASS. |
| `117029` | Zoom controls and media-engine minimap video keyed by native stream ID. | Must replace/guard native media and analytics dependencies before reuse. |

All module IDs above are **research references for build 634304**, not production
lookup anchors. Full function starts/imports are more useful than truncated
keyword matches. Spatial-room renderers `487048`/`321486` are not the ordinary
call grid; `61230` is a channel popout, not proof of the sidebar card's renderer.

## Follow-up live React-owner evidence

The user supplied sidebar-card and selected-player owner reports on 2026-10-12.
These are live mount evidence plus component source, not executed action traces.
Module IDs remain build-specific research references; the follow-up reports did
not independently report the running build number.

- The selected sidebar element belongs to the activity-panel component in
  `463481` (factory length 37,947). Its analytics location is
  `ActivityPanelGameCard`. `157667` wraps it with `bt`, an activity-panel
  analytics provider, above the separate RTC connection panel. This establishes
  an activity-panel surface, not another Voice Connected share-button renderer.
- That component subscribes to `getCurrentUserActiveStream()` and
  `getStreamerActiveStreamMetadata()` through local import `e6.A`. Its `H`
  streaming predicate requires a non-null stream owned by the current user and
  a state other than `ENDED`. It also reads running games, embedded activities,
  voice channel, quality/FPS and activity-popout state. The supplied function
  was truncated before its render branch: preview source and card actions are
  still unknown. Resolve the import and inspect the complete factory before
  treating it as a reusable stream-only card.
- Selected-player live ancestry includes `874739` -> `699707` -> `175203` ->
  `40056` -> `802867` -> `51092` -> `113634`'s `e9` video component (with
  intervening frame, focus, analytics and animation components). `699707`
  receives selected participant and selection/fullscreen/context-menu callbacks
  from above; the owner of that state remains untraced.
- `699707` renders the enlarged tile with `focused: true`, not `selected: true`.
  In `175203`, `selected` defaults to false and is passed to the stream renderer;
  `focused` enables stream zoom. Thus these flags have distinct meanings:
  equating `selected` with enlarged playback would send `802867` into its
  placeholder branch instead of its active-video branch.
- `461782` owns idle timing and a set of prevent-idle holders. `156652` routes
  mouse movement/down to `onActive` and mouse leave to `onForceIdle`. This is
  shared call presentation behavior rather than video-element hover alone.
- `113634.e9` borrows a media-engine stream via `q.yL(streamId)` and calls
  `O.NM`/`O.gm` on mount, pause and cleanup. Cleanup clears `srcObject` and calls
  `load()`; this component does not itself stop borrowed tracks. The meanings
  and owners of those imported functions, and the separate native stream-audio
  path, still require tracing. Its video is always muted; that does not establish
  that native remote stream audio is muted.

The user subsequently supplied complete factories `463481` and `175203` and
confirmed that share audio is optional at capture selection, while the focused
player's speaker button toggles mute and exposes a volume slider on hover.
These are separate capture and playback controls; a muted video element is not
a muted stream-audio path.

- `463481` resolves `e6.A` to `616356` (ApplicationStreamStore). Its card chooses
  running-game, embedded-activity and frame branches before the ordinary active
  stream branch `nv`. That branch renders metadata title/source icon and a
  quality indicator, not a captured-frame video preview in this factory. The
  imported source-icon component `118277` still needs inspection before making
  claims about its internals.
- The card's `t6` action group receives the stream and `isStreaming` predicate.
  Its streaming button invokes `z`, which calls `338771.A(stream)`, followed by
  activity-panel analytics. Non-streaming game/activity start buttons have their
  own modal entry paths. Do not conflate those with the two supported DASS Share
  interceptions.
- Complete `175203` confirms the local stream-audio mute callback calls
  `827343.default.toggleLocalMute(userId, STREAM)` with the stream media context
  from `731854`. `CallTileOverlay` only adds this mute button in its non-focused
  branch; focused controls here are zoom and, for tile popouts, stay-on-top and
  close. Self-stream tiles hide this audio icon. This factory does not identify
  the user's focused speaker/hover slider: inspect that control's own live owner
  rather than assigning it to `CallTileOverlay`.

The neighboring focused control's live owner is `128286` (popout toggle), inside
`156652`'s call-level controls layout. Inspecting the layout's render callback
sources located the controller and connected wrapper in `540462`:

- `renderBottomRight` renders the audio control `ep.A` only for a selected,
  non-activity participant whose user ID differs from the current user's ID.
  This explains why self-stream investigation cannot select the speaker.
  It receives `context: eM.A(participant.type)`, `userId`, the appropriate current
  window, slider/button classes and a voice-control-tray analytics location.
  The actual audio-control factory and context mapper remain to be resolved.
- The connected wrapper `eZ` subscribes to local import `eP.A` for participants,
  filtered participants, participant version, selected participant, mode,
  layout and panel visibility. ApplicationStreamStore is separately used for
  active streams and selected-stream metadata. These are distinct state owners.
- `eq.handleSelectParticipant` can select a voice channel and invoke native
  stream watch before updating selection through `x.A.selectParticipant`.
  DASS intent must route before those native effects, not merely replace video.
  Selection toggles off when the clicked participant is already selected.
- Fullscreen/double-click delegates to selection as needed and then fullscreen;
  popout opens the channel call and can additionally disconnect an embedded
  activity or navigate to a guild route. These handlers are not pure layout.
- The class owner source contains existing ShowHiddenChannels patches and did
  not exactly match a factory, while its render callbacks and connected wrapper
  matched `540462`. This is live patched-source evidence; preserve unrelated
  plugin behavior when considering integration.

Complete resolved dependency factories establish these further source boundaries:

- Focused audio controller `821747` reads `192820`'s local volume/mute by user
  ID and media context, then renders widget `20504`. It uses conversions from
  `824744`, with slider maxima 200 on embedded platforms and 100 otherwise.
  Moving the slider above zero unmutes an already-muted stream, then sets local
  volume through `827343`; speaker click toggles local mute and emits analytics.
  This is source evidence, not remote-audio interoperability verification.
- Context mapper `520698` maps STREAM/HIDDEN_STREAM to STREAM audio and USER/
  ACTIVITY to DEFAULT audio. Do not route DASS share volume into Discord voice.
- `198052` is ChannelRTCStore. Per-channel participant collections are constructed
  by `568598`; selection stores explicit and automatic IDs separately. Native
  selection retrieval resolves an ID through that collection, so an arbitrary
  DASS ID cannot become a focused participant just by updating selection.
- Native selection updates inspect native stream-key format, parse owner IDs,
  consult ApplicationStreamStore, rebuild participants and may change filmstrip
  visibility. Native participant popout/return also updates collection/user state.
  `367513` exposes Flux-dispatching actions, not an effect-free presentation API.
  These observations rule out using fabricated native selection/stream events as
  a DASS integration shortcut.
- Potential safe reuse remains a hypothesis: widget `20504` may accept DASS-owned
  mute/volume callbacks below the effectful `821747` wrapper. Inspect its complete
  dependencies before calling it a pure reusable widget. A coherent bounded
  DASS presentation projection is still needed for grid/focus/filmstrip routing.

Complete `20504`, `568598` and `806931` factory reports further narrow reuse:

- `20504` owns hover/focus/drag state and a 150 ms hover-hide timeout. It receives
  controlled `value`/`muted`, callbacks and `currentWindow`; no media/store calls
  appear directly in this factory. Arrow keys open the slider and then adjust
  by 5% of its configured range; Escape closes keyboard focus. Muting sets the
  grabber to zero without replacing the supplied volume. The lower-level media
  bar `122641` still needs inspection. No unmount timeout cleanup is present in
  the supplied class, so do not assert complete lifecycle safety from this dump.
- `824744` only re-exports conversions from `792251`; their scale is still unknown.
- `568598` builds native stream participants from Discord user records, voice
  state, ApplicationStreamStore and media-engine user-stream data (`803301`).
  It indexes stream/video/filtered/filmstrip/stage groups and sorts using native
  user/name fields. Active-video filtering requires `streamId` and excludes
  hidden or popped-out streams. There is no generic MediaStream input here.
- `806931` defines only STREAM, HIDDEN_STREAM, USER and ACTIVITY, with predicates
  matching those exact numeric types. A new DASS participant must not merely
  masquerade as STREAM: downstream consumers assume native user/stream/engine
  data, while an unhandled new type also breaks sorting/rendering.

The resulting design direction is a bounded DASS-owned presentation projection
at the connected call boundary, sharing grid/focus/filmstrip selection data while
guarding DASS-specific tile, title, sort, controls, watch, zoom and popout paths.
This is a proposal, not implemented or accepted interoperability. Keep native
stores and ordinary voice untouched; preserve controller-owned capture/receiver
tracks. Lower-level presentation controls can be reused only after checking
their remaining dependencies and lifecycle behavior.

The user saved complete `122641`/`792251` source in
`build/discord-volume-probe.json`, which was read locally. This is a user-supplied
research artifact, not a production lookup or runtime acceptance test.

- `792251.w` converts slider value `s` to native local-volume units with default
  reference 100: zero stays zero; below 100, `100 * (s / 100)^2.8`; at or above
  100, `100 * 10^(((s / 100) - 1) * 6 / 20)`. `792251.M` is its inverse.
  Slider 50 therefore yields approximately 14.36 native units, 100 yields 100,
  and 200 yields approximately 199.53. These are conversion units, not measured
  acoustic gain or proof of how Chromium playback gain must be implemented.
- `122641` is an animated pointer-driven media bar. VOLUME uses vertical pointer
  position, clamped to [0, 1]; DURATION uses horizontal position. Its callbacks
  and `setGrabber` own presentation only in this factory: there are no capture,
  RTC, Discord-store or analytics calls here. Its animation dependency remains
  host-owned; do not copy/bundle another runtime.
- Drag start registers mouse listeners on the supplied `currentWindow`; drag end
  removes them from that same window. However, unmount removes listeners from
  global `window` instead. A non-default popout window can consequently retain
  drag listeners if the bar unmounts during drag. Together with `20504`'s pending
  hover timeout, this requires a narrow lifecycle adaptation or a different
  validated presentation primitive before safe reuse across popouts.

The speaker/slider presentation path is now source-mapped through its volume
conversion and media bar. Native stream-audio output ownership and DASS audible
playback remain separate, unverified runtime questions. Next investigation should
cover lifecycle execution and all participant consumers needed by the proposed
projection, rather than gathering more duplicate player-frame source.

## Current DASS pipeline and ownership

```text
supported Share action
  -> chooseShareTransport
  -> separate DASS account access / WSS authentication
  -> Equibop DassCapture bridge
  -> source + quality/audio consent completes
  -> owned capture lease
  -> preparing -> prepared -> activating -> publishing
  -> DASS WebRTC peer/backend, never native STREAM_START

idle account/call discovery
  -> authorized DASS directory
  -> DASS tile callbacks in existing unselected grid

DASS tile Watch Stream
  -> prepare receiver
  -> authenticated room bind and fresh share revalidation
  -> DASS subscription / received MediaStream
  -> tile-owned video element borrowing controller-owned tracks
```

`plugins/dass/index.tsx` owns session, publisher, viewer, directory and lifecycle.
`publishing.ts` owns the capture lease and publish RTC/WSS resources.
`watching.ts` owns directory/subscription and receiver resources.
`callDiscovery.ts` relinquishes idle directory access while a publisher/viewer
owns the current account connection. Preserve this account-connection transfer;
do not discard the earlier session/signaling fixes while changing presentation.

`shareButton.tsx` uses `hasAcceptedPublishCapture` for streaming presentation.
Local preview/LIVE start after capture acceptance, not backend media confirmation.
`gridPresentation.ts` scopes, deduplicates and bounds DASS shares and grid keys.
`gridTile.tsx` borrows capture/receiver streams, uses the real frame/badge, but
still renders custom headings, Watch/Stop controls and browser video controls.
`tilePlayback.ts` requests remote audible playback after Watch Stream; local
preview starts muted. Autoplay rejection offers Play. Tile detach does not stop
controller-owned tracks; controller stop/account clear/call exit performs cleanup.

Existing source patches in `discordAdapter.ts` concern the two Share entry
points, sidebar streaming presentation, local voice-row LIVE and unselected grid
insertion/root routing. They do not implement native selected view, filmstrip,
popout, zoom, remote voice-row identity or the sidebar stream card.

## Recommended continuation: understand first, then reduce integration seams

1. **Locate the sidebar stream card.** With the plugin disabled, select its DOM
   element in DevTools Elements, inspect its live React owner/component and
   corresponding already-loaded factory source. Record component inputs,
   stream-state subscriptions, preview effects, click/watch/stop actions and
   mount/cleanup behavior. Do not serialize React props/fibers wholesale.
   `157667` and current-user stream readers are investigation leads, not proof
   that the card belongs to that module. Use the same process for selected view.
2. **Trace actual call chains.** Use breakpoints in the executed Sources modules,
   not extracted/copied functions. Observe sanitized action names and phase
   ordering around Share, picker acceptance/cancellation, native capture, state
   registration, watch, source end and stop. Do not capture token/SDP/frame/HAR
   payloads. Only user-initiated capture is authorized for these tests.
3. **Draw the state ownership graph.** For every surface record which controller/
   store supplies existence, selection, preview, audio state, actions and teardown.
   Identify which participant lists are presentation data and which imply native
   media ownership. Explicitly include the sidebar card.
4. **Choose one coherent DASS presentation projection.** Prefer a bounded adapter
   feeding compatible native UI/layout layers with explicit DASS routing. Keep
   media/auth ownership in existing controllers. Do not mirror arbitrary native
   Flux events or put fake streams in native stores. Any proposed participant
   extension must guard sorting, title, identity, watch, overlay and media paths
   before they assume native shapes. Prove coverage before implementing it.
5. **Replace provisional UI only after coverage is demonstrated.** Reuse native
   controls, focus/idle behavior and layout where their dependencies are safe.
   A native-looking frame around a second player is not the exit criterion.
   Avoid another parallel panel or a global patch of peer connections/media input.
   Preserve existing work until replacement is tested; no broad revert/cleanup.

Patches may still be necessary for webpack integration. The goal is fewer,
understood boundaries and coherent state, not a claim that all patching can be
removed. A native transport swap alone will not automatically implement DASS
discovery, authorization, remote identity binding and failure presentation.

## Identity, privacy and scope guardrails

- Separate DASS credentials only. Never obtain/transmit Discord tokens.
- Directory display names are DASS names, not verified Discord user bindings.
  Do not assign remote badges or participants by name matching. Client-provided
  Discord IDs/channel claims alone are not backend authorization.
- Ordinary Discord voice stays independent. Stock clients cannot receive DASS.
- Never fall back silently to Discord media or upload DASS preview thumbnails.
- No native event/store spoofing to unlock UI. No additional client process.
- Backend connection issues are outside this handoff request. If backend work
  becomes necessary, Rust checks run in Docker only; do not use host Cargo.
- No new remotes, deployment, push, issue/PR or subagents without authorization.
- Current checkout is heavily **uncommitted, with staged and unstaged changes**.
  Preserve staged `session.ts`, `clients/spike/signaling.ts` and related account/
  signaling tests. Do not reset or overwrite them as unrelated noise.

## Validation and working directories

Last completed client checks: **183 tests, 0 failures, 1042 assertions** with
Bun 1.4.3; DASS lint, full Equicord typecheck, desktop and Equibop builds passed.
The handoff documentation does not add runtime acceptance evidence.

Run from `/home/arthu/Projects/alkalines-DASS`:

```sh
bun test ./tests/plugin
bun scripts/build-plugin.mjs
git diff --check
```

Validated custom build: `build/Equicord/dist`. Equibop selects that directory,
not its `equibop` child. Fully quit/restart after module patch changes. Do not
inject into Equibop. The plugin adapter uses Bun; do not switch to pnpm.

Pins: Equicord `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`;
Equibop `27219be3566589280c0c933b04753805381d3bc8`. Do not advance them incidentally.

Existing read-only source probes in `scripts/`: `discord-live-probe.js`,
`discord-stream-ui-probe.js`, `discord-native-call-probe.js`,
`discord-grid-probe.js`, `discord-player-shell-probe.js` and
`discord-native-frame-probe.js`. These inspect loaded factory source, not runtime
credentials/media, and do not invoke factories or force-load chunks. The last
four probe responses have already informed the map above; do not ask the user
to repeat them just to rediscover the same dependencies.

Native/DASS comparison should cover: grid, selected view, filmstrip, hover/idle,
sidebar card, pending picker, accepted capture, source end, Stop, Watch, audio
mute/volume, logout/disable/call exit, authorization failure and missing hooks.
Include both a local publisher and a separate authorized viewer. Self-preview
and a successful build are not remote-media/audio acceptance.

## Suggested prompt for the next agent

> Read AGENTS.md and docs/native-screenshare-handoff.md, then load the
> equicord-plugin skill. Continue reverse engineering the native screenshare
> pipeline and state ownership before adding patches. Prioritize the stream
> card above Voice Connected and the shared native selection/player model.
> Preserve the OS source picker, quality/audio consent and independent voice.
> The current DASS tiles are a partial integration, not the finished native UI.
> Do not fabricate native stream events, upload previews, guess remote identities
> or reset staged work. Separate source evidence, design proposals and runtime
> verification. Ignore current Discord server connection bugs for this task.
