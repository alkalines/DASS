/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_SOURCE_CARD_RESEARCH__";
    const grid = globalThis.__DASS_CALL_GRID_RESEARCH__;
    if (grid?.marker !== "dass-call-grid-v1" || typeof grid.setMockRenderer !== "function")
        return "Restore the grid test, run the updated 52-native-call-grid-sandbox.js, then run this snippet.";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-source-card-v1") return "Preview name is already in use.";
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const factory = webpack?.wreq?.m?.["175203"];
    const source = typeof factory === "function" ? factory.toString() : "";
    const Live = cache?.["402216"]?.exports?.Ay;
    const Badge = cache?.["812993"]?.exports?.Lp;
    const shapes = cache?.["812993"]?.exports?.EG;
    const Button = cache?.["821609"]?.exports?.$;
    const playerFactory = webpack?.wreq?.m?.["802867"];
    const playerSource = typeof playerFactory === "function" ? playerFactory.toString() : "";
    const cssBindings = Array.from(playerSource.matchAll(/\bY\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g));
    const playerCssModuleId = cssBindings.length === 1 ? cssBindings[0][1] : null;
    const playerCss = playerCssModuleId ? cache?.[playerCssModuleId]?.exports : null;
    const Idle = cache?.["461782"]?.exports?.vG;
    const types = cache?.["806931"]?.exports?.lp;
    const Menu = webpack?.Common?.Menu;
    const contextMenus = webpack?.Common?.ContextMenuApi;
    const StopIcon = cache?.["959988"]?.exports?.G;
    const ChangeIcon = cache?.["183623"]?.exports?.F;
    const PopoutIcon = cache?.["811893"]?.exports?.t;
    const checks = [
        ["host React", !!React], ["tile source", !!source], ["idle context", !!Idle],
        ["LIVE export", typeof Live === "function"], ["text badge export", typeof Badge === "function"],
        ["secondary button export", typeof Button === "function"],
        ["tile class", typeof cache?.["886179"]?.exports?.V === "string"],
        ["computer icon", !!cache?.["31300"]?.exports?.k],
        ["stream type", types?.STREAM !== undefined && types.STREAM !== types.USER],
        ["LIVE small size", Live?.Sizes?.SMALL !== undefined],
        ...["ROUND", "ROUND_LEFT", "ROUND_RIGHT"].map(name => ["badge shape " + name, shapes?.[name] !== undefined]),
        ["unique player CSS binding", cssBindings.length === 1],
        ["player CSS Qs", typeof playerCss?.Qs === "string"],
        ["player CSS Ok", typeof playerCss?.Ok === "string"],
        ...["Menu", "MenuItem", "MenuGroup", "MenuCheckboxItem", "MenuSeparator"].map(name => ["native " + name, typeof Menu?.[name] === "function"]),
        ["context menu open", typeof contextMenus?.openContextMenu === "function"],
        ["context menu close", typeof contextMenus?.closeContextMenu === "function"]
    ];
    const missing = checks.filter(([, available]) => !available).map(([name]) => name);
    if (missing.length) return JSON.stringify({
        error: "Required native presentation dependencies are missing. Nothing changed.",
        missing, playerCssModuleId, playerCssBindingCount: cssBindings.length
    });
    const requireName = source.match(/^\s*\d+\([\w$]+,[\w$]+,([\w$]+)\)\{/)?.[1];
    const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bindings = requireName ? Array.from(source.matchAll(new RegExp("\\b([\\w$]+)=" + escapeRegex(requireName) + "\\((\\d+)\\)", "g"))) : [];
    const alias = id => {
        const matches = bindings.filter(match => match[2] === id);
        return matches.length === 1 ? matches[0][1] : null;
    };
    const jsx = alias("477900"), react = alias("582128"), typeAlias = alias("806931");
    const widthAlias = alias("345812"), storeAlias = alias("17928"), titleAlias = alias("141035");
    const actorName = source.match(/\bparticipant:([\w$]+),popoutType:/)?.[1];
    const profile = jsx === "i" && react === "s" && actorName === "p" && typeAlias === "e_" && widthAlias === "eC" ? "original"
        : jsx === "t" && react === "i" && actorName === "u" && typeAlias === "eR" && widthAlias === "eS" ? "current" : null;
    if (!profile || !requireName || !storeAlias || !titleAlias) return JSON.stringify({
        error: "Unreviewed native source profile. Nothing changed.",
        sourceLength: source.length, aliases: { requireName, jsx, react, typeAlias, widthAlias, storeAlias, titleAlias, actorName }
    });
    const label = source.match(/\b([\w$]+)\.displayName=["']CallTileOverlay["']/);
    const footerName = label?.[1];
    const importsStart = source.indexOf(`var ${jsx}=${requireName}(`);
    const importsEnd = source.indexOf(";let ", importsStart);
    const iconStart = source.match(/function\s+[\w$]+\([\w$]+\)\{let\{participantType:/)?.index ?? -1;
    const controlStart = source.match(/function\s+[\w$]+\([\w$]+\)\{let\{icon:/)?.index ?? -1;
    const unsafeControlStart = controlStart >= 0 ? source.indexOf("function ", controlStart + 10) : -1;
    const footerStart = footerName ? source.indexOf(`${footerName}=${react}.memo(`) : -1;
    const footerEnd = label?.index ?? -1;
    const renderStart = iconStart >= 0 ? source.lastIndexOf(`return(0,${jsx}.`, iconStart) : -1;
    const coordinateChecks = [
        ["importsStart", importsStart >= 0],
        ["importsEnd", importsStart >= 0 && importsEnd > importsStart],
        ["iconStart", iconStart >= 0],
        ["controlStart", iconStart >= 0 && controlStart > iconStart],
        ["unsafeControlStart", controlStart >= 0 && unsafeControlStart > controlStart],
        ["footerStart", footerStart >= 0],
        ["footerEnd", footerStart >= 0 && footerEnd > footerStart],
        ["renderStart", renderStart >= 0 && iconStart > renderStart]
    ];
    const failedCoordinates = coordinateChecks.filter(([, found]) => !found).map(([name]) => name);
    if (failedCoordinates.length) return JSON.stringify({
        error: "Native source coordinates changed. Nothing changed.",
        sourceLength: source.length, failedCoordinates,
        coordinates: { importsStart, importsEnd, iconStart, controlStart, unsafeControlStart, footerStart, footerEnd, renderStart },
        sourceHead: source.slice(0, 450), sourceTail: source.slice(-250)
    });
    const imports = source.slice(importsStart, importsEnd + 1);
    const helpers = source.slice(iconStart, unsafeControlStart);
    let footer = source.slice(footerStart, footerEnd).trim();
    let render = source.slice(renderStart, iconStart).trim();
    if (!render.endsWith("});")) return "Native renderer ending changed. Nothing changed.";
    render = render.slice(0, -3) + ";";
    const prefixStart = footer.indexOf(`,en=(0,${storeAlias}.bG)`);
    const effectEnd = footer.indexOf("},[]);let ", prefixStart);
    const prefixEnd = effectEnd >= 0 ? effectEnd + "},[])".length : -1;
    if (prefixStart < 0 || prefixEnd <= prefixStart) return "Footer setup changed. Nothing changed.";
    const projectedPrefix = profile === "original" ? `;
        let en=null,ea=null,ed=null,er=false,em="",
            eh=(0,eC.Yb)(n),ex=(0,eC.VE)(n),ev=(0,eC.DO)(n),
            ej=e.mockMenuOpen===true,eg=e.mockSetMenuOpen;
    ` : `;
        let en=null,ea=null,eo=null,ec=false,er=null,em="",
            eA=(0,eS.Yb)(n),ex=(0,eS.VE)(n),eI=(0,eS.DO)(n),
            ey=e.mockMenuOpen===true,eT=e.mockSetMenuOpen;
    `;
    footer = footer.slice(0, prefixStart) + projectedPrefix + footer.slice(prefixEnd);
    function replaceOnce(text, before, after) {
        if (text.split(before).length !== 2) throw Error("Native presentation signature changed.");
        return text.replace(before, after);
    }
    try {
        if (profile === "original") {
            footer = replaceOnce(footer, "r&&x===e_.lp.STREAM&&ef.push", "false&&ef.push");
            footer = replaceOnce(footer, "r?Z===$.N.CALL_TILE", "false?Z===$.N.CALL_TILE");
            render = replaceOnce(render, `title:(0,${titleAlias}.A)(T,p)`, "title:mockTitle");
        } else {
            footer = replaceOnce(footer, "c&&x===eR.lp.STREAM&&eE.push", "false&&eE.push");
            footer = replaceOnce(footer, "c?$===z.N.CALL_TILE", "false?$===z.N.CALL_TILE");
            render = replaceOnce(render, `title:(0,${titleAlias}.A)(v,u)`, "title:mockTitle");
        }
        render = replaceOnce(render, `(0,${jsx}.jsx)(${footerName},{focused:`, `(0,${jsx}.jsx)(${footerName},{mockMenuOpen:menuOpen,mockSetMenuOpen:setMenuOpen,focused:`);
    } catch {
        return "Native footer/render signatures changed. Nothing changed.";
    }
    for (const [name, threshold] of [["Yb",124],["VE",220],["DO",160]]) {
        const helper = cache?.["345812"]?.exports?.[name];
        const pattern = new RegExp("^function [\\w$]+\\(([\\w$]+)\\)\\{return \\1<=" + threshold + "\\}$");
        if (typeof helper !== "function" || !pattern.test(helper.toString()))
            return "Native width helper changed. Nothing changed.";
    }
    const h = React.createElement;
    function Pass({ children }) { return children; }
    function ShakePresentation({ children, className }) { return h("div", { className }, children); }
    function Nothing() { return null; }
    function loadedRequire(id) {
        const exports = cache?.[String(id)]?.exports;
        if (!exports) throw Error("A required native dependency is not loaded.");
        if (id === 820284) return { ...exports, A: Pass };
        if (id === 40056) return { ...exports, Ay: Pass };
        if (id === 551826) return { ...exports, A: ShakePresentation };
        if (id === 612258) return { ...exports, A: Nothing };
        return exports;
    }
    loadedRequire.n = value => () => value?.__esModule ? value.default : value;
    function projectScope(data) {
        const { rootProps, width, idle, hovered, muted, ref, media, overlay, onSelect, setHovered, setMuted, menuOpen, setMenuOpen, openMenu, isOwner } = data;
        const actor = { id: "dass-ui-research:mock-tile", type: types.STREAM, streamId: null };
        const muteFlags = { localMuted: muted, muted: false, deafened: false, serverMuted: false, serverDeafened: false };
        const contextMenu = openMenu;
        const common = { mockTitle: "Mock broadcaster", menuOpen, setMenuOpen };
        if (profile === "current") return {
            ...common, u: actor, x: rootProps.popoutType, I: undefined, y: undefined, T: onSelect,
            j: undefined, f: undefined, g: cache["886179"].exports.V, E: undefined, N: undefined,
            v: rootProps.channel, C: width, b: rootProps.inCall, O: false, R: false, k: false,
            M: false, L: false, z: false, B: 0, Q: idle, eP: false, eh: setHovered,
            eL: false, e8: ref, ey: null, e1: "Mock stream, no media", eq: undefined,
            eZ: contextMenu, eK: onSelect, eX: null, e6: width, e2: undefined,
            e$: media, e0: overlay, e9: cache["31300"].exports.k, eD: [types.ACTIVITY],
            eG: true, eY: muteFlags, eH: undefined, eN: false, eS: undefined, eW: isOwner === true,
            eJ: () => setMuted(value => !value), eF: false, ep: hovered, ez: false,
            e5: undefined, ee: false, es: false, ex: null, K: false, e3: false
        };
        return {
            ...common, p: actor, x: rootProps.popoutType, g: onSelect, I: undefined, y: undefined,
            N: cache["886179"].exports.V, f: undefined, S: undefined, E: width,
            b: rootProps.inCall, O: false, _: false, M: false, U: false, R: false,
            $: false, Y: 0, T: rootProps.channel, X: idle, eL: false, eR: false,
            e2: ref, ej: null, e1: "Mock stream, no media", e9: cache["31300"].exports.k,
            eH: null, e6: width, e8: undefined, eZ: media, e0: overlay, e3: false, eV: true,
            ez: muteFlags, eQ: undefined, eS: false, eC: undefined, eW: isOwner === true,
            eK: contextMenu, eJ: () => setMuted(value => !value), eF: false, eu: hovered,
            e$: false, e7: undefined, ee: false, el: false, ex: null, B: false,
            eA: setHovered, eB: onSelect, eq: undefined, ek: [types.ACTIVITY]
        };
    }
    const scopeKeys = Object.keys(projectScope({ rootProps: {} }));
    let renderPresentation;
    try {
        const compile = new Function(requireName, `"use strict";
            ${imports}
            ${helpers}
            let ${footer}
            return function(scope) {
                const {${scopeKeys.join(",")}}=scope;
                ${render}
            };
        `);
        renderPresentation = compile(loadedRequire);
    } catch {
        return "Native presentation extraction failed. Nothing changed.";
    }
    previous?.cleanup();
    const style = document.createElement("style");
    style.textContent = `
        .dass-source-card-marker { position:absolute; top:32px; left:8px; z-index:2;
          font:11px sans-serif; color:var(--text-normal,#eee); pointer-events:none; }
        .dass-source-card-actions { position:absolute; top:8px; left:8px; z-index:3;
          display:flex; flex-wrap:wrap; gap:4px; max-width:calc(100% - 16px); }
    `;
    let observer, removed = false, activeMenu = null;
    function closeOwnedMenu() {
        if (!activeMenu) return;
        const session = activeMenu;
        activeMenu = null;
        contextMenus.closeContextMenu();
        session.onClosed();
    }
    class MenuBoundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        render() {
            return this.state.failed
                ? h("div", { role: "alert" }, "Mock menu failed. Press Escape or restore the call.")
                : this.props.children;
        }
    }
    const api = {
        marker: "dass-source-card-v1",
        menuIcons: {
            stop: !!StopIcon,
            change: !!ChangeIcon,
            popout: !!PopoutIcon,
            moreOptions: "Native submenu indicator; no leading icon in captured source"
        },
        cleanup() {
            if (removed) return;
            removed = true;
            observer?.disconnect();
            closeOwnedMenu();
            style.remove();
            if (globalThis[key] === api) delete globalThis[key];
            if (globalThis.__DASS_CALL_GRID_RESEARCH__ === grid) grid.setMockRenderer(null);
        }
    };
    function SourceCard({ width, solo, ended, rootProps, onSelect, onReturnGrid, onToggleEnded, onRestore, endedPresentation }) {
        const [hovered, setHovered] = React.useState(false);
        const [muted, setMuted] = React.useState(false);
        const [menuOpen, setMenuOpen] = React.useState(false);
        const [sourceName, setSourceName] = React.useState("Display");
        const [showPreview, setShowPreview] = React.useState(true);
        const [pauseUnfocused, setPauseUnfocused] = React.useState(false);
        const [mockRole, setMockRole] = React.useState("viewer");
        const isOwner = mockRole === "owner";
        const mounted = React.useRef(false);
        const owner = React.useRef({});
        React.useEffect(() => {
            mounted.current = true;
            return () => {
                mounted.current = false;
                if (activeMenu?.owner === owner.current) closeOwnedMenu();
            };
        }, []);
        const callIdle = React.useContext(Idle);
        const ref = React.useRef(null);
        const idle = callIdle === true && !hovered;
        const button = (text, onClick) => h(Button, { text, onClick, variant: "secondary", size: "sm" });
        const showQuality = width > 220 && !idle;
        function openMenu(event) {
            event.preventDefault();
            event.stopPropagation();
            closeOwnedMenu();
            setMenuOpen(true);
            const session = { owner: owner.current, onClosed: () => { if (mounted.current) setMenuOpen(false); } };
            activeMenu = session;
            function OwnerMenu() {
                const [preview, setPreview] = React.useState(showPreview);
                const [pause, setPause] = React.useState(pauseUnfocused);
                React.useEffect(() => () => {
                    if (activeMenu === session) {
                        activeMenu = null;
                        session.onClosed();
                    }
                }, []);
                return h(Menu.Menu, {
                    navId: "dass-source-card-owner-menu",
                    "aria-label": isOwner ? "Mock owner stream options" : "Mock viewer stream options",
                    onClose: closeOwnedMenu
                },
                    isOwner ? h(Menu.MenuGroup, null,
                        h(Menu.MenuItem, { id: "mock-stop", label: "Stop Streaming", color: "danger", icon: StopIcon, leadingAccessory: StopIcon ? { type: "icon", icon: StopIcon } : undefined, action: () => { if (!ended) onToggleEnded(); closeOwnedMenu(); } }),
                        h(Menu.MenuItem, { id: "mock-change", label: "Change Stream", icon: ChangeIcon, leadingAccessory: ChangeIcon ? { type: "icon", icon: ChangeIcon } : undefined, action: () => { setSourceName(value => value === "Display" ? "Window" : "Display"); closeOwnedMenu(); } })) : h(Menu.MenuGroup, null,
                        h(Menu.MenuCheckboxItem, { id: "mock-viewer-mute", label: "Mute", checked: muted, action: () => setMuted(value => !value) })),
                    isOwner ? h(Menu.MenuSeparator) : null,
                    h(Menu.MenuGroup, null,
                        h(Menu.MenuItem, { id: "mock-popout", label: "Pop Out Stream", icon: PopoutIcon, leadingAccessory: PopoutIcon ? { type: "icon", icon: PopoutIcon } : undefined, disabled: true })),
                    isOwner ? h(Menu.MenuSeparator) : null,
                    isOwner ? h(Menu.MenuGroup, null,
                        h(Menu.MenuItem, { id: "mock-more", label: "More Options" },
                            h(Menu.MenuCheckboxItem, {
                                id: "mock-show-preview", label: "Show My screen share", checked: preview,
                                action: () => { setPreview(!preview); setShowPreview(!preview); }
                            }),
                            h(Menu.MenuCheckboxItem, {
                                id: "mock-pause-preview", label: "Pause Preview When Discord Isn't focused", checked: pause,
                                action: () => { setPause(!pause); setPauseUnfocused(!pause); }
                            }))) : null
                );
            }
            try {
                contextMenus.openContextMenu(event, () => h(MenuBoundary, null, h(OwnerMenu)), { onClose: () => {
                    if (activeMenu === session) activeMenu = null;
                    session.onClosed();
                } });
            } catch {
                if (activeMenu === session) activeMenu = null;
                session.onClosed();
                api.menuStatus = "Native menu could not be opened";
            }
        }
        const overlay = ended ? null : h("div", { className: playerCss.Ok, style: { display: "flex" } },
            showQuality ? h(Badge, { text: "1080p 60 FPS", shape: shapes.ROUND_LEFT }) : null,
            h(Live, { size: Live.Sizes.SMALL, shape: showQuality ? shapes.ROUND_RIGHT : shapes.ROUND }));
        const media = h("div", { className: [playerCss.Qs, playerCss.Rh].filter(Boolean).join(" ") },
            ended ? endedPresentation ?? null : null,
            h("span", { className: "dass-source-card-marker" }, ended ? "MOCK ENDED · no media" : "MOCK " + mockRole.toUpperCase() + " · " + (showPreview ? sourceName : "PREVIEW HIDDEN") + (pauseUnfocused ? " · pause-on-blur flag" : "")),
            h("div", { className: "dass-source-card-actions", onClick: event => event.stopPropagation() },
                button(solo ? "Grid" : "Focus", solo ? onReturnGrid ?? onSelect : onSelect),
                button(isOwner ? "Viewer mode" : "Owner mode", () => { closeOwnedMenu(); setMockRole(isOwner ? "viewer" : "owner"); }),
                button(ended ? "Return" : "End", onToggleEnded),
                button("Restore", onRestore)));
        return renderPresentation(projectScope({
            rootProps, width, idle, hovered, muted, ref, media, overlay,
            onSelect, setHovered, setMuted, menuOpen, setMenuOpen, openMenu, isOwner
        }));
    }
    globalThis[key] = api;
    try {
        document.head.append(style);
        observer = new MutationObserver(() => {
            if (globalThis.__DASS_CALL_GRID_RESEARCH__ !== grid) api.cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (!grid.setMockRenderer(SourceCard)) throw Error("Grid renderer slot unavailable.");
    } catch {
        api.cleanup();
        return "Native card setup failed and was removed.";
    }
    return "Original native card/footer presentation installed. Media and connected native actions are bypassed.";
})();
