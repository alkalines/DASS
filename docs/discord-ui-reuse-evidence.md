# Discord UI reuse: concrete source findings and remaining live evidence

Discord Alternative ScreenShare (DASS) should preserve the actual frontend and
substitute its native screenshare behavior. This companion to
[the reuse contract](discord-ui-reuse.md) records findings from source inspection
on 2026-10-13. It is not a new GUI or network acceptance result.

## Finding 1: the current plugin is only partially reusing the native tile

`plugins/dass/gridTile.tsx:94–145` renders the actual discovered tile frame and
LIVE badge, but supplies a DASS-authored content wrapper, video, placeholder,
title/controls row and Stop/Watch/Play buttons. Its audio control at lines
147–163 is also DASS-authored composition using a generic slider/button.

This is concrete evidence of why lower-level component reuse has not achieved
the requested original UI. The native full footer/overlay/menu composition is
not being reused there. This finding is from code, not a new visual comparison.

`plugins/dass/callPresentation.ts:51–59` toggles selection off when the same DASS
entry is selected again. The research recorded duplicate click/double-click
selection problems in E63 and continued focus problems in E68. The current toggle
is a potential interaction mismatch, not proof that it caused that earlier mock
failure. It needs event-order testing rather than another layout approximation.

## Finding 2: the full original presentation exists and was visually promising

Recorded user evidence E56–E62 identifies the original generic tile render body,
its footer, computer/icon controls, frame/clickable wrappers and imported player/
overlay. The research experiment reused source-derived actual presentation while
bypassing connected dependencies. E63 records the user's assessment that it was
“really good” and close to the original, with focus, ended-state and menu gaps.

This supports continuing from the real render/presentation boundaries rather
than regressing to a frame plus a custom footer. It does not establish a safe
production source-compilation strategy. The research sandbox's dynamic private
closures must become reviewed build-time patches/extraction seams, not a runtime
source loader.

Source/evidence: [E56–E70](ui-streaming-reverse-engineering/evidence.md#e56-loaded-full-tile-composition-versus-original-alias-map),
[sandbox contracts](ui-streaming-reverse-engineering/interactive-sandbox.md#56-source-native-stream-cardjs-original-presentation-extraction).

## Finding 3: the native tile is not solely a passive backend consumer

E57 records identity/activity/decoration/auto-video/context-menu subscriptions
before footer rendering. E56/E58 identify connected media/overlay and debug/effect
children. The connected stream player has native watch and preview ownership;
the overlay reads the native active-stream store. Native quality presentation
also has a premium analytics effect that is not disabled by the clickable-upsell
flag.

Therefore a patch that blocks only a network request does not remove these
client-side actions or provide DASS state. This is evidence for additional scoped
state/media/action seams, **not evidence that original UI reuse is impossible**.

Preferred next production boundary: preserve the native outer tile/footer render
and host layout, project DASS title/status/callbacks before connected consumers,
and replace only the media-owning/native-action branches. Audit all transitive
children; do not mount the unchanged connected player with dummy native records.

## Finding 4: the share/capture continuation is source-identified

E05 includes the complete non-embedded share-entry continuation:

```js
getMediaEngine().getDesktopSource(...).then(source => nativeStart(...))
```

The original also sets native quality/audio options before capture. The action
source recorded in `docs/discord-hooks.md` identifies `STREAM_START` dispatch.
Equibop's `goLive()` at
`vendor/Equibop/src/renderer/components/ScreenSharePicker.tsx:684–736` instead
completes the picker result and attempts connection/track quality mutation.
Main-process IPC and the installed capture wrapper complete the waiting capture
request. The picker itself does not dispatch `STREAM_START`.

This gives a concrete replacement candidate: consume the explicit DASS share
action before native preparation, use the existing installed host capture path,
and route completion to DASS publication rather than native start. It is not yet
a live proof of the complete media-engine call chain or of preview inactivity.

The existing plugin already wraps two build-scoped start callbacks in
`plugins/dass/discordAdapter.ts:15–59`. Retain those original entrypoints while
improving their reused presentation; do not replace them with a separate player.

## Finding 5: real focus and ended UI need specific, known substitutions

E69/E70 identify native focused geometry/springs/transitions and the actual themed
ended artwork. The focus owner also gets the native video component/current user,
calls camera pairing and passes entries into native tile/filmstrip consumers.
The ended component reads native channel state, runs a Stage effect and invokes
native close with a derived stream key.

`63-native-focus-and-ended-sandbox.js:79–95` demonstrates the exact dependencies
isolated in that research experiment. It preserves geometry/artwork while
substituting media/identity/camera-pairing/selection/close behavior in a private
namespace. Its fixture checks are not host GUI acceptance. The native filmstrip
still receives genuine entries only in that experiment, so it does not establish
complete DASS filmstrip integration.

These are actionable boundaries for narrow production adapters. Do not substitute
callback-count reduction for native focus or diagnostic text for native ended art.

## Missing evidence and how to acquire it

### Current user-supplied renderer source

The user ran a read-only factory inventory and supplied complete original factory
`471993` (1,284 characters). Its non-embedded branch still:

1. Chooses 1080p/720p through native quality/entitlement inputs.
2. Calls `401843.Xd` to set native quality and `soundshareEnabled: true`.
3. Calls `192820.Ay.getMediaEngine().getDesktopSource(size, true)`.
4. In that promise's continuation, calls `401843.XI` with guild/channel and
   `{pid: null, sourceId, sourceName: null, analyticsLocations}`.

This freshly confirms the source-level capture-to-native-start boundary. The
promise result is a **source identifier**, not evidence that this entry directly
receives the raw MediaStream. Trace the media engine's ownership next. Original
factory source does not establish effective patched behavior or live ordering.

The inventory found desktop acquisition/capture in `113634`, `206959`, `432351`
and `471993`; `DesktopInputPool` only in `113634`. The preview-manager name now
occurs in `260519`, not the historical `157667` coordinate. Native start markers
occur in `40876`, `260519`, `378187`, `401843` and `532294`. Six factories were
unreadable. These results do not establish the current numeric build or that all
native stream consumers have been found.

The next user-supplied excerpt confirms `401843.XI` exports local function `L`.
That function only calls `73153.h.dispatch` with `type: "STREAM_START"`, native
GUILD/CALL stream type, guild/channel, app context and supplied options. No direct
network or capture call appears in this function. This establishes an action
boundary, not a backend implementation. Its subscribers still need tracing:
blocking the dispatcher indiscriminately could suppress frontend state as well
as transport; preserving dispatch could activate native transport/preview owners.

The user then supplied the `113634` browser-capture excerpt. Desktop input class
`e6.get` awaits the installed `navigator.mediaDevices.getDisplayMedia`, constructs
an input around the returned MediaStream, installs video-end handling, obtains a
stream ID through `q.ju`, and uses the first video track's label as its input ID.
Pool `e5.acquire` stores that input by ID. `destroy` unregisters the stream ID
through `q.it` and stops all tracks. This confirms native input ownership around
capture; it does not prove that the nearby peer-connection class in the excerpt
belongs to screenshare transport. The returned desktop-source ID continuation
and native start subscribers still need tracing. Merely blocking `STREAM_START`
does not demonstrate cleanup of this already acquired input.

The user supplied current `616356` handler/getter excerpts. `STREAM_CREATE` and
`STREAM_UPDATE` both use local handler `x`. The preceding handler tail writes a
current-user CONNECTING record into map `i`; its action name is outside the
excerpt, so it must not yet be labeled `STREAM_START` or `STREAM_WATCH`.
`getCurrentUserActiveStream` derives the current voice channel and resolves the
current user's stream via `getActiveStreamForUser`. That getter resolves an
advertised stream through `getActiveStreamForApplicationStream`, or falls back to
an active-record owner match. This establishes native UI-facing lookup, not a
single universal event that mounts every Go Live surface. The complete `x`
handler is the next required source to identify the update semantics precisely.

The complete beginning of `x`, subsequently supplied by the user, parses
`streamKey` through `A.Iy`, writes ACTIVE or PAUSED to `i`, and writes
`{streamKey, region, viewerIds}` to `a`. It also expires an old stream-full marker
in `l`. No direct media/network call appears in this handler body. The enclosing
store identifies itself as `ApplicationStreamingStore`. Its active getters are
gated by `f.A(N.Ay)`; inserting state alone would not establish full UI visibility.
These findings identify the state mutation shared by CREATE/UPDATE, not safety
of globally dispatching those native events or authorization of a synthetic key.

Current user-supplied START/WATCH handlers settle the previously unidentified
CONNECTING write. `STREAM_START` derives the local native key, resolves optional
game/source metadata, writes it to `s`, then replaces the `i` entry with a local
CONNECTING record. `STREAM_WATCH` parses its supplied key and likewise replaces
the active record with CONNECTING. CREATE/UPDATE subsequently write ACTIVE/PAUSED.
Thus native START drives initial local publication metadata/connecting state;
CREATE is not the sole event responsible for UI-facing state. Exact per-surface
render gating and other START subscribers remain to be traced. This is the
concrete frontend-state branch to preserve semantically in the DASS adapter,
without synthesizing native keys/events or triggering native transport consumers.

Further user excerpts show why the first textual START match is not enough to
identify transport. `40876` is a manager registry: its first supplied match is
`OverlayContentProtectionManager`, registered for START/STOP and loading `48345`.
`378187` reacts to START/CREATE/CLOSE by synchronizing STREAM_ON_DESKTOP heartbeats,
not a media publisher in the supplied excerpt. `532294` includes START in an
action-name set; that alone identifies neither a handler nor transport. These
must not be labeled backend sinks or patched indiscriminately. Inspect the other
START registrations in `40876` to locate the actual streaming manager next.

The complete four-match registry result identifies
`ApplicationStreamingManager`, loaded from `130553.A`, registered for
START/WATCH/CREATE/UPDATE/DELETE/CLOSE and channel/voice/connection/logout actions.
It also confirms distinct overlay protection, clip-related (`95844.A`) and quest
heartbeat (`378187.A`) registrations. This establishes a concrete native
lifecycle-manager candidate separate from the UI-facing store `616356`; it does
not yet establish where signaling occurs or that blocking this manager alone
isolates all native media/preview effects.

The current `130553` excerpt confirms START routes to `this.handleStreamStart`
and the exported instance subclasses `B`. Its `platformHandleStreamStart()`
override is empty, while initialization calls `725792.Ay.initializeIfNeeded()`.
The empty platform override is not evidence that inherited `handleStreamStart`
has no signaling effects. Inspect the base handler before proposing a patch;
the registry alone did not establish this manager as the media transport sink.

The subsequently supplied base handler derives the native local stream key,
looks up the channel, calls `F(key, isGuildStageVoice)` and then calls the empty
platform override. CREATE/UPDATE handlers call `G` and `U`; UPDATE can dispatch a
media-engine stats reset through an RTC connection lookup. These are concrete
lifecycle effects beyond presentation, but `F` must still be inspected before
labeling it a signaling/transport start. No network effect is established merely
by its name or position in `handleStreamStart`.

Inspection of `F` resolves that candidate: it checks existing active RTC stream
keys, creates/reuses a timeout object, and schedules a `STREAM_TIMED_OUT` dispatch.
It is a lifecycle timeout, **not the native media/signaling starter** in this
body. The inspected START handler plus empty platform override therefore does
not identify backend publication. Correct the working hypothesis rather than
patching this manager as the backend. The initial inventory searched the quoted
literal `"STREAM_START"`, which misses unquoted `STREAM_START:` handler keys;
the next inventory must include every plain-token occurrence to find other
registered consumers before excluding them.

The corrected plain-token inventory returned 14 readable factories (six
unreadable), including previously missed `116956` (23,689 chars), `480595`
(3,876), `595528` (52,253) and `626798` (1,939), plus other known/caller modules.
`116956` is the next justified candidate because the inspected lifecycle manager
imports it as `m.A` and calls its `getRTCConnection`, `getAllActiveStreamKeys` and
hostname accessors. Its newly found START occurrence must be inspected rather
than inferring transport behavior solely from those RTC accessors.

The first `116956` excerpt accidentally matched the substring in
`VIDEO_STREAM_STARTED`; it was analytics, not the event handler. The corrected
word-boundary probe located the actual START handler at offset 20,843. It stores
source ID/PID and action/analytics context, updates optional game metadata, and
touches analytics on existing connections; the supplied body does not allocate
an RTC connection. The following CREATE handler consumes `rtcServerId` and
`rtcChannelId` and branches on an absent connection plus a present server ID.
That is a concrete connection-creation candidate needing its complete body.
Native signaling that obtains those IDs still needs identification among the
remaining exact-token START consumers.

The user-supplied `595528` excerpt identifies the native signaling branch:
its START handler checks `B.isSessionEstablished()`, chooses guild/call/preferred
RTC region, and invokes `B.streamCreate(streamType, guildId, channelId, region)`.
Its WATCH handler invokes `B.streamWatch(streamKey)` and can close other watched
streams. These are explicit backend-facing request candidates separate from the
UI store and timeout manager. Inspect `streamCreate` and response handler `e4`
before claiming exact wire operation or complete isolation. The other excerpts
show `626798` clears a stream-request reminder; `480595` uses a shared handler
`k` for numerous activity/settings actions, whose full effects remain unreviewed.

The currently established source chain is:

```text
host capture completion → share entry XI → STREAM_START
  ├─ 616356: source metadata + local CONNECTING record (UI-facing)
  ├─ 130553: lifecycle timeout
  ├─ 116956: selected source/PID + connection analytics context
  └─ 595528: established-session streamCreate request (native signaling)
```

This is concrete support for narrow native-signaling substitution while retaining
the original UI composition. It is not authorization to synthesize native Flux
events/store records, proof of live execution order, or proof that blocking
`streamCreate` alone covers RTC creation, previews, watch, stop and cleanup.

### Native socket request now source-confirmed

The user traced `B=new D.A` in `595528`, resolved `D` to `576991`, and supplied
the actual method body. `streamCreate` calls:

```js
this.send(e2.STREAM_CREATE, {
    type: streamType,
    guild_id: guildId,
    channel_id: channelId,
    preferred_region: preferredRegion
})
```

Adjacent socket methods likewise send STREAM_WATCH/PING/DELETE/SET_PAUSED with
native stream keys. No opcode number, authentication material or session data
was read. This establishes native outbound screenshare signaling, rather than
inferring it from a manager name. The definition is original factory source;
live execution and effective plugin patches remain unverified.

The initial-start chain is now source-confirmed end to end through the socket
request: capture completion → `471993` continuation → `401843.XI` → Flux START
→ `595528` handler → instance of `576991.A` → socket STREAM_CREATE send. The
UI-facing branch is separately confirmed in `616356`.

This is the concrete evidence requested for frontend/backend separation. Native
socket methods are candidate boundaries, not permission to globally patch
`send` or fabricate native records/server responses. Blocking the request alone
would leave native CONNECTING state/timeouts and acquired capture unresolved.
Trace CREATE-driven RTC allocation and preview activation next, then design a
DASS-scoped state/action/media adapter that preserves the actual render bodies
without starting the native socket/RTC/thumbnail paths.

### Native RTC allocation and connection now source-confirmed

The user's next `116956` excerpt identifies two distinct response handlers:

- CREATE, when no connection exists and `rtcServerId` is present, constructs
  analytics context `H`, asserts an existing session, constructs native connection
  `j` with session/stream/server/channel and parent media-session inputs, then
  stores it in `en[streamKey]`. It subsequently resets media-engine stats history.
- SERVER_UPDATE finds that connection and calls
  `connect(event.endpoint, event.token)`.

Only handler source was inspected; no endpoint/token values were collected.
This proves a separate response-driven native RTC allocation/connection path,
not frame delivery or live ordering. A fake CREATE event is unsafe: it would
enter this constructor rather than simply light up presentation. DASS must own
its RTC/subscription and avoid these native response handlers on its branch.
Inspect `j` to identify media-source acquisition/render exposure/cleanup seams
before deciding how the original player presentation consumes DASS tracks.

The user supplied the beginning of connection class `j`. It extends `A.A` and
initializes the base connection with native user/session/channel IDs, STREAM
context and stream-server/channel inputs. Its debounced `updateVideoStreamId`
dispatches `RTC_CONNECTION_VIDEO` with a media-engine stream ID and connection ID
plus native identity/channel/context. This identifies a third frontend-facing
boundary: stream metadata/ACTIVE state is distinct from video availability.
Inspect its event hookup and the actual player consumer before choosing a media
adapter; do not synthesize this native event for DASS to impersonate a connection.
Destroy stops stats/timers, cancels pending video-ID updates, flushes a null
video-ID update and calls base teardown, confirming native resource ownership.

The user traced `initializeEvents` and both calls to `updateVideoStreamId`.
One is the teardown null update. The other is the `h.q.Video` event listener:
it verifies guild/channel/owner against the native stream key and calls
`updateVideoStreamId(streamId, rtcServerId)`. Thus the actual source-level video
availability chain is base connection Video event → scoped identity check →
debounced video-ID update → Flux RTC_CONNECTION_VIDEO. The connection's State
event separately dispatches RTC_CONNECTION_STATE. Its sizeable stats block is
telemetry, not the sought video hookup. Next trace the VIDEO event's store
consumers and actual player lookup to locate the presentation/media boundary.

The user's VIDEO-consumer inventory found eight handler factories. `198052`
refreshes a call participant on VIDEO and handles source-quality changes;
`803301` stores `streamId` by native user/guild/context, clearing it on null video
and relevant voice-state changes. This identifies the video-ID storage candidate
separate from the publication store. Other excerpts concern guild rebuilds,
clips, overrides, connection-related refresh and AV errors; `583534` maps VIDEO
to handler `E`, whose effects remain uninspected. Source getters and actual player
consumption of `803301` remain the next presentation/media boundary to establish.

The current `803301` source identifies `VideoStreamStore` and confirms getter
`getStreamId(userId, guildId, context)` (default DEFAULT), plus
`getUserStreamData` with the same argument layout. Screenshare consumers must
explicitly use STREAM context, not the default voice/camera context. Trace actual
importing consumers and player render before assuming its ID is a browser
MediaStream or attempting to inject a DASS ID into the native store.

### Actual stream video presentation consumer identified

The user supplied complete current helper `393371.A` (813 characters). It reads
the native active stream through `616356`, reads video ID through
`803301.getStreamId(ownerId, guildId, STREAM)`, obtains the native video component
through `192820.Ay.getVideoComponent()`, and runs native preview hook `450149.A`.
It renders lower media component `51092.A` with videoComponent/streamId, COVER fit,
paused flag, preview URL, spinner context, native user ID and derived native key
when video is supported/present and state is not ENDED/FAILED. Otherwise it
renders placeholder `607407.A`. Consumer `568598` had no literal `getStreamId`
match in the requested excerpt; this is not evidence of no video consumption.

This gives an actual presentation seam: preserve the host lower video/spinner/
fit rendering, while a DASS branch supplies owned media/status/preview inputs
before native store/preview/key consumers run. Do not invoke the unchanged helper
with a fake native stream. Audit `51092` and its video-component contract next;
passing a browser MediaStream as native `streamId` is not established to work.

### Concrete reusable media-presentation contract: `51092.A`

The user supplied both parts of current `51092` (2,122 characters). Its original
render passes the supplied `videoComponent` these props:

```text
className, streamId, onResize, onReady, paused
```

The host wrapper owns actual contain/cover/cover-landscape classes, mirror state,
preview/empty-preview geometry, spinner and loading transition. A supplied media
component reports dimensions through `onResize` and readiness through `onReady`;
the wrapper then hides loading presentation. The supplied component is rendered
only when `streamId` is non-null. Paused suppresses the preview/spinner layer.

This is a source-proven media-leaf injection contract, not a requirement to
recreate the wrapper's JSX/CSS. A candidate DASS adapter can preserve this actual
wrapper and supply a DASS-owned media leaf that resolves only DASS-owned tracks,
honors paused/resize/readiness, and preserves the passed native classes. Its
selector must not be inserted into VideoStreamStore or interpreted by the
native media engine. Exact host type/lifecycle contracts still need verification.

Two connected hook paths need minimal guarded adaptation: spinner telemetry
through `684339.M`, and the native readiness timeout/clear path through
`37965.Z/W` plus incoming-video settings. These execute before rendering, so
overriding the videoComponent prop alone is insufficient. For DASS, replace these
with owned readiness/error handling without running native reporting or dispatch;
preserve React hook order and the original native branch. Do not copy the whole
wrapper, dynamically compile factory source in production, or mount a native
player with fabricated connection IDs to reach this presentation.

This confirms a concrete actual-host UI reuse seam. It does not yet prove that
the main call stream tile uses this same wrapper: `393371` is a stream-video
consumer, whose exact call-site role must be traced rather than assumed. Inspect
the actual connected call stream player (`802867` in the recorded research) next
to connect this contract to the intended call tile/overlay/footer composition.

### Main call-player path connected to the candidate

The current user-supplied `802867` source imports `51092` as `D`. Its player
`ei` obtains the native video component and reads native current user, channel,
stream, focus/settings and error state; it also has a native auto-watch effect.
Its video render branch invokes local wrapper `R` with the supplied
videoComponent, streamId, onResize, fit, paused, class/wrapper classes, spinner
context, user and stream key. Other branches render native ended/error/hidden or
watch-placeholder surfaces; native multi-watch action appears in the placeholder.
Thus props alone do not safely substitute the unchanged connected player.

The final user-supplied excerpt confirms `R` delegates to `D.A` (`51092.A`),
forwarding its props with an adapted `onResize` and wrapper-class handling. Its
outer DOM/classes/styles and mouse/wheel handlers implement the original zoom/
drag/pan presentation. The source-confirmed main call-video presentation chain is:

```text
802867.ei (connected stream player)
  → 802867.R (actual local zoom/pan wrapper)
    → 51092.A (actual fit/paused/loading/preview/spinner presentation)
      → supplied videoComponent (media leaf)
```

Retain these actual presentation functions through narrow guarded/export seams,
not copied JSX/CSS, another player, or runtime factory compilation. For DASS:

1. Route the stream-player branch to DASS-owned status/media/action inputs before
   the connected native store, preview, auto-watch and key consumers execute.
   Preserve hook ordering; do not introduce conditional native-hook execution in
   a component whose branch can change during its mounted lifetime.
2. Reuse the actual `R` and `51092.A` functions. A non-exported local function may
   need a reviewed build-time exposure patch. Validate owner idle/zoom providers
   (`461782`, `40056` in this capture), class/resize behavior and cleanup before
   mounting; a source signature alone does not establish provider compatibility.
3. Supply a DASS-owned media leaf with the verified props, preserving passed host
   classes, paused state, resize notification and truthful readiness. Keep its
   media selector private to the DASS branch, outside native IDs/stores/engine.
4. Guard `51092`'s native telemetry/timeout/ready-clear hooks for DASS. Preserve
   original native behavior otherwise. A videoComponent override alone is not
   sufficient isolation.
5. Reuse actual ended/error/hidden/overlay/footer presentation through their own
   audited seams, with DASS status and callbacks. Do not claim the video wrapper
   reproduces the complete card, menus, filmstrip, fullscreen or remote audio.

This is now a concrete source-backed reuse plan, not an unsupported demand to
redesign the UX. It still needs effective-patch/provider/lifecycle validation and
real GUI/network acceptance. Module IDs and local names above are research-only
coordinates, not production discovery keys.

### User-confirmed isolated video-wrapper experiment

The user ran the preparation and generated-video mount snippets in the live
renderer. After the mount message, the user explicitly confirmed a colorful
surface displaying “Local Generated Video” and a timer, with working Pause and
Resume. This is actual GUI evidence that the isolated original `51092.A` wrapper
can render a supplied browser-video media leaf and accept its paused state.

The wrapper's native telemetry/readiness paths were replaced with scoped facades,
and media came from a generated canvas track, not screen capture or DASS transport.
Spinner timing, Remove/cleanup, original zoom wrapper/provider compatibility,
call-tree placement, complete tile/footer/menu, remote audio and DASS publication/
subscription remain unaccepted. Do not label this diagnostic root a completed
native call integration. The next acceptance target is the same actual media
presentation inside the original call-tile/zoom/layout composition.

The user reported completion after the cleanup command. This is reported removal,
not independent measurement of stopped tracks/timers. The next read-only check
will inspect the mounted idle call controller before any actual-tree adaptation;
no new overlay, native stream records or native START/CREATE dispatch is needed.

### Actual-grid test: working media, rejected full-card equivalence

The user completed call/controller, wrapper, sample and adapter setup and reported
that installation creates a card with working Pause/Resume, **but it is not like
a normal Discord stream**. This is functional media-test evidence, not acceptance
of normal stream UX. The experiment used actual Grid/Frame/video-wrapper components
but omitted the original generic tile's outer composition, connected stream
overlay and native footer/menu. Diagnostic controls must not be polished into a
replacement for those layers. Restore the test, inspect the current original
`175203` render/overlay/footer contract, and adapt those actual functions through
guarded seams. Do not describe this partial test as complete native UI reuse.

The user's complete current original render slice (offsets 4,869–6,630) identifies
the actual normal-card composition: analytics section `D.A`, zoom provider `J.Ay`,
hover container, shake wrapper, frame `eE.A`, clickable `h.s`, media slot `e$`,
overlay slot `e0`, footer `ew`, optional effects/debug/confetti and focused borders.
The footer receives title/type/idle/platform/mute/paused/hover/security/context
inputs and callbacks. The partial test skipped these owners entirely. The next
experiment must reuse this original presentation body and audited footer/helpers,
with explicit owned slots and guarded dependency/effect seams—not add custom
CSS/buttons to the prior frame. The connected footer prefix still needs current
source validation before execution. Do not combine original render aliases with
effective loaded-function aliases or assume the zoom provider is media-free.

The user supplied the current `ew` footer prefix (start 7,945, length 3,980).
It confirms native current-user/activity/avatar-decoration/auto-video/display-name
hooks and context-menu subscriptions before presentation, followed by width,
mute-icon and spring calculations. Footer presentation inputs include title,
idle/focus/hover, type/platform, video/mute/audio, callbacks, paused and controls
position. A safe DASS branch must replace those connected inputs/effects while
retaining actual title/icons/layout/control rendering. The remaining footer
render and transitive helpers still need current-source review before execution.

The user then supplied the complete remaining footer. The original STREAM branch
renders the actual options trigger and optional mute control; the title area
uses native platform/type icon and typography, width/idle gates, and animated
control positioning. Focused/popout branches invoke native zoom, stay-on-top,
return analytics and close helpers; USER-only branches mount gifts/application
presentation. These are not generic Stop/Pause buttons. For the next non-focused
generated-video experiment, reuse the actual footer/render/helpers with owned
title/mute/menu callbacks and a guarded connected prefix; no native identity,
verification, popout/report/watch actions. The actual stream overlay is the next
small source contract required to avoid substituting another badge layout.

The user supplied complete current overlay `802867.en` (453 characters). It reads
native active state, uses native width classification, mounts health warning
`K.A` when neither selected nor focused, and mounts quality/LIVE wrapper `S.A`
when not focused and not ENDED/FAILED. Quality visibility is separately gated by
width and idle. Prototype scripts 71/72 retain this actual function and original
card/footer return in a private namespace, replacing the connected state lookup
with owned simulated state and isolating unsafe consumers. Native pure LIVE is
used without quality/health/upsell paths; this limitation is explicit. The
non-focused card composition is the next GUI target, not yet accepted. Local
source-syntax and stubbed footer/title/action bypass, overlay/LIVE routing and
atomic-failure fixtures passed; these do not certify host rendering/providers.

After successful separate card/footer compilation, the user restarted Discord;
the registry check then correctly reported no prepared card. This is loss of
ephemeral console setup, not a backend/session expiry. The restartable
`76-normal-card-demo.js` now consolidates preparation, owned generated media and
actual-grid installation. Its original non-focused card/menu appearance still
needs user acceptance. Existing local fixture and consolidated guard/syntax
checks are recorded separately from pending live full-card GUI/cleanup/voice
acceptance; no new DASS transport or interoperability evidence is claimed.

This session has local source/filesystem tools but no live renderer-control MCP
resource. Listening socket inspection found no identifiable Electron DevTools
endpoint. No debugging flags were enabled, client restarted, capture started or
network behavior patched. Live breakpoints cannot be claimed from this session.

The missing evidence is specifically:

1. Effective loaded share handler and its actual path through desktop acquisition.
2. Capture completion ordering relative to native signaling/media allocation.
3. Preview producer activation/cleanup caller and whether it starts before/after
   that native continuation.
4. Runtime mounting/event behavior of retained original tile/focus/ended surfaces.

First run the new **read-only**
[`64-capture-start-boundaries.js`](ui-streaming-reverse-engineering/64-capture-start-boundaries.js)
in Equibop DevTools and return its JSON. It searches available original factory
source for desktop-source acquisition, desktop input, browser capture, native
start and preview-producer signatures. It executes no module factories/exported
actions, loads no chunks, reads no session/store/credential values, mounts nothing
and starts no capture or transport. Missing/truncated candidates are reported,
not treated as absence. Module IDs are research coordinates only.

Review those results before placing breakpoints in the actual loaded Sources.
Do not use an extracted unused factory for breakpoints. A subsequent user-driven
native share test is needed to record execution ordering; do not automate consent
or claim request rejection alone proves transport isolation. Collect function/
module locations and state transitions only, never credentials, SDP or frames.

## Conclusion supported today

The strongest evidence supports **retaining the actual native frontend rendering
and replacing specific connected behavior**, rather than abandoning it for a
custom tile. It also identifies why a backend-only request block is incomplete.
The exact minimal number of production seams and their live safety remain open;
the next read-only probe targets that gap instead of redesigning the UX.
