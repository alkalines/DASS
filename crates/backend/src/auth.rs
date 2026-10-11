//! Invite-only DASS credentials, independent of Discord. No secret-bearing Debug.

use argon2::{Algorithm, Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier, Version};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::File, io::Read, path::Path};

pub const MAX_INVITE_FILE_BYTES: usize = 131_072;
pub const MAX_INVITES: usize = 256;
const MAX_GRANTS: usize = 16;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoomGrant {
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
    pub rooms: Vec<RoomGrant>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteFile {
    pub version: u16,
    pub invites: Vec<Invite>,
}

#[derive(Default)]
pub struct InviteStore {
    invites: HashMap<String, Invite>,
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
                || invite.rooms.len() > MAX_GRANTS
                || invite.expires_at_unix_seconds == 0
            {
                return Err("invalid invite record");
            }
            validated_hash(&invite.password_hash)?;
            let mut rooms = std::collections::HashSet::new();
            for grant in &invite.rooms {
                if !valid_identifier(&grant.room_id)
                    || !rooms.insert(&grant.room_id)
                    || (!grant.access && (grant.publish || grant.subscribe))
                {
                    return Err("invalid room grant");
                }
            }
            if invites.insert(invite.invite_id.clone(), invite).is_some() {
                return Err("duplicate invite ID");
            }
        }
        Ok(Self { invites })
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
        self.current(invite_id, now_seconds).is_some_and(|invite| {
            invite.rooms.iter().any(|grant| {
                grant.room_id == room_id
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
        };
        (store, credential, invite)
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
}
