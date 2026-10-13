# Sidebar share controls

Status: partial component contract from E01/E02, DM call on CachyOS/Wayland.
Running Discord build remains unconfirmed. Names/IDs below are research
coordinates only. The complete returned owner sources are in [E02](evidence.md#e02-sidebar-owner-functions).

## Ownership and props

Both owners are local functions in factory `157667` (1,275,513 characters in
this capture). A static factory scan returned one exact complete-function match
for each. This does not establish that either function is directly exported.

### `v5`: sidebar action-row owner

Observed inputs: `channel`, `canGoLive`. No defaults shown. `channel` must support
native methods (`isGuildStageVoice`, `isGuildVoice`, `getGuildId`) and properties
including `id` and `guild_id`. Plain DASS room data is not a substitute.

The owner reads limits, permissions/capabilities, current native publication,
activity availability and native voice state. It may return `null` for guild
stage voice depending on voice state, suppression and permissions. It renders
the camera/action sibling `vZ`, share control `vQ`, optional `vq`, and optional
`vs`. The sibling roles beyond the selected share control are not yet verified.

For `vQ` it derives `enableActivities` and a stage-specific `disabled` value.
DM evidence does not exercise those stage/guild branches. Preserve this action
row and unrelated controls; replacing the whole row is not justified.

### `vQ`: connected share control

Observed inputs: `channel`, `canGoLive`, `enableActivities`, `disabled`. No
defaults shown. It reads current user, all native active streams, native embedded
activity state, channel capabilities and the `RTCConnection` config's
`videoEnabled`. It obtains analytics locations/context.

Data flow from E02:

- `I`: first native active stream whose `ownerId` equals current user ID. The
  expression does not itself filter by channel; do not infer channel scoping.
- `p`: result of `vf.T(channel, currentUser, activeStreams)`, semantics open.
- `T = I != null || p.length > 0`: clicking opens the popout when true, otherwise
  calls the selected start/stop/permission callback. Not simply `streamActive`.
- Start: `vT.A(guildId, channel.id, analyticsLocations)` when `canGoLive`.
- Alternative start: `vp.A` when not `canGoLive`; its effects are untraced.
- Direct stop branch: `D0.A(I)` when a current-user stream exists. The full
  button usually routes through the menu in this state because `T` is true.
- Disabled: `!u || disabled`, where `u = vh.A(channel)` is not yet traced.
- Pressed and selected class: current-user native stream exists (`I != null`).
- Tooltip: one of three intl keys based on video-disabled configuration and
  `u`; translations/key identities are not yet established.
- Compact icon versus icon-plus-text depends on embedded activity,
  `enableActivities`, and `D5.Ay(channel)`; do not treat this as stream state.

## Existing presentation subtree

```text
al.Y (popout, target ref, top/center, FADE)
  renderPopout -> vf.A (connected ManageStreamsMenu)
  child render function
    rO.m (tooltip)
      si.$n (button)
        icon from DC.c, or S5.i when video disabled
        optionally lx.A icon-plus-text layout
```

The menu receives `channel`, `currentUser`, `activeStreams`, `onClose`,
`handleGoLive`, and an analytics `onInteraction` callback. `vf.A` and `vf.T`
must be traced together before deciding whether the menu itself can be reused.
Native menu actions must not receive fake DASS streams.

The button receives native `buttonRef`, size, `aria-pressed`, disabled/classes,
focus config, hover handlers and inherited popout handlers only when `T` is true.
Its click first calls `DH.X(parentAnalyticsLocation, DH.O.STREAM, I == null)`.
Passing only a replacement `onClick` is insufficient if reusing `vQ` unchanged:
the other connected branches and analytics still execute.

`DC.c(I != null ? "disable" : "enable")` returns `Component`, `events`, `play`.
Hover invokes those animation events. The effect
`useEffect(() => () => play(), [play, streamExists])` invokes `play` on effect
cleanup (dependency change or unmount). This is an icon-hook invocation, **not
evidence of the stream start/stop sound**. Trace the hook before transplanting
its lifecycle into a DASS wrapper.

## Proposed reuse boundary, not yet implemented

Preserve the native row and its real channel context. Reuse the actual button,
tooltip, popout, icon and layout exports once their contracts are verified.
Prefer a narrow seam inside the connected owner over copying its JSX, replacing
the row, or feeding fake native stream records into the menu.

A DASS branch must provide its own state, start/stop/change callbacks and audited
menu path before native share/stop/analytics effects. Retain native non-DASS
behavior. Green/pressed state, tooltip and menu-open conditions must be derived
consistently rather than patched individually without an owned state contract.

Import coordinates are now recorded in [E03](evidence.md#e03-sidebar-imports-and-owner-references).
`vQ`'s only two lexical references are its definition and `v5`'s render; no
direct export reference was found. `vf` resolves to separate factory `848362`,
which is the next menu/presentation boundary to audit. Primitive export
coordinates identify candidates, not yet lifecycle-safe component contracts.

E04 establishes that the stop callback is a native action: it derives a Discord
stream key, clears local native Go Live source and calls `401843.vN`. Never pass
DASS state to it. Two optional boolean arguments default to true, with meanings
not yet traced. The embedded share-start branch lazily opens a native modal;
this too is an interception boundary rather than a presentation primitive.

The menu factory is currently opaque to the original probe's prototype-level
source reader. This is not evidence of an unavailable menu; see the source-access
correction in [E04](evidence.md#e04-menu-source-opacity-and-native-action-evidence).

Menu dependency tracing now identifies native quality/audio/source mutation and
an independently rendered reporting hook; see [stream menus](stream-menus.md).
`showReportOption: false` alone does not suppress the outer report item.

Open: dependency export contracts; remaining action effects; complete menu contents and
pure item boundary; tooltip intl mapping; CSS/icon contracts; call-overlay reuse;
real running build; active/change/cancel/stop runtime observations.
