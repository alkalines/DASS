/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import type { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal, useEffect, useState } from "@webpack/common";

import { trustPrompt } from "../../clients/spike/e2ee";
import type { PublishController } from "./publishing";

interface ApprovalProps extends RenderModalProps {
    publisher: PublishController;
    requestId: string;
}

function ViewerApproval({ publisher, requestId, ...modalProps }: ApprovalProps) {
    const [status, setStatus] = useState(publisher.getSnapshot());
    useEffect(() => publisher.subscribe(() => setStatus(publisher.getSnapshot())), [publisher]);
    const pending = status.pendingViewers.find(viewer => viewer.requestId === requestId);
    if (!pending) return null;
    const changed = pending.trust.kind === "changed";
    return <Modal {...modalProps} size="sm" title={`${pending.displayName} wants to watch your stream`}
        subtitle="Approve within a few seconds; the DASS server cancels unanswered requests."
        actions={[
            { text: "Block", variant: "critical-primary", onClick: () => void publisher.decideView(requestId, "block") },
            { text: "Deny", variant: "secondary", onClick: () => void publisher.decideView(requestId, "deny") },
            changed
                ? { text: "Accept new identity", variant: "critical-primary", onClick: () => void publisher.acceptViewerIdentity(requestId) }
                : { text: "Approve", variant: "primary", onClick: () => void publisher.decideView(requestId, "approve") }
        ]}>
        <Paragraph>{trustPrompt(pending.trust)}</Paragraph>
        {pending.safetyNumber && <Paragraph>Safety number: {pending.safetyNumber}</Paragraph>}
    </Modal>;
}

const SafeViewerApproval = ErrorBoundary.wrap(ViewerApproval, { message: "DASS viewer approval failed. The request stays unapproved." });

/** Opens one prompt per pending view request and closes it once the request is decided or expires. */
export function startViewerApprovalPrompts(publisher: PublishController) {
    const open = new Map<string, string>();
    const sync = () => {
        const pending = publisher.getSnapshot().pendingViewers;
        for (const [requestId, modalKey] of open) {
            if (pending.some(viewer => viewer.requestId === requestId)) continue;
            open.delete(requestId);
            closeModal(modalKey);
        }
        for (const viewer of pending) {
            if (open.has(viewer.requestId) || publisher.willAutoApprove(viewer.trust)) continue;
            const { requestId } = viewer;
            open.set(requestId, openModal(props => <SafeViewerApproval {...props} publisher={publisher} requestId={requestId} />));
        }
    };
    const unsubscribe = publisher.subscribe(sync);
    sync();
    return () => {
        unsubscribe();
        for (const modalKey of open.values()) closeModal(modalKey);
        open.clear();
    };
}
