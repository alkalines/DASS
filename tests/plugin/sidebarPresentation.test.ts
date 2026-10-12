/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DISCORD_PRESENTATION_PATCHES } from "../../plugins/dass/discordAdapter";
import { sidebarActionProps, type SidebarState, stopSidebarStream } from "../../plugins/dass/sidebarPresentation";

const source = `function nv(e){let{streamMetadata:t,accountLinkUpsellTargetRef:n,streamQualityIndicator:i}=e,{title:a,sanitizedTitle:s}=(0,eq.A)(t);return(0,r.jsxs)("div",{className:nm.cm,ref:n,children:[(0,r.jsx)(eQ.A,{title:s,icon:t?.sourceIcon}),(0,r.jsxs)("div",{className:nm.pq,children:[(0,r.jsx)(th.A,{children:a}),null!=i&&(0,r.jsxs)("div",{className:nm.qi,children:[(0,r.jsx)(I.t,{size:"xxs",color:eM.k0.PREMIUM_TIER_2}),(0,r.jsx)(e8,{className:nm.s,variant:"text-xxs/semibold",children:i})]})]})]})}
let t6=a.memo(function(e){let{stream:t,canGoLive:i,canGoLiveActivity:s=!1,guildId:l,isStreaming:o,channel:c,canStream:u,runningGame:A,embeddedActivity:f,frame:I,activity:p,application:m,analyticsContext:g,inviteButtonRef:S,accountLinkButtonRef:N,startAuthorization:C,canStartAuthorization:O,hasAlreadyLinked:R,connectionApp:L}=e,D="panel",Z=!1,z=a.useCallback(()=>{(0,tz.A)(t)},[t]),eo=function(){let e,t,n;if(null==A&&null!=f&&!activityEnabled()&&!Z||!o&&!i)return null;let a=null;return o?(e=!1,t=()=>{z(),(0,ef.X)(D,ef.O.STREAM,!1)},n=tp.G,a=q.intl.string(q.t.S5anIc)):u?(e=!1,t=nativeStart,n=tT.F,a="Share"):(e=!0,t=null,n=tT.F),(0,r.jsx)("div",{className:t2.IF,children:(0,r.jsx)(tM.A,{tooltipText:a,disabled:e,onClick:t,icon:n})})}(),eu=null,e_=null,eE=null,es=null,ec=null,el=null,eA=null;return(0,r.jsxs)("div",{className:t2.o1,children:[eE??es??ec,el,(eu??e_)==null?(0,r.jsx)(tG,{isActivity:null==A&&null!=I&&I.intent!==t1.sV.MAIN}):null,eo,eu??e_,eA]})});
function nb(e){let{guildId:t,analyticsContext:n,className:i}=e,s=a.useRef(null),o=a.useRef(null),d=a.useRef(null),eg=nativeBody,S=nativeStream,B=!1,k=!1,H=nativeStreaming,m=null,U=!1,A=null,V=null,G=null,R=null,b=null,ea=null,ei=null,Z=!1,q=!1,Q=null,eh=null,ef=null,ee=null,en=!1,ec=null,z=null,X=null;return null==eg?null:(0,r.jsx)("div",{className:l()(nm.nd,i),ref:s,children:(0,r.jsxs)("div",{className:nm.rf,children:[eg,(0,r.jsx)(t6,{stream:S,canGoLive:B,canGoLiveActivity:k,guildId:t,isStreaming:H,channel:m,canStream:U,runningGame:A,activity:V,application:G,embeddedActivity:R,frame:b,analyticsContext:n,inviteButtonRef:d,accountLinkButtonRef:ea,canStartAuthorization:q,startAuthorization:ei,hasAlreadyLinked:Z,connectionApp:Q}),(0,r.jsx)(nR,{popover:eh,dismissPopover:ef,application:G,connectionApp:Q,activity:V,runningGame:A,hasAlreadyLinked:Z,didStartAuthorization:en,startAuthorization:ei,accountLinkUpsellTargetRef:o,activityPopoutTargetRef:s,inviteButtonRef:d,accountLinkButtonRef:ea,gameCommunityGuildId:ec,parentAnalyticsLocation:z,analyticsLocations:X,analyticsContext:n})]})})}`;

function patched(input = source) {
    for (const replacement of DISCORD_PRESENTATION_PATCHES[5].replacement) {
        const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
        expect([...input.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
        input = input.replace(regex, replacement.replace);
    }
    return input;
}

test("native card patches preserve the original frame, source icon, title, stop button and localized tooltip", () => {
    const result = patched();
    expect(() => new Function("$self", result)).not.toThrow();
    expect(result).toContain("$self.setNativeSidebarBody(nv);function nv");
    expect(result).toContain("className:l()(nm.nd,i)");
    expect(result).toContain("className:nm.rf");
    expect(result).toContain("(0,r.jsx)(eQ.A,{title:s,icon:t?.sourceIcon})");
    expect(result).toContain("(0,r.jsx)(th.A,{children:a})");
    expect(result).toContain("n=tp.G,a=q.intl.string(q.t.S5anIc)");
    expect(result).toContain("(0,r.jsx)(tM.A,{tooltipText:a,disabled:e,onClick:t,icon:n})");
    expect(result).not.toContain("vc-dass-sidebar-card");
    expect(() => new Function("$self", patched(source.replace(/\bnv\b/g, "renamedBody").replace(/\bt6\b/g, "renamedActions")))).not.toThrow();
});

test("action projection carries no fake stream or native metadata and leaves ordinary native props untouched", () => {
    const nativeProps = { stream: { ownerId: "native" }, runningGame: { id: "game" }, embeddedActivity: { id: "activity" },
        canStartAuthorization: true, isStreaming: false, guildId: "guild" };
    expect(sidebarActionProps(nativeProps, undefined)).toBe(nativeProps);
    const state: SidebarState = { metadata: { sourceName: "Screen" }, stop() {} };
    const props = sidebarActionProps(nativeProps, state);
    expect(props.stream).toBeNull();
    expect(props.runningGame).toBeNull();
    expect(props.embeddedActivity).toBeNull();
    expect(props.canStartAuthorization).toBe(false);
    expect(props.isStreaming).toBe(true);
    expect(props.dassStop).toBe(state.stop);
    expect(nativeProps.stream.ownerId).toBe("native");
    expect(props.guildId).toBe("guild");
});

test("DASS stop never invokes native stream stop; ordinary native stop retains its callback", () => {
    const calls: string[] = [];
    const stopNative = () => calls.push("native");
    stopSidebarStream(() => calls.push("dass"), stopNative);
    expect(calls).toEqual(["dass"]);
    stopSidebarStream(undefined, stopNative);
    expect(calls).toEqual(["dass", "native"]);
});

test("executed native sidebar keeps its renderer and mounts only its original body and stop action for DASS", () => {
    for (const active of [false, true]) {
        const calls: string[] = [];
        let registeredBody: unknown;
        const state: SidebarState = { metadata: { sourceName: "Screen" }, stop: () => calls.push("DASS stop") };
        const jsx = (component: unknown, props: Record<string, unknown>) => ({ component, props });
        const env = {
            a: { memo: (component: unknown) => component, useRef: () => null, useCallback: (fn: unknown) => fn },
            r: { jsx, jsxs: jsx }, l: () => (...classes: unknown[]) => classes,
            nm: { nd: "native-card", rf: "native-card-inner", cm: "native-body", pq: "native-title-area" },
            t2: { o1: "native-actions", IF: "native-button-wrapper" },
            eq: { A: (metadata: { sourceName?: string; }) => ({ title: metadata.sourceName ?? "Screen share", sanitizedTitle: "Screen" }) },
            eQ: { A: "native-source-icon" }, th: { A: "native-title" },
            tM: { A: "native-button" }, tp: { G: "native-stop-icon" }, tT: { F: "native-start-icon" },
            q: { intl: { string: () => "Localized Stop Streaming" }, t: { S5anIc: "stop" } },
            tz: { A: () => calls.push("native stop") }, ef: { X: () => calls.push("native analytics"), O: { STREAM: "stream" } },
            tG: "native-clips", nR: "native-popover", nativeBody: active ? null : "native-existing-body", nativeStream: { ownerId: "self" }, nativeStreaming: true
        };
        const adapter = {
            setNativeSidebarBody: (body: unknown) => { registeredBody = body; },
            useNativeSidebarProps: (props: Record<string, unknown>) => ({ ...props, dassSidebar: active ? state : undefined }),
            renderNativeSidebarBody: (metadata: unknown) => jsx(registeredBody, { streamMetadata: metadata }),
            sidebarActionProps, stopSidebarStream
        };
        const render = new Function("env", "$self", `const {${Object.keys(env).join(",")}}=env;${patched()};return nb;`)(env, adapter);
        const frame = render({ guildId: null, analyticsContext: {}, className: "provided-class" });
        expect(frame.props.className).toEqual(["native-card", "provided-class"]);
        const inner = frame.props.children;
        expect(inner.props.className).toBe("native-card-inner");
        const [body, actions, popover] = inner.props.children;
        if (active) {
            expect(body.component).toBe(registeredBody);
            expect(body.props.streamMetadata).toBe(state.metadata);
            const renderedBody = body.component(body.props);
            expect(renderedBody.props.className).toBe("native-body");
            const [sourceIcon, titleArea] = renderedBody.props.children;
            expect(sourceIcon.component).toBe("native-source-icon");
            expect(sourceIcon.props.icon).toBeUndefined();
            expect(titleArea.props.children[0].component).toBe("native-title");
            expect(titleArea.props.children[0].props.children).toBe("Screen");
            expect(popover).toBeNull();
        } else {
            expect(body).toBe("native-existing-body");
            expect(popover.component).toBe("native-popover");
        }
        const renderedActions = actions.component(actions.props);
        const [, , clips, wrapper] = renderedActions.props.children;
        expect(clips === null).toBe(active);
        const button = wrapper.props.children;
        expect(button.component).toBe("native-button");
        expect(button.props.icon).toBe("native-stop-icon");
        expect(button.props.tooltipText).toBe("Localized Stop Streaming");
        expect(button.props.disabled).toBe(false);
        button.props.onClick();
        expect(calls).toEqual(active ? ["DASS stop"] : ["native stop", "native analytics"]);
    }
});

test("the provisional sidebar JSX and stylesheet are removed, not hidden behind another replacement", () => {
    const tile = readFileSync(new URL("../../plugins/dass/gridTile.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../plugins/dass/style.css", import.meta.url), "utf8");
    expect(tile).not.toContain("useSidebarCard");
    expect(tile).not.toContain("vc-dass-sidebar-card");
    expect(css).not.toContain("vc-dass-sidebar-card");
});
