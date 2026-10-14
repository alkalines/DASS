/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./streamEnded.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import type { MouseEvent } from "react";

import { NATIVE_STREAM_ENDED_ART_STYLE_KEYS } from "./discordAdapter";

const endedArtStyles = findCssClassesLazy(...NATIVE_STREAM_ENDED_ART_STYLE_KEYS);

const EndedArtwork = ErrorBoundary.wrap(() => <div className={classes(endedArtStyles.art, "vc-dass-stream-ended-art")} />, { noop: true });

export function StreamEndedScreen({ onClose }: { onClose(event: MouseEvent<HTMLButtonElement>): void; }) {
    return <div className="vc-dass-stream-ended" role="group" aria-label="Ended DASS stream">
        <div className="vc-dass-stream-ended-content">
            <div className="vc-dass-stream-ended-art-container" aria-hidden="true"><EndedArtwork /></div>
            <div className="vc-dass-stream-ended-cta">
                <Heading tag="h2" className="vc-dass-stream-ended-heading" aria-live="polite">This stream has ended.</Heading>
                <Button variant="secondary" size="medium" className="vc-dass-stream-ended-close" onClick={onClose}>Close Stream</Button>
            </div>
        </div>
    </div>;
}
