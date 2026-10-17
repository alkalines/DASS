# Control panel

Discord Alternative ScreenShare (DASS) has an optional black-and-white control
panel served by the existing Rust backend, with no extra server or frontend
runtime. It has exactly three pages:

- **Users**: add, edit, reset passwords and remove DASS accounts; edit display
  names only. Validation is shown before saving, including the password's UTF-8
  byte count; a new password must contain 12–512 bytes. Account management
  grants no stream or room permissions: stream admission is decided live by
  each publisher through approval prompts inside the client.
- **Rooms**: a read-only grouping view of joined DASS sessions; rooms carry no
  authority and cannot be blocked or granted. The page can disconnect all DASS
  sessions as a blunt containment action.
- **Streams**: list connected publishers with viewer and pending-request counts.
  **Browser playback is unavailable**: the experimental media implementation
  has one viewer slot backend-wide and signaling accepts only the Discord
  client origin. Watch through a publisher-approved DASS client. Admin
  authentication never grants media permissions.

This is new implementation, **not runtime-accepted or production-ready**. Existing
LAN transport limitations, lack of E2EE and readiness 503 remain unchanged.

## Enable Basic authentication

The panel is disabled unless `DASS_ADMIN_USERS` contains administrator credentials.
It requires account mode (`DASS_USERS`), not legacy invite mode. Use **separate,
strong administrator passwords**, never Discord credentials or ordinary client
passwords. Every configured administrator has full panel privileges.

The exact environment format is:

```text
DASS_ADMIN_USERS=USER1:PASSWORDHASH;USER2:PASSWORDHASH2
```

Hashes must be salted Argon2id PHC hashes with the same fixed, validated parameters
as DASS accounts: version 19, memory 19456 KiB, two iterations, one lane, a 16-byte
salt and a 32-byte output. Plaintext and unsupported hash parameters are rejected.
There are at most 32 unique administrators and 16 KiB of administrator configuration.
Usernames use 1–64 ASCII letters, digits, underscores or hyphens; no trailing `;`.

**Put this environment entry in `.secrets/backend.env`.** `compose.yaml` loads that
file using `format: raw` (Compose >= 2.30) so hash `$` characters survive. Do not
put hashes into interpolated `.env`, paste them into commands or print expanded
Compose configuration. Docker administrators can inspect environment secrets.

All following commands run from the **repository root**. Prepare private
`.secrets/accounts/admin-password.txt` using a trusted editor/password manager:
12–512 UTF-8 bytes, no control characters, with an optional final LF/CRLF. Keep
the directory private and the file mode 0600. Do not mount this password into the
running backend.

```sh
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo run --locked -p dass-backend -- \
  create-admin .secrets/accounts/admin-auth.txt .secrets/accounts/admin-password.txt admin
```

The command writes `admin:<hash>` to a new mode-0600 file, never overwrites an
existing record, and does not print passwords/hashes. For multiple admins, repeat
with distinct usernames/output files, then join records with `;`.

If `.secrets/backend.env` already exists, this Bun command preserves its other
entries and **replaces only** `DASS_ADMIN_USERS`. Include all desired admin record
files in the argument list. Bun is tooling only; the backend remains Rust.

```sh
umask 077
bun -e 'const path = ".secrets/backend.env"; const lines = (await Bun.file(path).text()).split(/\r?\n/).filter(line => line && !line.startsWith("DASS_ADMIN_USERS=")); const records = await Promise.all(Bun.argv.slice(1).map(path => Bun.file(path).text())); await Bun.write(path, [...lines, "DASS_ADMIN_USERS=" + records.map(record => record.trim()).join(";")].join("\n") + "\n");' \
  .secrets/accounts/admin-auth.txt
chmod 600 .secrets/backend.env
```

For a new setup, first follow [LAN account/TLS setup](lan-accounts.md). An empty
bootstrap account configuration `DASS_USERS={"version":2,"users":[]}` is permitted
so accounts can be created in the panel. Version-1 documents with room grants,
expiration, revocation or login IP allowlists fail closed; see the migration
section in [lan-accounts.md](lan-accounts.md). Never enable LAN/public plaintext: Basic
Auth is **encoding, not encryption**. Use trusted HTTPS certificates outside
explicit loopback-only development. The existing backend TLS configuration is
used; no proxy or forwarded IP trust is introduced.

After formatting/checking/building as below, explicitly start/recreate the backend:

```sh
docker compose up -d --build backend
```

Open `https://YOUR_TLS_SERVER:8080/admin/users` (or
`http://127.0.0.1:8080/admin/users` only for isolated local development). The browser
asks for an administrator username and **plaintext password**; the backend verifies
it against the configured hash. Do not use the hash as the login password.

## Persistence and policy

- The named `backend-data` Docker volume holds `/var/lib/dass/policy.json`, writable
  only by backend UID/GID `10001:10001`. The root filesystem remains read-only,
  capability-free and resource-bounded. Protect volume backups: they contain
  password hashes. There is no plaintext password persistence.
- On first panel startup, `DASS_USERS` seeds the durable policy. Thereafter that
  file is authoritative: environment account edits **do not overwrite panel edits**.
  Admin login credentials still come only from the environment and changing them
  requires container recreation. Removing `DASS_ADMIN_USERS` disables the panel
  but continues using existing durable account policy, not the old seed.
- Do not delete the volume as a routine upgrade/reset. A missing file is initialized
  from the seed; corrupt/unreadable policy stops startup rather than falling back.
  Do not switch to invite mode expecting account/panel policy to apply there.
- Writes validate the complete bounded account policy, save with mode 0600 via a
  synced temporary file and atomic rename, then notify signaling. Write failure
  fails authorization closed. Filesystem work/hashing runs in bounded workers.
- **Every policy edit and disconnect action closes all DASS connections**, not
  just one selected room/user. This conservative experimental behavior prevents
  stale authorization and releases RTC-owned UDP admission. Capture/viewer cleanup
  on real clients still needs acceptance. Normal Discord voice is independent;
  DASS streams are not restarted automatically.
- Rooms are implicit client contexts for discovery grouping only. They carry no
  grants, block flags or persistent media state; a publisher's client decides
  stream admission per request. Account removal or password reset is the only
  administrative containment; every policy edit still disconnects all sessions.
- Account `allowed_ips` login restrictions were removed. The accepted TCP peer
  remains authoritative for login rate limiting and automatic RTC admission;
  `Forwarded`, `X-Forwarded-For`, and client claims are ignored. This does
  **not** change host firewall rules or relax RTC safe-destination/LAN candidate
  policies. RTC automatic admission still supports only private/loopback IPv4,
  not IPv6 media.
- No admin CORS permissions are granted. Writes require JSON and a non-simple
  custom header; cross-site browser requests are denied. Responses disable caching,
  framing and inline scripts. Password hashes never appear in panel API responses.
  Basic checks have a global 8/sec limit and two workers, not a production-grade
  brute-force defense. Browser Basic credential caching has no reliable server-side
  logout; use a private browser session and close it when finished.

## Validation

Frontend UI-logic tests passed with Bun 1.4.3: **8 tests, 40 assertions** using a
small fake DOM. The browser script also bundled successfully. This checks page
rendering, request headers/payloads, validation and error handling, not real browser Basic Auth
or backend/media behavior. Run locally with `bun test ./tests/admin`.

Docker socket access was denied in the agent environment. Rust formatting, Clippy,
compilation and tests **have not run** for this change. No server was started and
no secrets or existing accounts were changed. Run these Docker-only commands:

```sh
docker build --target tooling -t dass-rust-tools .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" dass-rust-tools cargo fmt --all
docker compose build backend
```

The build checks formatting, denies Clippy warnings, runs locked workspace tests
and builds the release image. New tests cover credential parsing, panel route
authentication, CSRF refusal, durable account CRUD, hash redaction, legacy
document fail-closed loading and policy-change notifications. They remain
**unexecuted** here.
GUI/runtime acceptance should additionally check browser Basic login, user password
reset/removal, restart persistence, containment during live media, actual TCP source
addresses, release of UDP admission and unauthorized panel access. Build success
alone is not runtime/security evidence.
