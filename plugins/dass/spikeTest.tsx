/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { TextInput, useCallback, useEffect, useRef, useState } from "@webpack/common";

import { createEquibopCapture, type EquibopCaptureBridge } from "./capture";
import { PREPARATION_TIMEOUT_MS, preparationFailureMessage, SpikePeer } from "../../clients/spike/peer";

let stopCurrentTest: (() => void) | undefined;

export function stopSpikeTest() {
    const stop = stopCurrentTest;
    stopCurrentTest = undefined;
    stop?.();
}

export function SpikeTestPanel({ backendUrl, isActive }: { backendUrl: string; isActive(): boolean; }) {
    const [roomId, setRoomId] = useState("");
    const [credential, setCredential] = useState("");
    const [publisherId, setPublisherId] = useState("");
    const [status, setStatus] = useState("Experimental test only. Real Equibop interoperability is unverified.");
    const [endpoints, setEndpoints] = useState<string[]>([]);
    const [sessionId, setSessionId] = useState("");
    const [prepared, setPrepared] = useState(false);
    const [busy, setBusy] = useState(false);
    const [viewerStream, setViewerStream] = useState<MediaStream>();
    const resource = useRef<{ abort: AbortController; peer?: SpikePeer; publisher: boolean; } | undefined>(undefined);
    const mounted = useRef(true);
    const video = useRef<HTMLVideoElement>(null);

    const stopResources = useCallback((clearCredential = true) => {
        const { current } = resource;
        resource.current = undefined;
        current?.abort.abort();
        current?.peer?.close();
        if (mounted.current) {
            setPrepared(false);
            setBusy(false);
            setViewerStream(undefined);
            setEndpoints([]);
            setSessionId("");
            if (clearCredential) setCredential("");
            setStatus("Test stopped. Capture and connection resources were released.");
        }
    }, []);
    const stop = useCallback(() => stopResources(), [stopResources]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (stopCurrentTest === stop) stopCurrentTest = undefined;
            stop();
        };
    }, [stop]);

    useEffect(() => {
        const element = video.current;
        if (!element) return;
        element.srcObject = viewerStream ?? null;
        return () => { element.srcObject = null; };
    }, [viewerStream]);

    async function prepare(publisher: boolean) {
        if (!isActive()) return;
        if (stopCurrentTest !== stop) stopSpikeTest();
        stopResources(false);
        stopCurrentTest = stop;
        const current = { abort: new AbortController(), publisher, peer: undefined as SpikePeer | undefined };
        resource.current = current;
        setBusy(true);
        setStatus(publisher ? "Opening the installed Equibop picker. Capture remains local until activation." : "Gathering viewer candidates. No capture is requested.");
        try {
            const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
            const capture = publisher ? await createEquibopCapture(host.Equibop?.DassCapture)(current.abort.signal) : undefined;
            if (current.abort.signal.aborted) { capture?.release(); return; }
            current.peer = await SpikePeer.prepare({ experimental: true, signal: current.abort.signal, capture });
            if (resource.current !== current) { current.peer.close(); return; }
            current.peer.closed.addEventListener("abort", () => {
                if (resource.current === current) stop();
            }, { once: true });
            setEndpoints(current.peer.candidates.map(candidate => {
                const fields = candidate.split(/\s+/);
                return `${fields[4]}:${fields[5]}`;
            }));
            if (!publisher) setViewerStream(current.peer.receivedStream);
            setPrepared(true);
            setStatus(`Candidates prepared for ${PREPARATION_TIMEOUT_MS / 1000} seconds. Allowlist both clients' endpoints before activation. Your separate DASS credential is kept for preparation; Stop clears it.`);
        } catch (error) {
            if (resource.current === current) {
                stop();
                setStatus(preparationFailureMessage(error));
            }
        } finally {
            if (resource.current === current) setBusy(false);
        }
    }

    async function activate() {
        if (!isActive()) return;
        const { current } = resource;
        if (!current?.peer || current.abort.signal.aborted) return;
        setBusy(true);
        setPrepared(false);
        setStatus("Authenticating and negotiating DASS media. This is not proof of playback.");
        try {
            const id = await current.peer.activate({ backendUrl, credential, roomId,
                publisherId: current.publisher ? undefined : publisherId });
            if (resource.current === current) {
                setSessionId(id);
                setStatus(current.publisher ? "Answer applied. Give this DASS publisher session ID to the viewer. Verify real video/audio reception separately." : "Answer applied. Use the player's Play control if autoplay is blocked; verify video and selected audio.");
            }
        } catch {
            if (resource.current === current) { stop(); setStatus("DASS activation failed or was cancelled. Verify TLS, Origin/CSP, credentials and candidate allowlisting. No Discord fallback."); }
        } finally {
            if (resource.current === current) {
                setCredential("");
                setBusy(false);
            }
        }
    }

    const activationBlockers = [
        busy && "wait for setup to finish",
        !prepared && "prepare a connection",
        !roomId && "enter the DASS room ID (lan_test for this test)",
        !credential && "enter your DASS credential",
        resource.current?.publisher === false && !publisherId && "enter the publisher session ID"
    ].filter(Boolean);

    return <div>
        <Paragraph>Manual DASS interoperability test. No E2EE, directory or Discord fallback. Publisher capture uses the installed host picker; audio must be explicitly selected there.</Paragraph>
        <TextInput placeholder="DASS room ID" value={roomId} onChange={setRoomId} disabled={busy} />
        <Button disabled={busy || prepared} onClick={() => void prepare(true)}>Prepare publisher capture</Button>
        <Button disabled={busy || prepared} onClick={() => void prepare(false)}>Prepare viewer</Button>
        <Paragraph>{endpoints.length ? `Allowlist these client UDP endpoints: ${endpoints.join(", ")}` : "No candidates prepared."}</Paragraph>
        <TextInput type="password" placeholder="Separate DASS credential, kept only in memory" value={credential} onChange={setCredential} disabled={busy} />
        <TextInput placeholder="Publisher session ID for viewer" value={publisherId} onChange={setPublisherId} disabled={busy} />
        <Button disabled={activationBlockers.length > 0} onClick={() => void activate()}>Activate prepared connection</Button>
        {activationBlockers.length > 0 && <Paragraph>To activate: {activationBlockers.join("; ")}.</Paragraph>}
        <Button onClick={() => { stopSpikeTest(); stop(); }}>Stop test</Button>
        <Paragraph role="status" aria-live="polite">{status}</Paragraph>
        {sessionId && <Paragraph>DASS session ID: {sessionId}</Paragraph>}
        {viewerStream && <video ref={video} controls autoPlay playsInline aria-label="DASS experimental viewer" />}
    </div>;
}
