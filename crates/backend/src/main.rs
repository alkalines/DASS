use dass_backend::{
    admin::AdminState,
    app_with_control_panel,
    auth::{
        InviteFile, InviteStore, MAX_ACCOUNT_PASSWORD_BYTES, UsersFile,
        create_invite_with_display_name, create_user,
    },
    database::Database,
    listener::{BoundedListener, PeerAddress, tls_acceptor},
    rtc::TransportConfig,
    signaling::SignalingState,
};
use std::{
    fs::File,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::watch;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Third-party RTC logs can contain SDP/identifiers. Only our fixed messages
    // reach the sink; do not enable upstream PII/debug logging for the spike.
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_target(false)
                .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                    metadata.target().starts_with("dass_backend")
                })),
        )
        .init();
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if !arguments.is_empty() {
        let result = match arguments.first().map(String::as_str) {
            Some("create-invite") => create_invite_files(&arguments),
            Some("create-user") => create_user_file(&arguments),
            Some("create-admin") => create_admin_file(&arguments),
            Some("set-user") | Some("set-admin") => provision_database(&arguments),
            _ => Err(
                "usage: dass-backend set-user ... | set-admin ... | create-invite ... | create-user ... | create-admin ...",
            ),
        };
        return result.map_err(Into::into);
    }
    for (key, value) in std::env::vars_os() {
        if key.to_str().is_some_and(|key| key.starts_with("DASS_")) && value.to_str().is_none() {
            return Err("DASS environment values must be UTF-8".into());
        }
    }
    let database_path =
        std::env::var("DASS_DATABASE_FILE").unwrap_or_else(|_| "/var/lib/dass/dass.sqlite3".into());
    if database_path.is_empty() {
        return Err("empty SQLite database path".into());
    }
    let database = Database::open(PathBuf::from(database_path), |name| {
        std::env::var(name).ok()
    })?;
    let settings = database.settings()?;
    let config = database.config(&settings)?;
    let tls = config.tls.as_ref().map(tls_acceptor).transpose()?;
    let transport = TransportConfig::from_lookup(tls.is_some(), config.transport_mode, |name| {
        settings
            .0
            .get(name)
            .cloned()
            .or_else(|| std::env::var(name).ok())
    })?;
    if let Some(transport) = &transport {
        transport
            .initialize()
            .await
            .map_err(|_| "could not bind the configured UDP port pair")?;
    }
    let admin_credentials = database.credentials()?;
    let resources = config.resources;
    let (sender, receiver) = watch::channel(Arc::new(database.store()?));
    let state = SignalingState::new(receiver)
        .with_transport(transport)
        .with_limits(resources);
    let panel = if admin_credentials.is_empty() {
        None
    } else {
        Some(AdminState::new(
            database.document()?,
            database.path().to_path_buf(),
            sender.clone(),
            state.clone(),
        ))
    };
    let listener = BoundedListener::new_with_limit(
        tokio::net::TcpListener::bind(config.listen_addr).await?,
        tls,
        resources.max_tcp_connections,
    );
    tracing::info!(
        tls = config.tls.is_some(),
        signaling = true,
        transport_mode = config.transport_mode.as_str(),
        "backend listening"
    );
    tracing::warn!("production media and E2EE unavailable; readiness remains false");
    axum::serve(
        listener,
        app_with_control_panel(config, Some(state), panel)
            .into_make_service_with_connect_info::<PeerAddress>(),
    )
    .with_graceful_shutdown(shutdown_signal(Some(sender), None))
    .await?;
    Ok(())
}

async fn shutdown_signal(
    invites: Option<watch::Sender<Arc<InviteStore>>>,
    reload: Option<tokio::task::AbortHandle>,
) {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            result.expect("install SIGINT handler");
        }
        _ = terminate.recv() => {}
    }
    if let Some(reload) = reload {
        reload.abort();
    }
    if let Some(invites) = invites {
        invites.send_replace(Arc::new(InviteStore::default()));
    }
    tracing::info!("shutdown requested");
}

fn create_invite_files(arguments: &[String]) -> Result<(), &'static str> {
    if !(4..=5).contains(&arguments.len()) || arguments[0] != "create-invite" {
        return Err(
            "usage: dass-backend create-invite RECORD_FILE CREDENTIAL_FILE INVITE_ID [DISPLAY_NAME]",
        );
    }
    let (invite, credential) =
        create_invite_with_display_name(arguments[3].clone(), arguments.get(4).cloned())?;
    let record = serde_json::to_vec_pretty(&InviteFile {
        version: 2,
        invites: vec![invite],
    })
    .map_err(|_| "cannot serialize invite")?;
    // No credential in command-line arguments, stdout or logs; never overwrite files.
    let mut credential_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&arguments[2])
        .map_err(|_| "cannot create credential file")?;
    let mut record_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&arguments[1])
        .map_err(|_| "cannot create invite record file")?;
    record_file
        .write_all(&record)
        .and_then(|_| record_file.sync_all())
        .map_err(|_| "cannot write invite record file")?;
    credential_file
        .write_all(credential.as_bytes())
        .and_then(|_| credential_file.sync_all())
        .map_err(|_| "cannot write credential file")?;
    tracing::info!("DASS invite files created; deliver credential privately");
    Ok(())
}

fn create_user_file(arguments: &[String]) -> Result<(), &'static str> {
    if !(5..=6).contains(&arguments.len()) || arguments[0] != "create-user" {
        return Err(
            "usage: dass-backend create-user RECORD_FILE PASSWORD_FILE USERNAME [DISPLAY_NAME]",
        );
    }
    let password = read_account_password(&arguments[2])?;
    let user = create_user(arguments[3].clone(), &password, arguments.get(4).cloned())?;
    let record = serde_json::to_vec_pretty(&UsersFile {
        version: 2,
        users: vec![user],
    })
    .map_err(|_| "cannot serialize DASS user")?;
    let mut record_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&arguments[1])
        .map_err(|_| "cannot create DASS user record file")?;
    record_file
        .write_all(&record)
        .and_then(|_| record_file.sync_all())
        .map_err(|_| "cannot write DASS user record file")?;
    tracing::info!("DASS user record created; password was not written to output");
    Ok(())
}

fn read_account_password(path: &str) -> Result<String, &'static str> {
    // Permit a single LF or CRLF added by a password-file editor, but never
    // allow unbounded input or control characters into the account password.
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "cannot open password file")?
        .take((MAX_ACCOUNT_PASSWORD_BYTES + 3) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "cannot read password file")?;
    if bytes.len() > MAX_ACCOUNT_PASSWORD_BYTES + 2 {
        return Err("password file is too large");
    }
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    }
    if bytes.len() > MAX_ACCOUNT_PASSWORD_BYTES {
        return Err("password file is too large");
    }
    let password = String::from_utf8(bytes).map_err(|_| "password file must contain UTF-8")?;
    if password.len() < 12 || password.chars().any(char::is_control) {
        return Err("password file does not meet the account password policy");
    }
    Ok(password)
}

fn create_admin_file(arguments: &[String]) -> Result<(), &'static str> {
    if arguments.len() != 4 {
        return Err("usage: dass-backend create-admin RECORD_FILE PASSWORD_FILE USERNAME");
    }
    let password = read_account_password(&arguments[2])?;
    let user = create_user(arguments[3].clone(), &password, None)?;
    // Administrator hashes are separate from account authentication and grant
    // no stream or room authority.
    let pair = format!("{}:{}", user.username, user.password_hash);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&arguments[1])
        .map_err(|_| "cannot create administrator record file")?;
    file.write_all(pair.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "cannot write administrator record file")?;
    tracing::info!("DASS administrator hash record created; password was not written to output");
    Ok(())
}

fn provision_database(arguments: &[String]) -> Result<(), &'static str> {
    if arguments.len() != 4 {
        return Err(
            "usage: dass-backend set-user|set-admin DATABASE_FILE PASSWORD_FILE USERNAME (backend must be stopped)",
        );
    }
    let password = read_account_password(&arguments[2])?;
    let user = create_user(arguments[3].clone(), &password, None)?;
    let database = Database::open(PathBuf::from(&arguments[1]), |key| std::env::var(key).ok())?;
    database.provision(user, arguments[0] == "set-admin")?;
    tracing::info!("SQLite credential saved; restart backend to load it");
    Ok(())
}
