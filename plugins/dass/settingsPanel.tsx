/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { TextInput, useEffect, useRef, useState } from "@webpack/common";

import { readRememberedAccount } from "./accountStorage";
import { type EquibopCaptureBridge, type LocalCaptureCheck } from "./capture";
import { type DiscoveryController } from "./controller";
import { type PublishController } from "./publishing";
import { type DassSession } from "./session";
import { type WatchController } from "./watching";
import { WatchPanel } from "./watchPanel";

interface SettingsPanelProps {
    session: DassSession;
    publisher: PublishController;
    watching: WatchController;
    discovery: DiscoveryController;
    localCapture: LocalCaptureCheck;
    backendUrl: string;
    allowInsecureLocalDevelopment: boolean;
    beforeAction(): void;
}

export function SettingsPanel({ session, publisher, watching, discovery, localCapture, backendUrl, allowInsecureLocalDevelopment, beforeAction }: SettingsPanelProps) {
    const [account, setAccount] = useState(session.getSnapshot());
    const [username, setUsername] = useState(account.username);
    const [password, setPassword] = useState("");
    const [savedUsername, setSavedUsername] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [message, setMessage] = useState("");
    const [publishStatus, setPublishStatus] = useState(publisher.getSnapshot());
    const [discoveryStatus, setDiscoveryStatus] = useState(discovery.getSnapshot());
    const generation = useRef(0);
    const edited = useRef(false);
    useEffect(() => session.subscribe(() => setAccount(session.getSnapshot())), [session]);
    useEffect(() => publisher.subscribe(() => setPublishStatus(publisher.getSnapshot())), [publisher]);
    useEffect(() => discovery.subscribe(() => setDiscoveryStatus(discovery.getSnapshot())), [discovery]);
    useEffect(() => {
        const epoch = ++generation.current;
        edited.current = false;
        setPassword("");
        setSavedUsername("");
        void readRememberedAccount().then(saved => {
            if (generation.current !== epoch || !saved || saved.backendUrl !== new URL(backendUrl).origin) return;
            setSavedUsername(saved.username);
            if (!edited.current) setUsername(saved.username);
        }).catch(() => {
            if (generation.current === epoch) setMessage("Saved account could not be unlocked. Check your OS keyring or enter a new password.");
        });
        return () => { ++generation.current; };
    }, [backendUrl]);

    async function saveConfiguration() {
        const epoch = generation.current;
        beforeAction();
        setMessage("");
        let submitted = password;
        try {
            if (!submitted) {
                const saved = await readRememberedAccount();
                if (saved?.backendUrl === new URL(backendUrl).origin && saved.username === username) submitted = saved.password;
            }
            if (generation.current !== epoch) return;
            if (!submitted) { setMessage("Enter a password to save this account configuration."); return; }
            await session.login({ backendUrl, username, password: submitted }, true);
            if (generation.current === epoch && (session.getSnapshot().phase === "ready" || !session.getSnapshot().configured)) setPassword("");
            if (generation.current === epoch && session.getSnapshot().phase === "ready") {
                const saved = await readRememberedAccount();
                if (generation.current === epoch) setSavedUsername(saved?.backendUrl === new URL(backendUrl).origin ? saved.username : "");
            }
        } catch {
            if (generation.current === epoch) setMessage("Account configuration could not be saved securely. No plaintext password fallback.");
        }
    }

    return <div className="vc-dass-settings">
        <label className="vc-dass-field">
            <span>Username</span>
            <TextInput value={username} onChange={value => { edited.current = true; setUsername(value); }} placeholder="DASS username" disabled={account.phase === "loading"} />
        </label>
        <label className="vc-dass-field">
            <span>Password</span>
            <TextInput type="password" value={password} onChange={setPassword} placeholder={savedUsername === username && savedUsername ? "Saved securely; leave blank to keep" : "DASS password, not Discord"} disabled={account.phase === "loading"} />
        </label>
        <Paragraph>Save once to connect automatically. Passwords are encrypted with your OS keyring; there is no plaintext fallback. The current Discord call determines stream context.</Paragraph>
        <div className="vc-dass-actions">
            <Button disabled={!username || (!password && savedUsername !== username) || account.phase === "loading"} onClick={() => void saveConfiguration()}>Save account configuration</Button>
            <Button variant="secondary" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide advanced options" : "Show advanced options"}</Button>
        </div>
        <Paragraph role="status" aria-live="polite">{message || account.message}</Paragraph>
        {advanced && <div className="vc-dass-advanced">
            <Paragraph>Advanced diagnostics only. The native watch tile/player hook is not implemented; this temporary test player is not the replacement UI.</Paragraph>
            <Paragraph role="status">{publishStatus.message}</Paragraph>
            <div className="vc-dass-actions">
                <Button disabled={["idle", "failed"].includes(publishStatus.phase)} onClick={() => publisher.reset()}>Stop capture</Button>
                <Button onClick={() => { beforeAction(); session.clear(); void session.start(backendUrl); }}>Reconnect saved account</Button>
                <Button variant="dangerPrimary" onClick={() => {
                    beforeAction();
                    void session.forget().then(() => { setSavedUsername(""); setPassword(""); }).catch(() => setMessage("Saved login could not be removed."));
                }}>Forget saved account</Button>
            </div>
            <Paragraph role="status">{discoveryStatus.message}</Paragraph>
            <Button onClick={() => void discovery.check({ backendUrl, allowInsecureLocalDevelopment })}>Check backend capabilities</Button>
            <div className="vc-dass-actions">
                <Button onClick={() => {
                    beforeAction();
                    const host = globalThis as typeof globalThis & { Equibop?: { DassCapture?: EquibopCaptureBridge; }; };
                    void localCapture.capture(host.Equibop?.DassCapture).then(setMessage);
                }}>Test local capture</Button>
                <Button onClick={() => { localCapture.stop(); setMessage("Local capture stopped."); }}>Stop local capture</Button>
            </div>
            <WatchPanel controller={watching} backendUrl={backendUrl} beforePrepare={beforeAction} session={session} />
        </div>}
    </div>;
}
