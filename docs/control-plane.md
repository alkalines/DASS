# DASS authenticated control-plane increment

Discord Alternative ScreenShare (DASS) now has source implementations for invite
authentication, scoped room membership and TLS/WSS in its **one Rust executable**.
The user's Docker validation passed dependency resolution, formatting, Clippy,
33 Rust tests, locked builds and the runtime image build. Transitive dependency
license/advisory review and real-client compatibility evidence are still outstanding.
This is not a functioning WebRTC transport, a production deployment, or completion
of step 4. Capture remains disabled and readiness remains 503.

## Dependency selection and review scope

Reviewed upstream release metadata, feature definitions and relevant API/source
documentation on October 11, 2026:

| Implementation | Exact manifest pin | Selection |
| --- | --- | --- |
| RustCrypto Argon2 | `0.6.0` | Maintained release, Rust 1.85; PHC `PasswordVerifier`, not custom password comparison |
| Axum | `0.8.9` | Existing HTTP framework with its WebSocket extractor enabled |
| rustls | `0.23.45` | TLS 1.3 only, explicit provider, no early data or library logging |
| tokio-rustls | `0.26.6` | Default features disabled; no implicit second provider |
| AWS-LC Rust bindings | `1.18.1` | Explicit non-FIPS AWS-LC provider, pinned independently of rustls |
| rustls-pki-types | `1.15.1` | PEM parsing for certificate/key files |
| getrandom | `0.4.3` | OS randomness; failures deny issuance/session creation |

Argon2/getrandom/rcgen/tokio-rustls/rustls-pki-types are MIT OR Apache-2.0,
Axum is MIT, and rustls is Apache-2.0 OR ISC OR MIT. AWS-LC Rust bindings declare
`ISC AND (Apache-2.0 OR ISC)`; its native source has additional
notices which must accompany redistribution. Exact transitive versions/licenses
and advisories still require reviewing the Docker-generated lockfile. This is
an implementation selection and API review, **not an independent security audit**.

Test-only pins are rcgen `0.14.10` with AWS-LC (not its default ring provider),
tokio-tungstenite `0.29.0`, and futures-util `0.3.34`. No str0m dependency has been
added yet: its crypto/provider and owner-loop review belongs to the next increment.
Do not enable another TLS provider through default dependency features. AWS-LC
adds a native C/CMake build dependency **inside Docker**, not a client helper or
host toolchain. The tooling image now installs CMake.

Sources:
- [Argon2 release/API](https://docs.rs/argon2/0.6.0/argon2/)
- [rustls release](https://crates.io/crates/rustls/0.23.45)
- [rustls provider model](https://docs.rs/rustls/0.23.45/rustls/crypto/index.html)
- [tokio-rustls release/features](https://crates.io/crates/tokio-rustls/0.26.6)
- [AWS-LC Rust bindings](https://github.com/aws/aws-lc-rs)
- [Axum WebSocket API](https://docs.rs/axum/0.8.9/axum/extract/ws/struct.WebSocketUpgrade.html)

## Intentional dependency update and validation

Run from the **DASS repository root** in a shell with Docker access. A `sudo su`
shell is supported as described in [backend.md](backend.md). Do not run host
Cargo. The control-plane dependency update has already been completed in Docker;
the subsequent RTC spike's intentional update also completed in Docker; retain
the resulting lockfile for these locked checks. See [rtc-spike.md](rtc-spike.md).

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker build --target tooling -t dass-rust-tools .
git diff -- Cargo.lock
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i rustls
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo tree --locked -e features -i aws-lc-rs
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo clippy --workspace --all-targets --locked -- -D warnings
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo build --workspace --locked
docker compose build backend
bun scripts/generate-protocol.mjs --check
bun test ./tests/plugin
git diff --check
```

Stop at a failure and share the output. Keep the Docker-generated `Cargo.lock`
with this change after review. For a future intentional manifest/dependency update
only, run `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo update --workspace` once and
inspect its MSRV/resolution changes. Do not routinely regenerate the lockfile.
Do not bypass a version conflict by removing pins or using a host toolchain.

In a `sudo su` shell, export `LOCAL_UID`/`LOCAL_GID` there and use plain `docker`
commands. The tooling service uses UID-specific cache and target directories,
separating root and normal-user tooling runs without deleting caches or changing
ownership. A denied update command leaves the old lockfile unchanged; subsequent
locked checks/builds are expected to fail.

New tests include valid/invalid credentials, legacy-field fail-closed loading,
bounded hash costs, duplicate requests, exclusive credential leases,
room saturation/cleanup, exact Origin and query rejection, admission exhaustion,
publisher-owned pending requests, single-use decisions, deny cooldown, block and
removal withdrawal, and network-level authenticated WSS with verified TLS 1.3
certificates.
Network tests also exercise the login deadline, idle credential expiration,
room reservation timeout and truthful discovery/readiness over HTTPS. Ephemeral
test roots are trusted explicitly; there is no certificate-verification bypass.
### Recorded Docker validation

On October 11, 2026, the user supplied passing output for:

- Docker-only intentional lockfile resolution using Rust 1.90-compatible versions.
- Formatting and formatting check, followed by Clippy with warnings denied.
- All 33 Rust tests: 29 backend and four protocol; doc tests completed with no cases.
- Locked debug workspace build and locked release runtime-image build.
- Non-root runtime image `b800f6af9735` built successfully; the missing Buildx
  warning did not prevent the classic builder from completing.

The first compilation exposed a missing Axum `original-uri` feature, which was
enabled before the successful Clippy/test/build run. Tests verify authenticated
WSS over actual loopback sockets using trusted ephemeral TLS 1.3 certificates,
including expiry, policy replacement, roles, replay, admission and setup timeouts.
Policy replacement tests exercise the watch channel, not OS SIGHUP delivery.
Admin issuance filesystem behavior, mounted-file reload operations, running-image
smoke checks and real Equibop browser compatibility remain unverified. The agent
still lacks Docker access and records the user's evidence rather than claiming
an independent container run or security audit.

## Invite model and admin issuance

The server reads a bounded, administrator-owned JSON file. Version-2 records
authenticate service-wide: room grants, roles, scheduled expiration, revocation
flags and login IP allowlists were removed. Stream admission is decided live by
the publisher through approval requests, never by stored grants.

```json
{
  "version": 2,
  "invites": [{
    "invite_id": "publisher_invite",
    "password_hash": "GENERATED_ARGON2ID_PHC_HASH",
    "display_name": "Studio PC"
  }]
}
```

The placeholder hash is **not valid configuration**; `display_name` is optional.
The same executable's admin-only `create-invite` subcommand creates a 256-bit
random secret and a random
16-byte salt. It writes an invite document and a separate credential file using
create-new, mode 0600; it never prints the credential. Argon2id v19 is fixed to
19,456 KiB, two passes, one lane, and a 32-byte output. Loading rejects other
hash algorithms, salt/output lengths and costs before any verification. At most
two blocking verifications run at once, including after a timed login is cancelled.
Version-1 files or records still containing the removed fields fail closed; see
the migration section in [lan-accounts.md](lan-accounts.md).

After the locked build succeeds, create two distinct client invites:

```sh
mkdir -m 700 .secrets
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo run --locked -p dass-backend -- create-invite .secrets/publisher-record.json .secrets/publisher-credential.txt publisher_invite "Publisher"
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo run --locked -p dass-backend -- create-invite .secrets/viewer-record.json .secrets/viewer-credential.txt viewer_invite "Viewer"
bun -e 'const fs = require("node:fs"); const documents = ["publisher", "viewer"].map(name => JSON.parse(fs.readFileSync(`.secrets/${name}-record.json`, "utf8"))); fs.writeFileSync(".secrets/invites.json", JSON.stringify({version: 2, invites: documents.flatMap(document => document.invites)}, null, 2), {mode: 0o600, flag: "wx"});'
```

If `.secrets` already exists, retain it rather than overwriting/deleting anything.
Issuance is not transactional across its two files: on an I/O failure inspect any
new partial files before retrying with fresh paths. Deliver each credential
privately to its intended client; never paste it into logs, issue reports, URLs,
Discord messages or command-line arguments. `.secrets/` is ignored by Git, but
that is not a substitute for filesystem permissions or secure delivery. Do not
mount the plaintext credential files into the backend.

Credentials are **reusable bearer credentials**, not identity proofs or
single-use WebSocket tickets. One live connection per invite prevents concurrent
credential reuse; duplicate request IDs and second login operations are rejected.
Reconnect with a new WebSocket after the old lease closes is intentional. Sessions
expire a fixed 600 seconds after authentication; containment is account removal
or password reset, which disconnects every session. A stolen
valid bearer credential can impersonate its holder once the lease is free; TLS
and private distribution remain essential. Do not
claim protection against bearer theft or arbitrary cross-connection credential replay.

## Configuration and local TLS testing

| Variable | Behavior |
| --- | --- |
| `DASS_TLS_CERT_FILE`, `DASS_TLS_KEY_FILE` | Both required outside explicit local development; bounded PEM input; TLS 1.3 only |
| `DASS_INVITE_FILE` | Required with TLS; enables `/v1/ws`; no public issuance/admin endpoint |
| `DASS_MAX_CONTROL_MESSAGE_BYTES` | With invites, minimum 1,024 bytes, maximum 16,384 (larger configured values are clamped); shared HTTP/WS receive bound |
| `DASS_INSECURE_LOCAL_DEV` | Exactly `true` allows plaintext on loopback or an isolated unspecified container bind; never combine with TLS |

Without an invite file, local Compose still exposes **discovery only**. TLS key,
certificate and invite file must be readable by container UID/GID `10001:10001`;
choose appropriate ownership/modes yourself without making keys world-readable.
Supply a certificate trusted by the actual client for the hostname it connects
to. No command here installs a root CA or bypasses browser certificate, CSP,
mixed-content or local-network checks.

Use the single `compose.yaml`. For loopback-only invite signaling, set these
values in the repository-root `.env` (do not copy the LAN example for this mode):

```dotenv
DASS_BIND_IP=127.0.0.1
DASS_INSECURE_LOCAL_DEV=false
DASS_RTC_SPIKE=false
DASS_RTC_AUTO_LAN_PEERS=false
```

Place the three backend-readable files in `.secrets/runtime` as `cert.pem`,
`key.pem` and `invites.json`; that directory is mounted read-only at `/run/dass`.
Create a private mode-0600 `.secrets/backend.env` with the following unquoted
lines (no `DASS_USERS` in invite mode):

```dotenv
DASS_TLS_CERT_FILE=/run/dass/cert.pem
DASS_TLS_KEY_FILE=/run/dass/key.pem
DASS_INVITE_FILE=/run/dass/invites.json
```

Compose >= 2.30 is required for the raw environment-file format. After validation
and preparing backend-readable files:

```sh
docker compose config --quiet
docker compose up -d --build backend
```

This is **local testing**, not authorization to expose the scaffold publicly.
No GUI login/capture flow is wired to this server yet.

## Signaling behavior and resource ownership

- `/v1/ws` requires exactly one `Origin: https://discord.com`, no query string,
  cookies or Authorization header, and the `dass.v1` subprotocol. Credentials go
  only in a text `login` operation within five seconds of upgrade. Binary media,
  malformed/oversized JSON and unknown wire fields are rejected.
- Rooms are discovery grouping only; any authenticated session may join or list
  any room. Stream admission is publisher-controlled: a viewer's `request_view`
  is pushed to the owning publisher, whose `view_decision` (`approve`, `deny`,
  `block`) is enforced single-use by the backend. Only an approval's opaque
  `approval_id` permits `subscribe`; `remove_viewer` withdraws an account's
  access. Required E2EE fails closed. By default authorized
  publish/subscribe, SDP and ICE operations return `transport_unavailable`.
  The subsequent explicit receive-only [RTC spike](rtc-spike.md) can reserve a
  publisher transport and process SDP/ICE, with passing Docker automated tests;
  the subsequent [minimal forwarding increment](forwarding-spike.md) also adds a
  room-scoped subscribe role, covered by passing Docker automated tests; its
  locked builds were subsequently confirmed by the user, while real-client
  interoperability remains unverified.
- Limits: 128 TCP connections including upgrades, 16 pending TLS handshakes,
  128 WebSockets, 16 unauthenticated WebSockets, 256 invite records,
  16 members per room, and one joined session per connection. View-request
  bounds are listed in [protocol.md](protocol.md) (64 global pending, 8 per
  publisher, 4 per viewer account, 16 unused approvals per publisher, 60 s
  request lifetime, 30 s deny cooldown).
- TLS handshake and initial HTTP I/O deadlines are five seconds each. An entire
  connection I/O has a ten-minute maximum lifetime after TLS/plaintext acceptance
  (in addition to the bounded TLS handshake). HTTP handler
  timeouts/body limits also wrap upgrade requests. Subsequent keepalive header
  reads share the lifetime ceiling, not a separate per-header five-second timer.
- At most eight login attempts per global one-second window and 32 received
  WebSocket messages per connection/window. This is bounded load shedding, not
  complete per-IP rate limiting or denial-of-service protection.
- Request IDs are remembered for the whole connection up to 256. Saturation
  closes the connection rather than evicting replay evidence. Reconnect requires
  fresh authentication. Room reservations time out after 15 seconds without RTC
  setup. Only the explicitly enabled RTC spike can complete DTLS setup; default
  control-plane-only operation cannot.
- There is no application outbound queue: one owner sends each response with a
  one-second deadline and a WebSocket write-buffer cap of twice the message bound
  (32,768 bytes by default). The new RTC spike independently bounds its temporary
  UDP batches. RAII releases room, invite and admission
  leases on disconnect/error/cancellation.
- Session expiration is fixed at 600 seconds from authentication and checked on
  each operation and every tick while idle, using both
  wall time and a login-time monotonic deadline. There is no scheduled
  account expiration or per-record revocation flag. Close delivery can add bounded
  send delays; the socket is then dropped even if the peer does not acknowledge.

## Containment and reload

Remove a record or change its hash in the admin file and
signal the backend:

```sh
docker compose kill -s SIGHUP backend
```

Every reload invalidates **all existing authenticated connections**, including
unchanged invites, so no session retains stale permissions. A malformed/unreadable
reload replaces policy with an empty deny-all store; it does not retain old access.
SIGINT/SIGTERM similarly invalidate sessions before draining HTTP.

The single Compose file mounts the containing `.secrets/runtime` directory,
so atomic replacement of `invites.json` inside that directory is visible to
the container. Keep replacement-file permissions readable by the backend and
signal SIGHUP after the edit. Replacing the mounted directory itself requires
recreating the container. The production policy-management/storage strategy is
not implemented, and the file format has no public writable admin API.

## Capability truthfulness and next gate

Discovery adds `control_plane_available` and `authentication_available`, true only
when the invite-backed route is installed. `signaling_available` still means
operational **SDP/ICE media signaling**, and remains false alongside media/E2EE.
The stage remains `scaffold`; `/health/ready` stays 503. A successful test/build of
this increment must not enable capture or advertise transport interoperability.

Next: Docker-validate the new pinned receive-only UDP/RTC spike with ICE
destination restrictions, add minimal feasibility forwarding, and use two real Equibop clients
to record video/explicit-audio, teardown, independent voice and no Discord media
leakage. Only then may step 4.7 SFU forwarding be accepted.
