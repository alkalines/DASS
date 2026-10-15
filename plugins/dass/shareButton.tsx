/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Menu, useEffect, useState } from "@webpack/common";
import type { ComponentType } from "react";

import { hasAcceptedPublishCapture, type PublishController } from "./publishing";
import { StreamIcon } from "./streamUi";

interface NativeShareProps {
    streamActive: boolean;
    onClick(): void;
    [key: string]: unknown;
}

export interface ShareButtonProps extends NativeShareProps {
    dassNativeComponent: ComponentType<NativeShareProps>;
    dassPopoutClick?: (event: unknown) => void;
}

export function usePublisherStatus(controller: PublishController) {
    const [status, setStatus] = useState(controller.getSnapshot());
    useEffect(() => controller.subscribe(() => setStatus(controller.getSnapshot())), [controller]);
    return status;
}

export function usePublishingState(controller: PublishController) {
    return hasAcceptedPublishCapture(usePublisherStatus(controller).phase);
}

function ShareButton({ controller, dassNativeComponent: NativeButton, dassPopoutClick, ...props }: ShareButtonProps & { controller: PublishController; }) {
    const captureActive = usePublishingState(controller);
    return <NativeButton {...props} streamActive={captureActive || props.streamActive}
        onPopoutClick={captureActive ? dassPopoutClick : props.onPopoutClick} />;
}

export const NativeShareButton = ErrorBoundary.wrap(ShareButton, { noop: true });

export interface StreamMenuProps {
    channel: { id: string; };
    hideSelfOptions?: boolean;
    onClose(): void;
    onSelect?: () => void;
    dassNativeComponent: ComponentType<Omit<StreamMenuProps, "dassNativeComponent">>;
}

function StreamMenu({ controller, currentChannelId, changeSource, dassNativeComponent: NativeMenu, ...props }: StreamMenuProps & {
    controller: PublishController; currentChannelId?: string; changeSource(): void;
}) {
    const active = usePublishingState(controller);
    if (!active || props.channel.id !== currentChannelId || props.hideSelfOptions) return <NativeMenu {...props} />;
    return <Menu.Menu navId="dass-manage-stream" aria-label="Manage Stream" onClose={props.onClose} onSelect={props.onSelect}>
        <Menu.MenuGroup>
            <Menu.MenuItem id="dass-stop-stream" label="Stop Streaming" color="danger"
                leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="stop" /> }}
                action={() => { props.onClose(); controller.reset(); }} />
            <Menu.MenuItem id="dass-change-stream" label="Change Stream"
                leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="change" /> }}
                action={() => { props.onClose(); changeSource(); }} />
        </Menu.MenuGroup>
    </Menu.Menu>;
}

export const NativeStreamMenu = ErrorBoundary.wrap(StreamMenu, { noop: true });
