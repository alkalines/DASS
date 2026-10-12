/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { createShareSelection, DISCORD_SHARE_PATCHES, TRANSPORT_UNAVAILABLE_MESSAGE } from "../../plugins/dass/discordAdapter";

const OBSERVED_BUTTON_SOURCE = 'return(0,i.jsx)(ee.h,{...l,centerButton:!0,disabled:c||!r,className:ev.uH,hasPermission:r,streamActive:null!=C,videoBlocked:o,isSelfStream:!0,onPopoutClick:s?function(e){t?.(e)}:null,popoutOpen:n,shouldShowTooltip:!n,renderNUXHighlight:N,buttonRef:f,onClick:null!=C?S:_})';
const OBSERVED_VOICE_PANEL_CALLBACK = 'f=em.useCallback(()=>{(0,vT.A)(_,n.id,o)},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id)';
const OBSERVED_VOICE_PANEL_RENDER_SOURCE = OBSERVED_VOICE_PANEL_CALLBACK + ',p=(0,vf.T)(n,d,c);t=null==I?i?f:vp.A:()=>(0,D0.A)(I);let T=null!=I||p.length>0,m=h?tv.intl.string(tv.t.GFr0GR):u?tv.intl.string(tv.t.fjBNo1):tv.intl.string(tv.t.uQn9B8),g=E||r||A,S=null!=I,{Component:N,events:C,play:O}=(0,DC.c)(S?"disable":"enable");em.useEffect(()=>()=>O(),[O,S]);let R=h?(0,w.jsx)(S5.i,{size:"md",color:"currentColor",className:tf()(va.iA,{[va.ij]:!g})}):(0,w.jsx)(N,{size:"md",color:"currentColor",className:tf()(va.iA,{[va.ij]:!g})});return(0,w.jsx)(al.Y,{targetElementRef:s,renderPopout:e=>{let{closePopout:t}=e;return(0,w.jsx)(vf.A,{channel:n,currentUser:d,activeStreams:c,onClose:t,handleGoLive:i?f:vp.A,onInteraction:(0,Dj.s)("ManageStreamsMenu",l,{entrypoint:vj.GK.OTHER_BUTTON})})},position:"top",align:"center",animation:al.Y.Animation.FADE,children:e=>{let{onClick:n,onMouseEnter:i,...r}=e;return(0,w.jsx)(rO.m,{text:m,children:(0,w.jsx)(si.$n,{"data-migration-pending":!0,buttonRef:s,size:si.$n.Sizes.MEDIUM,"aria-pressed":null!=I,onClick:e=>{(0,DH.X)(l,DH.O.STREAM,null==I),T?n(e):t()},disabled:!u||a,className:tf()(va.x6,va.Sq,{[va.rK]:null!=I,[va.r9]:!u||a}),...T?r:null,onMouseEnter:()=>{i?.(),C.onMouseEnter()},onMouseLeave:()=>{C.onMouseLeave()},innerClassName:va.bk,wrapperClassName:va.x6,focusProps:vK,children:g?R:(0,w.jsxs)(lx.A,{align:lx.A.Align.CENTER,children:[R,tv.intl.string(tv.t["r0/+v7"])]})})})}})';
const patch = DISCORD_SHARE_PATCHES[0];
const clickReplacement = patch.replacement[1];
const find = new RegExp(patch.find.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
const match = new RegExp(clickReplacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));

describe("build 634304 share button patch", () => {
    test("wraps the existing component and preserves native UI props", () => {
        let source = OBSERVED_BUTTON_SOURCE;
        for (const replacement of patch.replacement) {
            const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
            expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
            source = source.replace(regex, replacement.replace);
        }
        expect(source).toContain("$self.ShareButton,{dassNativeComponent:ee.h,...l,centerButton:!0");
        expect(source).toContain("onClick:null!=C?S:()=>$self.chooseShareTransport(_)");
        expect(() => new Function("i", "ee", "$self", source)).not.toThrow();
    });
    test("matches the supplied button source once and preserves stop", () => {
        expect(patch.fromBuild).toBe(634304);
        expect(patch.toBuild).toBe(634304);
        expect(find.test(OBSERVED_BUTTON_SOURCE)).toBe(true);
        expect([...OBSERVED_BUTTON_SOURCE.matchAll(new RegExp(match.source, "g"))]).toHaveLength(1);
        const patched = OBSERVED_BUTTON_SOURCE.replace(match, clickReplacement.replace);
        expect(patched).toContain("onClick:null!=C?S:()=>$self.chooseShareTransport(_)");
        expect(patched).toContain("onPopoutClick:s?function(e){t?.(e)}:null");
    });

    test("unrelated coach-mark modules cannot consume the patch first", () => {
        const modules = [
            '554146(e,t,n){const definition="TRIAL_NUX_STREAM_COACH_MARK";}',
            '958872(e,t,n){return {contentTypes:[d.M.TRIAL_NUX_STREAM_COACH_MARK]};}',
            OBSERVED_BUTTON_SOURCE
        ];
        expect(modules.filter(source => find.test(source))).toEqual([OBSERVED_BUTTON_SOURCE]);
        const firstMatch = modules.find(source => find.test(source));
        expect(firstMatch?.replace(match, clickReplacement.replace)).toContain("chooseShareTransport");
    });

    test("renamed identifiers work and changed syntax is not guessed", () => {
        expect(match.test("onClick:null!=$stream?stopShare:startShare})")).toBe(true);
        expect(match.test("onClick:stream?stopShare:startShare})")).toBe(false);
    });

    test("patched click defers native start until an explicit Discord selection", () => {
        const expression = "(0,i.jsx)(ee.h,{onClick:null!=C?S:_})".replace(match, clickReplacement.replace);
        const nativeCalls: string[] = [];
        const nativeStart = () => { nativeCalls.push("STREAM_START", "capture", "thumbnail POST"); };
        let select: ReturnType<typeof createShareSelection> | undefined;
        const adapter = { chooseShareTransport: (start: () => void) => {
            select = createShareSelection(new AbortController().signal, () => true, start);
        } };
        const render = new Function("i", "ee", "C", "S", "_", "$self", `return ${expression};`);
        const jsx = (_component: unknown, props: { onClick(): void; }) => props;
        render({ jsx }, { h: null }, null, () => {}, nativeStart, adapter).onClick();
        expect(nativeCalls).toEqual([]);
        expect(select?.("dass")).toBe(TRANSPORT_UNAVAILABLE_MESSAGE);
        expect(nativeCalls).toEqual([]);
        select?.("discord");
        expect(nativeCalls).toEqual([]);
        let stops = 0;
        render({ jsx }, { h: null }, {}, () => { stops++; }, nativeStart, adapter).onClick();
        expect(stops).toBe(1);
    });
});

describe("build 634304 Voice Connected panel patch", () => {
    const panelPatch = DISCORD_SHARE_PATCHES[1];
    const startReplacement = panelPatch.replacement[0];
    const panelMatch = new RegExp(startReplacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));

    test("matches the observed start callback, not generic stream or voice controls", () => {
        expect(panelPatch.fromBuild).toBe(634304);
        expect(panelPatch.toBuild).toBe(634304);
        expect(new RegExp(panelPatch.find.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)")).test(OBSERVED_VOICE_PANEL_CALLBACK)).toBe(true);
        expect([...OBSERVED_VOICE_PANEL_CALLBACK.matchAll(new RegExp(panelMatch.source, "g"))]).toHaveLength(1);
        expect(OBSERVED_VOICE_PANEL_CALLBACK.replace(panelMatch, startReplacement.replace))
            .toContain('f=em.useCallback(()=>{$self.chooseShareTransport(()=>(0,vT.A)(_,n.id,o))},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id)');
        expect(panelMatch.test('onClick:()=>{(0,D0.A)(I)}')).toBe(false);
        expect(panelMatch.test(OBSERVED_BUTTON_SOURCE)).toBe(false);
    });

    test("Discord retains the original capture callback and arguments; DASS never invokes it", () => {
        const source = OBSERVED_VOICE_PANEL_CALLBACK.replace(panelMatch, startReplacement.replace);
        const render = new Function("em", "vT", "_", "n", "o", "c", "d", "$self", `let ${source}; return f;`);
        const analyticsLocations = ["voice-panel"];
        const nativeCalls: unknown[][] = [];
        let select: ReturnType<typeof createShareSelection> | undefined;
        const adapter = { chooseShareTransport: (start: () => void) => {
            select = createShareSelection(new AbortController().signal, () => true, start);
        }, usePublishingState: () => false };
        const click = render(
            { useCallback: (callback: () => void) => callback },
            { A: (...args: unknown[]) => { nativeCalls.push(args); } },
            "guild", { id: "channel" }, analyticsLocations, [], { id: "user" }, adapter
        );
        click();
        expect(nativeCalls).toEqual([]);
        expect(select?.("dass")).toBe(TRANSPORT_UNAVAILABLE_MESSAGE);
        expect(nativeCalls).toEqual([]);
        click();
        select?.("discord");
        expect(nativeCalls).toEqual([["guild", "channel", analyticsLocations]]);
        expect(nativeCalls[0][2]).toBe(analyticsLocations);
        select?.("discord");
        expect(nativeCalls).toHaveLength(1);
    });

    function patchSidebar(source = OBSERVED_VOICE_PANEL_RENDER_SOURCE) {
        for (const replacement of panelPatch.replacement) {
            const regex = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
            expect([...source.matchAll(new RegExp(regex.source, "g"))]).toHaveLength(1);
            source = source.replace(regex, replacement.replace);
        }
        return source;
    }

    test("all sidebar state replacements match the observed renderer exactly once", () => {
        expect(panelPatch.group).toBe(true);
        const source = patchSidebar();
        expect(source).toContain("dassSidebarPublishing=$self.usePublishingState(n.id)");
        expect(source).toContain('"aria-pressed":dassSidebarPublishing||null!=I');
        expect(source).toContain("T=!dassSidebarPublishing&&(null!=I||p.length>0)");
        expect(() => new Function("$self", `let t; let ${source};`)).not.toThrow();
    });

    test("sidebar state matching does not depend on observed minified variable names", () => {
        const renamed = OBSERVED_VOICE_PANEL_RENDER_SOURCE.replace(/\bn\b/g, "voiceChannel").replace(/\bI\b/g, "currentNativeShare");
        const source = patchSidebar(renamed);
        expect(source).toContain("dassSidebarPublishing=$self.usePublishingState(voiceChannel.id)");
        expect(source).toContain('"aria-pressed":dassSidebarPublishing||null!=currentNativeShare');
        expect(() => new Function("$self", `let t; let ${source};`)).not.toThrow();
    });

    function renderSidebar(dassActive: boolean, nativeActive = false, hasActivity = false, blocked = false) {
        const calls: string[] = [];
        const jsx = (component: unknown, props: any) => ({ component, props });
        const env = {
            em: { useCallback: (cb: () => void) => cb, useEffect: () => {} },
            vT: { A: () => calls.push("native start") }, _: "guild", n: { id: "channel" }, o: [],
            c: nativeActive ? [{ ownerId: "self" }] : [], d: { id: "self" },
            vf: { T: () => hasActivity ? [{}] : [], A: "manage streams" }, i: true,
            vp: { A: () => calls.push("unavailable") }, D0: { A: () => calls.push("native stop") },
            h: false, u: !blocked, E: false, r: false, A: false, a: blocked,
            tv: { intl: { string: (key: string) => key }, t: { fjBNo1: "native tooltip" } },
            DC: { c: (mode: string) => { calls.push(mode); return { Component: "icon", events: {}, play: () => {} }; } },
            w: { jsx, jsxs: jsx }, tf: () => (...args: unknown[]) => args,
            va: { iA: "icon", ij: "enabled", x6: "wrapper", Sq: "button", rK: "selected", r9: "disabled" },
            al: { Y: { Animation: { FADE: "fade" } } }, s: {}, rO: { m: "tooltip" },
            si: { $n: { Sizes: { MEDIUM: "medium" } } },
            DH: { X: (_location: unknown, _kind: unknown, starts: boolean) => calls.push(starts ? "start intent" : "stop intent"), O: { STREAM: "stream" } },
            l: "panel", vK: {}, lx: { A: { Align: { CENTER: "center" } } }
        };
        const adapter = {
            usePublishingState: (channelId: string) => { expect(channelId).toBe("channel"); return dassActive; },
            stopPublishing: () => calls.push("DASS stop"),
            chooseShareTransport: () => calls.push("DASS start")
        };
        const render = new Function("env", "$self", `const {${Object.keys(env).join(",")}}=env; let t; let ${patchSidebar()};`);
        const popout = render(env, adapter);
        const tooltip = popout.props.children({ onClick: () => calls.push("popout"), popoutHandler: true });
        return { calls, tooltip: tooltip.props.text, button: tooltip.props.children.props };
    }

    test("DASS sidebar uses native pressed/icon styling and stops directly, even with activity or permission loss", () => {
        const rendered = renderSidebar(true, false, true, true);
        expect(rendered.tooltip).toBe("Stop Streaming");
        expect(rendered.button["aria-pressed"]).toBe(true);
        expect(rendered.button.disabled).toBe(false);
        expect(rendered.button.className[2]).toEqual({ selected: true, disabled: false });
        expect(rendered.button.children.props.children[1]).toBe("Stop Streaming");
        expect(rendered.button.popoutHandler).toBeUndefined();
        rendered.button.onClick({});
        expect(rendered.calls).toEqual(["disable", "stop intent", "DASS stop"]);
    });

    test("inactive DASS preserves native stop/popout and intercepted start", () => {
        const native = renderSidebar(false, true);
        expect(native.tooltip).toBe("native tooltip");
        expect(native.button["aria-pressed"]).toBe(true);
        native.button.onClick({});
        expect(native.calls).toEqual(["disable", "stop intent", "popout"]);
        const idle = renderSidebar(false);
        expect(idle.button["aria-pressed"]).toBe(false);
        idle.button.onClick({});
        expect(idle.calls).toEqual(["enable", "start intent", "DASS start"]);
    });
});

describe("explicit transport selection", () => {
    test("Discord runs once; cancellation never starts native sharing", () => {
        let starts = 0;
        const signal = new AbortController().signal;
        const select = createShareSelection(signal, () => true, () => { starts++; });
        select("discord");
        select("discord");
        expect(starts).toBe(1);
        const cancel = createShareSelection(signal, () => true, () => { starts++; });
        cancel("cancel");
        cancel("discord");
        expect(starts).toBe(1);
    });

    test("disable, logout, replaced chooser or context exit invalidates pending selection", () => {
        for (const transport of ["discord", "dass"] as const) {
            let starts = 0;
            const abort = new AbortController();
            const select = createShareSelection(abort.signal, () => true, () => { starts++; });
            abort.abort();
            expect(select(transport)).toBeUndefined();
            const changedContext = createShareSelection(new AbortController().signal, () => false, () => { starts++; });
            expect(changedContext(transport)).toBeUndefined();
            expect(starts).toBe(0);
        }
    });
});
