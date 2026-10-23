/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { DiagnosticEntry } from "../../crates/protocol/generated/signaling";

const collectors = new Set<(entry: DiagnosticEntry) => void>();
let clientId: string | undefined;

/** Random, process-local label, not an account/Discord/device identifier. */
export function diagnosticClientId() {
    return clientId ??= `client_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** One authenticated socket owns collection; parallel watcher sockets do not duplicate it. */
export function collectDiagnostics(collector: (entry: DiagnosticEntry) => void) {
    collectors.add(collector);
    return () => { collectors.delete(collector); };
}

/** Callers must supply fixed events and non-sensitive state only, never payloads or raw errors. */
export function logDiagnostic(event: string, details: Record<string, string | number | boolean> = {}, failed = false) {
    if (failed) console.error(`[DASS] ${event}`, details);
    else console.info(`[DASS] ${event}`, details);
    const collector = collectors.values().next().value;
    if (collector) {
        const now = Date.now();
        const encoded = JSON.stringify(details);
        if (event.length <= 96 && new TextEncoder().encode(encoded).byteLength <= 2048) {
            collector({ at_unix_seconds: Math.floor(now / 1000), milliseconds: now % 1000, event, failed, details: encoded });
        }
    }
}

/** Browser messages/stacks may contain URLs, source names or secrets. Only known names are safe. */
export function browserFailureCode(error: unknown): string {
    const allowed = ["AbortError", "NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError", "InvalidStateError", "NotSupportedError", "TypeError"];
    return error instanceof Error && allowed.includes(error.name) ? error.name : "unknown";
}

/** Allowlisted RTP counters only. Never serialize a raw stats report: it contains addresses and identifiers. */
export function mediaDiagnostics(report: RTCStatsReport, publisher: boolean): Array<Record<string, string | number | boolean>> {
    const rows: Array<Record<string, string | number | boolean>> = [];
    report.forEach((value: Record<string, unknown>) => {
        if (rows.length >= 4 || value.type !== (publisher ? "outbound-rtp" : "inbound-rtp")) return;
        const kind = value.kind ?? value.mediaType;
        if (kind !== "video" && kind !== "audio") return;
        const codec = typeof value.codecId === "string" ? report.get(value.codecId) as Record<string, unknown> | undefined : undefined;
        const mimeType = typeof codec?.mimeType === "string" ? codec.mimeType.toLowerCase() : "";
        const row: Record<string, string | number | boolean> = {
            role: publisher ? "publisher" : "viewer", kind,
            codec: ["video/vp8", "video/vp9", "video/h264", "video/av1", "audio/opus", "video/rtx"].includes(mimeType) ? mimeType : "unknown"
        };
        for (const field of ["payloadType", "clockRate", "channels"]) {
            const number = codec?.[field];
            if (typeof number === "number" && Number.isFinite(number) && number >= 0) row[field] = number;
        }
        for (const field of ["bytesReceived", "packetsReceived", "packetsLost", "framesReceived", "framesDecoded", "keyFramesDecoded",
            "framesDropped", "pliCount", "firCount", "nackCount", "bytesSent", "packetsSent", "framesEncoded", "keyFramesEncoded",
            "framesSent", "frameWidth", "frameHeight", "framesPerSecond", "jitter", "totalDecodeTime", "totalEncodeTime"]) {
            const number = value[field];
            if (typeof number === "number" && Number.isFinite(number)) row[field] = number;
        }
        for (const field of ["decoderImplementation", "encoderImplementation"]) {
            // Browser-defined strings are not generally safe to log verbatim.
            const implementation = value[field];
            if (typeof implementation === "string") row[field] = ["libvpx", "libvpx vp8", "libvpx vp9", "openh264", "ffmpeg", "external", "unknown"]
                .includes(implementation.toLowerCase()) ? implementation.toLowerCase() : "other";
        }
        if (typeof value.powerEfficientDecoder === "boolean") row.powerEfficientDecoder = value.powerEfficientDecoder;
        rows.push(row);
    });
    return rows;
}
