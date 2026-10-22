//! Bounded media transport with an explicit deployment mode.
//! Each mutation is completely drained before another mutation or socket await.
//!
//! The transport has two modes. `Local` is a test environment for private LAN
//! peers and explicit allowlists. `Public` is the Internet target: media
//! admission is bound to the authenticated signaling session and to the peer
//! address observed on that session's TCP connection, so the backend never
//! dials a client-supplied destination and never becomes a scanner or a relay.

mod udp;

use crate::forwarding::{
    ForwardPacket, MediaHub, PACKET_QUEUE_CAPACITY, PublisherEndpoint, SubscriberEndpoint,
};
use crate::transport::{MediaAdmission, Refusal, TransportMode, is_global_unicast};
use std::{
    collections::HashSet,
    net::{IpAddr, SocketAddr},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use str0m::{
    Candidate, Event, IceConnectionState, Input, Output, Rtc,
    change::SdpOffer,
    crypto::dtls::DtlsVersion,
    format::Codec,
    media::{KeyframeRequestKind, MediaKind, Mid},
    net::{Protocol, Receive},
    rtp::RtpWrite,
};
use tokio::sync::{OnceCell, OwnedSemaphorePermit, Semaphore};
use udp::{SessionUdp, SharedUdp};

const MAX_CANDIDATES: usize = 16;
const MAX_TRUSTED_CLIENT_IPS: usize = 16;
/// An IPv6 address is at most 39 characters; keep the configured list bounded.
const MAX_TRUSTED_CLIENT_IPS_CONFIG_BYTES: usize =
    MAX_TRUSTED_CLIENT_IPS * 40 + (MAX_TRUSTED_CLIENT_IPS - 1);
const MAX_OUTPUTS_PER_MUTATION: usize = 256;
const MAX_DATAGRAM_BYTES: usize = 2_048;
const MAX_PENDING_DATAGRAMS: usize = 32;
const MAX_BUDGET_DROPS: usize = 64;
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LIFETIME: Duration = Duration::from_secs(600);

/// Bounded media budgets. One account or one source cannot monopolize the
/// service: every media session has its own packet, byte and queue limits and
/// the number of concurrent media sessions is capped.
#[derive(Clone, Copy, Debug)]
pub struct MediaLimits {
    pub max_sessions: usize,
    pub max_packets_per_second: usize,
    pub max_ingress_bytes_per_second: usize,
    pub max_egress_bytes_per_second: usize,
}

impl Default for MediaLimits {
    fn default() -> Self {
        Self {
            max_sessions: 4,
            max_packets_per_second: 2_000,
            max_ingress_bytes_per_second: 2_000_000,
            max_egress_bytes_per_second: 4_000_000,
        }
    }
}

/// No Debug implementation: configuration contains sensitive network addresses.
#[derive(Clone)]
pub struct TransportConfig {
    mode: TransportMode,
    bind_ip: IpAddr,
    advertised_ip: IpAddr,
    first_port: u16,
    // Exact endpoint allowlisting remains a local-mode tool. Trusted IPs are an
    // explicit local-mode alternative for Chromium's per-session UDP ports.
    allowed_peers: HashSet<SocketAddr>,
    trusted_client_ips: HashSet<IpAddr>,
    auto_lan_peers: bool,
    admission: Arc<Semaphore>,
    hub: Arc<MediaHub>,
    sockets: Arc<OnceCell<Arc<SharedUdp>>>,
    limits: MediaLimits,
}

impl TransportConfig {
    async fn shared_sockets(&self) -> Result<&Arc<SharedUdp>, MediaFailure> {
        self.sockets
            .get_or_try_init(|| SharedUdp::bind(self.bind_ip, self.first_port, self.limits))
            .await
    }

    pub async fn initialize(&self) -> Result<(), MediaFailure> {
        self.shared_sockets().await.map(|_| ())
    }

    pub(crate) fn auto_lan_peers_enabled(&self) -> bool {
        self.auto_lan_peers
    }

    /// Clear one publisher's forwarding registration, including any queued
    /// viewer packets, before its endpoint or session finishes teardown.
    pub fn close_publisher(&self, publisher_id: &str) {
        self.hub.close_publisher(publisher_id);
    }

    /// Clear one viewer's route and queued packets (publisher removal/block).
    pub fn drop_viewer(&self, publisher_id: &str, subscriber_id: &str) {
        self.hub.drop_viewer(publisher_id, subscriber_id);
    }

    /// Disabled unless explicitly requested. The media transport requires TLS
    /// signaling in every mode.
    pub fn from_env(tls_enabled: bool, mode: TransportMode) -> Result<Option<Self>, &'static str> {
        Self::from_lookup(tls_enabled, mode, |name| std::env::var(name).ok())
    }

    pub fn from_lookup(
        tls_enabled: bool,
        mode: TransportMode,
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, &'static str> {
        match lookup("DASS_RTC_SPIKE").as_deref() {
            None | Some("false") => return Ok(None),
            Some("true") if tls_enabled => {}
            _ => return Err("the media transport requires explicit opt-in and TLS signaling"),
        }
        let bind_ip: IpAddr = lookup("DASS_RTC_BIND_IP")
            .ok_or("the media transport requires a bind IP address")?
            .parse()
            .map_err(|_| "invalid media transport bind IP address")?;
        let advertised_ip: IpAddr = lookup("DASS_RTC_ADVERTISED_IP")
            .ok_or("the media transport requires an advertised IP address")?
            .parse()
            .map_err(|_| "invalid media transport advertised IP address")?;
        if bind_ip.is_ipv4() != advertised_ip.is_ipv4() {
            return Err("the advertised media address must use the bind address family");
        }
        if !mode.permits_media_address(advertised_ip) {
            return Err("unsafe advertised media address");
        }
        let first_port: u16 = lookup("DASS_RTC_FIRST_PORT")
            .ok_or("the media transport requires a first UDP port")?
            .parse()
            .map_err(|_| "invalid media transport UDP port")?;
        if !(1024..=65534).contains(&first_port) {
            return Err("the media transport requires two consecutive non-privileged UDP ports");
        }
        let auto_lan_peers = match lookup("DASS_RTC_AUTO_LAN_PEERS").as_deref() {
            None | Some("false") => false,
            Some("true") => true,
            _ => return Err("invalid automatic LAN peer admission setting"),
        };
        let mut allowed_peers = HashSet::new();
        if let Some(peers) = lookup("DASS_RTC_ALLOWED_PEERS") {
            if peers.len() > 1024 {
                return Err("media transport peer allowlist too large");
            }
            if !peers.is_empty() {
                for entry in peers.split(',') {
                    let address: SocketAddr = entry
                        .parse()
                        .map_err(|_| "invalid media transport peer address")?;
                    if !mode.permits_media_address(address.ip()) || address.port() < 1024 {
                        return Err("unsafe media transport peer destination");
                    }
                    if !allowed_peers.insert(address) || allowed_peers.len() > MAX_CANDIDATES {
                        return Err("duplicate or excessive media transport peers");
                    }
                }
            }
        }
        let mut trusted_client_ips = HashSet::new();
        if let Some(clients) = lookup("DASS_RTC_TRUSTED_CLIENT_IPS") {
            if clients.len() > MAX_TRUSTED_CLIENT_IPS_CONFIG_BYTES {
                return Err("media transport trusted client address list too large");
            }
            if !clients.is_empty() {
                for entry in clients.split(',') {
                    let ip: IpAddr = entry
                        .parse()
                        .map_err(|_| "invalid trusted media transport client address")?;
                    if !mode.permits_media_address(ip) {
                        return Err("unsafe trusted media transport client address");
                    }
                    if !trusted_client_ips.insert(ip)
                        || trusted_client_ips.len() > MAX_TRUSTED_CLIENT_IPS
                    {
                        return Err(
                            "duplicate or excessive trusted media transport client addresses",
                        );
                    }
                }
            }
        }
        if mode == TransportMode::Public {
            // A public deployment has no LAN trust: allowlists, trusted client
            // addresses and automatic LAN admission are local-mode tools.
            if !allowed_peers.is_empty() || !trusted_client_ips.is_empty() || auto_lan_peers {
                return Err("a public media deployment does not accept LAN allowlists");
            }
            if !is_global_unicast(advertised_ip) {
                return Err(
                    "a public media deployment requires a globally routable advertised address",
                );
            }
        } else if allowed_peers.is_empty() && trusted_client_ips.is_empty() && !auto_lan_peers {
            return Err(
                "the local media transport requires static peers or automatic LAN admission",
            );
        }
        let limits = MediaLimits {
            max_sessions: bounded_integer(
                lookup("DASS_MAX_MEDIA_SESSIONS"),
                MediaLimits::default().max_sessions,
                64,
            )?,
            max_packets_per_second: bounded_integer(
                lookup("DASS_MAX_PACKETS_PER_SECOND"),
                MediaLimits::default().max_packets_per_second,
                20_000,
            )?,
            max_ingress_bytes_per_second: bounded_integer(
                lookup("DASS_MAX_INGRESS_BYTES_PER_SECOND"),
                MediaLimits::default().max_ingress_bytes_per_second,
                20_000_000,
            )?,
            max_egress_bytes_per_second: bounded_integer(
                lookup("DASS_MAX_EGRESS_BYTES_PER_SECOND"),
                MediaLimits::default().max_egress_bytes_per_second,
                40_000_000,
            )?,
        };
        Ok(Some(Self {
            mode,
            bind_ip,
            advertised_ip,
            first_port,
            allowed_peers,
            trusted_client_ips,
            auto_lan_peers,
            admission: Arc::new(Semaphore::new(limits.max_sessions)),
            hub: Arc::new(MediaHub::new(limits.max_sessions)),
            sockets: Arc::new(OnceCell::new()),
            limits,
        }))
    }
}

fn bounded_integer(
    value: Option<String>,
    default: usize,
    maximum: usize,
) -> Result<usize, &'static str> {
    let value = match value {
        Some(value) => value.parse().map_err(|_| "invalid numeric media limit")?,
        None => default,
    };
    if value == 0 || value > maximum {
        return Err("configured media limit is outside the supported range");
    }
    Ok(value)
}

/// Fixed failures only: no SDP, remote addresses, or crypto errors in logs.
#[derive(Debug)]
pub struct MediaFailure;

/// One second of byte budget for a single media session.
#[derive(Debug)]
struct ByteWindow {
    start: Instant,
    bytes: usize,
}

impl ByteWindow {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            bytes: 0,
        }
    }

    /// Charge `bytes` against the budget. Returns false once the budget for
    /// the current window is exhausted.
    fn charge(&mut self, bytes: usize, maximum: usize) -> bool {
        if self.start.elapsed() >= Duration::from_secs(1) {
            self.start = Instant::now();
            self.bytes = 0;
        }
        self.bytes = self.bytes.saturating_add(bytes);
        self.bytes <= maximum
    }
}

/// Byte counters for one media session. They contain no addresses, payload
/// content or identifiers: only how many bytes crossed the session. The
/// administrator panel may read them; clients never receive them.
#[derive(Clone, Debug, Default)]
pub struct MediaCounters {
    ingress_bytes: Arc<AtomicU64>,
    egress_bytes: Arc<AtomicU64>,
}

impl MediaCounters {
    pub fn new() -> Self {
        Self::default()
    }

    fn add_ingress(&self, bytes: u64) {
        self.ingress_bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    fn add_egress(&self, bytes: u64) {
        self.egress_bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    /// Bytes received from the peer since the session started.
    pub fn ingress_bytes(&self) -> u64 {
        self.ingress_bytes.load(Ordering::Relaxed)
    }

    /// Bytes forwarded to the peer since the session started.
    pub fn egress_bytes(&self) -> u64 {
        self.egress_bytes.load(Ordering::Relaxed)
    }
}

pub struct MediaPeer {
    rtc: Rtc,
    socket: SessionUdp,
    advertised: SocketAddr,
    admission: MediaAdmission,
    session_peers: HashSet<SocketAddr>,
    limits: MediaLimits,
    _admission: OwnedSemaphorePermit,
    next_timeout: Instant,
    started: Instant,
    last_packet: Instant,
    rate_started: Instant,
    packets_in_window: usize,
    ingress: ByteWindow,
    egress: ByteWindow,
    counters: MediaCounters,
    budget_drops: usize,
    candidates: usize,
    offered: bool,
    connected: bool,
    received_rtp_packets: u64,
    route: PeerRoute,
    tracks: Vec<(Mid, MediaKind)>,
    outgoing_sequences: [u64; 2],
    last_keyframe: Instant,
}

enum PeerRoute {
    Sink,
    Publisher(PublisherEndpoint),
    Subscriber(SubscriberEndpoint),
}

impl MediaPeer {
    pub async fn bind(config: &TransportConfig) -> Result<Self, MediaFailure> {
        Self::bind_for_session(config, None).await
    }

    pub async fn bind_for_session(
        config: &TransportConfig,
        observed_peer_ip: Option<IpAddr>,
    ) -> Result<Self, MediaFailure> {
        let admission = MediaAdmission::new(
            config.mode,
            observed_peer_ip,
            config.allowed_peers.clone(),
            config.trusted_client_ips.clone(),
            config.auto_lan_peers,
        );
        // A session without an admissible peer never carries media.
        if !admission.admits_media() {
            return Err(MediaFailure);
        }
        let admission_permit = config
            .admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| MediaFailure)?;
        let now = Instant::now();
        let mut rtc = Rtc::builder()
            .set_crypto_provider(Arc::new(str0m_aws_lc_rs::default_provider()))
            .set_rtp_mode(true)
            .clear_codecs()
            .enable_opus(true, false)
            .enable_vp8(true)
            .set_ice_lite(true)
            .set_fingerprint_verification(true)
            .set_dtls_version(DtlsVersion::Dtls12)
            .set_send_buffer_audio(32)
            .set_send_buffer_video(32)
            .set_reordering_size_audio(8)
            .set_reordering_size_video(8)
            .set_sctp_max_buffered_amount(0)
            .build(now);
        let credentials = rtc.direct_api().local_ice_credentials();
        let socket = config
            .shared_sockets()
            .await?
            .register(credentials, admission.clone())?;
        let advertised = SocketAddr::new(
            config.advertised_ip,
            socket.local_addr().map_err(|_| MediaFailure)?.port(),
        );
        let mut peer = Self {
            rtc,
            socket,
            advertised,
            admission,
            session_peers: HashSet::with_capacity(MAX_CANDIDATES),
            limits: config.limits,
            _admission: admission_permit,
            next_timeout: now,
            started: now,
            last_packet: now,
            rate_started: now,
            packets_in_window: 0,
            ingress: ByteWindow::new(),
            egress: ByteWindow::new(),
            counters: MediaCounters::new(),
            budget_drops: 0,
            candidates: 0,
            offered: false,
            connected: false,
            received_rtp_packets: 0,
            route: PeerRoute::Sink,
            tracks: Vec::with_capacity(2),
            outgoing_sequences: [0; 2],
            last_keyframe: now,
        };
        peer.rtc
            .add_local_candidate(Candidate::host(advertised, "udp").map_err(|_| MediaFailure)?);
        peer.drain().await?;
        Ok(peer)
    }

    pub fn connected(&self) -> bool {
        self.connected
    }

    /// This session's byte counters. The panel reads them for a bounded
    /// ingress/egress bitrate summary; they never carry payload content.
    pub fn counters(&self) -> &MediaCounters {
        &self.counters
    }

    pub fn is_subscriber(&self) -> bool {
        matches!(self.route, PeerRoute::Subscriber(_))
    }

    pub async fn publisher(
        config: &TransportConfig,
        room_id: &str,
        publisher_id: &str,
    ) -> Result<Self, MediaFailure> {
        Self::publisher_for_session(config, room_id, publisher_id, None).await
    }

    pub async fn publisher_for_session(
        config: &TransportConfig,
        room_id: &str,
        publisher_id: &str,
        observed_peer_ip: Option<IpAddr>,
    ) -> Result<Self, MediaFailure> {
        let route = config
            .hub
            .publish(room_id, publisher_id)
            .map_err(|_| MediaFailure)?;
        let mut peer = Self::bind_for_session(config, observed_peer_ip).await?;
        peer.route = PeerRoute::Publisher(route);
        Ok(peer)
    }

    pub async fn subscriber(
        config: &TransportConfig,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
    ) -> Result<Self, MediaFailure> {
        Self::subscriber_for_session(config, room_id, publisher_id, subscriber_id, None).await
    }

    pub async fn subscriber_for_session(
        config: &TransportConfig,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
        observed_peer_ip: Option<IpAddr>,
    ) -> Result<Self, MediaFailure> {
        let route = config
            .hub
            .subscribe(room_id, publisher_id, subscriber_id)
            .map_err(|_| MediaFailure)?;
        let mut peer = Self::bind_for_session(config, observed_peer_ip).await?;
        peer.route = PeerRoute::Subscriber(route);
        Ok(peer)
    }

    pub fn expired(&self) -> bool {
        self.started.elapsed() >= MAX_LIFETIME || self.last_packet.elapsed() >= IDLE_TIMEOUT
    }

    /// A candidate is usable, ignorable or fatal. Only a malformed candidate
    /// line is fatal: an unusable destination is dropped so the backend never
    /// dials an address it may not use.
    fn classify_candidate(&self, text: &str) -> Result<Result<Candidate, Refusal>, MediaFailure> {
        let candidate = Candidate::from_sdp_string(text).map_err(|_| MediaFailure)?;
        if candidate.proto() != Protocol::Udp || !candidate_component_one(text) {
            return Ok(Err(Refusal::UnsupportedTransport));
        }
        match self.admission.candidate_verdict(candidate.addr()) {
            Ok(()) => Ok(Ok(candidate)),
            Err(refusal) => {
                // A fixed reason code only: no address, port or client text.
                tracing::debug!(code = refusal.code(), "media candidate refused");
                Ok(Err(refusal))
            }
        }
    }

    /// Offers must be one-way audio/video (send-only publisher, recv-only viewer).
    /// Data channels, simulcast and renegotiation are deliberately unsupported.
    ///
    /// The returned SDP keeps only the candidates this session may dial. A
    /// candidate that is not admissible is dropped rather than failing the
    /// offer, because a public client's own host candidate is usually a
    /// private address that the backend must never dial.
    fn validate_offer(&self, sdp: &str) -> Result<(String, Vec<Candidate>), MediaFailure> {
        if sdp.len() > 12_288 || sdp.lines().count() > 256 {
            return Err(MediaFailure);
        }
        let mut media_count = 0;
        let mut send_only = false;
        let mut ssrcs = 0;
        let mut audio_count = 0;
        let mut video_count = 0;
        let mut candidates: Vec<Candidate> = Vec::with_capacity(MAX_CANDIDATES);
        let mut signalled = 0usize;
        let mut kept: Vec<&str> = Vec::with_capacity(256);
        let expected_direction = if self.is_subscriber() {
            "a=recvonly"
        } else {
            "a=sendonly"
        };
        for line in sdp.lines() {
            if line.starts_with("m=") {
                if media_count > 0 && !send_only {
                    return Err(MediaFailure);
                }
                if !line.starts_with("m=audio ") && !line.starts_with("m=video ") {
                    return Err(MediaFailure);
                }
                media_count += 1;
                if line.starts_with("m=audio ") {
                    audio_count += 1;
                } else {
                    video_count += 1;
                }
                send_only = false;
            }
            if line == expected_direction {
                send_only = true;
            }
            if (matches!(
                line,
                "a=sendrecv" | "a=recvonly" | "a=sendonly" | "a=inactive"
            ) && line != expected_direction)
                || line.starts_with("a=simulcast:")
                || line.starts_with("a=rid:")
            {
                return Err(MediaFailure);
            }
            if let Some(text) = line.strip_prefix("a=candidate:") {
                signalled += 1;
                if signalled > MAX_CANDIDATES {
                    return Err(MediaFailure);
                }
                // A candidate this session may not use is dropped: the backend
                // never dials an address it may not use.
                if let Ok(candidate) = self.classify_candidate(&format!("candidate:{text}"))? {
                    candidates.push(candidate);
                    kept.push(line);
                }
                continue;
            }
            if line.starts_with("a=ssrc:") {
                ssrcs += 1;
            }
            kept.push(line);
        }
        if !(1..=2).contains(&media_count)
            || !send_only
            || ssrcs > 16
            || audio_count > 1
            || video_count > 1
        {
            return Err(MediaFailure);
        }
        if candidates.is_empty() && self.admission.mode() == TransportMode::Local {
            // A local test session has no server-observed fallback, so the
            // client must offer at least one usable candidate.
            return Err(MediaFailure);
        }
        let mut filtered = String::with_capacity(sdp.len());
        for line in kept {
            filtered.push_str(line);
            filtered.push_str("\r\n");
        }
        Ok((filtered, candidates))
    }

    pub async fn offer(&mut self, sdp: &str) -> Result<String, MediaFailure> {
        if self.offered {
            return Err(MediaFailure);
        }
        let (filtered, candidates) = self.validate_offer(sdp)?;
        let offer = SdpOffer::from_sdp_string(&filtered).map_err(|_| MediaFailure)?;
        // Candidate validation is all-or-nothing: only after the complete SDP
        // has passed checks do its exact endpoints become usable by str0m.
        if self.admission.mode() == TransportMode::Local {
            self.session_peers
                .extend(candidates.iter().map(Candidate::addr));
        }
        let answer = self
            .rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|_| MediaFailure)?;
        self.offered = true;
        self.candidates = candidates.len();
        self.socket.admit_offer(&self.session_peers)?;
        let answer = answer.to_sdp_string();
        self.drain().await?;
        if answer.len() > 12_288 {
            return Err(MediaFailure);
        }
        Ok(answer)
    }

    pub async fn ice(&mut self, text: &str) -> Result<(), MediaFailure> {
        if !self.offered || self.candidates >= MAX_CANDIDATES {
            return Err(MediaFailure);
        }
        // An unusable destination is dropped, never dialled.
        if let Ok(candidate) = self.classify_candidate(text)? {
            if self.admission.mode() == TransportMode::Local {
                self.session_peers.insert(candidate.addr());
                self.socket.admit_offer(&self.session_peers)?;
            }
            self.rtc.add_remote_candidate(candidate);
            self.candidates += 1;
        }
        self.drain().await
    }

    pub async fn timeout(&mut self) -> Result<(), MediaFailure> {
        if self.expired() {
            return Err(MediaFailure);
        }
        if Instant::now() >= self.next_timeout {
            self.rtc
                .handle_input(Input::Timeout(Instant::now()))
                .map_err(|_| MediaFailure)?;
            self.drain().await?;
        }
        // At most one bounded queue batch per owner tick; no media JSON or IPC.
        let batch_started = Instant::now();
        for _ in 0..PACKET_QUEUE_CAPACITY {
            if batch_started.elapsed() >= Duration::from_millis(50) {
                break;
            }
            let packet = match &mut self.route {
                PeerRoute::Subscriber(route) => route.try_packet().map_err(|_| MediaFailure)?,
                _ => None,
            };
            let Some(packet) = packet else {
                break;
            };
            if self.connected {
                self.forward_packet(packet).await?;
            }
        }
        let request_keyframe = match &mut self.route {
            PeerRoute::Publisher(route) => {
                route.has_ready_viewer()
                    && (route.take_keyframe_request()
                        || self.last_keyframe.elapsed() >= Duration::from_secs(1))
            }
            _ => false,
        };
        if request_keyframe && self.last_keyframe.elapsed() >= Duration::from_millis(500) {
            let video_mid = self
                .tracks
                .iter()
                .find(|(_, kind)| *kind == MediaKind::Video)
                .map(|(mid, _)| *mid);
            if let Some(mid) = video_mid {
                if let Some(stream) = self.rtc.direct_api().stream_rx_by_mid(mid, None) {
                    stream.request_keyframe(KeyframeRequestKind::Pli);
                }
                self.drain().await?;
            }
            self.last_keyframe = Instant::now();
        }
        Ok(())
    }

    async fn forward_packet(&mut self, packet: ForwardPacket) -> Result<(), MediaFailure> {
        let (kind, index) = match packet.codec {
            Codec::Opus => (MediaKind::Audio, 0),
            Codec::Vp8 => (MediaKind::Video, 1),
            _ => return Err(MediaFailure),
        };
        let Some(mid) = self
            .tracks
            .iter()
            .find(|(_, track_kind)| *track_kind == kind)
            .map(|(mid, _)| *mid)
        else {
            return Ok(()); // A viewer may explicitly omit audio or video.
        };
        // Egress budget: one session cannot use more than its share of the
        // server's outbound capacity.
        if !self.egress.charge(
            packet.payload.len(),
            self.limits.max_egress_bytes_per_second,
        ) {
            self.budget_drops += 1;
            if self.budget_drops > MAX_BUDGET_DROPS {
                return Err(MediaFailure);
            }
            return Ok(());
        }
        self.counters.add_egress(packet.payload.len() as u64);
        let pt = self
            .rtc
            .codec_config()
            .params()
            .iter()
            .find(|params| params.spec().codec == packet.codec)
            .ok_or(MediaFailure)?
            .pt();
        let sequence = self.outgoing_sequences[index];
        self.outgoing_sequences[index] = sequence.checked_add(1).ok_or(MediaFailure)?;
        let mut direct = self.rtc.direct_api();
        let stream = direct.stream_tx_by_mid(mid, None).ok_or(MediaFailure)?;
        // New SSRC/MID and PT come from the viewer negotiation. Preserve encoded
        // bytes, timestamp and marker, not publisher-specific header extensions.
        stream.write_rtp(
            RtpWrite::new(
                pt,
                sequence.into(),
                packet.timestamp,
                Instant::now(),
                packet.payload,
            )
            .marker(packet.marker)
            .nackable(false),
        );
        self.drain().await
    }

    pub async fn recv(&self, buffer: &mut [u8]) -> std::io::Result<(usize, SocketAddr)> {
        self.socket.recv_from(buffer).await
    }

    pub async fn receive(&mut self, bytes: &[u8], source: SocketAddr) -> Result<(), MediaFailure> {
        let now = Instant::now();
        if !self.offered || bytes.len() > MAX_DATAGRAM_BYTES {
            return Ok(());
        }
        // Only the session's own peer may use this media path. An observed
        // source is what makes a peer-reflexive candidate usable, so this
        // check also bounds every address the backend will ever dial.
        if self
            .admission
            .source_verdict(source, &self.session_peers)
            .is_err()
        {
            return Ok(());
        }
        // Charge only datagrams admitted to this media session. Otherwise an
        // unrelated spoofed source can consume the observed peer's packet
        // budget and make the owner close a healthy session.
        if now.duration_since(self.rate_started) >= Duration::from_secs(1) {
            self.rate_started = now;
            self.packets_in_window = 0;
        }
        self.packets_in_window += 1;
        if self.packets_in_window > self.limits.max_packets_per_second {
            return Err(MediaFailure);
        }
        if !self
            .ingress
            .charge(bytes.len(), self.limits.max_ingress_bytes_per_second)
        {
            self.budget_drops += 1;
            if self.budget_drops > MAX_BUDGET_DROPS {
                return Err(MediaFailure);
            }
            return Ok(());
        }
        self.counters.add_ingress(bytes.len() as u64);
        let Ok(contents) = bytes.try_into() else {
            return Ok(());
        };
        let input = Input::Receive(
            now,
            Receive {
                proto: Protocol::Udp,
                source,
                destination: self.advertised,
                contents,
            },
        );
        if !self.rtc.accepts(&input) {
            return Ok(());
        }
        self.rtc.handle_input(input).map_err(|_| MediaFailure)?;
        self.last_packet = now;
        self.drain().await
    }

    async fn drain(&mut self) -> Result<(), MediaFailure> {
        // Drain into a bounded temporary batch before awaiting any socket I/O.
        let mut datagrams = Vec::with_capacity(MAX_PENDING_DATAGRAMS);
        let mut drained = false;
        for _ in 0..MAX_OUTPUTS_PER_MUTATION {
            match self.rtc.poll_output().map_err(|_| MediaFailure)? {
                Output::Timeout(deadline) => {
                    self.next_timeout = deadline;
                    drained = true;
                    break;
                }
                Output::Transmit(transmit) => {
                    if self
                        .admission
                        .source_verdict(transmit.destination, &self.session_peers)
                        .is_err()
                        || transmit.contents.len() > MAX_DATAGRAM_BYTES
                        || datagrams.len() >= MAX_PENDING_DATAGRAMS
                    {
                        return Err(MediaFailure);
                    }
                    datagrams.push((transmit.destination, transmit.contents.to_vec()));
                }
                Output::Event(Event::Connected) => {
                    tracing::info!(
                        subscriber = self.is_subscriber(),
                        "media transport connected"
                    );
                    self.connected = true;
                    if let PeerRoute::Subscriber(route) = &self.route {
                        route.set_ready().map_err(|_| MediaFailure)?;
                    }
                }
                Output::Event(Event::MediaAdded(media)) => {
                    if self.tracks.len() >= 2
                        || self.tracks.iter().any(|(_, kind)| *kind == media.kind)
                    {
                        return Err(MediaFailure);
                    }
                    self.tracks.push((media.mid, media.kind));
                }
                Output::Event(Event::KeyframeRequest(_)) => {
                    if let PeerRoute::Subscriber(route) = &self.route {
                        route.request_keyframe();
                    }
                }
                Output::Event(Event::RtpPacket(packet)) => {
                    self.received_rtp_packets = self.received_rtp_packets.saturating_add(1);
                    match &self.route {
                        PeerRoute::Subscriber(_) => return Err(MediaFailure),
                        PeerRoute::Publisher(route) => {
                            let codec = self
                                .rtc
                                .codec_config()
                                .params()
                                .iter()
                                .find(|params| params.pt() == packet.header.payload_type)
                                .ok_or(MediaFailure)?
                                .spec()
                                .codec;
                            route
                                .forward(ForwardPacket {
                                    codec,
                                    timestamp: packet.header.timestamp,
                                    marker: packet.header.marker,
                                    payload: packet.payload,
                                })
                                .map_err(|_| MediaFailure)?;
                        }
                        PeerRoute::Sink => {}
                    }
                }
                Output::Event(Event::IceConnectionStateChange(
                    IceConnectionState::Disconnected,
                )) => {
                    tracing::warn!(code = "ice_disconnected", "media transport failed");
                    return Err(MediaFailure);
                }
                // No decoding, recording, media logging, control-plane JSON or IPC.
                Output::Event(_) => {}
            }
        }
        if !drained {
            return Err(MediaFailure);
        }
        // One deadline for the entire batch, not 32 independently renewable waits.
        tokio::time::timeout(Duration::from_millis(50), async {
            for (destination, bytes) in datagrams {
                self.socket
                    .send_to(&bytes, destination)
                    .await
                    .map_err(|_| MediaFailure)?;
            }
            Ok::<(), MediaFailure>(())
        })
        .await
        .map_err(|_| MediaFailure)?
    }
}

fn candidate_component_one(text: &str) -> bool {
    let mut fields = text.split_ascii_whitespace();
    fields
        .next()
        .is_some_and(|foundation| foundation.starts_with("candidate:"))
        && fields.next() == Some("1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::UdpSocket;

    struct TestClient {
        rtc: Rtc,
        socket: UdpSocket,
        connected: bool,
        received: Vec<(Codec, Vec<u8>, u32, bool)>,
        audio_mid: Mid,
        video_mid: Mid,
    }

    impl TestClient {
        async fn negotiate(socket: UdpSocket, peer: &mut MediaPeer, viewer: bool) -> Self {
            use str0m::{
                change::SdpAnswer,
                format::FormatParams,
                media::{Direction, Frequency},
            };
            let mut builder = Rtc::builder()
                .set_crypto_provider(Arc::new(str0m_aws_lc_rs::default_provider()))
                .set_rtp_mode(true)
                .clear_codecs();
            // Different publisher/viewer payload types exercise translation.
            builder.codec_config().add_config(
                if viewer { 112 } else { 111 }.into(),
                None,
                Codec::Opus,
                Frequency::FORTY_EIGHT_KHZ,
                Some(2),
                FormatParams::default(),
            );
            builder.codec_config().add_config(
                if viewer { 98 } else { 96 }.into(),
                None,
                Codec::Vp8,
                Frequency::NINETY_KHZ,
                None,
                FormatParams::default(),
            );
            let mut rtc = builder.build(Instant::now());
            rtc.add_local_candidate(Candidate::host(socket.local_addr().unwrap(), "udp").unwrap());
            while !matches!(rtc.poll_output().unwrap(), Output::Timeout(_)) {}
            let direction = if viewer {
                Direction::RecvOnly
            } else {
                Direction::SendOnly
            };
            let mut change = rtc.sdp_api();
            let audio_mid = change.add_media(MediaKind::Audio, direction, None, None, None);
            let video_mid = change.add_media(MediaKind::Video, direction, None, None, None);
            let (offer, pending) = change.apply().unwrap();
            while !matches!(rtc.poll_output().unwrap(), Output::Timeout(_)) {}
            let answer = peer.offer(&offer.to_sdp_string()).await.unwrap();
            rtc.sdp_api()
                .accept_answer(pending, SdpAnswer::from_sdp_string(&answer).unwrap())
                .unwrap();
            let mut client = Self {
                rtc,
                socket,
                connected: false,
                received: Vec::new(),
                audio_mid,
                video_mid,
            };
            client.drain().await;
            client
        }

        async fn drain(&mut self) -> Instant {
            let mut datagrams = Vec::new();
            let deadline = loop {
                match self.rtc.poll_output().unwrap() {
                    Output::Timeout(deadline) => break deadline,
                    Output::Transmit(transmit) => {
                        assert!(datagrams.len() < MAX_PENDING_DATAGRAMS);
                        datagrams.push((transmit.destination, transmit.contents.to_vec()));
                    }
                    Output::Event(Event::Connected) => self.connected = true,
                    Output::Event(Event::RtpPacket(packet)) => {
                        let codec = self
                            .rtc
                            .codec_config()
                            .params()
                            .iter()
                            .find(|params| params.pt() == packet.header.payload_type)
                            .unwrap()
                            .spec()
                            .codec;
                        assert_eq!(
                            *packet.header.payload_type,
                            if codec == Codec::Opus { 112 } else { 98 }
                        );
                        self.received.push((
                            codec,
                            packet.payload.to_vec(),
                            packet.header.timestamp,
                            packet.header.marker,
                        ));
                    }
                    Output::Event(_) => {}
                }
            };
            for (destination, bytes) in datagrams {
                self.socket.send_to(&bytes, destination).await.unwrap();
            }
            deadline
        }

        async fn step(&mut self) {
            let deadline = self.drain().await;
            let mut buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
            match tokio::time::timeout(Duration::from_millis(2), self.socket.recv_from(&mut buffer))
                .await
            {
                Ok(Ok((length, source))) => {
                    self.rtc
                        .handle_input(Input::Receive(
                            Instant::now(),
                            Receive {
                                proto: Protocol::Udp,
                                source,
                                destination: self.socket.local_addr().unwrap(),
                                contents: buffer[..length].try_into().unwrap(),
                            },
                        ))
                        .unwrap();
                }
                Ok(Err(_)) => panic!("test client UDP receive"),
                Err(_) if Instant::now() >= deadline => {
                    self.rtc
                        .handle_input(Input::Timeout(Instant::now()))
                        .unwrap();
                }
                Err(_) => {}
            }
            self.drain().await;
        }

        async fn write(&mut self, codec: Codec, bytes: &[u8], timestamp: u32) {
            let mid = if codec == Codec::Opus {
                self.audio_mid
            } else {
                self.video_mid
            };
            let pt = self
                .rtc
                .codec_config()
                .params()
                .iter()
                .find(|params| params.spec().codec == codec)
                .unwrap()
                .pt();
            self.rtc
                .direct_api()
                .stream_tx_by_mid(mid, None)
                .unwrap()
                .write_rtp(
                    RtpWrite::new(pt, 0.into(), timestamp, Instant::now(), bytes.to_vec())
                        .marker(true),
                );
            self.drain().await;
        }
    }

    async fn run_test_peer(mut peer: MediaPeer, mut stop: tokio::sync::watch::Receiver<bool>) {
        let mut tick = tokio::time::interval(Duration::from_millis(2));
        let mut buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
        loop {
            tokio::select! {
                biased;
                _ = stop.changed() => break,
                _ = tick.tick() => if peer.timeout().await.is_err() { break; },
                received = peer.recv(&mut buffer) => {
                    let (length, source) = received.unwrap();
                    if peer.receive(&buffer[..length], source).await.is_err() { break; }
                }
            }
        }
    }

    fn free_test_port_pair() -> u16 {
        for _ in 0..128 {
            let first = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
            let port = first.local_addr().unwrap().port();
            if port == 65535 {
                continue;
            }
            if std::net::UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, port + 1)).is_ok() {
                return port;
            }
        }
        panic!("could not reserve a test UDP port range");
    }

    #[tokio::test]
    async fn one_dtls_publisher_fans_out_opus_and_vp8_to_three_viewers() {
        let mut config = config_with_auto(true, None, None, true).unwrap().unwrap();
        config.first_port = free_test_port_pair();
        let localhost = Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
        let mut publisher_peer =
            MediaPeer::publisher_for_session(&config, "room", "publisher", localhost)
                .await
                .unwrap();
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut publisher = TestClient::negotiate(socket, &mut publisher_peer, false).await;
        let (stop, receiver) = tokio::sync::watch::channel(false);
        let mut owners = vec![tokio::spawn(run_test_peer(
            publisher_peer,
            receiver.clone(),
        ))];
        let mut viewers = Vec::new();
        for index in 0..3 {
            let mut peer = MediaPeer::subscriber_for_session(
                &config,
                "room",
                "publisher",
                &format!("viewer_{index}"),
                localhost,
            )
            .await
            .unwrap();
            let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            viewers.push(TestClient::negotiate(socket, &mut peer, true).await);
            owners.push(tokio::spawn(run_test_peer(peer, receiver.clone())));
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        while !publisher.connected || viewers.iter().any(|viewer| !viewer.connected) {
            assert!(
                Instant::now() < deadline,
                "multi-viewer DTLS setup deadline"
            );
            publisher.step().await;
            for viewer in &mut viewers {
                viewer.step().await;
            }
        }
        for _ in 0..20 {
            publisher.step().await;
            for viewer in &mut viewers {
                viewer.step().await;
            }
        }
        publisher.write(Codec::Opus, &[0x78, 0], 960).await;
        publisher.write(Codec::Vp8, &[0x10, 0, 0, 0], 3000).await;
        while viewers.iter().any(|viewer| viewer.received.len() < 2) {
            assert!(
                Instant::now() < deadline,
                "multi-viewer forwarding deadline"
            );
            publisher.step().await;
            for viewer in &mut viewers {
                viewer.step().await;
            }
        }
        for viewer in viewers {
            assert!(
                viewer
                    .received
                    .contains(&(Codec::Opus, vec![0x78, 0], 960, true))
            );
            assert!(
                viewer
                    .received
                    .contains(&(Codec::Vp8, vec![0x10, 0, 0, 0], 3000, true))
            );
        }
        stop.send_replace(true);
        for owner in owners {
            owner.await.unwrap();
        }
        assert_eq!(config.admission.available_permits(), 4);
    }

    #[tokio::test]
    async fn two_dtls_peers_forward_opus_and_vp8_payloads_without_transcoding() {
        let publisher_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let viewer_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut config = config_with_auto(true, None, None, true).unwrap().unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65532);
        drop(probe);
        let mut publisher_peer = MediaPeer::publisher_for_session(
            &config,
            "room",
            "publisher",
            Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
        )
        .await
        .unwrap();
        let mut viewer_peer = MediaPeer::subscriber_for_session(
            &config,
            "room",
            "publisher",
            "viewer",
            Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
        )
        .await
        .unwrap();
        let mut publisher =
            TestClient::negotiate(publisher_socket, &mut publisher_peer, false).await;
        let mut viewer = TestClient::negotiate(viewer_socket, &mut viewer_peer, true).await;
        assert!(
            publisher_peer
                .session_peers
                .contains(&publisher.socket.local_addr().unwrap())
        );
        assert!(
            viewer_peer
                .session_peers
                .contains(&viewer.socket.local_addr().unwrap())
        );
        let trickle_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let trickle_address = trickle_socket.local_addr().unwrap();
        publisher_peer
            .ice(&format!(
                "candidate:2 1 udp 2130706431 {} {} typ host",
                trickle_address.ip(),
                trickle_address.port()
            ))
            .await
            .unwrap();
        assert!(publisher_peer.session_peers.contains(&trickle_address));
        let (stop, receiver) = tokio::sync::watch::channel(false);
        let publisher_owner = tokio::spawn(run_test_peer(publisher_peer, receiver.clone()));
        let viewer_owner = tokio::spawn(run_test_peer(viewer_peer, receiver));
        let deadline = Instant::now() + Duration::from_secs(10);
        while !publisher.connected || !viewer.connected {
            assert!(Instant::now() < deadline, "two-client DTLS setup deadline");
            publisher.step().await;
            viewer.step().await;
        }
        // Wait for both server-side Connected events/readiness, not just clients.
        for _ in 0..20 {
            publisher.step().await;
            viewer.step().await;
        }
        // Opaque payloads test transport fidelity, not valid codec playback.
        publisher.write(Codec::Opus, &[0x78, 0], 960).await;
        publisher.write(Codec::Vp8, &[0x10, 0, 0, 0], 3000).await;
        while viewer.received.len() < 2 {
            assert!(Instant::now() < deadline, "two-client forwarding deadline");
            publisher.step().await;
            viewer.step().await;
        }
        assert!(
            viewer
                .received
                .contains(&(Codec::Opus, vec![0x78, 0], 960, true))
        );
        assert!(
            viewer
                .received
                .contains(&(Codec::Vp8, vec![0x10, 0, 0, 0], 3000, true))
        );
        stop.send_replace(true);
        publisher_owner.await.unwrap();
        viewer_owner.await.unwrap();
        assert_eq!(
            config.admission.available_permits(),
            config.limits.max_sessions
        );
        assert!(
            config
                .hub
                .subscribe("room", "publisher", "late_viewer")
                .is_err()
        );
    }

    fn config(tls: bool, peers: &str) -> Result<Option<TransportConfig>, &'static str> {
        config_with(tls, Some(peers), None)
    }

    fn config_with(
        tls: bool,
        peers: Option<&str>,
        trusted_client_ips: Option<&str>,
    ) -> Result<Option<TransportConfig>, &'static str> {
        config_with_auto(tls, peers, trusted_client_ips, false)
    }

    fn config_with_auto(
        tls: bool,
        peers: Option<&str>,
        trusted_client_ips: Option<&str>,
        auto_lan_peers: bool,
    ) -> Result<Option<TransportConfig>, &'static str> {
        TransportConfig::from_lookup(tls, TransportMode::Local, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some("45000".into()),
            "DASS_RTC_ALLOWED_PEERS" => peers.map(Into::into),
            "DASS_RTC_TRUSTED_CLIENT_IPS" => trusted_client_ips.map(Into::into),
            "DASS_RTC_AUTO_LAN_PEERS" => Some(auto_lan_peers.to_string()),
            _ => None,
        })
        .map(use_ephemeral_port)
    }

    fn use_ephemeral_port(mut config: Option<TransportConfig>) -> Option<TransportConfig> {
        if let Some(config) = config.as_mut() {
            // Parallel tests must not compete for the production port range.
            config.first_port = free_test_port_pair();
        }
        config
    }

    fn public_config() -> Result<Option<TransportConfig>, &'static str> {
        TransportConfig::from_lookup(true, TransportMode::Public, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" => Some("0.0.0.0".into()),
            "DASS_RTC_ADVERTISED_IP" => Some("203.0.114.10".into()),
            "DASS_RTC_FIRST_PORT" => Some("45000".into()),
            _ => None,
        })
        .map(use_ephemeral_port)
    }

    #[test]
    fn configuration_requires_tls_opt_in_and_safe_exact_peers() {
        assert!(
            TransportConfig::from_lookup(false, TransportMode::Local, |_| None)
                .unwrap()
                .is_none()
        );
        assert!(config(false, "127.0.0.1:50000").is_err());
        assert!(config(true, "127.0.0.1:50000,192.168.1.2:50001").is_ok());
        assert!(config(true, "[::1]:50000").is_ok());
        for peers in [
            "",
            "0.0.0.0:50000",
            "169.254.169.254:50000",
            "100.100.100.200:50000",
            "224.0.0.1:50000",
            "240.0.0.1:50000",
            "192.168.1.255:50000",
            "127.0.0.1:53",
            "[::]:50000",
            "host.invalid:50000",
            "127.0.0.1:50000,127.0.0.1:50000",
        ] {
            assert!(config(true, peers).is_err(), "accepted peers {peers}");
        }
    }

    #[test]
    fn trusted_client_ip_configuration_is_explicit_safe_and_bounded() {
        let trusted_only = config_with(true, None, Some("192.168.1.2,10.0.0.3"))
            .unwrap()
            .unwrap();
        assert!(trusted_only.allowed_peers.is_empty());
        assert_eq!(trusted_only.trusted_client_ips.len(), 2);

        let both_modes = config_with(true, Some("127.0.0.1:50000"), Some("192.168.1.2"))
            .unwrap()
            .unwrap();
        assert!(
            both_modes
                .allowed_peers
                .contains(&"127.0.0.1:50000".parse().unwrap())
        );
        assert!(
            both_modes
                .trusted_client_ips
                .contains(&"192.168.1.2".parse().unwrap())
        );

        assert!(config_with(true, None, None).is_err());
        for clients in [
            "0.0.0.0",
            "169.254.1.2",
            "192.168.1.255",
            "192.0.2.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "192.168.1.2/32",
            "[::1]",
            "client.invalid",
            "192.168.1.2,192.168.1.2",
            "192.168.1.2,",
        ] {
            assert!(
                config_with(true, Some("127.0.0.1:50000"), Some(clients)).is_err(),
                "accepted trusted client list {clients:?}"
            );
        }

        let too_many = (1..=MAX_TRUSTED_CLIENT_IPS + 1)
            .map(|last| format!("10.0.0.{last}"))
            .collect::<Vec<_>>()
            .join(",");
        assert!(config_with(true, None, Some(&too_many)).is_err());
        let at_limit = (1..=MAX_TRUSTED_CLIENT_IPS)
            .map(|last| format!("10.0.0.{last}"))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(
            config_with(true, None, Some(&at_limit))
                .unwrap()
                .unwrap()
                .trusted_client_ips
                .len(),
            MAX_TRUSTED_CLIENT_IPS
        );
        assert!(
            config_with(
                true,
                Some("127.0.0.1:50000"),
                Some(&"1".repeat(MAX_TRUSTED_CLIENT_IPS_CONFIG_BYTES + 1))
            )
            .is_err()
        );
    }

    #[test]
    fn automatic_lan_admission_is_explicit_and_does_not_require_static_lists() {
        let automatic = config_with_auto(true, None, None, true).unwrap().unwrap();
        assert!(automatic.auto_lan_peers);
        assert!(automatic.allowed_peers.is_empty());
        assert!(automatic.trusted_client_ips.is_empty());

        assert!(config_with_auto(true, None, None, false).is_err());
        assert!(
            TransportConfig::from_lookup(true, TransportMode::Local, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                "DASS_RTC_AUTO_LAN_PEERS" => Some("yes".into()),
                _ => None,
            })
            .is_err()
        );
    }

    #[test]
    fn public_mode_requires_a_global_address_and_rejects_lan_allowlists() {
        let public = public_config().unwrap().unwrap();
        assert_eq!(public.mode, TransportMode::Public);
        assert!(public.allowed_peers.is_empty());
        assert!(!public.auto_lan_peers);

        // A public deployment never advertises a private or unroutable address.
        assert!(
            TransportConfig::from_lookup(true, TransportMode::Public, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" => Some("0.0.0.0".into()),
                "DASS_RTC_ADVERTISED_IP" => Some("192.168.1.10".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                _ => None,
            })
            .is_err()
        );
        // LAN trust mechanisms are local-mode tools only.
        assert!(
            TransportConfig::from_lookup(true, TransportMode::Public, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" => Some("0.0.0.0".into()),
                "DASS_RTC_ADVERTISED_IP" => Some("203.0.114.10".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                "DASS_RTC_AUTO_LAN_PEERS" => Some("true".into()),
                _ => None,
            })
            .is_err()
        );
        assert!(
            TransportConfig::from_lookup(true, TransportMode::Public, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" => Some("0.0.0.0".into()),
                "DASS_RTC_ADVERTISED_IP" => Some("203.0.114.10".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                "DASS_RTC_TRUSTED_CLIENT_IPS" => Some("203.0.114.11".into()),
                _ => None,
            })
            .is_err()
        );
        // The bind and advertised addresses must use the same family.
        assert!(
            TransportConfig::from_lookup(true, TransportMode::Public, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" => Some("0.0.0.0".into()),
                "DASS_RTC_ADVERTISED_IP" => Some("2606:4700::1111".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                _ => None,
            })
            .is_err()
        );
    }

    #[test]
    fn port_pair_is_independent_of_media_capacity_and_must_not_overflow() {
        for (first_port, accepted) in [("65534", true), ("65535", false)] {
            let result =
                TransportConfig::from_lookup(true, TransportMode::Local, |name| match name {
                    "DASS_RTC_SPIKE" => Some("true".into()),
                    "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
                    "DASS_RTC_FIRST_PORT" => Some(first_port.into()),
                    "DASS_RTC_AUTO_LAN_PEERS" => Some("true".into()),
                    "DASS_MAX_MEDIA_SESSIONS" => Some("64".into()),
                    _ => None,
                });
            assert_eq!(result.is_ok(), accepted);
        }
    }

    #[tokio::test]
    async fn many_media_owners_share_exactly_two_ports_with_independent_admission() {
        let mut config = config_with_auto(true, None, None, true).unwrap().unwrap();
        config.first_port = free_test_port_pair();
        let mut peers = Vec::new();
        let mut ports = HashSet::new();
        for _ in 0..4 {
            let peer = MediaPeer::bind_for_session(
                &config,
                Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            )
            .await
            .unwrap();
            ports.insert(peer.advertised.port());
            peers.push(peer);
        }
        assert_eq!(
            ports,
            HashSet::from([config.first_port, config.first_port + 1])
        );
        assert!(
            MediaPeer::bind_for_session(&config, Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),)
                .await
                .is_err()
        );
        let released = peers.pop().unwrap().advertised.port();
        let replacement =
            MediaPeer::bind_for_session(&config, Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)))
                .await
                .unwrap();
        assert_eq!(replacement.advertised.port(), released);
        assert_eq!(config.admission.available_permits(), 0);
        drop(peers);
        assert_eq!(config.admission.available_permits(), 3);
        drop(replacement);
        assert_eq!(config.admission.available_permits(), 4);
    }

    #[test]
    fn media_limits_are_bounded_and_configurable() {
        let limits = TransportConfig::from_lookup(true, TransportMode::Local, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some("45000".into()),
            "DASS_RTC_ALLOWED_PEERS" => Some("127.0.0.1:50000".into()),
            "DASS_MAX_MEDIA_SESSIONS" => Some("8".into()),
            "DASS_MAX_PACKETS_PER_SECOND" => Some("500".into()),
            "DASS_MAX_INGRESS_BYTES_PER_SECOND" => Some("100000".into()),
            "DASS_MAX_EGRESS_BYTES_PER_SECOND" => Some("200000".into()),
            _ => None,
        })
        .unwrap()
        .unwrap();
        assert_eq!(limits.limits.max_sessions, 8);
        assert_eq!(limits.limits.max_packets_per_second, 500);
        assert_eq!(limits.limits.max_ingress_bytes_per_second, 100_000);
        assert_eq!(limits.limits.max_egress_bytes_per_second, 200_000);

        for (name, value) in [
            ("DASS_MAX_MEDIA_SESSIONS", "0"),
            ("DASS_MAX_MEDIA_SESSIONS", "65"),
            ("DASS_MAX_PACKETS_PER_SECOND", "0"),
            ("DASS_MAX_INGRESS_BYTES_PER_SECOND", "20000001"),
            ("DASS_MAX_EGRESS_BYTES_PER_SECOND", "secret"),
        ] {
            assert!(
                TransportConfig::from_lookup(true, TransportMode::Local, |key| match key {
                    "DASS_RTC_SPIKE" => Some("true".into()),
                    "DASS_RTC_BIND_IP" => Some("127.0.0.1".into()),
                    "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
                    "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                    "DASS_RTC_ALLOWED_PEERS" => Some("127.0.0.1:50000".into()),
                    other if other == name => Some(value.into()),
                    _ => None,
                })
                .is_err(),
                "accepted {name}={value}"
            );
        }
    }

    #[tokio::test]
    async fn owner_rejects_unsafe_candidates_and_unbounded_or_nonpublisher_sdp() {
        let mut config = config(true, "127.0.0.1:50000").unwrap().unwrap();
        // Allocate a temporary port range rather than assume 45000 is unused.
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65532);
        drop(probe);
        let peer = MediaPeer::bind(&config).await.unwrap();
        assert!(
            peer.classify_candidate("candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host")
                .unwrap()
                .is_ok()
        );
        for text in [
            "candidate:1 1 udp 2130706431 169.254.169.254 50000 typ host",
            "candidate:1 1 udp 2130706431 127.0.0.1 50001 typ host",
            "candidate:1 1 tcp 2130706431 127.0.0.1 50000 typ host tcptype passive",
        ] {
            assert!(peer.classify_candidate(text).unwrap().is_err());
        }
        // A local session needs at least one usable candidate: the backend has
        // no server-observed fallback in the test environment.
        assert!(
            peer.validate_offer("m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n")
                .is_err()
        );
        assert!(
            peer.validate_offer(
                "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host\r\n"
            )
            .is_ok()
        );
        for sdp in [
            "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sendonly\r\n",
            "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendrecv\r\n",
            "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=rid:1 send\r\n",
        ] {
            assert!(peer.validate_offer(sdp).is_err());
        }
        assert!(peer.validate_offer(&"x".repeat(12_289)).is_err());
        assert_eq!(
            config.admission.available_permits(),
            config.limits.max_sessions - 1
        );
        drop(peer);
        assert_eq!(
            config.admission.available_permits(),
            config.limits.max_sessions
        );
    }

    #[tokio::test]
    async fn trusted_client_ip_accepts_dynamic_nonprivileged_ports_only_for_configured_hosts() {
        let mut config = config_with(true, None, Some("127.0.0.1")).unwrap().unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65532);
        drop(probe);
        let peer = MediaPeer::bind(&config).await.unwrap();

        for port in [1024, 49152, 65535] {
            assert!(
                peer.classify_candidate(&format!(
                    "candidate:1 1 udp 2130706431 127.0.0.1 {port} typ host"
                ))
                .unwrap()
                .is_ok(),
                "trusted address should accept non-privileged port {port}"
            );
        }
        for candidate in [
            "candidate:1 1 udp 2130706431 127.0.0.1 1023 typ host",
            "candidate:1 1 udp 2130706431 127.0.0.2 50000 typ host",
            "candidate:1 1 udp 2130706431 169.254.1.2 50000 typ host",
            "candidate:1 1 udp 2130706431 224.0.0.1 50000 typ host",
        ] {
            assert!(
                peer.classify_candidate(candidate).unwrap().is_err(),
                "accepted {candidate}"
            );
        }
    }

    #[tokio::test]
    async fn automatic_admission_is_bound_to_observed_lan_ip_and_validated_offer_candidates() {
        let observed_ip: IpAddr = "192.168.1.8".parse().unwrap();
        let config = config_with_auto(true, Some("127.0.0.1:50000"), Some("192.168.1.9"), true)
            .unwrap()
            .unwrap();
        let peer = MediaPeer::bind_for_session(&config, Some(observed_ip))
            .await
            .unwrap();

        assert!(
            peer.classify_candidate("candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host")
                .unwrap()
                .is_ok()
        );
        for candidate in [
            // Static exact/trusted configuration cannot override observed-peer mismatch.
            "candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host",
            "candidate:1 1 udp 2130706431 192.168.1.9 50000 typ host",
            "candidate:1 1 udp 2130706431 8.8.8.8 50000 typ host",
            "candidate:1 1 udp 2130706431 192.168.1.8 1023 typ host",
            "candidate:1 2 udp 2130706431 192.168.1.8 50000 typ host",
            "candidate:1 1 tcp 2130706431 192.168.1.8 50000 typ host tcptype passive",
        ] {
            assert!(
                peer.classify_candidate(candidate).unwrap().is_err(),
                "accepted {candidate}"
            );
        }

        let valid = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host\r\n";
        let (filtered, candidates) = peer.validate_offer(valid).unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(filtered.contains("a=candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host"));
        assert!(peer.session_peers.is_empty());

        let mismatched =
            format!("{valid}a=candidate:2 1 udp 2130706431 192.168.1.9 50001 typ host\r\n");
        let (filtered, candidates) = peer.validate_offer(&mismatched).unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(!filtered.contains("192.168.1.9"));
        assert!(peer.session_peers.is_empty());

        let too_many = format!(
            "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n{}",
            "a=candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host\r\n"
                .repeat(MAX_CANDIDATES + 1)
        );
        assert!(peer.validate_offer(&too_many).is_err());
        assert!(peer.session_peers.is_empty());

        assert!(MediaPeer::bind_for_session(&config, None).await.is_err());
        assert!(
            MediaPeer::bind_for_session(&config, Some("8.8.8.8".parse().unwrap()))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn public_mode_drops_unusable_candidates_and_keeps_the_observed_peer() {
        let config = public_config().unwrap().unwrap();
        let observed: IpAddr = "203.0.114.10".parse().unwrap();
        let peer = MediaPeer::bind_for_session(&config, Some(observed))
            .await
            .unwrap();
        let offer = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=candidate:1 1 udp 2130706431 192.168.1.5 50000 typ host\r\na=candidate:2 1 udp 2130706431 203.0.114.10 50001 typ host\r\n";
        let (filtered, candidates) = peer.validate_offer(offer).unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(!filtered.contains("192.168.1.5"));
        assert!(filtered.contains("203.0.114.10 50001"));
        // A peer that is not globally routable never carries media.
        assert!(
            MediaPeer::bind_for_session(&config, Some("192.168.1.5".parse().unwrap()))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn public_mode_drops_datagrams_from_another_address() {
        let config = public_config().unwrap().unwrap();
        let observed: IpAddr = "203.0.114.10".parse().unwrap();
        let mut peer = MediaPeer::bind_for_session(&config, Some(observed))
            .await
            .unwrap();
        // The peer has not offered yet, so every datagram is dropped.
        assert!(
            peer.receive(&[0; 16], "203.0.114.10:50000".parse().unwrap())
                .await
                .is_ok()
        );
        assert!(
            peer.receive(&[0; 16], "198.51.100.4:50000".parse().unwrap())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn spoofed_datagrams_do_not_consume_observed_peer_packet_budget() {
        let mut config = public_config().unwrap().unwrap();
        config.limits.max_packets_per_second = 1;
        let observed: IpAddr = "203.0.114.10".parse().unwrap();
        let mut peer = MediaPeer::bind_for_session(&config, Some(observed))
            .await
            .unwrap();
        peer.offered = true;

        for _ in 0..2 {
            peer.receive(&[0; 16], "198.51.100.4:50000".parse().unwrap())
                .await
                .unwrap();
        }
        assert_eq!(peer.packets_in_window, 0);
        peer.receive(&[0; 16], "203.0.114.10:50000".parse().unwrap())
            .await
            .unwrap();
        assert_eq!(peer.packets_in_window, 1);
        assert!(
            peer.receive(&[0; 16], "203.0.114.10:50000".parse().unwrap())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn udp_dtls_srtp_receives_encoded_payload_and_releases_pair_with_transport() {
        use str0m::{
            change::SdpAnswer,
            media::{Direction, MediaKind},
        };

        let publisher_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let publisher_address = publisher_socket.local_addr().unwrap();
        let mut config = config(true, &publisher_address.to_string())
            .unwrap()
            .unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65532);
        drop(probe);
        let mut peer = MediaPeer::bind(&config).await.unwrap();
        let peer_address = peer.socket.local_addr().unwrap();
        let mut publisher = Rtc::builder()
            .set_crypto_provider(Arc::new(str0m_aws_lc_rs::default_provider()))
            .set_fingerprint_verification(true)
            .build(Instant::now());
        publisher.add_local_candidate(Candidate::host(publisher_address, "udp").unwrap());
        // Drain after local-candidate mutation before touching the SDP API.
        while !matches!(publisher.poll_output().unwrap(), Output::Timeout(_)) {}
        let mut change = publisher.sdp_api();
        let mid = change.add_media(MediaKind::Audio, Direction::SendOnly, None, None, None);
        let (offer, pending) = change.apply().unwrap();
        while !matches!(publisher.poll_output().unwrap(), Output::Timeout(_)) {}
        let answer = peer.offer(&offer.to_sdp_string()).await.unwrap();
        publisher
            .sdp_api()
            .accept_answer(pending, SdpAnswer::from_sdp_string(&answer).unwrap())
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut publisher_connected = false;
        let mut wrote_payload = false;
        let mut peer_buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
        let mut publisher_buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
        loop {
            assert!(Instant::now() < deadline, "DTLS/SRTP transport deadline");
            let mut transmissions = Vec::new();
            let timeout = loop {
                match publisher.poll_output().unwrap() {
                    Output::Timeout(deadline) => break deadline,
                    Output::Transmit(transmit) => {
                        assert_eq!(transmit.destination, peer_address);
                        assert!(transmissions.len() < MAX_PENDING_DATAGRAMS);
                        transmissions.push(transmit.contents.to_vec());
                    }
                    Output::Event(Event::Connected) => publisher_connected = true,
                    Output::Event(_) => {}
                }
            };
            for bytes in transmissions {
                publisher_socket
                    .send_to(&bytes, peer_address)
                    .await
                    .unwrap();
            }
            if publisher_connected && peer.connected() && !wrote_payload {
                let writer = publisher.writer(mid).unwrap();
                let pt = writer.payload_params().next().unwrap().pt();
                // Opaque test bytes, not an audio quality/codec interoperability claim.
                writer
                    .write(
                        pt,
                        Instant::now(),
                        Duration::from_millis(20).into(),
                        vec![0x78, 0],
                    )
                    .unwrap();
                wrote_payload = true;
                continue; // Drain the write before any further mutation.
            }
            if peer.received_rtp_packets > 0 {
                break;
            }
            peer.timeout().await.unwrap();
            tokio::select! {
                received = peer.recv(&mut peer_buffer) => {
                    let (length, source) = received.unwrap();
                    peer.receive(&peer_buffer[..length], source).await.unwrap();
                }
                received = publisher_socket.recv_from(&mut publisher_buffer) => {
                    let (length, source) = received.unwrap();
                    let input = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp,
                        source, destination: publisher_address,
                        contents: publisher_buffer[..length].try_into().unwrap() });
                    publisher.handle_input(input).unwrap();
                }
                _ = tokio::time::sleep(Duration::from_millis(2)) => {
                    if Instant::now() >= timeout {
                        publisher.handle_input(Input::Timeout(Instant::now())).unwrap();
                    }
                }
            }
        }
        assert!(publisher_connected && peer.connected());
        assert!(peer.offer("invalid renegotiation").await.is_err());
        drop(peer);
        assert_eq!(
            config.admission.available_permits(),
            config.limits.max_sessions
        );
        // A session releases its routes, not the backend's listening pair.
        assert!(UdpSocket::bind(peer_address).await.is_err());
        drop(config);
        // Dispatcher cancellation must release both sockets with the owner.
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if let Ok(rebound) = UdpSocket::bind(peer_address).await {
                    drop(rebound);
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
