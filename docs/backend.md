# DASS backend: Docker-only development

Discord Alternative ScreenShare (DASS) uses one Rust backend executable. This
backend contains an Axum HTTP scaffold and a separate Rust protocol crate, not a
functioning SFU. All Rust tooling runs inside Docker. Signaling types and
structural parsers are documented in [protocol.md](protocol.md). An optional
invite-backed HTTPS/WSS control plane now passes user-run Docker validation; see
[control-plane.md](control-plane.md). WebRTC/media transport is still absent.

## Prerequisites

- Docker Engine with the Compose v2 plugin and permission to use the daemon.
- Network access to pull `rust:1.90.0-bookworm`, `debian:bookworm-slim` and crates.
- No host Rust, Cargo, Bun, encoder or media helper is required for backend work.

Image tags select the initial toolchain/OS but are not immutable digests. Pin
reviewed image digests before a production release. This scaffold is **local
development only** and must not be exposed publicly.

## Bootstrap and validate

Run every command from the repository root. Match the tooling container's user
to your host user so Cargo and formatting do not create root-owned source files:

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker compose build tooling
docker compose run --rm tooling cargo fmt --all
docker compose run --rm tooling cargo fmt --all -- --check
docker compose run --rm tooling cargo clippy --workspace --all-targets --locked -- -D warnings
docker compose run --rm tooling cargo test --workspace --locked
docker compose run --rm tooling cargo build --workspace --locked
docker compose build backend
```

Use the Docker-generated `Cargo.lock` included in the checkout. The runtime build
deliberately requires it and uses `--locked`; dependency changes must be intentional.
If bootstrapping a checkout without a lockfile, generate it once inside Docker:

```sh
docker compose run --rm tooling cargo generate-lockfile
```

Review dependencies/licenses and commit the result, rather than regenerating it
before every build.

### Recorded validation

The user's supplied Docker output confirms:

- Rust 1.90.0 tooling image built and formatting ran.
- Clippy with warnings denied passed.
- All 12 unit tests passed (11 backend, 1 protocol); doc tests passed with no cases.
- The locked release build and non-root runtime image built successfully.
- Docker Compose reported the backend container started.

The missing Buildx plugin warning was non-blocking: the classic builder completed
both images. These Dockerfiles do not require BuildKit-only features. Container
startup does not prove ongoing health or successful HTTP smoke checks; those are
still pending. No host Rust tooling was used.

The `tooling` service bind-mounts source and uses named volumes for Cargo's cache
and build artifacts. It runs as the configured UID/GID. Run tooling commands
sequentially: parallel Cargo/formatting jobs against the same source are unnecessary.

Cargo caches and build artifacts now use UID-specific subdirectories in those
volumes, so earlier root-run tooling does not require changing ownership of shared
registry/build files. If you prefer a root shell for Docker, enter it explicitly
and set Compose ownership variables **inside that shell**:

```sh
sudo su
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker compose run --rm tooling cargo test --workspace --locked
```

In this example tooling also runs as root and uses the `uid-0` cache/target
directories. Newly generated bind-mounted files may be root-owned. The runtime
image still runs as UID 10001; root tooling does not change that. No Docker
socket permissions or host groups need changing. Run the intentional dependency
update in [control-plane.md](control-plane.md) first when its new manifest pins
are not yet represented in `Cargo.lock`.

The subsequent receive-only RTC spike introduces new manifest pins; its Docker
lockfile update, formatting, Clippy and all 37 Rust tests passed in the user's
Docker run. Locked builds, formatting check and provider-feature review then passed,
including non-root runtime image `c768ed04d118`. A subsequently added combined
WSS-to-DTLS/revocation test also passed with Docker formatting, Clippy and all
38 Rust tests. See [rtc-spike.md](rtc-spike.md).

The later one-publisher/one-viewer feasibility forwarding code and its new tests
passed user-run Docker formatting, Clippy and all 41 Rust tests. The user then
confirmed its locked workspace/backend image builds completed, without supplying
a new image ID or separate formatting-check output. Prior
receive-only image evidence does not validate this increment's runtime image;
see [forwarding-spike.md](forwarding-spike.md).

Tests cover development opt-in, configuration bounds, capability truthfulness,
liveness versus readiness, absent session APIs, HTTP method rejection, oversized
bodies, handler saturation and request timeout. They do not validate capture,
authentication, WebRTC, SFU forwarding or E2EE.

The later protocol-foundation validation supplied by the user passed formatting,
Clippy with warnings denied, 17 Rust tests (13 backend, four protocol), locked
debug/release builds, and the runtime image build. TypeScript generation freshness,
61 client tests and `git diff --check` also passed. This evidence predates the
new authentication/TLS/WSS increment. The user subsequently validated that
increment too: Clippy, all 33 Rust tests, locked debug/release builds and runtime
image build passed after enabling Axum's `original-uri` feature. See
[control-plane.md](control-plane.md) for network-test evidence and untested behavior.

## Run locally

```sh
docker compose up -d backend
docker compose logs backend
```

Only `127.0.0.1:8080` on the host is published. Inside the container the service
binds to `0.0.0.0:8080`; other containers on the Compose network may reach it, so
keep that network isolated. The runtime is non-root, read-only, has no Linux
capabilities, and is capped at 1 CPU, 256 MiB memory and 64 processes/threads.

Inspect endpoints in a temporary container on the backend's network namespace
(no host curl installation needed):

```sh
docker run --rm --network "container:$(docker compose ps -q backend)" curlimages/curl:8.12.1 -i http://127.0.0.1:8080/health/live
docker run --rm --network "container:$(docker compose ps -q backend)" curlimages/curl:8.12.1 -i http://127.0.0.1:8080/health/ready
docker run --rm --network "container:$(docker compose ps -q backend)" curlimages/curl:8.12.1 -i http://127.0.0.1:8080/v1/capabilities
```

Expected behavior, **not yet verified at runtime**:

| Endpoint | Expected response |
| --- | --- |
| `GET /health/live` | 204: process responds |
| `GET /health/ready` | 503: signaling and media are not implemented |
| `GET /v1/capabilities` | 200: protocol v1, stage `scaffold`, all media/security capabilities unavailable in default local Compose |
| Room, publish, subscribe and WebSocket paths | 404 in default local Compose; optional invite configuration adds `/v1/ws` only |

Readiness intentionally stays false; do not configure it as a liveness probe.
The capability document advertises no SDP/ICE or media endpoint. Logs contain
fixed lifecycle messages, not request URLs, headers, bodies or sensitive IDs.

### Equibop discovery and CORS

The local-development scaffold permits credential-free browser reads of
`GET /v1/capabilities` (and its implicit HEAD response) only from the exact
origin `https://discord.com`. It returns `Access-Control-Allow-Origin` for that
origin and `Vary: Origin`, without a wildcard or credential permission. Other
origins, routes and write/preflight methods receive no CORS permission. The
plugin's discovery fetch is a simple GET without custom headers; no preflight
support is needed for that request. CORS is not authentication or authorization
and does not make this scaffold safe to expose publicly. Without TLS/invite
configuration, startup still fails closed unless isolated local development is
explicitly enabled. TLS/control network tests pass in Docker, but a built image
and those tests are not a production deployment/security audit.

After this change, rebuild/recreate the local backend from the **DASS repository
root**:

```sh
docker compose build backend
docker compose up -d backend
curl -i -H 'Origin: https://discord.com' http://localhost:8080/v1/capabilities
```

Expect HTTP 200, scaffold JSON and
`Access-Control-Allow-Origin: https://discord.com`. Then click **Check backend
capabilities** in DASS settings. This corrects the missing CORS header, not
unrelated CSP, mixed-content or local-network policy failures. No plugin rebuild
is needed for this backend-only fix. Media remains unavailable.

The pre-fix endpoint was reachable with HTTP 200 but lacked CORS headers. Tests
for the exact-origin policy and route/method isolation were added. Docker access
was denied in the agent session, so the CORS change has not been compiled,
formatted, tested or rebuilt by the agent; validate it with the Docker-only
commands above and the workspace checks before relying on it.

Stop the local container gracefully (SIGTERM):

```sh
docker compose down
```

This preserves named caches. Do not add `--volumes` unless you intentionally want
to discard build caches. Runtime SIGINT/SIGTERM asks Axum to drain; Compose waits
10 seconds before forcing termination. Requests have a five-second processing
timeout. The new bounded listener adds socket admission, initial-I/O deadlines and
a maximum connection lifetime; its automated tests pass, but it is not complete
per-IP denial-of-service protection.

## Configuration

| Variable | Default | Behavior |
| --- | --- | --- |
| `DASS_INSECURE_LOCAL_DEV` | unset | Exactly `true` permits isolated loopback/container plaintext; otherwise TLS files and invite policy are required |
| `DASS_TLS_CERT_FILE`, `DASS_TLS_KEY_FILE` | unset | Configure both for TLS 1.3; never combine with insecure mode |
| `DASS_INVITE_FILE` | unset | Enables the timed-login control plane; mandatory in TLS mode |
| `DASS_LISTEN_ADDR` | `127.0.0.1:8080` | Literal IP/port; Compose sets `0.0.0.0:8080` for container networking |
| `DASS_MAX_CONCURRENT_REQUESTS` | 128 | 1–1024; immediately reject excess active HTTP handlers with 503 |
| `DASS_MAX_CONTROL_MESSAGE_BYTES` | 16384 | Discovery-only: 1–65536; with invites: minimum 1024, clamped to protocol maximum 16384; cap HTTP bodies/WS messages |

The handler limit is **not** a bound on open TCP sockets, a rate limiter or a
future RTC peer limit. The new listener has its own 128-socket admission bound,
TLS/initial-I/O deadlines and maximum connection lifetime. See
[control-plane.md](control-plane.md) for independent WebSocket, verification and
room limits and their recorded test status. Local opt-in is not a TLS substitute.

## Next backend increment

1. Select and review scoped DASS authentication and revocation; never use Discord
   tokens or trust client channel membership claims.
2. Implement TLS/WSS, origin checks, single-use connection tickets, connection
   admission, bounded signaling messages, and authenticated room authorization.
3. Pin `str0m` and its crypto provider, and implement a single-owner sans-I/O
   transport spike with bounded UDP I/O and restricted ICE destinations.
4. Verify two real compatible clients before adding SFU packet routing,
   retransmission/feedback and publisher/subscriber admission.
5. Implement/review E2EE separately; required-E2EE sessions must fail closed until
   the client frame encryption and authenticated key distribution are verified.

No claim of Phase 0 completion, media interoperability, security review or
performance is made. See [the plan](research/PLAN.md) and
[backend ADR](adr/0001-rust-docker-backend.md).
