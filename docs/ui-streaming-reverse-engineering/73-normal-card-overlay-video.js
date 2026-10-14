/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const p = globalThis.__DASS_NORMAL_CARD_TEST__;
    if (p?.marker !== "dass-normal-card-v1" || !p.renderCard) return "Prepare original card/footer first.";
    const w = Vencord.Webpack;
    const cache = w.cache || w.wreq.c;
    const h = p.React.createElement;
    const bindings = [...p.playerSource.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g)];
    const imported = name => {
        const matches = bindings.filter(match => match[1] === name);
        const value = matches.length === 1 ? cache?.[matches[0][2]]?.exports : null;
        if (!value) throw Error("Missing reviewed overlay dependency: " + name);
        return value;
    };
    try {
        const lookup = "u=(0,a.bG)([O.A],()=>O.A.getActiveStreamForUser(t.user.id,t.stream.guildId))";
        if (p.overlay.split(lookup).length !== 2) throw Error("Overlay lookup changed.");
        const live = imported("f");
        if (live.Ay?.Sizes?.SMALL === undefined) throw Error("Native LIVE contract unavailable.");
        const enums = imported("q");
        const Overlay = new Function("i","X","f","Y","q","K","S",
            p.overlay.replace(lookup, "u=e.dassStatus") + ";return en;"
        )(imported("i"), imported("X"), live, imported("Y"), enums,
            { A: () => null }, { A: ({ size, className }) => h(live.Ay, { size, className }) });
        const source = w.wreq.m["51092"].toString();
        const signature = source.match(/^51092\(([\w$]+),([\w$]+),([\w$]+)\)\{/);
        if (!signature || source.length !== 2122 || !source.endsWith("}")) throw Error("Video wrapper changed.");
        const overrides = {
            684339: { M: class { onSpinnerStarted() {} trackSpinnerDuration() {} }, u: {} },
            276208: { X: { isIncomingVideoEnabled: () => false } },
            37965: { Z() {}, W() {} }
        };
        const requireLoaded = id => {
            const value = overrides[id] ?? cache?.[id]?.exports;
            if (!value) throw Error("Missing cached video dependency: " + id);
            return value;
        };
        requireLoaded.d = (target, getters) => {
            for (const [name, get] of Object.entries(getters)) Object.defineProperty(target, name, { get });
        };
        requireLoaded.n = value => () => value?.__esModule ? value.default : value;
        const exports = {};
        new Function(...signature.slice(1), source.slice(signature[0].length, -1))({ exports }, exports, requireLoaded);
        const types = cache?.["806931"]?.exports?.lp;
        const Idle = cache?.["461782"]?.exports?.vG;
        const computerIcon = cache?.["31300"]?.exports?.k;
        if (!exports.A || types?.STREAM === undefined || enums.XYD?.ACTIVE === undefined || !Idle || !computerIcon)
            throw Error("Native video/type/idle/icon contract unavailable.");
        Object.assign(p, { Overlay, Video: exports.A, states: enums.XYD, types, Idle, computerIcon });
    } catch (error) {
        return "Preparation failed: " + error.message;
    }
    return "Original overlay/video ready. Next stage attaches generated media and mounts the original card.";
})();
