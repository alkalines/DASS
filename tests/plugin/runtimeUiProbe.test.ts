/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const probe = readFileSync(new URL("../../scripts/discord-dass-runtime-ui-probe.js", import.meta.url), "utf8");

function runProbe(patcher = {}, exports = {}) {
    const host = { Webpack: { wreq: { m: { "540462": function originalFactory() {}, "848362": function nativeMenu() {} },
        c: { "540462": { exports } } } }, WebpackPatcher: { getFactoryPatchedSource: () => undefined,
        getFactoryPatchedBy: () => undefined, getBuildNumber: () => 634304, ...patcher } };
    return JSON.parse(new Function("globalThis", "document", `return (${probe.trim().replace(/;$/, "")});`)({ Vencord: host }, { fullscreenElement: null }));
}

test("release probe reports unavailable patch metadata as unknown, not failure", () => {
    const report = runProbe();
    expect(report.modules[0].dassPatched).toBeNull();
    expect(report.modules[0].sourceKind).toBe("original factory, not patch evidence");
    expect(report.modules.find((module: { moduleId: string; }) => module.moduleId === "848362").unavailable).toBeUndefined();
});

test("development probe uses available patched source and attribution", () => {
    const report = runProbe({ getFactoryPatchedSource: () => "patched source", getFactoryPatchedBy: () => new Set(["DASS"]) });
    expect(report.modules[0].dassPatched).toBe(true);
    expect(report.modules[0].source).toBe("patched source");
    expect(runProbe({ getFactoryPatchedBy: () => new Set() }).modules[0].dassPatched).toBe(false);
});

test("probe reads surviving exported DASS functions without invoking getters or functions", () => {
    const exports = {
        projected() { throw new Error("plugins.DASS"); },
        get unsafeGetter() { throw new Error("Must not execute exports."); }
    };
    const report = runProbe({}, exports);
    expect(report.modules[0].executedDassFunctions).toHaveLength(1);
    expect(report.modules[0].executedDassFunctions[0].path).toBe("exports.projected");
});
