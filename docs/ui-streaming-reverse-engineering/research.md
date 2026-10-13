# Research method and library handoff

## First capture: selected share button

With DASS disabled, join a call without streaming. In DevTools Elements, select
the Share Your Screen button **beside Voice Connected**, or its SVG child, so it
is `$0`. Run `01-selected-component.js` in the renderer Console. Send its single
JSON string and note DM/group DM/guild voice, OS and Wayland/X11 where applicable,
plus the running Equibop, Equicord and Discord build versions if available.

This probe reads the selected element's React fiber ancestry. It returns only
component function names, prop **names**, bounded static function prefixes and
webpack availability. It does not print prop values, user/channel IDs, text,
images, streams, store contents, credentials, SDP or event payloads. It does not
invoke components, callbacks, factories or capture APIs, and installs no hooks.
React fiber access is a DevTools research technique, not a library integration
strategy. The output is capped at 6,000 characters.

Factory source access needs a separate check: Equicord proxies can appear as
`[native code]` to `Function.prototype.toString.call(factory)`. The pinned
patcher exposes original code through `factory.toString()`. Label that source
view explicitly; original code is not necessarily the effective patched code.
Treat opaque output as missing evidence, not a complete 29-character component.
Search candidate counts must disclose opaque factories that were not inspected.

If the correct button cannot be selected or fiber access is unavailable, report
the error. Do not dump the surrounding DOM or all React props as a workaround.

## Investigation sequence

Collect small, separately labeled observations; do not paste a whole module graph.

1. Idle sidebar button ancestry, then idle call-overlay button ancestry in the
   same call. Locate shared primitives and distinct connected owners.
2. Inspect narrowly bounded static sources for identified owners/callers. Match
   actual component exports and import dependencies; count candidates rather
   than selecting the first plausible match.
3. Manually start native sharing. Repeat selected-button probes and inspect the
   sidebar card body, stop action and both open stop/change menus. The user owns
   all clicks and consent; probes do not automate native actions.
4. Trace the tile shell, LIVE/name/quality overlays and selection into enlarged
   playback. Identify the layout/selection owner, not only the video element.
5. Trace remote audio presentation separately. If no functioning remote stream
   is available, document source contracts and leave runtime audio unverified.
6. Observe Change Screen, cancellation at both picker stages and each stop path.
   Trace sound calls in source without globally logging event payloads.
7. Repeat relevant layouts in DM and guild voice. Record differences instead of
   assuming one sidebar/grid hook covers them all.

Each later probe must state its purpose, allowed data, size limit and whether it
leaves anything installed. Prefer already-loaded static source, then targeted
fiber **metadata**. Do not brute-force require modules, force-load chunks, dump
stores, intercept network traffic, or log full Flux payloads. Any necessary
temporary listener needs explicit scope, redaction and a cleanup command.

## Per-component contract template

The later agent needs each of these fields, including explicit unknowns:

- Surface and native states covered; evidence IDs and build/host versions.
- Export/owning module, caller and discovery signatures; candidate count.
- Whether exported directly, nested/local, memo/forwardRef wrapped, or connected.
  A local function may need a narrow extraction patch; don't copy its body.
- Prop names, types, defaults, mandatory context/providers, ref contract and
  safe callback replacements. Runtime key presence is not a type contract.
- Store reads, hooks, effects and transitive child dependencies, including
  native stream parsing, watch/start/stop, preview uploads, analytics and audio.
- Presentation-only versus connected/controller boundary, including unsafe
  branches even if they are currently hidden.
- Native CSS/icon/intl dependencies, accessibility, hover/idle/focus and keyboard
  semantics. Resolve native classes/exports rather than hardcoding mangled names.
- DASS-owned inputs, callbacks and lifecycle; native behaviors retained or omitted.
- DM/guild differences and how discovery failure disables this integration.
- Unit/source matching coverage versus manual runtime acceptance still required.

## Reuse rules

Render the actual audited host component with host React (`@webpack/common`).
Reuse native Button, Tooltip, Menu, Popout, Slider and other safe primitives;
do not clone JSX or DOM into a lookalike. A native-looking component is not
necessarily pure: follow children, hooks and callbacks before mounting it.

Prefer callback-driven presentation exports. Connected components that read
native stream stores require a narrow, explicitly guarded DASS branch before
their native side effects. Never populate native stores with fabricated streams,
reuse a native watch action for DASS, or transmit DASS previews/media to Discord.
Native video wrappers may update engine sink ownership; a shell's reuse does not
authorize reuse of its media engine. Keep actual capture/playback DASS-owned.

Private hooks and lookup signatures belong in an isolated versioned adapter.
Require unambiguous matches, grouped patch atomicity where needed, a visible
unsupported-build failure and preservation of non-DASS behavior. Research module
IDs, function names and hashed classes are not stable production contracts.
Do not globally patch peer connections or pretend plugin patches rewrite
Equibop's separately bundled renderer.

Keep UI state separate from authorization. DASS directory names cannot establish
Discord identity; client channel claims cannot grant room access. Do not promise
production readiness, E2EE or relief from OS/firewall restrictions.

## Acceptance matrix for the later implementation

Cover both entry points; idle/pending/active/stopping/failed; picker cancel;
repeated start/stop; source end; change/cancel/replacement; actual call exit;
same-context reselection; disable/logout while consent is pending; local/remote;
mute/volume; grid/focus/filmstrip; hover versus idle; keyboard/focus; DM versus
guild. Extend to fullscreen/popout if the selected components support them.

Verify ordinary Discord voice remains independent and no DASS native-share,
watch, media or preview upload occurs. Test authorized watch replacement and
authorization errors; do not mask failure with native fallback. Unit tests and
successful builds are not runtime acceptance or proof of network isolation.
