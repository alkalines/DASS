//! Invite and account DASS credentials, independent of Discord. No secret-bearing Debug.

use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::Path,
};

pub const MAX_INVITE_FILE_BYTES: usize = 131_072;
pub const MAX_USERS_FILE_BYTES: usize = 131_072;
pub const MAX_INVITES: usize = 256;
pub const MAX_USERS: usize = 256;
pub const MAX_ACCOUNT_PASSWORD_BYTES: usize = dass_protocol::signaling::MAX_LOGIN_PASSWORD_BYTES;
pub const MIN_ACCOUNT_PASSWORD_BYTES: usize = 12;
const MAX_GRANTS: usize = 16;
const MAX_DISPLAY_NAME_BYTES: usize = dass_protocol::signaling::MAX_PUBLISHER_DISPLAY_NAME_BYTES;
const ALL_ROOMS_GRANT: &str = "*";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoomGrant {
    /// Exact room ID, or "*" for explicit backend-wide account access (not invites).
    pub room_id: String,
    pub access: bool,
    pub publish: bool,
    pub subscribe: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invite {
    pub invite_id: String,
    pub password_hash: String,
    pub expires_at_unix_seconds: u32,
    pub revoked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub rooms: Vec<RoomGrant>,
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
    pub expires_at_unix_seconds: u32,
    pub revoked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub rooms: Vec<RoomGrant>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UsersFile {
    pub version: u16,
    pub users: Vec<User>,
}

#[derive(Default)]
pub struct InviteStore {
    // Accounts share the authorization identity map so rooms, expiry, revocation
    // and display names work identically. This set keeps account hashes out of
    // the legacy invitation credential verifier.
    invites: HashMap<String, Invite>,
    account_ids: HashSet<String>,
}

#[derive(Clone, Copy)]
pub enum Permission {
    Access,
    Publish,
    Subscribe,
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

fn valid_room_grants(rooms: &[RoomGrant], allow_all_rooms: bool) -> bool {
    if rooms.len() > MAX_GRANTS {
        return false;
    }
    let mut unique_rooms = HashSet::new();
    rooms.iter().all(|grant| {
        (valid_identifier(&grant.room_id) || (allow_all_rooms && grant.room_id == ALL_ROOMS_GRANT))
            && unique_rooms.insert(&grant.room_id)
            && (grant.access || (!grant.publish && !grant.subscribe))
    })
}

fn valid_account_password(password: &str) -> bool {
    (MIN_ACCOUNT_PASSWORD_BYTES..=MAX_ACCOUNT_PASSWORD_BYTES).contains(&password.len())
        && !password.chars().any(char::is_control)
}

fn hasher() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19_456, 2, 1, Some(32)).expect("fixed Argon2 parameters"),
    )
}

fn validated_hash(value: &str) -> Result<PasswordHash, &'static str> {
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
        if file.version != 1 || file.invites.len() > MAX_INVITES {
            return Err("invalid invite file");
        }
        let mut invites = HashMap::new();
        for invite in file.invites {
            if !valid_identifier(&invite.invite_id)
                || invite.expires_at_unix_seconds == 0
                || invite
                    .display_name
                    .as_deref()
                    .is_some_and(|name| !valid_display_name(name))
                || !valid_room_grants(&invite.rooms, false)
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
            account_ids: HashSet::new(),
        })
    }

    /// Parse bounded, versioned account data from DASS_USERS.
    pub fn from_users_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() > MAX_USERS_FILE_BYTES {
            return Err("DASS_USERS is too large");
        }
        let file: UsersFile = serde_json::from_slice(bytes).map_err(|_| "invalid DASS_USERS")?;
        if file.version != 1 || file.users.len() > MAX_USERS {
            return Err("invalid DASS_USERS");
        }
        let mut invites = HashMap::new();
        let mut account_ids = HashSet::new();
        for user in file.users {
            if !valid_identifier(&user.username)
                || user.expires_at_unix_seconds == 0
                || user
                    .display_name
                    .as_deref()
                    .is_some_and(|name| !valid_display_name(name))
                || !valid_room_grants(&user.rooms, true)
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
                    expires_at_unix_seconds: user.expires_at_unix_seconds,
                    revoked: user.revoked,
                    display_name: user.display_name,
                    rooms: user.rooms,
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

    pub fn verify(&self, credential: &str, now_seconds: u32) -> Result<String, &'static str> {
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
        let invite = self.current(invite_id, now_seconds).ok_or("unauthorized")?;
        let hash = validated_hash(&invite.password_hash).map_err(|_| "unauthorized")?;
        hasher()
            .verify_password(secret.as_bytes(), &hash)
            .map_err(|_| "unauthorized")?;
        Ok(invite_id.to_owned())
    }

    /// Verify an account login and return the username used by room authorization.
    pub fn verify_account(
        &self,
        username: &str,
        password: &str,
        now_seconds: u32,
    ) -> Result<String, &'static str> {
        if !valid_identifier(username)
            || password.is_empty()
            || password.len() > MAX_ACCOUNT_PASSWORD_BYTES
            || password.contains('\0')
            || !self.account_ids.contains(username)
        {
            return Err("unauthorized");
        }
        let account = self.current(username, now_seconds).ok_or("unauthorized")?;
        let hash = validated_hash(&account.password_hash).map_err(|_| "unauthorized")?;
        hasher()
            .verify_password(password.as_bytes(), &hash)
            .map_err(|_| "unauthorized")?;
        Ok(username.to_owned())
    }

    pub fn current(&self, invite_id: &str, now_seconds: u32) -> Option<&Invite> {
        self.invites
            .get(invite_id)
            .filter(|invite| !invite.revoked && now_seconds < invite.expires_at_unix_seconds)
    }

    pub fn authorize(
        &self,
        invite_id: &str,
        room_id: &str,
        permission: Permission,
        now_seconds: u32,
    ) -> bool {
        if !valid_identifier(room_id) {
            return false;
        }
        self.current(invite_id, now_seconds).is_some_and(|invite| {
            invite.rooms.iter().any(|grant| {
                // TODO: Replace broad trusted-account access with authenticated,
                // call-scoped admission. A Discord channel ID is not membership proof.
                (grant.room_id == room_id
                    || (self.account_ids.contains(invite_id) && grant.room_id == ALL_ROOMS_GRANT))
                    && grant.access
                    && match permission {
                        Permission::Access => true,
                        Permission::Publish => grant.publish,
                        Permission::Subscribe => grant.subscribe,
                    }
            })
        })
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
pub fn create_invite(
    invite_id: String,
    rooms: Vec<RoomGrant>,
    expires_at_unix_seconds: u32,
) -> Result<(Invite, String), &'static str> {
    create_invite_with_display_name(invite_id, None, rooms, expires_at_unix_seconds)
}

/// Admin-only creation with an optional credential-bound publisher display name.
pub fn create_invite_with_display_name(
    invite_id: String,
    display_name: Option<String>,
    rooms: Vec<RoomGrant>,
    expires_at_unix_seconds: u32,
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
        expires_at_unix_seconds,
        revoked: false,
        display_name,
        rooms,
    };
    let bytes = serde_json::to_vec(&InviteFile {
        version: 1,
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
    rooms: Vec<RoomGrant>,
    expires_at_unix_seconds: u32,
) -> Result<User, &'static str> {
    if !valid_identifier(&username)
        || !valid_account_password(password)
        || expires_at_unix_seconds == 0
        || display_name
            .as_deref()
            .is_some_and(|name| !valid_display_name(name))
        || !valid_room_grants(&rooms, true)
    {
        return Err("invalid DASS user record");
    }
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|_| "random source unavailable")?;
    let password_hash = hasher()
        .hash_password_with_salt(password.as_bytes(), &salt)
        .map_err(|_| "credential hashing failed")?
        .to_string();
    let user = User {
        username,
        password_hash,
        expires_at_unix_seconds,
        revoked: false,
        display_name,
        rooms,
    };
    let bytes = serde_json::to_vec(&UsersFile {
        version: 1,
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
        let (invite, credential) = create_invite(
            "invite_1".into(),
            vec![RoomGrant {
                room_id: "room_1".into(),
                access: true,
                publish: true,
                subscribe: false,
            }],
            100,
        )
        .unwrap();
        let store = InviteStore {
            invites: HashMap::from([(invite.invite_id.clone(), invite.clone())]),
            account_ids: HashSet::new(),
        };
        (store, credential, invite)
    }

    fn sample_user_store() -> (InviteStore, User) {
        let user = create_user(
            "alice".into(),
            "correct horse battery staple",
            Some("Alice Studio".into()),
            vec![RoomGrant {
                room_id: "room_1".into(),
                access: true,
                publish: false,
                subscribe: true,
            }],
            100,
        )
        .unwrap();
        let bytes = serde_json::to_vec(&UsersFile {
            version: 1,
            users: vec![user.clone()],
        })
        .unwrap();
        (InviteStore::from_users_bytes(&bytes).unwrap(), user)
    }

    #[test]
    fn verifies_only_dass_credentials_and_scoped_permissions() {
        let (store, credential, _) = sample();
        assert_eq!(store.verify(&credential, 99).unwrap(), "invite_1");
        assert!(
            store
                .verify(&format!("invite_1.{}", "0".repeat(64)), 99)
                .is_err()
        );
        assert!(store.verify("discord-token", 99).is_err());
        assert!(
            store
                .verify_account("invite_1", "correct horse battery staple", 99)
                .is_err()
        );
        assert!(store.authorize("invite_1", "room_1", Permission::Access, 99));
        assert!(store.authorize("invite_1", "room_1", Permission::Publish, 99));
        assert!(!store.authorize("invite_1", "room_1", Permission::Subscribe, 99));
        assert!(!store.authorize("invite_1", "room_2", Permission::Publish, 99));
        assert!(!store.authorize("123", "room_1", Permission::Publish, 99));
    }

    #[test]
    fn expiry_revocation_and_dangerous_hash_costs_fail_closed() {
        let (mut store, credential, invite) = sample();
        assert!(store.verify(&credential, 100).is_err());
        assert!(!store.authorize("invite_1", "room_1", Permission::Access, 100));
        store.invites.get_mut("invite_1").unwrap().revoked = true;
        assert!(store.verify(&credential, 99).is_err());
        assert!(!store.authorize("invite_1", "room_1", Permission::Access, 99));
        assert!(validated_hash(&invite.password_hash.replace("m=19456", "m=4294967295")).is_err());
    }

    #[test]
    fn invite_file_rejects_duplicates_unknown_fields_and_oversize() {
        let (_, _, invite) = sample();
        let bytes = serde_json::to_vec(&InviteFile {
            version: 1,
            invites: vec![invite.clone(), invite],
        })
        .unwrap();
        assert!(InviteStore::from_bytes(&bytes).is_err());
        assert!(
            InviteStore::from_bytes(br#"{"version":1,"invites":[],"discord_user_id":"123"}"#)
                .is_err()
        );
        assert!(InviteStore::from_bytes(&vec![b' '; MAX_INVITE_FILE_BYTES + 1]).is_err());
    }

    #[test]
    fn all_rooms_account_grant_preserves_permissions_expiry_and_revocation() {
        let user = create_user(
            "alice".into(),
            "correct horse battery staple",
            None,
            vec![RoomGrant {
                room_id: ALL_ROOMS_GRANT.into(),
                access: true,
                publish: false,
                subscribe: true,
            }],
            100,
        )
        .unwrap();
        let bytes = serde_json::to_vec(&UsersFile {
            version: 1,
            users: vec![user],
        })
        .unwrap();
        let mut store = InviteStore::from_users_bytes(&bytes).unwrap();
        for room_id in ["room_1", "room_2", "123456789"] {
            assert!(store.authorize("alice", room_id, Permission::Access, 99));
            assert!(store.authorize("alice", room_id, Permission::Subscribe, 99));
            assert!(!store.authorize("alice", room_id, Permission::Publish, 99));
            assert!(!store.authorize("unknown", room_id, Permission::Access, 99));
            assert!(!store.authorize("alice", room_id, Permission::Access, 100));
        }
        for room_id in ["", "*", "room/*", "room/name", &"x".repeat(65)] {
            assert!(!store.authorize("alice", room_id, Permission::Access, 99));
        }
        store.invites.get_mut("alice").unwrap().revoked = true;
        assert!(!store.authorize("alice", "new_dm", Permission::Subscribe, 99));
    }

    #[test]
    fn wildcard_grants_are_explicit_account_only_and_not_glob_patterns() {
        let grant = |room_id: &str| RoomGrant {
            room_id: room_id.into(),
            access: true,
            publish: true,
            subscribe: false,
        };
        assert!(valid_room_grants(&[grant("*")], true));
        assert!(!valid_room_grants(&[grant("*")], false));
        assert!(!valid_room_grants(&[grant("*"), grant("*")], true));
        for pattern in ["room_*", "**", " *", "* "] {
            assert!(!valid_room_grants(&[grant(pattern)], true));
        }
        assert!(!valid_room_grants(
            &[RoomGrant {
                room_id: "*".into(),
                access: false,
                publish: true,
                subscribe: false,
            }],
            true,
        ));
        assert!(!valid_room_grants(
            &(0..=MAX_GRANTS)
                .map(|index| grant(&format!("room_{index}")))
                .collect::<Vec<_>>(),
            true,
        ));
        let (_, _, mut invite) = sample();
        invite.rooms = vec![grant("*")];
        let bytes = serde_json::to_vec(&InviteFile {
            version: 1,
            invites: vec![invite],
        })
        .unwrap();
        assert!(InviteStore::from_bytes(&bytes).is_err());
    }

    #[test]
    fn exact_and_all_rooms_grants_are_additive_not_deny_overrides() {
        let (mut store, _) = sample_user_store();
        store
            .invites
            .get_mut("alice")
            .unwrap()
            .rooms
            .push(RoomGrant {
                room_id: ALL_ROOMS_GRANT.into(),
                access: true,
                publish: true,
                subscribe: false,
            });
        assert!(store.authorize("alice", "room_1", Permission::Publish, 99));
        assert!(store.authorize("alice", "room_1", Permission::Subscribe, 99));
        assert!(store.authorize("alice", "new_dm", Permission::Publish, 99));
        assert!(!store.authorize("alice", "new_dm", Permission::Subscribe, 99));
        store.invites.get_mut("alice").unwrap().rooms = vec![RoomGrant {
            room_id: ALL_ROOMS_GRANT.into(),
            access: false,
            publish: false,
            subscribe: false,
        }];
        assert!(!store.authorize("alice", "new_dm", Permission::Access, 99));
    }

    #[test]
    fn account_login_shares_room_scope_metadata_expiry_and_revocation() {
        let (mut store, user) = sample_user_store();
        assert_eq!(
            store
                .verify_account("alice", "correct horse battery staple", 99)
                .unwrap(),
            "alice"
        );
        assert!(store.verify_account("alice", "wrong password", 99).is_err());
        assert!(
            store
                .verify_account("alice", &"x".repeat(MAX_ACCOUNT_PASSWORD_BYTES + 1), 99)
                .is_err()
        );
        assert!(store.verify_account("alice", "bad\0password", 99).is_err());
        assert!(
            store
                .verify(&format!("alice.{}", "0".repeat(64)), 99)
                .is_err()
        );
        assert!(store.authorize("alice", "room_1", Permission::Access, 99));
        assert!(store.authorize("alice", "room_1", Permission::Subscribe, 99));
        assert!(!store.authorize("alice", "room_1", Permission::Publish, 99));
        assert!(!store.authorize("alice", "room_2", Permission::Access, 99));
        assert_eq!(
            store.current("alice", 99).unwrap().display_name.as_deref(),
            Some("Alice Studio")
        );
        assert!(
            store
                .verify_account("alice", "correct horse battery staple", 100)
                .is_err()
        );
        store.invites.get_mut("alice").unwrap().revoked = true;
        assert!(
            store
                .verify_account("alice", "correct horse battery staple", 99)
                .is_err()
        );
        assert!(!store.authorize("alice", "room_1", Permission::Access, 99));
        assert!(validated_hash(&user.password_hash.replace("m=19456", "m=4294967295")).is_err());
    }

    #[test]
    fn users_file_is_versioned_bounded_strict_and_rejects_duplicate_identities() {
        let (_, user) = sample_user_store();
        let duplicate = serde_json::to_vec(&UsersFile {
            version: 1,
            users: vec![user.clone(), user.clone()],
        })
        .unwrap();
        assert!(InviteStore::from_users_bytes(&duplicate).is_err());
        assert!(
            InviteStore::from_users_bytes(br#"{"version":1,"users":[],"discord_user_id":"123"}"#)
                .is_err()
        );
        assert!(InviteStore::from_users_bytes(&vec![b' '; MAX_USERS_FILE_BYTES + 1]).is_err());

        let mut invalid_hash = serde_json::to_value(UsersFile {
            version: 1,
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
            assert!(create_user("alice".into(), password, None, vec![], 100).is_err());
        }
        assert!(
            create_user(
                "alice/name".into(),
                "correct horse battery staple",
                None,
                vec![],
                100
            )
            .is_err()
        );
        assert!(
            create_user(
                "alice".into(),
                "correct horse battery staple",
                None,
                vec![],
                0
            )
            .is_err()
        );
    }

    #[test]
    fn display_names_are_optional_admin_metadata_and_bounded() {
        let (named, _) = create_invite_with_display_name(
            "named".into(),
            Some("Studio display 🖥️".into()),
            vec![],
            100,
        )
        .unwrap();
        let encoded = serde_json::to_vec(&InviteFile {
            version: 1,
            invites: vec![named],
        })
        .unwrap();
        assert_eq!(
            InviteStore::from_bytes(&encoded)
                .unwrap()
                .current("named", 99)
                .unwrap()
                .display_name
                .as_deref(),
            Some("Studio display 🖥️")
        );

        let (unnamed, _) = create_invite("legacy".into(), vec![], 100).unwrap();
        let mut legacy = serde_json::to_value(InviteFile {
            version: 1,
            invites: vec![unnamed],
        })
        .unwrap();
        assert!(
            !legacy["invites"][0]
                .as_object()
                .unwrap()
                .contains_key("display_name")
        );
        legacy["invites"][0]
            .as_object_mut()
            .unwrap()
            .remove("display_name");
        let parsed = InviteStore::from_bytes(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(parsed.current("legacy", 99).unwrap().display_name, None);

        for name in [
            "   ".to_owned(),
            "line\nbreak".to_owned(),
            "x".repeat(MAX_DISPLAY_NAME_BYTES + 1),
        ] {
            assert!(
                create_invite_with_display_name("invalid".into(), Some(name), vec![], 100).is_err()
            );
        }
    }
}
