use dass_backend::{app, config::Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().json().with_target(false).init();
    let config = Config::from_env()?;
    let listener = tokio::net::TcpListener::bind(config.listen_addr).await?;
    tracing::warn!("local-development scaffold only; signaling, media and E2EE unavailable");
    axum::serve(listener, app(config))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            result.expect("install SIGINT handler");
        }
        _ = terminate.recv() => {}
    }
    tracing::info!("shutdown requested");
}
