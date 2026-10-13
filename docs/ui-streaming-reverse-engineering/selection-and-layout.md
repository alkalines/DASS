# Native selection and call layout

Status: E20–E22, native self-stream in the user's ongoing DM/CachyOS/Wayland
investigation. Focus entry is not yet runtime-established. Source and captured
fiber props must not be conflated with a verified committed UI transition.

## Controller `eq`, factory `540462`

E22 identifies mounted class `eq` extending host PureComponent, body 15,646
chars, one original prefix match in `540462` (20,502 chars). Bounded handler
excerpt is complete for `handleSelectParticipant`; full class and all providers
remain uncollected.

Inputs include channel/guild/permission, app/popout context, selectedStream/mode,
inCall, participants/filteredParticipants/version, selectedParticipant, layout,
active streams, header/chat/sidebar settings and connected activity.

### Click selection flow

```text
handleSelectParticipant(participant, event)
  if native stream predicate and native eligibility helper is truthy:
    selectVoiceChannel(channel.id)
    if no matching non-ended native active stream:
      nativeWatch(parseNativeStreamKey(participant.id),
                  forceMultiple = event.shiftKey)
  if inCall AND mode == native VIDEO:
    toggle selected participant ID (same -> null; different -> participant.id)
```

Captured code:

```js
handleSelectParticipant=(e,t)=>{let{channel:n,selectedParticipant:i,allActiveStreams:l,inCall:a,mode:s}=this.props;(0,eF.Ay)(e)&&(0,B.eo)(n,eb.A,eI.A,eN.A,V.default)[0]&&(j.default.selectVoiceChannel(n.id),0===l.filter(t=>(0,k._z)(t)===e.id&&t.state!==ez.XYD.ENDED).length&&(0,y.A9)((0,k.Iy)(e.id),{forceMultiple:t.shiftKey})),a&&s===ez._Of.VIDEO&&(i?.id===e.id?x.A.selectParticipant(n.id,null):x.A.selectParticipant(n.id,e.id))}
```

Eligibility helper/predicate/import IDs remain open except historical leads;
do not infer what permission it grants or call it for DASS authorization.

**DASS requirement:** intercept a DASS participant before native stream predicate,
voice-channel selection and watch/key-parsing paths—not merely at the final
watch call. Keep native non-DASS actions untouched. Same-channel voice selection
must not be treated as DASS context exit/teardown. DASS selection must not spoof
native stream IDs or write fake participants into native selection stores.

### Fullscreen and other call behavior

`handleFullscreenParticipant` conditionally selects a participant depending on
current fullscreen layout/selected ID, then toggles fullscreen. Whole-call
fullscreen/popout paths remain native responsibilities unless deliberately
adapted. Open-popout handler includes activity handoff and guest/guild routing;
do not reuse that as an individual DASS stream popout without a lifecycle audit.

Controller bottom controls route stage versus ordinary in-call mode; share tray
receives exitFullScreen, channel, disconnect and native idle props. DASS UI must
not hijack ordinary voice disconnect or unrelated call header/chat controls.

## Captured grid versus actual committed selection

E21 captured selectedParticipantPresent false across several fiber ancestors,
with inCall true. E22 source shows VIDEO-mode gating, which may explain absent
selection, but the actual current mode was not measured by those probes.

React's DOM-attached `__reactFiber` may refer to an older alternate after a
render. A selected DevTools element can also be detached. Therefore E21 is
evidence about the **captured props branch**, not an unconditional claim about
the live selected layout. E23 checks element connectivity and compares the
identified class controller's fiber props with `stateNode.props` (class-instance
props), plus VIDEO/VOICE comparisons using already-loaded native constants.
No native identities, stream records or media values are returned.

### Current snapshot result (E23)

Selected element is connected. Already-loaded mode constants are available.
Both controller fiber props and class-instance props report inCall true,
VIDEO mode true, VOICE mode false, selectedParticipantPresent false. Therefore
the observed absence of selection cannot be explained by the VIDEO-mode gate
being false in this snapshot. Actual DOM/tile callback forwarding and subsequent
selection reconciliation remain open. Do not infer a broken native handler or
force selection through a DevTools action.

Next probe reads the mounted tile body and supplied onClick callback as static
function text, plus its original import coordinate through the native grid.
It does not click, dispatch, watch or alter selection.

E24 confirms the generic tile forwards click to the identified controller with
participant/event unchanged, and its supplied callback is that controller body.
No self-stream rejection is visible at that forwarding boundary. Eligibility,
actual event delivery and selection-store reconciliation remain open; inspect
the real selection action rather than force a fake/native selection in DevTools.

E25 resolves controller imports, one require match each: `x=367513` selection
action object, `eF=806931` native participant predicates/types, `B=279250`
eligibility helper, `j=730852` voice selection, `y=401843` watch actions,
`k=652896` native stream-key helpers, `ez=652215` mode/state/layout constants.
These are source coordinates; eligibility and selection implementation still
need audit before defining a DASS projection seam.

E26 confirms `367513.A.selectParticipant(channelId, id)` simply dispatches
`CHANNEL_RTC_SELECT_PARTICIPANT` with those fields through `73153.h`. No hidden
permission/self-stream guard appears in this action method. Store reconciliation
and event delivery remain open. Do not dispatch it with invented DASS stream IDs.
Native popout/return/layout actions are separate methods and layout changes track
native analytics; they are not generic DASS session state APIs.

## Call-root route (`874739`, E27)

Complete mounted body 1,488 chars, one original prefix match (factory 1,742).
Receives channel/call/permission, native participants/filteredParticipants/version,
selectedParticipant, layout, selection/context/fullscreen callbacks, dimensions,
idle/mode/popout, showParticipants (default true) and pending session info.

Routing order:

1. Matching awaitingRemoteSessionInfo channel -> pending-session placeholder.
2. Guild vocal/thread and not inCall -> prejoin component.
3. VOICE mode -> voice-only component (before selected routing).
4. VIDEO mode and no selected participant: empty-call placeholder when no
   participants, otherwise connected grid `526369` through native flex.
5. Selected participant -> separate focused-layout component `A.A` (import
   coordinate not yet extracted), passing selection/fullscreen/context callbacks,
   participant arrays, dimensions, layout/call/channel/idle/popout state.

It also dispatches internal REMEASURE_TARGET when dimensions change, filters
activity participants, and reads native voice-participants-hidden state. It is
not a pure grid/focus switch independent of native call data. A DASS projection
seam must preserve hooks, dimension updates, native paths and explicit separate
participant records. Do not populate native participant stores to trigger it.

E27 confirms current runtime Sentry build ID
`17e01cf978c3c10a5688429a38db59a4926e8982`. This is a public client build hash,
**not** a numeric Discord build number and not proof of historical build 634304.
Record it with subsequent session evidence; numeric patch gates remain unverified.

E28 resolves selected route to `699707.A` (factory 3,424). Header/first 1,100
chars establish real media-engine video component lookup, current-user ID,
selected native participant type/streamId, measured frame size, participant-strip
visibility and height thresholds, native activity hook, layout/idle state and
animation-related state. This is a connected selected-layout component, not a
pure render-callback layout like `511205.A`. Complete tail and filmstrip/media
routing are next; no selected-native GUI acceptance is claimed.

## Focused layout body `699707.A` (E28/E29 complete)

Original full body is collected across overlapping excerpts. It derives video
aspect from activity dimensions, measured selected video size or 16:9 fallback;
adjusts available height for participant strip/activity/layout controls; and
uses native springs/transitions for width/top/strip opacity/selected-item changes.
250 ms initial-state timer has effect cleanup. Animation changes/rest dispatch
REMEASURE_TARGET. Selected video resize updates owned measured-size state.

Selected surface renders actual generic tile `175203.Ay` with `focused: true`,
selected participant, channel, dimensions, controls-bottom positioning,
resize and select/fullscreen/context callbacks. It does **not** set `selected`
on this focused tile. This explains why selected and focused are not synonyms:
stream media `802867.A` uses selected to choose its placeholder branch, while
focused is the enlarged playback presentation.

Optional participant strip uses `163432.Ay` with visible participants, tile width,
selectedParticipantId, callbacks, inCall/popout and paused during animation or
when hidden. Sizing/visibility helper is `163432.i4`. When strip absent, native
helper `947580.Cf(participants, selectedParticipant, currentUserId)` computes
remaining participants for `306852.A`. Native activity and strip helpers remain
to audit. Native current-user/video-component lookups occur before rendering.

**Intended reuse:** preserve the actual host selected layout/geometry/animations
only through an adapter that guards every DASS consumer before native participant
helper/media logic. Do not feed fake STREAM/user shapes into it. If those guards
cannot be established, use audited lower layout primitives instead and report
unsupported focus integration visibly. One DASS projection supplies keys,
selection, readable-video/resize state and strip entries across all views.

Passing a videoComponent prop here does not prove native media ownership is
neutralized: the generic native tile enters its own native engine branches.
The DASS tile branch must execute before those hooks/children. Participant
identity/sorting/title/audio/security consumers also need explicit DASS guards.
Source inspection is not focused-layout or filmstrip GUI acceptance.

## Filmstrip `163432.Ay/i4` and leftover helper (E30)

Complete original `163432` factory, 2,523 chars. Export `Vp` is tile height 112;
base width is `16/9 * 112 + 8`. This is native UI geometry, not a transport size.

### Sizing hook `i4(width, participants, options?)`

Defaults: tileWidth base above, tileMinWidth 124, tileMargin 8, limit 12,
cropSelfVideo false; optional version participates in memoization. A 10-second
timer keyed by participant array refreshes recent-speaking sort and has cleanup.
Owns prior slot-index mapping to stabilize visible media participant positions.

Sort depends on native type: activity sortKey; stream/hidden-stream native user
nickname/name; user speaking/lastSpoke/selfVideo plus native user name. Partitions
with native `806931.Xw`, reserves local user's camera slot through current-user
lookup, fits visible participant count to width/min/limit, and returns visible
participants/tile width. This is **not** a generic callback-only layout hook.

For DASS, guard native sort/title/partition/local-camera helpers before they see
a distinct DASS record. Keep stable DASS keys and explicit ordering. Do not
construct fake native user/stream fields merely to pass these helpers. Native
participant count/voice state remains owned by native call; DASS directory state
and authorization remain separate.

### Renderer `Ay`

Props: participants, participantTileWidth, selectedParticipantId, selection/
double-click/context callbacks, channel, inCall, popoutType, paused default false.
Maps entries to `175203.Ay`, setting selected when IDs match, native
COVER_LANDSCAPE fit and paused, with local self-video special width/flex behavior.
That selected filmstrip tile is distinct from the enlarged `focused: true`
tile. Native selected stream branch can render a placeholder instead of a
second active native video; DASS must define corresponding own media behavior.

This renderer is not safe with DASS entries until local-camera checks and
generic tile consumers are guarded before native hooks. Do not let filmstrip
mounts create duplicate DASS subscriptions or audible playback. Hidden/paused
visual state must not independently stop the owned call's publication.

### Remaining participants `947580.Cf`

Complete original 410 chars. For selected STREAM, looks for another USER entry
with selected stream's user ID and native readable video; for selected USER,
looks for that user's STREAM with native streamId; can append local user's
readable camera. ACTIVITY/null returns empty. This is native camera/stream pairing,
not DASS identity matching. Never infer pairing from display-name equality.
For DASS selection, omit this native path unless a real authenticated identity
binding and guarded consumers are explicitly established.

GUI focus/filmstrip behavior, selected remote sound, fullscreen/popout media
ownership and DM-versus-guild placement still need manual acceptance.

This DOM/fiber technique is investigation-only. The later library must use host
React/webpack adapter inputs and native stores/context where appropriate, not
DOM queries or ad hoc fiber snapshots as production state management.

Open: current mode/committed selection; eligibility/helper effects; actual
click versus double-click behavior; selected-layout/filmstrip exports; call-mode
projection with DASS-only media; remote audio control placement; DM/guild/group-DM
differences; focus/idle and popout ownership continuity.
