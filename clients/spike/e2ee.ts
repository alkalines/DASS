/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 DASS contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// DASS E2EE media encryption (roadmap section 8). Every encoded audio/video
// frame is encrypted on the publisher's device and decrypted on approved
// viewers' devices; the backend relays opaque ciphertext and bounded key
// material blobs but never receives media keys.
//
// Frame layout is project-specific and follows the SFrame shape (RFC 9605):
//   epoch(4 BE) || counter(8 BE) || AES-256-GCM(encoded frame, aad = header)
// The nonce is the per-epoch 96-bit salt XORed with epoch||counter, matching
// the SFrame nonce construction. Keys are derived per epoch with HKDF-SHA-256.
// This is not RFC 9605 SFrame: there is no SFrame key id, no SFrame
// interoperability and no published test vector. Independent cryptographic
// review and interop test vectors remain release gates, not completed steps.
//
// Media epoch keys reach approved viewers as E2EE-wrapped blobs relayed over
// signaling (`key_relay`): AES-256-GCM under a key derived from static ECDH
// P-256 between the publisher's and the viewer's pinned identity keys. The
// trust anchor is the locally pinned identity (TOFU, or a verified safety
// number); a hostile server cannot substitute keys that have already been
// pinned, and cannot add an invisible recipient without the publisher's client
// distributing an epoch key to it.

export const E2EE_FRAME_OVERHEAD_BYTES = 28; // epoch(4) + counter(8) + tag(16)
export const E2EE_MAX_FRAME_BYTES = 262_144;
export const E2EE_KEY_BYTES = 32;
const FRAME_EPOCH_BYTES = 4;
const FRAME_COUNTER_BYTES = 8;
const FRAME_HEADER_BYTES = FRAME_EPOCH_BYTES + FRAME_COUNTER_BYTES;
const TAG_BYTES = 16;
const MAX_EPOCHS = 4;
const REPLAY_WINDOW_BITS = 256;
const NONCE_BYTES = 12;
const WRAP_NONCE_BYTES = 12;

/**
 * Every numeric value the insertable-stream transform worker needs. The
 * worker runs in its own global scope and cannot read this module's
 * bindings, so the constants travel as data and the worker-side code is
 * generated from them instead of from module-scope identifiers.
 */
export interface FrameConstants {
    readonly keyBytes: number;
    readonly epochBytes: number;
    readonly counterBytes: number;
    readonly headerBytes: number;
    readonly tagBytes: number;
    readonly maxEpochs: number;
    readonly replayWindowBits: number;
    readonly nonceBytes: number;
    readonly maxFrameBytes: number;
    readonly frameOverheadBytes: number;
}

const FRAME_CONSTANTS: FrameConstants = {
    keyBytes: E2EE_KEY_BYTES,
    epochBytes: FRAME_EPOCH_BYTES,
    counterBytes: FRAME_COUNTER_BYTES,
    headerBytes: FRAME_HEADER_BYTES,
    tagBytes: TAG_BYTES,
    maxEpochs: MAX_EPOCHS,
    replayWindowBits: REPLAY_WINDOW_BITS,
    nonceBytes: NONCE_BYTES,
    maxFrameBytes: E2EE_MAX_FRAME_BYTES,
    frameOverheadBytes: E2EE_FRAME_OVERHEAD_BYTES
};
const WRAP_CONTEXT_PREFIX = "DASS/E2EE-key-v1/";

function base64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid base64url field.");
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function concatBytes(...parts: Array<Uint8Array | ArrayBuffer>): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part instanceof Uint8Array ? part : new Uint8Array(part), offset);
        offset += part.byteLength;
    }
    return out;
}

async function hkdfSha256(keyBytes: Uint8Array, salt: Uint8Array, info: string, lengthBytes: number): Promise<Uint8Array> {
    const material = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: new TextEncoder().encode(info) },
        material,
        lengthBytes * 8
    );
    return new Uint8Array(bits);
}

/**
 * Per-epoch AES-256-GCM frame cipher. A fresh random 256-bit key and derived
 * 96-bit salt are unique per epoch, so counters may restart at zero after a
 * rekey without reusing a nonce. Encrypts the complete encoded frame; the
 * backend forwards the ciphertext unchanged to every approved viewer.
 *
 * The class is built by a factory so the generated transform-worker source
 * stays self-contained: it closes over its arguments and global APIs only,
 * never over this module's bindings.
 */
export function defineMediaFrameCipher(
    constants: FrameConstants,
    hkdf: (keyBytes: Uint8Array, salt: Uint8Array, info: string, lengthBytes: number) => Promise<Uint8Array>,
    concat: (...parts: Array<Uint8Array | ArrayBuffer>) => Uint8Array
) {
    class FrameCipher {
        private constructor(
            private readonly key: CryptoKey,
            private readonly salt: Uint8Array
        ) { }

        static async create(keyBytes: Uint8Array | ArrayBuffer): Promise<FrameCipher> {
            const raw = keyBytes instanceof Uint8Array ? keyBytes : new Uint8Array(keyBytes);
            if (raw.byteLength !== constants.keyBytes) throw new Error("DASS epoch keys are 256 bits.");
            const expanded = await hkdf(raw, new Uint8Array(constants.nonceBytes), "DASS/SFrame/AES-256-GCM", constants.keyBytes + constants.nonceBytes);
            const key = await crypto.subtle.importKey("raw", expanded.slice(0, constants.keyBytes) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
            return new FrameCipher(key, expanded.slice(constants.keyBytes));
        }

        private nonce(epoch: number, counter: bigint): Uint8Array {
            // XOR epoch into the first salt bytes and the counter into the rest,
            // identical to the SFrame nonce construction (KID || CTR big-endian).
            const overlay = new Uint8Array(constants.headerBytes);
            const view = new DataView(overlay.buffer);
            view.setUint32(0, epoch, false);
            view.setBigUint64(constants.epochBytes, counter, false);
            const nonce = this.salt.slice();
            for (let index = 0; index < constants.headerBytes; index++) nonce[index] ^= overlay[index];
            return nonce;
        }

        /** Encrypt one encoded frame under `epoch`/`counter`; AAD binds the header. */
        async encrypt(epoch: number, counter: bigint, frame: ArrayBuffer): Promise<ArrayBuffer> {
            if (frame.byteLength > constants.maxFrameBytes) throw new Error("DASS frame exceeds the E2EE bound.");
            const header = new Uint8Array(constants.headerBytes);
            const view = new DataView(header.buffer);
            view.setUint32(0, epoch, false);
            view.setBigUint64(constants.epochBytes, counter, false);
            const ciphertext = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv: this.nonce(epoch, counter) as BufferSource, additionalData: header as BufferSource, tagLength: constants.tagBytes * 8 },
                this.key,
                frame
            );
            return concat(header, ciphertext).buffer as ArrayBuffer;
        }

        /** Authenticate and decrypt one wire frame. Throws on tampering. */
        async decrypt(data: ArrayBuffer): Promise<{ epoch: number; counter: bigint; frame: ArrayBuffer; }> {
            if (data.byteLength < constants.headerBytes + constants.tagBytes || data.byteLength > constants.maxFrameBytes + constants.frameOverheadBytes) {
                throw new Error("Malformed DASS frame.");
            }
            const bytes = new Uint8Array(data);
            const header = bytes.slice(0, constants.headerBytes);
            const view = new DataView(data, 0, constants.headerBytes);
            const epoch = view.getUint32(0, false);
            const counter = view.getBigUint64(constants.epochBytes, false);
            const frame = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: this.nonce(epoch, counter) as BufferSource, additionalData: header as BufferSource, tagLength: constants.tagBytes * 8 },
                this.key,
                bytes.slice(constants.headerBytes) as BufferSource
            );
            return { epoch, counter, frame };
        }
    }
    return FrameCipher;
}

export const MediaFrameCipher = defineMediaFrameCipher(FRAME_CONSTANTS, hkdfSha256, concatBytes);

/** Sliding replay window over per-epoch frame counters; admits only new counters. */
export function defineReplayWindow(constants: FrameConstants) {
    class FrameReplayWindow {
        private highest = -1n;
        private seen = 0n;

        admit(counter: bigint): boolean {
            if (counter < 0n) return false;
            if (counter <= this.highest - BigInt(constants.replayWindowBits)) return false;
            const delta = this.highest - counter;
            if (delta < 0n) {
                this.seen = (this.seen << (-delta)) | 1n;
                this.highest = counter;
                return true;
            }
            const bit = 1n << delta;
            if (this.seen & bit) return false;
            this.seen |= bit;
            return true;
        }
    }
    return FrameReplayWindow;
}

export const ReplayWindow = defineReplayWindow(FRAME_CONSTANTS);

/** Fresh random 256-bit media epoch key. */
export function generateEpochKey(): Uint8Array {
    const key = new Uint8Array(E2EE_KEY_BYTES);
    crypto.getRandomValues(key);
    return key;
}

export interface E2eeIdentity {
    /** Base64url SPKI of the ECDH P-256 identity public key; travels in signaling. */
    readonly publicKey: string;
    /** SHA-256 fingerprint of the SPKI bytes, base64url; shown to users. */
    readonly fingerprint: string;
    readonly privateKey: CryptoKey;
    readonly publicKeyCrypto: CryptoKey;
}

export async function importIdentityKey(publicKey: string): Promise<CryptoKey> {
    const bytes = base64urlDecode(publicKey);
    if (bytes.byteLength > 1024) throw new Error("Invalid DASS identity key.");
    return crypto.subtle.importKey("spki", bytes as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function identityFingerprint(publicKey: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", base64urlDecode(publicKey) as BufferSource);
    return base64urlEncode(digest);
}

/** New ECDH P-256 identity. The private key is non-extractable. */
export async function generateIdentity(): Promise<E2eeIdentity> {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const digest = await crypto.subtle.digest("SHA-256", spki as BufferSource);
    return {
        publicKey: base64urlEncode(spki),
        fingerprint: base64urlEncode(digest),
        privateKey: pair.privateKey,
        publicKeyCrypto: pair.publicKey,
    };
}

/**
 * Wrap one media epoch key for a pinned peer identity. The blob is
 * nonce(12) || AES-256-GCM(epoch(4) || key(32)) under a key derived from the
 * ECDH shared secret; AAD binds the stream context so blobs cannot be moved
 * between streams. Only the holder of the peer's private key can unwrap it.
 */
export async function wrapEpochKey(
    identity: E2eeIdentity,
    peerPublicKey: string,
    streamContext: string,
    epoch: number,
    keyBytes: Uint8Array
): Promise<string> {
    const peerKey = await importIdentityKey(peerPublicKey);
    const shared = await crypto.subtle.deriveBits(
        { name: "ECDH", public: peerKey },
        identity.privateKey,
        256
    );
    const wrapMaterial = await hkdfSha256(new Uint8Array(shared), new Uint8Array(NONCE_BYTES), `${WRAP_CONTEXT_PREFIX}${streamContext}`, E2EE_KEY_BYTES);
    const wrapKey = await crypto.subtle.importKey("raw", wrapMaterial as BufferSource, "AES-GCM", false, ["encrypt"]);
    const nonce = new Uint8Array(WRAP_NONCE_BYTES);
    crypto.getRandomValues(nonce);
    const plaintext = new Uint8Array(FRAME_EPOCH_BYTES + E2EE_KEY_BYTES);
    new DataView(plaintext.buffer).setUint32(0, epoch, false);
    plaintext.set(keyBytes, FRAME_EPOCH_BYTES);
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce as BufferSource, additionalData: new TextEncoder().encode(`${WRAP_CONTEXT_PREFIX}${streamContext}`) },
        wrapKey,
        plaintext
    );
    return base64urlEncode(concatBytes(nonce, ciphertext));
}

/** Reverse of wrapEpochKey; throws on a blob for another stream or peer. */
export async function unwrapEpochKey(
    identity: E2eeIdentity,
    peerPublicKey: string,
    streamContext: string,
    blob: string
): Promise<{ epoch: number; keyBytes: Uint8Array; }> {
    const bytes = base64urlDecode(blob);
    if (bytes.byteLength !== WRAP_NONCE_BYTES + FRAME_EPOCH_BYTES + E2EE_KEY_BYTES + TAG_BYTES) {
        throw new Error("Malformed DASS key relay blob.");
    }
    const peerKey = await importIdentityKey(peerPublicKey);
    const shared = await crypto.subtle.deriveBits(
        { name: "ECDH", public: peerKey },
        identity.privateKey,
        256
    );
    const wrapMaterial = await hkdfSha256(new Uint8Array(shared), new Uint8Array(NONCE_BYTES), `${WRAP_CONTEXT_PREFIX}${streamContext}`, E2EE_KEY_BYTES);
    const wrapKey = await crypto.subtle.importKey("raw", wrapMaterial as BufferSource, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, WRAP_NONCE_BYTES) as BufferSource, additionalData: new TextEncoder().encode(`${WRAP_CONTEXT_PREFIX}${streamContext}`) },
        wrapKey,
        bytes.slice(WRAP_NONCE_BYTES) as BufferSource
    );
    const view = new DataView(plaintext);
    return { epoch: view.getUint32(0, false), keyBytes: new Uint8Array(plaintext, FRAME_EPOCH_BYTES) };
}

// ---------------------------------------------------------------------------
// Insertable-streams transform worker. The codec code is generated into the
// worker so both sides run identical code. The worker has its own global
// scope: every unit is embedded as an expression and receives the frame
// constants as data, so no module binding can be missing at runtime.
// ---------------------------------------------------------------------------

const workerBootstrap = `
const codecs = new Map(); // epoch -> { cipher, counter, replay }
let sendEpoch = -1;
let sendCounter = 0n;
let role = null;

function dropStaleEpochs() {
    while (codecs.size > ${FRAME_CONSTANTS.maxEpochs}) {
        codecs.delete(codecs.keys().next().value);
    }
}

async function transformFrame(event) {
    const transformer = event.transformer;
    const port = transformer.options && transformer.options.port;
    if (port) {
        port.onmessage = message => {
            const data = message.data || {};
            if (data.type === "epoch") {
                (async () => {
                    codecs.set(data.epoch, {
                        cipher: await MediaFrameCipher.create(new Uint8Array(data.keyBytes)),
                        counter: 0n,
                        replay: new ReplayWindow()
                    });
                    dropStaleEpochs();
                    if (data.send === true) {
                        sendEpoch = data.epoch;
                        sendCounter = 0n;
                    }
                })().catch(error => {
                    // Fail closed and visibly: without a cipher every frame is
                    // dropped instead of leaving this peer in plaintext.
                    console.error("DASS E2EE epoch installation failed.", error);
                });
            } else if (data.type === "dropBelow") {
                for (const epoch of codecs.keys()) if (epoch < data.epoch) codecs.delete(epoch);
            }
        };
        port.start();
    }
    transformer.readable.pipeThrough(new TransformStream({
        transform: async (frame, controller) => {
            if (role === "encrypt") {
                const entry = codecs.get(sendEpoch);
                if (!entry) return; // fail closed: drop until an epoch key exists
                const counter = sendCounter++;
                const encrypted = await entry.cipher.encrypt(sendEpoch, counter, frame.data);
                frame.data = encrypted;
                controller.enqueue(frame);
            } else {
                const bytes = new Uint8Array(frame.data);
                if (bytes.byteLength < ${FRAME_CONSTANTS.headerBytes + FRAME_CONSTANTS.tagBytes}) return;
                const epoch = new DataView(frame.data, 0, ${FRAME_CONSTANTS.headerBytes}).getUint32(0, false);
                const entry = codecs.get(epoch);
                if (!entry) return; // unknown epoch: drop rather than emit plaintext
                try {
                    const result = await entry.cipher.decrypt(frame.data);
                    if (!entry.replay.admit(result.counter)) return; // replayed frame
                    frame.data = result.frame;
                    controller.enqueue(frame);
                } catch {
                    // Authentication failure or malformed frame: drop silently.
                }
            }
        }
    })).pipeTo(transformer.writable).catch(() => {});
}

self.onrtctransform = event => {
    role = event.transformer.options.role === "encrypt" ? "encrypt" : "decrypt";
    transformFrame(event);
};
`;

/** The complete transform-worker source, generated from this module's code. */
export function transformWorkerSource(): string {
    return [
        `const FRAME_CONSTANTS = ${JSON.stringify(FRAME_CONSTANTS)};`,
        `const concatBytes = (${concatBytes.toString()});`,
        `const hkdfSha256 = (${hkdfSha256.toString()});`,
        `const MediaFrameCipher = (${defineMediaFrameCipher.toString()})(FRAME_CONSTANTS, hkdfSha256, concatBytes);`,
        `const ReplayWindow = (${defineReplayWindow.toString()})(FRAME_CONSTANTS);`,
        workerBootstrap,
    ].join("\n");
}

/**
 * One transform worker per peer. Epoch keys are pushed to the worker through a
 * MessagePort so raw key material never appears in signaling JSON beyond the
 * E2EE-wrapped relay blob.
 */
export class E2eeTransforms {
    private readonly worker: Worker;
    private readonly ports: MessagePort[] = [];

    constructor() {
        if (typeof Worker !== "function" || typeof RTCRtpScriptTransform !== "function") {
            throw new Error("DASS E2EE requires WebRTC insertable streams.");
        }
        const source = transformWorkerSource();
        this.worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    }

    attach(target: RTCRtpSender | RTCRtpReceiver, role: "encrypt" | "decrypt") {
        const channel = new MessageChannel();
        this.ports.push(channel.port1);
        target.transform = new RTCRtpScriptTransform(this.worker, { role, port: channel.port2 }, [channel.port2]);
    }

    /** Distribute a fresh epoch to every attached transform. */
    setEpoch(epoch: number, keyBytes: Uint8Array, send: boolean) {
        for (const port of this.ports) {
            port.postMessage({ type: "epoch", epoch, keyBytes: keyBytes.slice().buffer, send });
        }
    }

    /** Evict epochs below the current one once old traffic had time to drain. */
    retireBelow(epoch: number) {
        for (const port of this.ports) port.postMessage({ type: "dropBelow", epoch });
    }

    close() {
        for (const port of this.ports) port.close();
        this.ports.length = 0;
        this.worker.terminate();
    }
}

// ---------------------------------------------------------------------------
// Identity trust: TOFU pins plus explicit out-of-band verification.
// ---------------------------------------------------------------------------

export interface PinnedIdentity {
    key: string;
    fingerprint: string;
    verified: boolean;
}

export interface IdentityStore {
    readPeer(scope: string): Promise<PinnedIdentity | undefined>;
    writePeer(scope: string, pin: PinnedIdentity): Promise<void>;
    readDevice(): Promise<{ publicKey: string; privateKey: CryptoKey; } | undefined>;
    writeDevice(identity: { publicKey: string; privateKey: CryptoKey; }): Promise<void>;
}

export type IdentityTrust =
    | { kind: "verified"; }
    | { kind: "tofu"; }
    | { kind: "first-contact"; }
    | { kind: "changed"; pinned: PinnedIdentity; };

/**
 * Evaluate a peer's presented identity key against the local pin. A first
 * contact is not written automatically: the caller pins it only once the
 * admission decision (publisher approval / viewer acceptance) is made, so a
 * hostile server cannot silently anchor trust before consent. `changed` means
 * the presented key differs from the pin — admission must pause for explicit
 * review and never silently inherit earlier approvals.
 */
export function evaluateIdentity(pin: PinnedIdentity | undefined, presentedKey: string): IdentityTrust {
    if (!pin) return { kind: "first-contact" };
    if (pin.key !== presentedKey) return { kind: "changed", pinned: pin };
    return pin.verified ? { kind: "verified" } : { kind: "tofu" };
}

/** Human-readable safety number binding both identities; compare out of band. */
export async function safetyNumber(selfKey: string, peerKey: string): Promise<string> {
    const ordered = [selfKey, peerKey].sort();
    const digest = await crypto.subtle.digest(
        "SHA-256",
        concatBytes(new TextEncoder().encode("DASS/safety-v1/"), base64urlDecode(ordered[0]), base64urlDecode(ordered[1])) as BufferSource
    );
    const bytes = new Uint8Array(digest);
    // 30 decimal digits grouped for out-of-band comparison.
    let digits = "";
    for (let index = 0; index < 15; index++) digits += String(bytes[index] % 10).padStart(2, "0");
    return digits.replace(/(\d{6})(?=\d)/g, "$1 ");
}

/**
 * Stream-state label. Only the two states the roadmap allows are shown: an
 * independently verified identity or an unverified TOFU identity. The
 * first-contact and changed-key details belong to the approval prompt.
 */
export function trustLabel(trust: IdentityTrust): string {
    return trust.kind === "verified" ? "E2EE — identity independently verified" : "E2EE — identity unverified (TOFU)";
}

/** Approval-prompt wording, including first contact and changed identities. */
export function trustPrompt(trust: IdentityTrust): string {
    switch (trust.kind) {
        case "verified": return "E2EE — identity independently verified";
        case "tofu": return "E2EE — identity unverified (TOFU)";
        case "first-contact": return "E2EE — first contact (unverified). Approving pins this key as the trust anchor.";
        case "changed": return "E2EE — identity changed. Confirm the new key before approving.";
    }
}
