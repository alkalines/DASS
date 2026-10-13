# Native stream menus

Status: E05 establishes the sidebar menu wrapper and helper in **original**
factory source. Effective patched behavior and open-menu runtime observation are
not yet established. Coordinates below are capture-specific, not stable anchors.

## Sidebar menu export

Factory `848362` exports `A` (local function `_`) and `T` (hook `C`). This is a
real separately exported menu component, unlike local button owner `vQ`.
It is nevertheless connected to native stream state and actions.

Observed menu props and defaults:

| Prop | Default shown | Responsibility / unresolved detail |
| --- | --- | --- |
| `channel` | None | Real native channel context |
| `currentUser` | None | Native current-user object |
| `activeStreams` | None | Native stream records; calls `.find`/`.reduce`/`.filter` |
| `hideSelfOptions` | `false` | Omits rendered self options, **not their hook execution** |
| `showReportOption` | `false` | Passed to self-action hook |
| `handleGoLive` | None | Passed to self-action hook |
| `onClose` | None | Menu close callback |
| `onSelect` | None | Native menu selection callback |
| `appContext` | `652215.BRT.APP` | Passed to both self-option hooks |
| `disableChangeWindows` | `false` | Passed to self-action hook |
| `onInteraction` | None | Native interaction callback, supplied by sidebar owner |

These are source-observed props, not a full TypeScript or accessibility contract.
Required-versus-optional callback types and provider requirements remain open.

## Connected logic

`T` is the first current-user stream in `activeStreams` (`ownerId` comparison).
No channel filter is shown at this boundary. It executes all three hooks:

1. `C(channel, currentUser, activeStreams)` (export `T`): reads
   `198052.A.getSelectedParticipantId(channel.id)` and the corresponding native
   stream in `616356.A`; reads native users in `287809.default`; memoizes a list
   of non-self native streams and resolves each name using `562153.Ay.getName`.
   If exactly one non-self stream is already selected by owner, returns `[]`.
   This means the sidebar's menu-open condition also depends on native selection,
   not simply whether any other stream exists.
2. `74329.A(T, appContext)` (local `v`): Report Problem item, established in E06.
3. `405916.E({disableChangeWindows, stream: T, showReportOption, handleGoLive,
   minimal: true, appContext})` (local `O`): connected self-action group,
   established by E06 plus the final render tail in E07.

Both option hooks execute even with `hideSelfOptions: true`, or `T: null`.
Do not assume hidden nodes or empty native streams bypass their subscriptions,
effects or native callbacks. Hook order must remain valid for any future seam.

## Rendered shell and actions

- Provider `820284.A`, `section: 652215.JJy.CONTEXT_MENU`.
- Menu `980707.W`: `data-menu-migrated`, `navId: "manage-streams"`, `onSelect`,
  `onClose`, `onInteraction`, localized `aria-label` chosen by self-stream state.
- Group `477782.rX` with one `477782.Dr` item per `C` entry. Native owner IDs
  become item IDs/keys, labels are formatted with resolved native usernames,
  icon/leading accessory is `959988.G`.
- Each non-self stream item's action invokes native `338771.A(stream)`. E04
  established that this reaches `401843.vN`; whether that ends a local watch or
  another native state is not yet traced. Do not describe it as permission to
  stop another publisher or reuse it for DASS subscriptions.
- Unless `hideSelfOptions`, render the `405916.E` result followed by a group
  containing the `74329.A` result.

## Report Problem discrepancy

**Resolved in original source by E06:** `showReportOption` defaults to false and
the sidebar does not override it, but this flag is passed only to `405916.E`.
The outer menu separately and unconditionally calls `74329.A(T, appContext)`
and renders its result whenever `hideSelfOptions` is false. Thus false does
**not** remove all reporting. This is consistent with the user's observation.

`74329.A` returns null for a null stream, but first executes its stream-application
hook and current-user subscription. For a non-null stream it computes native
stream key, video statistics, media session/RTC connection IDs, region and viewer
count, then constructs item `report-stream-problem`. Its action calls optional
third callback and opens lazy reporting modal `292208` with stream/application,
is-streamer flag and analytics data. These are static source names only; probes
never read or print the actual identifiers/statistics.

DASS must omit the **reporting hook as well as the rendered item** on its branch,
not just set `showReportOption: false`. Do not invoke this hook with a DASS stream.

## Self-action hook `405916.E`, E06/E07 contract

Input defaults: `showReportOption: false`, `disableChangeWindows: false`,
`minimal: false`, `appContext: 652215.BRT.APP`; inputs `stream`, `handleGoLive`.
The sidebar supplies `minimal: true`.

Before the null-stream return, it reads native desktop source/last-picked content,
soundshare state, native media-engine capture/audio capabilities, system picker
configuration, and executes quality-setting and report-option hooks. A missing
stream eventually renders a Share Your Screen item (`share-your-screen`) with
`handleGoLive`, but does **not** make the component's preceding logic pure.

Observed native effects and presentation:

- Quality helper reads native preset/resolution/fps, Go Live source, current user,
  guild premium tier, voice channel and analytics location. It builds native
  radio groups `stream-settings-fps` and `stream-settings-resolution`, using
  checked values and entitlement checks. Accepted changes mutate native Go Live
  source with desktop/camera settings; denied changes open lazy modal `826789`.
- Change callback: for source IDs starting `prepicked:`, enumerates native media
  connections and calls `presentDesktopSourcePicker("window")` for STREAM
  contexts; otherwise calls `handleGoLive`. E07 establishes its menu gate below.
  Reusing this callback would bypass DASS ownership.
- Audio callback reads native share settings, flips `soundshareEnabled` via
  `401843.Xd` and updates native Go Live source. It is not a DASS audio toggle.
- Linux system-picker capability and macOS prepicked windows/applications affect
  gating/labels. Do not infer their values on the user's Wayland host from source.
- Native embedded-platform stream-settings submenu uses the quality-helper
  result. Its final composition is established below by E07.

### Final item composition (E07)

| Entry | Native gate | Action/data |
| --- | --- | --- |
| `stream-settings` | Embedded platform | Submenu children: quality helper's radio groups |
| `stream-settings-audio-enable` | Desktop source and soundshare support; screen sources also require screen-soundshare support | Checkbox checked from native soundshare state, calls native audio mutation `Q` |
| `change-windows` | Desktop application capture supported, `disableChangeWindows` false, Linux system picker flag false | Native prepicked connection picker or `handleGoLive`, via `q` |
| `stop-streaming` | Always when a native stream is present | Danger item; native stop `338771.A(stream)` |

`minimal: true` returns `[stop, change, settings, audio]`, with gated entries
null. `minimal: false` returns `[settings, showReportOption ? report : null,
audio, change, stop]`. The outer sidebar menu then adds its **own report group**
after this result; its presence is independent of the inner report flag.

Original source gates may differ from the effective Equibop capture patches.
In particular, Linux `getUseSystemScreensharePicker()` hides native Change here;
the user's observed Change Screen behavior must be checked in the running menu.
Do not blindly import this native gate into DASS: source replacement remains
explicitly consented and host-capability dependent.

These hooks cannot be used wholesale to supply DASS quality/audio/settings.
Reuse audited menu primitives and any lower callback-driven presentation layer,
with DASS state/actions rather than native engine/store mutations or entitlement
checks. Equibop's consent picker remains the host capture/settings boundary.

## Proposed library boundary

Do not mount `848362.A` with fake DASS streams or assume `hideSelfOptions` makes
it pure. Investigate the two lower option hooks and their presentation exports.
Reuse actual host Menu/Group/Item components with DASS-owned action callbacks if
no safe whole-menu seam exists. This composes real native primitives without
copying a connected native menu implementation.

Retain native close/selection, keyboard navigation, popout anchoring and focus
semantics, after auditing their contracts. DASS Stop/Change must own media
teardown/replacement and explicit capture consent. Any native option hook that
calls native watch/stop/start, stores, reporting or stream-key parsing remains
behind a guarded native-only branch.
