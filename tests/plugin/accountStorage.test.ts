import { expect, mock, test } from "bun:test";

// Exercise validation and ownership with a fake keyring, not Electron/OS crypto.
let secureBackend = "gnome_libsecret";
let encryptionAvailable = true;
let sequence = 0;
const encryptedPayloads = new Map<string, string>();
mock.module("electron", () => ({ safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    getSelectedStorageBackend: () => secureBackend,
    encryptString: (plaintext: string) => {
        const ciphertext = Buffer.from(`opaque_ciphertext_${++sequence}`);
        encryptedPayloads.set(ciphertext.toString("base64"), plaintext);
        return ciphertext;
    },
    decryptString: (ciphertext: Buffer) => {
        const value = encryptedPayloads.get(ciphertext.toString("base64"));
        if (!value) throw new Error("Invalid ciphertext");
        return value;
    }
} }));
const values = new Map<string, unknown>();
mock.module("@api/DataStore", () => ({ get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => { values.set(key, value); },
    del: async (key: string) => { values.delete(key); } }));

const native = await import("../../plugins/dass/native");
Object.assign(globalThis, { VencordNative: { pluginHelpers: { DASS: {
    encryptRememberedAccount: (value: unknown) => native.encryptRememberedAccount(undefined as never, value),
    decryptRememberedAccount: (value: unknown) => native.decryptRememberedAccount(undefined as never, value)
} } } });
const storage = await import("../../plugins/dass/accountStorage");
const account = { backendUrl: "https://dass.example", roomId: "room", username: "alice", password: "a_separate_password" };

test("remembered storage persists only native-produced ciphertext and can forget it", async () => {
    await storage.writeRememberedAccount(account);
    const stored = values.get("DASS_rememberedAccount_v1");
    expect(typeof stored).toBe("string");
    expect(JSON.stringify([...values])).not.toContain(account.password);
    expect(await storage.readRememberedAccount()).toEqual(account);
    await storage.forgetRememberedAccount();
    expect(await storage.readRememberedAccount()).toBeUndefined();
});

test("Linux basic-text and unknown keyrings never persist account passwords", async () => {
    if (process.platform !== "linux") return;
    try {
        for (secureBackend of ["basic_text", "unknown"]) {
            await expect(storage.writeRememberedAccount(account)).rejects.toThrow("Secure account storage is unavailable");
            expect(values.size).toBe(0);
        }
    } finally { secureBackend = "gnome_libsecret"; }
});

test("unavailable encryption fails closed without a plaintext storage fallback", async () => {
    encryptionAvailable = false;
    try {
        await expect(storage.writeRememberedAccount(account)).rejects.toThrow();
        expect(values.size).toBe(0);
    } finally { encryptionAvailable = true; }
});

test("native IPC rejects malformed account payloads and unsafe backend origins", async () => {
    for (const value of [null, [], { ...account, extra: true }, { ...account, username: "invalid/user" },
        { ...account, backendUrl: "https://name:password@dass.example" }, { ...account, backendUrl: "https://dass.example/path" },
        { ...account, password: "x".repeat(513) }]) {
        expect((await native.encryptRememberedAccount(undefined as never, value)).success).toBe(false);
    }
    for (const value of [null, "", "!not_base64!", "x".repeat(8193)]) {
        expect((await native.decryptRememberedAccount(undefined as never, value)).success).toBe(false);
    }
});

test("a queued forget cannot be undone by a preceding remember operation", async () => {
    const remembering = storage.writeRememberedAccount(account);
    const forgetting = storage.forgetRememberedAccount();
    await Promise.all([remembering, forgetting]);
    expect(values.size).toBe(0);
});
