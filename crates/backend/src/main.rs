use dass_backend::{
    app_with_signaling,
    auth::{InviteFile, InviteStore, RoomGrant, create_invite},
    config::Config,
    listener::{BoundedListener, tls_acceptor},
    rtc::SpikeConfig,
    signaling::{SignalingState, now_seconds},
};
use std::{io::Write, os::unix::fs::OpenOptionsExt, path::PathBuf, sync::Arc};
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
        return create_invite_files(&arguments).map_err(Into::into);
    }
    let config = Config::from_env()?;
    let tls = config.tls.as_ref().map(tls_acceptor).transpose()?;
    let rtc_spike = SpikeConfig::from_env(tls.is_some())?;
    let (sender, state, reload_task) = match config.invite_file.clone() {
        Some(path) => {
            let store = Arc::new(InviteStore::load(&path)?);
            let (sender, receiver) = watch::channel(store);
            let reload_task = tokio::spawn(reload_invites(path, sender.clone()));
            (
                Some(sender),
                Some(SignalingState::new(receiver).with_rtc_spike(rtc_spike)),
                Some(reload_task),
            )
        }
        None => (None, None, None),
    };
    let listener = BoundedListener::new(
        tokio::net::TcpListener::bind(config.listen_addr).await?,
        tls,
    );
    tracing::warn!("media and E2EE unavailable; readiness remains false");
    let abort_reload = reload_task.as_ref().map(|task| task.abort_handle());
    axum::serve(listener, app_with_signaling(config, state))
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
    if arguments.len() != 7 || arguments[0] != "create-invite" {
        return Err(
            "usage: dass-backend create-invite RECORD_FILE CREDENTIAL_FILE INVITE_ID ROOM_ID ROLE EXPIRES_UNIX_SECONDS; ROLE is viewer, publisher, or both",
        );
    }
    let (publish, subscribe) = match arguments[5].as_str() {
        "viewer" => (false, true),
        "publisher" => (true, false),
        "both" => (true, true),
        _ => return Err("invalid DASS role"),
    };
    let expires = arguments[6]
        .parse::<u32>()
        .map_err(|_| "invalid expiration")?;
    if expires <= now_seconds()? {
        return Err("expiration must be in the future");
    }
    let (invite, credential) = create_invite(
        arguments[3].clone(),
        vec![RoomGrant {
            room_id: arguments[4].clone(),
            access: true,
            publish,
            subscribe,
        }],
        expires,
    )?;
    let record = serde_json::to_vec_pretty(&InviteFile {
        version: 1,
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
