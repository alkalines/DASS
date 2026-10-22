# Rust WebRTC feasibility spike

This page records earlier checkpoints. The current experimental transport shares
exactly two UDP listeners across resource-bounded sessions; see
[simultaneous-sharing.md](simultaneous-sharing.md). Earlier Docker/client results
below do not validate the new shared-socket dispatcher.

Discord Alternative ScreenShare (DASS) has an **opt-in** WebRTC
implementation in the existing Rust executable. Its first receive-only checkpoint
passed user-run Docker checks/builds and provider-feature review. The subsequent
combined WSS-to-DTLS/revocation test also passed in Docker. This is a
partial step 4.5 increment, not a production SFU. A subsequent
[one-publisher/one-viewer forwarding increment](forwarding-spike.md) is now
covered by passing user-run Docker formatting, Clippy and all 41 Rust tests;
the user also confirmed its locked workspace/backend image builds completed.
Readiness stays 503 and
discovery media/SDP/ICE/E2EE capabilities stay false. No plugin capture was enabled.

## Dependency/API review

Reviewed published release metadata, manifests and relevant source on October 11,
2026. This is implementation-selection review, not a cryptographic audit or
completed transitive advisory/license review:

| Component | Exact pin | Selection |
| --- | --- | --- |
| str0m | `0.24.1` | Published October 3, non-yanked, Rust 1.85, MIT OR Apache-2.0; Sans-I/O, RTP-level operation, default features disabled |
| str0m-aws-lc-rs | `0.6.0` | Published August 8, non-yanked, Rust 1.85, MIT OR Apache-2.0; explicitly installed per RTC instance |
| dimpl | `0.7.4` | Published September 18, non-yanked, Rust 1.85, MIT OR Apache-2.0; provider's DTLS implementation, constrained directly with AWS-LC/rcgen features |
| aws-lc-rs | `1.18.1` | Existing exact non-FIPS binding pin shared with rustls; no OpenSSL/RustCrypto alternative provider selection |

DTLS 1.2 and remote certificate-fingerprint verification are explicitly selected
for the spike; HTTPS/WSS separately uses TLS 1.3. The provider supports
AES128-CM/SHA1-80 and AES-GCM SRTP profiles. These transport keys terminate at the
server, not E2EE. Required E2EE remains rejected. No custom encryption is added.
The provider uses dimpl's AWS-LC path, with its library-provided supporting
primitives; this is not a claim that every primitive is implemented in AWS-LC.

Sources:

- [str0m release](https://crates.io/crates/str0m/0.24.1)
- [str0m run-loop invariant and provider API](https://docs.rs/str0m/0.24.1/str0m/)
- [AWS-LC provider source](https://docs.rs/crate/str0m-aws-lc-rs/0.6.0/source/)
- [dimpl release](https://crates.io/crates/dimpl/0.7.4)

Source archives were inspected without resolving or building Rust on the host.
The Docker-generated lockfile contains the reviewed exact RTC pins, a single
AWS-LC binding version and the provider's supporting AES/CCM crates. The user's
Docker feature trees confirm AWS-LC/rcgen for dimpl and AWS-LC for rustls/webpki;
`cargo tree --locked -e features -i ring` reported nothing on the tested target.
Although `ring` appears in the lockfile and was downloaded by the builder, it
was not compiled in the supplied release build and is not an active dependency
in that target's feature tree. No claim is made about other build targets.
Only fixed DASS-owned log messages reach the executable's logging sink; upstream
RTC/TLS logs are filtered out to avoid SDP/identifier disclosure. Do not enable
upstream `pii` features or dump SDP/credentials for troubleshooting.

## Docker validation checkpoint

Run from the **DASS repository root**. If using a root shell, enter `sudo su`
first (skip that command if already root), then set UID/GID in that shell:

```sh
sudo su
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"

# RTC dependency resolution already completed; keep --locked.
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i aws-lc-rs
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i dimpl
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i str0m
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i ring
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo clippy --workspace --all-targets --locked -- -D warnings
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo build --workspace --locked
docker compose build backend
```

Stop at the first failure. No tooling-image rebuild is needed if the earlier CMake
tooling image is present. Review `git diff -- Cargo.lock` from your normal Git
shell; retain the Docker-generated lockfile with these changes after review.
Root tooling uses UID-0 cache/target directories and may create root-owned
bind-mounted files; the runtime remains non-root. No cache deletion, automatic
ownership/group changes or host Cargo fallback is used.

The agent's Docker socket access remains denied. On October 11, 2026, the user
supplied passing Docker results for intentional dependency resolution (30 added
packages), formatting, Clippy with warnings denied and all **37 Rust tests**
(33 backend, four protocol; no doc-test cases). This includes destination/SDP
policy, publish-scope authorization, UDP DTLS-SRTP payload receipt and socket
cleanup. The agent inspected the generated lockfile without editing it. A separate
formatting check, locked workspace/release builds, runtime image build and unified
provider-feature review subsequently passed in the user's supplied Docker output.
The non-root runtime image built as `c768ed04d118`; missing Buildx was non-blocking.
These results validate the first receive-only checkpoint, not a running-image
smoke test or production security audit. The UDP test negotiates two Rust RTCs
and sends opaque test bytes over DTLS-SRTP; it does not establish real Opus
decoding, video behavior, Chromium compatibility or capture consent.

### Recorded integration-test checkpoint

After the above results, a new network test was added:
`authenticated_wss_negotiates_dtls_and_revocation_drops_rtc_socket`. It performs
verified TLS 1.3 WSS login/room join, rejects SDP before publish, negotiates an RTC
answer through authenticated signaling, completes UDP DTLS with an explicitly
configured provider, and then replaces invite policy to check closure and actual
UDP socket/room/credential cleanup. It exercises policy-watch replacement, not
OS SIGHUP delivery. The user supplied passing Docker formatting, Clippy with
warnings denied and all **38 Rust tests** (34 backend, four protocol; no doc-test
cases) for this test and fixture refactor on October 11, 2026. No dependency
update was needed. The earlier locked runtime image predates this test-only
addition; no newer runtime image build is claimed. This combined-path test
establishes automated coverage of authenticated negotiation and RTC revocation
cleanup, not the real Equibop two-client gate.

## Experimental configuration and lifecycle

The normal server configuration is unchanged unless `DASS_RTC_SPIKE=true`.
Enabling it requires TLS, an invite file, and all these explicit settings:

| Variable | Meaning |
| --- | --- |
| `DASS_RTC_BIND_IP` | IPv4 UDP bind address, e.g. the isolated container's `0.0.0.0` |
| `DASS_RTC_ADVERTISED_IP` | Reachable IPv4 address advertised in the answer; never unspecified |
| `DASS_RTC_FIRST_PORT` | Two-port UDP range start, 1024–65534 inclusive |
| `DASS_RTC_ALLOWED_PEERS` | Comma-separated exact client IPv4:UDP-port endpoints; at most 16, no hostnames or duplicates |

There is intentionally no running Compose media example yet: container/network
topology and real client ICE endpoints must be verified first. Existing Compose
exposes TCP only. Binding container UDP alone does **not** make it reachable;
any later local-only UDP publication must be explicit and host-loopback-bound.
Do not expose this spike publicly or change the existing HTTP loopback policy.

The validated receive-only checkpoint's client flow: WSS `dass.v1` with exact `https://discord.com` Origin → timed DASS
login → room join with `require_e2ee=false` → publish → send-only
audio/video offer → answer → optional bounded trickle candidates. A publish
`accepted` response reserves a receive transport, not proof of media delivery.
Offer/ICE must reference that connection's authenticated session.
That checkpoint refused viewer subscriptions; the
new Docker-tested forwarding source enables a narrow, publisher-approved
subscribe path as documented
in [forwarding-spike.md](forwarding-spike.md). Duplicate request IDs and duplicate active credentials
remain rejected as before.

Only UDP/IPv4 candidates whose destination exactly matches the administrator's
allowlist are accepted, including embedded SDP candidates. Every outbound
datagram is checked again, including peer-reflexive ICE output. Link-local,
metadata, shared CGNAT, multicast, broadcast, documentation, benchmark and
reserved destinations are refused. Explicit LAN/loopback addresses are allowed
only at the configured non-privileged ports. No DNS resolution, TURN relay,
external STUN gathering, ICE restart, simulcast, data channel or renegotiation is
implemented. Browser mDNS candidates and changing ephemeral ports make this
strict policy inconvenient; a future minimal client harness must gather the
actual candidates and arrange exact allowlisting without logging full SDP.

## Receive-only checkpoint bounds and remaining work

- Two RTC owners globally per configured spike; two UDP ports, one socket per
  owner; existing authenticated connection/room limits still apply.
- At most two send-only audio/video m-lines, 16 SSRC attribute lines, 16 total
  embedded/trickle candidates and 256 SDP lines; 12 KiB SDP bound.
- 2048-byte UDP payload cap, 2000 packets/second per owner, up to 32 pending
  outbound datagrams and 256 outputs per mutation. Exceeding output/rate bounds
  closes the transport instead of creating an unbounded queue.
- Small explicit send/reordering buffers; RTP mode avoids encoded-frame
  reassembly. No application media cache, decoding, transcoding or recording.
- 15-second room-to-DTLS setup deadline; 30-second accepted-input inactivity
  timeout; ten-minute maximum RTC lifetime, plus the 600-second session lifetime
  and policy-reload containment.
- Drop-owned socket/RTC/admission cleanup on leave, WSS close, auth failure,
  shutdown/reload, setup failure and overload. No additional client processes.

Application bounds and library buffer settings are not a complete adversarial
resource audit. Peer allowlisting is not authorization; publisher approval is
required before any subscribe allocates a route. Node failure/reconnect, SIGHUP
delivery, malformed crypto packet
stress tests and real Equibop integration remain to be exercised.

After this checkpoint passes, add only the minimal authorized two-client
feasibility forwarding/capture/viewer path. Record actual video, explicit share
audio, independent Discord voice, teardown and no media/preview leakage in
[transport-gate.md](transport-gate.md). Full SFU mapping, pacing, feedback and
retransmission work remains gated on that evidence.
