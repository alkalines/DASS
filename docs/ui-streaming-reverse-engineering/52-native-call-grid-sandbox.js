/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_CALL_GRID_RESEARCH__";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-call-grid-v1") return "Preview name is already in use.";
    if (previous) return "Remove the previous grid test before running again.";
    const element = typeof $0 === "undefined" ? null : $0;
    const fiberKey = element && Object.keys(element).find(name => name.startsWith("__reactFiber$"));
    if (!element?.isConnected || !fiberKey) return "Select a connected native participant tile first.";
    let controller;
    for (let fiber = element[fiberKey], visited = 0; fiber && visited++ < 70; fiber = fiber.return) {
        let type = fiber.type;
        for (let depth = 0; type && typeof type === "object" && depth < 3; depth++) type = type.render ?? type.type;
        if (typeof type === "function" && type.toString().includes("handleSelectParticipant=")) {
            controller = fiber.stateNode;
            break;
        }
    }
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const Grid = cache?.["511205"]?.exports?.A;
    const Tile = cache?.["175203"]?.exports?.Ay;
    const Root = cache?.["874739"]?.exports?.A;
    const Flex = cache?.["235986"]?.exports?.A;
    const rootCss = cache?.["804273"]?.exports;
    const tileCss = cache?.["886179"]?.exports;
    const Frame = cache?.["272812"]?.exports?.A;
    const Live = cache?.["402216"]?.exports?.Ay;
    const Button = cache?.["821609"]?.exports?.$;
    const modes = cache?.["652215"]?.exports?._Of;
    const renderable = value => typeof value === "function" ||
        (value !== null && typeof value === "object" && value.$$typeof != null);
    if (!controller || !React || typeof controller.renderContent !== "function" ||
        typeof controller.forceUpdate !== "function" || !Object.isExtensible(controller) ||
        ![Grid, Tile, Root, Flex, Frame, Live, Button].every(renderable) ||
        !Flex.Justify || !Flex.Align || typeof rootCss?.HA !== "string" ||
        typeof rootCss?.g9 !== "string" || typeof tileCss?.V !== "string" || modes?.VOICE === undefined)
        return "Required call/grid exports are missing. Nothing changed.";
    const channelId = controller.props?.channel?.id;
    const mockKey = "dass-ui-research:mock-tile";
    const recordsAreIdle = records => Array.isArray(records) && records.every(record =>
        record && typeof record.id === "string" && record.id !== mockKey &&
        record.stream == null && record.streamId == null);
    function supported() {
        const props = controller.props;
        return props?.channel?.id === channelId && props.inCall === true && props.mode === modes.VOICE &&
            props.channel.isGuildStageVoice?.() !== true && !props.guildRoomVisible &&
            !props.selectedParticipant && !props.awaitingRemoteSessionInfo &&
            !controller.popoutOpen && !controller.inPopout &&
            Array.isArray(props.allActiveStreams) && props.allActiveStreams.length === 0 &&
            (props.currentChannelActivities?.length ?? 0) === 0 &&
            recordsAreIdle(props.participants) && recordsAreIdle(props.filteredParticipants);
    }
    if (!supported()) return "Use an idle voice call without streams, cameras, activities or popouts. Nothing changed.";
    const own = Object.getOwnPropertyDescriptor(controller, "renderContent");
    if (own && !own.configurable) return "Call render method cannot be adapted. Nothing changed.";
    const original = controller.renderContent;
    const h = React.createElement;
    const style = document.createElement("style");
    style.textContent = `
        .dass-research-call-grid-host { width:100%; height:100%; min-height:0; min-width:0; display:flex; }
        .dass-research-call-grid-mock { width:100%; height:100%; padding:10px;
          box-sizing:border-box; display:flex; flex-direction:column; gap:6px;
          overflow:auto; background:var(--background-secondary,#202025);
          color:var(--text-normal,#eee); font:12px/1.3 sans-serif; }
        .dass-research-call-grid-mock .mock-actions { display:flex; gap:6px; flex-wrap:wrap; }
        .dass-research-call-grid-mock .mock-pattern { flex:1; min-height:20px;
          display:grid; place-items:center; text-align:center;
          background:repeating-linear-gradient(135deg,#41495d 0 12px,#303745 12px 24px); }
    `;
    let observer, removed = false, mockRenderer = null, focusRenderer = null;
    const api = {
        marker: "dass-call-grid-v1", status: "Preparing",
        setMockRenderer(renderer) {
            if (removed || (renderer !== null && !renderable(renderer))) return false;
            mockRenderer = renderer;
            if (controller._wrapperRef?.current?.isConnected) controller.forceUpdate();
            return true;
        },
        setFocusRenderer(renderer) {
            if (removed || (renderer !== null && !renderable(renderer))) return false;
            focusRenderer = renderer;
            if (controller._wrapperRef?.current?.isConnected) controller.forceUpdate();
            return true;
        },
        cleanup() {
            if (removed) return;
            removed = true;
            observer?.disconnect();
            const stillOwned = controller.renderContent === adapted;
            if (stillOwned) {
                if (own) Object.defineProperty(controller, "renderContent", own);
                else delete controller.renderContent;
            }
            style.remove();
            if (globalThis[key] === api) delete globalThis[key];
            if (stillOwned && controller._wrapperRef?.current?.isConnected) controller.forceUpdate();
        }
    };
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        render() {
            return this.state.failed ? h("div", null,
                "Mock grid failed. ", h(Button, { text: "Restore call", variant: "secondary", size: "sm", onClick: api.cleanup }))
                : this.props.children;
        }
    }
    function CallGrid({ rootProps }) {
        const [solo, setSolo] = React.useState(false);
        const [ended, setEnded] = React.useState(false);
        const [visible, setVisible] = React.useState(true);
        const records = rootProps.filteredParticipants;
        const selectMock = () => setSolo(true);
        const returnToGrid = () => { setSolo(false); if (ended) setVisible(false); };
        function toggleEnded() {
            if (!ended && !solo) setVisible(false);
            setEnded(value => !value);
        }
        function dismissMock() { setSolo(false); setVisible(false); }
        const nativeCallbacks = records.map(participant => width => h(Tile, {
            participant, channel: rootProps.channel, className: tileCss.V,
            onClick: rootProps.onSelectParticipant,
            onDoubleClick: rootProps.onFullscreenParticipant,
            onContextMenu: rootProps.onContextMenuParticipant,
            inCall: rootProps.inCall, width, popoutType: rootProps.popoutType
        }, null));
        const button = (text, onClick) => h(Button, { text, onClick, variant: "secondary", size: "sm" });
        const mockCallback = width => mockRenderer ? h(mockRenderer, {
            width, solo, ended, rootProps,
            onSelect: selectMock, onReturnGrid: returnToGrid,
            onToggleEnded: toggleEnded, onDismiss: dismissMock,
            onRestore: api.cleanup
        }) : h(Frame, {
            className: tileCss.V + " dass-research-call-grid-mock",
            style: { minHeight: Math.max(60, Math.floor(width * 9 / 16)) }
        },
            ended ? null : h(Live),
            h("strong", null, "MOCK STREAM · no media"),
            h("div", { className: "mock-pattern" }, ended
                ? "Mock ended view (not the native ended component)"
                : "Native grid test pattern"),
            h("div", { className: "mock-actions" },
                button(solo ? "Return to grid" : "Focus mock", solo ? returnToGrid : selectMock),
                button(ended ? "Mock return" : "Mock end", toggleEnded),
                button("Restore call", api.cleanup)),
            h("small", null, "Local state; no native selection/watch actions")
        );
        const callbacks = solo && visible ? [mockCallback] : [...nativeCallbacks, ...(visible ? [mockCallback] : [])];
        const view = solo && visible && focusRenderer ? h(focusRenderer, {
            rootProps, records, mockRenderer, ended,
            onSelectMock: selectMock, onReturnGrid: returnToGrid,
            onToggleEnded: toggleEnded, onDismiss: dismissMock, onRestore: api.cleanup
        }) : h(Flex, { className: rootCss.HA, justify: Flex.Justify.CENTER, align: Flex.Align.CENTER },
            h(Grid, {
                className: rootCss.g9, paddingTop: 64, paddingBottom: 64,
                keyExtractor: index => solo && visible || index === records.length ? mockKey : records[index].id,
                children: callbacks
            }));
        return h("div", { className: "dass-research-call-grid-host", ref: controller._contentRef },
            visible ? null : h("div", { style: { position: "absolute", top: 8, left: 8, zIndex: 3 } },
                button("Announce mock return", () => { setEnded(false); setVisible(true); })),
            view
        );
    }
    function adapted(...args) {
        const shell = original.apply(this, args);
        if (removed || !supported()) {
            api.status = "Suspended: native call context changed";
            return shell;
        }
        const central = shell?.props?.children;
        if (!shell || central?.type !== Root || !recordsAreIdle(central.props?.filteredParticipants)) {
            api.status = "Unsupported central content: original call retained";
            return shell;
        }
        api.status = "Mock in native callback grid";
        return h(shell.type, {
            ...shell.props,
            children: h(Boundary, null, h(CallGrid, { rootProps: central.props }))
        });
    }
    globalThis[key] = api;
    try {
        document.head.append(style);
        Object.defineProperty(controller, "renderContent", { value: adapted, configurable: true, writable: true });
        observer = new MutationObserver(() => {
            if (!controller._wrapperRef?.current?.isConnected) api.cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        controller.forceUpdate();
    } catch {
        api.cleanup();
        return "Grid test setup failed and was restored.";
    }
    return "Call grid adaptation installed. Check __DASS_CALL_GRID_RESEARCH__.status if no mock appears.";
})();
