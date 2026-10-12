/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Callers must supply fixed events and non-sensitive state only, never payloads or raw errors. */
export function logDiagnostic(event: string, details: Record<string, string | number | boolean> = {}, failed = false) {
    if (failed) console.error(`[DASS] ${event}`, details);
    else console.info(`[DASS] ${event}`, details);
}

/** Browser messages/stacks may contain URLs, source names or secrets. Only known names are safe. */
export function browserFailureCode(error: unknown): string {
    const allowed = ["AbortError", "NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError", "InvalidStateError", "NotSupportedError", "TypeError"];
    return error instanceof Error && allowed.includes(error.name) ? error.name : "unknown";
}
