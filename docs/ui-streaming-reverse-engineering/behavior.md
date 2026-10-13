# Behavior inventory

All native behavior below is **user observation** from the initial description
unless explicitly marked otherwise. Exact components and effects are **open**.

## Surfaces

| Surface | Idle | Publishing / watching | Required investigation |
| --- | --- | --- | --- |
| Voice Connected share button | Share Your Screen action | Changed icon, green background; click opens Stop Streaming / Change Screen menu | Owner, icon/pressed props, menu factory, permission gates, handlers |
| Call overlay share button | Second share entry point | Stop Streaming button with attached dropdown arrow; same stop/change choices | Shared versus distinct component; DM/guild placement; split-button contract |
| OS source picker | Opened after a share action | Screen/window/virtual display/crop selection, as offered by the user's OS | Host consent boundary; cancellation; no assumption of cross-OS source types |
| Equibop settings picker | Resolution/framerate/audio consent after source selection | Chosen settings feed capture | Installed host path, submission/cancellation and optional audio ownership |
| Sidebar activity card | Absent for a stopped share | Above Voice Connected: Go live title, resolution, icon (user sees yellow G), stop button | Metadata body versus connected wrapper; icon/title fallback; stop callback |
| Call stream tile | Absent for a stopped share | Video card, LIVE badge, computer icon and streamer name; hover shows resolution | Tile shell versus media/preview/watch effects; metadata and hover dependencies |
| Selected stream | No selection | Clicking tile enlarges it within call layout | Selection, grid/focus/filmstrip transitions, ownership and identity assumptions |
| Remote speaker control | Not present on local self-preview | Mute/unmute and volume in enlarged remote stream | Presentational widget versus native audio controller; idle, hover, drag and keyboard behavior |
| Start/stop sounds | No repeated sound in steady state | User hears start and disconnect sounds | Actual cue identifiers, triggering layer and timing; avoid duplicate events |
| Remote ended view | No retained watch after explicit close | Ended placeholder persists; same broadcaster returning resumes without another click (E38 user observation) | Actual placeholder, retained watch identity, new-session matching, dismissal and context-exit lifecycle |

Native menus also offer Report Problem. **Requested DASS difference:** omit this
action, without invoking its reporting/telemetry handlers. Nitro icons/purple
styling are lower priority. Trace any entitlement dependencies before reuse;
do not make DASS quality selection depend on Discord paid transport privileges.

## Transition checklist

These are **proposed contracts** to test, not claims about native implementation:

1. Both share entry points reach the same owned publication operation while
   preserving their native layout, tooltip, focus and accessibility semantics.
2. Opening a picker is not an active stream. Cancel at either picker: return to
   idle without a card, LIVE badge, sound suggesting success or leaked tracks.
3. After consent and accepted capture, derive all local surfaces from the same
   publication state. Distinguish capture/connecting from backend publication and
   actual viewer reception; do not falsely claim receipt or readiness.
4. Publication renders the native control/card/tile presentation through audited
   props or narrow seams. Do not create a fake Discord stream to unlock it.
5. Stop from any control converges on one idempotent teardown. Source-ended,
   logout, disable and genuine call-context exit must also terminate owned media.
   An unchanged voice-channel selection event is not proof of context exit.
6. Local publication stop returns its surfaces to idle and clears stale menus. Cue
   timing must be researched; teardown must not play the same cue multiple times.
7. Change Screen preserves explicit consent. Trace native replacement/cancel
   behavior before specifying whether DASS retains the old capture or stops it.
   Handle cancellation, source-ended and competing stop while picker is open.
8. Remote selection initiates only an authorized DASS subscription, never native
   watch/preview actions. Loading, receiving, stopped and failed are distinct.
9. Local preview remains silent. Remote stream mute/volume is independent of
   ordinary Discord voice and uses one audible owner across mounted views.
10. Clicking/selecting/deselecting tiles preserves native grid and enlarged
    layouts, overlays and focus. Verify which contracts differ between DM,
   group DM and guild voice calls rather than inferring equivalence.
11. Remote publication end releases ended-session media/audio but may retain
    viewer intent and the native ended presentation. Same authenticated DASS
    broadcaster returning in the same authorized context should resume without
    another click while that view remains open. Reauthorize the new publication;
    never match only a display name/Discord claim or reuse old session grants.
    Explicit close, logout, disable or true context exit cancels this intent.
    This is proposed DASS policy based on E38, not a traced native implementation.

## Equibop-specific source evidence

E63 owner stream tile menu (distinct from sidebar share dropdown): user lists
Stop Streaming, Change Stream, separator, Pop Out Stream, separator, More Options
submenu with Show My screen share and Pause Preview When Discord Isn't focused
checkboxes, plus Report a Problem (omit). Exact intl wording/default states and
remote menu differences are not yet verified. The current mock action list does
not cover this native structure. Grid-end disappearance versus retained ended
view context needs clarification; do not assume number of streams alone decides.

E64 clarifies retained ended screen is in the enlarged view, with native artwork
and ended/funny-phrase text; unselected grid stream disappears. User wording
does not establish exact localized string/phrase selection or all sender/viewer
cases. Mock must not retain an ended card in ordinary grid merely because its
local ended boolean is true.

Manual E46: idle source-picker cancellation leaves UI unchanged, with a generic
capture failure/cancellation/overlap notification (partial text recorded in
evidence.md). E47 confirms the same for host settings-picker cancellation.
No start/end cue reported; actual track/audio cleanup remains unverified.
Change Screen currently blocked (E37);
its normally unchanged UI/no-sound behavior is remembered, not fresh acceptance.

**Pinned source:** `vendor/Equibop/src/main/screenShare.ts` installs Electron's
display-media handler. It obtains sources and delegates settings/source choice
to the renderer picker. The Wayland branch uses the first returned source and
`skipPicker: true`; other paths use `skipPicker: false`. This is consistent with
an OS-mediated source selection followed by host settings, but does not prove
the precise OS dialog/order on the running machine. Virtual display and crop
availability are OS/session capabilities, not guaranteed Discord components.

**Pinned source:**
`vendor/Equibop/src/renderer/components/ScreenSharePicker.tsx` owns the host
modal, resolution/framerate choices, audio submission and cancellation. Listed
quality options are 480/720/1080/1440/2160 and 15/30/60 fps, not evidence of actual
capture dimensions or achieved frame rate. Its Linux native `STREAM_CLOSE` and
`STREAM_UPDATE` subscriptions stop/unmute virtmic. DASS must explicitly audit
this lifecycle, not fabricate native stream events to obtain cleanup.

**Pinned source:**
`vendor/Equibop/src/renderer/patches/screenShareFixes.ts` replaces the installed
Linux `getDisplayMedia`, applies quality constraints and attaches existing
venmic audio. A future DASS integration must call the installed capture path,
preserve explicit audio consent and own cleanup. It must not use an unpatched
copy, parallel capture helper, extra process or encoder.

These are host-specific boundaries. Standard Discord + Equicord adaptation is
outside the immediate investigation; keep Equibop capability assumptions
explicit so a later adapter can fail visibly on unsupported hosts.
