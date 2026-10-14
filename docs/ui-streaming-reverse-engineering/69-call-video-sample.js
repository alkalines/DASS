/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    const test = globalThis.__DASS_CALL_VIDEO_TEST__;
    if (test?.marker !== "dass-call-video-test-v1" || !test.Video || test.mounted) return "Prepare the call and wrapper first.";
    const { React, Video, components: { Frame } } = test;
    const cache = Vencord.Webpack.cache || Vencord.Webpack.wreq.c;
    const Button = cache?.["821609"]?.exports?.$;
    if (!Button) return "Diagnostic host button unavailable. Call unchanged.";
    const h = React.createElement;
    function Media({ className, paused, onReady, onResize }) {
        const ref = React.useRef(null);
        React.useEffect(() => {
            const video = ref.current;
            const canvas = document.createElement("canvas");
            canvas.width = 640; canvas.height = 360;
            const context = canvas.getContext("2d");
            if (!context || !canvas.captureStream) throw Error("Generated video unavailable.");
            const stream = canvas.captureStream(15);
            const timer = setInterval(() => {
                context.fillStyle = `hsl(${performance.now() / 40 % 360},65%,35%)`;
                context.fillRect(0, 0, 640, 360);
                context.fillStyle = "white"; context.font = "28px sans-serif";
                context.fillText("Local generated video", 32, 140);
                context.fillText((performance.now() / 1000).toFixed(1) + " seconds", 32, 190);
            }, 100);
            const delay = setTimeout(() => { video.srcObject = stream; }, 1800);
            return () => {
                clearTimeout(delay); clearInterval(timer);
                video.pause(); video.srcObject = null;
                stream.getTracks().forEach(track => track.stop());
            };
        }, []);
        React.useEffect(() => {
            const video = ref.current;
            if (paused) video.pause();
            else if (video.srcObject) void video.play().catch(() => { test.mediaStatus = "Generated playback blocked."; });
        }, [paused]);
        return h("video", {
            ref, className, muted: true, playsInline: true, autoPlay: !paused,
            onLoadedData: event => {
                onResize?.({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
                onReady?.(); test.mediaStatus = "Generated video ready.";
            }
        });
    }
    test.Sample = function Sample({ width }) {
        const [paused, setPaused] = React.useState(false);
        return h(Frame, { className: test.tileClass, style: { width, height: Math.round(width * 9 / 16), position: "relative" } },
            h(Video, { streamId: "dass-research:call-video", videoComponent: Media, fit: "contain", paused,
                userId: null, streamKey: null, videoSpinnerContext: "dass-research" }),
            h("small", { style: { position: "absolute", top: 8, left: 8, color: "white" } }, "DASS media test • no transport"),
            h("div", { style: { position: "absolute", bottom: 8, right: 8 } },
                h(Button, { variant: "secondary", size: "sm", text: paused ? "Resume" : "Pause", onClick: () => setPaused(!paused) }),
                h(Button, { variant: "secondary", size: "sm", text: "Restore call", onClick: () => test.cleanup() })));
    };
    return "Generated media component ready. Nothing mounted or captured.";
})();
