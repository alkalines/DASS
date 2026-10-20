use super::*;
use crate::auth::{UsersFile, create_invite, create_user};
use argon2::PasswordVerifier;

struct Directory(PathBuf);

impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "dass-sqlite-{}",
            crate::auth::random_identifier().unwrap()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn open(&self, entries: &[(&str, &str)]) -> Result<Database, &'static str> {
        Database::open(self.0.join("dass.sqlite3"), |key| {
            if key == "DASS_ADMIN_DATA_FILE" {
                return Some(self.0.join("policy.json").to_str().unwrap().to_owned());
            }
            entries
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| (*value).into())
        })
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        for name in [
            "dass.sqlite3",
            "dass.sqlite3-journal",
            "policy.json",
            "invites.json",
        ] {
            let _ = std::fs::remove_file(self.0.join(name));
        }
        let _ = std::fs::remove_dir(&self.0);
    }
}

fn seed(username: &str, password: &str) -> String {
    serde_json::to_string(&UsersFile {
        version: 2,
        users: vec![create_user(username.into(), password, None).unwrap()],
    })
    .unwrap()
}

#[test]
fn imports_normalized_users_admins_settings_once_and_preserves_hashes() {
    let directory = Directory::new();
    let users = seed("alice", "a long account password");
    let admin = create_user("operator".into(), "a long admin password", None).unwrap();
    let pair = format!("operator:{}", admin.password_hash);
    let database = directory
        .open(&[
            ("DASS_USERS", &users),
            ("DASS_ADMIN_USERS", &pair),
            ("DASS_MAX_SESSIONS", "64"),
            ("DASS_MAX_UNAUTHENTICATED_SESSIONS", "4"),
        ])
        .unwrap();
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("alice", "a long account password")
            .is_ok()
    );
    assert_eq!(
        database.credentials().unwrap()["operator"],
        admin.password_hash
    );
    assert_eq!(database.settings().unwrap().0["DASS_MAX_SESSIONS"], "64");
    assert_eq!(
        database.settings().unwrap().0["DASS_MAX_LOGIN_HANDSHAKES"],
        "4"
    );
    assert_eq!(
        database.settings().unwrap().0["DASS_MAX_UNAUTHENTICATED_SESSIONS"],
        "0"
    );
    let original: UsersFile = serde_json::from_str(&users).unwrap();
    assert_eq!(
        database.document().unwrap().users[0].password_hash,
        original.users[0].password_hash
    );
    // Invalid/changed legacy inputs are never read again after commit.
    let reopened = directory
        .open(&[
            ("DASS_USERS", "not-json"),
            ("DASS_ADMIN_USERS", "not-a-hash"),
            ("DASS_MAX_SESSIONS", "0"),
        ])
        .unwrap();
    assert_eq!(reopened.settings().unwrap().0["DASS_MAX_SESSIONS"], "64");
    reopened.save_document(&AdminDocument::empty()).unwrap();
    assert!(
        directory
            .open(&[("DASS_USERS", &users)])
            .unwrap()
            .document()
            .unwrap()
            .users
            .is_empty()
    );
}

#[test]
fn durable_legacy_policy_wins_over_stale_environment_seed() {
    let directory = Directory::new();
    let policy = seed("current", "a current account password");
    let stale = seed("deleted", "a deleted account password");
    std::fs::write(directory.0.join("policy.json"), &policy).unwrap();
    let database = directory.open(&[("DASS_USERS", &stale)]).unwrap();
    assert_eq!(database.document().unwrap().users[0].username, "current");
    assert_eq!(
        std::fs::read_to_string(directory.0.join("policy.json")).unwrap(),
        policy
    );
    // Even a now-corrupt legacy file is irrelevant once the import committed.
    std::fs::write(directory.0.join("policy.json"), "broken").unwrap();
    assert!(directory.open(&[]).is_ok());
}

#[test]
fn failed_import_rolls_back_schema_and_can_be_retried_without_widening_access() {
    let directory = Directory::new();
    for bad in [
        "broken",
        r#"{"version":1,"users":[]}"#,
        r#"{"version":2,"users":[],"blocked_rooms":[]}"#,
    ] {
        std::fs::write(directory.0.join("policy.json"), bad).unwrap();
        assert!(directory.open(&[]).is_err());
        let connection = Connection::open(directory.0.join("dass.sqlite3")).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE type='table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0);
    }
    std::fs::write(
        directory.0.join("policy.json"),
        r#"{"version":2,"users":[]}"#,
    )
    .unwrap();
    assert!(directory.open(&[]).is_ok());
}

#[test]
fn imports_legacy_invites_without_converting_them_to_accounts() {
    let directory = Directory::new();
    let (invite, credential) = create_invite("legacy".into()).unwrap();
    let bytes = serde_json::to_vec(&InviteFile {
        version: 2,
        invites: vec![invite],
    })
    .unwrap();
    let path = directory.0.join("invites.json");
    std::fs::write(&path, bytes).unwrap();
    let database = directory
        .open(&[("DASS_INVITE_FILE", path.to_str().unwrap())])
        .unwrap();
    assert!(database.store().unwrap().verify(&credential).is_ok());
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("legacy", &credential)
            .is_err()
    );
    assert!(database.document().unwrap().users.is_empty());
    assert!(
        database
            .provision(
                create_user("operator".into(), "a long password value", None).unwrap(),
                true
            )
            .is_err()
    );
    std::fs::remove_file(path).unwrap();
    assert!(
        directory
            .open(&[])
            .unwrap()
            .store()
            .unwrap()
            .verify(&credential)
            .is_ok()
    );
}

#[test]
fn all_persisted_limits_and_network_lists_are_validated_even_with_media_disabled() {
    let directory = Directory::new();
    let settings = directory.open(&[]).unwrap().settings().unwrap();
    for (key, value) in [
        ("DASS_MAX_UNAUTHENTICATED_SESSIONS", "1"),
        ("DASS_MAX_LOGIN_HANDSHAKES", "0"),
        ("DASS_MAX_SESSIONS", "4097"),
        ("DASS_MAX_CONTROL_MESSAGE_BYTES", "512"),
        ("DASS_MAX_PACKETS_PER_SECOND", "20001"),
        ("DASS_MAX_INGRESS_BYTES_PER_SECOND", "0"),
        ("DASS_MAX_EGRESS_BYTES_PER_SECOND", "40000001"),
        ("DASS_MAX_MEDIA_SESSIONS", "65"),
        ("DASS_MAX_PASSWORD_VERIFICATIONS", "17"),
        ("DASS_RTC_AUTO_LAN_PEERS", "yes"),
        ("DASS_RTC_ALLOWED_PEERS", "169.254.169.254:1234"),
        ("DASS_RTC_TRUSTED_CLIENT_IPS", "127.0.0.1,127.0.0.1"),
    ] {
        let mut invalid = settings.clone();
        invalid.0.insert(key.into(), value.into());
        assert!(
            invalid.validate(TransportMode::Local).is_err(),
            "accepted {key}"
        );
    }
    let mut unknown = settings.clone();
    unknown.0.insert("unknown".into(), "1".into());
    assert!(unknown.validate(TransportMode::Local).is_err());
    let mut public = settings;
    public
        .0
        .insert("DASS_RTC_AUTO_LAN_PEERS".into(), "true".into());
    assert!(public.validate(TransportMode::Public).is_err());
}

#[test]
fn refuses_corrupt_and_future_databases_without_reseeding() {
    let directory = Directory::new();
    let path = directory.0.join("dass.sqlite3");
    std::fs::write(&path, "not-sqlite").unwrap();
    assert!(directory.open(&[]).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "not-sqlite");
    std::fs::remove_file(&path).unwrap();
    let database = directory.open(&[]).unwrap();
    database
        .connect()
        .unwrap()
        .pragma_update(None, "user_version", 999)
        .unwrap();
    assert!(directory.open(&[]).is_err());
}

#[test]
fn provisioning_updates_hashes_in_sqlite_without_plaintext_storage() {
    let directory = Directory::new();
    let database = directory.open(&[]).unwrap();
    database
        .provision(
            create_user("alice".into(), "a long account password", None).unwrap(),
            false,
        )
        .unwrap();
    database
        .provision(
            create_user("operator".into(), "a long admin password", None).unwrap(),
            true,
        )
        .unwrap();
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("alice", "a long account password")
            .is_ok()
    );
    assert_eq!(database.credentials().unwrap().len(), 2);
    database
        .provision(
            create_user("alice".into(), "a reset account password", None).unwrap(),
            false,
        )
        .unwrap();
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("alice", "a long account password")
            .is_err()
    );
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("alice", "a reset account password")
            .is_ok()
    );
    let bytes = std::fs::read(database.path()).unwrap();
    assert!(
        !bytes
            .windows(b"a reset account password".len())
            .any(|part| part == b"a reset account password")
    );
}

#[test]
fn default_administrator_requires_setup_and_cannot_grant_client_access() {
    let directory = Directory::new();
    let database = directory.open(&[]).unwrap();
    let (hash, required) = database.administrator("admin").unwrap().unwrap();
    assert!(required);
    let parsed = crate::auth::validated_hash(&hash).unwrap();
    assert!(
        argon2::Argon2::default()
            .verify_password(b"admin", &parsed)
            .is_ok()
    );
    assert!(
        database
            .store()
            .unwrap()
            .verify_account("admin", "admin")
            .is_err()
    );
    assert!(
        database
            .edit_administrator("admin", &hash, "other", Some("a long other password"))
            .is_err()
    );
    assert!(
        database
            .edit_administrator("admin", &hash, "admin", None)
            .is_err()
    );
    assert!(
        database
            .edit_administrator("admin", &hash, "admin", Some("admin"))
            .is_err()
    );
    database
        .edit_administrator("admin", &hash, "admin", Some("a long changed password"))
        .unwrap();
    let (new_hash, required) = directory
        .open(&[])
        .unwrap()
        .administrator("admin")
        .unwrap()
        .unwrap();
    assert!(!required);
    assert_ne!(new_hash, hash);
    assert!(
        database
            .edit_administrator("admin", &hash, "other", Some("a long other password"))
            .is_err()
    );
    assert!(
        database
            .edit_administrator("admin", &new_hash, "admin", None)
            .is_err()
    );
    database
        .edit_administrator("admin", &new_hash, "other", Some("a long other password"))
        .unwrap();
    database
        .edit_administrator("admin", &new_hash, "admin", None)
        .unwrap();
    assert!(database.administrator("admin").unwrap().is_none());
    assert!(
        directory
            .open(&[])
            .unwrap()
            .administrator("admin")
            .unwrap()
            .is_none()
    );
    assert!(
        database
            .edit_administrator(
                "admin",
                &new_hash,
                "other",
                Some("a different password value")
            )
            .is_err()
    );
}

#[test]
fn schema_two_migrates_existing_admins_without_resetting_their_passwords() {
    let directory = Directory::new();
    let user = create_user("existing".into(), "a long existing password", None).unwrap();
    let connection = Connection::open(directory.0.join("dass.sqlite3")).unwrap();
    connection
        .execute_batch(include_str!("migrations/001_initial.sql"))
        .unwrap();
    connection
        .execute("INSERT INTO metadata VALUES ('auth_mode', 'accounts')", [])
        .unwrap();
    for (key, value, _) in SETTINGS {
        connection
            .execute("INSERT INTO settings VALUES (?1, ?2)", params![key, value])
            .unwrap();
    }
    connection
        .execute(
            "INSERT INTO administrators VALUES (?1, ?2)",
            params![user.username, user.password_hash],
        )
        .unwrap();
    connection.pragma_update(None, "user_version", 1).unwrap();
    drop(connection);
    let database = directory
        .open(&[("DASS_ADMIN_USERS", "invalid seed ignored")])
        .unwrap();
    assert_eq!(
        database.administrators().unwrap(),
        vec![("existing".into(), false)]
    );
    assert_eq!(
        database.administrator("existing").unwrap().unwrap().0,
        user.password_hash
    );
    assert!(database.administrator("admin").unwrap().is_none());
    let version: u32 = database
        .connect()
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 2);
}
