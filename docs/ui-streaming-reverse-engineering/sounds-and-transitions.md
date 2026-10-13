# Stream sounds and transition verification

Status: start/end sound playback is baseline user observation; source tracing
E31–E36 covers cue selection, preference gates, playback and lifetime. No probe
plays audio, starts/stops sharing or dispatches events. Manual cancellation/
change/stop acceptance still needs collection.

## Sound inventory distinction (E31)

Six sampled factories out of sixteen matches included both uppercase native
actions and lowercase sound names. Uppercase STREAM_START/STREAM_STOP occur in
overlay content protection, clips, analytics and connection managers; they are
not evidence of the audio API or cue timing. Never dispatch these actions for
DASS to obtain sounds, UI state or venmic teardown.

Actual lowercase `stream_started` / `stream_ended` are in original `157667`,
near offsets 831,834 / 831,862. Excerpt returns these names before stream-viewer
join/user join/leave cues. The surrounding function's inputs, transition
conditions and consuming playback helper are not yet collected. Source also
references VoiceChannel rtcConnectionJoinSounds config for other cue conditions;
do not assume that is the complete screenshare sound preference gate.

Next probe narrows inventory to actual lowercase cue names and retrieves a
bounded selector window. Static source view remains original, not necessarily
the effective patched UI. No audio assets are requested/executed.

## Stream cue selector `Mo` (E32)

Complete selector component is visible in original `157667` context window.
It invokes helper `b9(stores, snapshotSelector, transitionSelector)` and returns
null. Actual b9 playback/preferences implementation remains next.

Snapshot includes native voice channel/type/count, advertised stream owner IDs,
active native stream data/current user, one active stream key/viewer count,
RTC-connected state and native RTC user IDs. CONNECTING stream is excluded
from the single-active-stream viewer-count calculation; it does not suppress
the separate advertised-owner start test.

Transition selection is suppressed when voice channel changes/is absent, channel
is AFK, or channel type belongs to native exclusion set `nS.Do` (contents not yet
retrieved). Within same eligible channel:

- Start: a current advertised owner ID was absent from previous owner list.
- End: a previously advertised owner disappears and is either local current user
  or represented in previous allActiveStreams owner list.
- Stream viewer/user join/leave cues have separate counts/thresholds/RTC policy;
  do not conflate them with start/end.
- VoiceChannel rtcConnectionJoinSounds changes some join/leave comparisons;
  this is not evidence of the full start/end disabled-sound preference gate.

Start/end names are therefore driven by native announcement/state transitions,
not direct capture-picker callbacks or actual frame receipt. Changing source
without changing advertised owner may not produce a new start/end cue. Call exit
changes context and is suppressed by this selector; other disconnect cues may
be owned elsewhere. No timing measurement or actual audio play is established
by the static source.

For DASS, use authenticated DASS publication/directory identity and owned session
transitions, never fake Discord streams/owner IDs to feed Mo. Define exactly
which local/remote transitions should match this policy, with source-change,
reconnect, failures and context changes deduplicated. Do not claim publication
or reception from merely having a capture lease.

## Preference gate and playback seam `b9` (E33)

One local binding in original `157667`, offset 826,988. Complete helper:

```js
function b9(e,t,n,i){em.useEffect(()=>{let r=t(),a=new ef.ru(e,()=>{let e=t(),a=n(r,e);null==a||iW.A.isSoundDisabled(a)||(0,b7.Ak)(a,i??.4),r=e});return a.attach("useSound"),()=>a.detach()})}
```

It owns a store listener, starts with a baseline snapshot, computes a cue on
change, checks `iW.A.isSoundDisabled(cue)`, then calls `400492.Ak(cue, volume)`
with default 0.4. Updates the baseline even when no cue or sound is disabled.
Effect cleanup detaches the listener. No direct capture/start/stop action.

Do not invoke this hook outside host React or attach it to fake native streams.
DASS should own its authenticated publication/transition deduplication and use
the audited host preference/playback seam. Sound API and preference-store export
contracts remain next; 0.4 is an API argument, not measured output loudness.

## Host sound API `400492.Ak` (E34)

Complete original factory, 1,071 chars. Ak selects current native soundpack
through `312671.A.getSoundpack()` unless an explicit fourth argument is supplied,
maps cue through `458640.A(pack)`, constructs host `946261.WebAudioSound` and
plays it. Second argument volume defaults to 1 (native stream selector passes
0.4); optional third callback uses playWithListener; fifth options control output
channel and notification-failure tracking. Returns the sound object when enabled.

It checks `351906.A.disableSounds` before playback. It does **not** itself call
NotificationSettingsStore.isSoundDisabled: the selector helper checks that
separately. DASS must preserve both gates, use the current pack/default output,
and avoid soundpack overrides/raw URLs/notification-failure analytics unless
explicitly justified. Source-observed reusable call shape is
`playSound(cueName, 0.4)` after an audited preference check; names/signatures must
be discovered through the isolated adapter, not hardcoded numeric module IDs.

Native notification preference store is `803224.A`, displayName
NotificationSettingsStore, persisted settings namespace notifications. E34
header shows disableAllSounds and disabledSounds defaults but not complete
isSoundDisabled implementation. Additional disableSounds gate and returned
sound object's stop/cleanup contract still need bounded source inspection.
No cue was played or sound object constructed by a probe.

## Confirmed preference semantics and remaining lifetime caveat (E35)

`803224.A.isSoundDisabled(name)` returns disableAllSounds OR membership in
disabledSounds. This is the per-cue/all-notification-sounds gate used by b9.
`351906.A` is StreamerModeStore; its disableSounds getter returns enabled AND
configured disableSounds. Ak checks that getter, so it respects Streamer Mode.
No actual user preference values were read by the probes.

Returned `946261.WebAudioSound` exposes pause, stop and playWithListener.
stop calls destroyAudio; visible destroyAudio resolves owned audio, clears
onerror, pauses it, clears src and drops the promise reference. Full construction,
normal end and pending-load/play cleanup remain to inspect. Do not assume stop
cancels every pending continuation from these short excerpts. Avoid optional
playWithListener unless needed: visible implementation schedules a timeout and
its lifetime/error semantics are separate from ordinary one-shot play.

## Complete sound-object lifetime (E36)

Complete original `946261` factory, 2,916 chars; no truncation or opaque source.
Despite the WebAudioSound name, this implementation uses a host-owned HTML Audio
element and the native asset catalog, not a demonstrated Web Audio graph.

- ensureAudio caches a promise; onloadeddata applies
  `Math.min(outputVolume / 100 * cueVolume, 1)` and playback rate, selects sink
  on embedded hosts, then resolves. Default output uses the default sink; the
  alternate output uses the host's mapped voice sink. Do not enumerate devices
  or duplicate that mapping in DASS.
- Ordinary play sets loop false and calls audio.play; normal onended calls
  destroyAudio. No explicit duration timer in the ordinary one-shot path.
- stop/destroyAudio queues pause/src/error-handler cleanup on the cached promise
  and immediately clears its reference. It does not abort loading, invalidate
  queued play continuations, clear onloadeddata/onended, or track a generation.
  Do not promise immediate cancellation of a loading cue. An old onended callback
  calls instance cleanup, so overlapping reuse of the same instance is unsafe.
- Load failure rejects the cached promise; ordinary play/cleanup do not catch
  that rejection. The play rejection handler concerns audio.play only. Optional
  telemetry is false by default; do not enable it for DASS.
- playWithListener uses audio.duration directly as setTimeout milliseconds,
  although HTML media duration is seconds. It has no owned timer cancellation,
  does not await/catch audio.play, and does not propagate ensureAudio rejection
  to its outer promise. Never use it as publication success/end or cleanup proof.
- Sink selection is not awaited or caught in the visible onloadeddata handler;
  this source does not establish reliable output-device routing on every host.

Reuse ordinary Ak one-shot playback/current assets with the two audited guards;
do not mutate/reuse sound instances or use completion callbacks. If the later
library requires strict pending-cue cancellation, implement and test a narrow
host lifecycle adaptation rather than claiming the native stop contract provides
it. No playback, failure behavior or device routing was tested at runtime here.

## Intended DASS cue contract (proposed, not native timing evidence)

Reuse audited host playback API/assets, respecting native sound preferences,
volume and disabled/muted state. Keep this separate from native stream signaling.
Avoid raw CDN/audio URLs, new helper processes or fabricated native events.
Exactly one cue per owned meaningful transition; rerenders, menu opens, duplicate
stop calls, strip mounts and late callbacks must not duplicate playback.

Opening/cancelling a picker must not sound like successful publication. Capture,
backend publication and receipt are distinct states; research native cue timing
before deciding the equivalent DASS accepted-start/ended trigger. Failure and
context-exit behavior must be explicit, not a silent native transport fallback.

## Remaining manual transition matrix

### Idle source-picker cancel (E46)

User reports no change after cancellation except host notification beginning
"Screen capture failed, was canceled or overlaps another capture. If shar...".
No active card/tile, control-color or cue change reported in response to the
requested check. Notification is partial and generic; no overlap/build drift/
permission diagnosis follows. This verifies visible idle cancellation behavior,
not absence of leaked tracks/audio.

### Host settings-picker cancel (E47)

User also confirms canceling the resolution/framerate/audio dialog leaves UI
unchanged and displays the same notification, with no cue reported. Both picker
stages have visible cancellation evidence; actual track/venmic cleanup remains
unverified. These observations do not establish DASS-enabled cancellation.

### User clarification (E37)

Current Change Screen testing is blocked: user reports a strange notification
and suspects a change in the Equibop build. Notification text/cause and changed
revision are unknown; do not treat this as verified build drift or diagnose it.
Cancellation behavior was therefore not established.

User recalls normal accepted Change Screen behavior: current stream switches
source (for example whole display to a window), without other UI/color changes
or start/end sound. This is historical user observation, not a fresh successful
replacement/cancellation test on the currently running build. It supports a
proposed no-new-session-cue policy but does not establish track/venmic cleanup.

Overlay main-button stop question was unclear to the user; no result collected.

### Follow-up stop confirmation (E38)

Overlay main icon immediately stops sharing. Go Live card disappears from above
Voice Connected, controls return to normal color, stream view disappears and
end-stream sound plays. Relative cleanup/cue timing not measured. Remote viewer
ended/resume behavior is recorded separately in behavior.md; local publishing
stop must not be generalized to removing every remote viewing placeholder.

Use DASS-disabled native UI as baseline; probes remain read-only. Do not include
screen thumbnails, source/window titles, usernames/channel IDs or raw store data
in returned evidence. Record only state changes and observed timing:

| Manual case | Observe |
| --- | --- |
| Idle start through sidebar | OS picker -> host quality/audio picker, cancel or submit; cue timing; green/pressed/card/tile |
| Idle start through overlay | Same capture path versus differences; split control state |
| Cancel OS picker | No active card/control/LIVE, no accepted-start sound, safe return to idle |
| Cancel host settings picker | Same cleanup, optional audio not left running |
| Change Screen then cancel | Does old capture survive? Does state/sound change? Both entrypoint menus |
| Change Screen then accept | Card/title/quality/preview transition; track replacement; no duplicate sounds |
| Stop via sidebar button/menu | Exact direct-stop versus open-menu behavior; native end cue; idle restoration |
| Stop via overlay main/caret | Main direct stop and caret menu; both reset same surfaces |
| Source/window ends | Cleanup/control/card/tile disappearance and cue |
| Actual call exit | Publication/media ends; ordinary voice independent |
| Own tile selection | Event target/click versus double-click; actual focus and return to grid |
| Remote selected stream (when possible) | Speaker visibility, mute/gain, loading/failure; cannot certify from self-preview |
| Guild/group-DM comparison | Placement, permissions, activity/other-stream menu differences |

Native acceptance does not certify DASS interception, authorization, media/audio
isolation, cancellation ownership or production readiness. The later plugin/lib
must repeat relevant cases with DASS enabled and verify no Discord media/preview
fallback or upload occurs.
