/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./streamError.css";

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import type { MouseEvent } from "react";

export function StreamErrorScreen({ started, message, onClose, action }: {
    started: boolean;
    message: string;
    onClose(event: MouseEvent<HTMLButtonElement>): void;
    /** A user decision that can resolve this failure, shown outside the collapsed help. */
    action?: { description: string; label: string; onClick(event: MouseEvent<HTMLButtonElement>): void; };
}) {
    return <div className="vc-dass-stream-error" role="group" aria-label="DASS stream error">
        <Heading tag="h2" className="vc-dass-stream-error-heading" aria-live="polite">
            {started ? "Stream disconnected :(" : "Stream failed to start :("}
        </Heading>
        <div className="vc-dass-stream-error-code">Error: DASS {started ? "connection" : "setup"}</div>
        {action && <p className="vc-dass-stream-error-action">{action.description}</p>}
        <details className="vc-dass-stream-error-help" onClick={event => event.stopPropagation()}>
            <summary>Having issues with your stream? <span>Let us try to help.</span></summary>
            <div className="vc-dass-stream-error-details">
                <p>{message}</p>
                <p>Check your DASS login, backend TLS certificate, room access and LAN/UDP connectivity. Close this stream, then try watching again.</p>
                <p>Discord voice is unaffected. No automatic Discord sharing fallback.</p>
            </div>
        </details>
        {action && <Button variant="dangerPrimary" size="medium" className="vc-dass-stream-error-close" onClick={action.onClick}>{action.label}</Button>}
        <Button variant="secondary" size="medium" className="vc-dass-stream-error-close" onClick={onClose}>Close Stream</Button>
    </div>;
}
