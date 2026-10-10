# DASS — Discord Alternative ScreenShare

Early-stage project for an Equicord plugin and self-hosted Rust screensharing backend.

- [Research and implementation plan](docs/research/PLAN.md)
- [Contributor and agent instructions](AGENTS.md)
- [Docker-only backend development](docs/backend.md)
- [Build and install the plugin scaffold in Equicord or Equibop](docs/plugin.md)

The proposed architecture uses Equibop's existing capture pipeline and a Rust
WebRTC selective forwarding backend, without additional client helper executables.
Both broadcasters and viewers need DASS. The Rust backend currently provides
local-development health and capability endpoints only. The initial plugin has
settings and explicit capability discovery, but authentication, capture integration,
WebRTC forwarding and E2EE are not implemented. Native Discord sharing is unchanged.

The backend is built, tested and run using Docker, with no host Rust installation.
Follow the backend guide to generate `Cargo.lock`, run checks and start the container.
Bun is used for TypeScript plugin tests and Equibop build tooling, not the server.
Client tooling can run locally; only backend/Rust tooling is Docker-only.

To build Equicord with DASS, run `bun scripts/build-plugin.mjs` from this repository
root (Bun 1.4.2, Node >=22 and Git required). In Equibop's Developer Options, select
the printed `build/Equicord/dist` directory, fully restart, then enable **DASS** in
Equicord's Plugins settings. Starting Equibop alone uses a bundle without DASS.
For standard Discord desktop with Equicord, install the custom desktop bundle
using the separate installation steps in [the plugin guide](docs/plugin.md).

## Upstream checkouts

`vendor/Equibop` is an upstream Git submodule pinned to the commit used for the
research. It provides the host application source, not the Equicord plugin build.
`vendor/Equicord` is pinned to `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`
and provides the shared plugin runtime for standard Discord desktop and Equibop.
The build adapter uses a separate `build/Equicord` checkout so dependency
adaptations and staged DASS source do not modify the upstream submodule.

Clone with `git clone --recurse-submodules https://github.com/alkalines/DASS.git`,
or initialize an existing clone with `git submodule update --init --recursive`.
