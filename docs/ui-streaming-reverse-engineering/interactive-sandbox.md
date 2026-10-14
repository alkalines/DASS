# DevTools component sandbox

## Scope change requested by user

After E47, user asked for executable DevTools snippets to replicate investigated
behaviors. This permits temporary, user-run **interactive presentation tests**,
not plugin/backend implementation, capture, native sharing/watching, deployment,
injection or modification of native stream/voice stores.

The report is enough to begin a guarded prototype, not proof every connected
surface is safe or accepted. Remaining card composition/helper contracts,
provider/compatibility checks, focused/remote GUI/audio and security acceptance
remain explicitly open. Sandbox results must get new evidence labels; mocks
cannot certify DASS media, authorization or transport interoperability.

## Video media-leaf experiment: scripts 65 and 66

New user-authorized test following the source trace in
[UI reuse evidence](../discord-ui-reuse-evidence.md). Script 65 prepares a private
instance of the inspected original `51092` module with cached dependencies only.
Scoped facades disable spinner telemetry, native incoming-video readiness timers
and native ready/timeout dispatch. Registered factories, stores, socket methods,
native media engines and global dependency exports remain unchanged.

Script 66 mounts the actual video wrapper in a clearly labeled diagnostic root.
A supplied media leaf plays generated canvas video, delayed 1.8 seconds to expose
the actual native loading/spinner transition. No OS capture, audio, connection,
streaming backend or thumbnail upload is started. Test selector stays private to
the isolated renderer; it is not inserted into a native store. Pause/Resume and
Remove are diagnostic controls, not the proposed production stream controls.

Cleanup unmounts the owned root, stops generated tracks, cancels the animation
and pending media attachment, removes owned listeners/container and deletes only
the matching test registry. Re-preparation cleans a previous owned test after
successful preparation. Missing dependencies/source signatures fail visibly.

This experiment tests actual wrapper/media-leaf compatibility only, not original
call-tree placement, zoom providers, full tile/footer/menu, remote audio or DASS
interoperability. Its diagnostic root must not become the production replacement
player. Source compilation is a temporary research tool, not a production loader.
Local isolation/cleanup/missing-host fixtures and mount syntax passed with Bun;
the user subsequently ran the shorter inline variant and explicitly confirmed
the colorful generated video/timer and working Pause/Resume in the actual host.
Spinner timing and Remove/cleanup remain unconfirmed. This does not accept the
original call tree, zoom wrapper or DASS transport. Cleanup command:

```js
globalThis.__DASS_VIDEO_WRAPPER_TEST__?.cleanup();
```

### Actual call-grid media test: scripts 67–70

After reported removal, the user supplied the live `renderContent` head/tail and
idle-call flags: no video/selection/popout, with cached root/grid/frame and a
renderable object tile export. Script 67 captures the controller and original
descriptor without changing rendering. Script 68 prepares the same isolated
actual video wrapper; script 69 defines the generated-video sample without
creating media until React mounts it.

Script 70 temporarily shadows only that mounted controller's `renderContent`,
preserves the original call shell/control props, and replaces a verified central
root with the actual host Flex/callback Grid. Genuine idle participant objects
render through the native generic tile; the extra callback renders the actual
frame/video wrapper with a DASS-private media selector and generated canvas leaf.
There is no second root, floating overlay or fake native stream/participant store
record. The diagnostic Pause/Restore controls are not the original stream footer.

The central subtree may remount. Only test in idle non-Stage voice without real
camera/share/activity/selection/popout. Context/shape/ownership guards pass the
original render through on mismatch; sample unmount stops its canvas track,
interval and pending attachment. Cleanup restores only the owned method and
preserves later foreign changes, disconnects the connectivity observer and
requests normal rendering. No socket/watch/start/preview actions are invoked.

Local syntax and mocked shell/reference/callback/context-guard/descriptor/
foreign-patch restoration fixtures passed. The user subsequently reported a card
with working Pause/Resume, but explicitly rejected equivalence to a normal Discord
stream. Full layout/voice/cleanup acceptance remains pending. This tests grid placement and
media-leaf reuse, not complete connected-root semantics, original stream footer,
zoom/focus/filmstrip/popout or DASS transport. Do not call it complete native UX.

```js
globalThis.__DASS_CALL_VIDEO_TEST__?.cleanup();
```

### Original normal-card parts: scripts 71 and 72

The user rejected the partial frame/video grid as unlike a normal Discord stream.
They then supplied the complete current original card return, footer and overlay.
Script 71 collects the reviewed current source profile without mounting/capture.
Script 72 prepares private original render/helper/footer functions, replacing the
footer's connected identity/activity/auto-video/menu subscription prefix with
owned presentation inputs. Original generic title lookup is bypassed. Scoped
analytics/zoom/shake/confetti facades prevent native action/effect paths, leaving
registered modules and dependencies unchanged.

The actual overlay function receives owned simulated status rather than querying
native stream state. Its native health consumer is skipped; connected quality/
upsell child is replaced by the actual pure LIVE component. Quality text and
health warnings are explicitly outside this test, not claimed as preserved.
Focused native zoom/popout controls are disabled. The target is original
non-focused card/hover/title/footer composition with generated media, not full
focus/fullscreen/popout/quality/audio or DASS acceptance. No fake native records,
keys, events or backend/preview actions are introduced.

Private source compilation remains research-only. The production approach needs
reviewed build-time guarded/exposure seams, not runtime source loading. Compiling
parts is not GUI acceptance and creates no media. Do not stringify the parts
registry/cache or collect native credential/identity values.

```js
globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup();
```

### Restartable normal-card demo: `76-normal-card-demo.js`

Discord restart removes console registries; these UI tests have no backend
session to expire. The consolidated local script prepares all reviewed parts,
captures an idle mounted call, defines generated media and installs the original
non-focused card in the actual callback grid in one execution. It retains actual
card/footer/overlay rendering with the explicitly limited scopes above. Menus
use host primitives with diagnostic pause/mute-icon/restore actions; popout is
disabled and mute is visual only (generated video has no audio).

From the repository root, regenerate the checked-in artifact with:

```sh
bun scripts/build-ui-reuse-demo.mjs
```

In Equibop, join an idle non-Stage voice call, expand the call view, and select a
connected native participant element in DevTools Elements. Copy the complete
local `docs/ui-streaming-reverse-engineering/76-normal-card-demo.js` file into
Console and execute it. No preparation snippets are needed. If the terminal
supports OSC 52 clipboard writing, this optional repository-root command copies
the script without clipboard packages:

```sh
printf '\033]52;c;%s\a' "$(base64 -w0 docs/ui-streaming-reverse-engineering/76-normal-card-demo.js)"
```

If clipboard writing is unsupported/blocked, use a text editor and copy the file
manually. Do not install host clipboard packages or start an HTTP/helper server
for this test. The script reads already-loaded original source, not remote code.

The artifact checks each stage, restores owned state on preparation/install
failure, preserves foreign registries/method changes, and captures the selected
controller before cleaning previous owned tests. Generated producer cleanup is
also explicit if a later foreign render patch prevents normal unmount. Missing
cached dependencies or source-profile mismatches stop visibly without loading
chunks, starting capture or falling back to native sharing.

Card/footer/overlay fixture checks and consolidated syntax/selection/foreign
ownership guards passed locally. The consolidated full-card GUI has not yet been
accepted; prior grid Pause/Resume does not establish it. Source/typing/provider/
menu/cleanup/voice regressions still need live testing. This remains a research
artifact, not a plugin implementation or transport acceptance result.

```js
globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup();
```

## First step: `44-sandbox-preflight.js`

Read-only check of loaded module exports, host React/root API availability and
original idle-context source. Does not mount components, invoke factories,
read identities/preferences, select streams or call capture/watch/audio APIs.
Coordinates are restricted to this research session, not production discovery.
Missing cached components must not trigger brute-force module loading.

## Planned temporary presentation tests

### `45-share-sandbox.js`

First user-run interactive test: actual Share export in base/split variants,
native frame/LIVE/secondary buttons; local publishing/pending/source state and
no-op idle provider. Base click opens a mock action list when active; split main
click stops directly. This is not the actual connected sidebar owner/menu/card.
Accept/cancel controls simulate consent; they do not invoke either real picker.
Source-change accept changes mock label only. No cue plays and no transport is
created. Lower split components may read normal native theme/mode state and
animation may load host assets. No native state is written.

Run with no actual share active for easier visual comparison. Remove via visible
Remove preview button or `__DASS_UI_RESEARCH_SANDBOX__.cleanup()`. Re-running
cleans the prior owned root. Cleanup unmounts React before removing container
and styles. No global keyboard/event listeners or persistent settings.
Report initial rendering/errors, active colors, caret/action-list behavior,
cancel preserving idle/active, change preserving active, direct stop and removal.
Local mock validation does not establish native runtime rendering or production
integration. Native assets/subscriptions remain subject to host lifecycle.

Local validation: Bun mock test exercised start/cancel/accept/change-cancel/
change-accept/direct-stop, repeated mount cleanup and explicit removal. Host
components were stubbed; actual rendering/animation/tooltips remain pending.

### Sidebar distinction and `46-sidebar-button-sandbox.js`

E49 broadly accepts first preview but notes missing sidebar green background.
Script 45 Base Share is an overlay variant, **not** the Voice Connected sidebar
control. Its lack of sidebar styles must not be generalized as a sidebar failure.
Script 46 tests actual native Button/Tooltip/animated icon with owner-supplied
CSS exports from `187529`, including selected rK, not new painted green CSS.
It tests icon-only sidebar presentation; connected owner, focusProps, responsive
icon-plus-text branch and actual popout/menu remain outside this test.
Idle click simulates active immediately; active click opens mock stop controls.
No real consent/capture or native analytics/stream actions. Separate root/state
from script 45. Remove with `__DASS_SIDEBAR_RESEARCH__.cleanup()`; re-run cleans
only its own prior root. Sandbox positioning styles do not recreate native
button styling. Missing cached dependencies abort without module loading.

E50 user confirms selected green background matches actual sidebar. Active
sidebar action list must include Stop Streaming/Change Screen (omit reporting);
mock controls are not native-menu acceptance. Next isolate actual native menu
root/items without connected ManageStreamsMenu hooks or stream actions.

## User-requested in-call mock tile

User asked to test a mock stream card inside a call. First inspect user-selected
call-area DOM element via `47-call-tile-slot.js`: only tag, geometry/position/
overflow for up to six ancestors and native frame source/availability. No
identities, element text, screenshots, fibers, native participants or stores.
It mounts nothing and retains no selected-element reference globally.

Proposed next test inserts a separately owned React root into an explicitly
selected supported call-area slot, using actual native frame/LIVE primitives and
local mock callbacks. Do not fabricate native participant records, call native
selection/watch actions, mount connected player/tile/layouts or imply a sandbox
child participates in native grid measurements/selection. No reparenting/
replacing native nodes or ancestor-style modifications. Cleanup must unmount
owned root and remove only owned nodes/listeners/observers/styles. If no suitable
positioned slot exists, stop and choose another explicit target.

### `48-in-call-tile-sandbox.js`

E51 chooses ancestor 1 of unchanged $0: positioned 1,207x239 call strip. Inserts
an absolute overlay root as its child without modifying parent styles/native
children. Native frame/LIVE/secondary buttons; generated static test pattern,
not video. Expand widens only inside strip; it does not enter native focused
layout or fullscreen. End/return preserves local mock view with a clearly
diagnostic ended label, not native connected ended component. Change source
switches mock label without ending state or sound. All changes own React state.

Remove via button or `__DASS_CALL_TILE_RESEARCH__.cleanup()`. Re-run cleans own
prior root. Scoped MutationObserver checks connectivity only (no content reads),
unmounts if host/root detached, disconnects on cleanup. No native stream/voice/
selection dispatch, capture, audio, native menu, credentials or participants.
Position/frame sizing may be rejected or clipped; do not change native ancestor
styles to force placement. Native grid does not count/measure this overlay.

### Scope correction: real call render integration

User rejected script 48 overlay approach: requested manipulating overall call
component so mock participates in layout/selection. User confirms overlay removed;
script 48 has no accepted GUI evidence. Do not call its mock local wide/end state
native focus/ended/resume integration. New goal is a reversible research-only
render adaptation, not production fiber-based integration.

`49-call-render-boundary.js` reads bounded mounted controller render source and
native callback grid source from an explicitly selected participant tile. Only
prop names, capability/descriptor booleans and function source returned, no
identity/participant/store values. No render/forceUpdate callbacks invoked or
instance/factory/prototype/selection state changed. Inspect before authorizing
any actual adaptation; preserve native actions/media and avoid remount side
effects. Do not inject fake participants into connected native consumers.

E53 renderer has no props-override API. Candidate actual-tree adaptation wraps
only mounted controller's renderContent method and retains original call-shell
element/control callbacks. It may remount central tiles, so limit to idle voice
call without real camera/screenshare, selection, activities, pending sessions or
popouts. Native media safety is not established by a mock grid. `51` performs
final root/shape preflight before any instance mutation; no identity values.

### `52-native-call-grid-sandbox.js`: actual call-tree experiment

E54 idle preflight passes. This is **not an overlay or second React root**.
Temporarily shadows renderContent only on mounted call controller instance.
Calls original method, retains returned call shell/header/bottom/effects, and
replaces central expected `874739.A` element with native Flex/callback Grid.
Authentic filtered participants render through actual native generic tile;
extra callback renders actual frame/LIVE/native buttons, not native participant.
Wrapper object tile export is valid React, not a missing function.

Layout/grid sizing is real; mock Solo changes callback list to one mock and
Return restores genuine tiles. It is **not** connected native focused layout or
selection store. Mock ended content remains diagnostic, not `566331.A` reuse.
No media, sound, authorization, native remote-watch or transport acceptance.
Real central tiles may remount on installation/solo/restoration; use idle call
only, no real camera/stream/activity/popout. Native voice transport untouched by
script, but GUI/lifecycle compatibility still requires user acceptance.

Guards pass original rendering through on context/mode/media changes. Unsupported
central element leaves original intact with status. Scoped styles only. Registry
status contains no native identities. Cleanup restores saved own descriptor or
deletes only owned shadow method, and never overwrites a later foreign patch.
Disconnects observer/removes style, schedules native restoration if mounted.
Observer checks controller wrapper connectivity only. No factory/prototype or
participant/selection-store mutation. Disable via visible Restore call or
`__DASS_CALL_GRID_RESEARCH__.cleanup()` before further native share/camera tests.
This research-only instance/fiber approach is not production plugin integration.

Local Bun mock validation passed for shell callbacks/participant-reference
preservation, three callbacks (two genuine + mock), mock solo/end/return, media
guard passthrough, own-descriptor restoration and later foreign-patch preservation.
Native tile/grid/Flex rendering and real call lifecycle remain pending user test.

E55 user broadly confirms card/behaviors appear, but requests full original
stream-specific card composition rather than frame-only placeholder. Individual
52 cases remain unenumerated. Next source probe 53 reads actual loaded generic
tile render tail and original dependency header. No component/factory invocation.
The proposed next adaptation must preserve actual native presentation instead
of cloning complete JSX, while bypassing connected native stream/media/preview/
analytics/entitlement/identity action paths. Do not equate authentic native
participant callbacks in 52 with safe fabricated stream input to 175203/802867.

E56 actual mounted stream branch confirms full composition: native connected
media/overlay, click/frame/zoom/effect/context wrappers, footer and hover stats.
Original header aliases differ from mounted aliases; never combine these source
views into an executable closure. Probe 54 reads original footer/control helpers
only. Any extraction must remain narrow, reuse actual host UI/assets and bypass
all connected native actions/effects. Whole-component dummy-data mounting or
copying complete implementation into a lookalike remains out of scope.

### `56-source-native-stream-card.js`: original presentation extraction

Requires **updated script 52** exposing setMockRenderer. Restore old installed
52, select native participant tile, paste current 52 file, then paste 56 file.
No element selection required for addon 56. It replaces only mock callback's
render component and leaves real participant callbacks/state/keys unchanged.

This is a source-derived narrow presentation experiment, **not mounting the
unmodified connected `175203.Ay` with dummy data**. Reads already-loaded original
host source, validates expected signatures/width helpers, and compiles original
outer JSX render, pure computer/icon control helpers and adapted private footer.
Does not execute original factory or initialize modules. Cached imports only;
fresh namespace facades replace analytics/zoom/shake/confetti dependencies for
this private closure without changing global cache/factories/prototypes.

Connected footer identity/activity/decoration/auto-video/context-store prefix is
removed; width helpers and native spring/animated UI retained. Focused zoom and
popout branches disabled. Title supplied directly, user ID null, verification
false, voice effects/debug off. UI-only key/type never reaches connected player,
native title/identity helpers, stores or watch actions. Original native JSX/
classes/frame/clickable/footer/computer/mute/options controls retained rather
than copied as a lookalike implementation. Existing plugin patches may differ
from original source; source view is explicit and isolated to mock presentation.

Media is an explicitly marked empty placeholder. LIVE/quality use actual lower
badge primitives with native width/idle gating, not connected premium wrapper,
health warning or its animation/upsell effects. Mock action list not native menu;
End text not native ended component; Solo still callback grid, not native focus.
Native-looking mute controls only change local visual boolean, no audio/mic/
volume/watch/capture. No genuine Discord user impersonation or E2EE assertion.

Remove addon via `__DASS_SOURCE_CARD_RESEARCH__.cleanup()` to return to earlier
frame mock; restore whole call via `__DASS_CALL_GRID_RESEARCH__.cleanup()`.
Observer removes owned style/closure registration when grid ownership disappears.
Virtualized tile unmount does not revoke addon registration. No persistent
settings or uploaded media/code. If signatures/dependencies fail, abort before
renderer installation. This explicit user-run source compilation is a temporary
research tool, not a runtime plugin-code loader or production strategy.

Local Bun fixture tests passed for source extraction, connected prefix/title/
analytics/zoom/shake/confetti bypass, mock footer title/mute/menu state, cleanup
and source mismatch rejection. Grid regression mock tests pass. These tests use
stubbed host exports; real source compilation/native GUI remains unverified.

E63–E64 update: source 56 now uses actual native Menu/Item/Group/Separator/
Checkbox primitives through public context-menu UI API, not connected Stream
ContextMenu 744960. Owner-style Stop/Change, separators, disabled Pop Out,
More Options with two preview checkboxes; reporting completely absent. Actions
change mock state only. Preview checkboxes currently toggle diagnostic flags/
marker text, not full preview lifecycle or native settings. Defaults are mock
true/false, not read from user settings. Pop Out intentionally disabled pending
safe integration. Context-menu root has its own error boundary; ownership token/
effect/close callback avoids closing unrelated replacement menus. Card/addon
unmount closes owned menu; checkbox actions/ordinary menu closure release state.
No native context-menu impression/idle/watch controller callback invoked.

Source click/double-click now separate: double-click selection callback removed.
Native focused/filmstrip and selected-ended-image behavior remain pending; do
not claim diagnostic solo/ended text implements those. User clarifies enlarged
ended view, grid disappearance; this is recorded in E64, not yet implemented.

E65–E67 missing menu icons: Stop 959988.G, Change 183623.F, Pop Out 811893.t
traced from original native item declarations. Added both icon/leadingAccessory
props to those mock rows using cached exports only. Captured More Options has
no leading icon; submenu indicator belongs to native MenuItem. Do not invoke
native popout helper 810845 or render connected menu 744960. Registry menuIcons
reports cached icon availability; false means unavailable, not silent module load.

E68: user accepts icons but corrects ownership. Source 56 now defaults to Viewer
mode; explicit Owner mode button switches mock role. Viewer omits Stop/Change/
More Options, shows visual mute and disabled popout. Owner adds those controls/
preview submenu and hides remote-audio footer icon. Role is local test state,
not a Discord identity or DASS authorization claim. Native solo/focus still not
equivalent: current code changes callback count and hides other tiles. Source 61
next inspects actual focused/ended templates; no connected fake-participant mount.

## `63-native-focus-and-ended-sandbox.js`

Requires updated 52, then 56, then 63. Restore old grid first. Native focus module
is prepared in a fresh private namespace from inspected host source, cached
imports only, with guards before every mock identity/media consumer. Actual
geometry, transitions/springs/cleanup/classes remain native. Tile adapter sends
only tagged mock UI descriptors to own source renderer, not native generic tile.
Real filmstrip entries retain native rendering/sizing; no mock record enters
native names/partition/local-camera logic. Strip receives null selected ID so
mock UI key does not enter it. Camera pairing/activity/current-user/media lookups
are scoped no-op facades, strip toggle omitted, native remeasure events bypassed.
No native participant/selection/store/factory/prototype mutation.

Ended module retains actual theme/artwork/intl/width buckets. Scoped channel
lookup and Stage effect skipped; key/close callbacks map only to owned dismiss
function. UI stream carrier contains that callback, not Discord stream claims.
Source renderer embeds actual ended element in mock media area. Native zoom/
fullscreen/popout remain unavailable; expanded footer adaptation not complete.

Grid's click selects mock idempotently; return is explicit, not extra dblclick
toggle. End in grid removes mock callback; end while focused retains view;
returning to grid after end removes it. Native ended close removes retained mock.
Announce mock return button simulates new publication when mock absent, no actual
directory/subscription/audio. Focused Return clears ended flag only on mock Return
action; selection/menu/role state may reset on card remount and is not yet accepted.

Native focus suppresses filmstrip when height <=384 px (112px tile height +8
margin, plus native thresholds), so enlarge call vertically for strip test.
ResizeObserver measures owned focus host and cleans up; mutation observer removes
addon registration if grid owner disappears. Cleanup
`__DASS_FOCUS_RESEARCH__.cleanup()` restores prior grid-style focus fallback;
whole-call restore uses grid cleanup. No production fiber/source-loader strategy.
Local isolated-factory fixture passed connected consumer bypass, real-only strip,
owned ended close and observer cleanup. Real host GUI/interoperability unverified.

E59 initial addon aborts at generic dependency guard. Corrected unverified
player CSS coordinate by tracing original 802867.Y import, not guessing module
109294 or searching DOM class substrings. Guard now returns named missing
exports/binding count. User only needs rerun updated 56; existing updated grid
test remains installed. Runtime resolution/rendering still pending.

E60–E62 source-coordinate failure identifies a different alias profile (11,975
versus 12,010 chars); no cause/build drift established. Updated 56 discovers
import/renderer/helper/footer roles rather than old letter coordinates, then
uses one of two explicitly inspected projection profiles. Unknown profiles fail
closed; no broad identifier renaming. Current full render/footer/helper fixture
passed title/computer/options/mute, width gating, mock end and cleanup with
stubbed UI and native connected hooks/actions forbidden. Actual host rendering
is still pending; rerun only current 56 while grid test remains installed.

E63 user confirms card visually close but reports double-click-only/weird solo,
incorrect ended/grid behavior and incomplete owner three-dot menu. Native
focused layout, ended view and full menu remain open. Native menu should use
actual lower Menu primitives with owned callbacks, not connected native stream
menu hooks. Checkbox state is mock preview preference only; never write native
settings or imply an implemented native popout/capture action. Clarify ended
context before imposing a stream-count rule. Inspect click/menu source next.

- Actual native Share/split control with locally owned mock publishing boolean,
  start/stop/cancel callback state and explicitly isolated idle callbacks.
- Actual audited frame/LIVE/card-action primitives; no synthetic native
  participants, previews, media engines or connected card owners.
- Retained-ended/dismiss/return simulation as **mock intent** first; actual
  connected ended component cannot mount until its native hooks/actions have
  a separately audited extraction seam. Never substitute a copied lookalike
  and call that actual ended-component reuse.
- Sound playback, if later explicitly requested, separate opt-in user gesture
  with both native preference gates; not automatic during mock transitions.

Any mounted sandbox needs visible simulation labeling, scoped container/styles,
error boundary, repeat-run ownership and explicit root unmount/removal cleanup.
No monkey-patching native stores, factories, actions, peer connections or
capture. No persistent settings or global event listeners without cleanup.
Only sandbox-owned state is simulated; genuine native state remains unchanged.
Host components may load their ordinary assets; no external executable code.

A temporary diagnostic container is not the proposed production call integration
and does not relax the requirement to reuse actual native surfaces there.
