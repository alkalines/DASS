# DASS plugin

For native screenshare UI continuation and the pipeline investigation, see
[native-screenshare-handoff.md](native-screenshare-handoff.md).
The follow-up [native presentation audit](native-presentation-audit.md) maps the
current adapter to the traced native state/media owners and prioritizes remaining
integration gaps. Passing unit tests does not establish native UI acceptance.

Discord Alternative ScreenShare (DASS) now has a build-time Equicord userplugin
in `plugins/dass`. It now includes an experimental authenticated directory and
DASS-owned viewer; see [watching.md](watching.md) for the current behavior,
supervised LAN procedure and unverified exit condition. The earlier manual
transport has user-reported LAN video evidence, not a completed transport gate.
The capability checker described below is still a separate scaffold-only check.

Automatic authenticated call discovery is retained, but the separate DASS Streams
button and call watch panel were removed after user feedback.
The user reports local preview and LIVE presentation in the intended grid space.
DASS-owned preview/watch tiles use the existing call grid, without a separate
panel. The latest revision projects DASS-owned selection into the connected call
view and reuses the focused layout and filmstrip, with guarded DASS tile rendering.
The sidebar reuses Discord's existing activity-panel frame, action button, Stop
icon and localized tooltip above Voice Connected. Its DASS branch now renders the
approved DASS-owned source/title/quality body inside that frame, using actual
capture settings and an isolated Stop callback. Ordinary Discord shares keep
their original body. No native Discord stream is registered. The separate
comparison-panel card is not mounted in the production sidebar.
These changes and remote playback/audio are not yet runtime-verified. Remote
voice-row badges remain unavailable. Streaming state begins after OS source selection
and quality/audio consent complete, rather than during authentication or the
open picker. Remote Watch Stream requests audible playback, with a Play fallback
only when autoplay is blocked; local preview stays muted. These latest changes
still need runtime acceptance. The full-call center Stop control is user-reported working; the new sidebar pressed/icon/Stop
state patch is built but not runtime-verified. See [discord-hooks.md](discord-hooks.md) for
the required native UI, runtime acceptance checklist and read-only DevTools probe
needed to trace those remaining private hooks. No backend changes are required
by this client integration; latest publisher/viewer runtime acceptance is still
outstanding.

Tiles reuse Discord's actual frame rather than the generic Card. Their LIVE badge,
publisher name and Options overlay now use the approved DASS-owned components.
The quality segment uses measured width and a sliding reveal instead of the
earlier grid-track animation. Quality labels come from track settings; unavailable
resolution/FPS is omitted instead of invented. At the user's request, quality
above 720p or 30FPS uses the Nitro-style icon and purple sidebar text; 720p 30FPS
and below stays standard. This is quality styling, not an entitlement check or a
Discord subscription requirement. The tile quality segment uses the same rule.
Their DASS video and watch content remain independent of Discord's media engine.
All tile videos are muted, including filmstrip previews; the connected call owns
separate audible playback of the receiver stream. Share mute/volume is independent
of Discord voice and uses the researched nonlinear curve over 0..100%, without
amplification. The volume control now uses a host Clickable speaker icon and an
owned, accessible vertical range input above it, replacing the labeled horizontal
slider. The 72px track, 6px rail, 10px thumb and dark rounded panel follow the
native control inspected on Discord build 637268. Hover/focus reveals it; a
150ms hover-exit delay and a pointer bridge keep it reachable. Clicking the
speaker toggles mute without losing the remembered level. Arrow keys change
volume by 5%, Home/End reach the bounds, and Escape dismisses an open panel
without triggering call fullscreen exit. Pointer cancellation and unmount clear
owned interaction state/timers. It does not reuse the native audio-store wrapper
or media bar with the documented popout listener risk, and installs no window
listeners. This is a visual/interaction recreation, not the native component.
Mock DevTools checks covered layout, mute restoration, keyboard changes and
Escape without changing real stream audio. Real pointer dragging, playback and
popout behavior still need runtime acceptance. DASS now reuses Discord's native
stream sound player for local publishing start/end and successful local watch/stop
transitions. A previously playing viewer that disconnects uses the ended cue,
not both ended and viewer-left. Picker cancellation and failed setup are silent;
plugin disable stops owned cues without playing teardown sounds. Discord's sound
toggles, sound pack, streamer-mode muting and native 40% cue volume are preserved.
These hooks and the four MP3 assets were inspected through DevTools in the
connected stable Discord window (release `a935e483c18dcf082c62ce19bc9e3560fce10581`);
the numeric Discord build was not exposed by the inspected globals. Actual DASS
transition playback still needs runtime acceptance.
The publisher now opts into authenticated, publisher-scoped backend viewer
presence before sending its offer. Accepted viewer subscriptions play the native
joined cue for the broadcaster; viewer session cleanup plays the left cue.
Presence means an accepted subscription, not proven RTC connectivity or playback.
Events are checked against the publisher's session and count transitions, and
cannot consume a pending signaling response. Stale events after teardown are
ignored. No viewer identity is disclosed. Directory arrivals/removals do not generate cues.
This plugin requires the matching updated backend for publisher presence; there
is no feature negotiation or silent fallback on an older backend. Rebuild the
backend with `docker compose build backend` from the repository root, then restart
it with `docker compose up -d backend`. New Rust presence tests, formatting,
Clippy and compilation remain unverified in this session because Docker socket
access was denied; real publisher/viewer sound acceptance is also outstanding.
Unexpected viewer disconnection is not proof that the publisher ended its stream.
Browser video controls are removed. Call-level fullscreen/popout controls retain
their native routes, but popout media/audio handoff still needs runtime testing;
individual tile popouts and zoom are unavailable. Tile overlays use DASS-owned
hover/focus styling rather than the complete native idle/overlay implementation.
The name/screen-icon pill is now independently anchored 12px from the frame's
lower-left corner. Native controls-bottom offsets raise only the actions, not
the name. A DOM-only mock check retained the 12px name inset while actions were
raised 96px.

When the selected DASS participant is the actually received remote share in the
current call, the native center disconnect/stop control uses its **Stop
Watching** branch. Its action stops only DASS reception and clears DASS focus;
it never disconnects ordinary voice, stops another native stream or falls back
to native stopping. Local previews, merely listed shares, errors and other calls
do not own this action. The hook subscribes to DASS watch/presentation state and
includes it in native callback dependencies; the native animation, icon and
tooltip remain native. A stale DASS callback is a no-op after context/selection
changes. Native stream/activity/call branches remain unchanged otherwise.

The missing publishing sidebar follow-up changes the Activity Panel entry
anchor to its unique **ActivityPanelGameCard** configuration location. Live
inspection on build 637268 found the old mounted component had no DASS hook;
the new anchor and all ten card replacements matched once and compiled in a
read-only source check. The six focused-watch replacements also matched once
and compiled. These checks do not prove that the rebuilt hooks mount at runtime:
fully restart with DASS enabled and verify the sidebar card and focused stop
action. No live module factories or active media were modified for the checks.
Stop Streaming and Stop Watching use the owning DASS controllers; Stop Watching
is disabled unless receiving a tile or dismissing its closed-view metadata. The
publishing call button now exposes Discord's native dropdown arrow, and the
Voice Connected share button opens the same DASS menu with **Change Stream** and
**Stop Streaming**, without Report Problem. Change Stream releases the old capture,
waits for host audio cleanup, and opens the existing Equibop source/quality/audio
picker through a fresh authenticated DASS session. Cancelling leaves sharing
stopped; ordinary voice is unaffected. Rebuild the Equibop capture bridge as well
as the plugin for awaitable capture cleanup. The menu/arrow hooks matched once
against build 638651 through read-only DevTools inspection; end-to-end acceptance
of these changes remains pending. DASS grid and filmstrip tiles now precede native
participant tiles (left first), preserving native participant keys.
Change Stream in the tile overlay and individual popout remain disabled.
Publisher More Options shares its Show My Screen Share
and Pause Preview When Discord Isn’t Focused preferences across grid/focused
tiles. These are session-only presentation preferences. They detach local preview
playback without disabling/stopping capture tracks or interrupting publishing.
Receiver video/audio and ordinary Discord voice are unaffected by those preferences.

The sidebar patch follow-up fixes a grouped-patch rollback: the action-props
wrapper previously opened and closed its call in separate replacements. Equicord
compiles after each replacement, so the incomplete call rejected the whole group
even though the final combined source compiled. The wrapper now uses a single
replacement. Tests compile every intermediate step; a read-only build 637268
check matched all nine replacements once and compiled each step. Lint, typecheck
and desktop/Equibop builds passed. The rebuilt sidebar still needs runtime
acceptance after a full restart; the live client was not patched or reloaded.

The viewer now retains one closed share's room/ID/display-name metadata after an
unexpected closure of actual received media. Peer, signaling, room binding,
candidates and playback are released immediately; no final frame is retained.
Only a successful authenticated directory refresh for the same room that no
longer lists the publisher produces **This stream has ended.** Otherwise the
closed view stays a connection error with a close action, not a false normal end.
The ended card keeps its grid key and focused selection until **Close Stream**;
stop, logout, disable, revocation or context loss clear retained metadata.
Closing changes only DASS viewing, not Discord voice. There is no automatic
resubscription or Discord fallback.

The ended layout uses the host Button/Heading and dynamically resolved native
illustration style, not copied bundled functions, hashed class names or a
hardcoded asset URL. The couch artwork remains a host resource and is not
redistributed in the plugin. If its style module is unavailable, the decorative
illustration is omitted while the heading and close action remain usable.
Small tiles hide the art; medium and large views use 134px/185px art areas.
The safe DevTools preview was checked against the visible native screen without
screenshots. Real publisher-end/directory timing still needs runtime acceptance.

Failed selected-share setup now retains a separate bounded metadata entry for
an error tile, never qualifying for the normal ended card. The native-like error
screen uses a black background, centered 16px semibold heading, muted 14px error
label, help action and host **Close Stream** button. Established media closure
reads **Stream disconnected :(**; failed setup reads **Stream failed to start
:(**. Labels are DASS setup/connection categories, not invented Discord numeric
codes. The help action expands the existing sanitized DASS status and local
troubleshooting advice, without sending diagnostics to Discord or another
service. No automatic retry, capture or fallback is triggered. Close, context
loss, logout, disable and revoked access clear retained entries. DevTools mock
checks verified typography, help expansion and close behavior; real failure
timing still needs runtime acceptance.

The reviewed Discord builds are **634304**, **637268** and **638651**. This list is
informational, not a patch gate: DASS attempts its hooks on every build. On an
unapproved or unidentifiable build, plugin startup shows a **DASS compatibility
warning** once per client session: “The current plugin version is not yet approved
for this Discord build. This could cause the UI to break.” Enabling the plugin
later in the session also performs this check. Source-match and grouped-patch
rollback checks remain in place, but cannot guarantee compatibility or interception
on future builds. If the chooser is missing, do not continue sharing expecting DASS.
On October 15, 2026, the running stable client
reported build 638651 (hash `5622b31c0cab24812146307b2dd36712a87d7174`). DASS was
enabled, but the previous exact-build gates skipped its share-button hooks,
leaving the native Discord-only action. A read-only DevTools check found all 55
replacements across 13 patch groups matching once, with every intermediate source
compiling. Build 638651 is now included in the reviewed-build list. No live module
factories were modified, and no capture or share was started. The chooser and
media behavior still require runtime acceptance after rebuilding and restarting.
On October 14, 2026, all 46 replacements across 11 patch
groups matched once in a read-only check of build 637268 (hash
`a935e483c18dcf082c62ce19bc9e3560fce10581`). No live module factories were replaced
by that check. Build success and source matching do not establish real media,
preview-blur, popout or sidebar acceptance; testing the built plugin requires a
full client restart and DASS enabled. See [stream-ui-preview.md](stream-ui-preview.md)
for the separate safe visual comparison tool.

The fullscreen follow-up protects the saved native call layout from voice-only
participant updates while the current call has DASS tiles. Native voice mode is
not changed, no Discord stream is registered and other calls retain their normal
layout cleanup. DASS owns a bounded set of native fullscreen-exit callbacks and
releases them on exit/unmount or when its view is lost. Logout/disable/context
exit close owned fullscreen before teardown; exits during Flux dispatch use the
host's deferred-dispatch helper. The CallTile hook also handles the conditional
neighboring frame export found on build 637268, so focused DASS tiles do not fall
through to native media assumptions. These source-level fixes still need a live
fullscreen/escape/stop regression test after restarting the rebuilt client. The
follow-up read-only check found all 50 replacements in 12 patch groups matching
once on build 637268; this did not modify any live module factories.

## Sharing diagnostics

Rebuild from the repository root with `bun scripts/build-plugin.mjs`, then fully
quit and restart the client using the custom build. In Equibop, the selected
custom Equicord location should be `build/Equicord/dist`, not its `equibop` child.

Open the client's Developer Tools Console, enable Info and Error levels, turn on
Preserve log, and filter for `DASS`. Diagnostics are enabled by default and use
Equicord's `Logger` in the staged plugin. They record share-action interception,
account state, publisher/viewer phases, picker availability, fixed failure codes,
signaling operation types, and peer connection/ICE state. They do not record
credentials, usernames, room/channel IDs, backend URLs, candidate addresses, SDP,
track labels or captured media. Browser exception messages and stacks are omitted.

If `share action intercepted` is absent after clicking a supported Share button,
check Equicord's patch warnings and plugin loading; the hooks are build-specific.
`bridge_missing_or_incompatible` means the required Equibop capture bridge is not
installed. `rejected:unauthorized` indicates backend authorization failure.
An applied answer followed by a connection timeout points to the UDP path or
peer lifecycle, not necessarily an authentication problem.

Backend JSON diagnostics go to container stdout. From the repository root:

```sh
docker compose up -d --build backend
docker compose logs --follow --tail=200 backend
```

Use the equivalent logs command for your LAN deployment's Compose file/service.
The local scaffold Compose configuration is not a TLS media deployment. Backend
logs record upgrade rejection categories, authentication, operation completion
and rejection codes, RTC connection, publisher directory registration, and
closure reasons. A process-local `connection` number groups socket events; it is
not a user identifier and is not shared with the client. Directory polls and media
packets are not logged. Third-party RTC logs remain filtered out, even if
`RUST_LOG` is set. These diagnostics do not establish runtime compatibility or
production readiness.

The current [session and Share-button workflow](session-workflow.md) and
[LAN account setup](lan-accounts.md) replace the manual publishing/refusal path
below. Accounts can be remembered with OS-backed encryption and authenticate
on plugin load; LAN client endpoints are admitted per session automatically.
Supported Share buttons now ask explicitly for Discord or DASS. The retained
`defaultDass` setting only emphasizes the preferred choice. Cancel/dismissal
starts neither transport, and active Stop actions bypass the chooser. The older
sections document development history, not the current normal workflow.

The capability checker sends no credentials, rejects redirects, requires HTTPS except for explicitly
enabled loopback HTTP, and bounds discovery to 5 seconds and 16 KiB. Only the
version-1 scaffold contract is accepted. Discovery is not authentication or an
authorization to capture. E2EE is mandatory in the media path (publisher and
viewer ECDH identities plus AES-256-GCM frame encryption); it is not yet
independently reviewed or validated on real clients, so treat it as
unproven code rather than a security claim. The frame layout is
project-specific: it follows the SFrame shape but is not RFC 9605 SFrame and
has no interoperability.

**Identity verification:** the publisher's approval prompt shows the
viewer's safety number, and the viewer panel shows the publisher's safety
number, so both sides can compare it over an independently authenticated
channel. A confirmed comparison marks that pinned identity as verified and
switches the stream state to "E2EE — identity independently verified";
without it the state stays "E2EE — identity unverified (TOFU)". The
`requireVerifiedViewers` setting makes the publisher refuse approvals for
viewers whose identity was not verified. A first contact is never verified by
the comparison alone, and a changed key always pauses admission until the
publisher explicitly re-confirms it. A changed publisher key pauses the
subscription until the viewer accepts the new identity.

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
passes with Bun 1.4.3 (286 tests, 2092 assertions), including the capture
consent, teardown and leakage guards in `tests/plugin/captureConsent.test.ts`.
`bun scripts/build-plugin.mjs`
passes DASS lint, full Equicord typecheck and desktop/Equibop bundle builds.
The existing adapter's Bun-version guard was already commented out; this work
does not change it. GUI hook matching and voice/media behavior remain unverified.
The historical build details below describe the earlier discovery-only snapshot.

The capture boundary, the teardown matrix and the metadata the client can
observe are documented in [capture-consent.md](capture-consent.md).

## Verified builds and remaining limitations

- Equicord: `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4` (1.15.11.0), built
  with DASS in `build/Equicord` using local Bun 1.4.2 and Node 24.18.0 on Linux.
- Equibop: submodule `27219be3566589280c0c933b04753805381d3bc8` (3.3.1).
- Discord build: user-reported stable `634304`, version hash
  `17e01cf978c3c10a5688429a38db59a4926e8982`. Candidate factory matches are
  recorded in [discord-hooks.md](discord-hooks.md); runtime compatibility and
  native interception remain unverified.
- All 286 plugin tests passed (2092 assertions). DASS lint, full Equicord typecheck,
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
media/thumbnail leakage, authenticated publish/subscribe, mandatory-E2EE
behavior (no transport-only fallback), and the Phase 0 media interoperability
tests in the implementation plan.
