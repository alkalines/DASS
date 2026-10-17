import { describe, expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "../../crates/protocol/generated/validate";

const message = (operation: unknown, protocol_version = 1) => JSON.stringify({ protocol_version, request_id: "request_1", operation });

describe("proposed signaling protocol", () => {
    test("accepts each client operation", () => {
        for (const operation of [
            { type: "login", credential: "separate-dass-credential" },
            { type: "account_login", username: "alice_1", password: "correct horse battery staple" },
            { type: "join", room_id: "room_1", require_e2ee: true },
            { type: "directory", room_id: "room_1" },
            { type: "publish", session_id: "session_1" },
            { type: "enable_viewer_presence", session_id: "session_1" },
            { type: "request_view", session_id: "session_1", publisher_id: "publisher_1" },
            { type: "view_decision", session_id: "session_1", request_id: "pending_1", decision: "approve" },
            { type: "subscribe", session_id: "session_1", publisher_id: "publisher_1", approval_id: "approval_1" },
            { type: "remove_viewer", session_id: "session_1", viewer_id: "alice_1" },
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
            message({ type: "account_login", username: "alice/name", password: "correct horse battery staple" }),
            message({ type: "account_login", username: "alice", password: "" }),
            message({ type: "account_login", username: "alice", password: "bad\0password" }),
            message({ type: "account_login", username: "alice", password: "é".repeat(257) }),
            message({ type: "account_login", username: "alice", password: "correct horse battery staple", credential: "not allowed" }),
            message({ type: "login", credential: "separate-dass-credential", display_name: "client supplied" }),
            message({ type: "leave", session_id: "s" }, 2),
            message({ type: "subscribe", session_id: "s", publisher_id: "p" }),
            message({ type: "subscribe", session_id: "s", publisher_id: "p", approval_id: "not/an" }),
            message({ type: "view_decision", session_id: "s", request_id: "r", decision: "maybe" }),
            message({ type: "request_view", session_id: "s", publisher_id: "bad/id" }),
            message({ type: "remove_viewer", session_id: "s", viewer_id: "bad/id" }),
            message({ type: "view_decision", session_id: "s", request_id: "r", decision: "approve", approval_id: "forged" }),
            message({ type: "toString" }),
            message({ type: "offer", session_id: "s", sdp: "x".repeat(12289) })
        ]) expect(() => parseClientMessage(input)).toThrow("Invalid DASS control message");
    });

    test("parses server lifecycle and fail-closed E2EE rejection", () => {
        for (const operation of [
            { type: "authenticated", expires_at_unix_seconds: 1800000000 },
            { type: "joined", session_id: "s" },
            { type: "directory", room_id: "room_1", publisher_ids: ["source"], publishers: [{ publisher_id: "source", display_name: "Studio PC" }] },
            { type: "accepted", session_id: "s" },
            { type: "answer", session_id: "s", sdp: "v=0\r\n" },
            { type: "ice", session_id: "s", candidate: "candidate:example" },
            { type: "view_request_pending", session_id: "s", request_id: "pending_1" },
            { type: "view_request", session_id: "s", request_id: "pending_1", viewer_id: "alice", viewer_display_name: "Alice" },
            { type: "view_decision", session_id: "s", request_id: "pending_1", decision: "approve", approval_id: "approval_1" },
            { type: "view_decision", session_id: "s", request_id: "pending_1", decision: "deny", approval_id: "" },
            { type: "view_request_closed", session_id: "s", request_id: "pending_1" },
            { type: "viewer_presence", session_id: "publisher_session", change: "joined", viewer_count: 1 },
            { type: "viewer_presence", session_id: "publisher_session", change: "left", viewer_count: 0 },
            { type: "closed", session_id: "s", reason: "revoked" },
            { type: "rejected", code: "e2ee_unavailable" }
        ]) expect(parseServerMessage(message(operation)).operation).toEqual(operation);
        expect(() => parseServerMessage(message({ type: "closed", session_id: "s", reason: "unknown" }))).toThrow();
        for (const operation of [
            { type: "view_decision", session_id: "s", request_id: "r", decision: "approve", approval_id: "" },
            { type: "view_decision", session_id: "s", request_id: "r", decision: "maybe", approval_id: "a" },
            { type: "view_request", session_id: "s", request_id: "r", viewer_id: "bad/id", viewer_display_name: "A" },
            { type: "view_request", session_id: "s", request_id: "r", viewer_id: "a", viewer_display_name: "line\nbreak" },
            { type: "viewer_presence", session_id: "s", change: "connected", viewer_count: 1 },
            { type: "viewer_presence", session_id: "s", change: "joined", viewer_count: 0 },
            { type: "viewer_presence", session_id: "s", change: "left", viewer_count: -1 },
            { type: "viewer_presence", session_id: "s", change: "left", viewer_count: 16 },
            { type: "viewer_presence", session_id: "s", change: "left", viewer_count: 17 },
            { type: "viewer_presence", session_id: "s", change: "left", viewer_count: 0, viewer_id: "private" }
        ]) expect(() => parseServerMessage(message(operation))).toThrow();
    });

    test("directory IDs and publisher metadata are bounded, exact and matched; client updates are forbidden", () => {
        const tooManyIds = Array.from({ length: 65 }, (_, index) => `p${index}`);
        expect(() => parseServerMessage(message({ type: "directory", room_id: "room", publisher_ids: tooManyIds,
            publishers: tooManyIds.map(publisher_id => ({ publisher_id, display_name: "Studio PC" })) }))).toThrow();
        for (const publisher_ids of [Array.from({ length: 65 }, (_, index) => `p${index}`), ["p", "p"], ["bad/id"], [123]]) {
            expect(() => parseServerMessage(message({ type: "directory", room_id: "room", publisher_ids, publishers: [] }))).toThrow();
        }
        for (const publishers of [
            [{ publisher_id: "other", display_name: "Studio PC" }],
            [{ publisher_id: "source", display_name: "" }],
            [{ publisher_id: "source", display_name: "line\nbreak" }],
            [{ publisher_id: "source", display_name: "x".repeat(129) }],
            [{ publisher_id: "source", display_name: "Studio PC", extra: true }]
        ]) {
            expect(() => parseServerMessage(message({ type: "directory", room_id: "room", publisher_ids: ["source"], publishers }))).toThrow();
        }
        expect(() => parseServerMessage(message({ type: "directory", room_id: "room", publisher_ids: ["source"] }))).toThrow();
        expect(() => parseClientMessage(message({ type: "directory", room_id: "room", publisher_ids: ["fabricated"], publishers: [] }))).toThrow();
    });
});
