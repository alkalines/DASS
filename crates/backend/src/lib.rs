pub mod config;

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
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
    let request_limits = RequestLimits {
        semaphore: Arc::new(Semaphore::new(config.limits.max_concurrent_requests)),
        max_body_bytes: config.limits.max_control_message_bytes,
    };
    Router::new()
        .route("/health/live", get(|| async { StatusCode::NO_CONTENT }))
        .route("/health/ready", get(not_ready))
        .route("/v1/capabilities", get(capabilities))
        .fallback(|| async { StatusCode::NOT_FOUND })
        .layer(middleware::from_fn_with_state(
            request_limits,
            limit_request,
        ))
        .layer(middleware::from_fn_with_state(
            config.request_timeout,
            request_timeout,
        ))
        .with_state(config)
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
    (StatusCode::SERVICE_UNAVAILABLE, "backend_not_implemented")
}

async fn capabilities(State(config): State<Config>) -> Json<Capabilities> {
    Json(Capabilities::scaffold(config.limits))
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

    fn test_app() -> Router {
        app(Config {
            listen_addr: "127.0.0.1:8080".parse().unwrap(),
            limits: ControlLimits {
                max_concurrent_requests: 128,
                max_control_message_bytes: 16_384,
            },
            request_timeout: Duration::from_secs(5),
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
