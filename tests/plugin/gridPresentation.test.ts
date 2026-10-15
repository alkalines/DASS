/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { DISCORD_SHARE_PATCHES } from "../../plugins/dass/discordAdapter";
import { gridShares, gridTileKeyExtractor } from "../../plugins/dass/gridPresentation";
import type { WatchStatus } from "../../plugins/dass/watching";

const idle: WatchStatus = { phase: "idle", message: "", candidates: [], shares: [] };
const share = { roomId: "call", shareId: "publisher", displayName: "DASS account" };
const directory: WatchStatus = { ...idle, phase: "ready", shares: [share] };

test("grid presentation is scoped, deduplicated and bounded without native stream records", () => {
    expect(gridShares("call", "call", true, true, directory, idle)).toEqual([
        { key: "dass-local:call", kind: "local" }, { key: "dass-remote:call:publisher", kind: "remote", share }
    ]);
    expect(gridShares("call", "other", true, true, directory, idle)).toEqual([]);
    expect(gridShares("call", "call", false, true, directory, idle)).toEqual([]);
    expect(gridShares("call", "call", true, false, { ...directory, phase: "unauthorized" }, idle)).toEqual([]);
    const pending = { ...idle, phase: "loading" as const, watchingShare: share };
    expect(gridShares("call", "call", true, false, directory, pending)).toHaveLength(1);
    expect(gridShares("call", "call", true, false, idle, pending)).toHaveLength(1);
    expect(gridShares("call", "call", true, false, idle, { ...pending, phase: "failed" })).toEqual([]);
    expect(gridShares("call", "call", true, false, { ...directory, shares: [{ ...share, roomId: "other" }] }, idle)).toEqual([]);
    const many = { ...directory, shares: Array.from({ length: 100 }, (_, index) => ({ ...share, shareId: `publisher_${index}` })) };
    expect(gridShares("call", "call", true, false, many, idle)).toHaveLength(64);
});

test("native grid keys and callbacks are untouched; only owned render callbacks have DASS keys", () => {
    const calls: number[] = [];
    const nativeKey = (index: number) => { calls.push(index); return `native-${index}`; };
    const render = () => { throw new Error("Key lookup must not render a tile"); };
    const owned = Object.assign(() => { throw new Error("Key lookup must not render a tile"); }, { dassTileKey: "dass-remote:call:publisher" });
    const tiles = [render, owned, render];
    const key = gridTileKeyExtractor(nativeKey, tiles);
    expect(key(0)).toBe("native-0"); expect(key(1)).toBe("dass-remote:call:publisher"); expect(key(2)).toBe("native-1");
    expect(calls).toEqual([0, 1]);
    expect(tiles[0]).toBe(render);
});

test("leftmost stream tiles do not shift native participant keys", () => {
    const owned = Object.assign(() => null, { dassTileKey: "dass-local:call" });
    const keys = gridTileKeyExtractor(index => ["alice", "bob"][index], [owned, () => null, () => null]);
    expect([keys(0), keys(1), keys(2)]).toEqual(["dass-local:call", "alice", "bob"]);
});

test("a previously watched share ends only after matching authenticated directory confirmation", () => {
    const closed: WatchStatus = { ...idle, phase: "disconnected", closedShare: share };
    const confirmed: WatchStatus = { ...directory, directoryRoomId: "call", shares: [] };
    const expected = [{ key: "dass-remote:call:publisher", kind: "remote", share, ended: true }];
    expect(gridShares("call", "call", true, false, confirmed, closed)).toEqual(expected);
    for (const unconfirmed of [idle, { ...confirmed, phase: "failed" as const },
        { ...confirmed, phase: "unauthorized" as const }, { ...confirmed, directoryRoomId: "other" },
        { ...confirmed, directoryRoomId: undefined }, { ...confirmed, shares: [share] }]) {
        const tiles = gridShares("call", "call", true, false, unconfirmed, closed);
        expect(tiles).toHaveLength(1);
        expect(tiles[0]).not.toHaveProperty("ended");
    }
    expect(gridShares("call", "call", false, false, confirmed, closed)).toEqual([]);
    expect(gridShares("call", "other", true, false, confirmed, closed)).toEqual([]);
    expect(gridShares("call", "call", true, false, confirmed, idle)).toEqual([]);
    expect(gridShares("call", "call", true, false, confirmed, { ...closed, phase: "unauthorized" })).toEqual([]);
});

const OBSERVED_GRID = 'function b(e){let{participants:t,onClick:n,onDoubleClick:b,onContextMenu:_,channel:S,className:T,inCall:R,totalNumberOfParticipants:O,popoutType:L}=e,P=(0,f.Us)()===E.BRT.POPOUT,M=(0,r.bG)([C.A],()=>C.A.getGuild(S.guild_id),[S.guild_id]),{dismissedActivityEntryPointTileChannel:w}=(0,N.P)(),U=(0,r.bG)([h.A],()=>h.A.getUserParticipantCount(S.id),[S]),D=(0,g.vp)(S.id,t),V=l.useCallback(()=>{(0,s.r)(()=>{N.P.setState({dismissedActivityEntryPointTileChannel:S.id})})},[S.id]);l.useEffect(()=>{null!=w&&S.id!==w&&(0,s.r)(()=>{N.P.setState({dismissedActivityEntryPointTileChannel:null})})},[S.id,w]);let G=(0,r.bG)([j.A],()=>S.isPrivate()||(0,A.K)(j.A,M,S),[M,S]),k=M?.afkChannelId===S.id,B=S.userLimit<=0||S.userLimit>1,F=(0,r.bG)([c.Ay],()=>c.Ay.getEmbeddedActivitiesForChannel(S.id).length<=0),z=(0,m.HX)(o.M.VC_TILE_ACTIVITIES_ENTRY_POINT),H=(0,d.et)(S.id)!==d.xy.CAN_LAUNCH,W=null!=w&&w===S.id,Y=D.map(e=>t=>(0,i.jsx)(I.Ay,{participant:e,channel:S,className:v.V,onClick:n,onDoubleClick:b,onContextMenu:_,inCall:R,width:t,popoutType:L},e.id));(0,u.A)({type:a.ImpressionTypes.VIEW,name:a.ImpressionNames.CHANNEL_CALL_VIDEO_GRID_VIEW,properties:{total_participants:O,can_invite:G,is_afk_channel:k,channel_user_limit:S.userLimit}},{trackOnInitialLoad:!0},[]);let $=F&&!H,[K,X]=(0,p._)();null!=M&&!k&&!S.isGuildStageVoice()&&(K?Y.push(e=>(0,i.jsx)(p.V,{width:e,handleClose:X},"clips-video-call-tile")):U>=2&&$&&!z&&!W?Y.push(e=>(0,i.jsx)(y.y,{channel:S,guild:M,width:e,inPopout:P,handleClose:V,userParticipantCount:U})):B&&1===U&&G&&Y.push(e=>(0,i.jsx)(y.y,{channel:S,guild:M,width:e,inPopout:P,handleClose:V,userParticipantCount:U,activitiesEnabled:$})));let q=l.useCallback(e=>D[e]?.id??"empty-tile",[D]);return(0,i.jsx)(x.A,{className:T,keyExtractor:q,paddingTop:64,paddingBottom:64,children:Y})}';
const OBSERVED_ROOT = 'e=>{let{participants:t,filteredParticipants:n,selectedParticipant:s,participantsVersion:j,layout:y,onSelectParticipant:I,onContextMenuParticipant:N,onFullscreenParticipant:E,channel:v,hasConnectPermission:b,className:_,inCall:S,showParticipants:T=!0,width:R,height:O,idle:L,mode:P,popoutType:M,awaitingRemoteSessionInfo:w,callContainerDimensions:U}=e;l.useEffect(()=>{u._.dispatch(x.jej.REMEASURE_TARGET)},[R,O,U.width,U.height]);let D=l.useMemo(()=>n.filter(e=>e.type!==g.lp.ACTIVITY||!e.participants.some(e=>(0,r.S)(e))),[n,j]),V=(0,a.bG)([o.A],()=>o.A.getVoiceParticipantsHidden(v.id),[v.id]);if(w?.channelId===v.id)return(0,i.jsx)(p.A,{height:O});if(v?.isGuildVocalOrThread()&&!S)return(0,i.jsx)(h.A,{channel:v,participants:t,hasConnectPermission:b});if(n=S?n:t,P===x._Of.VOICE)return(0,i.jsx)(c.A,{guildId:v.guild_id,width:R,className:C.Er,participants:t,onContextMenu:N});if(null==s){if(0===n.length){let e=t.length>0&&!V;return(0,i.jsx)(f.A,{channelId:v.id,allPoppedOut:e})}return(0,i.jsx)(d.A,{className:C.HA,justify:d.A.Justify.CENTER,align:d.A.Align.CENTER,children:(0,i.jsx)(m.A,{channel:v,className:C.g9,participants:D,totalNumberOfParticipants:t.length,onClick:I,onDoubleClick:E,onContextMenu:N,inCall:S,popoutType:M})})}return(0,i.jsx)(A.A,{onFullscreenParticipant:E,onContextMenuParticipant:N,onSelectParticipant:I,selectedParticipant:s,filteredParticipants:D,participants:t,popoutType:M,className:_,idle:L,height:O,width:R,layout:y,inCall:S,channel:v,showParticipants:T})}';

function applyPatch(source: string, index: number) {
    const patch = DISCORD_SHARE_PATCHES[index];
    expect(patch.group).toBe(true);
    for (const replacement of patch.replacement) {
        const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
        expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
        source = source.replace(regex, replacement.replace);
    }
    return source;
}

test("grid patches match the supplied renderers once and preserve native participant data", () => {
    const grid = applyPatch(OBSERVED_GRID, 3);
    expect(grid).toContain("Y=$self.useGridTiles(S.id,D.map(");
    expect(grid).toContain("keyExtractor:$self.gridTileKeyExtractor(q,Y)");
    expect(grid).toContain("participant:e,channel:S,className:v.V,onClick:n,onDoubleClick:b,onContextMenu:_");
    expect(() => new Function("$self", `return ${grid}`)).not.toThrow();
    const root = applyPatch(OBSERVED_ROOT, 4);
    expect(root.indexOf("useHasGridShares")).toBeLessThan(root.indexOf("if(w?.channelId"));
    expect(root).toContain("if(null==s||dassShowStreamGrid&&dassVoiceGrid)");
    expect(() => new Function("$self", `return ${root}`)).not.toThrow();
});

test("stream store factories cannot consume the call-grid patch", () => {
    const find = DISCORD_SHARE_PATCHES[4].find;
    const regex = new RegExp(typeof find === "string" ? find : find.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
    expect(regex.test("getVoiceParticipantsHidden(e){return hidden[e]}" )).toBe(false);
    expect(regex.test(OBSERVED_ROOT)).toBe(true);
});

test("only DASS presentation switches idle voice layout to the grid; selected native video and native data stay unchanged", () => {
    const source = applyPatch(OBSERVED_ROOT, 4);
    const jsx = (component: unknown, props: any) => ({ component, props });
    const env = { l: { useEffect: () => {}, useMemo: (fn: () => unknown) => fn() },
        a: { bG: (_stores: unknown[], fn: () => unknown) => fn() }, o: { A: { getVoiceParticipantsHidden: () => false } },
        g: { lp: { ACTIVITY: 3 } }, i: { jsx }, x: { _Of: { VOICE: "voice" } }, c: { A: "voice" },
        C: {}, d: { A: { Justify: { CENTER: 0 }, Align: { CENTER: 0 } } }, m: { A: "grid" }, A: { A: "selected" }, f: { A: "empty" } };
    const build = new Function("env", "$self", `const {${Object.keys(env).join(",")}}=env; return ${source}`);
    const props = { participants: [{ type: 2, id: "native_user" }], filteredParticipants: [{ type: 2, id: "native_user" }],
        channel: { id: "call", isGuildVocalOrThread: () => true }, inCall: true, mode: "voice", callContainerDimensions: {}, selectedParticipant: { type: 2 } };
    const native = build(env, { useHasGridShares: () => false })(props);
    expect(native.component).toBe("voice");
    expect(native.props.participants).toBe(props.participants);
    const dass = build(env, { useHasGridShares: () => true })(props);
    expect(dass.props.children.component).toBe("grid");
    expect(dass.props.children.props.participants).toEqual(props.filteredParticipants);
    expect(dass.props.children.props.participants[0]).toBe(props.filteredParticipants[0]);
    const selected = build(env, { useHasGridShares: () => true })({ ...props, mode: "video" });
    expect(selected.component).toBe("selected");
    expect(selected.props.selectedParticipant).toBe(props.selectedParticipant);
});
