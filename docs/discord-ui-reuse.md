# Reuse Discord's screensharing UI, replace its transport

## User requirement and scope

Discord Alternative ScreenShare (DASS) should use **Discord's actual existing
screensharing interface inside Equibop**, backed by DASS capture/publication/
subscription state and transport. This is the requested design direction, not
permission to implement another look-alike player or settings panel.

Preserve the existing share entrypoints, OS source picker, Equibop quality/audio
consent, call layout, sidebar publication card, stream controls and viewing
surfaces wherever their real components can be reused safely. Native Discord
sharing and ordinary Discord voice must continue to work independently.

This document is a new implementation contract and investigation guide. It does
not claim that the complete transport substitution or UI integration already
works. It does not authorize implementation, installation or deployment by itself.

Concrete findings from the follow-up source audit and the next read-only live
probe are recorded in [UI reuse evidence](discord-ui-reuse-evidence.md).

## The preferred approach

Start with the user's proposal: **retain the existing frontend and substitute
the screenshare backend-facing behavior through narrow patches/adapters.**

Investigate the real connected UI owners first. Determine whether a small,
DASS-specific state/action/media seam can preserve their original rendering and
layout. Do not jump directly to rebuilding their JSX out of generic buttons.

Prefer, in order:

1. Keep the original mounted UI owner and give its DASS branch owned inputs and
   callbacks before native stream-specific hooks/actions execute.
2. Expose/reuse an actual internal presentation component through a narrow
   build-scoped extraction seam when its connected owner cannot be separated.
3. Compose audited lower-level **actual host components**, only where the first
   two options are demonstrably unsuitable. Record the reason and remaining UX gap.

Using ordinary host Button/Modal components in a separate DASS panel does not
fulfill this requirement. Nor does a vaguely similar tile rendered alongside
the actual call UI. Development diagnostics may remain separate; they are not
the intended sharing workflow.

## What Equibop actually demonstrates

Equibop changes the capture selection path while leaving Discord's native stream
transport in place. Its custom picker is not evidence of an existing replaceable
Discord backend interface.

The pinned host source is `vendor/Equibop` at
`27219be3566589280c0c933b04753805381d3bc8`. Relevant paths:

| Boundary | Source | Behavior |
| --- | --- | --- |
| Capture request | `src/main/screenShare.ts` | Electron display-media handler enumerates sources and asks the renderer for a choice. On Wayland the OS-selected source is passed with `skipPicker: true`. |
| Consent UI | `src/renderer/components/ScreenSharePicker.tsx` | Actual host React modal selects source/quality/content/audio. |
| Picker completion | `src/renderer/ipcCommands.ts`, `src/main/ipcCommands.ts` | Choice/control data returns over IPC; captured media does not. |
| Linux stream assembly | `src/renderer/patches/screenShareFixes.ts` | Installed `getDisplayMedia` wrapper applies video settings and attaches venmic audio. |
| Audio routing | `src/main/venmic.ts` | Existing in-process native module routes selected PipeWire audio. |

### After the host's Go Live button

1. `goLive()` saves picker settings and reads resolution/FPS.
2. It updates an existing current-user Discord stream connection's video limits,
   if one is found. This lookup does not create that connection.
3. It submits source/settings. The submission callback starts selected venmic
   routing when applicable and resolves the picker promise.
4. It schedules a 100 ms attempt to constrain the connection's video track and
   closes the modal. That timer is not publication acknowledgment.
5. IPC completes the main-process picker request. Electron returns the selected
   source through the display-media callback.
6. Chromium completes the pending capture request. The Linux wrapper finishes
   constructing the stream before returning it to its caller.
7. Discord's waiting source-acquisition code can resume its native share start.

Recorded Discord factory evidence shows the non-embedded share entry awaiting
`getMediaEngine().getDesktopSource(...)` and then calling the native action that
dispatches `STREAM_START`. This is source evidence, not a complete live execution
trace. See [Discord hooks](discord-hooks.md#renderer-evidence).

The reusable idea is **substitute behavior at a boundary while preserving the
frontend**. DASS additionally needs to substitute publication, discovery,
subscription, playback ownership and lifecycle state; Equibop's picker alone
does not perform those substitutions.

## What “block the backend” must mean

For explicitly selected DASS sharing, native Discord stream signaling, media
publication/watch, thumbnail upload and native stream-specific reporting must
not run. Ordinary voice is outside this replacement.

Simply rejecting a Discord HTTP/WebSocket request is not a complete solution:
the frontend may already have started capture, allocated native media state,
started a preview producer, or entered retry/failure handling. A global network
or RTCPeerConnection patch also risks breaking voice and unrelated features.

Find the smallest **scoped behavior boundary** that stops those native effects
and routes the action to DASS instead. Preserve original native behavior on the
non-DASS branch. If one seam cannot cover all effects, document the additional
narrow seams; do not pretend one request-blocking patch is sufficient.

Do not insert fake Discord stream records, users, stream keys or synthetic native
`STREAM_CREATE`, `STREAM_UPDATE`, `STREAM_WATCH` or `STREAM_CLOSE` events to make
the UI appear. This would activate native consumers, not just rendering.
Instead, project authenticated DASS state into the UI adapter without mutating
Discord's native stream stores.

## Required frontend integration

Use one DASS-owned publication/viewing projection across all reused surfaces.
Native Discord stores remain authoritative for genuine Discord/voice state;
DASS records remain authoritative for DASS sessions and tracks.

| Surface | Preserve | Substitute on the DASS branch |
| --- | --- | --- |
| Share entrypoints | Existing location, actual button/icon, tooltip and accessibility | Start callback before native capture/start side effects |
| Capture consent | OS picker and actual Equibop quality/audio UI | Capture lease and cleanup ownership, without native stream-connection mutation |
| Sidebar Go Live card | Actual layout, title/icon/body and action components | DASS metadata, truthful publication status, stop/change callbacks |
| Call grid/focus/strip | Existing slots/layout and actual frame/overlay components | DASS entries, compatible selection/focus data and DASS media ownership |
| LIVE/quality | Actual badges/text/formatters where audited | DASS status and correctly mapped quality values, without native upsell effects |
| Stream menus | Actual menu/button/tooltip components and interaction behavior | DASS stop/change/quality/audio/watch callbacks; omit native reporting hooks |
| Remote playback | Existing presentation/layout and audited media surface | Authorized DASS subscription and received tracks, independent audio gain/mute |
| Ended/resuming view | Actual native presentation through a guarded seam | DASS retained viewing intent, dismissal and newly authorized resubscription |

Opening a picker is not being live. Capturing is not successful publication.
Connecting is not receiving frames. Reflect these distinctions in the shared
projection rather than forcing a native LIVE flag.

## Existing research to reuse, not redo blindly

The [component catalog](ui-streaming-reverse-engineering/component-catalog.md)
identifies actual Share buttons, animated icons, tile frame, callback-based grid,
LIVE/text badges, sidebar title/icon components and audio controls. It also lists
connected owners whose native effects need a guarded seam.

Read the relevant [sidebar card](ui-streaming-reverse-engineering/sidebar-card.md),
[call tile](ui-streaming-reverse-engineering/call-tiles.md),
[ended/resuming](ui-streaming-reverse-engineering/ended-and-resuming.md) and
[library handoff](ui-streaming-reverse-engineering/library-handoff.md) contracts.
“Connected owner” means **investigate and adapt**, not “abandon the real UI and
create a replacement panel.”

The historical Discord share trace records stable build `634304` and hash
`17e01cf978c3c10a5688429a38db59a4926e8982`. The later component catalog records
that hash but leaves its numeric build unconfirmed. Check the running client;
do not merge those evidence labels into an invented compatibility guarantee.
Numeric module IDs and mangled export names are research coordinates, never
production lookup anchors.

The [capture bridge](capture-bridge.md) documents existing staged host work.
Review it before proposing another capture pipeline. A plugin webpack patch
cannot automatically rewrite Equibop's separately bundled renderer. Necessary
host changes belong in the explicit staging/build adapter, not incidental edits
to the pinned vendor submodule.

## Investigation and implementation gates

1. **Record the client:** running Discord build/hash, Equibop/Equicord pins and
   whether the staged capture bridge is actually installed.
2. **Trace real execution:** pause in loaded code, not an extracted unused
   factory. Follow Go Live completion, source-acquisition continuation, native
   action, signaling/media ownership, preview activation and UI store consumers.
   Record ordering and cancellation. Source searches alone cannot prove ordering.
3. **Map each UI owner:** actual component/export, inputs/providers, transitive
   native effects, slot/layout integration and proposed minimal DASS seam.
4. **Prove the substitution boundary:** DASS starts through existing entrypoints
   and capture consent without any native stream or preview producer starting.
   Retain native Discord sharing as a separate explicit path.
5. **Integrate real surfaces incrementally:** publication button/card first,
   then grid/focus/strip, controls, authorized watch/playback and ended state.
   A primitive sandbox is research only, not acceptance of the complete UI.
6. **Validate both branches:** cancellation, stop/source change/source end,
   disable/logout/context exit, repeated teardown, remote audio, popout and
   reconnection. Test ordinary Discord voice and native sharing for regressions.

Acceptance requires real clients: actual host components mounted in the intended
locations, consistent state across surfaces, no DASS media/previews reaching
Discord, no native DASS stream-start/watch actions, and deterministic track/audio
cleanup. Passing build/unit checks alone does not establish these properties.

## Guardrails for future agents

- Do not steer this into another independent normal-workflow DASS panel/player.
- Do not copy complete Discord JSX/CSS, clone DOM, or use fiber probes in production.
- Do not equate lower-level generic component reuse with the requested native UX.
- Do not assume overriding an onClick removes earlier hooks/effects.
- Do not globally replace native stores, network calls, peer connections or voice.
- Do not silently fall back to Discord sharing, media or thumbnail uploads.
- Use host React and reviewed structural/intl lookup signatures; fail visibly on
  mismatches instead of guessing. Keep private hooks in the adapter.
- Preserve explicit optional audio consent; never implicitly capture a microphone.
- Introduce no additional client process, proxy, encoder or audio daemon.
- If the preferred narrow frontend/transport seam is impossible, show the concrete
  source/effect blocker and ask before substituting a materially different UX.

**Success means the real Discord/Equibop interface operating on DASS-owned
screensharing behavior, not a convincing imitation of that interface.**
