//! Versioned authenticated control-plane contract, including experimental RTC negotiation.
//! Identifiers are opaque DASS identifiers, never Discord authorization claims.

use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE_BYTES: usize = 16_384;
pub const MAX_SESSIONS: usize = 128;
pub const MAX_ROOM_MEMBERS: usize = 16;
pub const MAX_QUEUED_MESSAGES: usize = 32;
pub const LOGIN_DEADLINE_MS: usize = 5_000;
pub const SETUP_DEADLINE_MS: usize = 15_000;
pub const MAX_DIRECTORY_SHARES: usize = 64;

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
    Join {
        room_id: String,
        require_e2ee: bool,
    },
    Directory {
        room_id: String,
    },
    Publish {
        session_id: String,
    },
    Subscribe {
        session_id: String,
        publisher_id: String,
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidMessage,
    UnsupportedVersion,
    Unauthorized,
    Replay,
    E2eeUnavailable,
    Overloaded,
    InvalidState,
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
            ClientOperation::Join { room_id, .. } | ClientOperation::Directory { room_id } => {
                valid_id(room_id)
            }
            ClientOperation::Publish { session_id } | ClientOperation::Leave { session_id } => {
                valid_id(session_id)
            }
            ClientOperation::Subscribe {
                session_id,
                publisher_id,
            } => valid_id(session_id) && valid_id(publisher_id),
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
    fn parser_rejects_oversized_and_malformed_messages_without_details() {
        for bytes in [b"{".to_vec(), vec![b' '; MAX_MESSAGE_BYTES + 1]] {
            assert!(matches!(parse_client_message(&bytes), Err(InvalidMessage)));
        }
    }
}
