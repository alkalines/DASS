/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { CallPresentation, isDassParticipant, participantTitle, projectParticipants, sliderPlaybackVolume } from "../../plugins/dass/callPresentation";
import { DISCORD_PRESENTATION_PATCHES } from "../../plugins/dass/discordAdapter";

const participants = projectParticipants([
    { key: "dass-local:call", kind: "local" },
    { key: "dass-remote:call:publisher", kind: "remote", share: { roomId: "call", shareId: "publisher", displayName: "Account" } }
]);

test("DASS selection is bounded by available shares, scoped to a call and independent of native stores", () => {
    const presentation = new CallPresentation();
    let updates = 0;
    const unsubscribe = presentation.subscribe(() => updates++);
    expect(isDassParticipant(participants[0])).toBe(true);
    expect(isDassParticipant({ type: 1, id: "native" })).toBe(false);
    expect(participantTitle(participants[0])).toBe("Your screen");
    expect(participantTitle(participants[1])).toBe("Account");
    expect(presentation.select("call", participants[0], participants)).toBe(true);
    expect(presentation.getSelected("call", participants)).toBe(participants[0]);
    expect(presentation.getSelected("other", participants)).toBeUndefined();
    expect(presentation.getSelected("call", [])).toBeUndefined();
    expect(presentation.select("call", participants[0], participants)).toBe(true);
    expect(presentation.getSelected("call", participants)).toBeUndefined();
    presentation.select("call", participants[1], participants);
    expect(presentation.select("call", { type: 2, id: "native" }, participants)).toBe(false);
    expect(presentation.getSelected("call", participants)).toBeUndefined();
    presentation.select("call", participants[0], []);
    expect(presentation.getSelected("call", participants)).toBeUndefined();
    expect(updates).toBe(4);
    unsubscribe();
    presentation.reset();
    expect(updates).toBe(4);
});

test("share audio has independent mute and nonlinear volume, without voice actions or amplification", () => {
    const presentation = new CallPresentation();
    presentation.setAudio(true, 50);
    expect(presentation.getAudio()).toEqual({ muted: true, sliderPercent: 50 });
    expect(sliderPlaybackVolume(50)).toBeCloseTo(0.1435873);
    expect(sliderPlaybackVolume(100)).toBe(1);
    expect(sliderPlaybackVolume(200)).toBe(1);
    expect(sliderPlaybackVolume(-1)).toBe(0);
    presentation.setAudio(false);
    expect(presentation.getAudio().sliderPercent).toBe(50);
    presentation.reset();
    expect(presentation.getAudio()).toEqual({ muted: false, sliderPercent: 100 });
});

test("ended shares lose selection, including when a new local capture later uses the same key", () => {
    const presentation = new CallPresentation();
    presentation.select("call", participants[0], participants);
    presentation.reconcile("other", []);
    expect(presentation.getSelected("call", participants)).toBe(participants[0]);
    presentation.reconcile("call", []);
    expect(presentation.getSelected("call", participants)).toBeUndefined();
});

const controllerSource = `let eK={[ez.BRT.POPOUT]:eW.SW,[ez.BRT.APP]:null,[ez.BRT.OVERLAY]:null,[ez.BRT.CALL_TILE_POPOUT]:null};
function eX(e){let{layout:t,channel:n,selectedParticipant:l,canChangeLayout:a,canInvite:s,onToggleChat:r,maybeLeaveFullScreen:o}=e;return l}
class eq {
handleSelectParticipant=(e,t)=>{let{channel:n,selectedParticipant:i,allActiveStreams:l,inCall:a,mode:s}=this.props;(0,eF.Ay)(e)&&(0,B.eo)(n,eb.A,eI.A,eN.A,V.default)[0]&&(j.default.selectVoiceChannel(n.id),0===l.filter(t=>(0,k._z)(t)===e.id&&t.state!==ez.XYD.ENDED).length&&(0,y.A9)((0,k.Iy)(e.id),{forceMultiple:t.shiftKey})),a&&s===ez._Of.VIDEO&&(i?.id===e.id?x.A.selectParticipant(n.id,null):x.A.selectParticipant(n.id,e.id))};
handleContextMenu=(e,t,l,a)=>{let{channel:s}=this.props;this.trackCallTileContextMenuImpression(e,eF.qs.STREAM)};
renderBottomLeft=()=>{let{layout:e,channel:t,selectedParticipant:n,inCall:l}=this.props,{canChangeLayout:a,canInvite:s}=this.viewProperties,r=e===ez.DUB.FULL_SCREEN?()=>{this._prevLayout=ez.DUB.NORMAL,this.handleFullScreen()}:this.handleToggleLayout;return!l||t.isGuildStageVoice()?null:(0,i.jsx)(eX,{layout:e,channel:t,selectedParticipant:n,canChangeLayout:a,canInvite:s,onToggleChat:r,maybeLeaveFullScreen:this.maybeLeaveFullScreen})};
renderBottomRight=()=>{let{currentUserId:n,selectedParticipant:l}=this.props;return(0,i.jsxs)(i.Fragment,{children:[null!=l&&l.type!==eF.lp.ACTIVITY&&l.user.id!==n?(0,i.jsx)(ep.A,{context:(0,eM.A)(l.type),userId:l.user.id}):null]})};
renderContent(){return(0,i.jsx)(en.A,{onSelectParticipant:this.handleSelectParticipant,onContextMenuParticipant:this.handleContextMenu,showParticipants:r})}
}
function eZ(e){let{channel:t}=e,g="app",j=!0,y=t.isGuildStageVoice();(0,Z.A)(y);let{participants:b,filteredParticipants:S,participantsVersion:R,mode:L,layout:M,participantsOpen:w,chatOpen:U,stageAudienceSidebarOpen:k,selectedParticipant:B}=(0,d.cf)([eP.A],()=>{let e=g===ez.BRT.POPOUT,n=eP.A.getMode(t.id),i=eP.A.getLayout(t.id,g);e&&(n=ez._Of.VIDEO);let l=n===ez._Of.VIDEO?i:ez.DUB.MINIMUM;e&&l!==ez.DUB.FULL_SCREEN&&(l=ez.DUB.NO_CHAT);let a=y?eP.A.getStageSpeakerParticipants(t.id):null,s=n!==ez._Of.VOICE?eP.A.getSelectedParticipant(t.id):null;return null==s||null==a||a.includes(s)||(s=null),{mode:n,layout:l,selectedParticipant:s,participants:a??eP.A.getParticipants(t.id),filteredParticipants:a??eP.A.getFilteredParticipants(t.id),participantsOpen:eP.A.getParticipantsOpen(t.id),chatOpen:eP.A.getChatOpen(t.id),stageAudienceSidebarOpen:y&&eP.A.getStageAudienceSidebarOpen(t.id),participantsVersion:eP.A.getParticipantsVersion(t.id)}},[g,t.id,y]),{selectedStream:Y}=(0,d.cf)([eg.A],()=>({selectedStream:null!=B?eg.A.getActiveStreamForStreamKey(B.id):null}),[B]);return(0,i.jsx)(eq,{channel:t,guild:K,hasConnectPermission:ee,participantsOpen:w,selectedStream:Y,mode:L,inCall:j,layout:M})}`;

const focusedSource = `function _(e){let t,{onSelectParticipant:n,onContextMenuParticipant:a,onFullscreenParticipant:_,participants:S,filteredParticipants:T,popoutType:R,inCall:O,channel:L,selectedParticipant:P,showParticipants:M=!0,className:w,width:U,height:D,layout:V,idle:G}=e,k=m.Ay.getVideoComponent(),B=p.default.getId(),X=P.type===I.lp.ACTIVITY,Z=!X&&null!=P.streamId;return{S,T,Z}}`;
const tileSource = 'let eU=i.memo(e=>{return native(e)});eU.displayName="CallTile";let ez=F.$,eY=eU';
const filmstripSource = 'function sort(e,t){switch(e.type){case p.lp.ACTIVITY:return`\\x01${e.sortKey}`;case p.lp.STREAM:return e.user.username}}function render(n){let[d,f]=(0,r.partition)(n,p.Xw);return[d,f]}';
const auxiliarySource = 'function s(e,t,n){return null==t||t.type===a.lp.ACTIVITY?[]:[t.type===a.lp.STREAM?e.find(e=>e.type===a.lp.USER&&e.id===t?.user.id&&e.id!==n&&(0,l.Ay)(e)):null,t.type===a.lp.USER?e.find(e=>e.type===a.lp.STREAM&&e.user.id===t?.user.id&&null!=e.streamId):null,t.id!==n?e.find(e=>e.type===a.lp.USER&&e.id===n&&(0,l.Ay)(e)):null].filter(i.Vq)}';

function patch(source: string, index: number) {
    for (const replacement of DISCORD_PRESENTATION_PATCHES[index].replacement) {
        const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
        expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
        source = source.replace(regex, replacement.replace);
    }
    return source;
}

test("connected call patch guards native effects before routing DASS selection and controls", () => {
    const source = patch(controllerSource, 0);
    expect(source).toContain("$self.CallView,{dassNativeComponent:eq");
    expect(source).toContain("dassVideoMode=ez._Of.VIDEO,dassPopoutContext=ez.BRT.POPOUT");
    expect(source.indexOf("selectCallParticipant")).toBeLessThan(source.indexOf("selectVoiceChannel"));
    expect(source).toContain("selectedStream:null!=$self.nativeParticipant(B)?");
    expect(source).toContain("selectedParticipant:$self.nativeParticipant(n)");
    expect(source).toContain("selectedParticipant:l,canChangeLayout:a,canInvite:s,onToggleChat:r,maybeLeaveFullScreen:o}=e");
    expect(source).toContain("onFullscreenParticipant:this.handleFullscreenParticipant");
    expect(source).toContain("let l=(dassCallVideo||n===ez._Of.VIDEO)?i:ez.DUB.MINIMUM");
    expect(source).toContain("[g,t.id,y,dassCallVideo]");
    expect(() => new Function("$self", source)).not.toThrow();
});

test("DM fullscreen uses the native saved layout while DASS is active, without changing the native mode", () => {
    const source = patch(controllerSource, 0);
    const jsx = (_component: unknown, props: { layout: string; mode: string; }) => props;
    for (const active of [false, true]) {
        for (const savedLayout of ["normal", "fullscreen", "noChat"]) {
            const dependencies: unknown[][] = [];
            const env = {
                ez: { BRT: { POPOUT: "popout" }, _Of: { VIDEO: "video", VOICE: "voice" },
                    DUB: { MINIMUM: "minimum", FULL_SCREEN: "fullscreen", NO_CHAT: "noChat" } }, eW: {},
                i: { jsx }, Z: { A: () => {} },
                d: { cf: (_stores: unknown[], read: () => unknown, deps: unknown[]) => { dependencies.push(deps); return read(); } },
                eP: { A: { getMode: () => "voice", getLayout: () => savedLayout, getParticipants: () => [], getFilteredParticipants: () => [],
                    getParticipantsOpen: () => false, getChatOpen: () => false, getParticipantsVersion: () => 1 } },
                eg: { A: {} }, K: null, ee: true
            };
            const render = new Function("env", "$self", `const {${Object.keys(env).join(",")}}=env;${source};return eZ;`)(env,
                { useHasGridShares: () => active, nativeParticipant: (value: unknown) => value });
            const result = render({ channel: { id: "dm", isGuildStageVoice: () => false } });
            expect(result.layout).toBe(active ? savedLayout : "minimum");
            expect(result.mode).toBe("voice");
            expect(dependencies[0]).toEqual(["app", "dm", false, active]);
        }
    }
});

test("executed DASS selection and context routing never reach native watch, stores or user reads", () => {
    const source = patch(controllerSource, 0);
    const routes: string[] = [];
    const adapter = { isDassParticipant, nativeParticipant: (value: unknown) => isDassParticipant(value) ? null : value,
        selectCallParticipant: (channelId: string, participant: unknown) => {
            expect(channelId).toBe("call");
            expect(participant).toBe(participants[1]);
            routes.push("select");
            return true;
        }, renderCallAudio: () => { routes.push("audio"); return "DASS audio"; } };
    const Controller = new Function("$self", `const ez={BRT:{},_Of:{VIDEO:"video"}},eW={};const i={jsxs:(_component,props)=>props};${source};return eq;`)(adapter);
    const controller = new Controller();
    controller.props = { channel: { id: "call" }, selectedParticipant: participants[1], currentUserId: "self" };
    controller.handleSelectParticipant(participants[1], {});
    controller.handleContextMenu(participants[1], {});
    expect(controller.renderBottomRight().children).toEqual(["DASS audio"]);
    expect(routes).toEqual(["select", "audio"]);
});

test("focused layout and filmstrip use DASS participants without native user/media assumptions", () => {
    const focused = patch(focusedSource, 1);
    expect(focused).toContain("=$self.useFocusedCallProps(e)");
    expect(focused).toContain("Z=!X&&null!=P.streamId||$self.isDassParticipant(P)");
    expect(() => new Function("$self", focused)).not.toThrow();
    const filmstrip = patch(filmstripSource, 3);
    expect(() => new Function("$self", filmstrip)).not.toThrow();
    const auxiliary = patch(auxiliarySource, 4);
    const auxiliaryFn = new Function("$self", `${auxiliary};return s;`)({ isDassParticipant });
    expect(auxiliaryFn([], participants[0], "self")).toEqual([]);
});

test("CallTile export routes to a DASS-owned component before native hooks mount", () => {
    const source = patch(`${tileSource}}`, 2);
    expect(source).toContain("eY=$self.wrapCallTile(eU)");
    expect(() => new Function("$self", `function factory(){${source}`)).not.toThrow();
});
