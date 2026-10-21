# DASS — Discord Alternative ScreenShare

Self-hosted screensharing for Discord, built as an Equicord plugin with a Rust backend.
Discord still handles your voice call; DASS handles the screen and optional share audio.

[![Release](https://img.shields.io/github/v/release/alkalines/DASS)](https://github.com/alkalines/DASS/releases)
[![Downloads](https://img.shields.io/github/downloads/alkalines/DASS/total)](https://github.com/alkalines/DASS/releases)
[![Status: experimental](https://img.shields.io/badge/status-experimental-orange)](#current-status)
[![Pterodactyl Egg: coming soon](https://img.shields.io/badge/Pterodactyl_Egg-coming_soon-5865F2)](#host-a-backend)

[Download](https://github.com/alkalines/DASS/releases) · [Setup guide](docs/session-workflow.md) · [Report a bug](https://github.com/alkalines/DASS/issues) · [Security](SECURITY.md)

## What you need

- A DASS-enabled client **on both ends**. Stock Discord cannot receive DASS streams.
- A compatible self-hosted backend and a separate DASS account.
- **Equibop for publishing** through its existing screen picker. No extra capture executable or modified Equibop build is needed.

## Current status

E2EE and Public Hosting is still untested, use it at your own risk.

## Install the client

Get `dass-equicord-VERSION.zip` and `SHA256SUMS` from a
[full release](https://github.com/alkalines/DASS/releases), verify the ZIP's checksum,
and extract it somewhere permanent. Keep the entire `dist` folder. Backend-only
releases do not include the client; if no client bundle is available, build below.

<details>
<summary><strong>Equibop</strong> — recommended for publishing</summary>

1. Open **Settings → Developer Options** in Equibop.
2. Set the custom Equicord location to the extracted **`dist` directory**, not `dist/equibop`.
3. Fully quit Equibop, including its tray process, then restart.
4. Enable **DASS** under **Equicord → Plugins**.

Keep your standard Equibop installation. Do **not** inject Equicord into it as
though it were Discord Desktop. Older DASS bundles may require the former host
bridge; build from current source for the plugin-owned capture adapter. Real-client
acceptance of that adapter is still pending.

[Client guide](docs/plugin.md) · [Capture details](docs/capture-bridge.md)

</details>

<details>
<summary><strong>Discord Desktop</strong> — custom Equicord installation</summary>

DASS must be built into Equicord and installed into Discord; copying loose plugin
files will not work. The release ZIP does not include a turnkey desktop installer.
Build from source using the section below, then fully quit Discord, including its
tray process.

Review the upstream Equilotl installer first: this command downloads and runs it,
and modifies the Discord installation you select. From the **DASS repository root**:

```sh
cd build/Equicord
bun run inject
```

Restart Discord and enable **DASS** under **Equicord → Plugins**. Keep
`build/Equicord` on disk. This installer path is source-inspected, not runtime-verified.
The desktop bundle does **not** currently have an equivalent supported publishing
capture adapter.

[Installation details and compatibility limits](docs/plugin.md)

</details>

<details>
<summary><strong>Build from source</strong></summary>

Requires Git, **Bun 1.4.3** and **Node.js ≥22**. No host Rust toolchain is needed.

```sh
git clone --recurse-submodules https://github.com/alkalines/DASS.git
cd DASS
bun scripts/build-plugin.mjs
```

For an existing clone, run `git submodule update --init --recursive` from the
repository root first. The build uses a separate pinned Equicord checkout and
runs lint, typechecking and both client builds without modifying the upstream
submodules.

For Equibop, select the absolute **`build/Equicord/dist`** path printed by the
build. For Discord Desktop, use the installation section above. Rebuild after
source changes and fully restart your client.

[Build prerequisites and pinned revisions](docs/plugin.md)

</details>

## Host a backend

The backend is a single Rust executable in Docker. Start with the
[LAN account setup guide](docs/lan-accounts.md) for TLS, accounts and media
configuration. Compose defaults are loopback-only setup/discovery, **not a working
media server**.

For Pterodactyl, see the [custom image build and configuration guide](docs/pterodactyl.md).
An importable egg and real Wings runtime validation are still pending.

<details>
<summary><strong>Docker Compose</strong></summary>

Requires **Docker Engine with Compose ≥2.30** and access to its daemon. No host
Rust, Cargo or Bun is needed for the backend.

```sh
git clone https://github.com/alkalines/DASS.git
cd DASS
cp .env.example .env
```

If you already cloned the repository, use that checkout instead. Review `.env`
and complete the [server configuration](docs/lan-accounts.md), then run from the
repository root:

```sh
docker compose up -d --build backend
```

This builds, checks and tests Rust inside Docker. **No local build is needed** if
you use `ghcr.io/alkalines/dass:latest`: replace the backend's `build:` block in
`compose.yaml` with `image:` (keep the other settings, ports and volumes):

```yaml
services:
  backend:
    image: ghcr.io/alkalines/dass:latest
    # Keep the remaining backend configuration from compose.yaml.
```

Then start or update it with:

```sh
docker compose pull backend
docker compose up -d --no-build backend
```

`latest` tracks published backend releases; updates are manual. Back up the SQLite
volume first. For exact version/digest pins, see the [GHCR image instructions](docs/releasing.md).

Complete initial setup through the [control panel](docs/control-panel.md) on a
private connection. New account-mode databases without imported administrators
start with **`admin` / `admin`**; change that password immediately. Never expose
insecure setup or default credentials publicly.

Accounts and settings persist in the SQLite volume. Saved backend configuration
changes require a restart; keep the volume when updating.

[Backend guide](docs/backend.md) · [Storage and migration](docs/sqlite.md) · [Transport limits](docs/public-transport.md)

</details>

<details>
<summary><strong>Pterodactyl Egg</strong> — coming soon</summary>

A Pterodactyl Egg for hosting the DASS backend is planned. It is not available yet;
use Docker Compose for now. This will be another installation option, not a change
to DASS's experimental status or public-hosting limitations.

</details>

## Connect and share

Open **Equicord → Plugins → DASS settings**, enter your trusted backend's HTTPS
origin, and sign in with your **DASS account — never your Discord password or
token**. Remembering a password is opt-in and requires OS-backed secure storage.

Join a Discord call and use the supported Share button. DASS reuses Equibop's
source picker and keeps share audio optional. Authentication or capture failures
do not silently fall back to Discord sharing.

[Share and watch walkthrough](docs/session-workflow.md)

## Documentation

| | Guides |
| --- | --- |
| Client | [Build & install](docs/plugin.md) · [Sharing](docs/session-workflow.md) · [Watching](docs/watching.md) |
| Server | [LAN accounts](docs/lan-accounts.md) · [Control panel](docs/control-panel.md) · [Docker development](docs/backend.md) |
| Updates | [Releases, images & manual updates](docs/releasing.md) — no automatic installation or deployment |
| Security | [Capture & privacy](docs/capture-consent.md) · [Public transport](docs/public-transport.md) · [Report a vulnerability](SECURITY.md) |
| Development | [Plan](docs/research/PLAN.md) · [Security roadmap](docs/research/SECURITY-ROADMAP.md) · [Contributor instructions](AGENTS.md) |
