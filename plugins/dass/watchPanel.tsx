/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { TextInput, useEffect, useRef, useState } from "@webpack/common";

import { type DassSession } from "./session";
import { type WatchController } from "./watching";

export function WatchPanel({ controller, backendUrl, beforePrepare, session }: { controller: WatchController; backendUrl: string; beforePrepare(): void; session?: DassSession; }) {
    const [status, setStatus] = useState(controller.getSnapshot());
    const [roomId, setRoomId] = useState("");
    const [credential, setCredential] = useState("");
    const [audioMessage, setAudioMessage] = useState("");
    const video = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const unsubscribe = controller.subscribeStatus(() => {
            const snapshot = controller.getSnapshot();
            setStatus(snapshot);
            if (snapshot.phase === "unauthorized") setCredential("");
            if (snapshot.phase === "unauthorized") session?.clear();
        });
        return () => { unsubscribe(); if (!session) controller.reset(); };
    }, [controller, session]);
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
        <Paragraph>Temporary test viewer for this call. Native Discord watching remains separate until its UI hooks are implemented. Finding streams does not request capture.</Paragraph>
        {session && <Button disabled={loading || !!status.stream || !session.getSnapshot().configured} onClick={() => {
            beforePrepare();
            void (async () => {
                const access = session.getAccess();
                await controller.prepareAndBind(backendUrl, access.roomId, access);
            })().catch(() => { controller.reset(); });
        }}>Find DASS streams</Button>}
        {!session && <details><summary>Advanced: prepare viewer and exact UDP allowlist</summary>
        <Button disabled={loading || status.candidates.length > 0} onClick={() => { beforePrepare(); void controller.prepareViewer(); }}>Prepare DASS viewer</Button>
        {status.candidates.length > 0 && <Paragraph>Allowlist viewer UDP endpoints: {status.candidates.join(", ")}</Paragraph>}
        <div><TextInput placeholder="Authorized DASS room ID" value={roomId} onChange={setRoomId} disabled={loading} />
            <TextInput type="password" placeholder="Separate DASS credential (memory only)" value={credential} onChange={setCredential} disabled={loading} /></div>
        <Button disabled={loading || !credential || !roomId || !!status.stream} onClick={() => {
            const submitted = credential;
            void controller.bind(backendUrl, roomId, submitted);
        }}>Bind room and discover</Button>
        </details>}
        <Paragraph role="status" aria-live="polite">{status.phase}: {status.message}</Paragraph>
        {status.phase === "ready" && status.shares.length === 0 && <Paragraph>No shares listed. Wait for a connected publisher in this authorized call.</Paragraph>}
        {status.shares.map(share => <Button key={share.shareId} disabled={loading || !status.candidates.length || !!status.stream}
            onClick={() => void controller.watch(share)}>Watch {share.displayName ?? "Unnamed DASS publisher"}</Button>)}
        <Button onClick={() => { setCredential(""); controller.reset(); }}>Close test viewer</Button>
        {status.stream && <div>
            <Paragraph>Sharing: {status.watchingShare?.displayName ?? "Unnamed DASS publisher"}</Paragraph>
            <video ref={video} muted controls playsInline aria-label={`DASS stream from ${status.watchingShare?.displayName ?? "unnamed publisher"}`} />
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
