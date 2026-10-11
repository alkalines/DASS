/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import { createShareSelection, DISCORD_SHARE_PATCHES, TRANSPORT_UNAVAILABLE_MESSAGE } from "../../plugins/dass/discordAdapter";

const OBSERVED_BUTTON_SOURCE = 'return(0,i.jsx)(ee.h,{...l,centerButton:!0,disabled:c||!r,className:ev.uH,hasPermission:r,streamActive:null!=C,videoBlocked:o,isSelfStream:!0,onPopoutClick:s?function(e){t?.(e)}:null,popoutOpen:n,shouldShowTooltip:!n,renderNUXHighlight:N,buttonRef:f,onClick:null!=C?S:_})';
const OBSERVED_VOICE_PANEL_CALLBACK = 'f=em.useCallback(()=>{(0,vT.A)(_,n.id,o)},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id)';
const patch = DISCORD_SHARE_PATCHES[0];
const find = new RegExp(patch.find.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
const match = new RegExp(patch.replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));

describe("build 634304 share button patch", () => {
    test("matches the supplied button source once and preserves stop", () => {
        expect(patch.fromBuild).toBe(634304);
        expect(patch.toBuild).toBe(634304);
        expect(find.test(OBSERVED_BUTTON_SOURCE)).toBe(true);
        expect([...OBSERVED_BUTTON_SOURCE.matchAll(new RegExp(match.source, "g"))]).toHaveLength(1);
        const patched = OBSERVED_BUTTON_SOURCE.replace(match, patch.replacement.replace);
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
        expect(firstMatch?.replace(match, patch.replacement.replace)).toContain("chooseShareTransport");
    });

    test("renamed identifiers work and changed syntax is not guessed", () => {
        expect(match.test("onClick:null!=$stream?stopShare:startShare})")).toBe(true);
        expect(match.test("onClick:stream?stopShare:startShare})")).toBe(false);
    });

    test("patched click defers native start until an explicit Discord selection", () => {
        const expression = "(0,i.jsx)(ee.h,{onClick:null!=C?S:_})".replace(match, patch.replacement.replace);
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
    const panelMatch = new RegExp(panelPatch.replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));

    test("matches the observed start callback, not generic stream or voice controls", () => {
        expect(panelPatch.fromBuild).toBe(634304);
        expect(panelPatch.toBuild).toBe(634304);
        expect(panelPatch.find.source).toBe(panelPatch.replacement.match.source);
        expect([...OBSERVED_VOICE_PANEL_CALLBACK.matchAll(new RegExp(panelMatch.source, "g"))]).toHaveLength(1);
        expect(OBSERVED_VOICE_PANEL_CALLBACK.replace(panelMatch, panelPatch.replacement.replace))
            .toContain('f=em.useCallback(()=>{$self.chooseShareTransport(()=>(0,vT.A)(_,n.id,o))},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id)');
        expect(panelMatch.test('onClick:()=>{(0,D0.A)(I)}')).toBe(false);
        expect(panelMatch.test(OBSERVED_BUTTON_SOURCE)).toBe(false);
    });

    test("Discord retains the original capture callback and arguments; DASS never invokes it", () => {
        const source = OBSERVED_VOICE_PANEL_CALLBACK.replace(panelMatch, panelPatch.replacement.replace);
        const render = new Function("em", "vT", "_", "n", "o", "c", "d", "$self", `let ${source}; return f;`);
        const analyticsLocations = ["voice-panel"];
        const nativeCalls: unknown[][] = [];
        let select: ReturnType<typeof createShareSelection> | undefined;
        const adapter = { chooseShareTransport: (start: () => void) => {
            select = createShareSelection(new AbortController().signal, () => true, start);
        } };
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
