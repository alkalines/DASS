/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import type { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal } from "@webpack/common";

import { createShareSelection } from "./discordAdapter";

interface TransportChooserProps extends RenderModalProps {
    preferDass: boolean;
    choose(transport: "discord" | "dass" | "cancel"): void;
}

function TransportChooser({ preferDass, choose, ...modalProps }: TransportChooserProps) {
    return <Modal {...modalProps} size="sm" title="Share your screen" subtitle="Choose Discord or DASS. Cancelling starts neither."
        actions={[
            { text: "Cancel", variant: "secondary", onClick: () => choose("cancel") },
            { text: "Discord", variant: preferDass ? "secondary" : "primary", onClick: () => choose("discord") },
            { text: "DASS", variant: preferDass ? "primary" : "secondary", onClick: () => choose("dass") }
        ]}>
        <Paragraph>DASS uses your separate DASS account and backend. Viewers need DASS-compatible clients. No automatic Discord fallback.</Paragraph>
    </Modal>;
}

const SafeTransportChooser = ErrorBoundary.wrap(TransportChooser, { message: "DASS transport chooser failed. No sharing was started." });

interface PendingShareChoice {
    abort: AbortController;
    modalKey?: string;
}

let pendingChoice: PendingShareChoice | undefined;

export function cancelShareTransportChooser() {
    const pending = pendingChoice;
    pendingChoice = undefined;
    pending?.abort.abort();
    if (pending?.modalKey) closeModal(pending.modalKey);
}

export function showShareTransportChooser(preferDass: boolean, isContextCurrent: () => boolean, nativeStart: () => void, dassStart: () => void) {
    cancelShareTransportChooser();
    const pending: PendingShareChoice = { abort: new AbortController() };
    pendingChoice = pending;
    const select = createShareSelection(pending.abort.signal, isContextCurrent, nativeStart, dassStart);
    const dismiss = () => {
        pending.abort.abort();
        if (pendingChoice === pending) pendingChoice = undefined;
        if (pending.modalKey) closeModal(pending.modalKey);
    };
    pending.modalKey = openModal(props => <SafeTransportChooser {...props} onClose={dismiss} preferDass={preferDass} choose={transport => {
        if (pendingChoice !== pending) return;
        pendingChoice = undefined;
        try {
            select(transport);
        } finally {
            dismiss();
        }
    }} />, { onCloseRequest: dismiss, onCloseCallback: () => {
        pending.abort.abort();
        if (pendingChoice === pending) pendingChoice = undefined;
    } });
}
