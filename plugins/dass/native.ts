/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type IpcMainInvokeEvent, safeStorage, shell } from "electron";

import { DASS_VERSION } from "./releaseInfo";
import { fetchPluginUpdate, pluginReleaseUrl } from "./releaseUpdates";

export { prepareDesktopCapture } from "./nativeCapture";

let updateRequest: AbortController | undefined;

export async function getPluginUpdate(_: IpcMainInvokeEvent): Promise<string | undefined> {
    updateRequest?.abort();
    const request = new AbortController();
    updateRequest = request;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
        return await fetchPluginUpdate(DASS_VERSION, request.signal);
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeout);
        if (updateRequest === request) updateRequest = undefined;
    }
}

export function cancelPluginUpdate(_: IpcMainInvokeEvent): void {
    updateRequest?.abort();
    updateRequest = undefined;
}

export async function openPluginRelease(_: IpcMainInvokeEvent, version: unknown): Promise<void> {
    if (typeof version !== "string" || version.length > 64) return;
    const url = pluginReleaseUrl(version);
    if (url) await shell.openExternal(url).catch(() => {});
}

const VERSION = 2;
const MAX_BACKEND_ORIGIN_LENGTH = 320;
const MAX_CIPHERTEXT_BYTES = 8192;
const ACCOUNT_FIELDS = ["backendUrl", "username", "password"] as const;
const VERSIONED_ACCOUNT_FIELDS = ["version", ...ACCOUNT_FIELDS] as const;
const INVALID_ACCOUNT_ERROR = "Invalid DASS account details.";
const STORAGE_UNAVAILABLE_ERROR = "Secure account storage is unavailable.";
const DECRYPTION_ERROR = "Remembered DASS account could not be unlocked.";

interface AccountCredentials {
    backendUrl: string;
    username: string;
    password: string;
}

interface VersionedAccountCredentials extends AccountCredentials {
    version: typeof VERSION;
}

type EncryptionResult = { success: true; ciphertext: string; } | { success: false; error: string; };
type DecryptionResult = { success: true; account: AccountCredentials; } | { success: false; error: string; };

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isValidAccountFields(value: Record<string, unknown>): boolean {
    if (typeof value.backendUrl !== "string" || value.backendUrl.length > MAX_BACKEND_ORIGIN_LENGTH
        || typeof value.username !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.username)
        || typeof value.password !== "string" || value.password.length === 0 || value.password.includes("\0")
        || Buffer.byteLength(value.password, "utf8") > 512) return false;

    try {
        const url = new URL(value.backendUrl);
        return url.protocol === "https:" && url.origin === value.backendUrl && url.pathname === "/"
            && !url.username && !url.password && !url.search && !url.hash;
    } catch {
        return false;
    }
}

function isAccountCredentials(value: unknown): value is AccountCredentials {
    return hasExactKeys(value, ACCOUNT_FIELDS) && isValidAccountFields(value);
}

function isVersionedAccountCredentials(value: unknown): value is VersionedAccountCredentials {
    return hasExactKeys(value, VERSIONED_ACCOUNT_FIELDS) && value.version === VERSION && isValidAccountFields(value);
}

function isLegacyAccount(value: unknown): value is AccountCredentials & { version: 1; roomId: string; } {
    return hasExactKeys(value, ["version", ...ACCOUNT_FIELDS, "roomId"]) && value.version === 1
        && typeof value.roomId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.roomId) && isValidAccountFields(value);
}

function canUseSecureStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== "linux"
        || ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(safeStorage.getSelectedStorageBackend());
}

export async function encryptRememberedAccount(_: IpcMainInvokeEvent, account: unknown): Promise<EncryptionResult> {
    if (!isAccountCredentials(account)) return { success: false, error: INVALID_ACCOUNT_ERROR };

    try {
        if (!canUseSecureStorage()) return { success: false, error: STORAGE_UNAVAILABLE_ERROR };
        const payload: VersionedAccountCredentials = { version: VERSION, ...account };
        const ciphertext = safeStorage.encryptString(JSON.stringify(payload)).toString("base64");
        if (Buffer.byteLength(ciphertext, "utf8") > MAX_CIPHERTEXT_BYTES) {
            return { success: false, error: STORAGE_UNAVAILABLE_ERROR };
        }
        return { success: true, ciphertext };
    } catch {
        return { success: false, error: STORAGE_UNAVAILABLE_ERROR };
    }
}

export async function decryptRememberedAccount(_: IpcMainInvokeEvent, ciphertext: unknown): Promise<DecryptionResult> {
    if (typeof ciphertext !== "string" || Buffer.byteLength(ciphertext, "utf8") === 0
        || Buffer.byteLength(ciphertext, "utf8") > MAX_CIPHERTEXT_BYTES
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext)) {
        return { success: false, error: DECRYPTION_ERROR };
    }

    try {
        if (!canUseSecureStorage()) return { success: false, error: DECRYPTION_ERROR };
        const encrypted = Buffer.from(ciphertext, "base64");
        if (encrypted.length === 0 || encrypted.toString("base64") !== ciphertext) {
            return { success: false, error: DECRYPTION_ERROR };
        }
        const payload: unknown = JSON.parse(safeStorage.decryptString(encrypted));
        if (!isVersionedAccountCredentials(payload) && !isLegacyAccount(payload)) return { success: false, error: DECRYPTION_ERROR };

        const { backendUrl, username, password } = payload;
        return { success: true, account: { backendUrl, username, password } };
    } catch {
        return { success: false, error: DECRYPTION_ERROR };
    }
}
