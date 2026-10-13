# Component reuse catalog

This is the primary lookup for the later Discord Alternative ScreenShare (DASS)
library agent. **Source-reviewed is not runtime-accepted.** IDs/exports are
coordinates from this session, not production discovery signatures. Runtime
Sentry build hash: `17e01cf978c3c10a5688429a38db59a4926e8982`; numeric Discord
build remains unconfirmed. Equibop baseline is user-confirmed unchanged.

## Prefer actual lower host exports

| Surface | Source coordinate | Contract / remaining condition | Evidence |
| --- | --- | --- | --- |
| Specialized Share | `958449.h` | Supplied active/permission/click/popout props; animated icon; forwarded props override defaults | E08–E10 |
| Split/base overlay button | `204651.l/A` | Native theme/mode reads, tooltip/focus/idle; narrow-width caret behavior | E08–E10 |
| Animated share icon | `416696.c` | Native host asset/animation hook; not sound or media | E10 |
| Idle wrapper/hook | `447404.A/o` | Real call context `461782.k3`; tokens and cleanup | E11 |
| Menu idle holder | `246356.A` | Acquires popup holder while mounted, releases on cleanup | E11 |
| Sidebar card body | local `463481.nv` | Needs narrow extraction seam; supplied metadata/quality plus audited title/icon children | E12–E14 |
| Card title helper | `277680.A` | Plain title/fallback/punctuation removal; no native stream lookup | E14 |
| Card title icon | `118277.A` | Real native mask/color/initial/video icon; validate/omit optional image URL | E14 |
| Card title text | `485599.A` | Native typography wrapper | E14 |
| Card action button | `42473.A` | Supplied callbacks/icon/tooltip/accessibility; prefer standard tooltip branch | E17–E18 |
| Call tile frame | `272812.A` | Ref/class/style/children/noBorder; omit unbound native identity attribute | E18 |
| Callback-based grid layout | `511205.A` | Width-aware render callbacks, stable key extractor, native virtualization | E21 |
| LIVE badge | `402216.Ay` | Pure text/shape/look/size presentation, no stream action | E19 |
| Text/quality badge primitive | `812993.Lp` | Native typography/style/shape; no premium telemetry in body | E20–E21 |
| Quality formatters | `650338.ME/Bs` | Plain resolution/FPS formatting; correct native enum/input mapping required | E19 |
| Speaker widget | `20504.A` | Callback-driven but needs hover-timeout cleanup adaptation | E28 |
| Vertical MediaBar | `122641.A` | Needs owner-window drag cleanup adaptation before safe popout reuse | E29–E30 |
| Volume conversion | `792251.M/w` (re-export `824744`) | Exact inverse curve, baseline 100; DASS gain/clamp policy explicit | E29 |
| Sound cue API | `400492.Ak` | Current soundpack/Streamer Mode gate; caller checks notification cue prefs; ordinary one-shot only, pending-stop caveats | E33–E36 |

Primitive child contracts/provider requirements still need full type/a11y
verification in the library. Do not claim React props are type-verified merely
because they appeared in a fiber snapshot.

## Connected owners: do not mount with fake native streams/users

| Owner | Why it requires an explicit guarded seam |
| --- | --- |
| Sidebar share local `157667.vQ/v5` | Native streams/permission/activity/analytics/actions/menu |
| Overlay share local `105225.eN` | Native start/stop/menu, coach-mark, capability/analytics |
| Menu `848362.A` | Native selection/user/stream hooks/actions; report hook executes independently |
| Self options `405916.E` | Native quality/audio/source mutation, entitlements and reporting |
| Reporting `74329.A` | Native stats/session IDs/report modal; omit hook, not just visible item |
| Card connected owner / local `t6` | Game/community fetch hooks, consent, native actions/account-link popovers |
| Generic tile `175203.Ay` | Native user/voice/video/security/effects/media and footer hooks |
| Stream player `802867.A` | Auto-watch, native engine video/preview, watch actions |
| Stream overlay `802867.D` | Native active-stream lookup; health warning/LIVE visibility |
| Ended view `566331.A` | Actual themed art/heading/button; native channel/Stage effect and stop-watch callback need guarded extraction (E40) |
| Quality wrapper `872363.A` | Native quality/premium; child tracks upsell even when clickable upsell disabled |
| Health warning `275731.A` | Native participant AV-error provider; **not** the computer/name label |
| Footer local `175203.ew` | Native decoration/activity/video/context-menu/security/popout state |
| Grid `526369` | Native participants/permissions/activity/clip/impression logic |
| Root/focus/filmstrip `874739/699707/163432` | Mixed native participant consumers; guard all DASS paths before native helpers/media |
| Leftover helper `947580.Cf` | Native camera/stream pairing by user identity |
| Speaker controller `821747.A` | Native volume/mute store and analytics actions |
| Native start/stop/select `471993/338771/367513` | Native transport/state actions, not DASS callback APIs |

Some connected modules may still supply useful actual presentation layers, but
only after narrow extraction/guarding. A top-level prop override cannot remove
preceding hooks/effects or unsafe transitive children.

## Lifecycle fixes and unresolved evidence

- Speaker hover timeout: no unmount cleanup in complete source.
- MediaBar drag listeners: unmount uses global window, gesture uses currentWindow;
  pin actual gesture owner and remove listeners on end/unmount/window change.
- Sound object: normal end cleanup confirmed; pending-stop cancellation not guaranteed; avoid completion callback/timer path.
- Native selected GUI entry: VIDEO/inCall confirmed, no selected participant;
  selection dispatch identified, event delivery/reconciliation unverified.
- Remote speaker/audio and popout handoff: unverified; local preview insufficient.
- Remote ended/resume: user-observed; source chain E40–E45 covers presentation, selected-key retention and re-watch action. Runtime reconnection/teardown/authorization remain unverified; see ended-and-resuming.md.
- DM/group-DM/guild comparisons and Change/Cancel/Stop timing: pending manual matrix.
- Numeric Discord build/export signatures and full type contracts: pending.

See [library handoff](library-handoff.md) for integration rules and acceptance.
