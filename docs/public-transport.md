# DASS public Internet transport

Discord Alternative ScreenShare (DASS) has two transport modes. This document
describes the Internet target, the admission model, the deployment
requirements, the resource budget and the limits of the current evidence.

The implementation is in `crates/backend/src/transport.rs` (mode and admission
policy), `crates/backend/src/rtc.rs` (the media owner), `crates/backend/src/config.rs`
(deployment rules and limits), `crates/backend/src/listener.rs` (socket and TLS
admission) and `crates/backend/src/metrics.rs` (bounded operational counters).

**This is not deployment authorization and not interoperability evidence.**
Roadmap section 7 (the pilot gate) still requires an independent review, real
clients on separate networks and explicit operator approval.

## Transport modes

| Mode | `DASS_TRANSPORT_MODE` | Purpose |
| --- | --- | --- |
| Local | `local` (default) | LAN test environment: private peers, explicit allowlists and automatic LAN admission |
| Public | `public` | Internet target: admission is bound to the authenticated signaling session and its observed peer address |

LAN is a test environment, never a product mode and never a trust mechanism.
The public mode refuses every LAN allowlist mechanism
(`DASS_RTC_ALLOWED_PEERS`, `DASS_RTC_TRUSTED_CLIENT_IPS`,
`DASS_RTC_AUTO_LAN_PEERS`) and refuses a plaintext deployment.

## The public admission model

A public deployment answers one question per media session: *may this session
use this address?* The answer comes from the transport policy, never from a
client-supplied value.

1. The signaling WebSocket is authenticated. The only address the backend
   knows is the TCP peer address observed on that accepted socket. Forwarding
   headers and any client-claimed address are ignored.
2. The media session is bound to that observed peer address. A public
   deployment admits only globally routable peers: a private, loopback or
   otherwise unroutable peer never carries media.
3. A signalled candidate is usable only when its address is the observed peer
   address. The port may differ, because a NAT rewrites it. Candidates with
   any other address — a private host candidate, for example — are removed
   from the offer before the media stack ever sees them. The backend never
   dials a client-supplied destination.
4. An inbound datagram is processed only when its source address is the
   observed peer address. This is what makes the peer's effective (NAT
   mapped) address usable, and it is what keeps the backend from becoming a
   scanner, a reflector or an open relay.
5. The server advertises one media address of its own, configured by the
   operator. Clients reach the server; the server never connects to a
   participant.

Addresses that are never valid media endpoints: unspecified, loopback,
link-local (including `169.254.169.254`), multicast, broadcast, carrier-grade
NAT (`100.64.0.0/10`), documentation, benchmarking, unique-local IPv6, IPv6
6to4, IPv4-mapped IPv6 and known cloud metadata addresses.

### NAT traversal

The server is an ICE-lite agent with a single host candidate (its configured
public address and the bound UDP port). The client performs connectivity
checks; the backend answers them and learns the client's effective address
from the observed traffic. There is **no TURN server, no relay and no
peer-to-peer path**: every media byte travels client → server → client, and
the backend never forwards a participant's address to another participant.

Consequences an operator must accept:

- The client must be able to reach the advertised media address. A
  restrictive UDP network blocks the media path; there is no TCP fallback in
  this build.
- The UDP path and the signaling path must present the same public address to
  the server. Deployments that split TCP and UDP egress (some carrier-grade
  NAT setups) do not work and are not detected as such; the media session
  fails closed instead of opening an unsafe path.
- A server behind a 1:1 NAT advertises its public address and binds its
  private one. The bind and advertised addresses must use the same address
  family.
- IPv4 and IPv6 are supported by the backend. A client that offers only
  IPv6 candidates is usable; the client keeps both families and the backend
  decides which one it may use.

### No third-party STUN

No external STUN or TURN service is used, so no third party learns a
participant's address. The backend does not run a STUN responder in this
build: the ICE-lite exchange is enough for the server-observed model.

## Deployment requirements

A public deployment is a separate, explicit configuration. It is not the
default Compose profile.

| Requirement | Value |
| --- | --- |
| Transport mode | `DASS_TRANSPORT_MODE=public` |
| Transport encryption | `DASS_TLS_CERT_FILE` and `DASS_TLS_KEY_FILE`, TLS 1.3 only |
| Plaintext | `DASS_INSECURE_LOCAL_DEV` must be unset; the public mode rejects it |
| Public media address | `DASS_RTC_ADVERTISED_IP` must be a globally routable literal IP of the same family as `DASS_RTC_BIND_IP` |
| Media transport | `DASS_RTC_SPIKE=true` and `DASS_RTC_FIRST_PORT` (the UDP port range) |
| Published ports | TCP 8080 (signaling) and the UDP media port(s) to the Internet |
| Accounts | `DASS_USERS` (hashed accounts) or `DASS_INVITE_FILE` |
| Administration | `DASS_ADMIN_USERS` plus a network-restricted panel path; the panel is not an Internet-facing surface |

Names are never accepted for the media address: the backend resolves nothing,
so a hostname would add a DNS-rebinding and rebinding-attack surface for no
benefit.

### Certificates and renewal

The backend reads its certificate and key once at startup. An expired
certificate fails every TLS handshake, so the deployment is down for clients
even though the process still runs. The backend therefore reports the leaf
certificate's expiry at startup:

- `certificate_expiring` — the certificate expires within 14 days.
- `certificate_expired` — the certificate has already expired; clients cannot
  connect.

The check is informational. The TLS stack remains the authority on the
certificate; the backend never accepts an untrusted certificate and never
serves a self-signed one.

Renewal replaces the certificate and key files and restarts the container:

```sh
docker compose up -d --force-recreate backend
```

There is no in-process certificate reload. Rotation therefore needs a
restart, and a restart drops every signaling session and every media session;
clients reconnect and re-authenticate, and publisher approvals do not survive
a restart.

### Firewall and exposure

- Publish TCP 8080 and the UDP media port range. Nothing else is needed.
- Keep the administration panel on a restricted network path or behind a
  separate, private listener. The panel shares the process with the public
  signaling service; it is protected by separate administrator credentials,
  not by a second port.
- The container runs non-root, read-only, with no Linux capabilities, a
  256 MiB memory limit, one CPU and a 64-process limit. It never mounts the
  Docker socket and never runs a second service.

### Reverse proxies

This build does not trust forwarding headers, so a reverse proxy in front of
the signaling port hides the client address: the backend would then observe
the proxy's address, and the public mode would refuse the media session
because the observed peer is not the client's address.

A public deployment therefore needs either

- direct TCP exposure of the signaling port, or
- a transparent layer-4 pass-through that preserves the client source address.

A layer-7 proxy that terminates TLS and re-originates the connection is not
supported in this build. Reviewing that topology (including how authenticated
peer identity survives a load balancer) is an open item of roadmap 4.5.

## Resource budget

Every queue, socket, worker and media path is bounded and configurable. The
values are explicit so an operator can size a host and see the cost of a
hostile client.

| Variable | Default | Bound |
| --- | --- | --- |
| `DASS_MAX_CONCURRENT_REQUESTS` | 128 | 1–1024 active HTTP handlers |
| `DASS_MAX_CONTROL_MESSAGE_BYTES` | 16384 | HTTP bodies and WebSocket messages |
| `DASS_MAX_SESSIONS` | 128 | 1–4096 authenticated signaling sessions |
| `DASS_MAX_UNAUTHENTICATED_SESSIONS` | 16 | 1–256 sessions before login |
| `DASS_MAX_TCP_CONNECTIONS` | 128 | 1–4096 accepted TCP connections |
| `DASS_MAX_PASSWORD_VERIFICATIONS` | 2 | 1–16 concurrent password hashes |
| `DASS_MAX_MEDIA_SESSIONS` | 2 | 1–64 concurrent media-session admission permits; increasing it does not increase forwarding topology |
| `DASS_MAX_PACKETS_PER_SECOND` | 2000 | 1–20000 UDP datagrams per media session |
| `DASS_MAX_INGRESS_BYTES_PER_SECOND` | 2000000 | media bytes per session per second |
| `DASS_MAX_EGRESS_BYTES_PER_SECOND` | 4000000 | forwarded bytes per session per second |

Fairness comes from the per-session budgets: one account or one source cannot
take more than its share of the media path, and a slow viewer loses its route
instead of growing a queue. The total server egress is bounded by the number
of media sessions times the per-session egress budget. Application limits
cannot prevent upstream link saturation; hosting-provider DDoS protection and
the residual availability risk stay with the operator.

The media topology is still one publisher and one viewer **backend-wide**, with
one in-process queue of 32 packets between them. `DASS_MAX_MEDIA_SESSIONS` is a
transport admission ceiling, not a capacity setting; values above two do not
enable additional routes. Multi-user forwarding is roadmap section 9, not this
build.

## Operational metrics

`crates/backend/src/metrics.rs` keeps aggregate counters and a bounded ring of
the most recent events (128 in memory, 32 reported). The administrator panel
reads them; clients never do.

Counters cover connections, logins, sessions, streams, view requests and
decisions, rejections, rate limiting and media session outcomes. Events carry
a fixed code, a severity and a timestamp.

The module never records credentials, keys, SDP, captured frames, account
names, room names or addresses. A rejected login is counted as
`login_failed`; it does not record the submitted account name.

Readiness stays `503` and the capability document keeps reporting
`media_available: false` and `ready: false`. The public transport mode does
not change that: the media path has not passed the real-client gate.

## What is not proven

- No real client has exchanged media over the public mode. The two-client
  evidence checklist in [transport-gate.md](transport-gate.md) is still open,
  and the public mode adds a separate requirement: two clients on separate
  Internet networks.
- The Rust changes in this increment have not been compiled, formatted,
  linted or tested in Docker. The Docker socket was not accessible in the
  authoring session, so the canonical checks are blocked, not passed.
- The public mode's admission rules are covered by unit tests over the
  policy functions only. They are not exercised by a real ICE exchange.
- The certificate expiry reader is a minimal DER reader. It reports what it
  can parse and stays silent otherwise; it is not a certificate validator.
- There is no TURN, no relay, no TCP media fallback, no IPv6-only deployment
  test and no measured capacity figure.
- No independent security review has been performed. Roadmap section 7
  requires one before a pilot.

## Validation commands

Run from the repository root, in Docker:

```sh
docker compose build backend
```

That runs the locked formatting check, Clippy with warnings denied, the
workspace tests and the locked release build. The client checks are separate:

```sh
bun test ./tests/plugin
bun scripts/generate-protocol.mjs --check
```
