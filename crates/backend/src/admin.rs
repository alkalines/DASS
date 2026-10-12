//! Optional, separate administrator credentials and durable account policy.
//! No Discord credentials, media bypass, or external control-plane service.

use crate::{
    auth::{
        InviteStore, MAX_USERS, MAX_USERS_FILE_BYTES, RoomGrant, User, UsersFile, create_user,
        valid_identifier, validate_user_fields, validated_hash,
    },
    signaling::SignalingState,
};
use argon2::{Argon2, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Path, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{File, OpenOptions},
    io::{Read, Write},
    net::IpAddr,
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, watch};

const MAX_DOCUMENT_BYTES: usize = MAX_USERS_FILE_BYTES + 32_768;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminDocument {
    version: u16,
    users: Vec<User>,
    blocked_rooms: HashSet<String>,
}

impl AdminDocument {
    pub fn load_or_seed(path: &std::path::Path, seed: &str) -> Result<Self, &'static str> {
        let document = match File::open(path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take((MAX_DOCUMENT_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "cannot read panel data")?;
                if bytes.len() > MAX_DOCUMENT_BYTES {
                    return Err("panel data too large");
                }
                serde_json::from_slice(&bytes).map_err(|_| "invalid panel data")?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let file: UsersFile =
                    serde_json::from_str(seed).map_err(|_| "invalid account seed")?;
                let document = Self {
                    version: file.version,
                    users: file.users,
                    blocked_rooms: HashSet::new(),
                };
                document.store()?;
                document.save(path)?;
                document
            }
            Err(_) => return Err("cannot open panel data"),
        };
        document.store()?;
        Ok(document)
    }

    pub fn store(&self) -> Result<InviteStore, &'static str> {
        if self.version != 1
            || self.blocked_rooms.len() > 256
            || self
                .blocked_rooms
                .iter()
                .any(|room| !valid_identifier(room))
        {
            return Err("invalid panel room policy");
        }
        let bytes = serde_json::to_vec(&UsersFile {
            version: 1,
            users: self.users.clone(),
        })
        .map_err(|_| "invalid account policy")?;
        Ok(InviteStore::from_users_bytes(&bytes)?.with_blocked_rooms(self.blocked_rooms.clone()))
    }

    fn save(&self, path: &std::path::Path) -> Result<(), &'static str> {
        let bytes = serde_json::to_vec(self).map_err(|_| "cannot encode panel data")?;
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err("panel data too large");
        }
        let parent = path.parent().ok_or("invalid panel data path")?;
        let temporary = parent.join(format!(".policy-{}", crate::auth::random_identifier()?));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)
                .map_err(|_| "cannot create panel data")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "cannot write panel data")?;
            std::fs::rename(&temporary, path).map_err(|_| "cannot replace panel data")?;
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "cannot sync panel data")
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    }
}

/// Exactly USER:ARGON2ID_PHC_HASH pairs separated by semicolons. Never Debug.
pub fn parse_credentials(value: &str) -> Result<HashMap<String, String>, &'static str> {
    if value.is_empty() || value.len() > 16_384 {
        return Err("invalid DASS_ADMIN_USERS");
    }
    let mut users = HashMap::new();
    for entry in value.split(';') {
        let (username, hash) = entry.split_once(':').ok_or("invalid DASS_ADMIN_USERS")?;
        if !valid_identifier(username) || users.len() >= 32 {
            return Err("invalid DASS_ADMIN_USERS");
        }
        validated_hash(hash).map_err(|_| "invalid DASS_ADMIN_USERS hash")?;
        if users.insert(username.to_owned(), hash.to_owned()).is_some() {
            return Err("duplicate administrator");
        }
    }
    Ok(users)
}

#[derive(Clone)]
pub struct AdminState {
    credentials: Arc<HashMap<String, String>>,
    document: Arc<Mutex<AdminDocument>>,
    path: PathBuf,
    sender: watch::Sender<Arc<InviteStore>>,
    signaling: SignalingState,
    workers: Arc<Semaphore>,
    rate: Arc<Mutex<(Instant, usize)>>,
}

impl AdminState {
    pub fn new(
        credentials: HashMap<String, String>,
        document: AdminDocument,
        path: PathBuf,
        sender: watch::Sender<Arc<InviteStore>>,
        signaling: SignalingState,
    ) -> Self {
        Self {
            credentials: Arc::new(credentials),
            document: Arc::new(Mutex::new(document)),
            path,
            sender,
            signaling,
            workers: Arc::new(Semaphore::new(2)),
            rate: Arc::new(Mutex::new((Instant::now(), 0))),
        }
    }

    fn update(
        &self,
        change: impl FnOnce(&mut AdminDocument) -> Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        let mut current = self
            .document
            .lock()
            .map_err(|_| "panel policy unavailable")?;
        let mut next = current.clone();
        change(&mut next)?;
        let store = next.store()?;
        if let Err(error) = next.save(&self.path) {
            // A rename may already have committed: never keep authorizing stale policy.
            self.sender.send_replace(Arc::new(InviteStore::default()));
            return Err(error);
        }
        *current = next;
        // Existing sessions close and release RTC-owned endpoint admissions.
        self.sender.send_replace(Arc::new(store));
        Ok(())
    }
}

pub fn router(state: AdminState) -> Router {
    Router::new()
        .route("/admin", get(page))
        .route("/admin/users", get(page))
        .route("/admin/rooms", get(page))
        .route("/admin/streams", get(page))
        .route("/admin/app.js", get(script))
        .route("/admin/style.css", get(stylesheet))
        .route("/admin/api/users", get(users))
        .route(
            "/admin/api/users/{username}",
            axum::routing::put(save_user).delete(remove_user),
        )
        .route("/admin/api/status", get(status))
        .route("/admin/api/rooms/{room_id}", axum::routing::put(save_room))
        .route("/admin/api/disconnect", post(disconnect))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .with_state(state)
}

async fn page() -> Html<&'static str> {
    Html(include_str!("admin/index.html"))
}

async fn script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("admin/app.js"),
    )
}

async fn stylesheet() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("admin/style.css"),
    )
}

// Strict, bounded RFC 4648 decoding of the Basic header; not cryptography.
fn basic_credentials(value: &str) -> Option<(String, String)> {
    let (scheme, encoded) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("Basic")
        || encoded.len() > 1024
        || encoded.is_empty()
        || !encoded.len().is_multiple_of(4)
    {
        return None;
    }
    let mut bytes = Vec::new();
    for (index, chunk) in encoded.as_bytes().chunks_exact(4).enumerate() {
        let digit = |byte| match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        };
        let a = digit(chunk[0])?;
        let b = digit(chunk[1])?;
        bytes.push(a << 2 | b >> 4);
        if chunk[2] == b'=' {
            if chunk[3] != b'=' || b & 15 != 0 || index + 1 != encoded.len() / 4 {
                return None;
            }
        } else {
            let c = digit(chunk[2])?;
            bytes.push(b << 4 | c >> 2);
            if chunk[3] == b'=' {
                if c & 3 != 0 || index + 1 != encoded.len() / 4 {
                    return None;
                }
            } else {
                bytes.push(c << 6 | digit(chunk[3])?);
            }
        }
    }
    let decoded = String::from_utf8(bytes).ok()?;
    let (username, password) = decoded.split_once(':')?;
    if !valid_identifier(username)
        || password.is_empty()
        || password.len() > 512
        || password.chars().any(char::is_control)
    {
        return None;
    }
    Some((username.to_owned(), password.to_owned()))
}

async fn authenticate(State(state): State<AdminState>, request: Request, next: Next) -> Response {
    let mut response = authenticate_inner(state, request, next).await;
    for (name, value) in [
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("referrer-policy", "no-referrer"),
        ("x-frame-options", "DENY"),
        (
            "content-security-policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        ),
    ] {
        response.headers_mut().insert(
            axum::http::HeaderName::from_static(name),
            axum::http::HeaderValue::from_static(value),
        );
    }
    response
}

async fn authenticate_inner(state: AdminState, request: Request, next: Next) -> Response {
    // Custom non-simple header + JSON writes require a same-origin JS request.
    // No admin CORS/preflight grants; Basic browser credentials alone cannot CSRF.
    let cross_site = request
        .headers()
        .get("sec-fetch-site")
        .is_some_and(|site| site == "cross-site");
    let write_request =
        request.method() != axum::http::Method::GET && request.method() != axum::http::Method::HEAD;
    let valid_write_headers = request
        .headers()
        .get("x-dass-admin")
        .is_some_and(|value| value == "1")
        && request
            .headers()
            .get(header::CONTENT_TYPE)
            .is_some_and(|value| value == "application/json");
    if cross_site || (write_request && !valid_write_headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request
        .headers()
        .get_all(header::AUTHORIZATION)
        .iter()
        .count()
        != 1
    {
        return challenge();
    }
    let credentials = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(basic_credentials);
    let Some((username, password)) = credentials else {
        return challenge();
    };
    {
        let Ok(mut rate) = state.rate.lock() else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };
        if rate.0.elapsed() >= Duration::from_secs(1) {
            *rate = (Instant::now(), 0);
        }
        if rate.1 >= 8 {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        rate.1 += 1;
    }
    let Ok(permit) = state.workers.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let users = state.credentials.clone();
    let verified = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        users
            .get(&username)
            .and_then(|hash| validated_hash(hash).ok())
            .is_some_and(|hash| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &hash)
                    .is_ok()
            })
    })
    .await
    .unwrap_or(false);
    if !verified {
        return challenge();
    }
    next.run(request).await
}

fn challenge() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(
            header::WWW_AUTHENTICATE,
            "Basic realm=\"DASS administration\", charset=\"UTF-8\"",
        )],
    )
        .into_response()
}

async fn users(State(state): State<AdminState>) -> Response {
    let Ok(document) = state.document.try_lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let users: Vec<_> = document.users.iter().map(|user| serde_json::json!({
        "username": user.username, "display_name": user.display_name, "expires_at_unix_seconds": user.expires_at_unix_seconds,
        "revoked": user.revoked, "rooms": user.rooms, "allowed_ips": user.allowed_ips,
    })).collect();
    Json(users).into_response()
}

async fn status(State(state): State<AdminState>) -> Response {
    let Ok(mut snapshot) = state.signaling.admin_snapshot() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(document) = state.document.try_lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    snapshot["blocked_rooms"] = serde_json::json!(document.blocked_rooms);
    snapshot["configured_rooms"] = serde_json::json!(
        document
            .users
            .iter()
            .flat_map(|user| user.rooms.iter())
            .filter(|grant| grant.room_id != "*")
            .map(|grant| &grant.room_id)
            .collect::<HashSet<_>>()
    );
    Json(snapshot).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UserEdit {
    password: Option<String>,
    display_name: Option<String>,
    expires_at_unix_seconds: u32,
    revoked: bool,
    rooms: Vec<RoomGrant>,
    allowed_ips: Vec<IpAddr>,
}

async fn save_user(
    State(state): State<AdminState>,
    Path(username): Path<String>,
    Json(edit): Json<UserEdit>,
) -> Response {
    if let Err(error) = validate_user_fields(
        &username,
        edit.display_name.as_deref(),
        &edit.rooms,
        edit.expires_at_unix_seconds,
        &edit.allowed_ips,
    ) {
        return (StatusCode::BAD_REQUEST, error).into_response();
    }
    mutate(state, move |document| {
        let position = document
            .users
            .iter()
            .position(|user| user.username == username);
        if position.is_none() && document.users.len() >= MAX_USERS {
            return Err("account limit reached");
        }
        let mut user = if let Some(password) = edit.password.filter(|password| !password.is_empty())
        {
            create_user(
                username,
                &password,
                edit.display_name.clone(),
                edit.rooms.clone(),
                edit.expires_at_unix_seconds,
            )?
        } else {
            position
                .map(|index| document.users[index].clone())
                .ok_or("new users require a password")?
        };
        user.display_name = edit.display_name;
        user.expires_at_unix_seconds = edit.expires_at_unix_seconds;
        user.revoked = edit.revoked;
        user.rooms = edit.rooms;
        user.allowed_ips = edit.allowed_ips;
        if let Some(index) = position {
            document.users[index] = user;
        } else {
            document.users.push(user);
        }
        Ok(())
    })
    .await
}

async fn remove_user(State(state): State<AdminState>, Path(username): Path<String>) -> Response {
    mutate(state, move |document| {
        let index = document
            .users
            .iter()
            .position(|user| user.username == username)
            .ok_or("user not found")?;
        document.users.remove(index);
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RoomEdit {
    blocked: bool,
}

async fn save_room(
    State(state): State<AdminState>,
    Path(room_id): Path<String>,
    Json(edit): Json<RoomEdit>,
) -> Response {
    if !valid_identifier(&room_id) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    mutate(state, move |document| {
        if edit.blocked {
            document.blocked_rooms.insert(room_id);
        } else {
            document.blocked_rooms.remove(&room_id);
        }
        Ok(())
    })
    .await
}

async fn disconnect(State(state): State<AdminState>) -> Response {
    mutate(state, |_| Ok(())).await
}

async fn mutate(
    state: AdminState,
    change: impl FnOnce(&mut AdminDocument) -> Result<(), &'static str> + Send + 'static,
) -> Response {
    let Ok(permit) = state.workers.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        state.update(change)
    })
    .await
    {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use tower::ServiceExt;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "dass-panel-test-{}",
                crate::auth::random_identifier().unwrap()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0.join("policy.json"));
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    fn fixture() -> (TestDirectory, AdminState, watch::Receiver<Arc<InviteStore>>) {
        let directory = TestDirectory::new();
        let path = directory.0.join("policy.json");
        let document = AdminDocument::load_or_seed(&path, r#"{"version":1,"users":[]}"#).unwrap();
        let (sender, receiver) = watch::channel(Arc::new(document.store().unwrap()));
        let user = create_user(
            "admin".into(),
            "a long admin password",
            None,
            vec![],
            u32::MAX,
        )
        .unwrap();
        let state = AdminState::new(
            HashMap::from([("admin".into(), user.password_hash)]),
            document,
            path,
            sender,
            SignalingState::new(receiver.clone()),
        );
        (directory, state, receiver)
    }

    fn request(path: &str, method: &str, auth: bool, body: &str) -> Request {
        let mut request = axum::http::Request::builder().uri(path).method(method);
        if auth {
            request = request.header(
                header::AUTHORIZATION,
                "Basic YWRtaW46YSBsb25nIGFkbWluIHBhc3N3b3Jk",
            );
        }
        if method != "GET" {
            request = request
                .header("x-dass-admin", "1")
                .header(header::CONTENT_TYPE, "application/json");
        }
        request.body(Body::from(body.to_owned())).unwrap()
    }

    #[tokio::test]
    async fn all_pages_assets_and_api_require_basic_auth() {
        let (_directory, state, _) = fixture();
        let app = router(state);
        for path in [
            "/admin",
            "/admin/users",
            "/admin/rooms",
            "/admin/streams",
            "/admin/app.js",
            "/admin/style.css",
            "/admin/api/users",
            "/admin/api/status",
        ] {
            let response = app
                .clone()
                .oneshot(request(path, "GET", false, ""))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert!(response.headers().contains_key(header::WWW_AUTHENTICATE));
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }
        let response = app
            .oneshot(request("/admin/users", "GET", true, ""))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("content-security-policy"));
    }

    #[tokio::test]
    async fn browser_credentials_alone_cannot_write_cross_origin() {
        let (_directory, state, _) = fixture();
        let app = router(state);
        let mut missing_header = request("/admin/api/disconnect", "POST", true, "{}");
        missing_header.headers_mut().remove("x-dass-admin");
        assert_eq!(
            app.clone().oneshot(missing_header).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let mut cross_site = request("/admin/api/disconnect", "POST", true, "{}");
        cross_site
            .headers_mut()
            .insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert_eq!(
            app.clone().oneshot(cross_site).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.oneshot(request("/admin/api/disconnect", "POST", false, "{}"))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn short_password_returns_an_actionable_error_without_changing_policy() {
        let (directory, state, receiver) = fixture();
        let app = router(state);
        let edit = serde_json::json!({
            "password": "short-value", "display_name": "Test", "expires_at_unix_seconds": u32::MAX,
            "revoked": false, "allowed_ips": [],
            "rooms": [{"room_id": "*", "access": true, "publish": true, "subscribe": true}]
        });
        let response = app
            .clone()
            .oneshot(request(
                "/admin/api/users/test",
                "PUT",
                true,
                &edit.to_string(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            std::str::from_utf8(&body).unwrap(),
            "Password must contain 12–512 UTF-8 bytes."
        );
        assert!(!receiver.has_changed().unwrap());
        let restored = AdminDocument::load_or_seed(
            &directory.0.join("policy.json"),
            r#"{"version":1,"users":[]}"#,
        )
        .unwrap();
        assert!(restored.users.is_empty());
    }

    #[tokio::test]
    async fn account_crud_persists_without_exposing_passwords_and_notifies_sessions() {
        let (directory, state, mut receiver) = fixture();
        let app = router(state);
        let edit = serde_json::json!({"password":"a long user password", "display_name":"Alice", "expires_at_unix_seconds":u32::MAX,
            "revoked":false, "rooms":[{"room_id":"room_1","access":true,"publish":true,"subscribe":true}], "allowed_ips":["192.168.1.20"]});
        let response = app
            .clone()
            .oneshot(request(
                "/admin/api/users/alice",
                "PUT",
                true,
                &edit.to_string(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(receiver.has_changed().unwrap());
        let store = receiver.borrow_and_update().clone();
        assert!(
            store
                .verify_account("alice", "a long user password", 99)
                .is_ok()
        );
        assert!(!store.permits_ip("alice", Some("192.168.1.21".parse().unwrap())));
        let response = app
            .clone()
            .oneshot(request("/admin/api/users", "GET", true, ""))
            .await
            .unwrap();
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(!text.contains("password"));
        assert!(!text.contains("argon2"));
        let restored = AdminDocument::load_or_seed(
            &directory.0.join("policy.json"),
            r#"{"version":1,"users":[]}"#,
        )
        .unwrap();
        assert!(
            restored
                .store()
                .unwrap()
                .verify_account("alice", "a long user password", 99)
                .is_ok()
        );
        let mut edit = edit;
        edit["password"] = serde_json::Value::Null;
        edit["revoked"] = true.into();
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "/admin/api/users/alice",
                    "PUT",
                    true,
                    &edit.to_string()
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(
            receiver
                .borrow_and_update()
                .verify_account("alice", "a long user password", 99)
                .is_err()
        );
        assert_eq!(
            app.oneshot(request("/admin/api/users/alice", "DELETE", true, ""))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(
            AdminDocument::load_or_seed(
                &directory.0.join("policy.json"),
                r#"{"version":1,"users":[]}"#
            )
            .unwrap()
            .users
            .is_empty()
        );
    }

    #[tokio::test]
    async fn room_blocks_persist_and_disconnect_notifications_are_explicit() {
        let (directory, state, mut receiver) = fixture();
        let app = router(state);
        let response = app
            .clone()
            .oneshot(request(
                "/admin/api/rooms/room_1",
                "PUT",
                true,
                r#"{"blocked":true}"#,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(receiver.has_changed().unwrap());
        receiver.borrow_and_update();
        let restored = AdminDocument::load_or_seed(
            &directory.0.join("policy.json"),
            r#"{"version":1,"users":[]}"#,
        )
        .unwrap();
        assert!(restored.blocked_rooms.contains("room_1"));
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "/admin/api/rooms/room_1",
                    "PUT",
                    true,
                    r#"{"blocked":false}"#
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        receiver.borrow_and_update();
        assert!(!receiver.has_changed().unwrap());
        assert_eq!(
            // Keep the router's watch sender alive through the notification assertion.
            app.clone()
                .oneshot(request("/admin/api/disconnect", "POST", true, "{}"))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(receiver.has_changed().unwrap());
    }

    #[test]
    fn corrupt_persistent_policy_is_not_replaced_with_environment_seed() {
        let directory = TestDirectory::new();
        let path = directory.0.join("policy.json");
        std::fs::write(&path, "not-json").unwrap();
        assert!(AdminDocument::load_or_seed(&path, r#"{"version":1,"users":[]}"#).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "not-json");
    }

    #[test]
    fn basic_decoder_is_strict_bounded_and_preserves_password_colons() {
        assert_eq!(
            basic_credentials("Basic YWxpY2U6cGFzczp3b3Jk").unwrap(),
            ("alice".into(), "pass:word".into())
        );
        assert_eq!(
            basic_credentials("basic YTpi").unwrap(),
            ("a".into(), "b".into())
        );
        for header in [
            "Bearer YTpi",
            "Basic YTpi====",
            "Basic YT=p",
            "Basic YTph=AAA",
            "Basic YTo=",
            "Basic /w==",
            "Basic YTpi\n",
            "Basic YTphAA==",
        ] {
            assert!(basic_credentials(header).is_none(), "{header}");
        }
    }

    #[test]
    fn admin_hashes_require_fixed_cost_and_unique_identities() {
        let user = create_user(
            "admin".into(),
            "a long admin password",
            None,
            vec![],
            u32::MAX,
        )
        .unwrap();
        let pair = format!("admin:{}", user.password_hash);
        assert_eq!(parse_credentials(&pair).unwrap().len(), 1);
        for input in [
            "".to_owned(),
            "admin:plaintext".into(),
            format!("{pair};{pair}"),
            format!("{pair};"),
            pair.replace("m=19456", "m=999999"),
        ] {
            assert!(parse_credentials(&input).is_err());
        }
    }
}
