/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createShareSelection } from "../../plugins/dass/discordAdapter";

test("transport choices run only the selected owner once, even after repeated clicks", () => {
    for (const choice of ["discord", "dass", "cancel"] as const) {
        const calls: string[] = [];
        const choose = createShareSelection(new AbortController().signal, () => true,
            () => calls.push("discord"), () => calls.push("dass"));
        expect(calls).toEqual([]);
        choose(choice);
        choose("discord");
        choose("dass");
        expect(calls).toEqual(choice === "cancel" ? [] : [choice]);
    }
});

test("stale context and cancelled chooser cannot invoke either capture path", () => {
    for (const choice of ["discord", "dass"] as const) {
        const calls: string[] = [];
        let contextCurrent = true;
        const abort = new AbortController();
        const choose = createShareSelection(abort.signal, () => contextCurrent,
            () => calls.push("discord"), () => calls.push("dass"));
        contextCurrent = false;
        choose(choice);
        contextCurrent = true;
        abort.abort();
        choose(choice);
        expect(calls).toEqual([]);
    }
});

test("chooser uses host modal actions, aborts on dismissal, and remains required for either preference", () => {
    const chooser = readFileSync(new URL("../../plugins/dass/shareTransport.tsx", import.meta.url), "utf8");
    const plugin = readFileSync(new URL("../../plugins/dass/index.tsx", import.meta.url), "utf8");
    for (const choice of ["Cancel", "Discord", "DASS"]) expect(chooser).toContain(`text: "${choice}"`);
    expect(chooser).toContain("onCloseCallback:");
    expect(chooser).toContain("onCloseRequest: dismiss");
    expect(chooser).toContain("onClose={dismiss}");
    expect(chooser).toContain("pending.abort.abort()");
    expect(chooser).toContain("createShareSelection(pending.abort.signal, isContextCurrent, nativeStart, dassStart)");
    expect(plugin).toContain("showShareTransportChooser(settings.store.defaultDass");
    expect(plugin).not.toContain("if (!pluginActive || !settings.store.defaultDass) return nativeStart()");
    expect(plugin).toContain("cancelShareTransportChooser()");
    expect(plugin).toContain("callPresentation.exitFullscreen()");
    expect(plugin).toContain("FluxDispatcher.wait(exit)");
    expect(plugin).toContain("unsubscribeDirectoryStatus?.()");
});
