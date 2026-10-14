/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const parts = globalThis.__DASS_NORMAL_CARD_TEST__;
    if (parts?.marker !== "dass-normal-card-v1" || parts.renderCard) return "Prepare uncompiled normal-card parts first.";
    const { React, cache } = parts;
    const h = React.createElement;
    const replaceOnce = (source, before, after) => {
        if (source.split(before).length !== 2) throw Error("Reviewed source signature changed.");
        return source.replace(before, after);
    };
    const keys = ["scopeTitle","menuOpen","setMenuOpen","u","x","I","y","T","j","f","g","E","N","v","C","b","O","R","k","M","L","z","B","Q","eP","eh","eL","e8","ey","e1","eq","eZ","eK","eX","e6","e2","e$","e0","e9","eD","eG","eY","eH","eN","eS","eW","eJ","eF","ep","ez","e5","ee","es","ex","K","e3"];
    function Pass({ children }) { return children; }
    const facades = {
        820284: { A: Pass },
        40056: { Ay: Pass },
        551826: { A: ({ children, className }) => h("div", { className }, children) },
        612258: { A: () => null }
    };
    const requireLoaded = id => {
        if (Object.hasOwn(facades, id)) return facades[id];
        const value = cache?.[id]?.exports;
        if (!value) throw Error("Missing cached presentation dependency: " + id);
        return value;
    };
    requireLoaded.n = value => () => value?.__esModule ? value.default : value;
    try {
        for (const [name, threshold] of [["Yb",124],["VE",220],["DO",160]]) {
            const fn = cache?.["345812"]?.exports?.[name];
            if (typeof fn !== "function" || !new RegExp("^function [\\w$]+\\(([\\w$]+)\\)\\{return \\1<=" + threshold + "\\}$").test(fn.toString()))
                throw Error("Reviewed pure width helper changed.");
        }
        let footer = parts.footer;
        const start = footer.indexOf(",en=(0,r.bG)");
        const effectEnd = footer.indexOf("},[]);let ", start);
        if (start < 0 || effectEnd <= start) throw Error("Reviewed connected footer setup changed.");
        footer = footer.slice(0, start) + ";let en=null,ea=null,eo=null,ec=false,er=null,em=\"\",eA=(0,eS.Yb)(n),ex=(0,eS.VE)(n),eI=(0,eS.DO)(n),ey=e.dassMenuOpen===true,eT=e.dassSetMenuOpen;" + footer.slice(effectEnd + "},[])".length);
        footer = replaceOnce(footer, "c&&x===eR.lp.STREAM&&eE.push", "false&&eE.push");
        footer = replaceOnce(footer, "c?$===z.N.CALL_TILE", "false?$===z.N.CALL_TILE");
        let render = replaceOnce(parts.render, "title:(0,ej.A)(v,u)", "title:scopeTitle");
        render = replaceOnce(render, "(0,t.jsx)(ew,{focused:", "(0,t.jsx)(ew,{dassMenuOpen:menuOpen,dassSetMenuOpen:setMenuOpen,focused:");
        const renderCard = new Function(parts.requireName,
            `"use strict";${parts.imports}${parts.helpers}let ${footer}return function(scope){const {${keys.join(",")}}=scope;${render}}`
        )(requireLoaded);
        const playerBindings = [...parts.playerSource.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g)];
        const imported = name => {
            const matches = playerBindings.filter(match => match[1] === name);
            if (matches.length !== 1 || !cache?.[matches[0][2]]?.exports) throw Error("Reviewed overlay dependency unavailable.");
            return cache[matches[0][2]].exports;
        };
        const liveModule = imported("f");
        const Live = liveModule.Ay;
        if (!Live || Live.Sizes?.SMALL === undefined) throw Error("Native LIVE contract unavailable.");
        const overlay = replaceOnce(parts.overlay,
            "u=(0,a.bG)([O.A],()=>O.A.getActiveStreamForUser(t.user.id,t.stream.guildId))", "u=e.dassStatus");
        const enums = imported("q");
        const renderOverlay = new Function("i","X","f","Y","q","K","S", overlay + ";return en;")(
            imported("i"), imported("X"), liveModule, imported("Y"), enums,
            { A: () => null }, { A: ({ size, className }) => h(Live, { size, className }) }
        );
        const types = cache?.["806931"]?.exports?.lp;
        const Idle = cache?.["461782"]?.exports?.vG;
        const computerIcon = cache?.["31300"]?.exports?.k;
        if (!types || !Idle || !computerIcon || !enums.XYD) {
            throw Error("Native type/idle/icon contract unavailable.");
        }
        Object.assign(parts, { renderCard, Overlay: renderOverlay, states: enums.XYD, types, Idle, computerIcon });
    } catch (error) {
        return "Normal-card preparation failed: " + error.message;
    }
    return "Original non-focused card/footer/overlay ready in a private namespace. Quality, health, zoom and popout remain outside this test.";
})();
