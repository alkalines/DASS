//! Authenticated control plane with an explicit one-publisher/one-viewer RTC spike.

use crate::auth::{InviteStore, Permission, random_identifier};
use crate::listener::PeerAddress;
use crate::rtc::{SpikeConfig, SpikePeer};
use axum::{
    Router,
    extract::{
        Extension, OriginalUri, State,
        connect_info::ConnectInfo,
        ws::{
            CloseFrame, Message, WebSocket, WebSocketUpgrade, rejection::WebSocketUpgradeRejection,
        },
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use dass_protocol::{
    PROTOCOL_VERSION,
    signaling::{
        ClientOperation, CloseReason, ErrorCode, LOGIN_DEADLINE_MS, MAX_DIRECTORY_SHARES,
        MAX_MESSAGE_BYTES, MAX_ROOM_MEMBERS, MAX_SESSIONS, PublisherMetadata, SETUP_DEADLINE_MS,
        ServerMessage, ServerOperation, parse_client_message,
    },
};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, watch},
    time::Instant,
};

const MAX_UNAUTHENTICATED_CONNECTIONS: usize = 16;
const MAX_REQUEST_IDS: usize = 256;
const MAX_MESSAGES_PER_SECOND: usize = 32;
const SEND_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub struct SignalingState {
    maximum_message_bytes: usize,
    invites: watch::Receiver<Arc<InviteStore>>,
    connections: Arc<Semaphore>,
    unauthenticated: Arc<Semaphore>,
    verifications: Arc<Semaphore>,
    active_invites: Arc<Mutex<HashSet<String>>>,
    rooms: Arc<Mutex<HashMap<String, usize>>>,
    publishers: Arc<Mutex<HashMap<String, PublisherEntry>>>,
    login_rate: Arc<Mutex<RateWindow>>,
    rtc_spike: Option<SpikeConfig>,
}

struct RateWindow {
    start: Instant,
    count: usize,
}

impl RateWindow {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            count: 0,
        }
    }
    fn admit(&mut self, maximum: usize) -> bool {
        if self.start.elapsed() >= Duration::from_secs(1) {
            self.start = Instant::now();
            self.count = 0;
        }
        if self.count >= maximum {
            return false;
        }
        self.count += 1;
        true
    }
}

impl SignalingState {
    pub fn new(invites: watch::Receiver<Arc<InviteStore>>) -> Self {
        Self {
            invites,
            maximum_message_bytes: MAX_MESSAGE_BYTES,
            connections: Arc::new(Semaphore::new(MAX_SESSIONS)),
            unauthenticated: Arc::new(Semaphore::new(MAX_UNAUTHENTICATED_CONNECTIONS)),
            verifications: Arc::new(Semaphore::new(2)),
            active_invites: Arc::new(Mutex::new(HashSet::new())),
            rooms: Arc::new(Mutex::new(HashMap::new())),
            publishers: Arc::new(Mutex::new(HashMap::new())),
            login_rate: Arc::new(Mutex::new(RateWindow::new())),
            rtc_spike: None,
        }
    }

    pub fn with_rtc_spike(mut self, config: Option<SpikeConfig>) -> Self {
        self.rtc_spike = config;
        self
    }

    fn claim_invite(&self, invite_id: String) -> Result<InviteLease, ErrorCode> {
        let mut active = self
            .active_invites
            .lock()
            .map_err(|_| ErrorCode::Overloaded)?;
        if !active.insert(invite_id.clone()) {
            return Err(ErrorCode::Replay);
        }
        Ok(InviteLease {
            invite_id,
            active: self.active_invites.clone(),
        })
    }

    fn join_room(&self, room_id: String) -> Result<RoomLease, ErrorCode> {
        let mut rooms = self.rooms.lock().map_err(|_| ErrorCode::Overloaded)?;
        if rooms.len() >= MAX_SESSIONS && !rooms.contains_key(&room_id) {
            return Err(ErrorCode::Overloaded);
        }
        let count = rooms.entry(room_id.clone()).or_default();
        if *count >= MAX_ROOM_MEMBERS {
            return Err(ErrorCode::Overloaded);
        }
        *count += 1;
        Ok(RoomLease {
            room_id,
            rooms: self.rooms.clone(),
        })
    }
}

struct InviteLease {
    invite_id: String,
    active: Arc<Mutex<HashSet<String>>>,
}
impl Drop for InviteLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.invite_id);
        }
    }
}

struct RoomLease {
    room_id: String,
    rooms: Arc<Mutex<HashMap<String, usize>>>,
}
impl Drop for RoomLease {
    fn drop(&mut self) {
        if let Ok(mut rooms) = self.rooms.lock()
            && let Some(count) = rooms.get_mut(&self.room_id)
        {
            *count -= 1;
            if *count == 0 {
                rooms.remove(&self.room_id);
            }
        }
    }
}

struct JoinedSession {
    session_id: String,
    room: RoomLease,
    setup_deadline: Instant,
    observed_peer_ip: Option<Ipv4Addr>,
    receive_peer: Option<SpikePeer>,
    publisher: Option<PublisherLease>,
}

struct PublisherEntry {
    room_id: String,
    invite_id: String,
}

// Only the authenticated RTC owner can register a connected publisher. No client
// directory mutation operation exists; session teardown removes the entry.
struct PublisherLease {
    session_id: String,
    publishers: Arc<Mutex<HashMap<String, PublisherEntry>>>,
}

impl Drop for PublisherLease {
    fn drop(&mut self) {
        if let Ok(mut publishers) = self.publishers.lock() {
            publishers.remove(&self.session_id);
        }
    }
}

fn register_publisher(
    state: &SignalingState,
    joined: &mut JoinedSession,
    invite_id: &str,
) -> Result<(), ()> {
    if joined.publisher.is_some()
        || !joined
            .receive_peer
            .as_ref()
            .is_some_and(|peer| peer.connected() && !peer.is_subscriber())
    {
        return Ok(());
    }
    let mut publishers = state.publishers.lock().map_err(|_| ())?;
    if publishers.len() >= MAX_DIRECTORY_SHARES || publishers.contains_key(&joined.session_id) {
        return Err(());
    }
    publishers.insert(
        joined.session_id.clone(),
        PublisherEntry {
            room_id: joined.room.room_id.clone(),
            invite_id: invite_id.into(),
        },
    );
    joined.publisher = Some(PublisherLease {
        session_id: joined.session_id.clone(),
        publishers: state.publishers.clone(),
    });
    Ok(())
}

fn directory(
    state: &SignalingState,
    store: &InviteStore,
    invite_id: &str,
    room_id: String,
    now: u32,
) -> ServerOperation {
    if !store.authorize(invite_id, &room_id, Permission::Access, now)
        || !store.authorize(invite_id, &room_id, Permission::Subscribe, now)
    {
        return rejected(ErrorCode::Unauthorized);
    }
    let Ok(publishers) = state.publishers.lock() else {
        return rejected(ErrorCode::Overloaded);
    };
    let mut publisher_metadata: Vec<PublisherMetadata> = publishers
        .iter()
        .filter(|(_, publisher)| {
            publisher.room_id == room_id
                && store.authorize(&publisher.invite_id, &room_id, Permission::Access, now)
                && store.authorize(&publisher.invite_id, &room_id, Permission::Publish, now)
        })
        .map(|(publisher_id, publisher)| {
            let display_name = store
                .current(&publisher.invite_id, now)
                .and_then(|invite| invite.display_name.clone())
                .unwrap_or_else(|| publisher.invite_id.clone());
            PublisherMetadata {
                publisher_id: publisher_id.clone(),
                display_name,
            }
        })
        .take(MAX_DIRECTORY_SHARES)
        .collect();
    publisher_metadata.sort_unstable_by(|left, right| left.publisher_id.cmp(&right.publisher_id));
    let publisher_ids = publisher_metadata
        .iter()
        .map(|publisher| publisher.publisher_id.clone())
        .collect();
    ServerOperation::Directory {
        room_id,
        publisher_ids,
        publishers: publisher_metadata,
    }
}

pub fn router(mut state: SignalingState, maximum_message_bytes: usize) -> Router {
    state.maximum_message_bytes = maximum_message_bytes.min(MAX_MESSAGE_BYTES);
    Router::new()
        .route("/v1/ws", get(upgrade))
        .with_state(state)
}

fn exact_origin(headers: &HeaderMap) -> bool {
    let mut origins = headers.get_all(header::ORIGIN).iter();
    origins
        .next()
        .is_some_and(|value| value == "https://discord.com")
        && origins.next().is_none()
}

async fn upgrade(
    State(state): State<SignalingState>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    connect_info: Option<Extension<ConnectInfo<PeerAddress>>>,
    upgrade: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    if !exact_origin(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if uri.query().is_some()
        || headers.contains_key(header::AUTHORIZATION)
        || headers.contains_key(header::COOKIE)
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(upgrade) = upgrade else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let upgrade = upgrade.protocols(["dass.v1"]);
    if upgrade.selected_protocol().is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    // Only the accepted TCP socket's peer address is authoritative here. Do
    // not consult forwarding headers or any address claimed by the client.
    let observed_peer_ip =
        connect_info.and_then(
            |Extension(ConnectInfo(PeerAddress(address)))| match address.ip() {
                IpAddr::V4(ip) => Some(ip),
                IpAddr::V6(_) => None,
            },
        );
    if state
        .rtc_spike
        .as_ref()
        .is_some_and(SpikeConfig::auto_lan_peers_enabled)
        && !observed_peer_ip.is_some_and(crate::rtc::auto_lan_ip)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(connection) = state.connections.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(unauthenticated) = state.unauthenticated.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let maximum = state.maximum_message_bytes;
    upgrade
        .read_buffer_size(4096)
        .write_buffer_size(0)
        .max_write_buffer_size(maximum * 2)
        .max_message_size(maximum)
        .max_frame_size(maximum)
        .on_upgrade(move |socket| run(socket, state, connection, unauthenticated, observed_peer_ip))
}

pub fn now_seconds() -> Result<u32, &'static str> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "invalid server clock")?
        .as_secs()
        .try_into()
        .map_err(|_| "invalid server clock")
}

async fn send(socket: &mut WebSocket, request_id: String, operation: ServerOperation) -> bool {
    let response = ServerMessage {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        operation,
    };
    let Ok(json) = serde_json::to_string(&response) else {
        return false;
    };
    if json.len() > MAX_MESSAGE_BYTES {
        return false;
    }
    matches!(
        tokio::time::timeout(SEND_TIMEOUT, socket.send(Message::Text(json.into()))).await,
        Ok(Ok(()))
    )
}

async fn close(socket: &mut WebSocket, session: Option<&JoinedSession>, reason: CloseReason) {
    if let Some(session) = session {
        // Invalidate discovery before awaiting a potentially slow close send.
        if let Some(publisher) = &session.publisher
            && let Ok(mut publishers) = publisher.publishers.lock()
        {
            publishers.remove(&publisher.session_id);
        }
        let _ = send(
            socket,
            "server_close".into(),
            ServerOperation::Closed {
                session_id: session.session_id.clone(),
                reason,
            },
        )
        .await;
    }
    let _ = tokio::time::timeout(
        SEND_TIMEOUT,
        socket.send(Message::Close(Some(CloseFrame {
            code: 1008,
            reason: "DASS session closed".into(),
        }))),
    )
    .await;
}

async fn login(
    socket: &mut WebSocket,
    state: &mut SignalingState,
    failure_request_id: &mut String,
) -> Result<(String, InviteLease, u32), ErrorCode> {
    let Some(Ok(Message::Text(text))) = socket.recv().await else {
        return Err(ErrorCode::InvalidMessage);
    };
    let message = parse_client_message(text.as_bytes()).map_err(|_| ErrorCode::InvalidMessage)?;
    *failure_request_id = message.request_id.clone();
    enum LoginInput {
        Credential(String),
        Account { username: String, password: String },
    }
    let login_input = match &message.operation {
        ClientOperation::Login { credential } => LoginInput::Credential(credential.clone()),
        ClientOperation::AccountLogin { username, password } => LoginInput::Account {
            username: username.clone(),
            password: password.clone(),
        },
        _ => return Err(ErrorCode::Unauthorized),
    };
    if !state
        .login_rate
        .lock()
        .map_err(|_| ErrorCode::Overloaded)?
        .admit(8)
    {
        return Err(ErrorCode::Overloaded);
    }
    let permit = state
        .verifications
        .clone()
        .try_acquire_owned()
        .map_err(|_| ErrorCode::Overloaded)?;
    let invites = state.invites.borrow_and_update().clone();
    let verification_invites = invites.clone();
    let now = now_seconds().map_err(|_| ErrorCode::Unauthorized)?;
    // A cancelled login leaves the permit inside the non-cancellable bounded worker.
    let invite_id = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        match login_input {
            LoginInput::Credential(credential) => verification_invites.verify(&credential, now),
            LoginInput::Account { username, password } => {
                verification_invites.verify_account(&username, &password, now)
            }
        }
    })
    .await
    .map_err(|_| ErrorCode::Unauthorized)?
    .map_err(|_| ErrorCode::Unauthorized)?;
    let current_policy = state.invites.borrow();
    if !Arc::ptr_eq(&invites, &current_policy) || state.invites.has_changed().unwrap_or(true) {
        return Err(ErrorCode::Unauthorized);
    }
    let expires = current_policy
        .current(
            &invite_id,
            now_seconds().map_err(|_| ErrorCode::Unauthorized)?,
        )
        .ok_or(ErrorCode::Unauthorized)?
        .expires_at_unix_seconds;
    let lease = state.claim_invite(invite_id)?;
    Ok((message.request_id, lease, expires))
}

fn remember_request(seen: &mut HashSet<String>, request_id: &str) -> Result<(), ErrorCode> {
    if seen.contains(request_id) {
        return Err(ErrorCode::Replay);
    }
    if seen.len() >= MAX_REQUEST_IDS {
        return Err(ErrorCode::Overloaded);
    }
    seen.insert(request_id.to_owned());
    Ok(())
}

async fn run(
    mut socket: WebSocket,
    mut state: SignalingState,
    _connection: OwnedSemaphorePermit,
    unauthenticated: OwnedSemaphorePermit,
    observed_peer_ip: Option<Ipv4Addr>,
) {
    let mut failure_request_id = "login_rejected".to_owned();
    let result = tokio::time::timeout(
        Duration::from_millis(LOGIN_DEADLINE_MS as u64),
        login(&mut socket, &mut state, &mut failure_request_id),
    )
    .await;
    let (request_id, identity, expires) = match result {
        Ok(Ok(value)) => value,
        Ok(Err(code)) => {
            let _ = send(
                &mut socket,
                failure_request_id,
                ServerOperation::Rejected { code },
            )
            .await;
            close(&mut socket, None, CloseReason::TransportFailed).await;
            return;
        }
        Err(_) => {
            close(&mut socket, None, CloseReason::SetupTimeout).await;
            return;
        }
    };
    drop(unauthenticated);
    let Ok(now) = now_seconds() else {
        return;
    };
    let expiry_deadline = Instant::now() + Duration::from_secs(expires.saturating_sub(now) as u64);
    let mut seen = HashSet::from([request_id.clone()]);
    if !send(
        &mut socket,
        request_id,
        ServerOperation::Authenticated {
            expires_at_unix_seconds: expires,
        },
    )
    .await
    {
        return;
    }
    let mut session: Option<JoinedSession> = None;
    let mut last_left: Option<String> = None;
    let tick_ms = if state.rtc_spike.is_some() { 10 } else { 250 };
    let mut tick = tokio::time::interval(Duration::from_millis(tick_ms));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut rate = RateWindow::new();
    // One extra byte detects oversized/truncated UDP datagrams; never parse them.
    let mut udp_buffer = [0_u8; 2_049];
    loop {
        tokio::select! {
            biased;
            _ = state.invites.changed() => {
                close(&mut socket, session.as_ref(), CloseReason::Revoked).await;
                break;
            }
            _ = tick.tick() => {
                if now_seconds().ok().is_none_or(|now| now >= expires) || Instant::now() >= expiry_deadline {
                    close(&mut socket, session.as_ref(), CloseReason::Expired).await;
                    break;
                }
                if session.as_ref().is_some_and(|session| Instant::now() >= session.setup_deadline
                    && !session.receive_peer.as_ref().is_some_and(SpikePeer::connected)) {
                    close(&mut socket, session.as_ref(), CloseReason::SetupTimeout).await;
                    break;
                }
                if let Some(peer) = session.as_mut().and_then(|session| session.receive_peer.as_mut())
                    && peer.timeout().await.is_err() {
                    close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                    break;
                }
                if let Some(joined) = session.as_mut()
                    && register_publisher(&state, joined, &identity.invite_id).is_err() {
                    close(&mut socket, session.as_ref(), CloseReason::Overloaded).await;
                    break;
                }
            }
            received = socket.recv() => {
                if !rate.admit(MAX_MESSAGES_PER_SECOND) { close(&mut socket, session.as_ref(), CloseReason::Overloaded).await; break; }
                let message = match received {
                    Some(Ok(Message::Text(text))) => match parse_client_message(text.as_bytes()) {
                        Ok(message) => message,
                        Err(_) => { close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await; break; }
                    },
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    _ => break,
                };
                if let Err(code) = remember_request(&mut seen, &message.request_id) {
                    let _ = send(&mut socket, message.request_id, ServerOperation::Rejected { code }).await;
                    close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                    break;
                }
                let Ok(now) = now_seconds() else { break; };
                let store = state.invites.borrow().clone();
                if store.current(&identity.invite_id, now).is_none() || Instant::now() >= expiry_deadline {
                    close(&mut socket, session.as_ref(), CloseReason::Expired).await;
                    break;
                }
                let media_response = media_operation(&state, &store, &identity.invite_id, now,
                    &message.operation, &mut session).await;
                let response = match media_response {
                    Ok(Some(response)) => response,
                    Ok(None) => operate_for_peer(
                        &state,
                        &store,
                        &identity.invite_id,
                        now,
                        message.operation,
                        (observed_peer_ip, &mut session),
                        &mut last_left,
                    ),
                    Err(()) => {
                        close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                        break;
                    }
                };
                if !send(&mut socket, message.request_id, response).await { break; }
            }
            datagram = receive_datagram(session.as_ref(), &mut udp_buffer) => {
                let Ok((length, source)) = datagram else { break; };
                if let Some(peer) = session.as_mut().and_then(|session| session.receive_peer.as_mut())
                    && peer.receive(&udp_buffer[..length], source).await.is_err() {
                    close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                    break;
                }
            }
        }
    }
    // RAII releases membership and the exclusive credential lease on every exit.
}

async fn receive_datagram(
    session: Option<&JoinedSession>,
    buffer: &mut [u8],
) -> std::io::Result<(usize, std::net::SocketAddr)> {
    match session.and_then(|session| session.receive_peer.as_ref()) {
        Some(peer) => peer.recv(buffer).await,
        None => std::future::pending().await,
    }
}

/// No media mutation before an authorized publisher/subscriber role is selected.
async fn media_operation(
    state: &SignalingState,
    store: &InviteStore,
    invite_id: &str,
    now: u32,
    operation: &ClientOperation,
    session: &mut Option<JoinedSession>,
) -> Result<Option<ServerOperation>, ()> {
    let Some(config) = &state.rtc_spike else {
        return Ok(None);
    };
    let session_id = match operation {
        ClientOperation::Publish { session_id }
        | ClientOperation::Subscribe { session_id, .. }
        | ClientOperation::Offer { session_id, .. }
        | ClientOperation::Ice { session_id, .. } => session_id,
        _ => return Ok(None),
    };
    let Some(joined) = session
        .as_mut()
        .filter(|joined| &joined.session_id == session_id)
    else {
        return Ok(Some(rejected(ErrorCode::InvalidState)));
    };
    let role_permission = match operation {
        ClientOperation::Subscribe { .. } => Permission::Subscribe,
        ClientOperation::Publish { .. } => Permission::Publish,
        _ if joined
            .receive_peer
            .as_ref()
            .is_some_and(SpikePeer::is_subscriber) =>
        {
            Permission::Subscribe
        }
        _ => Permission::Publish,
    };
    for permission in [Permission::Access, role_permission] {
        if !store.authorize(invite_id, &joined.room.room_id, permission, now) {
            return Ok(Some(rejected(ErrorCode::Unauthorized)));
        }
    }
    let response = match operation {
        ClientOperation::Publish { .. } => {
            if joined.receive_peer.is_some() {
                return Ok(Some(rejected(ErrorCode::InvalidState)));
            }
            match SpikePeer::publisher_for_session(
                config,
                &joined.room.room_id,
                session_id,
                joined.observed_peer_ip,
            )
            .await
            {
                Ok(peer) => joined.receive_peer = Some(peer),
                Err(_) => return Ok(Some(rejected(ErrorCode::Overloaded))),
            }
            ServerOperation::Accepted {
                session_id: session_id.clone(),
            }
        }
        ClientOperation::Subscribe { publisher_id, .. } => {
            if joined.receive_peer.is_some() {
                return Ok(Some(rejected(ErrorCode::InvalidState)));
            }
            match SpikePeer::subscriber_for_session(
                config,
                &joined.room.room_id,
                publisher_id,
                session_id,
                joined.observed_peer_ip,
            )
            .await
            {
                Ok(peer) => joined.receive_peer = Some(peer),
                // Deliberately do not disclose whether a publisher exists in another room.
                Err(_) => return Ok(Some(rejected(ErrorCode::InvalidState))),
            }
            ServerOperation::Accepted {
                session_id: session_id.clone(),
            }
        }
        ClientOperation::Offer { sdp, .. } => {
            let Some(peer) = joined.receive_peer.as_mut() else {
                return Ok(Some(rejected(ErrorCode::InvalidState)));
            };
            let sdp = peer.offer(sdp).await.map_err(|_| ())?;
            ServerOperation::Answer {
                session_id: session_id.clone(),
                sdp,
            }
        }
        ClientOperation::Ice { candidate, .. } => {
            let Some(peer) = joined.receive_peer.as_mut() else {
                return Ok(Some(rejected(ErrorCode::InvalidState)));
            };
            peer.ice(candidate).await.map_err(|_| ())?;
            ServerOperation::Accepted {
                session_id: session_id.clone(),
            }
        }
        _ => return Ok(None),
    };
    Ok(Some(response))
}

fn rejected(code: ErrorCode) -> ServerOperation {
    ServerOperation::Rejected { code }
}

#[cfg(test)]
fn operate(
    state: &SignalingState,
    store: &InviteStore,
    invite_id: &str,
    now: u32,
    operation: ClientOperation,
    session: &mut Option<JoinedSession>,
    last_left: &mut Option<String>,
) -> ServerOperation {
    operate_for_peer(
        state,
        store,
        invite_id,
        now,
        operation,
        (None, session),
        last_left,
    )
}

fn operate_for_peer(
    state: &SignalingState,
    store: &InviteStore,
    invite_id: &str,
    now: u32,
    operation: ClientOperation,
    (observed_peer_ip, session): (Option<Ipv4Addr>, &mut Option<JoinedSession>),
    last_left: &mut Option<String>,
) -> ServerOperation {
    match operation {
        ClientOperation::Login { .. } | ClientOperation::AccountLogin { .. } => {
            rejected(ErrorCode::InvalidState)
        }
        ClientOperation::Directory { room_id } => directory(state, store, invite_id, room_id, now),
        ClientOperation::Join {
            room_id,
            require_e2ee,
        } => {
            if !store.authorize(invite_id, &room_id, Permission::Access, now) {
                return rejected(ErrorCode::Unauthorized);
            }
            if require_e2ee {
                return rejected(ErrorCode::E2eeUnavailable);
            }
            if session.is_some() {
                return rejected(ErrorCode::InvalidState);
            }
            let Ok(session_id) = random_identifier() else {
                return rejected(ErrorCode::Overloaded);
            };
            let room = match state.join_room(room_id) {
                Ok(room) => room,
                Err(code) => return rejected(code),
            };
            *session = Some(JoinedSession {
                session_id: session_id.clone(),
                room,
                setup_deadline: Instant::now() + Duration::from_millis(SETUP_DEADLINE_MS as u64),
                observed_peer_ip,
                receive_peer: None,
                publisher: None,
            });
            *last_left = None;
            ServerOperation::Joined { session_id }
        }
        ClientOperation::Leave { session_id } => {
            if session.is_none() && last_left.as_ref() == Some(&session_id) {
                return ServerOperation::Closed {
                    session_id,
                    reason: CloseReason::Left,
                };
            }
            let Some(joined) = session
                .as_ref()
                .filter(|joined| joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            if !store.authorize(invite_id, &joined.room.room_id, Permission::Access, now) {
                return rejected(ErrorCode::Unauthorized);
            }
            *session = None;
            *last_left = Some(session_id.clone());
            ServerOperation::Closed {
                session_id,
                reason: CloseReason::Left,
            }
        }
        operation => {
            let (session_id, permission) = match &operation {
                ClientOperation::Publish { session_id } => (session_id, Permission::Publish),
                ClientOperation::Subscribe { session_id, .. } => {
                    (session_id, Permission::Subscribe)
                }
                ClientOperation::Offer { session_id, .. }
                | ClientOperation::Ice { session_id, .. } => (session_id, Permission::Access),
                _ => return rejected(ErrorCode::InvalidState),
            };
            let Some(joined) = session
                .as_ref()
                .filter(|joined| &joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            if !store.authorize(invite_id, &joined.room.room_id, permission, now) {
                return rejected(ErrorCode::Unauthorized);
            }
            // Never return Accepted or process SDP/ICE before a media owner exists.
            rejected(ErrorCode::TransportUnavailable)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{InviteFile, RoomGrant, create_invite, create_invite_with_display_name};

    #[tokio::test]
    async fn directory_requires_subscribe_scope_filters_expiry_and_is_drop_owned() {
        let mut invites = Vec::new();
        for (id, room, publish, subscribe, expires) in [
            ("publisher", "room", true, false, 100),
            ("unnamed_publisher", "room", true, false, 100),
            ("viewer", "room", false, true, 200),
            ("outsider", "other", false, true, 200),
        ] {
            invites.push(
                create_invite_with_display_name(
                    id.into(),
                    (id == "publisher").then(|| "Studio PC".into()),
                    vec![RoomGrant {
                        room_id: room.into(),
                        access: true,
                        publish,
                        subscribe,
                    }],
                    expires,
                )
                .unwrap()
                .0,
            );
        }
        let store = Arc::new(
            InviteStore::from_bytes(
                &serde_json::to_vec(&InviteFile {
                    version: 1,
                    invites,
                })
                .unwrap(),
            )
            .unwrap(),
        );
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver);
        state.publishers.lock().unwrap().insert(
            "source".into(),
            PublisherEntry {
                room_id: "room".into(),
                invite_id: "publisher".into(),
            },
        );
        let lease = PublisherLease {
            session_id: "source".into(),
            publishers: state.publishers.clone(),
        };
        for requester in ["publisher", "outsider", "unknown"] {
            assert!(matches!(
                directory(&state, &store, requester, "room".into(), 99),
                ServerOperation::Rejected {
                    code: ErrorCode::Unauthorized
                }
            ));
        }
        assert!(matches!(
            directory(&state, &store, "viewer", "room".into(), 99),
            ServerOperation::Directory { publisher_ids, publishers, .. }
                if publisher_ids == vec!["source"]
                    && publishers.len() == 1
                    && publishers[0].publisher_id == "source"
                    && publishers[0].display_name == "Studio PC"
        ));
        state.publishers.lock().unwrap().insert(
            "source_unnamed".into(),
            PublisherEntry {
                room_id: "room".into(),
                invite_id: "unnamed_publisher".into(),
            },
        );
        let ServerOperation::Directory {
            publisher_ids,
            publishers,
            ..
        } = directory(&state, &store, "viewer", "room".into(), 99)
        else {
            panic!("authorized directory");
        };
        assert_eq!(publisher_ids, vec!["source", "source_unnamed"]);
        assert_eq!(publishers[1].display_name, "unnamed_publisher");
        state.publishers.lock().unwrap().remove("source_unnamed");
        assert!(matches!(
            directory(&state, &store, "viewer", "room".into(), 100),
            ServerOperation::Directory { publisher_ids, .. } if publisher_ids.is_empty()
        ));
        assert!(matches!(
            directory(&state, &store, "outsider", "other".into(), 99),
            ServerOperation::Directory { publisher_ids, .. } if publisher_ids.is_empty()
        ));
        drop(lease);
        assert!(state.publishers.lock().unwrap().is_empty());
        assert!(matches!(
            directory(&state, &store, "viewer", "room".into(), 99),
            ServerOperation::Directory { publisher_ids, .. } if publisher_ids.is_empty()
        ));
        for index in 0..=MAX_DIRECTORY_SHARES {
            state.publishers.lock().unwrap().insert(
                format!("source_{index}"),
                PublisherEntry {
                    room_id: "room".into(),
                    invite_id: "publisher".into(),
                },
            );
        }
        assert!(matches!(
            directory(&state, &store, "viewer", "room".into(), 99),
            ServerOperation::Directory { publisher_ids, .. } if publisher_ids.len() == MAX_DIRECTORY_SHARES
        ));
    }

    #[test]
    fn origins_are_exact_and_unambiguous() {
        let mut headers = HeaderMap::new();
        assert!(!exact_origin(&headers));
        for origin in [
            "null",
            "http://discord.com",
            "https://discord.com/",
            "https://discord.com.attacker.invalid",
        ] {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(!exact_origin(&headers));
        }
        headers.insert(header::ORIGIN, "https://discord.com".parse().unwrap());
        assert!(exact_origin(&headers));
        headers.append(header::ORIGIN, "https://discord.com".parse().unwrap());
        assert!(!exact_origin(&headers));
    }

    #[test]
    fn replay_storage_never_evicts_and_rate_windows_are_bounded() {
        let mut seen = HashSet::new();
        assert!(remember_request(&mut seen, "request_1").is_ok());
        assert!(matches!(
            remember_request(&mut seen, "request_1"),
            Err(ErrorCode::Replay)
        ));
        for index in 1..MAX_REQUEST_IDS {
            remember_request(&mut seen, &format!("r{index}"))
                .unwrap_or_else(|_| panic!("request admission"));
        }
        assert!(matches!(
            remember_request(&mut seen, "extra"),
            Err(ErrorCode::Overloaded)
        ));
        let mut rate = RateWindow::new();
        for _ in 0..MAX_MESSAGES_PER_SECOND {
            assert!(rate.admit(MAX_MESSAGES_PER_SECOND));
        }
        assert!(!rate.admit(MAX_MESSAGES_PER_SECOND));
    }

    #[tokio::test]
    async fn room_and_credential_leases_are_bounded_and_released() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let lease = state
            .claim_invite("invite_1".into())
            .unwrap_or_else(|_| panic!("lease"));
        assert!(matches!(
            state.claim_invite("invite_1".into()),
            Err(ErrorCode::Replay)
        ));
        drop(lease);
        assert!(state.claim_invite("invite_1".into()).is_ok());
        let members: Vec<_> = (0..MAX_ROOM_MEMBERS)
            .map(|_| {
                state
                    .join_room("room_1".into())
                    .unwrap_or_else(|_| panic!("room"))
            })
            .collect();
        assert!(matches!(
            state.join_room("room_1".into()),
            Err(ErrorCode::Overloaded)
        ));
        drop(members);
        assert!(state.rooms.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn operations_reauthorize_and_do_not_promise_media_or_e2ee() {
        let (invite, _) = create_invite(
            "invite_1".into(),
            vec![RoomGrant {
                room_id: "room_1".into(),
                access: true,
                publish: true,
                subscribe: false,
            }],
            100,
        )
        .unwrap();
        let store = Arc::new(
            InviteStore::from_bytes(
                &serde_json::to_vec(&InviteFile {
                    version: 1,
                    invites: vec![invite],
                })
                .unwrap(),
            )
            .unwrap(),
        );
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver);
        let mut session = None;
        let mut left = None;
        let mut apply = |operation, now| {
            operate(
                &state,
                &store,
                "invite_1",
                now,
                operation,
                &mut session,
                &mut left,
            )
        };
        assert!(matches!(
            apply(
                ClientOperation::Join {
                    room_id: "room_2".into(),
                    require_e2ee: false
                },
                99
            ),
            ServerOperation::Rejected {
                code: ErrorCode::Unauthorized
            }
        ));
        assert!(matches!(
            apply(
                ClientOperation::Join {
                    room_id: "room_1".into(),
                    require_e2ee: true
                },
                99
            ),
            ServerOperation::Rejected {
                code: ErrorCode::E2eeUnavailable
            }
        ));
        let ServerOperation::Joined { session_id } = apply(
            ClientOperation::Join {
                room_id: "room_1".into(),
                require_e2ee: false,
            },
            99,
        ) else {
            panic!("join")
        };
        assert!(matches!(
            apply(
                ClientOperation::Subscribe {
                    session_id: session_id.clone(),
                    publisher_id: "p".into()
                },
                99
            ),
            ServerOperation::Rejected {
                code: ErrorCode::Unauthorized
            }
        ));
        assert!(matches!(
            apply(
                ClientOperation::Publish {
                    session_id: session_id.clone()
                },
                99
            ),
            ServerOperation::Rejected {
                code: ErrorCode::TransportUnavailable
            }
        ));
        assert!(matches!(
            apply(
                ClientOperation::Publish {
                    session_id: session_id.clone()
                },
                100
            ),
            ServerOperation::Rejected {
                code: ErrorCode::Unauthorized
            }
        ));
        for _ in 0..2 {
            assert!(matches!(
                apply(
                    ClientOperation::Leave {
                        session_id: session_id.clone()
                    },
                    99
                ),
                ServerOperation::Closed {
                    reason: CloseReason::Left,
                    ..
                }
            ));
        }
        assert!(state.rooms.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rtc_spike_requires_publish_scope_and_owned_session_before_sdp() {
        let (invite, _) = create_invite(
            "rtc_viewer".into(),
            vec![RoomGrant {
                room_id: "rtc_room".into(),
                access: true,
                publish: false,
                subscribe: true,
            }],
            100,
        )
        .unwrap();
        let store = Arc::new(
            InviteStore::from_bytes(
                &serde_json::to_vec(&InviteFile {
                    version: 1,
                    invites: vec![invite],
                })
                .unwrap(),
            )
            .unwrap(),
        );
        let (_sender, receiver) = watch::channel(store.clone());
        let config = SpikeConfig::from_lookup(true, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some("45000".into()),
            "DASS_RTC_ALLOWED_PEERS" => Some("127.0.0.1:50000".into()),
            _ => None,
        })
        .unwrap();
        let state = SignalingState::new(receiver).with_rtc_spike(config);
        let mut session = None;
        let mut left = None;
        let ServerOperation::Joined { session_id } = operate(
            &state,
            &store,
            "rtc_viewer",
            99,
            ClientOperation::Join {
                room_id: "rtc_room".into(),
                require_e2ee: false,
            },
            &mut session,
            &mut left,
        ) else {
            panic!("join");
        };
        for operation in [
            ClientOperation::Publish {
                session_id: session_id.clone(),
            },
            ClientOperation::Offer {
                session_id: session_id.clone(),
                sdp: "not parsed".into(),
            },
            ClientOperation::Ice {
                session_id: session_id.clone(),
                candidate: "not parsed".into(),
            },
        ] {
            assert!(matches!(
                media_operation(&state, &store, "rtc_viewer", 99, &operation, &mut session).await,
                Ok(Some(ServerOperation::Rejected {
                    code: ErrorCode::Unauthorized
                }))
            ));
        }
        assert!(session.as_ref().unwrap().receive_peer.is_none());
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "rtc_viewer",
                99,
                &ClientOperation::Offer {
                    session_id: "other_session".into(),
                    sdp: "not parsed".into()
                },
                &mut session
            )
            .await,
            Ok(Some(ServerOperation::Rejected {
                code: ErrorCode::InvalidState
            }))
        ));
        assert!(matches!(
            operate(
                &state,
                &store,
                "rtc_viewer",
                99,
                ClientOperation::Subscribe {
                    session_id,
                    publisher_id: "publisher".into()
                },
                &mut session,
                &mut left
            ),
            ServerOperation::Rejected {
                code: ErrorCode::TransportUnavailable
            }
        ));
    }

    #[tokio::test]
    async fn subscriber_negotiation_uses_subscribe_scope_and_same_room_source() {
        let (publisher, _) = create_invite(
            "source_invite".into(),
            vec![RoomGrant {
                room_id: "room".into(),
                access: true,
                publish: true,
                subscribe: false,
            }],
            100,
        )
        .unwrap();
        let (viewer, _) = create_invite(
            "viewer_invite".into(),
            vec![
                RoomGrant {
                    room_id: "room".into(),
                    access: true,
                    publish: false,
                    subscribe: true,
                },
                RoomGrant {
                    room_id: "other_room".into(),
                    access: true,
                    publish: false,
                    subscribe: true,
                },
            ],
            100,
        )
        .unwrap();
        let store = Arc::new(
            InviteStore::from_bytes(
                &serde_json::to_vec(&InviteFile {
                    version: 1,
                    invites: vec![publisher, viewer],
                })
                .unwrap(),
            )
            .unwrap(),
        );
        let probe = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let config = SpikeConfig::from_lookup(true, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some(first_port.to_string()),
            "DASS_RTC_ALLOWED_PEERS" => Some("127.0.0.1:50000".into()),
            _ => None,
        })
        .unwrap();
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver).with_rtc_spike(config);
        let mut source_session = None;
        let mut viewer_session = None;
        let mut left = None;
        let ServerOperation::Joined {
            session_id: source_id,
        } = operate(
            &state,
            &store,
            "source_invite",
            99,
            ClientOperation::Join {
                room_id: "room".into(),
                require_e2ee: false,
            },
            &mut source_session,
            &mut left,
        )
        else {
            panic!("source join");
        };
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "source_invite",
                99,
                &ClientOperation::Publish {
                    session_id: source_id.clone()
                },
                &mut source_session
            )
            .await,
            Ok(Some(ServerOperation::Accepted { .. }))
        ));
        let ServerOperation::Joined {
            session_id: wrong_room_id,
        } = operate(
            &state,
            &store,
            "viewer_invite",
            99,
            ClientOperation::Join {
                room_id: "other_room".into(),
                require_e2ee: false,
            },
            &mut viewer_session,
            &mut left,
        )
        else {
            panic!("other room join");
        };
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "viewer_invite",
                99,
                &ClientOperation::Subscribe {
                    session_id: wrong_room_id.clone(),
                    publisher_id: source_id.clone()
                },
                &mut viewer_session
            )
            .await,
            Ok(Some(ServerOperation::Rejected {
                code: ErrorCode::InvalidState
            }))
        ));
        operate(
            &state,
            &store,
            "viewer_invite",
            99,
            ClientOperation::Leave {
                session_id: wrong_room_id,
            },
            &mut viewer_session,
            &mut left,
        );
        let ServerOperation::Joined {
            session_id: viewer_id,
        } = operate(
            &state,
            &store,
            "viewer_invite",
            99,
            ClientOperation::Join {
                room_id: "room".into(),
                require_e2ee: false,
            },
            &mut viewer_session,
            &mut left,
        )
        else {
            panic!("viewer join");
        };
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "viewer_invite",
                99,
                &ClientOperation::Subscribe {
                    session_id: viewer_id.clone(),
                    publisher_id: source_id
                },
                &mut viewer_session
            )
            .await,
            Ok(Some(ServerOperation::Accepted { .. }))
        ));
        let mut rtc = str0m::Rtc::builder()
            .set_crypto_provider(Arc::new(str0m_aws_lc_rs::default_provider()))
            .build(std::time::Instant::now());
        let mut change = rtc.sdp_api();
        change.add_media(
            str0m::media::MediaKind::Audio,
            str0m::media::Direction::RecvOnly,
            None,
            None,
            None,
        );
        let (offer, _) = change.apply().unwrap();
        while !matches!(rtc.poll_output().unwrap(), str0m::Output::Timeout(_)) {}
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "viewer_invite",
                99,
                &ClientOperation::Offer {
                    session_id: viewer_id.clone(),
                    sdp: offer.to_sdp_string()
                },
                &mut viewer_session
            )
            .await,
            Ok(Some(ServerOperation::Answer { .. }))
        ));
        assert!(matches!(
            media_operation(
                &state,
                &store,
                "viewer_invite",
                100,
                &ClientOperation::Ice {
                    session_id: viewer_id,
                    candidate: "not parsed after expiry".into()
                },
                &mut viewer_session
            )
            .await,
            Ok(Some(ServerOperation::Rejected {
                code: ErrorCode::Unauthorized
            }))
        ));
        drop(source_session);
        assert!(
            viewer_session
                .as_mut()
                .unwrap()
                .receive_peer
                .as_mut()
                .unwrap()
                .timeout()
                .await
                .is_err()
        );
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;
    use crate::{
        app_with_signaling,
        auth::{InviteFile, RoomGrant, create_invite_with_display_name},
        config::{Config, TlsFiles},
        listener::{BoundedListener, tls_acceptor_from_der},
    };
    use dass_protocol::ControlLimits;
    use futures_util::{SinkExt, StreamExt};
    use rustls_pki_types::{PrivatePkcs8KeyDer, ServerName};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };
    use tokio_rustls::{TlsConnector, client::TlsStream};
    use tokio_tungstenite::{
        WebSocketStream,
        tungstenite::{Message as ClientFrame, client::IntoClientRequest},
    };

    struct Server {
        address: std::net::SocketAddr,
        client_tls: TlsConnector,
        invites: watch::Sender<Arc<InviteStore>>,
        state: SignalingState,
        task: tokio::task::JoinHandle<()>,
        credential: String,
        viewer_credential: String,
    }

    impl Drop for Server {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    async fn start(expires: u32) -> Server {
        start_with_spike(expires, None).await
    }

    async fn start_with_spike(expires: u32, spike: Option<SpikeConfig>) -> Server {
        let (invite, credential) = create_invite_with_display_name(
            "network_invite".into(),
            Some("DASS Publisher".into()),
            vec![RoomGrant {
                room_id: "room_1".into(),
                access: true,
                publish: true,
                subscribe: false,
            }],
            expires,
        )
        .unwrap();
        let (viewer_invite, viewer_credential) = create_invite_with_display_name(
            "directory_viewer".into(),
            Some("DASS Viewer".into()),
            vec![RoomGrant {
                room_id: "room_1".into(),
                access: true,
                publish: false,
                subscribe: true,
            }],
            expires,
        )
        .unwrap();
        let store = InviteStore::from_bytes(
            &serde_json::to_vec(&InviteFile {
                version: 1,
                invites: vec![invite, viewer_invite],
            })
            .unwrap(),
        )
        .unwrap();
        let (invites, receiver) = watch::channel(Arc::new(store));
        let state = SignalingState::new(receiver).with_rtc_spike(spike);
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let tls = tls_acceptor_from_der(
            vec![cert.der().clone()],
            PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )
        .unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(cert.der().clone()).unwrap();
        let client_config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::aws_lc_rs::default_provider(),
        ))
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_config));
        let tcp = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = tcp.local_addr().unwrap();
        let config = Config {
            listen_addr: address,
            limits: ControlLimits {
                max_concurrent_requests: 128,
                max_control_message_bytes: MAX_MESSAGE_BYTES,
            },
            request_timeout: Duration::from_secs(5),
            tls: Some(TlsFiles {
                certificate: "unused".into(),
                private_key: "unused".into(),
            }),
            invite_file: Some("unused".into()),
            users_json: None,
        };
        let router = app_with_signaling(config, Some(state.clone()));
        let task = tokio::spawn(async move {
            axum::serve(
                BoundedListener::new(tcp, Some(tls)),
                router.into_make_service_with_connect_info::<PeerAddress>(),
            )
            .await
            .unwrap();
        });
        Server {
            address,
            client_tls,
            invites,
            state,
            task,
            credential,
            viewer_credential,
        }
    }

    type Client = WebSocketStream<TlsStream<TcpStream>>;

    async fn connect(
        server: &Server,
        origin: &str,
        suffix: &str,
    ) -> Result<Client, tokio_tungstenite::tungstenite::Error> {
        let tcp = TcpStream::connect(server.address).await.unwrap();
        let tls = server
            .client_tls
            .connect(ServerName::try_from("localhost").unwrap().to_owned(), tcp)
            .await
            .unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(rustls::ProtocolVersion::TLSv1_3)
        );
        let mut request = format!("wss://localhost:{}/v1/ws{suffix}", server.address.port())
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert(header::ORIGIN, origin.parse().unwrap());
        // Deliberately spoofed: auto admission must use the accepted TCP peer,
        // never forwarding headers supplied by the signaling client.
        request
            .headers_mut()
            .insert("x-forwarded-for", "192.168.1.77".parse().unwrap());
        request
            .headers_mut()
            .insert(header::SEC_WEBSOCKET_PROTOCOL, "dass.v1".parse().unwrap());
        tokio_tungstenite::client_async(request, tls)
            .await
            .map(|(socket, response)| {
                assert_eq!(
                    response.headers()[header::SEC_WEBSOCKET_PROTOCOL],
                    "dass.v1"
                );
                socket
            })
    }

    async fn request(
        client: &mut Client,
        request_id: &str,
        operation: serde_json::Value,
    ) -> serde_json::Value {
        let message = serde_json::json!({ "protocol_version": 1, "request_id": request_id, "operation": operation });
        client
            .send(ClientFrame::Text(message.to_string().into()))
            .await
            .unwrap();
        response(client).await
    }

    async fn response(client: &mut Client) -> serde_json::Value {
        let frame = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        serde_json::from_str(frame.to_text().unwrap()).unwrap()
    }

    async fn authenticate(server: &Server) -> Client {
        let mut client = connect(server, "https://discord.com", "").await.unwrap();
        let result = request(
            &mut client,
            "login_1",
            serde_json::json!({ "type": "login", "credential": server.credential }),
        )
        .await;
        assert_eq!(result["operation"]["type"], "authenticated");
        client
    }

    #[tokio::test]
    async fn authenticated_wss_negotiates_dtls_and_revocation_drops_rtc_socket() {
        use str0m::{
            Candidate, Event, Input, Output, Rtc,
            change::SdpAnswer,
            media::{Direction, MediaKind},
            net::{Protocol, Receive},
        };
        use tokio::net::UdpSocket;

        let publisher_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let publisher_address = publisher_socket.local_addr().unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let spike = SpikeConfig::from_lookup(true, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some(first_port.to_string()),
            "DASS_RTC_AUTO_LAN_PEERS" => Some("true".into()),
            _ => None,
        })
        .unwrap();
        let server = start_with_spike(now_seconds().unwrap() + 60, spike).await;
        let mut client = authenticate(&server).await;
        let joined = request(
            &mut client,
            "rtc_join",
            serde_json::json!({
                "type": "join", "room_id": "room_1", "require_e2ee": false,
            }),
        )
        .await;
        let session_id = joined["operation"]["session_id"]
            .as_str()
            .unwrap()
            .to_owned();
        let result = request(
            &mut client,
            "rtc_before_publish",
            serde_json::json!({
                "type": "offer", "session_id": session_id, "sdp": "must not be parsed",
            }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "invalid_state");
        let result = request(
            &mut client,
            "rtc_publish",
            serde_json::json!({
                "type": "publish", "session_id": session_id,
            }),
        )
        .await;
        assert_eq!(result["operation"]["type"], "accepted");

        let mut viewer = connect(&server, "https://discord.com", "").await.unwrap();
        let result = request(
            &mut viewer,
            "directory_login",
            serde_json::json!({ "type": "login", "credential": server.viewer_credential }),
        )
        .await;
        assert_eq!(result["operation"]["type"], "authenticated");
        let result = request(
            &mut viewer,
            "directory_pending",
            serde_json::json!({ "type": "directory", "room_id": "room_1" }),
        )
        .await;
        assert_eq!(result["operation"]["publisher_ids"], serde_json::json!([]));
        assert_eq!(result["operation"]["publishers"], serde_json::json!([]));

        let mut publisher = Rtc::builder()
            .set_crypto_provider(Arc::new(str0m_aws_lc_rs::default_provider()))
            .set_fingerprint_verification(true)
            .build(std::time::Instant::now());
        publisher.add_local_candidate(Candidate::host(publisher_address, "udp").unwrap());
        while !matches!(publisher.poll_output().unwrap(), Output::Timeout(_)) {}
        let mut change = publisher.sdp_api();
        change.add_media(MediaKind::Audio, Direction::SendOnly, None, None, None);
        let (offer, pending) = change.apply().unwrap();
        while !matches!(publisher.poll_output().unwrap(), Output::Timeout(_)) {}
        let answer_response = request(
            &mut client,
            "rtc_offer",
            serde_json::json!({
                "type": "offer", "session_id": session_id, "sdp": offer.to_sdp_string(),
            }),
        )
        .await;
        assert_eq!(answer_response["operation"]["type"], "answer");
        let sdp = answer_response["operation"]["sdp"].as_str().unwrap();
        let server_address = sdp
            .lines()
            .find_map(|line| {
                line.strip_prefix("a=candidate:").map(|candidate| {
                    Candidate::from_sdp_string(&format!("candidate:{candidate}"))
                        .unwrap()
                        .addr()
                })
            })
            .unwrap();
        assert!(server_address.ip().is_loopback());
        assert!((first_port..=first_port + 1).contains(&server_address.port()));
        publisher
            .sdp_api()
            .accept_answer(pending, SdpAnswer::from_sdp_string(sdp).unwrap())
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut buffer = [0_u8; 2_049];
        let mut connected = false;
        while !connected {
            assert!(
                std::time::Instant::now() < deadline,
                "authenticated RTC setup deadline"
            );
            let mut datagrams = Vec::new();
            let timeout = loop {
                match publisher.poll_output().unwrap() {
                    Output::Timeout(timeout) => break timeout,
                    Output::Transmit(transmit) => {
                        assert_eq!(transmit.destination, server_address);
                        assert!(datagrams.len() < 32);
                        datagrams.push(transmit.contents.to_vec());
                    }
                    Output::Event(Event::Connected) => connected = true,
                    Output::Event(_) => {}
                }
            };
            for bytes in datagrams {
                publisher_socket
                    .send_to(&bytes, server_address)
                    .await
                    .unwrap();
            }
            if connected {
                break;
            }
            match tokio::time::timeout(
                Duration::from_millis(2),
                publisher_socket.recv_from(&mut buffer),
            )
            .await
            {
                Ok(Ok((length, source))) => {
                    assert_eq!(source, server_address);
                    publisher
                        .handle_input(Input::Receive(
                            std::time::Instant::now(),
                            Receive {
                                proto: Protocol::Udp,
                                source,
                                destination: publisher_address,
                                contents: buffer[..length].try_into().unwrap(),
                            },
                        ))
                        .unwrap();
                }
                Ok(Err(_)) => panic!("publisher UDP receive failed"),
                Err(_) if std::time::Instant::now() >= timeout => {
                    publisher
                        .handle_input(Input::Timeout(std::time::Instant::now()))
                        .unwrap();
                }
                Err(_) => {}
            }
        }

        let mut discovered = false;
        for index in 0..100 {
            let result = request(
                &mut viewer,
                &format!("directory_connected_{index}"),
                serde_json::json!({ "type": "directory", "room_id": "room_1" }),
            )
            .await;
            if result["operation"]["publisher_ids"] == serde_json::json!([session_id]) {
                assert_eq!(
                    result["operation"]["publishers"],
                    serde_json::json!([{
                        "publisher_id": session_id,
                        "display_name": "DASS Publisher"
                    }])
                );
                discovered = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(discovered, "connected RTC publisher was not discoverable");

        // The tested control-policy watch reload must tear down actual RTC ownership,
        // not merely invalidate a control-only room reservation.
        server
            .invites
            .send_replace(Arc::new(InviteStore::default()));
        let closed = response(&mut client).await;
        assert_eq!(closed["operation"]["session_id"], session_id);
        assert_eq!(closed["operation"]["reason"], "revoked");
        for _ in 0..100 {
            if let Ok(socket) = UdpSocket::bind(server_address).await {
                drop(socket);
                if server.state.rooms.lock().unwrap().is_empty()
                    && server.state.active_invites.lock().unwrap().is_empty()
                    && server.state.publishers.lock().unwrap().is_empty()
                {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("revoked RTC UDP socket leaked");
    }

    #[tokio::test]
    async fn tls_websocket_enforces_origin_url_policy_and_admission() {
        let server = start(now_seconds().unwrap() + 60).await;
        for (origin, suffix, expected) in [
            ("https://attacker.invalid", "", 403),
            ("null", "", 403),
            ("https://discord.com", "?credential=must-not-be-used", 400),
        ] {
            let result = connect(&server, origin, suffix).await;
            assert!(
                matches!(result, Err(tokio_tungstenite::tungstenite::Error::Http(response)) if response.status().as_u16() == expected)
            );
        }
        let _occupied = server
            .state
            .unauthenticated
            .acquire_many(MAX_UNAUTHENTICATED_CONNECTIONS as u32)
            .await
            .unwrap();
        let result = connect(&server, "https://discord.com", "").await;
        assert!(
            matches!(result, Err(tokio_tungstenite::tungstenite::Error::Http(response)) if response.status() == StatusCode::SERVICE_UNAVAILABLE)
        );
    }

    #[tokio::test]
    async fn tls_discovery_separates_control_plane_from_unavailable_media() {
        let server = start(now_seconds().unwrap() + 60).await;
        for (path, assertions) in [("/v1/capabilities", true), ("/health/ready", false)] {
            let tcp = TcpStream::connect(server.address).await.unwrap();
            let mut tls = server
                .client_tls
                .connect(ServerName::try_from("localhost").unwrap().to_owned(), tcp)
                .await
                .unwrap();
            tls.write_all(
                format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
            let mut bytes = Vec::new();
            let read_result =
                tokio::time::timeout(Duration::from_secs(3), tls.read_to_end(&mut bytes))
                    .await
                    .unwrap();
            // Hyper may drop the upgraded/closed transport without TLS close_notify.
            // Inspect the complete HTTP response, but never bypass certificate verification.
            if let Err(error) = read_result {
                assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
            }
            let response = String::from_utf8(bytes).unwrap();
            if assertions {
                assert!(response.starts_with("HTTP/1.1 200"));
                // The HTTP body may be chunked; inspect only complete known JSON fields.
                for field in ["control_plane_available", "authentication_available"] {
                    assert!(response.contains(&format!("\"{field}\":true")));
                }
                for field in [
                    "ready",
                    "signaling_available",
                    "media_available",
                    "e2ee_available",
                    "insecure_local_development",
                ] {
                    assert!(response.contains(&format!("\"{field}\":false")));
                }
                assert!(response.trim_end().ends_with('}'));
            } else {
                assert!(response.starts_with("HTTP/1.1 503"));
            }
        }
    }

    #[tokio::test]
    async fn first_message_must_be_login_and_login_deadline_releases_admission() {
        let server = start(now_seconds().unwrap() + 60).await;
        let mut client = connect(&server, "https://discord.com", "").await.unwrap();
        let result = request(
            &mut client,
            "join_before_login",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": false }),
        )
        .await;
        assert_eq!(result["request_id"], "join_before_login");
        assert_eq!(result["operation"]["code"], "unauthorized");
        let mut idle = connect(&server, "https://discord.com", "").await.unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(7), idle.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(matches!(frame, ClientFrame::Close(_)));
        for _ in 0..100 {
            if server.state.unauthenticated.available_permits() == MAX_UNAUTHENTICATED_CONNECTIONS {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("unauthenticated admission leaked");
    }

    #[tokio::test]
    async fn joined_room_reservation_expires_without_media_setup() {
        let server = start(now_seconds().unwrap() + 60).await;
        let mut client = authenticate(&server).await;
        request(
            &mut client,
            "join",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": false }),
        )
        .await;
        let frame = tokio::time::timeout(Duration::from_secs(18), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let result: serde_json::Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
        assert_eq!(result["operation"]["reason"], "setup_timeout");
    }

    #[tokio::test]
    async fn wss_login_room_roles_replay_and_revocation_fail_closed() {
        let server = start(now_seconds().unwrap() + 60).await;
        let mut client = authenticate(&server).await;
        let mut duplicate = connect(&server, "https://discord.com", "").await.unwrap();
        let denied = request(
            &mut duplicate,
            "login_2",
            serde_json::json!({ "type": "login", "credential": server.credential }),
        )
        .await;
        assert_eq!(denied["operation"]["code"], "replay");
        let result = request(
            &mut client,
            "e2ee",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": true }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "e2ee_unavailable");
        let result = request(
            &mut client,
            "wrong_room",
            serde_json::json!({ "type": "join", "room_id": "room_2", "require_e2ee": false }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "unauthorized");
        let result = request(
            &mut client,
            "join",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": false }),
        )
        .await;
        let session_id = result["operation"]["session_id"].as_str().unwrap();
        let result = request(&mut client, "subscribe", serde_json::json!({ "type": "subscribe", "session_id": session_id, "publisher_id": "p" })).await;
        assert_eq!(result["operation"]["code"], "unauthorized");
        let result = request(
            &mut client,
            "publish",
            serde_json::json!({ "type": "publish", "session_id": session_id }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "transport_unavailable");
        server
            .invites
            .send_replace(Arc::new(InviteStore::default()));
        let result = response(&mut client).await;
        assert_eq!(result["operation"]["reason"], "revoked");
        let frame = tokio::time::timeout(Duration::from_secs(3), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(matches!(frame, ClientFrame::Close(_)));
    }

    #[tokio::test]
    async fn duplicate_request_and_expired_invite_are_rejected_over_wss() {
        let server = start(now_seconds().unwrap() + 60).await;
        let mut client = authenticate(&server).await;
        let result = request(
            &mut client,
            "login_1",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": false }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "replay");
        let expired = start(now_seconds().unwrap().saturating_sub(1)).await;
        let mut client = connect(&expired, "https://discord.com", "").await.unwrap();
        let result = request(
            &mut client,
            "login",
            serde_json::json!({ "type": "login", "credential": expired.credential }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "unauthorized");
    }

    #[tokio::test]
    async fn live_session_expiry_closes_wss_and_releases_membership() {
        let server = start(now_seconds().unwrap() + 8).await;
        let mut client = authenticate(&server).await;
        request(
            &mut client,
            "join",
            serde_json::json!({ "type": "join", "room_id": "room_1", "require_e2ee": false }),
        )
        .await;
        let frame = tokio::time::timeout(Duration::from_secs(10), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let result: serde_json::Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
        assert_eq!(result["operation"]["reason"], "expired");
        let _ = tokio::time::timeout(Duration::from_secs(3), client.next()).await;
        for _ in 0..100 {
            if server.state.rooms.lock().unwrap().is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("membership leaked after expiry");
    }
}
