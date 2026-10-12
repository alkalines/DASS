# Share-button DASS workflow

Discord Alternative ScreenShare (DASS) connects the two supported Discord Share
buttons to the experimental Rust transport. This is not a production service:
there is no E2EE, the backend still supports one publisher/one viewer, and stock
Discord cannot receive the stream.

## Setup once, with optional automatic login

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
3. In DASS settings, set the trusted HTTPS backend URL. Enter the authorized room,
   DASS username and password, then **Sign in to DASS**. Select **Remember login
   securely** to store only OS-encrypted account data and sign in automatically
   when the plugin loads. Without a supported secure keyring, remembering fails
   closed and the authenticated session remains memory-only. Ordinary plugin
   settings, URLs and Discord never receive the password.
4. Enable `DASS_RTC_AUTO_LAN_PEERS=true` in the backend configuration (the new
   account Compose overlay does this). The backend binds incoming candidate ports
   to the observed authenticated WSS LAN IP. No manual client-IP or port updates
   are needed for new shares/viewers. It does not change firewall rules or work
   around proxy/NAT address mismatches. Static allowlist modes remain available.
5. **Sign out and forget saved login** clears the account and deletes remembered
   ciphertext. Logout/disable/backend change clear in-memory passwords and media,
   but retain explicitly remembered ciphertext for the next load. Voice-context
   exit stops media while retaining the signed-in account for the next call.

No client helper executable, subprocess, proxy or external encoder is introduced.

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

On Discord stable build **634304**, the center call Share button and the left
Voice Connected Share callback use DASS by default. With session setup present,
clicking Share opens the DASS controls, authenticates, invokes the **installed**
Equibop source/quality/audio picker, gathers Chromium candidates and activates
the publisher automatically. Without setup, the same controls ask for it first.
Selecting share audio remains explicit; the microphone is not acquired implicitly.

Closing the controls does **not** stop the share. Click Share again or open DASS
settings to see its status and use **Stop sharing**. Source end, voice-context
exit, logout, disable and backend changes cancel pending work and release capture.
The controls do not fabricate a Discord live badge or stream record.
An additional DASS screenshare icon in the user panel opens these controls without
starting capture; it glows while DASS owns capture, including local preparation.
Use it to reopen the controls and stop sharing after closing the panel.

The viewer configures its own session, joins its voice context, and selects
**Find DASS streams** in the same controls/settings. Preparation and authenticated
directory binding happen together, with no copied publisher ID or repeated
credential entry. Choose a listed DASS stream to watch. Video starts muted;
**Enable audio** is an explicit playback gesture. Closing a panel detaches its
player; use **Close DASS viewer and room** to release the receiving connection.
Publishing and watching replace each other to keep one media session per client.

Disable **Use DASS directly from supported Share buttons** to restore the explicit
Discord/DASS/Cancel chooser. Only an explicit Discord choice invokes native
sharing. DASS failures never invoke the native callback, upload previews or fall
back to Discord. Other Share entry points remain native; other Discord builds
are not patched. This is two supported buttons, **not** universal interception.

## Exact-port policy and diagnostics

If keeping the default exact-endpoint backend policy, expand the advanced sections:

- Publisher: **Prepare capture only**, configure the shown endpoints in the
  backend, then **Activate prepared share** within 180 seconds.
- Viewer: **Prepare DASS viewer**, configure its endpoints, then **Bind room and
  discover**. Session access is reused; no credential repaste is necessary.

Prepare-only capture stays local and postpones media activation until backend
recreation is complete. Account login may already hold an idle WSS connection;
if recreation closes it, activation authenticates again. Legacy invite preparation
opens no WSS before activation. The manual transport panel remains under diagnostics for
comparison, not the normal sharing workflow. Replacing a prepared peer changes
its ports. Do not disable TLS/browser security or expose an open UDP policy.

## Evidence boundary

The previous commits record user-confirmed LAN video, discovery, audio and audio
consent. They do not verify this new button-to-publisher wiring. Unit tests and
custom bundle builds cannot establish live hook matching, media isolation or
Wayland/X11 capture behavior. Re-test both Share buttons, picker cancellation,
source end, disable/logout/context exit during setup, denied access, independent
Discord voice, directory removal and absence of native stream/thumbnail requests.
The native Discord Stop button is unchanged; DASS owns its separate Stop control.

Client validation passed with Bun 1.4.3: **113 plugin tests, 508 assertions**,
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
docker compose build tooling
docker compose run --rm tooling cargo fmt --all -- --check
docker compose run --rm tooling cargo clippy --workspace --all-targets --locked -- -D warnings
docker compose run --rm tooling cargo test --workspace --locked
docker compose build backend
```

The new accounts, publisher labels and automatic LAN policy need these backend checks
before runtime acceptance. No service was started or redeployed by this work.
