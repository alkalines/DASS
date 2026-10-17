# Share-button DASS workflow

Discord Alternative ScreenShare (DASS) connects the two supported Discord Share
buttons to the experimental Rust transport. This is not a production service:
there is no E2EE, the backend still supports one publisher/one viewer, and stock
Discord cannot receive the stream.

## Account configuration in settings

1. Configure the TLS backend and per-person hashed DASS accounts using
   [LAN accounts and automatic UDP admission](lan-accounts.md). Keep the trusted
   certificate and custom Equibop capture build from [direct-lan-test.md](direct-lan-test.md).
   Never use a Discord token/password. Publisher and viewer each use their own account.
2. From the **repository root**, rebuild the plugin:

   ```sh
   bun scripts/build-plugin.mjs
   ```

   Select `build/Equicord/dist` as Equibop's custom Equicord location and fully
   restart. The upstream pins are unchanged: Equicord
   `e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4`, Equibop
   `27219be3566589280c0c933b04753805381d3bc8`.
3. In DASS settings, set the trusted HTTPS backend URL, username and password,
   then **Save account configuration**. Saving requests OS-backed encryption and
   enables automatic login on plugin load. Leave the password field blank to keep
   an existing saved password. Without a supported secure keyring, persistence
   fails closed; a successful login remains memory-only. Ordinary plugin settings,
   URLs and Discord never receive the password. There is no client room field:
   media uses the current Discord call's channel ID as its DASS context.
4. Enable `DASS_RTC_AUTO_LAN_PEERS=true` in the backend configuration (the new
   account Compose overlay does this). The backend binds incoming candidate ports
   to the observed authenticated WSS LAN IP. No manual client-IP or port updates
   are needed for new shares/viewers. It does not change firewall rules or work
   around proxy/NAT address mismatches. Static allowlist modes remain available.
5. **Forget saved account**, under **Show advanced options**, clears the account and deletes remembered
   ciphertext. Logout/disable/backend change clear in-memory passwords and media,
   but retain explicitly remembered ciphertext for the next load. Voice-context
   exit stops media while retaining the signed-in account for the next call.

No client helper executable, subprocess, proxy or external encoder is introduced.
Rooms are discovery grouping only: the current Discord call's channel ID becomes
the opaque DASS room ID shared by the participants' clients. It selects context
only; it is not proof of Discord membership and grants no stream access. A viewer
asks to watch a specific live stream and the publisher's client approves, denies
or blocks the request; only a backend-consumed single-use approval permits
`subscribe`. The publisher can withdraw an account's viewers at any time.

## Publisher names

Stream labels come from the backend administrator's credential-bound publisher
display name, not an untrusted client claim. Set the optional display name when
creating a user (the final `DISPLAY_NAME` argument to `create-user`), or set
the account record's optional `display_name` in `DASS_USERS`.
Each person should have a separate account and label. These labels identify
DASS publishers; they do not verify or link a Discord account. No Discord token
or profile lookup is involved. Legacy invite mode remains supported separately.
Unnamed accounts fall back to their username; unnamed invites to their invite ID. The directory buttons and player
show the publisher label rather than an opaque stream session ID. Rebuild both
backend and clients together for the updated directory metadata contract.

## Normal sharing and watching

On reviewed Discord builds **634304**, **637268** and **638651**, the center call Share button
and the left Voice Connected Share callback open an explicit **Discord / DASS**
transport chooser. Cancel, Escape, outside dismissal, logout, disable or leaving
the call starts neither transport. Repeated clicks replace the pending chooser;
each selection is single-use and bound to the originating call.

Selecting **DASS**, with account setup present, authenticates and invokes the **installed**
Equibop source/quality/audio picker, gathers Chromium candidates and activates
the publisher automatically after capture consent. Missing setup produces a
notification directing the user to plugin settings.
Selecting share audio remains explicit; the microphone is not acquired implicitly.
Selecting **Discord** invokes only the original native share callback and picker.
No DASS login/capture is started by that selection. The account's background
session/discovery may already be running independently of the chooser.

Click the supported Share button again to stop. The center call button wraps its
existing native component to reflect DASS capture through `streamActive`; no
new user-area button or synthetic stream record is added. Source end, voice-context
exit, logout, disable and backend changes cancel pending work and release capture.

DASS-owned tiles now use the existing call grid, focused layout and filmstrip.
Automatically discovered remote DASS shares expose **Watch Stream**, with
independent DASS playback/audio. Stock Discord shares remain a separate transport.
These viewer workflows and popout handoff still need runtime acceptance.
The temporary advanced test viewer also remains available: expand
**Show advanced options** in plugin settings and select
**Find DASS streams** while in the call. Preparation and authenticated
directory binding happen together, with no copied publisher ID or repeated
credential entry. Choose a listed DASS stream to watch. Video starts muted;
**Enable audio** is an explicit playback gesture. Closing a panel detaches its
player; use **Close DASS viewer and room** to release the receiving connection.
Publishing and watching replace each other to keep one media session per client.

The retained `defaultDass` setting now chooses only which transport is emphasized
in the modal; it never bypasses explicit selection. Changing that preference
cancels a pending chooser but does not stop an active share.
DASS failures never invoke the native callback, upload previews or fall
back to Discord. Other Share entry points remain native; other Discord builds
are not patched. This is two supported buttons, **not** universal interception.
Stop buttons still stop their current owner immediately without reopening the
transport chooser. Hover the tile's Options button to see **Options (DASS)** for
a DASS tile; the PC-icon/name pill is also part of native Discord presentation
and is not, by itself, evidence of a particular transport.

## Exact-port policy and diagnostics

Capability checks, local capture tests, reconnect/forget controls and the temporary
viewer are hidden behind **Show advanced options**. Layout uses spaced fields and
wrapping action rows. No diagnostic buttons appear in the normal call UI.

The normal UI targets automatic LAN admission, not manual publisher prepare-and-
recreate. Older exact-port procedures remain transport experiments, not the
current settings UI. Do not disable TLS/browser security or expose an open UDP policy.

## Evidence boundary

The previous commits record user-confirmed LAN video, discovery, audio and audio
consent. They do not verify this new button-to-publisher wiring. Unit tests and
custom bundle builds cannot establish live hook matching, media isolation or
Wayland/X11 capture behavior. Re-test both Share buttons, picker cancellation,
source end, disable/logout/context exit during setup, denied access, independent
Discord voice, directory removal and absence of native stream/thumbnail requests.
The Share wrapper's native styling/stop-state rendering needs live acceptance.
It does not establish the complete native stream lifecycle or viewer integration.

Client validation passed with Bun 1.4.3: **116 tests, 520 assertions**,
generated-protocol freshness, DASS lint, full Equicord typecheck, and desktop/Equibop
bundle builds. Run from the repository root:

```sh
bun test ./tests/plugin
bun scripts/generate-protocol.mjs --check
bun scripts/build-plugin.mjs
```

Rust validation was blocked by Docker build-context access to the protected
`.secrets` directory and Docker socket permission errors; no host Cargo fallback
was used. In a Docker-enabled shell, from the repository root:

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all -- --check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo clippy --workspace --all-targets --locked -- -D warnings
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo test --workspace --locked
docker compose build backend
```

The new accounts, publisher labels and automatic LAN policy need these backend checks
before runtime acceptance. No service was started or redeployed by this work.
