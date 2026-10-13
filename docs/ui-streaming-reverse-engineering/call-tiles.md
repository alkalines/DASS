# Call stream tiles and overlays

Status: E16/E17, active self-stream in a DM call on CachyOS/Wayland. This is
presentation ancestry/source evidence, not DASS transport or remote-watch
acceptance. All module names/IDs are capture-specific research coordinates.

## Connected overlay `en`, factory `802867`

Complete mounted body, 453 chars, one original prefix match. Inputs:
participant, selected, focused, idle, width, premiumIndicator. It reads native
`getActiveStreamForUser(participant.user.id, participant.stream.guildId)` and
width classification `X.VE(width)`. Therefore a native participant shape alone
is insufficient; passing a fake DASS stream/user would still hit native stores.

Render conditions:

| Layer | Condition |
| --- | --- |
| Stream-health warning `K.A` (`275731.A`, confirmed E20) | Only when neither selected nor focused |
| LIVE/quality badge `S.A` | Only when not focused, native stream exists, and its state is neither ENDED nor FAILED |
| Quality part of that badge | `!compactWidth && !idle` |

Selected alone hides the warning but **does not** hide the badge. Focused hides
both of these overlay layers. Different enlarged-call layers may render other
labels/controls; do not infer their absence from this function alone.
Badge is passed native SMALL size, native class, participant, premiumIndicator
and `isUpsellEnabled: false`.

**Proposed DASS boundary:** retain the audited native layout/overlay components,
but project DASS state before native stream lookup. Reuse safe warning/LIVE/quality
primitives with owned strings/metrics, not `en` wholesale with synthetic native
participants. Selection/focus/idle must come from one compatible call projection.

## Quality+LIVE wrapper `Y`, factory `872363`

Complete mounted body, 811 chars, one original prefix match. Props: participant,
showQuality, isUpsellEnabled (default true), size, className, premiumIndicator.

Calls `N.N5(participant)` for quality (implementation not yet traced), reads host
reduced-motion context and owns `didTrackUpsellViewed` boolean. Shows quality
only when showQuality true and derived quality non-null. Native animation hooks
control quality insertion/removal and LIVE geometry using reduced-motion-aware
configuration. It renders child `W` with participant, quality, size, upsell state
and premiumIndicator, then native red LIVE badge `L.Ay`. LIVE shape is ROUND_RIGHT
when adjoining quality, otherwise ROUND; quality child uses ROUND_LEFT.

No native media action appears in this wrapper body, but quality derivation and
child `W` may read native stores or run upsell effects. `isUpsellEnabled: false`
does not prove those paths are eliminated before hook execution. Audit them
before reusing the whole wrapper. Pure LIVE badge remains a separate candidate.

### Quality child `W` hazard (E18)

Original `872363.A` exports outer `Y`; nested child `W` is not established as
directly exported. It uses participant helper `821715.A`, quality predicates
`650338.HB/OI`, native current-user/premium state, analytics location, and
resolution/framerate formatters `650338.ME/Bs`.

It derives clickable upsell eligibility from `isUpsellEnabled` and native premium
permissions, but its effect tracks `PREMIUM_UPSELL_VIEWED` whenever not already
tracked and quality is premium. The effect is **not gated by isUpsellEnabled**.
It also invokes another premium analytics helper and sets didTrackUpsellViewed.
Setting the prop false therefore does not make this subtree telemetry-free.
Do not spoof tracked state to bypass it or mount it with DASS participants.

Layout: rounded host text badge `812993.Lp`, native classes and shaped corners,
tooltip, optional premium icon, resolution/frame-rate spans. When clickable,
opens lazy native premium modal `826789`. Intended reuse should select audited
lower badge/text/formatting primitives with DASS-owned quality data and no native
participant/premium/analytics hooks. Native LIVE export `402216.Ay` remains
separate and is the next direct presentation component to inspect.

## Frame candidate (`l`, 222 chars)

Inputs: children, className, style, noBorder (default false), participantUserId,
ref. Renders native div/classes with `data-selenium-video-tile` from the user-ID
prop and `data-call-tile: ""`. No stream-store read or media action appears in
the mounted body. Original export coordinate remains unresolved because exact
prefix matching returned zero. E18 resolves export `272812.A` -> original local
`a`, matching structure of mounted `l`; native CSS module `195500`, class combiner
`503698`, host JSX `477900`. Exactly one readable factory matched both structural
data-attribute signatures; six factories were opaque to the inventory.
Omit native identity attributes when no trustworthy
Discord identity binding exists; this DOM field is not authorization.

## Outer participant owner (partial)

E17 returned an anonymous 5,485-character mounted function with participant,
channel, class/click/double-click/context-menu, inCall, width and popoutType
props. Only first/last 500 chars captured; original prefix match count zero.

Its destructure also supports mouse/key callbacks, styles/containerStyle,
onVideoResize, selected/focused, noBorder/noVideoRender, blocked/ignored,
fit/paused, speaking indicator, forceIdle, controlsBottom. It reads native idle
context and stream-related settings. Tail passes native participant user ID,
channel, security-verification state, video/audio-toggle callbacks, hovered/
popout state, stream ID, and other data to a child before rendering border,
hover accessory and animation effects.

These excerpts do not establish the full export, media ownership or safe
selection/watch boundary. Do not render this owner with a fabricated native
participant to get an existing tile. Follow native layout/controller versus
media/preview/audio boundaries and use the actual safe shell primitives.

Open: quality derivation/child effects; LIVE/name/frame exports and contracts;
outer stream/tile owners; video/preview/native-watch effects; grid/focus/filmstrip
selection; click/context-menu behavior; selected remote speaker controls;
DM/guild layout differences; actual runtime cleanup and sound cues.

Quality child effects and frame export are now established by E18. Native stream
tile module `802867` exports `A` -> `ei`, `D` -> connected overlay `en`. Its first
1,000 original chars show zoom/player wrapper `R`, native idle and zoom contexts
(`461782.k3`, `40056.e9`), refs and media/drag/resize state. Complete media/preview
branch is not yet captured. Follow `ei` separately rather than assuming the
safe frame implies safe native video/playback reuse.

## Native media boundary `802867.A` / `ei` (E19)

Complete function appears in E19's original tail. Inputs include participant,
selected, onVideoResize, fit, popoutType, width, wrapperClassName, paused
(default false). Reads native video component, local user, stream channel,
active/all native streams, focus and self-preview pause settings, AV error state.
Destructures native participant stream/user/streamId. Native identities and
stream keys are required by those paths; DASS data must not impersonate them.

Effects/branches that make direct reuse inappropriate:

- Stage auto-watch path when no active streams, stream's channel is stage voice,
  stream is remote and not marked full: invokes native `401843.A9` plus stage
  stream-size update. It is not merely a rendering decision.
- Logs native stream tile state from an effect. Do not adopt this diagnostic
  behavior for DASS identifiers/media.
- Hidden/ended/failed branches route native state to native placeholders.
- When an active stream/video component exists and `selected` is false, mounts
  zoom/player wrapper `R` with native streamId/userId/streamKey, actual engine
  video component, fit/paused state and spinner context. This enters native
  media/output ownership, not a generic srcObject video component.
- Otherwise renders native preview `607407.A`, even with `noImage/noText`;
  flags do not establish a safe DASS preview path. Additional Watch content and
  multi-watch button can invoke `401843.A9(stream, {forceMultiple: true})`.

Do not mount this export with fabricated DASS participants or reuse its native
video wrapper. Preserve DASS capture/received-video ownership and guarded
selection/watch callbacks before all native side effects. Full zoom wrapper
source, native video sink bookkeeping and error/placeholder exports remain
separate research boundaries.

## LIVE badge `402216.Ay` (E19)

### Ended-stream branch follow-up (E39)

Complete ei again collected in probe 37. It reads active stream by native user
and guild; after privacy-hidden branch, ENDED returns `U.A` with selected,
stream=activeStream and width. Dedicated placeholder export binding/body still
next. This does not establish retained-watch or reconnect implementation.
E38 user observation requires preserving an ended viewing surface and resuming
the same returning broadcaster; DASS must separate that intent from ended media
and new-session grants. Do not mount connected ei with invented native state.

### Actual ended presentation `566331.A` (E40)

Complete component destructures stream and width, not selected. Width buckets:
<550 small, <1000 medium, otherwise large. Actual host ONYX ThemeProvider
(`43990.N`), CSS art/content/container (`2753`), heading (`297264.D`) and
secondary button (`821609.$`), with native intl keys Kb4Ukp and 4EGMWL.
Do not copy complete JSX/CSS into a lookalike. Prefer a narrow extraction or
guarded DASS prop seam retaining this actual presentation and native assets.

Connected hazards must be bypassed before rendering: native channel store lookup,
Stage effect calling `401843.Xi(nativeStreamKey,false)`, and button calling
Xi(nativeStreamKey). Supply DASS dismissal callback without native key parsing,
watch actions or a fabricated stream. Button stops click propagation; preserve
that behavior and native theme/accessibility. The component itself has no resume
action. Retained watching is owned elsewhere and remains untraced.

E41 resolves Xi to STREAM_CLOSE dispatch with canShowFeedback default true
(Stage effect false). Replace it with owned DASS dismissal/intent cleanup;
never dispatch native STREAM_CLOSE for a DASS publication. Action module's
active-stream store import is `616356.A`, next retained-state research target.

E42: `616356` STREAM_DELETE retains ENDED only when stream key equals v;
other ENDED records are deleted. STREAM_CLOSE deletes the record. Unavailable
and unauthorized map to distinct reconnecting/failed states. RTC updates ignore
ENDED. v assignment and create/update handler still need tracing before stating
the full native resume mechanism. These records are UI/watch state, not proof
that ended tracks remain alive or that future subscriptions are authorized.

E43 resolves v as CHANNEL_RTC_SELECT_PARTICIPANT id. Selecting another id
deletes ENDED records not matching the new selection. getAllActiveStreams
includes retained ended records (native capability gate applies). STREAM_CREATE/
UPDATE local x overwrites same-key record as ACTIVE/PAUSED with parsed identity
and metadata; STREAM_WATCH creates CONNECTING separately. This explains retained
placeholder-to-live **presentation** without another click. Native connection
manager behavior/media reconnection is still untraced; do not infer delivery
from a record labeled ACTIVE or reuse this native key model for DASS grants.

E44: manager `130553.handleVoiceStateUpdates` contains the re-watch action.
Remote selfStream=true with retained ENDED record in same channel cancels a
timer, finds advertised stream, skips absent/full and calls native `401843.A9`.
This follows a separate helper x early-return path (next bounded read), so exact
ordering includes other native behavior. Explicit close stops manager timers;
store connection open/closed/logout resets its Maps. Do not invoke native Watch
for DASS. Retained DASS intent should acquire new authenticated session grants,
obey subscriber limits and release old media before re-subscription.

Complete original factory, 738 chars, export `Ay` -> local `p`. Inputs/defaults:
className/style, shape `812993.EG.ROUND`, look `RED`, size `LARGE`, optional count.
Uses localized LIVE text (`dI3q4h`) unless count > 1, when it formats count
(`hOnBrr`). No stream/user/quality store, media action or telemetry in this body.

Exports `gv` -> RED/GRAY looks, `ed` -> LARGE/SMALL class mapping, `u1` -> shape
class mapping. Function also has `.Looks`/`.Sizes` properties. Red uses native
notification-background badge color; non-red renders disableColor with gray
class. Underlying text badge `812993.Lp` and native CSS `874888` remain host
presentation dependencies. This is an actual presentation export to reuse with
DASS-owned visibility, not proof that a viewer is receiving frames.

## Quality formatting versus native derivation (E19)

Original `650338`, length 1,863, first 1,800 returned (final analytics tail missing).

- `ME`: plain localized resolution formatter. Input shape includes `type` and
  `height`; SOURCE type uses intl `XjXqzh`, otherwise formats `TEOC0I` with height.
  Native SOURCE/FIXED enum is in `731854.ei`; exact values still uncollected.
- `Bs`: plain localized FPS formatter using `Qb44XH`, input fps.
- `wz`: extracts maxResolution/maxFrameRate from a record, returns null if either
  missing. No store calls shown in this helper.
- `N5`: **hook**, reads native share settings, local user, guild; self-quality
  goes through native `965025.A` (`useMaxQuality`), remote quality uses record
  fields. Not a DASS quality provider.
- `HB/OI`: native premium/quality classification using preset entitlement tables,
  not needed to enforce DASS quality.
- `K2`: reads native user/guild and tracks STREAM_SETTINGS_UPDATE; tail truncated.
  Not a formatting function or DASS-safe callback.

Reuse only audited plain formatters with bounded DASS values and correct enum
mapping; do not import native derivation/entitlement/analytics to make labels
look native. Distinguish requested/capture-negotiated/received quality from
measured achieved frame rate in the later state model.

## Stream-health warning, not participant name (E20 correction)

Import `K.A` in `802867` resolves to `275731.A`, a 662-character original
factory. The earlier provisional name-overlay classification is **incorrect**.
It calls native participant AV-error hook/helper `821715.A(participant)`, maps
send-low-FPS/high-packet-loss, bad-network, soundshare-failed, and view-loss/low-FPS
categories to native error messages, then renders `93067.A` with errorMessage
and avError. Missing error/message returns null. No participant name is rendered.

Do not reuse this connected warning hook with DASS participants. Lower error
presentation is a separate candidate if its callbacks/effects are audited.
Native computer/name label remains **unlocated** in this investigation.

## First enlargement attempt: grid still observed (E20)

User was asked to click own stream then select its frame. Returned ancestry
contains the same 5,485-char participant owner and grid `b` (1,796 chars), along
with callback-based grid layout `h` (1,125), virtual list and scroller. Selected
frame remains a call tile, but this does not establish focused-layout entry.
No runtime boolean/selection values were returned in E20, and observed tile
props do not include selected/focused. Do not report focused selection as tested.

Next probe checks only allowlisted non-sensitive layout booleans/selection
presence plus complete bounded grid renderer and layout sources. It must not
print participant data, stream keys, user/channel IDs or captured media.

## Grid layout and routing (E21)

Captured fiber flags show `inCall: true` and
`selectedParticipantPresent: false` across the captured root/controller layers.
Some layers are idle and hide participant strips. No participant was selected
in this props snapshot; do not infer the reason from the flags alone or assume the
user's earlier click entered focus.
E22 introduces a current-instance/alternate caveat; see
[selection and layout](selection-and-layout.md#captured-grid-versus-actual-committed-selection)
before treating these flags as committed UI state.

### Layout `511205.A` (`h`, complete 1,125-char mounted body)

Props: className, children (array of render callbacks), optional keyExtractor,
paddingTop/paddingBottom (default 0). Owns measured width/height, derives tile
width/row/column geometry, uses virtual list `r.A`, and invokes each child as
`renderTile(tileWidth)`. Keys use `keyExtractor(index)` or index fallback.
No native participant/stream/media lookup/action in this body.

This is an actual reusable callback-driven layout boundary for DASS-owned tiles.
Preserve host container measurement/virtualization and styles. Supply stable
DASS-only keys through keyExtractor; never use changing indices as persistent
media/session identity. Handle virtualized tile unmount separately from owned
publication/subscription lifetime. Do not infer that visible tile count is the
native call's full participant count.

### Connected grid `526369` (`b`, complete 1,796-char mounted body)

Reads guild, user participant count, participant filtering, native permission,
activity-launch/clip/entry-point state. Maps native filtered participants to
`I.Ay` with supplied onClick/onDoubleClick/onContextMenu, channel, inCall, width
and popout type. It does **not** decide selected/focused state itself. Emits
native CHANNEL_CALL_VIDEO_GRID_VIEW impression and may append clip/activity tiles.
Uses layout with top/bottom padding 64 and native participant-key extractor.

Reuse its safe layout boundary, not the connected grid with fake native
participants. If integrating into native grid, preserve existing callback order,
native optional tiles and native non-DASS actions. Selection/interception must
be traced at the higher call-controller callback boundary.

## Text badge primitive `812993.Lp` (E20/E21)

Complete body across original head/tail. Inputs: text, className, color default
native notification background, shape default ROUND, disableColor false, style,
remaining props. Uses native typography-variant hook `85463.N` and Text
`834730.E`; sets native classes and dynamic background style, forwards remaining
props and renders text. No media/stream/participant/telemetry in this body.

Shape exports are native CSS-class values (ROUND/ROUND_LEFT/ROUND_RIGHT/SQUARE),
not numeric enum assumptions. LIVE's `u1` maps these to its own additional shape
classes. Reuse the actual exports/class tables rather than hardcoding strings.
This is a suitable primitive for a DASS-owned quality label once spacing,
hover/idle/tooltip and accessibility contracts are integrated, without premium
participant/upsell hooks.

## Complete mounted generic tile body (E24)

E24 captures all 5,485 chars of the mounted generic tile body. Grid import `I`
resolves once to original module `175203`, length 12,010, exports `Ay` -> `ez`,
`Yl` -> `e$`. Mounted aliases/function names differ from original source; prefer
structural field signatures and import tracing over exact whole-function matches.

The generic tile is **not** a callback-only safe shell. It reads native user,
video disabled/toggle/mute, voice state, speaking/ringing/video presence,
soundboard/voice effects, platform, secure-frame verification, volume and
stream-info-overlay settings. It wraps native analytics, zoom, shaking, effects,
native media and overlays. Its native stream branch calls `802867.A/D`.

Click forwarding is straightforward: memoized `eK(event) => onClick?.(participant,
event)`; double-click similarly forwards participant/event; context callback
forwards participant plus native stream flag. The actual supplied onClick is
the controller `handleSelectParticipant` body from E22, returned complete (405
chars). No tile-level self-stream click rejection appears in this body.
This still does not establish which event the earlier manual click generated
or how subsequent selection state is reconciled.

### Located footer/control boundary

Mounted local `ew` receives focused, width, inCall, participantId/type, hasVideo,
mute/deafen/suppression flags, idle, platform, derived title, blocked/ignored,
local video state, hideAudioIcon, context/mute callbacks, participantUserId,
channel, secureFramesVerified, hover, popout, paused, controlsBottom, streamId.
This is the next computer/name/control footer candidate—not `275731` warning.

For local native stream, `hideAudioIcon = true` when participant user ID equals
current user ID. Native toggle-mute callback calls voice-settings action
`toggleLocalMute(userId, STREAM)`, not a generic DASS mute operation. Any reusable
footer must accept DASS-owned mute/volume callbacks without reaching that action.
Footer body and dependency effects are not yet captured.

Native main clickable gets a localized stream/user/activity accessible label,
keyboard/mouse callbacks and focus offset 1. Native frame holds ref/resize
measurement and participant-user DOM attribute. Reusing safe primitives requires
explicit equivalent accessible names/focus behavior, not copying this connected
tile or forging participant data to unlock its footer/media branches.

### Original footer and platform helper (E25)

Original `175203` local footer `ew = React.memo(...)` begins before the
controlsBottom anchor at 8,277. Source window 7,627–9,277 establishes props,
initial hooks and control derivation, but final render is not yet captured.

Footer reads current user, native user activities, decoration/display-name
style hooks, video-auto-disabled state, width categories. It subscribes to native
context-menu store with effect cleanup, derives stream audio visibility from
hideAudioIcon/type/hasVideo/width/mute, and renders zoom control when focused
stream. This is not a presentation-only component despite supplied title/mute
callbacks. Do not mount it with synthetic DASS participant/user records.

Local helper `eR({participantType, platform, className})` is callback-free icon
selection: STREAM uses native computer icon `u.k`, except Xbox platform uses
native Xbox icon. User platforms select mobile/Xbox/PlayStation/Quest icons,
otherwise null. Its direct exportability is not established. Reuse an actual
safe icon export or narrowly extract this helper, not copy its switch/CSS.

Local icon-control helper `eL` accepts icon, tooltipText, hideWhenInactive, idle,
onClick and composes native Tooltip/icon button/classes; full body still needs
the render tail. It is a candidate for DASS-owned callbacks.

**Security semantics:** native secureFramesVerified is derived from Discord's
native secure-frame verification, not a generic "encrypted transport" flag.
Never map DASS TLS/DTLS-SRTP to a Discord verified/E2EE indicator. DASS transport
encryption terminates at the SFU, E2EE is unavailable, and required E2EE must fail
closed. Likewise native user-decoration/name lookup is not an authenticated
DASS-to-Discord identity binding. Prefer bounded DASS display names unless such
a binding is explicitly established.

### Footer render and callback-driven icon helper (E26)

Full original tail 9,200–12,010 is collected. Footer named `CallTileOverlay`.
Focused STREAM adds native zoom control. Focused tile popout adds native
stay-on-top/close; nonfocused controls may include native gift, options and mute.
Options stops propagation, marks context menu open and invokes supplied context
callback with native entrypoint. Stream mute invokes supplied onToggleMute,
with icon/tooltip reflecting local-muted state and width/idle/menu conditions.

Title/platform icon and text are omitted while idle. Blocked/ignored and native
secure-frame indicators are separate branches. Narrow/very narrow widths alter
footer row visibility and typography. Native video-auto-disabled/probing state
adds its own status content. Activity/name-decorations and native app labels
remain connected dependencies, not DASS metadata primitives.

`eL({icon, tooltipText, hideWhenInactive, idle, onClick})` is a small local
presentation helper: native Tooltip and div/classes around `N.K` icon button,
SMALL/overlay-secondary presentation, accessible label from tooltipText. Its
click stops propagation then invokes supplied callback. No store/media/action
lookup appears in this helper. Exportability remains open; a minimal extraction
or direct use of its host primitive dependencies is preferable to copying JSX.

Static source demonstrates native thumbnail mute callback behavior, not the
full selected-stream speaker/volume widget. That lives in a separate call
control boundary and must be traced independently. Own-stream audio remains
hidden/silent; DASS must not route either control to native stream mute stores.
