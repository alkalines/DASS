//! Explicit transport modes and the media admission policy.
//!
//! The backend has exactly one media path. Which addresses that path may use
//! is decided here and never by a client-supplied value:
//!
//! * `Local` is a test environment for private LAN peers and explicit
//!   allowlists. It is not a product mode and it is never a LAN trust
//!   mechanism for a public deployment.
//! * `Public` is the Internet target. Every signalled candidate, connectivity
//!   check and media datagram is bound to the authenticated signaling session
//!   and to the peer address observed on that session's TCP connection. The
//!   backend never dials a client-supplied destination, never relays a
//!   participant's address to another participant and never opens a relay.
//!
//! Observed addresses are used for destination safety and bounded abuse
//! control only. They are never proof of identity, room access or stream
//! admission.

use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
};

/// The deployment target of the media path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportMode {
    /// Test environment: private LAN peers and explicit allowlists.
    Local,
    /// Public Internet: admission bound to the observed signaling peer.
    Public,
}

impl TransportMode {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "local" => Ok(Self::Local),
            "public" => Ok(Self::Public),
            _ => Err("DASS_TRANSPORT_MODE must be local or public"),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Public => "public",
        }
    }
}

/// Why a candidate or a datagram source was refused. Fixed codes only:
/// addresses, ports and client-supplied text never reach a log or a response.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The endpoint does not belong to the session's observed signaling peer.
    NotObservedPeer,
    /// The address is never a valid media endpoint.
    UnsafeAddress,
    /// The endpoint uses a privileged port.
    PrivilegedPort,
    /// The transport is not UDP.
    UnsupportedTransport,
    /// The endpoint is not in the local-mode allowlist.
    NotAllowlisted,
    /// The endpoint was never signalled by this session.
    OutsideSession,
}

impl Refusal {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotObservedPeer => "not_observed_peer",
            Self::UnsafeAddress => "unsafe_address",
            Self::PrivilegedPort => "privileged_port",
            Self::UnsupportedTransport => "unsupported_transport",
            Self::NotAllowlisted => "not_allowlisted",
            Self::OutsideSession => "outside_session",
        }
    }
}

/// Normalize an address that carries an embedded IPv4 address. A dual-stack
/// socket reports an IPv4 peer as `::ffff:a.b.c.d`; the policy must see the
/// same address the IPv4 rules describe.
pub fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(address) => IpAddr::V4(address),
        IpAddr::V6(address) => match address.to_ipv4_mapped() {
            Some(mapped) => IpAddr::V4(mapped),
            None => IpAddr::V6(address),
        },
    }
}

/// Loopback, unspecified, link-local, multicast, broadcast, carrier-grade NAT,
/// documentation, benchmarking, IPv4-mapped and known cloud metadata addresses
/// are never valid media endpoints. Private space (RFC1918 and unique-local)
/// is a separate concern: it is usable in the local test environment only.
pub fn is_unsafe_media_address(ip: IpAddr) -> bool {
    match normalize(ip) {
        IpAddr::V4(address) => is_unsafe_media_address_v4(address),
        IpAddr::V6(address) => is_unsafe_media_address_v6(address),
    }
}

fn is_unsafe_media_address_v4(address: Ipv4Addr) -> bool {
    let [a, b, c, d] = address.octets();
    if a == 0 || a == 127 || a >= 224 {
        // "This" network, loopback, multicast, broadcast and reserved space.
        return true;
    }
    if (a == 169 && b == 254) || (a == 100 && (64..=127).contains(&b)) {
        // Link-local (including the 169.254.169.254 metadata address) and
        // carrier-grade NAT.
        return true;
    }
    if (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (18..=19).contains(&b))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
    {
        // Protocol assignments, documentation and benchmarking ranges.
        return true;
    }
    if a == 168 && b == 63 && c == 129 && d == 16 {
        // Azure instance and load-balancer metadata.
        return true;
    }
    if d == 255 && is_private_v4(address) {
        // Directed broadcast inside a private range.
        return true;
    }
    false
}

fn is_unsafe_media_address_v6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    if address.is_loopback() || address.is_unspecified() || address.is_multicast() {
        return true;
    }
    if segments[..6].iter().all(|segment| *segment == 0) {
        // `::/96` carries an embedded IPv4 address, including the deprecated
        // IPv4-compatible form. Such an address is never used directly.
        return true;
    }
    if (segments[0] & 0xffc0) == 0xfe80 {
        // Link-local.
        return true;
    }
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        // Documentation.
        return true;
    }
    if segments[0] == 0x2002 {
        // 6to4 embeds an IPv4 address in the prefix.
        return true;
    }
    false
}

/// RFC1918 private space. Public deployments never treat it as a peer.
pub fn is_private(ip: IpAddr) -> bool {
    match normalize(ip) {
        IpAddr::V4(address) => is_private_v4(address),
        IpAddr::V6(address) => is_unique_local(address),
    }
}

fn is_private_v4(address: Ipv4Addr) -> bool {
    let [a, b, _, _] = address.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

/// The IPv6 unique-local range, the IPv6 equivalent of RFC1918.
fn is_unique_local(address: Ipv6Addr) -> bool {
    (address.segments()[0] & 0xfe00) == 0xfc00
}

/// Private (RFC1918/ULA) and loopback addresses: a test environment only.
pub fn is_private_or_loopback(ip: IpAddr) -> bool {
    match normalize(ip) {
        IpAddr::V4(address) => is_private_v4(address) || address.is_loopback(),
        IpAddr::V6(address) => address.is_loopback() || is_unique_local(address),
    }
}

/// A globally routable unicast address: the only peer a public deployment
/// admits and the only media address a public deployment advertises.
pub fn is_global_unicast(ip: IpAddr) -> bool {
    let ip = normalize(ip);
    !is_unsafe_media_address(ip) && !is_private(ip)
}

/// One media session's admission policy, derived from the authenticated
/// signaling session and the transport mode.
#[derive(Clone, Debug)]
pub struct MediaAdmission {
    mode: TransportMode,
    observed_peer: Option<IpAddr>,
    allowed_peers: HashSet<SocketAddr>,
    trusted_client_ips: HashSet<IpAddr>,
    auto_lan: bool,
}

impl MediaAdmission {
    pub fn new(
        mode: TransportMode,
        observed_peer: Option<IpAddr>,
        allowed_peers: HashSet<SocketAddr>,
        trusted_client_ips: HashSet<IpAddr>,
        auto_lan: bool,
    ) -> Self {
        Self {
            mode,
            observed_peer: observed_peer.map(normalize),
            allowed_peers,
            trusted_client_ips: trusted_client_ips.into_iter().map(normalize).collect(),
            auto_lan,
        }
    }

    pub fn mode(&self) -> TransportMode {
        self.mode
    }

    /// The peer address observed on the authenticated signaling connection.
    pub fn observed_peer(&self) -> Option<IpAddr> {
        self.observed_peer
    }

    /// Whether this session may carry media at all.
    pub fn admits_media(&self) -> bool {
        match self.mode {
            TransportMode::Local => {
                self.observed_peer.is_some()
                    || !self.allowed_peers.is_empty()
                    || !self.trusted_client_ips.is_empty()
            }
            // A public deployment admits only globally routable peers. A
            // private, loopback or otherwise unroutable peer fails closed.
            TransportMode::Public => self.observed_peer.is_some_and(is_global_unicast),
        }
    }

    /// Whether a signalled candidate may be used as a media destination.
    pub fn candidate_verdict(&self, endpoint: SocketAddr) -> Result<(), Refusal> {
        if endpoint.port() < 1024 {
            return Err(Refusal::PrivilegedPort);
        }
        let ip = normalize(endpoint.ip());
        if is_unsafe_media_address(ip) {
            return Err(Refusal::UnsafeAddress);
        }
        match self.mode {
            TransportMode::Public => {
                if self.observed_peer != Some(ip) {
                    return Err(Refusal::NotObservedPeer);
                }
                Ok(())
            }
            TransportMode::Local => {
                if self.auto_lan {
                    let Some(observed) = self.observed_peer else {
                        return Err(Refusal::NotObservedPeer);
                    };
                    if observed != ip || !is_private_or_loopback(observed) {
                        return Err(Refusal::NotObservedPeer);
                    }
                    return Ok(());
                }
                if self.allowed_peers.contains(&endpoint) {
                    return Ok(());
                }
                if self.trusted_client_ips.contains(&ip) {
                    return Ok(());
                }
                Err(Refusal::NotAllowlisted)
            }
        }
    }

    /// Whether an inbound datagram source may be used. The port may differ
    /// from the signalled candidate because a NAT rewrites it, so the source
    /// rule is bound to the observed peer address rather than to a port.
    pub fn source_verdict(
        &self,
        endpoint: SocketAddr,
        session_peers: &HashSet<SocketAddr>,
    ) -> Result<(), Refusal> {
        if endpoint.port() < 1024 {
            return Err(Refusal::PrivilegedPort);
        }
        let ip = normalize(endpoint.ip());
        match self.mode {
            TransportMode::Public => {
                if is_unsafe_media_address(ip) {
                    return Err(Refusal::UnsafeAddress);
                }
                if self.observed_peer != Some(ip) {
                    return Err(Refusal::NotObservedPeer);
                }
                Ok(())
            }
            TransportMode::Local => {
                if self.auto_lan {
                    // Automatic LAN admission only ever accepts an endpoint
                    // this session itself signalled.
                    if session_peers.contains(&endpoint) {
                        return Ok(());
                    }
                    return Err(Refusal::OutsideSession);
                }
                self.candidate_verdict(endpoint)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(observed: Option<&str>, auto_lan: bool) -> MediaAdmission {
        MediaAdmission::new(
            TransportMode::Local,
            observed.map(|value| value.parse().unwrap()),
            HashSet::new(),
            HashSet::new(),
            auto_lan,
        )
    }

    fn public(observed: Option<&str>) -> MediaAdmission {
        MediaAdmission::new(
            TransportMode::Public,
            observed.map(|value| value.parse().unwrap()),
            HashSet::new(),
            HashSet::new(),
            false,
        )
    }

    #[test]
    fn transport_modes_parse_exactly() {
        assert_eq!(TransportMode::parse("local").unwrap(), TransportMode::Local);
        assert_eq!(
            TransportMode::parse("public").unwrap(),
            TransportMode::Public
        );
        for value in ["", "LAN", "Public", "p2p", "local "] {
            assert!(TransportMode::parse(value).is_err(), "accepted {value:?}");
        }
    }

    #[test]
    fn dangerous_addresses_are_never_media_endpoints() {
        for address in [
            "0.0.0.0",
            "127.0.0.1",
            "169.254.1.2",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.1",
            "192.0.2.1",
            "192.88.99.1",
            "198.18.0.1",
            "198.51.100.7",
            "203.0.113.9",
            "224.0.0.1",
            "239.1.1.1",
            "240.0.0.1",
            "255.255.255.255",
            "168.63.129.16",
            "192.168.1.255",
            "::",
            "::1",
            "fe80::1",
            "2001:db8::1",
            "2002::1",
            "ff02::1",
        ] {
            let ip: IpAddr = address.parse().unwrap();
            assert!(
                is_unsafe_media_address(ip),
                "accepted unsafe address {address}"
            );
        }
        for address in ["8.8.8.8", "203.0.114.1", "2606:4700::1111"] {
            let ip: IpAddr = address.parse().unwrap();
            assert!(!is_unsafe_media_address(ip), "rejected {address}");
        }
    }

    #[test]
    fn an_ipv4_mapped_peer_is_classified_by_the_ipv4_rules() {
        let mapped: IpAddr = "::ffff:203.0.114.9".parse().unwrap();
        assert_eq!(normalize(mapped), "203.0.114.9".parse().unwrap());
        assert!(is_global_unicast(mapped));
        let private: IpAddr = "::ffff:192.168.1.1".parse().unwrap();
        assert!(is_private(private));
        assert!(!is_global_unicast(private));
    }

    #[test]
    fn private_space_is_separate_from_unsafe_space() {
        for address in [
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.8",
            "127.0.0.1",
            "fd00::1",
        ] {
            let ip: IpAddr = address.parse().unwrap();
            assert!(!is_unsafe_media_address(ip), "rejected {address}");
            assert!(!is_global_unicast(ip), "accepted {address} as global");
            assert!(is_private_or_loopback(ip), "rejected {address} as local");
        }
        assert!(is_global_unicast("8.8.8.8".parse().unwrap()));
        assert!(!is_private_or_loopback("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn public_admission_binds_candidates_to_the_observed_peer() {
        let policy = public(Some("8.8.8.8"));
        assert!(policy.admits_media());
        assert_eq!(
            policy
                .candidate_verdict("8.8.8.8:51234".parse().unwrap())
                .unwrap(),
            ()
        );
        // A different port is normal: a NAT rewrites the client's port.
        assert_eq!(
            policy
                .candidate_verdict("8.8.8.8:40000".parse().unwrap())
                .unwrap(),
            ()
        );
        for endpoint in [
            "1.1.1.1:51234",
            "8.8.4.4:51234",
            "192.168.1.5:51234",
            "8.8.8.8:80",
            "169.254.169.254:51234",
        ] {
            assert!(
                policy.candidate_verdict(endpoint.parse().unwrap()).is_err(),
                "accepted {endpoint}"
            );
        }
    }

    #[test]
    fn public_admission_requires_a_globally_routable_observed_peer() {
        for observed in ["127.0.0.1", "10.0.0.4", "192.168.1.4", "::1"] {
            let policy = public(Some(observed));
            assert!(!policy.admits_media(), "admitted {observed}");
        }
        assert!(!public(None).admits_media());
    }

    #[test]
    fn public_sources_may_use_a_nat_rewritten_port_but_not_another_address() {
        let policy = public(Some("8.8.8.8"));
        let peers = HashSet::new();
        assert_eq!(
            policy
                .source_verdict("8.8.8.8:40001".parse().unwrap(), &peers)
                .unwrap(),
            ()
        );
        for endpoint in ["1.1.1.1:40001", "8.8.8.8:53", "10.0.0.1:40001"] {
            assert!(
                policy
                    .source_verdict(endpoint.parse().unwrap(), &peers)
                    .is_err(),
                "accepted {endpoint}"
            );
        }
    }

    #[test]
    fn local_admission_keeps_the_lan_test_environment() {
        let policy = local(Some("192.168.1.8"), true);
        assert!(policy.admits_media());
        assert_eq!(
            policy
                .candidate_verdict("192.168.1.8:50000".parse().unwrap())
                .unwrap(),
            ()
        );
        for endpoint in [
            "192.168.1.9:50000",
            "8.8.8.8:50000",
            "192.168.1.8:80",
            "169.254.1.2:50000",
        ] {
            assert!(
                policy.candidate_verdict(endpoint.parse().unwrap()).is_err(),
                "accepted {endpoint}"
            );
        }
        // Automatic LAN admission only accepts signalled session endpoints.
        let mut peers = HashSet::new();
        peers.insert("192.168.1.8:50000".parse().unwrap());
        assert_eq!(
            policy
                .source_verdict("192.168.1.8:50000".parse().unwrap(), &peers)
                .unwrap(),
            ()
        );
        assert!(
            policy
                .source_verdict("192.168.1.8:50001".parse().unwrap(), &peers)
                .is_err()
        );
    }

    #[test]
    fn refusals_expose_only_fixed_codes() {
        for refusal in [
            Refusal::NotObservedPeer,
            Refusal::UnsafeAddress,
            Refusal::PrivilegedPort,
            Refusal::UnsupportedTransport,
            Refusal::NotAllowlisted,
            Refusal::OutsideSession,
        ] {
            let code = refusal.code();
            assert!(!code.is_empty());
            assert!(!code.contains('.'));
            assert!(!code.contains(' '));
        }
    }
}
