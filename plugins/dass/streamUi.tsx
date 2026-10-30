/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./streamUi.css";

import { Button } from "@components/Button";
import { getIntlMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import { ContextMenuApi, Menu, React, Tooltip, useState } from "@webpack/common";
import type { ReactNode } from "react";

export interface StreamActions {
    local: boolean;
    stop?(): void;
    changeSource?(): void;
    previewOptions?: {
        showPreview: boolean;
        pauseWhenUnfocused: boolean;
        setShowPreview(value: boolean): void;
        setPauseWhenUnfocused(value: boolean): void;
    };
}

export interface StreamQuality {
    resolution: string;
    framesPerSecond: number;
    premium?: boolean;
}

type StreamIconName = "stop" | "change" | "camera" | "nitro";

export function StreamIcon({ name, premiumGradient }: { name: StreamIconName; premiumGradient?: boolean; }) {
    const gradientId = React.useId();
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {premiumGradient ? <defs><linearGradient id={gradientId}>
            <stop stopColor="var(--premium-tier-2-purple-for-gradients, #8849c6)" />
            <stop offset="0.502368" stopColor="var(--premium-tier-2-purple-for-gradients-2, #bc49c1)" />
            <stop offset="1" stopColor="var(--premium-tier-2-pink-for-gradients, #b84c8d)" />
        </linearGradient></defs> : null}
        {name === "camera" ? <path fill="currentColor" d="M4 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-2.12a1 1 0 0 0 .55.9l3 1.5a1 1 0 0 0 1.45-.9V7.62a1 1 0 0 0-1.45-.9l-3 1.5a1 1 0 0 0-.55.9V7a3 3 0 0 0-3-3H4Z" />
            : name === "nitro" ? <path fill={premiumGradient ? `url(#${gradientId})` : "currentColor"} d="M16.23 12c0 1.29-.95 2.25-2.22 2.25A2.18 2.18 0 0 1 11.8 12c0-1.29.95-2.25 2.22-2.25 1.27 0 2.22.96 2.22 2.25ZM23 12c0 5.01-4 9-8.99 9a8.93 8.93 0 0 1-8.75-6.9H3.34l-.9-4.2H5.3c.26-.96.68-1.89 1.21-2.7H1.89L1 3h12.74C19.13 3 23 6.99 23 12Zm-4.26 0c0-2.67-2.1-4.8-4.73-4.8A4.74 4.74 0 0 0 9.28 12c0 2.67 2.1 4.8 4.73 4.8a4.74 4.74 0 0 0 4.73-4.8Z" />
                : <g fill="currentColor">
                        <path fillRule="evenodd" d={name === "stop"
                            ? "M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm6.3.3a1 1 0 0 1 1.4 0L12 7.58l2.3-2.3a1 1 0 1 1 1.4 1.42L13.42 9l2.3 2.3a1 1 0 0 1-1.42 1.4L12 10.42l-2.3 2.3a1 1 0 0 1-1.4-1.42L10.58 9l-2.3-2.3a1 1 0 0 1 0-1.4Z"
                            : "M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm16 3a1 1 0 0 0-.3-.7l-3-3a1 1 0 1 0-1.4 1.4L14.58 7H13a6 6 0 0 0-6 6 1 1 0 1 0 2 0 4 4 0 0 1 4-4h1.59l-1.3 1.3a1 1 0 0 0 1.42 1.4l3-3A1 1 0 0 0 18 8Z"} />
                        <path d="M13 19.5c0 .28.22.5.5.5H15a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h1.5a.5.5 0 0 0 .5-.5v-2c0-.28.22-.5.5-.5h1c.28 0 .5.22.5.5v2Z" />
                    </g>}
    </svg>;
}

/** Discord's stream menu wording; the preview preferences are DASS-local. */
export function StreamActionsMenu({ local, stop, changeSource, previewOptions }: StreamActions) {
    const [showPreview, setShowPreview] = useState(previewOptions?.showPreview ?? true);
    const [pauseWhenUnfocused, setPauseWhenUnfocused] = useState(previewOptions?.pauseWhenUnfocused ?? true);
    return <Menu.Menu navId="dass-stream-actions" className="vc-dass-stream-menu" aria-label={getIntlMessage("OPTIONS")} onClose={ContextMenuApi.closeContextMenu}>
        <Menu.MenuGroup>
            <Menu.MenuItem id="dass-stop-stream" label={getIntlMessage(local ? "STOP_STREAMING" : "STOP_WATCHING")} color="danger"
                disabled={!stop} leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="stop" /> }}
                action={() => { ContextMenuApi.closeContextMenu(); stop?.(); }} />
            {local ? <Menu.MenuItem id="dass-change-stream" label={getIntlMessage("SCREENSHARE_CHANGE_STREAM")} disabled={!changeSource}
                leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="change" /> }}
                action={() => { ContextMenuApi.closeContextMenu(); changeSource?.(); }} /> : null}
        </Menu.MenuGroup>
        {local && previewOptions ? <Menu.MenuGroup><Menu.MenuItem id="dass-more-stream-options" label={getIntlMessage("MORE_OPTIONS")}>
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem id="dass-show-preview" label="Show My Screen Share" checked={showPreview}
                    action={() => { setShowPreview(!showPreview); previewOptions.setShowPreview(!showPreview); }} />
                <Menu.MenuCheckboxItem id="dass-pause-preview" label="Pause Preview When Discord Isn’t Focused" checked={pauseWhenUnfocused}
                    action={() => { setPauseWhenUnfocused(!pauseWhenUnfocused); previewOptions.setPauseWhenUnfocused(!pauseWhenUnfocused); }} />
            </Menu.MenuGroup>
        </Menu.MenuItem></Menu.MenuGroup> : null}
    </Menu.Menu>;
}

export interface StreamSidebarBodyProps {
    sourceName?: string;
    qualityLabel?: string;
    premiumQuality?: boolean;
    sourceIcon?: ReactNode;
}

export function StreamSidebarBody({ sourceName = "Go Live", qualityLabel, premiumQuality, sourceIcon }: StreamSidebarBodyProps) {
    return <div className="vc-dass-stream-sidebar-body">
        <div className="vc-dass-stream-source-icon" aria-hidden="true">
            <span>{sourceIcon ?? sourceName.slice(0, 1)}</span><div className="vc-dass-stream-source-badge"><StreamIcon name="camera" /></div>
        </div>
        <div className="vc-dass-stream-sidebar-info">
            <div className="vc-dass-stream-source-title" title={sourceName}>{sourceName}</div>
            {qualityLabel ? <div className={classes("vc-dass-stream-quality", premiumQuality && "vc-dass-stream-quality-premium")}>
                {premiumQuality ? <StreamIcon name="nitro" premiumGradient /> : null}<span>{qualityLabel}</span>
            </div> : null}
        </div>
    </div>;
}

export function StreamSidebarCard({ stop, ...body }: StreamSidebarBodyProps & { stop(): void; }) {
    return <div className="vc-dass-stream-sidebar-card">
        <StreamSidebarBody {...body} />
        <Tooltip text="Stop Streaming">{tooltipProps => <Button {...tooltipProps} variant="none" size="iconOnly"
            className="vc-dass-stream-sidebar-stop" aria-label="Stop Streaming" onClick={stop}><StreamIcon name="stop" /></Button>}</Tooltip>
    </div>;
}
