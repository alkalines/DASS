# DASS — Discord Alternative ScreenShare

Early-stage project for an Equicord plugin and self-hosted Rust screensharing backend.

- [Research and implementation plan](docs/research/PLAN.md)
- [Contributor and agent instructions](AGENTS.md)
- [Docker-only backend development](docs/backend.md)

The proposed architecture uses Equibop's existing capture pipeline and a Rust
WebRTC selective forwarding backend, without additional client helper executables.
Both broadcasters and viewers need DASS. The Rust backend currently provides
local-development health and capability endpoints only; the plugin, authentication,
WebRTC forwarding and E2EE are not implemented.

The backend is built, tested and run using Docker, with no host Rust installation.
Follow the backend guide to generate `Cargo.lock`, run checks and start the container.
Bun is only for future TypeScript plugin tooling, not the server.

## Equibop checkout

`vendor/Equibop` is an upstream Git submodule pinned to the commit used for the
research. It provides the host application source, not the Equicord plugin build.

Clone with `git clone --recurse-submodules https://github.com/alkalines/DASS.git`,
or initialize an existing clone with `git submodule update --init --recursive`.
