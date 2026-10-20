//! SQLite is authoritative after an atomic, one-time legacy import.
//! Password hashes retain their fixed-cost Argon2id policy; no plaintext secrets.
use crate::{
    admin::{AdminDocument, parse_credentials},
    auth::{Invite, InviteFile, InviteStore, MAX_INVITE_FILE_BYTES, MAX_USERS_FILE_BYTES, User},
    config::Config,
    rtc::TransportConfig,
    transport::TransportMode,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{File, OpenOptions},
    io::Read,
    net::{IpAddr, SocketAddr},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

const SETTINGS: &[(&str, &str, usize)] = &[
    ("DASS_MAX_CONCURRENT_REQUESTS", "128", 1024),
    ("DASS_MAX_CONTROL_MESSAGE_BYTES", "16384", 16384),
    ("DASS_MAX_SESSIONS", "128", 4096),
    ("DASS_MAX_UNAUTHENTICATED_SESSIONS", "0", 0),
    ("DASS_MAX_LOGIN_HANDSHAKES", "16", 256),
    ("DASS_MAX_TCP_CONNECTIONS", "128", 4096),
    ("DASS_MAX_PASSWORD_VERIFICATIONS", "2", 16),
    ("DASS_ADMIN_DATA_FILE", "/var/lib/dass/policy.json", 0),
    ("DASS_RTC_AUTO_LAN_PEERS", "false", 0),
    ("DASS_RTC_ALLOWED_PEERS", "", 0),
    ("DASS_RTC_TRUSTED_CLIENT_IPS", "", 0),
    ("DASS_MAX_MEDIA_SESSIONS", "2", 64),
    ("DASS_MAX_PACKETS_PER_SECOND", "2000", 20_000),
    ("DASS_MAX_INGRESS_BYTES_PER_SECOND", "2000000", 20_000_000),
    ("DASS_MAX_EGRESS_BYTES_PER_SECOND", "4000000", 40_000_000),
];

fn sql<T>(result: rusqlite::Result<T>) -> Result<T, &'static str> {
    result.map_err(|_| "SQLite operation failed; check database integrity and volume permissions")
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct Settings(pub BTreeMap<String, String>);

impl Settings {
    pub fn validate(&self, mode: TransportMode) -> Result<(), &'static str> {
        if self.0.len() != SETTINGS.len() {
            return Err("settings must contain exactly the supported configuration keys");
        }
        for (key, _, maximum) in SETTINGS {
            let value = self.0.get(*key).ok_or("missing configuration setting")?;
            if value.len() > 4096 || value.chars().any(char::is_control) {
                return Err("configuration value too large or contains control characters");
            }
            if *maximum > 0 {
                let number: usize = value.parse().map_err(|_| "invalid numeric setting")?;
                if number == 0 || number > *maximum {
                    return Err("numeric setting outside supported bounds");
                }
                if *key == "DASS_MAX_CONTROL_MESSAGE_BYTES" && number < 1024 {
                    return Err("authenticated control messages require at least 1024 bytes");
                }
            }
        }
        if self.0["DASS_MAX_UNAUTHENTICATED_SESSIONS"] != "0" {
            return Err("anonymous access is disabled; unauthenticated sessions must remain 0");
        }
        if self.0["DASS_ADMIN_DATA_FILE"].is_empty() {
            return Err("legacy import path must not be empty");
        }
        if !matches!(self.0["DASS_RTC_AUTO_LAN_PEERS"].as_str(), "true" | "false") {
            return Err("automatic LAN admission must be true or false");
        }
        let peers = &self.0["DASS_RTC_ALLOWED_PEERS"];
        let clients = &self.0["DASS_RTC_TRUSTED_CLIENT_IPS"];
        let mut seen = HashSet::new();
        if !peers.is_empty() {
            for entry in peers.split(',') {
                let address: SocketAddr = entry.parse().map_err(|_| "invalid allowed peer")?;
                if !mode.permits_media_address(address.ip())
                    || address.port() < 1024
                    || !seen.insert(address)
                    || seen.len() > 16
                {
                    return Err("unsafe, duplicate or excessive allowed peers");
                }
            }
        }
        let mut seen = HashSet::new();
        if !clients.is_empty() {
            for entry in clients.split(',') {
                let address: IpAddr = entry.parse().map_err(|_| "invalid trusted client IP")?;
                if !mode.permits_media_address(address) || !seen.insert(address) || seen.len() > 16
                {
                    return Err("unsafe, duplicate or excessive trusted client IPs");
                }
            }
        }
        if peers.len() > 1024 || clients.len() > 655 {
            return Err("media address list too large");
        }
        if mode == TransportMode::Public
            && (!peers.is_empty()
                || !clients.is_empty()
                || self.0["DASS_RTC_AUTO_LAN_PEERS"] == "true")
        {
            return Err("public mode does not permit LAN admission settings");
        }
        Ok(())
    }

    /// Anonymous access and migration provenance are not mutable controls.
    pub fn read_only_keys() -> [&'static str; 2] {
        ["DASS_MAX_UNAUTHENTICATED_SESSIONS", "DASS_ADMIN_DATA_FILE"]
    }
}

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn existing(path: PathBuf) -> Result<Self, &'static str> {
        if !path.is_file() {
            return Err("SQLite database does not exist");
        }
        let database = Self { path };
        let connection = database.connect()?;
        let version: u32 =
            sql(connection.pragma_query_value(None, "user_version", |row| row.get(0)))?;
        if version != 2 {
            return Err("unsupported SQLite schema version");
        }
        Ok(database)
    }

    fn connect(&self) -> Result<Connection, &'static str> {
        // Create with restrictive permissions before SQLite opens it. Existing
        // corrupt files are never replaced or reseeded.
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&self.path);
        if let Err(error) = file
            && error.kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err("cannot create SQLite database");
        }
        let connection = sql(Connection::open(&self.path))?;
        sql(connection.busy_timeout(Duration::from_secs(2)))?;
        sql(connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;"))?;
        Ok(connection)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn open(
        path: PathBuf,
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, &'static str> {
        let database = Self { path };
        let mut connection = database.connect()?;
        let transaction =
            sql(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
        let version: u32 =
            sql(transaction.pragma_query_value(None, "user_version", |row| row.get(0)))?;
        if version == 0 {
            let mut settings = Settings(
                SETTINGS
                    .iter()
                    .map(|(key, default, _)| {
                        (
                            (*key).into(),
                            lookup(key).unwrap_or_else(|| (*default).into()),
                        )
                    })
                    .collect(),
            );
            // The old value bounded login handshakes, not anonymous authority.
            if lookup("DASS_MAX_LOGIN_HANDSHAKES").is_none()
                && let Some(old) = lookup("DASS_MAX_UNAUTHENTICATED_SESSIONS")
                && old != "0"
            {
                settings.0.insert("DASS_MAX_LOGIN_HANDSHAKES".into(), old);
            }
            settings
                .0
                .insert("DASS_MAX_UNAUTHENTICATED_SESSIONS".into(), "0".into());
            // Historical control limits were clamped to the signaling ceiling.
            if let Ok(value) = settings.0["DASS_MAX_CONTROL_MESSAGE_BYTES"].parse::<usize>()
                && value <= 65_536
            {
                settings.0.insert(
                    "DASS_MAX_CONTROL_MESSAGE_BYTES".into(),
                    value
                        .min(dass_protocol::signaling::MAX_MESSAGE_BYTES)
                        .to_string(),
                );
            }
            let mode = TransportMode::parse(
                &lookup("DASS_TRANSPORT_MODE").unwrap_or_else(|| "local".into()),
            )?;
            settings.validate(mode)?;
            let legacy_path = PathBuf::from(&settings.0["DASS_ADMIN_DATA_FILE"]);
            let seed = lookup("DASS_USERS");
            let invite_path = lookup("DASS_INVITE_FILE");
            if seed.is_some() && invite_path.is_some() {
                return Err("configure only one account or invite seed");
            }
            let legacy = read_optional(&legacy_path, MAX_USERS_FILE_BYTES + 32_768)?;
            if legacy.is_some() && invite_path.is_some() {
                return Err("cannot combine persisted account policy with invite mode");
            }
            let document: AdminDocument = if let Some(bytes) = legacy {
                serde_json::from_slice(&bytes).map_err(|_| "invalid legacy account policy")?
            } else if let Some(seed) = seed {
                if seed.len() > MAX_USERS_FILE_BYTES {
                    return Err("account seed too large");
                }
                serde_json::from_str(&seed).map_err(|_| "invalid account seed")?
            } else {
                AdminDocument::empty()
            };
            document.store()?;
            let invites = if let Some(path) = invite_path {
                let bytes = read_optional(Path::new(&path), MAX_INVITE_FILE_BYTES)?
                    .ok_or("missing invite seed")?;
                InviteStore::from_bytes(&bytes)?;
                Some(
                    serde_json::from_slice::<InviteFile>(&bytes)
                        .map_err(|_| "invalid invite seed")?
                        .invites,
                )
            } else {
                None
            };
            let admins = match lookup("DASS_ADMIN_USERS") {
                Some(value) if !value.is_empty() => parse_credentials(&value)?,
                _ => HashMap::new(),
            };
            if invites.is_some() && !admins.is_empty() {
                return Err("admin panel requires account mode");
            }
            sql(transaction.execute_batch(include_str!("migrations/001_initial.sql")))?;
            for (key, value) in &settings.0 {
                sql(transaction
                    .execute("INSERT INTO settings VALUES (?1, ?2)", params![key, value]))?;
            }
            sql(transaction.execute(
                "INSERT INTO metadata VALUES ('auth_mode', ?1)",
                [if invites.is_some() {
                    "invites"
                } else {
                    "accounts"
                }],
            ))?;
            for user in &document.users {
                insert_user(&transaction, user)?;
            }
            for invite in invites.unwrap_or_default() {
                sql(transaction.execute(
                    "INSERT INTO invites VALUES (?1, ?2, ?3)",
                    params![invite.invite_id, invite.password_hash, invite.display_name],
                ))?;
            }
            for (username, hash) in admins {
                sql(transaction.execute(
                    "INSERT INTO administrators VALUES (?1, ?2)",
                    params![username, hash],
                ))?;
            }
            sql(transaction.pragma_update(None, "user_version", 1))?;
        } else if version != 1 && version != 2 {
            return Err("unsupported SQLite schema version");
        }
        if version <= 1 {
            sql(transaction
                .execute_batch(include_str!("migrations/002_administrator_management.sql")))?;
            let mode: String = sql(transaction.query_row(
                "SELECT value FROM metadata WHERE name='auth_mode'",
                [],
                |row| row.get(0),
            ))?;
            let count: i64 =
                sql(transaction
                    .query_row("SELECT count(*) FROM administrators", [], |row| row.get(0)))?;
            if mode == "accounts" && count == 0 {
                let administrator = crate::auth::bootstrap_administrator()?;
                sql(transaction.execute("INSERT INTO administrators (username, password_hash, must_change_password) VALUES (?1, ?2, 1)", params![administrator.username, administrator.password_hash]))?;
            }
            sql(transaction.pragma_update(None, "user_version", 2))?;
        }
        sql(transaction.commit())?;
        // Validate persisted data too; never revive environment seeds on failure.
        database.document()?.store()?;
        database.store()?;
        database.credentials()?;
        Ok(database)
    }

    pub fn settings(&self) -> Result<Settings, &'static str> {
        let connection = self.connect()?;
        let mut statement = sql(connection.prepare("SELECT name, value FROM settings"))?;
        let rows = sql(statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?))))?;
        Ok(Settings(sql(rows.collect())?))
    }

    pub fn config(&self, settings: &Settings) -> Result<Config, &'static str> {
        let lookup = |name: &str| match name {
            // These inputs are only used to select/validate authentication mode.
            // The actual credential store always comes from SQLite.
            "DASS_USERS" => Some(r#"{"version":2,"users":[]}"#.into()),
            "DASS_INVITE_FILE" => None,
            _ => settings
                .0
                .get(name)
                .cloned()
                .or_else(|| std::env::var(name).ok()),
        };
        let config = Config::from_lookup(lookup)?;
        settings.validate(config.transport_mode)?;
        TransportConfig::from_lookup(config.tls.is_some(), config.transport_mode, lookup)?;
        Ok(config)
    }

    pub fn save_settings(&self, next: &Settings) -> Result<(), &'static str> {
        let mode = TransportMode::parse(
            &std::env::var("DASS_TRANSPORT_MODE").unwrap_or_else(|_| "local".into()),
        )?;
        next.validate(mode)?;
        // Deployment/TLS inputs are immutable for the running process. Validate
        // media coherence as well as all stored settings before committing.
        let tls_enabled = std::env::var_os("DASS_TLS_CERT_FILE").is_some()
            && std::env::var_os("DASS_TLS_KEY_FILE").is_some();
        TransportConfig::from_lookup(tls_enabled, mode, |name| {
            next.0
                .get(name)
                .cloned()
                .or_else(|| std::env::var(name).ok())
        })?;
        let mut connection = self.connect()?;
        let transaction =
            sql(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
        for key in Settings::read_only_keys() {
            let old: String = sql(transaction.query_row(
                "SELECT value FROM settings WHERE name=?1",
                [key],
                |row| row.get(0),
            ))?;
            if next.0[key] != old {
                return Err("read-only configuration setting cannot be changed");
            }
        }
        for (key, value) in &next.0 {
            sql(transaction.execute(
                "UPDATE settings SET value=?2 WHERE name=?1",
                params![key, value],
            ))?;
        }
        sql(transaction.commit())
    }

    pub fn document(&self) -> Result<AdminDocument, &'static str> {
        let connection = self.connect()?;
        let mut statement = sql(connection.prepare(
            "SELECT username, password_hash, display_name FROM users ORDER BY username LIMIT 257",
        ))?;
        let rows = sql(statement.query_map([], |row| {
            Ok(User {
                username: row.get(0)?,
                password_hash: row.get(1)?,
                display_name: row.get(2)?,
            })
        }))?;
        let document = AdminDocument::from_users(sql(rows.collect())?);
        document.store()?;
        Ok(document)
    }

    pub fn save_document(&self, document: &AdminDocument) -> Result<(), &'static str> {
        document.store()?;
        let mut connection = self.connect()?;
        let transaction =
            sql(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
        sql(transaction.execute("DELETE FROM users", []))?;
        for user in &document.users {
            insert_user(&transaction, user)?;
        }
        sql(transaction.commit())
    }

    pub fn store(&self) -> Result<InviteStore, &'static str> {
        let connection = self.connect()?;
        let mode: String = sql(connection.query_row(
            "SELECT value FROM metadata WHERE name='auth_mode'",
            [],
            |row| row.get(0),
        ))?;
        match mode.as_str() {
            "accounts" => self.document()?.store(),
            "invites" => {
                let mut statement = sql(connection.prepare(
                    "SELECT invite_id, password_hash, display_name FROM invites LIMIT 257",
                ))?;
                let rows = sql(statement.query_map([], |row| {
                    Ok(Invite {
                        invite_id: row.get(0)?,
                        password_hash: row.get(1)?,
                        display_name: row.get(2)?,
                    })
                }))?;
                let bytes = serde_json::to_vec(&InviteFile {
                    version: 2,
                    invites: sql(rows.collect())?,
                })
                .map_err(|_| "invalid stored invites")?;
                InviteStore::from_bytes(&bytes)
            }
            _ => Err("invalid stored authentication mode"),
        }
    }

    pub fn credentials(&self) -> Result<HashMap<String, String>, &'static str> {
        let connection = self.connect()?;
        let mut statement =
            sql(connection.prepare("SELECT username, password_hash FROM administrators LIMIT 33"))?;
        let rows = sql(statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }))?;
        let pairs: Vec<_> = sql(rows.collect())?;
        if pairs.is_empty() {
            return Ok(HashMap::new());
        }
        parse_credentials(
            &pairs
                .into_iter()
                .map(|(name, hash)| format!("{name}:{hash}"))
                .collect::<Vec<_>>()
                .join(";"),
        )
    }

    /// Offline provisioning. Stop the backend before using these operations.
    pub fn provision(&self, user: User, administrator: bool) -> Result<(), &'static str> {
        let mut connection = self.connect()?;
        let transaction =
            sql(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
        let mode: String = sql(transaction.query_row(
            "SELECT value FROM metadata WHERE name='auth_mode'",
            [],
            |row| row.get(0),
        ))?;
        if mode != "accounts" {
            return Err("provisioning requires account mode");
        }
        if administrator {
            parse_credentials(&format!("{}:{}", user.username, user.password_hash))?;
            sql(transaction.execute("INSERT INTO administrators (username, password_hash, must_change_password) VALUES (?1, ?2, 0) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, must_change_password=0", params![user.username, user.password_hash]))?;
            let count: i64 =
                sql(transaction
                    .query_row("SELECT count(*) FROM administrators", [], |row| row.get(0)))?;
            if count > 32 {
                return Err("administrator limit reached");
            }
        } else {
            AdminDocument::from_users(vec![user.clone()]).store()?;
            sql(transaction.execute("INSERT INTO users VALUES (?1, ?2, ?3) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, display_name=excluded.display_name", params![user.username, user.password_hash, user.display_name]))?;
            let count: i64 =
                sql(transaction.query_row("SELECT count(*) FROM users", [], |row| row.get(0)))?;
            if count > crate::auth::MAX_USERS as i64 {
                return Err("account limit reached");
            }
        }
        sql(transaction.commit())
    }

    pub fn administrator(&self, username: &str) -> Result<Option<(String, bool)>, &'static str> {
        let connection = self.connect()?;
        sql(connection
            .query_row(
                "SELECT password_hash, must_change_password FROM administrators WHERE username=?1",
                [username],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional())
    }

    pub fn administrators(&self) -> Result<Vec<(String, bool)>, &'static str> {
        let connection = self.connect()?;
        let mut statement = sql(connection.prepare(
            "SELECT username, must_change_password FROM administrators ORDER BY username LIMIT 33",
        ))?;
        let rows = sql(statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?))))?;
        let administrators: Vec<_> = sql(rows.collect())?;
        if administrators.len() > 32 {
            return Err("administrator limit exceeded");
        }
        Ok(administrators)
    }

    /// Actor/hash checks and last-administrator protection share the mutation's
    /// write transaction, including concurrent requests and self-removal.
    pub fn edit_administrator(
        &self,
        actor: &str,
        actor_hash: &str,
        username: &str,
        password: Option<&str>,
    ) -> Result<(), &'static str> {
        if !crate::auth::valid_identifier(username) {
            return Err("invalid administrator username");
        }
        let replacement = password
            .map(|password| crate::auth::create_user(username.into(), password, None))
            .transpose()?;
        let mut connection = self.connect()?;
        let transaction =
            sql(connection.transaction_with_behavior(TransactionBehavior::Immediate))?;
        let record: Option<(String, bool)> = sql(transaction
            .query_row(
                "SELECT password_hash, must_change_password FROM administrators WHERE username=?1",
                [actor],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional())?;
        let Some((current_hash, must_change)) = record else {
            return Err("administrator authorization changed; sign in again");
        };
        if current_hash != actor_hash {
            return Err("administrator authorization changed; sign in again");
        }
        if must_change && (username != actor || replacement.is_none()) {
            return Err("change your initial administrator password first");
        }
        if let Some(user) = replacement {
            sql(transaction.execute("INSERT INTO administrators (username, password_hash, must_change_password) VALUES (?1, ?2, 0) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, must_change_password=0", params![user.username, user.password_hash]))?;
            let count: i64 =
                sql(transaction
                    .query_row("SELECT count(*) FROM administrators", [], |row| row.get(0)))?;
            if count > 32 {
                return Err("administrator limit reached");
            }
        } else {
            let count: i64 =
                sql(transaction
                    .query_row("SELECT count(*) FROM administrators", [], |row| row.get(0)))?;
            if count <= 1 {
                return Err("cannot remove the last administrator");
            }
            if sql(transaction.execute("DELETE FROM administrators WHERE username=?1", [username]))?
                == 0
            {
                return Err("administrator not found");
            }
        }
        sql(transaction.commit())
    }
}

fn insert_user(connection: &Connection, user: &User) -> Result<(), &'static str> {
    sql(connection.execute(
        "INSERT INTO users VALUES (?1, ?2, ?3)",
        params![user.username, user.password_hash, user.display_name],
    ))?;
    Ok(())
}

fn read_optional(path: &Path, maximum: usize) -> Result<Option<Vec<u8>>, &'static str> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("cannot open legacy configuration"),
    };
    let mut bytes = Vec::new();
    file.take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "cannot read legacy configuration")?;
    if bytes.len() > maximum {
        return Err("legacy configuration exceeds size limit");
    }
    Ok(Some(bytes))
}

#[cfg(test)]
#[path = "database_tests.rs"]
mod tests;
