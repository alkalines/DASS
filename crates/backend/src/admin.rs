//! Optional, separate administrator credentials and durable account policy.
//! No Discord credentials, media bypass, or external control-plane service.

use crate::{
    auth::{
        InviteStore, MAX_USERS, User, UsersFile, create_user,
        valid_identifier, validate_user_fields, validated_hash,
    },
    signaling::SignalingState,
    database::{Database, Settings},
};
use argon2::{Argon2, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Extension, Path, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, watch};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdminDocument {
    version: u16,
    pub(crate) users: Vec<User>,
}

impl AdminDocument {
    pub fn empty() -> Self { Self::from_users(Vec::new()) }

    pub fn from_users(users: Vec<User>) -> Self { Self { version: 2, users } }

    /// Initialize/open SQLite; the seed is consulted only for a new database.
    pub fn load_or_seed(path: &std::path::Path, seed: &str) -> Result<Self, &'static str> {
        Database::open(path.to_path_buf(), |key| (key == "DASS_USERS").then(|| seed.to_owned()))?.document()
    }

    pub fn store(&self) -> Result<InviteStore, &'static str> {
        // Version 2 removes room grants and the removed login controls; older
        // documents fail closed rather than silently changing access.
        if self.version != 2 {
            return Err("invalid panel data version");
        }
        let bytes = serde_json::to_vec(&UsersFile {
            version: 2,
            users: self.users.clone(),
        })
        .map_err(|_| "invalid account policy")?;
        InviteStore::from_users_bytes(&bytes)
    }

    fn save(&self, path: &std::path::Path) -> Result<(), &'static str> {
        Database::existing(path.to_path_buf())?.save_document(self)
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
    document: Arc<Mutex<AdminDocument>>,
    path: PathBuf,
    sender: watch::Sender<Arc<InviteStore>>,
    signaling: SignalingState,
    workers: Arc<Semaphore>,
    rate: Arc<Mutex<(Instant, usize)>>,
    running_settings: Option<Settings>,
}

impl AdminState {
    pub fn new(
        document: AdminDocument,
        path: PathBuf,
        sender: watch::Sender<Arc<InviteStore>>,
        signaling: SignalingState,
    ) -> Self {
        let running_settings = Database::existing(path.clone()).and_then(|db| db.settings()).ok();
        let password_workers = running_settings.as_ref()
            .and_then(|settings| settings.0.get("DASS_MAX_PASSWORD_VERIFICATIONS"))
            .and_then(|value| value.parse().ok()).unwrap_or(2);
        Self {
            document: Arc::new(Mutex::new(document)),
            path,
            sender,
            signaling,
            workers: Arc::new(Semaphore::new(password_workers)),
            rate: Arc::new(Mutex::new((Instant::now(), 0))),
            running_settings,
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
            // A commit error may be ambiguous: never authorize stale policy.
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
        .route("/admin/settings", get(page))
        .route("/admin/administrators", get(page))
        .route("/admin/app.js", get(script))
        .route("/admin/style.css", get(stylesheet))
        .route("/admin/api/users", get(users))
        .route(
            "/admin/api/users/{username}",
            axum::routing::put(save_user).delete(remove_user),
        )
        .route("/admin/api/status", get(status))
        .route("/admin/api/settings", get(settings).put(save_settings))
        .route("/admin/api/administrators", get(administrators))
        .route("/admin/api/administrators/{username}", axum::routing::put(save_administrator).delete(remove_administrator))
        .route("/admin/api/disconnect", post(disconnect))
        .route(
            "/admin/api/sessions/{session_id}/disconnect",
            post(disconnect_session),
        )
        .route("/admin/api/streams/{publisher_id}/stop", post(stop_stream))
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

// No Debug/Serialize: the hash is retained only to reject stale administrative
// writes if the actor is reset or removed while a request is in flight.
#[derive(Clone)]
struct AdminIdentity {
    username: String,
    password_hash: String,
    must_change_password: bool,
}

async fn authenticate_inner(state: AdminState, mut request: Request, next: Next) -> Response {
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
    let path = state.path.clone();
    let verified = tokio::task::spawn_blocking(move || -> Result<Option<AdminIdentity>, &'static str> {
        let _permit = permit;
        let database = Database::existing(path)?;
        let Some((password_hash, must_change_password)) = database.administrator(&username)? else { return Ok(None); };
        let hash = validated_hash(&password_hash)?;
        if Argon2::default().verify_password(password.as_bytes(), &hash).is_err() {
            return Ok(None);
        }
        // A credential removed/reset during verification cannot authorize this request.
        if database.administrator(&username)? != Some((password_hash.clone(), must_change_password)) {
            return Ok(None);
        }
        Ok(Some(AdminIdentity { username, password_hash, must_change_password }))
    })
    .await;
    let identity = match verified {
        Ok(Ok(Some(identity))) => identity,
        Ok(Ok(None)) => return challenge(),
        _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    if identity.must_change_password {
        let path = request.uri().path();
        let setup_asset = request.method() == axum::http::Method::GET
            && matches!(path, "/admin/administrators" | "/admin/app.js" | "/admin/style.css" | "/admin/api/administrators");
        let own_password_change = request.method() == axum::http::Method::PUT
            && path == format!("/admin/api/administrators/{}", identity.username);
        if !setup_asset && !own_password_change {
            if path.starts_with("/admin/api/") {
                return (StatusCode::FORBIDDEN, "change the initial administrator password first").into_response();
            }
            return Redirect::temporary("/admin/administrators").into_response();
        }
    }
    request.extensions_mut().insert(identity);
    next.run(request).await
}

async fn administrators(State(state): State<AdminState>, Extension(identity): Extension<AdminIdentity>) -> Response {
    match tokio::task::spawn_blocking(move || Database::existing(state.path)?.administrators()).await {
        Ok(Ok(administrators)) => Json(serde_json::json!({
            "current_username": identity.username,
            "must_change_password": identity.must_change_password,
            "administrators": administrators.into_iter().map(|(username, must_change_password)| serde_json::json!({ "username": username, "must_change_password": must_change_password })).collect::<Vec<_>>(),
        })).into_response(),
        _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AdministratorEdit { password: String }

async fn save_administrator(State(state): State<AdminState>, Extension(identity): Extension<AdminIdentity>, Path(username): Path<String>, Json(edit): Json<AdministratorEdit>) -> Response {
    edit_administrator(state, identity, username, Some(edit.password)).await
}

async fn remove_administrator(State(state): State<AdminState>, Extension(identity): Extension<AdminIdentity>, Path(username): Path<String>) -> Response {
    edit_administrator(state, identity, username, None).await
}

async fn edit_administrator(state: AdminState, identity: AdminIdentity, username: String, password: Option<String>) -> Response {
    let Ok(permit) = state.workers.clone().try_acquire_owned() else { return StatusCode::SERVICE_UNAVAILABLE.into_response(); };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        Database::existing(state.path)?.edit_administrator(&identity.username, &identity.password_hash, &username, password.as_deref())
    }).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
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
    let users: Vec<_> = document
        .users
        .iter()
        .map(|user| {
            serde_json::json!({
                "username": user.username, "display_name": user.display_name,
            })
        })
        .collect();
    Json(users).into_response()
}

async fn status(State(state): State<AdminState>) -> Response {
    let Ok(snapshot) = state.signaling.admin_snapshot() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    Json(snapshot).into_response()
}

async fn settings(State(state): State<AdminState>) -> Response {
    match tokio::task::spawn_blocking(move || {
        let saved = Database::existing(state.path)?.settings()?;
        let active = state.running_settings.ok_or("running settings unavailable")?;
        Ok::<_, &'static str>(serde_json::json!({
            "restart_required": saved != active,
            "saved": saved, "active": active,
            "read_only": Settings::read_only_keys(),
        }))
    }).await {
        Ok(Ok(value)) => Json(value).into_response(),
        _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn save_settings(State(state): State<AdminState>, Json(settings): Json<Settings>) -> Response {
    let Ok(permit) = state.workers.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        Database::existing(state.path)?.save_settings(&settings)
    }).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => (StatusCode::BAD_REQUEST, error).into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UserEdit {
    password: Option<String>,
    display_name: Option<String>,
}

async fn save_user(
    State(state): State<AdminState>,
    Path(username): Path<String>,
    Json(edit): Json<UserEdit>,
) -> Response {
    if let Err(error) = validate_user_fields(&username, edit.display_name.as_deref()) {
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
            create_user(username, &password, edit.display_name.clone())?
        } else {
            position
                .map(|index| document.users[index].clone())
                .ok_or("new users require a password")?
        };
        user.display_name = edit.display_name;
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

async fn disconnect(State(state): State<AdminState>) -> Response {
    mutate(state, |_| Ok(())).await
}

/// Close one live session. The panel may end a session; it never gains the
/// ability to receive the stream it stopped.
async fn disconnect_session(
    State(state): State<AdminState>,
    Path(session_id): Path<String>,
) -> Response {
    if session_id.is_empty() || session_id.len() > 128 {
        return (StatusCode::BAD_REQUEST, "invalid session").into_response();
    }
    match state.signaling.disconnect_session(&session_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err("session not found") => (StatusCode::NOT_FOUND, "session not found").into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, error).into_response(),
    }
}

/// Stop one publisher's stream. The publisher's teardown ends its approved
/// viewer routes with it.
async fn stop_stream(
    State(state): State<AdminState>,
    Path(publisher_id): Path<String>,
) -> Response {
    if publisher_id.is_empty() || publisher_id.len() > 128 {
        return (StatusCode::BAD_REQUEST, "invalid stream").into_response();
    }
    match state.signaling.stop_stream(&publisher_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err("stream not found") => (StatusCode::NOT_FOUND, "stream not found").into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, error).into_response(),
    }
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
        fixture_with_bootstrap(false)
    }

    fn fixture_with_bootstrap(bootstrap: bool) -> (TestDirectory, AdminState, watch::Receiver<Arc<InviteStore>>) {
        let directory = TestDirectory::new();
        let path = directory.0.join("policy.json");
        let document = AdminDocument::load_or_seed(&path, r#"{"version":2,"users":[]}"#).unwrap();
        let (sender, receiver) = watch::channel(Arc::new(document.store().unwrap()));
        if !bootstrap {
            let user = create_user("admin".into(), "a long admin password", None).unwrap();
            Database::existing(path.clone()).unwrap().provision(user, true).unwrap();
        }
        let state = AdminState::new(
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
            "/admin/settings",
            "/admin/administrators",
            "/admin/app.js",
            "/admin/style.css",
            "/admin/api/users",
            "/admin/api/status",
            "/admin/api/settings",
            "/admin/api/administrators",
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
            "password": "short-value", "display_name": "Test"
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
            r#"{"version":2,"users":[]}"#,
        )
        .unwrap();
        assert!(restored.users.is_empty());
    }

    #[tokio::test]
    async fn account_crud_persists_without_exposing_passwords_and_notifies_sessions() {
        let (directory, state, mut receiver) = fixture();
        let app = router(state);
        let edit = serde_json::json!({"password":"a long user password", "display_name":"Alice"});
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
                .verify_account("alice", "a long user password")
                .is_ok()
        );
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
            r#"{"version":2,"users":[]}"#,
        )
        .unwrap();
        assert!(
            restored
                .store()
                .unwrap()
                .verify_account("alice", "a long user password")
                .is_ok()
        );
        // Password reset replaces the credential and closes live sessions.
        let mut edit = edit;
        edit["password"] = serde_json::json!("a better user password");
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
        let store = receiver.borrow_and_update().clone();
        assert!(
            store
                .verify_account("alice", "a long user password")
                .is_err()
        );
        assert!(
            store
                .verify_account("alice", "a better user password")
                .is_ok()
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
                r#"{"version":2,"users":[]}"#
            )
            .unwrap()
            .users
            .is_empty()
        );
    }

    #[tokio::test]
    async fn disconnect_notifications_are_explicit_and_room_controls_are_gone() {
        let (_directory, state, receiver) = fixture();
        let app = router(state);
        // Room block/unblock controls were removed with room authority; rooms
        // are a read-only grouping view.
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "/admin/api/rooms/room_1",
                    "PUT",
                    true,
                    r#"{"blocked":true}"#,
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
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

    #[tokio::test]
    async fn stream_and_session_actions_require_authentication_and_a_known_id() {
        let (_directory, state, _) = fixture();
        let app = router(state);
        for path in [
            "/admin/api/sessions/missing/disconnect",
            "/admin/api/streams/missing/stop",
        ] {
            // Unauthenticated writes never reach the session owner.
            assert_eq!(
                app.clone()
                    .oneshot(request(path, "POST", false, "{}"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::UNAUTHORIZED
            );
            // An authenticated action for an unknown session or stream is refused.
            assert_eq!(
                app.clone()
                    .oneshot(request(path, "POST", true, "{}"))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NOT_FOUND
            );
        }
    }

    #[test]
    fn corrupt_persistent_policy_is_not_replaced_with_environment_seed() {
        let directory = TestDirectory::new();
        let path = directory.0.join("policy.json");
        std::fs::write(&path, "not-json").unwrap();
        assert!(AdminDocument::load_or_seed(&path, r#"{"version":2,"users":[]}"#).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "not-json");
    }

    #[test]
    fn legacy_policy_documents_fail_closed_instead_of_silent_migration() {
        let directory = TestDirectory::new();
        let path = directory.0.join("policy.json");
        // Version-1 documents carried room grants, expiration, revocation and
        // login IP allowlists. They must not be reinterpreted or widened.
        for body in [
            r#"{"version":1,"users":[],"blocked_rooms":[]}"#,
            r#"{"version":2,"users":[],"blocked_rooms":[]}"#,
        ] {
            std::fs::write(&path, body).unwrap();
            assert!(AdminDocument::load_or_seed(&path, r#"{"version":2,"users":[]}"#).is_err());
        }
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
        let user = create_user("admin".into(), "a long admin password", None).unwrap();
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

    #[tokio::test]
    async fn settings_persist_atomically_report_restart_and_cannot_enable_anonymous_access() {
        let (directory, state, receiver) = fixture();
        let database = Database::existing(directory.0.join("policy.json")).unwrap();
        let original = database.settings().unwrap();
        let app = router(state);
        let response = app.clone().oneshot(request("/admin/api/settings", "GET", true, "")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 16_384).await.unwrap();
        let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshot["restart_required"], false);
        assert_eq!(snapshot["saved"]["DASS_MAX_UNAUTHENTICATED_SESSIONS"], "0");
        let mut changed = original.clone();
        changed.0.insert("DASS_MAX_SESSIONS".into(), "64".into());
        let response = app.clone().oneshot(request("/admin/api/settings", "PUT", true, &serde_json::to_string(&changed).unwrap())).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(database.settings().unwrap().0["DASS_MAX_SESSIONS"], "64");
        assert!(!receiver.has_changed().unwrap()); // no hot reload/disconnection
        let response = app.clone().oneshot(request("/admin/api/settings", "GET", true, "")).await.unwrap();
        let body = to_bytes(response.into_body(), 16_384).await.unwrap();
        let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshot["restart_required"], true);
        assert_eq!(snapshot["active"]["DASS_MAX_SESSIONS"], "128");
        for (key, value) in [("DASS_MAX_UNAUTHENTICATED_SESSIONS", "1"), ("DASS_ADMIN_DATA_FILE", "/elsewhere"), ("DASS_MAX_SESSIONS", "0")] {
            let mut invalid = changed.clone();
            invalid.0.insert(key.into(), value.into());
            let response = app.clone().oneshot(request("/admin/api/settings", "PUT", true, &serde_json::to_string(&invalid).unwrap())).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert!(database.settings().unwrap() == changed);
        }
    }

    fn with_authorization(mut request: Request, value: &'static str) -> Request {
        request.headers_mut().insert(header::AUTHORIZATION, value.parse().unwrap());
        request
    }

    #[tokio::test]
    async fn default_login_only_allows_setup_until_a_strong_password_is_saved() {
        let (_directory, state, _) = fixture_with_bootstrap(true);
        let app = router(state);
        let default_request = |path: &str, method: &str, body: &str| with_authorization(request(path, method, true, body), "Basic YWRtaW46YWRtaW4=");
        let response = app.clone().oneshot(default_request("/admin/users", "GET", "")).await.unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(response.headers()[header::LOCATION], "/admin/administrators");
        assert_eq!(app.clone().oneshot(default_request("/admin/api/status", "GET", "")).await.unwrap().status(), StatusCode::FORBIDDEN);
        let response = app.clone().oneshot(default_request("/admin/api/administrators", "GET", "")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let text = std::str::from_utf8(&bytes).unwrap();
        assert!(!text.contains("argon2"));
        assert!(!text.contains("password_hash"));
        let snapshot: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(snapshot["must_change_password"], true);
        assert_eq!(app.clone().oneshot(default_request("/admin/api/administrators/other", "PUT", r#"{"password":"a long other password"}"#)).await.unwrap().status(), StatusCode::FORBIDDEN);
        assert_eq!(app.clone().oneshot(default_request("/admin/api/administrators/admin", "PUT", r#"{"password":"admin"}"#)).await.unwrap().status(), StatusCode::BAD_REQUEST);
        assert_eq!(app.clone().oneshot(default_request("/admin/api/administrators/admin", "PUT", r#"{"password":"a long admin password"}"#)).await.unwrap().status(), StatusCode::NO_CONTENT);
        assert_eq!(app.clone().oneshot(default_request("/admin/api/administrators", "GET", "")).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        assert_eq!(app.oneshot(request("/admin/api/status", "GET", true, "")).await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn administrator_crud_guards_last_admin_and_revokes_old_passwords_without_restart() {
        let (directory, state, receiver) = fixture();
        let app = router(state);
        assert_eq!(app.clone().oneshot(request("/admin/api/administrators/admin", "DELETE", true, "{}")).await.unwrap().status(), StatusCode::BAD_REQUEST);
        assert_eq!(app.clone().oneshot(request("/admin/api/administrators/other", "PUT", true, r#"{"password":"a long other password"}"#)).await.unwrap().status(), StatusCode::NO_CONTENT);
        assert_eq!(app.clone().oneshot(request("/admin/api/administrators/other", "DELETE", true, "{}")).await.unwrap().status(), StatusCode::NO_CONTENT);
        assert!(Database::existing(directory.0.join("policy.json")).unwrap().administrator("other").unwrap().is_none());
        assert_eq!(app.clone().oneshot(request("/admin/api/administrators/admin", "PUT", true, r#"{"password":"a new admin password"}"#)).await.unwrap().status(), StatusCode::NO_CONTENT);
        assert_eq!(app.clone().oneshot(request("/admin/api/status", "GET", true, "")).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let fresh = with_authorization(request("/admin/api/status", "GET", true, ""), "Basic YWRtaW46YSBuZXcgYWRtaW4gcGFzc3dvcmQ=");
        assert_eq!(app.clone().oneshot(fresh).await.unwrap().status(), StatusCode::OK);
        assert!(!receiver.has_changed().unwrap());
    }
}
