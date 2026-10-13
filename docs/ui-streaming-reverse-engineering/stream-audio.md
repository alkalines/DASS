# Selected-stream speaker and volume

Status: original native controller source E27; remote audio GUI is unverified.
The user's local restrictions make remote native watching unreliable; local
self-preview cannot establish received audio, mute/volume or cross-window
ownership. No remote connection was started by a probe.

## Placement in call controls

`540462` controller renders speaker in **renderBottomRight**, not bottom-left.
Condition: selected participant exists, is not ACTIVITY, and selected user's ID
differs from current local user's ID. Source passes context derived from native
participant type, native userId, main window or popout window, icon/slider
classes and voice-control-tray analytics location to `821747.A`.

This explains native selected remote-only audio. DASS must derive local-versus-
remote from its owned publisher/subscriber context, not match display names to
Discord user IDs or create fake native users to enter this branch. Ordinary
Discord voice audio must remain separate.

## Native controller `821747.A`

Complete original factory, 793 chars; one import alias `ep` in `540462`.
Props: className, iconClassName, sliderClassName, userId, context,
currentWindow (default window), location.

Subscribes to `192820.Ay` for `getLocalVolume(userId, context)` and
`isLocalMute(userId, context)`. Wraps lower widget in actual idle wrapper
`447404.A`, providing:

- currentWindow and class props.
- value `824744.M(nativeVolume)`.
- muted from native store.
- maxValue 200 on embedded platform, otherwise 100.
- onValueChange: if positive while muted, native toggleLocalMute; then
  `827343.default.setLocalVolume(userId, 824744.w(value), context)`.
- onToggleMute: optional native `384059.X(..., VOLUME, muted)` analytics, then
  native toggleLocalMute.

This is **not** a DASS-safe speaker controller. Reusing its native icon UI does
not authorize reading/writing native audio state with invented identities.
Lower actual widget is `20504.A`; conversion helpers `824744.M/w`. Their full
contracts, units, hover/drag cleanup and accessibility are next.

## Proposed DASS ownership contract

Reuse the actual lower callback-driven host widget and idle wrapper only after
auditing them. DASS owns mute and volume state, received-stream gain, and supplied
callbacks. Positive volume may unmute to match source behavior, while mute
remains distinct from stored volume. Local preview is always silent.

Do not write native voice/stream mute or native volume stores. Match native
slider/gain conversion intentionally, including the chosen maximum and zero
behavior; native max 200 cannot be assigned directly to HTML media volume
(range 0–1). Any above-unity gain requires an explicitly bounded in-process
Chromium audio path, not a helper process. No gain implementation is certified
by the UI source.

Exactly one audible owner per received stream across main call, selected view,
filmstrip and popouts. Visual tile mount/unmount must not independently create
duplicate audio sinks or lose controller state. Verify ownership handoff,
source-end/stop/disable/logout cleanup, muted/default volume and no interference
with ordinary voice. Reuse Chromium playback, no extra encoder/audio daemon.

Open: lower widget source, conversion units/formula, hover grace, slider orientation,
keyboard/focus/drag, popout ownerDocument/currentWindow semantics, idle holders,
timer/listener teardown, above-unity gain policy, real authorized remote tests.

## Lower widget `20504.A` (E28)

Complete original factory, 2,608 chars. Export is native class `p`, with no native
user/stream/store/action in its own body. Do not create another React runtime or
clone this component; reuse the host export after lifecycle/dependency audit.

Inputs: value, muted, minValue (default 0), maxValue (default 100), handleSize
(default 16; not visibly forwarded in this render), currentWindow, className,
iconClassName/iconColor, sliderWrapperClassName/sliderClassName, onValueChange,
onToggleMute, onVolumeShow/onVolumeHide. Maintains hovered/focused/dragging state.

- Speaker icon reflects muted/zero, low volume (< half max), or normal volume.
- Mute click invokes supplied callback; accessible name is localized `19lt24`.
- Slider is native `122641.A` with VOLUME type, normalized `value/maxValue`,
  currentWindow and owned ref. Drag scales normalized value by maxValue before
  invoking onValueChange. Keep minValue 0 unless auditing nonzero normalization.
- On mount and value/muted update: sets grabber to 0 if muted, otherwise
  value/maxValue. Stored volume can therefore remain independent of mute.
- Slider shown while hovered OR focused OR dragging. Main hover calls
  onVolumeShow; leave waits 150 ms then clears hover and calls onVolumeHide.
  Enter/leave of slider wrapper also has 150 ms grace.
- ArrowUp/Down stop propagation/prevent default. First key establishes focused
  state without changing value; subsequent keys change by 5% of range with
  bounds. Escape clears focus and stops propagation/default. Blur clears focus.

### Lifecycle caveat

This complete class contains **no componentWillUnmount** and does not clear its
owned hover timeout on unmount. The pending callback may set state/call hide
after unmount. Native MediaBar drag/currentWindow listener cleanup is not yet
audited. A later adapter needs a minimal lifecycle-safe seam (or another audited
native primitive), not a copied widget or a claim that callback-only means
resource-safe. Own idle-holder release must be idempotent even if native hide
arrives late; stop/disable/popout close during hover/drag must be tested.

No media decoding/capture/native mute action happens inside this widget body;
all media gain/mute remains the caller's ownership. Rendering it still uses
transitive native MediaBar and host accessible-clickable dependencies.

## Conversion re-export (E28)

`824744` is only 72 chars and re-exports `M/w` from `792251`. Formula/units are
not established until that source is retrieved. Do not infer linear volume
merely from the speaker widget's normalized drag position.

## Exact conversion formula `792251.M/w` (E29)

Complete original factory, 386 chars. Optional baseline argument defaults to
100. `w` maps slider value to native value; `M` is its inverse:

```text
n = value / baseline
toNative(0) = 0
toNative(value) = baseline * n^2.8                       when n < 1
toNative(value) = baseline * 10^((n - 1) * 6 / 20)       otherwise

toSlider(0) = 0
toSlider(native) = baseline * n^(1/2.8)                 when n < 1
toSlider(native) = baseline * (20*log10(n)/6 + 1)        otherwise
```

At baseline 100: slider 0 -> native 0; 50 -> 14.358729; 100 -> 100;
200 -> 199.526231. Local math checks passed inverse round trips within 1e-9
for these cases; this is formula validation, **not remote audio calibration**.
Source alone establishes native numeric units, not measured acoustic gain.
If DASS explicitly chooses 100 as unity, gain is toNative(slider)/100; cap it
and implement above-unity playback intentionally rather than setting HTML
media volume above 1. Reuse actual plain helpers where feasible, not the native
user/context volume controller.

## Native MediaBar `122641.A` (partial E29)

Original factory 3,874 chars, first 2,700 captured. Exports native class `h`.
Types DURATION/VOLUME. VOLUME drag is vertical: `(bottom - clientY)/height`,
clamped 0–1; duration uses horizontal position. Holds animated progress/preview,
dragging and element refs. Registers/removes animation-value listeners.

Drag start invokes supplied callbacks and registers mouseup/mousemove on
`props.currentWindow` (default window). Normal drag end removes them from the
then-current props.currentWindow. But **componentWillUnmount removes them from
global window**. If currentWindow differs from global window (e.g. a popout),
unmount during drag may leave listeners on the owning window. Changing
currentWindow mid-drag also needs an owner-pinned cleanup policy.

Required adaptation: a narrow audited lifecycle seam must retain the actual
window owning a gesture and remove exactly those listeners on drag end/unmount,
plus clear the speaker widget's hover timer. Ensure disable/stop/popout close
mid-drag cannot leave late callbacks/idle holders. Preserve ordinary native
paths and host animation/mouse/focus semantics; do not copy the widget or start
another audio process. Remaining render/drag-end tail is next.

E30 completes MediaBar tail (overlap 2,500 through end 3,874). Normal drag end
invokes supplied onDragEnd, removes mouse listeners from currentWindow, then
clears dragging. Render uses native VOLUME CSS for vertical interaction, ordinary
mouse handlers and animated fill/grabber. DURATION-specific buffer/time bubble
branches are separate. No additional unmount-window correction appears in the
tail; the E29 lifecycle mismatch remains. The widget owns presentation/listeners,
not an audio sink, gain node or remote stream subscription.
