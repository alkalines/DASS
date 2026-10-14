// Generated DASS normal-card research demo. Rebuild with bun scripts/build-ui-reuse-demo.mjs.
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Research only. Generated local video; no capture/share/watch/backend requests.
 * Select an idle voice participant in Elements before running.
 * Non-focused card only; quality/health/zoom/popout/audio remain outside the test.
 */
(() => {
    const oldParts = globalThis.__DASS_NORMAL_CARD_TEST__;
    const oldCall = globalThis.__DASS_CALL_VIDEO_TEST__;
    if (oldParts && oldParts.marker !== "dass-normal-card-v1" ||
        oldCall && oldCall.marker !== "dass-call-video-test-v1")
        return "Research name occupied by another script. Nothing changed.";
    if (typeof $0 === "undefined" || !$0?.isConnected)
        return "Select a connected idle voice participant in Elements first.";
    const fiberKey = Object.keys($0).find(key => key.startsWith("__reactFiber$"));
    let selectedController;
    for (let fiber = $0[fiberKey], depth = 0; fiber && depth < 70; fiber = fiber.return, depth++) {
        if (typeof fiber.stateNode?.renderContent === "function" &&
            typeof fiber.stateNode?.handleSelectParticipant === "function") {
            selectedController = fiber.stateNode;
            break;
        }
    }
    if (!selectedController) return "Select an actual idle call participant first.";
    try {
        oldParts?.cleanup?.();
        oldCall?.cleanup?.();
    } catch {
        return "Previous test cleanup failed. No new test installed.";
    }
    const stages = [{ name: "source parts", run: () => {
    const key = "__DASS_NORMAL_CARD_TEST__";
    if (globalThis[key]) return "Normal-card test already prepared. Remove it before repeating.";
    const webpack = Vencord.Webpack;
    const cache = webpack.cache || webpack.wreq.c;
    const source = webpack.wreq.m["175203"].toString();
    const requireName = source.match(/^175203\([\w$]+,[\w$]+,([\w$]+)\)\{/)?.[1];
    const bindings = [...source.matchAll(/\b([\w$]+)\s*=\s*[\w$]+\(\s*(\d+)\s*\)/g)];
    const alias = id => {
        const matches = bindings.filter(match => match[2] === String(id));
        return matches.length === 1 ? matches[0][1] : null;
    };
    if (!requireName || alias(477900) !== "t" || alias(582128) !== "i" ||
        alias(806931) !== "eR" || alias(345812) !== "eS" || alias(17928) !== "r" || alias(141035) !== "ej")
        return "Current reviewed tile profile changed. Nothing prepared.";
    const importsStart = source.indexOf(`var t=${requireName}(`);
    const importsEnd = source.indexOf(";let ", importsStart);
    const helperStart = source.search(/function\s+[\w$]+\([\w$]+\)\{let\{participantType:/);
    const controlStart = source.search(/function\s+[\w$]+\([\w$]+\)\{let\{icon:/);
    const helpersEnd = source.indexOf("function ", controlStart + 10);
    const renderStart = source.lastIndexOf("return(0,t.", helperStart);
    const label = source.match(/\bew\.displayName=["']CallTileOverlay["']/);
    const footerStart = source.indexOf("ew=i.memo(");
    if (importsStart < 0 || importsEnd <= importsStart || helperStart < 0 || controlStart <= helperStart ||
        helpersEnd <= controlStart || renderStart < 0 || footerStart < 0 || !label || label.index <= footerStart)
        return "Reviewed render/footer/helper boundaries changed. Nothing prepared.";
    const render = source.slice(renderStart, helperStart).trim();
    if (!render.endsWith("});") || render.length > 2100) return "Reviewed render body changed.";
    const playerSource = webpack.wreq.m["802867"].toString();
    const overlayStart = playerSource.indexOf("function en(");
    const overlayEnd = playerSource.indexOf("function ei(", overlayStart);
    if (overlayStart < 0 || overlayEnd <= overlayStart || overlayEnd - overlayStart !== 453)
        return "Reviewed overlay changed. Nothing prepared.";
    const parts = {
        marker: "dass-normal-card-v1", React: webpack.Common.React, cache, requireName,
        imports: source.slice(importsStart, importsEnd + 1),
        helpers: source.slice(helperStart, helpersEnd),
        footer: source.slice(footerStart, label.index).trim(),
        render: render.slice(0, -3) + ";",
        overlay: playerSource.slice(overlayStart, overlayEnd), playerSource,
        cleanup() { if (globalThis[key] === parts) delete globalThis[key]; }
    };
    globalThis[key] = parts;
    return "Original card, footer/helpers and overlay prepared. Nothing mounted or captured.";
}, check: () => globalThis.__DASS_NORMAL_CARD_TEST__?.marker === 'dass-normal-card-v1' },
{ name: "card/footer", run: () => {
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
}, check: () => typeof globalThis.__DASS_NORMAL_CARD_TEST__?.renderCard === 'function' },
{ name: "overlay/video", run: () => {
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
}, check: () => !!globalThis.__DASS_NORMAL_CARD_TEST__?.Video },
{ name: "idle call", run: () => {
    const key = "__DASS_CALL_VIDEO_TEST__";
    if (globalThis[key]) return "Call test name occupied. Remove the previous test first.";

    const controller = selectedController;
    if (!controller?._wrapperRef?.current?.isConnected) return "Selected call controller is no longer mounted.";
    const webpack = Vencord.Webpack;
    const cache = webpack.cache || webpack.wreq.c;
    const components = {
        Root: cache?.["874739"]?.exports?.A,
        Grid: cache?.["511205"]?.exports?.A,
        Tile: cache?.["175203"]?.exports?.Ay,
        Frame: cache?.["272812"]?.exports?.A,
        Flex: cache?.["235986"]?.exports?.A
    };
    const renderable = value => typeof value === "function" ||
        (value !== null && typeof value === "object" && value.$$typeof != null);
    if (!Object.values(components).every(renderable)) return "A required host component is unavailable.";
    const props = controller.props;
    if (!props?.inCall || props.selectedParticipant || controller.popoutOpen || controller.inPopout ||
        props.awaitingRemoteSessionInfo || props.guildRoomVisible || props.channel?.isGuildStageVoice?.() ||
        (props.currentChannelActivities?.length ?? 0) !== 0 ||
        !Array.isArray(props.allActiveStreams) || props.allActiveStreams.length !== 0 ||
        !Array.isArray(props.participants) || !Array.isArray(props.filteredParticipants) ||
        [...props.participants, ...props.filteredParticipants].some(item => !item || item.stream != null || item.streamId != null))
        return "Use an idle call without video, streams, selection, activities or popouts.";
    const css = cache?.["804273"]?.exports;
    const tileClass = cache?.["886179"]?.exports?.V;
    const modes = cache?.["652215"]?.exports?._Of;
    const descriptor = Object.getOwnPropertyDescriptor(controller, "renderContent");
    if (!webpack.Common?.React || typeof css?.HA !== "string" || typeof css?.g9 !== "string" ||
        typeof tileClass !== "string" || modes?.VOICE === undefined || props.mode !== modes.VOICE ||
        !Object.isExtensible(controller) || descriptor?.configurable === false ||
        typeof controller.forceUpdate !== "function")
        return "Required idle-call layout or restoration contract is unavailable.";
    const test = {
        marker: "dass-call-video-test-v1", controller, components, css, tileClass, modes,
        React: webpack.Common.React, original: controller.renderContent, descriptor,
        channel: props.channel, mounted: false,
        cleanup() { if (globalThis[key] === test) delete globalThis[key]; }
    };
    globalThis[key] = test;
    return "Idle call test prepared. Original rendering unchanged.";
}, check: () => globalThis.__DASS_CALL_VIDEO_TEST__?.marker === 'dass-call-video-test-v1' },
{ name: "generated media", run: () => {
    const p = globalThis.__DASS_NORMAL_CARD_TEST__;
    const call = globalThis.__DASS_CALL_VIDEO_TEST__;
    if (p?.marker !== "dass-normal-card-v1" || !p.renderCard || !p.Video || !p.Overlay ||
        call?.marker !== "dass-call-video-test-v1" || call.mounted)
        return "Prepare original presentation and an unmounted idle call first.";
    const { React, cache } = p;
    const h = React.createElement;
    const common = Vencord.Webpack.Common;
    const Menu = common.Menu;
    const contextMenus = common.ContextMenuApi;
    if (!Menu?.Menu || !Menu.MenuItem || !Menu.MenuCheckboxItem ||
        typeof contextMenus?.openContextMenu !== "function" || typeof contextMenus?.closeContextMenu !== "function")
        return "Required host menu UI unavailable.";
    const partsCleanup = p.cleanup;
    p.producers = new Set();
    let activeMenu = null;
    function closeOwnedMenu() {
        const session = activeMenu;
        if (!session) return;
        activeMenu = null;
        if (session.mounted) contextMenus.closeContextMenu();
        session.closed();
    }
    p.cleanup = () => {
        try { call.cleanup(); }
        finally {
            try { closeOwnedMenu(); }
            finally {
                for (const release of [...p.producers]) release();
                partsCleanup();
            }
        }
    };
    function Media({ className, paused, onReady, onResize, onGeneratedReady }) {
        const ref = React.useRef(null);
        const owner = React.useRef(null);
        React.useEffect(() => {
            const video = ref.current;
            const canvas = document.createElement("canvas");
            canvas.width = 640; canvas.height = 360;
            const context = canvas.getContext("2d");
            if (!context || !canvas.captureStream) throw Error("Generated video unavailable.");
            const stream = canvas.captureStream(15);
            let disposed = false, timer, delay;
            const release = () => {
                if (disposed) return;
                disposed = true;
                clearTimeout(delay); clearInterval(timer);
                video.pause(); video.srcObject = null;
                stream.getTracks().forEach(track => track.stop());
                p.producers.delete(release);
                owner.current = null;
            };
            owner.current = { release };
            p.producers.add(release);
            timer = setInterval(() => {
                context.fillStyle = `hsl(${performance.now() / 40 % 360},65%,35%)`;
                context.fillRect(0, 0, 640, 360);
                context.fillStyle = "white"; context.font = "28px sans-serif";
                context.fillText("Generated video - UI test", 32, 140);
                context.fillText((performance.now() / 1000).toFixed(1) + " seconds", 32, 190);
            }, 100);
            delay = setTimeout(() => { if (!disposed) video.srcObject = stream; }, 1800);
            return release;
        }, []);
        React.useEffect(() => {
            const video = ref.current;
            if (paused) video.pause();
            else if (video.srcObject) void video.play().catch(() => { p.mediaStatus = "Generated playback blocked."; });
        }, [paused]);
        return h("video", {
            ref, className, muted: true, playsInline: true, autoPlay: !paused,
            onLoadedData: event => {
                if (!owner.current) return;
                onResize?.({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
                onReady?.(); onGeneratedReady?.();
                p.mediaStatus = "Generated video ready; no transport.";
            }
        });
    }
    p.Card = function Card({ width }) {
        const [hovered, setHovered] = React.useState(false);
        const [muted, setMuted] = React.useState(false);
        const [paused, setPaused] = React.useState(false);
        const [ready, setReady] = React.useState(false);
        const [menuOpen, setMenuOpen] = React.useState(false);
        const mounted = React.useRef(false);
        const owner = React.useRef({});
        const frame = React.useRef(null);
        const idle = React.useContext(p.Idle) === true && !hovered;
        React.useEffect(() => {
            mounted.current = true;
            return () => {
                mounted.current = false;
                if (activeMenu?.owner === owner.current) closeOwnedMenu();
            };
        }, []);
        function openMenu(event) {
            event.preventDefault(); event.stopPropagation(); closeOwnedMenu();
            const session = {
                owner: owner.current, mounted: false,
                closed() { if (mounted.current) setMenuOpen(false); }
            };
            activeMenu = session;
            setMenuOpen(true);
            function TestMenu() {
                React.useEffect(() => {
                    session.mounted = true;
                    return () => {
                        session.mounted = false;
                        if (activeMenu === session) activeMenu = null;
                        session.closed();
                    };
                }, []);
                return h(Menu.Menu, { navId: "dass-normal-card-test", "aria-label": "Generated video UI test", onClose: closeOwnedMenu },
                    h(Menu.MenuCheckboxItem, { id: "test-pause", label: "Pause generated preview", checked: paused,
                        action: () => { setPaused(!paused); closeOwnedMenu(); } }),
                    h(Menu.MenuCheckboxItem, { id: "test-mute-icon", label: "Mute icon (UI only; no audio)", checked: muted,
                        action: () => { setMuted(!muted); closeOwnedMenu(); } }),
                    h(Menu.MenuItem, { id: "test-popout", label: "Pop Out Stream", disabled: true }),
                    h(Menu.MenuItem, { id: "test-restore", label: "Restore call and remove test", action: p.cleanup }));
            }
            try {
                contextMenus.openContextMenu(event, () => h(TestMenu), { onClose: () => {
                    if (activeMenu === session) activeMenu = null;
                    session.closed();
                } });
            } catch {
                if (activeMenu === session) activeMenu = null;
                session.closed();
                p.menuStatus = "Host test menu could not open.";
            }
        }
        const actor = { id: "dass-research:normal-card", type: p.types.STREAM, streamId: null, __dassUiTest: true };
        // Pass generated readiness through the supplied leaf without changing the original wrapper contract.
        const MediaWithReadiness = React.useMemo(() => function Leaf(props) {
            return h(Media, { ...props, onGeneratedReady: () => setReady(true) });
        }, []);
        const ownedMedia = h(p.Video, { streamId: "dass-research:generated-media", videoComponent: MediaWithReadiness,
            fit: "contain", paused, userId: null, streamKey: null, videoSpinnerContext: "dass-research" });
        const overlay = h(p.Overlay, { participant: actor, selected: false, focused: false, idle, width,
            dassStatus: ready ? { state: p.states.ACTIVE } : null });
        return p.renderCard({
            scopeTitle: "Generated video • UI simulation", menuOpen, setMenuOpen,
            u: actor, x: call.controller.props.popoutType, I: undefined, y: undefined, T: undefined,
            j: undefined, f: undefined, g: call.tileClass, E: undefined, N: undefined,
            v: call.channel, C: width, b: true, O: false, R: false, k: false,
            M: false, L: false, z: paused, B: 0, Q: idle, eP: false, eh: setHovered,
            eL: false, e8: frame, ey: null, e1: "Generated video UI simulation; no transport", eq: undefined,
            eZ: openMenu, eK: event => event.stopPropagation(), eX: null, e6: width, e2: undefined,
            e$: ownedMedia, e0: overlay, e9: p.computerIcon, eD: [p.types.ACTIVITY], eG: true,
            eY: { localMuted: muted, muted: false, deafened: false, serverMuted: false, serverDeafened: false },
            eH: undefined, eN: false, eS: undefined, eW: false, eJ: () => setMuted(!muted),
            eF: false, ep: hovered, ez: false, e5: undefined, ee: false, es: false, ex: null, K: false, e3: false
        });
    };
    call.Sample = p.Card;
    p.call = call;
    return "Original non-focused card connected to generated media. Nothing mounted yet.";
}, check: () => typeof globalThis.__DASS_CALL_VIDEO_TEST__?.Sample === 'function' },
{ name: "installation", run: () => {
    const key = "__DASS_CALL_VIDEO_TEST__";
    const test = globalThis[key];
    if (test?.marker !== "dass-call-video-test-v1" || !test.Sample || test.mounted) return "Prepare the call, wrapper and sample first.";
    const { React, controller, original, descriptor, channel, components: { Root, Grid, Tile, Flex } } = test;
    const h = React.createElement;
    const idleRecords = records => Array.isArray(records) && records.every(record =>
        record && typeof record.id === "string" && record.stream == null && record.streamId == null);
    const supported = () => {
        const props = controller.props;
        return props.channel === channel && props.inCall && props.mode === test.modes.VOICE &&
            !props.selectedParticipant && !controller.popoutOpen && !controller.inPopout &&
            !props.awaitingRemoteSessionInfo && !props.guildRoomVisible && !props.channel.isGuildStageVoice() &&
            !(props.currentChannelActivities?.length ?? 0) && Array.isArray(props.allActiveStreams) &&
            props.allActiveStreams.length === 0 && idleRecords(props.participants) && idleRecords(props.filteredParticipants);
    };
    if (!supported() || controller.renderContent !== original || !controller._wrapperRef?.current?.isConnected ||
        !Flex.Justify || !Flex.Align) return "Idle call or original render ownership changed. Nothing installed.";
    let removed = false, observer;
    const cleanup = () => {
        if (removed) return;
        removed = true;
        observer?.disconnect();
        const owned = controller.renderContent === adapted;
        if (owned) {
            if (descriptor) Object.defineProperty(controller, "renderContent", descriptor);
            else delete controller.renderContent;
        }
        if (globalThis[key] === test) delete globalThis[key];
        if (owned && controller._wrapperRef?.current?.isConnected) controller.forceUpdate();
    };
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { test.status = "Own test subtree failed. Restore call."; }
        render() { return this.state.failed ? h("button", { onClick: cleanup }, "Restore call test") : this.props.children; }
    }
    function CallGrid({ rootProps }) {
        const records = rootProps.filteredParticipants;
        const callbacks = records.map(participant => width => h(Tile, {
            participant, channel: rootProps.channel, className: test.tileClass, width,
            inCall: rootProps.inCall, popoutType: rootProps.popoutType,
            onClick: rootProps.onSelectParticipant, onDoubleClick: rootProps.onFullscreenParticipant,
            onContextMenu: rootProps.onContextMenuParticipant
        }));
        callbacks.push(width => h(test.Sample, { width }));
        return h("div", { ref: controller._contentRef, style: { width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex" } },
            h(Flex, { className: test.css.HA, justify: Flex.Justify.CENTER, align: Flex.Align.CENTER },
                h(Grid, { className: test.css.g9, paddingTop: 64, paddingBottom: 64,
                    keyExtractor: index => index === records.length ? "dass-research:call-video" : records[index].id,
                    children: callbacks })));
    }
    function adapted(...args) {
        const shell = original.apply(this, args);
        if (removed || !supported()) { test.status = "Suspended; original call retained."; return shell; }
        const central = shell?.props?.children;
        if (central?.type !== Root || !idleRecords(central.props?.filteredParticipants)) {
            test.status = "Unsupported central shape; original call retained.";
            return shell;
        }
        test.status = "Generated media in actual callback grid.";
        return h(shell.type, { ...shell.props, children: h(Boundary, null, h(CallGrid, { rootProps: central.props })) });
    }
    test.cleanup = cleanup;
    try {
        Object.defineProperty(controller, "renderContent", { value: adapted, configurable: true, writable: true });
        test.mounted = true;
        observer = new MutationObserver(() => { if (!controller._wrapperRef?.current?.isConnected) cleanup(); });
        observer.observe(document.body, { childList: true, subtree: true });
        controller.forceUpdate();
    } catch {
        cleanup();
        return "Installation failed and owned render changes were restored.";
    }
    return "Actual call-grid test installed. Check status if absent; Restore call removes owned media and adaptation.";
}, check: () => globalThis.__DASS_CALL_VIDEO_TEST__?.mounted === true }];
    for (const stage of stages) {
        try {
            const result = stage.run();
            if (!stage.check()) {
                globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup?.();
                globalThis.__DASS_CALL_VIDEO_TEST__?.cleanup?.();
                return "Stopped at " + stage.name + ": " + result;
            }
        } catch {
            globalThis.__DASS_NORMAL_CARD_TEST__?.cleanup?.();
            globalThis.__DASS_CALL_VIDEO_TEST__?.cleanup?.();
            return "Stopped at " + stage.name + ". Owned changes restored.";
        }
    }
    return "Original non-focused card demo installed. Generated video only. Cleanup: __DASS_NORMAL_CARD_TEST__.cleanup()";
})();
