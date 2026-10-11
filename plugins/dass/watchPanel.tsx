/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { TextInput, useEffect, useRef, useState } from "@webpack/common";

import { type WatchController } from "./watching";

export function WatchPanel({ controller, backendUrl, beforePrepare }: { controller: WatchController; backendUrl: string; beforePrepare(): void; }) {
    const [status, setStatus] = useState(controller.getSnapshot());
    const [roomId, setRoomId] = useState("");
    const [credential, setCredential] = useState("");
    const [audioMessage, setAudioMessage] = useState("");
    const video = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const unsubscribe = controller.subscribeStatus(() => {
            const snapshot = controller.getSnapshot();
            setStatus(snapshot);
            if (["unauthorized", "failed", "disconnected"].includes(snapshot.phase)) setCredential("");
        });
        return () => { unsubscribe(); controller.reset(); };
    }, [controller]);
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        element.muted = true;
        element.srcObject = status.stream ?? null;
        setAudioMessage("");
        if (status.stream) void element.play().catch(() => setAudioMessage("Playback was blocked. Use the player's Play control."));
        return () => { element.pause(); element.muted = true; element.srcObject = null; };
    }, [status.stream]);
    const loading = status.phase === "loading";
    return <div>
        <Paragraph>DASS directory and viewer (experimental). Select a voice context, prepare a viewer, then bind an independently authorized DASS room. Native Discord watching remains separate.</Paragraph>
        <Button disabled={loading || status.candidates.length > 0} onClick={() => { beforePrepare(); void controller.prepareViewer(); }}>Prepare DASS viewer</Button>
        {status.candidates.length > 0 && <Paragraph>Allowlist viewer UDP endpoints: {status.candidates.join(", ")}</Paragraph>}
        <TextInput placeholder="Authorized DASS room ID (not a Discord channel ID)" value={roomId} onChange={setRoomId} disabled={loading} />
        <TextInput type="password" placeholder="Separate DASS credential (memory only)" value={credential} onChange={setCredential} disabled={loading} />
        <Button disabled={loading || !credential || !roomId || !!status.stream} onClick={() => {
            const submitted = credential;
            setCredential("");
            void controller.bind(backendUrl, roomId, submitted);
        }}>Bind room and discover</Button>
        <Paragraph role="status" aria-live="polite">{status.phase}: {status.message}</Paragraph>
        {status.phase === "ready" && status.shares.length === 0 && <Paragraph>No shares listed. Bind an authorized room and wait for a connected publisher.</Paragraph>}
        {status.shares.map(share => <Button key={share.shareId} disabled={loading || !status.candidates.length || !!status.stream}
            onClick={() => void controller.watch(share)}>Watch DASS share {share.shareId}</Button>)}
        <Button onClick={() => { setCredential(""); controller.reset(); }}>Close DASS viewer and room</Button>
        {status.stream && <div>
            <video ref={video} muted controls playsInline aria-label="DASS-owned viewer" />
            <Button onClick={() => {
                const element = video.current;
                if (!element) return;
                element.muted = false;
                void element.play().then(() => setAudioMessage("Audio enabled by your gesture."), () => {
                    element.muted = true;
                    setAudioMessage("Audio playback was blocked. Try the player's Play control.");
                });
            }}>Enable audio</Button>
            <Paragraph role="status">{audioMessage}</Paragraph>
        </div>}
    </div>;
}
