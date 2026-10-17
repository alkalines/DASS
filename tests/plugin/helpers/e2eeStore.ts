// In-memory E2EE identity store for plugin tests; the real store uses DataStore.
import { type IdentityStore, type PinnedIdentity } from "../../../clients/spike/e2ee";

export function memoryIdentityStore(): IdentityStore {
    const peers = new Map<string, PinnedIdentity>();
    let device: { publicKey: string; privateKey: CryptoKey; } | undefined;
    return {
        readPeer: async scope => peers.get(scope),
        writePeer: async (scope, pin) => { peers.set(scope, pin); },
        readDevice: async () => device,
        writeDevice: async value => { device = value; },
    };
}
