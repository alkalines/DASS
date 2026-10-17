//! Authenticated control plane with an explicit one-publisher/one-viewer RTC spike.
//! Rooms are discovery grouping only. Stream admission is decided solely by the
//! authenticated publisher through bounded, single-use approval requests; the
//! backend relays and enforces decisions but never grants viewership itself.

use crate::auth::{InviteStore, random_identifier};
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
        MAX_MESSAGE_BYTES, MAX_QUEUED_MESSAGES, MAX_ROOM_MEMBERS, MAX_SESSIONS, PublisherMetadata,
        SESSION_LIFETIME_SECONDS, SETUP_DEADLINE_MS, ServerMessage, ServerOperation,
        VIEW_REQUEST_TIMEOUT_SECONDS, ViewDecisionKind, ViewerPresenceChange, parse_client_message,
    },
};
use std::{
    collections::{HashMap, HashSet},
    net::{IpAddr, Ipv4Addr},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, mpsc, watch},
    time::Instant,
};
use tracing::Instrument;

// Process-local diagnostics only; unrelated to credentials, rooms or wire session IDs.
static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

const MAX_UNAUTHENTICATED_CONNECTIONS: usize = 16;
const MAX_REQUEST_IDS: usize = 256;
const MAX_MESSAGES_PER_SECOND: usize = 32;
const SEND_TIMEOUT: Duration = Duration::from_secs(1);
const PRESENCE_REQUEST_ID: &str = "server_viewer_presence";
const VIEW_REQUEST_PUSH_ID: &str = "server_view_request";
const VIEW_DECISION_PUSH_ID: &str = "server_view_decision";
const VIEW_REQUEST_CLOSED_PUSH_ID: &str = "server_view_request_closed";
const MAX_PRESENCE_VIEWERS: usize = MAX_ROOM_MEMBERS - 1;
const MAX_PENDING_VIEW_REQUESTS: usize = 64;
const MAX_PENDING_PER_PUBLISHER: usize = 8;
const MAX_PENDING_PER_VIEWER: usize = 4;
const MAX_APPROVALS_PER_PUBLISHER: usize = 16;
const DENY_COOLDOWN: Duration = Duration::from_secs(30);
const MAX_LOGIN_SOURCES: usize = 1_024;
const PER_SOURCE_LOGINS_PER_SECOND: usize = 4;
const VIEW_REQUEST_LIFETIME: Duration =
    Duration::from_secs(VIEW_REQUEST_TIMEOUT_SECONDS as u64);

/// Server-pushed events for one authenticated connection. Queues stay bounded;
/// a connection that cannot drain its events is closed rather than silently
/// losing admission state.
enum ConnectionEvent {
    ViewerPresence {
        session_id: String,
        change: ViewerPresenceChange,
        viewer_count: u8,
    },
    ViewRequest {
        request_id: String,
        viewer_id: String,
        viewer_display_name: String,
    },
    ViewRequestClosed {
        request_id: String,
    },
    ViewDecision {
        request_id: String,
        decision: ViewDecisionKind,
        approval_id: String,
    },
    /// Publisher withdrawal or stream end: terminate this session's route.
    Close(CloseReason),
}

#[derive(Clone)]
pub struct SignalingState {
    maximum_message_bytes: usize,
    invites: watch::Receiver<Arc<InviteStore>>,
    connections: Arc<Semaphore>,
    unauthenticated: Arc<Semaphore>,
    verifications: Arc<Semaphore>,
    active_accounts: Arc<Mutex<HashSet<String>>>,
    rooms: Arc<Mutex<HashMap<String, usize>>>,
    publishers: Arc<Mutex<HashMap<String, PublisherEntry>>>,
    view_requests: Arc<Mutex<HashMap<String, PendingView>>>,
    login_rate: Arc<Mutex<RateWindow>>,
    login_sources: Arc<Mutex<HashMap<IpAddr, RateWindow>>>,
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
    /// Administrative metadata only; never exposes SDP, credentials or candidates.
    pub fn admin_snapshot(&self) -> Result<serde_json::Value, &'static str> {
        let rooms = self.rooms.lock().map_err(|_| "room state unavailable")?;
        let publishers = self
            .publishers
            .lock()
            .map_err(|_| "stream state unavailable")?;
        let mut room_list: Vec<_> = rooms
            .iter()
            .map(|(room_id, members)| serde_json::json!({"room_id": room_id, "members": members}))
            .collect();
        room_list.sort_by_key(|room| room["room_id"].as_str().unwrap_or_default().to_owned());
        let mut streams: Vec<_> = publishers
            .iter()
            .map(|(publisher_id, entry)| {
                serde_json::json!({
                    "publisher_id": publisher_id,
                    "room_id": entry.room_id,
                    "username": entry.account,
                    "viewers": entry.viewers.keys().collect::<Vec<_>>(),
                    "viewer_count": entry.viewers.len(),
                    "pending_view_requests": entry.pending.len(),
                })
            })
            .collect();
        streams.sort_by_key(|stream| {
            stream["publisher_id"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        });
        Ok(serde_json::json!({"rooms": room_list, "streams": streams, "watch_available": false}))
    }

    pub fn new(invites: watch::Receiver<Arc<InviteStore>>) -> Self {
        Self {
            invites,
            maximum_message_bytes: MAX_MESSAGE_BYTES,
            connections: Arc::new(Semaphore::new(MAX_SESSIONS)),
            unauthenticated: Arc::new(Semaphore::new(MAX_UNAUTHENTICATED_CONNECTIONS)),
            verifications: Arc::new(Semaphore::new(2)),
            active_accounts: Arc::new(Mutex::new(HashSet::new())),
            rooms: Arc::new(Mutex::new(HashMap::new())),
            publishers: Arc::new(Mutex::new(HashMap::new())),
            view_requests: Arc::new(Mutex::new(HashMap::new())),
            login_rate: Arc::new(Mutex::new(RateWindow::new())),
            login_sources: Arc::new(Mutex::new(HashMap::new())),
            rtc_spike: None,
        }
    }

    pub fn with_rtc_spike(mut self, config: Option<SpikeConfig>) -> Self {
        self.rtc_spike = config;
        self
    }

    fn claim_account(&self, account: String) -> Result<AccountLease, ErrorCode> {
        let mut active = self
            .active_accounts
            .lock()
            .map_err(|_| ErrorCode::Overloaded)?;
        if !active.insert(account.clone()) {
            return Err(ErrorCode::Replay);
        }
        Ok(AccountLease {
            account,
            active: self.active_accounts.clone(),
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

    fn admit_login_source(&self, ip: Option<IpAddr>) -> Result<(), ErrorCode> {
        let Some(ip) = ip else {
            return Ok(());
        };
        let mut sources = self
            .login_sources
            .lock()
            .map_err(|_| ErrorCode::Overloaded)?;
        if let Some(window) = sources.get_mut(&ip) {
            return if window.admit(PER_SOURCE_LOGINS_PER_SECOND) {
                Ok(())
            } else {
                Err(ErrorCode::Overloaded)
            };
        }
        if sources.len() >= MAX_LOGIN_SOURCES {
            return Err(ErrorCode::Overloaded);
        }
        let mut window = RateWindow::new();
        window.admit(PER_SOURCE_LOGINS_PER_SECOND);
        sources.insert(ip, window);
        Ok(())
    }
}

struct AccountLease {
    account: String,
    active: Arc<Mutex<HashSet<String>>>,
}
impl Drop for AccountLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.account);
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
    session_account: String,
    room: RoomLease,
    setup_deadline: Instant,
    observed_peer_ip: Option<Ipv4Addr>,
    events: mpsc::Sender<ConnectionEvent>,
    receive_peer: Option<SpikePeer>,
    publisher: Option<PublisherLease>,
    viewer_presence_enabled: bool,
    viewer_subscription: Option<ViewerSubscriptionLease>,
}

/// A viewer's request waiting for the publisher's decision. Identities are
/// resolved at request time; decisions reference the server-generated ID only.
struct PendingView {
    publisher_session_id: String,
    viewer_session_id: String,
    viewer_account: String,
    publisher_events: mpsc::Sender<ConnectionEvent>,
    viewer_events: mpsc::Sender<ConnectionEvent>,
    expires: Instant,
}

struct ActiveViewer {
    account: String,
    events: mpsc::Sender<ConnectionEvent>,
}

struct ApprovedView {
    viewer_session_id: String,
    viewer_account: String,
}

struct PublisherEntry {
    room_id: String,
    account: String,
    viewers: HashMap<String, ActiveViewer>,
    pending: HashSet<String>,
    approvals: HashMap<String, ApprovedView>,
    blocked_accounts: HashSet<String>,
    denied_at: HashMap<String, Instant>,
    events: mpsc::Sender<ConnectionEvent>,
    presence_enabled: bool,
    presence_overloaded: bool,
}

// Only the authenticated RTC owner can register a connected publisher. No client
// directory mutation operation exists; session teardown removes the entry, its
// pending requests and every approved viewer route.
struct PublisherLease {
    session_id: String,
    publishers: Arc<Mutex<HashMap<String, PublisherEntry>>>,
    view_requests: Arc<Mutex<HashMap<String, PendingView>>>,
    spike: Option<SpikeConfig>,
}

impl Drop for PublisherLease {
    fn drop(&mut self) {
        let mut closed_viewers = Vec::new();
        let mut pending_ids = Vec::new();
        if let Ok(mut publishers) = self.publishers.lock()
            && let Some(entry) = publishers.remove(&self.session_id)
        {
            pending_ids.extend(entry.pending.iter().cloned());
            for (viewer_session, viewer) in entry.viewers {
                closed_viewers.push((viewer_session, viewer.events));
            }
        }
        // Publisher offline means no admission: every pending request targeting
        // this stream expires immediately and its viewer is notified.
        if let Ok(mut requests) = self.view_requests.lock() {
            for request_id in &pending_ids {
                if let Some(request) = requests.remove(request_id) {
                    let _ = request
                        .viewer_events
                        .try_send(ConnectionEvent::ViewDecision {
                            request_id: request_id.clone(),
                            decision: ViewDecisionKind::Deny,
                            approval_id: String::new(),
                        });
                }
            }
        }
        // Drop queued media packets for this stream so nothing forwards after
        // the publisher's route ended.
        if let Some(spike) = &self.spike {
            spike.close_publisher(&self.session_id);
        }
        for (_, events) in closed_viewers {
            let _ = events.try_send(ConnectionEvent::Close(CloseReason::Revoked));
        }
    }
}

impl PublisherLease {
    fn presence_overloaded(&self) -> bool {
        self.publishers
            .lock()
            .map(|publishers| {
                publishers
                    .get(&self.session_id)
                    .is_none_or(|publisher| publisher.presence_overloaded)
            })
            .unwrap_or(true)
    }
}

struct ViewerSubscriptionLease {
    publisher_session_id: String,
    viewer_session_id: String,
    publishers: Arc<Mutex<HashMap<String, PublisherEntry>>>,
}

impl Drop for ViewerSubscriptionLease {
    fn drop(&mut self) {
        let Ok(mut publishers) = self.publishers.lock() else {
            return;
        };
        let Some(publisher) = publishers.get_mut(&self.publisher_session_id) else {
            // The publisher's own session already ended; never route a departure
            // to a replacement publisher or another share.
            return;
        };
        if publisher.viewers.remove(&self.viewer_session_id).is_none() {
            return;
        }
        let Ok(viewer_count) = u8::try_from(publisher.viewers.len()) else {
            publisher.presence_overloaded = true;
            return;
        };
        if !publisher.presence_enabled {
            return;
        }
        if publisher
            .events
            .try_send(ConnectionEvent::ViewerPresence {
                session_id: self.publisher_session_id.clone(),
                change: ViewerPresenceChange::Left,
                viewer_count,
            })
            .is_err()
        {
            // A publisher that cannot drain its bounded event queue is closed by
            // its owning connection loop rather than silently losing presence.
            publisher.presence_overloaded = true;
        }
    }
}

fn register_publisher(state: &SignalingState, joined: &mut JoinedSession) -> Result<(), ()> {
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
            account: joined.session_account.clone(),
            viewers: HashMap::new(),
            pending: HashSet::new(),
            approvals: HashMap::new(),
            blocked_accounts: HashSet::new(),
            denied_at: HashMap::new(),
            events: joined.events.clone(),
            presence_enabled: joined.viewer_presence_enabled,
            presence_overloaded: false,
        },
    );
    joined.publisher = Some(PublisherLease {
        session_id: joined.session_id.clone(),
        publishers: state.publishers.clone(),
        view_requests: state.view_requests.clone(),
        spike: state.rtc_spike.clone(),
    });
    tracing::info!("connected publisher registered in directory");
    Ok(())
}

fn register_viewer_subscription(
    state: &SignalingState,
    room_id: &str,
    publisher_session_id: &str,
    viewer_session_id: &str,
    viewer_account: &str,
    viewer_events: mpsc::Sender<ConnectionEvent>,
) -> Result<ViewerSubscriptionLease, ErrorCode> {
    if publisher_session_id == viewer_session_id {
        return Err(ErrorCode::InvalidState);
    }
    let mut publishers = state.publishers.lock().map_err(|_| ErrorCode::Overloaded)?;
    let Some(publisher) = publishers.get_mut(publisher_session_id) else {
        return Err(ErrorCode::InvalidState);
    };
    if publisher.room_id != room_id {
        return Err(ErrorCode::InvalidState);
    }
    if publisher.viewers.contains_key(viewer_session_id) {
        return Err(ErrorCode::InvalidState);
    }
    if publisher.viewers.len() >= MAX_PRESENCE_VIEWERS {
        return Err(ErrorCode::Overloaded);
    }
    let viewer_count =
        u8::try_from(publisher.viewers.len() + 1).map_err(|_| ErrorCode::Overloaded)?;
    if publisher.presence_enabled
        && publisher
            .events
            .try_send(ConnectionEvent::ViewerPresence {
                session_id: publisher_session_id.into(),
                change: ViewerPresenceChange::Joined,
                viewer_count,
            })
            .is_err()
    {
        publisher.presence_overloaded = true;
        return Err(ErrorCode::Overloaded);
    }
    publisher.viewers.insert(
        viewer_session_id.into(),
        ActiveViewer {
            account: viewer_account.into(),
            events: viewer_events,
        },
    );
    Ok(ViewerSubscriptionLease {
        publisher_session_id: publisher_session_id.into(),
        viewer_session_id: viewer_session_id.into(),
        publishers: state.publishers.clone(),
    })
}

fn enable_viewer_presence(
    state: &SignalingState,
    joined: &mut JoinedSession,
) -> Result<(), ErrorCode> {
    if joined
        .receive_peer
        .as_ref()
        .is_none_or(|peer| peer.is_subscriber())
    {
        return Err(ErrorCode::InvalidState);
    }
    if joined.viewer_presence_enabled {
        return Ok(());
    }
    if let Some(publisher_lease) = &joined.publisher {
        let mut publishers = state.publishers.lock().map_err(|_| ErrorCode::Overloaded)?;
        let Some(publisher) = publishers.get_mut(&publisher_lease.session_id) else {
            return Err(ErrorCode::InvalidState);
        };
        if !publisher.viewers.is_empty() {
            return Err(ErrorCode::InvalidState);
        }
        publisher.presence_enabled = true;
    }
    joined.viewer_presence_enabled = true;
    Ok(())
}

fn directory(state: &SignalingState, store: &InviteStore, room_id: String) -> ServerOperation {
    let Ok(publishers) = state.publishers.lock() else {
        return rejected(ErrorCode::Overloaded);
    };
    let mut publisher_metadata: Vec<PublisherMetadata> = publishers
        .iter()
        .filter(|(_, publisher)| publisher.room_id == room_id)
        .map(|(publisher_id, publisher)| PublisherMetadata {
            publisher_id: publisher_id.clone(),
            display_name: store.display_name(&publisher.account),
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

/// A viewer asks to watch one specific live stream. The backend assigns the
/// pending ID, binds it to both authenticated identities and forwards it to the
/// publisher; it never decides admission itself.
fn request_view(
    state: &SignalingState,
    joined: &JoinedSession,
    publisher_session_id: &str,
) -> Result<String, ErrorCode> {
    let mut publishers = state.publishers.lock().map_err(|_| ErrorCode::Overloaded)?;
    let Some(publisher) = publishers.get_mut(publisher_session_id) else {
        // Do not disclose whether the stream exists in another room.
        return Err(ErrorCode::InvalidState);
    };
    if publisher.room_id != joined.room.room_id {
        return Err(ErrorCode::InvalidState);
    }
    let viewer_account = joined.session_account.clone();
    if publisher.account == viewer_account {
        return Err(ErrorCode::InvalidState);
    }
    if publisher.blocked_accounts.contains(&viewer_account)
        || publisher
            .denied_at
            .get(&viewer_account)
            .is_some_and(|denied| denied.elapsed() < DENY_COOLDOWN)
    {
        return Err(ErrorCode::Denied);
    }
    if publisher
        .viewers
        .values()
        .any(|viewer| viewer.account == viewer_account)
        || publisher
            .approvals
            .values()
            .any(|approval| approval.viewer_account == viewer_account)
        || publisher.pending.len() >= MAX_PENDING_PER_PUBLISHER
    {
        return Err(ErrorCode::InvalidState);
    }
    let mut requests = state.view_requests.lock().map_err(|_| ErrorCode::Overloaded)?;
    if requests.len() >= MAX_PENDING_VIEW_REQUESTS
        || requests
            .values()
            .filter(|request| request.viewer_account == viewer_account)
            .count()
            >= MAX_PENDING_PER_VIEWER
    {
        return Err(ErrorCode::Overloaded);
    }
    if requests.values().any(|request| {
        request.publisher_session_id == publisher_session_id
            && request.viewer_account == viewer_account
    }) {
        // One pending prompt per viewer per stream; duplicates never queue spam.
        return Err(ErrorCode::InvalidState);
    }
    let request_id = random_identifier().map_err(|_| ErrorCode::Overloaded)?;
    publisher.pending.insert(request_id.clone());
    let pending = PendingView {
        publisher_session_id: publisher_session_id.into(),
        viewer_session_id: joined.session_id.clone(),
        viewer_account: viewer_account.clone(),
        publisher_events: publisher.events.clone(),
        viewer_events: joined.events.clone(),
        expires: Instant::now() + VIEW_REQUEST_LIFETIME,
    };
    let display_name = state
        .invites
        .borrow()
        .display_name(&viewer_account);
    requests.insert(request_id.clone(), pending);
    drop(requests);
    if publisher
        .events
        .try_send(ConnectionEvent::ViewRequest {
            request_id: request_id.clone(),
            viewer_id: viewer_account,
            viewer_display_name: display_name,
        })
        .is_err()
    {
        publisher.pending.remove(&request_id);
        requests_remove(state, &request_id);
        publisher.presence_overloaded = true;
        return Err(ErrorCode::Overloaded);
    }
    Ok(request_id)
}

fn requests_remove(state: &SignalingState, request_id: &str) {
    if let Ok(mut requests) = state.view_requests.lock() {
        requests.remove(request_id);
    }
}

/// Publisher decision enforcement: single-use, bound to the owning stream and
/// the pending entry's authenticated identities.
fn decide_view(
    state: &SignalingState,
    joined: &JoinedSession,
    request_id: &str,
    decision: &ViewDecisionKind,
) -> Result<(), ErrorCode> {
    let mut publishers = state.publishers.lock().map_err(|_| ErrorCode::Overloaded)?;
    let Some(publisher) = publishers.get_mut(&joined.session_id) else {
        return Err(ErrorCode::InvalidState);
    };
    if !publisher.pending.remove(request_id) {
        return Err(ErrorCode::InvalidState);
    }
    let mut requests = state.view_requests.lock().map_err(|_| ErrorCode::Overloaded)?;
    let Some(pending) = requests.remove(request_id) else {
        return Err(ErrorCode::InvalidState);
    };
    drop(requests);
    if pending.publisher_session_id != joined.session_id || Instant::now() >= pending.expires {
        return Err(ErrorCode::InvalidState);
    }
    let event = match decision {
        ViewDecisionKind::Approve => {
            if publisher.approvals.len() >= MAX_APPROVALS_PER_PUBLISHER {
                return Err(ErrorCode::Overloaded);
            }
            let approval_id = random_identifier().map_err(|_| ErrorCode::Overloaded)?;
            publisher.approvals.insert(
                approval_id.clone(),
                ApprovedView {
                    viewer_session_id: pending.viewer_session_id.clone(),
                    viewer_account: pending.viewer_account.clone(),
                },
            );
            ConnectionEvent::ViewDecision {
                request_id: request_id.to_owned(),
                decision: ViewDecisionKind::Approve,
                approval_id,
            }
        }
        ViewDecisionKind::Deny | ViewDecisionKind::Block => {
            publisher
                .denied_at
                .insert(pending.viewer_account.clone(), Instant::now());
            if matches!(decision, ViewDecisionKind::Block) {
                publisher
                    .blocked_accounts
                    .insert(pending.viewer_account.clone());
                block_account_viewers(
                    state,
                    &joined.session_id,
                    publisher,
                    &pending.viewer_account,
                );
            }
            ConnectionEvent::ViewDecision {
                request_id: request_id.to_owned(),
                decision: ViewDecisionKind::Deny,
                approval_id: String::new(),
            }
        }
    };
    if pending.viewer_events.try_send(event).is_err() {
        publisher.presence_overloaded = true;
        return Err(ErrorCode::Overloaded);
    }
    Ok(())
}

/// Remove a blocked account's existing sessions, approvals and pending
/// requests on this stream. Caller holds the publishers lock.
fn block_account_viewers(
    state: &SignalingState,
    publisher_session_id: &str,
    publisher: &mut PublisherEntry,
    account: &str,
) {
    publisher
        .approvals
        .retain(|_, approval| approval.viewer_account != account);
    let removed: Vec<_> = publisher
        .viewers
        .iter()
        .filter(|(_, viewer)| viewer.account == account)
        .map(|(session, _)| session.clone())
        .collect();
    let mut removed_any = false;
    for session in removed {
        if let Some(viewer) = publisher.viewers.remove(&session) {
            removed_any = true;
            if let Some(spike) = &state.rtc_spike {
                spike.drop_viewer(publisher_session_id, &session);
            }
            let _ = viewer
                .events
                .try_send(ConnectionEvent::Close(CloseReason::Revoked));
        }
    }
    if removed_any
        && publisher.presence_enabled
        && let Ok(viewer_count) = u8::try_from(publisher.viewers.len())
    {
        let _ = publisher.events.try_send(ConnectionEvent::ViewerPresence {
            session_id: publisher_session_id.to_owned(),
            change: ViewerPresenceChange::Left,
            viewer_count,
        });
    }
    // Pending requests from the blocked account on this stream also close.
    if let Ok(mut requests) = state.view_requests.lock() {
        let owned: Vec<String> = requests
            .iter()
            .filter(|(_, request)| {
                request.publisher_session_id == publisher_session_id
                    && request.viewer_account == account
            })
            .map(|(id, _)| id.clone())
            .collect();
        for request_id in owned {
            if let Some(request) = requests.remove(&request_id) {
                publisher.pending.remove(&request_id);
                let _ = request
                    .viewer_events
                    .try_send(ConnectionEvent::ViewDecision {
                        request_id,
                        decision: ViewDecisionKind::Deny,
                        approval_id: String::new(),
                    });
            }
        }
    }
}

/// Publisher withdrawal of an approved viewer account: terminate every viewer
/// session, pending request and unused approval belonging to that account.
fn remove_viewer(
    state: &SignalingState,
    joined: &JoinedSession,
    viewer_account: &str,
) -> Result<(), ErrorCode> {
    let mut publishers = state.publishers.lock().map_err(|_| ErrorCode::Overloaded)?;
    let Some(publisher) = publishers.get_mut(&joined.session_id) else {
        return Err(ErrorCode::InvalidState);
    };
    publisher
        .approvals
        .retain(|_, approval| approval.viewer_account != viewer_account);
    let sessions: Vec<_> = publisher
        .viewers
        .iter()
        .filter(|(_, viewer)| viewer.account == viewer_account)
        .map(|(session, _)| session.clone())
        .collect();
    let mut events = Vec::new();
    for session in sessions {
        if let Some(viewer) = publisher.viewers.remove(&session) {
            if let Some(spike) = &state.rtc_spike {
                spike.drop_viewer(&joined.session_id, &session);
            }
            events.push(viewer.events);
        }
    }
    let mut pending_ids = Vec::new();
    {
        let mut requests = state.view_requests.lock().map_err(|_| ErrorCode::Overloaded)?;
        let expired: Vec<_> = requests
            .iter()
            .filter(|(_, request)| {
                request.publisher_session_id == joined.session_id
                    && request.viewer_account == viewer_account
            })
            .map(|(id, _)| id.clone())
            .collect();
        for request_id in expired {
            if let Some(request) = requests.remove(&request_id) {
                publisher.pending.remove(&request_id);
                pending_ids.push(request.viewer_events.clone());
            }
        }
    }
    if !events.is_empty()
        && publisher.presence_enabled
        && let Ok(viewer_count) = u8::try_from(publisher.viewers.len())
    {
        let _ = publisher.events.try_send(ConnectionEvent::ViewerPresence {
            session_id: joined.session_id.clone(),
            change: ViewerPresenceChange::Left,
            viewer_count,
        });
    }
    drop(publishers);
    for events in events {
        let _ = events.try_send(ConnectionEvent::Close(CloseReason::Revoked));
    }
    for events in pending_ids {
        let _ = events.try_send(ConnectionEvent::ViewDecision {
            request_id: String::new(),
            decision: ViewDecisionKind::Deny,
            approval_id: String::new(),
        });
    }
    Ok(())
}

/// Expire pending requests on each tick: publishers going offline or silent
/// never admit viewers, and prompts cannot accumulate. The publisher sees a
/// close notification; the viewer sees a denial.
fn expire_pending_views(state: &SignalingState) {
    let expired: Vec<(String, PendingView)> = {
        let Ok(mut requests) = state.view_requests.lock() else {
            return;
        };
        let now = Instant::now();
        let ids: Vec<String> = requests
            .iter()
            .filter(|(_, request)| request.expires <= now)
            .map(|(request_id, _)| request_id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|request_id| {
                requests
                    .remove(&request_id)
                    .map(|request| (request_id, request))
            })
            .collect()
    };
    if expired.is_empty() {
        return;
    }
    let mut publishers = match state.publishers.lock() {
        Ok(publishers) => publishers,
        Err(_) => return,
    };
    for (request_id, request) in expired {
        if let Some(publisher) = publishers.get_mut(&request.publisher_session_id) {
            publisher.pending.remove(&request_id);
            if publisher
                .events
                .try_send(ConnectionEvent::ViewRequestClosed {
                    request_id: request_id.clone(),
                })
                .is_err()
            {
                publisher.presence_overloaded = true;
            }
        }
        let _ = request
            .viewer_events
            .try_send(ConnectionEvent::ViewDecision {
                request_id,
                decision: ViewDecisionKind::Deny,
                approval_id: String::new(),
            });
    }
}

/// Drop pending requests and unused approvals owned by a leaving viewer session.
fn drop_viewer_state(state: &SignalingState, session_id: &str) {
    let mut requests = match state.view_requests.lock() {
        Ok(requests) => requests,
        Err(_) => return,
    };
    let owned: Vec<String> = requests
        .iter()
        .filter(|(_, request)| request.viewer_session_id == session_id)
        .map(|(id, _)| id.clone())
        .collect();
    for request_id in owned {
        if let Some(request) = requests.remove(&request_id) {
            let _ = request
                .publisher_events
                .try_send(ConnectionEvent::ViewRequestClosed { request_id });
        }
    }
    drop(requests);
    if let Ok(mut publishers) = state.publishers.lock() {
        for publisher in publishers.values_mut() {
            publisher
                .approvals
                .retain(|_, approval| approval.viewer_session_id != session_id);
        }
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
        tracing::warn!(code = "origin", "signaling upgrade rejected");
        return StatusCode::FORBIDDEN.into_response();
    }
    if uri.query().is_some()
        || headers.contains_key(header::AUTHORIZATION)
        || headers.contains_key(header::COOKIE)
    {
        tracing::warn!(
            code = "unexpected_auth_or_query",
            "signaling upgrade rejected"
        );
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(upgrade) = upgrade else {
        tracing::warn!(code = "invalid_upgrade", "signaling upgrade rejected");
        return StatusCode::BAD_REQUEST.into_response();
    };
    let upgrade = upgrade.protocols(["dass.v1"]);
    if upgrade.selected_protocol().is_none() {
        tracing::warn!(code = "subprotocol", "signaling upgrade rejected");
        return StatusCode::BAD_REQUEST.into_response();
    }
    // Only the accepted TCP socket's peer address is authoritative here. Do
    // not consult forwarding headers or any address claimed by the client.
    let observed_ip = connect_info.map(|Extension(ConnectInfo(PeerAddress(address)))| address.ip());
    let observed_peer_ip = observed_ip.and_then(|ip| match ip {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    });
    if state
        .rtc_spike
        .as_ref()
        .is_some_and(SpikeConfig::auto_lan_peers_enabled)
        && !observed_peer_ip.is_some_and(crate::rtc::auto_lan_ip)
    {
        tracing::warn!(code = "auto_lan_peer_policy", "signaling upgrade rejected");
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(connection) = state.connections.clone().try_acquire_owned() else {
        tracing::warn!(code = "connection_limit", "signaling upgrade rejected");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(unauthenticated) = state.unauthenticated.clone().try_acquire_owned() else {
        tracing::warn!(code = "unauthenticated_limit", "signaling upgrade rejected");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let maximum = state.maximum_message_bytes;
    upgrade
        .read_buffer_size(4096)
        .write_buffer_size(0)
        .max_write_buffer_size(maximum * 2)
        .max_message_size(maximum)
        .max_frame_size(maximum)
        .on_upgrade(move |socket| {
            run(socket, state, connection, unauthenticated, observed_ip).instrument(
                tracing::info_span!(
                    "signaling",
                    connection = NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed)
                ),
            )
        })
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
    if let ServerOperation::Rejected { code } = &operation {
        tracing::warn!(code = error_code(code), "signaling request rejected");
    }
    let response = ServerMessage {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        operation,
    };
    let Ok(json) = serde_json::to_string(&response) else {
        tracing::error!(code = "serialization", "signaling response failed");
        return false;
    };
    if json.len() > MAX_MESSAGE_BYTES {
        tracing::warn!(code = "size_limit", "signaling response failed");
        return false;
    }
    let sent = matches!(
        tokio::time::timeout(SEND_TIMEOUT, socket.send(Message::Text(json.into()))).await,
        Ok(Ok(()))
    );
    if !sent {
        tracing::warn!(code = "socket_or_timeout", "signaling response failed");
    }
    sent
}

async fn close(socket: &mut WebSocket, session: Option<&JoinedSession>, reason: CloseReason) {
    let code = match &reason {
        CloseReason::Left => "left",
        CloseReason::Expired => "expired",
        CloseReason::Revoked => "revoked",
        CloseReason::SetupTimeout => "setup_timeout",
        CloseReason::Overloaded => "overloaded",
        CloseReason::TransportFailed => "transport_failed",
    };
    tracing::info!(code, joined = session.is_some(), "signaling closing");
    if let Some(session) = session {
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
    observed_ip: Option<IpAddr>,
) -> Result<(String, AccountLease), ErrorCode> {
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
    // Bounded per-source throttling is an abuse control, not an IP allowlist.
    state.admit_login_source(observed_ip)?;
    let permit = state
        .verifications
        .clone()
        .try_acquire_owned()
        .map_err(|_| ErrorCode::Overloaded)?;
    let invites = state.invites.borrow_and_update().clone();
    let verification_invites = invites.clone();
    // A cancelled login leaves the permit inside the non-cancellable bounded worker.
    let account = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        match login_input {
            LoginInput::Credential(credential) => verification_invites.verify(&credential),
            LoginInput::Account { username, password } => {
                verification_invites.verify_account(&username, &password)
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
    if current_policy.current(&account).is_none() {
        return Err(ErrorCode::Unauthorized);
    }
    let lease = state.claim_account(account)?;
    Ok((message.request_id, lease))
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
    observed_ip: Option<IpAddr>,
) {
    tracing::info!("signaling socket opened");
    let observed_peer_ip = observed_ip.and_then(|ip| match ip {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    });
    let mut failure_request_id = "login_rejected".to_owned();
    let result = tokio::time::timeout(
        Duration::from_millis(LOGIN_DEADLINE_MS as u64),
        login(
            &mut socket,
            &mut state,
            &mut failure_request_id,
            observed_ip,
        ),
    )
    .await;
    let (request_id, identity) = match result {
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
    tracing::info!("signaling authenticated");
    let Ok(now) = now_seconds() else {
        return;
    };
    // Sessions are bounded from authentication; there is no scheduled account
    // expiration. Re-authentication starts a fresh session and approvals.
    let expires = now.saturating_add(SESSION_LIFETIME_SECONDS);
    let expiry_deadline = Instant::now() + Duration::from_secs(SESSION_LIFETIME_SECONDS as u64);
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
    let (event_sender, mut event_receiver) = mpsc::channel::<ConnectionEvent>(MAX_QUEUED_MESSAGES);
    let account = identity.account.clone();
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
                    tracing::warn!(stage = "rtc_tick", "media transport failed");
                    close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                    break;
                }
                expire_pending_views(&state);
                if let Some(joined) = session.as_mut()
                    && register_publisher(&state, joined).is_err() {
                    close(&mut socket, session.as_ref(), CloseReason::Overloaded).await;
                    break;
                }
                if session.as_ref().is_some_and(|joined| {
                    joined
                        .publisher
                        .as_ref()
                        .is_some_and(PublisherLease::presence_overloaded)
                }) {
                    close(&mut socket, session.as_ref(), CloseReason::Overloaded).await;
                    break;
                }
            }
            event = event_receiver.recv() => {
                let Some(event) = event else { break; };
                let push = match event {
                    ConnectionEvent::Close(reason) => {
                        close(&mut socket, session.as_ref(), reason).await;
                        break;
                    }
                    ConnectionEvent::ViewerPresence { session_id, change, viewer_count } => {
                        if !session.as_ref().is_some_and(|joined| joined.session_id == session_id) {
                            continue;
                        }
                        send(&mut socket, PRESENCE_REQUEST_ID.into(), ServerOperation::ViewerPresence {
                            session_id, change, viewer_count,
                        }).await
                    }
                    ConnectionEvent::ViewRequest { request_id, viewer_id, viewer_display_name } => {
                        let Some(joined) = session.as_ref() else { continue; };
                        send(&mut socket, VIEW_REQUEST_PUSH_ID.into(), ServerOperation::ViewRequest {
                            session_id: joined.session_id.clone(),
                            request_id, viewer_id, viewer_display_name,
                        }).await
                    }
                    ConnectionEvent::ViewRequestClosed { request_id } => {
                        let Some(joined) = session.as_ref() else { continue; };
                        send(&mut socket, VIEW_REQUEST_CLOSED_PUSH_ID.into(), ServerOperation::ViewRequestClosed {
                            session_id: joined.session_id.clone(), request_id,
                        }).await
                    }
                    ConnectionEvent::ViewDecision { request_id, decision, approval_id } => {
                        let Some(joined) = session.as_ref() else { continue; };
                        send(&mut socket, VIEW_DECISION_PUSH_ID.into(), ServerOperation::ViewDecision {
                            session_id: joined.session_id.clone(),
                            request_id, decision, approval_id,
                        }).await
                    }
                };
                if !push { break; }
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
                let store = state.invites.borrow().clone();
                if store.current(&account).is_none() || Instant::now() >= expiry_deadline {
                    close(&mut socket, session.as_ref(), CloseReason::Expired).await;
                    break;
                }
                let media_response = media_operation(&state, &account,
                    &message.operation, &mut session).await;
                let operation_type = operation_name(&message.operation);
                let response = match media_response {
                    Ok(Some(response)) => response,
                    Ok(None) => operate_for_peer(
                        &state,
                        &account,
                        message.operation,
                        (observed_peer_ip, &mut session, event_sender.clone()),
                        &mut last_left,
                    ),
                    Err(()) => {
                        tracing::warn!(operation = operation_type, "media operation failed");
                        close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                        break;
                    }
                };
                if operation_type != "directory" {
                    tracing::info!(operation = operation_type, rejected = matches!(&response, ServerOperation::Rejected { .. }), "signaling operation completed");
                }
                if !send(&mut socket, message.request_id, response).await { break; }
            }
            datagram = receive_datagram(session.as_ref(), &mut udp_buffer) => {
                let Ok((length, source)) = datagram else {
                    tracing::warn!(stage = "udp_receive", "media transport failed");
                    break;
                };
                if let Some(peer) = session.as_mut().and_then(|session| session.receive_peer.as_mut())
                    && peer.receive(&udp_buffer[..length], source).await.is_err() {
                    tracing::warn!(stage = "rtc_receive", "media transport failed");
                    close(&mut socket, session.as_ref(), CloseReason::TransportFailed).await;
                    break;
                }
            }
        }
    }
    // RAII releases membership, pending approvals and the exclusive account lease
    // on every exit.
    if let Some(joined) = session.as_mut() {
        let session_id = joined.session_id.clone();
        drop(joined.receive_peer.take());
        drop(joined.viewer_subscription.take());
        drop_viewer_state(&state, &session_id);
    }
    tracing::info!("signaling socket ended; releasing session resources");
}

fn error_code(code: &ErrorCode) -> &'static str {
    match code {
        ErrorCode::InvalidMessage => "invalid_message",
        ErrorCode::UnsupportedVersion => "unsupported_version",
        ErrorCode::Unauthorized => "unauthorized",
        ErrorCode::Replay => "replay",
        ErrorCode::E2eeUnavailable => "e2ee_unavailable",
        ErrorCode::Overloaded => "overloaded",
        ErrorCode::InvalidState => "invalid_state",
        ErrorCode::Denied => "denied",
        ErrorCode::TransportUnavailable => "transport_unavailable",
    }
}

fn operation_name(operation: &ClientOperation) -> &'static str {
    match operation {
        ClientOperation::Login { .. } => "login",
        ClientOperation::AccountLogin { .. } => "account_login",
        ClientOperation::Directory { .. } => "directory",
        ClientOperation::Join { .. } => "join",
        ClientOperation::Leave { .. } => "leave",
        ClientOperation::Publish { .. } => "publish",
        ClientOperation::EnableViewerPresence { .. } => "enable_viewer_presence",
        ClientOperation::RequestView { .. } => "request_view",
        ClientOperation::ViewDecision { .. } => "view_decision",
        ClientOperation::Subscribe { .. } => "subscribe",
        ClientOperation::RemoveViewer { .. } => "remove_viewer",
        ClientOperation::Offer { .. } => "offer",
        ClientOperation::Ice { .. } => "ice",
    }
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
    account: &str,
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
        ClientOperation::Subscribe {
            publisher_id,
            approval_id,
            ..
        } => {
            if joined.receive_peer.is_some() {
                return Ok(Some(rejected(ErrorCode::InvalidState)));
            }
            // Backend-enforced approval: the opaque ID is consumed exactly once
            // and only for the stream, viewer session and account it names.
            let approved = {
                let mut publishers = state.publishers.lock().map_err(|_| ())?;
                let Some(publisher) = publishers.get_mut(publisher_id) else {
                    return Ok(Some(rejected(ErrorCode::InvalidState)));
                };
                if publisher.room_id != joined.room.room_id
                    || publisher.blocked_accounts.contains(account)
                {
                    return Ok(Some(rejected(ErrorCode::InvalidState)));
                }
                match publisher.approvals.remove(approval_id) {
                    Some(approval)
                        if approval.viewer_session_id == joined.session_id
                            && approval.viewer_account == account =>
                    {
                        true
                    }
                    _ => false,
                }
            };
            if !approved {
                return Ok(Some(rejected(ErrorCode::Unauthorized)));
            }
            let peer = match SpikePeer::subscriber_for_session(
                config,
                &joined.room.room_id,
                publisher_id,
                session_id,
                joined.observed_peer_ip,
            )
            .await
            {
                Ok(peer) => peer,
                // Deliberately do not disclose whether a publisher exists in another room.
                Err(_) => return Ok(Some(rejected(ErrorCode::InvalidState))),
            };
            let subscription = match register_viewer_subscription(
                state,
                &joined.room.room_id,
                publisher_id,
                session_id,
                account,
                joined.events.clone(),
            ) {
                Ok(subscription) => subscription,
                Err(code) => return Ok(Some(rejected(code))),
            };
            joined.receive_peer = Some(peer);
            joined.viewer_subscription = Some(subscription);
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
    account: &str,
    operation: ClientOperation,
    session: &mut Option<JoinedSession>,
    last_left: &mut Option<String>,
) -> ServerOperation {
    let (events, _receiver) = mpsc::channel(MAX_QUEUED_MESSAGES);
    operate_for_peer(
        state,
        account,
        operation,
        (None, session, events),
        last_left,
    )
}

fn operate_for_peer(
    state: &SignalingState,
    account: &str,
    operation: ClientOperation,
    (observed_peer_ip, session, events): (
        Option<Ipv4Addr>,
        &mut Option<JoinedSession>,
        mpsc::Sender<ConnectionEvent>,
    ),
    last_left: &mut Option<String>,
) -> ServerOperation {
    match operation {
        ClientOperation::Login { .. } | ClientOperation::AccountLogin { .. } => {
            rejected(ErrorCode::InvalidState)
        }
        ClientOperation::Directory { room_id } => {
            let store = state.invites.borrow().clone();
            directory(state, &store, room_id)
        }
        ClientOperation::Join {
            room_id,
            require_e2ee,
        } => {
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
                events,
                session_account: account.to_owned(),
                receive_peer: None,
                publisher: None,
                viewer_presence_enabled: false,
                viewer_subscription: None,
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
            let leaving = joined.session_id.clone();
            *session = None;
            *last_left = Some(session_id.clone());
            drop_viewer_state(state, &leaving);
            ServerOperation::Closed {
                session_id,
                reason: CloseReason::Left,
            }
        }
        ClientOperation::RequestView {
            session_id,
            publisher_id,
        } => {
            let Some(joined) = session
                .as_ref()
                .filter(|joined| joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            if joined.viewer_subscription.is_some() || joined.receive_peer.is_some() {
                return rejected(ErrorCode::InvalidState);
            }
            match request_view(state, joined, &publisher_id) {
                Ok(request_id) => ServerOperation::ViewRequestPending {
                    session_id: session_id.clone(),
                    request_id,
                },
                Err(code) => rejected(code),
            }
        }
        ClientOperation::ViewDecision {
            session_id,
            request_id,
            decision,
        } => {
            let Some(joined) = session
                .as_ref()
                .filter(|joined| joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            match decide_view(state, joined, &request_id, &decision) {
                Ok(()) => ServerOperation::Accepted {
                    session_id: session_id.clone(),
                },
                Err(code) => rejected(code),
            }
        }
        ClientOperation::RemoveViewer {
            session_id,
            viewer_id,
        } => {
            let Some(joined) = session
                .as_ref()
                .filter(|joined| joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            match remove_viewer(state, joined, &viewer_id) {
                Ok(()) => ServerOperation::Accepted {
                    session_id: session_id.clone(),
                },
                Err(code) => rejected(code),
            }
        }
        operation => {
            let session_id = match &operation {
                ClientOperation::Publish { session_id }
                | ClientOperation::EnableViewerPresence { session_id }
                | ClientOperation::Subscribe { session_id, .. }
                | ClientOperation::Offer { session_id, .. }
                | ClientOperation::Ice { session_id, .. } => session_id,
                _ => return rejected(ErrorCode::InvalidState),
            };
            let Some(joined) = session
                .as_mut()
                .filter(|joined| &joined.session_id == session_id)
            else {
                return rejected(ErrorCode::InvalidState);
            };
            if matches!(&operation, ClientOperation::EnableViewerPresence { .. }) {
                if let Err(code) = enable_viewer_presence(state, joined) {
                    return rejected(code);
                }
                return ServerOperation::Accepted {
                    session_id: session_id.clone(),
                };
            }
            // Never return Accepted or process SDP/ICE before a media owner exists.
            rejected(ErrorCode::TransportUnavailable)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{InviteFile, UsersFile, create_invite, create_invite_with_display_name, create_user};

    fn store_with_invites(invites: Vec<crate::auth::Invite>) -> Arc<InviteStore> {
        Arc::new(
            InviteStore::from_bytes(
                &serde_json::to_vec(&InviteFile {
                    version: 2,
                    invites,
                })
                .unwrap(),
            )
            .unwrap(),
        )
    }

    fn users_store(users: Vec<crate::auth::User>) -> Arc<InviteStore> {
        Arc::new(
            InviteStore::from_users_bytes(
                &serde_json::to_vec(&UsersFile {
                    version: 2,
                    users,
                })
                .unwrap(),
            )
            .unwrap(),
        )
    }

    fn publisher_entry(account: &str) -> (mpsc::Receiver<ConnectionEvent>, PublisherEntry) {
        let (events, receiver) = mpsc::channel(MAX_QUEUED_MESSAGES);
        (
            receiver,
            PublisherEntry {
                room_id: "room".into(),
                account: account.into(),
                viewers: HashMap::new(),
                pending: HashSet::new(),
                approvals: HashMap::new(),
                blocked_accounts: HashSet::new(),
                denied_at: HashMap::new(),
                events,
                presence_enabled: true,
                presence_overloaded: false,
            },
        )
    }

    fn viewer_session(
        account: &str,
        session_id: &str,
    ) -> (mpsc::Receiver<ConnectionEvent>, JoinedSession) {
        let (events, receiver) = mpsc::channel(MAX_QUEUED_MESSAGES);
        let session = JoinedSession {
                session_id: session_id.into(),
                session_account: account.into(),
                room: RoomLease {
                    room_id: "room".into(),
                    rooms: Arc::new(Mutex::new(HashMap::new())),
                },
                setup_deadline: Instant::now() + Duration::from_secs(60),
                observed_peer_ip: None,
                events,
                receive_peer: None,
                publisher: None,
                viewer_presence_enabled: false,
                viewer_subscription: None,
        };
        (receiver, session)
    }

    async fn next_event(receiver: &mut mpsc::Receiver<ConnectionEvent>) -> ConnectionEvent {
        tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn view_requests_are_publisher_owned_bounded_and_decided_once() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let (mut publisher_events, entry) = publisher_entry("publisher_account");
        state
            .publishers
            .lock()
            .unwrap()
            .insert("publisher_session".into(), entry);
        let (mut viewer_events, viewer) = viewer_session("viewer_account", "viewer_session");

        // Another room or a missing stream never reveals whether it exists.
        let mut wrong_room = viewer_session("viewer_account", "other_session").1;
        wrong_room.room.room_id = "other_room".into();
        assert!(matches!(
            request_view(&state, &wrong_room, "publisher_session"),
            Err(ErrorCode::InvalidState)
        ));
        assert!(matches!(
            request_view(&state, &viewer, "missing_publisher"),
            Err(ErrorCode::InvalidState)
        ));

        request_view(&state, &viewer, "publisher_session").unwrap();
        let pushed = next_event(&mut publisher_events).await;
        let request_id = match pushed {
            ConnectionEvent::ViewRequest {
                request_id,
                viewer_id,
                viewer_display_name,
            } => {
                assert_eq!(viewer_id, "viewer_account");
                assert_eq!(viewer_display_name, "viewer_account");
                request_id
            }
            _ => panic!("expected a pushed view request"),
        };
        // Duplicates do not queue a second prompt.
        assert!(matches!(
            request_view(&state, &viewer, "publisher_session"),
            Err(ErrorCode::InvalidState)
        ));

        let (mut decider_events, decider) = viewer_session("viewer_account", "decider_session");
        decider.room.room_id = "room".into();
        let _ = &mut decider_events;
        // A non-publisher session cannot decide someone else's request.
        assert!(matches!(
            decide_view(&state, &decider, &request_id, &ViewDecisionKind::Approve),
            Err(ErrorCode::InvalidState)
        ));

        let publisher_joined = JoinedSession {
            session_id: "publisher_session".into(),
            ..viewer_session("publisher_account", "ignored").1
        };
        decide_view(
            &state,
            &publisher_joined,
            &request_id,
            &ViewDecisionKind::Approve,
        )
        .unwrap();
        let decision = next_event(&mut viewer_events).await;
        let approval_id = match decision {
            ConnectionEvent::ViewDecision {
                decision,
                approval_id,
                request_id: decided,
            } => {
                assert!(matches!(decision, ViewDecisionKind::Approve));
                assert_eq!(decided, request_id);
                approval_id
            }
            _ => panic!("expected a pushed approval"),
        };
        assert!(!approval_id.is_empty());
        // Decisions are single-use; replaying one cannot reuse the pending ID.
        assert!(matches!(
            decide_view(&state, &publisher_joined, &request_id, &ViewDecisionKind::Deny),
            Err(ErrorCode::InvalidState)
        ));
        // The approval is bound to the owning stream entry.
        let approval = state
            .publishers
            .lock()
            .unwrap()
            .get("publisher_session")
            .unwrap()
            .approvals
            .get(&approval_id)
            .unwrap();
        assert_eq!(approval.viewer_session_id, "viewer_session");
        assert_eq!(approval.viewer_account, "viewer_account");
    }

    #[tokio::test]
    async fn denials_cool_down_and_blocks_remove_access() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let (mut publisher_events, entry) = publisher_entry("publisher_account");
        state
            .publishers
            .lock()
            .unwrap()
            .insert("publisher_session".into(), entry);
        let (mut viewer_events, viewer) = viewer_session("viewer_account", "viewer_session");
        let publisher_joined = viewer_session("publisher_account", "publisher_session").1;

        request_view(&state, &viewer, "publisher_session").unwrap();
        let request_id = match next_event(&mut publisher_events).await {
            ConnectionEvent::ViewRequest { request_id, .. } => request_id,
            _ => panic!("expected request"),
        };
        decide_view(&state, &publisher_joined, &request_id, &ViewDecisionKind::Deny).unwrap();
        assert!(matches!(
            next_event(&mut viewer_events).await,
            ConnectionEvent::ViewDecision {
                decision: ViewDecisionKind::Deny,
                ..
            }
        ));
        // Denied viewers get a cooldown before they can prompt again.
        assert!(matches!(
            request_view(&state, &viewer, "publisher_session"),
            Err(ErrorCode::Denied)
        ));
        state
            .publishers
            .lock()
            .unwrap()
            .get_mut("publisher_session")
            .unwrap()
            .denied_at
            .clear();

        // An active viewer of the same account is closed when a later request
        // is blocked: withdrawal terminates routes, not just prompts.
        let (mut active_events, active) = viewer_session("viewer_account", "active_session");
        register_viewer_subscription(
            &state,
            "room",
            "publisher_session",
            "active_session",
            "viewer_account",
            active.events.clone(),
        )
        .unwrap();
        let (_blocked_events, blocked) = viewer_session("viewer_account", "blocked_session");
        request_view(&state, &blocked, "publisher_session").unwrap();
        let request_id = match next_event(&mut publisher_events).await {
            ConnectionEvent::ViewRequest { request_id, .. } => request_id,
            _ => panic!("expected second request"),
        };
        decide_view(&state, &publisher_joined, &request_id, &ViewDecisionKind::Block).unwrap();
        assert!(matches!(
            next_event(&mut active_events).await,
            ConnectionEvent::Close(CloseReason::Revoked)
        ));
        assert!(matches!(
            request_view(&state, &viewer, "publisher_session"),
            Err(ErrorCode::Denied)
        ));
        // Blocked accounts cannot use a stale approval either.
        assert!(
            state
                .publishers
                .lock()
                .unwrap()
                .get("publisher_session")
                .unwrap()
                .blocked_accounts
                .contains("viewer_account")
        );
    }

    #[tokio::test]
    async fn remove_viewer_terminates_sessions_approvals_and_prompts() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let (mut publisher_events, entry) = publisher_entry("publisher_account");
        state
            .publishers
            .lock()
            .unwrap()
            .insert("publisher_session".into(), entry);
        let publisher_joined = viewer_session("publisher_account", "publisher_session").1;
        let (mut viewer_events, viewer) = viewer_session("viewer_account", "viewer_session");
        let (_ignored, active) = viewer_session("active_account", "active_session");
        register_viewer_subscription(
            &state,
            "room",
            "publisher_session",
            "active_session",
            "active_account",
            active.events.clone(),
        )
        .unwrap();
        request_view(&state, &viewer, "publisher_session").unwrap();
        match next_event(&mut publisher_events).await {
            ConnectionEvent::ViewRequest { .. } => {}
            _ => panic!("expected request"),
        }
        // Clearing only a pending prompt must not emit a viewer_presence left.
        remove_viewer(&state, &publisher_joined, "viewer_account").unwrap();
        assert!(matches!(
            next_event(&mut viewer_events).await,
            ConnectionEvent::ViewDecision {
                decision: ViewDecisionKind::Deny,
                ..
            }
        ));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), publisher_events.recv())
                .await
                .is_err()
        );
        // Removing an account with an active session emits exactly one left.
        remove_viewer(&state, &publisher_joined, "active_account").unwrap();
        match next_event(&mut publisher_events).await {
            ConnectionEvent::ViewerPresence {
                change: ViewerPresenceChange::Left,
                viewer_count: 0,
                ..
            } => {}
            _ => panic!("expected single presence left"),
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), publisher_events.recv())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn publisher_offline_closes_pending_requests_and_viewers() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let (mut publisher_events, entry) = publisher_entry("publisher_account");
        let _ = &mut publisher_events;
        state
            .publishers
            .lock()
            .unwrap()
            .insert("publisher_session".into(), entry);
        let (mut viewer_events, viewer) = viewer_session("viewer_account", "viewer_session");
        request_view(&state, &viewer, "publisher_session").unwrap();
        // Active viewer of the same stream is closed when the publisher drops.
        let (mut active_events, active) = viewer_session("viewer2_account", "active_session");
        let subscription = register_viewer_subscription(
            &state,
            "room",
            "publisher_session",
            "active_session",
            "viewer2_account",
            active.events.clone(),
        )
        .unwrap();
        let _ = &mut active_events;

        let lease = PublisherLease {
            session_id: "publisher_session".into(),
            publishers: state.publishers.clone(),
            view_requests: state.view_requests.clone(),
            spike: None,
        };
        drop(lease);
        assert!(matches!(
            next_event(&mut viewer_events).await,
            ConnectionEvent::ViewDecision {
                decision: ViewDecisionKind::Deny,
                ..
            }
        ));
        assert!(matches!(
            next_event(&mut active_events).await,
            ConnectionEvent::Close(CloseReason::Revoked)
        ));
        assert!(state.view_requests.lock().unwrap().is_empty());
        assert!(state.publishers.lock().unwrap().is_empty());
        drop(subscription);
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
    async fn room_and_account_leases_are_bounded_and_released() {
        let (_sender, receiver) = watch::channel(Arc::new(InviteStore::default()));
        let state = SignalingState::new(receiver);
        let lease = state
            .claim_account("account_1".into())
            .unwrap_or_else(|_| panic!("lease"));
        assert!(matches!(
            state.claim_account("account_1".into()),
            Err(ErrorCode::Replay)
        ));
        drop(lease);
        assert!(state.claim_account("account_1".into()).is_ok());
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
    async fn any_authenticated_identity_may_join_and_list_but_never_decide() {
        let (invite, _) = create_invite("account_1".into()).unwrap();
        let store = store_with_invites(vec![invite]);
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver);
        let mut session = None;
        let mut left = None;
        let mut apply = |operation| {
            operate(
                &state,
                "account_1",
                operation,
                &mut session,
                &mut left,
            )
        };
        // No room grant exists anymore: joining any opaque room is grouping.
        let ServerOperation::Joined { session_id } = apply(ClientOperation::Join {
            room_id: "any_room".into(),
            require_e2ee: false,
        }) else {
            panic!("join")
        };
        assert!(matches!(
            apply(ClientOperation::Join {
                room_id: "any_room".into(),
                require_e2ee: true
            }),
            ServerOperation::Rejected {
                code: ErrorCode::E2eeUnavailable
            }
        ));
        assert!(matches!(
            apply(ClientOperation::Subscribe {
                session_id: session_id.clone(),
                publisher_id: "p".into(),
                approval_id: "a".into()
            }),
            ServerOperation::Rejected {
                code: ErrorCode::TransportUnavailable
            }
        ));
        assert!(matches!(
            apply(ClientOperation::Publish {
                session_id: session_id.clone()
            }),
            ServerOperation::Rejected {
                code: ErrorCode::TransportUnavailable
            }
        ));
        for _ in 0..2 {
            assert!(matches!(
                apply(ClientOperation::Leave {
                    session_id: session_id.clone()
                }),
                ServerOperation::Closed {
                    reason: CloseReason::Left,
                    ..
                }
            ));
        }
        assert!(state.rooms.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn directory_lists_live_publishers_with_display_names() {
        let (publisher_invite, _) = create_invite_with_display_name(
            "publisher".into(),
            Some("Studio PC".into()),
        )
        .unwrap();
        let (other_invite, _) = create_invite("outsider".into()).unwrap();
        let store = store_with_invites(vec![publisher_invite, other_invite]);
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver);
        let (_events, entry) = publisher_entry("publisher");
        state
            .publishers
            .lock()
            .unwrap()
            .insert("source".into(), entry);
        let ServerOperation::Directory {
            publishers,
            publisher_ids,
            ..
        } = directory(&state, &store, "room".into())
        else {
            panic!("directory");
        };
        assert_eq!(publisher_ids, vec!["source"]);
        assert_eq!(publishers[0].display_name, "Studio PC");
        // Rooms group discovery: another room sees nothing.
        let ServerOperation::Directory { publisher_ids, .. } =
            directory(&state, &store, "other".into())
        else {
            panic!("directory");
        };
        assert!(publisher_ids.is_empty());
    }

    #[tokio::test]
    async fn account_login_display_names_feed_view_requests() {
        let publisher = create_user("pub".into(), "a long publisher password", None).unwrap();
        let viewer = create_user(
            "alice".into(),
            "correct horse battery staple",
            Some("Alice Studio".into()),
        )
        .unwrap();
        let store = users_store(vec![publisher, viewer]);
        let (_sender, receiver) = watch::channel(store.clone());
        let state = SignalingState::new(receiver);
        let (mut publisher_events, entry) = publisher_entry("pub");
        state
            .publishers
            .lock()
            .unwrap()
            .insert("publisher_session".into(), entry);
        let (_viewer_events, viewer) = viewer_session("alice", "viewer_session");
        request_view(&state, &viewer, "publisher_session").unwrap();
        match next_event(&mut publisher_events).await {
            ConnectionEvent::ViewRequest {
                viewer_id,
                viewer_display_name,
                ..
            } => {
                assert_eq!(viewer_id, "alice");
                assert_eq!(viewer_display_name, "Alice Studio");
            }
            _ => panic!("expected view request"),
        }
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;
    use crate::{
        app_with_signaling,
        auth::{InviteFile, create_invite_with_display_name},
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

    async fn start() -> Server {
        start_with_spike(None).await
    }

    async fn start_with_spike(spike: Option<SpikeConfig>) -> Server {
        let (invite, credential) =
            create_invite_with_display_name("network_invite".into(), Some("DASS Publisher".into()))
                .unwrap();
        let (viewer_invite, viewer_credential) =
            create_invite_with_display_name("directory_viewer".into(), Some("DASS Viewer".into()))
                .unwrap();
        let store = InviteStore::from_bytes(
            &serde_json::to_vec(&InviteFile {
                version: 2,
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
        // Deliberately spoofed: admission must use the accepted TCP peer,
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
        authenticate_as(server, &server.credential.clone()).await
    }

    async fn authenticate_as(server: &Server, credential: &str) -> Client {
        let mut client = connect(server, "https://discord.com", "").await.unwrap();
        let result = request(
            &mut client,
            "login_1",
            serde_json::json!({ "type": "login", "credential": credential }),
        )
        .await;
        assert_eq!(result["operation"]["type"], "authenticated");
        client
    }

    async fn join(client: &mut Client, room: &str, request_id: &str) -> String {
        let joined = request(
            client,
            request_id,
            serde_json::json!({
                "type": "join", "room_id": room, "require_e2ee": false,
            }),
        )
        .await;
        assert_eq!(joined["operation"]["type"], "joined");
        joined["operation"]["session_id"].as_str().unwrap().to_owned()
    }

    #[tokio::test]
    async fn authenticated_sessions_are_bounded_and_revocation_closes_them() {
        let server = start().await;
        let mut client = authenticate(&server).await;
        let authenticated_at = now_seconds().unwrap();
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
        let session_id = join(&mut client, "room_1", "join").await;
        let result = request(&mut client, "subscribe", serde_json::json!({
            "type": "subscribe", "session_id": session_id, "publisher_id": "p", "approval_id": "a"
        }))
        .await;
        // Without the RTC spike a subscribe never reaches approval checks.
        assert_eq!(result["operation"]["code"], "transport_unavailable");
        server
            .invites
            .send_replace(Arc::new(InviteStore::default()));
        let result = response(&mut client).await;
        assert_eq!(result["operation"]["reason"], "revoked");
        let _ = authenticated_at;
    }

    #[tokio::test]
    async fn tls_websocket_enforces_origin_url_policy_and_admission() {
        let server = start().await;
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
        let server = start().await;
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
            if let Err(error) = read_result {
                assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
            }
            let response = String::from_utf8(bytes).unwrap();
            if assertions {
                assert!(response.starts_with("HTTP/1.1 200"));
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
            } else {
                assert!(response.starts_with("HTTP/1.1 503"));
            }
        }
    }

    #[tokio::test]
    async fn first_message_must_be_login_and_login_deadline_releases_admission() {
        let server = start().await;
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
        let server = start().await;
        let mut client = authenticate(&server).await;
        join(&mut client, "room_1", "join").await;
        let frame = tokio::time::timeout(Duration::from_secs(18), client.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let result: serde_json::Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
        assert_eq!(result["operation"]["reason"], "setup_timeout");
    }

    #[tokio::test]
    async fn view_requests_flow_over_wss_and_direct_subscribe_is_denied() {
        let server = start().await;
        // A registered connected publisher would need the RTC spike; without it
        // request_view cannot find a live stream and stays denied.
        let mut viewer = authenticate_as(&server, &server.viewer_credential).await;
        let session_id = join(&mut viewer, "room_1", "viewer_join").await;
        let result = request(
            &mut viewer,
            "request_missing",
            serde_json::json!({
                "type": "request_view", "session_id": session_id, "publisher_id": "missing"
            }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "invalid_state");
        let result = request(
            &mut viewer,
            "subscribe_direct",
            serde_json::json!({
                "type": "subscribe", "session_id": session_id,
                "publisher_id": "missing", "approval_id": "forged"
            }),
        )
        .await;
        assert_eq!(result["operation"]["code"], "transport_unavailable");
    }
}
