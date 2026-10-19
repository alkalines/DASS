//! Versioned authenticated control-plane contract, including experimental RTC negotiation.
//! Identifiers are opaque DASS identifiers, never Discord authorization claims.
//! Stream admission is publisher-controlled: approval request and decision IDs are
//! server-generated, single-use and scoped to one stream instance and viewer account.

use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 16_384;
pub const MAX_SESSIONS: usize = 128;
pub const MAX_ROOM_MEMBERS: usize = 16;
pub const MAX_QUEUED_MESSAGES: usize = 32;
pub const LOGIN_DEADLINE_MS: usize = 5_000;
pub const SETUP_DEADLINE_MS: usize = 15_000;
pub const MAX_DIRECTORY_SHARES: usize = 64;
pub const MAX_PUBLISHER_DISPLAY_NAME_BYTES: usize = 128;
pub const MAX_LOGIN_PASSWORD_BYTES: usize = 512;
/// Pending view requests expire without a publisher decision; offline or silent
/// publishers never admit a viewer.
pub const VIEW_REQUEST_TIMEOUT_SECONDS: u32 = 60;
pub const SESSION_LIFETIME_SECONDS: u32 = 600;
/// ECDH P-256 public identity keys and wrapped media-epoch keys cross the wire
/// as base64url text; the backend treats them as opaque bounded fields.
pub const MAX_IDENTITY_KEY_CHARS: usize = 256;
pub const MAX_KEY_RELAY_CHARS: usize = 4096;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientMessage {
    pub protocol_version: u16,
    pub request_id: String,
    pub operation: ClientOperation,
}

// Deliberately no Debug: login credentials and SDP must not enter logs.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientOperation {
    Login {
        credential: String,
    },
    AccountLogin {
        username: String,
        password: String,
    },
    Join {
        room_id: String,
        require_e2ee: bool,
    },
    Directory {
        room_id: String,
    },
    /// Publishing requires the publisher's E2EE identity key; a stream without
    /// an identity is refused rather than delivered as transport-only media.
    Publish {
        session_id: String,
        publisher_key: String,
    },
    EnableViewerPresence {
        session_id: String,
    },
    /// An authenticated viewer asks a specific live publisher for admission.
    /// The backend assigns the opaque pending request ID. `viewer_key` is the
    /// viewer's E2EE identity key, relayed to the publisher for its pinned
    /// membership decision; a request without one is refused.
    RequestView {
        session_id: String,
        publisher_id: String,
        viewer_key: String,
    },
    /// Only the authenticated publisher owner may decide. `request_id` is the
    /// server-generated pending ID from the `view_request` push, not the
    /// caller's message envelope ID.
    ViewDecision {
        session_id: String,
        request_id: String,
        decision: ViewDecisionKind,
    },
    /// Admission requires the approval ID from an approved `view_decision`.
    Subscribe {
        session_id: String,
        publisher_id: String,
        approval_id: String,
    },
    /// Publisher withdrawal: removes every viewer session of one account.
    RemoveViewer {
        session_id: String,
        viewer_id: String,
    },
    /// Publisher → approved-viewer relay of an opaque encrypted media-epoch key
    /// blob. The backend forwards the bounded ciphertext only to viewer sessions
    /// it recorded as approved for this stream; it never sees media keys.
    KeyRelay {
        session_id: String,
        viewer_id: String,
        blob: String,
    },
    Offer {
        session_id: String,
        sdp: String,
    },
    Ice {
        session_id: String,
        candidate: String,
    },
    Leave {
        session_id: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerMessage {
    pub protocol_version: u16,
    pub request_id: String,
    pub operation: ServerOperation,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublisherMetadata {
    pub publisher_id: String,
    pub display_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerPresenceChange {
    Joined,
    Left,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewDecisionKind {
    Approve,
    Deny,
    /// Deny now and refuse further requests from this account on this stream.
    Block,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ServerOperation {
    Authenticated {
        expires_at_unix_seconds: u32,
    },
    Joined {
        session_id: String,
    },
    Directory {
        room_id: String,
        publisher_ids: Vec<String>,
        publishers: Vec<PublisherMetadata>,
    },
    /// Direct response to `request_view`: the backend's pending request ID.
    /// The pushed `view_decision` for this viewer echoes the same ID.
    ViewRequestPending {
        session_id: String,
        request_id: String,
    },
    /// Pushed to the authenticated publisher when a viewer asks to watch.
    /// `request_id` inside the operation is the pending approval ID.
    /// `viewer_key` is the E2EE identity the publisher's client pins.
    ViewRequest {
        session_id: String,
        request_id: String,
        viewer_id: String,
        viewer_display_name: String,
        viewer_key: String,
    },
    /// Pushed to the viewer when the publisher decides. `approval_id` is set
    /// only for an approval and is consumed by a single `subscribe`.
    /// `publisher_key` is the publisher's E2EE identity key on an approval so
    /// the viewer can pin it; it is empty on deny/block.
    /// `publisher_account` is the publisher's DASS account on an approval. It
    /// gives the viewer a stable identity scope for the pin, so a changed
    /// publisher key is detected across stream instances instead of being
    /// mistaken for a first contact.
    ViewDecision {
        session_id: String,
        request_id: String,
        decision: ViewDecisionKind,
        approval_id: String,
        publisher_key: String,
        publisher_account: String,
    },
    /// Relays an opaque publisher-encrypted media-epoch key blob to an approved
    /// viewer session. The backend enforces the route only; contents are E2EE.
    KeyRelay {
        session_id: String,
        publisher_id: String,
        blob: String,
    },
    /// Pushed to the publisher when a pending request expires or is withdrawn.
    ViewRequestClosed {
        session_id: String,
        request_id: String,
    },
    Accepted {
        session_id: String,
    },
    Answer {
        session_id: String,
        sdp: String,
    },
    Ice {
        session_id: String,
        candidate: String,
    },
    ViewerPresence {
        session_id: String,
        change: ViewerPresenceChange,
        viewer_count: u8,
    },
    Closed {
        session_id: String,
        reason: CloseReason,
    },
    Rejected {
        code: ErrorCode,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseReason {
    Left,
    Expired,
    Revoked,
    SetupTimeout,
    Overloaded,
    TransportFailed,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidMessage,
    UnsupportedVersion,
    Unauthorized,
    Replay,
    E2eeUnavailable,
    Overloaded,
    InvalidState,
    /// The publisher denied this view request or the viewer is blocked.
    Denied,
    TransportUnavailable,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_text(value: &str, maximum_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= maximum_bytes && !value.contains('\0')
}

/// Opaque base64url fields (identity keys, wrapped epoch keys): bounded text
/// without padding, decoded only by clients, never by the backend.
fn valid_opaque(value: &str, maximum_chars: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum_chars
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Fixed error: never exposes submitted credentials, SDP or identifiers.
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidMessage;

pub fn parse_client_message(bytes: &[u8]) -> Result<ClientMessage, InvalidMessage> {
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(InvalidMessage);
    }
    let message: ClientMessage = serde_json::from_slice(bytes).map_err(|_| InvalidMessage)?;
    if !message.is_valid() {
        return Err(InvalidMessage);
    }
    Ok(message)
}

impl ClientMessage {
    /// Structural validation only; authorization and replay protection are server duties.
    pub fn is_valid(&self) -> bool {
        if self.protocol_version != crate::PROTOCOL_VERSION || !valid_id(&self.request_id) {
            return false;
        }
        match &self.operation {
            ClientOperation::Login { credential } => valid_text(credential, 512),
            ClientOperation::AccountLogin { username, password } => {
                valid_id(username) && valid_text(password, MAX_LOGIN_PASSWORD_BYTES)
            }
            ClientOperation::Join { room_id, .. } | ClientOperation::Directory { room_id } => {
                valid_id(room_id)
            }
            ClientOperation::EnableViewerPresence { session_id }
            | ClientOperation::Leave { session_id } => valid_id(session_id),
            ClientOperation::Publish {
                session_id,
                publisher_key,
            } => valid_id(session_id) && valid_opaque(publisher_key, MAX_IDENTITY_KEY_CHARS),
            ClientOperation::KeyRelay {
                session_id,
                viewer_id,
                blob,
            } => {
                valid_id(session_id)
                    && valid_id(viewer_id)
                    && valid_opaque(blob, MAX_KEY_RELAY_CHARS)
            }
            ClientOperation::RemoveViewer {
                session_id,
                viewer_id,
            } => valid_id(session_id) && valid_id(viewer_id),
            ClientOperation::ViewDecision {
                session_id,
                request_id,
                ..
            } => valid_id(session_id) && valid_id(request_id),
            ClientOperation::RequestView {
                session_id,
                publisher_id,
                viewer_key,
            } => {
                valid_id(session_id)
                    && valid_id(publisher_id)
                    && valid_opaque(viewer_key, MAX_IDENTITY_KEY_CHARS)
            }
            ClientOperation::Subscribe {
                session_id,
                publisher_id,
                approval_id,
            } => valid_id(session_id) && valid_id(publisher_id) && valid_id(approval_id),
            ClientOperation::Offer { session_id, sdp } => {
                valid_id(session_id) && valid_text(sdp, 12_288)
            }
            ClientOperation::Ice {
                session_id,
                candidate,
            } => valid_id(session_id) && valid_text(candidate, 2_048),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_messages_reject_unknown_fields_and_versions() {
        let json = r#"{"protocol_version":1,"request_id":"r1","operation":{"type":"join","room_id":"room_1","require_e2ee":true}}"#;
        let message: ClientMessage = serde_json::from_str(json).unwrap();
        assert!(message.is_valid());
        assert!(
            serde_json::from_str::<ClientMessage>(
                &json.replace("\"room_id\"", "\"discord_channel_id\":\"123\",\"room_id\"")
            )
            .is_err()
        );
        let message: ClientMessage =
            serde_json::from_str(&json.replace("\"protocol_version\":1", "\"protocol_version\":2"))
                .unwrap();
        assert!(!message.is_valid());
    }

    #[test]
    fn identifiers_and_payloads_are_bounded() {
        assert!(valid_id("room_1-x"));
        for invalid in ["", "discord/channel", "é", &"x".repeat(65)] {
            assert!(!valid_id(invalid));
        }
        assert!(!valid_text("", 512));
        assert!(!valid_text("secret\0", 512));
        assert!(!valid_text(&"é".repeat(257), 512));
    }

    #[test]
    fn account_login_is_bounded_without_replacing_invite_login() {
        let account_login = ClientMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "login_1".into(),
            operation: ClientOperation::AccountLogin {
                username: "alice_1".into(),
                password: "correct horse battery staple".into(),
            },
        };
        assert!(account_login.is_valid());
        let too_long_password = ClientMessage {
            operation: ClientOperation::AccountLogin {
                username: "alice_1".into(),
                password: "é".repeat(MAX_LOGIN_PASSWORD_BYTES / 2 + 1),
            },
            ..account_login
        };
        assert!(!too_long_password.is_valid());
        for username in ["", "invalid/name", &"x".repeat(65)] {
            let invalid_username = ClientMessage {
                protocol_version: crate::PROTOCOL_VERSION,
                request_id: "login_1".into(),
                operation: ClientOperation::AccountLogin {
                    username: username.into(),
                    password: "correct horse battery staple".into(),
                },
            };
            assert!(!invalid_username.is_valid());
        }
        let invalid_password = ClientMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "login_1".into(),
            operation: ClientOperation::AccountLogin {
                username: "alice_1".into(),
                password: "bad\0password".into(),
            },
        };
        assert!(!invalid_password.is_valid());
    }

    #[test]
    fn approval_operations_require_valid_bounded_identifiers() {
        for operation in [
            ClientOperation::RequestView {
                session_id: "viewer_session".into(),
                publisher_id: "publisher_session".into(),
                viewer_key: "aXYtcHVibGljLWtleQ".into(),
            },
            ClientOperation::ViewDecision {
                session_id: "publisher_session".into(),
                request_id: "approval".into(),
                decision: ViewDecisionKind::Approve,
            },
            ClientOperation::Subscribe {
                session_id: "viewer_session".into(),
                publisher_id: "publisher_session".into(),
                approval_id: "approval".into(),
            },
            ClientOperation::RemoveViewer {
                session_id: "publisher_session".into(),
                viewer_id: "alice".into(),
            },
            ClientOperation::KeyRelay {
                session_id: "publisher_session".into(),
                viewer_id: "alice".into(),
                blob: "ZW5jcnlwdGVkLWVwb2NoLWtleQ".into(),
            },
            ClientOperation::Publish {
                session_id: "publisher_session".into(),
                publisher_key: "cHVibGlzaGVyLWtleQ".into(),
            },
        ] {
            let message = ClientMessage {
                protocol_version: crate::PROTOCOL_VERSION,
                request_id: "r".into(),
                operation,
            };
            assert!(message.is_valid());
        }
        for (field, invalid) in [
            ("session", "discord/channel"),
            ("session", ""),
            ("session", &"x".repeat(65)),
        ] {
            assert!(!valid_id(invalid), "{field}");
        }
        let missing_approval = ClientMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "r".into(),
            operation: ClientOperation::Subscribe {
                session_id: "viewer_session".into(),
                publisher_id: "publisher_session".into(),
                approval_id: "not/an/approval".into(),
            },
        };
        assert!(!missing_approval.is_valid());
    }

    #[test]
    fn parser_rejects_oversized_and_malformed_messages_without_details() {
        for bytes in [b"{".to_vec(), vec![b' '; MAX_MESSAGE_BYTES + 1]] {
            assert!(matches!(parse_client_message(&bytes), Err(InvalidMessage)));
        }
    }

    #[test]
    fn e2ee_fields_are_opaque_bounded_and_required() {
        // Identity keys and wrapped keys need non-empty bounded base64url text.
        for invalid in [
            "",
            "has+plu/slashes=",
            &"x".repeat(MAX_IDENTITY_KEY_CHARS + 1),
        ] {
            let message = ClientMessage {
                protocol_version: crate::PROTOCOL_VERSION,
                request_id: "r".into(),
                operation: ClientOperation::RequestView {
                    session_id: "viewer_session".into(),
                    publisher_id: "publisher_session".into(),
                    viewer_key: invalid.into(),
                },
            };
            assert!(!message.is_valid());
        }
        let relay = ClientMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "r".into(),
            operation: ClientOperation::KeyRelay {
                session_id: "publisher_session".into(),
                viewer_id: "alice".into(),
                blob: "x".repeat(MAX_KEY_RELAY_CHARS + 1),
            },
        };
        assert!(!relay.is_valid());
        let publish = ClientMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "r".into(),
            operation: ClientOperation::Publish {
                session_id: "publisher_session".into(),
                publisher_key: "".into(),
            },
        };
        assert!(!publish.is_valid());
    }

    #[test]
    fn pushed_view_operations_are_bounded_server_notifications() {
        let request = serde_json::to_value(ServerMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "server_view_request".into(),
            operation: ServerOperation::ViewRequest {
                session_id: "publisher_session".into(),
                request_id: "pending_1".into(),
                viewer_id: "alice".into(),
                viewer_display_name: "Alice".into(),
                viewer_key: "aXYtcHVibGljLWtleQ".into(),
            },
        })
        .unwrap();
        assert_eq!(
            request,
            serde_json::json!({
                "protocol_version": 1,
                "request_id": "server_view_request",
                "operation": {
                    "type": "view_request",
                    "session_id": "publisher_session",
                    "request_id": "pending_1",
                    "viewer_id": "alice",
                    "viewer_display_name": "Alice",
                    "viewer_key": "aXYtcHVibGljLWtleQ"
                }
            })
        );
        let decision = serde_json::to_value(ServerOperation::ViewDecision {
            session_id: "viewer_session".into(),
            request_id: "pending_1".into(),
            decision: ViewDecisionKind::Approve,
            approval_id: "approval_1".into(),
            publisher_key: "cHVibGlzaGVyLWtleQ".into(),
            publisher_account: "publisher_account".into(),
        })
        .unwrap();
        assert_eq!(decision["type"], "view_decision");
        assert_eq!(decision["decision"], "approve");
        assert_eq!(decision["publisher_key"], "cHVibGlzaGVyLWtleQ");
        assert_eq!(decision["publisher_account"], "publisher_account");
        let relay = serde_json::to_value(ServerOperation::KeyRelay {
            session_id: "viewer_session".into(),
            publisher_id: "publisher_session".into(),
            blob: "ZW5jcnlwdGVk".into(),
        })
        .unwrap();
        assert_eq!(relay["type"], "key_relay");
        assert_eq!(relay["publisher_id"], "publisher_session");
    }

    #[test]
    fn viewer_presence_is_a_server_notification_scoped_to_a_publisher_session() {
        let joined = serde_json::to_value(ServerMessage {
            protocol_version: crate::PROTOCOL_VERSION,
            request_id: "server_viewer_presence".into(),
            operation: ServerOperation::ViewerPresence {
                session_id: "publisher_session".into(),
                change: ViewerPresenceChange::Joined,
                viewer_count: 1,
            },
        })
        .unwrap();
        assert_eq!(
            joined,
            serde_json::json!({
                "protocol_version": 1,
                "request_id": "server_viewer_presence",
                "operation": {
                    "type": "viewer_presence",
                    "session_id": "publisher_session",
                    "change": "joined",
                    "viewer_count": 1
                }
            })
        );
    }
}
