# DASS — Discord Alternative ScreenShare

## Project

- DASS is a monorepo for a TypeScript Equicord plugin and a self-hosted Rust screensharing backend. Its goal is to replace Discord's screenshare transport while keeping ordinary Discord voice independent.
- Self-hosting aims to increase control and security and bypass restrictions tied to Discord's screensharing service. Do not promise that it bypasses OS capture permissions, firewalls or all local network restrictions.
- Broadcasters and viewers need DASS-compatible clients; stock Discord cannot receive DASS media. Never silently fall back to Discord sharing or upload DASS preview thumbnails there.
- Keep plugin, backend and shared protocol responsibilities separate. `crates/backend` contains the HTTP scaffold and experimental authenticated one-publisher/one-viewer Rust transport; `crates/protocol` owns discovery/signaling types. `plugins/dass` owns settings, session access, capture and publishing/watching controllers. User-confirmed LAN video/discovery/audio is recorded in the docs; the new Share-button publishing, account login, secure remembering and automatic LAN admission workflows still need runtime acceptance. Production readiness and E2EE are unavailable. Do not advertise readiness or invent interoperability evidence.
- The backend is one Rust executable in a Docker container. Do not introduce `Bun.serve`, Bun signaling, a TypeScript backend, or a separate control-plane service. Bun is only for TypeScript/client tooling; use Cargo for Rust, inside Docker.
- Rust/backend dependency resolution, formatting, linting, compilation and automated tests must run in Docker, not on the host. Do not work around unavailable Docker access with host Cargo. Bun/TypeScript, Equicord and Equibop client tooling may run locally. Give container commands and report blocked validation only for the backend when Docker is unavailable.
- Keep the Docker-generated `Cargo.lock` committed and use `--locked` for builds and tests. Do not regenerate it on routine runs; dependency updates must be intentional. Commit `bun.lock` when TypeScript packages exist. If an upstream checkout requires another package manager, report the incompatibility and ask before deviating from Bun.

## Rust backend and Docker workflow

- Run commands from the repository root. `Dockerfile` provides `tooling`, `builder` and non-root `runtime` build stages; `compose.yaml` provides only the local-only `backend` service. There is no tooling Compose service or separate development Compose file.
- For occasional source formatting or intentional dependency maintenance, build the existing stage with `docker build --target tooling -t dass-rust-tools .` and run Cargo with `docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo ...`. Only if `Cargo.lock` is missing, bootstrap with `cargo generate-lockfile` in that container. Otherwise use the committed lockfile and `--locked`; do not silently update dependencies during tests/builds.
- `docker compose build backend` checks formatting, runs Clippy with warnings denied, runs locked workspace tests and builds the locked release image. Run locally with `docker compose up -d backend`, or build/check/start in one command with `docker compose up -d --build backend`. See `docs/backend.md` for the full sequence and cleanup.
- Keep runtime images non-root, read-only, capability-free and resource-bounded. Publish local HTTP only on host loopback; do not expose this scaffold publicly. Production startup fails closed unless an explicit insecure-local-development flag is set; this flag is not a production TLS substitute.
- `/health/live` checks process liveness only. `/health/ready` must remain 503 until authenticated signaling and media are operational. `/v1/capabilities` must accurately report unavailable functionality. Bound HTTP request bodies, active handlers and request duration; these are not socket admission limits or complete rate limiting.
- Add `str0m` only with a pinned, reviewed crypto-provider choice and a tested single-owner media loop. Do not treat skeleton endpoints or a successful Docker build as an SFU implementation. Keep the Phase 0 interoperability gate in the plan.
- Do not modify Docker socket permissions, host groups or install a host toolchain automatically. Docker access/setup is the user's responsibility. Do not spawn subagents, push images or deploy without explicit authorization.

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
- LAN account login uses separate DASS usernames/passwords and fixed-cost Argon2id password hashes in bounded server configuration. Automatic UDP admission must bind candidate IPs to the observed authenticated WSS TCP peer, ignore forwarding/client IP claims, admit bounded exact endpoints per media session, and remove them with the owning RTC session. Do not expose a global client-controlled whitelist or imply this config edits host firewall rules. Remembered client passwords require explicit consent and OS-backed encryption with no plaintext fallback; ordinary plugin settings must never store them.
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
- `vendor/Equicord` is the shared upstream plugin-runtime submodule pinned to `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4` for standard Discord desktop and Equibop. Keep it unchanged; the Bun build adapter stages and adapts a separate `build/Equicord` checkout cloned from this submodule. Desktop injection is an explicit user installation step, not routine validation.
- Upstream Equibop uses Bun >=1.3.0; its test script runs lint/typecheck and its postinstall updates/compiles arRPC. Client tooling may run locally with the required native libraries (including `libglib2.0-dev` on Linux); do not install host packages automatically. Host build checks alone do not establish DASS runtime compatibility, and GUI capture tests still require real Equibop clients on the target OS.
- Local `bun test ./tests/plugin` passed with Bun 1.4.3. `bun scripts/build-plugin.mjs` is the validated Bun-only Equicord build adapter for revision `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`: it changes the local types dependency from `link:` to `file:` in a dedicated checkout and uses `tooling/equicord/bun.lock` with a frozen, script-free install. The lock is an intentional resolution, not an exact pnpm migration. Lint, full typecheck and desktop/Equibop bundle builds passed; GUI/plugin loading remains unverified. The user retained Bun-only; do not use pnpm or translate unvalidated upstream scripts. See `docs/plugin.md`.
- The E2EE media path is client-side: the insertable-stream transform worker is generated from `clients/spike/e2ee.ts` and must stay self-contained, because the worker scope cannot read module bindings. The staged plugin file is bundled with esbuild, which does not inline module constants; verify the generated worker source in an isolated scope before trusting a media-path change.
- Missing venmic/libvesktop may only warn during host builds. Verify real Wayland/X11 capture, audio selection, cleanup, native-action interception and absence of Discord media leakage; build success is not interoperability evidence.
- Test authorization failures, E2EE downgrade rejection and reconnection/node failure. Report untested compatibility/security behavior; make performance claims only from measured hardware/scenarios.
- Commit dependency lockfiles and review licenses/native requirements. Do not spawn subagents, change remotes, push or deploy without explicit user authorization.
