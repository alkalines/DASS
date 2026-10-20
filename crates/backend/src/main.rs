use dass_backend::{
    admin::{AdminDocument, AdminState, parse_credentials},
    app_with_control_panel,
    auth::{
        InviteFile, InviteStore, MAX_ACCOUNT_PASSWORD_BYTES, UsersFile,
        create_invite_with_display_name, create_user,
    },
    config::Config,
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
            _ => Err("usage: dass-backend create-invite ... | create-user ... | create-admin ..."),
        };
        return result.map_err(Into::into);
    }
    let config = Config::from_env()?;
    let tls = config.tls.as_ref().map(tls_acceptor).transpose()?;
    let transport = TransportConfig::from_env(tls.is_some(), config.transport_mode)?;
    let admin_credentials = match std::env::var("DASS_ADMIN_USERS") {
        Ok(value) if value.is_empty() => None,
        Ok(value) => Some(parse_credentials(&value)?),
        Err(std::env::VarError::NotPresent) => None,
        Err(_) => return Err("DASS_ADMIN_USERS must be UTF-8".into()),
    };
    if admin_credentials.is_some() && config.users_json.is_none() {
        return Err("the control panel requires DASS_USERS account mode, not invite mode".into());
    }
    let admin_path = PathBuf::from(
        std::env::var("DASS_ADMIN_DATA_FILE")
            .unwrap_or_else(|_| "/var/lib/dass/policy.json".into()),
    );
    let mut admin_document = None;
    let resources = config.resources;
    let (sender, state, reload_task) = match (config.invite_file.clone(), config.users_json.clone())
    {
        (Some(path), None) => {
            let store = Arc::new(InviteStore::load(&path)?);
            let (sender, receiver) = watch::channel(store);
            let reload_task = tokio::spawn(reload_invites(path, sender.clone()));
            (
                Some(sender),
                Some(
                    SignalingState::new(receiver)
                        .with_transport(transport)
                        .with_limits(resources),
                ),
                Some(reload_task),
            )
        }
        (None, Some(users_json)) => {
            // Removing admin login must not resurrect the old environment seed.
            let store = if admin_credentials.is_some() || admin_path.try_exists()? {
                let document = AdminDocument::load_or_seed(&admin_path, &users_json)?;
                let store = Arc::new(document.store()?);
                admin_document = Some(document);
                store
            } else {
                Arc::new(InviteStore::from_users_bytes(users_json.as_bytes())?)
            };
            let (sender, receiver) = watch::channel(store);
            (
                Some(sender),
                Some(
                    SignalingState::new(receiver)
                        .with_transport(transport)
                        .with_limits(resources),
                ),
                None,
            )
        }
        (None, None) => (None, None, None),
        (Some(_), Some(_)) => {
            return Err("configure only one of DASS_INVITE_FILE or DASS_USERS".into());
        }
    };
    let panel = match (admin_credentials, admin_document) {
        (Some(credentials), Some(document)) => Some(AdminState::new(
            credentials,
            document,
            admin_path,
            sender.clone().ok_or("panel account policy unavailable")?,
            state.clone().ok_or("panel signaling unavailable")?,
        )),
        _ => None,
    };
    let listener = BoundedListener::new_with_limit(
        tokio::net::TcpListener::bind(config.listen_addr).await?,
        tls,
        resources.max_tcp_connections,
    );
    tracing::info!(
        tls = config.tls.is_some(),
        signaling = state.is_some(),
        transport_mode = config.transport_mode.as_str(),
        "backend listening"
    );
    tracing::warn!("production media and E2EE unavailable; readiness remains false");
    let abort_reload = reload_task.as_ref().map(|task| task.abort_handle());
    axum::serve(
        listener,
        app_with_control_panel(config, state, panel)
            .into_make_service_with_connect_info::<PeerAddress>(),
    )
    .with_graceful_shutdown(shutdown_signal(sender, abort_reload))
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

async fn reload_invites(path: PathBuf, sender: watch::Sender<Arc<InviteStore>>) {
    let mut hangup = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup())
        .expect("install SIGHUP handler");
    while hangup.recv().await.is_some() {
        let path = path.clone();
        let loaded = tokio::task::spawn_blocking(move || InviteStore::load(&path)).await;
        match loaded {
            Ok(Ok(store)) => {
                sender.send_replace(Arc::new(store));
                tracing::info!("invite policy reloaded; sessions invalidated");
            }
            _ => {
                sender.send_replace(Arc::new(InviteStore::default()));
                tracing::error!("invite reload failed; all credentials denied");
            }
        }
    }
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
