/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
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
})();
