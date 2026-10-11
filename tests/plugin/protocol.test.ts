import { describe, expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "../../crates/protocol/generated/validate";

const message = (operation: unknown, protocol_version = 1) => JSON.stringify({ protocol_version, request_id: "request_1", operation });

describe("proposed signaling protocol", () => {
    test("accepts each client operation", () => {
        for (const operation of [
            { type: "login", credential: "separate-dass-credential" },
            { type: "join", room_id: "room_1", require_e2ee: true },
            { type: "directory", room_id: "room_1" },
            { type: "publish", session_id: "session_1" },
            { type: "subscribe", session_id: "session_1", publisher_id: "publisher_1" },
            { type: "offer", session_id: "session_1", sdp: "v=0\r\n" },
            { type: "ice", session_id: "session_1", candidate: "candidate:example" },
            { type: "leave", session_id: "session_1" }
        ]) expect(parseClientMessage(message(operation)).operation).toEqual(operation);
    });

    test("rejects unknown fields, malformed data and oversized UTF-8", () => {
        for (const input of [
            "{", "null", "[]", "x".repeat(16385),
            message({ type: "login", credential: "é".repeat(257) }),
            message({ type: "login", credential: "secret\0" }),
            message({ type: "join", room_id: "room/1", require_e2ee: false }),
            message({ type: "join", room_id: "room_1", require_e2ee: "false" }),
            message({ type: "join", room_id: "room_1", require_e2ee: false, discord_channel_id: "123" }),
            message({ type: "leave", session_id: "s" }, 2),
            message({ type: "toString" }),
            message({ type: "offer", session_id: "s", sdp: "x".repeat(12289) })
        ]) expect(() => parseClientMessage(input)).toThrow("Invalid DASS control message");
    });

    test("parses server lifecycle and fail-closed E2EE rejection", () => {
        for (const operation of [
            { type: "authenticated", expires_at_unix_seconds: 1800000000 },
            { type: "joined", session_id: "s" },
            { type: "directory", room_id: "room_1", publisher_ids: ["source"] },
            { type: "accepted", session_id: "s" },
            { type: "answer", session_id: "s", sdp: "v=0\r\n" },
            { type: "ice", session_id: "s", candidate: "candidate:example" },
            { type: "closed", session_id: "s", reason: "revoked" },
            { type: "rejected", code: "e2ee_unavailable" }
        ]) expect(parseServerMessage(message(operation)).operation).toEqual(operation);
        expect(() => parseServerMessage(message({ type: "closed", session_id: "s", reason: "unknown" }))).toThrow();
    });

    test("directory results are bounded, exact and duplicate-free; client updates are forbidden", () => {
        for (const publisher_ids of [Array.from({ length: 65 }, (_, index) => `p${index}`), ["p", "p"], ["bad/id"], [123]]) {
            expect(() => parseServerMessage(message({ type: "directory", room_id: "room", publisher_ids }))).toThrow();
        }
        expect(() => parseClientMessage(message({ type: "directory", room_id: "room", publisher_ids: ["fabricated"] }))).toThrow();
    });
});
