import { type ClientMessage, MAX_DIRECTORY_SHARES, MAX_IDENTITY_KEY_CHARS, MAX_KEY_RELAY_CHARS, MAX_LOGIN_PASSWORD_BYTES, MAX_MESSAGE_BYTES, MAX_PUBLISHER_DISPLAY_NAME_BYTES, MAX_ROOM_MEMBERS, PROTOCOL_VERSION, type ServerMessage } from "./signaling";

const pushedRequestIds = ["server_view_request", "server_view_decision", "server_view_request_closed", "server_viewer_presence", "server_key_relay"];

const encoder = new TextEncoder();
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const opaqueField = (maximumChars: number) => (value: unknown) => typeof value === "string"
    && value.length > 0 && value.length <= maximumChars && /^[A-Za-z0-9_-]+$/.test(value);
const identityKey = opaqueField(MAX_IDENTITY_KEY_CHARS);
const emptyOrIdentityKey = (value: unknown) => value === "" || identityKey(value);
const text = (maximumBytes: number) => (value: unknown) => typeof value === "string"
    && value.length > 0 && !value.includes("\0") && encoder.encode(value).byteLength <= maximumBytes;
const boolean = (value: unknown) => typeof value === "boolean";
const seconds = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
const viewerCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAX_ROOM_MEMBERS;
const member = (values: string[]) => (value: unknown) => typeof value === "string" && values.includes(value);
const displayName = (value: unknown) => typeof value === "string" && text(MAX_PUBLISHER_DISPLAY_NAME_BYTES)(value)
    && value.trim().length > 0 && ![...value].some(character => /\p{Cc}/u.test(character));

type Validator = (value: unknown) => boolean;
type Shape = Record<string, Validator>;
const clientShapes: Record<string, Shape> = {
    login: { credential: text(512) },
    account_login: { username: identifier, password: text(MAX_LOGIN_PASSWORD_BYTES) },
    join: { room_id: identifier, require_e2ee: boolean },
    directory: { room_id: identifier },
    publish: { session_id: identifier, publisher_key: identityKey },
    enable_viewer_presence: { session_id: identifier },
    request_view: { session_id: identifier, publisher_id: identifier, viewer_key: identityKey },
    view_decision: { session_id: identifier, request_id: identifier, decision: member(["approve", "deny", "block"]) },
    subscribe: { session_id: identifier, publisher_id: identifier, approval_id: identifier },
    remove_viewer: { session_id: identifier, viewer_id: identifier },
    key_relay: { session_id: identifier, viewer_id: identifier, blob: opaqueField(MAX_KEY_RELAY_CHARS) },
    offer: { session_id: identifier, sdp: text(12288) },
    ice: { session_id: identifier, candidate: text(2048) },
    leave: { session_id: identifier }
};
const serverShapes: Record<string, Shape> = {
    authenticated: { expires_at_unix_seconds: seconds },
    joined: { session_id: identifier },
    directory: { room_id: identifier, publisher_ids: value => Array.isArray(value) && value.length <= MAX_DIRECTORY_SHARES
        && value.every(identifier) && new Set(value).size === value.length,
    publishers: value => Array.isArray(value) && value.length <= MAX_DIRECTORY_SHARES
        && value.every(publisher => record(publisher) && exact(publisher, {
            publisher_id: identifier,
            display_name: displayName
        })) },
    view_request_pending: { session_id: identifier, request_id: identifier },
    view_request: { session_id: identifier, request_id: identifier, viewer_id: identifier,
        viewer_display_name: displayName, viewer_key: identityKey },
    view_decision: { session_id: identifier, request_id: identifier,
        decision: member(["approve", "deny", "block"]), approval_id: value => value === "" || identifier(value),
        publisher_key: emptyOrIdentityKey, publisher_account: value => value === "" || identifier(value) },
    view_request_closed: { session_id: identifier, request_id: identifier },
    key_relay: { session_id: identifier, publisher_id: identifier, blob: opaqueField(MAX_KEY_RELAY_CHARS) },
    accepted: { session_id: identifier },
    answer: { session_id: identifier, sdp: text(12288) },
    ice: { session_id: identifier, candidate: text(2048) },
    viewer_presence: { session_id: identifier, change: member(["joined", "left"]), viewer_count: viewerCount },
    closed: { session_id: identifier, reason: member(["left", "expired", "revoked", "setup_timeout", "overloaded", "transport_failed"]) },
    rejected: { code: member(["invalid_message", "unsupported_version", "unauthorized", "replay", "e2ee_unavailable", "overloaded", "invalid_state", "denied", "transport_unavailable"]) }
};

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, shape: Shape): boolean {
    return Object.keys(value).length === Object.keys(shape).length
        && Object.entries(shape).every(([key, validate]) => Object.hasOwn(value, key) && validate(value[key]));
}

function parse(message: string, shapes: Record<string, Shape>): unknown {
    // Check cheap code-unit bound before allocating an encoded copy.
    if (message.length > MAX_MESSAGE_BYTES || encoder.encode(message).byteLength > MAX_MESSAGE_BYTES) {
        throw new Error("Invalid DASS control message");
    }
    let value: unknown;
    try { value = JSON.parse(message); } catch { throw new Error("Invalid DASS control message"); }
    if (!record(value) || !exact(value, {
        protocol_version: version => version === PROTOCOL_VERSION,
        request_id: identifier,
        operation: operation => {
            if (!record(operation) || typeof operation.type !== "string" || !Object.hasOwn(shapes, operation.type)) return false;
            if (!exact(operation, { type: type => type === operation.type, ...shapes[operation.type] })) return false;
            if (shapes === serverShapes && operation.type === "directory") {
                const ids = operation.publisher_ids as string[];
                const publishers = operation.publishers as Array<{ publisher_id: string; display_name: string; }>;
                return ids.length === publishers.length
                    && ids.every((id, index) => id === publishers[index].publisher_id);
            }
            if (shapes === serverShapes && operation.type === "view_decision") {
                return operation.decision !== "approve"
                    || ((operation.approval_id as string).length > 0
                        && (operation.publisher_key as string).length > 0
                        && (operation.publisher_account as string).length > 0);
            }
            if (shapes === serverShapes && operation.type === "viewer_presence") {
                return operation.change !== "joined" || (operation.viewer_count as number) > 0;
            }
            return true;
        }
    })) throw new Error("Invalid DASS control message");
    return value;
}

// Validation never includes the original message in errors (credentials/SDP).
// These parsers confer no authorization and do not validate ICE destination safety.
export function parseClientMessage(message: string): ClientMessage {
    return parse(message, clientShapes) as ClientMessage;
}

export function parseServerMessage(message: string): ServerMessage {
    return parse(message, serverShapes) as ServerMessage;
}
