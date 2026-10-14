/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./volumeControl.css";

import { Clickable, useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties } from "react";

export interface StreamVolumeControlProps {
    muted: boolean;
    sliderPercent: number;
    onToggleMute(): void;
    onVolumeChange(value: number): void;
}

export function StreamVolumeControl({ muted, sliderPercent, onToggleMute, onVolumeChange }: StreamVolumeControlProps) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [dragging, setDragging] = useState(false);
    const hideTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const value = muted ? 0 : sliderPercent;
    const silent = muted || sliderPercent === 0;
    const visible = hovered || focused || dragging;
    const cancelHide = () => clearTimeout(hideTimeout.current);
    useEffect(() => () => clearTimeout(hideTimeout.current), []);
    return <div className="vc-dass-audio-control" onMouseEnter={() => { cancelHide(); setHovered(true); }}
        onMouseLeave={() => { cancelHide(); hideTimeout.current = setTimeout(() => setHovered(false), 150); }}
        onFocus={() => setFocused(true)} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }} onKeyDown={event => {
            if (event.key === "Escape" && visible) {
                event.preventDefault();
                event.stopPropagation();
                cancelHide();
                setHovered(false);
                setFocused(false);
                setDragging(false);
            }
        }}>
        <div className="vc-dass-volume-popover" hidden={!visible}>
            <input className="vc-dass-volume-range" type="range" min={0} max={100} step={1} value={value}
                aria-label="DASS stream volume" aria-orientation="vertical" aria-valuetext={`${Math.round(value)}%`}
                style={{ "--vc-dass-volume-percent": `${value}%` } as CSSProperties}
                onChange={event => onVolumeChange(event.currentTarget.valueAsNumber)}
                onKeyDown={event => {
                    const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1
                        : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
                    if (direction) {
                        event.preventDefault();
                        event.stopPropagation();
                        onVolumeChange(Math.max(0, Math.min(100, value + direction * 5)));
                    }
                }}
                onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
                onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
                onLostPointerCapture={() => setDragging(false)} />
        </div>
        <Clickable className="vc-dass-volume-button" aria-label={silent ? "Unmute DASS stream" : "Mute DASS stream"}
            aria-pressed={muted} onClick={onToggleMute}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path fill="currentColor" d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3Z" />
                {silent ? <path d="m16 9 6 6m0-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    : <>
                        <path d="M16 8a6 6 0 0 1 0 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        {sliderPercent >= 50 && <path d="M19 5a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
                    </>}
            </svg>
        </Clickable>
    </div>;
}
