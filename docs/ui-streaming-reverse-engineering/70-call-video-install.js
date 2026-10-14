/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
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
})();
