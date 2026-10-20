# DASS — Discord Alternative ScreenShare

Early-stage project for an Equicord plugin and self-hosted Rust screensharing backend.

- [Research and implementation plan](docs/research/PLAN.md)
- [Security roadmap and acceptance gates](docs/research/SECURITY-ROADMAP.md)
- [Contributor and agent instructions](AGENTS.md)
- [Docker-only backend development](docs/backend.md)
- [Public Internet transport, admission model and resource budget](docs/public-transport.md)
- [Build and install the plugin in Equicord or Equibop](docs/plugin.md)
- [Session setup and Share-button DASS workflow](docs/session-workflow.md)
- [LAN accounts and automatic client UDP admission](docs/lan-accounts.md)
- [Optional Users / Rooms / Streams control panel](docs/control-panel.md)
- [Capture consent, teardown and client privacy](docs/capture-consent.md)
- [Experimental authenticated directory and DASS viewer](docs/watching.md)

The proposed architecture uses Equibop's existing capture pipeline and a Rust
WebRTC selective forwarding backend, without additional client helper executables.
Both broadcasters and viewers need DASS. An opt-in, invite/account-authenticated
one-publisher/one-viewer Rust transport has user-reported LAN video evidence.
The authenticated directory and DASS-owned viewer now have user-reported discovery
and audio playback evidence. Audio consent and backend checks are also
user-confirmed; broader runtime acceptance remains pending. This is not a production SFU;
E2EE is unavailable and readiness remains 503. Native Discord watching is separate.
Supported build-634304 Share buttons now connect to the DASS publisher by default,
with reusable in-memory session access. This new wiring still needs live-client
acceptance; it does not intercept every Discord share entry point.
Separate DASS accounts are configured in plugin settings with OS-backed encryption
and authenticate on plugin load. LAN media endpoints are then admitted per RTC
session using the observed WSS peer IP, without manual client-port updates.
These new account/admission paths still require live-client/backend acceptance.
There is no separate DASS call button or sharing modal. Call context is derived
from the current channel; backend grants must authorize it. Diagnostics and the
temporary viewer are hidden behind Advanced options. Native stream tiles and
watch/player integration remain incomplete; this is not yet a drop-in replacement.

The backend is built, tested and run using Docker, with no host Rust installation.
Follow the backend guide to generate `Cargo.lock`, run checks and start the container.
Bun is used for TypeScript plugin tests and Equibop build tooling, not the server.
Client tooling can run locally; only backend/Rust tooling is Docker-only.

There is one Compose file: `compose.yaml`. For LAN settings, copy `.env.example`
to `.env` and set your server IP. **Users are configured in
`.secrets/accounts/users.json`**, generated with the Docker `create-user` command,
then loaded through the private `.secrets/backend.env` file. See the exact
[account setup commands](docs/lan-accounts.md#generate-the-hash-without-exposing-the-password).
No `.env` or secrets means loopback-only discovery, not a working media server.
The optional [control panel](docs/control-panel.md) uses separate HTTP Basic admin
credentials and persists user/room edits in a Docker volume. With it enabled,
environment users are only the initial seed; the persisted policy takes precedence.

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
