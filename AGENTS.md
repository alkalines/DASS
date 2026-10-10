# DASS — Discord Alternative ScreenShare

## Project

- DASS is a monorepo for a TypeScript Equicord plugin and a self-hosted Rust screensharing backend. Its goal is to replace Discord's screenshare transport while keeping ordinary Discord voice independent.
- Self-hosting aims to increase control and security and bypass restrictions tied to Discord's screensharing service. Do not promise that it bypasses OS capture permissions, firewalls or all local network restrictions.
- Broadcasters and viewers need DASS-compatible clients; stock Discord cannot receive DASS media. Never silently fall back to Discord sharing or upload DASS preview thumbnails there.
- Keep plugin, backend and shared protocol responsibilities separate. The repository currently contains documentation and the upstream host submodule, not implemented DASS runtime packages; do not invent existing paths or verification commands.
- Use Bun, not npm or pnpm, for DASS TypeScript dependency management, scripts, tests and build tooling. Commit `bun.lock`; keep Rust tooling on Cargo. If an upstream checkout requires another package manager, report the incompatibility and ask before deviating from Bun.

## Equicord, Equibop and plugins

- For plugin implementation, debugging or installation, load the `equicord-plugin` skill in `.agents/skills/equicord-plugin/SKILL.md`.
- [Equicord](https://github.com/Equicord/Equicord) is a fork of Vencord, a Discord client modification. It supplies the plugin runtime, settings, UI APIs and patches to Discord's webpack modules.
- [Equibop](https://github.com/Equicord/Equibop) is a standalone Electron Discord client forked from Vesktop, with Equicord preinstalled and its own screen/audio capture integration. It uses Equicord plugins, not a separate Equibop plugin format.
- Plugins export `definePlugin({ name, description, authors, ... })` from `index.ts` or `index.tsx`; keep the literal `name` first because upstream build discovery parses it. Use `start`/`stop` for lifecycle ownership and cleanup; module patches normally require a restart.
- Custom plugins are build inputs, not loose files installed into a running client. Stage DASS in an explicit Equicord checkout at `src/userplugins/dass`, then build Equicord from source. Rebuild after plugin changes; never download executable plugin code at runtime.
- For the external Equicord checkout, validate Bun compatibility against the pinned manifest, lockfile and scripts before documenting installation/build commands; do not blindly translate upstream npm/pnpm commands or claim an untested Bun build works. Normal Discord desktop requires installing/injecting the custom build. For Equibop, select the checkout's `dist` directory as its custom Equicord location: the host looks for `equibop/main.js` beneath the selected directory. Do not inject into Equibop as if it were official Discord.
- Equicord's current build produces both `dist/desktop` and `dist/equibop`. Pin and verify upstream revisions before relying on build commands or private hooks; record the Discord build used for compatibility tests.
- Import host React/hooks from `@webpack/common` and use Equicord APIs. Do not bundle another React/Electron runtime; keep private Discord hooks isolated in an adapter and fail visibly when patches no longer match.

## Screenshare integration and client limits

- Integrate/patch DASS at Equibop's existing screenshare path, preserving its source picker and consent; intercept the chosen Discord share action before native stream creation. Do not replace capture with a parallel helper pipeline or globally patch unrelated peer connections.
- In `vendor/Equibop`, `src/main/screenShare.ts` registers Electron's display-media handler and invokes the picker; `src/renderer/components/ScreenSharePicker.tsx` owns source/quality/audio selection. `src/renderer/patches/screenShareFixes.ts` wraps `getDisplayMedia` on Linux, applies constraints and attaches venmic audio. Call the installed capture function, not an unpatched copy.
- Reuse existing in-process venmic integration (`src/main/venmic.ts`) and Chromium WebRTC encoding/decoding. DASS must not spawn any additional client child process, daemon, executable, local proxy, external encoder/decoder, FFmpeg or GStreamer. Existing Electron processes and OS PipeWire/portal services are host prerequisites, not DASS helpers.
- Share audio is explicit and optional; never capture the microphone implicitly. Preserve visible capture state and stop tracks on stop, source end, logout, disable or context exit; cancellation and repeated teardown must be safe.
- Prefer a single Rust backend with a packet-forwarding SFU: no decoding/transcoding. Keep media packets out of control-plane JSON and Electron IPC; bound queues, caches, payloads and session counts, with one owner per RTC state.

## Security

- Never extract or transmit Discord user tokens. Use separate DASS credentials and authenticated, scoped publish/subscribe permissions; client-provided Discord identity/channel claims are not authorization.
- Require TLS/WSS and DTLS-SRTP outside explicit local development. Transport encryption terminates at the SFU and is not E2EE; required E2EE must fail closed without downgrade.
- Use reviewed encryption implementations and test vectors, authenticated key distribution, rekeying and replay protection. For server-untrusted E2EE, media keys must never reach the backend.
- Never log credentials, keys, full SDP, captured frames or sensitive identifiers. Restrict unsafe server-side ICE destinations and never operate an open TURN relay.

## Documentation and naming

- Write documentation in English using DASS's full name on first introduction. Separate intended behavior from verified behavior; document supported Equicord/Equibop/Discord revisions, prerequisites, exact working-directory-specific commands and known limitations.
- Keep installation instructions explicit about building custom Equicord plugins and selecting the build in Equibop. Distinguish development/build tooling from client runtime requirements; never imply users need a DASS helper executable.
- TypeScript: descriptive `camelCase` variables/functions, `PascalCase` types/components and `UPPER_SNAKE_CASE` constants. Rust: `snake_case` variables/functions/modules, `PascalCase` types/traits/variants and `UPPER_SNAKE_CASE` constants/statics.
- Use domain-specific names such as publisher, subscriber, room and capture track; distinguish Discord identifiers from DASS identifiers and include units in duration/size names. Keep wire-field names stable across Rust/TypeScript via explicit serialization mappings and generated protocol types.

## Checkout and validation

- `vendor/Equibop` is an upstream submodule pinned to `27219be3566589280c0c933b04753805381d3bc8`; initialize with `git submodule update --init --recursive`. Do not advance its pin or treat it as DASS-owned plugin source incidentally.
- Host-only checks, from `vendor/Equibop`: `bun install` (Bun >=1.3.0; postinstall updates/compiles arRPC), `bun run test` (lint then typecheck), `bun run build`, `bun run build --dev`. Linux CI installs `libglib2.0-dev`; these checks do not validate DASS.
- Missing venmic/libvesktop may only warn during host builds. Verify real Wayland/X11 capture, audio selection, cleanup, native-action interception and absence of Discord media leakage; build success is not interoperability evidence.
- Test authorization failures, E2EE downgrade rejection and reconnection/node failure. Report untested compatibility/security behavior; make performance claims only from measured hardware/scenarios.
- Commit dependency lockfiles and review licenses/native requirements. Do not spawn subagents, change remotes, push or deploy without explicit user authorization.
