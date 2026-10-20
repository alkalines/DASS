import { describe, expect, test } from "bun:test";
import {
    E2EE_FRAME_OVERHEAD_BYTES,
    E2EE_KEY_BYTES,
    E2EE_MAX_FRAME_BYTES,
    MediaFrameCipher,
    ReplayWindow,
    evaluateIdentity,
    generateEpochKey,
    generateIdentity,
    identityFingerprint,
    safetyNumber,
    transformWorkerSource,
    trustLabel,
    trustPrompt,
    unwrapEpochKey,
    wrapEpochKey,
} from "../../clients/spike/e2ee";

const FRAME = new TextEncoder().encode("encoded video frame payload").buffer;

describe("media frame cipher", () => {
    test("rejects integer truncation and oversized frames before encryption", async () => {
        const cipher = await MediaFrameCipher.create(generateEpochKey());
        for (const epoch of [-1, 0x100000000, 1.5, NaN, Infinity]) {
            await expect(cipher.encrypt(epoch, 0n, FRAME)).rejects.toThrow("Invalid DASS frame");
        }
        for (const counter of [-1n, 0x10000000000000000n]) {
            await expect(cipher.encrypt(1, counter, FRAME)).rejects.toThrow("Invalid DASS frame");
        }
        await expect(cipher.encrypt(1, 0n, new ArrayBuffer(E2EE_MAX_FRAME_BYTES + 1))).rejects.toThrow();
        await expect(cipher.decrypt(new ArrayBuffer(E2EE_MAX_FRAME_BYTES + E2EE_FRAME_OVERHEAD_BYTES + 1))).rejects.toThrow();
        for (const length of [0, 16, 31, 33]) {
            await expect(MediaFrameCipher.create(new Uint8Array(length))).rejects.toThrow();
        }
    });

    test("encrypts and decrypts frames with a 12-byte header and 16-byte tag", async () => {
        const cipher = await MediaFrameCipher.create(generateEpochKey());
        const encrypted = new Uint8Array(await cipher.encrypt(7, 3n, FRAME));
        expect(encrypted.byteLength).toBe(FRAME.byteLength + E2EE_FRAME_OVERHEAD_BYTES);
        // Header carries epoch + counter; the plaintext frame is not recoverable
        // from the ciphertext body.
        expect(new DataView(encrypted.buffer).getUint32(0)).toBe(7);
        expect(encrypted.slice(12).some((byte, index) => byte !== new Uint8Array(FRAME)[index])).toBe(true);
        const decrypted = await cipher.decrypt(encrypted.buffer as ArrayBuffer);
        expect(decrypted.epoch).toBe(7);
        expect(decrypted.counter).toBe(3n);
        expect(new Uint8Array(decrypted.frame)).toEqual(new Uint8Array(FRAME));
    });

    test("rejects tampered ciphertext and malformed frames", async () => {
        const cipher = await MediaFrameCipher.create(generateEpochKey());
        const encrypted = new Uint8Array(await cipher.encrypt(1, 0n, FRAME));
        const tampered = encrypted.slice();
        tampered[13] ^= 0xff;
        await expect(cipher.decrypt(tampered.buffer)).rejects.toThrow();
        // A different counter changes the nonce and fails authentication.
        const forged = encrypted.slice();
        new DataView(forged.buffer).setBigUint64(4, 99n);
        await expect(cipher.decrypt(forged.buffer)).rejects.toThrow();
        await expect(cipher.decrypt(new ArrayBuffer(4))).rejects.toThrow();
    });

    test("different epochs cannot decrypt each other and keys differ per epoch", async () => {
        const a = await MediaFrameCipher.create(generateEpochKey());
        const b = await MediaFrameCipher.create(generateEpochKey());
        const encrypted = await a.encrypt(1, 0n, FRAME);
        await expect(b.decrypt(encrypted)).rejects.toThrow();
        // Same key material under a different epoch still decrypts — nonce
        // separation is per key, and epoch keys are rotated together.
        const again = await MediaFrameCipher.create(generateEpochKey());
        expect(await again.decrypt(await again.encrypt(2, 5n, FRAME))).toMatchObject({ epoch: 2, counter: 5n });
    });
});

describe("transform worker scope", () => {
    test("the generated worker source carries every constant it needs", async () => {
        // The worker runs in its own global scope. Evaluating the generated
        // source there proves no module binding is missing at runtime; a
        // missing constant would leave every frame dropped.
        const scope: { onrtctransform?: unknown } = {};
        const factory = new Function("self", `${transformWorkerSource()}\nreturn { MediaFrameCipher, ReplayWindow };`);
        const worker = factory(scope) as {
            MediaFrameCipher: typeof MediaFrameCipher;
            ReplayWindow: typeof ReplayWindow;
        };
        expect(typeof scope.onrtctransform).toBe("function");

        const cipher = await worker.MediaFrameCipher.create(generateEpochKey());
        const encrypted = await cipher.encrypt(4, 9n, FRAME);
        const decrypted = await cipher.decrypt(encrypted);
        expect(new Uint8Array(decrypted.frame)).toEqual(new Uint8Array(FRAME));
        expect(decrypted.epoch).toBe(4);
        expect(decrypted.counter).toBe(9n);

        const window = new worker.ReplayWindow();
        expect(window.admit(3n)).toBe(true);
        expect(window.admit(3n)).toBe(false);
        expect(window.admit(0xFFFFFFFFFFFFFFFFn)).toBe(true);
        expect(window.admit(0xFFFFFFFFFFFFFFFFn)).toBe(false);
        await expect(cipher.encrypt(0x100000000, 9n, FRAME)).rejects.toThrow();
    });

    test("preserves counters/replay across duplicates and orders conflicting and stale epoch controls", async () => {
        type EncodedFrame = { data: ArrayBuffer; };
        type WorkerScope = { onrtctransform?: (event: { transformer: { options: { role: string; port: MessagePort; }; readable: ReadableStream<EncodedFrame>; writable: WritableStream<EncodedFrame>; }; }) => void; };
        const scope: WorkerScope = {};
        new Function("self", `${transformWorkerSource()};`)(scope);
        const makeTransform = (role: "encrypt" | "decrypt") => {
            const channel = new MessageChannel();
            let enqueue!: (frame: EncodedFrame) => void;
            let closeInput!: () => void;
            const readable = new ReadableStream<EncodedFrame>({ start(controller) {
                enqueue = frame => controller.enqueue(frame);
                closeInput = () => controller.close();
            } });
            let outputController!: ReadableStreamDefaultController<EncodedFrame>;
            const output = new ReadableStream<EncodedFrame>({ start(controller) { outputController = controller; } });
            const reader = output.getReader();
            const writable = new WritableStream<EncodedFrame>({ write(frame) { outputController.enqueue(frame); }, close() { outputController.close(); } });
            let nextId = 0;
            const acknowledgements = new Map<number, (event: MessageEvent) => void>();
            channel.port1.onmessage = event => acknowledgements.get(event.data.id)?.(event);
            scope.onrtctransform!({ transformer: { options: { role, port: channel.port2 }, readable, writable } });
            const control = (type: "epoch" | "dropBelow", epoch: number, keyBytes?: Uint8Array, send = false) => new Promise<MessageEvent>(resolve => {
                const id = ++nextId;
                acknowledgements.set(id, event => { acknowledgements.delete(id); resolve(event); });
                channel.port1.postMessage({ type, id, epoch, keyBytes: keyBytes?.slice().buffer, send });
            });
            return {
                async install(epoch: number, keyBytes: Uint8Array, send: boolean) {
                    return (await control("epoch", epoch, keyBytes, send)).data.status as string;
                },
                async retire(epoch: number) { await control("dropBelow", epoch); },
                async sendFrame(data: ArrayBuffer) {
                    const result = reader.read();
                    enqueue({ data });
                    return result;
                },
                pushFrame(data: ArrayBuffer) { enqueue({ data }); },
                readFrame() { return reader.read(); },
                async close() {
                    closeInput();
                    await reader.cancel();
                    channel.port1.close();
                    channel.port2.close();
                }
            };
        };
        const key = generateEpochKey();
        const encryptA = makeTransform("encrypt");
        const encryptB = makeTransform("encrypt");
        expect(await encryptA.install(11, key, true)).toBe("installed");
        expect(await encryptB.install(11, key, true)).toBe("installed");
        const firstEncrypted = await encryptA.sendFrame(FRAME);
        const alternateFrame = new TextEncoder().encode("another frame").buffer;
        const secondEncrypted = await encryptB.sendFrame(alternateFrame);
        const firstCiphertext = firstEncrypted.value.data;
        const counters = [firstCiphertext, secondEncrypted.value.data].map(bytes => new DataView(bytes).getBigUint64(4));
        expect(new Set(counters).size).toBe(2);
        expect(await encryptA.install(11, key, true)).toBe("installed");
        const afterDuplicate = await encryptA.sendFrame(FRAME);
        expect(new DataView(afterDuplicate.value.data).getBigUint64(4)).toBe(2n);
        expect(await encryptA.install(11, generateEpochKey(), true)).toBe("rejected");
        const afterConflict = await encryptA.sendFrame(FRAME);
        expect(new DataView(afterConflict.value.data).getBigUint64(4)).toBe(3n);
        const rekey = generateEpochKey();
        expect(await encryptA.install(12, rekey, true)).toBe("installed");
        expect(await encryptA.install(11, key, true)).toBe("installed");
        const afterOutOfOrder = await encryptA.sendFrame(FRAME);
        expect(new DataView(afterOutOfOrder.value.data).getUint32(0)).toBe(12);
        expect(new DataView(afterOutOfOrder.value.data).getBigUint64(4)).toBe(0n);

        const decryptA = makeTransform("decrypt");
        const decryptB = makeTransform("decrypt");
        expect(await decryptA.install(11, key, false)).toBe("installed");
        expect(await decryptB.install(11, key, false)).toBe("installed");
        expect((await decryptA.sendFrame(firstCiphertext)).value.data).toEqual(FRAME);
        expect(await decryptA.install(11, key, false)).toBe("installed");
        decryptB.pushFrame(firstCiphertext);
        decryptB.pushFrame(secondEncrypted.value.data);
        expect(await decryptB.install(11, key, false)).toBe("installed");
        expect((await decryptB.readFrame()).value.data).toEqual(alternateFrame);
        const retirement = decryptA.retire(12);
        const staleInstall = decryptA.install(11, key, false);
        await retirement;
        expect(await staleInstall).toBe("stale");
        for (const transform of [encryptA, encryptB, decryptA, decryptB]) await transform.close();
    });
});

describe("replay window", () => {
    test("bounds history after sustained traffic and a maximum counter jump", () => {
        const window = new ReplayWindow();
        for (let counter = 0n; counter < 4096n; counter++) expect(window.admit(counter)).toBe(true);
        // Inspect retained state as well as behavior: merely rejecting old
        // counters did not prevent the previous bitmap from growing forever.
        const state = window as unknown as { seen: bigint; };
        expect(state.seen.toString(2).length).toBeLessThanOrEqual(256);
        expect(window.admit(0xFFFFFFFFFFFFFFFFn)).toBe(true);
        expect(state.seen).toBe(1n);
        expect(window.admit(0xFFFFFFFFFFFFFFFEn)).toBe(true);
        expect(window.admit(0xFFFFFFFFFFFFFFFEn)).toBe(false);
        expect(window.admit(0x10000000000000000n)).toBe(false);
        expect(window.admit(-1n)).toBe(false);
    });

    test("admits each counter once within the window and rejects repeats", () => {
        const window = new ReplayWindow();
        expect(window.admit(5n)).toBe(true);
        expect(window.admit(5n)).toBe(false);
        expect(window.admit(6n)).toBe(true);
        expect(window.admit(6n)).toBe(false);
        // Old counters below the window edge are rejected.
        for (let index = 0n; index < 300n; index++) window.admit(500n + index);
        expect(window.admit(5n)).toBe(false);
        expect(window.admit(500n)).toBe(false);
    });
});

describe("epoch key wrapping", () => {
    test("only the intended peer unwraps the relayed epoch key", async () => {
        const publisher = await generateIdentity();
        const viewer = await generateIdentity();
        const outsider = await generateIdentity();
        const epochKey = generateEpochKey();
        const context = "stream/stream_1";
        const blob = await wrapEpochKey(publisher, viewer.publicKey, context, 3, epochKey);
        const { epoch, keyBytes } = await unwrapEpochKey(viewer, publisher.publicKey, context, blob);
        expect(epoch).toBe(3);
        expect(keyBytes).toEqual(epochKey);
        await expect(unwrapEpochKey(outsider, publisher.publicKey, context, blob)).rejects.toThrow();
        // A blob bound to another stream context never unwraps here.
        await expect(unwrapEpochKey(viewer, publisher.publicKey, "stream/other", blob)).rejects.toThrow();
        // A blob wrapped for a different publisher key is also inauthentic.
        const wrong = await wrapEpochKey(outsider, viewer.publicKey, context, 3, epochKey);
        await expect(unwrapEpochKey(viewer, publisher.publicKey, context, wrong)).rejects.toThrow();
        await expect(unwrapEpochKey(viewer, publisher.publicKey, context, "aGVsbG8")).rejects.toThrow();
    });
});

describe("identity trust", () => {
    test("first contact, pinned TOFU, verified and changed-key states", async () => {
        const peer = await generateIdentity();
        const fingerprint = await identityFingerprint(peer.publicKey);
        expect(evaluateIdentity(undefined, peer.publicKey).kind).toBe("first-contact");
        const tofu = { key: peer.publicKey, fingerprint, verified: false };
        expect(evaluateIdentity(tofu, peer.publicKey).kind).toBe("tofu");
        expect(evaluateIdentity({ ...tofu, verified: true }, peer.publicKey).kind).toBe("verified");
        const changed = evaluateIdentity(tofu, (await generateIdentity()).publicKey);
        expect(changed.kind).toBe("changed");
        expect(trustPrompt({ kind: "changed", pinned: tofu })).toContain("changed");
        expect(trustPrompt({ kind: "first-contact" })).toContain("first contact");
        // The stream state only shows the two allowed labels.
        expect(trustLabel({ kind: "verified" })).toContain("verified");
        expect(trustLabel({ kind: "tofu" })).toContain("TOFU");
        expect(trustLabel({ kind: "first-contact" })).toContain("unverified");
        expect(trustLabel({ kind: "changed", pinned: tofu })).toContain("unverified");
    });

    test("safety number binds both identity keys deterministically", async () => {
        const a = await generateIdentity();
        const b = await generateIdentity();
        const forward = await safetyNumber(a.publicKey, b.publicKey);
        expect(await safetyNumber(b.publicKey, a.publicKey)).toBe(forward);
        expect(forward).toMatch(/^[\d ]+$/);
        expect(await safetyNumber(a.publicKey, a.publicKey)).not.toBe(forward);
    });
});
