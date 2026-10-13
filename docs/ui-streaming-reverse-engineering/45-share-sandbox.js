/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_UI_RESEARCH_SANDBOX__";
    const previous = globalThis[key];
    if (previous && previous.marker !== "dass-share-preview-v1") {
        return "Sandbox name is already in use. Nothing changed.";
    }
    const webpack = globalThis.Vencord?.Webpack;
    const cache = webpack?.cache || webpack?.wreq?.c;
    const React = webpack?.Common?.React;
    const createRoot = webpack?.Common?.createRoot;
    const Share = cache?.["958449"]?.exports?.h;
    const Frame = cache?.["272812"]?.exports?.A;
    const Live = cache?.["402216"]?.exports?.Ay;
    const Button = cache?.["821609"]?.exports?.$;
    const Idle = cache?.["461782"]?.exports?.k3;
    if (!React || typeof createRoot !== "function" || !Idle ||
        [Share, Frame, Live, Button].some(value => typeof value !== "function")) {
        return "Required native exports are missing. Nothing mounted.";
    }
    previous?.cleanup();
    const h = React.createElement;
    const container = document.createElement("div");
    container.id = "dass-ui-research-preview";
    const style = document.createElement("style");
    style.textContent = `
        #dass-ui-research-preview { position:fixed; right:20px; bottom:20px;
          width:min(520px,calc(100vw - 40px)); max-height:75vh; overflow:auto;
          z-index:2147483647; background:var(--background-primary,#242429);
          color:var(--text-normal,#eee); border:1px solid var(--background-modifier-accent,#777);
          border-radius:12px; padding:16px; box-shadow:0 8px 32px #0008;
          font:14px/1.4 sans-serif; }
        #dass-ui-research-preview .research-row { display:flex; flex-wrap:wrap;
          align-items:center; gap:12px; margin:12px 0; }
        #dass-ui-research-preview .research-tile { height:140px; padding:16px; }
        #dass-ui-research-preview p { margin:8px 0; }
    `;
    const mount = document.createElement("div");
    container.append(style, mount);
    document.body.append(container);
    let root;
    const api = {
        marker: "dass-share-preview-v1",
        cleanup() {
            try { root?.unmount(); }
            finally {
                container.remove();
                if (globalThis[key] === api) delete globalThis[key];
            }
        }
    };
    const idle = {
        onPreventIdle() {}, onAllowIdle() {}, onForceIdle() {}, onActive() {}
    };
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        render() {
            return this.state.failed
                ? h("p", null, "Native preview failed. Use the cleanup command to remove it.")
                : this.props.children;
        }
    }
    function Preview() {
        const [active, setActive] = React.useState(false);
        const [pending, setPending] = React.useState(null);
        const [menu, setMenu] = React.useState(false);
        const [source, setSource] = React.useState("Display");
        const [last, setLast] = React.useState("Idle");
        const button = (text, onClick) => h(Button, { text, onClick, variant: "secondary", size: "sm" });
        function stop() {
            setActive(false); setPending(null); setMenu(false); setLast("Mock stopped");
        }
        function start() { setPending("start"); setMenu(false); setLast("Mock consent open"); }
        function change() { setPending("change"); setMenu(false); setLast("Mock source change open"); }
        function cancel() { setPending(null); setLast("Mock consent canceled"); }
        function accept() {
            if (pending === "change") setSource(value => value === "Display" ? "Window" : "Display");
            setActive(true); setPending(null); setLast("Mock accepted");
        }
        const shareProps = {
            hasPermission: true, streamActive: active, isSelfStream: true,
            disabled: pending !== null, videoBlocked: false,
            popoutOpen: menu, popoutDisabled: !active || pending !== null,
            tooltipShouldShow: !menu,
            onPopoutClick: active ? () => setMenu(value => !value) : undefined
        };
        return h(Idle.Provider, { value: idle }, h("div", null,
            h("strong", null, "Native component preview · simulation only"),
            h("p", null, "No capture, sharing, watching or sound. The real call is unchanged."),
            h("p", null, last),
            h("div", { className: "research-row" },
                h("span", null, "Base Share:"),
                h(Share, { ...shareProps, onClick: active ? () => setMenu(value => !value) : start }),
                h("span", null, "Split Share:"),
                h(Share, { ...shareProps, centerButton: true, onClick: active ? stop : start })),
            menu ? h("div", null,
                h("p", null, "Mock action list (not the native stream menu):"),
                h("div", { className: "research-row" }, button("Change source", change), button("Stop", stop))) : null,
            pending ? h("div", null,
                h("p", null, "Mock consent controls (not an OS or Equibop picker):"),
                h("div", { className: "research-row" }, button("Accept", accept), button("Cancel", cancel))) : null,
            active ? h(Frame, { className: "research-tile" },
                h(Live), h("p", null, "Mock publication: " + source),
                h("p", null, "Native frame and badge; no video or connected Go Live card.")) : null,
            h("div", { className: "research-row" }, button("Remove preview", api.cleanup))
        ));
    }
    globalThis[key] = api;
    try {
        root = createRoot(mount);
        root.render(h(Boundary, null, h(Preview)));
    } catch {
        api.cleanup();
        return "Preview setup failed and was removed.";
    }
    return "Preview mounted. Remove with __DASS_UI_RESEARCH_SANDBOX__.cleanup()";
})();
