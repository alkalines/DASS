import { describe, expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "../../crates/protocol/generated/validate";

// Deterministic mutation smoke tests, not coverage-guided backend fuzzing.
const envelope = (operation: unknown) => ({ protocol_version: 1, request_id: "request_1", operation });
const clientOperations = [
    { type: "account_login", username: "alice", password: "synthetic-test-password" },
    { type: "join", room_id: "room", require_e2ee: true },
    { type: "publish", session_id: "publisher", publisher_key: "a2V5" },
    { type: "request_view", session_id: "viewer", publisher_id: "publisher", viewer_key: "a2V5" },
    { type: "view_decision", session_id: "publisher", request_id: "pending", decision: "approve" },
    { type: "subscribe", session_id: "viewer", publisher_id: "publisher", approval_id: "approval" },
    { type: "key_relay", session_id: "publisher", viewer_id: "alice", blob: "YmxvYg" },
    { type: "remove_viewer", session_id: "publisher", viewer_id: "alice" },
    { type: "offer", session_id: "publisher", sdp: "v=0\r\n" },
    { type: "ice", session_id: "publisher", candidate: "candidate:synthetic" },
    { type: "leave", session_id: "publisher" }
];

describe("security protocol mutation regressions", () => {
    test("rejects missing, mistyped and authority-injection fields", () => {
        for (const operation of clientOperations) {
            expect(parseClientMessage(JSON.stringify(envelope(operation))).operation).toEqual(operation);
            for (const field of Object.keys(operation)) {
                const missing = { ...operation } as Record<string, unknown>;
                delete missing[field];
                expect(() => parseClientMessage(JSON.stringify(envelope(missing)))).toThrow();
                for (const value of [null, [], {}, 0, false]) {
                    if (field === "require_e2ee" && value === false) continue;
                    expect(() => parseClientMessage(JSON.stringify(envelope({ ...operation, [field]: value })))).toThrow();
                }
            }
            for (const field of ["__proto__", "constructor", "discord_token", "room_grants", "approved", "viewer_account", "verified"]) {
                expect(() => parseClientMessage(JSON.stringify(envelope({ ...operation, [field]: "forged" })))).toThrow();
            }
        }
    });

    test("seeded mutation corpus rejects with fixed errors or round-trips accepted messages", () => {
        let seed = 0xDA55;
        const corpus = [
            ...clientOperations.map(operation => JSON.stringify(envelope(operation))),
            JSON.stringify(envelope({ type: "rejected", code: "e2ee_unavailable" })),
            JSON.stringify(envelope({ type: "closed", session_id: "viewer", reason: "revoked" })),
            JSON.stringify(envelope({ type: "view_decision", session_id: "viewer", request_id: "pending",
                decision: "approve", approval_id: "approval", publisher_key: "a2V5", publisher_account: "alice" }))
        ];
        for (let index = 0; index < 2048; index++) {
            const original = corpus[index % corpus.length];
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const offset = seed % original.length;
            const input = index % 3 === 0 ? original.slice(0, offset)
                : index % 3 === 1 ? original.slice(0, offset) + original.slice(offset + 1)
                    : original.slice(0, offset) + String.fromCharCode((seed >>> 8) & 0xFF) + original.slice(offset + 1);
            for (const parse of [parseClientMessage, parseServerMessage]) {
                let parsed: unknown;
                let failure: unknown;
                try { parsed = parse(input); } catch (error) { failure = error; }
                if (failure !== undefined) {
                    expect(failure).toBeInstanceOf(Error);
                    expect((failure as Error).message).toBe("Invalid DASS control message");
                } else {
                    expect(parse(JSON.stringify(parsed))).toEqual(parsed);
                }
            }
        }
    });
});
