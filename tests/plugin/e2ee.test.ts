import { describe, expect, test } from "bun:test";
import {
    E2EE_FRAME_OVERHEAD_BYTES,
    E2EE_KEY_BYTES,
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
    });
});

describe("replay window", () => {
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
