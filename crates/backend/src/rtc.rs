//! One-publisher/one-viewer interoperability spike, not a production SFU.
//! Each mutation is completely drained before another mutation or socket await.

use crate::forwarding::{
    ForwardPacket, PACKET_QUEUE_CAPACITY, PublisherEndpoint, SpikeHub, SubscriberEndpoint,
};
use std::{
    collections::HashSet,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::Arc,
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
use tokio::{
    net::UdpSocket,
    sync::{OwnedSemaphorePermit, Semaphore},
};

const MAX_PEERS: usize = 2;
const MAX_CANDIDATES: usize = 16;
const MAX_TRUSTED_CLIENT_IPS: usize = 16;
const MAX_TRUSTED_CLIENT_IPS_CONFIG_BYTES: usize =
    MAX_TRUSTED_CLIENT_IPS * 15 + (MAX_TRUSTED_CLIENT_IPS - 1);
const MAX_OUTPUTS_PER_MUTATION: usize = 256;
const MAX_DATAGRAM_BYTES: usize = 2_048;
const MAX_PENDING_DATAGRAMS: usize = 32;
const MAX_PACKETS_PER_SECOND: usize = 2_000;
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LIFETIME: Duration = Duration::from_secs(600);

/// No Debug implementation: configuration contains sensitive network addresses.
#[derive(Clone)]
pub struct SpikeConfig {
    bind_ip: Ipv4Addr,
    advertised_ip: Ipv4Addr,
    first_port: u16,
    // Exact endpoint allowlisting remains the default. Trusted IPs are an
    // explicit alternative for Chromium's per-session UDP ports. Automatic
    // admission is scoped to the authenticated WSS peer and its SDP candidates.
    allowed_peers: HashSet<SocketAddr>,
    trusted_client_ips: HashSet<Ipv4Addr>,
    auto_lan_peers: bool,
    admission: Arc<Semaphore>,
    hub: Arc<SpikeHub>,
}

impl SpikeConfig {
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

    /// Disabled unless explicitly requested. This spike requires TLS signaling.
    pub fn from_env(tls_enabled: bool) -> Result<Option<Self>, &'static str> {
        Self::from_lookup(tls_enabled, |name| std::env::var(name).ok())
    }

    pub(crate) fn from_lookup(
        tls_enabled: bool,
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Self>, &'static str> {
        match lookup("DASS_RTC_SPIKE").as_deref() {
            None | Some("false") => return Ok(None),
            Some("true") if tls_enabled => {}
            _ => return Err("RTC spike requires explicit opt-in and TLS signaling"),
        }
        let bind_ip = lookup("DASS_RTC_BIND_IP")
            .ok_or("RTC spike requires a bind IPv4 address")?
            .parse()
            .map_err(|_| "invalid RTC bind IPv4 address")?;
        let advertised_ip = lookup("DASS_RTC_ADVERTISED_IP")
            .ok_or("RTC spike requires an advertised IPv4 address")?
            .parse()
            .map_err(|_| "invalid RTC advertised IPv4 address")?;
        if !safe_ip(advertised_ip) {
            return Err("unsafe RTC advertised address");
        }
        let first_port: u16 = lookup("DASS_RTC_FIRST_PORT")
            .ok_or("RTC spike requires a first UDP port")?
            .parse()
            .map_err(|_| "invalid RTC UDP port")?;
        if !(1024..=65534).contains(&first_port) {
            return Err("RTC port range must contain two non-privileged ports");
        }
        let auto_lan_peers = match lookup("DASS_RTC_AUTO_LAN_PEERS").as_deref() {
            None | Some("false") => false,
            Some("true") => true,
            _ => return Err("invalid automatic RTC LAN peer admission setting"),
        };
        let mut allowed_peers = HashSet::new();
        if let Some(peers) = lookup("DASS_RTC_ALLOWED_PEERS") {
            if peers.len() > 1024 {
                return Err("RTC peer allowlist too large");
            }
            if !peers.is_empty() {
                for entry in peers.split(',') {
                    let address: SocketAddr =
                        entry.parse().map_err(|_| "invalid RTC peer address")?;
                    let SocketAddr::V4(address_v4) = address else {
                        return Err("RTC spike supports IPv4 only");
                    };
                    if !safe_ip(*address_v4.ip()) || address.port() < 1024 {
                        return Err("unsafe RTC peer destination");
                    }
                    if !allowed_peers.insert(address) || allowed_peers.len() > MAX_CANDIDATES {
                        return Err("duplicate or excessive RTC peers");
                    }
                }
            }
        }
        let mut trusted_client_ips = HashSet::new();
        if let Some(clients) = lookup("DASS_RTC_TRUSTED_CLIENT_IPS") {
            if clients.len() > MAX_TRUSTED_CLIENT_IPS_CONFIG_BYTES {
                return Err("RTC trusted client IPv4 list too large");
            }
            if !clients.is_empty() {
                for entry in clients.split(',') {
                    let ip: Ipv4Addr = entry
                        .parse()
                        .map_err(|_| "invalid trusted RTC client IPv4 address")?;
                    if !safe_ip(ip) {
                        return Err("unsafe trusted RTC client address");
                    }
                    if !trusted_client_ips.insert(ip)
                        || trusted_client_ips.len() > MAX_TRUSTED_CLIENT_IPS
                    {
                        return Err("duplicate or excessive trusted RTC client addresses");
                    }
                }
            }
        }
        if allowed_peers.is_empty() && trusted_client_ips.is_empty() && !auto_lan_peers {
            return Err("RTC spike requires static peers or automatic LAN admission");
        }
        Ok(Some(Self {
            bind_ip,
            advertised_ip,
            first_port,
            allowed_peers,
            trusted_client_ips,
            auto_lan_peers,
            admission: Arc::new(Semaphore::new(MAX_PEERS)),
            hub: Arc::new(SpikeHub::default()),
        }))
    }
}

// Static-mode destinations are explicit allowlisted endpoints or trusted-client
// IPv4 addresses. Auto mode has separate session-local observed-peer checks.
// No link-local, metadata, multicast, broadcast, reserved, or unspecified targets.
fn safe_ip(ip: Ipv4Addr) -> bool {
    let [a, b, c, d] = ip.octets();
    a != 0
        && a < 224
        && !(a == 169 && b == 254)
        && !(a == 100 && (64..=127).contains(&b))
        && !(a == 192 && b == 0 && c == 0)
        && !(a == 198 && (18..=19).contains(&b))
        && ip != Ipv4Addr::new(168, 63, 129, 16)
        && !ip.is_documentation()
        && d != 255
        && !ip.is_broadcast()
}

/// Automatic peer admission is intentionally limited to private IPv4 LANs and
/// loopback. Public, link-local, IPv6 and forwarded/claimed addresses do not
/// qualify.
pub(crate) fn auto_lan_ip(ip: Ipv4Addr) -> bool {
    safe_ip(ip) && (ip.is_private() || ip.is_loopback())
}

fn candidate_component_one(text: &str) -> bool {
    let mut fields = text.split_ascii_whitespace();
    fields
        .next()
        .is_some_and(|foundation| foundation.starts_with("candidate:"))
        && fields.next() == Some("1")
}

/// Fixed failures only: no SDP, remote addresses, or crypto errors in logs.
#[derive(Debug)]
pub struct SpikeFailure;

pub struct SpikePeer {
    rtc: Rtc,
    socket: UdpSocket,
    advertised: SocketAddr,
    allowed_peers: HashSet<SocketAddr>,
    trusted_client_ips: HashSet<Ipv4Addr>,
    auto_lan_peers: bool,
    observed_peer_ip: Option<Ipv4Addr>,
    session_peers: HashSet<SocketAddr>,
    _admission: OwnedSemaphorePermit,
    next_timeout: Instant,
    started: Instant,
    last_packet: Instant,
    rate_started: Instant,
    packets_in_window: usize,
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

impl SpikePeer {
    pub async fn bind(config: &SpikeConfig) -> Result<Self, SpikeFailure> {
        Self::bind_for_session(config, None).await
    }

    pub async fn bind_for_session(
        config: &SpikeConfig,
        observed_peer_ip: Option<Ipv4Addr>,
    ) -> Result<Self, SpikeFailure> {
        if config.auto_lan_peers && !observed_peer_ip.is_some_and(auto_lan_ip) {
            return Err(SpikeFailure);
        }
        let admission = config
            .admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| SpikeFailure)?;
        let mut bound = None;
        for port in config.first_port..=config.first_port + 1 {
            if let Ok(socket) = UdpSocket::bind(SocketAddrV4::new(config.bind_ip, port)).await {
                bound = Some(socket);
                break;
            }
        }
        let socket = bound.ok_or(SpikeFailure)?;
        let advertised = SocketAddr::V4(SocketAddrV4::new(
            config.advertised_ip,
            socket.local_addr().map_err(|_| SpikeFailure)?.port(),
        ));
        let now = Instant::now();
        let rtc = Rtc::builder()
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
        let mut peer = Self {
            rtc,
            socket,
            advertised,
            allowed_peers: config.allowed_peers.clone(),
            trusted_client_ips: config.trusted_client_ips.clone(),
            auto_lan_peers: config.auto_lan_peers,
            observed_peer_ip,
            session_peers: HashSet::with_capacity(MAX_CANDIDATES),
            _admission: admission,
            next_timeout: now,
            started: now,
            last_packet: now,
            rate_started: now,
            packets_in_window: 0,
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
            .add_local_candidate(Candidate::host(advertised, "udp").map_err(|_| SpikeFailure)?);
        peer.drain().await?;
        Ok(peer)
    }

    pub fn connected(&self) -> bool {
        self.connected
    }

    pub fn is_subscriber(&self) -> bool {
        matches!(self.route, PeerRoute::Subscriber(_))
    }

    pub async fn publisher(
        config: &SpikeConfig,
        room_id: &str,
        publisher_id: &str,
    ) -> Result<Self, SpikeFailure> {
        Self::publisher_for_session(config, room_id, publisher_id, None).await
    }

    pub async fn publisher_for_session(
        config: &SpikeConfig,
        room_id: &str,
        publisher_id: &str,
        observed_peer_ip: Option<Ipv4Addr>,
    ) -> Result<Self, SpikeFailure> {
        let route = config
            .hub
            .publish(room_id, publisher_id)
            .map_err(|_| SpikeFailure)?;
        let mut peer = Self::bind_for_session(config, observed_peer_ip).await?;
        peer.route = PeerRoute::Publisher(route);
        Ok(peer)
    }

    pub async fn subscriber(
        config: &SpikeConfig,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
    ) -> Result<Self, SpikeFailure> {
        Self::subscriber_for_session(config, room_id, publisher_id, subscriber_id, None).await
    }

    pub async fn subscriber_for_session(
        config: &SpikeConfig,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
        observed_peer_ip: Option<Ipv4Addr>,
    ) -> Result<Self, SpikeFailure> {
        let route = config
            .hub
            .subscribe(room_id, publisher_id, subscriber_id)
            .map_err(|_| SpikeFailure)?;
        let mut peer = Self::bind_for_session(config, observed_peer_ip).await?;
        peer.route = PeerRoute::Subscriber(route);
        Ok(peer)
    }

    pub fn expired(&self) -> bool {
        self.started.elapsed() >= MAX_LIFETIME || self.last_packet.elapsed() >= IDLE_TIMEOUT
    }

    fn candidate(&self, text: &str) -> Result<Candidate, SpikeFailure> {
        let candidate = Candidate::from_sdp_string(text).map_err(|_| SpikeFailure)?;
        if candidate.proto() != Protocol::Udp
            || (self.auto_lan_peers && !candidate_component_one(text))
            || !self.candidate_endpoint_allowed(candidate.addr())
        {
            return Err(SpikeFailure);
        }
        Ok(candidate)
    }

    fn candidate_endpoint_allowed(&self, endpoint: SocketAddr) -> bool {
        if self.auto_lan_peers {
            let (SocketAddr::V4(endpoint), Some(observed_peer_ip)) =
                (endpoint, self.observed_peer_ip)
            else {
                return false;
            };
            endpoint.port() >= 1024
                && *endpoint.ip() == observed_peer_ip
                && auto_lan_ip(observed_peer_ip)
        } else {
            self.peer_endpoint_allowed(endpoint)
        }
    }

    fn peer_endpoint_allowed(&self, endpoint: SocketAddr) -> bool {
        if self.auto_lan_peers {
            return self.session_peers.contains(&endpoint);
        }
        if self.allowed_peers.contains(&endpoint) {
            return true;
        }
        let SocketAddr::V4(endpoint) = endpoint else {
            return false;
        };
        endpoint.port() >= 1024
            && safe_ip(*endpoint.ip())
            && self.trusted_client_ips.contains(endpoint.ip())
    }

    /// Offers must be one-way audio/video (send-only publisher, recv-only viewer).
    /// Data channels, simulcast and renegotiation are deliberately unsupported.
    fn validate_offer(&self, sdp: &str) -> Result<Vec<Candidate>, SpikeFailure> {
        if sdp.len() > 12_288 || sdp.lines().count() > 256 {
            return Err(SpikeFailure);
        }
        let mut media_count = 0;
        let mut send_only = false;
        let mut candidates = Vec::with_capacity(MAX_CANDIDATES);
        let mut ssrcs = 0;
        let expected_direction = if self.is_subscriber() {
            "a=recvonly"
        } else {
            "a=sendonly"
        };
        let mut audio_count = 0;
        let mut video_count = 0;
        for line in sdp.lines() {
            if line.starts_with("m=") {
                if media_count > 0 && !send_only {
                    return Err(SpikeFailure);
                }
                if !line.starts_with("m=audio ") && !line.starts_with("m=video ") {
                    return Err(SpikeFailure);
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
                return Err(SpikeFailure);
            }
            if let Some(text) = line.strip_prefix("a=candidate:") {
                candidates.push(self.candidate(&format!("candidate:{text}"))?);
                if candidates.len() > MAX_CANDIDATES {
                    return Err(SpikeFailure);
                }
            }
            if line.starts_with("a=ssrc:") {
                ssrcs += 1;
            }
        }
        if !(1..=2).contains(&media_count)
            || !send_only
            || ssrcs > 16
            || audio_count > 1
            || video_count > 1
        {
            return Err(SpikeFailure);
        }
        Ok(candidates)
    }

    pub async fn offer(&mut self, sdp: &str) -> Result<String, SpikeFailure> {
        if self.offered {
            return Err(SpikeFailure);
        }
        let candidates = self.validate_offer(sdp)?;
        let offer = SdpOffer::from_sdp_string(sdp).map_err(|_| SpikeFailure)?;
        // Candidate validation is all-or-nothing: only after the complete SDP
        // has passed checks do its exact endpoints become usable by str0m.
        if self.auto_lan_peers {
            self.session_peers
                .extend(candidates.iter().map(Candidate::addr));
        }
        let answer = self
            .rtc
            .sdp_api()
            .accept_offer(offer)
            .map_err(|_| SpikeFailure)?;
        self.offered = true;
        self.candidates = candidates.len();
        let answer = answer.to_sdp_string();
        self.drain().await?;
        if answer.len() > 12_288 {
            return Err(SpikeFailure);
        }
        Ok(answer)
    }

    pub async fn ice(&mut self, text: &str) -> Result<(), SpikeFailure> {
        if !self.offered || self.candidates >= MAX_CANDIDATES {
            return Err(SpikeFailure);
        }
        let candidate = self.candidate(text)?;
        if self.auto_lan_peers {
            self.session_peers.insert(candidate.addr());
        }
        self.rtc.add_remote_candidate(candidate);
        self.candidates += 1;
        self.drain().await
    }

    pub async fn timeout(&mut self) -> Result<(), SpikeFailure> {
        if self.expired() {
            return Err(SpikeFailure);
        }
        if Instant::now() >= self.next_timeout {
            self.rtc
                .handle_input(Input::Timeout(Instant::now()))
                .map_err(|_| SpikeFailure)?;
            self.drain().await?;
        }
        // At most one bounded queue batch per owner tick; no media JSON or IPC.
        let batch_started = Instant::now();
        for _ in 0..PACKET_QUEUE_CAPACITY {
            if batch_started.elapsed() >= Duration::from_millis(50) {
                break;
            }
            let packet = match &mut self.route {
                PeerRoute::Subscriber(route) => route.try_packet().map_err(|_| SpikeFailure)?,
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

    async fn forward_packet(&mut self, packet: ForwardPacket) -> Result<(), SpikeFailure> {
        let (kind, index) = match packet.codec {
            Codec::Opus => (MediaKind::Audio, 0),
            Codec::Vp8 => (MediaKind::Video, 1),
            _ => return Err(SpikeFailure),
        };
        let Some(mid) = self
            .tracks
            .iter()
            .find(|(_, track_kind)| *track_kind == kind)
            .map(|(mid, _)| *mid)
        else {
            return Ok(()); // A viewer may explicitly omit audio or video.
        };
        let pt = self
            .rtc
            .codec_config()
            .params()
            .iter()
            .find(|params| params.spec().codec == packet.codec)
            .ok_or(SpikeFailure)?
            .pt();
        let sequence = self.outgoing_sequences[index];
        self.outgoing_sequences[index] = sequence.checked_add(1).ok_or(SpikeFailure)?;
        let mut direct = self.rtc.direct_api();
        let stream = direct.stream_tx_by_mid(mid, None).ok_or(SpikeFailure)?;
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

    pub async fn receive(&mut self, bytes: &[u8], source: SocketAddr) -> Result<(), SpikeFailure> {
        let now = Instant::now();
        if now.duration_since(self.rate_started) >= Duration::from_secs(1) {
            self.rate_started = now;
            self.packets_in_window = 0;
        }
        self.packets_in_window += 1;
        if self.packets_in_window > MAX_PACKETS_PER_SECOND {
            return Err(SpikeFailure);
        }
        if !self.offered || bytes.len() > MAX_DATAGRAM_BYTES || !self.peer_endpoint_allowed(source)
        {
            return Ok(());
        }
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
        self.rtc.handle_input(input).map_err(|_| SpikeFailure)?;
        self.last_packet = now;
        self.drain().await
    }

    async fn drain(&mut self) -> Result<(), SpikeFailure> {
        // Drain into a bounded temporary batch before awaiting any socket I/O.
        let mut datagrams = Vec::with_capacity(MAX_PENDING_DATAGRAMS);
        let mut drained = false;
        for _ in 0..MAX_OUTPUTS_PER_MUTATION {
            match self.rtc.poll_output().map_err(|_| SpikeFailure)? {
                Output::Timeout(deadline) => {
                    self.next_timeout = deadline;
                    drained = true;
                    break;
                }
                Output::Transmit(transmit) => {
                    if !self.peer_endpoint_allowed(transmit.destination)
                        || transmit.contents.len() > MAX_DATAGRAM_BYTES
                        || datagrams.len() >= MAX_PENDING_DATAGRAMS
                    {
                        return Err(SpikeFailure);
                    }
                    datagrams.push((transmit.destination, transmit.contents.to_vec()));
                }
                Output::Event(Event::Connected) => {
                    tracing::info!(subscriber = self.is_subscriber(), "RTC transport connected");
                    self.connected = true;
                    if let PeerRoute::Subscriber(route) = &self.route {
                        route.set_ready().map_err(|_| SpikeFailure)?;
                    }
                }
                Output::Event(Event::MediaAdded(media)) => {
                    if self.tracks.len() >= 2
                        || self.tracks.iter().any(|(_, kind)| *kind == media.kind)
                    {
                        return Err(SpikeFailure);
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
                        PeerRoute::Subscriber(_) => return Err(SpikeFailure),
                        PeerRoute::Publisher(route) => {
                            let codec = self
                                .rtc
                                .codec_config()
                                .params()
                                .iter()
                                .find(|params| params.pt() == packet.header.payload_type)
                                .ok_or(SpikeFailure)?
                                .spec()
                                .codec;
                            route
                                .forward(ForwardPacket {
                                    codec,
                                    timestamp: packet.header.timestamp,
                                    marker: packet.header.marker,
                                    payload: packet.payload,
                                })
                                .map_err(|_| SpikeFailure)?;
                        }
                        PeerRoute::Sink => {}
                    }
                }
                Output::Event(Event::IceConnectionStateChange(
                    IceConnectionState::Disconnected,
                )) => {
                    tracing::warn!(code = "ice_disconnected", "RTC transport failed");
                    return Err(SpikeFailure);
                }
                // No decoding, recording, media logging, control-plane JSON or IPC.
                Output::Event(_) => {}
            }
        }
        if !drained {
            return Err(SpikeFailure);
        }
        // One deadline for the entire batch, not 32 independently renewable waits.
        tokio::time::timeout(Duration::from_millis(50), async {
            for (destination, bytes) in datagrams {
                self.socket
                    .send_to(&bytes, destination)
                    .await
                    .map_err(|_| SpikeFailure)?;
            }
            Ok::<(), SpikeFailure>(())
        })
        .await
        .map_err(|_| SpikeFailure)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestClient {
        rtc: Rtc,
        socket: UdpSocket,
        connected: bool,
        received: Vec<(Codec, Vec<u8>, u32, bool)>,
        audio_mid: Mid,
        video_mid: Mid,
    }

    impl TestClient {
        async fn negotiate(socket: UdpSocket, peer: &mut SpikePeer, viewer: bool) -> Self {
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

    async fn run_test_peer(mut peer: SpikePeer, mut stop: tokio::sync::watch::Receiver<bool>) {
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

    #[tokio::test]
    async fn two_dtls_peers_forward_opus_and_vp8_payloads_without_transcoding() {
        let publisher_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let viewer_socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut config = config_with_auto(true, None, None, true).unwrap().unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let mut publisher_peer = SpikePeer::publisher_for_session(
            &config,
            "room",
            "publisher",
            Some(Ipv4Addr::LOCALHOST),
        )
        .await
        .unwrap();
        let mut viewer_peer = SpikePeer::subscriber_for_session(
            &config,
            "room",
            "publisher",
            "viewer",
            Some(Ipv4Addr::LOCALHOST),
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
        assert_eq!(config.admission.available_permits(), MAX_PEERS);
        assert!(
            config
                .hub
                .subscribe("room", "publisher", "late_viewer")
                .is_err()
        );
    }

    fn config(tls: bool, peers: &str) -> Result<Option<SpikeConfig>, &'static str> {
        config_with(tls, Some(peers), None)
    }

    fn config_with(
        tls: bool,
        peers: Option<&str>,
        trusted_client_ips: Option<&str>,
    ) -> Result<Option<SpikeConfig>, &'static str> {
        config_with_auto(tls, peers, trusted_client_ips, false)
    }

    fn config_with_auto(
        tls: bool,
        peers: Option<&str>,
        trusted_client_ips: Option<&str>,
        auto_lan_peers: bool,
    ) -> Result<Option<SpikeConfig>, &'static str> {
        SpikeConfig::from_lookup(tls, |name| match name {
            "DASS_RTC_SPIKE" => Some("true".into()),
            "DASS_RTC_BIND_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
            "DASS_RTC_FIRST_PORT" => Some("45000".into()),
            "DASS_RTC_ALLOWED_PEERS" => peers.map(Into::into),
            "DASS_RTC_TRUSTED_CLIENT_IPS" => trusted_client_ips.map(Into::into),
            "DASS_RTC_AUTO_LAN_PEERS" => Some(auto_lan_peers.to_string()),
            _ => None,
        })
    }

    #[test]
    fn configuration_requires_tls_opt_in_and_safe_exact_peers() {
        assert!(SpikeConfig::from_lookup(false, |_| None).unwrap().is_none());
        assert!(config(false, "127.0.0.1:50000").is_err());
        assert!(config(true, "127.0.0.1:50000,192.168.1.2:50001").is_ok());
        for peers in [
            "",
            "0.0.0.0:50000",
            "169.254.169.254:50000",
            "100.100.100.200:50000",
            "224.0.0.1:50000",
            "240.0.0.1:50000",
            "192.168.1.255:50000",
            "127.0.0.1:53",
            "[::1]:50000",
            "host.invalid:50000",
            "127.0.0.1:50000,127.0.0.1:50000",
        ] {
            assert!(config(true, peers).is_err());
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
                .contains(&Ipv4Addr::new(192, 168, 1, 2))
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
            SpikeConfig::from_lookup(true, |name| match name {
                "DASS_RTC_SPIKE" => Some("true".into()),
                "DASS_RTC_BIND_IP" | "DASS_RTC_ADVERTISED_IP" => Some("127.0.0.1".into()),
                "DASS_RTC_FIRST_PORT" => Some("45000".into()),
                "DASS_RTC_AUTO_LAN_PEERS" => Some("yes".into()),
                _ => None,
            })
            .is_err()
        );

        for ip in [
            Ipv4Addr::new(10, 0, 0, 4),
            Ipv4Addr::new(172, 16, 0, 4),
            Ipv4Addr::new(192, 168, 0, 4),
            Ipv4Addr::LOCALHOST,
        ] {
            assert!(auto_lan_ip(ip));
        }
        for ip in [
            Ipv4Addr::new(8, 8, 8, 8),
            Ipv4Addr::new(169, 254, 1, 4),
            Ipv4Addr::new(100, 64, 0, 1),
        ] {
            assert!(!auto_lan_ip(ip));
        }
    }

    #[tokio::test]
    async fn owner_rejects_unsafe_candidates_and_unbounded_or_nonpublisher_sdp() {
        let mut config = config(true, "127.0.0.1:50000").unwrap().unwrap();
        // Allocate a temporary two-port range rather than assume 45000 is unused.
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let peer = SpikePeer::bind(&config).await.unwrap();
        assert!(
            peer.candidate("candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host")
                .is_ok()
        );
        for text in [
            "candidate:1 1 udp 2130706431 169.254.169.254 50000 typ host",
            "candidate:1 1 udp 2130706431 127.0.0.1 50001 typ host",
            "candidate:1 1 tcp 2130706431 127.0.0.1 50000 typ host tcptype passive",
        ] {
            assert!(peer.candidate(text).is_err());
        }
        assert!(
            peer.validate_offer("m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n")
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
        assert_eq!(config.admission.available_permits(), 1);
        drop(peer);
        assert_eq!(config.admission.available_permits(), 2);
    }

    #[tokio::test]
    async fn trusted_client_ip_accepts_dynamic_nonprivileged_ports_only_for_configured_hosts() {
        let mut config = config_with(true, None, Some("127.0.0.1")).unwrap().unwrap();
        let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        config.first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let peer = SpikePeer::bind(&config).await.unwrap();

        for port in [1024, 49152, 65535] {
            assert!(
                peer.candidate(&format!(
                    "candidate:1 1 udp 2130706431 127.0.0.1 {port} typ host"
                ))
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
            assert!(peer.candidate(candidate).is_err(), "accepted {candidate}");
        }
    }

    #[tokio::test]
    async fn automatic_admission_is_bound_to_observed_lan_ip_and_validated_offer_candidates() {
        let observed_ip = Ipv4Addr::new(192, 168, 1, 8);
        let config = config_with_auto(true, Some("127.0.0.1:50000"), Some("192.168.1.9"), true)
            .unwrap()
            .unwrap();
        let peer = SpikePeer::bind_for_session(&config, Some(observed_ip))
            .await
            .unwrap();

        assert!(
            peer.candidate("candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host")
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
            assert!(peer.candidate(candidate).is_err(), "accepted {candidate}");
        }

        let valid = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host\r\n";
        let candidates = peer.validate_offer(valid).unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(peer.session_peers.is_empty());

        let mismatched =
            format!("{valid}a=candidate:2 1 udp 2130706431 192.168.1.9 50001 typ host\r\n");
        assert!(peer.validate_offer(&mismatched).is_err());
        assert!(peer.session_peers.is_empty());

        let too_many = format!(
            "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n{}",
            "a=candidate:1 1 udp 2130706431 192.168.1.8 50000 typ host\r\n"
                .repeat(MAX_CANDIDATES + 1)
        );
        assert!(peer.validate_offer(&too_many).is_err());
        assert!(peer.session_peers.is_empty());

        assert!(SpikePeer::bind_for_session(&config, None).await.is_err());
        assert!(
            SpikePeer::bind_for_session(&config, Some(Ipv4Addr::new(8, 8, 8, 8)))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn udp_dtls_srtp_receives_encoded_payload_and_releases_socket() {
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
        config.first_port = probe.local_addr().unwrap().port().min(65534);
        drop(probe);
        let mut peer = SpikePeer::bind(&config).await.unwrap();
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
                        transmissions.push((transmit.destination, transmit.contents.to_vec()));
                    }
                    Output::Event(Event::Connected) => publisher_connected = true,
                    Output::Event(_) => {}
                }
            };
            for (destination, bytes) in transmissions {
                publisher_socket.send_to(&bytes, destination).await.unwrap();
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
        assert_eq!(config.admission.available_permits(), MAX_PEERS);
        let rebound = UdpSocket::bind(peer_address).await.unwrap();
        drop(rebound);
    }
}
