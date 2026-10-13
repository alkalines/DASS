/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_FOCUS_RESEARCH__";
    const grid = globalThis.__DASS_CALL_GRID_RESEARCH__;
    if (grid?.marker !== "dass-call-grid-v1" || typeof grid.setFocusRenderer !== "function")
        return "Restore the old grid, run updated 52, then 56, then this file.";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-focus-v1") return "Preview name is already in use.";
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const NativeTile = cache?.["175203"]?.exports?.Ay;
    const strip = cache?.["163432"]?.exports;
    const Button = cache?.["821609"]?.exports?.$;
    const types = cache?.["806931"]?.exports?.lp;
    const layout = cache?.["652215"]?.exports?.DUB;
    const focusSource = webpack?.wreq?.m?.["699707"]?.toString() || "";
    const endedSource = webpack?.wreq?.m?.["566331"]?.toString() || "";
    if (!React || !NativeTile || typeof strip?.Ay !== "function" || typeof strip?.i4 !== "function" ||
        typeof Button !== "function" || types?.STREAM === undefined || layout?.NORMAL === undefined ||
        !focusSource.includes("getVideoComponent()") || !focusSource.includes(".Cf)(S,P,B)") ||
        !focusSource.includes("selectedParticipantId:P.id") ||
        !endedSource.includes("Kb4Ukp") || !endedSource.includes("4EGMWL"))
        return "Required inspected focus/ended source or exports changed. Nothing installed.";
    const h = React.createElement;
    const mockId = "dass-ui-research:mock-tile";
    const isMock = participant => participant?.__dassFocusMock === true && participant.id === mockId;
    function compileIsolated(source, overrides) {
        const signature = source.match(/^\d+\(([\w$]+),([\w$]+),([\w$]+)\)\{/);
        if (!signature || !source.endsWith("}")) throw Error("Native module wrapper changed.");
        const exports = {};
        function requireLoaded(id) {
            if (Object.hasOwn(overrides, id)) return overrides[id];
            const value = cache?.[String(id)]?.exports;
            if (!value) throw Error("A required UI dependency is not loaded.");
            return value;
        }
        requireLoaded.d = (target, getters) => {
            for (const [name, get] of Object.entries(getters)) Object.defineProperty(target, name, { enumerable: true, get });
        };
        requireLoaded.n = value => () => value?.__esModule ? value.default : value;
        const body = source.slice(signature[0].length, -1);
        new Function(signature[1], signature[2], signature[3], body)({ exports }, exports, requireLoaded);
        return exports;
    }
    function FocusTile(props) {
        const participant = props.participant;
        if (!isMock(participant)) {
            if (participant?.__dassFocusMock) return null;
            return h(NativeTile, props);
        }
        const model = participant.presentation;
        if (typeof model.mockRenderer !== "function") return null;
        return h(model.mockRenderer, {
            width: props.width, solo: true, focused: true, ended: model.ended,
            rootProps: model.rootProps, onSelect: model.onSelectMock,
            onReturnGrid: model.onReturnGrid, onToggleEnded: model.onToggleEnded,
            onDismiss: model.onDismiss, onRestore: model.onRestore,
            endedPresentation: model.ended ? h(Ended, {
                width: props.width,
                stream: { __mockClose: model.onDismiss }
            }) : null
        });
    }
    function Strip(props) {
        if (!Array.isArray(props.participants) || props.participants.some(isMock)) return null;
        return h(strip.Ay, { ...props, selectedParticipantId: null });
    }
    const genuineSizing = (width, participants) => {
        if (!Array.isArray(participants) || participants.some(isMock)) throw Error("Mock identity must not enter native strip sizing.");
        return strip.i4(width, participants);
    };
    let Focus, Ended;
    try {
        Ended = compileIsolated(endedSource, {
            17928: { bG: () => null },
            964486: { Ay() {} },
            652896: { _z: model => model.__mockClose },
            401843: { Xi: close => { if (typeof close === "function") close(); } }
        }).A;
        Focus = compileIsolated(focusSource, {
            192820: { Ay: { getVideoComponent: () => null } },
            280450: { default: { getId: () => null } },
            216418: { A: () => null },
            947580: { Cf: () => [] },
            175203: { ...cache["175203"].exports, Ay: FocusTile },
            163432: { ...strip, Ay: Strip, i4: genuineSizing },
            80051: { A: () => null },
            625494: { _: { dispatch() {} } }
        }).A;
        if (typeof Focus !== "function" || typeof Ended !== "function") throw Error("Native layout exports changed.");
    } catch {
        return "Isolated native focus/ended preparation failed. Nothing installed.";
    }
    previous?.cleanup();
    let observer, removed = false;
    const api = {
        marker: "dass-focus-v1",
        cleanup() {
            if (removed) return;
            removed = true;
            observer?.disconnect();
            if (globalThis[key] === api) delete globalThis[key];
            if (globalThis.__DASS_CALL_GRID_RESEARCH__ === grid) grid.setFocusRenderer(null);
        }
    };
    function FocusView(model) {
        const ref = React.useRef(null);
        const [size, setSize] = React.useState({ width: 0, height: 0 });
        React.useLayoutEffect(() => {
            const element = ref.current;
            if (!element) return;
            const measure = () => {
                const bounds = element.getBoundingClientRect();
                setSize(previous => previous.width === bounds.width && previous.height === bounds.height
                    ? previous : { width: bounds.width, height: bounds.height });
            };
            const resize = new ResizeObserver(measure);
            resize.observe(element);
            measure();
            return () => resize.disconnect();
        }, []);
        const selected = React.useMemo(() => ({
            id: mockId, type: types.STREAM, streamId: null, __dassFocusMock: true,
            presentation: model
        }), [model.rootProps, model.records, model.mockRenderer, model.ended]);
        function selectReal(participant, event) {
            if (isMock(participant)) return;
            model.onReturnGrid();
            model.rootProps.onSelectParticipant?.(participant, event);
        }
        return h("div", { ref, style: { width: "100%", height: "100%", minHeight: 0, minWidth: 0, position: "relative" } },
            h("div", { style: { position: "absolute", top: 8, left: 8, zIndex: 5 } },
                h(Button, { text: "Return to grid", variant: "secondary", size: "sm", onClick: model.onReturnGrid })),
            size.width > 0 && size.height > 0 ? h(Focus, {
                participants: model.records, filteredParticipants: model.records,
                selectedParticipant: selected,
                onSelectParticipant: selectReal,
                onContextMenuParticipant: model.rootProps.onContextMenuParticipant,
                onFullscreenParticipant: undefined,
                popoutType: model.rootProps.popoutType, inCall: model.rootProps.inCall,
                channel: model.rootProps.channel, showParticipants: true,
                width: size.width, height: size.height, layout: layout.NORMAL, idle: false
            }) : null
        );
    }
    globalThis[key] = api;
    try {
        observer = new MutationObserver(() => {
            if (globalThis.__DASS_CALL_GRID_RESEARCH__ !== grid) api.cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (!grid.setFocusRenderer(FocusView)) throw Error("Focus renderer slot unavailable.");
    } catch {
        api.cleanup();
        return "Focus addon setup failed and was removed.";
    }
    return "Native focus geometry/real filmstrip and native ended artwork installed with scoped action/media guards.";
})();
