# LAN accounts and automatic UDP admission

Discord Alternative ScreenShare (DASS) supports separate per-person usernames
and passwords for its experimental Rust transport. The backend stores password
**hashes**, never the account passwords, in a bounded JSON environment variable.
This replaces repeatedly handing around invite strings or editing client UDP
ports. It remains LAN-only experimental functionality: one publisher and one
viewer backend-wide, TLS/DTLS-SRTP, no E2EE, and readiness still returns 503.

## The implemented flow

1. An administrator provisions each DASS account with a salted Argon2id hash,
   room grants, expiry/revocation state and optional display name.
2. Configure the **DASS** username/password in plugin settings once. These are
   not Discord credentials. No room is entered: the current Discord call determines
   context. Backend `room_id` grants must authorize that call's channel ID.
3. **Save account configuration** stores only OS-encrypted
   account data. On plugin load or a Discord login after logout, it unlocks the
   saved account and authenticates over WSS to the same configured backend origin.
   Secure-storage failure leaves a successful login memory-only and reports the
   failure; there is no plaintext persistence fallback.
4. The backend obtains the IPv4 address from the accepted WSS TCP socket. The
   plugin does **not** send a claimed local IP at startup: the server-observed
   address is authoritative. Login alone does not authorize any UDP port or
   capture, and does not add a permanent global whitelist entry.
5. Share uses the installed Equibop picker and Chromium WebRTC. The publisher's
   offer carries its freshly opened UDP candidates. Watching prepares a receive-
   only peer and submits its own candidates through the same authenticated flow.
6. With `DASS_RTC_AUTO_LAN_PEERS=true`, the backend admits only exact UDP endpoints
   from valid offers/ICE candidates whose IPv4 equals that connection's observed
   LAN IP. The port must be non-privileged, the ICE component must be 1, and at
   most 16 candidates may be submitted per media session. Publishing/subscribing
   still requires the account's scoped room permission.
7. Those endpoints belong to the single RTC session, not the whole backend.
   Actual packet sources and outgoing destinations must be in that session's
   set. Stop, source end, socket loss, expiry, revocation, timeout, plugin disable,
   logout or voice-context exit close the owning peer and remove its admission.
   Future streams/viewers authenticate and admit their new ports automatically.

The startup authenticated connection is transferred to the first media operation,
not reused for a second concurrent login. After an idle connection expires,
subsequent sharing/watching authenticates again. This does not automatically
restart capture or reconnect a failed stream without a user action.

## Account environment format

**Edit `.secrets/accounts/users.json` to manage users.** Generate each password
hash with `create-user` below; never put plaintext passwords in this JSON.
After editing, regenerate `.secrets/backend.env` and recreate the backend as
shown below. Both files are private and ignored by Git.

`DASS_USERS` is UTF-8 JSON with this shape (the hash placeholder is **not valid**):

```json
{
  "version": 1,
  "users": [
    {
      "username": "alice",
      "password_hash": "<generated Argon2id PHC hash>",
      "expires_at_unix_seconds": 1893456000,
      "revoked": false,
      "display_name": "Alice",
      "rooms": [
        { "room_id": "lan_test", "access": true, "publish": true, "subscribe": true }
      ]
    }
  ]
}
```

- At most 128 KiB, 256 unique accounts and 16 distinct room grants per account.
  Usernames and exact room IDs are 1–64 ASCII letters, digits, underscores or
  hyphens. Account grants also accept the explicit all-rooms selector `"*"` below.
- Admin-created passwords must be 12–512 UTF-8 bytes without control characters.
  Use strong, unique passwords. Password hashes use the existing pinned Argon2id
  parameters: version 19, 19,456 KiB memory, two iterations, one lane, 16-byte
  random salt and 32-byte output. Unsupported hash cost parameters fail closed.
- Account display names are optional, at most 128 UTF-8 bytes, and cannot contain
  control characters. Unnamed accounts display their username. These labels do
  not verify a Discord identity.
- Configure **either** `DASS_USERS` **or** `DASS_INVITE_FILE`, not both. Legacy
  invite authentication remains supported separately; an account cannot use the
  invite-login path, nor can an invite use account login.
- Environment account changes require recreating the container. SIGHUP reload
  remains specific to the invite-file mode; it does not reread a host environment.
- Accounts are exclusive to one live authenticated connection in this experiment.
  Do not share one account between clients. Account login is bounded/rate-limited,
  but this is not a completed production brute-force or multi-device system.

### Temporary all-rooms access for trusted accounts

For dynamic DM/group calls, use this grant in an account's `rooms` array:

```json
"rooms": [
  { "room_id": "*", "access": true, "publish": true, "subscribe": true }
]
```

Only the literal `"*"` is supported, not patterns such as `"dm_*"`. This option
is account-only (`DASS_USERS` / `create-user`); legacy invite grants remain exact.
Exact grants remain the default. Set `publish` or `subscribe` to false to restrict
the all-rooms role. Authentication, account expiry/revocation and media-session
limits still apply. Wildcard selection is server configuration, not a valid room
ID in signaling messages.

**Security limitation:** this grants access to every DASS room on this backend,
including calls the account does not belong to in Discord. Knowing/guessing a
channel ID is not proof of membership. Use only for trusted users on a private
backend; do not use this as isolation between unrelated users. Grants are
additive: an exact grant with `false` permissions does not override permissions
already granted by `"*"`. To exclude a room, remove wildcard access and use exact
grants instead. Remove the wildcard grant to revoke broad access, regenerate
the private backend environment file and recreate the backend.

**Future authorization work:** replace broad wildcard grants with authenticated,
short-lived call-scoped admission, server-enforced publisher/viewer membership
and revocation when membership changes. Dynamic DMs should not require manual
channel lists, but neither client-provided Discord IDs nor extracted Discord
tokens may become authorization. This is a design requirement, not functionality
provided by the current implementation.

The admin CLI accepts the same selector in its `ROOM_ID` argument. Quote it so
the shell cannot expand it into filenames:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo run --locked -p dass-backend -- \
  create-user .secrets/accounts/alice.json .secrets/accounts/alice-password.txt \
  alice '*' both "$DASS_ACCOUNT_EXPIRES" 'Alice'
```

Run from the repository root after preparing the private password file and expiry
as described below. Existing account record files are not overwritten. For an
existing user, edit only their grants in the private JSON; no password rehash is
required. Rebuild the backend before enabling wildcard records on older binaries.

### Generate the hash without exposing the password

The `lan_test` identifiers in the transport examples below are placeholders.
For the current call-based plugin UI, substitute the actual Discord call/channel
ID in each exact backend room grant and `create-user` command, or explicitly use
the trusted-account wildcard above. Users do not enter it
into plugin configuration; the server must still authorize it explicitly.

All commands here run from the **DASS repository root**. Rust tools run in Docker.
Prepare a private `.secrets/accounts` directory and a mode-0600 password file,
for example `.secrets/accounts/alice-password.txt`, using a trusted editor/password
manager. Do not put the password into command arguments, shell history, chat or
environment variables. A single final LF/CRLF from the editor is stripped.

```sh
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
export DASS_ACCOUNT_EXPIRES="$(date -d '+30 days' +%s)"
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo run --locked -p dass-backend -- \
  create-user .secrets/accounts/alice.json .secrets/accounts/alice-password.txt \
  alice lan_test both "$DASS_ACCOUNT_EXPIRES" 'Alice'
```

The command reads the bounded password file, writes a new mode-0600 JSON record
containing only its hash, and never prints the password/hash. Existing output
files are not overwritten. Repeat for each person; use `publisher` or `viewer`
instead of `both` for narrower grants. Deliver the username/password privately
and manage the temporary password file yourself; the backend does not need it.

For multiple generated account records, combine their `users` arrays into one
private file. For example, with local Bun (tooling only, not a server):

```sh
umask 077
bun -e 'const users = []; for (const path of Bun.argv.slice(1)) users.push(...(await Bun.file(path).json()).users); await Bun.write(".secrets/accounts/users.json", JSON.stringify({ version: 1, users }));' \
  .secrets/accounts/alice.json .secrets/accounts/bob.json
```

For one account, copy its generated JSON to `users.json` instead of combining
records (`cp .secrets/accounts/alice.json .secrets/accounts/users.json` on first
setup only). Then generate the backend's private environment file (also after any
account edit). These commands replace that file; use this account mode **or**
legacy invite mode, never both:

```sh
umask 077
bun -e 'const users = await Bun.file(".secrets/accounts/users.json").json(); await Bun.write(".secrets/backend.env", "DASS_TLS_CERT_FILE=/run/dass/cert.pem\nDASS_TLS_KEY_FILE=/run/dass/key.pem\nDASS_USERS=" + JSON.stringify(users) + "\n");'
chmod 600 .secrets/backend.env
```

Protect hash records and environment access too: Docker administrators can inspect
container environment variables. Do not paste `docker inspect`, expanded Compose
configuration, account JSON or authentication messages into bug reports. Avoid
manually placing unescaped Argon2 `$` strings into interpolating `.env` files.
Compose loads `.secrets/backend.env` in **raw** mode, preserving those characters;
do not wrap its JSON value in shell quotes. Compose >= 2.30 is required.

## One-time direct-LAN server setup

Keep the TLS certificate/trust, native capture build and firewall prerequisites
from [direct-lan-test.md](direct-lan-test.md). All modes now use **one**
`compose.yaml`; there are no overlay files. Put only the backend-readable TLS
certificate/key in `.secrets/runtime/cert.pem` and `.secrets/runtime/key.pem`.
If upgrading, copy your existing `.secrets/lan-test` certificate/key there,
preserving their restrictive permissions. The directory must be traversable and
the files readable by container UID/GID `10001:10001`; do not make keys
world-readable. Password input files and account JSON stay outside this mount.
Set the actual private IPv4 of this backend host; it must match the certificate
SAN and the client's HTTPS URL:

```sh
cp .env.example .env
# Edit .env: set DASS_BIND_IP and DASS_LAN_SERVER_IPV4 to your actual LAN IP.
docker compose config --quiet
docker compose up -d --build backend
```

Copy the example only on first setup, not over an existing `.env`. Its TLS LAN
settings explicitly disable insecure mode and enable media/automatic admission.
Never publish plaintext discovery on a LAN/public interface. After account
changes, regenerate `.secrets/backend.env` above and run
`docker compose up -d --force-recreate backend`; no image rebuild is needed for
account-only changes. Keep `.env` for network/mode settings and
`.secrets/backend.env` for TLS paths and `DASS_USERS`.

This is an explicit user startup command, not a service deployed by the agent.
It retains the non-root, read-only, capability-free, bounded backend container.
It publishes TLS TCP 8080 and the backend's two fixed UDP ports, 50000/50001, on
the selected LAN address. Those **server** ports/firewall rules still need one-time
configuration. The **client** ports no longer need manual allowlisting per share.
The static exact/trusted-IP policies remain the default in other configurations;
setting the automatic flag enables the new behavior explicitly.

Rebuild both backend and plugin, select `build/Equicord/dist` in Equibop and fully
restart. Save account configuration once, then use the call's Share button.
The temporary test viewer is behind **Show advanced options**; native stream
tiles/watch/player integration remains incomplete. See [session-workflow.md](session-workflow.md).

## Network and storage limits

- Automatic admission currently accepts only safe RFC1918 private IPv4 or
  loopback TCP peers. IPv6, public, link-local/metadata, broadcast and unspecified
  addresses do not qualify. It does not support internet/NAT traversal or TURN.
- The WSS peer IP must equal the client's advertised candidate IP. A reverse
  proxy, Docker userland proxy/hairpin NAT, VPN, translated source address or
  multiple client interfaces can break this assumption. Mismatches fail closed;
  `Forwarded`/`X-Forwarded-For` and client IP fields are never trusted to fix it.
  Verify source-address preservation on the real LAN. Existing static policies
  remain a separate, explicit alternative for supervised tests.
- Admission is an in-process RTC destination/source policy. It does **not** edit
  iptables/nftables, open router/client firewall ports, bypass capture permission,
  or guarantee connectivity. An authenticated client cannot admit another host's
  address or make the backend an arbitrary UDP relay.
- Remembering uses Electron `safeStorage` through the custom plugin's native IPC
  and stores only ciphertext through Equicord DataStore. Linux requires a known
  secure libsecret/KWallet backend; `basic_text`, `unknown` and unavailable storage
  are rejected. Windows/macOS also require available OS encryption. No fallback
  to plaintext settings/storage is permitted. OS keyring prompts may occur.
- In-memory passwords/connections are cleared on logout/disable/backend change.
  Remembered ciphertext survives those actions by explicit consent so the next
  plugin load can authenticate. **Forget saved account** in Advanced deletes it.
  Saved credentials are bound to their backend origin; a different configured
  backend never receives them automatically. Encryption at rest does not protect
  against malicious renderer plugins, a compromised account or a compromised OS.
- No extra client executable, process, daemon or encoder is introduced. Share
  audio still requires explicit picker consent; login/viewer setup requests no
  capture. DASS never falls back to native Discord streams or thumbnails.

## Validation boundary

Client unit tests use fake sockets/keyrings and do not prove real OS encryption,
native IPC availability or LAN address preservation. Re-test login on startup,
secure-storage refusal, wrong/expired/revoked passwords, scoped room denial,
spoofed candidate/header addresses, candidate bounds, source/port cleanup and
two-client video/audio without per-share backend edits. Include ordinary voice
independence and absence of Discord media/preview leakage.

Backend formatting, Clippy and tests remain blocked in the agent environment by
Docker socket/build-context permissions. Run the Docker-only checks in
[backend.md](backend.md) before claiming runtime acceptance. No hashes, passwords,
images or network policies were installed on the user's behalf.

Client validation with Bun 1.4.3 passed: **116 tests, 520 assertions**, generated
protocol freshness, plugin lint, full Equicord typecheck and both desktop/Equibop
bundles (including secure-login native helpers). The former account overlay
passed `config --quiet` using an empty, non-secret account fixture; that evidence
was configuration parsing only, not a running authenticated backend.

The consolidated `compose.yaml` passed isolated Compose 5.6.0 configuration
checks for default discovery, TLS invite signaling, LAN accounts and static LAN
media policies, including literal hash dollar signs and retained container
hardening. Checking the real repository configuration was blocked by `.secrets`
permissions. These checks did not start a backend or validate account/media runtime.
