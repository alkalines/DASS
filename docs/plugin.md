# DASS plugin scaffold

Discord Alternative ScreenShare (DASS) now has a build-time Equicord userplugin
in `plugins/dass`. This is **not working screensharing**. It provides backend URL
settings, an explicit discovery button, visible status and cancellation on disable,
logout, settings changes or a newer check. No background requests are made.

It sends no credentials, rejects redirects, requires HTTPS except for explicitly
enabled loopback HTTP, and bounds discovery to 5 seconds and 16 KiB. Only the
version-1 scaffold contract is accepted. Discovery is not authentication or an
authorization to capture. There is no production transport or E2EE to configure.

Native Discord sharing is **unchanged**: choosing it still shares through Discord.
DASS has no capture button or native replacement toggle, and sends no frames or
thumbnails. Stock Discord cannot receive future DASS media.

## Verified builds and remaining limitations

- Equicord: `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4` (1.15.11.0), built
  with DASS in `build/Equicord` using local Bun 1.4.2 and Node 24.18.0 on Linux.
- Equibop: submodule `27219be3566589280c0c933b04753805381d3bc8` (3.3.1).
- Discord build: not tested or recorded; runtime compatibility is unverified.
- All 13 plugin tests passed (41 assertions). DASS lint, full Equicord typecheck,
  and desktop/Equibop-target bundle builds passed. The Equibop renderer was checked
  for DASS inclusion. Equibop host builds and GUI/plugin loading were not verified
  by the agent; the user has launched the Equibop host.
- Docker daemon access was denied; Rust/backend validation remains blocked.
- Equicord declares Node >=22 and `pnpm@12.8.1`. Its build/test scripts reference
  pnpm, its workspace uses pnpm policy, and its committed lockfile is not a Bun
  lockfile. Bun's automatic migration failed on the relative `link:` dependency.
  The tested DASS build adapter changes only `@vencord/discord-types` from
  `link:packages/discord-types` to `file:packages/discord-types` in the dedicated
  checkout. `tooling/equicord/bun.lock` records an intentional resolution from
  upstream's manifest ranges, not an exact migration of pnpm's dependency graph.
  Subsequent installs use that lock with `--frozen-lockfile --ignore-scripts`.
  The original pnpm lockfile stays untouched. No pnpm command is run. Only the
  selected lint/typecheck/build scripts are validated, not all upstream scripts.
- Author attribution is intentionally pending with approval: `authors: []` avoids
  fabricating Discord IDs. Add a confirmed maintainer name/ID before distribution.

## Local plugin checks; Docker-only backend checks

Run plugin tests locally from the **DASS repository root**:

```sh
bun test ./tests/plugin
```

Only Rust/backend checks require Docker. After configuring Docker access, from
the **DASS repository root**:

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker compose build tooling
docker compose run --rm tooling cargo fmt --all -- --check
docker compose run --rm tooling cargo test --workspace --locked
```

The Rust commands remain unverified in this session. The Bun tests use built-in
`bun:test`, with no DASS package manifest or dependency resolution needed. There is
no root DASS package manifest. The Equicord build snapshot has a committed Bun lock
in `tooling/equicord`; Equibop retains its upstream `bun.lock`. The Rust test checks the discovery fixture
against the actual serialized protocol so frontend validation cannot silently drift.
Scaffold tests do not typecheck the host-facing plugin or establish interoperability.

## Build and install DASS in Equibop

Launching `vendor/Equibop` alone uses its default Equicord bundle, which does
**not** contain DASS. You must build the plugin into a custom Equicord bundle and
select it in Equibop. From the **DASS repository root**, with Bun 1.4.2, Node >=22
and Git available locally:

```sh
bun scripts/build-plugin.mjs
```

This clones a dedicated checkout on first use, verifies the pin, adapts the local
types dependency, stages `plugins/dass` under `src/userplugins/dass`, installs the
locked dependencies, runs lint/typecheck, and builds both targets. It refuses
unfamiliar manifest, lockfile and staged-source edits rather than overwriting them.
Edit `plugins/dass`, not the staged copy, and rerun this command to rebuild.

1. In Equibop settings, open **Developer Options** and click **Change** next to
   the Equicord location.
2. Select the absolute `build/Equicord/dist` path printed by the build command.
   Do **not** select `dist/equibop` or the plugin source directory.
3. Fully quit Equibop (including its tray process), then restart it.
4. Open **Equicord → Plugins**, search for **DASS**, and enable it. Open the
   plugin's settings for backend discovery.

The build disables Equicord's updater so an upstream update cannot replace the
custom bundle and remove DASS. Updates require an intentional pin/lock review and
rebuild. Do not use Discord injection for Equibop.

## Build and run the Equibop host on Linux

This sequence builds **the host only**, not the DASS-equipped Equicord bundle. It
is source-inspected but untested by the agent. Build and select the custom bundle
above to include DASS. Bun/client tooling runs locally, not in
Docker. Prerequisites are Bun >=1.3.0, a desktop session, Electron's Linux runtime
dependencies, and any native build prerequisites (including `libglib2.0-dev` when
building libvesktop from source). Do not install host packages automatically.
From the **DASS repository root**:

```sh
git submodule update --init --recursive
cd vendor/Equibop
bun install --frozen-lockfile
bun run test
bun run package:dir
./dist/linux-unpacked/equibop
```

Alternatively, after installing dependencies, `bun run start` builds and launches
Equibop directly from this same working directory without packaging.
Do not disable Electron's sandbox to work around launch failures. Dependency
installation runs upstream's postinstall (arRPC DB update/compilation); review any
resulting submodule changes. Missing venmic/libvesktop warnings do not verify audio
or capture. No extra DASS client process is introduced.

The host appends `equibop` to the selected directory and expects `equibop/main.js`.
An existing installed Equibop can select the custom build without rebuilding the
host. Keep the custom bundle on disk; do not delete `build/Equicord/dist` afterward.

For backend development, follow [backend.md](backend.md). Set the plugin URL to
`http://127.0.0.1:8080` and explicitly enable local development to attempt discovery.
Renderer fetch remains subject to CSP, CORS, mixed-content and local-network policy;
the current HTTP scaffold does not provide a verified cross-origin integration.
A failed check must remain visible. Do not disable browser security or expose the
local scaffold publicly to make discovery work.

## Next integration gate

Private Discord hooks must live in a guarded adapter, with tested interception
**before** native stream creation. No hook is installed by this scaffold. Source
inspection alone cannot establish a safe hook against a live Discord build.

Reuse Equibop's installed capture function and its existing picker/consent. The
pinned Linux wrapper attaches venmic audio when its virtual device exists, and
the picker currently ties audio unmute/cleanup to native `STREAM_UPDATE` and
`STREAM_CLOSE`. DASS cannot rely on those events without native stream creation.
Explicit audio selection and independent teardown therefore need a narrow,
reviewed host integration before enabling DASS capture. An Equicord webpack patch
cannot rewrite Equibop's bundled renderer. The upstream submodule is unchanged.

Release gates remain real Wayland/X11 picker cancellation, optional audio,
disable/logout/context-exit cleanup, independent Discord voice, no Discord
media/thumbnail leakage, authenticated publish/subscribe, required-E2EE rejection,
and the Phase 0 media interoperability tests in the implementation plan.
