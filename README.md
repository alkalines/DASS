# DASS — Discord Alternative ScreenShare

Early-stage project for an Equicord plugin and self-hosted Rust screensharing backend.

- [Research and implementation plan](docs/research/PLAN.md)
- [Security roadmap and acceptance gates](docs/research/SECURITY-ROADMAP.md)
- [Pilot/public release gates, provenance and incident response](docs/security-release.md)
- [Private vulnerability reporting and security policy](SECURITY.md)
- [Contributor and agent instructions](AGENTS.md)
- [Docker-only backend development](docs/backend.md)
- [Public Internet transport, admission model and resource budget](docs/public-transport.md)
- [Build and install the plugin in Equicord or Equibop](docs/plugin.md)
- [GitHub Releases, GHCR images and update notices](docs/releasing.md)
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
The new E2EE client code uses an unreviewed project-specific format: Internet
pilot/public hosting and server-untrusted confidentiality claims remain blocked.
Readiness remains 503. Native Discord watching is separate.
Supported build-634304 Share buttons now connect to the DASS publisher by default,
with reusable in-memory session access. This new wiring still needs live-client
acceptance; it does not intercept every Discord share entry point.
Separate DASS accounts are configured in plugin settings with OS-backed encryption
and authenticate on plugin load. LAN media endpoints are then admitted per RTC
session using the observed WSS peer IP, without manual client-port updates.
These new account/admission paths still require live-client/backend acceptance.
There is no separate DASS call button or sharing modal. Call context is derived
from the current channel; rooms are informational and publisher approval controls
stream admission. Diagnostics and the
temporary viewer are hidden behind Advanced options. Native stream tiles and
watch/player integration remain incomplete; this is not yet a drop-in replacement.

## Installation

Both broadcasters and viewers need a DASS-enabled client and access to a compatible
DASS backend. Stock Discord cannot receive DASS media. This is experimental software;
the instructions below do not establish production readiness or capture compatibility.

### Install a prebuilt client bundle

1. Open [GitHub Releases](https://github.com/alkalines/DASS/releases) and choose a
   full release containing `dass-equicord-VERSION.zip`. Backend-only releases do not
   contain a client bundle. If no bundle has been published, use the source steps below.
2. Download the ZIP and `SHA256SUMS`, verify the ZIP's checksum, and extract it to a
   permanent directory you control. Keep the complete extracted `dist` folder.
3. **Equibop:** open **Settings → Developer Options**, change the custom Equicord
   location, and select the extracted **`dist` directory**, not `dist/equibop`.
4. Fully quit Equibop, including its tray process, restart it, and enable **DASS**
   under **Equicord → Plugins**.

**Publishing limitation:** the ZIP contains custom Equicord, not a modified Equibop
application. Current publishing also requires the matching
[Equibop host capture bridge](docs/capture-bridge.md); selecting the bundle in
stock Equibop alone is insufficient. Do not inject Equicord into Equibop as if it
were official Discord.

**Discord Desktop:** a custom desktop bundle must be installed/injected using
Equicord's installer mechanism; loose plugin files cannot be installed directly.
The release ZIP does not include a turnkey desktop installer. Use the source
installation below for the documented installer entry point. The desktop bundle
does not currently provide an equivalent supported publishing capture adapter.

### Build and install the client from source

Prerequisites: Git, **Bun 1.4.3**, and **Node.js >=22**. Client tooling runs locally;
no host Rust toolchain or additional DASS capture executable is required.

```sh
git clone --recurse-submodules https://github.com/alkalines/DASS.git
cd DASS
bun scripts/build-plugin.mjs
```

The build adapter stages DASS in a separate pinned Equicord checkout, installs
locked dependencies, runs lint/typecheck, and builds both client targets. For an
existing clone, run `git submodule update --init --recursive` from its root first.

- **Equibop:** follow the selection/restart steps above, using the absolute
  `build/Equicord/dist` directory printed by the build. Publishing still requires
  the separate [host capture bridge build](docs/capture-bridge.md).
- **Discord Desktop:** fully quit Discord, including its tray process. Review the
  upstream Equilotl installer before proceeding: the following explicit installation
  command downloads and runs it and modifies your selected Discord installation.
  From the **DASS repository root**:

  ```sh
  cd build/Equicord
  bun run inject
  ```

  Select the intended Discord installation when prompted, restart Discord, and
  enable **DASS** in **Equicord → Plugins**. This installer path is source-inspected,
  not runtime-verified here. Keep `build/Equicord` on disk.

See [the plugin guide](docs/plugin.md) for pinned revisions, host prerequisites and
compatibility limits. Rebuild from the repository root after source changes and
fully restart the client.

### Install the backend

Prerequisites: **Docker Engine with Compose >=2.30** and permission to use its
daemon. No host Rust, Cargo or Bun is required to run the backend.

1. Clone this repository and enter its root, or use the clone created above:

   ```sh
   git clone https://github.com/alkalines/DASS.git
   cd DASS
   cp .env.example .env
   ```

2. Review `.env` and follow [LAN account setup](docs/lan-accounts.md) for your server
   IP, TLS, accounts and media configuration. Defaults provide loopback-only
   setup/discovery, **not a working media server**. Never expose insecure setup or
   default administrator credentials publicly.
3. To use a published **linux/amd64** image, create `compose.image.yaml` beside
   `compose.yaml`. Replace `0.1.0` with an actually published version:

   ```yaml
   services:
     backend:
       image: ghcr.io/alkalines/dass:0.1.0
   ```

   From the **DASS repository root**:

   ```sh
   docker compose -f compose.yaml -f compose.image.yaml pull backend
   docker compose -f compose.yaml -f compose.image.yaml up -d --no-build backend
   ```

   Alternatively, build and start from source, with all Rust checks inside Docker:

   ```sh
   docker compose up -d --build backend
   ```

4. Complete private account-mode setup through the
   [control panel](docs/control-panel.md). New account-mode databases without
   imported administrators start with `admin` / `admin`; change that password
   immediately. Accounts and settings persist in the SQLite Docker volume. Saved
   backend configuration changes require a restart; do not delete the volume when
   updating. See [migration and provisioning](docs/sqlite.md).

The Compose configuration retains loopback binding, a read-only root filesystem,
dropped capabilities and resource limits. Publishing an image does not configure
safe public hosting. See [backend development](docs/backend.md),
[public transport limitations](docs/public-transport.md) and
[manual updates/image digest pinning](docs/releasing.md).

### Connect the client

Open **Equicord → Plugins → DASS settings**, enter the trusted backend's HTTPS
origin, and sign in with your separate **DASS account**, not your Discord password
or token. Remembering a password requires explicit consent and OS-backed secure
storage. Join a Discord call, then follow the
[Share-button and account workflow](docs/session-workflow.md). Required host support
or authentication failures do not silently fall back to Discord sharing.

### Updates

Versioned builds can show **DASS update available** with a manual download link;
the authenticated backend admin panel also reports newer backend releases. Nothing
is installed or deployed automatically. Fully quit the client before replacing
its bundle. Custom Equicord's upstream updater is disabled to preserve DASS; review
[release and update instructions](docs/releasing.md) before upgrading the backend
or modified Equibop host.

## Upstream checkouts

`vendor/Equibop` is an upstream Git submodule pinned to the commit used for the
research. It provides the host application source, not the Equicord plugin build.
`vendor/Equicord` is pinned to `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`
and provides the shared plugin runtime for standard Discord desktop and Equibop.
The build adapter uses a separate `build/Equicord` checkout so dependency
adaptations and staged DASS source do not modify the upstream submodule.

Clone with `git clone --recurse-submodules https://github.com/alkalines/DASS.git`,
or initialize an existing clone with `git submodule update --init --recursive`.
