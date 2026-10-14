/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./streamUi.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { Clickable, ContextMenuApi, Menu, React, Tooltip, useLayoutEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

export interface StreamActions {
    local: boolean;
    stop?(): void;
    changeSource?(): void;
    popout?(): void;
    moreOptions?: ReactNode;
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

type StreamIconName = "options" | "stop" | "change" | "popout" | "screen" | "camera" | "nitro";

function StreamIcon({ name, premiumGradient }: { name: StreamIconName; premiumGradient?: boolean; }) {
    const gradientId = React.useId();
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {premiumGradient ? <defs><linearGradient id={gradientId}>
            <stop stopColor="var(--premium-tier-2-purple-for-gradients, #8849c6)" />
            <stop offset="0.502368" stopColor="var(--premium-tier-2-purple-for-gradients-2, #bc49c1)" />
            <stop offset="1" stopColor="var(--premium-tier-2-pink-for-gradients, #b84c8d)" />
        </linearGradient></defs> : null}
        {name === "options" ? <g fill="currentColor"><circle cx="4" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="20" cy="12" r="2" /></g>
            : name === "camera" ? <path fill="currentColor" d="M4 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-2.12a1 1 0 0 0 .55.9l3 1.5a1 1 0 0 0 1.45-.9V7.62a1 1 0 0 0-1.45-.9l-3 1.5a1 1 0 0 0-.55.9V7a3 3 0 0 0-3-3H4Z" />
                : name === "nitro" ? <path fill={premiumGradient ? `url(#${gradientId})` : "currentColor"} d="M16.23 12c0 1.29-.95 2.25-2.22 2.25A2.18 2.18 0 0 1 11.8 12c0-1.29.95-2.25 2.22-2.25 1.27 0 2.22.96 2.22 2.25ZM23 12c0 5.01-4 9-8.99 9a8.93 8.93 0 0 1-8.75-6.9H3.34l-.9-4.2H5.3c.26-.96.68-1.89 1.21-2.7H1.89L1 3h12.74C19.13 3 23 6.99 23 12Zm-4.26 0c0-2.67-2.1-4.8-4.73-4.8A4.74 4.74 0 0 0 9.28 12c0 2.67 2.1 4.8 4.73 4.8a4.74 4.74 0 0 0 4.73-4.8Z" />
                    : name === "popout" ? <g fill="currentColor">
                        <path d="M15 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V4.41l-4.3 4.3a1 1 0 1 1-1.4-1.42L19.58 3H16a1 1 0 0 1-1-1Z" />
                        <path d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6a1 1 0 1 0-2 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a1 1 0 1 0 0-2H5Z" />
                    </g> : <g fill="currentColor">
                        <path fillRule="evenodd" d={name === "stop"
                            ? "M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm6.3.3a1 1 0 0 1 1.4 0L12 7.58l2.3-2.3a1 1 0 1 1 1.4 1.42L13.42 9l2.3 2.3a1 1 0 0 1-1.42 1.4L12 10.42l-2.3 2.3a1 1 0 0 1-1.4-1.42L10.58 9l-2.3-2.3a1 1 0 0 1 0-1.4Z"
                            : name === "change"
                                ? "M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm16 3a1 1 0 0 0-.3-.7l-3-3a1 1 0 1 0-1.4 1.4L14.58 7H13a6 6 0 0 0-6 6 1 1 0 1 0 2 0 4 4 0 0 1 4-4h1.59l-1.3 1.3a1 1 0 0 0 1.42 1.4l3-3A1 1 0 0 0 18 8Z"
                                : "M5 2a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5Z"} />
                        <path d="M13 19.5c0 .28.22.5.5.5H15a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h1.5a.5.5 0 0 0 .5-.5v-2c0-.28.22-.5.5-.5h1c.28 0 .5.22.5.5v2Z" />
                    </g>}
    </svg>;
}

export function StreamActionsMenu({ local, stop, changeSource, popout, moreOptions, previewOptions }: StreamActions) {
    const [showPreview, setShowPreview] = useState(previewOptions?.showPreview ?? true);
    const [pauseWhenUnfocused, setPauseWhenUnfocused] = useState(previewOptions?.pauseWhenUnfocused ?? true);
    return <Menu.Menu navId="dass-stream-actions" className="vc-dass-stream-menu" aria-label="Stream Actions" onClose={ContextMenuApi.closeContextMenu}>
        <Menu.MenuGroup>
            <Menu.MenuItem id="dass-stop-stream" label={local ? "Stop Streaming" : "Stop Watching"} color="danger"
                disabled={!stop} leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="stop" /> }}
                action={() => { ContextMenuApi.closeContextMenu(); stop?.(); }} />
            {local ? <Menu.MenuItem id="dass-change-stream" label="Change Stream" disabled={!changeSource}
                leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="change" /> }} action={changeSource} /> : null}
        </Menu.MenuGroup>
        <Menu.MenuGroup>
            <Menu.MenuItem id="dass-popout-stream" label="Pop Out Stream" disabled={!popout}
                leadingAccessory={{ type: "icon", icon: () => <StreamIcon name="popout" /> }} action={popout} />
        </Menu.MenuGroup>
        {moreOptions || local && previewOptions ? <Menu.MenuGroup><Menu.MenuItem id="dass-more-stream-options" label="More Options">
            {local && previewOptions ? <Menu.MenuGroup>
                <Menu.MenuCheckboxItem id="dass-show-preview" label="Show My Screen Share" checked={showPreview}
                    action={() => { setShowPreview(!showPreview); previewOptions.setShowPreview(!showPreview); }} />
                <Menu.MenuCheckboxItem id="dass-pause-preview" label="Pause Preview When Discord Isn’t Focused" checked={pauseWhenUnfocused}
                    action={() => { setPauseWhenUnfocused(!pauseWhenUnfocused); previewOptions.setPauseWhenUnfocused(!pauseWhenUnfocused); }} />
            </Menu.MenuGroup> : null}
            {moreOptions}
        </Menu.MenuItem></Menu.MenuGroup> : null}
    </Menu.Menu>;
}

const SafeStreamActionsMenu = ErrorBoundary.wrap(StreamActionsMenu, { message: "DASS stream menu failed." });

export interface StreamOverlayProps extends StreamActions {
    title: string;
    audioControl?: ReactNode;
    controlsBottom?: number;
}

export function StreamOverlay(props: StreamOverlayProps) {
    function openMenu(event: MouseEvent) {
        event.stopPropagation();
        ContextMenuApi.openContextMenu(event, () => <SafeStreamActionsMenu {...props} />);
    }
    return <div className="vc-dass-stream-overlay" style={{ bottom: props.controlsBottom }}>
        <span className="vc-dass-stream-title"><StreamIcon name="screen" /><span>{props.title}</span></span>
        <div className="vc-dass-stream-overlay-actions" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
            {props.audioControl}
            <Tooltip text="Options">{tooltipProps => <Button {...tooltipProps} variant="none" size="small"
                className="vc-dass-stream-options" aria-label="Options" aria-haspopup="menu" onClick={openMenu}>
                <StreamIcon name="options" />
            </Button>}</Tooltip>
        </div>
    </div>;
}

export function StreamLiveBadge({ quality }: { quality?: StreamQuality; }) {
    const qualityContent = useRef<HTMLDivElement>(null);
    const [qualityWidth, setQualityWidth] = useState(0);
    useLayoutEffect(() => {
        const element = qualityContent.current;
        if (!element) { setQualityWidth(0); return; }
        const measure = () => setQualityWidth(element.getBoundingClientRect().width);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [quality?.resolution, quality?.framesPerSecond, quality?.premium]);
    return <div className={classes("vc-dass-stream-live-indicator", quality && "vc-dass-stream-live-has-quality")}
        style={{ "--vc-dass-stream-quality-width": `${qualityWidth}px` } as CSSProperties}>
        {quality ? <div className="vc-dass-stream-quality-clip"><div className="vc-dass-stream-quality-overflow" ref={qualityContent}>
            <span className="vc-dass-stream-badge-quality">
                {quality.premium ? <StreamIcon name="nitro" /> : null}
                <span>{quality.resolution}</span><span>{quality.framesPerSecond}FPS</span>
            </span>
        </div></div> : null}
        <span className="vc-dass-stream-live">LIVE</span>
    </div>;
}

export interface StreamTileSurfaceProps extends StreamOverlayProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    focused?: boolean;
    quality?: StreamQuality;
    onFocusStream?(): void;
}

export function StreamTileSurface({ children, className, style, focused, quality, onFocusStream, ...overlay }: StreamTileSurfaceProps) {
    return <div className={classes("vc-dass-stream-surface", focused && "vc-dass-stream-surface-focused", className)} style={style}>
        <Clickable className="vc-dass-stream-media" aria-label={`Call tile, stream, ${overlay.title}`}
            onClick={onFocusStream}>{overlay.local && overlay.previewOptions?.showPreview === false
                ? <div className="vc-dass-stream-preview-hidden">Your screen share preview is hidden.</div> : children}</Clickable>
        <div className="vc-dass-stream-indicators"><StreamLiveBadge quality={quality} /></div>
        <StreamOverlay {...overlay} />
    </div>;
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
