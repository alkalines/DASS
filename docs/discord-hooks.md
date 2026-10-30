# Discord hook investigation

For the current continuation map, native DOM comparison, the newly requested
stream card above Voice Connected and pipeline-first investigation plan, start
with [native-screenshare-handoff.md](native-screenshare-handoff.md). The historical
sections below retain earlier milestones and are not all current behavior.

## Current UI revision

The separate user-area DASS button and share modal were removed. Settings own
encrypted account configuration and an initially collapsed Advanced panel. The
existing center Share component is wrapped on build 634304 to reflect capture
through its native `streamActive` prop; clicking either supported start callback
again stops DASS. The user reports the full-call center Stop control works, but
the sidebar control did not reflect DASS publishing state. The new sidebar-state
patch described below is built but still needs runtime verification.
Disabling DASS transport in settings explicitly selects native Discord sharing.

The local publisher now has a build-634304 native voice-row LIVE badge patch,
not yet runtime-verified. DASS-owned tiles now enter the existing unselected call
grid, with local preview and authenticated Watch Stream playback. Full native
player integration remains incomplete; no synthetic Discord stream records are inserted.
The rejected DASS Streams button and separate call watch
panel have been removed. The target is the existing LIVE badge beside a
participant, existing stream tile (including loading state), existing Watch
action and existing sharing/Stop controls in both full-call and sidebar views.
There must not be a separate normal-workflow DASS button or panel.
Media context comes from the current call's channel ID as an opaque room
identifier; the client has no room selection field. A Discord channel ID alone
grants nothing: stream admission requires the publisher's live approval.

## Call discovery and watching integration

After successful DASS login, `callDiscovery.ts` binds a directory-only
`WatchController` to the current call through independently authenticated WSS.
Rooms are discovery grouping only; listing supplies no media permission.
Discovery polls every five seconds using the existing bounded directory protocol.
It does not prepare ICE, create a decoder, request capture or start a native
Discord subscription. Its connection is separate from publisher and viewer
connections. Current client admission allows one connection per account, so idle
directory polling relinquishes its connection before publishing or watching.
This background discovery now supplies DASS-owned tiles in the ordinary grid.
The Advanced test viewer remains
available for transport testing, not as the intended normal watch workflow.

Directory authorization requires subscribe permission. A directory denial clears
its shares and connection but does not erase the account or stop its independent
publisher: a publish-only account may legitimately lack directory access.

This does **not** fabricate a native stream participant, identify a Discord user from a DASS
display name, or reuse Discord's stream media engine. The directory may include
the local publisher. Simultaneous publish/watch remains experimental and is not
runtime-verified. The backend's current one-publisher/one-viewer transport limits
still apply. Native hook behavior and absence of Discord network leakage require
real-client acceptance; unit/build checks are insufficient.

The supplied sidebar render excerpt now supports a build-634304 atomic patch:
the existing component subscribes to the DASS publisher through a React hook,
scoped to its current call. Authentication and the pending OS/quality/audio
pickers do not set streaming presentation. Only after the installed capture
function returns an owned lease does the existing button use pressed/selected
styling, its native disable/stop icon animation and Stop Streaming tooltip/text.
Clicking stops DASS directly, even if an activity would otherwise open its native
manage-streams popout or permissions changed. This does not invent a current-user
stream object. When DASS is inactive, native callback, tooltip, popout, permission
and stop behavior remain unchanged. The replacements are grouped so an unmatched
replacement rolls back the whole sidebar patch. Real matching and UI behavior
still require client acceptance after a full restart.

Display names from the DASS directory must not be guessed to be Discord user
identities; remote participant badges also need an explicit, trustworthy identity
binding.

## Read-only probe for the remaining native UI hooks

### Local native LIVE badge

The complete `936520` excerpt identifies a safe, presentation-only boundary.
Its status-icon component looks up Discord previews using the original native
`isStreaming` prop. Changing that prop is unsafe: `340851` also uses it to enable
native double-click watch and hover actions. DASS leaves that prop, the preview
lookup and native watch handlers unchanged.

Instead, a grouped patch injects a publisher-state hook before the icon
component's existing preview/config hooks and collapsed/disabled early return.
It changes only the condition that pushes the existing small LIVE badge into
the native icon list. DASS's contribution requires the local Discord user, the
current call, an active plugin and an accepted capture operation in preparing,
prepared, activating or publishing phase. Authentication and open-picker phases
alone do not show LIVE. Stopping, failed setup, call exit, account clear or disable
removes the DASS contribution. Existing native LIVE/preview behavior is retained.

This is a **local presentation** indicator for your own capture/negotiation,
not proof that the backend directory has registered it or that a viewer received
media. Remote badges still need a trustworthy DASS-to-Discord identity binding;
no matching by display name or client-provided authorization claim is added.
The badge does not make native hover/double-click actions DASS-aware.

Client-only validation on Bun 1.4.3: `bun test ./tests/plugin` passes 183 tests;
`bun scripts/build-plugin.mjs` passes DASS lint, full Equicord typecheck and
desktop/Equibop bundle builds against the existing pinned Equicord revision.
No Rust source or protocol was changed; backend checks were not run for this
client slice. Real-client acceptance remains unverified.

While already in a call, paste the contents of `scripts/discord-live-probe.js`
into DevTools Console and send the resulting JSON string along with your Discord
build number. No rebuild or Docker command is necessary for this probe.
It inventories **already-loaded factory source** by stream-directory, watch and
video-rendering anchors. It does not call factories, load chunks, inspect store
values, dispatch actions, join calls, request capture or access credentials.
Results contain up to 100 inventory entries, up to two sidebar callback/render
source excerpts (8,000 characters each) and up to three stream-list source
excerpts (12,000 characters each). These are static factory code, not runtime
store values or event payloads. Module IDs are research references, never
production anchors. Source excerpts allow us to inspect the sidebar's native
button props and follow stream-list imports without triggering a native share.

The user's returned source confirms `61230` is a channel popout, not the full-call
grid: it renders the first native stream through `607407.A` and its badge through
`402216.Ay`. The generic probe's first-three-results cap omitted the relevant
`487048` stream-list reader and included a truncated icon-export preamble from
the large `157667` factory. Neither is evidence of a working native tile hook.

The first presentation probe returned factories `487048`, `607407`, `402216`
and `35903`. That evidence establishes:

- `487048` uses room corners, screen clipping and fitted geometry: it is a spatial
  room screen, not evidence of the normal full-call grid. It passes streams to
  `321486.A`, which still needs inspection.
- `607407.A` calls `450149.A` for native Discord previews. DASS must not pass its
  shares to that component, including while its player is merely loading.
- `402216.Ay` is a presentational LIVE badge with no stream or network lookup.
  Its participant-row placement remains to be traced.
- `35903` uses `711589.K` for native watch eligibility. Its Watch handler selects
  a voice channel before calling `401843.Nl`. DASS must intercept before that
  handler, not just before its final native watch action.

The updated `scripts/discord-stream-ui-probe.js` follows `321486` and `711589`,
finds actual JSX callers of imported `402216.Ay` (not just re-exports), and finds
loaded JSX renderers reading stream/participant state. It returns up to ten
badge-placement and ten call-renderer excerpts, each at most 6,000 characters,
plus up to 16,000 characters for each of the two referenced factories. Combined
static source output is capped at 64,000 characters, with truncation flags and
an explicit limit indicator. These IDs remain research references for build
634304, never production lookup anchors. No capture, factory execution, chunk
loading or runtime payload inspection is needed.

The returned graph identifies the requested surfaces more precisely:

- `588224` (`ConnectedVoiceUser`) passes native `isStreaming` to `340851.Ay`.
  `936520` displays the small LIVE badge in the voice-user status icons. Its
  excerpt starts midway through that icon function, so its input props and hook
  ordering still need inspection. Changing the higher-level `isStreaming` flag
  without tracing its preview/watch wrapper could invoke unrelated native logic.
- `802867` logs `StreamTile` and renders the ordinary native stream tile. Its
  media branch reads `getActiveStreamForUser` and Discord's video component from
  its media engine. Its placeholder also renders native previews and watch
  callbacks. DASS needs a separate guarded media branch inside that existing
  shell; passing fake native streams into it is not a safe loading placeholder.
- `241215` passes participant lists to `874739.A` in the call overlay. This
  identifies a grid renderer to inspect, not evidence that changing that one
  caller covers the normal full-call view.
- `321486` confirms the spatial room's carousel preview and remains outside the
  requested normal call UI integration.

`scripts/discord-native-call-probe.js` now reads only the five referenced
factories `936520`, `340851`, `874739`, `802867` and `806931`, up to 16,000
characters each. This avoids the exhausted graph output budget and retrieves
the missing function starts/imports without scanning or running any modules.
The local native LIVE badge is now patched as described above. `874739` delegates
the unselected grid to `526369.A` and the selected-participant layout to
`699707.A`. The `526369` delegate now appends DASS render callbacks to its native
grid list, using Discord's tile width/class and stable DASS-only keys. Native
participant callbacks and optional activity/clip tiles remain unchanged. The root
routes idle voice mode to this grid when DASS tiles exist, including an otherwise
empty grid. Hooks run before conditional returns. The selected native
video/activity layout in `699707` is unchanged: DASS tiles are not yet available
in that selected layout or its filmstrip.

DASS tiles own video elements rather than invoking `802867` or Discord's preview
or media engine. Local preview uses the existing capture stream without new
capture, upload or ownership of its tracks. Remote tiles display authenticated
DASS account names, not guessed Discord identities. Watch Stream prepares a
decoder, binds the room again and revalidates the share before subscribing.
Pending setup retains the tile after directory polling relinquishes its connection.
Watch Stream requests remote playback with audio; browser autoplay rejection
shows a Play fallback. The local preview always starts muted to avoid echo.
Audio capture still requires the publisher's explicit host-picker choice, and
selected-but-unavailable audio fails rather than silently publishing video-only.
Stop Watching,
account clearing, disable and call exit close the owning viewer. At most 64
remote tiles are presented. This is a DASS-owned branch in the existing grid,
not Discord's native StreamTile, Watch handler or full player; native
focus/popout/zoom controls and remote voice-row LIVE remain unresolved.
Real-client acceptance is still required. `scripts/discord-grid-probe.js` remains
a read-only bounded probe of the two grid delegates.

User feedback confirms the tile uses the intended grid space, local preview and
LIVE presentation, but does not behave like Discord's real player. This is not
full native-player acceptance or audio interoperability evidence. To investigate
the actual shell and controls rather than restyling the substitute, run
`scripts/discord-player-shell-probe.js` in client DevTools and return its JSON.
It reads the loaded `175203` tile wrapper, `163432` filmstrip, `51092` video
renderer and `402216` badge factories only (24,000 characters each). It does not
execute factories, load chunks, read runtime media or start sharing.

The complete player-shell response identifies `175203` as `CallTile` and its
`CallTileOverlay`, not a pure reusable frame. Before rendering it reads native
voice state, mute/video toggles, identity, activities and secure-frame state.
Its stream branch invokes `802867`, and its title/controls assume native
participants. `163432` likewise sorts by native user identity and renders
`175203`. Neither is yet safe to receive a fabricated DASS participant.

`51092` is also not just a video element: it runs native spinner telemetry and
a twenty-second incoming-video error timer keyed by native stream/user IDs.
DASS must bypass those side effects as well as the Discord media-engine component.
The real frame is imported from `272812`; the zoom provider and controls are
`40056` and `117029`. `scripts/discord-native-frame-probe.js` reads those three
loaded dependencies only, with the same 24,000-character per-factory bound,
without executing modules or inspecting runtime media.

The complete frame response confirms `272812` only renders a div, native border
classes, supplied children and optional style/ref/user test attribute. DASS tiles
now resolve that component by its two observed data-attribute source signatures,
without relying on the module ID. It replaces the generic Equicord Card and owns
the border styling; the plugin no longer supplies its own frame radius/padding.
No Discord user ID is passed. The accessibility group lives inside the frame
because this native component does not forward arbitrary props. The existing
DASS video/audio lifecycle and loading/watch content remain inside it. Frame
reuse is built and source-tested, not yet runtime-verified.

`40056` is not purely local zoom state: zoom changes invoke debounced Discord
analytics and parse native stream keys. `117029` obtains the native media-engine
video component and renders it for the minimap, keyed by a native stream ID.
Neither is enabled for DASS. Reusing the native frame and LIVE badge does not
yet provide native selection/focus, filmstrip, popout, hover menus or zoom.

The supplied `402216` function is purely presentational. DASS grid tiles now
resolve its actual component by the verified look/color source signature and
render it instead of a handmade LIVE label. The existing local voice-row badge
patch is unchanged. This badge change is not full native player integration.

After that inventory, inspect the relevant list renderer's imported component,
its LIVE badge/watch callback and its video component props. We need to establish
whether the video renderer accepts an independent MediaStream without acquiring
a native stream connection. If it does not, only its presentational shell may be
reusable. Do not fabricate `STREAM_CREATE`, `STREAM_UPDATE` or `STREAM_WATCH`
events to satisfy its stores. Do not enable native sharing or copy runtime
payloads, tokens, full SDP, HAR files or frames merely to collect these hooks.

Required acceptance for the native integration (not implemented yet):

1. Rebuild with `bun scripts/build-plugin.mjs` from the repository root and fully
   restart both DASS clients using `build/Equicord/dist` in Equibop.
2. Sign in to separate authorized DASS accounts and join the same ordinary call.
   The directory must require no source picker and no viewer ICE preparation.
3. Publish through a supported Share button. Both full-call and sidebar sharing
   controls must reflect DASS state and stop it. The publisher needs the existing
   participant LIVE badge and stream tile, not a separate DASS button.
4. The other authorized DASS client must see the stream tile and use its existing
   Watch action. Loading state may precede real media, but errors must remain
   visible. Watching, publishing and ordinary voice must remain independent.
   Repeat logout, plugin disable, call exit and cancellation during setup.
5. Confirm no DASS-triggered native stream events or Discord thumbnail POSTs.
   Observe event names and request method/path only, not sensitive payloads.
6. Check wrong-room authorization, removed publishers, expired sessions and
   directory failure. Stale shares must disappear; failure must not fall back.

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

## Discord desktop Go Live picker in DASS mode

Observed through DevTools on Windows Discord 1.0.9266 (Electron 44, Chromium
152), build 655747. On Discord desktop `isPlatformEmbedded` is true, so the
share callback `471993.A` lazily opens the Go Live modal `266536`. Its source
grid comes from `742459.A`, which prefers the native media engine's previews
(`screen-handle:<monitor>`, `window:<hwnd>`). Choosing a screen or window calls
`startStreamWithSource` (`560595.A`), which dispatches `STREAM_START`.

`DISCORD_GO_LIVE_PATCHES` add an optional fourth `dassGoLive` argument to the
opener and forward it as a modal prop. Only a modal opened with that prop:

- lists sources from `DiscordNative.desktopCapture` (`screen:<id>:0`,
  `window:<hwnd>:<n>`). Native `screen-handle` IDs have no reliable mapping to
  Chromium screen IDs, so the list itself must come from Chromium;
- hides the camera tab and the Linux/macOS OS-picker path, whose sources
  Chromium cannot capture;
- passes the chosen source and quality options to DASS instead of
  `startStreamWithSource`, so no native stream starts. Closing the modal without
  a choice cancels the DASS capture.

Both groups must match completely or neither applies. The opener throws when it
receives `dassGoLive` on a non-embedded host instead of starting its native
branch.

Discord's native screen capture is not reusable by DASS. It runs only inside a
native RTC connection (`createOwnStreamConnectionWithOptions`). That connection
registers its video callback and codecs only after UDP IP discovery with a
Discord media server. Native video can reach the renderer through
`window.createDiscordStream`, but only from such a connection, and
per-application share audio stays inside the native connection. DASS instead
uses the same Windows process-loopback technique through Chromium's
`applicationLoopback:<pid>` and `loopbackWithoutChrome` devices; the window's
process comes from Discord's own `getPidFromDesktopSource`. See
[plugin.md](plugin.md#install-in-standard-discord-desktop-with-equicord).

## Native call-tile pieces in DASS tiles

Build 655747's CallTile module (`175203`) defines an unexported
`CallTileOverlay` (title pill, options and mute buttons, zoom controls). The
existing `.displayName="CallTile"` patch also hands that component to
`captureCallTileOverlay`. DASS renders it as a `STREAM` participant without a
Discord user ID, stream ID or secure-frames claim, so the user-only volume,
gifting and zoom controls stay off. The LIVE badge (`402216`), quality text badge
(`286134`), Discord button (`657718`), spinner (`289873`) and the tile/video CSS
modules are found by code or class names. The native stream tile (`802867`) and
video wrapper (`51092`) are not reused: they read `ApplicationStreamStore` and
report receiver timeouts as Discord AV errors.

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
