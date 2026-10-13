# Runtime evidence log

## E01: idle sidebar share button ancestry

User-supplied DevTools result, 2026-10-12, probe `01-selected-component`.
Context: DM voice call, CachyOS (Arch Linux), Wayland, DASS disabled. The requested
state was idle/no stream; the JSON itself does not expose stream state. Equibop
version is user-confirmed unchanged since project inception. Discord build and
running Equicord revision are not yet confirmed. Selected element: `BUTTON`.
Webpack factories available; 13 fibers visited, ten function rows returned,
output budget not clipped. The ten-row cap limits ancestry coverage.

Relevant returned chain, from the selected button upward:

| Fiber depth | Runtime function | Returned prop names / evidence |
| --- | --- | --- |
| 1 | `O` | `offset`, `children`; source prefix destructures focus targets/rings. |
| 2 | `I` | Button props including `buttonRef`, `aria-pressed`, `onClick`, `disabled`, `onContextMenu`, focus/hover and class props; source begins with look/color/size defaults. |
| 3 | `E` | `text`, `children`; source includes tooltip position/anchor/spacing options. |
| 4 | `N` | Popout props including `renderPopout`, `shouldShow`, open/close handlers; class has DOM/layer/popout refs. |
| 5 | `S` | `targetElementRef`, `renderPopout`, `position`, `align`, `animation`, `children`; wrapper class forwards popout options. |
| 6 | `vQ` | `channel`, `canGoLive`, `enableActivities`, `disabled`; function length 1,879. |
| 8 | `v5` | `channel`, `canGoLive`; function length 751; reads `getCurrentUserActiveStream()`. |
| 10–12 | `_`, `N`, `S` | Text/layout wrapper then another popout/wrapper pair. |

Exact returned owner prefixes:

```js
function vQ(e){let t,{channel:n,canGoLive:i,enableActivities:r,disabled:a}=e,s=em.useRef(null),{parentAnalyticsLocation:l,analyticsLocations:o}=(0,lv.Ay)(),d=(0,ef.bG)([eH.default],()=>eH.default.getCurrentUser()),c=(0,e
```

```js
function v5(e){let{channel:t,canGoLive:n}=e,{reachedLimit:i}=(0,vA.A)(t),r=(0,vd.qT)(t.id),a=(0,vd.Kl)(t.id),s=(0,ef.bG)([cE.A],()=>cE.A.getCurrentUserActiveStream()),l=(0,DU.A)(t.guild_id??K.dJq,t.id),o=(0,Dx.A)(t.id),d
```

### Interpretation and limits

**Runtime evidence:** the selected sidebar control is not merely a standalone
Button. It has tooltip/popout wrappers and at least two connected owners. `vQ`
reads current-user state and analytics context; `v5` reads native stream state.
Neither is established as a pure DASS-ready component.

**Open:** complete owner sources, imports/exports, callbacks, exact permission and
stream-active branching, menu component and whether the overlay shares these
owners. The prefixes do not establish callback safety, types, default values,
all subscriptions or effect behavior. Minified names are capture-specific
coordinates, not lookup recommendations.

**Next:** probe `02-sidebar-owners` with the same selected button, returning the
two complete bounded functions and matching static factory coordinates. This
does not execute factories or return native store data.

## E02: sidebar owner functions

User-supplied result, same context as E01. Both sources were returned complete,
not truncated. Each has one matching factory, `157667`, length 1,275,513, with
`containsCompleteFunction: true`. This establishes containment, not exportability.

`vQ` (1,879 characters):

```js
function vQ(e){let t,{channel:n,canGoLive:i,enableActivities:r,disabled:a}=e,s=em.useRef(null),{parentAnalyticsLocation:l,analyticsLocations:o}=(0,lv.Ay)(),d=(0,ef.bG)([eH.default],()=>eH.default.getCurrentUser()),c=(0,ef.yK)([cE.A],()=>cE.A.getAllActiveStreams()),u=(0,vh.A)(n),_=n.getGuildId(),E=(0,ef.cf)([nv.Ay],()=>null!=nv.Ay.getSelfEmbeddedActivityForChannel(n.id)),A=(0,D5.Ay)(n),h=!dh.k.useConfig({location:"RTCConnection"}).videoEnabled,f=em.useCallback(()=>{(0,vT.A)(_,n.id,o)},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id),p=(0,vf.T)(n,d,c);t=null==I?i?f:vp.A:()=>(0,D0.A)(I);let T=null!=I||p.length>0,m=h?tv.intl.string(tv.t.GFr0GR):u?tv.intl.string(tv.t.fjBNo1):tv.intl.string(tv.t.uQn9B8),g=E||r||A,S=null!=I,{Component:N,events:C,play:O}=(0,DC.c)(S?"disable":"enable");em.useEffect(()=>()=>O(),[O,S]);let R=h?(0,w.jsx)(S5.i,{size:"md",color:"currentColor",className:tf()(va.iA,{[va.ij]:!g})}):(0,w.jsx)(N,{size:"md",color:"currentColor",className:tf()(va.iA,{[va.ij]:!g})});return(0,w.jsx)(al.Y,{targetElementRef:s,renderPopout:e=>{let{closePopout:t}=e;return(0,w.jsx)(vf.A,{channel:n,currentUser:d,activeStreams:c,onClose:t,handleGoLive:i?f:vp.A,onInteraction:(0,Dj.s)("ManageStreamsMenu",l,{entrypoint:vj.GK.OTHER_BUTTON})})},position:"top",align:"center",animation:al.Y.Animation.FADE,children:e=>{let{onClick:n,onMouseEnter:i,...r}=e;return(0,w.jsx)(rO.m,{text:m,children:(0,w.jsx)(si.$n,{"data-migration-pending":!0,buttonRef:s,size:si.$n.Sizes.MEDIUM,"aria-pressed":null!=I,onClick:e=>{(0,DH.X)(l,DH.O.STREAM,null==I),T?n(e):t()},disabled:!u||a,className:tf()(va.x6,va.Sq,{[va.rK]:null!=I,[va.r9]:!u||a}),...T?r:null,onMouseEnter:()=>{i?.(),C.onMouseEnter()},onMouseLeave:()=>{C.onMouseLeave()},innerClassName:va.bk,wrapperClassName:va.x6,focusProps:vK,children:g?R:(0,w.jsxs)(lx.A,{align:lx.A.Align.CENTER,children:[R,tv.intl.string(tv.t["r0/+v7"])]})})})}})}
```

`v5` (751 characters):

```js
function v5(e){let{channel:t,canGoLive:n}=e,{reachedLimit:i}=(0,vA.A)(t),r=(0,vd.qT)(t.id),a=(0,vd.Kl)(t.id),s=(0,ef.bG)([cE.A],()=>cE.A.getCurrentUserActiveStream()),l=(0,DU.A)(t.guild_id??K.dJq,t.id),o=(0,Dx.A)(t.id),d=(0,ef.bG)([nx.A,es.default],()=>nx.A.getVoiceState(t.guild_id,es.default.getId()));if(t.isGuildStageVoice()&&(null==d||d.suppress||!n||!(0,vd.Bw)(t.guild_id)))return null;let c=(t.isGuildVoice()||o)&&l;return(0,w.jsxs)("div",{className:va.uu,children:[(0,w.jsx)(vZ,{channel:t,enableActivities:c,disabled:!r&&i}),(0,w.jsx)(vQ,{channel:t,canGoLive:n,enableActivities:c,disabled:t.isGuildStageVoice()&&(a&&null==s||!r&&i)}),c&&(0,w.jsx)(vq,{channel:t,enableActivities:l}),(0,D5.Ay)(t)?(0,w.jsx)(vs,{channel:t,focusProps:vK}):null]})}
```

Interpretation and open questions: [sidebar control contract](sidebar-controls.md).

## E03: sidebar imports and owner references

User-supplied result from `03-sidebar-imports`, same ongoing renderer session.
Each listed alias has exactly one matching numeric require declaration in
factory `157667`, all through require variable `n`:

| Owner alias | Imported module | Observed use in E02 |
| --- | --- | --- |
| `vf` | `848362` | Menu export `A`, stream-list helper `T` |
| `vT` | `471993` | Share-start callback `A` |
| `vp` | `702904` | Alternative callback `A` when `canGoLive` is false |
| `D0` | `338771` | Stop callback `A` |
| `DC` | `416696` | Animated icon hook `c` |
| `DH` | `384059` | Button interaction call `X`, category `O.STREAM` |
| `Dj` | `480890` | Menu interaction callback factory `s` |
| `vh` | `704877` | Channel capability hook `A` |
| `al` | `922016` | Popout `Y` |
| `rO` | `866665` | Tooltip `m` |
| `si` | `862482` | Button `$n` |
| `lx` | `235986` | Layout `A` |
| `va` | `187529` | CSS classes |
| `tv` | `660183` | Intl API/table |

`vQ` occurs twice, at offsets 721119 (definition) and 727714 (`v5`'s render).
There is no direct export reference among these matches. This supports a local
owner seam rather than assuming a discoverable standalone `vQ` export.

`v5` has a definition at 727180 and a render call at 730330 (surrounding parent's
identity remains open). The third lexical match at 1228715 is `a2.v5`, an
unrelated imported object's property. **Do not treat lexical name matches as
symbol references without inspecting context.**

Next: static factory `848362` for the menu/helper, plus bounded start/stop source
from `471993`/`338771`. No module invocation or native stream action is needed.

## E04: menu source opacity and native action evidence

User-supplied `04-sidebar-menu` result:

- `848362`: `Function.prototype.toString.call(factory)` returns
  `function () { [native code] }` (29 characters). This is opaque output, **not
  a complete readable menu source**, despite the probe's `truncated: false`.
- `338771`: complete stop factory, 433 characters (below).
- `471993`: factory length 1,312, first 900 characters returned; truncated.
  Embedded-platform branch opens a lazily loaded modal from module `266536`,
  passing modal props and `analyticsLocations`. The alternative branch is not
  established by this truncated excerpt. Do not execute the loader for research.

Complete stop source:

```js
338771(e,t,n){"use strict";n.d(t,{A:()=>l});var i=n(827343),r=n(401843),a=n(280450),s=n(652896);function l(e){let t=!(arguments.length>1)||void 0===arguments[1]||arguments[1],n=!(arguments.length>2)||void 0===arguments[2]||arguments[2];if(null==e)return;let{streamType:l,guildId:o,channelId:d,ownerId:c}=e,u=(0,s._z)({streamType:l,guildId:o,channelId:d,ownerId:c});c===a.default.getId()&&i.default.setGoLiveSource(null),r.vN(u,t,n)}}
```

This action derives a native stream key through `652896._z`, clears native
Go Live source through `827343.default.setGoLiveSource(null)` for the local
owner, and invokes `401843.vN(key, flag1, flag2)`. Both optional boolean flags
default to true; their meanings remain open. This is a native state/action
boundary, not a DASS-safe stop callback or merely a sound/presentation helper.

### Source-access correction (pinned-source evidence)

`vendor/Equicord/src/webpack/patchWebpack.ts`, lines 268–280, redirects a proxied
factory's `toString` property to a bound original factory method. Bypassing that
property with `Function.prototype.toString.call(proxy)` can produce opaque
native-code text. `factory.toString()` exposes **original** factory source,
not necessarily the effective source after Equicord/plugin patches.

Probe `05-sidebar-original-source` uses this exposed method for the menu and
complete start factory. No factory, exported action or chunk loader is called.
Earlier factory scans may have skipped opaque proxies; their observed matches
are valid but candidate counts are limited to readable inspected sources.

## E05: complete original menu and share-start factories

User-supplied `05-sidebar-original-source` result. Both factories readable,
complete, not opaque or truncated. Source view is the Equicord-exposed original
factory; effective patches may differ.

### Menu `848362`, 1,653 characters

```js
848362(e,t,n){n.d(t,{A:()=>_,T:()=>C});var i=n(477900),r=n(582128),l=n(17928),s=n(980707),a=n(477782),o=n(959988),u=n(820284),c=n(198052),d=n(74329),h=n(405916),m=n(338771),A=n(616356),E=n(287809),f=n(562153),g=n(652215),p=n(660183);function C(e,t,n){let i=(0,l.bG)([c.A],()=>null!=e?c.A.getSelectedParticipantId(e.id):null),s=(0,l.bG)([A.A],()=>null!=i?A.A.getActiveStreamForStreamKey(i):null,[i]),a=(0,l.cf)([E.default],()=>n.reduce((e,t)=>(e[t.ownerId]=E.default.getUser(t.ownerId),e),{}),[n]);return r.useMemo(()=>{if(null==e)return[];let i=n.filter(e=>e.ownerId!==t?.id);return 1===i.length&&i[0].ownerId===s?.ownerId?[]:i.map(t=>({stream:t,username:f.Ay.getName(e.getGuildId(),e.id,a[t.ownerId])}))},[a,n,e,s,t?.id])}function _(e){let{channel:t,currentUser:n,activeStreams:r,hideSelfOptions:l=!1,showReportOption:c=!1,handleGoLive:A,onClose:E,onSelect:f,appContext:_=g.BRT.APP,disableChangeWindows:b=!1,onInteraction:S}=e,T=r.find(e=>e.ownerId===n?.id)??null,I=C(t,n,r),v=(0,d.A)(T,_),O=(0,h.E)({disableChangeWindows:b,stream:T,showReportOption:c,handleGoLive:A,minimal:!0,appContext:_});return(0,i.jsx)(u.A,{section:g.JJy.CONTEXT_MENU,children:(0,i.jsxs)(s.W,{"data-menu-migrated":!0,onSelect:f,navId:"manage-streams",onClose:E,onInteraction:S,"aria-label":null!=T?p.intl.string(p.t.S5anIc):p.intl.string(p.t.fjBNo1),children:[(0,i.jsx)(a.rX,{children:I.map(e=>{let{stream:t,username:n}=e;return(0,i.jsx)(a.Dr,{id:t.ownerId,label:p.intl.formatToPlainString(p.t["7rkg+/"],{username:n}),icon:o.G,leadingAccessory:{type:"icon",icon:o.G},action:()=>(0,m.A)(t)},`manage-stream-menu${t.ownerId}`)})}),l?null:O,l?null:(0,i.jsx)(a.rX,{children:v})]})})}}
```

Detailed contract: [stream menus](stream-menus.md). Next dependencies:
`405916.E` (self actions) and `74329.A` (another option group).

### Start `471993`, 1,312 characters

E05 completes E04's truncated original source. Embedded-platform branch lazily
opens modal `266536` with modal props and `analyticsLocations`; original factory
includes many chunk dependencies. The probe did not execute that branch.

The complete alternative (non-embedded) branch is:

```js
else{let n=l.A.getChannel(t),i=(0,s.A)(_.jQ.PRESET_CUSTOM,_.on.RESOLUTION_1080,_.kn.FPS_30,c.default.getCurrentUser(),o.A.getGuild(e)?.premiumTier,n)?{width:1920,height:1080}:{width:1280,height:720};(0,a.Xd)({preset:_.jQ.PRESET_CUSTOM,resolution:i.height,frameRate:_.kn.FPS_30,soundshareEnabled:!0}),d.Ay.getMediaEngine().getDesktopSource(i,!0).then(n=>{(0,a.XI)(e,t,{pid:null,sourceId:n,sourceName:null,analyticsLocations:E})})}
```

Imports for this branch: `s=327649`, `l=734057`, `o=71393`, `d=192820`,
`c=287809`, `a=401843`, `_=753070`. It performs native quality/entitlement
checking, sets native share options with `soundshareEnabled: true`, obtains a
native desktop source and calls native start `401843.XI`. This is not an
appropriate fallback for DASS. The source alone does not prove which platform
branch the running Equibop session takes or that its capture/audio is selected.

## E06: self actions and reporting hook

User-supplied `06-menu-options` result, original factory view:

- `405916`, export `E` -> local `j`, length 4,848; first 4,400 returned.
  Source ends mid-audio-checkbox label. Complete preceding logic establishes
  native capture/quality/audio subscriptions and mutation callbacks; final
  item composition is not yet available. See [menu contract](stream-menus.md).
- `74329`, export `A` -> local `m`, complete 878-character factory. This is the
  **Report Problem item**, not an unknown settings group. Its independent use
  in the outer menu resolves E05's `showReportOption: false` discrepancy.

Complete reporting hook source:

```js
74329(e,t,n){n.d(t,{A:()=>m});var i=n(477900);n(582128);var r=n(17928),l=n(192308),s=n(477782),a=n(695366),o=n(652896),u=n(834757),c=n(280450),d=n(116956),h=n(660183);function m(e,t,m){let A=(0,u.AO)(e),E=(0,r.bG)([c.default],()=>c.default.getId());if(null==e)return null;let f=(0,o._z)(e),g=d.A.getVideoStats(f)??{},p={media_session_id:d.A.getMediaSessionId(f),rtc_connection_id:d.A.getRtcConnectionId(f),stream_region:d.A.getRegion(f),max_viewers:d.A.getMaxViewers(f),...g};return(0,i.jsx)(s.Dr,{id:"report-stream-problem",color:"danger",label:h.intl.string(h.t.sdnCxV),action:function(){m?.(),null!=e&&(0,l.openModalLazy)(async()=>{let{default:t}=await Promise.all([n.e("617171"),n.e("186889")]).then(n.bind(n,292208));return n=>(0,i.jsx)(t,{stream:e,streamApplication:A,isStreamer:E===e?.ownerId,analyticsData:p,...n})})},icon:a.E,leadingAccessory:{type:"icon",icon:a.E}})}}
```

No actual stream statistics, identifiers or reporting calls were inspected.
Next probe retrieves the missing self-action tail and the separately selected
idle call-overlay button ancestry.

## E07: menu tail and idle overlay button

User-supplied `07-overlay-and-menu-tail` result. Same DM/CachyOS/Wayland session;
requested selected element is now the idle call-overlay share button. The
probe does not expose state values. Selected `BUTTON`, 15 fibers visited, ten
function rows returned, output budget not clipped; ancestry stopped at row cap.

### Menu tail

Original `405916` source, offset 4,000 through end at 4,848, complete/readable:

```js
reEnabled:!V}),u.default.setGoLiveSource(i)},[U,V]);if(null==t)return(0,i.jsx)(s.Dr,{id:"share-your-screen",label:N.intl.string(N.t.fjBNo1),icon:a.F,leadingAccessory:{type:"icon",icon:a.F},action:j});let $=E.isPlatformEmbedded?(0,i.jsx)(s.Dr,{id:"stream-settings",label:N.intl.string(N.t.ytAD9d),children:W}):null,ee=B?(0,i.jsx)(s.sL,{id:"stream-settings-audio-enable",label:L?N.intl.string(N.t.af2Tw1):N.intl.string(N.t.ZJEHt7),checked:V,action:Q}):null,et=!z||P||K?null:(0,i.jsx)(s.Dr,{id:"change-windows",label:Z,icon:a.F,leadingAccessory:{type:"icon",icon:a.F},action:q}),en=(0,i.jsx)(s.Dr,{id:"stop-streaming",color:"danger",label:N.intl.string(N.t.S5anIc),icon:o.G,leadingAccessory:{type:"icon",icon:o.G},action:()=>(0,h.A)(t)});return L?(0,i.jsxs)(i.Fragment,{children:[en,et,$,ee]}):(0,i.jsxs)(i.Fragment,{children:[$,D?H:null,ee,et,en]})}}
```

### Overlay chain

| Depth | Name | Relevant evidence |
| --- | --- | --- |
| 1–3 | `O`, `I`, `E` | Same focus-ring/button/tooltip source lengths as sidebar; different tooltip/button prop sets |
| 5 | `l` (390 chars) | Hover/focus prevent-idle wrapper, cleanup releases both holders |
| 6 | `C` (1,012 chars) | `label`, `iconComponent`, supplied click/hover/focus/menu callbacks and classes |
| 8 | `L` (1,100 chars) | `isActive`, `isTrayButton`, `onPopoutClick`, `popoutOpen`, icon/label/button props; split-button candidate |
| 9 | `c` (662 chars) | `centerButton`, `hasPermission`, `streamActive`, `videoBlocked`, `isSelfStream`, click/popout props; specialized Share component |
| 11–12 | `N`, `S` | Popout and wrapper |
| 14 | `l` | Second instance of same idle-wrapper function |

Exact specialized Share prefix:

```js
function c(e){let n,t,{hasPermission:c,streamActive:u,isSelfStream:d,videoBlocked:A=!1,centerButton:h,onMouseEnter:m,onMouseLeave:g,renderNUXHighlight:x,buttonRef:C,...f}=e,p=h?r.l:r.A;t=A?o.intl.stri
```

This is a candidate for actual component reuse via supplied props. Full body,
export coordinates, icon hook and transitive children are not yet established;
no claim of purity is made from the prop names alone. Next probe returns full
bounded Share/split-button/button/idle-wrapper sources and factory coordinates.

## E08: mounted overlay candidate sources and coordinates

User-supplied `08-overlay-primitives` result. Complete mounted bodies (not
truncated): idle `l` 390 chars, base `C` 1,012, split `L` 1,100, Share `c` 662.
Share matches original factory `958449`, 770 chars, once, containing the complete
function. The other exact prefix scans returned zero matches. Six factories
remained opaque even through the exposed original-source method. Counts are
therefore not exhaustive evidence of module/export absence.

Detailed body-derived contracts are retained in [overlay controls](overlay-controls.md).
Key findings: rest-prop override precedence in Share; native theme/mode reads
in split button; width-dependent caret removal; base button's fixed mouse-down
handler and lack of arbitrary ARIA forwarding; idle holders with document-aware
focus cleanup. All transitive dependencies still need export/provider audit.

Share body, exactly returned:

```js
function c(e){let n,t,{hasPermission:c,streamActive:u,isSelfStream:d,videoBlocked:A=!1,centerButton:h,onMouseEnter:m,onMouseLeave:g,renderNUXHighlight:x,buttonRef:C,...f}=e,p=h?r.l:r.A;t=A?o.intl.string(o.t.GFr0GR):u?d?o.intl.string(o.t.S5anIc):o.intl.string(o.t.q3O3J8):c?o.intl.string(o.t.fjBNo1):o.intl.string(o.t.uQn9B8);let{Component:E,events:j,play:v}=(0,s.c)(u?"disable":"enable"),I=A?a.i:E;return l.useEffect(()=>()=>v(),[u,v]),(0,i.jsx)(p,{buttonRef:C,isTrayButton:!0,label:t,disabled:!c,iconComponent:I,isActive:u,color:(x?n="premiumGradient":u&&(n="green"),n),onMouseEnter:e=>{m?.(e),j.onMouseEnter()},onMouseLeave:e=>{g?.(e),j.onMouseLeave()},...f})}
```

Ancestors newly returned: `eN` 1,752 chars, props channel/currentUser/
exitFullScreen/canGoLive/hasPermission/videoBlocked; `ey` 3,126 chars, props
exitFullScreen/channel/onDisconnectCall/idleProps. Prefix evidence for `eN`:

```js
function eN(e){let{channel:n,currentUser:t,exitFullScreen:s,canGoLive:a,hasPermission:r,videoBlocked:o=!1,disabled:c}=e,{parentAnalyticsLocation:h,analyticsLocations:m}=(0,v.Ay)(),
```

Next probe: original factory `958449` plus complete mounted `eN` and its original
factory coordinates. No ancestor callback or component is invoked.

## E09: actual Share export and connected overlay owner

User-supplied `09-overlay-owner` result. Original `958449` factory complete,
770 chars: exports `h` -> local Share `c`; imports presentation variants from
`204651`, icon hook `416696`, blocked icon `797394`, host React `582128`, JSX
`477900` and intl `660183`. The mounted Share body is retained in E08.

Mounted owner `eN` complete, 1,752 chars, one original factory match `105225`
(9,643 chars), containing the complete function:

```js
function eN(e){let{channel:n,currentUser:t,exitFullScreen:s,canGoLive:a,hasPermission:r,videoBlocked:o=!1,disabled:c}=e,{parentAnalyticsLocation:h,analyticsLocations:m}=(0,v.Ay)(),g=(0,B.Us)(),x=(0,u.yK)([et.A],()=>et.A.getAllActiveStreams()),C=x.find(e=>e.ownerId===t.id),f=l.useRef(null),p=l.useRef(null),E=n.getGuildId(),j=l.useCallback(()=>{if(s?.(),!a)return(0,eg.A)();(0,ex.A)(E,n.id,m)},[E,n.id,a,s,m]),I=(0,H.k0)(),[N,T]=l.useState(!1);if(!(0,u.bG)([el.Ay],()=>el.Ay.supports(ej.O5.VIDEO)))return null;function _(){((0,b.X)(h,b.O.STREAM,!0),a)?j():(0,eg.A)()}function S(){(0,b.X)(h,b.O.STREAM,!1),(0,D.A)(C)}return(0,i.jsxs)(i.Fragment,{children:[function(){if(I&&0===x.length)return(0,i.jsx)(y.Ay,{contentTypes:[d.M.TRIAL_NUX_STREAM_COACH_MARK],bypassAutoDismiss:!0,children:e=>{let{visibleContent:n,markAsDismissed:t}=e;if(n===d.M.TRIAL_NUX_STREAM_COACH_MARK)return T(!0),(0,i.jsx)(Y.b,{buttonRef:f,dismissed:!1,onDismiss:()=>{t(eE.i.USER_DISMISS),T(!1)}})}})}(),(0,i.jsx)(K.A,{children:(0,i.jsx)(A.Y,{targetElementRef:p,renderPopout:e=>{let{closePopout:l}=e;return(0,i.jsx)(F.A,{children:(0,i.jsx)(eh.A,{channel:n,currentUser:t,activeStreams:null!=C?[C]:[],handleGoLive:j,appContext:g,onClose:l,onInteraction:eS("ManageStreamsMenu")})})},position:"top",align:"center",spacing:16,animation:A.Y.Animation.FADE,children:(e,n)=>{let{...t}=e,{isShown:l}=n;return(0,i.jsx)("div",{ref:p,children:function(e,n){let{onClick:t,...l}=e??{onClick:void 0},s=null!=C;return(0,i.jsx)(ee.h,{...l,centerButton:!0,disabled:c||!r,className:ev.uH,hasPermission:r,streamActive:null!=C,videoBlocked:o,isSelfStream:!0,onPopoutClick:s?function(e){t?.(e)}:null,popoutOpen:n,shouldShowTooltip:!n,renderNUXHighlight:N,buttonRef:f,onClick:null!=C?S:_})}(t,l)})}})})]})}
```

Interpretation: [connected overlay contract](overlay-controls.md#connected-owner-en-e09-factory-105225).
Native action/menu imports need confirmation. Next probe reads `204651` and
`416696` original bodies plus the connected owner's import coordinates.

## E10: confirmed overlay dependencies and icon lifecycle

User-supplied `10-overlay-dependencies` result; original source, complete,
readable factories `204651` (2,699 chars) and `416696` (1,017 chars).

Owner imports, one require match each: `ee=958449`, `eh=848362`, `K=447404`,
`F=246356`, `B=267102`, `et=616356`, `eg=702904`, `ex=471993`, `D=338771`,
`b=384059`, `A=922016`, `ev=843395`, `el=192820`, `ej=731854`.
This confirms both entry points share native start/stop/menu modules.

`204651` exports `l` -> original local split button `L`, `A` -> original local
base button `A`. Original base is named `A` versus E08 mounted `C`; split-button
internal aliases also differ. Structural correspondence through imports resolves
the E08 exact-source scan failures without treating missing matches as absence.

Other original `204651` dependencies: `477900` JSX, `582128` React, `503698`
class combiner, `319354` icon size, `84571` accessible label, `862482` button,
`866665` tooltip, `939249` caret clickable, `241524` media-query hook,
`147925` caret icon, `461782` animation/idle context, `447404` idle wrapper,
`17928` store hooks, `462887` theme predicate, `736653` theme hook,
`198052` call mode, `309010` selected voice channel, `652215` constants,
`660183` intl, `609142` CSS.

`416696.c` is the animated icon hook. Its complete source:

```js
416696(e,t,n){n.d(t,{c:()=>a});var i=n(477900),r=n(582128),l=n(744682);let s={enable:{name:"enable",start:0,duration:70},disable:{name:"disable",start:90,duration:70},hover_enabled:{name:"hover_enabled",start:180,duration:40},hover_disabled:{name:"hover_disabled",start:240,duration:40}};function a(e){let t=r.useRef(null),a=r.useRef(e);a.current=e;let o=r.useMemo(()=>()=>{null!=t.current&&t.current.play(e)},[e]),u=r.useCallback(()=>{if(null==t.current)return;let n="enable"===e?"hover_disabled":"hover_enabled";t.current.play(n)},[e]),c=r.useCallback(()=>{if(null==t.current)return;let n="enable"===e?"hover_disabled":"hover_enabled";t.current.stopIfPlaying(n)},[e]),d=r.useCallback(e=>(0,i.jsx)(l.P,{...e,src:()=>n.e("836306").then(n.t.bind(n,478313,19)),ref:t,initialAnimation:a.current,markers:s}),[]);return{events:{onClick:o,onMouseEnter:u,onMouseLeave:c},play:o,getDuration:r.useCallback(()=>t.current?.getDuration(),[]),getCurrentFrame:r.useCallback(()=>t.current?.getCurrentFrame()??null,[]),Component:d}}}
```

The native `.play` observed here targets the animation ref, not an audio player.
Sound cue ownership remains open. No animation chunks were loaded by the probe.
Next: manual native start, active sidebar card ancestry, and bounded static
source for the idle/popout wrappers. No remote viewing is needed for this step.

## E11: active sidebar title ancestry and idle wrappers

User explicitly selected the active card's "Go Live" text and supplied probe
`11-active-sidebar-card`. Same ongoing DM/CachyOS/Wayland session; DASS-disabled
native start was requested. No actual stream content/metadata values were read.
22 fibers visited, ten function rows returned, budget not clipped.
The user did not separately confirm green controls or sound in this response;
those remain baseline user observations, not newly measured transitions.

Relevant chain:

| Depth | Function | Prop names / evidence |
| --- | --- | --- |
| 1 | `_` (577 chars) | Native text component |
| 2 | `o` (137 chars) | Title text wrapper |
| 5 | `nv` (493 chars) | `streamMetadata`, `accountLinkUpsellTargetRef`, `streamQualityIndicator` |
| 8 | anonymous (6,814 chars) | `className`, `guildId`, `ref`, `analyticsContext`; connected owner |
| 10 | `withAnalyticsContext()` (126 chars) | HOC passes analytics context and ref |
| 12 | `c` (89 chars) | Provider wrapper with `value`, `children` |
| 13 | `bt` (190 chars) | Activity panel analytics location and guild context, renders `Dc.A` |
| 16 | `d` (995 chars) | Native analytics section wrapper |
| 19 | `P` (251 chars) | Container/theme wrapper |
| 21 | anonymous (770 chars) | Outer app-panels section |

Metadata-body prefix:

```js
function nv(e){let{streamMetadata:t,accountLinkUpsellTargetRef:n,streamQualityIndicator:i}=e,{title:a,sanitizedTitle:s}=(0,eq.A)(t);return(0,r.jsxs)("div",{className:nm.cm,ref:n,children:[(0,r.jsx)(eQ.A,{title:s,icon:t?.
```

Connected-owner prefix:

```js
function(e){let{guildId:t,analyticsContext:n,className:i}=e,s=a.useRef(null),o=a.useRef(null),d=a.useRef(null),c=(0,_.bG)([tt.default],()=>tt.default.getId()),A=(0,_.bG)([eV.Ay,tc.A],()=>(0,eJ.A)(eV.Ay,tc.A)),{enabled:h}
```

Complete original idle-wrapper source `447404` (654 chars):

```js
447404(e,n,l){l.d(n,{A:()=>o,o:()=>u});var r=l(477900),t=l(582128),a=l(461782);function u(e){let{onPreventIdle:n,onAllowIdle:l,onActive:r}=t.useContext(a.k3);return{preventIdle:t.useCallback(()=>{n(e)},[e,n]),allowIdle:t.useCallback(()=>{l(e)},[e,l]),onActive:r}}function o(e){let{children:n,className:l}=e,{preventIdle:a,allowIdle:o}=u("interact-hover"),{preventIdle:c,allowIdle:s}=u("interact-focus");t.useEffect(()=>()=>{o(),s()},[o,s]);let i=t.useCallback(e=>{let n=e.target.ownerDocument??document;e.currentTarget.contains(n.activeElement)||s()},[s]);return(0,r.jsx)("div",{className:l,onMouseEnter:a,onMouseLeave:o,onFocus:c,onBlur:i,children:n})}}
```

Complete original popup holder `246356` (183 chars):

```js
246356(e,t,n){n.d(t,{A:()=>l});var s=n(582128),i=n(447404);function l(e){let{children:t}=e,{preventIdle:n,allowIdle:l}=(0,i.o)("popup");return s.useEffect(()=>(n(),()=>l()),[l,n]),t}}
```

Next: metadata body complete source, connected owner head/tail and original
factory coordinates. Reusing the card remains conditional on auditing its title,
icon, quality, action and effect dependencies; props alone do not prove purity.

## E12: sidebar metadata and connected card boundary

User-supplied `12-sidebar-card-boundaries` result. Metadata `nv` complete,
493 chars, one prefix match in original factory `463481` (37,947 chars).
Connected owner 6,814 chars, first 1,100 and last 1,900 (offset 4,914) returned;
middle offsets 1,100–4,914 missing. Same factory coordinate, one match. Six
factories remain opaque. Parent prefix matches establish containment, not
exportability or complete source equality.

Complete body:

```js
function nv(e){let{streamMetadata:t,accountLinkUpsellTargetRef:n,streamQualityIndicator:i}=e,{title:a,sanitizedTitle:s}=(0,eq.A)(t);return(0,r.jsxs)("div",{className:nm.cm,ref:n,children:[(0,r.jsx)(eQ.A,{title:s,icon:t?.sourceIcon}),(0,r.jsxs)("div",{className:nm.pq,children:[(0,r.jsx)(th.A,{children:a}),null!=i&&(0,r.jsxs)("div",{className:nm.qi,children:[(0,r.jsx)(I.t,{size:"xxs",color:eM.k0.PREMIUM_TIER_2}),(0,r.jsx)(e8,{className:nm.s,variant:"text-xxs/semibold",children:i})]})]})]})}
```

Connected head establishes current user/game/config/recent-game timer, native
voice/activity channel/guild state, then current native stream + metadata from
`e6.A`. Tail establishes selected game/activity/stream bodies, native action
group `t6`, account-link/activity popover `nR`, refs and analytics context.
Detailed contract and missing evidence are in [sidebar card](sidebar-card.md).

Next: user selects stop-sharing button on this card without clicking; retrieve
the action group's bounded mounted body and body dependency import map.

## E13: metadata dependency coordinates; action filter unmatched

User-supplied `13-sidebar-card-actions` result. Each alias has exactly one
numeric require declaration in original `463481`:

| Alias | Module | E12 body use |
| --- | --- | --- |
| `eq` | `277680` | Title/sanitized-title helper `A` |
| `eQ` | `118277` | Title/icon presentation `A` |
| `th` | `485599` | Title text wrapper `A` |
| `I` | `403581` | Small premium icon `t` |
| `eM` | `404374` | Premium color constants |
| `nm` | `821095` | Card CSS |
| `e6` | `616356` | Native stream store |

`actionOwner: null`: no function owner satisfied all three prop names
`stream`/`canGoLive`/`isStreaming` within the probe's ancestry/unwrap limits.
This does not establish missing action UI or wrong user selection. The next
probe returns bounded ancestry metadata, supporting up to three React wrapper
layers, and title/icon/text original factory excerpts. No stop action is called.

## E14: menu-item ancestry and complete title/icon helpers

User-supplied `14-card-action-ancestry` result. Selected `DIV`, ten function rows,
21 fibers visited, budget not clipped. Native menu item `q` has props id/color/
label/icon/leadingAccessory/action/hasSubmenu/isFocused/menuItemProps/onClose.
Ancestors include effective native menu `eA` (8,590 chars, patched through
`Vencord.Api.ContextMenu._usePatchContextMenu`), analytics wrapper `d`, connected
stream-menu `m` (997 chars), and animation wrapper `p`. This is menu ancestry,
not a card action-group capture. No menu action was executed by the probe.

Complete original helper sources:

```js
277680(e,t,n){"use strict";n.d(t,{A:()=>a});var i=n(660183);let r=/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g;function a(e){let t=i.intl.string(i.t.FeUKeA);return null!=e&&null!=e.sourceName&&e.sourceName.length>0&&(t=e.sourceName),{sanitizedTitle:t.replace(r,""),title:t}}}
```

```js
118277(e,t,n){"use strict";n.d(t,{A:()=>E});var i=n(477900),r=n(582128),a=n(503698),s=n.n(a),l=n(317097),o=n(428689),d=n(573435),c=n(35455);let u=[1752220,3066993,3447003,0x9b59b6,0xe91e63,0xf1c40f];function _(e){return(0,l.Hl)(u[function(e){let t=5381,n=0;for(;n<e.length;)t=33*t^e.charCodeAt(n++);return t>>>0}(e)%u.length])}function E(e){let{title:t,className:n,icon:a}=e,[l,u]=r.useState(_(t));return r.useEffect(()=>{u(_(t))},[t]),(0,i.jsxs)("div",{className:s()(c.iE,n),children:[(0,i.jsx)(d.Ay,{mask:d.Ay.Masks.STATUS_SCREENSHARE,width:32,height:32,children:null==a||0===a.length?(0,i.jsx)("div",{className:c.Kk,style:{backgroundColor:l},children:t[0]??"?"}):(0,i.jsx)("img",{alt:"",src:a,className:c.Kk})}),(0,i.jsx)(o.VideoIcon,{size:"md",color:"currentColor",className:c.qS})]})}}
```

```js
485599(e,t,n){"use strict";n.d(t,{A:()=>o});var i=n(477900);n(582128);var r=n(503698),a=n.n(r),s=n(834730),l=n(158821);function o(e){let{children:t,className:n}=e;return(0,i.jsx)(s.E,{color:"none",className:a()(l.D,n),variant:"text-md/medium",children:t})}}
```

All three complete, readable, not truncated. Contracts and image-source caveat:
[sidebar card](sidebar-card.md#title-and-icon-contracts-e14).
Next: bounded static card-action declaration windows; no element selection needed.

## E15: native card action group declaration

User-supplied `15-card-action-source` result. Original `463481`, length 37,947,
readable. Two `canGoLiveActivity:` matches:

- Declaration anchor 11,891; source window 11,671–13,691 (2,020 chars).
  Identifies `t6 = a.memo(function(e) { ... })`, complete props and initial
  hooks/callbacks; ends mid native callback.
- Caller anchor 37,311; window 37,091–37,947 (856 chars), confirming the connected
  card's `t6` props and following account-link/activity popover `nR`.

The group reads personalization consent and constructs fetch-capable native
game/community hooks. Native stop candidate is `tz.A(stream)` in callback `z`;
screen-share modal callback loads `266536`. Exact import coordinates and final
render need another bounded excerpt. See [native action group](sidebar-card.md#native-action-group-t6-partial-e15).

Next probe reads static offsets 13,600–16,600 and a small import map, plus
ancestry metadata for the user's selected self-stream LIVE badge in the call.

## E16: direct card stop branch and first call-tile overlay ancestry

User-supplied `16-call-tile-and-card-tail`. Original card slice 13,600–16,600
complete as requested, but ends before the final action-group render. Imports:
`tz=338771`, `ef=384059`, `tI=192308`, `tQ=153488`, each one match.
The stream action branch wraps `tM.A({tooltipText, disabled, onClick, icon})` in
a div; active click calls native stop then analytics. Inactive enabled click
opens native share/activity modal. See [card stream action](sidebar-card.md#stream-action-branch-e16).

Self-stream call LIVE badge selection: `DIV`, 22 fibers visited, output clipped
at 3,500-character metadata budget. Outer tile/layout owner not reached.

| Depth | Mounted function | Relevant evidence |
| --- | --- | --- |
| 1 | `_`, 577 chars | Native text |
| 2 | `A`, 278 chars | Badge text/color/shape presentation |
| 3 | `A`, 397 chars | LIVE look/size/shape/count wrapper |
| 5 | anonymous, 563 chars | Animation wrapper |
| 7 | `Y`, 811 chars | participant, showQuality, isUpsellEnabled, size, className, premiumIndicator; reads reduced-motion context |
| 8 | `en`, 453 chars | participant, selected, focused, idle, width, premiumIndicator; reads `getActiveStreamForUser(user.id, stream.guildId)` |
| 12 | `l`, 730 chars | Clickable/interaction wrapper |
| 14 | `l`, 222 chars | Tile frame props ref/className/noBorder/style/participantUserId |
| 15 | `o`, 210 chars | Shake-animation wrapper |
| 17 | `f`, 65 chars | enableZoom condition around children |
| 20 | `d`, 995 chars | Analytics section wrapper |

This distinguishes LIVE presentation from connected quality overlay and outer
media/controller. It does not establish a DASS-safe whole-tile component.
Next: focused small component sources and relevant outer participant-owner
excerpts, plus card action-button import/source, omitting generic ancestry rows.

## E17: tile overlay/quality/frame and card action primitive

User-supplied `17-tile-boundaries`, collection not clipped:

- Quality `Y`: complete 811 chars, one original prefix match in `872363`,
  factory length 3,146. Derived quality and child `W` are not yet audited.
- Overlay `en`: complete 453 chars, one original prefix match in `802867`,
  factory length 6,768. Full body below.
- Frame `l`: complete 222 chars, no original prefix match; coordinate open.
- Anonymous participant owner: 5,485 chars, first/last 500 captured, no original
  prefix match; media/selection/callback body still missing.
- Card button: one `tM` import resolves `42473`, factory length 2,012, first
  1,200 chars captured; truncated tooltip wrapper but complete inner button.

Complete connected overlay:

```js
function en(e){let{participant:t,selected:n,focused:l,idle:s,width:r,premiumIndicator:o}=e,u=(0,a.bG)([O.A],()=>O.A.getActiveStreamForUser(t.user.id,t.stream.guildId)),c=(0,X.VE)(r);return(0,i.jsxs)(i.Fragment,{children:[n||l?null:(0,i.jsx)(K.A,{participant:t}),l||null==u||u.state===q.XYD.ENDED||u.state===q.XYD.FAILED?null:(0,i.jsx)(S.A,{size:f.Ay.Sizes.SMALL,className:Y.Ok,participant:t,showQuality:!c&&!s,isUpsellEnabled:!1,premiumIndicator:o})]})}
```

Contracts: [call tiles](call-tiles.md), [card primitive](sidebar-card.md#action-button-primitive-42473a-partial-e17).
Next: complete original quality factory, card tooltip tail, stream-tile import
header and bounded structural frame candidate inventory. No selection required.

## E18: quality telemetry boundary, card tooltip, frame export

User-supplied `18-tile-quality-and-primitives`:

- `872363`: complete original 3,146 chars, exports `A` -> `Y`. Nested `W`
  reveals native premium predicates/user state and **ungated-by-isUpsellEnabled
  premium-view telemetry**. Calls formatters/quality helpers in `650338`, native
  badge `812993`, LIVE `402216`, participant helper `821715`. No actual metrics
  or identifiers were read; this is static source only.
- `42473`: original tail offset 1,000 to end (2,012), complete. Default standard
  tooltip/accessibility branch and specialized green-tooltip callback branch are
  established. See [card tooltip contract](sidebar-card.md#complete-tooltip-wrapper-e18).
- `802867`: first 1,000 of 6,768 original chars; exports `A` -> `ei`, `D` -> `en`.
  Begins zoom/player memo wrapper `R`; full media branch remains open.
- Frame inventory: one readable candidate, `272812`, length 317, export `A`
  -> local `a`; six opaque factories. Structural frame excerpt matches E17's
  mounted body despite original alias/name changes.

Frame import header: JSX `477900`, React `582128`, class combiner `503698`,
CSS `195500`. Complete render has native ref/classes/style/noBorder, children,
and optional participant user-ID DOM attribute; no store/media hooks.

Next probe reads original stream-tile tail, quality helpers `650338`, and
LIVE export `402216`, without requiring modules or invoking any media function.

## E19: complete stream media tail, quality helpers and LIVE export

User-supplied `19-stream-media-and-live`:

- `802867`: original offset 4,000 through end 6,768, complete tail. Contains full
  `ei` media function and end of `en`. Reveals stage auto-watch, native video
  ownership, preview path and force-multiple native watch action. Not DASS-safe
  as a wholesale player. No actions were invoked by the probe.
- `650338`: first 1,800 of 1,863, 63 remaining. Exported plain formatters `ME/Bs`,
  extraction `wz`, native quality hook `N5`, premium predicates `HB/OI`, native
  analytics update `K2`. Full formatter/hook bodies visible; analytics tail not.
- `402216`: complete original 738 chars. Actual LIVE presentation export `Ay`,
  looks `gv`, sizes `ed`, shape classes `u1`. No media/store/action in body.

Contracts and native-side-effect details: [call tiles](call-tiles.md).
Next: user manually enlarges own stream, selects the enclosing native tile frame
in Elements, and returns bounded layout ancestry. Static probe also follows
native name-overlay import and lower text-badge source, without media values.

## E20: grid ancestry after requested enlargement; warning import correction

User-supplied `20-focused-layout`: 25 fibers visited, twelve function rows,
budget not clipped. Selected frame ancestry includes frame/shake/zoom/analytics,
same anonymous 5,485-char participant owner, virtual list/scroller, layout `h`
(1,125 chars), grid `b` (1,796), and flex wrapper. No focused-layout owner or
runtime state values were returned. Do not claim enlargement succeeded from
the probe title/request alone.

Grid `b` props: channel/className/participants/totalNumberOfParticipants/onClick/
onDoubleClick/onContextMenu/inCall/popoutType. Layout `h` props:
className/keyExtractor/paddingTop/paddingBottom/children. Their complete sources
and actual layout flags are next.

Static name-import probe resolved `K` once to `275731`; complete source 662
chars is a **stream-health warning**, not participant-name overlay. This
corrects the earlier provisional classification in the plan/docs. It derives
native AV error through `821715.A`, maps error category to intl text, renders
`93067.A` with native avError. Participant computer/name label remains unlocated.

`812993`: first 900 of 1,667 chars returned. Exports include shape class table
`EG`, text badge `Lp`, count badge/count formatting helpers. Text badge body
starts in excerpt but is incomplete; next probe retrieves overlapping tail.

Next probe permits only selected/focused/idle/etc **boolean** values and a
selected-participant-present boolean. This is intentionally more specific than
earlier key-only probes; all identity/media values remain excluded.

## E21: no native selection; complete grid/layout/badge contracts

User-supplied `21-grid-routing`. Allowlisted runtime flags only:

- Tile/grid inCall true.
- Root layers idle true, showParticipants false, selectedParticipantPresent false.
- Other captured call layers `eq`, `uw`, anonymous also selectedParticipantPresent
  false. No selected/focused values were present on the tile-owner props.

Complete mounted layout `h` (1,125 chars), one original prefix match in `511205`
(1,403); complete mounted connected grid `b` (1,796), one original prefix match
in `526369` (2,116). Layout consumes width-aware render callbacks; connected grid
forwards click/double-click/context-menu without deciding selection and runs
native permission/activity/impression logic.

`812993` original tail 800–1,667 completes text-badge `Lp` across E20/E21;
its body is callback-free native typography/classes/style/text presentation.
See [grid/layout contracts](call-tiles.md#grid-layout-and-routing-e21).

Next: bounded ancestry-derived call-controller selection handler snippets,
original factory coordinates and source match counts. No click automation or
event listeners; selected-participant identity remains excluded.

## E22: native selection controller and VIDEO-mode gate

User-supplied `22-selection-controller`. Handler owner `eq` (mounted class
15,646 chars), one original prefix match `540462` (20,502). Handler anchor
`handleSelectParticipant=` at mounted offset 7,197; bounded excerpt establishes
complete selection, popout and fullscreen-participant handlers, then begins
bottom-control rendering. No handler was invoked.

Native stream clicks may select voice channel and watch native stream before
participant selection. Selection itself requires inCall plus native VIDEO mode.
Repeated click on selected ID deselects. Native stream key parsing and Shift
multi-watch are source-observed; exact imports/eligibility remain open.
Full contract: [selection and layout](selection-and-layout.md).

Additional candidates: anonymous call-root body 1,488 chars with participants,
selectedParticipant, layout, selection/context/fullscreen callbacks, channel;
measurement wrappers 391 chars; higher channel-page class `uw` 16,632 chars.
Their presence does not override the user's reported DM voice-call context.

Investigation correction: DOM-attached fiber props may be an older alternate;
E21's booleans are captured-branch evidence until compared with connected
element/current class instance. E23 reads only connectivity and non-sensitive
layout flags/constant comparisons from the same identified controller.

## E23: connected element and current class-instance flags agree

User-supplied `23-current-call-flags`:

- selectedElementConnected true; already-loaded mode constants available.
- Controller `eq`, both fiber and class-instance props: inCall true,
  selectedParticipantPresent false, videoMode true, voiceMode false.

This strengthens the current-selection observation and rules out a false VIDEO
gate as its immediate explanation. It does not prove the earlier user click
reached the intended tile callback or show subsequent reconciliation behavior.
No identity/participant/media values were returned. Next: mounted tile body and
static supplied click callback, without invoking it.

## E24: complete generic tile and actual supplied click callback

User-supplied `24-tile-click-body`. Mounted generic body complete (5,485 chars),
actual supplied click callback complete (405). Tile forwards participant/event
unchanged to controller callback; the callback matches E22's selection logic.
It does not invoke callback while inspecting source.

Original grid import `I` matches once to `175203`, length 12,010; export header
`Ay:()=>ez`, `Yl:()=>e$`. Generic tile includes native media/settings/voice/effects/
security/analytics/zoom dependencies, but separates frame, clickable and footer
presentation boundaries. Mounted footer `ew` receives title/icon/audio/context/
hover/idle/focus/identity state and callbacks; local stream hides audio icon.
Detailed fields and safety boundaries: [call tile body](call-tiles.md#complete-mounted-generic-tile-body-e24).

Next: bounded original `controlsBottom` declaration/caller windows to identify
the footer, plus controller imports for selection/eligibility/watch. No listener,
callback, dispatch or selection mutation is performed.

## E25: footer hooks, computer icon helper and selection imports

User-supplied `25-footer-and-selection-imports`. Three original `175203`
controlsBottom windows: 855–2,505 (generic tile destructure/import tail),
5,692–7,342 (footer caller plus platform/icon-control helpers),
7,627–9,277 (footer declaration/initial hooks).

Footer local `ew` is memoized and connected to native user/activity/display-name/
video/context-menu state. Platform helper `eR` selects computer icon for native
STREAM (Xbox exception). Native icon-control helper `eL` is a candidate but body
tail incomplete. Footer secure-frame/identity semantics must not be forged for
DASS. See [footer contract](call-tiles.md#original-footer-and-platform-helper-e25).

Controller imports each match once: `x=367513`, `eF=806931`, `B=279250`,
`j=730852`, `y=401843`, `k=652896`, `ez=652215`.

Next: original `175203` tail 9,200 through end plus bounded selectParticipant
implementation from `367513`. Static text only; no store action is invoked.

## E26: complete footer tail and unguarded selection dispatch

User-supplied `26-footer-render-and-selection`:

- Original `175203` offsets 9,200–12,010 complete; includes footer render,
  `CallTileOverlay` displayName and final module exports. Native title/platform
  icon hide while idle; mute/options/popout/zoom/security/activity branches are
  distinct. See [footer render](call-tiles.md#footer-render-and-callback-driven-icon-helper-e26).
- Icon helper `eL` anchor 7,134, 600-char window includes complete helper then
  start of native stay-on-top helper. Tooltip/icon button forwards supplied
  callback after stopPropagation; no store/action in the helper itself.
- `367513`, length 1,757, one selectParticipant match at 193. Excerpt confirms
  plain `73153.h.dispatch({type:"CHANNEL_RTC_SELECT_PARTICIPANT",channelId,id})`.
  Other native layout/popout actions visible, including layout analytics.

No calls or dispatches occurred. Selection reconciliation/event delivery remains
unverified. Next: call-root route and selected-stream audio control source,
without forcing focus, native watching or a remote connection.

## E27: complete call-root route and selected remote speaker controller

User-supplied `27-call-route-and-speaker`. Public runtime Sentry build ID:
`17e01cf978c3c10a5688429a38db59a4926e8982`; not a numeric build gate.

Mounted root complete 1,488 chars, one original prefix match `874739` (1,742).
Native route is pending/prejoin/VOICE, then grid/empty when no selection, otherwise
focused layout. Full route contract: [selection and layout](selection-and-layout.md#call-root-route-874739-e27).

Original controller excerpt from renderBottomLeft offset 10,997 also includes
renderBottomRight, where selected non-activity/non-self audio component appears.
One historical audio import matches: `ep=821747`. Original `821747` complete
793 chars, export `A` -> `g`, connected native volume/mute controller. Lower
widget `20504.A`, conversions `824744.M/w`, idle wrapper `447404.A`.

Complete native audio controller:

```js
821747(e,n,t){t.d(n,{A:()=>g});var i=t(477900);t(582128);var l=t(503698),s=t.n(l),a=t(17928),r=t(827343),o=t(384059),c=t(20504),u=t(192820),d=t(824744),A=t(723702),h=t(447404),m=t(609142);function g(e){let{className:n,iconClassName:t,sliderClassName:l,userId:g,context:x,currentWindow:C=window,location:f}=e,{currentVolume:p,muted:E}=(0,a.cf)([u.Ay],()=>({currentVolume:u.Ay.getLocalVolume(g,x),muted:u.Ay.isLocalMute(g,x)}));return(0,i.jsx)(h.A,{children:(0,i.jsx)(c.A,{currentWindow:C,iconClassName:s()(t,m.pd),sliderClassName:l,className:n,value:(0,d.M)(p),muted:E,maxValue:A.isPlatformEmbedded?200:100,onValueChange:e=>{e>0&&E&&r.default.toggleLocalMute(g,x),r.default.setLocalVolume(g,(0,d.w)(e),x)},onToggleMute:()=>{null!=f&&(0,o.X)(f,o.O.VOLUME,E),r.default.toggleLocalMute(g,x)}})})}}
```

No native audio calls/streams were invoked. Remote GUI/audio remains unverified.
Next: lower widget/conversion source and focused-layout import/header.

## E28: callback-driven speaker, lifecycle caveat and focused import

User-supplied `28-speaker-and-focused-imports`:

- `20504`: complete original 2,608, export native class `p` as `A`. Callback-driven
  icons/slider/hover/key behavior, 150 ms grace. No componentWillUnmount/hover-
  timeout cleanup in class. Slider/currentWindow drag ownership in `122641.A`
  remains to inspect. Detailed API: [lower speaker](stream-audio.md#lower-widget-20504a-e28).
- `824744`: complete 72-char re-export of `792251.M/w`; formula not yet known.
- One focused-route import from `874739` resolves `699707`. Original factory
  3,424, first 1,100 returned. Native video/current-user/participant/layout hooks,
  dimensions/strip visibility and animation state shown; tail uncollected.

No component/callback/asset was invoked. Next: actual conversion source, native
MediaBar source and complete focused-layout continuation. Remote audio GUI and
selection reconciliation remain open.

## E29: exact volume curve, drag-window cleanup mismatch, focused render

User-supplied `29-volume-drag-and-focus`:

- `792251`: complete 386-char original, plain M/w inverse conversion, baseline
  100, exponent 2.8 below unity and log/6 dB mapping above. Local math examples/
  round trips recorded in [audio conversion](stream-audio.md#exact-conversion-formula-792251mw-e29).
- `122641`: first 2,700 of 3,874, 1,174 remaining. Native MediaBar adds drag
  listeners to props.currentWindow, normal end removes from props.currentWindow,
  but unmount removes from global window. Conditional popout cleanup hazard;
  animation subscriptions are explicitly removed. No listener was installed
  by this probe.
- `699707`: original offset 1,000 through end 3,424, complete continuation.
  Confirms focused generic tile, native geometry/animation/remeasurement,
  participant strip `163432.Ay/i4`, leftover helper `947580.Cf`, secondary
  participant surface `306852.A`. Full route interpretation:
  [focused layout](selection-and-layout.md#focused-layout-body-699707a-e28e29-complete).

Next: MediaBar tail plus filmstrip and leftover-participant helper original
sources. No remote watch, native selection or media data is invoked/read.

## E30: completed slider, filmstrip sorting/renderer and camera pairing

User-supplied `30-filmstrip-and-slider-tail`:

- `122641`: offset 2,500 through end 3,874, complete tail. Native drag-end/
  render, DURATION versus VOLUME branches and animated grabber. No additional
  cleanup correction; source-verified currentWindow/global-window mismatch remains.
- `163432`: complete original 2,523. Exports Ay (filmstrip), i4 (sizing/sort hook),
  Vp (height 112). Native type/user/speaking sorting, local-camera reservation,
  10-second timer with cleanup, stable prior slots, limit 12; maps to native tile
  with selected state and COVER_LANDSCAPE. DASS guard requirements documented
  in [filmstrip contract](selection-and-layout.md#filmstrip-163432ayi4-and-leftover-helper-e30).
- `947580`: complete original 410, Cf leftover helper pairs native user camera
  and stream by actual native user IDs. Not a DASS identity/binding helper.

No component/media/listener/action was invoked. Next: bounded original factory
inventory of stream start/end sound names; no sound played and no event listeners.

## E31: broad cue/action inventory

User-supplied `31-stream-sound-inventory`. Six excerpts returned out of sixteen
candidate factories; six opaque. Sampled IDs: `40876` manager catalog,
`48345` overlay content protection, `95844` clips, `116956` stream analytics,
`130553` stream connection lifecycle, `157667` large UI.

First five matches are uppercase native actions, not audio cue API evidence.
`157667` includes lowercase `stream_started` at 831,834 and `stream_ended` at
831,862, a selector returning these before stream-viewer/user join/leave cues.
Beginning/state conditions/consumer are missing from the 330-char excerpts.
Do not infer cue timing or call native signaling actions from this inventory.

Next: lowercase cue-only inventory and a bounded selector context window.

## E32: four actual cue-name candidates and complete transition selector

User-supplied `32-stream-cue-selector`, original view. Four candidates:
`157667` transition selector; `458640` sound-name table (1,593 chars);
`598493` sound-preference UI (474,664); `696354` native mp3 module catalog (3,124).
Catalog/preference names are not direct playback evidence; no assets loaded.

Selector anchor at 831,833, returned window starts 829,833 and spans 2,800 chars.
It includes complete local `Mo`: b9 store-snapshot/transition hook, same-channel/
AFK/type gates, advertised-owner start/end policy and other join/leave cues.
See [cue selector contract](sounds-and-transitions.md#stream-cue-selector-mo-e32).
Actual native IDs/store values were never returned.

Next: resolve imported or local b9 helper and read bounded playback source.

## E33: local useSound helper and preference gate

User-supplied `33-stream-cue-playback`. No numeric b9 import; exactly one local
binding at 826,988. Window includes complete b9, neighboring mute/video/voice/
PTT cue selectors. b9 checks `iW.A.isSoundDisabled`, calls `b7.Ak` with default
0.4, updates prior snapshot, attaches `ef.ru` listener under useSound and detaches
on effect cleanup. Header resolves `b7=400492`; preference alias iW import needs
confirmation. No listener or sound was invoked by the probe.

Next: original playback API `400492` and preference alias iW binding/header.

## E34: complete host playback API and notification preferences

User-supplied `34-sound-api-and-preferences`: one iW import -> `803224`.
`400492` complete original 1,071: Ak current-pack playback/global disableSounds
gate, Qh constructor, aN pack-specific constructor. Uses `946261.WebAudioSound`,
soundpack mapping `458640`, current-pack store `312671`, global gate `351906`,
output constants `257645`. Returns sound object, optional playWithListener
callback/options; no native stream action in returned body.

`803224` original 2,186, first 1,100 returned. Native NotificationSettingsStore,
disableAllSounds/disabledSounds defaults and basic getters; exact isSoundDisabled
tail not yet captured. Playback does not itself perform this per-cue check.
See [host sound contract](sounds-and-transitions.md#host-sound-api-400492ak-e34).

Next: bounded preference tail, global gate header and sound-object cleanup
method inventory. No sound instantiated/played, settings read or changed.

## E35: notification/Streamer Mode gates and partial sound lifetime

User-supplied `35-sound-guards-and-lifecycle`:

- Complete preference tail (1,000–2,186) confirms isSoundDisabled = all-disabled
  OR cue-name list membership. Native notification-setting actions are source
  only; no preferences read/changed.
- `351906` header 1,100 of 2,472 identifies StreamerModeStore, getter disableSounds
  = enabled AND configured disableSounds. This is Ak's additional global gate.
- `946261` original length 2,916; header and stop/playWithListener excerpts.
  stop delegates destroyAudio; visible cleanup pauses/clears src/error callback,
  drops owned audio promise. No destroy/dispose method found by these anchors.
  Full pending-load/end handling remains open; no audio instantiated.

Next: complete sound object factory, then explicit manual Change/Cancel/Stop
observations. Source contracts and runtime acceptance remain separate.

## E36: complete sound-object factory and cleanup limitations

User-supplied `36-sound-object-complete`: original `946261`, 2,916 chars,
untruncated/nonopaque. HTML Audio native assets; output-volume multiplication,
embedded-host sink selection, normal onended cleanup confirmed in source.
Pending promise callbacks are not canceled by stop; no generation protection.
Load rejection handling and optional playWithListener timer/seconds mismatch
are limitations, not tested failures. See complete lifetime contract in
sounds-and-transitions.md. No audio constructed/played or devices enumerated by
the probe. Static sound tracing is sufficient for the current handoff; manual
Change/Cancel/Stop evidence remains outstanding.

## E37: Change Screen blocked; remembered replacement behavior

User cannot currently change source: strange notification, suspected Equibop
build change. No notification text/revision/cause established. Do not assume
build drift or a DASS issue (baseline DASS disabled). User recalls accepted
source replacement preserving UI/colors with no sound. Historical observation
only, not current cancellation/replacement acceptance. Overlay main-button stop
question needs clearer visual instructions; no stop result yet.

## E38: direct overlay stop and retained remote ended view

User confirms overlay main share button immediately stops publication: Go Live
card above Voice Connected disappears, controls return to normal color, stream
view disappears and end-stream cue plays. Exact teardown/cue ordering unmeasured.

User additionally reports native remote viewing retains a custom ended UI after
broadcaster stops. If viewer leaves that UI open, the same broadcaster returning
resumes viewing without further click. User observation, not fresh remote GUI
test or source-confirmed mechanism. Retained watch identity, placeholder export,
new-session matching, close/context-exit behavior and authorization remain to
trace. Do not equate retained viewing intent with retaining ended media tracks.

## E39: native ENDED player branch

User-supplied `37-ended-stream-branch`, original `802867`, length 6,768.
Complete ei at 4,343: looks up active stream with
getActiveStreamForUser(user.id, stream.guildId); ENDED routes to `U.A` with
selected, active stream, width. Hidden/failed/player/preview paths are separate;
privacy-hidden branch precedes ENDED. This proves a dedicated ended component,
not auto-resume ownership. Import U binding outside returned header; next probe
resolves it without invoking factories/watch callbacks. Native identity lookup
must not be copied as DASS authorization or faked to mount connected ei.

## E40: complete ended placeholder `566331.A`

User-supplied probe 38 resolves U -> `566331`, complete original 1,061 chars.
Props destructure stream,width; selected supplied by parent is unused here.
Native channel lookup and `964486.Ay` effect invoke `401843.Xi(streamKey,false)`
for Stage voice. Visible button stops propagation then invokes Xi(streamKey).
No start/watch/resume callback in this component body.

Presentation: forced ONYX native theme provider `43990.N`, art CSS `2753`,
width buckets <550 small/<1000 medium/otherwise large, native `297264.D` heading
and `821609.$` secondary button. Intl keys Kb4Ukp (heading) and 4EGMWL (button)
are coordinates only; actual localized text not yet collected. No fabricated
stream/native action allowed for DASS reuse; narrow actual-component seam must
bypass channel/effect/key parsing and replace close callback. Auto-resume still
requires separate retained-state/participant/transport source evidence.

## E41: ended dismissal is STREAM_CLOSE

User-supplied probe 39, original `401843`, 3,098 chars. Xi -> local U at
1,812; complete function dispatches STREAM_CLOSE with streamKey and
canShowFeedback default true. Stage-ended component passes false. This is a
native state/media action, not a safe DASS dismissal callback. No action invoked.
Action header resolves active-stream store `616356.A`; next inspect its
create/delete/close handlers for retained ended state and returning streams.

## E42: retained ENDED record versus explicit close

User-supplied probe 40, original `616356`, length 7,847. Active records Map i;
helper w deletes a key. STREAM_DELETE sets ENDED by default, RECONNECTING for
unavailable, FAILED for unauthorized (other reason-specific branches visible).
ENDED record removed only when key != v. STREAM_CLOSE unconditionally removes
record via w. v initialization null visible; its assignment/meaning still next.
STREAM_CREATE and STREAM_UPDATE both use local x. RTC_CONNECTION_STATE ignores
ENDED records, so RTC changes alone do not demonstrate native resumption.
getActiveStreamForUser can fall back to an active record matching ownerId;
do not adopt this native fallback as DASS room authorization. No live data read.

## E43: selection retains ended key; create/update restores presentation

User-supplied probe 41, original `616356`. Complete local x writes parsed key
identity with PAUSED/ACTIVE and metadata on STREAM_CREATE/UPDATE, replacing the
Map record. STREAM_WATCH separately writes CONNECTING. getAllActiveStreams
returns all Map records behind native capability gate, not only ACTIVE entries.
CHANNEL_RTC_SELECT_PARTICIPANT assigns v=id and deletes ENDED records whose key
differs from selected id. Thus selected ended record can persist and later
same-key create/update replaces its ended state without a new UI click.
This is source support for presentation restoration, not proof of new media
connection/authorization. Final reset handlers and connection-manager create/
delete handling remain next. No methods/actions invoked.

## E44: remote selfStream return invokes Watch from ENDED

User-supplied probe 42, original `130553`, 4,570. Complete visible
handleVoiceStateUpdates checks remote users with nonnull channel, tries helper
x when selfStream true, otherwise finds active record in same channel. For
selfStream true and ENDED, cancels key's L timer, finds current advertised
stream, rejects absent/marked-full and invokes `401843.A9(stream)`.
Non-streaming/non-ENDED branch starts three-minute delayed Xi(key,false).
Do not infer ended view lifetime from that conditional timer alone.

Create clears a timer/full markers and local-owner notification logic; update
clears timer and optionally resets native media statistics. STREAM_FULL delete
can notify/close. Explicit close stops both L/y timers. Store tail confirms
Map resets on CONNECTION_OPEN, CONNECTION_CLOSED, LOGOUT; selected-key v reset
is not shown in U, so do not assert every scalar resets there.

Native re-watch source supports E38 automatic return observation, distinct from
same-key ACTIVE presentation update. Preceding helper x/Watch guards still need
bounded context before documenting complete trigger ordering. No watch/session
action invoked; no remote playback acceptance performed.

## E45: initial auto-watch versus retained-ended resume; Watch boundaries

User-supplied probe 43, original helper x in `130553`: same voice channel,
DM or Guild Stage only, no active record for owner, advertised stream exists,
not last attempted key M/not marked full -> A9(stream,{noFocus:true}). Retained
ENDED record is an active Map record for this lookup, preventing this initial
auto-watch helper; E44 subsequent ENDED branch owns explicit return watch.

`401843.v`/A9: remote-session guard, guild voice-channel helper D, key derivation,
allowMultiple from option or >=2 other-owner active records, STREAM_WATCH,
guild-associated helper call, conditional selectParticipant. noFocus suppresses
selection unless forceFocus true; allowMultiple also suppresses ordinary focus.
These are native transport/context actions, never DASS presentation callbacks.
Manager STREAM_WATCH starts timeout, stops L timer, and if not allowMultiple
stops other remote records. No actions invoked. Static tracing of ended/resume
is sufficient for handoff; no new remote GUI acceptance or backend auth evidence.

## E46: idle source-picker cancellation

User reports nothing changes after canceling source picker while idle, except a
notification beginning: "Screen capture failed, was canceled or overlaps another
capture. If shar..." (user-supplied truncated text; remainder unknown).
In response to requested card/tile/color/cue check, no active UI or sound change
reported. Do not classify the generic failure/cancel/overlap wording as proof of
overlapping capture, changed build or permission failure. No track/audio leak
inspection or host settings-picker cancellation acceptance established.

## E47: host settings-picker cancellation

User reports nothing changes when canceling Equibop resolution/framerate/audio
dialog after choosing a source, except the same notification recorded in E46.
No active UI or cue reported. This is manual visible cancellation evidence,
not track/audio cleanup or DASS interception acceptance. Both picker cancellation
surfaces now have user observations; source replacement remains blocked.

## E48: interactive sandbox preflight

User-supplied probe 44: host createElement/useState/createRoot functions present;
Share/split/frame/LIVE/card action/secondary button cached as functions; idle
context cached object. Complete original `461782` source 941 chars shows no-op
defaults and owned provider Set/timer/effect cleanup. Does not inspect current
context values or mount anything. Scope now includes user-requested removable
presentation sandbox; script 45 has mock-owned state/callbacks, no stream events,
capture/watch/sounds. Its actual runtime rendering remains pending user result.

## E49: first native-component preview accepted; sidebar distinction corrected

User calls script 45 pretty good apart from intentionally missing menu styling.
Reports Base Share lacks green background expected near Voice Connected. Script
45 base is actual non-split overlay Share, not sidebar connected owner or styled
sidebar Button; this is a coverage/labeling distinction, not proof a native
sidebar style is broken. Individual transition/a11y/cleanup outcomes not separately
enumerated. E03 already maps sidebar CSS va -> `187529`; E02 active classes
x6/Sq/rK, native Button `862482.$n` and animated hook `416696.c` supply the next
temporary test. Script 46 composes those actual primitives without native owner
stores/actions. Native green styling acceptance remains pending its result.

## E50: actual sidebar selected styling accepted

User confirms script 46 active green background matches real sidebar button.
This validates primitive/native CSS composition visually in this session,
not connected owner/menu or all a11y/hover/disabled/layout behavior. Active
sidebar opens Stop Streaming/Change Screen menu; user reiterated this contract.
Mock action list is incomplete and is not native menu reuse acceptance.

## E51: in-call mock placement preflight

User-supplied probe 47. Selected node/parent: 1,207x239; parent positioned
relative; ancestor 4 is 1,207x1,015 and may cover other UI. Select parent index 1
for isolated diagnostic overlay, not broad ancestor. Native Frame/LIVE cached.
Complete original `272812` 317 chars: children/className/style/noBorder/ref/
optional participantUserId -> div with native frame classes and data-call-tile.
No connected media/watch/identity lookup in body. Do not supply user ID.

Script 48 pending acceptance: separately owned overlay root in user-selected
strip, actual frame/LIVE/button exports with generated pattern/local wide/end/
return/source state. Not native participant/grid/focus/ended/media integration.
Cleanup removes only owned nodes and disconnects observer; detachment triggers
cleanup. No native container styles modified or children reparented.

## E52: mounted controller render and complete callback grid

User-supplied probe 49: controller instance extensible, inherits render,
forceUpdate present; complete mounted render 1,421 chars. Call theme/container
and native idle provider render children via this.renderContent; other siblings
include resizer/chat. Do not rewrite entire controller or disturb those paths.
Original callback grid `511205` complete 1,403: children callback array length
drives tile count/virtualized rows/columns/width; invokes each callback with tile
width; optional keyExtractor(index). No participant parameter/store lookup in
this grid body. Mock must branch at pure callback boundary, not connected
participant consumer. Probe 50 next inspects renderContent, connected grid and
DevTools renderer override capabilities. No methods invoked/mutations yet.

## E53: renderContent central route and no renderer props override

User-supplied probe 50: complete mounted renderContent 2,487, inherited method;
inCall true, VIDEO false, no selected participant. It returns actual call shell
er.A with native header/bottom/effect callbacks and central en.A element; Stage,
guild-room/app surfaces and hidden-channel paths are separate and must not be
adapted blindly. Central element receives authentic native participants and
dimensions. Original `526369` complete 2,116: maps derived real participants to
`175203.Ay` render callbacks; native callback grid `511205` consumes resulting
children/keyExtractor, with paddingTop/Bottom 64. Connected grid also runs
permission/activity/impression logic; do not feed it fabricated participants.

React DevTools hook exists, renderer 1 lacks overrideProps/scheduleUpdate.
Candidate approach is instance-only renderContent wrapper retaining shell,
central native grid with genuine native tile callbacks plus isolated mock
callback. This would remount central tiles, not mutate native participant stores;
requires idle no-media/context guards, precise restore and runtime acceptance.
Probe 51 next checks root source and allowlisted participant/media-shape flags.

## E54: idle voice guard passes; complete native root

User-supplied probe 51: inCall/VOICE true; two participants, zero stream payloads/
streamIds/active streams/activities; no selection/pending session/guild room/
popout. Generic native tile export is React wrapper object, callback grid function,
tile CSS available. Complete `874739` 1,742: VOICE routes voice surface before
VIDEO grid/focus. VIDEO grid uses native Flex `235986.A`, CSS `804273.HA/g9`,
connected grid with real filtered participants. Native selection/focused branch
cannot consume mock participant safely; root itself includes effects/stores.

Script 52 pending user acceptance: actual central React-tree replacement through
instance-only renderContent wrapper, preserving original call shell and controls,
native Flex/callback grid/genuine participant tiles plus independent mock frame.
May remount central genuine tiles; restricted to idle no-media voice context.
No fake participant objects/stores/keys/native watch dispatch. Mock solo/end/
return are local grid projection, not connected native focus/ended acceptance.

## E55: actual-grid mock works, complete stream component still requested

User reports script 52 creates a card and some behaviors appear, positively
accepting progress. Individual native grid sizing/solo/end/return/restoration
cases not separately enumerated. User clarifies desired target is complete
original Discord Streaming Component/Card, not mock frame-only content.
Do not call 52 full stream-tile reuse or media/focus/ended compatibility evidence.

Next inspect loaded generic tile actual render subtree/dependency header for a
narrow original-presentation adaptation replacing native media/state/actions.
Native connected tile/player/quality/footer hazards from E19/E24–E30 remain
binding; no dummy native stream records or unmodified fake-participant mount.

## E56: loaded full tile composition versus original alias map

User-supplied probe 53: loaded tile function 5,485 chars; prefix/tail 2,285–end.
Stream path mounts actual `802867.A/D` player/overlay (mounted alias ev), while
outer native frame/clickable/effect/analytics/zoom wrappers and private footer
compose the full tile. Footer receives native identity/type/security/voice state;
hover may mount additional native debug stats. Merely reusing outer frame does
not reproduce this whole composition safely. Original factory header 1,600 of
12,010 has different aliases (stream module eT, frame ef, types e_, CSS eD etc.).
Do not bind mounted render-tail symbols using original header imports.
Probe 54 retrieves original private footer/helpers for safe presentation-seam
review; no component/factory/action invoked and no native mock records created.

## E57: complete original footer and native presentation helpers

User-supplied probe 54, original `175203`, footer start 7,945 through 12,010,
untruncated. Footer native identity/activity/decoration/auto-video/context-menu
subscriptions precede actual rendering. Stream presentation includes pure eR
computer/platform icon, eL tooltip/icon control, options and optional mute supplied
callbacks. Focused stream adds native zoom; popout branch native close/stay-top;
USER gift/application branches connected; secure verification separately rendered.
No dummy user/stream identity or native verification flags allowed for mock.

Source supports narrow presentation-only extraction with explicit mock inputs,
not unchanged connected footer mount. Keep actual JSX/classes/host helpers while
removing connected prefix/unsafe branches; audit width helpers and consistent
original outer-card render scope before any executable adaptation. Probe 55
reads those remaining source coordinates; no factory/component/actions invoked.

## E58: consistent original renderer, overlay and pure width thresholds

User-supplied probe 55: original outer render 4,869–6,630 complete, consistent
aliases with original footer/header. Native context/zoom/shake/frame/clickable,
media/overlay/footer/debug/confetti composition visible. Original overlay en at
3,890 reads native active stream and mounts connected quality/health components;
do not mount unchanged. Cached width helpers are pure <=124 (Yb), <=220 (VE),
<=160 (DO). No methods invoked.

Next executable test 56 extracts only original render body, pure icon/control
helpers and footer render, with connected footer prefix removed and native
zoom/popout branch disabled. Scoped cached dependency facades bypass analytics,
zoom, shaking effects/confetti; no registered factory/module/store mutation.
Original media/debug/voice-effect/account/avatar/identity paths not executed.
UI-only type/key goes only to isolated presentation; no fake native stream/user
records. Native verification forced false. Actual frame/clickable/footer styles,
computer/mute/options/icon controls retained; quality uses audited lower badges,
media/ended text/action list diagnostic. Not original connected component object
or complete native focused/ended/quality-animation acceptance.

## E59: addon dependency guard failure; CSS coordinate correction

User reports script 56's generic missing-dependencies message; addon did not
install. Investigation finds unverified player CSS ID 109294 in prototype was
incorrectly assigned without tracing Y binding from original `802867`. Corrected
script resolves unique Y import from original source, reads its cached export
only, and reports named missing dependencies/binding counts. Actual missing
list/new resolution remains pending user rerun; do not claim CSS fix alone proves
all guards or rendering pass. No native factories/stores/actions modified.

## E60: dependency check passes; source-coordinate guard fails

User reruns updated 56: "Native source coordinates changed. Nothing changed."
This means dependency gate passed but extraction coordinates did not; no addon
installed. Exact anchor/cause unknown, not evidence of build drift. Guard now
reports individually failed coordinates, source length and bounded head/tail
to distinguish stale naming from incorrect syntax anchors before changing code.

## E61: current tile source alias map differs

User supplies coordinate diagnostics: source length 11,975 versus earlier
12,010. Current header JSX t/React i/require s, exported Ay=eY; current tail
CallTileOverlay label remains ew, export eY=eU. Old name-based coordinates fail;
controlStart old eL now matches at 6,630 but role cannot be inferred from name.
Source difference established, cause/build revision not established. No addon
installed. Next probe 57 discovers imports by module role, footer by displayName,
pure helpers by prop signatures, then reads consistent current render/footer.
Do not repair with broad global renaming of minified identifiers.

## E62: current renderer/footer pair and updated extraction profile

User-supplied probe 57, source length 11,975. Complete current outer renderer
4,869–6,630 and footer 7,945–11,925; JSX t, React i, types eR, CSS e_, widths
eS, frame eE, title helper ej. Pure computer helper eL, icon control eP; footer
ew. Current generic props/derived locals differ from original 12,010-char view.
Both source families are now explicit reviewed mock-input profiles; coordinate
discovery uses imported module roles, helper prop signatures and footer display
name. Original render/helper text is not globally renamed.

Updated 56 removes current footer's connected prefix, disables its zoom/popout
branches, projects its title/callbacks and generates scoped bindings for this
profile. Unknown profiles fail before install. Local fixture using actual
user-returned current renderer/footer/helper bodies passed full render, title/
computer/options/mute, width gating, mock end and cleanup with native identity/
connected actions forbidden and UI dependencies stubbed. Real host compilation/
GUI acceptance remains pending. No production compatibility claim.

## E63: source-derived card visually close; behavior/menu gaps

User calls updated card "really good" and close to original. Reports mock solo
is weird and requires double click instead of standard behavior. This is not
native focus acceptance; mock callback-grid solo and event delivery need fixing.

Native baseline clarification: when stream ends in grid and is the only stream,
it disappears; "otherwise" ended custom UI appears. Selected/enlarged versus
multiple-stream grid and local publisher versus remote viewing context not yet
specified. E42–E45 source-selected-key retention still applies; do not replace
it with an unverified count-only rule or generalize local publishing stop.

User describes own-stream three-dot menu: Stop Streaming; Change Stream;
separator; Pop Out Stream; separator; More Options submenu with Show My screen
share checkbox, Pause Preview When Discord Isn't focused checkbox, Report a
Problem. Report must be omitted including hooks. Labels reflect user's wording,
not collected native intl text. Current inline action list is not this menu.
Next inspect original context-menu callback/native menu API availability and
clickable source without invoking native callbacks or creating native streams.

Source 56 review also finds both click and double-click mapped to the same mock
selection toggle. Double-click can therefore add an extra toggle to normal click
events. Removed double-click selection callback (not replaced with native
fullscreen). Single-click delivery and native focus integration remain pending;
do not claim this alone fixes all reported solo behavior.

## E64: enlarged ended-view clarification; native menu/click APIs available

User clarifies retained ended UI is for enlarged stream, with native ended text/
funny phrase (e.g. cricket noise) and custom image. Grid disappearance versus
enlarged retention, not count-only rule. Sender/viewer differences beyond this
statement remain unverified. Matches selected-key retention evidence E42–E45.

Probe 58: all five native Menu primitives and open/closeContextMenu functions
available. Clickable 730 chars directly forwards onClick/onDoubleClick and has
an inner button stopping propagation before forwarding click. No hidden watch
action at this primitive. Native controller stream context menu tracks impression,
holds idle and lazy-opens `744960` with stream/minimal/app context; never invoke
with mock stream. Fullscreen controller couples native selection/fullscreen;
also unsafe as mock callback. Use lower native menu primitives/owned callbacks.
No handlers invoked by probe. Original ended presentation and native focus
extraction remain separate from current placeholder/solo experiment.

## E65: native menu prototype broadly accepted; missing icons

User says updated native-menu presentation is "not bad" but misses a few icons.
Exact missing rows/icons and individual submenu/checkbox/close/cleanup outcomes
not specified. Record broad visual acceptance only, not complete menu parity.
Use actual audited host icon exports when completing decoration; no hand-drawn
lookalikes or connected menu handlers. Focus/ended integration remains open.

User identifies missing icon rows: Stop Streaming, Change Stream, Pop Out Stream,
More Options. Probe 59 next traces native 744960/context menu and 405916 self
action item/import sources; no module loading or action invocation.

## E66: owner menu icon references and truncated context-menu tail

User-supplied probe 59: complete 405916 item excerpts/header confirms Stop
Streaming icon `959988.G`, Change Stream icon `183623.F`; both native rows set
icon and leadingAccessory. Added these actual cached exports to mock menu.
Native `744960` original 4,195, first 3,200 returned; reads many native hooks
and report helper before rendering. Do not mount with fake stream. Popout item
helper resolves `810845.A`; remaining menu tail still needed for More Options
icon/composition. Probe 60 reads tail/helper and cached icon types, no actions.

## E67: popout icon traced; More Options has no explicit leading icon

User-supplied probe 60: `810845` complete 819, popout icon/leadingAccessory
`811893.t`. Helper has native watch/selection/popout/analytics actions; reuse
only icon export, never hook/action. `744960` tail completes 4,195-char factory:
minimal More Options item has children but no icon/leadingAccessory. Native menu
primitive supplies submenu indicator; do not invent a leading glyph or confuse
three-dot trigger icon with More Options row. Mock now includes popout cached
icon and exposes menuIcons availability flags without loading modules.
Popout action remains disabled. Actual icon/submenu-arrow GUI acceptance pending.

## E68: icons accepted; remote ownership gating and solo still wrong

User confirms icons okay. Remote stream must omit owner-only Stop Streaming,
Change Stream, More Options. Source 56 now defaults to explicit Viewer test mode,
with Owner mode button for owner-style menu; owner preview checkbox submenu and
mute-icon hiding stay scoped to mock role, not native user identity/settings.
Viewer mute changes visual mock boolean only; popout remains disabled.

User still reports solo messy. Current solo is callback-grid count reduction,
not native focused layout/filmstrip; removing duplicate double-click callback
did not establish correct focus. Next source 61 inspects current full 699707 and
566331 for safe focus/ended presentation seams, no fake native selection/media.

## E69: complete current native focus and ended template

User-supplied probe 61: `699707` 3,424 complete. Actual focus geometry/springs/
transition/cleanup/strip placement present; reads native current-user/media
component/activity, passes selected participant to native tile and camera-pair
helper. Do not mount unchanged with mock record. Proposed isolated dependency
adaptation must guard all those consumers and preserve genuine strip entries;
review current `163432`/strip toggle `80051` next via source 62.

`566331` 1,074 complete, changed aliases versus E40. Native ONYX/theme/artwork/
intl-ended/width buckets intact; connected channel/Stage close effect and native
Xi/key close action still unsafe. Future pure presentation extraction must omit
those actions and supply owned dismissal. No native focus/ended component
invoked, no fake native selection or media/session created.

## E70: current real-participant filmstrip and strip-control boundaries

User-supplied probe 62: `163432` complete 2,523. Sizing sorts/partitions native
participants using native names/current-user/local-camera flags and stabilized
slots; 10-second UI timer cleans up. Must receive genuine records only. Ay
renderer selected ID is compared for style; renderer also checks local self
video and maps to connected native generic tile. `80051` 1,105, first 1,100:
strip-control actual icons/base button and native toggleParticipants dispatch.
Never invoke that controller action for mock selection.

Prepared 63 addon instantiates fresh, isolated copies of inspected native focus/
ended modules with cached-only dependency facades (not registered factories).
Fake UI descriptor stays in generic layout/animation and guarded mock-tile path;
native current-user/media/activity/pairing/strip-toggle/remeasure consumers
bypassed. Filmstrip sizing/rendering receives genuine records only; selected ID
set null before real strip. Native ended channel/Stage effect/key close replaced
with owned dismissal. Geometry/springs/real strip/artwork/intl remain native.
Fixture passed guard routing, strip isolation, ended dismissal, observer cleanup;
host GUI remains untested. No native fullscreen/popout/audio integration claimed.
