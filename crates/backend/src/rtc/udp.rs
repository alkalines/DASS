//! Two shared UDP sockets. This dispatcher never owns or mutates an RTC.
//! A session's authenticated ICE check establishes its bounded endpoint routes;
//! DTLS/SRTP and all RTC mutation remain in that session's single owner.

use super::{MAX_CANDIDATES, MAX_DATAGRAM_BYTES, MediaFailure, MediaLimits};
use crate::transport::MediaAdmission;
use std::{
    collections::{HashMap, HashSet},
    io,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};
use str0m::{IceCreds, crypto::Sha1HmacProvider, net::StunMessage};
use tokio::{
    net::UdpSocket,
    sync::{Mutex as AsyncMutex, mpsc},
    task::JoinHandle,
};

const INGRESS_QUEUE_PACKETS: usize = 32;

pub(super) struct SharedUdp {
    sockets: [Arc<UdpSocket>; 2],
    registry: Arc<Mutex<Registry>>,
    readers: [JoinHandle<()>; 2],
}

struct Registry {
    routes: HashMap<String, Route>,
    endpoints: HashMap<(usize, SocketAddr), String>,
    max_sessions: usize,
    max_packets_per_second: usize,
    windows: [(Instant, usize); 2],
    hmac: &'static dyn Sha1HmacProvider,
    failed: bool,
}

struct Route {
    identity: Arc<()>,
    credentials: IceCreds,
    admission: MediaAdmission,
    session_peers: HashSet<SocketAddr>,
    observed_endpoints: HashSet<SocketAddr>,
    port_index: usize,
    offered: bool,
    sender: mpsc::Sender<Datagram>,
}

struct Datagram {
    bytes: Box<[u8]>,
    source: SocketAddr,
}

pub(super) struct SessionUdp {
    shared: Arc<SharedUdp>,
    ufrag: String,
    identity: Arc<()>,
    port_index: usize,
    receiver: AsyncMutex<mpsc::Receiver<Datagram>>,
}

impl Registry {
    fn destination(
        &mut self,
        port_index: usize,
        source: SocketAddr,
        bytes: &[u8],
    ) -> Option<mpsc::Sender<Datagram>> {
        if self.failed || bytes.is_empty() || bytes.len() > MAX_DATAGRAM_BYTES {
            return None;
        }
        // Bound parsing/HMAC work even for unknown senders. This aggregate
        // shedding limit is not per-source fairness or DDoS protection.
        let window = &mut self.windows[port_index];
        if window.0.elapsed() >= Duration::from_secs(1) {
            *window = (Instant::now(), 0);
        }
        if window.1 >= self.max_packets_per_second {
            return None;
        }
        window.1 += 1;

        if bytes[0] < 2 {
            let stun = StunMessage::parse(bytes).ok()?;
            if stun.is_binding_request() {
                let (ufrag, _) = stun.split_username()?;
                let hmac = self.hmac;
                let route = self.routes.get_mut(ufrag)?;
                if !route.offered
                    || route.port_index != port_index
                    || route
                        .admission
                        .source_verdict(source, &route.session_peers)
                        .is_err()
                    || !stun.verify(route.credentials.pass.as_bytes(), |key, payloads| {
                        hmac.sha1_hmac(key, payloads)
                    })
                {
                    return None;
                }
                // A valid check for a different session must not steal an
                // established tuple. Ambiguous tuple reuse fails closed.
                let key = (port_index, source);
                if self.endpoints.get(&key).is_some_and(|owner| owner != ufrag) {
                    return None;
                }
                if !route.observed_endpoints.contains(&source)
                    && route.observed_endpoints.len() >= MAX_CANDIDATES
                {
                    return None;
                }
                route.observed_endpoints.insert(source);
                self.endpoints.insert(key, ufrag.to_owned());
                return Some(route.sender.clone());
            }
        }
        // No fan-out by IP, broadcast to RTC owners or client-controlled global
        // whitelist: non-request traffic needs an integrity-verified ICE tuple.
        let ufrag = self.endpoints.get(&(port_index, source))?;
        let route = self.routes.get(ufrag)?;
        if !route.offered
            || route
                .admission
                .source_verdict(source, &route.session_peers)
                .is_err()
        {
            return None;
        }
        Some(route.sender.clone())
    }
}

impl SharedUdp {
    pub(super) async fn bind(
        bind_ip: IpAddr,
        first_port: u16,
        limits: MediaLimits,
    ) -> Result<Arc<Self>, MediaFailure> {
        let second_port = first_port.checked_add(1).ok_or(MediaFailure)?;
        if first_port < 1024 {
            return Err(MediaFailure);
        }
        // Both binds must succeed. Never fall back to a larger range, an
        // ephemeral port, or a partially available pair.
        let first = Arc::new(
            UdpSocket::bind((bind_ip, first_port))
                .await
                .map_err(|_| MediaFailure)?,
        );
        let second = Arc::new(
            UdpSocket::bind((bind_ip, second_port))
                .await
                .map_err(|_| MediaFailure)?,
        );
        let registry = Arc::new(Mutex::new(Registry {
            routes: HashMap::new(),
            endpoints: HashMap::new(),
            max_sessions: limits.max_sessions,
            max_packets_per_second: limits.max_sessions * limits.max_packets_per_second,
            windows: [(Instant::now(), 0); 2],
            hmac: str0m_aws_lc_rs::default_provider().sha1_hmac_provider,
            failed: false,
        }));
        let readers = [
            tokio::spawn(read_socket(first.clone(), Arc::downgrade(&registry), 0)),
            tokio::spawn(read_socket(second.clone(), Arc::downgrade(&registry), 1)),
        ];
        Ok(Arc::new(Self {
            sockets: [first, second],
            registry,
            readers,
        }))
    }

    pub(super) fn register(
        self: &Arc<Self>,
        credentials: IceCreds,
        admission: MediaAdmission,
    ) -> Result<SessionUdp, MediaFailure> {
        let mut registry = self.registry.lock().map_err(|_| MediaFailure)?;
        if registry.failed
            || registry.routes.len() >= registry.max_sessions
            || registry.routes.contains_key(&credentials.ufrag)
        {
            return Err(MediaFailure);
        }
        let first_count = registry
            .routes
            .values()
            .filter(|route| route.port_index == 0)
            .count();
        let port_index = if first_count > registry.routes.len() - first_count {
            1
        } else {
            0
        };
        let identity = Arc::new(());
        let ufrag = credentials.ufrag.clone();
        let (sender, receiver) = mpsc::channel(INGRESS_QUEUE_PACKETS);
        registry.routes.insert(
            ufrag.clone(),
            Route {
                identity: identity.clone(),
                credentials,
                admission,
                session_peers: HashSet::new(),
                observed_endpoints: HashSet::new(),
                port_index,
                offered: false,
                sender,
            },
        );
        Ok(SessionUdp {
            shared: self.clone(),
            ufrag,
            identity,
            port_index,
            receiver: AsyncMutex::new(receiver),
        })
    }
}

async fn read_socket(socket: Arc<UdpSocket>, registry: Weak<Mutex<Registry>>, port_index: usize) {
    let mut buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
    loop {
        let received = socket.recv_from(&mut buffer).await;
        let Some(registry) = registry.upgrade() else {
            break;
        };
        let Ok((length, source)) = received else {
            if let Ok(mut registry) = registry.lock() {
                registry.failed = true;
                registry.endpoints.clear();
                registry.routes.clear();
            }
            break;
        };
        let sender = {
            let Ok(mut registry) = registry.lock() else {
                break;
            };
            registry.destination(port_index, source, &buffer[..length])
        };
        if let Some(sender) = sender {
            // A saturated owner drops input; it cannot stall the shared socket
            // or grow another queue. RTC/DTLS retain their own validation.
            let _ = sender.try_send(Datagram {
                bytes: Box::from(&buffer[..length]),
                source,
            });
        }
    }
}

impl SessionUdp {
    pub(super) fn admit_offer(&self, session_peers: &HashSet<SocketAddr>) -> Result<(), MediaFailure> {
        if session_peers.len() > MAX_CANDIDATES {
            return Err(MediaFailure);
        }
        let mut registry = self.shared.registry.lock().map_err(|_| MediaFailure)?;
        let route = registry
            .routes
            .get_mut(&self.ufrag)
            .filter(|route| Arc::ptr_eq(&route.identity, &self.identity))
            .ok_or(MediaFailure)?;
        route.session_peers.clone_from(session_peers);
        route.offered = true;
        Ok(())
    }

    pub(super) fn local_addr(&self) -> io::Result<SocketAddr> {
        self.shared.sockets[self.port_index].local_addr()
    }

    pub(super) async fn recv_from(&self, buffer: &mut [u8]) -> io::Result<(usize, SocketAddr)> {
        let mut receiver = self.receiver.lock().await;
        let datagram = receiver
            .recv()
            .await
            .ok_or_else(|| io::Error::from(io::ErrorKind::BrokenPipe))?;
        if datagram.bytes.len() > buffer.len() {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        buffer[..datagram.bytes.len()].copy_from_slice(&datagram.bytes);
        Ok((datagram.bytes.len(), datagram.source))
    }

    pub(super) async fn send_to(&self, bytes: &[u8], destination: SocketAddr) -> io::Result<usize> {
        self.shared.sockets[self.port_index]
            .send_to(bytes, destination)
            .await
    }
}

impl Drop for SessionUdp {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.shared.registry.lock()
            && registry
                .routes
                .get(&self.ufrag)
                .is_some_and(|route| Arc::ptr_eq(&route.identity, &self.identity))
        {
            registry.routes.remove(&self.ufrag);
            registry
                .endpoints
                .retain(|_, owner| owner.as_str() != self.ufrag.as_str());
        }
    }
}

impl Drop for SharedUdp {
    fn drop(&mut self) {
        for reader in &self.readers {
            reader.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::TransportMode;
    use str0m::ice::TransId;

    async fn pair(max_sessions: usize) -> Arc<SharedUdp> {
        for _ in 0..128 {
            let probe = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let port = probe.local_addr().unwrap().port();
            drop(probe);
            if port == 65535 { continue; }
            if let Ok(pair) = SharedUdp::bind("127.0.0.1".parse().unwrap(), port,
                MediaLimits { max_sessions, ..MediaLimits::default() }).await {
                return pair;
            }
        }
        panic!("could not bind a test UDP pair");
    }

    fn session(pair: &Arc<SharedUdp>, ufrag: &str, source: SocketAddr) -> SessionUdp {
        let admission = MediaAdmission::new(TransportMode::Local, Some(source.ip()),
            HashSet::new(), HashSet::new(), true);
        let session = pair.register(IceCreds { ufrag: ufrag.into(), pass: "test-ice-password".into() }, admission).unwrap();
        session.admit_offer(&HashSet::from([source])).unwrap();
        session
    }

    fn check(ufrag: &str, password: &[u8]) -> Vec<u8> {
        let username = format!("{ufrag}:remote");
        let request = StunMessage::binding_request(&username, TransId::new(), true, 42, 1, true);
        let mut bytes = [0_u8; 512];
        let hmac = str0m_aws_lc_rs::default_provider().sha1_hmac_provider;
        let length = request.to_bytes(Some(password), &mut bytes,
            |key, payloads| hmac.sha1_hmac(key, payloads)).unwrap();
        bytes[..length].to_vec()
    }

    fn dispatch(pair: &SharedUdp, index: usize, source: SocketAddr, bytes: &[u8]) -> bool {
        let sender = pair.registry.lock().unwrap().destination(index, source, bytes);
        sender.is_some_and(|sender| sender.try_send(Datagram { bytes: bytes.into(), source }).is_ok())
    }

    #[tokio::test]
    async fn sixty_four_sessions_use_only_the_same_two_ports_and_release_their_slots() {
        let pair = pair(64).await;
        let source = "127.0.0.1:55000".parse().unwrap();
        let mut sessions: Vec<_> = (0..64).map(|index| session(&pair, &format!("session_{index}"), source)).collect();
        let ports: HashSet<_> = sessions.iter().map(|session| session.local_addr().unwrap().port()).collect();
        let first = pair.sockets[0].local_addr().unwrap().port();
        assert_eq!(ports, HashSet::from([first, first + 1]));
        assert!(pair.register(IceCreds { ufrag: "overflow".into(), pass: "test".into() },
            MediaAdmission::new(TransportMode::Local, Some(source.ip()), HashSet::new(), HashSet::new(), true)).is_err());
        drop(sessions.pop());
        let replacement = session(&pair, "replacement", source);
        drop(sessions);
        drop(replacement);
        assert!(pair.registry.lock().unwrap().routes.is_empty());
        assert!(pair.registry.lock().unwrap().endpoints.is_empty());
    }

    #[tokio::test]
    async fn checks_require_integrity_admission_and_the_correct_port_without_tuple_stealing() {
        let pair = pair(4).await;
        let source: SocketAddr = "127.0.0.1:55000".parse().unwrap();
        let alice = session(&pair, "alice", source);
        let bob = session(&pair, "bob", source);
        let other = session(&pair, "other", source);
        let valid = check("alice", b"test-ice-password");
        assert!(!dispatch(&pair, alice.port_index, source, &[128, 96, 0]));
        assert!(!dispatch(&pair, alice.port_index, source, &check("alice", b"wrong-password")));
        assert!(!dispatch(&pair, alice.port_index, "127.0.0.2:55000".parse().unwrap(), &valid));
        assert!(!dispatch(&pair, bob.port_index, source, &valid));
        assert!(dispatch(&pair, alice.port_index, source, &valid));
        assert!(!dispatch(&pair, other.port_index, source, &check("other", b"test-ice-password")));
        assert!(dispatch(&pair, alice.port_index, source, &[128, 96, 0]));
        assert_eq!(alice.receiver.lock().await.len(), 2);
        assert!(bob.receiver.lock().await.is_empty());
        assert!(other.receiver.lock().await.is_empty());
        drop(alice);
        assert!(pair.registry.lock().unwrap().endpoints.is_empty());
        assert!(dispatch(&pair, other.port_index, source, &check("other", b"test-ice-password")));
    }

    #[tokio::test]
    async fn public_nat_endpoints_require_the_observed_ip_and_remain_bounded() {
        let pair = pair(4).await;
        let ip = "203.0.114.10".parse().unwrap();
        let session = pair.register(IceCreds { ufrag: "public".into(), pass: "test-ice-password".into() },
            MediaAdmission::new(TransportMode::Public, Some(ip), HashSet::new(), HashSet::new(), false)).unwrap();
        session.admit_offer(&HashSet::new()).unwrap();
        let bytes = check("public", b"test-ice-password");
        assert!(!dispatch(&pair, session.port_index, "203.0.114.11:55000".parse().unwrap(), &bytes));
        for offset in 0..MAX_CANDIDATES {
            assert!(dispatch(&pair, session.port_index, SocketAddr::new(ip, 55000 + offset as u16), &bytes));
        }
        assert!(!dispatch(&pair, session.port_index, SocketAddr::new(ip, 55016), &bytes));
        assert_eq!(pair.registry.lock().unwrap().endpoints.len(), MAX_CANDIDATES);
        drop(session);
        assert!(pair.registry.lock().unwrap().endpoints.is_empty());
    }

    #[tokio::test]
    async fn an_unavailable_second_port_fails_without_keeping_the_first_or_binding_a_fallback() {
        for _ in 0..128 {
            let second = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let second_port = second.local_addr().unwrap().port();
            if second_port <= 1024 { continue; }
            let first_port = second_port - 1;
            let Ok(probe) = UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, first_port)).await else { continue; };
            drop(probe);
            assert!(SharedUdp::bind("127.0.0.1".parse().unwrap(), first_port, MediaLimits::default()).await.is_err());
            assert!(UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, first_port)).await.is_ok());
            return;
        }
        panic!("could not reserve a test port pair");
    }

    #[tokio::test]
    async fn a_full_ingress_queue_does_not_stall_another_owner() {
        let pair = pair(4).await;
        let source: SocketAddr = "127.0.0.1:55000".parse().unwrap();
        let slow = session(&pair, "slow", source);
        let fast = session(&pair, "fast", source);
        assert!(dispatch(&pair, slow.port_index, source, &check("slow", b"test-ice-password")));
        for _ in 0..INGRESS_QUEUE_PACKETS {
            dispatch(&pair, slow.port_index, source, &[128, 96, 0]);
        }
        assert_eq!(slow.receiver.lock().await.len(), INGRESS_QUEUE_PACKETS);
        assert!(dispatch(&pair, fast.port_index, source, &check("fast", b"test-ice-password")));
        assert_eq!(fast.receiver.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn real_socket_dispatch_is_cancellable_and_drop_clears_endpoint_ownership() {
        let pair = pair(4).await;
        let client = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let source = client.local_addr().unwrap();
        let session = session(&pair, "actual", source);
        let mut buffer = [0_u8; MAX_DATAGRAM_BYTES + 1];
        assert!(tokio::time::timeout(Duration::from_millis(1), session.recv_from(&mut buffer)).await.is_err());
        let bytes = check("actual", b"test-ice-password");
        client.send_to(&bytes, session.local_addr().unwrap()).await.unwrap();
        let (length, observed) = tokio::time::timeout(Duration::from_secs(1), session.recv_from(&mut buffer)).await.unwrap().unwrap();
        assert_eq!(observed, source);
        assert_eq!(&buffer[..length], &bytes);
        drop(session);
        assert!(pair.registry.lock().unwrap().routes.is_empty());
        assert!(pair.registry.lock().unwrap().endpoints.is_empty());
    }
}
