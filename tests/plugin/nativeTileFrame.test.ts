/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { NATIVE_LIVE_BADGE_SOURCE_SIGNATURE, NATIVE_TILE_FRAME_SOURCE_SIGNATURE } from "../../plugins/dass/discordAdapter";

const OBSERVED_FRAME = 'function l(e){let{children:t,className:n,style:r,noBorder:l=!1,participantUserId:o,ref:d}=e;return(0,i.jsx)("div",{className:a()(n,s.V,{[s.E]:l}),style:r,ref:d,"data-selenium-video-tile":o,"data-call-tile":"",children:t})}';
const OBSERVED_BADGE = 'function A(e){let{className:t,style:n,shape:i=o.EG.ROUND,look:a="RED",size:u=_.LARGE,count:A}=e,h=null!=A&&A>1?d.intl.format(d.t.hOnBrr,{count:A}):d.intl.string(d.t.dI3q4h);return"RED"===a?(0,r.jsx)(o.Lp,{text:h,className:s()(t,c.VD,u),color:l.A.colors.BADGE_NOTIFICATION_BACKGROUND.css,shape:E[i],style:n}):(0,r.jsx)(o.Lp,{text:h,className:s()(t,c.VD,u,c.Oh),disableColor:!0,shape:E[i],style:n})}';

interface FrameResult {
    component: string;
    props: Record<string, unknown>;
}

test("native presentation signatures match the supplied frame and badge, not media components", () => {
    expect(NATIVE_TILE_FRAME_SOURCE_SIGNATURE.every(token => OBSERVED_FRAME.includes(token))).toBe(true);
    expect(NATIVE_LIVE_BADGE_SOURCE_SIGNATURE.every(token => OBSERVED_BADGE.includes(token))).toBe(true);
    expect(NATIVE_TILE_FRAME_SOURCE_SIGNATURE.every(token => OBSERVED_BADGE.includes(token))).toBe(false);
    expect(NATIVE_LIVE_BADGE_SOURCE_SIGNATURE.every(token => OBSERVED_FRAME.includes(token))).toBe(false);
});

test("the actual frame renders native border classes and borrowed children without a Discord identity", () => {
    const jsx = (component: string, props: Record<string, unknown>): FrameResult => ({ component, props });
    const classes = (name: string, native: string, conditions: Record<string, boolean>) =>
        [name, native, ...Object.keys(conditions).filter(key => conditions[key])].join(" ");
    const render = new Function("i", "a", "s", `return ${OBSERVED_FRAME}`)(
        { jsx }, () => classes, { V: "native-frame", E: "native-no-border" }
    );
    const children = { media: "DASS-owned video" };
    const style = { width: 640 };
    const result: FrameResult = render({ children, style, className: "vc-dass-grid-tile" });
    expect(result.component).toBe("div");
    expect(result.props.className).toBe("vc-dass-grid-tile native-frame");
    expect(result.props.children).toBe(children);
    expect(result.props.style).toBe(style);
    expect(result.props["data-call-tile"]).toBe("");
    expect(result.props["data-selenium-video-tile"]).toBeUndefined();
    const borderless: FrameResult = render({ children, noBorder: true, className: "vc-dass-grid-tile" });
    expect(borderless.props.className).toContain("native-no-border");
});

test("DASS tile uses the native frame without Card styling, native media IDs or zoom side effects", () => {
    const source = readFileSync(new URL("../../plugins/dass/gridTile.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../plugins/dass/style.css", import.meta.url), "utf8");
    expect(source).toContain("findComponentByCodeLazy<NativeTileFrameProps>(...NATIVE_TILE_FRAME_SOURCE_SIGNATURE)");
    expect(source).toContain("<TileFrame className=");
    expect(source).not.toContain("@components/Card");
    expect(source).not.toContain("participantUserId=");
    expect(source).not.toContain("streamKey=");
    expect(source).toContain('role="group" aria-label={title}');
    expect(css.match(/\.vc-dass-grid-tile \{[^}]+\}/)?.[0]).not.toContain("border-radius");
});
