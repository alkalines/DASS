/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cancelShareTransportChooser, showShareTransportChooser } from "../../plugins/dass/shareTransport";

const choices: string[] = [];

export function open(preferDass = true, isContextCurrent = true) {
    showShareTransportChooser(preferDass, () => isContextCurrent,
        () => choices.push("discord"), () => choices.push("dass"));
}

export function cancel() {
    cancelShareTransportChooser();
}

export function selected() {
    return [...choices];
}
