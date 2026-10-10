# DASS — Discord Alternative ScreenShare

Planning-stage project for an Equicord plugin and self-hosted screensharing backend.

- [Research and implementation plan](docs/research/PLAN.md)
- [Contributor and agent instructions](AGENTS.md)

The proposed architecture uses Equibop's existing capture pipeline and a Rust
WebRTC selective forwarding backend, without additional client helper executables.
Both broadcasters and viewers need DASS. No plugin or backend is implemented yet.

## Equibop checkout

`vendor/Equibop` is an upstream Git submodule pinned to the commit used for the
research. It provides the host application source, not the Equicord plugin build.

Clone with `git clone --recurse-submodules https://github.com/alkalines/DASS.git`,
or initialize an existing clone with `git submodule update --init --recursive`.
