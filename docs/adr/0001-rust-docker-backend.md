# ADR 0001: one Rust backend, Docker-only tooling

Status: accepted for language/tooling; media-library feasibility remains open.

## Decision

Implement DASS signaling and media in one Rust executable, packaged in Docker.
Use a Cargo workspace separating the service from public protocol types. Use
Docker for dependency resolution, formatting, linting, tests and compilation;
do not require or invoke a host Rust toolchain. Bun is reserved for future
TypeScript plugin tooling and is not a signaling server option.

Start with Axum/Tokio discovery and health endpoints. Do not add `str0m`, an
authentication library or encryption implementation without the corresponding
dependency/provider review and transport/security design. Runtime defaults fail
closed; the scaffold runs only with explicit local-development opt-in.

## Consequences

- One deployment unit and no backend control-plane IPC boundary.
- Tooling and runtime images are separate; runtime has no compiler and runs as
  a non-root user with container resource/security restrictions.
- Docker access is required. If access is blocked, provide the user the Docker
  commands rather than bypassing the requirement with host tools.
- Lockfile generation must happen inside Docker and the result must be committed.
- The current service is not ready to carry media or serve production traffic.
  It advertises unavailable signaling, media and E2EE and returns 503 readiness.
- Real Equibop/Discord compatibility, packet forwarding, E2EE, TURN and failover
  remain subject to the plan's acceptance gates, not implied by this decision.
