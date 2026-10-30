import { expect, mock, test } from "bun:test";

// Exercise validation and ownership with a fake keyring, not Electron/OS crypto.
let secureBackend = "gnome_libsecret";
let encryptionAvailable = true;
let sequence = 0;
const encryptedPayloads = new Map<string, string>();
const openedReleaseUrls: string[] = [];
mock.module("electron", () => ({ app: {}, webContents: {}, shell: { openExternal: async (url: string) => { openedReleaseUrls.push(url); } }, safeStorage: {
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
mock.module("@main/settings", () => ({ RendererSettings: { store: { plugins: {} } } }));
Object.assign(globalThis, { IS_DISCORD_DESKTOP: false });

const native = await import("../../plugins/dass/native");
Object.assign(globalThis, { VencordNative: { pluginHelpers: { DASS: {
    encryptRememberedAccount: (value: unknown) => native.encryptRememberedAccount(undefined as never, value),
    decryptRememberedAccount: (value: unknown) => native.decryptRememberedAccount(undefined as never, value)
} } } });
const storage = await import("../../plugins/dass/accountStorage");
const account = { backendUrl: "https://dass.example", username: "alice", password: "a_separate_password" };

test("release links only open the fixed project and validated stable versions", async () => {
    for (const value of [undefined, null, {}, "https://evil.invalid", "../../evil", "0.1.0-rc.1", "0.1.0?x=y"]) {
        await native.openPluginRelease(undefined as never, value);
    }
    expect(openedReleaseUrls).toEqual([]);
    await native.openPluginRelease(undefined as never, "0.2.0");
    expect(openedReleaseUrls).toEqual(["https://github.com/alkalines/DASS/releases/tag/v0.2.0"]);
});

test("remembered storage persists only native-produced ciphertext and can forget it", async () => {
    await storage.writeRememberedAccount(account);
    const stored = values.get("DASS_rememberedAccount_v1");
    expect(typeof stored).toBe("string");
    expect(JSON.stringify([...values])).not.toContain(account.password);
    expect(await storage.readRememberedAccount()).toEqual(account);
    await storage.forgetRememberedAccount();
    expect(await storage.readRememberedAccount()).toBeUndefined();
});

test("old encrypted accounts migrate without retaining a manually selected room", async () => {
    const ciphertext = Buffer.from("legacy_ciphertext").toString("base64");
    encryptedPayloads.set(ciphertext, JSON.stringify({ version: 1, ...account, roomId: "old_room" }));
    const result = await native.decryptRememberedAccount(undefined as never, ciphertext);
    expect(result).toEqual({ success: true, account });
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
