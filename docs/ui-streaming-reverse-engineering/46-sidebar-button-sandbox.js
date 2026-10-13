/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_SIDEBAR_RESEARCH__";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-sidebar-preview-v1") return "Preview name is already in use.";
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const createRoot = webpack?.Common?.createRoot;
    const Button = cache?.["862482"]?.exports?.$n;
    const Tooltip = cache?.["866665"]?.exports?.m;
    const useShareIcon = cache?.["416696"]?.exports?.c;
    const Secondary = cache?.["821609"]?.exports?.$;
    const css = cache?.["187529"]?.exports;
    if (!React || typeof createRoot !== "function" ||
        [Button, Tooltip, useShareIcon, Secondary].some(value => typeof value !== "function") ||
        ["x6", "Sq", "rK", "bk", "iA", "ij"].some(name => typeof css?.[name] !== "string")) {
        return "Sidebar primitives or native styles are missing. Nothing mounted.";
    }
    previous?.cleanup();
    const h = React.createElement;
    const container = document.createElement("div");
    container.id = "dass-sidebar-research-preview";
    const style = document.createElement("style");
    style.textContent = `
        #dass-sidebar-research-preview { position:fixed; left:20px; top:60px;
          z-index:2147483647; width:300px; padding:16px; border-radius:12px;
          background:var(--background-primary,#242429); color:var(--text-normal,#eee);
          box-shadow:0 8px 32px #0008; font:14px/1.4 sans-serif; }
        #dass-sidebar-research-preview .research-controls { display:flex;
          gap:12px; align-items:center; margin:12px 0; }
    `;
    const mount = document.createElement("div");
    container.append(style, mount);
    document.body.append(container);
    let root;
    const api = {
        marker: "dass-sidebar-preview-v1",
        cleanup() {
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
            return this.state.failed ? h("p", null, "Preview failed. Run the cleanup command.") : this.props.children;
        }
    }
    function Preview() {
        const [active, setActive] = React.useState(false);
        const [menu, setMenu] = React.useState(false);
        const { Component: Icon, events, play } = useShareIcon(active ? "disable" : "enable");
        React.useEffect(() => () => play(), [play, active]);
        const label = active ? "Stop Streaming" : "Share Your Screen";
        return h("div", null,
            h("strong", null, "Sidebar primitive · simulation only"),
            h("p", null, "Native button, animated icon and selected classes. No capture or sound."),
            h("div", { className: "research-controls" },
                h(Tooltip, { text: label }, h(Button, {
                    "data-migration-pending": true,
                    size: Button.Sizes.MEDIUM,
                    "aria-label": label, "aria-pressed": active,
                    className: [css.x6, css.Sq, active ? css.rK : null].filter(Boolean).join(" "),
                    innerClassName: css.bk, wrapperClassName: css.x6,
                    onMouseEnter: events.onMouseEnter,
                    onMouseLeave: events.onMouseLeave,
                    onClick: () => active ? setMenu(value => !value) : setActive(true)
                }, h(Icon, {
                    size: "md", color: "currentColor",
                    className: [css.iA, css.ij].join(" ")
                }))),
                h("span", null, active ? "Mock active" : "Mock idle")),
            menu ? h("div", { className: "research-controls" },
                h(Secondary, {
                    text: "Mock stop", variant: "secondary", size: "sm",
                    onClick: () => { setActive(false); setMenu(false); }
                }),
                h(Secondary, {
                    text: "Close action list", variant: "secondary", size: "sm",
                    onClick: () => setMenu(false)
                })) : null,
            h(Secondary, { text: "Remove preview", variant: "secondary", size: "sm", onClick: api.cleanup })
        );
    }
    globalThis[key] = api;
    try {
        root = createRoot(mount);
        root.render(h(Boundary, null, h(Preview)));
    } catch {
        api.cleanup();
        return "Sidebar preview setup failed and was removed.";
    }
    return "Sidebar preview mounted. Click its icon to test native active styling.";
})();
