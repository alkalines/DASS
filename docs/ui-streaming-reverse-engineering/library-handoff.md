# Handoff for the later UI library and plugin agent

The requested implementation is **not part of this investigation**. Keep DASS
plugin/backend source unchanged here. Read the catalog, behavior inventory,
evidence labels and per-surface contracts before implementing. Historical DASS
patches are leads, not the target design or new interoperability evidence.

## Intended separation

1. **Versioned native adapter:** discover actual exports, validate uniqueness,
   isolate private webpack/host hooks and minimal extraction/lifecycle patches.
2. **Reusable presentation:** render actual audited host Share/Button/Menu/
   Tooltip/Frame/Grid/Badge/Icon/Speaker components with host React, not copied
   JSX, DOM cloning or screenshot-derived CSS. Own only necessary adaptation.
3. **DASS call projection:** one bounded set of DASS publication/viewing records,
   stable DASS-only keys, selection, capture/connecting/published/receiving/error
   state, quality and audio flags shared by grid/focus/strip/controls/card.
4. **Plugin controllers:** own authorization, capture lease, publication,
   subscriptions, tracks/gain, cleanup and cue transitions. No native fake
   streams/IDs/users/events or silent Discord fallback.

Avoid a second independent call player or normal-workflow DASS panel. Preserve
existing native share entrypoints and ordinary voice. The native slot/primitive
reuse strategy is not permission to globally patch peer connections or native
media engine ownership.

## Host capture boundary

Preserve the installed Equibop OS/picker/quality/audio consent path and call its
installed capture function, not an unpatched saved copy or parallel helper.
Pinned host sources are documented in behavior.md. A plugin webpack patch does
not automatically patch Equibop's separately bundled renderer. Any needed host
seam must be identified explicitly and pinned, with native input/venmic cleanup.

Never implicit microphone capture; share audio optional. DASS must own teardown
without dispatching fake STREAM_CLOSE/UPDATE to obtain native virtmic behavior.
No new client executable/process/proxy/encoder/decoder/audio daemon. OS portals,
PipeWire and existing Electron/venmic are prerequisites, not DASS helper services.

## State/action rules

- Intercept DASS share/start/stop/change/watch before native analytics/transport
  actions; guard selection before native voice selection/key parsing/watch.
- Card/button/LIVE/menus use the same owned publication projection. Opening a
  picker is not successful publication or receipt. Visible capture and backend
  status must remain distinguishable and truthful.
- Selected versus focused are distinct; native focused tile does not set selected.
  Guard native participant sort/title/camera/media consumers in all layouts.
- Selection/watch replacement obey authenticated room grants and current
  one-viewer bound; DASS display names cannot establish Discord identities.
- Retain remote viewing intent/ended presentation when broadcaster stops (E38),
  not old tracks/session grants. Returning same authenticated broadcaster in the
  same context requires a new authorized subscription; dismiss/context exit
    cancels intent. Trace native ended primitive before implementing presentation.
- Mute/volume independent of ordinary voice, local preview silent, one audible
  received-stream owner across views/popouts. Tile unmount is not session stop.
- Stop/disable/logout/source end/context exit idempotently clean resources and
  cancel pending consent/callbacks. Same-context VOICE_CHANNEL_SELECT is not exit.
- Report Problem omitted by bypassing native reporting hooks, not just hiding
  its menu item or setting showReportOption false.
- Nitro/premium adornments low priority; never reuse native entitlement/upsell
  telemetry to enforce DASS quality. Do not label TLS/DTLS as native E2EE verified.
- Cue playback uses owned transition deduplication and audited host preferences/
  API, not native stream events. Do not play receipt/success cues prematurely.

## Discovery and integration safety

Production lookups use reviewed stable code/intl/structural signatures and
candidate counts, not the catalog's numeric IDs/minified names/hashed classes.
Import host React/hooks and existing Equicord primitives. Preserve existing
patches and normal native paths; grouped narrow changes should fail atomically.
Mismatch must visibly disable the affected DASS integration, not guess or leak
media through native fallback. Do not download executable plugin code at runtime.

DOM/fiber probes are **research-only**. Do not use DOM queries/fiber crawling for
production state or component mounting. Prefer explicit host React props/hooks,
native stores only for genuine native state, and separate DASS owned state.
Wrap injected components with appropriate host ErrorBoundary; do not silence
unsupported discovery as if the feature loaded successfully.

## Validation gates

Unit/source tests: lookup ambiguity/mismatch, patch atomicity, callback routing,
no native DASS watch/start/stop/report paths, projection consistency, pending
consent race/teardown, true context exit versus reselection, selected/focused
semantics, stable virtualized keys, audio conversion/mute/clamp/ownership,
hover/drag/window cleanup, cue deduplication and preference gates.

Manual host acceptance: picker cancel/change/replace, both entrypoints and menus,
card/title/icon/quality/stop, grid/focus/strip, keyboard/hover/idle, remote audio,
source end, disable/logout/real context exit, fullscreen/popout handoff and
DM/group-DM/guild comparison. Verify no DASS frames/previews/media are sent to
Discord and no native transport starts for DASS. Build/unit success is not GUI
acceptance or proof of network isolation.

Keep separate supported pins/running build metadata, exact commands and known
limitations. Bun-only client tooling and Docker-only Rust policy remain in force;
do not advance vendor pins, deploy, inject or spawn agents without authorization.
Do not promise production readiness, E2EE or bypass of OS/firewall restrictions.
