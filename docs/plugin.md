# DASS plugin

Discord Alternative ScreenShare (DASS) now has a build-time Equicord userplugin
in `plugins/dass`. It now includes an experimental authenticated directory and
DASS-owned viewer; see [watching.md](watching.md) for the current behavior,
supervised LAN procedure and unverified exit condition. The earlier manual
transport has user-reported LAN video evidence, not a completed transport gate.
The capability checker described below is still a separate scaffold-only check.

The current [session and Share-button workflow](session-workflow.md) and
[LAN account setup](lan-accounts.md) replace the manual publishing/refusal path
below. Accounts can be remembered with OS-backed encryption and authenticate
on plugin load; LAN client endpoints are admitted per session automatically.
Supported Share buttons start DASS by default. The older sections document the
development history, not the current normal workflow.

The capability checker sends no credentials, rejects redirects, requires HTTPS except for explicitly
enabled loopback HTTP, and bounds discovery to 5 seconds and 16 KiB. Only the
version-1 scaffold contract is accepted. Discovery is not authentication or an
authorization to capture. There is no production transport or E2EE to configure.

**Historical chooser-only behavior:** On Discord stable build **634304**, the center voice tray and left Voice Connected
panel share buttons now declare an explicit Discord/DASS chooser before their
native start callbacks. The center chooser/refusal is user-observed; the new left
panel patch is not yet runtime-verified. DASS only
shows “DASS transport unavailable.”; choosing Discord still shares through
Discord. Other share entry points remain native and unmodified. Complete
runtime coverage, voice independence and absence of native media/thumbnail leakage
are **not yet verified**. Stock Discord cannot receive future DASS media.

## Publish, watch and detection boundary

**Historical routing/chooser snapshot:** the description below predates the
authenticated watch transport. `WatchController` now supplies `subscribe` and
`listShares` through authenticated WSS and routes DASS-owned watch buttons to the
viewer. `setDassRoom` alone does not authorize a binding. Routing `preparePublish`
still refuses; the separate manual publisher panel remains the publishing path.
Current directory/viewer checks and limitations are recorded in [watching.md](watching.md).

The initial routing implementation is in `plugins/dass/routing.ts`, with the
action boundary isolated in `plugins/dass/discordAdapter.ts`. These are tested
contracts, **not a working server connection**. Narrow center-tray and
Voice Connected panel UI patches are declared separately; see
[discord-hooks.md](discord-hooks.md). The
plugin intentionally supplies no transport, so all DASS operations are refused
before capture. The capability checker does not enable media.

The intended interception sequence is:

1. A verified hook identifies an explicitly selected DASS publish/watch action.
   It calls `routePublish` or `routeWatch` **before** Discord creates a native
   stream, uploads previews or starts a native subscription. `handled: true` is
   synchronous: the caller must return immediately and never run the original
   action, including when `completion` reports failure. Explicit Discord actions
   return `handled: false`; no automatic fallback is allowed.
2. The context adapter binds an independently authenticated DASS room using
   `setDassRoom`, and clears it on voice-context exit. Discord channel/user IDs
   are not DASS authorization. Pending operations and owned media are cancelled
   on room changes, plugin disable, logout and configuration changes.
3. A future Rust-backed transport implements `preparePublish`, `subscribe` and
   `listShares`. Each must authenticate and authorize its scoped operation, use
   TLS/WSS outside explicit loopback development, and enforce required E2EE
   without downgrade. `preparePublish` must reject before capture if those
   prerequisites fail. These interface requirements are **not implemented or
   cryptographically tested** by the routing layer.
4. The development-only [host capture bridge](capture-bridge.md) invokes the **currently installed** native
   capture function, retaining the existing picker, source selection, quality
   and consent. It returns a `CaptureLease` containing explicit `audioSelected`
   and an idempotent `release()` for host audio/capture cleanup. It must clean up
   partial capture on rejection and handle cancellation while a picker is open.
   Unselected audio is stopped/removed before publishing as a final safeguard;
    this does not replace preventing unwanted audio capture in the host bridge.
     The staged wrapper fix prevents unselected virtual-audio acquisition and
     stops partial/replaced tracks. GUI acceptance remains outstanding.
5. Watching returns a DASS-owned media stream for a future player adapter.
   Detection reads the authenticated DASS room directory, not Discord stream
   events or invented native stream records. Stock Discord shares remain a
   separate transport. No synthetic Discord `STREAM_CREATE` events are emitted.

One publisher, one subscriber and one directory request are owned per routing
instance. New operations replace the prior operation of the same kind. Setup
has a 15-second cancellation deadline; late resources are disposed even if a
provider ignores abort. Providers must settle on abort; a non-cooperative
provider can leave its awaiting promise pending. Directory results are bounded
to 64 entries and checked against the current DASS room. This is an in-process
contract, not a new wire protocol or a complete untrusted-response parser.

The plugin also offers a local-only capture check in settings through the staged
host bridge, without a backend transport. See [capture-bridge.md](capture-bridge.md).
The plugin exposes boundary methods and declares a build-scoped share-start
chooser patch. The chooser does not call native capture or instantiate a peer connection,
change voice, or install watch/detection hooks. A Discord build and private
factory excerpts are recorded; runtime hook behavior is not validated. The
required narrow Equibop capture lifecycle
bridge and wrapper fix are staged and unit-tested; runtime acceptance remains
outstanding. Pinned upstream capture code remains untouched. See
[capture bridge limitations](capture-bridge.md) and the
[Rust transport gate](transport-gate.md).

The routing tests use fake capture tracks and injected transports. They check
synchronous consumption, refusal before capture, explicit audio, cancellation,
late-result disposal, room isolation and publish/watch cleanup. They do not
prove native interception, live directory detection, server authorization,
E2EE, OS capture compatibility or absence of runtime Discord media leakage.

Validation for the current routing and chooser slice: `bun test ./tests/plugin`
passes with Bun 1.4.3 (38 tests, 128 assertions). `bun scripts/build-plugin.mjs`
passes DASS lint, full Equicord typecheck and desktop/Equibop bundle builds.
The existing adapter's Bun-version guard was already commented out; this work
does not change it. GUI hook matching and voice/media behavior remain unverified.
The historical build details below describe the earlier discovery-only snapshot.

## Verified builds and remaining limitations

- Equicord: `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4` (1.15.11.0), built
  with DASS in `build/Equicord` using local Bun 1.4.2 and Node 24.18.0 on Linux.
- Equibop: submodule `27219be3566589280c0c933b04753805381d3bc8` (3.3.1).
- Discord build: user-reported stable `634304`, version hash
  `17e01cf978c3c10a5688429a38db59a4926e8982`. Candidate factory matches are
  recorded in [discord-hooks.md](discord-hooks.md); runtime compatibility and
  native interception remain unverified.
- All 13 plugin tests passed (41 assertions). DASS lint, full Equicord typecheck,
  and desktop/Equibop-target bundle builds passed. Both renderers were checked
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
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
```

The Rust commands remain unverified in this session. The Bun tests use built-in
`bun:test`, with no DASS package manifest or dependency resolution needed. There is
no root DASS package manifest. The Equicord build snapshot has a committed Bun lock
in `tooling/equicord`; Equibop retains its upstream `bun.lock`. The Rust test checks the discovery fixture
against the actual serialized protocol so frontend validation cannot silently drift.
Scaffold tests do not typecheck the host-facing plugin or establish interoperability.

## Build DASS for Equicord and Equibop

Launching `vendor/Equibop` alone uses its default Equicord bundle, which does
**not** contain DASS. You must build the plugin into a custom Equicord bundle and
select it in Equibop. From the **DASS repository root**, with Bun 1.4.2, Node >=22
and Git available locally:

```sh
git submodule update --init --recursive
bun scripts/build-plugin.mjs
```

`vendor/Equicord` is the shared upstream source, pinned to the verified revision
above. This clones a dedicated `build/Equicord` checkout from that submodule on
first use, verifies both pins, adapts the local
types dependency, stages `plugins/dass` under `src/userplugins/dass`, installs the
locked dependencies, runs lint/typecheck, and builds both targets. It refuses
unfamiliar manifest, lockfile and staged-source edits rather than overwriting them.
Edit `plugins/dass`, not the staged copy, and rerun this command to rebuild.
The upstream submodule stays unchanged. Both desktop and Equibop renderers are
checked for DASS inclusion.

## Install in standard Discord desktop with Equicord

Build using the commands above first. A normal installed Equicord bundle does
not include DASS, and copying loose plugin files into Discord will not install it.
Fully quit Discord, including its tray process. Then, only when you intend to
modify your Discord installation, from the **DASS repository root**:

```sh
cd build/Equicord
bun run inject
```

The pinned `inject` script invokes Node directly, not pnpm. It downloads and runs
upstream's Equilotl installer and points it at this checkout's `dist/desktop`.
Review that installer before running it; injection is an explicit installation
step, never part of the build adapter. Select the intended Discord installation
when prompted, restart Discord, then enable **DASS** in **Equicord → Plugins**.
Keep `build/Equicord` on disk. Rebuild from the DASS root after plugin changes and
fully restart Discord.

This installation command is source-inspected, not executed or runtime-verified
by the agent. Desktop bundle checks do not prove plugin loading or capture
compatibility. Equibop's picker and venmic APIs are not available in standard
Discord; future capture integration needs separate host validation. The current
settings/discovery scaffold has no Equibop-only capture dependency.

## Install in Equibop

1. In Equibop settings, open **Developer Options** and click **Change** next to
   the Equicord location.
2. Select the absolute `build/Equicord/dist` path printed by the build command.
   Do **not** select `dist/equibop` or the plugin source directory.
3. Fully quit Equibop (including its tray process), then restart it.
4. Open **Equicord → Plugins**, search for **DASS**, and enable it. Open the
   plugin's settings for backend discovery.

The build disables Equicord's updater for both targets so an upstream update cannot replace the
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

Private Discord hooks live in a guarded adapter, with interception **before**
the native share-start callbacks at the identified center-tray and Voice Connected
panel buttons. Both build-634304 patches are built; the center chooser/refusal is
user-observed, while the left-panel patch still needs runtime verification. Follow the
acceptance procedure in [discord-hooks.md](discord-hooks.md); source inspection
and unit tests alone cannot establish safety against a live Discord build.

Reuse Equibop's installed capture function and its existing picker/consent. The
pinned Linux wrapper attaches venmic audio when its virtual device exists, and
the picker currently ties audio unmute/cleanup to native `STREAM_UPDATE` and
`STREAM_CLOSE`. DASS cannot rely on those events without native stream creation.
The staged host fix now adds explicit consent, independent teardown and exclusive
capture ownership; its local capture check still needs GUI acceptance before
production use. An Equicord webpack patch
cannot rewrite Equibop's bundled renderer. The upstream submodule is unchanged.

Release gates remain real Wayland/X11 picker cancellation, optional audio,
disable/logout/context-exit cleanup, independent Discord voice, no Discord
media/thumbnail leakage, authenticated publish/subscribe, required-E2EE rejection,
and the Phase 0 media interoperability tests in the implementation plan.
