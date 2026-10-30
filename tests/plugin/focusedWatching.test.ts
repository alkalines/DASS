/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";

import { isFocusedDassWatch, projectParticipants } from "../../plugins/dass/callPresentation";
import { DISCORD_PRESENTATION_PATCHES } from "../../plugins/dass/discordAdapter";
import type { WatchStatus } from "../../plugins/dass/watching";

const share = { roomId: "call", shareId: "publisher" };
const participant = projectParticipants([{ key: "dass-remote:call:publisher", kind: "remote", share }])[0];
const watching: WatchStatus = { phase: "watching", message: "", shares: [], candidates: [], watchingShare: share, stream: {} as MediaStream };

test("only the focused, actually received remote share owns Stop Watching", () => {
    expect(isFocusedDassWatch(participant, [watching], "call")).toBe(true);
    for (const selected of [undefined, { type: "user" }, projectParticipants([{ key: "local", kind: "local" }])[0]]) {
        expect(isFocusedDassWatch(selected, [watching], "call")).toBe(false);
    }
    expect(isFocusedDassWatch(participant, [watching], "other")).toBe(false);
    expect(isFocusedDassWatch(participant, [{ ...watching, stream: undefined }], "call")).toBe(false);
    expect(isFocusedDassWatch(participant, [{ ...watching, watchingShare: { ...share, shareId: "other" } }], "call")).toBe(false);
    for (const phase of ["loading", "ready", "failed", "disconnected", "unauthorized"] as const) {
        expect(isFocusedDassWatch(participant, [{ ...watching, phase }], "call")).toBe(false);
    }
    // Another live watch elsewhere does not make an unwatched selection focused.
    expect(isFocusedDassWatch(participant, [{ ...watching, watchingShare: { ...share, shareId: "other" } }, { ...watching, phase: "loading" }], "call")).toBe(false);
    expect(isFocusedDassWatch(participant, [{ ...watching, watchingShare: { ...share, shareId: "other" } }, watching], "call")).toBe(true);
});

const controlSource = `function control(e){let{currentUser:n,onDisconnectCall:t,channel:s,connectedEmbeddedActivity:a}=e,o=e.nativeParticipant,j=e.nativeWatching,y=false,O=null,E=e.nativeStream,N=e.nativeStreams,r=null,M=l.useCallback(()=>o?.type===ep.lp.ACTIVITY&&o.applicationId===a?.applicationId?"ACTIVITY":j||y?"STREAM":null!=O?"EVENT":"CALL",[o,a?.applicationId,j,y,O]),[D,V]=l.useState(M()),w=l.useCallback(()=>{if(null!=E)(0,C.vN)((0,L._z)(E));else for(let e of N)(0,C.vN)((0,L._z)(e))},[N,E]);return(0,i.jsx)(A.Y,{targetElementRef:r,renderPopout:()=>null,children:D==="STREAM"?(0,i.jsx)(ee.h,{onClick:()=>w(),onPopoutClick:N.length>1?nativePopover:null,isSelfStream:!1}):D==="CALL"?(0,i.jsx)(J.A,{onClick:()=>t?.()}):{component:D}})}`;

function patchedControl() {
    const patch = DISCORD_PRESENTATION_PATCHES.find(p => p.find === "CenterControlTray: currentUser cannot be undefined");
    if (!patch) throw new Error("Missing focused watch patch");
    let source = controlSource;
    for (const replacement of patch.replacement) {
        const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
        expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
        source = source.replace(regex, replacement.replace);
    }
    return source;
}

test("native Stop Watching routes to DASS without touching native streams or voice; other branches stay native", () => {
    for (const focused of [false, true]) {
        const calls: string[] = [];
        const jsx = (component: string, props: Record<string, unknown>) => ({ component, props });
        const env = {
            l: { useCallback: (callback: unknown) => callback, useState: (value: unknown) => [value, () => {}] },
            ep: { lp: { ACTIVITY: "activity" } }, i: { jsx }, A: { Y: "popout" }, ee: { h: "stop-watching" }, J: { A: "disconnect" },
            C: { vN: () => calls.push("native-stream-stop") }, L: { _z: (stream: unknown) => stream }, nativePopover: () => {}
        };
        const adapter = { useFocusedWatchingState: () => focused, stopFocusedWatching: (channel: string) => calls.push(`dass:${channel}`) };
        const render = new Function("env", "$self", `const {${Object.keys(env).join(",")}}=env;${patchedControl()};return control;`)(env, adapter);
        const base = { currentUser: {}, channel: { id: "call" }, nativeStreams: [{}, {}], onDisconnectCall: () => calls.push("voice") };
        const rendered = render(base).props.children;
        expect(rendered.component).toBe(focused ? "stop-watching" : "disconnect");
        rendered.props.onClick();
        expect(calls).toEqual(focused ? ["dass:call"] : ["voice"]);
        calls.length = 0;
        const nativeWatch = render({ ...base, nativeWatching: true, nativeStream: {} }).props.children;
        nativeWatch.props.onClick();
        expect(calls).toEqual(focused ? ["dass:call"] : ["native-stream-stop"]);
        if (focused) expect(nativeWatch.props.onPopoutClick).toBeNull();
        const activity = render({ ...base, nativeParticipant: { type: "activity", applicationId: "app" }, connectedEmbeddedActivity: { applicationId: "app" } }).props.children;
        expect(activity.component).toBe(focused ? "stop-watching" : "ACTIVITY");
    }
});
