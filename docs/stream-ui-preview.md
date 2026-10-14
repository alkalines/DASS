# DASS screenshare UI preview

Discord Alternative ScreenShare (DASS) has an isolated visual prototype in
`plugins/dass/streamUi.tsx` and `plugins/dass/streamUi.css`. Those approved components
are now wired into DASS's real tile overlay and sidebar body. The separate DevTools
comparison panel remains mock-only. Native tile/sidebar frames, sidebar Stop
actions and share buttons are preserved; ordinary Discord shares remain unchanged.

The prototype owns the stream surface, hover overlay, publisher/viewer titles,
hover-expanded quality badge and sidebar-card composition. Buttons, tooltips,
clickable surfaces and menus use Equicord's public component exports. It does not copy bundled Discord
functions, webpack module IDs, minified variable names or hashed CSS classes.
Those public exports still depend on host compatibility; this is not a promise
that Discord updates cannot break integration.

## Preview

From the repository root, after preparing the pinned Equicord build checkout:

```sh
bun scripts/build-ui-preview.mjs
```

The build writes `/tmp/opencode/dass-ui-preview.js`. The development script uses
the existing checkout's esbuild dependency and externalizes React and Equicord
primitives to the already running host. It does not bundle a second React runtime
or include DASS capture, credentials, networking or transport code. No additional
dependency or runtime helper is required.

Evaluate the generated IIFE in the attached client's DevTools to mount the
bottom-right comparison panel. No reload is necessary. Do not paste code from an
untrusted source into Discord's console. The agent can evaluate this local build
through the attached DevTools tool instead.

- Hover or keyboard-focus the tile to reveal Options.
- Options opens a host menu. All controls are preview-only.
- Switch between publisher and viewer, or grid and focused proportions.
- Publisher More Options has Show My Screen Share and Pause Preview When Discord
  Isn’t Focused checkboxes. Hiding affects only the mock media area; the pause
  checkbox edits a preview preference without pausing any real media in this demo.
  In the built plugin, these preferences affect only local preview playback.
- Standard quality/Nitro styling switches between two illustrative quality
  presentations, including the white tile emblem and purple sidebar gradient.
- The sidebar quality text is illustrative, not a measured capture setting.
- Close removes the React root and stylesheet. Reapplying removes the previous
  preview first. For manual cleanup: `window.dassUiPreview?.remove()`.

The preview never requests display media, clones an active track, reads captured
frames, starts or stops streams, or changes Discord voice state. It does not
replace the real native tile or sidebar. It deliberately uses a blank media area.

## Reference and validation

On October 13, 2026, DOM and computed-style inspection of the attached Equibop
client showed an 8px tile radius, a 16px LIVE badge with 12px bold text and 0.02em
letter spacing, 8px indicator offsets, 12px overlay insets, and a sidebar body
with a 32px source icon, 8px text gap and 12px outer padding. The attached
Discord build hash was `a5d0242057ca1f63954c0d291a632a1a15d7bed2`.
The client's numeric Discord build and Equibop version were not established.
No screenshots were taken, and no Discord bundled source was copied.

The development checkout uses Equicord revision
`e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`.
The preview build and 209 plugin tests passed with Bun 1.4.3 after integration.
The plugin build adapter also passed lint, full typecheck and both host bundle
builds. These checks do not establish screenshare interoperability or visual
acceptance.

Live DOM checks confirmed the recreated badge's width and the Options button's
32px dimensions. The preview menu measured 220px by 198px, matching the observed
native menu, with leading icons and the same group separators. Publisher/viewer
switching, a mock stop action, removal and reapplication were exercised. The
native video element remained present throughout. Matching dimensions is not
pixel-perfect visual acceptance. After user feedback, filled vector geometry,
the publisher-name overlay's 16px text, the camera source badge and Nitro gradient were
matched against the live DOM. The attached native stream showed the premium
emblem even at 1080p/30FPS; premium styling therefore uses explicit metadata, not
a hardcoded resolution/FPS threshold. This mock does not claim DASS requires
Nitro, checks Nitro membership or unlocks Discord entitlements. Live checks also
confirmed both checkmarks update while the submenu stays open, the visibility
toggle affects only the mock area, and the quality segment expands on tile focus.
The revised quality animation measures the intrinsic segment width, slides its
contents into a clipped width reveal and keeps rounding on the outer pill. Its
ResizeObserver is disconnected on unmount. This replaces the buggy intrinsic
grid-column interpolation; native spring timing is not reproduced exactly.
On October 14, a DOM-only animation sample increased the demo segment from 0 to
its measured 105.75px width and decreased it back to 0 without overshoot or a
width jump. This checks the reveal geometry, not pixel-perfect motion acceptance.

This first pass does not recreate the source picker, stream-ended/resuming
screens, stream-quality picker, viewer volume popover or popout window. The
sidebar supports a supplied source icon, with a first-letter placeholder in the
demo. In production, unsupported change-source/popout actions are disabled when
their callbacks are absent. Real stop actions are connected, quality text comes
from track settings, and no Nitro entitlement styling is supplied. Native source
matching was checked on Discord build 637268; actual media and focus/blur behavior
still require runtime acceptance after rebuilding and restarting. See
[plugin.md](plugin.md) for installation and compatibility details.
