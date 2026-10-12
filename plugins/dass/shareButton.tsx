/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useState } from "@webpack/common";
import type { ComponentType } from "react";

import { hasAcceptedPublishCapture, type PublishController } from "./publishing";

interface NativeShareProps {
    streamActive: boolean;
    onClick(): void;
    [key: string]: unknown;
}

export interface ShareButtonProps extends NativeShareProps {
    dassNativeComponent: ComponentType<NativeShareProps>;
}

export function usePublisherStatus(controller: PublishController) {
    const [status, setStatus] = useState(controller.getSnapshot());
    useEffect(() => controller.subscribe(() => setStatus(controller.getSnapshot())), [controller]);
    return status;
}

export function usePublishingState(controller: PublishController) {
    return hasAcceptedPublishCapture(usePublisherStatus(controller).phase);
}

function ShareButton({ controller, dassNativeComponent: NativeButton, ...props }: ShareButtonProps & { controller: PublishController; }) {
    const captureActive = usePublishingState(controller);
    return <NativeButton {...props} streamActive={captureActive || props.streamActive} />;
}

export const NativeShareButton = ErrorBoundary.wrap(ShareButton, { noop: true });
