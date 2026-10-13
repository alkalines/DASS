# Remote ended view and automatic return

## Observed requirement (E38)

User reports that when a watched broadcaster ends their stream, native Discord
inside Equibop keeps an ended UI. Leaving it open allows the same broadcaster's
returning stream to resume without another click. This is user observation,
not a newly performed remote test; local restrictions prevent reliable remote
GUI/audio acceptance. Source E39–E45 supports the mechanism below.

Local publisher stop is different: user freshly confirmed direct overlay stop,
Go Live card and stream disappearance, controls restored and end cue. Do not
remove a viewer's retained ended surface merely because publication ended.

## Actual ended component

`802867.A` checks native active record ENDED and renders `566331.A` with stream,
width, selected. The latter does not use selected. It renders actual ONYX host
theme, native art/heading/secondary button with three width buckets (<550,
<1000, otherwise). See call-tiles.md for exact export/intl/CSS coordinates.

It is connected, not a safe generic placeholder: native channel lookup, Stage
effect and close button call `401843.Xi`, which dispatches STREAM_CLOSE. For
DASS, reuse actual presentation through a narrow extraction/guarded prop seam
that skips those hooks/actions and supplies owned dismissal. Do not duplicate
complete JSX/CSS, fabricate streams or mount connected player to obtain this UI.
Button click propagation suppression and responsive/accessibility behavior
must be preserved. Heading/button text keys are traced, rendered text not yet
collected; do not invent exact native wording.

## Source-observed native state chain

1. `616356` stores records by native stream key. STREAM_WATCH writes CONNECTING;
   STREAM_CREATE/UPDATE writes ACTIVE/PAUSED and metadata. Getters include ENDED
   records, despite their getAllActiveStreams naming.
2. Selected participant id is retained key v. STREAM_DELETE normally writes
   ENDED, deleting it only if its key differs from v. Unavailable/unauthorized
   have distinct RECONNECTING/FAILED branches. RTC changes ignore ENDED.
3. Explicit STREAM_CLOSE deletes record. Selecting another participant removes
   ENDED records not matching that selection. Connection open/closed/logout
   resets Maps; not every scalar reset is proven. Stage ended component has
   its own close effect, so do not assume all channel types retain equally.
4. On remote voice-state selfStream=true, manager `130553` first tries initial
   DM/Stage auto-watch helper. That requires no active record, so retained ENDED
   does not enter it. Initial helper uses noFocus=true and last-attempt/full gates.
5. With retained ENDED record in same channel, subsequent branch cancels an
   L timer, retrieves advertised stream, rejects absent/full and invokes A9.
   This is the actual source-observed re-watch action, separate from rendering.
6. Native A9 checks remote-session/context conditions, dispatches STREAM_WATCH,
   may invoke guild voice helpers and selects participant unless multi-watch/
   noFocus rules suppress it. Manager starts timeout and may stop other remote
   records. Later create/update changes the record to ACTIVE/PAUSED.

This chain does not establish frame receipt, exact network timing, sound ordering,
grants, transport teardown or successful runtime reconnection on current build.
Neither stream keys nor native owner lookup are suitable DASS authorization.

## Proposed DASS contract

Retain **viewing intent** and native ended presentation, not dead media tracks,
keys or session grants. Intent binds authenticated DASS broadcaster plus room/
call context, never display name or untrusted Discord identity claims. On new
publication, obtain new scoped subscription authorization, respect current
one-viewer backend limit and enter truthful connecting/receiving/error states.
No native Watch/STREAM_WATCH/STREAM_CLOSE/selectParticipant actions for DASS.

Explicit close, select another target, logout, disable or genuine context exit
cancels intent and pending resume. Publication end releases old audio/video and
preserves silent ended view only when still intended. Late directory events,
duplicate announcements and old session callbacks must not revive dismissed
views or attach stale tracks. Source change is not a new broadcaster identity.

Keep one subscription/audio owner across grid/focus/strip/popout and ensure
retained intent never evades authentication, revocation or room grants. Automatic
resume failure must remain visible, not fall back to Discord media. Session/cue
deduplication must distinguish old end, new publication and actual receipt.

## Acceptance still required

Actual native ended view/button wording/keyboard behavior, selected versus
unselected end, DM/group-DM/guild/Stage differences, dismiss before return,
multiple-stream behavior and voice-context exit. DASS tests must additionally
cover new-session authorization/revocation/full capacity, broadcaster identity
collision, delayed old-session callbacks, duplicate return events, logout/
disable/close races, one audio owner and no Discord media/preview leakage.
