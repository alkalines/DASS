/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MAX_PUBLISHER_DISPLAY_NAME_BYTES } from "../../crates/protocol/generated/signaling";

export interface DassShare {
    roomId: string;
    shareId: string;
    displayName?: string;
}

export interface CaptureLease {
    stream: MediaStream;
    audioSelected: boolean;
    release(): void;
}

export interface PublishConnection {
    publish(stream: MediaStream, signal: AbortSignal): Promise<void>;
    close(): void;
}

export interface Subscription {
    stream: MediaStream;
    close(): void;
}

export interface ScreenshareTransport {
    preparePublish(roomId: string, signal: AbortSignal): Promise<PublishConnection>;
    subscribe(share: DassShare, signal: AbortSignal): Promise<Subscription>;
    listShares(roomId: string, signal: AbortSignal): Promise<readonly DassShare[]>;
}

export type RoutingResult<T> = { ok: true; value: T; } | { ok: false; message: string; };

interface PendingOperation {
    abort: AbortController;
    timer: ReturnType<typeof setTimeout>;
    cleanup: Array<() => void>;
}

const OPERATION_TIMEOUT_MS = 15_000;
const MAX_ROOM_SHARES = 64;

export class ScreenshareRouting {
    private active = false;
    private roomId?: string;
    private publisher?: PendingOperation;
    private subscriber?: PendingOperation;
    private directory?: PendingOperation;

    constructor(private readonly transport?: ScreenshareTransport) {}

    start() {
        this.active = true;
    }

    setRoom(roomId?: string) {
        if (this.roomId === roomId) return;
        this.reset();
        this.roomId = roomId;
    }

    reset() {
        this.dispose(this.publisher);
        this.dispose(this.subscriber);
        this.dispose(this.directory);
        this.publisher = this.subscriber = this.directory = undefined;
    }

    stop() {
        this.active = false;
        this.reset();
        this.roomId = undefined;
    }

    stopPublishing() {
        this.dispose(this.publisher);
        this.publisher = undefined;
    }

    stopWatching() {
        this.dispose(this.subscriber);
        this.subscriber = undefined;
    }

    private dispose(operation?: PendingOperation) {
        if (!operation || operation.abort.signal.aborted) return;
        operation.abort.abort();
        clearTimeout(operation.timer);
        for (const cleanup of operation.cleanup.reverse()) {
            try {
                cleanup();
            } catch {
                continue;
            }
        }
        operation.cleanup = [];
    }

    private begin(): PendingOperation {
        const operation: PendingOperation = {
            abort: new AbortController(),
            timer: setTimeout(() => this.dispose(operation), OPERATION_TIMEOUT_MS),
            cleanup: []
        };
        return operation;
    }

    private unavailable(roomId: string) {
        return !this.active || !this.transport || !roomId || roomId !== this.roomId;
    }

    private own(operation: PendingOperation, cleanup: () => void) {
        if (operation.abort.signal.aborted) {
            cleanup();
            throw new Error("The screenshare request was cancelled.");
        }
        operation.cleanup.push(cleanup);
    }

    async publish(roomId: string, capture: (signal: AbortSignal) => Promise<CaptureLease>): Promise<RoutingResult<void>> {
        if (this.unavailable(roomId) || !this.transport) {
            return { ok: false, message: "DASS publishing is unavailable. Nothing was captured or sent to Discord." };
        }
        this.stopPublishing();
        const operation = this.begin();
        this.publisher = operation;
        const { signal } = operation.abort;
        try {
            const connection = await this.transport.preparePublish(roomId, signal);
            this.own(operation, () => connection.close());
            const lease = await capture(signal);
            this.own(operation, () => {
                try {
                    lease.stream.getTracks().forEach(track => track.stop());
                } finally {
                    lease.release();
                }
            });
            if (!lease.audioSelected) {
                for (const track of lease.stream.getAudioTracks()) {
                    track.stop();
                    lease.stream.removeTrack(track);
                }
            }
            const videoTracks = lease.stream.getVideoTracks();
            if (!videoTracks.length || videoTracks.some(track => track.readyState === "ended")) {
                throw new Error("No live capture track is available.");
            }
            const onEnded = () => this.dispose(operation);
            for (const track of videoTracks) {
                track.addEventListener("ended", onEnded);
                operation.cleanup.push(() => track.removeEventListener("ended", onEnded));
            }
            await connection.publish(lease.stream, signal);
            if (signal.aborted) throw new Error("The screenshare request was cancelled.");
            clearTimeout(operation.timer);
            return { ok: true, value: undefined };
        } catch {
            this.dispose(operation);
            return { ok: false, message: "DASS publishing failed or was cancelled. No Discord fallback was attempted." };
        }
    }

    async watch(share: DassShare): Promise<RoutingResult<MediaStream>> {
        if (this.unavailable(share.roomId) || !this.transport || !share.shareId) {
            return { ok: false, message: "DASS watching is unavailable. No Discord subscription was started." };
        }
        this.stopWatching();
        const operation = this.begin();
        this.subscriber = operation;
        try {
            const subscription = await this.transport.subscribe(share, operation.abort.signal);
            this.own(operation, () => {
                try {
                    subscription.stream.getTracks().forEach(track => track.stop());
                } finally {
                    subscription.close();
                }
            });
            const videoTracks = subscription.stream.getVideoTracks();
            if (!videoTracks.length || videoTracks.some(track => track.readyState === "ended")) {
                throw new Error("No live subscription track is available.");
            }
            const onEnded = () => this.dispose(operation);
            for (const track of videoTracks) {
                track.addEventListener("ended", onEnded);
                operation.cleanup.push(() => track.removeEventListener("ended", onEnded));
            }
            clearTimeout(operation.timer);
            return { ok: true, value: subscription.stream };
        } catch {
            this.dispose(operation);
            return { ok: false, message: "DASS watching failed or was cancelled. No Discord fallback was attempted." };
        }
    }

    async detect(roomId: string): Promise<RoutingResult<readonly DassShare[]>> {
        if (this.unavailable(roomId) || !this.transport) {
            return { ok: false, message: "DASS stream detection is unavailable." };
        }
        this.dispose(this.directory);
        const operation = this.begin();
        this.directory = operation;
        try {
            const shares = await this.transport.listShares(roomId, operation.abort.signal);
            if (operation.abort.signal.aborted || shares.length > MAX_ROOM_SHARES || shares.some(share => share.roomId !== roomId || !share.shareId
                || (share.displayName !== undefined && (!share.displayName.trim()
                    || new TextEncoder().encode(share.displayName).byteLength > MAX_PUBLISHER_DISPLAY_NAME_BYTES)))) {
                throw new Error("The stream directory is unavailable.");
            }
            return { ok: true, value: shares };
        } catch {
            return { ok: false, message: "DASS stream detection failed or was cancelled." };
        } finally {
            this.dispose(operation);
        }
    }
}
