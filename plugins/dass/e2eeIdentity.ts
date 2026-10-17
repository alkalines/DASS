/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Local E2EE identity and peer-key pins. The device identity's private key is
// a non-extractable CryptoKey persisted via the host's encrypted store
// (IndexedDB DataStore in Equicord); peer pins are TOFU anchors that become
// "verified" only through explicit out-of-band safety-number confirmation.
// Ordinary plugin settings never store keys.

import {
    type E2eeIdentity,
    generateIdentity,
    identityFingerprint,
    type IdentityStore,
    importIdentityKey,
    type PinnedIdentity,
} from "../../clients/spike/e2ee";

const DEVICE_KEY = "DASS_e2eeDevice_v1";
const PIN_PREFIX = "DASS_e2eePin_v1/";

/** Minimal key/value adapter over the host store so the store module can be
 * injected (and mocked in tests) without statically importing plugin APIs. */
export interface KeyValueBackend {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    del(key: string): Promise<void>;
}

let writeQueue: Promise<void> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
}

export class DassIdentityStore implements IdentityStore {
    constructor(private readonly backend: KeyValueBackend) { }

    async readPeer(scope: string): Promise<PinnedIdentity | undefined> {
        const pin = await this.backend.get(`${PIN_PREFIX}${scope}`);
        if (pin === undefined) return undefined;
        if (typeof pin !== "object" || pin === null) throw new Error("Invalid DASS identity pin.");
        const { key, fingerprint, verified } = pin as PinnedIdentity;
        if (typeof key !== "string" || typeof fingerprint !== "string" || typeof verified !== "boolean") {
            throw new Error("Invalid DASS identity pin.");
        }
        return { key, fingerprint, verified };
    }

    writePeer(scope: string, pin: PinnedIdentity): Promise<void> {
        return serialize(() => this.backend.set(`${PIN_PREFIX}${scope}`, { key: pin.key, fingerprint: pin.fingerprint, verified: pin.verified }));
    }

    /** Mark a pinned peer identity as verified after out-of-band comparison. */
    async verifyPeer(scope: string, key: string): Promise<void> {
        const pin = await this.readPeer(scope);
        if (!pin || pin.key !== key) throw new Error("Cannot verify an unpinned or changed DASS identity.");
        await this.writePeer(scope, { ...pin, verified: true });
    }

    async readDevice() {
        const stored = await this.backend.get(DEVICE_KEY);
        if (stored === undefined) return undefined;
        if (typeof stored !== "object" || stored === null) throw new Error("Invalid DASS device identity.");
        const { publicKey, privateKey } = stored as { publicKey?: unknown; privateKey?: unknown; };
        if (typeof publicKey !== "string" || !(privateKey instanceof CryptoKey)) throw new Error("Invalid DASS device identity.");
        return { publicKey, privateKey };
    }

    writeDevice(identity: { publicKey: string; privateKey: CryptoKey; }): Promise<void> {
        return serialize(() => this.backend.set(DEVICE_KEY, { publicKey: identity.publicKey, privateKey: identity.privateKey }));
    }
}

let cached: Promise<E2eeIdentity> | undefined;
let defaultStore: IdentityStore | undefined;

/** Inject the host key/value backend once at plugin start (Equicord DataStore). */
export function configureIdentityBackend(backend: KeyValueBackend) {
    defaultStore = new DassIdentityStore(backend);
    cached = undefined;
}

export async function defaultIdentityStore(): Promise<IdentityStore> {
    if (defaultStore) return defaultStore;
    const DataStore = await import("@api/DataStore");
    defaultStore = new DassIdentityStore(DataStore as unknown as KeyValueBackend);
    return defaultStore;
}

/**
 * Load or create the local device identity once per client run. Persistence is
 * best-effort: if the store is unavailable the identity is regenerated, which
 * surfaces to peers as a first-contact/changed identity rather than silently
 * reusing someone else's trust anchor.
 */
export async function deviceIdentity(store?: IdentityStore): Promise<E2eeIdentity> {
    if (store) {
        const stored = await store.readDevice().catch(() => undefined);
        if (stored) {
            return {
                publicKey: stored.publicKey,
                fingerprint: await identityFingerprint(stored.publicKey),
                privateKey: stored.privateKey,
                publicKeyCrypto: await importIdentityKey(stored.publicKey),
            };
        }
        const identity = await generateIdentity();
        await store.writeDevice({ publicKey: identity.publicKey, privateKey: identity.privateKey }).catch(() => {});
        return identity;
    }
    cached ??= (async () => deviceIdentity(await defaultIdentityStore()))();
    return cached;
}
