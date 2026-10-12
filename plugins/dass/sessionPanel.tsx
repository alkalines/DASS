/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { TextInput, useEffect, useState } from "@webpack/common";

import { type EquibopCaptureBridge } from "./capture";
import { type PublishController } from "./publishing";
import { type DassSession } from "./session";
import { type WatchController } from "./watching";
import { WatchPanel } from "./watchPanel";

export function SessionPanel({ session, publisher, watching, backendUrl, beforePublish, beforeWatch, onForget }: {
    session: DassSession; publisher: PublishController; watching: WatchController; backendUrl: string;
    beforePublish(): void; beforeWatch(): void; onForget(): void;
}) {
    const [access, setAccess] = useState(session.getSnapshot());
    const [status, setStatus] = useState(publisher.getSnapshot());
    const [roomId, setRoomId] = useState(access.roomId);
    const [credential, setCredential] = useState("");
    const [username, setUsername] = useState(access.username);
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => session.subscribe(() => {
        const snapshot = session.getSnapshot();
        setAccess(snapshot);
        if (snapshot.configured) setRoomId(snapshot.roomId);
        if (snapshot.username) setUsername(snapshot.username);
        setCredential("");
        setPassword("");
    }), [session]);
    useEffect(() => publisher.subscribe(() => setStatus(publisher.getSnapshot())), [publisher]);
    function publish(prepareOnly = false) {
        beforePublish();
        const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
        void publisher.publish(backendUrl, host.Equibop?.DassCapture, prepareOnly);
    }
    const busy = !["idle", "failed"].includes(status.phase);
    return <div>
        <Paragraph>Use your DASS account, not your Discord password. The backend observes your LAN IP at login and admits only your active stream/viewer UDP endpoints. Remembering login uses OS-backed encryption, never plaintext plugin settings.</Paragraph>
        <Paragraph role="status" aria-live="polite">{access.message}</Paragraph>
        {!access.configured ? <div>
            <TextInput placeholder="Authorized DASS room ID" value={roomId} onChange={setRoomId} disabled={access.phase === "loading"} />
            <TextInput placeholder="DASS username" value={username} onChange={setUsername} disabled={access.phase === "loading"} />
            <TextInput type="password" placeholder="DASS password (not Discord)" value={password} onChange={setPassword} disabled={access.phase === "loading"} />
            <FormSwitch title="Remember login securely" description="Sign in automatically when the plugin loads. Requires a supported OS keyring; no plaintext fallback."
                value={remember} onChange={setRemember} disabled={access.phase === "loading"} />
            <Button disabled={!roomId || !username || !password || access.phase === "loading"} onClick={() => {
                beforePublish();
                publisher.reset();
                const submitted = password;
                setPassword("");
                void session.login({ backendUrl, roomId, username, password: submitted }, remember);
            }}>Sign in to DASS</Button>
            <details><summary>Legacy invite credential</summary>
            <TextInput type="password" placeholder="Your separate DASS credential" value={credential} onChange={setCredential} />
            <Button disabled={!roomId || !credential} onClick={() => {
                try { session.configure(roomId, credential); setCredential(""); setError(""); }
                catch { setError("Enter a valid authorized DASS room and credential."); }
            }}>Use for this session</Button>
            {error && <Paragraph role="status">{error}</Paragraph>}
            </details>
        </div> : <div>
            <Paragraph>Signed in{access.username ? ` as ${access.username}` : " with a legacy invite"} for DASS room {access.roomId}. The backend checks room access for every operation.</Paragraph>
        </div>}
        <Button onClick={onForget}>Sign out and forget saved login</Button>
        <Paragraph role="status" aria-live="polite">{status.message}</Paragraph>
        <Button disabled={!access.configured || busy} onClick={() => publish()}>Start DASS share</Button>
        <Button disabled={!busy} onClick={() => publisher.reset()}>Stop sharing</Button>
        <details>
            <summary>Advanced: exact UDP endpoint allowlist</summary>
            <Paragraph>Use only if the server requires exact client ports. Prepare locally, update/recreate the backend, then activate within 180 seconds. Otherwise Start DASS share is automatic.</Paragraph>
            <Button disabled={!access.configured || busy} onClick={() => publish(true)}>Prepare capture only</Button>
            {status.candidates.length > 0 && <Paragraph>Client UDP endpoints: {status.candidates.join(", ")}</Paragraph>}
            <Button disabled={status.phase !== "prepared"} onClick={() => void publisher.activate(backendUrl)}>Activate prepared share</Button>
        </details>
        <WatchPanel controller={watching} backendUrl={backendUrl} beforePrepare={beforeWatch} session={session} />
    </div>;
}
