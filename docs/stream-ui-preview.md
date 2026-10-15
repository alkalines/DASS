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
The preview build and 230 plugin tests passed with Bun 1.4.3 after the
sidebar/focused-controls follow-up.
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
emblem even at 1080p/30FPS. The mock uses explicit premium metadata; production
quality styling now follows the user-requested threshold above 720p or 30FPS.
This mock does not claim DASS requires
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

The preview's **Stream ended** toggle now shows the same ended component used
in DASS tiles. It borrows the host couch illustration through lazy CSS-property
discovery and uses owned layout plus host controls. DOM checks confirmed the
185px/134px illustration areas, compact-art hiding, 20px normal heading with a
24px line height, and a close button matching the native reference's width and
background. The mock Close Stream action and preview teardown were exercised.
No real stream was stopped by these checks. The comparison panel was removed
afterward so it would not cover the next volume-control inspection.

The preview now also includes the production vertical speaker/volume control
with mock state only, independent of active call audio. DOM inspection confirmed
a 24px speaker, 72px vertical input and approximately 32px by 88px dark panel.
Mock mute displayed zero and unmute restored 100%; ArrowDown changed 100 to 95,
Home reached zero, ArrowUp reached 5, and Escape hid the panel. These checks do
not establish real pointer-drag/playback or popout compatibility.

The source picker, resuming screen, stream-quality picker, sound cues and popout
window remain outside this preview.

The **Stream error** toggle previews the production failure screen with mock
DASS status. On build 637268, DOM inspection confirmed the native reference's
16px/600 heading, 14px/600 error label, 14px/500 help line and 16px button gap.
Mock help expansion and Close Stream were exercised without changing the active
call. DASS uses its own setup/connection error labels and inline guidance rather
than Discord error 2012 or Discord's support link. The panel was removed after
the checks.
The sidebar supports a supplied source icon, with a first-letter placeholder in the
demo. In production, unsupported change-source/popout actions are disabled when
their callbacks are absent. Real stop actions are connected, quality text comes
from track settings, and no Nitro entitlement styling is supplied. Native source
matching was checked on Discord build 637268; actual media and focus/blur behavior
still require runtime acceptance after rebuilding and restarting. See
[plugin.md](plugin.md) for installation and compatibility details.

## Safe chooser UI check

From the repository root:

```sh
bun scripts/build-ui-preview.mjs --chooser
```

The generated `/tmp/opencode/dass-chooser-preview.js` exposes
`DassChooserPreview.open()`, `.cancel()` and `.selected()` when evaluated directly
in DevTools. Both transport callbacks only record the chosen label. They never
start Discord or DASS sharing. This uses the same host Modal composition as the
real chooser. The build does not bundle a second React or any capture/backend
callback. Cancellation and a stale-context choice were checked against the live
dialog and recorded no transport start; explicit DASS selected only the mock
DASS callback. This is UI evidence, not a test of real capture or signaling.
