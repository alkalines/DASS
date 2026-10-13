/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_CALL_TILE_RESEARCH__";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-call-tile-v1") return "Preview name is already in use.";
    const selected = typeof $0 === "undefined" ? null : $0;
    const host = selected?.parentElement;
    if (!host?.isConnected || host.ownerDocument !== document ||
        host === document.body || host === document.documentElement)
        return "Keep the same call-area element selected. Nothing mounted.";
    const geometry = host.getBoundingClientRect();
    if (getComputedStyle(host).position === "static" || geometry.width < 360 || geometry.height < 180)
        return "Selected parent is not a suitable positioned call strip. Nothing mounted.";
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const createRoot = webpack?.Common?.createRoot;
    const Frame = cache?.["272812"]?.exports?.A;
    const Live = cache?.["402216"]?.exports?.Ay;
    const Button = cache?.["821609"]?.exports?.$;
    if (!React || typeof createRoot !== "function" ||
        [Frame, Live, Button].some(value => typeof value !== "function"))
        return "Native presentation exports are missing. Nothing mounted.";
    previous?.cleanup();
    const h = React.createElement;
    const container = document.createElement("div");
    container.id = "dass-call-tile-research";
    const style = document.createElement("style");
    style.textContent = `
        #dass-call-tile-research { position:absolute; inset:0; z-index:20; pointer-events:none; }
        #dass-call-tile-research .mock-panel { position:absolute; top:8px; right:8px;
          width:min(340px,calc(100% - 16px)); height:calc(100% - 16px);
          pointer-events:auto; display:flex; flex-direction:column; gap:6px;
          color:var(--text-normal,#eee); font:12px/1.3 sans-serif; }
        #dass-call-tile-research .mock-panel.expanded { width:calc(100% - 16px); }
        #dass-call-tile-research .mock-frame { flex:1; min-height:0; display:flex;
          flex-direction:column; padding:12px; box-sizing:border-box;
          background:var(--background-secondary,#202025); overflow:hidden; }
        #dass-call-tile-research .mock-heading, #dass-call-tile-research .mock-controls {
          display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        #dass-call-tile-research .mock-pattern { flex:1; min-height:20px; margin:8px 0;
          display:grid; place-items:center; text-align:center;
          background:repeating-linear-gradient(135deg,#41495d 0 12px,#303745 12px 24px); }
        #dass-call-tile-research .mock-controls { background:var(--background-primary,#242429);
          padding:4px; border-radius:6px; }
    `;
    const mount = document.createElement("div");
    mount.style.display = "contents";
    container.append(style, mount);
    host.append(container);
    let root, observer;
    const api = {
        marker: "dass-call-tile-v1",
        cleanup() {
            observer?.disconnect();
            try { root?.unmount(); }
            finally {
                container.remove();
                if (globalThis[key] === api) delete globalThis[key];
            }
        }
    };
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        render() {
            return this.state.failed
                ? h("div", { className: "mock-panel" }, h("p", null, "Preview failed. Run the cleanup command."))
                : this.props.children;
        }
    }
    function Preview() {
        const [expanded, setExpanded] = React.useState(false);
        const [ended, setEnded] = React.useState(false);
        const [source, setSource] = React.useState("Display");
        const button = (text, onClick) => h(Button, { text, onClick, variant: "secondary", size: "sm" });
        return h("section", {
            className: "mock-panel" + (expanded ? " expanded" : ""),
            "aria-label": "Mock stream tile, no media"
        },
            h(Frame, { className: "mock-frame" },
                h("div", { className: "mock-heading" }, ended ? null : h(Live),
                    h("strong", null, "MOCK STREAM · no media")),
                h("div", { className: "mock-pattern" }, ended
                    ? "Mock ended state (not the native ended component)"
                    : "Generated test pattern · " + source),
                h("span", null, expanded ? "Local wide view, not native selection" : "Local tile preview")),
            h("div", { className: "mock-controls" },
                button(expanded ? "Collapse" : "Expand", () => setExpanded(value => !value)),
                button(ended ? "Mock return" : "Mock end", () => setEnded(value => !value)),
                ended ? null : button("Change source", () => setSource(value => value === "Display" ? "Window" : "Display")),
                button("Remove", api.cleanup))
        );
    }
    globalThis[key] = api;
    try {
        root = createRoot(mount);
        root.render(h(Boundary, null, h(Preview)));
        observer = new MutationObserver(() => {
            if (!host.isConnected || !container.isConnected) api.cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    } catch {
        api.cleanup();
        return "In-call preview setup failed and was removed.";
    }
    return "Mock tile placed inside the selected call strip. No native participant or media created.";
})();
