//! DASS account and legacy-invite credentials, independent of Discord.
//! Rooms are discovery context only: authentication is service-wide and stream
//! admission belongs to publisher approval, never to stored room grants,
//! administrator flags or client network addresses. No secret-bearing Debug.

use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::File, io::Read, path::Path};

pub const MAX_INVITE_FILE_BYTES: usize = 131_072;
pub const MAX_USERS_FILE_BYTES: usize = 131_072;
pub const MAX_INVITES: usize = 256;
pub const MAX_USERS: usize = 256;
pub const MAX_ACCOUNT_PASSWORD_BYTES: usize = dass_protocol::signaling::MAX_LOGIN_PASSWORD_BYTES;
pub const MIN_ACCOUNT_PASSWORD_BYTES: usize = 12;
const MAX_DISPLAY_NAME_BYTES: usize = dass_protocol::signaling::MAX_PUBLISHER_DISPLAY_NAME_BYTES;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invite {
    pub invite_id: String,
    pub password_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteFile {
    pub version: u16,
    pub invites: Vec<Invite>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct User {
    pub username: String,
    pub password_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UsersFile {
    pub version: u16,
    pub users: Vec<User>,
}

#[derive(Default)]
pub struct InviteStore {
    // Accounts share the authentication identity map so display names work
    // identically. This set keeps account hashes out of the legacy invitation
    // credential verifier.
    invites: HashMap<String, Invite>,
    account_ids: std::collections::HashSet<String>,
}

pub fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn valid_display_name(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_DISPLAY_NAME_BYTES
        && !value.chars().any(char::is_control)
}

pub fn validate_account_password(password: &str) -> Result<(), &'static str> {
    if !(MIN_ACCOUNT_PASSWORD_BYTES..=MAX_ACCOUNT_PASSWORD_BYTES).contains(&password.len()) {
        return Err("Password must contain 12–512 UTF-8 bytes.");
    }
    if password.chars().any(char::is_control) {
        return Err("Password must not contain control characters.");
    }
    Ok(())
}

pub fn validate_user_fields(
    username: &str,
    display_name: Option<&str>,
) -> Result<(), &'static str> {
    if !valid_identifier(username) {
        return Err("Username must contain 1–64 ASCII letters, digits, underscores or hyphens.");
    }
    if display_name.is_some_and(|name| !valid_display_name(name)) {
        return Err(
            "Display name must contain 1–128 UTF-8 bytes, non-whitespace text and no control characters.",
        );
    }
    Ok(())
}

fn hasher() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19_456, 2, 1, Some(32)).expect("fixed Argon2 parameters"),
    )
}

pub(crate) fn validated_hash(value: &str) -> Result<PasswordHash, &'static str> {
    // Verify cost parameters BEFORE invoking the verifier (it uses stored parameters).
    if value.len() > 256 {
        return Err("invalid invite hash");
    }
    let hash = PasswordHash::new(value).map_err(|_| "invalid invite hash")?;
    let params = Params::try_from(&hash).map_err(|_| "invalid invite hash")?;
    if hash.algorithm.as_str() != "argon2id"
        || hash.version != Some(19)
        || params.m_cost() != 19_456
        || params.t_cost() != 2
        || params.p_cost() != 1
        || !params.data().is_empty()
        || !params.keyid().is_empty()
        || hash
            .salt
            .as_ref()
            .is_none_or(|salt| salt.as_ref().len() != 16)
        || hash
            .hash
            .as_ref()
            .is_none_or(|output| output.as_ref().len() != 32)
    {
        return Err("invalid invite hash");
    }
    Ok(hash)
}

impl InviteStore {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_INVITE_FILE_BYTES {
            return Err("invite file too large");
        }
        let file: InviteFile = serde_json::from_slice(bytes).map_err(|_| "invalid invite file")?;
        // Version 2 removes room grants, expiration and revocation fields;
        // legacy files fail closed rather than silently widening access.
        if file.version != 2 || file.invites.len() > MAX_INVITES {
            return Err("invalid invite file");
        }
        let mut invites = HashMap::new();
        for invite in file.invites {
            if !valid_identifier(&invite.invite_id)
                || invite
                    .display_name
                    .as_deref()
                    .is_some_and(|name| !valid_display_name(name))
            {
                return Err("invalid invite record");
            }
            validated_hash(&invite.password_hash)?;
            if invites.insert(invite.invite_id.clone(), invite).is_some() {
                return Err("duplicate invite ID");
            }
        }
        Ok(Self {
            invites,
            account_ids: Default::default(),
        })
    }

    /// Parse bounded, versioned account data from DASS_USERS.
    pub fn from_users_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_USERS_FILE_BYTES {
            return Err("DASS_USERS is too large");
        }
        let file: UsersFile = serde_json::from_slice(bytes).map_err(|_| "invalid DASS_USERS")?;
        if file.version != 2 || file.users.len() > MAX_USERS {
            return Err("invalid DASS_USERS");
        }
        let mut invites = HashMap::new();
        let mut account_ids = std::collections::HashSet::new();
        for user in file.users {
            if !valid_identifier(&user.username)
                || user
                    .display_name
                    .as_deref()
                    .is_some_and(|name| !valid_display_name(name))
            {
                return Err("invalid DASS_USERS record");
            }
            validated_hash(&user.password_hash)?;
            let username = user.username;
            if !account_ids.insert(username.clone()) {
                return Err("duplicate DASS username");
            }
            invites.insert(
                username.clone(),
                Invite {
                    invite_id: username,
                    password_hash: user.password_hash,
                    display_name: user.display_name,
                },
            );
        }
        Ok(Self {
            invites,
            account_ids,
        })
    }

    pub fn load(path: &Path) -> Result<Self, &'static str> {
        let mut bytes = Vec::new();
        File::open(path)
            .map_err(|_| "cannot open invite file")?
            .take((MAX_INVITE_FILE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "cannot read invite file")?;
        Self::from_bytes(&bytes)
    }

    pub fn verify(&self, credential: &str) -> Result<String, &'static str> {
        let (invite_id, secret) = credential.split_once('.').ok_or("unauthorized")?;
        if !valid_identifier(invite_id)
            || self.account_ids.contains(invite_id)
            || secret.len() != 64
            || !secret
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err("unauthorized");
        }
        let invite = self.invites.get(invite_id).ok_or("unauthorized")?;
        let hash = validated_hash(&invite.password_hash).map_err(|_| "unauthorized")?;
        hasher()
            .verify_password(secret.as_bytes(), &hash)
            .map_err(|_| "unauthorized")?;
        Ok(invite_id.to_owned())
    }

    /// Verify an account login and return the account identity. There are no
    /// per-room credentials: stream admission is decided by publishers.
    pub fn verify_account(&self, username: &str, password: &str) -> Result<String, &'static str> {
        if !valid_identifier(username)
            || password.is_empty()
            || password.len() > MAX_ACCOUNT_PASSWORD_BYTES
            || password.contains('\0')
            || !self.account_ids.contains(username)
        {
            return Err("unauthorized");
        }
        let account = self.invites.get(username).ok_or("unauthorized")?;
        let hash = validated_hash(&account.password_hash).map_err(|_| "unauthorized")?;
        hasher()
            .verify_password(password.as_bytes(), &hash)
            .map_err(|_| "unauthorized")?;
        Ok(username.to_owned())
    }

    /// The identity exists and its credentials are current. Authentication is
    /// service-wide; no room or role check exists at this layer.
    pub fn current(&self, invite_id: &str) -> Option<&Invite> {
        self.invites.get(invite_id)
    }

    /// Stable operator-facing label for pending-request prompts; falls back to
    /// the account identifier, never to untrusted session data.
    pub fn display_name(&self, invite_id: &str) -> String {
        self.current(invite_id)
            .and_then(|invite| invite.display_name.clone())
            .unwrap_or_else(|| invite_id.to_owned())
    }
}

pub fn random_identifier() -> Result<String, &'static str> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "random source unavailable")?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut identifier = String::with_capacity(64);
    for byte in bytes {
        identifier.push(char::from(HEX[usize::from(byte >> 4)]));
        identifier.push(char::from(HEX[usize::from(byte & 15)]));
    }
    Ok(identifier)
}

/// Admin-only creation: caller delivers the returned credential out of band.
pub fn create_invite(invite_id: String) -> Result<(Invite, String), &'static str> {
    create_invite_with_display_name(invite_id, None)
}

/// Admin-only creation with an optional credential-bound publisher display name.
pub fn create_invite_with_display_name(
    invite_id: String,
    display_name: Option<String>,
) -> Result<(Invite, String), &'static str> {
    if display_name
        .as_deref()
        .is_some_and(|name| !valid_display_name(name))
    {
        return Err("invalid invite record");
    }
    let secret = random_identifier()?;
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|_| "random source unavailable")?;
    let password_hash = hasher()
        .hash_password_with_salt(secret.as_bytes(), &salt)
        .map_err(|_| "credential hashing failed")?
        .to_string();
    let credential = format!("{invite_id}.{secret}");
    let invite = Invite {
        invite_id,
        password_hash,
        display_name,
    };
    let bytes = serde_json::to_vec(&InviteFile {
        version: 2,
        invites: vec![invite.clone()],
    })
    .map_err(|_| "invalid invite record")?;
    InviteStore::from_bytes(&bytes)?;
    Ok((invite, credential))
}

/// Admin-only account creation. Passwords are accepted only in memory and never returned.
pub fn create_user(
    username: String,
    password: &str,
    display_name: Option<String>,
) -> Result<User, &'static str> {
    validate_account_password(password)?;
    validate_user_fields(&username, display_name.as_deref())?;
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|_| "random source unavailable")?;
    let password_hash = hasher()
        .hash_password_with_salt(password.as_bytes(), &salt)
        .map_err(|_| "credential hashing failed")?
        .to_string();
    let user = User {
        username,
        password_hash,
        display_name,
    };
    let bytes = serde_json::to_vec(&UsersFile {
        version: 2,
        users: vec![user.clone()],
    })
    .map_err(|_| "invalid DASS user record")?;
    InviteStore::from_users_bytes(&bytes)?;
    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (InviteStore, String, Invite) {
        let (invite, credential) = create_invite("invite_1".into()).unwrap();
        let store = InviteStore {
            invites: HashMap::from([(invite.invite_id.clone(), invite.clone())]),
            account_ids: Default::default(),
        };
        (store, credential, invite)
    }

    fn sample_user_store() -> (InviteStore, User) {
        let user = create_user(
            "alice".into(),
            "correct horse battery staple",
            Some("Alice Studio".into()),
        )
        .unwrap();
        let bytes = serde_json::to_vec(&UsersFile {
            version: 2,
            users: vec![user.clone()],
        })
        .unwrap();
        (InviteStore::from_users_bytes(&bytes).unwrap(), user)
    }

    #[test]
    fn verifies_only_dass_credentials_without_room_authority() {
        let (store, credential, _) = sample();
        assert_eq!(store.verify(&credential).unwrap(), "invite_1");
        assert!(
            store
                .verify(&format!("invite_1.{}", "0".repeat(64)))
                .is_err()
        );
        assert!(store.verify("discord-token").is_err());
        assert!(
            store
                .verify_account("invite_1", "correct horse battery staple")
                .is_err()
        );
        // Authentication is service-wide: any opaque room ID groups discovery.
        assert!(store.current("invite_1").is_some());
        assert!(store.current("unknown").is_none());
    }

    #[test]
    fn legacy_grant_and_login_control_fields_fail_closed() {
        // Version-1 records carried room grants, scheduled expiration,
        // revocation flags and login IP allowlists. Loading them must fail
        // closed rather than silently widening or narrowing access.
        let legacy_user = serde_json::json!({
            "username": "alice",
            "password_hash": create_user("alice".into(), "correct horse battery staple", None)
                .unwrap()
                .password_hash,
            "expires_at_unix_seconds": u32::MAX,
            "revoked": false,
            "rooms": [{"room_id": "*", "access": true, "publish": true, "subscribe": true}],
            "allowed_ips": ["192.168.1.20"]
        });
        for file in [
            serde_json::json!({"version": 1, "users": [legacy_user]}),
            serde_json::json!({"version": 2, "users": [legacy_user]}),
        ] {
            let bytes = serde_json::to_vec(&file).unwrap();
            assert!(InviteStore::from_users_bytes(&bytes).is_err());
        }
        let (_, _, invite) = sample();
        let mut legacy_invite = serde_json::to_value(&invite).unwrap();
        legacy_invite["rooms"] = serde_json::json!([]);
        legacy_invite["expires_at_unix_seconds"] = serde_json::json!(u32::MAX);
        for version in [1, 2] {
            let file = serde_json::json!({"version": version, "invites": [legacy_invite]});
            assert!(InviteStore::from_bytes(&serde_json::to_vec(&file).unwrap()).is_err());
        }
    }

    #[test]
    fn dangerous_hash_costs_fail_closed() {
        let (store, credential, invite) = sample();
        assert!(store.verify(&credential).is_ok());
        assert!(validated_hash(&invite.password_hash.replace("m=19456", "m=4294967295")).is_err());
    }

    #[test]
    fn invite_file_rejects_duplicates_unknown_fields_and_oversize() {
        let (_, _, invite) = sample();
        let bytes = serde_json::to_vec(&InviteFile {
            version: 2,
            invites: vec![invite.clone(), invite],
        })
        .unwrap();
        assert!(InviteStore::from_bytes(&bytes).is_err());
        assert!(
            InviteStore::from_bytes(br#"{"version":2,"invites":[],"discord_user_id":"123"}"#)
                .is_err()
        );
        assert!(InviteStore::from_bytes(&vec![b' '; MAX_INVITE_FILE_BYTES + 1]).is_err());
    }

    #[test]
    fn account_login_uses_bounded_credentials_and_display_names() {
        let (store, user) = sample_user_store();
        assert_eq!(
            store
                .verify_account("alice", "correct horse battery staple")
                .unwrap(),
            "alice"
        );
        assert!(store.verify_account("alice", "wrong password").is_err());
        assert!(
            store
                .verify_account("alice", &"x".repeat(MAX_ACCOUNT_PASSWORD_BYTES + 1))
                .is_err()
        );
        assert!(store.verify_account("alice", "bad\0password").is_err());
        assert!(store.verify(&format!("alice.{}", "0".repeat(64))).is_err());
        assert_eq!(store.display_name("alice"), "Alice Studio");
        assert_eq!(store.display_name("unknown"), "unknown");
        assert!(validated_hash(&user.password_hash.replace("m=19456", "m=4294967295")).is_err());
    }

    #[test]
    fn users_file_is_versioned_bounded_strict_and_rejects_duplicate_identities() {
        let (_, user) = sample_user_store();
        let duplicate = serde_json::to_vec(&UsersFile {
            version: 2,
            users: vec![user.clone(), user.clone()],
        })
        .unwrap();
        assert!(InviteStore::from_users_bytes(&duplicate).is_err());
        assert!(
            InviteStore::from_users_bytes(br#"{"version":2,"users":[],"discord_user_id":"123"}"#)
                .is_err()
        );
        assert!(InviteStore::from_users_bytes(&vec![b' '; MAX_USERS_FILE_BYTES + 1]).is_err());

        let mut invalid_hash = serde_json::to_value(UsersFile {
            version: 2,
            users: vec![user],
        })
        .unwrap();
        invalid_hash["users"][0]["password_hash"] = "not-an-argon-hash".into();
        assert!(
            InviteStore::from_users_bytes(&serde_json::to_vec(&invalid_hash).unwrap()).is_err()
        );
        invalid_hash["users"][0]["password_hash"] = "valid hash stays private".into();
        invalid_hash["users"][0]["unexpected"] = true.into();
        assert!(
            InviteStore::from_users_bytes(&serde_json::to_vec(&invalid_hash).unwrap()).is_err()
        );
    }

    #[test]
    fn admin_user_creation_enforces_the_password_policy_and_account_bounds() {
        for password in ["short", "has\ncontrol\ncharacters", &"x".repeat(513)] {
            assert!(create_user("alice".into(), password, None).is_err());
        }
        assert!(create_user("alice/name".into(), "correct horse battery staple", None).is_err());
    }

    #[test]
    fn display_names_are_optional_admin_metadata_and_bounded() {
        let (named, _) =
            create_invite_with_display_name("named".into(), Some("Studio display 🖥️".into()))
                .unwrap();
        let encoded = serde_json::to_vec(&InviteFile {
            version: 2,
            invites: vec![named],
        })
        .unwrap();
        assert_eq!(
            InviteStore::from_bytes(&encoded)
                .unwrap()
                .current("named")
                .unwrap()
                .display_name
                .as_deref(),
            Some("Studio display 🖥️")
        );

        let (unnamed, _) = create_invite("legacy".into()).unwrap();
        let mut legacy = serde_json::to_value(InviteFile {
            version: 2,
            invites: vec![unnamed],
        })
        .unwrap();
        legacy["invites"][0]
            .as_object_mut()
            .unwrap()
            .remove("display_name");
        let parsed = InviteStore::from_bytes(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(parsed.current("legacy").unwrap().display_name, None);

        for name in [
            "   ".to_owned(),
            "line\nbreak".to_owned(),
            "x".repeat(MAX_DISPLAY_NAME_BYTES + 1),
        ] {
            assert!(create_invite_with_display_name("invalid".into(), Some(name)).is_err());
        }
    }
}
