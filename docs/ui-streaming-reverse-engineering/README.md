# Native screensharing UI research

Discord Alternative ScreenShare (DASS) needs to reuse Discord's actual React
components while replacing screenshare transport. This directory is a fresh,
evidence-led investigation for a later component library and plugin integration.
It is not an implementation or a claim of runtime compatibility.

## Status and scope

Started 2026-10-12. The user is investigating Equibop with DASS disabled and can
publish a native stream; remote viewing is unreliable under their local network
restrictions. First runtime evidence is recorded in [the evidence log](evidence.md):
DM voice call on CachyOS (Arch Linux), Wayland. The user confirms the Equibop
version is unchanged since the project's beginning; retain the existing baseline
without requesting it again. The running Discord build and Equicord revision
remain unconfirmed for this capture.

The deliverable is component contracts, ownership boundaries, behavior and
acceptance cases, not cloned JSX, screenshots turned into CSS, synthetic native
stream records, or a second independent player UI. Plugin/backend code stays
unchanged during this investigation. Existing implementation is not the target
specification.

Read:

- [Component catalog](component-catalog.md): primary actual-export reuse/safety map.
- [Ended and resuming](ended-and-resuming.md): retained remote ended UI and automatic re-watch boundaries.
- [Library handoff](library-handoff.md): later integration responsibilities and gates.
- [Interactive sandbox](interactive-sandbox.md): user-requested temporary component experiments, separate from read-only probes.
- [Behavior inventory](behavior.md): the user's baseline and required transitions.
- [Research method](research.md): probes, evidence rules and library handoff gates.
- [Evidence log](evidence.md): runtime findings and remaining questions.
- [Sidebar controls](sidebar-controls.md): connected owners and reuse boundaries.
- [Stream menus](stream-menus.md): menu props, native hook dependencies and omissions.
- [Overlay controls](overlay-controls.md): Share/split-button/base-button/idle contracts.
- [Sidebar card](sidebar-card.md): metadata body versus connected card owner.
- [Call tiles](call-tiles.md): LIVE/quality/identity overlays versus media owners.
- [Selection and layout](selection-and-layout.md): controller interception and current-state caveats.
- [Stream audio](stream-audio.md): selected remote-only speaker controller and DASS ownership.
- [Sounds and transitions](sounds-and-transitions.md): cue research and manual acceptance matrix.
- `01-selected-component.js`: first bounded, read-only DevTools probe.
- `02-sidebar-owners.js`: two sidebar owners and static factory coordinates.
- `03-sidebar-imports.js`: bounded import coordinates; no module execution.
- `04-sidebar-menu.js`: bounded menu and native action source excerpts.
- `05-sidebar-original-source.js`: proxy-aware original menu/start source.
- `06-menu-options.js`: original source for the menu's two option hooks.
- `07-overlay-and-menu-tail.js`: selected overlay ancestry and missing menu tail.
- `08-overlay-primitives.js`: bounded candidate component sources and coordinates.
- `09-overlay-owner.js`: Share imports and the connected overlay action owner.
- `10-overlay-dependencies.js`: presentation/icon source and owner import map.
- `11-active-sidebar-card.js`: active card ancestry and idle/popout wrapper source.
- `12-sidebar-card-boundaries.js`: metadata body, bounded owner excerpts and coordinates.
- `13-sidebar-card-actions.js`: selected stop-action owner and metadata imports.
- `14-card-action-ancestry.js`: broader stop-button ancestry and title/icon helpers.
- `15-card-action-source.js`: bounded static action declaration windows.
- `16-call-tile-and-card-tail.js`: LIVE-badge ancestry and card-action continuation.
- `17-tile-boundaries.js`: prioritized overlay/frame/owner sources and card button.
- `18-tile-quality-and-primitives.js`: quality source, card-button tail, tile imports/frame candidates.
- `19-stream-media-and-live.js`: stream-tile tail, quality helpers and LIVE exports.
- `20-focused-layout.js`: selected self-stream layout ancestry and name/badge dependencies.
- `21-grid-routing.js`: bounded grid/layout sources and allowlisted layout flags.
- `22-selection-controller.js`: selection-handler excerpts from call ancestors.
- `23-current-call-flags.js`: connected-element and class-instance layout comparison.
- `24-tile-click-body.js`: mounted tile body/click callback and original import coordinate.
- `25-footer-and-selection-imports.js`: footer structural windows and controller imports.
- `26-footer-render-and-selection.js`: footer render/audio boundary and selection action source.
- `27-call-route-and-speaker.js`: call-root route and selected-stream speaker source coordinates.
- `28-speaker-and-focused-imports.js`: lower speaker/conversion and focused-layout header.
- `29-volume-drag-and-focus.js`: conversion formula, slider lifecycle and focused tail.
- `30-filmstrip-and-slider-tail.js`: filmstrip/leftover helpers and slider completion.
- `31-stream-sound-inventory.js`: bounded static stream-cue candidate inventory.
- `32-stream-cue-selector.js`: lowercase cue callsites and selector context.
- `33-stream-cue-playback.js`: selector helper binding and bounded playback source.
- `34-sound-api-and-preferences.js`: playback export and preference-store coordinate.
- `35-sound-guards-and-lifecycle.js`: preference guards and sound-object lifecycle excerpts.
- `36-sound-object-complete.js`: final bounded sound-object source read.
- `37-ended-stream-branch.js`: native ended-placeholder branch and import coordinates.
- `38-ended-component.js`: ended-placeholder export binding and bounded original source.
- `39-ended-close-action.js`: native ended-view dismissal boundary source.
- `40-retained-stream-store.js`: active-stream end/close/create handler coordinates.
- `41-retained-stream-return.js`: retained-key assignments and create/watch source.
- `42-stream-return-connection.js`: native returning-stream connection handlers and reset tail.
- `43-return-watch-guards.js`: preceding return helper and native Watch guards.
- `44-sandbox-preflight.js`: cached component/root availability and idle-context source; mounts nothing.
- `45-share-sandbox.js`: explicitly interactive, removable native presentation preview with mock-owned transitions; no media or cues.
- `46-sidebar-button-sandbox.js`: actual sidebar Button/icon/native selected classes, isolated mock callbacks; not the connected sidebar owner.
- `47-call-tile-slot.js`: user-selected call-area geometry and native frame contract; read-only preflight for an in-call mock tile.
- `48-in-call-tile-sandbox.js`: isolated actual frame/LIVE overlay inside the selected call strip; mock local view/end/return/source, no native participant/media.
- `49-call-render-boundary.js`: read-only mounted controller/native grid boundary inspection for user-requested actual call-layout mock integration.
- `50-call-content-and-renderer.js`: read-only renderContent/connected-grid source and scoped renderer-override capability check.
- `51-call-grid-adapter-preflight.js`: read-only native-root source and idle-call/media-shape guards for a potential actual-tree grid adapter.
- `52-native-call-grid-sandbox.js`: explicitly mutating, reversible instance-only call-content adapter; actual native grid with real tiles plus mock callback, no fake native participant/media.
- `53-stream-card-presentation.js`: read-only loaded tile render/dependency inspection for full native stream-presentation adaptation, beyond frame-only mock.
- `54-original-stream-footer.js`: original private footer/control-helper source; avoids mixing mounted and original alias maps.
- `55-original-card-render.js`: consistent original outer-card/overlay source and width-helper audit for presentation-only extraction.
- `56-source-native-stream-card.js`: interactive source-derived native card/footer presentation for the updated grid test; connected media/actions bypassed, not unmodified native component mounting.
- `57-current-card-source.js`: read-only role-based discovery of current native render/footer after alias-map mismatch; no broad identifier renaming.
- `58-native-tile-menu-and-click.js`: read-only native menu API/clickable/context/fullscreen boundary inspection after mock behavior feedback.
- `59-stream-menu-icons.js`: read-only original tile-menu/self-action icon references; no connected menu mounting.
- `60-stream-menu-icon-tail.js`: bounded remaining context-menu/popout icon source and cached stop/change icon availability.
- `61-focused-layout-and-ended-source.js`: read-only current focused-layout/ended-artwork source for replacing mock solo/text with native presentation seams.
- `62-filmstrip-focus-boundary.js`: read-only current filmstrip/sizing/strip-control source to guard mock focus consumers and preserve genuine participants.
- `63-native-focus-and-ended-sandbox.js`: interactive scoped native focused geometry/real-only filmstrip/native ended artwork addon; requires updated 52/56, no native selection/media actions.

## Evidence labels

| Label | Meaning |
| --- | --- |
| User observation | The user's description of their native Equibop workflow; not yet independently traced. |
| Pinned source | A finding in the repository's pinned upstream source; not proof the running app uses that revision. |
| Historical lead | Earlier research; must be revalidated for this investigation/build. |
| Runtime evidence | A numbered DevTools result or explicit manual observation tied to build and UI state. |
| Proposed contract | Intended library/plugin behavior; not evidence of native internals. |
| Open | Missing or inconclusive evidence. |

## Revision baseline

Repository pins, not yet confirmed running versions:

- Equibop: `27219be3566589280c0c933b04753805381d3bc8`.
- Equicord: `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`.
- Historical Discord research: build `634304`; do not assume today's app matches.

Historical leads live in [the presentation audit](../native-presentation-audit.md),
[the previous handoff](../native-screenshare-handoff.md) and
[Discord hooks](../discord-hooks.md). They must not be silently promoted to new
runtime evidence. Module IDs and mangled names are research coordinates, never
portable production lookup signatures.

## Completion criteria

For every requested surface, identify the real export or narrow extraction
boundary, caller, input props, subscribed stores, callback effects, CSS/icon
dependencies and cleanup requirements. State whether it is safe to render with
DASS-owned data, needs a narrow host seam, or must not be reused. Document source
and runtime evidence, DM versus guild differences, and unsupported states.

The documentation is **in progress** until those contracts are established.
Self-preview alone cannot establish remote watch, audio or transport safety.
