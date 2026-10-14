/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const key = "__DASS_VIDEO_WRAPPER_TEST__";
    const test = globalThis[key];
    if (test?.marker !== "dass-video-wrapper-test-v1") return "Run preparation 65 first.";
    if (test.mounted) return "Already mounted. Remove this test before repeating preparation.";
    const { React, createRoot, Video } = test;
    const h = React.createElement;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") return "Synthetic video unavailable.";
    let stream;
    try { stream = canvas.captureStream(15); }
    catch { return "Synthetic video creation failed. Nothing mounted."; }
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;right:20px;bottom:20px;width:min(640px,90vw);z-index:2147483647;background:var(--background-primary);color:var(--text-normal);padding:12px;border:1px solid var(--background-modifier-accent)";
    const status = document.createElement("p");
    status.textContent = "Actual Discord video wrapper • generated video • no capture or sharing";
    const mount = document.createElement("div");
    mount.style.cssText = "position:relative;height:360px;max-height:55vh;overflow:hidden";
    const pauseButton = document.createElement("button");
    pauseButton.textContent = "Pause";
    const closeButton = document.createElement("button");
    closeButton.textContent = "Remove test";
    container.append(status, pauseButton, closeButton, mount);
    let root, frame, removed = false;
    const cleanup = () => {
        if (removed) return;
        removed = true;
        try { root?.unmount(); }
        finally {
            cancelAnimationFrame(frame);
            stream.getTracks().forEach(track => track.stop());
            pauseButton.removeEventListener("click", togglePause);
            closeButton.removeEventListener("click", cleanup);
            container.remove();
            if (globalThis[key] === test) delete globalThis[key];
        }
    };
    const draw = () => {
        if (removed) return;
        const hue = (performance.now() / 40) % 360;
        context.fillStyle = `hsl(${hue}, 65%, 35%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.font = "28px sans-serif";
        context.fillText("Local generated video", 32, 140);
        context.fillText((performance.now() / 1000).toFixed(1) + " seconds", 32, 190);
        frame = requestAnimationFrame(draw);
    };
    class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { status.textContent = "Wrapper failed. Remove test; no native sharing started."; }
        render() { return this.state.failed ? null : this.props.children; }
    }
    function MediaLeaf({ className, onReady, onResize, paused }) {
        const ref = React.useRef(null);
        const ready = React.useRef(onReady);
        const resize = React.useRef(onResize);
        ready.current = onReady;
        resize.current = onResize;
        React.useEffect(() => {
            const video = ref.current;
            if (!video) return;
            let disposed = false;
            const loaded = () => {
                if (disposed) return;
                resize.current?.({ width: video.videoWidth, height: video.videoHeight });
                ready.current?.();
                status.textContent = "Native wrapper ready • synthetic video playing • no transport";
            };
            video.addEventListener("loadeddata", loaded);
            const timer = setTimeout(() => { if (!disposed) video.srcObject = stream; }, 1800);
            return () => {
                disposed = true;
                clearTimeout(timer);
                video.removeEventListener("loadeddata", loaded);
                video.pause();
                video.srcObject = null;
            };
        }, []);
        React.useEffect(() => {
            const video = ref.current;
            if (!video) return;
            if (paused) video.pause();
            else void video.play().catch(() => {
                status.textContent = "Playback blocked. Click Pause, then Resume. No transport started.";
            });
        }, [paused]);
        return h("video", { ref, className, muted: true, playsInline: true, autoPlay: !paused });
    }
    let paused = false;
    const render = () => root.render(h(Boundary, null, h(Video, {
        streamId: "dass-research:generated-local-video", videoComponent: MediaLeaf,
        fit: "contain", paused, videoSpinnerContext: "dass-research",
        userId: null, streamKey: null
    })));
    function togglePause() {
        paused = !paused;
        pauseButton.textContent = paused ? "Resume" : "Pause";
        render();
    }
    test.cleanup = cleanup;
    test.mounted = true;
    pauseButton.addEventListener("click", togglePause);
    closeButton.addEventListener("click", cleanup);
    try {
        document.body.append(container);
        root = createRoot(mount);
        draw();
        render();
    } catch {
        cleanup();
        return "Mount failed and owned resources were removed.";
    }
    return "Native wrapper mounted. Expect spinner, generated video, Pause/Resume; Remove test cleans up.";
})();
