pub mod admin;
pub mod auth;
pub mod certificate;
pub mod config;
pub mod database;
pub mod diagnostics;
pub mod forwarding;
pub mod listener;
pub mod metrics;
pub mod rtc;
pub mod signaling;
pub mod transport;

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use dass_protocol::Capabilities;
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;

use config::Config;

/// Discovery only: no unauthenticated room, publish or subscribe handlers.
pub fn app(config: Config) -> Router {
    app_with_signaling(config, None)
}

pub fn app_with_signaling(config: Config, signaling: Option<signaling::SignalingState>) -> Router {
    app_with_control_panel(config, signaling, None)
}

pub fn app_with_control_panel(
    config: Config,
    signaling: Option<signaling::SignalingState>,
    panel: Option<admin::AdminState>,
) -> Router {
    let request_limits = RequestLimits {
        semaphore: Arc::new(Semaphore::new(config.limits.max_concurrent_requests)),
        max_body_bytes: config.limits.max_control_message_bytes,
    };
    let timeout = config.request_timeout;
    let maximum_message_bytes = config.limits.max_control_message_bytes;
    let discovery = DiscoveryState {
        config,
        control_plane_available: signaling.is_some(),
    };
    let router = Router::new()
        .route("/health/live", get(|| async { StatusCode::NO_CONTENT }))
        .route("/health/ready", get(not_ready))
        .route("/v1/capabilities", get(capabilities))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .with_state(discovery);
    let router = match signaling {
        Some(state) => router.merge(signaling::router(state, maximum_message_bytes)),
        None => router,
    };
    let router = match panel {
        Some(state) => router.merge(admin::router(state)),
        None => router,
    };
    router
        .layer(middleware::from_fn_with_state(
            request_limits,
            limit_request,
        ))
        .layer(middleware::from_fn_with_state(timeout, request_timeout))
}

#[derive(Clone)]
struct RequestLimits {
    semaphore: Arc<Semaphore>,
    max_body_bytes: usize,
}

async fn limit_request(
    State(limits): State<RequestLimits>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = limits.semaphore.try_acquire() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let (parts, body) = request.into_parts();
    let bytes = match to_bytes(body, limits.max_body_bytes).await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

async fn not_ready() -> impl IntoResponse {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "media_transport_unavailable",
    )
}

#[derive(Clone)]
struct DiscoveryState {
    config: Config,
    control_plane_available: bool,
}

async fn capabilities(State(discovery): State<DiscoveryState>, headers: HeaderMap) -> Response {
    let mut document = Capabilities::scaffold(discovery.config.limits);
    document.insecure_local_development = discovery.config.tls.is_none();
    document.control_plane_available = discovery.control_plane_available;
    document.authentication_available = discovery.control_plane_available;
    // The backend relays publisher-encrypted epoch keys for every stream; E2EE
    // availability means the key-management relay exists, not that the RTC
    // media path or client-side frame encryption has been validated.
    document.e2ee_available = discovery.control_plane_available;
    // Signaling control tests are not yet a media interoperability gate.
    let mut response = Json(document).into_response();
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Origin"));
    if headers.get(header::ORIGIN) == Some(&HeaderValue::from_static("https://discord.com")) {
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("https://discord.com"),
        );
    }
    response
}

async fn request_timeout(
    State(timeout): State<Duration>,
    request: Request,
    next: Next,
) -> Response {
    match tokio::time::timeout(timeout, next.run(request)).await {
        Ok(response) => response,
        Err(_) => StatusCode::REQUEST_TIMEOUT.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use dass_protocol::ControlLimits;
    use tower::ServiceExt;

    use crate::config::ResourceLimits;
    use crate::transport::TransportMode;

    fn test_app() -> Router {
        app(Config {
            listen_addr: "127.0.0.1:8080".parse().unwrap(),
            limits: ControlLimits {
                max_concurrent_requests: 128,
                max_control_message_bytes: 16_384,
            },
            resources: ResourceLimits::default(),
            transport_mode: TransportMode::Local,
            request_timeout: Duration::from_secs(5),
            tls: None,
            invite_file: None,
            users_json: None,
        })
    }

    async fn get_response(path: &str) -> Response {
        test_app()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn liveness_is_not_media_readiness() {
        assert_eq!(
            get_response("/health/live").await.status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            get_response("/health/ready").await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[tokio::test]
    async fn discovery_is_versioned_and_fail_closed() {
        let response = get_response("/v1/capabilities").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], "application/json");
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(document["protocol_version"], 1);
        assert_eq!(document["ready"], false);
        assert_eq!(document["media_available"], false);
        assert_eq!(document["e2ee_available"], false);
    }

    #[tokio::test]
    async fn discovery_allows_only_the_exact_discord_origin_without_credentials() {
        for origin in [
            "https://discord.com",
            "http://discord.com",
            "https://discord.com.attacker.invalid",
            "https://attacker.invalid",
            "null",
        ] {
            let response = test_app()
                .oneshot(
                    Request::builder()
                        .uri("/v1/capabilities")
                        .header(header::ORIGIN, origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::VARY], "Origin");
            assert_eq!(
                response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
                (origin == "https://discord.com")
                    .then_some(&HeaderValue::from_static("https://discord.com")),
            );
            assert!(
                !response
                    .headers()
                    .contains_key(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            );
        }
        assert!(
            !get_response("/v1/capabilities")
                .await
                .headers()
                .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        );
    }

    #[tokio::test]
    async fn discovery_cors_does_not_apply_to_other_routes_or_writes() {
        for (method, path) in [
            ("GET", "/health/live"),
            ("GET", "/v1/rooms"),
            ("POST", "/v1/capabilities"),
            ("OPTIONS", "/v1/capabilities"),
        ] {
            let response = test_app()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header(header::ORIGIN, "https://discord.com")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert!(
                !response
                    .headers()
                    .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            );
        }
    }

    #[tokio::test]
    async fn no_unauthenticated_session_or_media_api_exists() {
        for path in ["/v1/rooms", "/v1/publish", "/v1/subscribe", "/v1/ws"] {
            assert_eq!(get_response(path).await.status(), StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn discovery_rejects_writes() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/capabilities")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn oversized_bodies_are_rejected() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/v1/capabilities")
                    .body(Body::from(vec![0; 16_385]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn saturated_requests_are_rejected_without_queueing() {
        let semaphore = Arc::new(Semaphore::new(1));
        let _occupied = semaphore.acquire().await.unwrap();
        let router = Router::new()
            .route("/", get(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(
                RequestLimits {
                    semaphore: semaphore.clone(),
                    max_body_bytes: 1024,
                },
                limit_request,
            ));
        let response = router
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn slow_requests_time_out() {
        let router = Router::new()
            .route(
                "/",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    StatusCode::OK
                }),
            )
            .layer(middleware::from_fn_with_state(
                Duration::from_millis(1),
                request_timeout,
            ));
        let response = router
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
    }
}
