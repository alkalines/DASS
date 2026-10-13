# Sidebar publication card

Status: E11/E12, active native card in DM call on CachyOS/Wayland. Module `463481`
coordinates match historical research, but the current evidence does not assume
the historical Discord build. Source excerpts do not establish complete effects.

## Metadata body `nv` (493 characters)

Local function in factory `463481` (37,947 chars). One original factory contains
the mounted prefix. Exportability is not yet established; a narrow extraction
seam may be necessary to reuse the actual function without copying JSX.

Props: `streamMetadata`, `accountLinkUpsellTargetRef`, `streamQualityIndicator`.
No defaults shown.

```text
eq.A(streamMetadata) -> title, sanitizedTitle
div (native metadata-body class; ref = accountLinkUpsellTargetRef)
  eQ.A(title = sanitizedTitle, icon = streamMetadata?.sourceIcon)
  div (native text/quality layout)
    th.A(children = title)
    when streamQualityIndicator != null:
      div
        I.t(size = xxs, color = eM.k0.PREMIUM_TIER_2)
        e8(native tiny semibold text, children = streamQualityIndicator)
```

This function does not itself read native stream stores or invoke watch/stop.
It does call title hook/helper `eq.A`; the icon/text/quality dependencies must
be audited before declaring it safe to render with DASS metadata. `sourceIcon`
is a presentation input, not permission to accept arbitrary URLs from a backend.
Do not capture/upload source previews or invent native application identity.

The quality label is already supplied by the caller; this body does not derive
capture dimensions or measured frame rate. Its optional quality branch always
adds the premium-colored icon shown in source. Do not imply DASS quality is
Nitro-gated: decide explicitly whether to retain/omit that adornment via a
minimal seam while reusing the actual layout/text components.

The account-link target is merely attached as a ref here; it does not itself
launch linking. A DASS-owned ref need not activate the surrounding native upsell
owner, but upstream ref expectations need checking.

## Connected owner (6,814 characters)

Anonymous mounted function in `463481`, wrapped with analytics context. Inputs:
`guildId`, `analyticsContext`, `className`; receives a ref prop but the returned
destructure shown does not use it directly. Full head/tail are captured in E12;
the middle 3,814 chars remain uncollected.

Observed head includes refs, current-user ID, current/recent game lookup,
`ActivityPanelGameCard` config, a bounded recent-game timer with cleanup, native
voice/activity channel and guild state, current native stream plus metadata,
and embedded-activity lookup. This is not a screenshare-only card component.

Observed final selection order:

1. Current running game panel when its eligibility condition holds.
2. Eligible embedded activity card.
3. Application/frame activity card.
4. Stream-only metadata body `nv` when `H` is true.
5. Eligible recently running game card, otherwise no card.

`H`/quality label `W` and several eligibility conditions are defined in the
missing middle. Do not infer exact active/loading or quality semantics yet.

When a body is selected, native outer divs render:

- Chosen body (`eg`).
- Action group `t6` receiving native stream, permission flags, activity/game/
  app/channel/frame data, analytics, authorization/linking refs and callbacks.
- Popover component `nR` receiving account-link, application/community/activity,
  analytics and dismissal state.

Passing a fake native stream into this wrapper would cross unrelated native
actions/upsell/authorization dependencies. Rendering the metadata body alone
does not reproduce actions or outer card placement.

## Intended reuse contract

Reuse native body, safe icon/title/text primitives, native outer layout and
action primitives through a minimal guarded DASS seam. DASS supplies its own
publication metadata, quality presentation and idempotent stop/change callbacks.
Omit native account-link/upsell popovers on that branch without running their
native effects. Preserve original game/activity/native-stream paths otherwise.

Open: title/icon import and input contracts; action group body/export; full
connected middle/effects; title/icon fallback yielding user-observed Go Live/
yellow G; native resolution source; button tooltip/a11y; stop/sound transitions;
placement/absence in DM/guild/disconnected contexts.

E13 resolves original dependency coordinates: title helper `277680.A`,
title/icon `118277.A`, title text `485599.A`, premium icon `403581.t`, colors
`404374`, card CSS `821095`, native stream store `616356`. The selected stop
button's exact action-owner filter returned no match; full bounded ancestry is
needed before choosing an extraction or callback replacement seam.

## Title and icon contracts (E14)

### Title helper `277680.A`

Complete original factory, 268 chars. Plain helper, not a React hook. Begins
with intl key `FeUKeA`, then replaces the title with `metadata.sourceName` if
non-null and nonempty. Returns the original `title` and a `sanitizedTitle`
formed by removing ASCII punctuation matching:

```js
/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g
```

It does not remove spaces, lowercase, validate user identity or authorize
anything. It does not read stream stores. Use a bounded DASS-owned sourceName
or null metadata for the native localized fallback; do not pass Discord stream
records just to obtain a title. The user-observed Go Live fallback still needs
intl reverse mapping/build-language recording before pinning a production key.

### Icon component `118277.A`

Complete original factory, 790 chars. Props: `title` (required string for
hash/indexing), optional className/icon. Holds derived color in React state and
updates it when title changes. For this card the body passes sanitizedTitle.

Color calculation starts with 5381, repeatedly applies `(33 * hash) XOR charCode`,
converts to unsigned 32-bit, takes modulo 6, and selects from
`[1752220, 3066993, 3447003, 0x9b59b6, 0xe91e63, 0xf1c40f]`, converted by
`317097.Hl`. This explains title-dependent color, including the user's observed
yellow G, without asserting the running locale's exact fallback string/hash.

Renders native 32×32 masked icon through `573435.Ay` with
`Masks.STATUS_SCREENSHARE`. If icon is null/empty: colored native div containing
`title[0] ?? "?"`; otherwise native img with empty alt and `src: icon`. Adds
native `428689.VideoIcon`, medium/currentColor. Classes come from `35455`.

This component has no native stream-store/media/network action, but img `src`
can trigger an ordinary image request. Prefer the no-image native fallback for
DASS unless a deliberately validated, non-sensitive icon source is supported.
Never use captured frames as Discord preview/icon inputs or accept arbitrary
backend-provided URLs without validation.

### Title text `485599.A`

Complete original factory, 257 chars. Callback-free wrapper over `834730.E`:
`color: "none"`, `variant: "text-md/medium"`, native class `158821.D` combined
with optional className; renders children. Reuse the actual export rather than
copying its typography/CSS. Its underlying text primitive needs no media data.

## Action-selection caveat (E14)

The selected element was a `DIV` in native menu item `q`, inside menu `eA`,
native analytics and a connected stream-menu owner `m`. This was **menu item
ancestry**, not the `t6` activity-card action group. It explains E13's unmatched
prop filter without concluding the card has no action group. The captured menu
also contains the effective `Vencord.Api.ContextMenu._usePatchContextMenu` call,
reinforcing the distinction between original and effective source.

Trace the card action group from bounded static source next. Whether the user's
card icon directly stops or opens a menu still requires explicit manual
observation; this ancestry alone does not establish the triggering control.

## Native action group `t6` (partial E15)

Original local `t6 = React.memo(function(e) { ... })` in `463481`. Declaration
is in E15's source window 11,671–13,691 (prop anchor at 11,891).
Its caller in the connected owner is established independently in E12/E15.
Source window ends mid-callback; final buttons/composition remain open.

Inputs include stream, canGoLive, canGoLiveActivity (default false), guildId,
isStreaming, channel, canStream, runningGame, embeddedActivity, frame, activity,
application, analyticsContext, invite/account-link refs, authorization callbacks,
linked status and connection app.

The beginning executes analytics-location hooks, application/game/community
configuration and fetch-capable hooks, native personalization consent lookup,
invite/leave activity callback construction and native screen-share modal
callbacks. Some hooks use `shouldFetch` derived from native configuration. Do
not transplant this group wholesale into a DASS card or call it with fake streams
to obtain a stop icon; unrelated effects may run before the chosen button branch.

Stop callback `z = useCallback(() => tz.A(stream), [stream])`; imported `tz`
coordinate needs confirmation. This is a native-stop candidate, not yet a
callback-driven presentation primitive. Another callback lazily loads modal
`266536` with sourcePID, voice-channel-based selectSource and analytics locations.
This reinforces the need to replace native action paths before invocation.

### Stream action branch (E16)

`tz` resolves to `338771` native stop, `ef` to `384059` analytics, modal API
`tI` to `192308`, consent store `tQ` to `153488`.

The stream button branch returns null for certain embedded-activity conditions,
or when not streaming and `canGoLive` false. When streaming: enabled, tooltip
key `S5anIc`, stop icon `tp.G`, click calls `z()` then stream analytics false.
When not streaming and `canStream` true: start modal callback `Q`/`X`, analytics
true, icon `tT.F`, game/activity-aware label or fallback `FeUKeA`. Otherwise
disabled with native channel-dependent unavailable tooltip.

It renders a native div class `t2.IF` containing `tM.A` with only tooltipText,
disabled, onClick and icon. This smaller presentation primitive is the next
reuse candidate; inspect its export and effects rather than mounting all `t6`.
The user's initial description of a stop button is consistent with this source
branch. E14's separate menu ancestry does not prove that this direct button opens
the menu; retain that distinction.

E16 continuation also shows unrelated game-server/shop modals, upsell badges,
invite/leave buttons and account-link timer cleanup. Final `t6` container/ordering
remains beyond the excerpt; do not claim the whole group is reconstructed.

### Action-button primitive `42473.A` (partial E17)

Original module 2,012 chars; first 1,200 captured. `tM` import in `463481`
matches once and resolves this export. Export `A` wraps local button `_` with
tooltip/accessibility handling; that wrapper's tail remains uncollected.

Inner button takes children, supplied context-menu/click/mouse/hover callbacks,
disabled, icon/iconForeground, inner/wrapper class, redGlow, plated, ref,
aria-label/aria-checked/role. Function icons receive width/height 20, custom size,
color props; React-node icons are used as provided. Uses real `862482.$n` with
BLANK/NONE presentation and native focus offsets. Optional children invoke a
native PANEL_BUTTON mask around the icon. Click invokes supplied callback if
present; no native stream action/store appears in this returned inner body.

This is a callback-driven reuse candidate for the DASS card stop action. Finish
the tooltip wrapper first; pass explicit accessible label and DASS-owned stop,
not native `338771` or fake stream props. Icon defaults/styles still need mapping
if adapting red/stop state rather than retaining the native caller's values.

### Complete tooltip wrapper (E18)

For absent/null `tooltipType`, export `42473.A` uses native Tooltip `866665.m`.
Inputs: tooltipText, tooltipForceOpen, tooltipShouldShow, tooltipPositionKey,
aria-label; remaining props go to inner button. Accessible-label helper
`84571.O(tooltipText)` supplies default aria-label; explicit label overrides it.
Tooltip is aria-hidden when button label equals derived text. No native stream
lookup/action appears in this wrapper body.

Non-null tooltipType selects specialized green tooltip `900002.ST`, which
supplies interaction handlers and aria-label to the child render callback; the
wrapper chains these with supplied callbacks. Inner button does not forward
arbitrary onFocus/onBlur props, so do not promise every chained callback reaches
the actual button without runtime verification. Prefer the ordinary tooltip
branch for DASS unless this special presentation is intentionally required.

This establishes a useful **actual callback-driven host export** for the card's
stop action. Native tooltip/button/mask/class dependencies remain host-managed;
no JSX cloning or CSS reconstruction is needed. Test accessible name, keyboard,
disabled state, focus ref and cleanup with DASS-owned callbacks in the later lib.
