/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import type { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.DASS as PluginNative<typeof import("./native")>;
const REMEMBERED_ACCOUNT_KEY = "DASS_rememberedAccount_v1";

export interface AccountCredentials {
    backendUrl: string;
    roomId?: string;
    username: string;
    password: string;
}

let writeQueue: Promise<void> = Promise.resolve();

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
}

export async function readRememberedAccount(): Promise<AccountCredentials | undefined> {
    const ciphertext = await DataStore.get<unknown>(REMEMBERED_ACCOUNT_KEY);
    if (ciphertext === undefined) return undefined;
    if (typeof ciphertext !== "string") throw new Error("Remembered DASS account is invalid.");

    const result = await Native.decryptRememberedAccount(ciphertext);
    if (!result.success) throw new Error(result.error);
    return result.account;
}

export function writeRememberedAccount(account: AccountCredentials): Promise<void> {
    return serializeWrite(async () => {
        const result = await Native.encryptRememberedAccount(account);
        if (!result.success) throw new Error(result.error);
        await DataStore.set(REMEMBERED_ACCOUNT_KEY, result.ciphertext);
    });
}

export function forgetRememberedAccount(): Promise<void> {
    return serializeWrite(() => DataStore.del(REMEMBERED_ACCOUNT_KEY));
}
