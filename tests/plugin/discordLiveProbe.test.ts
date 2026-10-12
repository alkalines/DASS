/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const probe = readFileSync(new URL("../../scripts/discord-live-probe.js", import.meta.url), "utf8");
const presentationProbe = readFileSync(new URL("../../scripts/discord-stream-ui-probe.js", import.meta.url), "utf8");
const nativeCallProbe = readFileSync(new URL("../../scripts/discord-native-call-probe.js", import.meta.url), "utf8");
const gridProbe = readFileSync(new URL("../../scripts/discord-grid-probe.js", import.meta.url), "utf8");
const playerShellProbe = readFileSync(new URL("../../scripts/discord-player-shell-probe.js", import.meta.url), "utf8");
const nativeFrameProbe = readFileSync(new URL("../../scripts/discord-native-frame-probe.js", import.meta.url), "utf8");

test("live probe reads factory source without invoking factories or runtime exports", () => {
    const sidebar = new Function('throw new Error("Never execute"); f=em.useCallback(()=>{(0,vT.A)(_,n.id,o)},[_,n.id,o]),I=c.find(e=>e.ownerId===d?.id); render({streamActive:null!=I});');
    const list = new Function('throw new Error("Never execute"); store.getAllApplicationStreamsForChannel(channel);');
    const result = JSON.parse(runInNewContext(probe, { Vencord: { Webpack: { wreq: { m: { sidebar, list } } } } }));
    expect(result.sidebar).toHaveLength(1);
    expect(result.sidebar[0].source).toContain("streamActive:null!=I");
    expect(result.streamLists).toHaveLength(1);
    expect(result.results.map((entry: { moduleId: string; }) => entry.moduleId)).toEqual(["sidebar", "list"]);
});

test("presentation probe follows recorded UI imports without loading or invoking modules", () => {
    const result = JSON.parse(runInNewContext(presentationProbe, { Vencord: { Webpack: { wreq: { m: {
        321486: new Function(`throw new Error("Never execute"); /*${"x".repeat(17_000)}*/`),
        711589: new Function('throw new Error("Never execute");')
    } } } } }));
    expect(result.modules.map((module: { moduleId: string; }) => module.moduleId)).toEqual(["321486", "711589"]);
    expect(result.modules[0].source.length).toBe(16_000);
    expect(result.modules[0].truncated).toBe(true);
    expect(result.modules[1].truncated).toBe(false);
    expect(result.badgePlacements).toEqual([]);
    expect(result.callRenderers).toEqual([]);
    expect(JSON.parse(runInNewContext(presentationProbe, {})).error).toContain("unavailable");
});

test("presentation graph finds renamed badge imports and nearby call render code, not re-export preambles", () => {
    const result = JSON.parse(runInNewContext(presentationProbe, { Vencord: { Webpack: { wreq: { m: {
        badge: new Function('throw new Error("Never execute"); const $live=req(402216); function row(){return(0,jsx.jsx)($live.Ay,{size:$live.Ay.Sizes.SMALL})}'),
        reexport: new Function('throw new Error("Never execute"); const badge=req(402216); exports.LiveBadge=badge.Ay;'),
        grid: new Function(`throw new Error("Never execute"); /*${"x".repeat(10_000)}*/ function grid(){let streams=store.getAllActiveStreamsForChannel(channelId); return(0,jsx.jsx)(Tile,{streams})}`)
    } } } } }));
    expect(result.modules.every((module: { unavailable: boolean; }) => module.unavailable)).toBe(true);
    expect(result.badgePlacements).toHaveLength(1);
    expect(result.badgePlacements[0].moduleId).toBe("badge");
    expect(result.badgePlacements[0].source).toContain("$live.Ay");
    expect(result.callRenderers).toHaveLength(1);
    expect(result.callRenderers[0].moduleId).toBe("grid");
    expect(result.callRenderers[0].offset).toBeGreaterThan(0);
    expect(result.callRenderers[0].source).toContain("Tile,{streams}");
    expect(result.callRenderers[0].truncated).toBe(true);
});

test("presentation graph bounds the combined source output", () => {
    const factories = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), new Function(`throw new Error("Never execute"); /*${"x".repeat(7_000)}*/ const badge=req(402216); function row(){let stream=store.getActiveStreamForUser(id); return(0,jsx.jsx)(badge.Ay,{stream})} /*${"x".repeat(7_000)}*/`)]));
    const result = JSON.parse(runInNewContext(presentationProbe, { Vencord: { Webpack: { wreq: { m: factories } } } }));
    const total = [...result.modules, ...result.badgePlacements, ...result.callRenderers]
        .reduce((count: number, entry: { source?: string; }) => count + (entry.source?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(64_000);
    expect(result.sourceLimitReached).toBe(true);
    expect(result.badgePlacements.length).toBeLessThanOrEqual(10);
    expect(result.callRenderers.length).toBeLessThanOrEqual(10);
});

test("native call probe only reads the identified badge and grid boundaries", () => {
    const ids = ["936520", "340851", "874739", "802867", "806931"];
    const factories = Object.fromEntries(ids.map(id => [id, new Function(`throw new Error("Never execute"); /*${"x".repeat(17_000)}*/`)]));
    const result = JSON.parse(runInNewContext(nativeCallProbe, { Vencord: { Webpack: { wreq: { m: factories } } } }));
    expect(result.modules.map((module: { moduleId: string; }) => module.moduleId)).toEqual(ids);
    expect(result.modules.every((module: { source: string; truncated: boolean; }) => module.source.length === 16_000 && module.truncated)).toBe(true);
    const unavailable = JSON.parse(runInNewContext(nativeCallProbe, { Vencord: { Webpack: { wreq: { m: {} } } } }));
    expect(unavailable.modules.every((module: { unavailable: boolean; }) => module.unavailable)).toBe(true);
});

test("grid probe reads only the two native grid delegates and bounds their source", () => {
    const result = JSON.parse(runInNewContext(gridProbe, { Vencord: { Webpack: { wreq: { m: {
        526369: new Function(`throw new Error("Never execute"); /*${"x".repeat(25_000)}*/`)
    } } } } }));
    expect(result.modules.map((module: { moduleId: string; }) => module.moduleId)).toEqual(["526369", "699707"]);
    expect(result.modules[0].source.length).toBe(24_000);
    expect(result.modules[0].truncated).toBe(true);
    expect(result.modules[1].unavailable).toBe(true);
    expect(JSON.parse(runInNewContext(gridProbe, {})).error).toContain("unavailable");
});

test("player shell probe reads only the supplied tile imports without executing factories", () => {
    const ids = ["175203", "163432", "51092", "402216"];
    const factories = Object.fromEntries(ids.map(id => [id, new Function(`throw new Error("Never execute"); /*${"x".repeat(25_000)}*/`)]));
    const result = JSON.parse(runInNewContext(playerShellProbe, { Vencord: { Webpack: { wreq: { m: factories } } } }));
    expect(result.modules.map((module: { moduleId: string; }) => module.moduleId)).toEqual(ids);
    expect(result.modules.every((module: { source: string; truncated: boolean; }) => module.source.length === 24_000 && module.truncated)).toBe(true);
    const unavailable = JSON.parse(runInNewContext(playerShellProbe, { Vencord: { Webpack: { wreq: { m: {} } } } }));
    expect(unavailable.modules.every((module: { unavailable: boolean; }) => module.unavailable)).toBe(true);
    expect(JSON.parse(runInNewContext(playerShellProbe, {})).error).toContain("unavailable");
});

test("native frame probe bounds the three identified presentation dependencies without executing them", () => {
    const ids = ["272812", "40056", "117029"];
    const factories = Object.fromEntries(ids.map(id => [id, new Function(`throw new Error("Never execute"); /*${"x".repeat(25_000)}*/`)]));
    const result = JSON.parse(runInNewContext(nativeFrameProbe, { Vencord: { Webpack: { wreq: { m: factories } } } }));
    expect(result.modules.map((module: { moduleId: string; }) => module.moduleId)).toEqual(ids);
    expect(result.modules.every((module: { source: string; truncated: boolean; }) => module.source.length === 24_000 && module.truncated)).toBe(true);
    const unavailable = JSON.parse(runInNewContext(nativeFrameProbe, { Vencord: { Webpack: { wreq: { m: {} } } } }));
    expect(unavailable.modules.every((module: { unavailable: boolean; }) => module.unavailable)).toBe(true);
    expect(JSON.parse(runInNewContext(nativeFrameProbe, {})).error).toContain("unavailable");
});

test("live probe bounds static source excerpts and reports unavailable webpack", () => {
    const factories = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [String(i), new Function(`throw new Error("Never execute"); store.getAllApplicationStreamsForChannel(channel); /*${"x".repeat(13_000)}*/`)]));
    const result = JSON.parse(runInNewContext(probe, { Vencord: { Webpack: { wreq: { m: factories } } } }));
    expect(result.results).toHaveLength(100);
    expect(result.streamLists).toHaveLength(3);
    expect(result.streamLists.every((entry: { source: string; truncated: boolean; }) => entry.source.length <= 12_000 && entry.truncated)).toBe(true);
    expect(JSON.parse(runInNewContext(probe, {})).error).toContain("unavailable");
});
