# SQLite configuration and migration

Discord Alternative ScreenShare (DASS) stores users, separate administrator
credentials, legacy invitations and resource/LAN admission settings in SQLite.
This change is **not runtime-accepted or production-ready**. Existing security,
E2EE, interoperability and readiness limitations are unchanged.

## Upgrade an existing installation

All commands below run from the repository root. Stop the existing backend and
take a private backup of its `backend-data` volume and bootstrap configuration
before upgrading. Do not remove the volume. Backups contain password hashes.

On the first launch with no migrated database, one SQLite transaction:

1. Creates the version-1 schema from `crates/backend/src/migrations/001_initial.sql`.
2. Imports the version-2 `policy.json` at `DASS_ADMIN_DATA_FILE` if present.
   That file takes precedence over `DASS_USERS`, including an empty saved policy:
   deleted users must never reappear. Without that file, `DASS_USERS` is imported.
   Alternatively, `DASS_INVITE_FILE` imports legacy invitations without converting
   them to accounts. Conflicting account/invitation modes are rejected.
3. Imports `DASS_ADMIN_USERS` into a separate administrators table. Administrator
   access does not grant stream access; invitation mode does not enable the panel.
4. Imports the settings below, using bounded defaults for unset values.
5. Applies the administrator-management migration and commits schema version 2
   atomically. Existing version-1 SQLite databases upgrade transactionally too.
   Existing administrator hashes are preserved. In account mode only, if no
   administrators were imported, `admin` / `admin` is seeded with a mandatory
   password-change flag. It is never re-created on routine restarts.

Malformed, oversized, unsupported-version or unreadable legacy inputs abort the
import. Existing source files are not changed or deleted. A failed transaction
can be retried after correcting its source. Corrupt or future-version SQLite
databases fail closed and are **never** replaced by environment seeds.

Once committed, SQLite wins on every restart—even if environment credentials
or legacy files are changed, deleted or invalid. Remove migrated credentials
from `.secrets/backend.env` after verifying the import and backup. Removing
`DASS_ADMIN_USERS` no longer disables administrators already stored in SQLite.
Legacy `create-user`/`create-admin` commands remain import utilities, not live
configuration editors. SIGHUP no longer reloads invitation JSON; restart to load
offline database changes.

`DASS_DATABASE_FILE` locates the database (default `/var/lib/dass/dass.sqlite3`).
It remains an environment/bootstrap input, as do TLS paths, the listen address,
transport mode, RTC opt-in, bind/advertised addresses and UDP ports. The database
must live in a persistent, writable directory for SQLite's rollback journal;
do not mount only its file read-only. Compose retains the non-root UID/GID
10001, read-only root filesystem and existing resource/security restrictions.
Files are created mode 0600. SQLite does not encrypt the database at rest.

## Administrator setup and management

New account-mode databases without imported administrators start with username
`admin` and password `admin`. **This is a publicly known setup credential. Keep
the backend private (prefer loopback access) until it has been changed.** It is
hashed with the existing salted, fixed-cost Argon2id policy, not stored in plaintext.
On login, the backend redirects to `/admin/administrators`. Until the initial
password is replaced, all other panel APIs/actions are blocked server-side; only
the setup page, its assets and that administrator's own password update are allowed.
No ordinary client account is created by this default.

Choose a unique password containing 12–512 UTF-8 bytes. The initial five-character
password is a bootstrap-only exception, never accepted for a new/reset password.
After saving, refresh and sign in with the new password. Browser Basic Auth may
prompt again; it cannot be reliably logged out server-side. Use a private session.

The **Administrators** page lists usernames and setup state only, and supports
adding administrators, resetting passwords and removing administrators. There are
at most 32, all with full panel privileges, separate from DASS client accounts.
The last administrator cannot be removed, including by concurrent requests.
To replace a username, add the replacement administrator before removing the old
one. Credentials are read from SQLite on every authenticated request: password
changes/removals revoke old credentials without restart. Administrator changes do
not disconnect DASS client media sessions or grant media access. The database
rechecks an administrative writer's current credential inside its transaction.

Legacy `DASS_ADMIN_USERS` remains a one-time import, not a live credential source.
Imported or existing administrators keep their passwords and are not reset to
the default. Invitation-mode databases do not seed an administrator or enable
the account-management panel. Offline `set-admin` is available for recovery.

## Settings page

Open `/admin/settings` using a separate administrator login. The page shows
saved values and, when different, the running values. Saves validate the whole
configuration and commit it atomically. **Restart the backend to apply edits**;
there is no automatic restart or partial live application. Account edits still
apply immediately and disconnect existing DASS sessions.

| SQLite setting | Default | Accepted values |
| --- | --- | --- |
| `DASS_MAX_CONCURRENT_REQUESTS` | 128 | 1–1024 |
| `DASS_MAX_CONTROL_MESSAGE_BYTES` | 16384 | 1024–16384 |
| `DASS_MAX_SESSIONS` | 128 | 1–4096 authenticated sessions |
| `DASS_MAX_UNAUTHENTICATED_SESSIONS` | 0 | Read-only: anonymous access is prohibited |
| `DASS_MAX_LOGIN_HANDSHAKES` | 16 | 1–256 short-lived login handshakes |
| `DASS_MAX_TCP_CONNECTIONS` | 128 | 1–4096 |
| `DASS_MAX_PASSWORD_VERIFICATIONS` | 2 | 1–16 per existing verification pool |
| `DASS_ADMIN_DATA_FILE` | `/var/lib/dass/policy.json` | Read-only legacy import provenance, not live storage |
| `DASS_RTC_AUTO_LAN_PEERS` | false | `true` or `false`; local mode only |
| `DASS_RTC_ALLOWED_PEERS` | empty | Up to 16 comma-separated safe, exact IP:port endpoints |
| `DASS_RTC_TRUSTED_CLIENT_IPS` | empty | Up to 16 comma-separated safe IP addresses |
| `DASS_MAX_MEDIA_SESSIONS` | 4 | 1–64 |
| `DASS_MAX_PACKETS_PER_SECOND` | 2000 | 1–20000 per media session |
| `DASS_MAX_INGRESS_BYTES_PER_SECOND` | 2000000 | 1–20000000 per media session |
| `DASS_MAX_EGRESS_BYTES_PER_SECOND` | 4000000 | 1–40000000 per media session |

The previous `DASS_MAX_UNAUTHENTICATED_SESSIONS` limited **login handshakes**.
Migration moves a nonzero legacy value to `DASS_MAX_LOGIN_HANDSHAKES` unless that
new setting was explicitly supplied, and fixes anonymous access at zero. Login
still has its existing deadline and cannot join rooms or access media before
successful authentication. Zero never means unlimited admission.

Legacy control-message limits up to 65536 are clamped to the existing signaling
ceiling of 16384 during migration. Invalid/zero limits are rejected. All stored
limits and peer lists are validated even while RTC is disabled. Public mode
rejects LAN trust settings. These settings do not edit host firewall rules.

## Provision accounts without hand-writing hashes or JSON

Use `set-user DATABASE_FILE PASSWORD_FILE USERNAME` or
`set-admin DATABASE_FILE PASSWORD_FILE USERNAME`. They create or reset a record
directly in SQLite. Password files contain 12–512 UTF-8 bytes, no control
characters, with an optional final LF/CRLF. Keep them private and mode 0600.
The backend stores only the existing fixed-cost, salted Argon2id hashes.

Stop the backend first. For Compose, place a temporary password file at
`.secrets/accounts/admin-password.txt`, readable by container UID 10001, then:

```sh
docker compose stop backend
docker compose run --rm --no-deps \
  -v "$PWD/.secrets/accounts/admin-password.txt:/run/admin-password.txt:ro" \
  backend set-admin /var/lib/dass/dass.sqlite3 /run/admin-password.txt admin
docker compose up -d backend
```

The one-off container uses the same volume, bootstrap environment and backend UID.
Only it receives the temporary password mount; the running service does not.
For a new installation, ensure bootstrap settings are correct before this command:
the provisioning command also initializes/imports a missing database. New setups
do not need `DASS_USERS` or `DASS_ADMIN_USERS`. No accounts means no client access.
Account mode automatically seeds the initial administrator described above;
invitation mode has no panel. Use Users in the panel to add accounts,
or replace `set-admin` with `set-user` for offline account provisioning.

## Validation (pending Docker execution)

The new dependency is pinned `rusqlite` 0.39.0 (MIT), with default features
disabled and bundled SQLite (public domain). SQLite is compiled into the Rust
executable, not run as another service. No host SQLite library is required.
The 0.40.x series uses `cfg_select!`, unavailable on the pinned Rust 1.90
toolchain; 0.39.0 avoids that incompatibility. Full Docker validation is pending.

For this intentional dependency addition only, resolve the lockfile in Docker:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo update -p dass-backend
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
docker compose build backend
```

Review and retain `Cargo.lock`; subsequent builds/tests remain `--locked`.
Do not regenerate it on routine runs. The full build checks formatting, Clippy,
locked workspace tests and the release binary. Added tests cover one-time import,
policy precedence, hashes, invitation separation, rollback/retry, corrupt/future
databases, bounds, provisioning, settings authentication and atomic restart-only
edits, mandatory administrator setup, administrator CRUD, last-administrator
protection and immediate revocation of old credentials. Run frontend logic checks
locally with `bun test ./tests/admin`.

Real upgrade/restart, browser authentication, account login, live capture/media
and security acceptance remain unverified. Never test migration first against
the only copy of a live database/volume.
