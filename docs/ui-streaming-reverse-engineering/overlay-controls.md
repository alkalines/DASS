# Call-overlay share controls

Status: complete mounted candidate function bodies from E08, idle DM call on
CachyOS/Wayland; E10 confirms original button/icon exports via import tracing.
Idle/provider/child dependencies still need verification. A source-based
reuse contract is not runtime acceptance with DASS state.

## Specialized Share (`c`, factory `958449`)

662-character mounted body; one original-factory match (770-character factory)
contains the entire function. E09 confirms actual export `958449.h`, with
presentation variants `204651.l` for `centerButton` and `204651.A` otherwise,
animated-icon hook `416696.c`, blocked icon `797394.i`, host React `582128`,
JSX runtime `477900` and intl `660183`. These are coordinates, not production
lookup signatures. This is the strongest component-reuse candidate so far.

Observed props:

| Prop | Source behavior |
| --- | --- |
| `hasPermission` | Chooses available/unavailable idle label; supplies default disabled state `!hasPermission` |
| `streamActive` | Chooses active label/icon and active/green presentation |
| `isSelfStream` | Active label distinguishes self stream from another native stream; remote-label translation still open |
| `videoBlocked` | Default false; overrides label and icon |
| `centerButton` | Chooses `r.l` versus `r.A` presentation component |
| `onMouseEnter`, `onMouseLeave` | Chained with animated-icon hover events |
| `renderNUXHighlight` | Truthy value selects `premiumGradient` instead of active green; not invoked in this body |
| `buttonRef` | Forwarded to presentation component |
| Remaining props (`...f`) | Forwarded **last**, including click/popout, explicit disabled, classes and tooltip props |

**Override precedence:** `disabled: !hasPermission` is followed by `...f`.
An explicit incoming `disabled` wins. Other remaining props can likewise
override earlier constructed props if supplied. The integration must define
its permission/pending/stop policy deliberately; do not assume the specialized
component enforces permission independently of forwarded values.

Label source keys (translations not yet reverse-mapped): video-blocked
`GFr0GR`; active self `S5anIc`; active non-self `q3O3J8`; idle allowed `fjBNo1`;
idle denied `uQn9B8`. These hashes are evidence, not production intl anchors.

The body has no native stream-store lookup, start/stop/watch action or native
stream-key parsing. It invokes animated-icon hook `s.c(streamActive ? "disable"
: "enable")`, selects its component versus blocked icon `a.i`, and calls hook
`play()` on effect cleanup when active state/play changes or on unmount. The
icon hook's own effects still need audit; this is not proof of start/stop sound.

**Proposed usage:** render this actual host export with DASS-owned active state,
real host context, and DASS-owned click/popout handlers. Do not change native
stores to make it active. Its ancestors must be intercepted before native actions.

## Split-button candidate (`L`, 1,100 characters)

E10 confirms export `204651.l` -> original local `L`. Original internal aliases
differ from E08's mounted body, but the read/derive/render structure corresponds.
Retain both source views; do not treat their exact prefix mismatch as absence.

Defaults: `isActive: false`, `popoutOpen: false`, `popoutDisabled: false`,
`applyStyles: false`. Reads current native voice-channel ID, that channel's
native mode, host theme and an animation context. Explicit `color` wins the
derived color choice but **does not eliminate the preceding subscriptions**.

- Calls base button `C` with forwarded props, `grow: false`, and context-menu
  fallback `onContextMenu ?? onPopoutClick`.
- Uses host media-query hook `(max-width: 456px)`. At narrow width, returns only
  base button, omitting the separate caret. Context-menu fallback remains.
- At larger width, wraps the main button and optional caret. Main/caret classes
  depend on tray mode, active/open/disabled state and derived/explicit color.
- Caret uses `caretAriaLabel` or localized default; its click is omitted if
  `popoutDisabled`. It is wrapped in the native idle holder.
- Separate caret color can override the main color. A forwarded `ref` belongs
  to the outer wrapper; `buttonRef` belongs to the main button.

Factory matching returned zero for the mounted prefix; import tracing E09/E10
resolves the actual original export. Do not use its native store reads as DASS
authorization/media state.

## Base button candidate (`C`, 1,012 characters)

E10 confirms export `204651.A` -> original local `A`, corresponding structurally
to E08's mounted local `C`. The original factory and mounted functions use
different local names/aliases; component discovery must use reviewed code
signatures rather than those names.

Inputs/defaults: icon color `currentColor`, `themeable: false`, `disabled: false`,
`isActive: false`, tooltip position `top`, tooltip enabled, forced tooltip closed;
host blank look and no-size defaults. Requires an `iconComponent` renderable by
host React. Renders the real tooltip/button inside the native idle wrapper.

- Derives an accessible label through `o.O(label)`; explicit `aria-label` wins.
- Tooltip receives label as an unsupported React-node text prop and is aria-hidden,
  avoiding tooltip text substituting for the button's accessible label.
- Forwards click and context-menu handlers. Keydown forwards optional callback.
- Button mouse-down always `preventDefault()`; a passed `onMouseDown` prop is
  **not** forwarded by this body. Preserve/test native focus semantics.
- Focus invokes supplied mouse-enter callback; blur invokes mouse-leave.
- Supports `buttonRef`, wrapper/icon/classes, look/size/color and optional
  `buttonText`; active/themeable flags affect native classes.
- It has no rest-prop spread. Input `aria-controls`/`aria-expanded` observed on
  ancestors are **not forwarded in this body**. Do not promise arbitrary ARIA
  props survive without auditing the chosen variant and actual mounted DOM.

Original child coordinates: idle wrapper `447404.A`, tooltip `866665.m`, button
`862482.$n`, accessible-label helper `84571.O`, CSS `609142`. Contracts/provider
requirements beyond the returned bodies still need audit.

## Native idle wrapper (`l`, 390 characters)

Accepts children/className. Uses idle-holder hook with tokens `interact-hover`
and `interact-focus`; mouse-enter/leave acquire/release hover holder;
focus/blur acquire/release focus holder. Blur checks the target's ownerDocument
and releases focus only when activeElement has left the wrapper. Effect cleanup
releases both holders. Preserve this wrapper for overlay interactions rather
than relying only on custom CSS hover. E10 resolves wrapper coordinate
`447404.A`; E11 establishes its hook/provider boundary below.

### Idle context and popup lifetime (E11)

`447404.o(token)` reads `461782.k3` context fields `onPreventIdle`, `onAllowIdle`,
`onActive`. Its returned callbacks call the context functions with the token;
`onActive` is forwarded. Context defaults/provider implementation are still
untraced. Library consumers must mount within the real supported call context
or supply an explicitly audited adapter; never assume the default context is
sufficient outside a call/popout.

`246356.A` takes children, calls the hook with `popup`, acquires prevent-idle
in an effect and releases it on cleanup. It returns its children unchanged.
Use the actual wrapper around a mounted DASS menu to retain overlay visibility
while open, with ordinary React unmount cleanup. Do not replace it with a CSS
hover-only approximation or leave a holder after menu teardown.

Nested native wrappers may use identical hover/focus tokens. Token accounting,
popout provider continuity, and multiple simultaneously mounted controls need
provider audit/runtime testing before asserting equivalent DASS behavior.

## Animated Share icon `416696.c` (E10)

Complete original factory, 1,017 chars. Hook input is `enable`/`disable`. Owns
animation ref and current initial-animation ref; returns a memoized component,
hover/click events, `play`, `getDuration`, `getCurrentFrame`.

Component renders `744682.P` with forwarded icon props, owned animation ref,
initial animation and marker table. Its source callback lazily loads host chunk
`836306` / module `478313`. The probe only reads that callback; it never loads
the chunk. Rendering the native component may use this ordinary host asset path.

Markers: enable start 0/duration 70, disable 90/70, hover_enabled 180/40,
hover_disabled 240/40. Units are not established by this source alone.
`play` invokes animation-ref `.play(inputState)`. Hover selects the complementary
hover marker and mouse-leave calls `stopIfPlaying(marker)`. No sound API, native
stream action, capture or media store is present in the returned hook body.
The animation renderer's cleanup/accessibility/reduced-motion handling remains
transitive evidence to inspect if required. Do not replace it with a copied icon.

## Connected owner `eN` (E09, factory `105225`)

Complete mounted body: 1,752 characters, one complete match in original factory
`105225` (9,643 characters). Inputs: `channel`, `currentUser`, `exitFullScreen`,
`canGoLive`, `hasPermission`, `videoBlocked: false`, `disabled`.

It reads analytics context, app context, all native active streams, VIDEO
capability and a native trial/coach-mark hook. Local `C` is the first native
stream with `ownerId === currentUser.id`; there is no channel filter in that
expression. Returns null when the native media engine does not support VIDEO.
Its ordinary active presentation follows native advertised stream existence,
not merely an open picker or accepted capture track.

### Native callbacks

- `j`: invokes optional `exitFullScreen` first; when `canGoLive` false calls
  `eg.A`, otherwise calls `ex.A(guildId, channel.id, analyticsLocations)`.
- `_` (idle main click): records `b.X(..., b.O.STREAM, true)`, then routes to
  `j` when allowed or directly to `eg.A` when not. Denied path need not exit
  fullscreen because it does not enter `j`.
- `S` (active main click): records `b.X(..., b.O.STREAM, false)`, then invokes
  `D.A(C)` (native stop candidate, imported ID to confirm).
- Menu `handleGoLive: j`: native start/change path is supplied separately from
  the main button callback. Replacing only the main click leaves it reachable.

Native Share props: `centerButton: true`, `disabled: disabled || !hasPermission`,
`hasPermission`, `streamActive: C != null`, `isSelfStream: true`, `videoBlocked`,
class, refs, coach-mark flag. Main `onClick` chooses `S`/`_`. Only when native
local stream exists does `onPopoutClick` forward the popout child callback;
otherwise it is null. Tooltip is suppressed while the popout is shown.

This explains the active split control: **main Stop action** versus **caret
menu**, rather than the sidebar's whole-button menu behavior.

### Native menu and wrappers

Owner renders popout `A.Y` at top/center, spacing 16, FADE, with target wrapper
ref `p`, separate main button ref `f`. Menu `eh.A` receives channel/currentUser,
`activeStreams: C != null ? [C] : []`, `handleGoLive: j`, app context, close and
interaction callbacks. Thus this caller does **not** expose other users' streams
to the menu, unlike the sidebar caller's all-active-stream input.

E10 resolves wrappers `K.A` -> `447404.A` (native idle holder) and `F.A` ->
`246356.A` (body/provider contract open). Coach-mark wrapper may set local `renderNUXHighlight` state
when no native streams exist, which changes the lower Share's color to premium
gradient. A DASS branch must not manufacture native stream/entitlement state to
dismiss or trigger it. Decide explicitly whether to suppress native upsell
presentation for DASS without disturbing ordinary native behavior.

### Proposed interception seam

Keep native layouts/refs/idle/popout machinery. Supply DASS projection at the
existing Share call boundary and substitute both main start/stop and caret/menu
callbacks before native analytics/action paths. Menu data must be DASS-owned
without invoking native connected stream option hooks. Preserve non-DASS source
paths unchanged. Audit store/capability/coach-mark dependencies if changing the
owner's early return or conditional render; never conditionally skip hooks.

`ey` (3,126 characters) receives channel, exitFullScreen, disconnect and idle
props; its full call-layout ownership remains open. DM observations do not
establish guild/group-DM placement or control coverage.

### Confirmed owner import coordinates (E10)

`ee=958449` Share; `eh=848362` menu; `K=447404` idle wrapper; `F=246356`
popout wrapper; `B=267102` app-context hook; `et=616356` native streams;
`eg=702904` denied/alternative action; `ex=471993` start; `D=338771` stop;
`b=384059` interaction analytics; `A=922016` popout; `ev=843395` owner CSS;
`el=192820` native media engine store; `ej=731854` media capability constants.
Each alias has one require declaration in the original owner factory.

Do not assume passing DASS props to the lower Share export prevents these
ancestors from creating native streams or menus. Preserve native behavior for
non-DASS actions and use a narrow guarded adapter seam for DASS state/actions.
